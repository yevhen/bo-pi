# bo-pi Development Notes

This repo contains multiple Pi extensions, each published separately.

## Extensions
- Preflight package: `preflight/package.json`
- Preflight entrypoint: `preflight/index.ts`
- macOS Theme Sync package: `macos-theme-sync/package.json`
- macOS Theme Sync entrypoint: `macos-theme-sync/index.ts`
- Root `package.json` is workspace/test tooling only.

## Persistent files
- Preflight config: `~/.pi/agent/extensions/bo-pi/preflight.json`
- macOS theme map: `~/.pi/agent/extensions/macos-theme-map.json`

## Commits
- Use imperative, short subject lines.
- Do **not** use conventional-commit prefixes (`feat:`, `docs:`, etc.).
- Example: `Add development notes`.

## Testing (pi interactive mode)
Use the interactive shell tool to run Pi in a controlled TUI session. Do **not** run TUI commands via `bash`.

### Recommended commands
From the Pi repo root (using its test wrapper):
```bash
./pi-test.sh -e /absolute/path/to/bo-pi/preflight
./pi-test.sh -e /absolute/path/to/bo-pi/macos-theme-sync
```

Or with a globally installed Pi:
```bash
pi -e /absolute/path/to/bo-pi/preflight
pi -e /absolute/path/to/bo-pi/macos-theme-sync
```

Use absolute paths so the extension package is found reliably.

### Important nuances
- **Wait for full load**: do not send inputs until the prompt and status line are visible.
- **Always send Enter** after a prompt or command. Pi waits for the newline to execute; without it the input will just sit in the prompt buffer.
- For preflight settings, use explicit commands (for example):
  - `/preflight approvals off` then **Enter**
  - `/preflight approvals destructive` then **Enter**
- For theme sync, use `/macos-theme-map` then **Enter**.
- When the session is done, exit or kill the interactive shell session explicitly.

### Using the interactive shell tool
- Start Pi via `interactive_shell` with `mode: "hands-free"` so you can send input programmatically.
- Query status/output after the prompt is visible before sending commands.
- Send input with `input` and `inputKeys: ["enter"]` to ensure execution.

### Example flow
1. Start: `interactive_shell({ command: "./pi-test.sh -e /absolute/path/to/bo-pi/preflight", mode: "hands-free" })`
2. Poll until prompt is visible.
3. Send: `"/preflight approvals off"` + Enter.
4. Send a user prompt + Enter.
5. Optionally run a second session with `macos-theme-sync` and verify `"/macos-theme-map"`.
6. Verify behavior, then kill the session when done.
