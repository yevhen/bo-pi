# Pi Assistant

Pi Assistant is a home for Pi extensions that work with the current dialog and assistant responses.

Right now it provides `/assistant`, which can copy the last completed assistant response to the clipboard or save it to a file as Markdown or plain text.

## Install

Install from npm:

```bash
pi install npm:@yevhen.b/pi-assistant
```

From a local checkout:

```bash
pi install /absolute/path/to/bo-pi/pi-assistant
```

Temporary run without installing:

```bash
pi -e npm:@yevhen.b/pi-assistant
```

## Commands

### `/assistant`

- `/assistant` opens an action picker
- `/assistant help` shows usage
- `/assistant copy [markdown|plain|rich]` copies the last completed assistant response
- `/assistant save [path] [--append] [--format markdown|plain]` saves the last completed assistant response

Examples:

```bash
/assistant copy
/assistant copy plain
/assistant copy rich
/assistant save
/assistant save notes.md --append
/assistant save notes.txt --format plain
```

Paths are resolved relative to Pi's current working directory.

## Current behavior

- Waits for the agent to become idle before reading session history.
- Scans the current session branch backward.
- Finds the last completed assistant message (`stopReason === "stop"`).
- Uses only text blocks from that message.
- Ignores thinking and tool-call blocks.
- Supports Markdown passthrough, plain-text rendering via the `remark`/`unified` ecosystem, and macOS rich-text clipboard copy.
- Saves with overwrite by default; `--append` appends with a format-aware separator.
- Copies via platform clipboard commands (`pbcopy`, `wl-copy`, `xclip`, `clip.exe`).

If no completed assistant response exists, the command shows an error and does not write a file or copy anything.

## Suggested internal structure

As this package grows, keep it split by responsibility:

- `commands/` — slash commands and command registration
- `session/` — helpers for traversing branch/tree/session state
- `ui/` — notifications, pickers, overlays, widgets, and future custom components
- `index.ts` — thin entrypoint that wires everything together

## More docs

- [Repo README](../README.md)
- [Releasing](../RELEASING.md)
