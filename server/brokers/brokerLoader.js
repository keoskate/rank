// server/brokers/brokerLoader.js
// Reads agents/brokers/*.md files, parses frontmatter, validates them, and
// optionally watches the directory for hot-reloads.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const matter = require('gray-matter');
const chokidar = require('chokidar');

const { validateBroker } = require('./brokerSchema');

// Allow override via env so the cloud deploy can point at a persistent
// volume (e.g. /app/data/agents/brokers) without code changes.
const BROKERS_DIR =
  process.env.BROKERS_DIR ||
  path.resolve(__dirname, '..', '..', 'agents', 'brokers');

/**
 * Parse a single broker .md file. Returns { broker, persona, errors, file }.
 * `persona` is the markdown body (used as LLM system-prompt context).
 */
async function loadBroker(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  const parsed = matter(raw);
  const result = validateBroker(parsed.data, path.basename(filePath));
  return {
    file: filePath,
    broker: result.broker,
    persona: parsed.content.trim(),
    errors: result.errors,
  };
}

/**
 * Loads all brokers from agents/brokers/. Returns an array of results.
 * Each item: { file, broker, persona, errors }. Brokers with errors have broker=null.
 */
async function loadAllBrokers(dir = BROKERS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const entries = await fsp.readdir(dir);
  const mdFiles = entries.filter(f => f.endsWith('.md') && !f.startsWith('.'));
  const results = [];
  for (const f of mdFiles) {
    try {
      const r = await loadBroker(path.join(dir, f));
      results.push(r);
    } catch (err) {
      results.push({
        file: path.join(dir, f),
        broker: null,
        persona: '',
        errors: [`read failed: ${err.message}`],
      });
    }
  }
  return results;
}

/**
 * Starts a chokidar watcher on agents/brokers/. Emits change/add/unlink events.
 * Caller is responsible for invoking the bridge to materialize changes into sessions.
 *
 * @param {object} handlers { onChange, onAdd, onUnlink, onError }
 * @param {object} opts { dir, ignoreInitial, writeTokens } - writeTokens is a Set of paths
 *        the writer is currently mutating; events for those paths are debounced for 500ms
 *        and only fire if the token has cleared (prevents self-mutation feedback loops).
 * @returns {chokidar.FSWatcher}
 */
function watchBrokers(handlers = {}, opts = {}) {
  const dir = opts.dir || BROKERS_DIR;
  const writeTokens = opts.writeTokens || new Set();

  const debounceMs = 500;
  const pending = new Map();

  const fire = (event, filePath) => {
    if (!filePath.endsWith('.md')) return;
    if (writeTokens.has(filePath)) {
      if (pending.has(filePath)) clearTimeout(pending.get(filePath));
      pending.set(
        filePath,
        setTimeout(() => {
          if (!writeTokens.has(filePath)) {
            handlers[event] && handlers[event](filePath);
          }
          pending.delete(filePath);
        }, debounceMs)
      );
      return;
    }
    handlers[event] && handlers[event](filePath);
  };

  const watcher = chokidar.watch(dir, {
    ignored: /(^|[/\\])\..*/,
    persistent: true,
    ignoreInitial: opts.ignoreInitial !== false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher
    .on('add', p => fire('onAdd', p))
    .on('change', p => fire('onChange', p))
    .on('unlink', p => fire('onUnlink', p))
    .on('error', err => handlers.onError && handlers.onError(err));

  return watcher;
}

module.exports = {
  BROKERS_DIR,
  loadBroker,
  loadAllBrokers,
  watchBrokers,
};
