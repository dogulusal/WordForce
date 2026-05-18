# Round 2/3/4 Practice Improvements - Design Spec

**Date:** 2026-05-18  
**Status:** Draft for user review

---

## Overview

This design improves learning quality and UX in four places:

1. Round 2 distractors become semantically plausible (not random unrelated words).
2. Round 3 sentence variation is enabled only for words currently in `practice` status.
3. Round 4 Sentence Builder UI is redesigned to match the requested chip-based layout (visual 4 style), while preserving current colors.
4. A new in-exercise action allows adding the current word to `practice` immediately.

The behavior is intentionally conservative for now:
- No session-by-session distractor drift policy.
- No forced randomization strategy beyond current shuffle behavior.
- Focus on stronger option quality and stable behavior.

---

## Scope

In scope:
- Round 2 option generation logic and distractor ranking.
- Round 3 template generation logic for practice words.
- Round 4 Sentence Builder rendering and interactions.
- New `Practice +` quick action during exercises.

Out of scope:
- Full dataset backfill for all words with manual semantic classes.
- Per-day or per-session deterministic seed policy for distractor rotation.
- Non-Sentence Builder layout redesigns.

---

## Round 2 - Semantic Distractors

### Goal

Distractors should be "close enough to confuse thoughtfully" while still clearly wrong.

### Selection strategy (hybrid, stable-first)

For each target word, build distractors in priority tiers:

1. Use explicit Turkish distractor hints if present (`mc_tr_distractors` if introduced later).
2. Use `sb_distractors` English words and map them to Turkish (`allWords[d].tr`) when possible.
3. Use scored candidates from lexicon using constraints:
   - Same POS (hard filter)
   - Same or adjacent CEFR level (soft preference)
   - Context overlap from example tokens (`ex` token similarity)
   - Definition token overlap (`def` token similarity)
4. Fallback to existing same-POS/same-level pool.

### Scoring

Candidate score is weighted:

- POS match: required
- CEFR distance: lower is better
- Example-context similarity: higher is better
- Definition token similarity: higher is better
- Duplicate/gloss collision penalty: applied

Pick top candidates, then shuffle display order once.

### Stability policy

For now, no special session-drift strategy is added. The system keeps stable logic and current randomness level. If needed later, deterministic daily/session seeds can be added without redesigning core ranking.

---

## Round 3 - Practice-Only Sentence Variation

### Goal

When a word is in `practice`, show varied contexts for the same target word to improve retention.

### Activation rule

At exercise render-time, read latest progress state:
- If `progress.words[word].status === "practice"`, enable variation mode.
- Otherwise keep existing behavior.

No separate active-practice cache is introduced. This guarantees automatic updates as soon as any word is marked practice.

### Template source chain

1. Word-specific examples from `ex`.
2. POS-aware generic templates (noun/verb/adjective/adverb/prep/conj).
3. Safe fallback template.

Each produced template must include the target token in a fill-ready format so the expected answer remains the same target word.

### Repetition control

Keep a tiny per-session recent-template memory per word (e.g., last 1-2 indexes) to avoid immediate repeats.

---

## Round 4 - Sentence Builder Redesign (Only This Exercise)

### Layout (visual 4 style)

- Header row remains as-is (round progress + quick actions).
- Sentence Builder card changes to:
  - Turkish prompt line.
  - Placed chips zone (selected words).
  - "Available words" chip row/grid.
  - Actions row: Undo + Submit.
  - Helper hint text.

Colors remain in the existing palette. The change is structural/interactional, not theme replacement.

### Interaction model

- Tap available chip -> move/add to placed zone.
- Tap placed chip -> remove and return to available zone.
- Undo removes last placed chip.
- Used chips in available zone appear disabled/ghosted.

### Feedback and motion

- Chip add: small pop animation.
- Chip remove: short fade/slide back.
- Wrong submit: subtle shake on placed zone + concise warning.
- Partial order hint: visually mark longest correct prefix after wrong submit.

Accessibility:
- Buttons remain keyboard-focusable.
- Reduced-motion users get non-animated fallback.

---

## In-Exercise `Practice +` Action

### Goal

Let users mark any active word for future practice without leaving the session.

### Behavior

- Add `Practice +` button in round quick actions.
- On click: mark current word `practice` immediately.
- Keep user on the same current exercise screen (no forced skip/end).
- Show short confirmation feedback.

This integrates with Round 3 automatically because variation mode reads live status each render.

---

## Data and State Changes

Expected minimal additions:

- Optional in-memory helper state for template recency:
  - `session.templateHistory[word] = [index,...]` (bounded)
- Optional new data key support (non-breaking):
  - `mc_tr_distractors` (future-friendly)

No breaking schema migration is required.

---

## Error Handling

- If semantic pool is too small, fallback to current safe distractor logic.
- If template generation lacks enough material, fallback sentence is used.
- If mapped Turkish distractor duplicates correct answer, dedupe and refill.

---

## Testing Strategy

1. Round 2 quality checks:
   - For known samples (`beer`, similar words), ensure distractors are semantically closer than generic unrelated nouns.
   - Ensure 4 options with unique values.
2. Round 3 gating:
   - Word not in practice -> old behavior.
   - Word in practice -> varied templates.
   - Newly marked practice mid-session -> variation activates without restart.
3. Round 4 UI:
   - Add/remove chip flows.
   - Undo behavior.
   - Wrong order feedback + partial prefix hint.
4. Practice button:
   - Status changes to practice immediately.
   - Session continues on same question.

---

## Implementation Notes

Primary files expected to change:
- `js/exercises.js`
- `js/app.js`
- `css/style.css`

Potential optional touch:
- `data/words_enriched.json` (only if future curated distractor key is introduced)

---

## Open Decisions (Resolved)

- Distractor options do not need forced per-session churn now.
- Focus now is option quality and stable behavior.
- Sentence Builder redesign applies only to Sentence Builder, not all rounds.
