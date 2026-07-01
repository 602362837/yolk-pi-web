# Implementation Plan — Yolk pi web branding

1. Add/inline a compact `yolk pi` logo in the landing header, preserving existing inline-style/CSS variable patterns.
2. Update browser metadata in `app/layout.tsx`.
3. Rename npm package and CLI bin in `package.json`; refresh lockfile metadata with npm install/package-lock update if needed.
4. Update install/run command documentation in README files and deployment docs.
5. Update AGENTS.md/deployment pointers only for published binary/name references; keep `pi-web.json` references unchanged for compatibility.
6. Run `npm run lint` and `node_modules/.bin/tsc --noEmit`.

## Notes

- Do not rename `lib/pi-web-config.ts` or the persisted `~/.pi/agent/pi-web.json` file in this release.
- Do not bulk rewrite archived Trellis task history.
