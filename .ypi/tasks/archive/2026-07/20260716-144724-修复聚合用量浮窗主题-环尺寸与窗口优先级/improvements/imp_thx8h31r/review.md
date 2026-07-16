# Review：IMP-001

## Verdict
Pass — standalone GPT/Grok/Kiro triggers now open on keyboard focus or pointer hover instead of click-primary. Aggregate mode remains unchanged.

## Verification
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run lint -- --quiet` — pass
- Trigger props retain `aria-expanded`, `aria-controls`, focus-visible and provider detail actions.

## Scope
Changed standalone trigger open behavior only; refresh, account, Models and aggregate panel behavior remain unchanged.