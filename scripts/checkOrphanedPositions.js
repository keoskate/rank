#!/usr/bin/env node
/**
 * Check for orphaned positions - positions that no running session manages
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

function main() {
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));

  const currentPositions = ['IONQ', 'NVDA', 'PATH', 'RGTI', 'RR'];
  const runningSessions = Object.values(data).filter(s => s.status === 'running');

  console.log('Current positions:', currentPositions.join(', '));
  console.log('');
  console.log('Running sessions and their watchlists:');
  runningSessions.forEach(s => {
    const watchlist = s.config?.watchlist || [];
    const matches = currentPositions.filter(p =>
      watchlist.map(w => w.toUpperCase()).includes(p.toUpperCase())
    );
    console.log(`  - ${s.name}: watchlist=[${watchlist.join(', ')}]`);
    console.log(`    Manages positions: ${matches.length > 0 ? matches.join(', ') : 'NONE'}`);
  });

  console.log('');
  const orphaned = currentPositions.filter(p => {
    return !runningSessions.some(s => {
      const watchlist = (s.config?.watchlist || []).map(w => w.toUpperCase());
      return watchlist.includes(p.toUpperCase());
    });
  });
  console.log('ORPHANED POSITIONS (no session managing them):', orphaned.join(', ') || 'None');

  // Check all stopped sessions for potential owner
  const stoppedSessions = Object.values(data).filter(s => s.status === 'stopped' || s.status === 'paused');
  console.log('\n');
  console.log('Checking stopped sessions for original position owners...');
  for (const pos of orphaned) {
    const potentialOwners = stoppedSessions.filter(s => {
      const watchlist = (s.config?.watchlist || []).map(w => w.toUpperCase());
      return watchlist.includes(pos.toUpperCase());
    });
    if (potentialOwners.length > 0) {
      console.log(`  ${pos}: Could be from session(s):`);
      potentialOwners.forEach(s => {
        console.log(`    - "${s.name}" (${s.status})`);
      });
    } else {
      console.log(`  ${pos}: No matching sessions found (may have been bought manually)`);
    }
  }
}

main();
