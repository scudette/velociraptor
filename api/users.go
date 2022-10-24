package api

import (
	"crypto/rand"
	"fmt"
	"sort"

	"github.com/sirupsen/logrus"
	context "golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"www.velocidex.com/golang/velociraptor/api/authenticators"
	api_proto "www.velocidex.com/golang/velociraptor/api/proto"
	config_proto "www.velocidex.com/golang/velociraptor/config/proto"
	"www.velocidex.com/golang/velociraptor/logging"
	"www.velocidex.com/golang/velociraptor/services"
	"www.velocidex.com/golang/velociraptor/users"
	"www.velocidex.com/golang/velociraptor/utils"
)

// This is only used to set the user's own password which is always
// allowed for any user.
func (self *ApiServer) SetPassword(
	ctx context.Context,
	in *api_proto.SetPasswordRequest) (*emptypb.Empty, error) {

	// Enforce a minimum length password
	if len(in.Password) < 4 {
		return nil, InvalidStatus("Password is not set or too short")
	}

	user_manager := services.GetUserManager()
	user_record, _, err := user_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, Status(self.verbose, err)
	}

	principal := user_record.Name
	err = users.SetUserPassword(ctx, principal, principal, in.Password, "")
	if err != nil {
		return nil, Status(self.verbose, err)
	}

	org_manager, err := services.GetOrgManager()
	if err != nil {
		return nil, Status(self.verbose, err)
	}

	org_config_obj, err := org_manager.GetOrgConfig(services.ROOT_ORG_ID)
	if err != nil {
		return nil, Status(self.verbose, err)
	}

	logger := logging.GetLogger(org_config_obj, &logging.Audit)
	logger.WithFields(logrus.Fields{
		"Username":  user_record.Name,
		"Principal": user_record.Name,
	}).Info("passwd: Updating password for user via API")

	return &emptypb.Empty{}, nil
}

type userByName []*api_proto.VelociraptorUser

func (s userByName) Len() int {
	return len(s)
}
func (s userByName) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}
func (s userByName) Less(i, j int) bool {
	return s[i].Name < s[j].Name
}

func (self *ApiServer) GetUsers(
	ctx context.Context,
	in *api_proto.GetUsersRequest) (*api_proto.Users, error) {

	user_manager := services.GetUserManager()
	user_record, org_config_obj, err := user_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, Status(self.verbose, err)
	}

	principal := user_record.Name
	result := &api_proto.Users{}

	// Only show users in the current org
	users, err := users.ListUsers(ctx, principal, []string{org_config_obj.OrgId})
	if err != nil {
		return nil, Status(self.verbose, err)
	}

	if filterOrgs {
		newUsers := []*api_proto.VelociraptorUser{}
		callerOrgs := map[string]bool{}
		for _, org := range user_record.Orgs {
			callerOrgs[org.Id] = true

		}

		for _, user := range users {
			for _, org := range user.Orgs {
				_, found := callerOrgs[org.Id]
				if found {
					newUsers = append(newUsers, user)
					break
				}
			}
		}
		users = newUsers
	}

	if in.WithRoles {
		for _, user := range users {
			user.Permissions, err = acls.GetPolicy(org_config_obj, user.Name)
			if err != nil {
				return nil, err
			}
		}
	}

	sort.Sort(userByName(users))
	result.Users = users

	return result, nil
}

func checkOrgMembership(requestedOrgs []*api_proto.Org, hasOrgs []*api_proto.Org) bool {
	if isMemberOfRootOrg(hasOrgs) {
		return true
	}

	for _, requestedOrg := range requestedOrgs {
		found := false
		for _, hasOrg := range hasOrgs {
			if utils.CompareOrgIds(requestedOrg.Id, hasOrg.Id) {
				found = true
				break
			}
		}

		if !found {
			return false
		}
	}

	return true
}

func setPassword(org_config_obj *config_proto.Config,
	user_record *api_proto.VelociraptorUser, password string,
	createUser bool) error {
	authenticator, err := authenticators.NewAuthenticator(org_config_obj)
	if err != nil {
		return err
	}

	// Set a random password if none is provided to prevent login should the authentication
	// method is later changed to one that does require a password
	if authenticator.IsPasswordLess() && password == "" &&
		(createUser || len(user_record.PasswordHash) == 0) {
		randomPassword := make([]byte, 100)
		_, err = rand.Read(randomPassword)
		if err != nil {
			return err
		}
		password = string(password)
	}

	if createUser && password == "" {
		// Do not accept an empty password if we are using a password
		// based authenticator.
		return fmt.Errorf("Authentication requires a password but one was not provided.")
	}

	if password != "" {
		users.SetPassword(user_record, password)
	}

	return nil
}

func grantUserRoles(config_obj *config_proto.Config, org_manager *services.OrgManager,
	user_record *api_proto.VelociraptorUser) error {
	// No OrgIds specified - the user will be created in the root org.
	if len(user_record.Orgs) == 0 {
		// Grant the roles to the user
		return acls.GrantRoles(config_obj, user_record.Name,
			user_record.Permissions.Roles)
	}

	for _, org := range user_record.Orgs {
		org_config_obj, err := (*org_manager).GetOrgConfig(org.Id)
		if err != nil {
			return err
		}

		// Grant the roles to the user
		err = acls.GrantRoles(org_config_obj, user_record.Name,
			user_record.Permissions.Roles)
		if err != nil {
			return err
		}
	}

	return nil
}

func (self *ApiServer) ChangeUser(ctx context.Context,
	in *api_proto.ChangeUserRequest,
	createUser bool) (*emptypb.Empty, error) {

	users_manager := services.GetUserManager()

	active_user, org_config_obj, err := users_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, err
	}

	perm, err := acls.CheckAccess(org_config_obj, active_user.Name, acls.SERVER_ADMIN)
	if !perm || err != nil {
		return nil, status.Error(codes.PermissionDenied,
			"User is not allowed to create users.")
	}

	if in.User.Name == "" {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid empty username")
	}

	org_admin, err := acls.CheckAccess(org_config_obj, active_user.Name, acls.ORG_ADMIN)
	if err != nil {
		return nil, err
	}

	user_record, err := users_manager.GetUserWithHashes(ctx, in.User.Name)
	if err == services.UserNotFoundError {
		if !createUser {
			return nil, status.Errorf(codes.NotFound, "User %s does not exist.",
				in.User.Name)
		}

		user_record, err = users.NewUserRecord(in.User.Name)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%s", err)
		}
	} else if err != nil {
		return nil, err
	} else if user_record != nil && createUser {
		return nil, status.Errorf(codes.AlreadyExists,
			"Cannot create user %s.  Username already exists",
			in.User.Name)
	}

	// Remove any duplicates
	orgs := []*api_proto.Org{}
	seen := map[string]bool{}
	for _, org := range in.User.Orgs {
		_, ok := seen[org.Id]
		if !ok {
			seen[org.Id] = true
			orgs = append(orgs, org)
		}
	}
	in.User.Orgs = orgs[:]

	if !org_admin {
		if !checkOrgMembership(in.User.Orgs, active_user.Orgs) {
			return nil, status.Error(codes.PermissionDenied,
				"User is not allowed to add users to orgs without the org admin role or being a member of all requested orgs.")
		}
		if !createUser {
			removed := map[string]*api_proto.Org{}
			for _, org := range user_record.Orgs {
				removed[org.Id] = org

			}
			for _, org := range in.User.Orgs {
				delete(removed, org.Id)
			}
			required_orgs := make([]*api_proto.Org, 0, len(removed))
			idx := 0
			for _, v := range removed {
				required_orgs[idx] = v
				idx += 1
			}

			if !checkOrgMembership(required_orgs, active_user.Orgs) {
				return nil, status.Error(codes.PermissionDenied,
					"User is not allowed to remove users from orgs without the org admin role or being a member of the org.")
			}
		}
	}

	org_manager, err := services.GetOrgManager()
	if err != nil {
		return nil, err
	}

	config_obj, err := org_manager.GetOrgConfig(services.ROOT_ORG_ID)
	if err != nil {
		return nil, err
	}

	err = setPassword(config_obj, in.User, in.Password, createUser)
	if err != nil {
		return nil, err
	}

	err = grantUserRoles(config_obj, &org_manager, in.User)
	if err != nil {
		return nil, err
	}

	user_record.Email = in.User.Email
	user_record.Picture = in.User.Picture
	user_record.VerifiedEmail = in.User.VerifiedEmail

	// This must go after setting the password since SetPassword clears the Locked flag
	user_record.Locked = in.User.Locked

	err = users_manager.SetUser(ctx, user_record)
	if err != nil {
		return nil, err
	}

	msg := "users: Updating user record via API"
	if createUser {
		msg = "users: Creating user record via API"
	}

	logger := logging.GetLogger(org_config_obj, &logging.Audit)
	logger.WithFields(logrus.Fields{
		"Username":  active_user.Name,
		"Principal": user_record.Name,
	}).Info(msg)

	return &emptypb.Empty{}, nil
}

func (self *ApiServer) CreateUser(ctx context.Context,
	in *api_proto.ChangeUserRequest) (*emptypb.Empty, error) {
	return self.ChangeUser(ctx, in, true)
}

func (self *ApiServer) UpdateUser(ctx context.Context,
	in *api_proto.ChangeUserRequest) (*emptypb.Empty, error) {
	return self.ChangeUser(ctx, in, false)
}

func (self *ApiServer) GetUser(
	ctx context.Context, in *api_proto.UserRequest) (*api_proto.VelociraptorUser, error) {

	users_manager := services.GetUserManager()
	user_record, org_config_obj, err := users_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, err
	}

	if user_record.Name != in.Name {
		permissions := acls.SERVER_ADMIN
		perm, err := acls.CheckAccess(org_config_obj, user_record.Name, permissions)
		if !perm || err != nil {
			return nil, status.Error(codes.PermissionDenied,
				"User is not allowed to view this user.")
		}
	}

	user, err := users_manager.GetUser(ctx, in.Name)
	if err != nil {
		return nil, err
	}

	user.Permissions, err = acls.GetPolicy(org_config_obj, in.Name)
	if err != nil {
		return nil, err
	}

	return user, nil
}

func (self *ApiServer) GetUserFavorites(
	ctx context.Context,
	in *api_proto.Favorite) (*api_proto.Favorites, error) {

	// No special permission requires to view a user's own favorites.
	users_manager := services.GetUserManager()
	user_record, org_config_obj, err := users_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, Status(self.verbose, err)
	}
	principal := user_record.Name
	return users_manager.GetFavorites(ctx, org_config_obj, principal, in.Type)
}
