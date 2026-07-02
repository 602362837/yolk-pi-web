---
name: yolk-release-publish
description: Release and publish @alan-zhao/yolk-pi-web / ypi. Use when asked to prepare a release, bump version, update package metadata, create or push a git tag, push main, run npm publish, or verify the npm package.
---

# Yolk Pi Web Release Publish

Use this skill for project releases of `@alan-zhao/yolk-pi-web` (`ypi`). Follow the repository contract in `AGENTS.md` and the release commands in `docs/deployment/README.md`.

## Safety Rules

- Never commit npm tokens, `.npmrc` secrets, OAuth credentials, or local auth config.
- Never push to `upstream`; release pushes go to `origin` only unless the user explicitly changes the plan.
- Do not publish before validation passes.
- Do not run `next build` directly; use `npm run build`.
- Keep release/work commits separate from Trellis archive and journal commits. Archive/journal commits happen after the release commit.
- Stop if the target npm version already exists in the registry.

## Standard Release Flow

1. Confirm the intended semantic-version bump from `package.json`.
2. Inspect the current state:
   ```bash
   git status --short
   git branch --show-current
   git tag --list 'v*' --sort=-v:refname | head -20
   npm view @alan-zhao/yolk-pi-web version --prefer-online
   npm whoami
   ```
3. Update version fields in both files:
   - `package.json`
   - `package-lock.json` root `version` and `packages[""].version`
4. Run release validation before any publish:
   ```bash
   npm whoami
   npm run lint
   node_modules/.bin/tsc --noEmit
   npm run build
   npm pack --dry-run
   ```
5. Commit only durable release files, not Trellis task files. Include release documentation when it changed:
   ```bash
   git add package.json package-lock.json docs/deployment/README.md .pi/skills/yolk-release-publish/SKILL.md
   git commit -m "chore: release <version>"
   ```
6. Push and tag the release commit:
   ```bash
   git push origin main
   git tag v<version> <release-commit>
   git push origin v<version>
   ```
7. Publish and verify:
   ```bash
   npm publish --access public
   npm view @alan-zhao/yolk-pi-web version --prefer-online
   ```
8. After the release is verified, finish Trellis work so archive and journal commits land after the release commit.

## Version Bump Notes

- Prefer a manual version edit when Trellis task files are dirty; `npm version` expects a clean worktree and can accidentally mix release and workflow bookkeeping.
- Keep `package.json` and `package-lock.json` in sync.
- Use tag format `v<version>` such as `v0.7.4`.

## Stop Conditions

Stop and report the blocker without publishing when:

- Any validation command fails.
- `npm view @alan-zhao/yolk-pi-web version --prefer-online` already returns the intended version.
- `git push origin main` or `git push origin v<version>` fails.
- The working tree includes unrelated dirty files that would be swept into the release commit.
