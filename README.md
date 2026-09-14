# Scout AI

An **Antigravity-style agent command center for internet research** — a Windows
desktop app (Electron) with ~99% look-and-workflow parity with Google
Antigravity 2.0, but research-first instead of code-first.

Powered by the **pi harness**:

| Package | Role |
| --- | --- |
| `@earendil-works/pi-coding-agent` | Embedded harness (extension host, sessions) |
| `@earendil-works/pi-agent-core` | Agent runtime (tool calling, event stream) |
| `@earendil-works/pi-ai` | Multi-provider LLM API (model picker) |
| [`pi-subagents`](https://pi.dev/packages/pi-subagents) | Fleet of focused children: `researcher`, `evidence-auditor`, `reviewer`, `oracle`, … |
| [`pi-web-access`](https://pi.dev/packages/pi-web-access) | `web_search`, `fetch_content`, GitHub cloning, YouTube/video understanding |
| [`billion-context`](https://pi.dev/packages/billion-context) | Incremental context compression for marathon sessions |

## Status

Scaffold milestone: Electron shell (Antigravity-like four-pane layout: nav rail,
conversations, chat with composer + model picker, artifacts sidebar), an
`AgentHost` seam in the main process that will embed pi, and tests. The pi
harness embedding, the three packages, Projects/Artifacts/Fleet/Schedules and
per-project security are the next milestones.

## Development

```bash
npm install
npm run build      # esbuild → dist/
npm start          # build + launch the Electron app
npm run typecheck
npm test
```

## Layout

```
src/main/       Electron main process (agentHost.ts is the only pi seam)
src/preload/    contextBridge → window.scout
src/renderer/   Antigravity-style UI
docs/agents/    AI-agent working agreements (issue tracker, triage, domain docs)
docs/adr/       Architecture decisions
CONTEXT.md      Domain glossary + Antigravity parity map
```

## License

Private / all rights reserved for now.
