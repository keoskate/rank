/**
 * Shared helpers for the Playwright UI inspector.
 * Kept tiny and dep-free — all browser-driving lives in inspector.js.
 */

const fs = require('fs');
const path = require('path');

const ARTIFACT_ROOT = path.join(__dirname, '..', '..', 'data', 'ui-inspect');

function ensureArtifactDir() {
  if (!fs.existsSync(ARTIFACT_ROOT)) {
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  }
  return ARTIFACT_ROOT;
}

/**
 * Slugify a URL into a filesystem-safe filename stem.
 * "http://localhost:8080/command-center" → "localhost_8080__command_center"
 */
function slugForUrl(url) {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function resolveUrl(target, baseUrl = 'http://localhost:8080') {
  if (target.startsWith('http://') || target.startsWith('https://')) return target;
  return `${baseUrl}${target.startsWith('/') ? '' : '/'}${target}`;
}

function parseViewport(str = '1440x900') {
  const [w, h] = str.split('x').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    return { width: 1440, height: 900 };
  }
  return { width: w, height: h };
}

module.exports = {
  ARTIFACT_ROOT,
  ensureArtifactDir,
  slugForUrl,
  resolveUrl,
  parseViewport,
};
