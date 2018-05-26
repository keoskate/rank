import React, { Component } from 'react';
import { Link } from 'react-router-dom';

class WeightSlider extends Component {
    render() {
        return (
            <div>
                <label>
                    {this.props.label} ({this.props.value}) <input type="range" value={this.props.value} min="0" max="1" step="0.05" name={this.props.name} onChange={this.props.onChange} />
                </label>
            </div>
        );
    }
}
export default WeightSlider;