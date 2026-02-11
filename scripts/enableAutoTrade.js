#!/usr/bin/env node
/**
 * Enable autoTrade on all running sessions
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

function main() {
  console.log('Loading sessions...');
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));

  let updated = 0;
  for (const [sessionId, session] of Object.entries(data)) {
    if (session.status === 'running') {
      const wasEnabled = session.config?.autoTrade;
      if (!wasEnabled) {
        session.config.autoTrade = true;
        updated++;
        console.log(`✅ Enabled autoTrade on "${session.name}"`);
      } else {
        console.log(`   "${session.name}" already has autoTrade enabled`);
      }
    }
  }

  if (updated > 0) {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    console.log(`\nUpdated ${updated} session(s). Restart server or wait for sync.`);
  } else {
    console.log('\nNo sessions needed updating.');
  }

  // Show current state
  console.log('\nCurrent running sessions:');
  for (const [sessionId, session] of Object.entries(data)) {
    if (session.status === 'running') {
      console.log(`  - ${session.name}: autoTrade=${session.config?.autoTrade}`);
    }
  }
}

main();
