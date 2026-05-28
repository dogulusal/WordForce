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
    templateHistory: {},
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
    wrongAttempts: 0,
    hintVisible: false,
    freeTypeInput: '',
    flashcardIndex: 0,
    flashcardFlipped: false,
    sbRetryMode: false,
    sbPrefixMatch: 0,
    sbShake: false,
    productionDraft: '',
    productionSubmitted: '',
    sessionSize: 10,
    sessionStartLevel: 'ALL',
    prepLevel: 'ALL',
    prepPage: 0,
    prepSelectionMode: 'known',
    prepSelectedKnown: [],
    prepSelectedSession: [],
    prepPendingAction: null,
    demoAnswerOpen: false,
    errorCorrectionRevealPrompt: false
  }
};

const SESSION_SIZE = 10;
const PRIMARY_PROGRESS_KEY = 'wf_progress';
const LEGACY_PROGRESS_KEYS = ['wordforge_progress', 'progress'];
const WF_PROGRESS_UPDATED_KEY = 'wf_local_updated_at';

function toLocalDate(daysToAdd = 0) {
  return new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
}

function addDaysToDate(dateString, days) {
  if (!dateString) return toLocalDate(days);
  const parsed = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return toLocalDate(days);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toLocaleDateString('en-CA');
}

function applyReviewCollisionPolicy(progress) {
  const today = toLocalDate(0);
  let changed = false;

  Object.values(progress.words || {}).forEach((entry) => {
    const due = [];

    if (entry.status === 'learned' && entry.nextReview && entry.nextReview <= today) {
      due.push({
        meaningIndex: 0,
        interval: entry.interval,
        nextReview: entry.nextReview,
      });
    }

    if (Array.isArray(entry.meanings)) {
      entry.meanings.forEach((meaning, meaningIndex) => {
        if (meaningIndex === 0) return;
        if (meaning?.status !== 'learned') return;
        if (!meaning.nextReview || meaning.nextReview > today) return;
        due.push({
          meaningIndex,
          interval: meaning.interval,
          nextReview: meaning.nextReview,
        });
      });
    }

    if (due.length <= 1) return;

    due.sort((a, b) => {
      const intervalDiff = Number(a.interval || 999) - Number(b.interval || 999);
      if (intervalDiff !== 0) return intervalDiff;
      return a.meaningIndex - b.meaningIndex;
    });

    due.slice(1).forEach((deferred) => {
      if (deferred.meaningIndex === 0) {
        entry.nextReview = addDaysToDate(deferred.nextReview, 1);
      } else if (entry.meanings?.[deferred.meaningIndex]) {
        entry.meanings[deferred.meaningIndex].nextReview = addDaysToDate(deferred.nextReview, 1);
      }
      changed = true;
    });
  });

  return changed;
}

async function loadWords() {
  const response = await fetch('data/words_enriched.json', { cache: 'no-store' });
  AllWords = await response.json();
  window.AllWords = AllWords;
}

async function loadEnvApiKey() {
  try {
    const response = await fetch('.env', { cache: 'no-store' });
    if (!response.ok) return;
    const content = await response.text();

    const readEnvValue = (name) => {
      const match = content.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
      return match ? match[1].trim() : '';
    };

    const key = readEnvValue('API_KEY');
    if (key) {
      window.ENV_API_KEY = key;
      if (!localStorage.getItem('wf_api_key')) {
        localStorage.setItem('wf_api_key', key);
      }
    }

    const supabaseUrl = readEnvValue('SUPABASE_URL');
    if (supabaseUrl) {
      window.ENV_SUPABASE_URL = supabaseUrl;
      if (!localStorage.getItem('wf_supabase_url')) {
        localStorage.setItem('wf_supabase_url', supabaseUrl);
      }
    }

    const supabaseAnonKey = readEnvValue('SUPABASE_ANON_KEY');
    if (supabaseAnonKey) {
      window.ENV_SUPABASE_ANON_KEY = supabaseAnonKey;
      if (!localStorage.getItem('wf_supabase_anon_key')) {
        localStorage.setItem('wf_supabase_anon_key', supabaseAnonKey);
      }
    }
  } catch (error) {
    // .env may be absent in some environments; ignore silently.
  }
}

function saveProgress(progress) {
  const payload = JSON.stringify(progress);
  const currentPayload = localStorage.getItem(PRIMARY_PROGRESS_KEY);
  if (currentPayload === payload) return;

  localStorage.setItem(PRIMARY_PROGRESS_KEY, payload);
  // Mirror to legacy keys so older app variants can still read the same progress.
  LEGACY_PROGRESS_KEYS.forEach((key) => localStorage.setItem(key, payload));
  localStorage.setItem(WF_PROGRESS_UPDATED_KEY, new Date().toISOString());

  if (window.WFCloud) {
    window.WFCloud.notifyLocalChange();
  }
}

function parseProgressJSON(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.words || typeof parsed.words !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadProgress() {
  const keysToTry = [PRIMARY_PROGRESS_KEY, ...LEGACY_PROGRESS_KEYS];

  for (const key of keysToTry) {
    const parsed = parseProgressJSON(localStorage.getItem(key));
    if (!parsed) continue;

    if (key !== PRIMARY_PROGRESS_KEY) {
      // Self-heal: migrate legacy storage into the primary key.
      localStorage.setItem(PRIMARY_PROGRESS_KEY, JSON.stringify(parsed));
    }

    return parsed;
  }

  return { level: 'A1', words: {} };
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
    case 'SET_FREE_TYPE_SECOND_CHANCE':
      newState.ui.freeTypeSecondChance = action.payload;
      break;
    case 'SET_EC_REVEAL_PROMPT':
      newState.ui.errorCorrectionRevealPrompt = action.payload;
      break;
    case 'SET_PENDING_RESULT':
      newState.ui.pendingResult = action.payload;
      break;
    case 'SET_SB_RETRY':
      newState.ui.sbRetryMode = action.payload;
      break;
    case 'SET_SB_PREFIX':
      newState.ui.sbPrefixMatch = Number(action.payload) || 0;
      break;
    case 'SET_SB_SHAKE':
      newState.ui.sbShake = Boolean(action.payload);
      break;
    case 'SET_PRODUCTION_DRAFT':
      newState.ui.productionDraft = action.payload;
      break;
    case 'SET_PRODUCTION_SUBMITTED':
      newState.ui.productionSubmitted = action.payload;
      break;
    case 'SET_SESSION_SIZE':
      newState.ui.sessionSize = action.payload;
      break;
    case 'SET_SESSION_START_LEVEL':
      newState.ui.sessionStartLevel = action.payload;
      break;
    case 'RESET_SESSION_START_SELECTION':
      newState.ui.sessionStartLevel = 'ALL';
      break;
    case 'SET_HINT_VISIBLE':
      newState.ui.hintVisible = Boolean(action.payload);
      break;
    case 'SET_FREE_TYPE_INPUT':
      newState.ui.freeTypeInput = action.payload;
      break;
    case 'SET_FLASHCARD':
      newState.ui.flashcardIndex = action.payload.index;
      newState.ui.flashcardFlipped = action.payload.flipped;
      break;
    case 'SET_PREP_LEVEL':
      newState.ui.prepLevel = action.payload;
      newState.ui.prepPage = 0;
      break;
    case 'SET_PREP_SELECTION_MODE':
      newState.ui.prepSelectionMode = action.payload === 'session' ? 'session' : 'known';
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
    case 'TOGGLE_PREP_SESSION_WORD':
      {
        const word = action.payload;
        const selected = new Set(newState.ui.prepSelectedSession);
        if (selected.has(word)) selected.delete(word);
        else selected.add(word);
        newState.ui.prepSelectedSession = [...selected];
      }
      break;
    case 'RESET_PREP':
      newState.ui.prepLevel = 'ALL';
      newState.ui.prepPage = 0;
      newState.ui.prepSelectionMode = 'known';
      newState.ui.prepSelectedKnown = [];
      newState.ui.prepSelectedSession = [];
      newState.ui.prepPendingAction = null;
      break;
    case 'CLEAR_PREP_SELECTION':
      newState.ui.prepSelectedKnown = [];
      newState.ui.prepPendingAction = null;
      break;
    case 'CLEAR_PREP_SESSION_SELECTION':
      newState.ui.prepSelectedSession = [];
      break;
    case 'SET_PREP_PENDING_ACTION':
      newState.ui.prepPendingAction = action.payload;
      break;
    case 'SET_DEMO_ANSWER_OPEN':
      newState.ui.demoAnswerOpen = Boolean(action.payload);
      break;
    case 'INIT_SESSION':
      newState.session = action.payload;
      newState.ui.demoAnswerOpen = false;
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
      newState.ui.wrongAttempts = 0;
      newState.ui.hintVisible = false;
      newState.ui.freeTypeInput = '';
      newState.ui.sbRetryMode = false;
      newState.ui.sbPrefixMatch = 0;
      newState.ui.sbShake = false;
      newState.ui.productionDraft = '';
      newState.ui.productionSubmitted = '';
      newState.ui.demoAnswerOpen = false;
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
      newState.ui.wrongAttempts = 0;
      newState.ui.hintVisible = false;
      newState.ui.freeTypeInput = '';
      newState.ui.sbRetryMode = false;
      newState.ui.sbPrefixMatch = 0;
      newState.ui.sbShake = false;
      newState.ui.productionDraft = '';
      newState.ui.productionSubmitted = '';
      newState.ui.demoAnswerOpen = false;
      break;
    case 'SET_CURRENT_EXERCISE':
      newState.session.currentExercise = action.payload;
      newState.ui.demoAnswerOpen = false;
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
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CEFR_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };

function isEligibleForLevel(word, levelFilter) {
  if (levelFilter === 'ALL') return true;
  return (AllWords[word]?.level || 'A1') === levelFilter;
}

function getWordLevel(word) {
  return AllWords[word]?.level || 'A1';
}

// Returns the lowest CEFR level that still has unseen or practice words.
// Used when levelFilter is 'ALL' to ensure level-ordered progression (A1 → A2 → ...).
function getActiveLevel(progress) {
  const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const today = toLocalDate(0);
  for (const level of levelOrder) {
    const hasActive = Object.keys(AllWords).some((w) => {
      if (getWordLevel(w) !== level) return false;
      const wp = progress.words[w];
      if (!wp) return true; // unseen
      if (wp.status === 'practice' && (!wp.nextReview || wp.nextReview <= today)) return true;
      return false;
    });
    if (hasActive) return level;
  }
  // All levels exhausted — allow review-due words from any level
  return null;
}

function pickSessionWords(sessionSize, levelFilter = 'ALL', customWords = null) {
  if (Array.isArray(customWords) && customWords.length > 0) {
    return shuffle(customWords).slice(0, sessionSize);
  }

  const reviewDue = getReviewDue(AppState.progress);
  const today = toLocalDate(0);
  const practiceWords = Object.keys(AppState.progress.words).filter((w) => {
    const data = AppState.progress.words[w];
    return data.status === 'practice' && (!data.nextReview || data.nextReview <= today);
  });
  const deferredPracticeWords = Object.keys(AppState.progress.words).filter((w) => {
    const data = AppState.progress.words[w];
    return data.status === 'practice' && data.nextReview && data.nextReview > today;
  });
  const unseen = Object.keys(AllWords).filter((w) => !AppState.progress.words[w]);

  // When ALL is selected, enforce level-ordered progression: finish lower levels first
  const effectiveFilter = levelFilter === 'ALL'
    ? (getActiveLevel(AppState.progress) || 'ALL')
    : levelFilter;

  const picked = [
    ...reviewDue.filter((w) => isEligibleForLevel(w, effectiveFilter)),
    ...practiceWords.filter((w) => !reviewDue.includes(w) && isEligibleForLevel(w, effectiveFilter)),
    ...unseen.filter((w) => isEligibleForLevel(w, effectiveFilter))
  ];

  if (picked.length === 0) {
    // No active words at current level — try review-due words from any level
    const anyReviewDue = reviewDue.filter((w) => isEligibleForLevel(w, levelFilter));
    if (anyReviewDue.length > 0) return anyReviewDue.slice(0, sessionSize);
    return deferredPracticeWords
      .filter((w) => isEligibleForLevel(w, levelFilter))
      .slice(0, sessionSize);
  }

  return picked.slice(0, sessionSize);
}

function startTypedSession(type) {
  // Prefer words from the user's practice/learned pool that support this exercise type
  const practicePool = Object.keys(AppState.progress.words).filter(w => {
    const status = AppState.progress.words[w]?.status;
    if (status !== 'practice' && status !== 'learned') return false;
    if (!AllWords[w]) return false;
    if (type === 'COLLOCATION_MATCH') return Array.isArray(AllWords[w].collocations) && AllWords[w].collocations.length >= 1;
    if (type === 'ERROR_CORRECTION') return (Array.isArray(AllWords[w].wrong_usage) && AllWords[w].wrong_usage.length > 0) || (Array.isArray(AllWords[w].ex) && AllWords[w].ex.length > 0);
    return true;
  });

  // Fall back to all words supporting this type if practice pool too small
  let sessionWords;
  if (practicePool.length >= 3) {
    sessionWords = shuffle(practicePool).slice(0, AppState.ui.sessionSize || 10);
  } else {
    const broader = Object.keys(AllWords).filter(w => {
      if (type === 'COLLOCATION_MATCH') return Array.isArray(AllWords[w].collocations) && AllWords[w].collocations.length >= 1;
      if (type === 'ERROR_CORRECTION') return (Array.isArray(AllWords[w].wrong_usage) && AllWords[w].wrong_usage.length > 0) || (Array.isArray(AllWords[w].ex) && AllWords[w].ex.length > 0);
      return true;
    });
    sessionWords = shuffle(broader).slice(0, AppState.ui.sessionSize || 10);
  }

  if (sessionWords.length === 0) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'No words available for this exercise type.' });
    return;
  }

  const nextSession = {
    words: sessionWords,
    queue: shuffle([...sessionWords]),
    templateHistory: {},
    skipped: {},
    levelFilter: 'ALL',
    round: 1,
    current: 0,
    results: {},
    currentExercise: null,
    demoType: null,
    isDemo: false,
    forceType: type
  };

  dispatch({ type: 'INIT_SESSION', payload: nextSession });
  AppState.session.words = sessionWords;
  AppState.session.queue = [...nextSession.queue];
  AppState.session.current = 0;
  dispatch({ type: 'SET_ROUND', payload: 1 });
  startRoundExercise();
  dispatch({ type: 'SET_SCREEN', payload: 'round' });
}

function startDemoExercise(type) {
  // Find words that have the data needed for these exercise types
  const candidates = Object.keys(AllWords).filter(w => {
    const d = AllWords[w];
    if (type === 'COLLOCATION_MATCH') {
      return Array.isArray(d.collocations) && d.collocations.length >= 1;
    }
    if (type === 'ERROR_CORRECTION') {
      return (Array.isArray(d.wrong_usage) && d.wrong_usage.length > 0) ||
             (Array.isArray(d.ex) && d.ex.length > 0);
    }
    return false;
  });

  if (candidates.length === 0) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'No suitable words found for this exercise demo.' });
    return;
  }

  // Pick 5 random words for the demo
  const demoWords = shuffle(candidates).slice(0, 5);
  const nextSession = {
    words: demoWords,
    queue: demoWords,
    templateHistory: {},
    skipped: {},
    levelFilter: 'ALL',
    round: 1,
    current: 0,
    results: {},
    currentExercise: null,
    demoType: type,
    isDemo: true
  };

  dispatch({ type: 'INIT_SESSION', payload: nextSession });

  // Build the demo exercise for the first word
  let exercise = null;
  for (const word of demoWords) {
    if (type === 'COLLOCATION_MATCH') {
      exercise = Exercises.renderCollocationMatch(word, AllWords);
    } else if (type === 'ERROR_CORRECTION') {
      exercise = Exercises.renderErrorCorrection(word, AllWords);
    }
    if (exercise) break;
  }

  if (!exercise) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'Could not generate demo exercise. Word data insufficient.' });
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }

  dispatch({ type: 'SET_CURRENT_EXERCISE', payload: exercise });
  dispatch({ type: 'SET_SCREEN', payload: 'round' });
}

function initiateSession(sessionSize, levelFilter = 'ALL', skipGate = false, customWords = null) {
  const collisionChanged = applyReviewCollisionPolicy(AppState.progress);
  if (collisionChanged) saveProgress(AppState.progress);

  const sessionWords = pickSessionWords(sessionSize, levelFilter, customWords);
  const nextSession = {
    words: sessionWords,
    queue: shuffle(sessionWords),
    templateHistory: {},
    skipped: {},
    levelFilter,
    round: 0,
    current: 0,
    results: {},
    currentExercise: null,
    demoType: null,
    isDemo: false
  };

  dispatch({ type: 'INIT_SESSION', payload: nextSession });

  if (sessionWords.length === 0) {
    dispatch({ type: 'SET_SCREEN', payload: 'summary' });
    return;
  }

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
  const item = currentQueueItem();
  if (!item) return null;
  return typeof item === 'string' ? item : item.word;
}

function currentQueueItem() {
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
  const chosenLevel = AppState.ui.prepLevel || 'ALL';
  const sessionSize = AppState.ui.sessionSize || SESSION_SIZE;
  const selectedSessionWords = AppState.ui.prepSelectedSession || [];

  if (selectedSessionWords.length > 0) {
    dispatch({ type: 'CLEAR_PREP_SESSION_SELECTION' });
    initiateSession(sessionSize, 'ALL', true, selectedSessionWords);
    return;
  }

  initiateSession(sessionSize, chosenLevel, true);
}

function savePrepSelection() {
  const prepKnown = AppState.ui.prepSelectedKnown || [];
  prepKnown.forEach((word) => {
    dispatch({ type: 'MARK_KNOWN', payload: word });
  });
  dispatch({ type: 'CLEAR_PREP_SELECTION' });
}

function continuePrepPendingAction(pendingAction = AppState.ui.prepPendingAction) {
  dispatch({ type: 'SET_MODAL', payload: null });
  dispatch({ type: 'SET_PREP_PENDING_ACTION', payload: null });

  if (pendingAction === 'start') {
    startSessionFromPrep();
    return;
  }

  dispatch({ type: 'SET_SCREEN', payload: 'home' });
}

function buildRoundSkipKey(word, round) {
  return `r${round}:${word}`;
}

function deferCurrentWordInSession() {
  const word = currentWord();
  if (!word) return;

  const skipKey = buildRoundSkipKey(word, AppState.session.round);
  const skipCount = (AppState.session.skipped[skipKey] || 0) + 1;
  AppState.session.skipped[skipKey] = skipCount;

  if (skipCount > 1) {
    removeCurrentWordFromSession('practice');
    return;
  }

  const [deferredWord] = AppState.session.queue.splice(AppState.session.current, 1);
  if (!deferredWord) return;

  AppState.session.queue.push(deferredWord);
  AppState.session.currentExercise = null;
  resetRoundInteractionState();

  if (AppState.session.current >= AppState.session.queue.length) {
    if (AppState.session.round >= getMaxRound()) {
      dispatch({ type: 'SET_SCREEN', payload: 'summary' });
      return;
    }
    dispatch({ type: 'SET_ROUND', payload: AppState.session.round + 1 });
  }

  startRoundExercise();
}

function removeCurrentWordFromSession(status) {
  const word = currentWord();
  if (!word) return;

  if (status === 'known') {
    dispatch({ type: 'MARK_KNOWN', payload: word });
  } else if (status === 'practice') {
    dispatch({ type: 'MARK_PRACTICE', payload: word });
  }

  AppState.session.queue.splice(AppState.session.current, 1);
  AppState.session.words = AppState.session.words.filter((sessionWord) => sessionWord !== word);
  AppState.session.currentExercise = null;

  if (AppState.session.queue.length === 0) {
    dispatch({ type: 'SET_SCREEN', payload: 'summary' });
    return;
  }

  if (AppState.session.current >= AppState.session.queue.length) {
    if (AppState.session.round >= getMaxRound()) {
      dispatch({ type: 'SET_SCREEN', payload: 'summary' });
      return;
    }
    dispatch({ type: 'SET_ROUND', payload: AppState.session.round + 1 });
  }

  startRoundExercise();
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

function pickPracticeGapExampleIndex(word) {
  const examples = Array.isArray(AllWords[word]?.ex) ? AllWords[word].ex : [];
  if (examples.length <= 1) return 0;

  if (!AppState.session.templateHistory) {
    AppState.session.templateHistory = {};
  }

  const recent = AppState.session.templateHistory[word] || [];
  let candidates = examples.map((_, idx) => idx).filter((idx) => !recent.includes(idx));
  if (candidates.length === 0) {
    candidates = examples.map((_, idx) => idx);
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)] || 0;
  AppState.session.templateHistory[word] = [picked, ...recent.filter((idx) => idx !== picked)].slice(0, 2);
  return picked;
}

function buildExercise(queueItem, round, wordIndex) {
  const word = queueItem;
  if (AppState.session.isDemo) {
    if (AppState.session.demoType === 'COLLOCATION_MATCH') {
      return Exercises.renderCollocationMatch(word, AllWords);
    }
    if (AppState.session.demoType === 'ERROR_CORRECTION') {
      return Exercises.renderErrorCorrection(word, AllWords);
    }
  }
  // Typed session: force a specific exercise type for all rounds
  if (AppState.session.forceType === 'COLLOCATION_MATCH') {
    return Exercises.renderCollocationMatch(word, AllWords) || Exercises.renderDefinition(word, AllWords);
  }
  if (AppState.session.forceType === 'ERROR_CORRECTION') {
    return Exercises.renderErrorCorrection(word, AllWords) || Exercises.renderDefinition(word, AllWords);
  }
  if (round === 1) return Exercises.renderDefinition(word, AllWords);
  if (round === 2) return Exercises.renderENtoTRMC(word, AllWords);
  if (round === 3) {
    const status = AppState.progress.words[word]?.status;
    const isPractice = status === 'practice';
    const preferredExampleIndex = isPractice ? pickPracticeGapExampleIndex(word) : 0;
    return Exercises.renderGapFill(word, AllWords, 0, { isPractice, preferredExampleIndex });
  }
  if (round === 4) {
    return wordIndex % 2 === 0
      ? Exercises.renderSentenceBuilder(word, AllWords)
      : Exercises.renderTranslationMC(word, AllWords);
  }
  if (round === 5) {
    return Exercises.renderContextMatch(word, AllWords);
  }
  if (round === 6) {
    return Exercises.renderMultiGap(word, AppState.session.queue, AllWords);
  }
  if (round === 7) {
    return Exercises.renderFreeTypeGap(word, AllWords);
  }
  // Fallback
  return Exercises.renderDefinition(word, AllWords);
}

function getMaxRound() {
  if (AppState.session.isDemo) return 1;
  if (AppState.session.forceType) return 3;
  const queue = AppState.session.queue || [];
  const hasRound5 = queue.some(w => Exercises.hasContextMatchData(w, AllWords));
  const hasRound6 = queue.length >= 2;

  // Round 7 (Free-type Gap) always available
  return 7;
}

function shouldSkipRound(round, word) {
  if (AppState.session.forceType) return false;
  if (round === 5) {
    return !Exercises.hasContextMatchData(word, AllWords);
  }
  if (round === 6) {
    return AppState.session.queue.length < 2;
  }
  return false;
}

function startRoundExercise() {
  const queueItem = currentQueueItem();
  if (!queueItem) {
    const maxRound = getMaxRound();
    if (AppState.session.round >= maxRound) {
      dispatch({ type: 'SET_SCREEN', payload: 'summary' });
      return;
    }
    dispatch({ type: 'SET_ROUND', payload: AppState.session.round + 1 });
    startRoundExercise();
    return;
  }

  const word = typeof queueItem === 'string' ? queueItem : queueItem.word;

  // Skip this word for this round if exercise not available
  if (shouldSkipRound(AppState.session.round, word)) {
    dispatch({ type: 'ADVANCE_SESSION_INDEX' });
    startRoundExercise();
    return;
  }

  const exercise = buildExercise(queueItem, AppState.session.round, AppState.session.current);

  // If exercise couldn't be built (e.g. renderContextMatch returned null), skip
  if (!exercise) {
    dispatch({ type: 'ADVANCE_SESSION_INDEX' });
    startRoundExercise();
    return;
  }

  dispatch({ type: 'SET_CURRENT_EXERCISE', payload: exercise });
}

function recordPosError(word) {
  const existing = AppState.progress.words[word] || { status: 'practice', interval: 1, nextReview: toLocalDate(1), posErrors: {} };
  const pos = AllWords[word]?.pos || 'unknown';
  const posErrors = existing.posErrors || {};
  posErrors[pos] = (posErrors[pos] || 0) + 1;
  AppState.progress.words[word] = { ...existing, posErrors };
}

function resetRoundInteractionState() {
  dispatch({ type: 'SET_OPTION', payload: null });
  dispatch({ type: 'SET_REVEAL', payload: null });
  dispatch({ type: 'SET_LOCKED', payload: false });
  dispatch({ type: 'SET_PENDING_RESULT', payload: null });
  dispatch({ type: 'SET_SB_PREFIX', payload: 0 });
  dispatch({ type: 'SET_SB_SHAKE', payload: false });
  dispatch({ type: 'SET_FEEDBACK', payload: '' });
  dispatch({ type: 'SET_FREE_TYPE_SECOND_CHANCE', payload: false });
  dispatch({ type: 'SET_EC_REVEAL_PROMPT', payload: false });
}

function finalizeRoundAnswer(correct) {
  const word = currentWord();
  const round = AppState.session.round;
  const maxRound = getMaxRound();

  dispatch({ type: 'SAVE_RESULT', payload: { word, round, correct } });

  if (AppState.session.isDemo) {
    dispatch({ type: 'ADVANCE_SESSION_INDEX' });
    startRoundExercise();
    return;
  }

  if (!correct) {
    recordPosError(word);
    dispatch({ type: 'MARK_PRACTICE', payload: word });
  } else if (round >= maxRound) {
    const allCorrect = Object.values(AppState.session.results[word] || {}).every(Boolean);
    // Track review completions for the daily goal
    if (allCorrect) {
      const wp = AppState.progress.words[word];
      if (wp && wp.status === 'learned' && wp.nextReview && wp.nextReview <= toLocalDate(0)) {
        recordReviewCleared();
      }
    }
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

  if (exercise.type === 'FREE_TYPE_GAP') {
    const inputEl = document.getElementById('freeTypeInput');
    const userInput = (inputEl?.value || AppState.ui.freeTypeInput || '').trim().toLowerCase();
    if (!userInput) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Type your answer first.' });
      return;
    }
    const correct = exercise.correct.toLowerCase();
    const isCorrect = userInput === correct || userInput === correct.replace(/'/g, "'");
    if (isCorrect) {
      dispatch({ type: 'SET_LOCKED', payload: true });
      dispatch({ type: 'SET_FEEDBACK', payload: '✓ Correct!' });
      dispatch({ type: 'SET_PENDING_RESULT', payload: true });
    } else if (!AppState.ui.freeTypeSecondChance) {
      // First wrong: give another chance
      dispatch({ type: 'SET_FREE_TYPE_SECOND_CHANCE', payload: true });
      dispatch({ type: 'SET_FEEDBACK', payload: 'Not quite. Try again!' });
      if (inputEl) inputEl.value = '';
    } else {
      // Second wrong: lock and show correct answer
      dispatch({ type: 'SET_LOCKED', payload: true });
      dispatch({ type: 'SET_FEEDBACK', payload: `Wrong. Correct answer: ${exercise.correct}` });
      dispatch({ type: 'SET_PENDING_RESULT', payload: false });
    }
    return;
  }

  if (exercise.type === 'SENTENCE_BUILDER') {
    const placed = AppState.ui.selectedChips || [];
    if (placed.length === 0) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Tap words to build the sentence first.' });
      return;
    }

    const userAnswer = placed.join(' ');
    const isCorrect = userAnswer.trim() === exercise.correct.trim();
    const correctTokens = exercise.correctTokens || exercise.correct.split(/\s+/).filter(Boolean);
    let prefixMatch = 0;
    while (
      prefixMatch < placed.length
      && prefixMatch < correctTokens.length
      && placed[prefixMatch] === correctTokens[prefixMatch]
    ) {
      prefixMatch += 1;
    }

    if (isCorrect) {
      dispatch({ type: 'SET_FEEDBACK', payload: '✓ Correct!' });
      dispatch({ type: 'SET_SB_PREFIX', payload: correctTokens.length });
      dispatch({ type: 'SET_SB_SHAKE', payload: false });
      dispatch({ type: 'SET_LOCKED', payload: true });
      dispatch({ type: 'SET_PENDING_RESULT', payload: true });
    } else {
      dispatch({ type: 'SET_SB_PREFIX', payload: prefixMatch });
      dispatch({ type: 'SET_SB_SHAKE', payload: true });
      dispatch({
        type: 'SET_FEEDBACK',
        payload: prefixMatch > 0
          ? `Order is not right yet. First ${prefixMatch} word(s) are correct.`
          : 'Order is not right yet. Try another sequence.'
      });
      window.setTimeout(() => {
        dispatch({ type: 'SET_SB_SHAKE', payload: false });
      }, 260);
    }
    return;
  }

  if (exercise.type === 'CONTEXT_MATCH') {
    const selected = AppState.ui.selectedOption;
    if (selected === null || selected === undefined) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Please select a sentence.' });
      return;
    }
    const isCorrect = selected === exercise.correct;
    dispatch({ type: 'SET_REVEAL', payload: { selected, correct: exercise.correct } });
    dispatch({ type: 'SET_FEEDBACK', payload: isCorrect ? '✓ Correct! That sentence uses the word incorrectly.' : `Wrong. The incorrect sentence was: "${exercise.correct}"` });
    dispatch({ type: 'SET_LOCKED', payload: true });
    dispatch({ type: 'SET_PENDING_RESULT', payload: isCorrect });
    return;
  }

  if (exercise.type === 'MULTI_GAP') {
    const placed = AppState.ui.selectedChips || [];
    const gapSentence = exercise.gapSentence;

    if (exercise.mode === 'separate') {
      // Need 2 chips placed (one per gap)
      if (placed.length < 2) {
        dispatch({ type: 'SET_FEEDBACK', payload: 'Place a word in each blank.' });
        return;
      }
      const isCorrect = placed[0] === gapSentence[0].correct && placed[1] === gapSentence[1].correct;
      dispatch({ type: 'SET_LOCKED', payload: true });
      if (isCorrect) {
        dispatch({ type: 'SET_FEEDBACK', payload: '✓ Correct!' });
        dispatch({ type: 'SET_PENDING_RESULT', payload: true });
      } else {
        dispatch({ type: 'SET_FEEDBACK', payload: `Wrong. Correct: ${gapSentence[0].correct} / ${gapSentence[1].correct}` });
        dispatch({ type: 'SET_PENDING_RESULT', payload: false });
      }
    } else {
      // Single or compound: gaps array
      const gaps = gapSentence[0].gaps;
      if (placed.length < gaps.length) {
        dispatch({ type: 'SET_FEEDBACK', payload: 'Place a word in each blank.' });
        return;
      }
      const isCorrect = gaps.every((gap, i) => placed[i] === gap.correct);
      dispatch({ type: 'SET_LOCKED', payload: true });
      if (isCorrect) {
        dispatch({ type: 'SET_FEEDBACK', payload: '✓ Correct!' });
        dispatch({ type: 'SET_PENDING_RESULT', payload: true });
      } else {
        const correctStr = gaps.map(g => g.correct).join(' / ');
        dispatch({ type: 'SET_FEEDBACK', payload: `Wrong. Correct: ${correctStr}` });
        dispatch({ type: 'SET_PENDING_RESULT', payload: false });
      }
    }
    return;
  }

  if (exercise.type === 'COLLOCATION_MATCH') {
    const selected = AppState.ui.selectedOption;
    if (selected === null || selected === undefined) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Please select a collocation.' });
      return;
    }
    const isCorrect = selected === exercise.correct;
    dispatch({ type: 'SET_REVEAL', payload: { selected, correct: exercise.correct } });
    dispatch({ type: 'SET_FEEDBACK', payload: isCorrect ? '✓ Correct collocation!' : `Wrong. Correct: "${exercise.correct}"` });
    dispatch({ type: 'SET_LOCKED', payload: true });
    dispatch({ type: 'SET_PENDING_RESULT', payload: isCorrect });
    return;
  }

  if (exercise.type === 'ERROR_CORRECTION') {
    const inputEl = document.getElementById('freeTypeInput');
    const userInput = (inputEl?.value || AppState.ui.freeTypeInput || '').trim();
    if (!userInput) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Type the corrected sentence.' });
      return;
    }
    // Normalize for comparison
    const normalize = (s) => s.toLowerCase().replace(/[.,!?;:'"()\[\]]/g, '').replace(/\s+/g, ' ').trim();
    const isCorrect = normalize(userInput) === normalize(exercise.correctSentence);
    // Also accept if user typed just the correct word
    const wordOnly = normalize(userInput) === normalize(exercise.correctWord);
    if (isCorrect || wordOnly) {
      dispatch({ type: 'SET_LOCKED', payload: true });
      dispatch({ type: 'SET_FEEDBACK', payload: `✓ Correct! The right sentence: "${exercise.correctSentence}"` });
      dispatch({ type: 'SET_PENDING_RESULT', payload: true });
    } else {
      // Every wrong attempt: ask if they want the answer
      dispatch({ type: 'SET_EC_REVEAL_PROMPT', payload: true });
      if (inputEl) inputEl.value = '';
    }
    return;
  }

  const selected = AppState.ui.selectedOption;
  if (selected === null || selected === undefined) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'Please select an option.' });
    return;
  }

  const isCorrect = selected === exercise.correct;
  dispatch({ type: 'SET_REVEAL', payload: { selected, correct: exercise.correct } });

  if (isCorrect) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'Correct.' });
  } else {
    const word = exercise.word || currentWord();
    const wordData = AllWords[word] || {};
    const wrongCount = (AppState.session.results[word] ? Object.values(AppState.session.results[word]).filter(v => !v).length : 0) + 1;
    let hint = `Wrong. Correct answer: ${exercise.correct}`;
    if (wrongCount >= 2 && wordData.def) {
      hint += ` | Hint: ${wordData.def}`;
      if (wordData.ex && wordData.ex[0]) {
        hint += ` — e.g. "${wordData.ex[0]}"`;
      }
    }
    dispatch({ type: 'SET_FEEDBACK', payload: hint });
  }
  dispatch({ type: 'SET_LOCKED', payload: true });
  dispatch({ type: 'SET_PENDING_RESULT', payload: isCorrect });
}

// ── Streak System ─────────────────────────────────────────────────────────

function getStreakData() {
  const json = localStorage.getItem('wf_streak');
  if (!json) return { currentStreak: 0, lastSessionDate: null, longestStreak: 0 };
  try {
    return JSON.parse(json);
  } catch (e) {
    return { currentStreak: 0, lastSessionDate: null, longestStreak: 0 };
  }
}

function saveStreakData(data) {
  const payload = JSON.stringify(data);
  const current = localStorage.getItem('wf_streak');
  if (current === payload) return;

  localStorage.setItem('wf_streak', payload);
  localStorage.setItem(WF_PROGRESS_UPDATED_KEY, new Date().toISOString());

  if (window.WFCloud) {
    window.WFCloud.notifyLocalChange();
  }
}

function updateStreak() {
  const today = toLocalDate(0);
  const yesterday = toLocalDate(-1);
  const streak = getStreakData();

  if (streak.lastSessionDate === today) return streak;

  if (streak.lastSessionDate === yesterday) {
    streak.currentStreak += 1;
  } else {
    streak.currentStreak = 1;
  }

  streak.lastSessionDate = today;
  if (streak.currentStreak > (streak.longestStreak || 0)) {
    streak.longestStreak = streak.currentStreak;
  }

  saveStreakData(streak);
  return streak;
}

// ── Gamification Helpers ───────────────────────────────────────────────────

function getXP() {
  const json = localStorage.getItem('wf_xp');
  const today = toLocalDate(0);
  let xp;
  try { xp = json ? JSON.parse(json) : null; } catch { xp = null; }
  if (!xp) xp = { total: 0, today: 0, lastDate: null };
  // Lazy daily reset — fires whenever XP is read on a new day
  if (xp.lastDate !== today) { xp.today = 0; xp.lastDate = today; localStorage.setItem('wf_xp', JSON.stringify(xp)); }
  return xp;
}

function addXP(amount) {
  const xp = getXP();
  const today = toLocalDate(0);
  if (xp.lastDate !== today) { xp.today = 0; xp.lastDate = today; }
  xp.today += amount;
  xp.total += amount;
  localStorage.setItem('wf_xp', JSON.stringify(xp));
  return xp;
}

function getReviewsCleared() {
  const today = toLocalDate(0);
  try {
    const data = JSON.parse(localStorage.getItem('wf_reviews_cleared') || 'null');
    return (data && data.date === today) ? (data.count || 0) : 0;
  } catch { return 0; }
}

function recordReviewCleared() {
  const today = toLocalDate(0);
  const count = getReviewsCleared() + 1;
  localStorage.setItem('wf_reviews_cleared', JSON.stringify({ date: today, count }));
}

function getWeeklyActivity() {
  const json = localStorage.getItem('wf_weekly_activity');
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
}

function recordDailyActivity(wordsCompleted) {
  const today = toLocalDate(0);
  const activity = getWeeklyActivity();
  activity[today] = (activity[today] || 0) + wordsCompleted;
  // Keep only last 14 days
  const cutoff = toLocalDate(-14);
  Object.keys(activity).forEach(d => { if (d < cutoff) delete activity[d]; });
  localStorage.setItem('wf_weekly_activity', JSON.stringify(activity));
}

function buildWeeklyHeatmap() {
  const activity = getWeeklyActivity();
  const days = [];
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  for (let i = 6; i >= 0; i--) {
    const date = toLocalDate(-i);
    const count = activity[date] || 0;
    const intensity = count === 0 ? 0 : count <= 3 ? 1 : count <= 7 ? 2 : count <= 12 ? 3 : 4;
    const isToday = i === 0;
    const dayIndex = new Date(date + 'T00:00:00').getDay();
    const label = dayLabels[(dayIndex + 6) % 7]; // Mon=0
    days.push({ date, count, intensity, isToday, label });
  }
  return days;
}

function buildLevelProgress(progress) {
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
  return levels.map(level => {
    const totalInLevel = Object.keys(AllWords).filter(w => AllWords[w]?.level === level).length;
    const knownInLevel = Object.keys(progress.words).filter(w => {
      const s = progress.words[w]?.status;
      return (s === 'known' || s === 'learned') && AllWords[w]?.level === level;
    }).length;
    const fill = totalInLevel > 0 ? (knownInLevel / totalInLevel) : 0;
    return { level, total: totalInLevel, known: knownInLevel, fill };
  });
}

function getDailyGoals(progress) {
  const xp = getXP();
  const today = toLocalDate(0);
  const activity = getWeeklyActivity();
  const wordsToday = activity[today] || 0;
  const reviewDue = getReviewDue(progress).length;
  return [
    { icon: '📚', title: 'Learn 5 words', current: wordsToday, target: 5 },
    { icon: '⭐', title: 'Earn 50 XP', current: xp.today, target: 50 },
    { icon: '🔔', title: 'Review words', current: getReviewsCleared(), target: 5 }
  ];
}

function triggerConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  container.innerHTML = '<div class="confetti-container">' +
    Array.from({ length: 10 }, (_, i) => `<div class="confetti-piece"></div>`).join('') +
    '</div>';
  setTimeout(() => { container.innerHTML = ''; }, 3500);
}

function renderHome(state) {
  const words = state.progress.words;
  const learned = Object.keys(words).filter((w) => words[w].status === 'learned').length;
  const known = Object.keys(words).filter((w) => words[w].status === 'known').length;
  const reviewDue = getReviewDue(state.progress).length;
  const today = toLocalDate(0);
  const wordsToday = getWeeklyActivity()[today] || 0;
  const focusPool = Math.max(0, Object.keys(AllWords).length - (known + learned));
  const streak = getStreakData();

  const levelData = buildLevelProgress(state.progress);
  const levelBarHtml = levelData.map(l =>
    `<div class="home-level-segment" data-level="${l.level}" style="--fill:${l.fill.toFixed(3)}" title="${l.level}: ${l.known}/${l.total}"></div>`
  ).join('');

  const streakHtml = streak.currentStreak > 0
    ? `<div class="home-streak-pill"><span>🔥</span><span class="home-streak-num">${streak.currentStreak}</span></div>`
    : '';

  return `
    <div class="home-screen card-slide-enter">
      <div class="home-header">
        <div class="home-headline">
          <h1 style="margin-bottom:4px;">WordForge</h1>
          <p style="margin:0;color:var(--text-secondary);font-size:0.88rem;">Build momentum daily with short, focused sessions.</p>
        </div>
        ${streakHtml}
      </div>
      <div class="home-quick-grid" style="margin-bottom:14px;">
        <div class="home-quick-card">
          <div class="home-quick-label">Today</div>
          <div class="home-quick-value">${wordsToday} words</div>
        </div>
        <div class="home-quick-card">
          <div class="home-quick-label">Due for review</div>
          <div class="home-quick-value" style="${reviewDue > 0 ? 'color:var(--accent)' : ''}">${reviewDue}</div>
        </div>
        <div class="home-quick-card">
          <div class="home-quick-label">Focus Pool</div>
          <div class="home-quick-value">${focusPool}</div>
        </div>
        <div class="home-quick-card">
          <div class="home-quick-label">Session Size</div>
          <div class="home-quick-value">${state.ui.sessionSize || 10}</div>
        </div>
      </div>
      <div class="home-level-row">
        <div class="home-level-bar">${levelBarHtml}</div>
        <div class="home-level-labels">
          ${levelData.map(l => `<span>${l.level}</span>`).join('')}
        </div>
      </div>
      <button class="home-manage-card btn-press" data-action="open-manage-words">
        <span class="home-manage-icon">📚</span>
        <div class="home-manage-body">
          <div class="home-manage-title">Manage Words</div>
          <div class="home-manage-desc">Browse vocabulary, mark known words, or hand-pick for your next session.</div>
        </div>
        <span class="home-manage-arrow">›</span>
      </button>
    </div>
  `;
}

function renderProgress(state) {
  const words = state.progress.words;
  const learned = Object.keys(words).filter((w) => words[w].status === 'learned').length;
  const known = Object.keys(words).filter((w) => words[w].status === 'known').length;
  const practice = Object.keys(words).filter((w) => words[w].status === 'practice').length;
  const reviewDue = getReviewDue(state.progress).length;
  const total = Object.keys(AllWords).length;
  const knownOrLearned = known + learned;
  const available = total - knownOrLearned;
  const streak = getStreakData();
  const xp = getXP();

  const levelData = buildLevelProgress(state.progress);
  const levelProgressHtml = `
    <div class="level-progress">
      ${levelData.map(l => `<div class="level-progress-segment" data-level="${l.level}" style="--fill:${l.fill.toFixed(3)}" title="${l.level}: ${l.known}/${l.total}"></div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--text-secondary);margin:-8px 0 8px;">
      ${levelData.map(l => `<span>${l.level}</span>`).join('')}
    </div>`;

  // Weekly streak bubbles (Duolingo style)
  const weekDays = buildWeeklyHeatmap();
  const heatmapHtml = `
    <div class="streak-days">
      ${weekDays.map(d => {
        const done = d.count > 0;
        const isPast = !d.isToday;
        let circleContent, circleClass;
        if (done) {
          circleContent = '🔥';
          circleClass = 'done';
        } else if (d.isToday) {
          circleContent = '🕯️';
          circleClass = 'pending';
        } else {
          circleContent = '❄️';
          circleClass = 'missed';
        }
        return `<div class="streak-day-col${d.isToday ? ' today' : ''}">
          <div class="streak-day-circle ${circleClass}">${circleContent}</div>
          <div class="streak-day-label">${d.label}</div>
          <div class="streak-day-count">${d.count > 0 ? d.count : ''}</div>
        </div>`;
      }).join('')}
    </div>`;

  // Daily goals
  const goals = getDailyGoals(state.progress);
  const goalsHtml = goals.map(g => {
    const pct = Math.min(100, Math.round((g.current / g.target) * 100));
    const done = pct >= 100;
    return `<div class="daily-goal ${done ? 'daily-goal-done' : ''}">
      <span class="daily-goal-icon">${g.icon}</span>
      <div class="daily-goal-info">
        <span class="daily-goal-title">${g.title}</span>
        <div class="daily-goal-bar"><div class="daily-goal-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <span class="daily-goal-count">${g.current}/${g.target}</span>
    </div>`;
  }).join('');

  return `
    <div class="home-screen card-slide-enter">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2>Progress</h2>
        <button class="btn btn-muted btn-press" data-action="go-home">← Back</button>
      </div>

      <div class="card" style="padding:16px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div class="streak-display" style="margin-bottom:0;">
            <span class="streak-fire">${streak.currentStreak > 0 ? '🔥' : '⚪'}</span>
            <span class="streak-count">${streak.currentStreak} day${streak.currentStreak !== 1 ? 's' : ''}</span>
            <span class="streak-best">Best: ${streak.longestStreak || 0}</span>
          </div>
          <div class="xp-display" title="Total XP earned"><span class="xp-icon">⚡</span><span>${xp.total} XP</span>${xp.today > 0 ? `<span class="xp-today">+${xp.today}</span>` : ''}</div>
        </div>
        ${levelProgressHtml}
        <div class="home-word-stats" style="margin-top:4px;">
          <span class="home-stat"><span class="home-stat-label">Total</span><span class="home-stat-value">${total}</span></span>
          <span class="home-stat-sep">·</span>
          <span class="home-stat"><span class="home-stat-label">Known</span><span class="home-stat-value home-stat-known">${knownOrLearned}</span></span>
          <span class="home-stat-sep">·</span>
          <span class="home-stat"><span class="home-stat-label">Available</span><span class="home-stat-value home-stat-available">${available}</span></span>
        </div>
      </div>

      <div class="card" style="padding:14px;margin-bottom:12px;">
        <div class="progress-section-title">This Week</div>
        ${heatmapHtml}
      </div>

      <div class="card" style="padding:14px;margin-bottom:12px;">
        <div class="progress-section-title">Today's Goals</div>
        <div style="display:flex;flex-direction:column;gap:8px;">${goalsHtml}</div>
      </div>

      <div class="stats-grid">
        <button class="stat-card btn-press" data-action="open-list" data-filter="learned">
          <span class="stat-card-icon">📚</span>
          <span class="stat-card-value" style="color:var(--accent)">${learned}</span>
          <span class="stat-card-label">Learned</span>
        </button>
        <button class="stat-card btn-press" data-action="open-list" data-filter="known">
          <span class="stat-card-icon">✓</span>
          <span class="stat-card-value" style="color:var(--success)">${known}</span>
          <span class="stat-card-label">Known</span>
        </button>
        <button class="stat-card btn-press" data-action="open-list" data-filter="review">
          <span class="stat-card-icon">🔔</span>
          <span class="stat-card-value" style="color:${reviewDue > 0 ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)'}">${reviewDue}</span>
          <span class="stat-card-label">Due review</span>
        </button>
        <button class="stat-card btn-press" data-action="open-list" data-filter="practice">
          <span class="stat-card-icon">🏋️</span>
          <span class="stat-card-value" style="color:var(--text-secondary)">${practice}</span>
          <span class="stat-card-label">In Training</span>
        </button>
      </div>
    </div>
  `;
}

function renderExtras(state) {
  return `
    <div class="home-screen card-slide-enter">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h2>Practice &amp; Tools</h2>
        <button class="btn btn-muted btn-press" data-action="go-train">← Back</button>
      </div>
      <div class="stats-grid" style="grid-template-columns:1fr;">
        <button class="card btn-press" data-action="open-flashcards" style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:1.5rem;">🃏</span>
          <div style="text-align:left;"><strong>Flashcards</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">Review learned words with flip cards</span></div>
        </button>
        <button class="card btn-press" data-action="demo-collocation" style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:1.5rem;">🔗</span>
          <div style="text-align:left;"><strong>Collocation Match</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">Practice word partnerships from your learned pool</span></div>
        </button>
        <button class="card btn-press" data-action="demo-error-correction" style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:1.5rem;">✏️</span>
          <div style="text-align:left;"><strong>Error Correction</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">Spot and fix word usage mistakes in real sentences</span></div>
        </button>
      </div>
    </div>
  `;
}

function renderTrain(state) {
  const sessionSize = state.ui.sessionSize || 10;
  const reviewDue = getReviewDue(state.progress).length;
  const sizeOptions = [5, 10, 15, 20].map(size =>
    `<button class="session-size-btn btn-press ${size === sessionSize ? 'active' : ''}" data-action="set-session-size" data-size="${size}">${size}</button>`
  ).join('');

  return `
    <div class="train-screen card-slide-enter">
      <h2 style="margin-bottom:4px;">Learn</h2>
      <p style="color:var(--text-secondary);margin-bottom:20px;font-size:0.88rem;">Choose how you want to practice today.</p>
      <button class="train-card train-card-start btn-press" data-action="start-session">
        <span class="train-card-icon">▶️</span>
        <div class="train-card-body">
          <div class="train-card-title">Start Session</div>
          <div class="train-card-desc">${reviewDue > 0 ? `<strong style="color:var(--accent)">${reviewDue}</strong> words due for review · ` : ''}New vocabulary &amp; spaced repetition</div>
        </div>
      </button>
      <button class="train-card train-card-practice btn-press" data-action="open-extras">
        <span class="train-card-icon">🎯</span>
        <div class="train-card-body">
          <div class="train-card-title">Practice Exercises</div>
          <div class="train-card-desc">Collocations, error correction, flashcards</div>
        </div>
      </button>
      <div class="train-size-config">
        <span class="train-size-label">Session size</span>
        <div class="session-size-options">${sizeOptions}</div>
      </div>
    </div>
  `;
}

function renderPrep(state) {
  const level = state.ui.prepLevel || 'ALL';
  const selectionMode = state.ui.prepSelectionMode || 'known';
  const page = state.ui.prepPage || 0;
  const pageSize = 24;
  const levels = ['ALL', 'A1', 'A2', 'B1', 'B2', 'C1'];

  const baseCandidates = Object.keys(AllWords)
    .filter((word) => {
      const status = state.progress.words[word]?.status;
      return status !== 'known' && status !== 'learned';
    })
    .sort((a, b) => a.localeCompare(b));

  const candidates = baseCandidates.filter((word) => isEligibleForLevel(word, level));

  const totalPages = Math.max(1, Math.ceil(candidates.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  if (safePage !== page) {
    dispatch({ type: 'SET_PREP_PAGE', payload: safePage });
    return '<div class="card">Preparing words...</div>';
  }

  const pageItems = candidates.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selectedKnown = new Set(state.ui.prepSelectedKnown || []);
  const selectedSession = new Set(state.ui.prepSelectedSession || []);
  const selected = selectionMode === 'session' ? selectedSession : selectedKnown;
  const persistentKnownCount = Object.keys(state.progress.words).filter(
    (w) => state.progress.words[w]?.status === 'known' || state.progress.words[w]?.status === 'learned'
  ).length;
  const totalMarked = persistentKnownCount + selectedKnown.size;

  const levelCounts = {};
  levels.forEach((l) => {
    if (l === 'ALL') {
      levelCounts[l] = baseCandidates.length;
    } else {
      levelCounts[l] = baseCandidates.filter((w) => AllWords[w]?.level === l).length;
    }
  });

  const levelButtons = levels
    .map((l) => `<button class="prep-level ${l === level ? 'active' : ''}" data-action="prep-select-level" data-level="${l}">${l} <span class="prep-level-count">${levelCounts[l]}</span></button>`)
    .join('');

  const modeSubtitle = selectionMode === 'session'
    ? 'Tap words to pick them for your next session.'
    : 'Tap words to mark them as known — they won\'t appear in new sessions.';

  const chips = pageItems
    .map((word) => {
      const classes = ['prep-chip'];
      if (selectedKnown.has(word)) classes.push('selected-known');
      if (selectedSession.has(word)) classes.push('selected-session');
      if (selected.has(word)) classes.push('selected');
      return `<button class="${classes.join(' ')}" data-action="prep-toggle-word" data-word="${word}">${word}</button>`;
    })
    .join('');

  return `
    <div class="prep-screen card">
      <div class="prep-header">
        <button class="btn btn-muted" data-action="prep-back">← Back</button>
        <div class="prep-mode-toggle">
          <button class="prep-mode-btn ${selectionMode === 'known' ? 'active' : ''}" data-action="prep-set-mode" data-mode="known">Known</button>
          <button class="prep-mode-btn ${selectionMode === 'session' ? 'active' : ''}" data-action="prep-set-mode" data-mode="session">Session</button>
        </div>
        <span class="prep-count">${selectionMode === 'session' ? `🎯 ${selectedSession.size} picks` : `✓ ${totalMarked}`}</span>
      </div>
      <p class="prep-subtitle">${modeSubtitle}</p>
      <div class="prep-levels">${levelButtons}</div>
      <div class="prep-grid-wrap">
        <div class="prep-grid">${chips || '<p class="prep-empty">No words for this filter.</p>'}</div>
      </div>
      <div class="prep-footer">
        <div class="prep-pagination">
          <button class="btn btn-muted" data-action="prep-prev" ${safePage <= 0 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${safePage + 1} / ${totalPages}</span>
          <button class="btn btn-muted" data-action="prep-next" ${safePage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        </div>
        <div class="prep-actions">
          <button class="btn btn-muted prep-save-btn" data-action="prep-save" ${(state.ui.prepSelectedKnown || []).length === 0 ? 'disabled' : ''}>Save Known</button>
          <button class="btn prep-continue-btn" data-action="prep-start-session">Start Session →</button>
        </div>
      </div>
    </div>
  `;
}

// ── Flashcard Mode ────────────────────────────────────────────────────────

function getFlashcardPool() {
  const progressWords = AppState.progress.words || {};
  return Object.keys(progressWords).filter((w) => {
    const status = progressWords[w]?.status;
    return (status === 'practice' || status === 'learned') && AllWords[w];
  });
}

function renderFlashcards(state) {
  const pool = getFlashcardPool();
  if (pool.length === 0) {
    return `
      <div class="flashcard-screen">
        <div class="card centered-card">
          <h2>No Flashcards Available</h2>
          <p>Complete some sessions first to build your flashcard deck.</p>
          <button class="btn" data-action="go-home">Back Home</button>
        </div>
      </div>
    `;
  }

  const idx = state.ui.flashcardIndex || 0;
  const safeIdx = idx % pool.length;
  const word = pool[safeIdx];
  const wordData = AllWords[word] || {};
  const flipped = state.ui.flashcardFlipped;

  const front = `
    <div class="flashcard-word">${escapeHtml(word.replace(/_/g, ' '))}</div>
    <div class="flashcard-pos">${escapeHtml(wordData.pos || '')}</div>
  `;

  const back = `
    <div class="flashcard-tr">${escapeHtml(wordData.tr || '')}</div>
    <div class="flashcard-def">${escapeHtml(wordData.def || '')}</div>
    ${wordData.ex && wordData.ex[0] ? `<div class="flashcard-ex">"${escapeHtml(wordData.ex[0])}"</div>` : ''}
  `;

  return `
    <div class="flashcard-screen">
      <div class="flashcard-progress">${safeIdx + 1} / ${pool.length}</div>
      <div class="flashcard-card ${flipped ? 'flipped' : ''}" data-action="flashcard-flip">
        <div class="flashcard-front">${front}</div>
        <div class="flashcard-back">${back}</div>
      </div>
      <p class="flashcard-hint-text">${flipped ? '' : 'Tap card to reveal'}</p>
      <div class="flashcard-actions">
        <button class="btn btn-muted" data-action="flashcard-prev" ${safeIdx <= 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn" data-action="flashcard-next">Next →</button>
        <button class="btn btn-muted" data-action="go-home">Done</button>
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
    <div class="gate-screen card-slide-enter" style="position:relative;">
      <div class="card centered-card">
        <h2>Do you know this word?</h2>
        <div class="word-display">${word}</div>
        <div class="actions">
          <button class="btn btn-press" data-action="gate-known">Yes, I know it</button>
          <button class="btn btn-press" data-action="gate-learn">No, teach me</button>
          <button class="btn btn-muted btn-press" data-action="gate-back">← Back</button>
        </div>
        <p>${state.session.current + 1} / ${state.session.queue.length}</p>
      </div>
      <div class="gesture-hint gesture-hint-right"><span class="gesture-hint-arrow">→</span> Know it</div>
      <div class="gesture-hint gesture-hint-left">Learn <span class="gesture-hint-arrow">←</span></div>
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

function renderRoundFrame(state, body, maxRound, progress) {
  const totalWords = state.session.queue.length;
  const wordPct = totalWords > 0 ? Math.round((state.session.current / totalWords) * 100) : 0;

  const roundStepsHtml = Array.from({ length: maxRound }, (_, i) => {
    const roundNum = i + 1;
    const isDone = roundNum < state.session.round;
    const isActive = roundNum === state.session.round;
    const label = isDone ? '✓' : `${roundNum}`;
    const cls = `rp-step${isDone ? ' done' : ''}${isActive ? ' active' : ''}`;
    const connectorHtml = i > 0 ? `<div class="rp-connector${isDone ? ' done' : ''}"></div>` : '';
    return `${connectorHtml}<div class="${cls}"><span class="rp-step-label">${label}</span><span class="rp-step-name">Round ${roundNum}</span></div>`;
  }).join('');

  const roundProgressHtml = `
    <div class="round-progress-wrap" aria-hidden="true">
      <div class="rp-steps">${roundStepsHtml}</div>
      <div class="rp-word-track">
        <div class="rp-word-fill" style="width:${wordPct}%"></div>
      </div>
    </div>
  `;

  const feedbackClass = state.ui.feedback
    ? (state.ui.feedback.startsWith('✓') || state.ui.feedback.startsWith('Correct') ? 'correct-pulse' :
       (state.ui.feedback.startsWith('Wrong') || state.ui.feedback.startsWith('Not quite') ? 'wrong-shake' : ''))
    : '';

  return `
    <div class="round-screen card-slide-enter" role="main" aria-label="Exercise screen">
      <div class="progress" aria-live="polite" aria-label="${progress}">${progress}</div>
      ${roundProgressHtml}
      <div class="round-quick-actions round-toolbar">
        <button class="btn btn-round-back btn-press" data-action="round-back" title="End session">← Back</button>
        <button class="btn btn-round-skip btn-press" data-action="round-skip">Skip</button>
        <button class="btn btn-round-practice btn-press" data-action="round-practice">Practice</button>
        <button class="btn btn-manage btn-press" data-action="round-known">Known ✓</button>
      </div>
      <div class="card round-exercise-card">${body}</div>
      ${state.ui.feedback ? `<div class="feedback-bar ${feedbackClass}">${state.ui.feedback}</div>` : '<div style="min-height:10px;"></div>'}
    </div>
  `;
}

function renderRoundSession(state) {
  const exercise = state.session.currentExercise;
  const maxRound = getMaxRound();
  const progress = `Round ${state.session.round}/${maxRound} | Word ${state.session.current + 1}/${state.session.queue.length}`;
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
    const hintVisible = state.ui.hintVisible;
    const hintHtml = exercise.hint
      ? `<div class="gap-hint-area">${hintVisible ? `<p class="gap-hint-text">💡 ${exercise.hint}</p>` : `<button class="btn btn-muted btn-hint" data-action="show-hint">Show Hint</button>`}</div>`
      : '';
    body = `
      <h2>Fill the blank</h2>
      <p>${exercise.sentence}</p>
      ${hintHtml}
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'SENTENCE_BUILDER') {
    const usedIndexes = new Set(state.ui.selectedChipIndexes || []);
    const placedChips = (state.ui.selectedChips || [])
      .map((chip, index) => `<button class="sb-placed-chip ${index < (state.ui.sbPrefixMatch || 0) ? 'sb-chip-prefix' : ''}" data-action="remove-placed-chip" data-index="${index}" ${state.ui.locked ? 'disabled' : ''}>${chip} ×</button>`)
      .join('');
    const availableChips = exercise.chips
      .map((chip, index) => {
        const used = usedIndexes.has(index);
        return `<button class="sb-available-chip ${used ? 'option-used' : ''}" data-action="add-chip" data-index="${index}" data-value="${chip}" ${state.ui.locked || used ? 'disabled' : ''}>${chip}</button>`;
      })
      .join('');

    body = `
      <h2>Build the sentence</h2>
      <p class="sb-def">Definition: ${exercise.definition}</p>
      <div class="sb-placed-zone ${state.ui.sbShake ? 'sb-shake' : ''}">
        ${placedChips || '<span class="sb-placeholder">Tap words to build your sentence.</span>'}
      </div>
      <p class="sb-label">Available words</p>
      <div class="sb-available-zone">${availableChips}</div>
      <div class="actions">
        <button class="btn btn-muted" data-action="remove-chip" ${state.ui.locked ? 'disabled' : ''}>↩ Undo</button>
        <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
      </div>
      <p class="sb-help">Tap an available word to add. Tap a placed chip to remove it.</p>
    `;
  } else if (exercise.type === 'TRANSLATION_MC') {
    body = `
      <h2>Choose the correct sentence for this word</h2>
      <p class="sb-def">Word: <strong>${exercise.word.replace(/_/g, ' ')}</strong> — ${exercise.definition}</p>
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'CONTEXT_MATCH') {
    body = `
      <h2>${exercise.prompt}</h2>
      <div class="options context-match-options">${renderOptions(exercise.sentences, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'MULTI_GAP') {
    const placed = state.ui.selectedChips || [];
    const usedIndexes = new Set(state.ui.selectedChipIndexes || []);

    let sentenceHtml = '';
    if (exercise.mode === 'separate') {
      sentenceHtml = exercise.gapSentence.map((item, i) => {
        const filledWord = placed[i] || '';
        const display = item.sentence.replace('___', filledWord ? `<span class="mg-filled">${filledWord}</span>` : `<span class="mg-blank">${i + 1}</span>`);
        return `<p class="mg-sentence">${display}</p>`;
      }).join('');
    } else {
      let display = exercise.gapSentence[0].sentence;
      const gaps = exercise.gapSentence[0].gaps;
      gaps.forEach((gap, i) => {
        const filledWord = placed[i] || '';
        const replacement = filledWord ? `<span class="mg-filled">${filledWord}</span>` : `<span class="mg-blank">${gap.id}</span>`;
        display = display.replace(`___${gap.id}`, replacement);
      });
      sentenceHtml = `<p class="mg-sentence">${display}</p>`;
    }

    const chipHtml = exercise.chips.map((chip, index) => {
      const used = usedIndexes.has(index);
      return `<button class="sb-available-chip ${used ? 'option-used' : ''}" data-action="add-chip" data-index="${index}" data-value="${chip}" ${state.ui.locked || used ? 'disabled' : ''}>${chip}</button>`;
    }).join('');

    body = `
      <h2>${exercise.prompt}</h2>
      <div class="mg-sentences">${sentenceHtml}</div>
      <p class="sb-label">Available words</p>
      <div class="sb-available-zone">${chipHtml}</div>
      <div class="actions">
        <button class="btn btn-muted" data-action="remove-chip" ${state.ui.locked ? 'disabled' : ''}>↩ Undo</button>
        <button class="btn" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
      </div>
    `;
  } else if (exercise.type === 'FREE_TYPE_GAP') {
    const hintVisible = state.ui.hintVisible;
    const hintHtml = exercise.hint
      ? `<div class="gap-hint-area">${hintVisible ? `<p class="gap-hint-text">💡 ${exercise.hint}</p>` : `<button class="btn btn-muted btn-hint" data-action="show-hint">Show Hint</button>`}</div>`
      : '';
    const inputVal = state.ui.freeTypeInput || '';
    body = `
      <h2>Type the missing word</h2>
      <p class="ft-sentence">${exercise.sentence}</p>
      ${hintHtml}
      <input type="text" class="ft-input" id="freeTypeInput" value="${escapeHtml(inputVal)}" placeholder="Type your answer..." autocomplete="off" ${state.ui.locked ? 'disabled' : ''}>
      <button class="btn btn-press" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'COLLOCATION_MATCH') {
    const hintVisible = state.ui.hintVisible;
    const hintHtml = exercise.hint
      ? `<div class="gap-hint-area">${hintVisible ? `<p class="gap-hint-text">💡 ${exercise.hint}</p>` : `<button class="btn btn-muted btn-hint" data-action="show-hint">Show Hint</button>`}</div>`
      : '';
    body = `
      <h2>${exercise.prompt}</h2>
      ${hintHtml}
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn btn-press" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
    `;
  } else if (exercise.type === 'ERROR_CORRECTION') {
    const hintVisible = state.ui.hintVisible;
    const hintHtml = exercise.hint
      ? `<div class="gap-hint-area">${hintVisible ? `<p class="gap-hint-text">💡 ${exercise.hint}</p>` : `<button class="btn btn-muted btn-hint" data-action="show-hint">Show Hint</button>`}</div>`
      : '';
    const inputVal = state.ui.freeTypeInput || '';
    const revealPrompt = state.ui.errorCorrectionRevealPrompt;
    if (revealPrompt) {
      body = `
        <h2>${exercise.prompt}</h2>
        <p class="ft-sentence" style="color:var(--error);border-left:3px solid var(--error);padding-left:12px;">${exercise.incorrectSentence}</p>
        <div class="ec-reveal-prompt">
          <p class="ec-reveal-question">Not quite. Do you want to see the answer?</p>
          <div class="ec-reveal-actions">
            <button class="btn btn-muted btn-press" data-action="ec-try-again">↩ Try Again</button>
            <button class="btn btn-press" data-action="ec-show-answer">Show Answer</button>
          </div>
        </div>
      `;
    } else {
      body = `
        <h2>${exercise.prompt}</h2>
        <p class="ft-sentence" style="color:var(--error);border-left:3px solid var(--error);padding-left:12px;">${exercise.incorrectSentence}</p>
        ${hintHtml}
        <input type="text" class="ft-input" id="freeTypeInput" value="${escapeHtml(inputVal)}" placeholder="Type the corrected sentence..." autocomplete="off" ${state.ui.locked ? 'disabled' : ''}>
        <button class="btn btn-press" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
      `;
    }
  }

  return renderRoundFrame(state, body, maxRound, progress);
}

function renderRoundDemo(state) {
  const exercise = state.session.currentExercise;
  const maxRound = getMaxRound();
  const progress = `Round ${state.session.round}/${maxRound} | Word ${state.session.current + 1}/${state.session.queue.length}`;
  const waitingContinue = state.ui.pendingResult !== null;
  const submitLabel = waitingContinue ? 'Continue' : 'Submit';
  const answerOpen = state.ui.demoAnswerOpen;

  const renderAnswerControl = (text) => `
    <div class="demo-answer-zone">
      <button class="demo-answer-link" data-action="toggle-demo-answer">${answerOpen ? 'Hide answer' : 'Show answer'}</button>
      ${answerOpen ? `<div class="demo-answer-inline">${escapeHtml(text)}</div>` : ''}
    </div>
  `;

  let body = '';
  if (exercise.type === 'COLLOCATION_MATCH') {
    const hintVisible = state.ui.hintVisible;
    const hintHtml = exercise.hint
      ? `<div class="gap-hint-area">${hintVisible ? `<p class="gap-hint-text">💡 ${exercise.hint}</p>` : `<button class="btn btn-muted btn-hint" data-action="show-hint">Show Hint</button>`}</div>`
      : '';
    body = `
      <h2>${exercise.prompt}</h2>
      ${hintHtml}
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption, state.ui.reveal, state.ui.locked)}</div>
      <button class="btn btn-press" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
      ${renderAnswerControl(exercise.correct)}
    `;
  } else if (exercise.type === 'ERROR_CORRECTION') {
    const hintVisible = state.ui.hintVisible;
    const hintHtml = exercise.hint
      ? `<div class="gap-hint-area">${hintVisible ? `<p class="gap-hint-text">💡 ${exercise.hint}</p>` : `<button class="btn btn-muted btn-hint" data-action="show-hint">Show Hint</button>`}</div>`
      : '';
    const inputVal = state.ui.freeTypeInput || '';
    body = `
      <h2>${exercise.prompt}</h2>
      <p class="ft-sentence" style="color:var(--error);border-left:3px solid var(--error);padding-left:12px;">${exercise.incorrectSentence}</p>
      ${hintHtml}
      <input type="text" class="ft-input" id="freeTypeInput" value="${escapeHtml(inputVal)}" placeholder="Type the corrected sentence..." autocomplete="off" ${state.ui.locked ? 'disabled' : ''}>
      <button class="btn btn-press" data-action="submit-answer" ${state.ui.locked && !waitingContinue ? 'disabled' : ''}>${submitLabel}</button>
      ${renderAnswerControl(exercise.correctSentence)}
    `;
  } else {
    body = `
      <h2>Demo Exercise</h2>
      <p>This demo supports collocation and error-correction cards.</p>
      <button class="btn btn-press" data-action="submit-answer">Continue</button>
    `;
  }

  return renderRoundFrame(state, body, maxRound, progress);
}

function renderRound(state) {
  if (!state.session.currentExercise) {
    return '<div class="card">Loading exercise...</div>';
  }
  if (state.session.isDemo) return renderRoundDemo(state);
  return renderRoundSession(state);
}

function renderSummary(state) {
  const words = state.session.words;
  const perfect = words.filter((w) => Object.values(state.session.results[w] || {}).every(Boolean)).length;

  if (words.length === 0) {
    return `
      <div class="summary-screen">
        <div class="card centered-card">
          <h2>No Words Due</h2>
          <p>There are no eligible words to study right now.</p>
          <button class="btn" data-action="go-home">Back Home</button>
        </div>
      </div>
    `;
  }

  const wordRows = words.map((w) => {
    const results = state.session.results[w] || {};
    const rounds = Object.keys(results).sort();
    const allCorrect = rounds.length > 0 && rounds.every((r) => results[r]);
    const dots = rounds.map((r) => results[r]
      ? '<span class="summary-dot summary-dot-correct">✓</span>'
      : '<span class="summary-dot summary-dot-wrong">✗</span>'
    ).join('');
    const status = allCorrect ? 'learned' : 'practice';
    const statusClass = allCorrect ? 'summary-status-learned' : 'summary-status-practice';
    const tr = AllWords[w]?.tr || '';
    return `<div class="summary-word-row">
      <div class="summary-word-info"><strong>${escapeHtml(w)}</strong><span class="summary-word-tr">${escapeHtml(tr)}</span></div>
      <div class="summary-word-dots">${dots}</div>
      <span class="summary-word-status ${statusClass}">${status}</span>
    </div>`;
  }).join('');

  return `
    <div class="summary-screen">
      <div class="card centered-card">
        <h2>Session Complete</h2>
        <div class="summary-stats">
          <span class="summary-stat">Total: ${words.length}</span>
          <span class="summary-stat summary-stat-perfect">Perfect: ${perfect}</span>
          <span class="summary-stat summary-stat-needs">Needs Practice: ${words.length - perfect}</span>
        </div>
        <div class="summary-word-list">${wordRows}</div>
        <button class="btn" data-action="go-home">Back Home</button>
      </div>
    </div>
  `;
}

let _lastRenderedScreen = null;
function render(state) {
  const app = document.getElementById('app');
  const modalContainer = document.getElementById('modal-container');
  if (!app || !modalContainer) return;

  // Skip re-rendering main content when a modal is open and screen didn't change
  // This prevents visible background flicker during modal interactions.
  const skipAppRender = state.ui.modal && state.ui.screen === _lastRenderedScreen;
  if (!skipAppRender) {
    _lastRenderedScreen = state.ui.screen;
    if (state.ui.screen === 'home') app.innerHTML = renderHome(state);
    if (state.ui.screen === 'progress') app.innerHTML = renderProgress(state);
    if (state.ui.screen === 'extras') app.innerHTML = renderExtras(state);
    if (state.ui.screen === 'train') app.innerHTML = renderTrain(state);
    if (state.ui.screen === 'preflight') app.innerHTML = renderPrep(state);
    if (state.ui.screen === 'flashcards') app.innerHTML = renderFlashcards(state);
    if (state.ui.screen === 'gate') app.innerHTML = renderGate(state);
    if (state.ui.screen === 'round') app.innerHTML = renderRound(state);
  }
  if (state.ui.screen === 'summary') {
    if (!skipAppRender) {
      const streakData = updateStreak();
      app.innerHTML = renderSummary(state);
      const wordsCompleted = state.session.words.length;
      if (wordsCompleted > 0) recordDailyActivity(wordsCompleted);
      if (streakData.currentStreak > 0 && streakData.currentStreak % 5 === 0) triggerConfetti();
      const perfect = state.session.words.filter(w => Object.values(state.session.results[w] || {}).every(Boolean)).length;
      if (perfect === wordsCompleted && wordsCompleted > 0) triggerConfetti();
    }
  }

  modalContainer.innerHTML = state.ui.modal ? UI.renderModal(state.ui.modal, state, AllWords) : '';
  updateBottomNav(state.ui.screen, state.ui.modal);
}

function handleAction(action, target) {
  if (action === 'set-session-size') {
    const size = Number(target.dataset.size) || 10;
    dispatch({ type: 'SET_SESSION_SIZE', payload: size });
    return;
  }
  if (action === 'open-flashcards') {
    dispatch({ type: 'SET_FLASHCARD', payload: { index: 0, flipped: false } });
    dispatch({ type: 'SET_SCREEN', payload: 'flashcards' });
    return;
  }
  if (action === 'flashcard-flip') {
    dispatch({ type: 'SET_FLASHCARD', payload: { index: AppState.ui.flashcardIndex, flipped: !AppState.ui.flashcardFlipped } });
    return;
  }
  if (action === 'flashcard-next') {
    dispatch({ type: 'SET_FLASHCARD', payload: { index: (AppState.ui.flashcardIndex || 0) + 1, flipped: false } });
    return;
  }
  if (action === 'flashcard-prev') {
    dispatch({ type: 'SET_FLASHCARD', payload: { index: Math.max(0, (AppState.ui.flashcardIndex || 0) - 1), flipped: false } });
    return;
  }
  if (action === 'start-session') {
    dispatch({ type: 'RESET_SESSION_START_SELECTION' });
    dispatch({ type: 'SET_MODAL', payload: 'sessionSize' });
    return;
  }
  if (action === 'session-start-select-level') {
    dispatch({ type: 'SET_SESSION_START_LEVEL', payload: target.dataset.level || 'ALL' });
    return;
  }
  if (action === 'open-manage-words') {
    dispatch({ type: 'RESET_PREP' });
    dispatch({ type: 'SET_SCREEN', payload: 'preflight' });
    return;
  }
  if (action === 'open-progress') {
    dispatch({ type: 'SET_SCREEN', payload: 'progress' });
    return;
  }
  if (action === 'open-extras') {
    dispatch({ type: 'SET_SCREEN', payload: 'extras' });
    return;
  }
  if (action === 'ec-show-answer') {
    const ex = AppState.session.currentExercise;
    dispatch({ type: 'SET_EC_REVEAL_PROMPT', payload: false });
    dispatch({ type: 'SET_LOCKED', payload: true });
    dispatch({ type: 'SET_FEEDBACK', payload: `Correct version: "${ex.correctSentence}"` });
    dispatch({ type: 'SET_PENDING_RESULT', payload: false });
    return;
  }
  if (action === 'ec-try-again') {
    dispatch({ type: 'SET_EC_REVEAL_PROMPT', payload: false });
    dispatch({ type: 'SET_FEEDBACK', payload: '' });
    return;
  }
  if (action === 'demo-collocation') {
    startTypedSession('COLLOCATION_MATCH');
    return;
  }
  if (action === 'demo-error-correction') {
    startTypedSession('ERROR_CORRECTION');
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
  if (action === 'prep-set-mode') {
    dispatch({ type: 'SET_PREP_SELECTION_MODE', payload: target.dataset.mode || 'known' });
    return;
  }
  if (action === 'prep-toggle-word') {
    const word = target.dataset.word;
    if (!word) return;
    if ((AppState.ui.prepSelectionMode || 'known') === 'session') {
      dispatch({ type: 'TOGGLE_PREP_SESSION_WORD', payload: word });
      return;
    }
    dispatch({ type: 'TOGGLE_PREP_KNOWN', payload: word });
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
    if ((AppState.ui.prepSelectedKnown || []).length > 0) {
      dispatch({ type: 'SET_PREP_PENDING_ACTION', payload: 'back' });
      dispatch({ type: 'SET_MODAL', payload: 'prepUnsaved' });
      return;
    }
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
  if (action === 'prep-save') {
    savePrepSelection();
    return;
  }
  if (action === 'prep-start-session') {
    // If session picks exist, show confirmation modal first
    if ((AppState.ui.prepSelectedSession || []).length > 0) {
      dispatch({ type: 'SET_MODAL', payload: 'prepSessionConfirm' });
      return;
    }
    if ((AppState.ui.prepSelectedKnown || []).length > 0) {
      dispatch({ type: 'SET_PREP_PENDING_ACTION', payload: 'start' });
      dispatch({ type: 'SET_MODAL', payload: 'prepUnsaved' });
      return;
    }
    startSessionFromPrep();
    return;
  }
  if (action === 'confirm-session-picks') {
    dispatch({ type: 'SET_MODAL', payload: null });
    startSessionFromPrep();
    return;
  }
  if (action === 'remove-session-pick') {
    const word = target?.dataset?.word;
    if (word) dispatch({ type: 'TOGGLE_PREP_SESSION_WORD', payload: word });
    return;
  }
  if (action === 'session-start-confirm') {
    const startLevel = AppState.ui.sessionStartLevel || 'ALL';
    const size = AppState.ui.sessionSize || 10;
    dispatch({ type: 'SET_MODAL', payload: null });
    initiateSession(size, startLevel, true);
    return;
  }
  if (action === 'start-filter-session') {
    const filter = AppState.ui.wordListFilter || 'practice';
    const today = toLocalDate(0);
    const allProgressWords = AppState.progress.words || {};
    const filteredWords = Object.entries(allProgressWords)
      .filter(([_, data]) => {
        if (filter === 'review') {
          return (data.status === 'learned' || data.status === 'practice') && data.nextReview && data.nextReview <= today;
        }
        return data.status === filter;
      })
      .map(([word]) => word);

    if (filteredWords.length === 0) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'No words available in this list.' });
      return;
    }

    dispatch({ type: 'SET_MODAL', payload: null });
    initiateSession(AppState.ui.sessionSize || 10, 'ALL', true, filteredWords);
    return;
  }
  if (action === 'select-option-index') {
    if (AppState.ui.locked) return;
    const exercise = AppState.session.currentExercise;
    const index = Number(target.dataset.index);
    const optionsList = exercise?.options || exercise?.sentences;
    if (!exercise || !Array.isArray(optionsList) || Number.isNaN(index)) return;
    if (optionsList[index] === undefined) return;
    dispatch({ type: 'SET_OPTION', payload: optionsList[index] });
    return;
  }
  if (action === 'show-hint') {
    dispatch({ type: 'SET_HINT_VISIBLE', payload: true });
    return;
  }
  if (action === 'toggle-demo-answer') {
    dispatch({ type: 'SET_DEMO_ANSWER_OPEN', payload: !AppState.ui.demoAnswerOpen });
    return;
  }
  if (action === 'add-chip') {
    const chipIndex = Number(target.dataset.index);
    if (Number.isNaN(chipIndex) || AppState.ui.selectedChipIndexes.includes(chipIndex)) return;
    const chips = [...AppState.ui.selectedChips, target.dataset.value];
    const chipIndexes = [...AppState.ui.selectedChipIndexes, chipIndex];
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
    dispatch({ type: 'SET_SB_PREFIX', payload: 0 });
    dispatch({ type: 'SET_SB_SHAKE', payload: false });
    return;
  }
  if (action === 'remove-chip') {
    const chips = [...AppState.ui.selectedChips];
    const chipIndexes = [...AppState.ui.selectedChipIndexes];
    chips.pop();
    chipIndexes.pop();
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
    dispatch({ type: 'SET_SB_PREFIX', payload: 0 });
    dispatch({ type: 'SET_SB_SHAKE', payload: false });
    return;
  }
  if (action === 'remove-placed-chip') {
    const removeIndex = Number(target.dataset.index);
    if (Number.isNaN(removeIndex)) return;
    const chips = [...AppState.ui.selectedChips];
    const chipIndexes = [...AppState.ui.selectedChipIndexes];
    chips.splice(removeIndex, 1);
    chipIndexes.splice(removeIndex, 1);
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
    dispatch({ type: 'SET_SB_PREFIX', payload: 0 });
    dispatch({ type: 'SET_SB_SHAKE', payload: false });
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
  if (action === 'round-back') {
    dispatch({ type: 'SET_MODAL', payload: 'quitConfirm' });
    return;
  }
  if (action === 'round-skip') {
    if (AppState.session.isDemo) {
      const queue = AppState.session.queue || [];
      if (queue.length <= 1) {
        dispatch({ type: 'SET_FEEDBACK', payload: 'Demo has one item left.' });
        return;
      }
      const [currentItem] = queue.splice(AppState.session.current, 1);
      queue.push(currentItem);
      AppState.session.currentExercise = null;
      resetRoundInteractionState();
      startRoundExercise();
      dispatch({ type: 'SET_FEEDBACK', payload: 'Skipped in demo mode.' });
      return;
    }
    deferCurrentWordInSession();
    return;
  }
  if (action === 'round-known') {
    if (AppState.session.isDemo) {
      AppState.session.queue.splice(AppState.session.current, 1);
      AppState.session.words = [...AppState.session.queue];
      AppState.session.currentExercise = null;
      if (AppState.session.queue.length === 0) {
        dispatch({ type: 'SET_SCREEN', payload: 'extras' });
        return;
      }
      if (AppState.session.current >= AppState.session.queue.length) {
        AppState.session.current = 0;
      }
      resetRoundInteractionState();
      startRoundExercise();
      dispatch({ type: 'SET_FEEDBACK', payload: 'Marked known in demo only (not saved).' });
      return;
    }
    removeCurrentWordFromSession('known');
    return;
  }
  if (action === 'round-practice') {
    if (AppState.session.isDemo) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Demo note: this word needs practice (not saved).' });
      return;
    }
    const word = currentWord();
    if (!word) return;
    dispatch({ type: 'MARK_PRACTICE', payload: word });

    if (AppState.session.round === 3) {
      resetRoundInteractionState();
      const refreshed = buildExercise(currentQueueItem(), AppState.session.round, AppState.session.current);
      dispatch({ type: 'SET_CURRENT_EXERCISE', payload: refreshed });
    }

    dispatch({ type: 'SET_FEEDBACK', payload: 'Word added to practice list.' });
    return;
  }
  if (action === 'go-home') {
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
  if (action === 'go-train') {
    dispatch({ type: 'SET_SCREEN', payload: 'train' });
    return;
  }
}

function handleUiAction(action, element) {
  const setStatus = (id, text, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.color = ok ? 'var(--success)' : 'var(--error, #f87171)';
    el.textContent = text;
  };

  const ensureCloudReady = async () => {
    if (!window.WFCloud) return { ok: false, message: 'Cloud sync module is unavailable.' };

    const cloudConfig = window.WFCloud.getConfig ? window.WFCloud.getConfig() : { url: '', anonKey: '' };
    if (!cloudConfig.url || !cloudConfig.anonKey) {
      return { ok: false, message: 'Supabase config is missing in this app build.' };
    }

    const result = await window.WFCloud.init({
      onRemoteApplied: (remoteProgress) => {
        dispatch({ type: 'LOAD_PROGRESS', payload: remoteProgress });
      },
      onStatus: ({ message, ok }) => setStatus('cloud-status', message, ok)
    });

    return result;
  };

  if (action === 'close-modal') {
    dispatch({ type: 'SET_MODAL', payload: null });
    return;
  }
  if (action === 'save-settings') {
    const apiInput = document.getElementById('apiKeyInput');
    const modelInput = document.getElementById('modelInput');
    const gistTokenInput = document.getElementById('gistTokenInput');
    localStorage.setItem('wf_api_key', apiInput ? apiInput.value.trim() : '');
    localStorage.setItem('wf_model', modelInput ? modelInput.value.trim() : 'gemma-4-31b-it');
    if (window.WFCloud) {
      window.WFCloud.init({
        onRemoteApplied: (remoteProgress) => {
          dispatch({ type: 'LOAD_PROGRESS', payload: remoteProgress });
        },
        onStatus: ({ message, ok }) => setStatus('cloud-status', message, ok)
      }).then((result) => {
        setStatus('cloud-status', result.message, result.ok);
      });
    }
    if (gistTokenInput && window.WFSync) window.WFSync.setSyncToken(gistTokenInput.value);
    dispatch({ type: 'SET_MODAL', payload: null });
    return;
  }
  if (action === 'cloud-connect' || action === 'cloud-signin') {
    if (!window.WFCloud) return;
    setStatus('cloud-status', 'Checking Supabase config…', true);
    ensureCloudReady().then((initResult) => {
      if (!initResult.ok) {
        setStatus('cloud-status', initResult.message || 'Cloud config is missing.', false);
        return;
      }

      const authState = window.WFCloud.getAuthState ? window.WFCloud.getAuthState() : { signedIn: false };
      if (authState.signedIn) {
        setStatus('cloud-status', 'Already signed in. Use Sync Now to refresh.', true);
        return;
      }

      setStatus('cloud-status', 'Starting GitHub sign-in…', true);
      window.WFCloud.signInWithGitHub().then((result) => {
        setStatus('cloud-status', result.message, result.ok);
      });
    });
    return;
  }
  if (action === 'cloud-signout') {
    if (!window.WFCloud) return;
    window.WFCloud.signOut().then((result) => {
      setStatus('cloud-status', result.message, result.ok);
      dispatch({ type: 'SET_MODAL', payload: 'settings' });
    });
    return;
  }
  if (action === 'cloud-sync-now') {
    if (!window.WFCloud) return;
    setStatus('cloud-status', 'Checking Supabase config…', true);
    ensureCloudReady().then((initResult) => {
      if (!initResult.ok) {
        setStatus('cloud-status', initResult.message || 'Cloud config is missing.', false);
        return;
      }
      setStatus('cloud-status', 'Syncing…', true);
      window.WFCloud.syncNow().then((result) => {
        setStatus('cloud-status', result.message, result.ok);
        if (result.ok) {
          dispatch({ type: 'LOAD_PROGRESS', payload: loadProgress() });
        }
      });
    });
    return;
  }
  if (action === 'sync-save') {
    if (!window.WFSync) return;
    const tokenInput = document.getElementById('gistTokenInput');
    if (tokenInput) window.WFSync.setSyncToken(tokenInput.value);
    const statusEl = document.getElementById('sync-status');
    if (statusEl) statusEl.textContent = 'Saving…';
    window.WFSync.saveToGist().then((result) => {
      const el = document.getElementById('sync-status');
      if (!el) return;
      el.style.color = result.ok ? 'var(--success)' : 'var(--error, #f87171)';
      el.textContent = result.message;
    });
    return;
  }
  if (action === 'sync-load') {
    if (!window.WFSync) return;
    const tokenInput = document.getElementById('gistTokenInput');
    if (tokenInput) window.WFSync.setSyncToken(tokenInput.value);
    const statusEl = document.getElementById('sync-status');
    if (statusEl) statusEl.textContent = 'Loading…';
    window.WFSync.loadFromGist().then((result) => {
      const el = document.getElementById('sync-status');
      if (el) {
        el.style.color = result.ok ? 'var(--success)' : 'var(--error, #f87171)';
        el.textContent = result.message;
      }
      if (result.ok && result.reload) {
        setTimeout(() => window.location.reload(), 1500);
      }
    });
    return;
  }
  if (action === 'quit-session') {
    dispatch({ type: 'SET_MODAL', payload: null });
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
  if (action === 'prep-save-and-continue') {
    const pendingAction = AppState.ui.prepPendingAction;
    savePrepSelection();
    continuePrepPendingAction(pendingAction);
    return;
  }
  if (action === 'prep-discard-and-continue') {
    const pendingAction = AppState.ui.prepPendingAction;
    dispatch({ type: 'CLEAR_PREP_SELECTION' });
    continuePrepPendingAction(pendingAction);
    return;
  }
  if (action === 'remove-from-known') {
    const word = element?.dataset?.word;
    if (word) {
      dispatch({ type: 'DELETE_WORD_PROGRESS', payload: word });
    }
  }
  if (action === 'switch-word-filter') {
    const newFilter = element?.dataset?.filter;
    if (newFilter) {
      dispatch({ type: 'SET_WORD_LIST_FILTER', payload: newFilter });
    }
  }
  if (action === 'remove-from-practice') {
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
  if (action === 'export-progress') {
    const data = {
      progress: AppState.progress,
      streak: getStreakData(),
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wordforge-progress-${toLocalDate(0)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (action === 'set-theme') {
    const nextTheme = element?.dataset?.theme;
    if (!nextTheme || (nextTheme !== 'dark' && nextTheme !== 'light')) return;
    applyTheme(nextTheme);
    dispatch({ type: 'SET_MODAL', payload: 'settings' });
    return;
  }
  if (action === 'select-session-size') {
    const size = Number(element?.dataset?.size) || 10;
    dispatch({ type: 'SET_SESSION_SIZE', payload: size });
    return;
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

  if (event.key >= '1' && event.key <= '4' && Array.isArray(exercise.options || exercise.sentences)) {
    const optionsList = exercise.options || exercise.sentences;
    const index = Number(event.key) - 1;
    if (optionsList[index] !== undefined) {
      dispatch({ type: 'SET_OPTION', payload: optionsList[index] });
    }
    event.preventDefault();
    return;
  }

  if (event.key === 'Enter') {
    submitExerciseAnswer();
    event.preventDefault();
    return;
  }

  if (event.key === 'Backspace' && (exercise.type === 'SENTENCE_BUILDER' || exercise.type === 'MULTI_GAP')) {
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

document.addEventListener('input', (event) => {
  if (event.target.id === 'freeTypeInput') {
    AppState.ui.freeTypeInput = event.target.value;
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'importFileInput') {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.progress && data.progress.words) {
          dispatch({ type: 'LOAD_PROGRESS', payload: data.progress });
          saveProgress(data.progress);
          if (data.streak) saveStreakData(data.streak);
          dispatch({ type: 'SET_MODAL', payload: null });
        } else {
          alert('Invalid progress file format.');
        }
      } catch (err) {
        alert('Failed to read file. Make sure it is a valid JSON export.');
      }
    };
    reader.readAsText(file);
  }
});

document.addEventListener('keydown', handleKeyboardNavigation);

// ── Drag-Reorder for Sentence Builder placed chips ────────────────────────

(function initDragReorder() {
  let dragState = null;

  function getPlacedChipIndex(el) {
    const chip = el.closest('.sb-placed-chip');
    if (!chip) return -1;
    return Number(chip.dataset.index);
  }

  function createGhost(el, x, y) {
    const ghost = el.cloneNode(true);
    ghost.classList.add('sb-drag-ghost');
    ghost.style.position = 'fixed';
    ghost.style.left = `${x - 30}px`;
    ghost.style.top = `${y - 20}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '100';
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveGhost(ghost, x, y) {
    ghost.style.left = `${x - 30}px`;
    ghost.style.top = `${y - 20}px`;
  }

  function getDropIndex(zone, x, y, dragIndex) {
    const chips = [...zone.querySelectorAll('.sb-placed-chip')];
    for (let i = 0; i < chips.length; i++) {
      const rect = chips[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (x < midX) return i;
    }
    return chips.length;
  }

  function finishDrag() {
    if (!dragState) return;
    if (dragState.ghost) dragState.ghost.remove();
    document.querySelectorAll('.sb-drop-indicator').forEach(el => el.remove());
    dragState = null;
  }

  function reorderChips(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex === toIndex - 1) return;
    const chips = [...AppState.ui.selectedChips];
    const chipIndexes = [...AppState.ui.selectedChipIndexes];
    const [movedChip] = chips.splice(fromIndex, 1);
    const [movedIdx] = chipIndexes.splice(fromIndex, 1);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    chips.splice(insertAt, 0, movedChip);
    chipIndexes.splice(insertAt, 0, movedIdx);
    dispatch({ type: 'SET_CHIPS', payload: chips });
    dispatch({ type: 'SET_CHIP_INDEXES', payload: chipIndexes });
  }

  // Mouse events
  document.addEventListener('mousedown', (e) => {
    if (AppState.ui.locked) return;
    const exercise = AppState.session?.currentExercise;
    if (!exercise || exercise.type !== 'SENTENCE_BUILDER') return;
    const chipEl = e.target.closest('.sb-placed-chip');
    if (!chipEl) return;

    const index = Number(chipEl.dataset.index);
    const zone = chipEl.closest('.sb-placed-zone');
    if (!zone) return;

    dragState = { index, zone, startX: e.clientX, startY: e.clientY, ghost: null, dragging: false };
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const dx = Math.abs(e.clientX - dragState.startX);
    const dy = Math.abs(e.clientY - dragState.startY);

    if (!dragState.dragging && (dx > 5 || dy > 5)) {
      dragState.dragging = true;
      const chipEl = dragState.zone.querySelectorAll('.sb-placed-chip')[dragState.index];
      if (chipEl) {
        dragState.ghost = createGhost(chipEl, e.clientX, e.clientY);
        chipEl.classList.add('sb-chip-dragging');
      }
    }

    if (dragState.dragging && dragState.ghost) {
      moveGhost(dragState.ghost, e.clientX, e.clientY);
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragState) return;
    if (dragState.dragging) {
      const dropIdx = getDropIndex(dragState.zone, e.clientX, e.clientY, dragState.index);
      reorderChips(dragState.index, dropIdx);
      const chipEl = dragState.zone.querySelectorAll('.sb-placed-chip')[dragState.index];
      if (chipEl) chipEl.classList.remove('sb-chip-dragging');
    }
    finishDrag();
  });

  // Touch events
  document.addEventListener('touchstart', (e) => {
    if (AppState.ui.locked) return;
    const exercise = AppState.session?.currentExercise;
    if (!exercise || exercise.type !== 'SENTENCE_BUILDER') return;
    const chipEl = e.target.closest('.sb-placed-chip');
    if (!chipEl) return;

    const touch = e.touches[0];
    const index = Number(chipEl.dataset.index);
    const zone = chipEl.closest('.sb-placed-zone');
    if (!zone) return;

    dragState = { index, zone, startX: touch.clientX, startY: touch.clientY, ghost: null, dragging: false, touchId: touch.identifier };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!dragState) return;
    const touch = [...e.touches].find(t => t.identifier === dragState.touchId);
    if (!touch) return;

    const dx = Math.abs(touch.clientX - dragState.startX);
    const dy = Math.abs(touch.clientY - dragState.startY);

    if (!dragState.dragging && (dx > 8 || dy > 8)) {
      dragState.dragging = true;
      const chipEl = dragState.zone.querySelectorAll('.sb-placed-chip')[dragState.index];
      if (chipEl) {
        dragState.ghost = createGhost(chipEl, touch.clientX, touch.clientY);
        chipEl.classList.add('sb-chip-dragging');
      }
      e.preventDefault();
    }

    if (dragState.dragging && dragState.ghost) {
      moveGhost(dragState.ghost, touch.clientX, touch.clientY);
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!dragState) return;
    if (dragState.dragging) {
      const touch = e.changedTouches[0];
      const dropIdx = getDropIndex(dragState.zone, touch.clientX, touch.clientY, dragState.index);
      reorderChips(dragState.index, dropIdx);
      const chipEl = dragState.zone.querySelectorAll('.sb-placed-chip')[dragState.index];
      if (chipEl) chipEl.classList.remove('sb-chip-dragging');
    }
    finishDrag();
  });

  document.addEventListener('touchcancel', () => finishDrag());
})();

// ── Theme Toggle ──────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('wf_theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', safeTheme);
  localStorage.setItem('wf_theme', safeTheme);
  // Update PWA theme-color meta
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = safeTheme === 'dark' ? '#10141e' : '#f8f9fa';
}

// ── Bottom Nav ────────────────────────────────────────────────────────────

function updateBottomNav(screen, modal) {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  const items = nav.querySelectorAll('.bottom-nav-item');
  items.forEach(item => {
    const navTarget = item.dataset.nav;
    let isActive = false;
    if (navTarget === 'home' && (screen === 'home' || screen === 'preflight')) isActive = true;
    if (navTarget === 'session' && (screen === 'gate' || screen === 'round' || screen === 'train' || screen === 'extras' || screen === 'flashcards')) isActive = true;
    if (navTarget === 'stats' && screen === 'progress') isActive = true;
    if (navTarget === 'settings' && modal === 'settings') isActive = true;
    item.classList.toggle('active', isActive);
  });
}

document.getElementById('bottomNav')?.addEventListener('click', (e) => {
  const item = e.target.closest('.bottom-nav-item');
  if (!item) return;
  const nav = item.dataset.nav;
  if (nav === 'home') dispatch({ type: 'SET_SCREEN', payload: 'home' });
  if (nav === 'session') {
    if (AppState.ui.screen === 'round' || AppState.ui.screen === 'gate') return;
    dispatch({ type: 'SET_SCREEN', payload: 'train' });
  }
  if (nav === 'stats') dispatch({ type: 'SET_SCREEN', payload: 'progress' });
  if (nav === 'settings') dispatch({ type: 'SET_MODAL', payload: 'settings' });
});

// ── Touch Gestures for Gate Screen ────────────────────────────────────────

(function initGateGestures() {
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', (e) => {
    if (AppState.ui.screen !== 'gate') return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (AppState.ui.screen !== 'gate') return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx)) return; // not a clear horizontal swipe
    if (dx > 0) gateKnown();  // swipe right = know it
    else gateLearn();          // swipe left = learn
  }, { passive: true });
})();

// ── XP Integration in finalizeRoundAnswer ─────────────────────────────────

const originalFinalizeRoundAnswer = finalizeRoundAnswer;
finalizeRoundAnswer = function(correct) {
  if (correct) {
    const round = AppState.session.round;
    const xpAmount = round >= 5 ? 15 : round >= 3 ? 10 : 5;
    addXP(xpAmount);
  }
  originalFinalizeRoundAnswer(correct);
};

// ── Enhanced render with nav + activity tracking ──────────────────────────
// (updateBottomNav is called directly inside the main render function)

async function init() {
  try {
    initTheme();
    await loadEnvApiKey();
    await loadWords();
    dispatch({ type: 'LOAD_PROGRESS', payload: loadProgress() });
    dispatch({ type: 'SET_SCREEN', payload: 'home' });

    if (window.WFCloud) {
      await window.WFCloud.init({
        onRemoteApplied: (remoteProgress) => {
          dispatch({ type: 'LOAD_PROGRESS', payload: remoteProgress });
          render(AppState);
        },
      });
    }
  } catch (error) {
    const app = document.getElementById('app');
    if (app) app.innerHTML = `<div class="card">Failed to initialize: ${escapeHtml(error.message)}</div>`;
  }
}

init();
