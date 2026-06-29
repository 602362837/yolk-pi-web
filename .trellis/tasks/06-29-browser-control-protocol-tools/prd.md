# Browser control protocol and tools

## Goal

Define and implement the constrained browser-control protocol and agent-visible tool surface for observing and operating attached Chrome tabs.

## Requirements

- Define extension ↔ bridge message schemas.
- Define stable bridge-side tab IDs.
- Define observation format with URL/title, interactive elements, refs, and optional boxes.
- Implement constrained actions: status, tabs, observe, screenshot, click, type, navigate, evaluate.
- Avoid exposing raw CDP to the model by default.
- Return structured errors and stale-ref hints.

## Acceptance Criteria

- [ ] Agent/tool caller can observe an attached tab.
- [ ] Agent/tool caller can capture a screenshot.
- [ ] Agent/tool caller can click/type/navigate through constrained actions.
- [ ] Element refs are regenerated on observe and invalidated safely when stale.
- [ ] Protocol docs include request/response examples.
