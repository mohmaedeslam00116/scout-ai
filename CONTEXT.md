# Scout AI — Domain Context

**Scout AI** is a Windows desktop **agent command center for internet
research**: a standalone Electron app that mirrors **Google Antigravity 2.0**
(target ~99% parity in look and workflow) but is research-first instead of
code-first. The agent engine is the **pi harness** — never a hand-rolled loop.

## Antigravity 2.0 parity map

| Antigravity 2.0 concept | Scout AI equivalent |
| --- | --- |
| Standalone command-center app (Win/mac/Linux) | Standalone Electron app, Windows-first |
| Projects (folders + isolated agent settings) | **Project**: a research workspace; per-project security settings (allowed domains, tool permissions) |
| Conversations grouped under a project | **Conversation** threads with rename + history, grouped under Projects |
| Model picker, `+` / `@` / `/` composer actions | Same affordances in the composer |
| Slash commands (e.g. `/browser`) | `/research`, `/sources`, `/audit`, `/video`, `/schedule` (backed by pi-web-access tools) |
| Scheduled tasks (recurring / one-off) | Recurring research tasks per project |
| MCP servers in Settings, enable per project | Same mechanism via pi settings |
| Artifacts: plans, diffs, browser recordings | **Artifacts**: Research Briefs, Source Dossiers, Evidence Tables, Playbooks — artifacts sidebar + review pane + inline feedback before the agent executes |
| Parallel autonomous agents | **Fleet** of pi-subagents children running foreground (streamed) or background |

## The pi stack (source of truth for the engine)

| Package | Role in Scout AI |
| --- | --- |
| `@earendil-works/pi-coding-agent` | Embedded harness: extension host, package loader, session machinery |
| `@earendil-works/pi-agent-core` | Agent runtime we ride on: tool calling + event stream (`agent_start → message_update → tool_execution → agent_end`) piped to the UI |
| `@earendil-works/pi-ai` | Multi-provider LLM API behind the model picker (OpenAI, Anthropic, Google, local) |
| `pi-subagents` | Delegation to focused children: `researcher` (research briefs; needs pi-web-access), `evidence-auditor` (verifies claims vs sources), `scout`, `worker`, `reviewer`, `oracle`; foreground/background runs |
| `pi-web-access` | `web_search` (20+ providers, zero-config Exa fallback chain), `fetch_content` (readable/raw/answer, GitHub clones, YouTube & video understanding, PDFs), `get_search_content` |
| `billion-context` | Incremental hierarchical context compression → marathon research sessions without context-window blowups (compress / decompress / search_context / acp_status) |

## Glossary (Scout-specific terms)

| Term | Definition |
| --- | --- |
| **Research Brief** | The flagship Artifact: a cited answer/plan the agent produces for a Conversation, reviewed in the artifacts pane with inline feedback |
| **Source Dossier** | Per-URL Artifact: fetched content + metadata + credibility notes |
| **Evidence Table** | Extracted quotes mapped to Sources, supporting a Research Brief |
| **Fleet** | The set of running subagent children (foreground streams + background runs) |
| **Playbook** | A saved, reusable research workflow the Fleet can execute |

## Architecture

- `src/main` — Electron main process; `agentHost.ts` embeds the pi harness and
  loads the three pi packages. The UI never imports pi.
- `src/preload` — `contextBridge` exposes `window.scout` (typed IPC only).
- `src/renderer` — Antigravity-style UI (light theme): nav rail, Projects &
  Conversations columns, conversation pane with composer, artifacts sidebar.
- Event flow: pi agent events → `agentHost` → IPC `scout:event` → renderer.

## Open questions

- Which LLM providers ship preconfigured, and how the model picker maps to
  pi-ai's catalog (needs provider keys or local endpoints).
- Windows packaging: electron-builder NSIS installer vs portable exe.
- Where Source Dossier HTML snapshots live on disk (per-project folder?).

(Resolve via `/domain-modeling`; record decisions as ADRs in `docs/adr/`.)
