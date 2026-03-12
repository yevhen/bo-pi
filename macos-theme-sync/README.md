# macOS Theme Sync

macOS Theme Sync keeps Pi's theme aligned with the current macOS appearance.

When macOS switches between light and dark mode, Pi updates automatically. You can also map macOS dark/light to any Pi themes you prefer.

## Install

Install from npm:

```bash
pi install npm:@yevhen.b/pi-macos-theme-sync
```

From a local checkout:

```bash
pi install /absolute/path/to/bo-pi/macos-theme-sync
```

Temporary run without installing:

```bash
pi -e npm:@yevhen.b/pi-macos-theme-sync
```

## What it does

- Watches macOS appearance changes without polling.
- Reuses one shared `osascript` watcher across Pi sessions.
- Applies Pi's built-in `dark` / `light` themes by default.
- Lets you remap macOS `dark` and `light` to any installed Pi themes.
- Shows a small status indicator in the UI (`🌙` or `☀️`).

## Command

- `/macos-theme-map` opens a simple picker flow to map:
  - macOS `dark` → Pi theme
  - macOS `light` → Pi theme

## Files

- Theme map: `~/.pi/agent/extensions/macos-theme-map.json`
- Debug log: `~/.pi/agent/extensions/macos-theme-sync.log`
- Shared state file: `/tmp/pi-macos-theme`
- Shared watcher pid file: `/tmp/pi-macos-theme.pid`

## Notes

- Only runs on macOS.
- If Pi is running inside Ghostty IDE, this extension stays inactive so Ghostty-specific syncing can take over.
- The shared watcher is detached and intentionally not killed on session shutdown, so multiple Pi sessions can reuse it.

## More docs

- [Full macOS Theme Sync guide](../docs/macos-theme-sync.md)
- [Repo README](../README.md)
- [Releasing](../RELEASING.md)
