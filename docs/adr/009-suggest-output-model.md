# ADR-009: Suggest output model — multi-attitude structured output

## Status

Accepted

**Date:** 2026-06-25
**Deciders:** Solo developer

## Context

Suggest must not return a single recommendation. Given the situation, the active PC's
traits/goals, and retrieved history, it should determine which **4 of the 7 attitudes**
(Neutral, Friendly, Hostile, Moral, Selfish, Compassionate, Cynical) the PC is most likely to
adopt and return a **unique in-character action for each**, rendered as four cards. We need an
output mechanism that yields valid, parseable, well-structured results.

## Decision Drivers

* Structured, reliably **parseable** output (4 items, one per attitude)
* Clean rendering as **discrete cards**
* Constrain attitudes to the **taxonomy** (no off-list values)
* Keep reasoning quality high (selecting the right 4 attitudes is the hard part)
* Compatible with `claude-opus-4-8` and adaptive thinking

## Considered Options

### Option 1: Structured outputs (`output_config.format` json_schema) with an `attitude` enum, single `messages.parse()` call
- **Pros:** guaranteed valid JSON matching the schema; trivial to render as cards; attitudes
  constrained to the enum; works alongside adaptive thinking.
- **Cons:** JSON-schema can't enforce array length or uniqueness (`minItems`/`maxItems`/
  `uniqueItems` are unsupported) → enforce count/uniqueness in code; incompatible with citations
  (not needed for Suggest).

### Option 2: Tool use (a `propose_options` tool returning a 4-item array)
- **Pros:** also structured.
- **Cons:** heavier (a tool-use loop) for a single structured response; same array-length caveat;
  less direct than structured outputs.

### Option 3: Freeform prose with four labeled sections, parsed by the app
- **Pros:** no schema.
- **Cons:** brittle parsing; inconsistent formatting; a poor fit for card rendering.

### Option 4: Streaming text
- **Pros:** live "typing" feel.
- **Cons:** the output is four discrete short items rendered as cards — streaming adds
  complexity for little UX benefit; a structured parse is cleaner.

## Decision

Use **structured outputs** (`output_config: { format: { type: 'json_schema', schema } }`) on
**`claude-opus-4-8`** with **adaptive thinking** (`thinking: { type: 'adaptive' }` + `effort`),
via a single non-streaming `client.messages.parse()` call. `attitude` is an `enum` of the
7-attitude taxonomy. **Validate in code** that exactly 4 distinct attitudes are returned, each
with a non-empty action; re-prompt or backfill on a malformed response.

## Rationale

Structured outputs give reliably parseable, card-ready results with attitudes constrained to the
taxonomy — the cleanest fit for the four-card UI. The schema's inability to enforce array length
/ uniqueness is cheaply covered by a code-side check. Citations are irrelevant to Suggest, so
the structured-output/citations incompatibility doesn't matter. Adaptive thinking stays on
because choosing the 4 most-likely attitudes is the reasoning-heavy step.

> Note: `budget_tokens` is **not** used — it returns a 400 on Opus 4.8. Reasoning depth is
> controlled with `output_config.effort` instead.

## Consequences

### Positive
- Deterministic shape; easy card rendering; enum-constrained attitudes; high-quality selection
  via adaptive thinking.

### Negative
- Must validate count/uniqueness in code; no streaming (acceptable for small output); no
  citations (not needed here).

### Risks & Mitigations
- The model returns fewer than 4, duplicates, or an off-list attitude → code re-prompts, or
  trims/backfills; if validation churns, tighten the prompt.

## Related Decisions

- ADR-008 — request/response over the typed IPC layer (Suggest does not stream)

## References

- `../../ARCHITECTURE.md` §6 (Suggest Output Model)
- `../../SPEC.md` Pillar 3 (attitude taxonomy)
- `../../ROADMAP.md` P3-01
