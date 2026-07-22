/**
 * Scanner-results persistence.
 * Writes <kind>-<ISO>.json + <kind>-latest.json into data/scanner-results/.
 * kind defaults to 'scan' (stock scanner), whose files keep their original
 * names (scan-*.json + latest.json) for back-compat; the options scanner
 * uses kind 'options-scan'. Prunes each kind to last MAX_KEEP files.
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', '..', 'data', 'scanner-results');
const MAX_KEEP = 50;

function _ensureDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function _safeFilename(iso, kind) {
  return `${kind}-${iso.replace(/[:.]/g, '-')}.json`;
}

function _latestFilename(kind) {
  return kind === 'scan' ? 'latest.json' : `${kind}-latest.json`;
}

function saveScan(scanResult, kind = 'scan') {
  _ensureDir();
  const iso = scanResult.generatedAt || new Date().toISOString();
  const filename = _safeFilename(iso, kind);
  const filepath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(scanResult, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, _latestFilename(kind)), JSON.stringify(scanResult, null, 2));
  _prune(kind);
  return filepath;
}

function _historyFiles(kind) {
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith(`${kind}-`) && f.endsWith('.json'))
    .filter(f => f !== _latestFilename(kind));
}

function _prune(kind) {
  const files = _historyFiles(kind)
    .map(f => ({ name: f, path: path.join(RESULTS_DIR, f), mtime: fs.statSync(path.join(RESULTS_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime); // newest first
  if (files.length <= MAX_KEEP) return;
  for (const f of files.slice(MAX_KEEP)) {
    try { fs.unlinkSync(f.path); } catch { /* ignore */ }
  }
}

function loadLatest(kind = 'scan') {
  _ensureDir();
  const latestPath = path.join(RESULTS_DIR, _latestFilename(kind));
  if (!fs.existsSync(latestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch {
    return null;
  }
}

function listHistory(limit = 10, kind = 'scan') {
  _ensureDir();
  const files = _historyFiles(kind)
    .map(f => ({ name: f, mtime: fs.statSync(path.join(RESULTS_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return files.map(f => ({ filename: f.name, generatedAt: f.mtime.toISOString() }));
}

module.exports = { saveScan, loadLatest, listHistory, RESULTS_DIR };
