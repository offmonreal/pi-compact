## Output Format — This Replaces Any Format Described Above

Use exactly these sections, in this order, and no others.

### Goal

The active goal and task being worked on.

### Constraints

Explicit user prohibitions, agreed rules, and hard requirements.

### Decisions

One line each: `<subject> — <decision>`. Mark the state when history says so:
`[proposed]`, `[agreed]`, `[revoked]`, `[superseded by <what>]`.

### Progress

`Done:` completed commands, edits, and results.
`In progress:` what is being worked on now.
`Blocked:` what cannot proceed and why.

### Failures

Failed attempts and why they failed. This prevents repeating them.

### Next Steps

Ordered list of what should happen next.

### Artifacts

Files, documents, tasks, endpoints, and other identifiers touched, each with its role.

### Access

Infrastructure access that already appears in history: hosts, ports, URLs, base paths, logins,
tokens, key and config file paths. Copy exactly; do not mask or invent.

### Critical Context

Anything needed to continue that fits nowhere above, including reasoning that changes future work.
Keep it short.

Rules for every section: one fact per line, no prose paragraphs, exact identifiers verbatim.
An empty section is written as `- none` and never omitted.
