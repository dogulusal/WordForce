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

1. **WordNet sense enumeration** — Pull all senses for the word. WordNet's default sense ordering (Princeton editorial + historical usage frequency) serves as the initial ranking heuristic. This ordering is not perfect but is consistent for the majority of common words.
2. **Coarse filter** — Word-level frequency gate using `wordfreq` (Python, SUBTLEX-based) or equivalent: skip words whose overall frequency is too low to warrant multi-meaning treatment. Additionally, flag potential merge candidates by computing cosine similarity between WordNet gloss pairs; pairs with similarity > 0.85 are marked as merge candidates for the next step.
3. **LLM reranker + deduplicator** — LLM receives the full WordNet sense list (with merge candidates flagged) and handles both jobs in a single call:
   - **Dedup:** For flagged merge candidates, decide whether they are truly the same sense. If yes, keep the clearer gloss.
   - **Rerank:** Select and rank remaining senses by **frequency in everyday spoken English**.
   - LLM does not discover new senses — it only merges, selects from, and reorders the WordNet list.

LLM must never be the authority for sense count. It may merge near-duplicates, reorder, or exclude WordNet senses but cannot invent senses not present in the WordNet list.

### LLM reranker prompt template

```
WordNet senses (in WordNet order): [1. havlamak, 2. ağaç kabuğu, 3. bir gemi türü]
Merge candidates (cosine > 0.85): [(1, 4)]
Word: bark
Target audience: Turkish learners (A2-B1)

Step 1: For each merge candidate pair, decide if they are the same sense.
  If yes, keep the clearer gloss and note the merged index.
Step 2: From the remaining senses, select those common in everyday spoken English.
  Rank by how frequently they appear in casual conversation and general media.
Step 3: For each excluded or merged sense, write a one-sentence reason.

Return JSON:
{
  "selected": [{"wordnetIndex": 1, "rank": 1}, ...],
  "merged": [{"kept": 1, "dropped": 4, "reason": "Same sense: both describe rapid leg movement"}],
  "excluded": [{"wordnetIndex": 3, "reason": "Archaic nautical term, rare in modern speech"}]
}
```

The exclusion and merge reasons serve as an audit trail and help improve the prompt over time.

### Common-meaning selection policy

For each word:

- Pull all senses from WordNet (already roughly frequency-ordered).
- Coarse-filter: skip low-frequency words; flag gloss pairs with cosine similarity > 0.85 as merge candidates.
- LLM reranker + deduplicator: merge flagged near-duplicates, then select and rank by everyday spoken English frequency.
- Keep top K, where K <= 3 for this product phase.

If a word has more than K genuinely common senses, only the top K are included. This is an intentional product limit, not a data error.

### Automated spot-check flags

After the pipeline runs, automatically flag words for manual review:

- **Order mismatch:** LLM reranker changed WordNet's top-2 order → review.
- **Heavy pruning:** WordNet listed 4+ senses but LLM selected only 1 → review.
- **No alt_meanings:** Word has 3+ WordNet senses but pipeline produced 0 alt_meanings → review.

These flags produce a `data/spot_check_review.json` file listing flagged words with reasons. Expected volume: ~20-30 words out of 100-200 polysemous candidates. Manual review of this list replaces full curation.

### Guarantee boundaries

Guaranteed:

- Sense candidates come from WordNet, not LLM invention.
- Ordering uses WordNet's default frequency heuristic as baseline, refined by LLM reranking on spoken-language frequency.
- Rare/domain-specific senses are filtered out by policy.
- Every LLM exclusion decision has a logged reason for audit.

Not guaranteed:

- The app does not surface all common meanings when K limit is reached.
- Frequency ranking reflects everyday spoken English; register-specific ordering (e.g. academic, legal) may differ.
- WordNet's sense granularity deduplication is heuristic — edge cases may merge or split incorrectly.

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
    "senseId": "wn:bark.n.02",
    "wordnetRank": 2,
    "llmRank": 2,
    "orderChanged": false,
    "selectionReason": "top_k_spoken"
  }
}
```

Excluded senses are logged separately per word:

```json
{
  "word": "bark",
  "excluded": [
    { "senseId": "wn:bark.n.03", "reason": "Archaic nautical term, rare in modern speech" }
  ]
}
```

These fields are optional for runtime UI but required in the enrichment artifact so quality can be inspected.

### Verification checks (`scripts/validate.js`)

Add validation rules for multi-meaning data:

- `alt_meanings.length <= 3`
- `alt_meanings` sorted by `source.llmRank` ascending
- each meaning has non-empty `tr`, `def`, `ex[0]`
- no duplicate normalized Turkish gloss across primary `tr` and any `alt_meanings[].tr`
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

1. Pull WordNet senses for the word (uses default sense ordering as baseline).
2. Coarse-filter: skip words below frequency gate; compute cosine similarity between gloss pairs and flag pairs > 0.85 as merge candidates.
3. Send full sense list + merge candidates to LLM — merge near-duplicates, then select and rank by everyday spoken English frequency. Log merge and exclusion reasons.
4. Take top K (K <= 3) from reranked list.
5. For each selected sense, call LLM separately to generate learner-facing `def`, `tr`, `ex`.
6. Write `source` provenance metadata for each meaning.
7. Generate spot-check flags to `data/spot_check_review.json`.

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
| `scripts/enrich.js` | WordNet sense pull → coarse filter → LLM reranker → LLM content generation; spot-check flag output |
| `scripts/validate.js` | Multi-meaning validation rules (max 3, rank order, schema checks, duplicate sense guards) |
| `js/progress.js` | `meanings` array tracking; unlock check after each review; backward-compat guard |
| `js/app.js` | `session.newlyUnlocked` accumulation; session summary Evet/Sonra action handlers |
| `js/exercises.js` | `SECONDARY_MEANING_DEFINITION` renderer with context bridge; Adaptive B gate logic |
| `js/ui.js` | `🟡 1/2` badge; `[Öğren]` chip for queued meanings in word list panel |
