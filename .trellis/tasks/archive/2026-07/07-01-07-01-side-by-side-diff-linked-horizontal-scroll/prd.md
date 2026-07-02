# Side-by-side diff linked horizontal scroll

## Problem
In side-by-side diff mode, long lines make the modal expose one shared horizontal scroll area across both panes. Users must drag a very long scrollbar to inspect content, and the interaction does not match IDE diff viewers.

## Requirements
- In side-by-side mode, the left and right diff panes should each have their own horizontal scroll container.
- Horizontal scrolling should be synchronized: scrolling either pane horizontally updates the other pane to the same horizontal offset.
- The center divider should remain between the panes instead of both panes behaving like one wide surface.
- Preserve existing vertical scrolling behavior and diff rendering.
- Keep unified mode behavior unchanged.

## Acceptance Criteria
- Long lines in side-by-side diff view show independent horizontal scrollbars for the left and right panes.
- Dragging or wheel/trackpad horizontal scrolling in either pane moves the other pane horizontally in sync.
- No scroll feedback loop or jitter occurs while syncing.
- Existing lint and type-check pass.
