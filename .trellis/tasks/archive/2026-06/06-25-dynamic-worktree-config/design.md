# Dynamic worktree configuration page — Design

## Architecture Overview

Add a small pi-web config API plus a client settings modal. The config API owns reading, validating, merging, and writing `~/.pi/agent/pi-web.json`. The modal edits the `worktree` section. The existing worktree creation API remains unchanged except that it will naturally pick up new values because it already calls `readPiWebConfig()` on every request.

```
AppShell
  └─ Settings / WorkTree Config button
      └─ WorktreeConfig modal
          ├─ GET /api/web-config
          │    └─ lib/pi-web-config.ts readPiWebConfigForApi()
          └─ PUT /api/web-config
               └─ lib/pi-web-config.ts validate + merge + write

POST /api/git/worktrees
  └─ readPiWebConfig()  // already per request; no cache invalidation needed
```

## API Contract

Route:

```text
GET /api/web-config
PUT /api/web-config
```

GET response:

```ts
{
  config: PiWebConfig;        // effective normalized config
  defaults: PiWebConfig;      // built-in defaults for reset UI
  path: string;               // ~/.pi/agent/pi-web.json resolved path
  exists: boolean;            // whether the file exists
  parseError?: string;        // optional, if raw file was malformed and defaults were used
}
```

PUT request:

```ts
{
  worktree: {
    baseRef: string;
    branchNameTemplate: string;
    baseDirTemplate: string;
    pathTemplate: string;
    sessionDisplay: "separate" | "tag";
  }
}
```

PUT response:

```ts
{
  success: true;
  config: PiWebConfig;
  defaults: PiWebConfig;
  path: string;
  exists: true;
}
```

Errors:

```ts
{ error: string }
```

Use 400 for validation errors and 500 for unexpected file-system errors.

## Config Persistence Contract

`lib/pi-web-config.ts` should become the single owner of web config behavior:

- `DEFAULT_PI_WEB_CONFIG` remains the default source.
- `getPiWebConfigPath()` remains the path source.
- `readPiWebConfig()` remains the safe effective-config helper used by runtime consumers.
- Add a stricter read helper for the API that can report `exists` and parse errors.
- Add a write helper that:
  - loads the raw object if valid;
  - preserves unknown top-level keys and unknown future `worktree` keys where reasonable;
  - replaces/normalizes known worktree keys;
  - creates the config directory if missing;
  - writes pretty JSON.

Malformed existing files are risky for preservation. The recommended behavior is: GET reports parse error and returns defaults; PUT overwrites with valid JSON containing requested settings, because merging invalid JSON is impossible.

## Validation Rules

Minimum validation on write:

- `baseRef`, `branchNameTemplate`, `baseDirTemplate`, and `pathTemplate` must be non-empty strings after trim.
- `sessionDisplay` must be `"separate"` or `"tag"`.
- Unknown template variables are allowed because the runtime template expander leaves unmatched placeholders unchanged today; the UI should document supported variables rather than reject experimentation.
- Git-level validity (for example whether `baseRef` exists or branch template expands to a valid branch) remains checked by `POST /api/git/worktrees`, because it depends on the selected repository and timestamp.

## UI Design

Recommended MVP surface: a generic `Settings` modal with a `WorkTree` section/tab. This avoids adding one-off bottom buttons for every future pi-web config section while still only implementing WorkTree fields now.

Fields:

- Base ref
- Branch name template
- Base directory template
- Worktree path template
- Session display mode (`separate` / `tag` select)

Supporting UI:

- config file path display;
- supported variable help text;
- Save button;
- Reset to defaults button;
- dirty-state indication;
- loading, saving, success, and error states.

Placement options:

1. Preferred: replace or augment bottom settings strip with a `Settings` button and expose WorkTree inside it.
2. Lower-impact alternative: add a `WorkTree` button next to `Models`, `Usage`, `Skills` that opens a dedicated modal.

## Dynamic Behavior

No server restart or client-side cache invalidation is required for worktree creation because `app/api/git/worktrees/route.ts` currently does:

```ts
const config = readPiWebConfig();
```

inside the POST handler. After saving the JSON file, the next POST reads the new values.

## Compatibility

- No changes to existing session file format.
- No changes to `POST /api/git/worktrees` request/response shape required.
- No changes to `models.json` or `models-config` route.
- Absence of `pi-web.json` keeps defaults.
- Malformed `pi-web.json` currently silently falls back; after this task, the UI can make that visible through the config API while runtime creation remains safe.

## Trade-offs

- A generic Settings modal is slightly more structure now, but avoids UI sprawl and gives future web config a home.
- A dedicated WorkTree modal is faster and smaller, but likely creates another migration when more pi-web settings are added.
- Template preview is useful but requires a selected cwd/repo context and Git discovery; keep it out of MVP unless requested.
