package api

import (
	context "golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"www.velocidex.com/golang/velociraptor/acls"
	api_proto "www.velocidex.com/golang/velociraptor/api/proto"
	"www.velocidex.com/golang/velociraptor/services"
)

func (self *ApiServer) GetOrganizations(
	ctx context.Context,
	in *emptypb.Empty) (*api_proto.Organizations, error) {

	users_manager := services.GetUserManager()
	user_record, org_config_obj, err := users_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, err
	}

	perm, err := services.CheckAccess(
		org_config_obj, user_record.Name, acls.ORG_ADMIN)
	if !perm || err != nil {
		return nil, status.Error(codes.PermissionDenied,
			"User is not allowed to enumerate organizations.")
	}

	org_manager, err := services.GetOrgManager()
	if err != nil {
		return nil, err
	}

	result := &api_proto.Organizations{}
	result.Orgs = org_manager.ListOrgs()

	return result, nil
}
