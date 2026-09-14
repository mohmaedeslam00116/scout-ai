# ADR-0002: Embed the pi harness as the agent engine

- Status: accepted
- Date: 2026-09-14

## Context

Scout AI needs an agent engine for a desktop research app. The product requires
three pi extension packages — `pi-subagents`, `pi-web-access`, and
`billion-context` — which are written against the pi coding-agent's extension
API (`ExtensionAPI`, package loader, session lifecycle). They cannot run on a
bare `pi-agent-core` loop.

## Decision

Embed the **pi harness** (`@earendil-works/pi-coding-agent`) in the Electron
main process, with `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`
underneath it, and load the three packages via pi's package mechanism. All pi
usage is confined to `src/main/agentHost.ts`; the renderer sees only our typed
IPC events.

## Consequences

- Antigravity-style features (Fleet of subagents, web research tools, marathon
  sessions) come from the packages rather than custom code.
- Updates to pi's extension API may require coordination; pin versions.
- The UI never imports pi, keeping a stable contract at the IPC boundary.
