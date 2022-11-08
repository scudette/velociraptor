import React, { Component } from 'react';
import api from '../core/api-service.js';
import _ from 'lodash';
import axios from 'axios';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Col from 'react-bootstrap/Row';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import T from '../i8n/i8n.js';
import Card  from 'react-bootstrap/Card';
import UserConfig from '../core/user.js';
import { withSnackbar } from 'react-simple-snackbar';
import "./user.css";


const roleList = [
    "administrator",
    "org_admin",
    "artifact_writer",
    "investigator",
    "analyst",
    "reader",
    "api",
];

const permissionsByRole = {
    administrator : [ "all_query", "any_query", "read_results", "label_clients",
                      "collect_client", "collect_server", "artifact_writer",
                      "server_artifact_writer", "execve", "notebook_editor", "impersonation",
                      "server_admin", "filesystem_read", "filesystem_write", "machine_state",
                      "prepare_results" ],
    org_admin : [ "org_admin" ],
    reader : [ "read_results" ],
    api : [ "any_query", "read_results" ],
    analyst : [ "read_results", "notebook_editor", "label_clients", "any_query",
                "prepare_results" ],
    investigator : [ "read_results", "notebook_editor", "collect_client", "label_clients",
                     "any_query", "prepare_results" ],
    artifact_writer : [ "artifact_writer" ]
};

const permissionNames = {
    "all_query" : "AllQuery",
    "any_query" : "AnyQuery",
    "read_results" : "ReadResults",
    "collect_client" : "CollectClient",
    "collect_server" : "CollectServer",
    "artifact_writer" : "ArtifactWriter",
    "execve" : "Execve",
    "notebook_editor" : "NotebookEditor",
    "label_clients" : "LabelClients", // Permission to apply labels to clients
    "server_admin" : "ServerAdmin",
    "filesystem_read" : "FilesystemRead",
    "filesystem_write" : "FilesystemWrite",
    "server_artifact_writer" : "ServerArtifactWriter",
    "machine_state" : "MachineState",
    "prepare_results" : "PrepareResults",
    "datastore_access" : "DatastoreAccess",
    "org_admin" : "OrgAdmin",
};

class UserState {
    constructor () {
        this.roles = [];
        this.permissions = {};

        this.fields = {
            'name': '',
            'email': '',
            'picture': '',
            'verified_email': false,
            // read_only exists but is unused
            'locked': false,
            'orgs': [],
            'currentOrg': '',
            'failed' : false,
        };

        this.password = '';
    }

    as_dict() {
        let user = Object.assign({}, this.fields);
        user['Permissions'] = { 'roles' : [...this.roles]};
        return user;
    }

    hasPermission(perm) {
        return perm in this.permissions && this.permissions[perm];
    }

    hasRole(role) {
        return this.roles.indexOf(role) !== -1;
    }

    updateImpliedPermissions() {
        this.permissions = {};
        this.roles.forEach((role) => {
            permissionsByRole[role].forEach((perm) => {
                this.permissions[perm] = true;
            });
        });
    }

    modifyRoles(role, present) {
        if (present) {
            this.roles.push(role);
        } else if (!present) {
            this.roles = this.roles.filter((elem) => { return elem !== role });
        }

        this.updateImpliedPermissions();
    }

    modifyPermissionValue(perm, value) {
        this.permissions[perm] = value;
    }

    isMemberOf(org_id) {
        for (let i = 0; i < this.fields.orgs.length; i++) {
            if (org_id === this.fields.orgs[i].id) {
                return true;
            }
        }

        return false;
    }

    setRootOrg() {
        this.fields.orgs = [ { "id" : "root", "name" : "<root>" } ];
    }

    modifyOrgs(org, present, allOrgs) {
        console.log("org " + org.id + " present " + present);
        if (!present) {
            if (org.id === "root") {
                this.fields.orgs = allOrgs.filter((elem) => {
                    return elem.id !== "root";
                });
            } else {
                this.fields.orgs = this.fields.orgs.filter((elem) => {
                    return elem.id !== org.id;
                });
                if (this.fields.orgs.length === 0) {
                    this.setRootOrg();
                    return false;
                }
            }
        } else if (present) {
            if (org.id === "root") {
                this.setRootOrg();
            } else {
                this.fields.orgs.push({id: org.id, name: org.name});
            }
        }

        return true;
    }

    clone() {
        let user = new UserState();
        user.permissions = { ...this.permissions };
        user.roles = [ ...this.roles ];
        user.fields = { ...this.fields };
        user.password = this.password;
        return user;
    }

    static permissionList() {
        let perms = Object.keys(permissionNames);
        return perms.sort();
    }

};

const renderToolTip = (props, value) => (
    <Tooltip show={T(value)} {...props}>
        {T(value)}
    </Tooltip>
);

export class User extends Component {
    static contextType = UserConfig;

    state = {
        user : new UserState(),
        dirty: false,
        mode: undefined,
    }

    componentDidMount = () => {
        this.source = axios.CancelToken.source();

        if (this.props.user) {
            this.maybeUpdateUser();
        }
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (prevProps.mode === this.props.mode &&
            prevProps.user === this.props.user) {
            return;
        }

        this.maybeUpdateUser();
    }

    componentWillUnmount() {
      this.source.cancel("unmounted");
    }

    maybeUpdateUser() {
        if (this.props.mode === "edit" || this.props.mode === "view") {
            this.loadUser(this.props.user);
        } else {
            let user = new UserState();
            user.setRootOrg();
            this.setState({'user' : user });
        }
    }

    handleCreate(e) {
        e.preventDefault();

        this.source.cancel();
        this.source = axios.CancelToken.source();

        let user = this.state.user.as_dict();

        let endpoint = "";

        if (this.props.mode === 'create') {
            endpoint = "v1/CreateUser";
        } else {
            endpoint = "v1/UpdateUser";
        }

        api.post(endpoint, {
            'User': user, 'password': this.state.user.password,
        }, this.source.token).then((response) => {
            if (!response.cancel) {
                this.setState({ 'dirty' : false });
                this.props.userCreatedCallback(
                    this.state.user.fields.name, this.state.user.roles,
                    this.state.user.fields.orgs);
                this.props.openSnackbar(T("User updated."));
                this.passwordInput.value = '';
            }
        }, (reason) => {}); // Just to silence uncaught exceptions.  api will report the error.
    }

    loadUser(user) {
        this.source.cancel();
        this.source = axios.CancelToken.source();

        api.get("v1/GetUser/" + user, {}, this.source.token).then((response) => {
            if (response.cancel) {
                return;
            }
            let new_user_state = new UserState();

            for (const [data_key, data_value] of Object.entries(response.data)) {
                if (data_key === "Permissions") {
                    for (const [perm_key, perm_value] of Object.entries(data_value)) {
                        if (perm_key === "roles") {
                            perm_value.forEach((e) => { new_user_state.modifyRoles(e, true); });
                        } else if (perm_key !== "publish_queues") {
                            new_user_state.modifyPermissionValue(perm_key, perm_value);
                        }
                    }
                } else {
                    new_user_state.fields[data_key] = data_value;
                }
            }

            if (new_user_state.fields.orgs.length === 0) {
                new_user_state.setRootOrg();
            }

            this.setState({'user' : new_user_state});
            this.passwordInput = '';
        }, (reason) => {
            let new_user_state = new UserState();
            new_user_state.setRootOrg();
            new_user_state.name = user;
            new_user_state.failed = true;
            this.setState({'user' : new_user_state});
        });
    };

    changeRole(role, e) {
        let value = e.currentTarget.checked;
        this.setState((state) => {
            let user_state = state.user.clone();
            user_state.modifyRoles(role, value);
            return { 'user' : user_state, 'dirty' : true };
        });
    }

    changePermission(perm, e) {
        let value = e.currentTarget.checked;
        this.setState((state) => {
            let user_state = state.user.clone();
            user_state.modifyPermissionValue(perm, value);
            return { 'user' : user_state, 'dirty' : true };
        });
    }

    changeOrg(org, e) {
        let value = e.currentTarget.checked;
        console.log("changeOrg org " + org.id + " present " + value);
        this.setState((state) => {
            let user_state = state.user.clone();
            if (user_state.modifyOrgs(org, value, this.props.orgs) === false) {
                    this.props.openSnackbar(
                        T("A user without an organization defaults to membership in the root organization."));
            }
            return { 'user' : user_state, 'dirty' : true };
        });
    }

    setUserState(name, value) {
        this.setState((state) => {
            let user_state = state.user.clone();
            user_state.fields[name] = value;
            return { 'user' : user_state, 'dirty' : true };
        });
    }

    setUserPassword(name, value) {
        this.setState((state) => {
            let user_state = state.user.clone();
            user_state.password = value;
            return { 'user' : user_state, 'dirty' : true };
        });
    }

    wrapToolTipOverlay(wrapped, toolTipName) {
      return (
        <OverlayTrigger
          delay={{show: 250, hide: 400}} placement="right"
          overlay={(props)=>renderToolTip(props, toolTipName)}>
            <div>
            {wrapped}
            </div>
         </OverlayTrigger>
      );
    }

    renderUsernameForm() {
        let newUser = this.props.mode === 'create';
        let placeholder = T("Username");
        if (!newUser) {
            placeholder = this.props.user;
        }
        return (
          <Form.Group as={Col}>
            <Form.Label>{T("Username")}</Form.Label>
            <Form.Control placeholder={placeholder} readOnly={!newUser}
                          onChange={(e) => this.setUserState('name', e.target.value)}/>
          </Form.Group>
        );
    }

    renderUsernameField() {
        if (this.props.password_less) {
            return this.wrapToolTipOverlay(this.renderUsernameForm(), "ToolUsernamePasswordless");
        }
        return this.renderUsernameForm();
    }

    renderPasswordForm() {
        let disabled = false;
        let placeholder = T("Password");
        if (this.props.password_less) {
            disabled = true;
            placeholder = T("Password must be changed with authentication provider");
        }

        return (
          <Form.Group as={Col}>
            <Form.Label>{T("Password")}</Form.Label>
            <Form.Control type="password"
                          placeholder={placeholder}
                          disabled={disabled}
                          ref={input=>{ this.passwordInput = input; }}
                          autoComplete="new-password"
                          onChange={(e) => this.setUserPassword('password', e.target.value)}/>
          </Form.Group>
        );
    }

    renderEmailAddress() {
        return (
          <Form.Group as={Col}>
            <Form.Label>{T("Email Address")}</Form.Label>
            <Form.Control placeholder="Email" disabled={!this.props.admin}
                         onChange={(e) => this.setUserState('email', e.target.value)}
                         value={this.state.user.fields.email}/>
          </Form.Group>
        );
    }

    renderUserInfo() {
        return (
          <div className="col-sm-4">
           <Card>
            <Card.Header>
             User Information
            </Card.Header>
            <Card.Body>
             { this.renderUsernameField() }
             { this.renderPasswordForm() }
             { this.renderEmailAddress() }
             { this.renderVerifiedEmail() }
             { this.renderUserLocked() }
            </Card.Body>
           </Card>
          </div>
        );
    }

    renderRoleCard() {
        let disabled = !this.props.admin;
        return (
          <Card>
           <Card.Header>
            <OverlayTrigger delay={{show: 250, hide: 400}}
                            overlay={(props)=>renderToolTip(props, "ToolRoleBasedPermissions")}>
             <div>
               {T("Roles")}
             </div>
            </OverlayTrigger>
           </Card.Header>
           <Card.Body>
             { _.map(roleList, (role, idx) => {
                 return (
                   <OverlayTrigger key={role} delay={{show: 250, hide: 400}}
                                   overlay={(props)=>renderToolTip(props, "ToolRole_" + role)}>
                    <div>
                     <Form.Switch label={T("Role_" + role)} id={role} disabled={disabled}
                                  checked={this.state.user.hasRole(role)}
                                  onChange={(e) => {this.changeRole(role, e)}} />
                    </div>
                   </OverlayTrigger>
                 );
             })}
           </Card.Body>
          </Card>
        );
    }

    renderEffectivePermissionsCard() {
        return (
          <Card>
          <Card.Header>
            <OverlayTrigger delay={{show: 250, hide: 400}}
                            overlay={(props)=>renderToolTip(props, "ToolEffectivePermissions")}>
              <div>
                {T("Effective Permissions")}
              </div>
             </OverlayTrigger>
          </Card.Header>
            <Card.Body>
              { _.map(UserState.permissionList(), (perm, idx) => {
                    return (
                      <OverlayTrigger key={perm} delay={{show: 250, hide: 400}}
                                      overlay={(props)=>renderToolTip(props, "ToolPerm_" + perm)}>
                       <div>
                        <Form.Switch disabled={true} label={permissionNames[perm]}
                                     id={perm} checked={this.state.user.hasPermission(perm)}
                                     onChange={(e) => {this.changePermission(perm, e)}} />
                       </div>
                      </OverlayTrigger>
                    );
              })}
            </Card.Body>
          </Card>
        );
    }

    renderPermissions() {
        return (
          <>
           <div className="col-sm-4">
            { this.renderRoleCard() }
            { this.renderEffectivePermissionsCard() }
           </div>
          </>
        );
    }

    renderOrganizationsCard() {
        let disabled = !this.context.traits.Permissions.org_admin;
        let root_org = this.state.user.isMemberOf("root");
        return (
          <Card>
            <Card.Header>
              <OverlayTrigger delay={{show: 250, hide: 400}}
                              overlay={(props)=>renderToolTip(props, "ToolOrganizations")}>
                <div>
                  {T("Organizations")}
                </div>
              </OverlayTrigger>
            </Card.Header>
            <Card.Body>
              { _.map(this.props.orgs, (org, idx) => {
                    let name = org.name;
                    let checked = root_org || this.state.user.isMemberOf(org.id);
                    let key = org.id;
                    if (org.id === "root") {
                        // We can't have an id of 'root'
                        key = "Org_" + org.id;
                        name = T("Organizational Root");
                    } else if (root_org) {
                        disabled = true;
                    }
                    return (
                       <Form.Switch label={name} id={key} disabled={disabled} key={key}
                                    checked={checked}
                                    onChange={e=>this.changeOrg(org, e)} />
                    );
              })}
            </Card.Body>
          </Card>

        );
    }

    renderOrganizations() {
        return (
          <>
           <div className="col-sm-4">
            { this.renderOrganizationsCard() }
           </div>
          </>
        );
    }

    renderVerifiedEmail() {
        let disabled = this.state.user.fields.email === '' || !this.props.admin;
        let checked = this.state.user.fields.verified_email;

        return (
          <Form.Group>
            <OverlayTrigger
             delay={{show:250, hide: 400}}
             overlay={(props)=>renderToolTip(props, "ToolUser_verified_email")}>
             <div>
              <Form.Switch label={T("Verified Email")} id="verified-email"
                           disabled={disabled} checked={checked}
                           onChange={e=>this.setUserState(
                               'verified_email', e.currentTarget.checked)} />
             </div>
            </OverlayTrigger>
          </Form.Group>
        );
    }

    renderUserLocked() {
        let disabled = !this.props.admin;
        let checked = this.state.user.fields.locked;
        return (
          <Form.Group>
            <OverlayTrigger
             delay={{show:250, hide: 400}}
             overlay={(props)=>renderToolTip(props, "ToolUser_locked")}>
             <div>
              <Form.Switch label={T("Account Locked")} id="locked"
                           disabled={disabled} checked={checked}
                           onChange={e=>this.setUserState(
                               'locked', e.currentTarget.checked)} />
             </div>
            </OverlayTrigger>
          </Form.Group>
        );
    }

    renderUserFlags() {
        return (
          <div className="col-sm-4">
           { this.renderVerifiedEmail() }
           { this.renderUserLocked() }
          </div>
        );
    }

    renderSubmitButton() {
        if (!this.props.admin) {
            return <></>;
        }

        return (
          <div className="col-sm-4">
           <Button onClick={(e) => this.handleCreate(e)} disabled={!this.state.dirty}
                   variant="default" type="button">
             {this.props.mode === "create" ? "Add User" : "Update User"}
           </Button>
          </div>
        );
    }

    render() {
        if (!this.context.traits.username) {
            return null;
        }
        let header = "";
        if (this.props.mode === "create") {
            if (!this.props.admin) {
                return null;
            }
            header = T("Create a new user");
        } else {
            if (!this.props.admin) {
                header = T("User Information");
            } else {
                header = T("Edit User");
            }
        }

        return(
          <div className="user">
           <h2 className="mx-1">{header}</h2>
           <Form onSubmit={(e) => e.preventDefault()} ref={ form => this.userForm = form }>
            <div className="row ml-3">
             { this.renderUserInfo() }
             { this.renderPermissions() }
             { this.renderOrganizations() }
            </div>
            <div className="row ml-3">
             { this.renderSubmitButton() }
            </div>
           </Form>
          </div>
        );
    }
};

export default withSnackbar(User);
