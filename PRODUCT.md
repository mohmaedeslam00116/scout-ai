# PRODUCT.md — Scout AI

## What this is

**Scout AI** is a Windows desktop app (Electron): an agent command center for
internet research, held to ~99% workflow parity with Google Antigravity 2.0,
but research-first instead of code-first. The agent engine is the pi harness
embedded in the main process; the renderer is the operator console.

## Register

**Product.** Design serves the research work: reading streams, judging
evidence, reviewing artifacts. The interface is the instrument panel, not the
showpiece. Calm, dense where density helps, quiet everywhere else.

## Who uses it

- **The researcher (primary):** poses questions, watches the agent work,
  reads answers with sources attached. Long sessions, mostly keyboard.
- **The fleet overseer:** delegates to researcher / evidence-auditor /
  reviewer children, steers or stops them mid-run from the Fleet view.
- **The reviewer:** pauses at the Research Brief, leaves inline feedback,
  approves revisions before the run continues.

## Surfaces

1. **Nav rail** (left): identity, new conversation, section switching.
2. **Conversations pane**: session list with search.
3. **Chat pane** (stage): thread, agent activity strip, composer with
   `/` commands, `@` sources, `+` context, model picker.
4. **Artifacts pane** (right): Research Briefs, Source Dossiers, Evidence
   Tables; versioned review cards with inline feedback.
5. **Fleet view**: subagent run cards with live transcripts, steer, stop.

## Experience principles

1. **Evidence is visible.** Every claim can be traced to sources; activity
   shows the agent's actual tool work, not progress theater.
2. **Review-first.** The app's signature loop is pause → feedback → revised
   version → approve. Make that loop the most comfortable thing in the UI.
3. **Calm density.** Long reading sessions: hairline structure, no shadows,
   no decoration. Motion only where it explains state.
4. **Keyboard-first composer.** Enter sends, Shift+Enter breaks, `/` and `@`
   are first-class, focus rings are unmistakable.

## Voice

Direct and task-oriented. Name the research action, not the AI. No marketing
adjectives in UI copy. Buttons say what they do ("Send feedback", not "OK").
