#!/usr/bin/env node
'use strict';

//
// Background alarm daemon. Spawned by hook-handler.js or manual `claude-alarm start`.
// Sleeps until the target time, then fires a positive desktop notification + voice alert.
// Repeats once after 1 minute if not dismissed. Auto-exits after that.
//
// Usage:
//   node alarm-daemon.js <minutes>     Background mode: wait <minutes>, then alarm
//   node alarm-daemon.js --now         Test mode: fire once immediately, then exit
//

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.claude-alarm');
const PID_FILE = path.join(CONFIG_DIR, 'alarm.pid');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const isTestMode = process.argv.includes('--now');

// ── Load config ──────────────────────────────────────────────────────

let config = {
  displayMessage: 'Time to build. Claude credits are back!',
  spokenMessage: 'Time to build. Clawed credits are back!',
  voice: 'Samantha',
  rate: 165,
  defaultWaitMinutes: 240,
};

try {
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  config = { ...config, ...saved };
} catch {}

// ── PID management ───────────────────────────────────────────────────

if (!isTestMode) {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function cleanup() {
  if (!isTestMode) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
  }
}

process.on('exit', cleanup);
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

// ── Parse wait time ──────────────────────────────────────────────────

const waitArg = process.argv[2];
const waitMinutes =
  isTestMode ? 0 : waitArg !== undefined ? parseInt(waitArg) || config.defaultWaitMinutes : config.defaultWaitMinutes;
const waitMs = waitMinutes * 60 * 1000;

// ── Schedule alarm ───────────────────────────────────────────────────

if (isTestMode) {
  fireAlarm();
  process.exit(0);
} else {
  setTimeout(() => {
    fireAlarm();

    // Second alarm after 1 minute if not dismissed
    setTimeout(() => {
      if (fs.existsSync(PID_FILE)) {
        fireAlarm();
      }
      // Done. Auto-exit.
      setTimeout(() => process.exit(0), 3000);
    }, 60 * 1000);
  }, waitMs);
}

// ── Alarm ────────────────────────────────────────────────────────────

function fireAlarm() {
  const platform = os.platform();

  // Terminal bell (universal fallback)
  try {
    process.stdout.write('\x07');
  } catch {}

  if (platform === 'darwin') {
    macOSAlarm();
  } else if (platform === 'linux') {
    linuxAlarm();
  } else if (platform === 'win32') {
    windowsAlarm();
  }
}

// ── macOS ────────────────────────────────────────────────────────────

function macOSAlarm() {
  // Desktop notification with chime
  try {
    execFileSync('osascript', [
      '-e',
      'display notification "' +
        config.displayMessage +
        '" with title "Claude Credits Renewed" subtitle "Your Pro limit has reset" sound name "Glass"',
    ]);
  } catch {}

  // Play chime sound
  try {
    execFileSync('afplay', ['/System/Library/Sounds/Glass.aiff']);
  } catch {}

  // Speak the message
  try {
    execFileSync('say', ['-v', config.voice || 'Samantha', '-r', String(config.rate || 165), config.spokenMessage]);
  } catch {}
}

// ── Linux ────────────────────────────────────────────────────────────

function linuxAlarm() {
  // Desktop notification
  try {
    execFileSync('notify-send', ['-u', 'normal', 'Claude Credits Renewed', config.displayMessage]);
  } catch {}

  // Voice
  if (config.voice === 'espeak') {
    try {
      execFileSync('espeak', ['-s', '150', config.spokenMessage]);
    } catch {}
  } else if (config.voice === 'spd-say') {
    try {
      execFileSync('spd-say', [config.spokenMessage]);
    } catch {}
  }

  // Notification sound fallback
  try {
    execFileSync('paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga']);
  } catch {
    try {
      execFileSync('aplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga']);
    } catch {}
  }
}

// ── Windows ──────────────────────────────────────────────────────────

function windowsAlarm() {
  const psScript = `
    Add-Type -AssemblyName System.Speech
    Add-Type -AssemblyName PresentationFramework
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.Rate = 0
    $synth.Speak('${config.spokenMessage.replace(/'/g, "''")}')
    [System.Windows.MessageBox]::Show('${config.displayMessage.replace(/'/g, "''")}', 'Claude Credits Renewed', 'OK', 'Information')
  `.trim();

  try {
    execFileSync('powershell', ['-NoProfile', '-Command', psScript]);
  } catch {}
}
