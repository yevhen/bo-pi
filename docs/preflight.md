# Preflight guide

bo-pi adds a preflight/approval layer for tool calls in Pi. It generates short summaries and destructive flags with an LLM, applies deterministic and policy rules, and optionally prompts before execution.

Key features:
- Single preflight LLM request per tool call returning both intrinsic metadata and policy decision.
- Deterministic permissions + natural-language policy rules.
- Inline approval UI with custom-rule authoring.
- Explain mode with configurable context window.
- Session-specific overrides and separate model selection for preflight vs policy.

## Flow overview

1. The agent emits a tool call.
2. bo-pi runs preflight (LLM) and gets, per tool call:
   - intrinsic: `summary`, `destructive`, optional `scope`
   - policy: `allow|ask|deny|none` + reason
3. bo-pi resolves final decision in this order:
   - deterministic permissions (`deny > ask > allow`), then
   - policy decision, then
   - fallback from approval mode.
4. If final decision is **ask**, bo-pi shows inline approval UI.
5. If allowed, tool executes.
6. If blocked, tool result is rewritten to a non-error user message.

## Approval modes

Set via `/preflight approvals`:

- `all`: ask for every tool call unless rules allow it.
- `destructive`: ask only when preflight marks the call as destructive.
- `off`: do not ask; allow unless rules/policy deny.

## Approval UI

Inline options:

1. `Yes` (or `Allow once` when policy currently denies)
2. `Always (this workspace)`
3. `No` (or `Keep blocked` when policy currently denies)
4. Custom rule row (suggestion + inline input)

Custom rule row behavior:
- muted suggestion shown by default;
- `Tab` accepts suggestion;
- `Tab` again cycles to next suggestion;
- typing replaces suggestion with custom text;
- `Enter` saves rule and immediately re-evaluates the current tool call.

If the new decision is still `ask`, the approval UI opens again with updated policy context.

### Rule conflict detection

Before saving a custom rule, bo-pi checks it against existing rules for conflicts (duplicates, contradictions). If a conflict is detected, a dialog appears:

- **Edit rule** (default): go back and revise the rule.
- **Save anyway**: persist despite the conflict.
- **Cancel**: discard the rule and block the current call.

Conflict detection uses an LLM call with the full rule context (policy rules, deterministic permissions, policy overrides). If the consistency check fails or the model is unavailable, the rule is saved without blocking — conflict detection is warning-based, never a hard gate.

### Rule suggestion context

Suggestions are generated with awareness of your existing rules:
- global and tool-specific policy rules (`preflight.llmRules`)
- deterministic permissions (`permissions.allow|ask|deny`)
- policy overrides (`preflight.policyOverrides`)

This prevents the model from suggesting rules that duplicate or contradict what you already have. Suggestions are also post-filtered on the client side: near-exact duplicates (after normalizing case, whitespace, and trailing punctuation) are removed.

## Explain mode

In the approval dialog, press explain shortcut (default `ctrl+e`) for a richer explanation.

Explain output is normalized to:
- paragraph 1: what will happen,
- paragraph 2: why this is needed (context-based),
- final line: `<Level> risk: <reason>`.

Explain and rule suggestions use `/preflight context`:
- `full`: full context
- `N`: last N messages

Preflight classification itself uses tool-call-only message context to reduce prompt-injection risk from prior chat history.

## Preflight failure handling

If preflight fails:
- with UI: prompt `Retry / Allow / Block`
- without UI: block by default

No silent auto-allow fallback on preflight failure.

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

Matching behavior:
- **Bash** uses `*` wildcards.
- **Read/Edit/Write** use gitignore-style patterns.
- **Custom tools** use `ToolName(args:<json>)` and match arguments exactly.

Path pattern prefixes:
- `./` → current workspace
- `/` → settings file directory
- `//` → absolute path root
- `~/` → home directory

## Policy rules (LLM)

Canonical format is tool-scoped `preflight.llmRules.<tool>[]`:

```json
{
  "preflight": {
    "llmRules": {
      "bash": [
        "Deny commands that recursively delete files"
      ],
      "read": [
        "Allow reads in docs/ and test/"
      ]
    }
  }
}
```

Legacy formats are still supported for reading and are migrated on write:
- `string[]`
- `[{ pattern, policy }]`

Policy overrides are stored in `preflight.policyOverrides`.

## Session vs default settings

The `/preflight` menu has separate tabs for:
- **Session settings**
- **Default settings**

Session overrides take precedence over defaults. Use `/preflight reset-session` to clear session overrides.

## Model selection

Preflight and policy evaluation can use different models:
- `/preflight model ...`
- `/preflight policy-model ...`

## Debugging

Enable debug output with `/preflight debug on`.

bo-pi writes detailed traces to:
- `.pi/preflight/logs/preflight-debug.log`

Includes prompts, context slices, raw responses, parsed metadata, and final decision source (`deterministic | policy | fallback`).
