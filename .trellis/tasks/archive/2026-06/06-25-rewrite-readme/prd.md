# Rewrite README for forked project

## Goal

Rework the README so it describes this repository as the current project, not the original upstream fork, and make the installation / build path accurate for local source builds.

## Confirmed Facts

- The current `README.md` still describes `npx` and global npm installation for `@agegr/pi-web`.
- The project is built and run from source with `npm install`, `npm run build`, `npm run dev`, and `npm run start`.
- `bin/pi-web.js` exists, but the repository is not meant to be introduced primarily as a directly installable npm package in the README.
- The deployment guide also still mentions the npm package flow and should stay consistent with the README.

## Requirements

- Update the README introduction so it reflects the forked/current project identity.
- Replace the installation section with a source-build workflow.
- Keep the rest of the feature overview accurate and concise.
- Align deployment docs with the new install story so readers do not see conflicting instructions.

## Acceptance Criteria

- [x] README no longer recommends `npx @agegr/pi-web@latest` or `npm install -g @agegr/pi-web` as the primary install path.
- [x] README explains how to clone, install dependencies, build, and run locally from source.
- [x] README still documents the main features and data/configuration notes.
- [x] Deployment docs no longer present npm-package usage as the default path for getting the app running.
- [x] The wording is consistent with the repository now being maintained as its own project.

## Out of Scope

- Changing runtime behavior or build scripts.
- Renaming the package or bin entry.
- Publishing or release-process changes.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
