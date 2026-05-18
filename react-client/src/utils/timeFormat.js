/**
 * Time-format utilities anchored to America/New_York (NYSE/NASDAQ hours).
 *
 * The trading system operates in ET. Without explicit timezone-ing, calling
 * `toLocaleTimeString('en-US')` on a Date returns the BROWSER's local time —
 * which silently produces wrong-looking displays for anyone outside ET
 * (the LA user who reads "07:17" and thinks "market should be closed").
 *
 * Use `fmtET()` everywhere on dashboards that display market timestamps.
 */

const ET_OPTIONS = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'America/New_York',
};

const ET_OPTIONS_NO_SEC = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/New_York',
};

/**
 * Format a timestamp as ET HH:MM:SS without a label.
 * Use when the column header or surrounding context already implies ET.
 */
export function fmtET(ts) {
  if (ts == null) return '--:--:--';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-US', ET_OPTIONS);
}

/**
 * Format a timestamp as `HH:MM:SS ET` with the suffix label.
 * Use when there's no other timezone cue nearby — the suffix removes any
 * ambiguity for users in PT/CT/MT/UTC.
 */
export function fmtETLabel(ts) {
  if (ts == null) return '--:--:-- ET';
  return `${fmtET(ts)} ET`;
}

/**
 * HH:MM ET — short form when seconds aren't relevant (e.g. polling intervals).
 */
export function fmtETShort(ts) {
  if (ts == null) return '--:-- ET';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '--:-- ET';
  return `${d.toLocaleTimeString('en-US', ET_OPTIONS_NO_SEC)} ET`;
}
