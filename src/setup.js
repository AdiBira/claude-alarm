'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync, spawn } = require('child_process');

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, '.claude-alarm');
const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.json');
const PID_FILE = path.join(CONFIG_DIR, 'alarm.pid');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── Setup ────────────────────────────────────────────────────────────

function setup() {
  console.log('\n  claude-alarm setup\n');

  const platform = os.platform();
  const platformName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : 'Windows';
  console.log(`  Detected: ${platformName}`);

  // Detect platform capabilities
  const config = detectConfig(platform);

  // Create config directory
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  // Copy standalone scripts to ~/.claude-alarm/
  const srcDir = path.join(__dirname);
  fs.copyFileSync(path.join(srcDir, 'hook-handler.js'), path.join(CONFIG_DIR, 'hook-handler.js'));
  fs.copyFileSync(path.join(srcDir, 'alarm-daemon.js'), path.join(CONFIG_DIR, 'alarm-daemon.js'));

  // Write config
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('');

  // Install Claude Code hooks
  console.log('  Installing Claude Code hooks...');
  installHooks();

  // Run test alarm
  console.log('\n  Running test alarm...');
  spawnSync('node', [path.join(CONFIG_DIR, 'alarm-daemon.js'), '--now'], {
    stdio: 'inherit',
  });

  console.log('\n  Setup complete.');
  console.log('  You\'ll be alerted automatically when credits renew.');
  console.log('  Run \'claude-alarm stop\' to dismiss an active alarm.\n');
}

// ── Uninstall ────────────────────────────────────────────────────────

function uninstall() {
  console.log('\n  claude-alarm uninstall\n');

  // Stop any running alarm
  stopAlarm(true);

  // Remove hooks from Claude Code settings
  removeHooks();

  // Remove config directory
  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    console.log('  Removed ~/.claude-alarm/');
  }

  console.log('\n  Uninstalled. All hooks and config removed.\n');
}

// ── Manual Start ─────────────────────────────────────────────────────

function manualStart(timeArg) {
  if (!timeArg) {
    console.log('\n  Usage: claude-alarm start <time>');
    console.log('  Examples: "4h", "30m", "240" (minutes)\n');
    process.exit(1);
  }

  const minutes = parseTime(timeArg);
  if (minutes <= 0) {
    console.log('\n  Invalid time. Use formats like "4h", "30m", or "240" (minutes).\n');
    process.exit(1);
  }

  // Check if alarm already running
  if (isAlarmRunning()) {
    console.log('\n  Alarm already active. Run \'claude-alarm stop\' first.\n');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Ensure config exists
  if (!fs.existsSync(CONFIG_FILE)) {
    const config = detectConfig(os.platform());
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  // Ensure alarm daemon exists
  const daemonPath = path.join(CONFIG_DIR, 'alarm-daemon.js');
  if (!fs.existsSync(daemonPath)) {
    fs.copyFileSync(path.join(__dirname, 'alarm-daemon.js'), daemonPath);
  }

  const daemon = spawn('node', [daemonPath, String(minutes)], {
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();

  const targetTime = new Date(Date.now() + minutes * 60 * 1000);
  const timeStr = targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  console.log(`\n  Alarm set for ${timeStr} (${formatDuration(minutes)} from now).`);
  console.log('  Run \'claude-alarm stop\' to cancel.\n');
}

// ── Stop ─────────────────────────────────────────────────────────────

function stop() {
  stopAlarm(false);
}

function stopAlarm(silent) {
  if (!fs.existsSync(PID_FILE)) {
    if (!silent) console.log('\n  No active alarm.\n');
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    process.kill(pid, 'SIGTERM');
    if (!silent) console.log('\n  Alarm dismissed.\n');
  } catch {
    if (!silent) console.log('\n  Alarm was already stopped.\n');
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {}
}

// ── Status ───────────────────────────────────────────────────────────

function status() {
  if (!isAlarmRunning()) {
    console.log('\n  No active alarm.\n');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
  console.log(`\n  Alarm is active (PID: ${pid}).`);
  console.log('  Run \'claude-alarm stop\' to dismiss.\n');
}

// ── Test ─────────────────────────────────────────────────────────────

function test() {
  const daemonPath = path.join(CONFIG_DIR, 'alarm-daemon.js');
  if (!fs.existsSync(daemonPath)) {
    console.log('\n  Run \'claude-alarm setup\' first.\n');
    process.exit(1);
  }

  console.log('\n  Playing test alarm...\n');
  spawnSync('node', [daemonPath, '--now'], { stdio: 'inherit' });
  console.log('');
}

// ── Hook Installation ────────────────────────────────────────────────

function installHooks() {
  let settings = {};

  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    } catch {
      console.log('  Warning: Could not parse ~/.claude/settings.json. Creating backup...');
      fs.copyFileSync(CLAUDE_SETTINGS, CLAUDE_SETTINGS + '.backup');
      settings = {};
    }
  }

  if (!settings.hooks) settings.hooks = {};

  const hookCommand = `node "${path.join(CONFIG_DIR, 'hook-handler.js')}"`;

  const hookEntry = {
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 10,
      },
    ],
  };

  const hookEvents = ['Notification', 'Stop', 'PostToolUseFailure'];

  for (const event of hookEvents) {
    if (!settings.hooks[event]) settings.hooks[event] = [];

    const exists = settings.hooks[event].some(
      (h) => h.hooks && h.hooks.some((hh) => hh.command && hh.command.includes('claude-alarm'))
    );

    if (!exists) {
      settings.hooks[event].push(hookEntry);
      console.log(`  + ${event} hook added`);
    } else {
      console.log(`  = ${event} hook (already installed)`);
    }
  }

  const claudeDir = path.dirname(CLAUDE_SETTINGS);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
}

function removeHooks() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return;

  try {
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    if (!settings.hooks) return;

    const hookEvents = ['Notification', 'Stop', 'PostToolUseFailure'];

    for (const event of hookEvents) {
      if (!settings.hooks[event]) continue;
      settings.hooks[event] = settings.hooks[event].filter(
        (h) => !(h.hooks && h.hooks.some((hh) => hh.command && hh.command.includes('claude-alarm')))
      );
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }

    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
    console.log('  Removed Claude Code hooks');
  } catch {
    console.log('  Warning: Could not update ~/.claude/settings.json');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function detectConfig(platform) {
  const config = {
    displayMessage: 'Time to build. Claude credits are back!',
    spokenMessage: 'Time to build. Clawed credits are back!',
    defaultWaitMinutes: 240,
  };

  if (platform === 'darwin') {
    config.voice = 'Samantha';
    config.rate = 165;
    console.log('  Voice: Samantha ✓');
    console.log('  Desktop notifications: osascript ✓');
    console.log('  Sound: afplay ✓');
  } else if (platform === 'linux') {
    const hasNotify = commandExists('notify-send');
    const hasEspeak = commandExists('espeak');
    const hasSpd = commandExists('spd-say');
    config.voice = hasEspeak ? 'espeak' : hasSpd ? 'spd-say' : null;
    console.log(
      `  Desktop notifications: ${hasNotify ? 'notify-send ✓' : '✗ (install: sudo apt install libnotify-bin)'}`
    );
    console.log(
      `  Voice: ${config.voice ? config.voice + ' ✓' : '✗ (install: sudo apt install espeak)'}`
    );
  } else if (platform === 'win32') {
    config.voice = 'powershell';
    console.log('  Voice: PowerShell Speech ✓');
    console.log('  Desktop notifications: PowerShell Toast ✓');
  }

  return config;
}

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isAlarmRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    process.kill(pid, 0);
    return true;
  } catch {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
    return false;
  }
}

function parseTime(str) {
  str = str.trim().toLowerCase();
  const hourMatch = str.match(/^(\d+\.?\d*)h$/);
  if (hourMatch) return Math.ceil(parseFloat(hourMatch[1]) * 60);
  const minMatch = str.match(/^(\d+)m$/);
  if (minMatch) return parseInt(minMatch[1]);
  const numMatch = str.match(/^(\d+)$/);
  if (numMatch) return parseInt(numMatch[1]);
  return 0;
}

function formatDuration(minutes) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

module.exports = { setup, uninstall, manualStart, stop, status, test };
