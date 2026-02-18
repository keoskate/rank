#!/usr/bin/env node
/**
 * Fix duplicate running sessions
 *
 * This script:
 * 1. Reads the ai-sessions.json file
 * 2. Finds all sessions with status "running"
 * 3. For sessions with duplicate names, keeps only the newest one running
 * 4. Marks duplicates as "stopped"
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

function main() {
  console.log('Loading sessions file...');
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));

  // Find all running sessions
  const runningSessions = [];
  for (const [sessionId, session] of Object.entries(data)) {
    if (session.status === 'running') {
      runningSessions.push({
        sessionId,
        name: session.name,
        startTime: new Date(session.startTime),
        autoTrade: session.config?.autoTrade
      });
    }
  }

  console.log(`\nFound ${runningSessions.length} running sessions:`);
  runningSessions.forEach(s => {
    console.log(`  - ${s.name} (${s.sessionId.slice(0,8)}...) started: ${s.startTime.toISOString()} autoTrade: ${s.autoTrade}`);
  });

  // Group by name
  const byName = {};
  for (const session of runningSessions) {
    if (!byName[session.name]) {
      byName[session.name] = [];
    }
    byName[session.name].push(session);
  }

  // Find duplicates
  const toStop = [];
  for (const [name, sessions] of Object.entries(byName)) {
    if (sessions.length > 1) {
      console.log(`\nDuplicate sessions for "${name}":`);
      // Sort by start time, newest first
      sessions.sort((a, b) => b.startTime - a.startTime);

      // Keep the newest, stop the rest
      const [keep, ...stop] = sessions;
      console.log(`  KEEP: ${keep.sessionId.slice(0,8)}... (started ${keep.startTime.toISOString()})`);

      for (const s of stop) {
        console.log(`  STOP: ${s.sessionId.slice(0,8)}... (started ${s.startTime.toISOString()})`);
        toStop.push(s.sessionId);
      }
    }
  }

  if (toStop.length === 0) {
    console.log('\nNo duplicate sessions to stop.');
    return;
  }

  console.log(`\nStopping ${toStop.length} duplicate sessions...`);

  // Mark duplicates as stopped
  for (const sessionId of toStop) {
    data[sessionId].status = 'stopped';
    data[sessionId].endTime = new Date().toISOString();
    data[sessionId].stopReason = 'Duplicate session cleanup';
  }

  // Write back
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  console.log('Sessions file updated.');

  // Summary
  const stillRunning = Object.values(data).filter(s => s.status === 'running');
  console.log(`\nAfter cleanup: ${stillRunning.length} sessions still running:`);
  stillRunning.forEach(s => {
    console.log(`  - ${s.name} (autoTrade: ${s.config?.autoTrade})`);
  });
}

main();
