# DESIGN.md — Scout AI design contract

Derived from the attached **Cursor Reference Design System** (reference
inspiration, not an app spec) plus the two **explicit user selections** that
override everything else in it.

## Explicit selections (highest priority)

1. **Primary color: `#000000`.** Black is the brand anchor and the canvas.
2. **Dark mode required.** Exact dark values were unspecified, so they are
   defined below in OKLCH and are Scout's own.

## Color system (OKLCH, dark only in v1)

Strategy: **drenched**. The surface is the color; black carries the app.

| Token | Value | Role |
|---|---|---|
| `--color-canvas` | `#000000` | App background, stage (chat, fleet) |
| `--color-surface` | `oklch(16% 0.006 60)` | Side panes (conversations, artifacts) |
| `--color-surface-2` | `oklch(20% 0.007 60)` | Cards, bubbles, wells |
| `--color-surface-3` | `oklch(25% 0.008 60)` | Hover / active fills |
| `--color-ink` | `oklch(96% 0.005 85)` | Primary text (warm white) |
| `--color-ink-mid` | `oklch(80% 0.008 70)` | Secondary text |
| `--color-ink-dim` | `oklch(66% 0.008 70)` | Muted text, placeholders (≥4.5:1) |
| `--color-line` | `white / 8%` | Hairline borders |
| `--color-line-strong` | `white / 14%` | Emphasized borders |
| `--color-accent` | `oklch(66% 0.21 42)` | Scout orange (from the reference's `#f54e00`): live states, review badges, links, focus |
| `--color-accent-bright` | `oklch(76% 0.17 45)` | Accent as small text / icons on dark fills |
| `--color-accent-soft` | `oklch(27% 0.07 45)` | Accent-tinted fills (badges, soft wells) |
| `--color-danger` / `-soft` | `oklch(68% 0.19 25)` / `oklch(27% 0.07 25)` | Errors, stop |
| `--color-success` / `-soft` | `oklch(75% 0.14 150)` / `oklch(28% 0.05 150)` | Done, approved, verified |

Rules:

- Neutrals are tinted a hair toward the accent hue (60°), chroma ≤ 0.008:
  warm charcoal, never gray-brown, never blue-slate.
- Orange is a **bounded** accent: live/running, review-needed, focus, links.
  It is not the fill color of primary buttons.
- **Primary actions invert** (the reference's filled action, dark-mode
  mapped): warm-white fill, black text. One per view, at most.
- Depth is tonal only. No drop shadows in dark mode.

## Typography

- **Sans:** `"Segoe UI Variable Text", "Segoe UI", system-ui` (native Windows;
  CursorGothic is unlicensed and must not be bundled).
- **Mono:** `"Cascadia Mono", "Cascadia Code", Consolas, ui-monospace` for
  transcripts, artifact bodies, activity log.
- Scale: 11px labels/badges · 12px meta · 13px lists/UI · 14px body (base) ·
  16px pane titles. Weight contrast (450/600) instead of size sprawl.
- Uppercase only on pane headers (≤2 words) and badge text. Never body copy.
- `text-wrap: balance` on headings; `pretty` on prose.

## Geometry

- **Full-pill radius** for actions and badges (the reference's signature).
- **8px radius** for cards and wells; **16px** for the composer shell.
- 1px hairline borders (`--color-line`) for structure. No 1px-border +
  big-shadow pair (banned); no side-stripe accent borders (banned).
- Panes: nav rail 208px · conversations 256px · artifacts 288px · chat flexes.

## Motion

- Curve `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint), 120–240ms.
- Messages: 160ms fade-rise on entry. Live runs: 2s soft opacity pulse.
- Streaming caret: 1s blink. Color/hover transitions: 150ms.
- **`prefers-reduced-motion: reduce`** disables all animation and
  transitions. Non-negotiable.

## Accessibility floor

- Body text ≥ 4.5:1, large text ≥ 3:1 (verified for every token pair used).
- `:focus-visible` = 2px orange outline, 2px offset, everywhere.
- `color-scheme: dark` on `:root` and a `<meta>` tag so native controls
  (selects, scrollbars) render dark.
- Hit targets ≥ 28px; icon buttons carry `title` and `aria-label`.

## Z-scale (semantic)

`dropdown 100 → sticky 200 → modal-backdrop 300 → modal 400 → toast 500 →
tooltip 600`. No arbitrary 999 values.

## Copy rules

- Verb + object buttons ("Send feedback", "New conversation").
- No em dashes in UI copy; use commas, colons, or periods.
- No marketing adjectives. Name the research action.
