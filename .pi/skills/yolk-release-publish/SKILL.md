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
- Keep release/work commits focused on durable release files only.
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
5. Commit only durable release files. Include release documentation when it changed:
   ```bash
   git add package.json package-lock.json docs/deployment/README.md .pi/skills/yolk-release-publish/SKILL.md
   git commit -m "chore: release <version>"
   ```
6. Push and tag the release commit with an **annotated** tag that describes the changes:
   ```bash
   git push origin main
   git tag -a v<version> <release-commit> -m "$(cat <<'EOF'
   release v<version>: <short summary of this release>

   - <change 1>
   - <change 2>
   - <change 3>
   EOF
   )"
   git push origin v<version>
   ```
   - Do **not** create lightweight tags (`git tag v<version>` without `-a`/`-m`).
   - The tag message must explain **what changed** in this release, not only the version number.
   - Prefer a one-line subject plus bullet points for notable fixes/features.
7. Publish and verify:
   ```bash
   npm publish --access public
   npm view @alan-zhao/yolk-pi-web version --prefer-online
   ```
## Version Bump Notes

- Prefer a manual version edit when the working tree is dirty; `npm version` expects a clean worktree and can accidentally mix unrelated bookkeeping.
- Keep `package.json` and `package-lock.json` in sync.
- Use annotated tag format `v<version>` such as `v0.7.4`.
- Tag messages are required and must describe the release content, for example:
  ```text
  release v0.7.4: fix session list memory and studio session ownership

  - bound JSONL metadata scanner to reduce session-list memory
  - exclusive transfer for YPI Studio task session ownership
  - fix sidebar layout SSR hydration mismatch
  ```
- Derive the tag body from the actual release commit range / changelog of this version; do not invent unrelated notes.
- Reject or rewrite tags that only contain the bare version (e.g. message is just `v0.7.4` or empty).

## Stop Conditions

Stop and report the blocker without publishing when:

- Any validation command fails.
- `npm view @alan-zhao/yolk-pi-web version --prefer-online` already returns the intended version.
- `git push origin main` or `git push origin v<version>` fails.
- The working tree includes unrelated dirty files that would be swept into the release commit.
- The release tag would be lightweight, or its message is empty / only the bare version with no change description.
