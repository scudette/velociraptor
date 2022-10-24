import React, { Component } from 'react';
import api from '../core/api-service.js';
import Alert from 'react-bootstrap/Alert';
import axios from 'axios';
import Button from 'react-bootstrap/Button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import User from './user.js';
import T from '../i8n/i8n.js';
import Dropdown from 'react-bootstrap/Dropdown';
import DropdownButton from 'react-bootstrap/DropdownButton';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import InputGroup from 'react-bootstrap/InputGroup';
import _ from 'lodash';
import SplitPane from 'react-split-pane';
import Navbar from 'react-bootstrap/Navbar';
import Table  from 'react-bootstrap/Table';
import Form from 'react-bootstrap/Form';
import FormControl from 'react-bootstrap/FormControl';
import Container from  'react-bootstrap/Container';
import VeloTable from '../core/table.js';
import UserConfig from '../core/user.js';
import Spinner from '../utils/spinner.js';

import './users.css';

const roles = {
    "administrator" : T("Server Administrator"),
    "org_admin" : T("Organization Administrator"),
    "reader" : T("Read-Only User"),
    "analyst" : T("Analyst"),
    "investigator" : T("Investigator"),
    "artifact_writer" : T("Artifact Writer"),
    "api" : T("Read-Only API Client"),
};

export default class Users extends Component {
    static contextType = UserConfig;

    state = {
        fullSelecteddescriptor: {},
        matchingDescriptors: [],
        timeout: 0,
        current_filter: "",
        nameFilter: "",
        roleFilter: "",
        filteredUsers: [],
        allUsers: {},
        explicitFilter: true,
        updatePending: false,
        showUserTable: false,

        users_initialized: false,
        loading: false,
        orgs_initialized: false,
        context_found: false,
    }

    constructor(props, context) {
        super(props, context);
        let username = props.match && props.match.params && props.match.params.user;
        if (username) {
            this.state.explicitFilter = false;
        }
    }

    componentDidMount = () => {
        this.usersSource = axios.CancelToken.source();
        this.orgsSource = axios.CancelToken.source();
        if (this.nameInput) {
            this.nameInput.focus();
        }
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (prevProps === this.props && prevState === this.state && this.state.initialized) {
            return;
        }

        if (this.state.users_initialized && this.state.orgs_initialized) {
            return;
        }

        if (this.state.loading) {
            return;
        }

        if (!prevState.loading && this.context.traits.username) {
            this.loadUsersAndOrgs();
        }
    }

    filterUsers(allUsers, nameFilter, roleFilter) {
        let users = [];

        for (const [username, user] of Object.entries(allUsers)) {
            if (!username.startsWith(nameFilter)) {
                continue;
            }
            if (roleFilter !== "" && !user.Roles.includes(roleFilter)) {
                continue;
            }
            users.push(username);
        }

        return users.sort();
    }

    clearFilter(e) {
        let users = this.filterUsers(this.state.allUsers, "", "");
        this.setState({nameFilter: "", roleFilter: "", filteredUsers: users});
    }

    updateNameFilter(e, value) {
        e.preventDefault();
        if (value !== this.state.nameFilter) {
            let users = this.filterUsers(this.state.allUsers, value, this.state.roleFilter);
            this.setState({nameFilter: value, filteredUsers: users, explicitFilter: true});
        }
    }

    updateRoleFilter(value) {
        if (value !== this.state.roleFilter) {
            let users = this.filterUsers(this.state.allUsers, this.state.nameFilter, value);
            this.setState({roleFilter: value, filteredUsers: users});
        }
    }

    isAdminUser() {
        let perms = this.context.traits.Permissions;
        return perms && (perms.server_admin || perms.super_user);
    }

    handleDelete(e, user) {
        e.preventDefault();

        if (!window.confirm(T("Do you want to delete?", user))) {
            return;
        }

        api.delete_req("v1/DeleteUser/" + user, {}, this.usersSource.token).then((response) => {;
            let names = {...this.state.allUsers};
            delete names[user]

            let filtered = this.state.filteredUsers.filter((elem) => { return user !== elem; });

            this.setState({allUsers: names, filteredUsers: filtered});
            this.props.history.push("/users/");
        });
    }

    loadUsers() {
        if (!this.isAdminUser() || this.state.users_initialized) {
            return;
        }

        this.usersSource.cancel();
        this.usersSource = axios.CancelToken.source();

        api.post("v1/GetUsers", {with_roles: true},
                 this.usersSource.token).then((response) => {
            let names = {}
            if (response.cancel) {
                return;
            }
            response.data.users.forEach((user) => {
                let roles = [];
                if (user.Permissions && user.Permissions.roles) {
                    roles = user.Permissions.roles;
                }
                names[user.name] = { Username: user.name, Roles: roles, Orgs: user.orgs }
            });

            let tableData = {
                columns: [ "name", "Permissions", "orgs" ],
                rows: response.data.users,
            };

            let headers = [ T("Username"), T("Permissions"), T("Organizations") ];

            let filtered = Object.keys(names).sort()

            this.setState({allUsers: names, filteredUsers: filtered,
                           users_initialized: true,
                           tableHeaders: headers, tableData: tableData});
        });
    }

      loadOrgs() {
        if (this.context.traits.Permissions.org_admin) {
            if (this.state.orgs_initialized) {
                return;
            }

            this.orgsSource.cancel();
            this.orgsSource = axios.CancelToken.source();

            api.get("v1/GetOrganizations", {}, this.orgsSource.token).then((response) => {
                if (response.cancel) {
                    return;
                }

                let orgs = response.data.orgs.map((elem) =>
                        ({ id: elem.org_id, name: elem.name})
                );
                this.setState({orgs_initialized: true, orgs: orgs});
              });
          } else {
              this.setState({orgs_initialized: true});
          }
    };

    async loadUsersAndOrgs() {
        this.setState({loading: true});
        await Promise.all([this.loadUsers(), this.loadOrgs()]);
        this.setState({loading: false});
    }

    onSelect(username, e) {
        this.setState({ createUser: false });
        this.props.history.push("/users/" + username);
        e.preventDefault();
        e.stopPropagation();

        return false;
    }

    clickNewUser(e) {
        this.setState({createUser: true, updatePending: true});
        this.props.history.push("/users/");
        e.preventDefault();
        e.stopPropagation();

        return false;
    }

    userCreatedCallback(username, roles) {
        let newState = { allUsers : {...this.state.allUsers } };
        newState.allUsers[username] = { Username: username, Roles: roles };
        newState.filteredUsers = this.filterUsers(newState.allUsers,
                                                  this.state.roleFilter,
                                                  this.state.nameFilter);
        this.setState(newState);
        this.props.history.push("/users/" + username);
    }

    renderUserPanel() {
        let mode = undefined;
        let username = this.props.match && this.props.match.params && this.props.match.params.user;
        let password_less = this.context.traits.password_less;

        if (!this.state.users_initialized) {
            return null;
        }

        if (username && !this.state.allUsers[username]) {
            return <Alert variant="warning">{T("User does not exist", username)}</Alert>;
        }

        if (this.state.createUser) {
            mode = "create";
        } else if (username) {
            mode = "edit"
        }

        if (mode) {
            return (
              <User mode={mode} user={username} admin={this.isAdminUser()}
                    password_less={password_less} orgs={this.state.orgs}
                    userCreatedCallback={(username, roles) => {this.userCreatedCallback(username, roles)}}/>);
        } else {
            return (<h2 className="no-content">{T("Select a user to view it")}</h2>);
        }
    }

    renderUserRow(user) {
        let selected = user === this.props.match.params.user;

        return (
          <tr key={user} className={ selected ? "row-selected" : undefined }>
             <td onClick={(e) => this.onSelect(user, e)}>
               {/* eslint jsx-a11y/anchor-is-valid: "off" */}
               <a href="#" onClick={(e) => this.onSelect(user, e)}>{user}</a>
             </td>
          </tr>
        );
    }

    renderUserSelector() {
        let users = this.state.filteredUsers;
        return (
          <>
            <Table bordered hover size="sm">
              <tbody>
                { users.map((username, idx) => {
                    return this.renderUserRow(username);
                })}
              </tbody>
            </Table>
          </>
        );
    }

    renderCreate() {
        return (
          <>
            <Button title={T("Add New User")}
                    onClick={(e) => this.clickNewUser(e)} variant="default">
              <FontAwesomeIcon icon="plus"/>
            </Button>
          </>
        );
    }

    renderDelete() {
        if (this.props.match.params.user && !this.state.createUser) {
            return (
              <>
                <Button title={T("Delete")}
                            onClick={(e) => this.handleDelete(e, this.props.match.params.user)}
                            variant="default">
                  <FontAwesomeIcon icon="window-close"/>
                </Button>
              </>
            );
        }
    }

    renderLoadingSpinner() {
        if (this.state.loading) {
            return <FontAwesomeIcon icon="spinner" spin/>
        } else {
            return <FontAwesomeIcon icon="broom"/>
        }
    }

    renderSearchNavbar() {
        if (this.state.showUserTable || !this.isAdminUser()) {
            return;
        }
        return (
          <Form inline className="">
            <InputGroup >
              <InputGroup.Prepend>
                <Button variant="outline-default"
                        onClick={() => this.clearFilter()}
                        size="sm">
                  { this.renderLoadingSpinner() }
                </Button>
              </InputGroup.Prepend>
              <FormControl size="sm"
                           ref={(input) => { this.nameInput = input; }}
                           value={this.state.explicitFilter ? this.state.nameFilter : ""}
                           onChange={(e) => this.updateNameFilter(e, e.currentTarget.value)}
                           placeholder={T("Search for user")}
                           spellCheck="false"/>
              <DropdownButton title={T(roles[this.state.roleFilter]) ||
                              T("All roles")} variant="default"
                              menuAlign="right">
                  <Dropdown.Item title={T("All roles")}
                           active={this.state.roleFilter === ""}
                           onClick={() => {
                               this.updateRoleFilter("");
                           }}>
                           {T("All roles")}
                  </Dropdown.Item>

                  { _.map(Object.keys(roles), (key, idx) => {
                      return <Dropdown.Item
                               key={key}
                               title={roles[key]}
                               active={key === this.state.roleFilter}
                               onClick={() => {
                                   this.updateRoleFilter(key);
                               }}>
                               {roles[key]}
                             </Dropdown.Item>;
                  })}
              </DropdownButton>
            </InputGroup>
          </Form>
        );
    }

    renderTableToggle() {
        if (this.state.showUserTable) {
            return (
              <Button title={T("Show user selector")}
                          onClick={() => this.setState({showUserTable: false})}
                          variant="default">
                <FontAwesomeIcon icon="list"/>
              </Button>
            );
      }
      return (
        <Button title={T("Show user tables")}
                    onClick={() => this.setState({showUserTable: true})}
                    variant="default">
          <FontAwesomeIcon icon="binoculars"/>
        </Button>
      );
    }

    renderUnprivilegedNavbar() {
        return (
          <Navbar className="justify-content-between">
            <ButtonGroup>
              { this.renderTableToggle() }
            </ButtonGroup>
          </Navbar>
        );
    }


    renderAdminNavbar() {
        return (
          <Navbar className="justify-content-between">
            <ButtonGroup>
              { this.renderCreate() }
              { this.renderTableToggle() }
              { this.renderDelete() }
            </ButtonGroup>
            { this.renderSearchNavbar() }
          </Navbar>
        );
    }

    renderNavbar() {
        if (this.isAdminUser()) {
            return this.renderAdminNavbar();
        }

        return this.renderUnprivilegedNavbar();
    }

    renderOneUser() {
        return (
          <>
            { this.renderUnprivilegedNavbar() }
            <User mode={"view"} user={this.context.traits.username}
                  password_less={this.context.traits.password_less} />
          </>
        );
    }

    render() {
        if (!this.context.traits.username) {
            return <Spinner loading={!(this.state.users_initialized && this.state.orgs_initialized)} />;
        }
        if (this.state.showUserTable) {
            return (
              <>
                { this.renderNavbar() }
                <div className="users-user-table">
                <VeloTable
                  className="col-12"
                  rows={this.state.tableData.rows}
                  headers={this.state.tableHeaders}
                  columns={this.state.tableData.columns} />
                </div>
              </>
            );
        }

        if (!this.isAdminUser()) {
            return this.renderOneUser();
        }

        return (
          <>
            { this.renderNavbar() }
            <div className="users-search-panel">
              <Spinner loading={!(this.state.users_initialized && this.state.orgs_initialized)} />
              <SplitPane split="vertical" defaultSize="70%">
                <div className="users-search-results">
                  { this.renderUserPanel() }
                </div>
                <Container className="user-search-table selectable">
                  { this.renderUserSelector() }
                </Container>
                </SplitPane>
            </div>
          </>
        );
    }
};
