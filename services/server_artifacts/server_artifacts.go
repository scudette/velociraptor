/*

   This service provides a runner to execute artifacts on the server.
   Server artifacts run with high privilege and so only users with the
   COLLECT_SERVER permission can run those.

   Server artifacts are used for administration or information purposes.

*/

package server_artifacts

import (
	"context"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"time"

	"github.com/Velocidex/ordereddict"
	"github.com/pkg/errors"
	"www.velocidex.com/golang/velociraptor/artifacts"
	config_proto "www.velocidex.com/golang/velociraptor/config/proto"
	crypto_proto "www.velocidex.com/golang/velociraptor/crypto/proto"
	"www.velocidex.com/golang/velociraptor/datastore"
	flows_proto "www.velocidex.com/golang/velociraptor/flows/proto"
	"www.velocidex.com/golang/velociraptor/logging"
	"www.velocidex.com/golang/velociraptor/paths"
	"www.velocidex.com/golang/velociraptor/result_sets"
	"www.velocidex.com/golang/velociraptor/services"
	"www.velocidex.com/golang/velociraptor/utils"
	vql_subsystem "www.velocidex.com/golang/velociraptor/vql"
	"www.velocidex.com/golang/vfilter"
)

var (
	mu sync.Mutex
)

type contextManager struct {
	context      *flows_proto.ArtifactCollectorContext
	mu           sync.Mutex
	config_obj   *config_proto.Config
	path_manager *paths.FlowPathManager
}

func NewCollectionContext(
	config_obj *config_proto.Config,
	client_id string,
	flow_id string) (*contextManager, error) {

	self := &contextManager{
		config_obj:   config_obj,
		path_manager: paths.NewFlowPathManager(client_id, flow_id),
	}

	self.context = &flows_proto.ArtifactCollectorContext{}
	db, err := datastore.GetDB(self.config_obj)
	if err != nil {
		return nil, err
	}

	err = db.GetSubject(self.config_obj, self.path_manager.Path(), self.context)
	if err != nil {
		return nil, err
	}

	return self, nil
}

func (self *contextManager) Modify(cb func(context *flows_proto.ArtifactCollectorContext)) {
	mu.Lock()
	defer mu.Unlock()

	cb(self.context)
}

func (self *contextManager) Save() error {
	mu.Lock()
	defer mu.Unlock()
	db, err := datastore.GetDB(self.config_obj)
	if err != nil {
		return err
	}
	return db.SetSubject(self.config_obj, self.path_manager.Path(), self.context)
}

type serverLogger struct {
	config_obj   *config_proto.Config
	path_manager *paths.FlowPathManager
}

// Send each log message individually to avoid any buffering - logs
// need to be available immediately.
func (self *serverLogger) Write(b []byte) (int, error) {
	msg := artifacts.DeobfuscateString(self.config_obj, string(b))
	services.GetJournal().PushRows(self.config_obj,
		self.path_manager, []*ordereddict.Dict{
			ordereddict.NewDict().
				Set("Timestamp", time.Now().UTC().UnixNano()/1000).
				Set("time", time.Now().UTC().String()).
				Set("message", msg)})
	return len(b), nil
}

type ServerArtifactsRunner struct {
	config_obj       *config_proto.Config
	timeout          time.Duration
	mu               sync.Mutex
	cancellationPool map[string]func()
}

func (self *ServerArtifactsRunner) Start(
	ctx context.Context,
	config_obj *config_proto.Config,
	wg *sync.WaitGroup) {
	defer wg.Done()

	logger := logging.GetLogger(
		self.config_obj, &logging.FrontendComponent)

	// Listen for notifications from the server.
	notification, cancel := services.GetNotifier().ListenForNotification("server")
	defer cancel()

	self.process(ctx, config_obj, wg)

	for {
		select {
		// Check the queues anyway every minute in case we miss the
		// notification.
		case <-time.After(time.Duration(60) * time.Second):
			self.process(ctx, config_obj, wg)

		case <-ctx.Done():
			return

		case quit := <-notification:
			if quit {
				logger.Info("ServerArtifactsRunner: quit.")
				return
			}
			err := self.process(ctx, config_obj, wg)
			if err != nil {
				logger.Error("ServerArtifactsRunner: %v", err)
				return
			}

			// Listen again.
			cancel()
			notifier := services.GetNotifier()
			if notifier == nil {
				return
			}
			notification, cancel = notifier.ListenForNotification("server")
		}
	}
}

func (self *ServerArtifactsRunner) process(
	ctx context.Context,
	config_obj *config_proto.Config,
	wg *sync.WaitGroup) error {

	logger := logging.GetLogger(
		self.config_obj, &logging.FrontendComponent)

	db, err := datastore.GetDB(self.config_obj)
	if err != nil {
		return err
	}

	tasks, err := db.GetClientTasks(self.config_obj, "server", true)
	if err != nil {
		return err
	}

	wg.Add(1)
	defer func() {
		defer wg.Done()

		for _, task := range tasks {
			err := self.processTask(ctx, config_obj, task)
			if err != nil {
				logger.Error("ServerArtifactsRunner: %v", err)
			}
		}
	}()

	return nil
}

func (self *ServerArtifactsRunner) cancel(flow_id string) {
	self.mu.Lock()
	defer self.mu.Unlock()

	cancel, pres := self.cancellationPool[flow_id]
	if pres {
		cancel()
		delete(self.cancellationPool, flow_id)
	}
}

func (self *ServerArtifactsRunner) processTask(
	ctx context.Context,
	config_obj *config_proto.Config,
	task *crypto_proto.GrrMessage) error {

	collection_context, err := NewCollectionContext(
		self.config_obj, "server", task.SessionId)
	if err != nil {
		return err
	}

	db, _ := datastore.GetDB(self.config_obj)
	db.UnQueueMessageForClient(self.config_obj, "server", task)

	if task.Cancel != nil {
		path_manager := paths.NewFlowPathManager("server", task.SessionId).Log()
		services.GetJournal().PushRows(config_obj, path_manager, []*ordereddict.Dict{
			ordereddict.NewDict().
				Set("Timestamp", time.Now().UTC().UnixNano()/1000).
				Set("time", time.Now().UTC().String()).
				Set("message", "Cancelling Query")})

		self.cancel(task.SessionId)
		return nil
	}

	// Kick off processing in the background and go back to
	// listening for new tasks. We can then cancel this task
	// later.
	go func() {
		self.runQuery(ctx, task, collection_context)

		collection_context.Modify(func(context *flows_proto.ArtifactCollectorContext) {
			context.State = flows_proto.ArtifactCollectorContext_TERMINATED
			context.ActiveTime = uint64(time.Now().UnixNano() / 1000)
			context.KillTimestamp = uint64(time.Now().UnixNano() / 1000)
		})
		collection_context.Save()
	}()

	return nil
}

func (self *ServerArtifactsRunner) runQuery(
	ctx context.Context,
	task *crypto_proto.GrrMessage,
	collection_context *contextManager) error {

	// Set up the logger for writing query logs. Note this must be
	// destroyed last since we need to be able to receive logs
	// from scope destructors.
	arg := task.VQLClientAction
	if arg == nil {
		return errors.New("VQLClientAction should be specified.")
	}

	if arg.Query == nil {
		return errors.New("Query should be specified")
	}

	// Cancel the query after this deadline
	deadline := time.After(self.timeout)
	started := time.Now().Unix()
	sub_ctx, cancel := context.WithCancel(ctx)

	self.mu.Lock()
	self.cancellationPool[task.SessionId] = cancel
	self.mu.Unlock()

	defer func() {
		self.cancel(task.SessionId)
	}()

	// Where to write the logs.
	path_manager := paths.NewFlowPathManager("server", task.SessionId)

	// Server artifacts run with full access. In order to collect
	// them in the first place we need COLLECT_SERVER permissions.
	scope := services.GetRepositoryManager().BuildScope(services.ScopeBuilder{
		Config: self.config_obj,

		// For server artifacts, upload() ends up writing in
		// the file store. NOTE: This allows arbitrary
		// filestore write. Using this we can manager the
		// files in the filestore using VQL artifacts.
		Uploader: NewServerUploader(self.config_obj,
			path_manager, collection_context),
		ACLManager: vql_subsystem.NewRoleACLManager("administrator"),
		Logger: log.New(&serverLogger{
			self.config_obj,
			path_manager.Log(),
		}, "", 0),
	})
	defer scope.Close()

	env := ordereddict.NewDict()
	for _, env_spec := range arg.Env {
		env.Set(env_spec.Key, env_spec.Value)
	}
	scope.AppendVars(env)

	// If we panic below we need to recover and report this to the
	// server.
	defer func() {
		r := recover()
		if r != nil {
			scope.Log(string(debug.Stack()))
		}
	}()

	scope.Log("<green>Starting</> query execution.")

	// All the queries will use the same scope. This allows one
	// query to define functions for the next query in order.
	for _, query := range arg.Query {
		vql, err := vfilter.Parse(query.VQL)
		if err != nil {
			return err
		}

		read_chan := vql.Eval(sub_ctx, scope)
		var rs_writer *result_sets.ResultSetWriter
		if query.Name != "" {
			name := artifacts.DeobfuscateString(
				self.config_obj, query.Name)

			opts := vql_subsystem.EncOptsFromScope(scope)
			path_manager := result_sets.NewArtifactPathManager(
				self.config_obj, "server", task.SessionId, name)
			rs_writer, err = result_sets.NewResultSetWriter(
				self.config_obj, path_manager, opts, false /* truncate */)
			defer rs_writer.Close()

			// Update the artifacts with results in the
			// context.
			collection_context.Modify(
				func(context *flows_proto.ArtifactCollectorContext) {
					if !utils.InString(
						context.ArtifactsWithResults, name) {
						context.ArtifactsWithResults = append(
							context.ArtifactsWithResults, name)
					}
				})
		}

		row_idx := 0

	process_query:
		for {
			select {
			case <-deadline:
				msg := fmt.Sprintf("Query timed out after %v seconds",
					time.Now().Unix()-started)
				scope.Log(msg)

				// Cancel the sub ctx but do not exit
				// - we need to wait for the sub query
				// to finish after cancelling so we
				// can at least return any data it
				// has.
				cancel()

				// Try again after a while to prevent spinning here.
				deadline = time.After(self.timeout)

			case row, ok := <-read_chan:
				if !ok {
					break process_query
				}
				if rs_writer != nil {
					row_idx += 1
					rs_writer.Write(vfilter.RowToDict(
						sub_ctx, scope, row))
				}
			}
		}

		if query.Name != "" {
			scope.Log("Query %v: Emitted %v rows", query.Name, row_idx)
		}
	}

	return nil
}

func StartServerArtifactService(
	ctx context.Context,
	wg *sync.WaitGroup,
	config_obj *config_proto.Config) error {

	result := &ServerArtifactsRunner{
		config_obj:       config_obj,
		timeout:          time.Second * time.Duration(600),
		cancellationPool: make(map[string]func()),
	}

	logger := logging.GetLogger(
		config_obj, &logging.FrontendComponent)
	logger.Info("<green>Starting</> Server Artifact Runner Service")

	wg.Add(1)
	go result.Start(ctx, config_obj, wg)

	return nil
}
