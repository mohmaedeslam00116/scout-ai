# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

**Scout AI** — a Windows desktop app (Electron) that is an **agent command
center for internet research**, intentionally ~99% equivalent to **Google
Antigravity 2.0** in look and workflow, but research-first instead of
code-first. The agent engine is the **pi harness embedded in the main process**
(`@earendil-works/pi-coding-agent` + `@earendil-works/pi-agent-core` +
`@earendil-works/pi-ai`); we do not reimplement an agent loop.

Required pi packages (loaded by the harness, see `CONTEXT.md`):
`pi-subagents` (researcher / evidence-auditor / reviewer children),
`pi-web-access` (web_search / fetch_content / video understanding),
`billion-context` (long-session context compression).

Core parity concepts (details in `CONTEXT.md`): Projects, Conversations,
Artifacts (sidebar + review pane + inline feedback), model picker, slash
commands, scheduled tasks, MCP servers, per-project security settings.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in this repo via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used with their default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: read `CONTEXT.md` at the repo root and relevant `docs/adr/` entries before exploring. See `docs/agents/domain.md`.

## Codebase notes

- `src/main` runs in Electron's main process (Node); `src/renderer` is the UI
  (no Node access; talks via `window.scout` IPC bridge from `src/preload`).
- Keep all pi usage confined to `src/main/agentHost.ts` so the UI never imports
  pi; the renderer consumes only our own typed event stream.
- Tests run in plain Node (`node --test` on esbuild-bundled test files); keep
  modules testable without Electron imports.
