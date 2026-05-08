# Multi-Meaning Word System — Design Spec

**Date:** 2026-05-08  
**Status:** Approved

---

## Overview

Teach multiple meanings of polysemous words without disrupting the existing spaced repetition algorithm or forcing users through redundant exercises. A secondary meaning unlocks automatically after the primary meaning is sufficiently learned, surfaces in the session summary, and enters the queue only with user consent.

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

When generating `alt_meanings`, instruct the model to:
- Produce **at most 3 meanings** per word, in **descending frequency order**
- Skip rare or highly domain-specific meanings
- Skip words where a second common meaning does not exist

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
| `scripts/enrich.js` | Prompt addition to generate `alt_meanings` (max 3, frequency-ordered) |
| `js/progress.js` | `meanings` array tracking; unlock check after each review; backward-compat guard |
| `js/app.js` | `session.newlyUnlocked` accumulation; session summary Evet/Sonra action handlers |
| `js/exercises.js` | `SECONDARY_MEANING_DEFINITION` renderer with context bridge; Adaptive B gate logic |
| `js/ui.js` | `🟡 1/2` badge; `[Öğren]` chip for queued meanings in word list panel |
