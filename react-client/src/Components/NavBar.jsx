import React, { Component } from 'react';
import { Link } from 'react-router-dom';
class NavBar extends Component {
  render() {
    return (
      <header>
        <ul id="headerButtons">
          <li className="navButton"><span style={{ color: 'white', fontSize: 35 }}>KEO STONKS</span></li>
        </ul>
      </header>
    )
  }
}
export default NavBar;