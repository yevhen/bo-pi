# Releasing

This repo publishes a single npm package: `@yevhen.b/bo-pi`.

## Tag format

Use `bo-pi/vX.Y.Z` (example: `bo-pi/v0.1.0`).

## Automated publish (GitHub Actions + npm OIDC)

Publishing is automated by `.github/workflows/publish.yml`.

When a tag matching `bo-pi/v*` is pushed, the workflow will:
1. validate that the tag version matches `package.json` version,
2. run `npm ci` and `npm test`,
3. publish with `npm publish --access public --provenance`.

### One-time npm setup

In npm package settings for `@yevhen.b/bo-pi`, add a **Trusted Publisher**:
- Provider: **GitHub Actions**
- Repository: `yevhen/bo-pi`
- Workflow file: `.github/workflows/publish.yml`
- Environment: leave empty unless you explicitly want to restrict it

After this is set, no `NPM_TOKEN` is needed in GitHub secrets.

## Release steps

1. Update `CHANGELOG.md` (move notes from **Unreleased** into a new version section).
2. Bump the version in `package.json`.
3. Commit release prep changes.
4. Tag and push:

```bash
git tag -a bo-pi/vX.Y.Z -m "bo-pi vX.Y.Z"
git push origin main bo-pi/vX.Y.Z
```

5. Watch the `Publish to npm` workflow in GitHub Actions and confirm it succeeds.
6. Create a GitHub release from the tag and paste the changelog notes.

## Manual fallback (only if automation is unavailable)

```bash
npm whoami
npm publish --access public
```

If 2FA is required:

```bash
npm publish --access public --otp <code>
```
