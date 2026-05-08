# Multi-Meaning Word System Implementation Plan

> For agentic workers: execute task by task and keep commits scoped to each task.

## Goal

Implement multi-meaning vocabulary learning with:
- WordNet-based sense discovery
- LLM rerank + dedup decisions
- Secondary-meaning unlock flow integrated into spaced repetition
- UI updates for meaning progress and POS cues

## Scope

In scope:
- Data enrichment and validation pipeline updates
- Runtime data model updates (`alt_meanings`, per-meaning progress)
- Session queue rules (collision policy, bloat limit)
- Secondary meaning exercise flow (Adaptive B)

Out of scope:
- Backend services
- New external dashboard tools

## Phase 1: Data Pipeline

### Task 1.1 - Add enrichment schema for multi-meaning
Files:
- [scripts/enrich.js](scripts/enrich.js)
- [data/words_enriched.json](data/words_enriched.json)

Steps:
- [ ] Add output schema for `alt_meanings[]` with fields: `tr`, `pos`, `def`, `ex`, `unlockAfter`, `source`.
- [ ] Keep primary meaning backward-compatible (`tr`, `pos`, `def`, `ex`).
- [ ] Ensure `alt_meanings` max length is 3.

Acceptance:
- Enriched entries can carry 0-3 secondary meanings.

### Task 1.2 - WordNet pull + coarse filter + LLM reranker
Files:
- [scripts/enrich.js](scripts/enrich.js)

Steps:
- [ ] Pull WordNet senses for each word and retain WordNet order.
- [ ] Compute cosine similarity over gloss pairs and flag merge candidates (`> 0.85`).
- [ ] Apply word-level frequency gate using a Node.js-compatible library or a static frequency JSON file. Do not use Python `wordfreq` directly from this Node.js script.
- [ ] Send one LLM reranker call per word with merge candidates.
- [ ] Add fail-safes in this task's implementation path:
  - timeout guard per API call
  - retry with backoff for `429` and transient `5xx`
  - malformed JSON repair/fallback flow
  - structured error reason codes in failure output
- [ ] Parse and store `selected`, `merged`, `excluded` decisions.

Acceptance:
- No sense is invented by LLM.
- Exclusion and merge reasons are persisted for audit.
- Timeout/retry/JSON-repair behavior is present and testable.

### Task 1.3 - Generate learner-facing content for selected senses
Files:
- [scripts/enrich.js](scripts/enrich.js)

Steps:
- [ ] For each selected meaning, call LLM content generator for `def`, `tr`, `ex`.
- [ ] Execute these per-meaning LLM content calls sequentially with a small delay to reduce `429` risk (no `Promise.all` burst by default).
- [ ] Reuse fail-safe policy here as well (timeout, retry/backoff, malformed JSON repair/fallback, reason-coded failures).
- [ ] Add `source` provenance: `senseId`, `wordnetRank`, `llmRank`, `orderChanged`, `selectionReason`.

Acceptance:
- Final enriched records include full runtime fields plus provenance.

### Task 1.4 - Validation and spot-check output
Files:
- [scripts/validate.js](scripts/validate.js)
- [data/words_enrichment_failures.json](data/words_enrichment_failures.json)
- [data/spot_check_review.json](data/spot_check_review.json)

Steps:
- [ ] Add checks: max 3 meanings, rank order by `llmRank`, no duplicate glosses, no duplicate `senseId`, valid `unlockAfter`.
- [ ] Add spot-check flags:
  - order mismatch (top-2 changed)
  - heavy pruning (4+ senses -> 1 selected)
  - no alt meanings despite 3+ senses
- [ ] Write spot-check output JSON.

Acceptance:
- Validation reports deterministic failures.
- Spot-check file is generated with reason codes.

## Phase 2: Runtime Progress Model

### Task 2.1 - Extend progress model for per-meaning state
Files:
- [js/progress.js](js/progress.js)

Steps:
- [ ] Track per-meaning states under `meanings[]`.
- [ ] Implement backward-compatible fallback for old records without `meanings`.
- [ ] Do NOT write a migration script. Use lazy runtime handling with:

```js
const primaryMeaning = word.meanings?.[0] ?? { status: word.status, interval: word.interval };
```

- [ ] Keep existing spaced repetition intervals unchanged.

Acceptance:
- Existing users load without migration errors.

### Task 2.2a - Implement unlock logic in progress layer
Files:
- [js/progress.js](js/progress.js)

Steps:
- [ ] On review completion, unlock secondary meaning when interval threshold reached.
- [ ] Mark new meanings as `queued`.

Acceptance:
- Unlock events appear exactly once per meaning.

## Phase 3: Session Queue and Pedagogy Rules

### Task 3.0 - Wire unlock events into session UI state (2.2b)
Files:
- [js/app.js](js/app.js)

Steps:
- [ ] Populate `session.newlyUnlocked` from progress-layer unlock outputs.
- [ ] Keep this change in the same app.js-oriented commit stream as other session queue rules to avoid overlapping commit churn.

Acceptance:
- Newly unlocked meanings are visible to session summary logic without duplicate insertion.

### Task 3.1 - Review collision policy
Files:
- [js/app.js](js/app.js)

Steps:
- [ ] Enforce one meaning per word per session.
- [ ] Priority: shorter interval first.
- [ ] Tie-break: lower `meaningIndex` first.
- [ ] Push non-selected meaning review by 1 day.

Acceptance:
- No same-word multi-meaning collision in a single session.

### Task 3.2 - Session bloat limit
Files:
- [js/app.js](js/app.js)

Steps:
- [ ] Add max 2 pending secondary meanings per session.
- [ ] Keep overflow `pending` for next session (FIFO).

Acceptance:
- Secondary meanings do not dominate session queue.

## Phase 4: UI and Exercise Flow

### Task 4.1 - Summary and activation UX
Files:
- [js/app.js](js/app.js)
- [js/ui.js](js/ui.js)

Steps:
- [ ] Add summary block for newly unlocked meanings.
- [ ] Add actions: `Evet` (move to pending), `Sonra` (remain queued).
- [ ] Add word-list badge `1/2` and `Ogren` chip for queued activation.

Acceptance:
- User can activate queued meanings later from word list.

### Task 4.2 - Adaptive B exercise flow for secondary meanings
Files:
- [js/exercises.js](js/exercises.js)
- [js/app.js](js/app.js)

Steps:
- [ ] Add `SECONDARY_MEANING_DEFINITION` renderer.
- [ ] Add POS badge pills on definition cards.
- [ ] Flow: Definition -> Gap Fill -> (if wrong) EN->TR MC -> retry gap if needed.
- [ ] Skip production exercise for secondary meanings.

Acceptance:
- Secondary meaning flow completes in short adaptive path.

## Phase 5: Verification

### Task 5.1 - Pipeline verification
Files:
- [scripts/enrich.js](scripts/enrich.js)
- [scripts/validate.js](scripts/validate.js)

Steps:
- [ ] Run enrichment on small sample set (10-20 words).
- [ ] Verify spot-check output quality.
- [ ] Validate schema and failure reporting.

### Task 5.2 - Runtime verification
Files:
- [js/app.js](js/app.js)
- [js/progress.js](js/progress.js)
- [js/exercises.js](js/exercises.js)
- [js/ui.js](js/ui.js)

Steps:
- [ ] Simulate unlock path with mocked progress intervals.
- [ ] Verify collision policy including equal-interval tie-break.
- [ ] Verify bloat limit and carry-over behavior.
- [ ] Verify old progress compatibility.

## Implementation Notes (Engineering)

- LLM/API fail-safes (timeout, 429, malformed JSON, retries, fallback model, structured logs) are implementation requirements and should be enforced while building tasks above.
- Keep commits small and phase-scoped.

## Suggested Commit Sequence

1. `feat(enrich): add multi-meaning schema and WordNet reranker pipeline`
2. `feat(validate): add multi-meaning validation and spot-check report`
3. `feat(progress): add per-meaning progress and unlock queue marking`
4. `feat(session): wire newlyUnlocked state, collision policy, and bloat limit`
5. `feat(ui): add meaning badges, summary actions, queued activation`
6. `feat(exercises): add adaptive secondary meaning flow with POS badges`
7. `test: verify unlock, collision, and backward compatibility paths`
