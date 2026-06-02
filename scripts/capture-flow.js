#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/capture-flow.js — manually capture one options-flow snapshot to
// data/flow-history/. The server also does this automatically every 15 min
// during market hours; this is for ad-hoc capture / testing.

require('dotenv').config();
const { captureSnapshot } = require('../server/flowCapture');

captureSnapshot()
  .then(r => {
    console.log('flow snapshot:', JSON.stringify(r));
    process.exit(0);
  })
  .catch(e => {
    console.error('capture failed:', e.message);
    process.exit(1);
  });
