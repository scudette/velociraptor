package api

import (
	context "golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"www.velocidex.com/golang/velociraptor/acls"
	api_proto "www.velocidex.com/golang/velociraptor/api/proto"
	"www.velocidex.com/golang/velociraptor/services"
	"www.velocidex.com/golang/velociraptor/utils"
)

func (self *ApiServer) GetOrganizations(
	ctx context.Context,
	in *emptypb.Empty) (*api_proto.Organizations, error) {

	users_manager := services.GetUserManager()
	user_record, org_config_obj, err := users_manager.GetUserFromContext(ctx)
	if err != nil {
		return nil, err
	}

	perm, err := acls.CheckAccess(org_config_obj, user_record.Name, acls.ORG_ADMIN)
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

	if !isMemberOfRootOrg(user_record.Orgs) {
		allowedOrgs := []*api_proto.OrgRecord{}
		hasOrgs := map[string]bool{}
		for _, org := range user_record.Orgs {
			hasOrgs[org.Id] = true
		}

		for _, orgrec := range result.Orgs {
			_, found := hasOrgs[orgrec.OrgId]
			if !found {
				continue
			}

			allowedOrgs = append(allowedOrgs, orgrec)
		}

		result.Orgs = allowedOrgs
	}

	return result, nil
}

func isMemberOfRootOrg(orgs []*api_proto.Org) bool {
	// Implicit root org membership
	if len(orgs) == 0 {
		return true
	}

	for _, org := range orgs {
		if utils.IsRootOrg(org.Id) {
			return true
		}
	}

	return false
}
