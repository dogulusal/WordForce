# Multi-Meaning Word System — Design Spec

**Date:** 2026-05-08  
**Status:** Approved

---

## Overview

Teach multiple meanings of polysemous words without disrupting the existing spaced repetition algorithm or forcing users through redundant exercises. A secondary meaning unlocks automatically after the primary meaning is sufficiently learned, surfaces in the session summary, and enters the queue only with user consent.

Meaning discovery is source-first, not LLM-first: authoritative lexical data determines which meanings exist and their order; LLM is used only for pedagogical content generation (simple definition wording, Turkish translation phrasing, example sentence generation).

---

## Meaning Discovery and Verification

This feature has two distinct questions:

1. How many common meanings does a word have?
2. Which meanings are most common for general learners?

The system answers these through a source hierarchy.

### Source hierarchy (required)

1. Lexical ground truth source (WordNet and/or licensed dictionary API such as Oxford/Merriam-Webster) to enumerate candidate senses.
2. Frequency layer (corpus-based source such as COCA-derived mapping, SUBTLEX, or equivalent frequency table) to rank/filter by real usage.
3. LLM layer only to render learner-friendly outputs for already selected senses.

LLM must never be the authority for sense count or base ordering.

### Common-meaning selection policy

For each word:

- Gather all candidate senses from lexical source.
- Map each sense to frequency evidence.
- Keep only general-use senses passing minimum frequency threshold.
- Sort by frequency score descending.
- Keep top K, where K <= 3 for this product phase.

If a word has more than K genuinely common senses, only the top K are included. This is an intentional product limit, not a data error.

### Guarantee boundaries

Guaranteed:

- Included meanings are selected from external lexical/frequency evidence, not raw model intuition.
- Included meanings are ordered by measurable usage score.
- Rare/domain-specific senses are filtered out by policy.

Not guaranteed:

- The app does not surface all common meanings when K limit is reached.
- Frequency ranking can vary by domain/register; ordering reflects the chosen corpus profile, not every context.

### Confidence metadata (stored for audit)

Each secondary meaning should carry provenance fields during enrichment:

```json
{
  "tr": "ağaç kabuğu",
  "def": "...",
  "ex": ["..."],
  "unlockAfter": 14,
  "source": {
    "lexicon": "wordnet",
    "senseId": "wn:...",
    "frequencySource": "coca",
    "frequencyRank": 2,
    "frequencyScore": 0.71,
    "selectionReason": "top_k_common"
  }
}
```

These fields are optional for runtime UI but required in the enrichment artifact so quality can be inspected.

### Verification checks (`scripts/validate.js`)

Add validation rules for multi-meaning data:

- `alt_meanings.length <= 3`
- `alt_meanings` sorted by `source.frequencyRank` ascending
- each meaning has non-empty `tr`, `def`, `ex[0]`
- no duplicate normalized Turkish gloss across meanings
- no duplicate `senseId` for the same word
- `unlockAfter` in allowed set: `1|3|7|14|30`

Validation failures go to `data/words_enrichment_failures.json` with reason code.

---

## Data Layer — `words_enriched.json`

Backward-compatible extension. Single-meaning words are untouched.

```json
"bark": {
  "tr": "havlamak",
  "def": "To make the sharp sound a dog makes.",
  "ex": ["The dog barked at the stranger."],
  "alt_meanings": [
    {
      "tr": "ağaç kabuğu",
      "def": "The outer covering of a tree trunk or branch.",
      "ex": ["The bark of the oak tree is very rough."],
      "unlockAfter": 14
    }
  ]
}
```

### `unlockAfter` semantics

`unlockAfter` maps to the spaced repetition interval value, not a separate counter:

| interval value | successful reviews completed |
|---------------|------------------------------|
| 1             | 0 (just learned)             |
| 3             | 1                            |
| 7             | 2                            |
| 14            | 3 ← default unlock threshold |
| 30            | 4                            |

No new counter field is needed. Unlock check: `wordProgress.interval >= meaning.unlockAfter`.

### Enrichment script note (`scripts/enrich.js`)

When building `alt_meanings`:

- Determine senses from lexical source first.
- Apply frequency filtering/ranking before any generation.
- Keep **at most 3 meanings** in descending frequency order.
- Skip rare or highly domain-specific meanings.
- Skip words where a second common meaning does not exist.
- Use LLM only after selection, to generate learner-facing `def`, `tr`, `ex` for the already chosen senses.

---

## Progress Structure

Secondary meanings are tracked inside the word's progress entry.

```json
"bark": {
  "status": "learned",
  "interval": 14,
  "nextReview": "2026-05-22",
  "meanings": [
    { "meaningIndex": 0, "status": "learned", "interval": 14 },
    { "meaningIndex": 1, "status": "queued" }
  ]
}
```

### `meaningIndex` values

- `0` = primary meaning (same as current `tr`/`def`/`ex`)
- `1`, `2` = secondary meanings from `alt_meanings[0]`, `alt_meanings[1]`

### Meaning statuses

| status    | description |
|-----------|-------------|
| `learned` | In spaced repetition |
| `queued`  | Unlocked but not yet accepted by user |
| `pending` | Accepted by user, will appear in next session |

---

## Backward Compatibility

`progress.js` must handle existing word records that have no `meanings` array. Use the following pattern everywhere meaning-level data is accessed:

```js
const primaryMeaning = word.meanings?.[0] ?? { status: word.status, interval: word.interval };
```

No migration script needed — old records continue to work, `meanings` is populated lazily on first write.

---

## Unlock Flow

After each session, `progress.js` checks all reviewed words:

```
for each reviewed word:
  if word.interval >= alt_meanings[i].unlockAfter
  AND meanings[i+1].status is undefined or missing:
    set meanings[i+1].status = "queued"
    add to session.newlyUnlocked list
```

If `newlyUnlocked` is non-empty, the session summary screen shows:

```
🔓 Yeni anlam açıldı:
   bark → "ağaç kabuğu"
   can  → "teneke kutu"

→ Bunları sonraki session'a ekleyelim mi?  [Evet] [Sonra]
```

- **Evet** → sets `status: "pending"` for each; next session start includes them at the front of the queue
- **Sonra** → status stays `"queued"`; user can activate later from the word list panel (see below)

### Activating "Sonra" items later

The word list panel (accessible from the home screen) shows each word with its meaning progress badge (`🟡 1/2`). Words with `queued` meanings display an **"Öğren"** chip next to the badge. Tapping it sets the meaning to `pending` and it enters the next session. This is the only activation path — there is no separate "queued meanings" screen.

---

## Secondary Meaning Exercise Flow (Adaptive B)

When a `pending` secondary meaning reaches the front of the session queue:

```
1. Definition card (required)
      ↓
2. Gap Fill (required)
      ✓ correct → status = "learned", interval = 1, spaced repetition begins
      ✗ wrong   → EN→TR Multiple Choice
                    ✓ → "learned"
                    ✗ → return to Gap Fill (same meaning, new sentence if available)
```

Production exercise is skipped entirely — the user already produces sentences with this word.

### Definition card — context bridge

The Definition card for a secondary meaning always shows the primary meaning alongside the new one:

```
🔁 bark — 2. anlam

💡 Hatırla: bark = "havlamak" da demekti
   "The dog barked loudly."

Yeni anlam:
   "The bark of the oak tree is very rough."
```

---

## UI Changes

### Word list panel (`js/ui.js`)

- Single-meaning words: existing display, no change
- Multi-meaning words: `bark 🟡 1/2` badge after the word
- Words with `queued` meanings: `bark 🟡 1/2 [Öğren]` chip

### Session summary screen (`js/app.js`)

- New section: `🔓 Yeni anlam açıldı` with Evet/Sonra buttons, rendered only when `session.newlyUnlocked` is non-empty

### Exercise renderer (`js/exercises.js`)

- New exercise type: `SECONDARY_MEANING_DEFINITION` — renders the context bridge card
- Adaptive B gate: if Gap Fill result is wrong, push `EN_TO_TR_MC` for the same meaning onto the front of the queue

---

## Affected Files

| File | Change |
|------|--------|
| `data/words_enriched.json` | `alt_meanings` field added to polysemous words via enrich script |
| `scripts/enrich.js` | Source hierarchy integration (lexicon + frequency), then LLM generation for selected senses only |
| `scripts/validate.js` | Multi-meaning validation rules (max 3, rank order, schema checks, duplicate sense guards) |
| `js/progress.js` | `meanings` array tracking; unlock check after each review; backward-compat guard |
| `js/app.js` | `session.newlyUnlocked` accumulation; session summary Evet/Sonra action handlers |
| `js/exercises.js` | `SECONDARY_MEANING_DEFINITION` renderer with context bridge; Adaptive B gate logic |
| `js/ui.js` | `🟡 1/2` badge; `[Öğren]` chip for queued meanings in word list panel |
