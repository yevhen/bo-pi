# Releasing

This repo publishes a single npm package: `@yevhen.b/bo-pi`.

## Tag format

Use `bo-pi/vX.Y.Z` (example: `bo-pi/v0.1.0`).

## Steps

1. Update `CHANGELOG.md` (move notes from **Unreleased** into a new version section).
2. Bump the version in `package.json`.
3. Verify npm auth (do this without prompting):

```bash
npm whoami
```

If it fails, login and retry:

```bash
npm login
npm whoami
```

4. Publish to npm:

```bash
npm publish --access public
```

If 2FA is required for publish:

```bash
npm publish --access public --otp <code>
```

5. Tag and push:

```bash
git tag -a bo-pi/vX.Y.Z -m "bo-pi vX.Y.Z"
git push origin bo-pi/vX.Y.Z
```

6. Create a GitHub release from the tag and paste the changelog notes.
