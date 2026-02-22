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

- Every tool call gets a human-readable summary and a destructive/safe label before you decide.
- Three approval modes: ask for everything, ask only for destructive actions, or turn it off entirely.
- Write permission rules in plain language — bo-pi checks them with the LLM on every call.
- Not sure what a tool call does? Press `Ctrl+E` for a detailed explanation with risk assessment.
- bo-pi suggests rules for you — accept with `Tab`, cycle through alternatives, or type your own.
- Suggestions are aware of your existing rules and avoid duplicates or conflicts.
- Permanent rules are saved per workspace or globally; session overrides reset when the session ends.
- Use different models for classification and policy evaluation if you want.

## Approval UI

When a tool call needs your approval, bo-pi shows an inline prompt:

```
Agent wants to:
List files in the scripts/ directory

Scope: scripts/

→ Yes
  Always (this workspace)
  No
  Ask before running shell commands in hidden/system directories
```

The first three options work as you'd expect. The 4th row is a rule suggestion from the model, shown in muted text. You can:

- press `Tab` to accept it,
- press `Tab` again to see the next suggestion,
- start typing to write your own rule instead,
- press `Enter` to save the rule.

When you save a rule, bo-pi checks it for conflicts with your existing rules first. If a conflict is detected, you'll see a dialog:

```
⚠ Rule conflict

New rule:  Deny bash commands that only echo static strings
Conflicts: Allow bash commands that only echo static strings
Reason:    Candidate rule contradicts an existing allow rule

→ Edit rule
  Save anyway
  Cancel
```

- **Edit rule** (default): go back and change the rule text.
- **Save anyway**: persist the rule despite the conflict.
- **Cancel**: discard the rule and block the current call.

If no conflict is found, the rule is saved and bo-pi immediately re-checks the current tool call against it. If the rule allows the call, it proceeds. If it blocks, the call is denied. If the rule says "ask", you'll see the approval prompt again with updated context.

Press `Ctrl+E` (configurable) in the approval prompt to get a detailed explanation: what the tool call does, why it's needed, and a risk assessment.

## Config files

- Persistent settings: `~/.pi/agent/extensions/bo-pi/preflight.json`
- Workspace rules: `.pi/preflight/settings.local.json`
- Global rules: `~/.pi/preflight/settings.json`
- Debug log: `.pi/preflight/logs/preflight-debug.log` (in workspace)

"Always (this workspace)" saves an allow rule in the workspace file. Session overrides are stored in session history and reset when the session ends.

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

Policy rules are written in plain language and grouped by tool:

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

You can write these by hand or let bo-pi create them through the approval UI (4th row).

Legacy formats (`string[]`, `[{pattern, policy}]`) are still read and migrated automatically.

Policy overrides (`preflight.policyOverrides`) are saved when you explicitly allow a call that policy blocked.

## Docs

- [Preflight spec](docs/preflight.md)
- [Releasing](RELEASING.md)
