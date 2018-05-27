import React, { Component } from 'react';
import { Link } from 'react-router-dom';

class ColorColumn extends Component {
    render() {
        return (
            <div class={this.props.class}>
               {this.props.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            </div>
        );
    }
}
export default ColorColumn;