# Yolk pi web branding and npm package rename

## Goal

Prepare the fork for its first branded release by replacing user-facing Pi Agent Web branding with `yolk pi web`, publishing the npm package as `yolk-pi-web`, and exposing the CLI command as `ypi`.

## Requirements

1. The empty chat landing header uses a compact project-style logo derived from the provided bitten egg-yolk-on-π artwork.
2. User-facing product name in browser metadata and primary UI branding is `yolk pi web`.
3. npm package name is `yolk-pi-web`.
4. npm CLI command is `ypi`.
5. Documentation and deployment references for install/run commands are updated where they describe package usage.
6. Keep internal config compatibility, especially `~/.pi/agent/pi-web.json`, unless a separate migration is designed.
7. Avoid changing unrelated pi SDK/package names or historical Trellis archive text.

## Acceptance Criteria

- [ ] Landing page no longer shows `Pi Agent Web` and instead shows `yolk pi web`.
- [ ] Browser metadata title/description use the new product name.
- [ ] `package.json` and `package-lock.json` use package `yolk-pi-web` and bin `ypi`.
- [ ] README quick-start examples use `npx yolk-pi-web@latest` and `ypi`.
- [ ] The logo is implemented locally without external image dependencies and follows the existing theme/CSS variable style.
- [ ] Validation passes: `npm run lint` and `node_modules/.bin/tsc --noEmit`.
