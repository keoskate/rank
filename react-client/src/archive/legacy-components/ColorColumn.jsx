/**
 * COLOR COLUMN - Table Cell Formatter
 *
 * Formats numeric values in table cells with:
 * - Comma separation for thousands (e.g., 1,000,000)
 * - CSS class application for conditional styling
 *
 * Used by: StonkBoard for displaying formatted stock metrics
 */
import React, { Component } from 'react';
import { Link } from 'react-router-dom';

class ColorColumn extends Component {
  render() {
    return (
      <div class={this.props.class}>
        {this.props.value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
      </div>
    );
  }
}
export default ColorColumn;
