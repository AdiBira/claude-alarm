#!/usr/bin/env node
'use strict';

//
// Background alarm daemon. Spawned by hook-handler.js or manual `claude-alarm start`.
// Sleeps until the target time, then fires a positive desktop notification + voice alert.
// Shows a persistent dialog with a dismiss button. If dismissed, the second repeat is cancelled.
// If not dismissed, repeats once after 1 minute, then auto-exits.
//
// Usage:
//   node alarm-daemon.js <minutes>     Background mode: wait <minutes>, then alarm
//   node alarm-daemon.js --now         Test mode: fire once immediately, then exit
//

const { execFileSync, spawn: spawnChild } = require('child_process');
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
const parsedWait = waitArg !== undefined ? parseFloat(waitArg) : NaN;
const waitMinutes = isTestMode ? 0 : !isNaN(parsedWait) && parsedWait >= 0 ? parsedWait : config.defaultWaitMinutes;
const waitMs = Math.round(waitMinutes * 60 * 1000);

// ── Schedule alarm ───────────────────────────────────────────────────

if (isTestMode) {
  playAlertSounds();
  process.exit(0);
} else {
  setTimeout(() => {
    playAlertSounds();

    // Show persistent dismiss dialog (non-blocking spawn)
    // When user clicks the button, the dialog process exits and we clean up
    const dialogProc = showDismissDialog();

    if (dialogProc) {
      dialogProc.on('close', () => {
        // User clicked "Let's go!" -- dismiss alarm, cancel second repeat
        cleanup();
        process.exit(0);
      });
    }

    // Second alarm after 1 minute if not dismissed (PID file still exists)
    setTimeout(() => {
      if (fs.existsSync(PID_FILE)) {
        playAlertSounds();
      }
      // Auto-exit after second alarm regardless
      setTimeout(() => process.exit(0), 5000);
    }, 60 * 1000);
  }, waitMs);
}

// ── Alert sounds (notification + chime + voice) ──────────────────────

function playAlertSounds() {
  const platform = os.platform();

  // Terminal bell (universal fallback)
  try {
    process.stdout.write('\x07');
  } catch {}

  if (platform === 'darwin') {
    macOSSounds();
  } else if (platform === 'linux') {
    linuxSounds();
  } else if (platform === 'win32') {
    windowsSounds();
  }
}

// ── Dismiss dialog (persistent, stays on screen until clicked) ───────

function showDismissDialog() {
  const platform = os.platform();

  if (platform === 'darwin') {
    return macOSDialog();
  } else if (platform === 'linux') {
    return linuxDialog();
  } else if (platform === 'win32') {
    return windowsDialog();
  }
  return null;
}

// ── macOS ────────────────────────────────────────────────────────────

function macOSSounds() {
  // Desktop notification with chime
  try {
    execFileSync('osascript', [
      '-e',
      'display notification "' +
        config.displayMessage +
        '" with title "Claude Credits Renewed" subtitle "Your rate limit has reset" sound name "Glass"',
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

function macOSDialog() {
  // Persistent dialog with "Let's go!" button -- stays on screen until clicked
  try {
    const proc = spawnChild('osascript', [
      '-e',
      'display dialog "' +
        config.displayMessage +
        '" with title "Claude Credits Renewed" buttons {"Let\'s go!"} default button "Let\'s go!" with icon note',
    ]);
    return proc;
  } catch {}
  return null;
}

// ── Linux ────────────────────────────────────────────────────────────

function linuxSounds() {
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

function linuxDialog() {
  // Try zenity first, fall back to kdialog
  try {
    const proc = spawnChild('zenity', [
      '--info',
      '--title=Claude Credits Renewed',
      '--text=' + config.displayMessage,
      '--ok-label=Let\'s go!',
    ]);
    return proc;
  } catch {}

  try {
    const proc = spawnChild('kdialog', [
      '--msgbox',
      config.displayMessage,
      '--title',
      'Claude Credits Renewed',
    ]);
    return proc;
  } catch {}

  return null;
}

// ── Windows ──────────────────────────────────────────────────────────

function windowsSounds() {
  const psScript = `
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.Rate = 0
    $synth.Speak('${config.spokenMessage.replace(/'/g, "''")}')
  `.trim();

  try {
    execFileSync('powershell', ['-NoProfile', '-Command', psScript]);
  } catch {}
}

function windowsDialog() {
  const psScript = `
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('${config.displayMessage.replace(/'/g, "''")}', 'Claude Credits Renewed', 'OK', 'Information')
  `.trim();

  try {
    const proc = spawnChild('powershell', ['-NoProfile', '-Command', psScript]);
    return proc;
  } catch {}
  return null;
}
