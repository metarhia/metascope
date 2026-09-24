#!/usr/bin/env node
'use strict';

const { main } = require('../lib/app.js');
const { leaveInteractive } = require('../lib/layout.js');

process.on('uncaughtException', (error) => {
  try {
    leaveInteractive();
  } catch {
    // ignore
  }
  console.error('Uncaught:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

main(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
