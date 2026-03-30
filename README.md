# bo-pi

A repo of Pi extensions with both standalone packages and an umbrella bundle.

## Packages

| Package | Install | What it does |
| --- | --- | --- |
| [`@yevhen.b/bo-pi`](README.md) | `pi install npm:@yevhen.b/bo-pi` | Umbrella package that installs Preflight, Pi Assistant, and macOS Theme Sync together. |
| [`@yevhen.b/pi-preflight`](preflight/README.md) | `pi install npm:@yevhen.b/pi-preflight` | Adds tool-call approvals, policy rules, explanations, and rule suggestions before Pi executes actions. |
| [`@yevhen.b/pi-assistant`](pi-assistant/README.md) | `pi install npm:@yevhen.b/pi-assistant` | Home for dialog-oriented assistant commands, currently including `/assistant` for copying or saving the last completed assistant response as Markdown or plain text. |
| [`@yevhen.b/pi-macos-theme-sync`](macos-theme-sync/README.md) | `pi install npm:@yevhen.b/pi-macos-theme-sync` | Keeps Pi's light/dark theme in sync with macOS appearance changes and lets you remap dark/light to any Pi theme. |

## Install

### Umbrella package

Install all extensions at once:

```bash
pi install npm:@yevhen.b/bo-pi
```

Temporary run without installing:

```bash
pi -e npm:@yevhen.b/bo-pi
```

### Standalone packages

Install extensions individually from npm:

```bash
pi install npm:@yevhen.b/pi-preflight
pi install npm:@yevhen.b/pi-assistant
pi install npm:@yevhen.b/pi-macos-theme-sync
```

Temporary run without installing:

```bash
pi -e npm:@yevhen.b/pi-preflight
pi -e npm:@yevhen.b/pi-assistant
pi -e npm:@yevhen.b/pi-macos-theme-sync
```

### Local checkouts

From a local checkout you can load either the umbrella repo or an individual extension directory:

```bash
pi install /absolute/path/to/bo-pi
pi install /absolute/path/to/bo-pi/preflight
pi install /absolute/path/to/bo-pi/pi-assistant
pi install /absolute/path/to/bo-pi/macos-theme-sync
```

## Repo layout

- `preflight/` — standalone extension package
- `pi-assistant/` — standalone extension package
- `macos-theme-sync/` — standalone extension package
- root `package.json` — umbrella package for all extensions
- `docs/` — shared detailed docs

## Docs

- [Preflight README](preflight/README.md)
- [Pi Assistant README](pi-assistant/README.md)
- [Preflight guide](docs/preflight.md)
- [macOS Theme Sync README](macos-theme-sync/README.md)
- [macOS Theme Sync guide](docs/macos-theme-sync.md)
- [Releasing](RELEASING.md)
