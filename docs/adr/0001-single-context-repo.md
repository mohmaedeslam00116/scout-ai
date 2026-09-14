# ADR-0001: Scout AI is a single-context repo

- Status: accepted
- Date: 2026-09-14

## Context

Scout AI starts as one pipeline (plan → search → extract → synthesize) with no
separable bounded contexts. There are no monorepo signals (no workspaces, no
`packages/*`).

## Decision

Keep a single `CONTEXT.md` and a shared `docs/adr/` at the repo root.

## Consequences

If distinct contexts later emerge (e.g. a serving API separate from the research
engine), split via a root `CONTEXT-MAP.md` with per-context docs, and record that
in a superseding ADR.
