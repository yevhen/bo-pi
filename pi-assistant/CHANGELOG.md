# Changelog

## [Unreleased]

### Added
- Add the `/assistant` slash command with guided picker flow, clipboard copy (`markdown`, `plain`, `rich`), and file save with `--append` / `--format` options for the last completed assistant response.
- Add macOS rich clipboard copy that writes both plain text and HTML for formatted pasting into rich editors.

### Changed
- Replace the custom Markdown rendering logic with the `remark` / `unified` pipeline for plain-text and HTML conversion, including GFM support for tables and task lists.
