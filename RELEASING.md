# Releasing

This repo publishes a single npm package: `bo-pi`.

## Tag format

Use `bo-pi/vX.Y.Z` (example: `bo-pi/v0.1.0`).

## Steps

1. Update `CHANGELOG.md` (move notes from **Unreleased** into a new version section).
2. Bump the version in `package.json`.
3. Publish to npm:

```bash
npm publish --access public
```

4. Tag and push:

```bash
git tag -a bo-pi/vX.Y.Z -m "bo-pi vX.Y.Z"
git push origin bo-pi/vX.Y.Z
```

5. Create a GitHub release from the tag and paste the changelog notes.
