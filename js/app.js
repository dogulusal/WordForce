// WordForge v3 - App state, dispatch, render, and session lifecycle

let AllWords = {};

let AppState = {
  progress: {
    level: 'A1',
    words: {}
  },
  session: {
    words: [],
    queue: [],
    skipped: {},
    levelFilter: 'ALL',
    round: 1,
    current: 0,
    results: {},
    currentExercise: null
  },
  ui: {
    screen: 'home',
    modal: null,
    loading: false,
    selectedOption: null,
    selectedChips: [],
    selectedChipIndexes: [],
    feedback: '',
    reveal: null,
    locked: false,
    pendingResult: null,
    sbRetryMode: false,
    productionDraft: '',
    productionSubmitted: '',
    prepLevel: 'ALL',
    prepPage: 0,
    prepSelectedKnown: []
  }
};

const SESSION_SIZE = 10;

function toLocalDate(daysToAdd = 0) {
  return new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
}

async function loadWords() {
  const response = await fetch('data/words_enriched.json');
  AllWords = await response.json();
  window.AllWords = AllWords;
}

async function loadEnvApiKey() {
  try {
    const response = await fetch('.env', { cache: 'no-store' });
    if (!response.ok) return;
    const content = await response.text();
    const match = content.match(/^API_KEY\s*=\s*(.+)$/m);
    if (!match) return;
    const key = match[1].trim();
    if (!key) return;
    window.ENV_API_KEY = key;
    if (!localStorage.getItem('wf_api_key')) {
      localStorage.setItem('wf_api_key', key);
    }
  } catch (error) {
    // .env may be absent in some environments; ignore silently.
  }
}

function saveProgress(progress) {
  localStorage.setItem('wf_progress', JSON.stringify(progress));
}

function loadProgress() {
  const json = localStorage.getItem('wf_progress');
  if (!json) return { level: 'A1', words: {} };
  try {
    return JSON.parse(json);
  } catch (e) {
    localStorage.removeItem('wf_progress');
    return { level: 'A1', words: {} };
  }
}

function updateState(currentState, action) {
  const newState = structuredClone(currentState);

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
    case 'SET_WORD_LIST_FILTER':
      newState.ui.wordListFilter = action.payload;
      break;
    case 'SET_OPTION':
      newState.ui.selectedOption = action.payload;
      break;
    case 'SET_CHIPS':
      newState.ui.selectedChips = action.payload;
      break;
    case 'SET_CHIP_INDEXES':
      newState.ui.selectedChipIndexes = action.payload;
      break;
    case 'SET_FEEDBACK':
      newState.ui.feedback = action.payload;
      break;
    case 'SET_REVEAL':
      newState.ui.reveal = action.payload;
      break;
    case 'SET_LOCKED':
      newState.ui.locked = action.payload;
      break;
    case 'SET_PENDING_RESULT':
      newState.ui.pendingResult = action.payload;
      break;
    case 'SET_SB_RETRY':
      newState.ui.sbRetryMode = action.payload;
      break;
    case 'SET_PRODUCTION_DRAFT':
      newState.ui.productionDraft = action.payload;
      break;
    case 'SET_PRODUCTION_SUBMITTED':
      newState.ui.productionSubmitted = action.payload;
      break;
    case 'SET_PREP_LEVEL':
      newState.ui.prepLevel = action.payload;
      newState.ui.prepPage = 0;
      break;
    case 'SET_PREP_PAGE':
      newState.ui.prepPage = action.payload;
      break;
    case 'TOGGLE_PREP_KNOWN':
      {
        const word = action.payload;
        const selected = new Set(newState.ui.prepSelectedKnown);
        if (selected.has(word)) selected.delete(word);
        else selected.add(word);
        newState.ui.prepSelectedKnown = [...selected];
      }
      break;
    case 'RESET_PREP':
      newState.ui.prepLevel = 'ALL';
      newState.ui.prepPage = 0;
      newState.ui.prepSelectedKnown = [];
      break;
    case 'INIT_SESSION':
      newState.session = action.payload;
      break;
    case 'ADVANCE_SESSION_INDEX':
      newState.session.current += 1;
      newState.ui.selectedOption = null;
      newState.ui.selectedChips = [];
      newState.ui.selectedChipIndexes = [];
      newState.ui.feedback = '';
      newState.ui.reveal = null;
      newState.ui.locked = false;
      newState.ui.pendingResult = null;
      newState.ui.sbRetryMode = false;
      newState.ui.productionDraft = '';
      newState.ui.productionSubmitted = '';
      break;
    case 'SET_ROUND':
      newState.session.round = action.payload;
      newState.session.current = 0;
      newState.ui.selectedOption = null;
      newState.ui.selectedChips = [];
      newState.ui.selectedChipIndexes = [];
      newState.ui.feedback = '';
      newState.ui.reveal = null;
      newState.ui.locked = false;
      newState.ui.pendingResult = null;
      newState.ui.sbRetryMode = false;
      newState.ui.productionDraft = '';
      newState.ui.productionSubmitted = '';
      break;
    case 'SET_CURRENT_EXERCISE':
      newState.session.currentExercise = action.payload;
      break;
    case 'MARK_KNOWN':
      newState.progress.words[action.payload] = {
        status: 'known',
        interval: null,
        nextReview: null,
        posErrors: {}
      };
      break;
    case 'MARK_PRACTICE':
      newState.progress.words[action.payload] = {
        status: 'practice',
        interval: 1,
        nextReview: toLocalDate(1),
        posErrors: (newState.progress.words[action.payload] && newState.progress.words[action.payload].posErrors) || {}
      };
      break;
    case 'MARK_LEARNED':
      newState.progress.words[action.payload] = {
        status: 'learned',
        interval: 3,
        nextReview: toLocalDate(3),
        posErrors: (newState.progress.words[action.payload] && newState.progress.words[action.payload].posErrors) || {}
      };
      break;
    case 'SAVE_RESULT':
      {
        const { word, round, correct } = action.payload;
        if (!newState.session.results[word]) newState.session.results[word] = {};
        newState.session.results[word][`r${round}`] = correct;
      }
      break;
    case 'SET_WORD_STATUS':
      {
        const { word, status, interval, nextReview } = action.payload;
        const existing = newState.progress.words[word] || { posErrors: {} };
        newState.progress.words[word] = {
          ...existing,
          status,
          interval,
          nextReview
        };
      }
      break;
    case 'DELETE_WORD_PROGRESS':
      delete newState.progress.words[action.payload];
      break;
    default:
      break;
  }

  return newState;
}

function dispatch(action) {
  AppState = updateState(AppState, action);
  saveProgress(AppState.progress);
  render(AppState);
}

window.dispatch = dispatch;

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function isEligibleForLevel(word, levelFilter) {
  if (levelFilter === 'ALL') return true;
  return (AllWords[word]?.level || 'A1') === levelFilter;
}

function pickSessionWords(sessionSize, levelFilter = 'ALL') {
  const reviewDue = getReviewDue(AppState.progress);
  const today = toLocalDate(0);
  const practiceWords = Object.keys(AppState.progress.words).filter((w) => {
    const data = AppState.progress.words[w];
    return data.status === 'practice' && (!data.nextReview || data.nextReview <= today);
  });
  const unseen = Object.keys(AllWords).filter((w) => !AppState.progress.words[w]);

  const picked = [
    ...reviewDue.filter((w) => isEligibleForLevel(w, levelFilter)),
    ...practiceWords.filter((w) => !reviewDue.includes(w) && isEligibleForLevel(w, levelFilter)),
    ...unseen.filter((w) => isEligibleForLevel(w, levelFilter))
  ];

  return picked.slice(0, sessionSize);
}

function initiateSession(sessionSize, levelFilter = 'ALL', skipGate = false) {
  const sessionWords = pickSessionWords(sessionSize, levelFilter);
  const nextSession = {
    words: sessionWords,
    queue: shuffle(sessionWords),
    skipped: {},
    levelFilter,
    round: 0,
    current: 0,
    results: {},
    currentExercise: null
  };

  dispatch({ type: 'INIT_SESSION', payload: nextSession });

  if (skipGate) {
    AppState.session.words = sessionWords;
    AppState.session.queue = shuffle(sessionWords);
    AppState.session.current = 0;
    dispatch({ type: 'SET_ROUND', payload: 1 });
    startRoundExercise();
    dispatch({ type: 'SET_SCREEN', payload: 'round' });
  } else {
    dispatch({ type: 'SET_SCREEN', payload: 'gate' });
  }
}

function currentWord() {
  return AppState.session.queue[AppState.session.current] || null;
}

function gateKnown() {
  const word = currentWord();
  if (!word) return;
  dispatch({ type: 'MARK_KNOWN', payload: word });
  AppState.session.skipped[word] = true;
  dispatch({ type: 'ADVANCE_SESSION_INDEX' });
  checkGateComplete();
}

function gateLearn() {
  dispatch({ type: 'ADVANCE_SESSION_INDEX' });
  checkGateComplete();
}

function startSessionFromPrep() {
  const prepKnown = AppState.ui.prepSelectedKnown || [];
  prepKnown.forEach((word) => {
    dispatch({ type: 'MARK_KNOWN', payload: word });
  });
  const chosenLevel = AppState.ui.prepLevel || 'ALL';
  initiateSession(SESSION_SIZE, chosenLevel, true);
}

function checkGateComplete() {
  if (AppState.session.current < AppState.session.queue.length) return;
  const activeWords = AppState.session.queue.filter((w) => !AppState.session.skipped[w]);
  AppState.session.words = activeWords;
  AppState.session.queue = activeWords;
  AppState.session.current = 0;

  if (activeWords.length === 0) {
    dispatch({ type: 'SET_SCREEN', payload: 'summary' });
    return;
  }

  dispatch({ type: 'SET_ROUND', payload: 1 });
  startRoundExercise();
  dispatch({ type: 'SET_SCREEN', payload: 'round' });
}

function buildExercise(word, round, wordIndex) {
  if (round === 1) return Exercises.renderDefinition(word, AllWords);
  if (round === 2) return Exercises.renderENtoTRMC(word, AllWords);
  if (round === 3) return Exercises.renderGapFill(word, AllWords);
  if (round === 4) {
    return wordIndex % 2 === 0
      ? Exercises.renderSentenceBuilder(word, AllWords)
      : Exercises.renderTranslationMC(word, AllWords);
  }
  return Production.renderProduction(word, AllWords);
}

function startRoundExercise() {
  const word = currentWord();
  if (!word) {
    if (AppState.session.round >= 5) {
      dispatch({ type: 'SET_SCREEN', payload: 'summary' });
      return;
    }
    dispatch({ type: 'SET_ROUND', payload: AppState.session.round + 1 });
    startRoundExercise();
    return;
  }

  const exercise = buildExercise(word, AppState.session.round, AppState.session.current);
  dispatch({ type: 'SET_CURRENT_EXERCISE', payload: exercise });
}

function recordPosError(word) {
  const existing = AppState.progress.words[word] || { status: 'practice', interval: 1, nextReview: toLocalDate(1), posErrors: {} };
  const pos = AllWords[word]?.pos || 'unknown';
  const posErrors = existing.posErrors || {};
  posErrors[pos] = (posErrors[pos] || 0) + 1;
  AppState.progress.words[word] = { ...existing, posErrors };
}

function finalizeRoundAnswer(correct) {
  const word = currentWord();
  const round = AppState.session.round;

  dispatch({ type: 'SAVE_RESULT', payload: { word, round, correct } });

  if (!correct) {
    recordPosError(word);
    dispatch({ type: 'MARK_PRACTICE', payload: word });
  } else if (round >= 5) {
    const allCorrect = Object.values(AppState.session.results[word] || {}).every(Boolean);
    dispatch({ type: allCorrect ? 'MARK_LEARNED' : 'MARK_PRACTICE', payload: word });
  }

  dispatch({ type: 'ADVANCE_SESSION_INDEX' });
  startRoundExercise();
}

async function submitExerciseAnswer() {
  if (AppState.ui.pendingResult !== null) {
    finalizeRoundAnswer(Boolean(AppState.ui.pendingResult));
    return;
  }

  if (AppState.ui.locked) return;

  const exercise = AppState.session.currentExercise;
  if (!exercise) return;

  if (exercise.type === 'DEFINITION') {
    finalizeRoundAnswer(true);
    return;
  }

  if (exercise.type === 'SENTENCE_BUILDER') {
    if (AppState.ui.sbRetryMode) {
      // Reset retry mode - clear chips and let them try again
      dispatch({ type: 'SET_SB_RETRY', payload: false });
      dispatch({ type: 'SET_CHIPS', payload: [] });
      dispatch({ type: 'SET_CHIP_INDEXES', payload: [] });
      dispatch({ type: 'SET_FEEDBACK', payload: '' });
      return;
    }
    const userAnswer = AppState.ui.selectedChips.join(' ');
    const isCorrect = userAnswer.trim() === exercise.correct.trim();
    if (isCorrect) {
      dispatch({ type: 'SET_FEEDBACK', payload: '✓ Correct!' });
      dispatch({ type: 'SET_LOCKED', payload: true });
      dispatch({ type: 'SET_PENDING_RESULT', payload: true });
    } else {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Not quite right.' });
      dispatch({ type: 'SET_SB_RETRY', payload: true });
    }
    return;
  }

  if (exercise.type === 'PRODUCTION') {
    const textarea = document.getElementById('productionTextarea');
    const userSentence = textarea ? textarea.value.trim() : '';
    if (!userSentence) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Please write a sentence first.' });
      return;
    }
    const normalizedSentence = Exercises.normalizeToken(userSentence).replace(/\s+/g, ' ').trim();
    const requiredWord = Exercises.normalizeToken(exercise.word).replace(/_/g, ' ');
    const escapedWord = requiredWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`(^|\\s)${escapedWord}(\\s|$)`, 'i');
    if (!wordRegex.test(normalizedSentence)) {
      dispatch({ type: 'SET_FEEDBACK', payload: `Please use '${exercise.word}' in your sentence.` });
      dispatch({ type: 'SET_PRODUCTION_DRAFT', payload: userSentence });
      return;
    }
    dispatch({ type: 'SET_PRODUCTION_SUBMITTED', payload: userSentence });
    dispatch({ type: 'SET_PRODUCTION_DRAFT', payload: '' });
    dispatch({ type: 'SET_LOCKED', payload: true });
    dispatch({ type: 'SET_FEEDBACK', payload: '⏳ Evaluating...' });
    const result = await Production.evaluateProduction(exercise.word, userSentence, AllWords);
    if (result.correct) {
      dispatch({ type: 'SET_FEEDBACK', payload: result.feedback || '✓ Great sentence!' });
      dispatch({ type: 'SET_LOCKED', payload: false });
      dispatch({ type: 'SET_PENDING_RESULT', payload: true });
      return;
    }
    const correction = result.correctedSentence ? `\n💡 Suggestion: "${result.correctedSentence}"` : '';
    dispatch({ type: 'SET_FEEDBACK', payload: `${result.feedback}${correction}` });
    dispatch({ type: 'SET_LOCKED', payload: false });
    return;
  }

  const selected = AppState.ui.selectedOption;
  if (selected === null || selected === undefined) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'Please select an option.' });
    return;
  }

  const isCorrect = selected === exercise.correct;
  dispatch({ type: 'SET_REVEAL', payload: { selected, correct: exercise.correct } });
  dispatch({ type: 'SET_FEEDBACK', payload: isCorrect ? 'Correct.' : `Wrong. Correct answer: ${exercise.correct}` });
  dispatch({ type: 'SET_LOCKED', payload: true });
  dispatch({ type: 'SET_PENDING_RESULT', payload: isCorrect });
}

function renderHome(state) {
  const words = state.progress.words;
  const learned = Object.keys(words).filter((w) => words[w].status === 'learned').length;
  const known = Object.keys(words).filter((w) => words[w].status === 'known').length;
  const practice = Object.keys(words).filter((w) => words[w].status === 'practice').length;
  const reviewDue = getReviewDue(state.progress).length;
  const total = Object.keys(AllWords).length;
  const knownOrLearned = known + learned;
  const available = total - knownOrLearned;

  return `
    <div class="home-screen">
      <h1>WordForge</h1>
      <div class="home-word-stats">
        <span class="home-stat"><span class="home-stat-label">Total</span><span class="home-stat-value">${total}</span></span>
        <span class="home-stat-sep">·</span>
        <span class="home-stat"><span class="home-stat-label">Known</span><span class="home-stat-value home-stat-known">${knownOrLearned}</span></span>
        <span class="home-stat-sep">·</span>
        <span class="home-stat"><span class="home-stat-label">Available</span><span class="home-stat-value home-stat-available">${available}</span></span>
      </div>
      <div class="stats-grid">
        <button class="card" data-action="open-list" data-filter="learned">Learned: ${learned}</button>
        <button class="card" data-action="open-list" data-filter="known">Known: ${known}</button>
        <button class="card" data-action="open-list" data-filter="review">Review Due: ${reviewDue}</button>
        <button class="card" data-action="open-list" data-filter="practice">Practice: ${practice}</button>
      </div>
      <div class="actions">
        <button class="btn" data-action="start-session">Start Session (10 words)</button>
        <button class="btn btn-muted" data-action="open-manage-words">Manage Words</button>
        <button class="btn btn-muted" data-action="open-settings">Settings</button>
      </div>
    </div>
  `;
}

function renderPrep(state) {
  const level = state.ui.prepLevel || 'ALL';
  const page = state.ui.prepPage || 0;
  const pageSize = 24;
  const levels = ['ALL', 'A1', 'A2', 'B1', 'B2', 'C1'];

  const candidates = Object.keys(AllWords)
    .filter((word) => isEligibleForLevel(word, level))
    .filter((word) => {
      const status = state.progress.words[word]?.status;
      return status !== 'known' && status !== 'learned';
    })
    .sort((a, b) => a.localeCompare(b));

  const totalPages = Math.max(1, Math.ceil(candidates.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  if (safePage !== page) {
    dispatch({ type: 'SET_PREP_PAGE', payload: safePage });
    return '<div class="card">Preparing words...</div>';
  }

  const pageItems = candidates.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selected = new Set(state.ui.prepSelectedKnown || []);
  const persistentKnownCount = Object.keys(state.progress.words).filter(
    (w) => state.progress.words[w]?.status === 'known' || state.progress.words[w]?.status === 'learned'
  ).length;
  const totalMarked = persistentKnownCount + selected.size;

  const levelCounts = {};
  levels.forEach((l) => {
    if (l === 'ALL') {
      levelCounts[l] = candidates.length;
    } else {
      levelCounts[l] = Object.keys(AllWords).filter((w) => {
        if (AllWords[w]?.level !== l) return false;
        const st = state.progress.words[w]?.status;
        return st !== 'known' && st !== 'learned';
      }).length;
    }
  });

  const levelButtons = levels
    .map((l) => `<button class="prep-level ${l === level ? 'active' : ''}" data-action="prep-select-level" data-level="${l}">${l} <span class="prep-level-count">${levelCounts[l]}</span></button>`)
    .join('');

  const chips = pageItems
    .map((word) => `<button class="prep-chip ${selected.has(word) ? 'selected' : ''}" data-action="prep-toggle-word" data-word="${word}">${word}</button>`)
    .join('');

  return `
    <div class="prep-screen card">
      <h2>Select words you already know</h2>
      <div class="prep-header">
        <button class="btn btn-muted" data-action="prep-back">← Back</button>
        <span class="prep-count">✓ Known: ${totalMarked}</span>
      </div>
      <div class="prep-levels">${levelButtons}</div>
      <div class="prep-grid">${chips || '<p>No words for this filter.</p>'}</div>
      <div class="prep-footer">
        <div class="prep-pagination">
          <button class="btn btn-muted" data-action="prep-prev" ${safePage <= 0 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${safePage + 1} / ${totalPages}</span>
          <button class="btn btn-muted" data-action="prep-next" ${safePage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        </div>
        <button class="btn prep-continue-btn" data-action="prep-start">Save &amp; Start Session →</button>
      </div>
    </div>
  `;
}

function renderGate(state) {
  const word = currentWord();
  if (!word) {
    return '<div class="card">Preparing next round...</div>';
  }

  return `
    <div class="gate-screen">
      <div class="card centered-card">
        <h2>Do you know this word?</h2>
        <div class="word-display">${word}</div>
        <div class="actions">
          <button class="btn" data-action="gate-known">Yes, I know it</button>
          <button class="btn" data-action="gate-learn">No, teach me</button>
          <button class="btn btn-muted" data-action="gate-back">← Back</button>
        </div>
        <p>${state.session.current + 1} / ${state.session.queue.length}</p>
      </div>
    </div>
  `;
}

function renderOptions(options, selected, reveal, locked) {
  return options.map((option, idx) => {
    const classes = ['option'];
    if (selected === option) classes.push('selected');
    if (reveal && reveal.correct === option) classes.push('option-correct');
    if (reveal && reveal.selected === option && reveal.selected !== reveal.correct) classes.push('option-wrong');
    const escaped = String(option).replace(/"/g, '&quot;');
    const isSelected = selected === option ? 'true' : 'false';
    const disabledAttr = locked ? 'disabled' : '';
    return `<button class="${classes.join(' ')}" role="option" aria-selected="${isSelected}" aria-label="Option ${idx + 1}: ${escaped}" data-action="select-option-index" data-index="${idx}" ${disabledAttr}>${idx + 1}. ${option}</button>`;
  }).join('');
}

function renderRound(state) {
  if (!state.session.currentExercise) {
    return '<div class="card">Loading exercise...</div>';
  }

  const exercise = state.session.currentExercise;
  const progress = `Round ${state.session.round}/5 | Word ${state.session.current + 1}/${state.session.queue.length}`;
  const waitingContinue = state.ui.pendingResult !== null;
  const submitLabel = waitingContinue ? 'Continue' : 'Submit';
  let body = '';

  if (exercise.type === 'DEFINITION') {
    body = `
      <h2>${exercise.word}</h2>
      <p>${exercise.def}</p>
      <button class="btn" data-action="submit-answer">Continue</button>
    `;
  } else if (exercise.type === 'EN_TO_TR_MC') {
    body = `
      <h2>${exercise.prompt}</h2>
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'GAP_FILL') {
    body = `
      <h2>Fill the blank</h2>
      <p>${exercise.sentence}</p>
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'SENTENCE_BUILDER') {
    if (state.ui.sbRetryMode) {
      body = `
        <h2>Build the sentence</h2>
        <p>TR: ${exercise.trSentence}</p>
        <div class="sb-retry-box">
          <p class="sb-retry-msg">Not quite right. Want to try again?</p>
          <div class="actions">
            <button class="btn" data-action="submit-answer">↺ Try Again</button>
            <button class="btn btn-muted" data-action="sb-skip">Skip →</button>
          </div>
        </div>
      `;
    } else {
      const usedIndexes = new Set(state.ui.selectedChipIndexes || []);
      const chips = exercise.chips
        .map((chip, index) => {
          const used = usedIndexes.has(index);
          return `<button class="option ${used ? 'option-used' : ''}" data-action="add-chip" data-index="${index}" data-value="${chip}" ${state.ui.locked || used ? 'disabled' : ''}>${chip}</button>`;
        })
        .join('');
      body = `
        <h2>Build the sentence</h2>
        <p>TR: ${exercise.trSentence}</p>
        <div class="answer-box">${state.ui.selectedChips.join(' ') || '<span style="opacity:0.4">Tap words below to build the sentence</span>'}</div>
        <div class="options">${chips}</div>
        <div class="actions">
          <button class="btn btn-muted" data-action="remove-chip" ${state.ui.locked ? 'disabled' : ''}>⌫ Undo</button>
          <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
        </div>
      `;
    }
  } else if (exercise.type === 'TRANSLATION_MC') {
    body = `
      <h2>Choose the correct English sentence</h2>
      <p>TR: ${exercise.trSentence}</p>
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'PRODUCTION') {
    const hasFeedback = Boolean(state.ui.feedback) && !String(state.ui.feedback).startsWith('⏳');
    const isEvaluating = String(state.ui.feedback).startsWith('⏳');
    const submittedSentence = state.ui.productionSubmitted || '';
    const draftValue = state.ui.productionDraft || '';
    const showTryAgain = hasFeedback && !waitingContinue && !state.ui.locked;
    body = `
      <h2>${exercise.prompt}</h2>
      ${submittedSentence && !waitingContinue ? `<div class="production-submitted">${submittedSentence.replace(/</g,'&lt;')}</div>` : ''}
      ${!submittedSentence || waitingContinue ? `<textarea id="productionTextarea" class="modal-input" rows="3" placeholder="Write your sentence...">${draftValue.replace(/</g,'&lt;')}</textarea>` : ''}
      <div class="actions">
        <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${waitingContinue ? 'Continue →' : (showTryAgain ? '↺ Try Again' : (isEvaluating ? '⏳ Evaluating...' : 'Submit'))}</button>
        ${showTryAgain ? '<button class="btn btn-muted" data-action="production-practice-later">Skip for now</button>' : ''}
      </div>
    `;
  }

  return `
    <div class="round-screen" role="main" aria-label="Exercise screen">
      <div class="progress" aria-live="polite" aria-label="${progress}">${progress}</div>
      <div class="card">${body}</div>
      <p>${state.ui.feedback || ''}</p>
      <button class="btn" data-action="open-quit">End Session</button>
    </div>
  `;
}

function renderSummary(state) {
  const words = state.session.words;
  const perfect = words.filter((w) => Object.values(state.session.results[w] || {}).every(Boolean)).length;
  return `
    <div class="summary-screen">
      <div class="card centered-card">
        <h2>Session Complete</h2>
        <p>Total words: ${words.length}</p>
        <p>Perfect words: ${perfect}</p>
        <button class="btn" data-action="go-home">Back Home</button>
      </div>
    </div>
  `;
}

function render(state) {
  const app = document.getElementById('app');
  const modalContainer = document.getElementById('modal-container');
  if (!app || !modalContainer) return;

  if (state.ui.screen === 'home') app.innerHTML = renderHome(state);
  if (state.ui.screen === 'preflight') app.innerHTML = renderPrep(state);
  if (state.ui.screen === 'gate') app.innerHTML = renderGate(state);
  if (state.ui.screen === 'round') app.innerHTML = renderRound(state);
  if (state.ui.screen === 'summary') app.innerHTML = renderSummary(state);

  modalContainer.innerHTML = state.ui.modal ? UI.renderModal(state.ui.modal, state, AllWords) : '';
}

function handleAction(action, target) {
  if (action === 'start-session') {
    initiateSession(SESSION_SIZE, 'ALL', true);
    return;
  }
  if (action === 'open-manage-words') {
    dispatch({ type: 'RESET_PREP' });
    dispatch({ type: 'SET_SCREEN', payload: 'preflight' });
    return;
  }
  if (action === 'open-settings') {
    dispatch({ type: 'SET_MODAL', payload: 'settings' });
    return;
  }
  if (action === 'open-list') {
    dispatch({ type: 'SET_WORD_LIST_FILTER', payload: target.dataset.filter || 'practice' });
    dispatch({ type: 'SET_MODAL', payload: 'wordList' });
    return;
  }
  if (action === 'gate-known') {
    gateKnown();
    return;
  }
  if (action === 'gate-learn') {
    gateLearn();
    return;
  }
  if (action === 'gate-back') {
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
  if (action === 'prep-select-level') {
    dispatch({ type: 'SET_PREP_LEVEL', payload: target.dataset.level || 'ALL' });
    return;
  }
  if (action === 'prep-toggle-word') {
    const word = target.dataset.word;
    if (word) dispatch({ type: 'TOGGLE_PREP_KNOWN', payload: word });
    return;
  }
  if (action === 'prep-prev') {
    dispatch({ type: 'SET_PREP_PAGE', payload: Math.max(0, (AppState.ui.prepPage || 0) - 1) });
    return;
  }
  if (action === 'prep-next') {
    dispatch({ type: 'SET_PREP_PAGE', payload: (AppState.ui.prepPage || 0) + 1 });
    return;
  }
  if (action === 'prep-back') {
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
  if (action === 'prep-start') {
    startSessionFromPrep();
    return;
  }
  if (action === 'select-option-index') {
    if (AppState.ui.locked) return;
    const exercise = AppState.session.currentExercise;
    const index = Number(target.dataset.index);
    if (!exercise || !Array.isArray(exercise.options) || Number.isNaN(index)) return;
    if (exercise.options[index] === undefined) return;
    dispatch({ type: 'SET_OPTION', payload: exercise.options[index] });
    return;
  }
  if (action === 'add-chip') {
    const chipIndex = Number(target.dataset.index);
    if (Number.isNaN(chipIndex) || AppState.ui.selectedChipIndexes.includes(chipIndex)) return;
    const chips = [...AppState.ui.selectedChips, target.dataset.value];
    const chipIndexes = [...AppState.ui.selectedChipIndexes, chipIndex];
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
    return;
  }
  if (action === 'remove-chip') {
    const chips = [...AppState.ui.selectedChips];
    const chipIndexes = [...AppState.ui.selectedChipIndexes];
    chips.pop();
    chipIndexes.pop();
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
    return;
  }
  if (action === 'submit-answer') {
    submitExerciseAnswer();
    return;
  }
  if (action === 'sb-skip') {
    dispatch({ type: 'SET_SB_RETRY', payload: false });
    finalizeRoundAnswer(false);
    return;
  }
  if (action === 'open-quit') {
    dispatch({ type: 'SET_MODAL', payload: 'quitConfirm' });
    return;
  }
  if (action === 'production-practice-later') {
    dispatch({ type: 'SET_SB_RETRY', payload: false });
    dispatch({ type: 'SET_PRODUCTION_DRAFT', payload: '' });
    dispatch({ type: 'SET_PRODUCTION_SUBMITTED', payload: '' });
    finalizeRoundAnswer(false);
    return;
  }
  if (action === 'go-home') {
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
}

function handleUiAction(action, element) {
  if (action === 'close-modal') {
    dispatch({ type: 'SET_MODAL', payload: null });
    return;
  }
  if (action === 'save-settings') {
    const apiInput = document.getElementById('apiKeyInput');
    const modelInput = document.getElementById('modelInput');
    localStorage.setItem('wf_api_key', apiInput ? apiInput.value.trim() : '');
    localStorage.setItem('wf_model', modelInput ? modelInput.value.trim() : 'gemma-4-31b-it');
    dispatch({ type: 'SET_MODAL', payload: null });
    return;
  }
  if (action === 'quit-session') {
    dispatch({ type: 'SET_MODAL', payload: null });
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
  }
  if (action === 'remove-from-known') {
    const word = element?.dataset?.word;
    if (word) {
      dispatch({ type: 'DELETE_WORD_PROGRESS', payload: word });
    }
  }
  if (action === 'add-to-known') {
    const word = element?.dataset?.word;
    if (word) {
      dispatch({
        type: 'SET_WORD_STATUS',
        payload: { word, status: 'known', interval: null, nextReview: null }
      });
    }
  }
}

window.handleUiAction = handleUiAction;

function handleKeyboardNavigation(event) {
  if (AppState.ui.modal) {
    if (event.key === 'Escape') {
      dispatch({ type: 'SET_MODAL', payload: null });
      event.preventDefault();
    }
    return;
  }

  if (AppState.ui.screen !== 'round') return;

  const exercise = AppState.session.currentExercise;
  if (!exercise) return;

  if (event.key >= '1' && event.key <= '4' && Array.isArray(exercise.options)) {
    const index = Number(event.key) - 1;
    if (exercise.options[index] !== undefined) {
      dispatch({ type: 'SET_OPTION', payload: exercise.options[index] });
    }
    event.preventDefault();
    return;
  }

  if (event.key === 'Enter') {
    submitExerciseAnswer();
    event.preventDefault();
    return;
  }

  if (event.key === 'Backspace' && exercise.type === 'SENTENCE_BUILDER') {
    const chips = [...AppState.ui.selectedChips];
    const chipIndexes = [...AppState.ui.selectedChipIndexes];
    chips.pop();
    chipIndexes.pop();
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
    event.preventDefault();
  }
}

document.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) handleAction(actionTarget.dataset.action, actionTarget);

  const uiTarget = event.target.closest('[data-ui-action]');
  if (uiTarget) handleUiAction(uiTarget.dataset.uiAction, uiTarget);
});

document.addEventListener('keydown', handleKeyboardNavigation);

async function init() {
  try {
    await loadEnvApiKey();
    await loadWords();
    dispatch({ type: 'LOAD_PROGRESS', payload: loadProgress() });
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
  } catch (error) {
    const app = document.getElementById('app');
    if (app) app.innerHTML = `<div class="card">Failed to initialize: ${error.message}</div>`;
  }
}

init();

