// server/brokers/brokerWriter.js
// Atomic writer for broker .md files. Snapshots prior versions to data/broker-versions/
// for audit/revert. Used by self-mutation, hire-broker, and tier-promotion flows.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const matter = require('gray-matter');

const { BROKERS_DIR } = require('./brokerLoader');
const VERSIONS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'data',
  'broker-versions'
);

// Tracks paths the writer is currently mutating, so the loader's file-watcher
// can skip self-triggered reload events. Shared across module instances.
const writeTokens = new Set();

function brokerPath(slug) {
  return path.join(BROKERS_DIR, `${slug}.md`);
}

async function ensureVersionDir(slug) {
  const dir = path.join(VERSIONS_DIR, slug);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function snapshotCurrent(slug) {
  const filePath = brokerPath(slug);
  if (!fs.existsSync(filePath)) return null;
  const dir = await ensureVersionDir(slug);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapPath = path.join(dir, `${ts}.md`);
  await fsp.copyFile(filePath, snapPath);
  return snapPath;
}

/**
 * Writes a broker definition to its .md file atomically (tmp → rename).
 * Snapshots the prior version (if any) to data/broker-versions/<slug>/<timestamp>.md
 * unless `opts.skipSnapshot` is true (e.g. for initial creation).
 *
 * @param {string} slug
 * @param {object} broker validated broker object
 * @param {string} personaBody markdown body to write below the frontmatter
 * @param {object} [opts]
 * @returns {Promise<{ file: string, snapshot: string|null }>}
 */
async function writeBroker(slug, broker, personaBody = '', opts = {}) {
  const filePath = brokerPath(slug);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  const snapshot = opts.skipSnapshot ? null : await snapshotCurrent(slug);

  const fileContent = matter.stringify(personaBody, broker);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  writeTokens.add(filePath);
  try {
    await fsp.writeFile(tmpPath, fileContent, 'utf8');
    await fsp.rename(tmpPath, filePath);
  } finally {
    // Hold the token briefly so the file-watcher's debounced re-read sees the write
    // as our own and skips the reload.
    setTimeout(() => writeTokens.delete(filePath), 1500);
  }

  return { file: filePath, snapshot };
}

/**
 * Restores a broker .md from a prior snapshot in data/broker-versions/.
 */
async function revertBroker(slug, snapshotTimestamp) {
  const dir = path.join(VERSIONS_DIR, slug);
  const target = path.join(dir, `${snapshotTimestamp}.md`);
  if (!fs.existsSync(target)) {
    throw new Error(`snapshot not found: ${target}`);
  }
  const filePath = brokerPath(slug);
  await snapshotCurrent(slug); // snapshot the now-being-replaced version too
  writeTokens.add(filePath);
  try {
    await fsp.copyFile(target, filePath);
  } finally {
    setTimeout(() => writeTokens.delete(filePath), 1500);
  }
  return { file: filePath, restoredFrom: target };
}

/**
 * Archives a fired broker by moving its .md to agents/fired/<slug>.<timestamp>.md.
 */
async function archiveBroker(slug) {
  const filePath = brokerPath(slug);
  if (!fs.existsSync(filePath)) return null;
  const firedDir = path.resolve(__dirname, '..', '..', 'agents', 'fired');
  await fsp.mkdir(firedDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(firedDir, `${slug}.${ts}.md`);
  writeTokens.add(filePath);
  try {
    await fsp.rename(filePath, dest);
  } finally {
    setTimeout(() => writeTokens.delete(filePath), 1500);
  }
  return dest;
}

async function listSnapshots(slug) {
  const dir = path.join(VERSIONS_DIR, slug);
  if (!fs.existsSync(dir)) return [];
  const entries = await fsp.readdir(dir);
  return entries.filter(f => f.endsWith('.md')).sort();
}

module.exports = {
  brokerPath,
  writeBroker,
  revertBroker,
  archiveBroker,
  listSnapshots,
  writeTokens,
};
