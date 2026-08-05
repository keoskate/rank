import { memo } from 'react';
import theme from '../../theme';

// Blend a hex color toward white. t=1 → full color, t→0 → near white.
const hexToRgb = h => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shade = (hex, t) => {
  const [r, g, b] = hexToRgb(hex);
  const mix = c => Math.round(255 + (c - 255) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

/**
 * One dot per trading day, oldest → newest. Green = up, red = down, gray = flat.
 * Shared by the options scanner cards and the SOXL Multi-Timeframe panel.
 *
 * @param {number[]} recentDays    - direction per day (+1/0/-1), oldest first
 * @param {number[]} [magnitudes]  - |day %| per day (same length). When given,
 *                                    the green/red SHADE scales with magnitude
 *                                    (bigger move = deeper color) for an extra
 *                                    layer of detail. Omit for flat colors.
 * @param {number}  [maxMagnitude=8] - % move that saturates the color
 * @param {string}  [label]        - trailing caption (default "last N days"); '' hides
 * @param {number}  [size=8]       - dot diameter (px)
 * @param {number}  [gap=4]        - gap between dots (px)
 */
const DotHistory = ({ recentDays, magnitudes, maxMagnitude = 8, label, size = 8, gap = 4 }) => {
  if (!Array.isArray(recentDays) || !recentDays.length) return null;
  const caption = label === undefined ? `last ${recentDays.length} days` : label;

  const dotColor = (dir, i) => {
    if (dir === 0) return theme.colors.gray300;
    const base = dir > 0 ? theme.colors.successMuted : theme.colors.errorMuted;
    if (!Array.isArray(magnitudes)) return base; // flat (no magnitude info)
    const mag = Math.abs(Number(magnitudes[i]) || 0);
    const t = 0.3 + 0.7 * Math.min(1, mag / maxMagnitude); // 0.3 (light) → 1 (deep)
    return shade(base, t);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap, flexWrap: 'wrap' }}>
        {recentDays.map((d, i) => (
          <span
            key={i}
            title={Array.isArray(magnitudes) && magnitudes[i] != null ? `${magnitudes[i] >= 0 ? '+' : ''}${Number(magnitudes[i]).toFixed(1)}%` : undefined}
            style={{ width: size, height: size, borderRadius: '50%', background: dotColor(d, i) }}
          />
        ))}
      </div>
      {caption && (
        <span style={{ fontSize: '0.62rem', color: theme.colors.gray500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {caption}
        </span>
      )}
    </div>
  );
};

export default memo(DotHistory);
