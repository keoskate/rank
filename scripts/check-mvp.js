#!/usr/bin/env node
/**
 * MVP File Change Checker
 *
 * Runs as a pre-commit hook to warn when MVP (critical trading) files are modified.
 * These files require high rigor: testing, careful review, and validation.
 *
 * Usage:
 *   node scripts/check-mvp.js          # Check staged files
 *   node scripts/check-mvp.js --force  # Skip confirmation (for CI)
 */

const { execSync } = require('child_process');
const readline = require('readline');

// MVP Files - Critical trading logic requiring high rigor
const MVP_FILES = {
  // Tier 1 - Critical Path (must be stable)
  tier1: [
    'server/aiTradingEngine.js',
    'server/alpacaClient.js',
    'server/index.js',
    'react-client/src/Components/pages/LiveTradingDashboard.jsx',
    'react-client/src/Components/pages/TradingSessionsList.jsx',
  ],
  // Tier 2 - High Impact (important for accuracy)
  tier2: [
    'server/technicalIndicatorsService.js',
    'server/regimeDetector.js',
    'server/strategyBacktester.js',
    'server/enhancedBacktestEngine.js',
    'server/polygonClient.js',
    'react-client/src/Components/common/ConfigPanel.jsx',
    'react-client/src/Components/common/StrategyValidatorPanel.jsx',
    'react-client/src/Components/common/TradingLogPanel.jsx',
  ],
  // Tier 3 - Supporting (important but secondary)
  tier3: [
    'server/websocketServer.js',
    'server/tradingLogger.js',
    'server/strategyMonitor.js',
    'server/leveragedEtfStrategy.js',
    'server/leveragedEtfRules.js',
    'server/cheddarFlowScraper.js',
  ],
};

const ALL_MVP_FILES = [...MVP_FILES.tier1, ...MVP_FILES.tier2, ...MVP_FILES.tier3];

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getTierForFile(file) {
  if (MVP_FILES.tier1.includes(file)) return { tier: 1, label: 'CRITICAL' };
  if (MVP_FILES.tier2.includes(file)) return { tier: 2, label: 'HIGH IMPACT' };
  if (MVP_FILES.tier3.includes(file)) return { tier: 3, label: 'SUPPORTING' };
  return null;
}

function checkMvpFiles() {
  const stagedFiles = getStagedFiles();
  const mvpChanges = stagedFiles
    .map(file => ({ file, tierInfo: getTierForFile(file) }))
    .filter(({ tierInfo }) => tierInfo !== null);

  if (mvpChanges.length === 0) {
    // No MVP files changed, commit can proceed
    process.exit(0);
  }

  // MVP files detected
  console.log('\n\x1b[33m========================================\x1b[0m');
  console.log('\x1b[33m  MVP FILE CHANGES DETECTED\x1b[0m');
  console.log('\x1b[33m========================================\x1b[0m\n');
  console.log('The following critical trading files are being modified:\n');

  // Group by tier
  const byTier = { 1: [], 2: [], 3: [] };
  mvpChanges.forEach(({ file, tierInfo }) => {
    byTier[tierInfo.tier].push({ file, label: tierInfo.label });
  });

  if (byTier[1].length > 0) {
    console.log('\x1b[31mTier 1 - CRITICAL PATH:\x1b[0m');
    byTier[1].forEach(({ file }) => console.log(`  - ${file}`));
    console.log('');
  }

  if (byTier[2].length > 0) {
    console.log('\x1b[33mTier 2 - HIGH IMPACT:\x1b[0m');
    byTier[2].forEach(({ file }) => console.log(`  - ${file}`));
    console.log('');
  }

  if (byTier[3].length > 0) {
    console.log('\x1b[36mTier 3 - SUPPORTING:\x1b[0m');
    byTier[3].forEach(({ file }) => console.log(`  - ${file}`));
    console.log('');
  }

  console.log('\x1b[33mReminder:\x1b[0m These files require:');
  console.log('  - Testing before committing');
  console.log('  - Careful review of trading logic');
  console.log('  - Edge case consideration\n');

  // Check for --force flag (for CI or explicit bypass)
  if (process.argv.includes('--force')) {
    console.log('\x1b[33m--force flag used, proceeding with commit.\x1b[0m\n');
    process.exit(0);
  }

  // Check if running in a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    console.log('\x1b[33mNon-interactive mode. Use --force to bypass.\x1b[0m');
    console.log('Commit blocked. Run: git commit --no-verify to bypass.\n');
    process.exit(1);
  }

  // Interactive confirmation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\x1b[32mHave you tested these changes? (y/N): \x1b[0m', (answer) => {
    rl.close();
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      console.log('\n\x1b[32mProceeding with commit.\x1b[0m\n');
      process.exit(0);
    } else {
      console.log('\n\x1b[31mCommit aborted. Please test your changes first.\x1b[0m');
      console.log('Use git commit --no-verify to bypass this check.\n');
      process.exit(1);
    }
  });
}

checkMvpFiles();
