# ADR-0003: Scout data lives under Electron userData with its own pi agentDir

- Status: accepted
- Date: 2026-09-14

## Context

Scout needs on-disk homes for: its pi harness config (auth, models, packages,
web-search), project definitions, and conversation transcripts. pi already
persists sessions under the agentDir keyed by working directory, and stores
auth/models/settings/web-search files in the agentDir. The owner's pi CLI uses
`~/.pi/agent`; sharing it live would couple two apps' configs.

## Decision

Data root = Electron `userData` (`%APPDATA%\scout-ai` on Windows):

```
<dataRoot>/
├── agent/                      ← Scout's pi agentDir (isolation from CLI pi)
│   ├── auth.json               ← first-run snapshot copy from ~/.pi/agent (opt-in)
│   ├── models.json
│   ├── settings.json           ← packages: the three pinned pi packages (ticket #6)
│   └── web-search.json         ← pi-web-access config (Exa zero-config for v1)
├── projects/
│   └── <projectId>/
│       ├── project.json        ← name, folder bindings, per-project security settings
│       └── home/               ← effective cwd when no folder is bound
└── registry.json               ← ordered project list
```

- A **Project** is a named workspace; binding a real folder is optional. The
  project's **effective cwd** = first bound folder, else `projects/<id>/home` —
  this anchors pi's cwd-keyed session storage (conversation transcripts live in
  pi's session store under `agent/sessions/<cwd-slug>/`).
- Auth import is a **one-time copy** on first run ("Reuse my pi login"):
  `auth.json` + `models.json` snapshot; decoupled afterwards.
- Per-project security settings (allowed domains, tool permissions) live in
  `project.json` and map onto session creation options (`tools`, `excludeTools`,
  pi-web-access routing) at harness-wiring time.

## Consequences

- Clean uninstall (delete userData); no clash with the user's CLI pi.
- Conversation persistence rides pi's SessionManager — Scout stores only
  display metadata (titles/order) alongside `project.json`.
- The layout is encoded in `src/main/paths.ts` (tested) so all main-process code
  resolves paths through one module.
