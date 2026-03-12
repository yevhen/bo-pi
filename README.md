# bo-pi

A repo of Pi extensions with independent npm releases.

## Extensions

| Extension | npm package | What it does |
| --- | --- | --- |
| [preflight](preflight/README.md) | `@yevhen.b/pi-preflight` | Adds tool-call approvals, policy rules, explanations, and rule suggestions before Pi executes actions. |
| [macos-theme-sync](macos-theme-sync/README.md) | `@yevhen.b/pi-macos-theme-sync` | Keeps Pi's light/dark theme in sync with macOS appearance changes and lets you remap dark/light to any Pi theme. |

## Install

Install extensions individually from npm:

```bash
pi install npm:@yevhen.b/pi-preflight
pi install npm:@yevhen.b/pi-macos-theme-sync
```

From a local checkout you can load an individual extension directory:

```bash
pi install /absolute/path/to/bo-pi/preflight
pi install /absolute/path/to/bo-pi/macos-theme-sync
```

Temporary run without installing:

```bash
pi -e npm:@yevhen.b/pi-preflight
pi -e npm:@yevhen.b/pi-macos-theme-sync
```

## Repo layout

- `preflight/` — standalone extension package
- `macos-theme-sync/` — standalone extension package
- `docs/` — shared detailed docs
- root `package.json` — workspace/test tooling only, not published

## Docs

- [Preflight README](preflight/README.md)
- [Preflight guide](docs/preflight.md)
- [macOS Theme Sync README](macos-theme-sync/README.md)
- [macOS Theme Sync guide](docs/macos-theme-sync.md)
- [Releasing](RELEASING.md)
