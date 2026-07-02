# UI Design Spec: YPI Studio Session Widget

This document defines the UI/UX design specifications for the YPI Studio Session Widget (`YpiStudioSessionWidget.tsx`). It details the visual layout, information hierarchy, status transitions via visual pipelines, interactive models, and technical design notes for developers.

---

## 1. Design Goals

- **Immediate Visibility**: Allow users to monitor YPI Studio task stages, required artifacts, ownership, and background subagent runs within an active chat session without keeping the sidebar or the right panel drawer open.
- **Visual Flow**: Express the progressive workflow states using a cohesive pipeline style (e.g., done vs. active vs. pending nodes connected by fluid status lines), using pulsing states and gradient lines to signify active processes.
- **Subagent Transparency**: Provide real-time previews of active `ypi_studio_subagent` runs, displaying the selected member, current state, active model/thinking mode, and latest transcript previews.
- **Non-Intrusive Layout**: Seamlessly coexist with other floating widgets like the `TrellisSessionWidget` and `SessionChangesFloatingPanel`, offering drag-and-drop customization with sticky positions.
- **Device Adaptability**: Support rich detailed states on desktop monitors and collapse into a clean, tap-to-expand sheet layout on mobile screens.

---

## 2. Information Hierarchy

The widget displays information in three distinct logical layers:

```
┌────────────────────────────────────────────────────────┐
│ [工] YPI Studio · <Workflow> · <Progress>%       [X]  │ ◄── Header & State Meta
│ "Task Title: Add YPI Studio Floating Card..."          │
├────────────────────────────────────────────────────────┤
│ (Done) ──(Active)──[Pending]──[Pending]                │ ◄── Workflow Step Pipeline
│ Intake   Planning  Implement  Check                    │
├────────────────────────────────────────────────────────┤
│ 👤 Owner: ui-designer  |  📄 Artifacts: 1/4 completed  │ ◄── State Details
├────────────────────────────────────────────────────────┤
│ Active Subagents:                                      │ ◄── Subagents Runs Stream
│ 🟢 ui-designer (gemini-3.5-flash-low) [Thinking...]     │
│   💬 "Writing ui.md specifications..."                 │
│ 🔘 architect (succeeded) 10m ago                       │
└────────────────────────────────────────────────────────┘
```

### 2.1 Header Section
- **Studio Symbol**: The character `工` is used as the badge for YPI Studio, mirroring the right panel toggle strip and distinguishing it from Trellis's `T`.
- **Workflow & Progress**: Shows the workflow name and progress percentage (e.g., `功能开发 · 35%`).
- **Dismiss Button**: An close/dismiss button `[x]` that hides the widget for the remainder of the session (resets when reloading/switching sessions).
- **Task Title**: Single-line text with ellipsis overflow showing the active Studio task name.

### 2.2 Workflow Step Pipeline (Visual Flow Lines)
- **Workflow State Nodes**: Left-to-right horizontal pipeline (scrollable if exceeding width on desktop, stacked on mobile).
- **Node Statuses**:
  - `done`: Completed stages, green fill, checkmark icon, solid connection line.
  - `active`: Current stage, accent-color fill, pulsing ring, moving gradient connection line.
  - `pending`: Upcoming stages, muted background, dotted connection line.
- **Pipeline Metric Overlay**: Progress and required/optional artifacts completion status.

### 2.3 Subagents Stream (Waterfall Runs)
- **Active Member Badge**: Avatar label, color-coded per member config (e.g., `architect` is orange, `ui-designer` is light blue, `implementer` is green, `checker` is purple).
- **Run Status Indicator**:
  - `running`: Pulsing green ring, model name, and a "Thinking..." indicator.
  - `succeeded`: Solid green check.
  - `failed`: Solid red error cross.
  - `cancelled`: Muted gray line.
- **Live Preview Segment**: The last 1-2 lines of message or tool execution preview extracted from the run's transcript sidecar.

---

## 3. Desktop UI/UX Specification

### 3.1 Default Layout & Positioning
- **Default Position**: Placed in the upper-right corner of the chat viewport (`ChatWindow`), offset by `top: 18px` and `right: 18px` from the viewport edges.
- **Dimensions**:
  - Width: `320px` (fixed).
  - Max Height: `380px` (scrolling enabled inside sections if contents exceed bounds).
- **Layer Stacking (`z-index`)**: Stacks at `z-index: 250` (higher than messages, lower than modals/global alerts).
- **Persisted Positioning**: Custom layout positions are recorded in `localStorage` key `pi-web:ypi-studio-session-widget-position` using coordinate values `{ left, top }` relative to the chat window container.

### 3.2 Hover and Drag States
- **Hover Feedbacks**:
  - Hovering over the header switches the cursor to `move` (drag handle indicator).
  - Background opacity transitions from `0.85` (standard panel translucency) to `0.98` for focus.
- **Drag Interaction**:
  - Pointer events are tracked with a dragging threshold of `4px` to avoid accidental clicks.
  - While dragging, the opacity decreases to `0.7` and borders highlight with `var(--accent)`.
  - Position clamping keeps the widget bounded inside the parent container with `18px` margins.

### 3.3 Visual Flow Line Animations (CSS/SVG)
- **Line Renderer**: An inline SVG path renders connection segments dynamically between stage nodes.
- **Active Transition Effect**: Active paths employ `stroke-dasharray` and a sliding keyframe animation to simulate linear flowing energy:
  ```css
  @keyframes flow-dash {
    to {
      stroke-dashoffset: -20;
    }
  }
  .active-flow-path {
    stroke-dasharray: 6, 4;
    animation: flow-dash 1.2s linear infinite;
  }
  ```
- **Reduced Motion Support**:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .active-flow-path {
      animation: none;
      stroke-dasharray: none;
    }
    .pulsing-indicator {
      animation: none;
    }
  }
  ```

---

## 4. Mobile Adaptive UI Specification

For screens narrower than `640px` (sm breakpoint), the widget collapses into a compact pill layout to save screen real estate.

```
┌──────────────────────────────────────┐
│ [工] Studio 35% · architect running  │  ◄── Compact Pill Mode (Pinned Bottom Center)
└──────────────────────────────────────┘
```

### 4.1 Compact Pill Layout
- **Position**: Center-pinned at the bottom of the viewport, `bottom: 12px`, above the input field.
- **Style**: Minimal border pill, height `32px`, padding `0 12px`, with a background of `var(--bg-panel)` and full backdrop blur (`backdrop-filter: blur(8px)`).
- **Interactions**:
  - Tapping the pill triggers a slide-up bottom sheet overlay.

### 4.2 Mobile Bottom Sheet
- **Transitions**: Slides up from the bottom edge (`bottom: 0`, full width, rounded top corners `border-top-left-radius: 16px`).
- **Contents**: Renders the complete vertical progress tree, including artifacts status list, owner details, and recent subagent run histories.
- **Handoff Action**: Includes an "Open Studio Tab" button that closes the modal sheet, opens the right Studio drawer, and switches the AppShell layout.

---

## 5. Interaction States & Transitions

| State / Event | UI Representation | Action Triggered | Transition Effect |
| :--- | :--- | :--- | :--- |
| **Default / Idle** | Semi-transparent pane (85% opacity), static workflow nodes, list of previous subagent run cards. | User hovers. | Opacity increases to 98% (`transition: opacity 0.15s`). |
| **Subagent Running** | Active stage shows pulsing border; active subagent card shows pulsing dot and moving dash line. | SSE tool progress message arrives. | Live text updates in-place with fluid scrolling behavior. |
| **Dragging** | Panel gets outline glow, opacity drops to 70%, cursor changes to `grabbing`. | Pointer down + drag past `4px`. | Translucent follow animation. |
| **Clashing / Ambiguous**| Card hidden. API returns `ambiguous`. | Multiple Studio tasks bound to session. | Console warnings written, no widget mounted. |
| **Toggle Right Panel** | Widget detects Studio panel focused on the same task. | Right Drawer Studio tab opens. | Widget fades out or collapses to avoid redundancy. |
| **Widget Dismissed** | Widget disappears for current session context. | User clicks close `[x]`. | Fade out transition (`transition: all 0.2s`). |

---

## 6. Coexistence Matrix

To prevent visual collisions with other floating panels in yolk pi web, the viewport space is managed dynamically:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                                  ┌────────────────────┐  │
│                                  │ YpiStudioWidget    │  │
│                                  │ (Top Right)        │  │
│                                  └────────────────────┘  │
│                                                          │
│                                                          │
│                                                          │
│  ┌────────────────────┐                                  │
│  │ TrellisWidget      │                                  │
│  │ (Center Left)      │                                  │
│  └────────────────────┘                                  │
│                                  ┌────────────────────┐  │
│                                  │ ChangesFloating    │  │
│                                  │ (Bottom Right)     │  │
│                                  └────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

1. **Default Positions Strategy**:
   - `YpiStudioSessionWidget`: Upper Right corner (`top: 18px`, `right: 18px`).
   - `TrellisSessionWidget`: Middle Left corner (`top: 40%`, `left: 18px`).
   - `SessionChangesFloatingPanel`: Bottom Right corner (`bottom: 92px`, `right: 18px`).
2. **Dragging Bounds Constraint**:
   - Each widget calculates its parent container bounds independently but respects storage namespaces.
   - If coordinates overlap within a threshold of `32px`, the active dragged widget is snapped to layout alignment guidelines.
3. **Visibility Interlock**:
   - If the active YPI Studio drawer pane is open AND focused on the same task ID as the session, the floating widget is automatically hidden or collapsed to prevent layout duplication.

---

## 7. CSS Theme Specifications

Rely on the core theme variables mapped from `globals.css`. Do not hardcode HEX values.

```css
/* Color Palette Variables */
.ypi-widget-container {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font-mono);
}

.ypi-widget-text-muted {
  color: var(--text-muted);
}

.ypi-widget-text-dim {
  color: var(--text-dim);
}

/* Status Mappings */
.ypi-state-done {
  color: #22c55e; /* Green */
  background: rgba(34, 197, 94, 0.1);
}

.ypi-state-active {
  color: var(--accent); /* Accent Color */
  background: rgba(37, 99, 235, 0.1);
}

.ypi-state-pending {
  color: var(--text-dim);
  background: var(--bg-subtle);
}

.ypi-state-failed {
  color: #ef4444; /* Red */
  background: rgba(239, 68, 68, 0.1);
}
```

---

## 8. Implementation Notes & Checklist

- [ ] **State Sync**: Consume SSE updates from `ChatWindow`'s tool execution progress, updating the subagent preview string in real-time.
- [ ] **Storage Key**: Position should be stored in `localStorage` key `pi-web:ypi-studio-session-widget-position` (desktop) and `pi-web:ypi-studio-session-widget-mobile-position` (mobile compact tracker).
- [ ] **Accessibility**: Render interactive nodes as `role="button"` or `tabIndex={0}` for clean screen reader readouts and keyboard navigation.
- [ ] **Reduced Animations**: Disable SVG gradients flow and pulsing keyframes on `prefers-reduced-motion: reduce`.
- [ ] **Lightweight Fetch**: Ensure the `/api/sessions/[id]/studio-task` endpoint retrieves only metadata, bypassing bulky task artifacts or text bodies.
