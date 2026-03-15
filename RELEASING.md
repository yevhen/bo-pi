# Releasing

This repo publishes three npm packages:

- root package `@yevhen.b/bo-pi` — umbrella package bundling both extensions
- `preflight/` -> `@yevhen.b/pi-preflight`
- `macos-theme-sync/` -> `@yevhen.b/pi-macos-theme-sync`

## Tag format

Releases are per package:

```text
bo-pi/vX.Y.Z
preflight/vX.Y.Z
macos-theme-sync/vX.Y.Z
```

Examples:

```text
bo-pi/v0.1.0
preflight/v0.1.0
macos-theme-sync/v0.1.0
```

## Automated publish

Publishing is handled by `.github/workflows/publish.yml`.

When a matching tag is pushed, the workflow will:
1. resolve the target package from the tag,
2. verify the tag version matches that package's `package.json`,
3. install root dependencies with `npm ci`,
4. run the root test suite,
5. run `npm pack --dry-run` in the target package directory,
6. publish only that package with `npm publish --access public --provenance`.

## One-time npm setup

Add a **Trusted Publisher** in npm for each published package:

### `@yevhen.b/bo-pi`
- Provider: **GitHub Actions**
- Repository: `yevhen/bo-pi`
- Workflow file: `.github/workflows/publish.yml`

### `@yevhen.b/pi-preflight`
- Provider: **GitHub Actions**
- Repository: `yevhen/bo-pi`
- Workflow file: `.github/workflows/publish.yml`

### `@yevhen.b/pi-macos-theme-sync`
- Provider: **GitHub Actions**
- Repository: `yevhen/bo-pi`
- Workflow file: `.github/workflows/publish.yml`

Environment can stay empty unless you want an extra restriction.

## Release steps

### Umbrella package (`@yevhen.b/bo-pi`)
1. Update root `CHANGELOG.md`.
2. Bump root `package.json` version.
3. If needed, update root docs (`README.md`, `RELEASING.md`).
4. Commit release prep.
5. Tag and push:

```bash
git tag -a bo-pi/vX.Y.Z -m "bo-pi vX.Y.Z"
git push origin main bo-pi/vX.Y.Z
```

### Preflight
1. Update `preflight/CHANGELOG.md`.
2. Bump `preflight/package.json` version.
3. If needed, update shared docs (`README.md`, `docs/preflight.md`).
4. Commit release prep.
5. Tag and push:

```bash
git tag -a preflight/vX.Y.Z -m "preflight vX.Y.Z"
git push origin main preflight/vX.Y.Z
```

### macOS Theme Sync
1. Update `macos-theme-sync/CHANGELOG.md`.
2. Bump `macos-theme-sync/package.json` version.
3. If needed, update shared docs (`README.md`, `docs/macos-theme-sync.md`).
4. Commit release prep.
5. Tag and push:

```bash
git tag -a macos-theme-sync/vX.Y.Z -m "macos-theme-sync vX.Y.Z"
git push origin main macos-theme-sync/vX.Y.Z
```

## Manual fallback

Only use this if GitHub Actions publishing is unavailable.

### Umbrella package
```bash
cd /path/to/bo-pi
npm whoami
npm publish --access public
```

### Preflight
```bash
cd /path/to/bo-pi/preflight
npm whoami
npm publish --access public
```

### macOS Theme Sync
```bash
cd /path/to/bo-pi/macos-theme-sync
npm whoami
npm publish --access public
```

If npm asks for 2FA:

```bash
npm publish --access public --otp <code>
```
