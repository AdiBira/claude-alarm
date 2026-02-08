#!/usr/bin/env node
'use strict';

const command = process.argv[2];

switch (command) {
  case 'setup':
    require('../src/setup').setup();
    break;
  case 'uninstall':
    require('../src/setup').uninstall();
    break;
  case 'start':
    require('../src/setup').manualStart(process.argv[3]);
    break;
  case 'stop':
    require('../src/setup').stop();
    break;
  case 'status':
    require('../src/setup').status();
    break;
  case 'test':
    require('../src/setup').test();
    break;
  default:
    printHelp();
}

function printHelp() {
  console.log(`
  claude-alarm - Never miss your Claude credit renewal

  Usage:
    claude-alarm <command>

  Commands:
    setup          One-time setup (installs Claude Code hooks)
    uninstall      Remove hooks and clean up
    start <time>   Manual alarm (e.g., "4h", "30m", "90s", "120")
    stop           Dismiss active alarm
    status         Check alarm status
    test           Play a test alarm

  Examples:
    npx claude-alarm setup        # One-time setup
    npx claude-alarm start 4h     # Manual: alarm in 4 hours
    npx claude-alarm start 30s    # Manual: alarm in 30 seconds
    npx claude-alarm stop         # Dismiss alarm
  `);
}
