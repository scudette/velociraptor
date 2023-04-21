import "./client-status.css";

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import api from '../core/api-service.jsx';
import online from './img/online.png';
import online1d from './img/online-1d.png';
import offline from './img/offline.png';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';


export default class VeloClientStatusIcon extends Component {
    static propTypes = {
        client: PropTypes.object,
    }

    render() {
        let item = this.props.client;
        let date = new Date();
        let now_ms = date.getTime();
        let last_seen_ms = item.last_seen_at/1000;

        if ((now_ms - last_seen_ms) < (60 * 15 * 1000)) {
            return  <span className="fa-stack fa-fw">
                      <FontAwesomeIcon
                        className="fa-solid fa-stack-xl"
                        icon="network-wired"
                        alt="online" />
                    </span>;
        }

        if ((now_ms - last_seen_ms) < (60 * 60 * 24 * 1000)) {
            return  <span className="fa-stack fa-fw">
                      <FontAwesomeIcon
                        className="fa-stack-1x"
                        icon="fa-solid fa-network-wired"
                        alt="online1d" />
                      <FontAwesomeIcon
                        className="fa-stack-2x"
                        icon="fa-solid fa-fade fa-ban"
                        alt="online1d" />
                    </span>;
        }
        return  <span className="fa-stack fa-fw">
                  <FontAwesomeIcon
                    className="fa-stack-1x"
                    icon="fa-solid fa-network-wired"
                    alt="offline" />
                  <FontAwesomeIcon
                    className="fa-stack-2x"
                    icon="fa-solid fa-ban"
                    alt="offline" />
                </span>;
    }
}
