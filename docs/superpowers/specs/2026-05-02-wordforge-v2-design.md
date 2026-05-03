# WordForge v3 — Product & Technical Specification

**Date:** 2026-05-02  
**Version:** 3.0  
**Status:** Active Draft  

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Scope](#2-scope)
3. [Data Model](#3-data-model)
4. [Learning Flow — Round-Based Interleaving](#4-learning-flow--round-based-interleaving)
5. [Exercise Catalogue](#5-exercise-catalogue)
6. [Spaced Repetition Policy](#6-spaced-repetition-policy)
7. [Level & Progress System](#7-level--progress-system)
8. [State Management Architecture](#8-state-management-architecture)
9. [API Key Security](#9-api-key-security)
10. [Data Enrichment Pipeline](#10-data-enrichment-pipeline)
11. [Home & Stats Interaction](#11-home--stats-interaction)
12. [Visual System](#12-visual-system)
13. [Accessibility](#13-accessibility)
14. [Error Handling](#14-error-handling)
15. [Rollout Plan](#15-rollout-plan)
16. [Non-Goals](#16-non-goals)
17. [Open Decisions](#17-open-decisions)

---

## 1. Product Vision

WordForge is a personal-use English vocabulary learning app that teaches through **active use, not passive memorization**. The experience is built around spaced repetition, context-driven exercises, and production tasks — all with a polished, portfolio-quality visual finish.

**Primary outcomes:**
- Deepen vocabulary retention through varied, progressive exercise types
- Track long-term progress with a spaced repetition engine (fully local, no backend)
- Deliver a clean, modern UI worthy of a portfolio showcase

**User type:** Personal-use learner. Visual quality matters alongside learning effectiveness.

---

## 2. Scope

### In Scope
- Vocabulary levels: A1 → C1 (starting with full A1 coverage)
- Five exercise types (see Section 5)
- Spaced repetition via localStorage
- Level-based word pool (A1 / A2 / B1 / B2 / C1) — no arbitrary "session" grouping
- AI-assisted sentence evaluation (Production exercise)
- Data enrichment pipeline for `def`, `ex`, and `ex_tr` fields
- Warm Night visual theme with subtle motion

### Out of Scope
- Listening / speech API exercises
- Backend, database, or authentication
- Multi-user features
- Native mobile app
- B1–C1 dataset enrichment (current cycle)

---

## 3. Data Model

### 3.1 Word Entry (`words.json`)

```json
{
  "word": "need",
  "level": "A1",
  "pos": "verb",
  "tr": "ihtiyaç duymak",
  "def": "to require something as necessary or important",
  "ex": [
    "I need water after a long run.",
    "She needs more time to finish the report.",
    "Do you need help with that?"
  ],
  "ex_tr": [
    "Uzun bir koşunun ardından su içmem gerekiyor.",
    "Raporu bitirmek için daha fazla zamana ihtiyacı var.",
    "Bunun için yardıma ihtiyacın var mı?"
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `word` | string | ✅ | Exact target form |
| `level` | string | ✅ | A1 / A2 / B1 / B2 / C1 |
| `pos` | string | ✅ | noun / verb / adj / adv / conj / phrasal |
| `tr` | string | ✅ | Turkish translation |
| `def` | string | ✅ | Short English definition (A1-friendly wording) |
| `ex` | array | ✅ | 2–3 natural, frequent-use English sentences |
| `ex_tr` | array | ✅ | Turkish translations of `ex` — same order, same count |

**Data quality rules:**
- `ex` sentences must use the exact target form of the word
- `ex_tr[i]` must be a natural Turkish translation of `ex[i]` — index-matched
- Sentences should reflect real-world, common usage (not contrived examples)
- `def` must be one sentence, plain English, no jargon
- No word may be marked enriched with empty `def`, `ex`, or `ex_tr`

**Fallback behaviour (if fields missing):**
- Missing `def` → hide definition block, do not show Turkish placeholder
- Missing `ex` or `ex_tr` → skip Gap Fill, Sentence Builder, and Translation MC for that word, continue flow

---

### 3.2 User Progress (`localStorage`)

```json
{
  "level": "A1",
  "words": {
    "need": {
      "status": "learned",
      "interval": 3,
      "nextReview": "2026-05-05",
      "posErrors": { "verb": 1, "noun": 0 }
    },
    "happy": {
      "status": "known"
    },
    "begin": {
      "status": "practice"
    }
  }
}
```

**Status values:**

| Status | Meaning |
|--------|---------|
| `practice` | In active learning pool (default for new words) |
| `known` | User self-reported as already known — skipped |
| `learned` | Completed all exercises correctly — enters spaced repetition |
| `review` | `learned` word whose `nextReview` date has arrived |

---

## 4. Learning Flow — Round-Based Interleaving

### 4.1 Why Not Per-Word Linear Flow?

A per-word linear flow creates **information leakage**: the user sees "sleep → uyumak" in Round 1, then immediately gets asked "uyumak → which English word?" The answer is still in working memory — the exercise tests nothing.

The solution is **interleaving** (Rohrer 2012, Kornell & Bjork 2008): process all session words through one exercise type before moving to the next. With 10 words per session, there are 9 items between a word's definition and its first quiz — enough spacing to make recall genuinely effortful.

### 4.2 Session Structure

```
SESSION START (e.g. 10 words: sleep, run, eat, big, old, fast, give, need, help, find)
│
├── GATE (before session begins)
│   Each word shown once: "Do you know this word?"
│   → YES: mark [known], remove from session queue
│   → NO: keep in queue
│
│   ⚠️ Note: Gate shows the word with no definition — just "Do you know X?"
│   Round 1 then shows the same word again but with full definition and POS.
│   This is intentional: Gate is a fast triage (~1 sec per word),
│   Round 1 is deliberate study exposure. They serve different purposes.
│
├── ROUND 1 — Definition  "Meet the words"
│   All queued words, shuffled order A
│   Show: word + POS + English definition
│   CTA: "Got it" → next word
│   (No quiz, no pressure — pure exposure)
│
├── ROUND 2 — EN → TR MC  "Recognize"
│   All words, reshuffled order B
│   "What does X mean in Turkish?" → 4 options
│
├── ROUND 3 — Gap Fill  "Context"
│   All words, reshuffled order C
│   Bağlam bazlı cümle tamamlama
│
├── ROUND 4 — Sentence Builder + Translation MC  "Apply"
│   All words, reshuffled order D
│   Alternates between Sentence Builder and Translation MC per word
│
├── ROUND 5 — Production  "Produce"
│   All words, reshuffled order E
│   User writes their own sentence — AI evaluated
│
└── SESSION SUMMARY
    Per-word result grid → scoring applied
```

### 4.3 Shuffle Rule

Each round uses an **independent random shuffle** of the word queue. This prevents positional memory ("sleep was always third") from substituting for genuine recall.

```javascript
function shuffleForRound(words) {
  return [...words].sort(() => Math.random() - 0.5);
}
// Called independently before each round — never reuse previous round's order
```

### 4.4 Spacing Effect

In a 10-word session, there are **9 items** between a word's definition and its Round 2 quiz. Research shows this level of spacing increases recall difficulty by ~40–60% compared to back-to-back presentation — which is exactly the desired effect.

### 4.5 Scoring Rule

Words are evaluated **at session end**, not round by round.

| Result | Condition | Next status |
|--------|-----------|-------------|
| `learned` | Correct in all rounds on first attempt | Enters spaced repetition |
| `practice` | Any wrong answer in any round | Returns to active pool |

A word marked `practice` re-enters the queue in the next session. Its per-round error data is preserved for analytics (POS error counters — Section 7).

### 4.6 Quit Session (End Early)

A 20-word session runs 5 rounds × 20 words = **100 interactions**. Users must be able to exit mid-session without losing all progress.

**UI:** A persistent "✕ End Session" button in the top corner of the session screen, visible at all times.

**Quit flow:**
1. User taps "✕ End Session"
2. `quitConfirm` modal appears: *"End this session? Progress so far will be saved."*
3. Two options: **"End Session"** (confirm) | **"Keep Going"** (dismiss)
4. On confirm: score partial results, navigate to mini summary, then Home

No accidental exits — the confirmation dialog prevents mis-taps.

**Behaviour on quit:**
- Words that have completed **all rounds up to the current round** are scored and saved normally (`learned` or `practice`)
- Words that are **partially through rounds** (started but not finished) → marked `practice`, no interval change
- Words **not yet reached** in the current round → no state change, remain in pool
- User lands on a mini summary screen showing what was saved before returning to Home

**Example — quit mid Round 3, 20-word session:**
```
Round 1 ✅ complete (all 20 words)
Round 2 ✅ complete (all 20 words)
Round 3 🔴 quit at word 8 of 20
→ Words 1–7 of Round 3: scored with rounds 1–3 data (rounds 4–5 not reached → practice)
→ Words 8–20: scored with rounds 1–2 only (rounds 3–5 not reached → practice)
→ No word loses Round 1–2 data
```

---

## 5. Exercise Catalogue

### 5.1 EN → TR Multiple Choice

**Purpose:** Verify the user knows the Turkish meaning before deeper exercises.

**Structure:**
- Prompt: *"What does '[word]' mean in Turkish?"*
- 4 options: 1 correct + 3 distractors
- Immediate correctness feedback (green / red)

**Feedback behaviour on correct answer:**
- Selected correct option → turns green (200ms flash)
- Auto-advance to next item after 600ms — no tap required
- Keep it fast: correct answers should feel rewarding, not slow

**Feedback behaviour on wrong answer:**
- Selected wrong option → turns red
- Correct option → simultaneously turns green (revealed)
- User sees both at the same time: what they picked vs. what was right
- After 1 second delay, auto-advance to next item (no extra tap required)
- This applies to all MC exercises (5.1, 5.2, 5.4) — consistent across the app

**Distractor selection algorithm:**
1. Same `pos` + same `level` → preferred pool
2. Same `pos` + adjacent level (±1) → fallback pool
3. Random same-`pos` → last resort
4. Never use the correct answer's word family (no "need" / "needy" / "needing" as distractors)

---

### 5.2 Gap Fill (Context-Based)

**Purpose:** Test comprehension of the word in a real sentence, not just recognition of the word itself.

**Key design principle:** The user already knows the target word at this point. The exercise must require **understanding the sentence context**, not just recalling the word.

**Structure:**
- Take one sentence from the word's `ex` array
- Replace the target word with a blank `___`
- 4 options: target word + 3 distractors of the same `pos`
- All 4 options must be grammatically plausible in the sentence — only 1 is semantically correct

**Example (word: "need"):**
> *"She ___ more time to finish the report."*  
> → needs / takes / wants / uses ← all grammatically valid verbs, only "needs" fits the meaning

**Distractor selection algorithm:** Same rules as 5.1 (same `pos` + same/adjacent `level`).

**Fallback:** If `ex` is empty, skip this exercise for the word.

---

### 5.3 Sentence Builder (TR → EN Word Ordering)

**Purpose:** Test the user's ability to reconstruct a correct English sentence from Turkish context.

**Data source:** The Turkish sentence is taken from the word's `ex_tr` array — the pre-generated Turkish translation of one of the English sentences in `ex`. `ex_tr[i]` always corresponds to `ex[i]`.

**Structure:**
- Show a Turkish sentence from `ex_tr` (one entry, randomly selected)
- Provide English words as tappable chips (correct words + 2–3 distractors)
- User taps chips in the correct order to build the English sentence
- Tapped chips appear in an answer area; user can tap placed chips to remove them
- Submit → immediate correctness feedback

**Chip display & comparison rules:**
- All chips are displayed in **lowercase, without punctuation** — no capitalization hints, no trailing periods
- Example: "She" → displayed as `she`, "report." → displayed as `report`
- On submit, both the expected answer and user's answer are normalized before comparison: `toLowerCase()` + strip punctuation
- This prevents trivial failures on capitalization and keeps exercise difficulty honest

**Interaction:**
- Mobile: tap-to-place (no drag-and-drop)
- Desktop: click-to-place

**Example:**
> TR: *"O, raporu bitirmek için daha fazla zamana ihtiyaç duyuyor."*  
> Chips: `She` `needs` `more` `time` `to` `finish` `the` `report` `wants` `has`

---

### 5.4 Translation MC (TR Sentence → Correct EN)

**Purpose:** Test holistic sentence understanding — grammar, vocabulary, and meaning together.

**Data source:** The Turkish sentence shown as the prompt is taken from the word's `ex_tr` array (same pre-generated translations used in Sentence Builder). The correct English answer is the corresponding `ex[i]` entry. Distractors are generated at runtime by modifying the correct sentence.

**Structure:**
- Show a Turkish sentence from `ex_tr`
- 4 English options: 1 correct translation + 3 plausible distractors
- Single correct answer only (no multi-select)
- Distractor sentences must differ in a meaningful, grammatically important way (pronoun, verb tense, word choice) — not trivially wrong

**Example:**
> TR: *"Onun sol ayakkabısı mavidir."*  
> A) Her left shoe is blue. ✅  
> B) His left shoe is blue.  
> C) Her right shoe is blue.  
> D) Her left dress is blue.

**Distractor design rules:**
- Option B: wrong pronoun (his vs her)
- Option C: wrong adjective (right vs left)
- Option D: wrong noun (dress vs shoe)
Each distractor tests a specific error type.

---

### 5.5 Production — Write Your Own Sentence (AI-Assisted)

**Purpose:** Deepest level of learning. Forces the user to produce language, not just recognize it.

**Structure:**
- Prompt: *"Write your own sentence using '[word]'."*
- User types a free sentence
- Sentence sent to Anthropic API for evaluation
- API response: correct ✅ or incorrect ❌ with specific error explanation
- If incorrect: user must try again. Exercise does not advance until a correct sentence is produced.

**API call spec:**
```javascript
{
  model: "claude-sonnet-4-20250514",
  max_tokens: 200,
  messages: [{
    role: "user",
    content: `Evaluate this sentence for correct use of the word "${word}" (${pos}).
Sentence: "${userSentence}"
Reply in JSON only: { "correct": true/false, "feedback": "one sentence explanation" }
If correct, feedback should confirm why it works.
If incorrect, explain the specific error clearly in one sentence.`
  }]
}
```

**API response parsing — JSON safety:**
LLMs occasionally wrap JSON in markdown code blocks despite instructions. Always sanitize before parsing:
```javascript
const raw = data.content[0].text;
const clean = raw.replace(/```json|```/g, '').trim();
const result = JSON.parse(clean);
```
Wrap in try/catch. On parse failure, treat as API error and apply fallback.

**Latency expectation:** ~1–2 seconds. Show a subtle loading indicator.

**Fallback:** If API call fails or response cannot be parsed, skip exercise and mark word as `learned` anyway. Do not block the user.

---

## 6. Spaced Repetition Policy

### 6.1 Algorithm

When a word reaches `learned` status, a `nextReview` date is assigned.

**Interval progression (days):**
```
1 → 3 → 7 → 14 → 30 → (retired from active review)
```

**Core function:**
```javascript
function calculateNextReview(currentInterval, wasCorrect) {
  const intervals = [1, 3, 7, 14, 30];
  if (!wasCorrect) return 1; // reset on any wrong answer
  const currentIndex = intervals.indexOf(currentInterval);
  if (currentIndex === intervals.length - 1) return null; // retired
  return intervals[currentIndex + 1];
}
```

**On app open:** Compare `nextReview` dates against `Date.now()`. Words due for review are inserted at the top of the current session queue before new words.

### 6.2 Review Session Flow

Review sessions follow the same **round-based interleaving structure** as new-word sessions, with one difference: **Round 1 (Definition) is skipped** — the user has already studied these words.

```
Review Session:
  (No Gate — all review words enter queue automatically)
  Round 2: EN → TR MC      "Recognize"
  Round 3: Gap Fill        "Context"
  Round 4: Sentence Builder + Translation MC  "Apply"
  Round 5: Production      "Produce"
  → Session Summary
```

Review words and new words can be mixed in the same session. Review words always enter the queue first (higher priority), then new words fill remaining slots up to the selected session size.

**Example — 10-word session with 4 review words:**
```
Queue: [review×4] + [new×6] = 10 words
Round 1: new words only (review words skip this round)
Round 2–5: all 10 words, independently shuffled each round
```

**Status transitions during review:**
- All answers correct → push `nextReview` forward by next interval
- Any wrong answer → reset interval to 1 day, status remains `learned`

---

## 7. Level & Progress System

### 7.1 Level Structure

Words are grouped by CEFR level. The user progresses through levels, not arbitrary sessions.

```
A1 (842 words) → A2 → B1 → B2 → C1
```

**Level completion criteria:** 80% of words in the current level reach `learned` status.

**Level-up trigger:** Automatic prompt when criteria is met. User can accept or continue current level.

### 7.2 Session Initiation

When the user starts a session:
1. Load `localStorage` state
2. Check for `review` due items → insert first
3. Fill remaining slots with `practice` words from current level
4. User selects session size: **5 / 10 / 20 words**

No infinite sessions. Hard stop at selected size.

### 7.3 Stats Counters

| Counter | Definition |
|---------|-----------|
| Learned | Words with `status: learned` |
| Known | Words with `status: known` |
| Review Due | Words where `nextReview <= today` |
| Practice | Words with `status: practice` (in active pool) |

### 7.4 POS Error Counters (`posErrors`)

Each word entry in `localStorage` carries a `posErrors` object that tracks how many times the user answered incorrectly, broken down by the word's part of speech.

**When it's incremented:** Any wrong answer in any round (Round 2–5) increments `posErrors[word.pos]` by 1.

```javascript
// On wrong answer:
progress.words[word].posErrors[word.pos] = 
  (progress.words[word].posErrors[word.pos] || 0) + 1;
```

**Where it's used:** Aggregated across all words in the Home stats panel to show which POS categories the user struggles with most.

```javascript
// Aggregate across all words:
const totals = {};
Object.values(progress.words).forEach(w => {
  if (w.posErrors) {
    Object.entries(w.posErrors).forEach(([pos, count]) => {
      totals[pos] = (totals[pos] || 0) + count;
    });
  }
});
// Example output: { verb: 14, noun: 3, adj: 7 }
```

**Display:** Home stats panel shows a simple bar or list: "Most errors: verbs (14), adjectives (7), nouns (3)." No further action is taken — this is informational only in this cycle.

---

## 8. State Management Architecture

### 8.1 Core Principle

All state flows through a single `AppState` object. DOM elements **never write directly to localStorage**. The flow is:

```
User action → dispatch(action) → updateState(action) → render()
```

### 8.2 AppState Structure

```javascript
const AppState = {
  // Persistent (synced to localStorage)
  progress: {
    level: "A1",
    words: { /* word entries */ }
  },

  // Session (in-memory only)
  session: {
    words: [],          // full word list for this session (post-gate)
    round: 1,           // current round (1–5)
    queue: [],          // shuffled word order for current round
    current: 0,         // index in current round's queue
    results: {}         // { word: { r1: true, r2: false, ... } } — per-word per-round
  },

  // UI
  ui: {
    screen: "home",     // home | session | summary
    modal: null,        // null | "settings" | "wordList" | "quitConfirm"
    loading: false
  }
};
```

### 8.3 State Update Pattern

```javascript
function dispatch(action) {
  AppState = updateState(AppState, action);
  saveToStorage(AppState.progress); // only persist the progress slice
  render(AppState);
}
```

### 8.4 Render Pattern

```javascript
function render(state) {
  switch (state.ui.screen) {
    case "home":    renderHome(state); break;
    case "session": renderSession(state); break;
    case "summary": renderSummary(state); break;
  }
  // Modals render on top of current screen — always checked after screen render
  if (state.ui.modal) {
    renderModal(state.ui.modal, state);
  } else {
    closeModal();
  }
}
```

**Rule:** No direct DOM manipulation outside of render functions. No event handler should contain business logic — only `dispatch(action)` calls.

### 8.5 localStorage Size Discipline

Browsers enforce a ~5MB localStorage limit. This is not a concern for A1 (842 words) but becomes relevant at B1–C1 scale.

**Rule:** Never write `words.json` static content (definitions, example sentences) into localStorage. Only the `progress` slice is persisted — word status, interval, and nextReview date. A full A1–C1 progress object (5000+ words) stays well under 500KB.

```javascript
// ✅ Correct — only persist progress
saveToStorage(AppState.progress);

// ❌ Wrong — never store the full word data
saveToStorage({ progress: AppState.progress, words: allWordData });
```

## 9. API Key Security

### 9.1 The Problem

Section 5.5 (Production exercise) makes direct calls to the Anthropic API from the frontend. In a pure Vanilla JS app with no backend, any API key written into the source code is visible to anyone who opens DevTools → Sources.

**If this app is deployed publicly** (Vercel, Netlify, GitHub Pages), an exposed key can be found and used by others, draining your quota.

### 9.2 Chosen Approach — User-Supplied Key (Option A)

Since WordForge is a **personal-use app**, the simplest and most appropriate solution is to let the user (you) enter their own API key at first launch. The key is stored in `localStorage` and never appears in source code.

**First-launch flow:**
```
App opens → no API key in localStorage?
  → Show "Settings" modal
  → Input field: "Enter your Anthropic API Key"
  → Key saved to localStorage under "wf_api_key"
  → Modal dismissed, app proceeds normally
```

**API call with stored key:**
```javascript
const apiKey = localStorage.getItem('wf_api_key');

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  },
  body: JSON.stringify({ /* ... */ })
});
```

> **Note:** The `anthropic-dangerous-direct-browser-access: true` header is required for direct browser calls. Anthropic allows this for personal/development use — it acknowledges you understand the key is client-side.

**Settings access:** A gear icon in the corner always lets you view/reset the key.

### 9.3 Why Not Option B (Serverless Proxy)?

A Vercel/Netlify serverless function would properly secure the key server-side, but it introduces a backend dependency, environment variable management, and deployment complexity. For a personal-use app that runs on localhost or is shared with no one, this is unnecessary overhead. Option A is the correct tradeoff here.

---

## 10. Data Enrichment Pipeline

### 10.1 Goal

Enrich all 842 A1 words with `def`, `ex`, and `ex_tr` fields automatically via API.

### 10.2 Script Architecture

```
words_raw.json
     │
     ▼
enrich.js (Node.js)
     │  ← Anthropic API (batch)
     ▼
words_enriched.json
     │
     ▼
validate.js → console report (errors / empty fields)
```

### 10.3 Enrichment Script

```javascript
// enrich.js
const BATCH_SIZE = 10; // words per API call
const PROMPT = (word, pos, tr) => `
You are a language data generator. For the English word "${word}" (${pos}, meaning "${tr}" in Turkish):
Return ONLY a JSON object with no markdown:
{
  "def": "one short English definition, A1-friendly",
  "ex": ["sentence 1", "sentence 2", "sentence 3"],
  "ex_tr": ["turkish translation 1", "turkish translation 2", "turkish translation 3"]
}
Rules:
- def must be one sentence, plain English, no jargon
- ex must use the exact word form "${word}"
- ex sentences must be natural, common, simple (A1 level)
- ex_tr[i] must be the natural Turkish translation of ex[i] — same index, same count
- ex_tr must read naturally in Turkish, not word-for-word literal
`;
```

**Resume support:** Script tracks which words are already enriched. Re-running is safe.

### 10.4 Validation Script

```javascript
// validate.js — checks enriched data quality
words.forEach(w => {
  if (!w.def || w.def.trim() === '') log(`MISSING def: ${w.word}`);
  if (!w.ex || w.ex.length < 2) log(`MISSING ex: ${w.word}`);
  if (!w.ex_tr || w.ex_tr.length !== w.ex.length) log(`MISSING/MISMATCHED ex_tr: ${w.word}`);
  if (!w.ex.some(s => s.includes(w.word))) log(`ex missing target form: ${w.word}`);
});
```

---

## 11. Home & Stats Interaction

### 11.1 Stats Cards

Four cards on the home screen:

| Card | Clickable | Opens |
|------|-----------|-------|
| Learned | ✅ | Filtered word list |
| Known | ✅ | Filtered word list |
| Review Due | ✅ | Filtered word list (view-only) |
| Practice | ✅ | Filtered word list |

### 11.2 Word List Panel

Each row shows: **English word** | **Turkish** | **Status badge** | **Action buttons (text labels)**

**Available actions by status:**

| Status | Actions |
|--------|---------|
| Known | Move to Learned · Remove |
| Learned | Move to Known · Remove |
| Review Due | — (view only) |
| Practice | Mark as Known · Remove |

**Action semantics:**
- **Remove** → clears word state, returns it to the active learning pool as `practice`
- **Move actions** → update `localStorage` status immediately
- List re-renders instantly after any action (no page reload)

---

## 12. Visual System

### 12.1 Color Palette — Warm Night

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0f1117` | App background |
| `--bg-surface` | `#1a1d27` | Cards, panels |
| `--bg-elevated` | `#22263a` | Modals, dropdowns |
| `--accent` | `#f59e0b` | CTAs, highlights, badges |
| `--accent-dim` | `#92400e` | Hover states, secondary accent |
| `--success` | `#34d399` | Correct answer feedback |
| `--error` | `#f87171` | Wrong answer feedback |
| `--text-primary` | `#f1f0ed` | Main text |
| `--text-secondary` | `#94a3b8` | Labels, metadata |
| `--border` | `#2d3148` | Card borders, dividers |

### 12.2 Typography

- Font: **Inter** (Google Fonts)
- Base size: 16px
- Scale: 12 / 14 / 16 / 20 / 24 / 32px
- Word display: 32px bold, prominent
- Body: 16px regular

### 12.3 Motion

All transitions use CSS `transition` — no JS animation libraries.

| Interaction | Animation |
|-------------|-----------|
| Step change | Fade + 4px slide up (150ms ease-out) |
| Correct answer | Green flash on option card (200ms) |
| Wrong answer | Red flash + subtle shake (300ms) |
| Card tap | Scale 0.97 (100ms) |
| Screen transition | Fade (200ms) |

**Rule:** No animation should exceed 400ms. Motion is informative, not decorative.

### 12.4 Component Guidelines

- Cards: `border-radius: 12px`, subtle border, no drop shadows (flat on dark bg)
- Option chips (MC): full-width on mobile, equal-width grid on desktop
- Word chips (Sentence Builder): inline flex, amber border, tappable
- Answer area (Sentence Builder): dashed border, fills left-to-right
- CTA buttons: amber background, dark text, 48px min height

---

## 13. Accessibility

### 13.1 Keyboard Navigation

| Key | Action |
|-----|--------|
| `1` `2` `3` `4` | Select MC option by index |
| `Enter` | Confirm selection / advance step |
| `Backspace` | Remove last chip (Sentence Builder) |
| `Tab` | Focus next interactive element |
| `Escape` | Close modal / list panel |

### 13.2 ARIA & Contrast

- All interactive elements have `aria-label` attributes
- Options marked with `aria-selected` state
- Minimum contrast ratio: **4.5:1** for all text (WCAG AA)
- Focus rings visible on keyboard navigation (do not suppress `outline`)

---

## 14. Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `words.json` parse error | Console error, graceful empty state, no crash |
| Missing `def` field | Hide definition block entirely |
| Missing `ex` or `ex_tr` field | Skip Gap Fill, Sentence Builder, and Translation MC for that word |
| `ex` and `ex_tr` length mismatch | Treat as missing — skip all three exercises for that word |
| Anthropic API timeout / error | Skip Production exercise, mark word `learned` |
| Duplicate button clicks | Guard with `isProcessing` flag on all exercise callbacks |
| Corrupt `localStorage` | Reset to fresh state, log error to console |
| Word missing from state during action | Ignore action silently |

---

## 15. Rollout Plan

### Phase 1 — Data Enrichment
- [ ] Write `enrich.js` and `validate.js`
- [ ] Run enrichment for all 842 A1 words
- [ ] Validate output — 0 empty `def` / `ex`
- [ ] Spot-check 50 random words for quality

### Phase 2 — State Architecture
- [ ] Implement `AppState` + `dispatch` + `render` pattern
- [ ] Migrate all `localStorage` access to go through state layer
- [ ] Implement `calculateNextReview()` and review queue logic
- [ ] Wire level-completion detection

### Phase 3 — Exercise Engine
- [ ] EN → TR MC with distractor algorithm
- [ ] Gap Fill (bağlam bazlı, not word-recognition)
- [ ] Sentence Builder (tap-to-place chips)
- [ ] Translation MC (TR sentence → EN)
- [ ] Production + Anthropic API integration

### Phase 4 — UI & Visual Polish
- [ ] Warm Night palette + CSS variables
- [ ] Motion system (transitions, feedback animations)
- [ ] Home stats cards + word list panel
- [ ] Session size selector (5 / 10 / 20)
- [ ] Session summary screen

### Phase 5 — Accessibility & QA
- [ ] Keyboard navigation (1–4 keys, Enter, Backspace)
- [ ] ARIA labels + contrast audit
- [ ] Manual acceptance checklist (all 8 items from v2 spec)
- [ ] Bugfix pass

---

## 16. Non-Goals (This Cycle)

- Speech / listening exercises
- Cloud sync or authentication
- B1–C1 dataset enrichment
- Multi-user support
- Randomized exercise order (deferred to optional future toggle)
- Review Due list inline actions (view-only in this cycle)

---

## 17. Open Decisions

### Resolved
| Decision | Resolution |
|----------|-----------|
| Exercise set | EN→TR MC + Gap Fill + Sentence Builder + Translation MC + Production |
| TR→EN MC | Removed from active flow |
| Session grouping | Level-based (A1/A2...), not arbitrary session count |
| Session size control | User selects 5 / 10 / 20 per session |
| Distractor strategy | Same POS + same/adjacent level |
| Gap Fill design | Context-based — cümle anlama, not word recall |
| Spaced repetition storage | `localStorage` only, `Date.now()` comparison on app open |
| State management | Single `AppState` object, unidirectional flow |
| Data enrichment | Automated via Anthropic API script |
| Production exercise | AI-evaluated via Anthropic API, retry until correct |
| Randomize exercise order per word? | ❌ Fixed order — sabit sıra zihinsel yükü azaltır, pedagojik olarak daha sağlam |
| Review Due inline actions? | ❌ View-only — kullanıcının spaced repetition algoritmasını bypass etmesini önler |
| Error pattern analytics? | ✅ Basit POS sayaçları yeterli — MVP aşaması için detaylı analitik gereksiz |

### Pending
_Tüm kararlar çözüme kavuşturuldu._