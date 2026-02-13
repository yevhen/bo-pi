# bo-pi

Tool preflight approvals for the Pi coding agent. YOLO mode done right!

## Install

From npm:

```bash
pi install npm:@yevhen.b/bo-pi
```

From a local checkout:

```bash
pi install /absolute/path/to/bo-pi
```

Temporary run without installing:

```bash
pi -e npm:@yevhen.b/bo-pi
```

## Usage

- `/preflight` opens the interactive settings menu.
- `/preflight status` prints active settings.
- `/preflight approvals all|destructive|off` sets approval mode.
- `/preflight context full|<N>` sets context for explain and policy evaluation.
- `/preflight model current|provider/model` sets the preflight model.
- `/preflight policy-model current|provider/model` sets the policy model.
- `/preflight debug on|off` toggles debug logs.
- `/preflight reset-session` clears session overrides.

## Highlights

- LLM-generated, natural-language summaries for every tool call.
- LLM-based destructive classification powers destructive-only approvals (fewer prompts).
- Natural-language policy rules (LLM) evaluated with a configurable context window.
- Explain mode with full context or last N messages.
- Session overrides vs default settings, plus per-purpose model selection.

## Approval UI example

```
Agent wants to:
List files in the scripts/ directory

Scope: scripts/

→ Yes
  Always (this workspace)
  No
  Never (this workspace)
```

## Config files

- Persistent settings: `~/.pi/agent/extensions/bo-pi/preflight.json`
- Workspace rules: `.pi/preflight/settings.local.json`
- Global rules: `~/.pi/preflight/settings.json`

The UI choices “Always (this workspace)” / “Never (this workspace)” persist rules in the workspace file.
Session overrides are stored in the session history and take precedence over defaults.

## Permission rules (workspace/global)

Rules live in `permissions.allow|ask|deny` arrays. Examples:

```json
{
  "permissions": {
    "allow": [
      "Bash(ls -la)",
      "Read(./docs/**)",
      "Write(//tmp/*.txt)",
      "MyTool(args:{\"mode\":\"safe\"})"
    ],
    "ask": [],
    "deny": []
  }
}
```

Matching behavior:
- `Bash(...)` uses `*` wildcards.
- `Read/Edit/Write(...)` use gitignore-style patterns.
- `ToolName(args:<json>)` matches arguments exactly for non-builtin tools.

## Policy rules

LLM policy rules are stored under `preflight.llmRules`:

```json
{
  "preflight": {
    "llmRules": [
      {
        "pattern": "Bash(*)",
        "policy": "Deny if the command contains rm -rf. Otherwise allow."
      }
    ]
  }
}
```

Policy overrides live under `preflight.policyOverrides` and are written when you allow a policy-blocked tool call.

## Docs

- [Preflight guide](docs/preflight.md)
- [Releasing](RELEASING.md)
