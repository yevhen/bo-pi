# Preflight guide

bo-pi adds a preflight/approval layer for tool calls in Pi. It generates short summaries and destructive flags with an LLM, applies permission rules, and optionally prompts you before the tool executes.

Key features:
- Natural-language summaries for tool calls.
- LLM-based destructive classification for destructive-only approvals.
- Natural-language policy rules with optional context.
- Explain mode with a configurable context window.
- Session-specific overrides and model selection for preflight vs policy.

## Flow overview

1. The agent emits a tool call.
2. bo-pi builds a preflight prompt (tool-call only context) and requests metadata.
3. Permission rules and policy rules are evaluated.
4. If the decision is **ask**, bo-pi shows the inline approval UI.
5. If allowed, the tool runs. If blocked, the tool result is replaced with a non-error “blocked by policy/user” message.

## Approval modes

Set via `/preflight approvals`:

- `all`: ask for every tool call unless a rule allows it.
- `destructive`: ask only when preflight marks the call as destructive (LLM classification).
- `off`: do not ask; allow unless a rule or policy denies.

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

When you select **No** or **Never**, press **Tab** to add an optional reason. Reasons entered for **Never** are saved with the deny rule and reused in future blocks.

## Explain mode

In the approval dialog, press the explain shortcut (default `ctrl+e`) to request a richer explanation. Explain uses the configured context window (`/preflight context`):

- `full`: use full context.
- `N`: use the last N messages.

Policy rules use the same context window when evaluating natural-language policies.

## Permission rules

Rules are stored in:
- Workspace: `.pi/preflight/settings.local.json`
- Global: `~/.pi/preflight/settings.json`

`allow`, `ask`, and `deny` lists use tool patterns:

```json
{
  "permissions": {
    "allow": ["Bash(ls -la)", "Read(./docs/**)"],
    "ask": ["Write(**/*.md)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

Deny rules can also include optional reasons:

```json
{
  "permissions": {
    "deny": [
      {
        "rule": "Bash(rm -rf *)",
        "reason": "Destructive command"
      }
    ]
  }
}
```

Matching behavior:
- **Bash** uses `*` wildcards.
- **Read/Edit/Write** use gitignore-style patterns.
- **Custom tools** use `ToolName(args:<json>)` and match arguments exactly.

Path patterns are resolved relative to:
- `./` → current workspace
- `/` → settings file directory
- `//` → absolute path root
- `~/` → home directory

## Policy rules (LLM)

LLM policy rules live under `preflight.llmRules` and are written in natural language:

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

Policy rules can only tighten decisions (allow → ask/deny, ask → deny). If a policy denies and UI is available, bo-pi offers a one-time override and can persist it to `preflight.policyOverrides`.

## Session vs default settings

The `/preflight` menu lets you change settings for the current session or defaults. Session overrides are stored in the session history and take precedence over defaults.

## Model selection

Preflight and policy evaluation can use different models. Configure them via `/preflight model` and `/preflight policy-model`.

## Preflight summaries

Each tool call gets a short, natural-language summary and a destructive flag used in the approval UI. This preflight metadata is generated from the tool call itself (tool-call-only context) to reduce prompt injection risks.

## Debugging

Enable debug output with `/preflight debug on`. In UI mode, debug logs are shown as notifications. In non-UI mode, they print to stdout.
