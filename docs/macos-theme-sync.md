# macOS Theme Sync guide

`macos-theme-sync` keeps Pi's theme in sync with macOS appearance changes.

It is designed to be event-driven and lightweight: one detached `osascript` watcher listens for macOS appearance notifications, writes the current state to a shared temp file, and each Pi session watches that file.

## How it works

Architecture:

```text
osascript watcher (shared, detached)
  -> writes "dark" or "light" to /tmp/pi-macos-theme
  -> Pi sessions watch the file and call ctx.ui.setTheme()
```

Key behavior:

- no polling loop for appearance detection;
- one shared watcher process across all Pi sessions;
- fallback reconciliation in each session to recover from stale or missed file updates;
- default mapping is macOS `dark` -> Pi `dark`, macOS `light` -> Pi `light`.

## Activation rules

The extension activates on `session_start` only when:

- `process.platform === "darwin"`
- Pi is **not** running inside Ghostty IDE (`GHOSTTY_AGENT_PORT` is not set)

Otherwise it exits early and does nothing.

## Command

Use:

```bash
/macos-theme-map
```

This opens two pickers:
1. map macOS `dark` to a Pi theme;
2. map macOS `light` to a Pi theme.

The extension validates mappings against the list of themes returned by `ctx.ui.getAllThemes()`.

## State and config files

Persistent/theme-related files:

- Theme map: `~/.pi/agent/extensions/macos-theme-map.json`
- Debug log: `~/.pi/agent/extensions/macos-theme-sync.log`
- Shared state: `/tmp/pi-macos-theme`
- Shared watcher pid: `/tmp/pi-macos-theme.pid`

## Failure handling

The extension has a few guardrails:

- If the pid file points to a dead or unexpected process, it is discarded.
- If file watching fails, it retries after a short delay.
- A periodic reconcile pass compares the system appearance with the state file and rewrites stale state.
- If a mapped Pi theme no longer exists, the extension falls back to Pi's built-in `dark` / `light` names.

## Operational details

- Status indicator: `🌙` for dark, `☀️` for light.
- The watcher is intentionally left running after a session exits so other sessions can keep using it.
- Logging is best-effort; failures to write logs do not break theme syncing.

## Related docs

- [macOS Theme Sync README](../macos-theme-sync/README.md)
- [Repo README](../README.md)
