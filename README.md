# claude-alarm

Never miss your Claude Pro credit renewal. Get an automatic voice alert the moment your rate limit resets.

When you hit the Claude Pro rate limit, `claude-alarm` detects it automatically through Claude Code hooks, starts a countdown, and speaks **"Time to build. Claude credits are back!"** when your credits renew -- with a desktop notification and a gentle chime.

## Setup (one time)

```bash
npm install -g claude-alarm
claude-alarm setup
```

Or without installing globally:

```bash
npx claude-alarm setup
```

That's it. Fully hands-free from here.

## How it works

1. `setup` installs hooks into Claude Code that monitor for rate limit events
2. When a rate limit is detected, a background countdown starts automatically
3. When the countdown ends, you get a desktop notification + voice alert
4. The alert plays twice (immediately and after 1 minute), then stops
5. Dismiss early with `claude-alarm stop`

## Commands

| Command | Description |
|---|---|
| `claude-alarm setup` | One-time setup (installs hooks, tests alarm) |
| `claude-alarm start <time>` | Manual alarm: `4h`, `30m`, or `240` (minutes) |
| `claude-alarm stop` | Dismiss an active alarm |
| `claude-alarm status` | Check if an alarm is active |
| `claude-alarm test` | Play a test alarm |
| `claude-alarm uninstall` | Remove all hooks and config |

## Platform support

| Platform | Notification | Voice | Sound |
|---|---|---|---|
| macOS | osascript | `say` (Samantha) | Glass.aiff |
| Linux | notify-send | espeak / spd-say | paplay |
| Windows | PowerShell Toast | PowerShell Speech | System sounds |

## Configuration

After setup, edit `~/.claude-alarm/config.json` to customize:

```json
{
  "displayMessage": "Time to build. Claude credits are back!",
  "spokenMessage": "Time to build. Clawed credits are back!",
  "voice": "Samantha",
  "rate": 165,
  "defaultWaitMinutes": 240
}
```

- **displayMessage**: Text shown in the desktop notification
- **spokenMessage**: Text spoken aloud (spelled phonetically for correct pronunciation)
- **voice**: macOS voice name, or `espeak`/`spd-say` on Linux
- **rate**: Speech rate (words per minute)
- **defaultWaitMinutes**: Fallback countdown if reset time can't be detected (default: 4 hours)

## How detection works

Claude Code has a hooks system that runs shell commands on events. `claude-alarm` installs hooks on three events:

- **Notification** -- scans notification messages for rate limit keywords
- **Stop** -- reads the session transcript when Claude stops responding
- **PostToolUseFailure** -- catches API 429 errors

When any hook detects a rate limit, it extracts the reset time (or defaults to 4 hours) and spawns a background alarm process that survives terminal close.

## Uninstall

```bash
claude-alarm uninstall
```

Removes all hooks from Claude Code settings and deletes `~/.claude-alarm/`.

## Requirements

- Node.js >= 16 (already required by Claude Code)
- Claude Code CLI

## License

MIT
