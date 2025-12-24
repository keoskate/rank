#!/usr/bin/env node
/**
 * Install Git Hooks
 *
 * Copies pre-commit hook to .git/hooks/ and makes it executable.
 * Run: node scripts/install-hooks.js
 */

const fs = require('fs');
const path = require('path');

const HOOKS_DIR = path.join(__dirname, '..', '.git', 'hooks');
const PRE_COMMIT_HOOK = path.join(HOOKS_DIR, 'pre-commit');

const hookContent = `#!/bin/sh
# Pre-commit hook - Check MVP file changes
node scripts/check-mvp.js
`;

try {
  // Check if .git/hooks exists
  if (!fs.existsSync(HOOKS_DIR)) {
    console.error('Error: .git/hooks directory not found. Are you in a git repository?');
    process.exit(1);
  }

  // Write the hook
  fs.writeFileSync(PRE_COMMIT_HOOK, hookContent, { mode: 0o755 });
  console.log('Pre-commit hook installed successfully!');
  console.log(`Location: ${PRE_COMMIT_HOOK}`);
  console.log('\nThe hook will now check for MVP file changes before each commit.');
  console.log('Use "git commit --no-verify" to bypass if needed.');
} catch (error) {
  console.error('Error installing hook:', error.message);
  process.exit(1);
}
