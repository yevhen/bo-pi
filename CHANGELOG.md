# Changelog

## [Unreleased]

## [0.0.5] - 2026-02-17
### Fixed
- Re-enable `Tab` suggestion accept/next after empty custom-rule submission when suggestions are available.

## [0.0.4] - 2026-02-17
### Fixed
- Drop invalid LLM suggestion artifacts (for example `<Function_calls>`) from the custom-rule row.
- Normalize additional policy verbs (`block`, `forbid`, `require`, `prompt`, `permit`) to canonical `Allow`/`Ask`/`Deny` suggestions.
- Show a muted `Type custom rule` fallback hint when no suggestion is available.

## [0.0.3] - 2026-02-14
### Added
- Custom rule row in approval UI: bo-pi suggests rules, accept with Tab, cycle alternatives, or type your own.
- Custom rules are applied immediately to the current tool call (allow/deny/re-ask).
- Debug file logging to `.pi/preflight/logs/preflight-debug.log`.
- Tests for rule suggestion normalization, approval flow, and persistence.

### Changed
- Tab is now the only shortcut for accepting and cycling rule suggestions (removed Ctrl+N).
- Rule suggestions are hardened: headings, trailing punctuation, and duplicate lines are filtered.
- Suggestion text requires explicit Tab acceptance; Enter does not implicitly accept.
- Updated README and preflight docs for current behavior.

## [0.0.2] - 2026-02-13
### Added
- Document release process, npm publishing auth, and preflight usage.

### Changed
- Publish package under the @yevhen.b scope.
- Fix package scope in README install commands.

## [0.0.1] - 2026-02-11
### Added
- Initial bo-pi preflight extension with approvals, policies, and rules.
