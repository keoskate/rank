import { memo } from 'react';
import theme from '../../theme';

/**
 * Tiny inline sparkline (SVG polyline). Auto-scales to the data's min/max unless
 * an explicit [min, max] is given. Optional `midline` draws a dashed reference
 * line (in data units — e.g. 50 for a 0–100 breadth series).
 *
 * @param {number[]} points     - series, oldest → newest
 * @param {number}  [w=130] [h=26]
 * @param {number}  [min] [max] - fixed scale (default: data min/max)
 * @param {number}  [midline]   - draw a dashed line at this value
 * @param {string}  [color]     - stroke override (default: green if rising else red)
 * @param {number}  [strokeWidth=1.5]
 */
const Sparkline = memo(({ points, w = 130, h = 26, min, max, midline, color, strokeWidth = 1.5 }) => {
  if (!Array.isArray(points) || points.length < 2) return null;
  const lo = min != null ? min : Math.min(...points);
  const hi = max != null ? max : Math.max(...points);
  const span = hi - lo || 1;
  const pad = h * 0.12;
  const y = v => h - pad - ((v - lo) / span) * (h - 2 * pad);
  const xStep = w / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * xStep).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  const rising = points[points.length - 1] >= points[0];
  const stroke = color || (rising ? theme.colors.success : theme.colors.error);
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {midline != null && (
        <line x1="0" y1={y(midline)} x2={w} y2={y(midline)} stroke={theme.colors.gray200} strokeWidth="1" strokeDasharray="2 2" />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
});

export default Sparkline;
