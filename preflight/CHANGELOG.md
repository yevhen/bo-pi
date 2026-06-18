# Changelog

## [Unreleased]

## [0.0.10] - 2026-06-18

### Changed
- Move Preflight into a top-level extension directory in the shared bo-pi repo.
- Add extension-local README and package metadata.
- Migrate Preflight to the latest `@earendil-works/pi-*` SDK packages.
- Resolve model auth via `getApiKeyAndHeaders()` so latest Pi custom provider headers and env are forwarded during preflight calls.

## [0.0.9] - 2026-03-11
### Added
- Preflight is now documented as a standalone extension inside the multi-extension bo-pi package.
