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
    feedback: ''
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
    case 'SET_FEEDBACK':
      newState.ui.feedback = action.payload;
      break;
    case 'INIT_SESSION':
      newState.session = action.payload;
      break;
    case 'ADVANCE_SESSION_INDEX':
      newState.session.current += 1;
      newState.ui.selectedOption = null;
      newState.ui.selectedChips = [];
      newState.ui.feedback = '';
      break;
    case 'SET_ROUND':
      newState.session.round = action.payload;
      newState.session.current = 0;
      newState.ui.selectedOption = null;
      newState.ui.selectedChips = [];
      newState.ui.feedback = '';
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

function pickSessionWords(sessionSize) {
  const reviewDue = getReviewDue(AppState.progress);
  const practiceWords = Object.keys(AppState.progress.words).filter((w) => AppState.progress.words[w].status === 'practice');
  const unseen = Object.keys(AllWords).filter((w) => !AppState.progress.words[w]);

  const picked = [
    ...reviewDue,
    ...practiceWords.filter((w) => !reviewDue.includes(w)),
    ...unseen
  ];

  return picked.slice(0, sessionSize);
}

function initiateSession(sessionSize) {
  const sessionWords = pickSessionWords(sessionSize);
  const nextSession = {
    words: sessionWords,
    queue: shuffle(sessionWords),
    skipped: {},
    round: 0,
    current: 0,
    results: {},
    currentExercise: null
  };

  dispatch({ type: 'INIT_SESSION', payload: nextSession });
  dispatch({ type: 'SET_SCREEN', payload: 'gate' });
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
  const exercise = AppState.session.currentExercise;
  if (!exercise) return;

  if (exercise.type === 'DEFINITION') {
    finalizeRoundAnswer(true);
    return;
  }

  if (exercise.type === 'SENTENCE_BUILDER') {
    const userAnswer = AppState.ui.selectedChips.join(' ');
    const expected = exercise.correct;
    const isCorrect = userAnswer.trim() === expected.trim();
    finalizeRoundAnswer(isCorrect);
    return;
  }

  if (exercise.type === 'PRODUCTION') {
    const textarea = document.getElementById('productionTextarea');
    const userSentence = textarea ? textarea.value.trim() : '';
    if (!userSentence) {
      dispatch({ type: 'SET_FEEDBACK', payload: 'Please write a sentence first.' });
      return;
    }
    dispatch({ type: 'SET_FEEDBACK', payload: 'Evaluating with Gemini...' });
    const result = await Production.evaluateProduction(exercise.word, userSentence, AllWords);
    dispatch({ type: 'SET_FEEDBACK', payload: result.feedback });
    if (result.correct) {
      finalizeRoundAnswer(true);
    }
    return;
  }

  const selected = AppState.ui.selectedOption;
  if (selected === null || selected === undefined) {
    dispatch({ type: 'SET_FEEDBACK', payload: 'Please select an option.' });
    return;
  }

  const isCorrect = selected === exercise.correct;
  finalizeRoundAnswer(isCorrect);
}

function renderHome(state) {
  const words = state.progress.words;
  const learned = Object.keys(words).filter((w) => words[w].status === 'learned').length;
  const known = Object.keys(words).filter((w) => words[w].status === 'known').length;
  const practice = Object.keys(words).filter((w) => words[w].status === 'practice').length;
  const reviewDue = getReviewDue(state.progress).length;

  return `
    <div class="home-screen">
      <h1>WordForge</h1>
      <p>Loaded words: ${Object.keys(AllWords).length}</p>
      <div class="stats-grid">
        <button class="card" data-action="open-list" data-filter="learned">Learned: ${learned}</button>
        <button class="card" data-action="open-list" data-filter="known">Known: ${known}</button>
        <button class="card" data-action="open-list" data-filter="review">Review Due: ${reviewDue}</button>
        <button class="card" data-action="open-list" data-filter="practice">Practice: ${practice}</button>
      </div>
      <div class="actions">
        <button class="btn" data-action="start-session">Start Session (10 words)</button>
        <button class="btn" data-action="open-settings">Settings</button>
      </div>
    </div>
  `;
}

function renderGate(state) {
  const word = currentWord();
  if (!word) {
    checkGateComplete();
    return '<div class="card">Preparing next round...</div>';
  }

  return `
    <div class="gate-screen">
      <h2>Do you know this word?</h2>
      <div class="word-display">${word}</div>
      <div class="actions">
        <button class="btn" data-action="gate-known">Yes, I know it</button>
        <button class="btn" data-action="gate-learn">No, teach me</button>
      </div>
      <p>${state.session.current + 1} / ${state.session.queue.length}</p>
    </div>
  `;
}

function renderOptions(options, selected) {
  return options.map((option, idx) => {
    const cls = selected === option ? 'option selected' : 'option';
    return `<button class="${cls}" data-action="select-option" data-value="${String(option).replace(/"/g, '&quot;')}">${idx + 1}. ${option}</button>`;
  }).join('');
}

function renderRound(state) {
  if (!state.session.currentExercise) {
    startRoundExercise();
    return '<div class="card">Loading exercise...</div>';
  }

  const exercise = state.session.currentExercise;
  const progress = `Round ${state.session.round}/5 | Word ${state.session.current + 1}/${state.session.queue.length}`;
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
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption)}</div>
      <button class="btn" data-action="submit-answer">Submit</button>
    `;
  } else if (exercise.type === 'GAP_FILL') {
    body = `
      <h2>Fill the blank</h2>
      <p>${exercise.sentence}</p>
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption)}</div>
      <button class="btn" data-action="submit-answer">Submit</button>
    `;
  } else if (exercise.type === 'SENTENCE_BUILDER') {
    const chips = exercise.chips.map((chip) => `<button class="option" data-action="add-chip" data-value="${chip}">${chip}</button>`).join('');
    body = `
      <h2>Build the sentence</h2>
      <p>TR: ${exercise.trSentence}</p>
      <div class="answer-box">${state.ui.selectedChips.join(' ')}</div>
      <div class="options">${chips}</div>
      <div class="actions">
        <button class="btn" data-action="remove-chip">Backspace</button>
        <button class="btn" data-action="submit-answer">Submit</button>
      </div>
    `;
  } else if (exercise.type === 'TRANSLATION_MC') {
    body = `
      <h2>Choose the correct English sentence</h2>
      <p>TR: ${exercise.trSentence}</p>
      <div class="options">${renderOptions(exercise.options, state.ui.selectedOption)}</div>
      <button class="btn" data-action="submit-answer">Submit</button>
    `;
  } else if (exercise.type === 'PRODUCTION') {
    body = `
      <h2>${exercise.prompt}</h2>
      <textarea id="productionTextarea" class="modal-input" rows="4" placeholder="Write your sentence..."></textarea>
      <button class="btn" data-action="submit-answer">Submit</button>
    `;
  }

  return `
    <div class="round-screen">
      <div class="progress">${progress}</div>
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
      <h2>Session Complete</h2>
      <p>Total words: ${words.length}</p>
      <p>Perfect words: ${perfect}</p>
      <button class="btn" data-action="go-home">Back Home</button>
    </div>
  `;
}

function render(state) {
  const app = document.getElementById('app');
  const modalContainer = document.getElementById('modal-container');
  if (!app || !modalContainer) return;

  if (state.ui.screen === 'home') app.innerHTML = renderHome(state);
  if (state.ui.screen === 'gate') app.innerHTML = renderGate(state);
  if (state.ui.screen === 'round') app.innerHTML = renderRound(state);
  if (state.ui.screen === 'summary') app.innerHTML = renderSummary(state);

  modalContainer.innerHTML = state.ui.modal ? UI.renderModal(state.ui.modal, state, AllWords) : '';
}

function handleAction(action, target) {
  if (action === 'start-session') {
    initiateSession(SESSION_SIZE);
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
  if (action === 'select-option') {
    dispatch({ type: 'SET_OPTION', payload: target.dataset.value });
    return;
  }
  if (action === 'add-chip') {
    const chips = [...AppState.ui.selectedChips, target.dataset.value];
    dispatch({ type: 'SET_CHIPS', payload: chips });
    return;
  }
  if (action === 'remove-chip') {
    const chips = [...AppState.ui.selectedChips];
    chips.pop();
    dispatch({ type: 'SET_CHIPS', payload: chips });
    return;
  }
  if (action === 'submit-answer') {
    submitExerciseAnswer();
    return;
  }
  if (action === 'open-quit') {
    dispatch({ type: 'SET_MODAL', payload: 'quitConfirm' });
    return;
  }
  if (action === 'go-home') {
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
    return;
  }
}

function handleUiAction(action) {
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
}

document.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) handleAction(actionTarget.dataset.action, actionTarget);

  const uiTarget = event.target.closest('[data-ui-action]');
  if (uiTarget) handleUiAction(uiTarget.dataset.uiAction);
});

async function init() {
  try {
    await loadWords();
    dispatch({ type: 'LOAD_PROGRESS', payload: loadProgress() });
    dispatch({ type: 'SET_SCREEN', payload: 'home' });
  } catch (error) {
    const app = document.getElementById('app');
    if (app) app.innerHTML = `<div class="card">Failed to initialize: ${error.message}</div>`;
  }
}

init();

