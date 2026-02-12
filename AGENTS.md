# bo-pi Development Notes

This repo contains the bo-pi extension used by pi. Use the notes below when developing or testing the extension.

## Development
- Main extension entrypoint: `extensions/preflight/index.ts`.
- Package metadata lives in `package.json`; `pi.extensions` lists each extension entrypoint.
- Persistent config is stored at `~/.pi/agent/extensions/bo-pi/preflight.json`.

## Commits
- Use imperative, short subject lines.
- Do **not** use conventional-commit prefixes (`feat:`, `docs:`, etc.).
- Example: `Add development notes`.

## Testing (pi interactive mode)
Use the interactive shell tool to run pi in a controlled TUI session. Do **not** run TUI commands via `bash`.

### Recommended commands
From the pi repo root (using its test wrapper):
```bash
./pi-test.sh -e /absolute/path/to/bo-pi
```

Or with a globally installed pi:
```bash
pi -e /absolute/path/to/bo-pi
```

Use an absolute path so the extension is found reliably.

### Important nuances
- **Wait for full load**: do not send inputs until the prompt and status line are visible.
- **Always send Enter** after a prompt or command. Pi waits for the newline to execute; without it the input will just sit in the prompt buffer.
- For settings, use explicit commands (for example):
  - `/preflight approvals off` then **Enter**
  - `/preflight approvals destructive` then **Enter**
- When the session is done, exit or kill the interactive shell session explicitly.

### Using the interactive shell tool
- Start pi via `interactive_shell` with `mode: "hands-free"` so you can send input programmatically.
- Query status/output after the prompt is visible before sending commands.
- Send input with `input` and `inputKeys: ["enter"]` to ensure execution.

### Example flow
1. Start: `interactive_shell({ command: "./pi-test.sh -e /absolute/path/to/bo-pi", mode: "hands-free" })`
2. Poll until prompt is visible.
3. Send: `"/preflight approvals off"` + Enter.
4. Send a user prompt + Enter.
5. Verify tool behavior, then kill the session when done.
