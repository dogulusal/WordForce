# WordForge v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, production-ready English vocabulary learning app with round-based interleaving exercises, spaced repetition, and a polished Warm Night UI — fully client-side with no backend.

**Architecture:** Unidirectional data flow (dispatch → state → render), localStorage-only persistence for user progress, static word data loaded once at startup, Google Gemini API for Production exercise evaluation (user-supplied key).

**Tech Stack:** Vanilla HTML5 + CSS3 + ES6 JavaScript (zero dependencies), localStorage for persistence, Node.js scripts for data enrichment, Google Gemini API (Gemma 31B model, browser direct-call with API key).

---

## File Structure

### New Files to Create

```
index.html                          — SPA structure (5 screens: home, placement, learn, review, summary)
css/style.css                       — Warm Night theme, motion system, responsive layout
js/app.js                           — Core state management (AppState, dispatch, render pattern)
js/exercises.js                     — Exercise renderers (EN→TR MC, Gap Fill, Sentence Builder, Translation MC)
js/production.js                    — Production exercise + Gemini API integration
js/progress.js                      — User progress persistence & spaced repetition logic
js/placement.js                     — Placement test (gate) UI & logic
js/ui.js                            — Shared UI components (stats cards, word list panel, modals)
data/words.json                     — 842 A1 words (to be enriched)
scripts/enrich.js                   — Data enrichment: call Gemini API to generate def/ex/ex_tr
scripts/validate.js                 — Data validation: check enrichment quality, report gaps
```

### File Responsibilities

| File | Responsibility |
|------|-----------------|
| `index.html` | DOM structure, element references for rendering, no inline handlers |
| `css/style.css` | Warm Night palette, motion rules, responsive 640px max-width, component styles |
| `app.js` | Single source of truth (AppState), dispatch/updateState/render pattern, screen routing, session lifecycle |
| `exercises.js` | Pure renderers for 4 MC/interactive exercises (EN→TR, Gap Fill, Sentence Builder, Translation MC) |
| `production.js` | Production exercise + Gemini API call, response parsing, retry logic |
| `progress.js` | localStorage read/write, spaced repetition algorithm, interval progression |
| `placement.js` | Gate UI, quick-scan interaction, mark words as known |
| `ui.js` | Stats cards, word list panel, action buttons, modals (settings, quitConfirm), shared utilities |
| `words.json` | Raw word list (842 words) + enriched data (def, ex, ex_tr, ex_distractors, sb_distractors) |
| `enrich.js` | Node.js script: batch API calls to generate enriched fields + distractors, resume support |
| `validate.js` | Node.js script: QA check for missing/mismatched fields + distractors, console report |

---

## Phase 1: Data Enrichment

**Objective:** Enrich all 842 A1 words with `def`, `ex`, and `ex_tr` fields via Gemini API. Goal: 100% enrichment before implementation begins.

### Task 1.1: Set Up Enrichment Script

**Files:**
- Create: `scripts/enrich.js`

- [ ] **Step 1: Write skeleton enrich.js with file I/O**

```javascript
const fs = require('fs');
const path = require('path');

// Load raw words.json
const rawPath = path.join(__dirname, '../data/words.json');
const words = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));

console.log(`Loaded ${Object.keys(words).length} words`);
```

- [ ] **Step 2: Test file loads correctly**

Run: `node scripts/enrich.js`
Expected: Console logs "Loaded 842 words"

- [ ] **Step 3: Add Gemini API client**

```javascript
const { GoogleGenAI } = require('@google/genai');
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});
```

- [ ] **Step 4: Commit**

```bash
git add scripts/enrich.js
git commit -m "feat: skeleton enrich script with Gemini client"
```

---

### Task 1.2: Implement Enrichment Batch Function

**Files:**
- Modify: `scripts/enrich.js`

- [ ] **Step 1: Write prompt generator function**

```javascript
function generatePrompt(word, pos, tr) {
  return `You are a language data generator. For the English word "${word}" (${pos}, meaning "${tr}" in Turkish):
Return ONLY a JSON object with no markdown:
{
  "def": "one short English definition, A1-friendly",
  "ex": ["sentence 1", "sentence 2", "sentence 3"],
  "ex_tr": ["turkish translation 1", "turkish translation 2", "turkish translation 3"],
  "ex_distractors": [["alt eng 1", "alt eng 2", "alt eng 3"], ...],
  "sb_distractors": [["alt word 1", "alt word 2", "alt word 3"], ...]
}
Rules:
- def, ex, ex_tr as before
- ex_distractors[i]: 3 plausible but incorrect translations of ex[i] (differ in grammar, pronoun, tense)
- sb_distractors[i]: 3 English word alternatives that fit sentence structure (same pos as target word)
- All alternatives must be A1-level vocabulary, contextually relevant`;
}
```

- [ ] **Step 2: Write batch API function**

```javascript
async function enrichBatch(wordList, maxRetries = 3) {
  const batchPromise = wordList.map(async (word) => {
    const { word: w, pos, tr } = word;
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const message = await client.messages.create({
          model: "gemma-4-31b-it",
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: generatePrompt(w, pos, tr)
          }]
        });
        const raw = message.content[0].text;
        const clean = raw.replace(/```json|```/g, '').trim();
        return { word: w, data: JSON.parse(clean) };
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          // On rate limit or overload error, wait exponentially longer before retry
          const waitMs = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s
          console.warn(`Attempt ${attempt + 1}/${maxRetries} failed for ${w}, retrying in ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
        }
      }
    }
    
    throw new Error(`Failed to enrich ${w} after ${maxRetries} attempts: ${lastError.message}`);
  });
  return Promise.all(batchPromise);
}
```

- [ ] **Step 3: Test with 1 word**

Modify enrich.js to call enrichBatch with a single test word, log the result

Run: `GEMINI_API_KEY=<key> node scripts/enrich.js`
Expected: Console logs enriched def/ex/ex_tr for that word

- [ ] **Step 4: Commit**

```bash
git add scripts/enrich.js
git commit -m "feat: batch enrichment with Gemini API"
```

---

### Task 1.3: Add Resume Support & Full Enrichment

**Files:**
- Modify: `scripts/enrich.js`
- Create: `data/words_enriched.json` (auto-generated)

- [ ] **Step 1: Track already-enriched words**

```javascript
const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
let enriched = {};
if (fs.existsSync(enrichedPath)) {
  enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
}

const toEnrich = Object.keys(words)
  .filter(word => !enriched[word])
  .map(word => ({ word, ...words[word] }));

console.log(`Found ${toEnrich.length} words to enrich (skipping ${Object.keys(enriched).length})`);
```

- [ ] **Step 2: Process in BATCH_SIZE chunks with delays**

```javascript
const BATCH_SIZE = 10;
const DELAY_MS = 1000; // 1 sec between batches to avoid rate limits

async function enrichAll() {
  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Processing batch ${batchNum}/${Math.ceil(toEnrich.length / BATCH_SIZE)}...`);
    
    try {
      const results = await enrichBatch(batch);
      results.forEach(({ word, data }) => {
        enriched[word] = { ...words[word], ...data };
      });
      fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));
      console.log(`✅ Batch ${batchNum} completed`);
    } catch (error) {
      console.error(`❌ Batch ${batchNum} failed: ${error.message}`);
      console.error('Stopping enrichment. Fix the error and run the script again (resume will skip already-enriched words).');
      process.exit(1);
    }
    
    if (i + BATCH_SIZE < toEnrich.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
}
```

- [ ] **Step 3: Run enrichment (will take 10–15 minutes for 842 words)**

Run: `GEMINI_API_KEY=<key> node scripts/enrich.js`
Expected: Console logs batch progress, file `data/words_enriched.json` grows

- [ ] **Step 4: Commit**

```bash
git add scripts/enrich.js data/words_enriched.json
git commit -m "feat: full enrichment with 842 words (resume-safe)"
```

---

### Task 1.4: Data Validation & Quality Assurance

**Files:**
- Create: `scripts/validate.js`

- [ ] **Step 1: Write validation checks**

```javascript
const fs = require('fs');
const path = require('path');

const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));

const errors = [];

Object.entries(enriched).forEach(([word, data]) => {
  if (!data.def || data.def.trim() === '') errors.push(`MISSING def: ${word}`);
  if (!data.ex || data.ex.length < 2) errors.push(`MISSING ex: ${word}`);
  if (!data.ex_tr || data.ex_tr.length !== data.ex.length) {
    errors.push(`MISSING/MISMATCHED ex_tr: ${word}`);
  }
  if (!data.ex.some(s => s.includes(word))) {
    errors.push(`ex missing target form: ${word}`);
  }
  if (!data.ex_distractors || data.ex_distractors.length !== data.ex.length) {
    errors.push(`MISSING/MISMATCHED ex_distractors: ${word}`);
  }
  if (!data.sb_distractors || data.sb_distractors.length !== data.ex.length) {
    errors.push(`MISSING/MISMATCHED sb_distractors: ${word}`);
  }
  data.ex_distractors?.forEach((dists, i) => {
    if (!Array.isArray(dists) || dists.length !== 3) {
      errors.push(`ex_distractors[${i}] should be 3-item array: ${word}`);
    }
  });
  data.sb_distractors?.forEach((dists, i) => {
    if (!Array.isArray(dists) || dists.length !== 3) {
      errors.push(`sb_distractors[${i}] should be 3-item array: ${word}`);
    }
  });
});

if (errors.length === 0) {
  console.log(`✅ All ${Object.keys(enriched).length} words validated successfully`);
} else {
  console.log(`❌ ${errors.length} validation errors:\n${errors.join('\n')}`);
  process.exit(1);
}
```

- [ ] **Step 2: Run validation**

Run: `node scripts/validate.js`
Expected: Either ✅ all words validated, or ❌ list of errors

- [ ] **Step 3: Spot-check 10 random words manually**

Open `data/words_enriched.json`, pick 10 random words, verify:
- def is one sentence, A1-friendly English
- ex[i] contains the target word form
- ex_tr[i] is natural Turkish translation of ex[i]

- [ ] **Step 4: Commit**

```bash
git add scripts/validate.js
git commit -m "feat: data validation script (0 errors)"
```

---

## Phase 2: State Architecture

**Objective:** Implement the unidirectional data flow pattern (dispatch → updateState → render), localStorage persistence, and spaced repetition logic.

### Task 2.1: Core App State & Dispatch

**Files:**
- Create: `js/app.js`
- Create: `index.html` (skeleton)

- [ ] **Step 1: Create index.html with element references**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="css/style.css">
  <title>WordForge</title>
</head>
<body>
  <div id="app"></div>
  <div id="modal-container"></div>
  <script src="js/progress.js"></script>
  <script src="js/exercises.js"></script>
  <script src="js/production.js"></script>
  <script src="js/ui.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Define AppState shape**

```javascript
let AppState = {
  progress: {
    level: "A1",
    words: {}  // { word: { status, interval, nextReview, posErrors } }
  },
  session: {
    words: [],
    round: 1,
    queue: [],
    current: 0,
    results: {}
  },
  ui: {
    screen: "home",
    modal: null,
    loading: false
  }
};
```

- [ ] **Step 3: Write updateState function (pure)**

```javascript
function updateState(currentState, action) {
  const newState = structuredClone(currentState); // deep copy (modern, faster alternative to JSON.parse/stringify)
  
  switch (action.type) {
    case 'LOAD_PROGRESS':
      newState.progress = action.payload;
      break;
    case 'SET_SCREEN':
      newState.ui.screen = action.payload;
      break;
    case 'SET_MODAL':
      newState.ui.modal = action.payload;
      break;
    // ... more actions
  }
  return newState;
}
```

- [ ] **Step 4: Write dispatch function**

```javascript
function dispatch(action) {
  AppState = updateState(AppState, action);
  saveProgress(AppState.progress);
  render(AppState);
}
```

- [ ] **Step 5: Test dispatch with simple action**

```javascript
dispatch({ type: 'SET_SCREEN', payload: 'home' });
console.log(AppState.ui.screen); // should be "home"
```

- [ ] **Step 6: Commit**

```bash
git add js/app.js index.html
git commit -m "feat: core app state and dispatch pattern"
```

---

### Task 2.2: localStorage Persistence

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Write saveProgress function**

```javascript
function saveProgress(progress) {
  const json = JSON.stringify(progress);
  localStorage.setItem('wf_progress', json);
  console.log(`Saved ${json.length} bytes to localStorage`);
}
```

- [ ] **Step 2: Write loadProgress function**

```javascript
function loadProgress() {
  const json = localStorage.getItem('wf_progress');
  if (!json) {
    return { level: "A1", words: {} };
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error('Corrupt localStorage, resetting:', e);
    localStorage.removeItem('wf_progress');
    return { level: "A1", words: {} };
  }
}
```

- [ ] **Step 3: Call loadProgress on app start**

```javascript
AppState.progress = loadProgress();
console.log(`Loaded progress for level ${AppState.progress.level}`);
```

- [ ] **Step 4: Test persistence manually**

Open DevTools → Application → localStorage, verify `wf_progress` is stored as JSON

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: localStorage persistence for user progress"
```

---

### Task 2.3: Spaced Repetition Algorithm

**Files:**
- Create: `js/progress.js`

- [ ] **Step 1: Write calculateNextReview function**

```javascript
function calculateNextReview(currentInterval, wasCorrect) {
  const intervals = [1, 3, 7, 14, 30];
  if (!wasCorrect) return 1;
  const currentIndex = intervals.indexOf(currentInterval);
  if (currentIndex === -1) return 1; // unknown interval, reset
  if (currentIndex === intervals.length - 1) return null; // retired
  return intervals[currentIndex + 1];
}
```

- [ ] **Step 2: Write test for calculateNextReview**

```javascript
console.assert(calculateNextReview(1, true) === 3, "1→3 on correct");
console.assert(calculateNextReview(3, false) === 1, "3→1 on wrong");
console.assert(calculateNextReview(30, true) === null, "30→null (retired)");
console.log("✅ All spaced repetition tests passed");
```

- [ ] **Step 3: Run test**

Run: `node js/progress.js`
Expected: ✅ All spaced repetition tests passed

- [ ] **Step 4: Write getReviewDue function**

```javascript
function getReviewDue(progress) {
  // Use local date string (timezone-safe) instead of UTC
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  return Object.entries(progress.words)
    .filter(([_, data]) => data.status === 'learned' && data.nextReview <= today)
    .map(([word, _]) => word);
}
```

- [ ] **Step 5: Commit**

```bash
git add js/progress.js
git commit -m "feat: spaced repetition algorithm and review queue"
```

---

### Task 2.4: Session Initiation Logic

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Write initiateSession function**

```javascript
function initiateSession(sessionSize) {
  // Get review-due words first, then fill with practice words
  const reviewDue = getReviewDue(AppState.progress);
  const practiceWords = Object.keys(AppState.progress.words)
    .filter(w => AppState.progress.words[w].status === 'practice');
  
  const sessionWords = [
    ...reviewDue.slice(0, sessionSize),
    ...practiceWords.slice(0, Math.max(0, sessionSize - reviewDue.length))
  ].slice(0, sessionSize);
  
  AppState.session = {
    words: sessionWords,
    round: 1,
    queue: shuffle(sessionWords),
    current: 0,
    results: {}
  };
  
  dispatch({ type: 'SET_SCREEN', payload: 'gate' });
}
```

- [ ] **Step 2: Write shuffle function**

```javascript
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}
```

- [ ] **Step 3: Test initiateSession with mock progress**

Create a test state with some practice words, call initiateSession(5), verify session.words has 5 items

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: session initiation with review priority"
```

---

## Phase 3: Exercise Engine

**Objective:** Implement all 4 interactive exercise types (EN→TR MC, Gap Fill, Sentence Builder, Translation MC) + Production exercise with AI evaluation.

### Task 3.1: Load Words Data

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Add words.json loading**

```javascript
let AllWords = {};

async function loadWords() {
  const response = await fetch('data/words_enriched.json');
  AllWords = await response.json();
  console.log(`Loaded ${Object.keys(AllWords).length} words`);
}

// Call on app start
loadWords().then(() => {
  AppState.progress = loadProgress();
  render(AppState);
});
```

- [ ] **Step 2: Test fetch in browser**

Run dev server, open DevTools console, verify AllWords is populated

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: load words.json on app start"
```

---

### Task 3.2: EN → TR Multiple Choice Exercise

**Files:**
- Create: `js/exercises.js`

- [ ] **Step 1: Write distractor selection algorithm**

```javascript
function selectDistractors(word, count = 3) {
  const target = AllWords[word];
  const { pos, level } = target;
  
  // Preferred pool: same pos + same level
  let pool = Object.keys(AllWords)
    .filter(w => w !== word && AllWords[w].pos === pos && AllWords[w].level === level);
  
  if (pool.length < count) {
    // Fallback: same pos + adjacent level
    pool = Object.keys(AllWords)
      .filter(w => w !== word && AllWords[w].pos === pos && 
              Math.abs(CEFR_RANK[AllWords[w].level] - CEFR_RANK[level]) === 1);
  }
  
  return pool.slice(0, count).map(w => AllWords[w].tr);
}

const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
```

- [ ] **Step 2: Write renderENtoTRMC function**

```javascript
function renderENtoTRMC(word) {
  const wordData = AllWords[word];
  const correctTr = wordData.tr;
  const distractors = selectDistractors(word);
  const options = [correctTr, ...distractors].sort(() => Math.random() - 0.5);
  
  return {
    type: 'EN_TO_TR_MC',
    prompt: `What does '${word}' mean in Turkish?`,
    options: options,
    correct: correctTr,
    word: word
  };
}
```

- [ ] **Step 3: Test renderENtoTRMC with a real word**

```javascript
const exercise = renderENtoTRMC('need');
console.log(exercise.prompt);
console.log(exercise.options);
console.assert(exercise.options.includes(exercise.correct), "Correct answer in options");
```

- [ ] **Step 4: Write handler for option selection**

```javascript
function handleMCAnswer(word, selectedOption, correctAnswer, roundNumber) {
  const isCorrect = selectedOption === correctAnswer;
  
  if (!AppState.session.results[word]) {
    AppState.session.results[word] = {};
  }
  AppState.session.results[word][`r${roundNumber}`] = isCorrect;
  
  if (!isCorrect && AppState.progress.words[word]) {
    const pos = AllWords[word].pos;
    AppState.progress.words[word].posErrors[pos] = 
      (AppState.progress.words[word].posErrors[pos] || 0) + 1;
  }
  
  return isCorrect;
}
```

- [ ] **Step 5: Commit**

```bash
git add js/exercises.js
git commit -m "feat: EN→TR MC exercise with distractor algorithm"
```

---

### Task 3.3: Gap Fill Exercise

**Files:**
- Modify: `js/exercises.js`

- [ ] **Step 1: Write renderGapFill function**

```javascript
function renderGapFill(word) {
  const wordData = AllWords[word];
  const sentences = wordData.ex;
  const sentence = sentences[0]; // use first example
  const blank = '___';
  
  // Replace target word with blank
  const gappedSentence = sentence.replace(
    new RegExp(`\\b${word}s?\\b`, 'i'), 
    blank
  );
  
  const distractors = selectDistractors(word);
  const options = [word, ...distractors].sort(() => Math.random() - 0.5);
  
  return {
    type: 'GAP_FILL',
    sentence: gappedSentence,
    options: options,
    correct: word,
    word: word
  };
}
```

- [ ] **Step 2: Write handler**

```javascript
function handleGapFill(word, selectedOption, roundNumber) {
  const isCorrect = selectedOption === word;
  AppState.session.results[word][`r${roundNumber}`] = isCorrect;
  
  if (!isCorrect && AppState.progress.words[word]) {
    const pos = AllWords[word].pos;
    AppState.progress.words[word].posErrors[pos] = 
      (AppState.progress.words[word].posErrors[pos] || 0) + 1;
  }
  
  return isCorrect;
}
```

- [ ] **Step 3: Test with a real word**

```javascript
const exercise = renderGapFill('need');
console.log(exercise.sentence);
console.log(exercise.options);
console.assert(exercise.options.includes(exercise.correct));
```

- [ ] **Step 4: Commit**

```bash
git add js/exercises.js
git commit -m "feat: Gap Fill exercise with context-based cloze"
```

---

### Task 3.4: Sentence Builder Exercise

**Files:**
- Modify: `js/exercises.js`

- [ ] **Step 1: Write renderSentenceBuilder function**

```javascript
function renderSentenceBuilder(word) {
  const wordData = AllWords[word];
  const sentenceIndex = Math.floor(Math.random() * wordData.ex.length);
  const trSentence = wordData.ex_tr[sentenceIndex];
  const enSentence = wordData.ex[sentenceIndex];
  
  // Split into chips, normalize (lowercase, no punctuation)
  const chips = enSentence
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/[.,!?;:]/g, ''));
  
  // Get distractors from enriched data
  const distractors = wordData.sb_distractors[sentenceIndex] || [];
  
  const allChips = [...chips, ...distractors]
    .sort(() => Math.random() - 0.5);
  
  return {
    type: 'SENTENCE_BUILDER',
    trSentence: trSentence,
    chips: allChips,
    correct: chips.join(' '),
    sentenceIndex: sentenceIndex,
    word: word
  };
}
```

- [ ] **Step 2: Write handler**

```javascript
function handleSentenceBuilder(word, userAnswer, roundNumber, sentenceIndex) {
  const expected = AllWords[word].ex[sentenceIndex]
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .split(/\s+/)
    .join(' ');
  
  const userNorm = userAnswer
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .split(/\s+/)
    .join(' ');
  
  const isCorrect = userNorm === expected;
  AppState.session.results[word][`r${roundNumber}`] = isCorrect;
  
  if (!isCorrect && AppState.progress.words[word]) {
    const pos = AllWords[word].pos;
    AppState.progress.words[word].posErrors[pos] = 
      (AppState.progress.words[word].posErrors[pos] || 0) + 1;
  }
  
  return isCorrect;
}
```

- [ ] **Step 3: Commit**

```bash
git add js/exercises.js
git commit -m "feat: Sentence Builder exercise with chip normalization"
```

---

### Task 3.5: Translation MC Exercise

**Files:**
- Modify: `js/exercises.js`

- [ ] **Step 1: Write renderTranslationMC function**

```javascript
function renderTranslationMC(word) {
  const wordData = AllWords[word];
  const sentenceIndex = Math.floor(Math.random() * wordData.ex.length);
  const trSentence = wordData.ex_tr[sentenceIndex];
  const correctEN = wordData.ex[sentenceIndex];
  
  // Get pre-generated distractors from enriched data
  const distractors = wordData.ex_distractors[sentenceIndex] || [];
  
  const options = [correctEN, ...distractors]
    .sort(() => Math.random() - 0.5);
  
  return {
    type: 'TRANSLATION_MC',
    trSentence: trSentence,
    options: options,
    correct: correctEN,
    sentenceIndex: sentenceIndex,
    word: word
  };
}
```

- [ ] **Step 2: Write handler**

```javascript
function handleTranslationMC(word, selectedOption, roundNumber, sentenceIndex) {
  const correct = AllWords[word].ex[sentenceIndex];
  const isCorrect = selectedOption === correct;
  AppState.session.results[word][`r${roundNumber}`] = isCorrect;
  
  if (!isCorrect && AppState.progress.words[word]) {
    const pos = AllWords[word].pos;
    AppState.progress.words[word].posErrors[pos] = 
      (AppState.progress.words[word].posErrors[pos] || 0) + 1;
  }
  
  return isCorrect;
}
```

- [ ] **Step 3: Commit**

```bash
git add js/exercises.js
git commit -m "feat: Translation MC exercise (TR→EN)"
```

---

### Task 3.6: Production Exercise & Gemini API

**Files:**
- Create: `js/production.js`

- [ ] **Step 1: Write Production exercise renderer**

```javascript
function renderProduction(word) {
  return {
    type: 'PRODUCTION',
    prompt: `Write your own sentence using '${word}'.`,
    word: word,
    pos: AllWords[word].pos
  };
}
```

- [ ] **Step 2: Write Gemini API call function**

```javascript
async function evaluateProduction(word, userSentence) {
  const apiKey = localStorage.getItem('wf_api_key');
  if (!apiKey) {
    console.error('No API key in localStorage');
    return { correct: false, feedback: 'API key not configured' };
  }
  
  const pos = AllWords[word].pos;
  const model = localStorage.getItem('wf_model') || 'gemma-4-31b-it';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `Evaluate this sentence for correct use of the word "${word}" (${pos}).
Sentence: "${userSentence}"
Reply in JSON only: { "correct": true/false, "feedback": "one sentence explanation" }
If correct, feedback should confirm why it works.
If incorrect, explain the specific error clearly in one sentence.` }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 300
      }
    })
  });
  
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = raw.replace(/```json|```/g, '').trim();
  
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('Failed to parse API response:', e);
    return { correct: false, feedback: 'API error, please try again' };
  }
}
```

- [ ] **Step 3: Write handler with retry logic**

```javascript
async function handleProduction(word, userSentence, roundNumber) {
  const result = await evaluateProduction(word, userSentence);
  AppState.session.results[word][`r${roundNumber}`] = result.correct;
  
  if (!result.correct && AppState.progress.words[word]) {
    AppState.progress.words[word].posErrors[AllWords[word].pos]++;
  }
  
  return result;
}
```

- [ ] **Step 4: Test API call with mock key**

Set a test API key in localStorage, call evaluateProduction('need', 'I need water'), verify response structure

- [ ] **Step 5: Commit**

```bash
git add js/production.js
git commit -m "feat: Production exercise with Gemini API evaluation"
```

---

## Phase 4: UI & Visual Polish

**Objective:** Implement Warm Night visual system, session flow UI, and home screen.

### Task 4.1: Warm Night CSS System

**Files:**
- Create: `css/style.css`

- [ ] **Step 1: Write CSS variables and base styles**

```css
:root {
  --bg-primary: #0f1117;
  --bg-surface: #1a1d27;
  --bg-elevated: #22263a;
  --accent: #f59e0b;
  --accent-dim: #92400e;
  --success: #34d399;
  --error: #f87171;
  --text-primary: #f1f0ed;
  --text-secondary: #94a3b8;
  --border: #2d3148;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

#app {
  max-width: 680px;
  margin: 0 auto;
  padding: 16px;
}
```

- [ ] **Step 2: Write motion/transition utilities**

```css
.fade-in {
  animation: fadeIn 150ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.green-flash {
  animation: greenFlash 200ms ease-out;
}

@keyframes greenFlash {
  0%, 100% { background-color: var(--bg-surface); }
  50% { background-color: var(--success); }
}

.shake {
  animation: shake 300ms ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
```

- [ ] **Step 3: Write card and button styles**

```css
.card {
  background-color: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.btn {
  background-color: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: 8px;
  padding: 12px 16px;
  min-height: 48px;
  font-size: 16px;
  cursor: pointer;
  transition: background-color 150ms;
}

.btn:hover {
  background-color: var(--accent-dim);
}

.option {
  display: flex;
  padding: 12px;
  margin: 8px 0;
  border: 2px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms;
}

.option.selected {
  border-color: var(--accent);
  background-color: rgba(245, 158, 11, 0.1);
}
```

- [ ] **Step 4: Test visual system in browser**

Create a simple test page with cards, buttons, options, verify Warm Night colors and motion

- [ ] **Step 5: Commit**

```bash
git add css/style.css
git commit -m "feat: Warm Night theme with motion system"
```

---

### Task 4.2: Render Functions & Screen Routing

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Write render function dispatcher**

```javascript
function render(state) {
  const app = document.getElementById('app');
  
  switch (state.ui.screen) {
    case 'home':
      renderHome(state);
      break;
    case 'gate':
      renderGate(state);
      break;
    case 'round':
      renderRound(state);
      break;
    case 'summary':
      renderSummary(state);
      break;
    default:
      app.innerHTML = '<p>Unknown screen</p>';
  }
  
  // Render modals on top
  if (state.ui.modal) {
    renderModal(state.ui.modal, state);
  }
}
```

- [ ] **Step 2: Write renderHome function**

```javascript
function renderHome(state) {
  const app = document.getElementById('app');
  const { words } = state.progress;
  
  const learned = Object.keys(words).filter(w => words[w].status === 'learned').length;
  const known = Object.keys(words).filter(w => words[w].status === 'known').length;
  const practice = Object.keys(words).filter(w => words[w].status === 'practice').length;
  const reviewDue = getReviewDue(state.progress).length;
  
  app.innerHTML = `
    <div class="home-screen fade-in">
      <h1>WordForge</h1>
      <div class="stats-grid">
        <div class="card stats-card" onclick="dispatch({type: 'OPEN_WORD_LIST', filter: 'learned'})">
          <div class="stat-number">${learned}</div>
          <div class="stat-label">Learned</div>
        </div>
        <div class="card stats-card" onclick="dispatch({type: 'OPEN_WORD_LIST', filter: 'known'})">
          <div class="stat-number">${known}</div>
          <div class="stat-label">Known</div>
        </div>
        <div class="card stats-card" onclick="dispatch({type: 'OPEN_WORD_LIST', filter: 'review'})">
          <div class="stat-number">${reviewDue}</div>
          <div class="stat-label">Review Due</div>
        </div>
        <div class="card stats-card" onclick="dispatch({type: 'OPEN_WORD_LIST', filter: 'practice'})">
          <div class="stat-number">${practice}</div>
          <div class="stat-label">Practice</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="dispatch({type: 'START_SESSION', size: 10})">
        Start Session (10 words)
      </button>
      <button class="btn" onclick="dispatch({type: 'OPEN_MODAL', modal: 'settings'})">
        ⚙️ Settings
      </button>
    </div>
  `;
}
```

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: render functions and home screen UI"
```

---

### Task 4.3: Gate & Round Screens

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Write renderGate function**

```javascript
function renderGate(state) {
  const app = document.getElementById('app');
  const word = state.session.queue[state.session.current];
  
  if (!word) {
    // Gate complete, move to Round 1
    dispatch({ type: 'START_ROUND', round: 1 });
    return;
  }
  
  app.innerHTML = `
    <div class="gate-screen fade-in">
      <h2>Do you know this word?</h2>
      <div class="word-display">${word}</div>
      <button class="btn btn-success" onclick="dispatch({type: 'MARK_KNOWN', word: '${word}'})">
        Yes, I know it
      </button>
      <button class="btn" onclick="dispatch({type: 'NEXT_GATE_ITEM'})">
        No, teach me
      </button>
    </div>
  `;
}
```

- [ ] **Step 2: Write renderRound function (generic for all rounds)**

```javascript
function renderRound(state) {
  const word = state.session.queue[state.session.current];
  const round = state.session.round;
  
  let exercise;
  if (round === 1) {
    exercise = renderDefinition(word);
  } else if (round === 2) {
    exercise = renderENtoTRMC(word);
  } else if (round === 3) {
    exercise = renderGapFill(word);
  } else if (round === 4) {
    // Alternate between Sentence Builder and Translation MC based on word index
    exercise = state.session.current % 2 === 0 ? 
      renderSentenceBuilder(word) : 
      renderTranslationMC(word);
  } else {
    exercise = renderProduction(word);
  }
  
  renderExerciseUI(exercise, word, round);
}
```

- [ ] **Step 3: Write renderExerciseUI (handles all exercise types)**

```javascript
function renderExerciseUI(exercise, word, round) {
  const app = document.getElementById('app');
  
  app.innerHTML = `
    <div class="exercise-screen fade-in">
      <div class="progress-bar">
        Round ${round}/5, Word ${AppState.session.current + 1}/${AppState.session.words.length}
      </div>
      <div class="exercise-container">
        ${renderExerciseContent(exercise)}
      </div>
      <button class="btn btn-quit" onclick="dispatch({type: 'OPEN_MODAL', modal: 'quitConfirm'})">
        ✕ End Session
      </button>
    </div>
  `;
}
```

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: Gate and Round rendering with exercise UI"
```

---

### Task 4.4: Settings & Word List Modals

**Files:**
- Create: `js/ui.js`

- [ ] **Step 1: Write renderModal dispatcher**

```javascript
function renderModal(modalType, state) {
  const container = document.getElementById('modal-container');
  
  let modalHTML = '';
  
  switch (modalType) {
    case 'settings':
      modalHTML = renderSettingsModal(state);
      break;
    case 'wordList':
      modalHTML = renderWordListModal(state);
      break;
    case 'quitConfirm':
      modalHTML = renderQuitConfirmModal();
      break;
  }
  
  // Render into modal container (does NOT overwrite event listeners)
  container.innerHTML = `
    <div class="modal-overlay" onclick="dispatch({type: 'CLOSE_MODAL'})">
      <div class="modal" onclick="event.stopPropagation()">
        ${modalHTML}
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: Write renderSettingsModal**

```javascript
function renderSettingsModal(state) {
  const apiKey = localStorage.getItem('wf_api_key') || '';
  
  return `
    <h2>Settings</h2>
    <label>
      Gemini API Key:
      <input type="password" id="apiKeyInput" value="${apiKey}" placeholder="sk-...">
    </label>
    <button class="btn" onclick="saveAPIKey(document.getElementById('apiKeyInput').value)">
      Save Key
    </button>
    <button class="btn" onclick="dispatch({type: 'CLOSE_MODAL'})">
      Close
    </button>
  `;
}

function saveAPIKey(key) {
  localStorage.setItem('wf_api_key', key);
  console.log('API key saved');
  dispatch({ type: 'CLOSE_MODAL' });
}
```

- [ ] **Step 3: Write renderWordListModal**

```javascript
function renderWordListModal(state) {
  const filter = state.ui.wordListFilter || 'practice';
  const { words } = state.progress;
  
  const filtered = Object.entries(words)
    .filter(([_, data]) => {
      if (filter === 'review') {
        return data.status === 'learned' && 
               data.nextReview <= new Date().toLocaleDateString('en-CA');
      }
      return data.status === filter;
    })
    .map(([word, data]) => `
      <div class="word-row">
        <span class="word-en">${word}</span>
        <span class="word-tr">${AllWords[word]?.tr || ''}</span>
        <span class="status-badge">${data.status}</span>
        <button onclick="dispatch({type: 'MARK_KNOWN', word: '${word}'})">
          ${data.status === 'practice' ? 'Mark Known' : 'Remove'}
        </button>
      </div>
    `)
    .join('');
  
  return `
    <h2>${filter} Words (${filtered.length})</h2>
    <div class="word-list">${filtered}</div>
    <button class="btn" onclick="dispatch({type: 'CLOSE_MODAL'})">Close</button>
  `;
}
```

- [ ] **Step 4: Write renderQuitConfirmModal**

```javascript
function renderQuitConfirmModal() {
  return `
    <h2>End this session?</h2>
    <p>Progress so far will be saved.</p>
    <button class="btn btn-danger" onclick="dispatch({type: 'QUIT_SESSION'})">
      End Session
    </button>
    <button class="btn" onclick="dispatch({type: 'CLOSE_MODAL'})">
      Keep Going
    </button>
  `;
}
```

- [ ] **Step 5: Commit**

```bash
git add js/ui.js
git commit -m "feat: Settings, word list, and quit confirmation modals"
```

---

## Phase 5: Accessibility & QA

### Task 5.1: Keyboard Navigation

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Add keyboard event listeners**

```javascript
document.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '4') {
    const optionIndex = parseInt(e.key) - 1;
    dispatch({ type: 'SELECT_OPTION_BY_INDEX', index: optionIndex });
  } else if (e.key === 'Enter') {
    dispatch({ type: 'CONFIRM_SELECTION' });
  } else if (e.key === 'Backspace') {
    dispatch({ type: 'REMOVE_LAST_CHIP' });
  } else if (e.key === 'Escape') {
    dispatch({ type: 'CLOSE_MODAL' });
  }
});
```

- [ ] **Step 2: Test keyboard navigation manually**

Open app, test 1–4 keys select options, Enter advances, Escape closes modals

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: keyboard navigation (1-4, Enter, Backspace, Escape)"
```

---

### Task 5.2: ARIA Labels & Contrast Audit

**Files:**
- Modify: `js/app.js`, `css/style.css`

- [ ] **Step 1: Add ARIA labels to interactive elements**

```javascript
// In renderExerciseUI:
app.innerHTML = `
  <div class="exercise-screen fade-in" role="main" aria-label="Exercise">
    <div class="progress-bar" aria-live="polite" aria-label="Progress Round ${round} of 5">
      Round ${round}/5, Word ${AppState.session.current + 1}/${AppState.session.words.length}
    </div>
    ${/* ... */}
  </div>
`;

// In options:
const optionHTML = options.map((opt, i) => `
  <button 
    class="option" 
    role="option"
    aria-selected="false"
    aria-label="Option ${i + 1}: ${opt}"
    onclick="selectOption(${i})"
  >
    ${opt}
  </button>
`).join('');
```

- [ ] **Step 2: Verify contrast ratios in CSS**

Check all color pairs:
- Text on bg-primary: contrast ≥ 4.5:1
- Text on bg-surface: contrast ≥ 4.5:1
- Accent buttons: contrast ≥ 4.5:1

Use WebAIM contrast checker to verify. If contrast fails, adjust colors.

- [ ] **Step 3: Commit**

```bash
git add js/app.js css/style.css
git commit -m "feat: ARIA labels and contrast audit (WCAG AA)"
```

---

### Task 5.3: Manual Acceptance Testing

**Files:**
- (No code changes)

- [ ] **Step 1: Test Home Screen**
- Stats cards display correct counts
- All 4 cards are clickable and open word lists
- Settings button opens modal
- Start Session button initiates a new session

- [ ] **Step 2: Test Session Flow**
- Gate: displays words, marks known/skips
- Round 1: shows definitions, "Got it" advances
- Round 2: EN→TR MC, wrong answer shows red+green, auto-advances after 1s
- Round 3: Gap Fill works with context
- Round 4: alternates between Sentence Builder and Translation MC
- Round 5: Production → API evaluates, retry on wrong, advance on correct

- [ ] **Step 3: Test Quit Flow**
- "✕ End Session" visible at all times
- Tapping shows quitConfirm modal
- "Keep Going" closes modal
- "End Session" saves progress and returns to Home
- Partial results are saved (words completed through current round)

- [ ] **Step 4: Test Persistence**
- Close app mid-session, reopen → progress persists
- Mark words as known → reload → status remains
- Spaced repetition intervals advance correctly

- [ ] **Step 5: Test API Key Flow**
- First launch with no API key → Settings modal appears
- Enter API key → stored in localStorage
- Production exercise uses the key
- Can reset key in Settings

- [ ] **Step 6: Commit test results**

```bash
git commit -m "test: manual acceptance testing complete (all criteria pass)"
```

---

### Task 5.4: Bug Fixes & Polish

**Files:**
- (Various based on issues found)

- [ ] **Step 1: Document any bugs found during testing**

Create a checklist of issues, prioritize by severity

- [ ] **Step 2: Fix critical bugs (break core flow)**

Examples:
- Session not advancing after Round 5
- Progress not persisting
- API key not being used

- [ ] **Step 3: Fix medium bugs (UX issues)**

Examples:
- Animations stuttering
- Modals not closing properly
- Word list not filtering correctly

- [ ] **Step 4: Fix cosmetic issues**

Examples:
- Spacing off on mobile
- Colors not quite right
- Typography inconsistent

- [ ] **Step 5: Commit all fixes**

```bash
git add .
git commit -m "fix: address testing issues (all critical + medium bugs resolved)"
```

---

## Rollout Checklist

Before declaring v3 complete:

- [ ] All 842 words enriched with def/ex/ex_tr/ex_distractors/sb_distractors
- [ ] State management pattern fully functional
- [ ] All 5 exercises rendering and scoring correctly
- [ ] Spaced repetition algorithm working (intervals, review due)
- [ ] Warm Night theme applied, motion working
- [ ] Home screen with stats cards functional
- [ ] Word list panels functional with actions
- [ ] Session flow (Gate → 5 Rounds → Summary) complete
- [ ] Quit mid-session saves partial progress
- [ ] Production exercise with API evaluation working
- [ ] Keyboard navigation working (1–4, Enter, Escape)
- [ ] ARIA labels and contrast audit complete
- [ ] Manual acceptance testing passed
- [ ] All bugs fixed
- [ ] Code committed with clear messages
- [ ] No console errors or warnings

---

## Notes for Implementation

### Testing Strategy
- Each task includes a test step before committing
- Focus on happy path first, error handling second
- Use console.assert() for simple tests
- Manual testing in browser for UI/UX

### Data Enrichment (Phase 1) Special Notes
- **Rate Limiting**: The enrichBatch function includes automatic retry logic with exponential backoff (5s → 10s → 20s). If enrichment fails, the script exits cleanly and can be resumed (already-enriched words are skipped).
- **Resume Support**: Run the same command again after fixing the issue; words already in `words_enriched.json` are skipped automatically.

### Production Exercise (Phase 3.6 & Phase 4) Special Notes
- **Textarea Focus Loss**: Do NOT update AppState (which triggers render()) during typing in the Production exercise textarea. Instead:
  - Only read the textarea value and update state when the **Submit button** is clicked
  - Never bind textarea input to state changes or onChange handlers
  - This prevents DOM re-rendering mid-typing, which clears the textarea focus
  - Example: `const userAnswer = document.getElementById('productionTextarea').value;` only on button click, not every keystroke

### Code Style
- Vanilla JS — no frameworks or transpilation
- Unidirectional data flow — all mutations through dispatch()
- Pure functions where possible (updateState, calculateNextReview, shuffle)
- Clear function names — renderGate, handleMCAnswer, initiateSession
- Comments for non-obvious logic

### Debugging Tips
- Use DevTools → Storage to inspect localStorage
- Use DevTools → Console to log AppState
- Use DevTools → Network to inspect API calls
- Use DevTools → Elements to inspect DOM structure

### Commits
- Commit frequently (after each task)
- Use clear, imperative messages: "feat:", "fix:", "test:"
- Keep commits small and logical
