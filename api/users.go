package api

import (
	"sort"

	"github.com/sirupsen/logrus"
	context "golang.org/x/net/context"
	"google.golang.org/protobuf/types/known/emptypb"
	api_proto "www.velocidex.com/golang/velociraptor/api/proto"
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

	if in.WithRoles {
		for _, user := range users {
			user.Permissions, err = services.GetPolicy(org_config_obj, user.Name)
			if err != nil {
				return nil, err
			}
		}
	}

	sort.Slice(users, func(i, j int) bool {
		return users[i].Name < users[j].Name
	})
	result.Users = users

	return result, nil
}

func (self *ApiServer) ChangeUser(ctx context.Context,
	in *api_proto.ChangeUserRequest,
	createUser bool) (*emptypb.Empty, error) {

	utils.Debug(in)

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

func (self *ApiServer) DeleteUser(
	ctx context.Context,
	in *api_proto.UserRequest) (*emptypb.Empty, error) {

	utils.Debug(in)

	return &emptypb.Empty{}, nil
}

func (self *ApiServer) GetUser(
	ctx context.Context, in *api_proto.UserRequest) (*api_proto.VelociraptorUser, error) {

	users_manager := services.GetUserManager()
	user_record, org_config_obj, err := users_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, err
	}

	principal := user_record.Name
	user, err := users.GetUser(ctx, principal, in.Name)
	if err != nil {
		return nil, err
	}

	user.Permissions, err = services.GetPolicy(org_config_obj, in.Name)
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
