import 'bootstrap/dist/css/bootstrap.css';
import './css/bootstrap-theme.css';
import 'react-bootstrap-typeahead/css/Typeahead.css';

import './_variables.css';

import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';

import {HashRouter} from "react-router-dom";

import { library } from '@fortawesome/fontawesome-svg-core';

import faHome from '@fortawesome/free-solid-svg-icons/faHome.js';
import faCrosshairs from '@fortawesome/free-solid-svg-icons/faCrosshairs.js';
import faWrench from '@fortawesome/free-solid-svg-icons/faWrench.js';
import faEye from '@fortawesome/free-solid-svg-icons/faEye.js';
import faServer from '@fortawesome/free-solid-svg-icons/faServer.js';
import faBook from '@fortawesome/free-solid-svg-icons/faBook.js';
import faLaptop from '@fortawesome/free-solid-svg-icons/faLaptop.js';
import faSearch from '@fortawesome/free-solid-svg-icons/faSearch.js';
import faSpinner from '@fortawesome/free-solid-svg-icons/faSpinner.js';
import faSearchPlus from '@fortawesome/free-solid-svg-icons/faSearchPlus.js';
import faFolderOpen from '@fortawesome/free-solid-svg-icons/faFolderOpen.js';
import faHistory from '@fortawesome/free-solid-svg-icons/faHistory.js';
import faTasks from '@fortawesome/free-solid-svg-icons/faTasks.js';
import faTerminal from '@fortawesome/free-solid-svg-icons/faTerminal.js';
import faCompress from '@fortawesome/free-solid-svg-icons/faCompress.js';
import faExpand from '@fortawesome/free-solid-svg-icons/faExpand.js';
import faEyeSlash from '@fortawesome/free-solid-svg-icons/faEyeSlash.js';
import faStop from '@fortawesome/free-solid-svg-icons/faStop.js';
import faExclamation from '@fortawesome/free-solid-svg-icons/faExclamation.js';
import faColumns from '@fortawesome/free-solid-svg-icons/faColumns.js';
import faDownload from '@fortawesome/free-solid-svg-icons/faDownload.js';
import faBinoculars from '@fortawesome/free-solid-svg-icons/faBinoculars.js';


library.add(faHome, faCrosshairs, faWrench, faEye, faServer, faBook, faLaptop,
            faSearch, faSpinner, faSearchPlus, faTasks, faTerminal,
            faCompress, faExpand, faEyeSlash, faStop, faExclamation,
            faColumns, faDownload,
            faFolderOpen , faHistory, faBinoculars);

ReactDOM.render(
    <HashRouter>
        <App />
    </HashRouter>,
    document.getElementById('root')
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
