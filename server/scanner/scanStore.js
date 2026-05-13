/**
 * Scanner-results persistence.
 * Writes scan-<ISO>.json + latest.json into data/scanner-results/.
 * Prunes to last MAX_KEEP files.
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

function _safeFilename(iso) {
  return `scan-${iso.replace(/[:.]/g, '-')}.json`;
}

function saveScan(scanResult) {
  _ensureDir();
  const iso = scanResult.generatedAt || new Date().toISOString();
  const filename = _safeFilename(iso);
  const filepath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(scanResult, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, 'latest.json'), JSON.stringify(scanResult, null, 2));
  _prune();
  return filepath;
}

function _prune() {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .map(f => ({ name: f, path: path.join(RESULTS_DIR, f), mtime: fs.statSync(path.join(RESULTS_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime); // newest first
  if (files.length <= MAX_KEEP) return;
  for (const f of files.slice(MAX_KEEP)) {
    try { fs.unlinkSync(f.path); } catch { /* ignore */ }
  }
}

function loadLatest() {
  _ensureDir();
  const latestPath = path.join(RESULTS_DIR, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch {
    return null;
  }
}

function listHistory(limit = 10) {
  _ensureDir();
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('scan-') && f.endsWith('.json'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(RESULTS_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return files.map(f => ({ filename: f.name, generatedAt: f.mtime.toISOString() }));
}

module.exports = { saveScan, loadLatest, listHistory, RESULTS_DIR };
