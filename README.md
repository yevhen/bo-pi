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
- `/preflight context full|<N>` sets context for explain and rule suggestions.
- `/preflight model current|provider/model` sets the preflight model.
- `/preflight policy-model current|provider/model` sets the policy/rule-suggestion model.
- `/preflight debug on|off` toggles debug logs.
- `/preflight reset-session` clears session overrides.

## Highlights

- Single LLM preflight call returns both intrinsic metadata and policy decision per tool call.
- Deterministic-first decision order: `permissions deny > ask > allow`, then policy, then fallback mode.
- LLM-generated summaries/destructive flags for approvals.
- Explain mode with full context or last N messages.
- Inline custom rule flow in approval UI with immediate re-check for the current call.
- Tool-scoped policy rules (`preflight.llmRules.<tool>[]`) with legacy format migration.
- Session overrides vs default settings, plus per-purpose model selection.

## Approval UI example

```
Agent wants to:
List files in the scripts/ directory

Scope: scripts/

→ Yes
  Always (this workspace)
  No
  Ask before running shell commands in hidden/system directories
```

On the 4th row:
- `Tab` accepts the suggestion.
- `Tab` again cycles to the next suggestion.
- typing enters your own rule.
- `Enter` saves the selected/typed rule and re-evaluates the current tool call.

## Config files

- Persistent settings: `~/.pi/agent/extensions/bo-pi/preflight.json`
- Workspace rules: `.pi/preflight/settings.local.json`
- Global rules: `~/.pi/preflight/settings.json`
- Workspace debug log: `.pi/preflight/logs/preflight-debug.log`

Session overrides are stored in session history and take precedence over defaults.

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

Canonical storage is tool-scoped under `preflight.llmRules`:

```json
{
  "preflight": {
    "llmRules": {
      "bash": [
        "Deny commands that remove files recursively",
        "Ask before shell commands that change git history"
      ],
      "read": [
        "Allow reads inside docs/ and test/"
      ]
    }
  }
}
```

Legacy formats (`string[]`, `[{pattern, policy}]`) are still read and migrated on write.

Policy overrides live under `preflight.policyOverrides` and are written when policy blocks are explicitly overridden.

## Docs

- [Preflight guide/spec](docs/preflight.md)
- [Releasing](RELEASING.md)
