#!/usr/bin/env node
'use strict';

//
// This script is called by Claude Code hooks (Notification, Stop, PostToolUseFailure).
// It reads JSON from stdin, checks for rate limit indicators, and spawns the alarm daemon.
// It lives at ~/.claude-alarm/hook-handler.js after setup.
//

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.claude-alarm');
const PID_FILE = path.join(CONFIG_DIR, 'alarm.pid');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Safety: exit after 8 seconds no matter what (hook timeout is 10s)
setTimeout(() => process.exit(0), 8000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    handleHook(data);
  } catch {
    process.exit(0);
  }
});

function handleHook(data) {
  // Collect all text fields to scan for rate limit indicators
  const texts = [
    data.message,
    data.title,
    data.error,
    typeof data.tool_response === 'string'
      ? data.tool_response
      : JSON.stringify(data.tool_response || ''),
  ].filter(Boolean);

  // For Stop hook: read last few lines of transcript for rate limit errors
  if (data.transcript_path) {
    try {
      if (fs.existsSync(data.transcript_path)) {
        const content = fs.readFileSync(data.transcript_path, 'utf8');
        const lines = content.trim().split('\n');
        // Only check last 10 lines to keep it fast
        const tail = lines.slice(-10).join(' ');
        texts.push(tail);
      }
    } catch {
      // Can't read transcript, that's OK
    }
  }

  const fullText = texts.join(' ');

  // Check for rate limit patterns
  const rateLimitPatterns = [
    /rate.?limit/i,
    /usage.?limit/i,
    /limit.?reached/i,
    /limit.?exceeded/i,
    /too.?many.?requests/i,
    /\b429\b/,
    /try.?again.?in/i,
    /cooldown.?period/i,
    /quota.?exceeded/i,
    /token.?limit.?reached/i,
    /capacity.?limit/i,
    /over.?capacity/i,
  ];

  const isRateLimit = rateLimitPatterns.some((p) => p.test(fullText));
  if (!isRateLimit) {
    return process.exit(0);
  }

  // Don't spawn a second alarm if one is already running
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
      process.kill(pid, 0); // Throws if process doesn't exist
      return process.exit(0);
    } catch {
      // Stale PID file, remove and continue
      try {
        fs.unlinkSync(PID_FILE);
      } catch {}
    }
  }

  // Extract how long to wait (in minutes)
  const resetMinutes = extractResetTime(fullText);

  // Fall back to config default
  let defaultWait = 240;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    defaultWait = config.defaultWaitMinutes || 240;
  } catch {}

  const waitMinutes = resetMinutes || defaultWait;

  // Spawn the alarm daemon as a fully detached background process
  const daemon = spawn('node', [path.join(CONFIG_DIR, 'alarm-daemon.js'), String(waitMinutes)], {
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();

  process.exit(0);
}

function extractResetTime(text) {
  let match;

  // "in X hours" / "in X.5 hours"
  match = text.match(/in\s+(\d+\.?\d*)\s*hours?/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 60);

  // "in X minutes"
  match = text.match(/in\s+(\d+)\s*minutes?/i);
  if (match) return parseInt(match[1]);

  // "retry-after: X" (seconds)
  match = text.match(/retry.?after[\s:]+(\d+)/i);
  if (match) return Math.max(1, Math.ceil(parseInt(match[1]) / 60));

  // Time with AM/PM like "3:00 PM"
  match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    if (target <= new Date()) target.setDate(target.getDate() + 1);
    return Math.max(1, Math.ceil((target - new Date()) / 60000));
  }

  // 24-hour time like "15:00"
  match = text.match(/(?:at|until|by)\s+(\d{1,2}):(\d{2})/i);
  if (match) {
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const target = new Date();
      target.setHours(hours, minutes, 0, 0);
      if (target <= new Date()) target.setDate(target.getDate() + 1);
      return Math.max(1, Math.ceil((target - new Date()) / 60000));
    }
  }

  return null;
}
