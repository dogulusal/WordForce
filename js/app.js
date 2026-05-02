// WordForge v3 - Core App State & Dispatch Pattern

let AllWords = {};

let AppState = {
  progress: {
    level: "A1",
    words: {}  // { word: { status, interval, nextReview } }
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

// Load words from enriched data
async function loadWords() {
  try {
    const response = await fetch('data/words_enriched.json');
    AllWords = await response.json();
    console.log(`✅ Loaded ${Object.keys(AllWords).length} words`);
  } catch (error) {
    console.error('Failed to load words:', error);
  }
}

// Save progress to localStorage
function saveProgress(progress) {
  const json = JSON.stringify(progress);
  localStorage.setItem('wf_progress', json);
}

// Load progress from localStorage
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

// Pure state update function (uses structuredClone for deep copy)
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
    case 'SET_LOADING':
      newState.ui.loading = action.payload;
      break;
    case 'INIT_SESSION':
      newState.session = action.payload;
      break;
    case 'MARK_WORD_KNOWN':
      newState.progress.words[action.payload] = {
        status: 'known',
        interval: null,
        nextReview: null
      };
      break;
    case 'START_PRACTICE':
      newState.progress.words[action.payload] = {
        status: 'practice',
        interval: 1,
        nextReview: new Date().toLocaleDateString('en-CA')
      };
      break;
    case 'MARK_CORRECT':
      {
        const word = action.payload;
        const current = newState.progress.words[word] || { status: 'practice', interval: 1 };
        const nextInterval = calculateNextReview(current.interval, true);
        const nextDate = nextInterval === null 
          ? null 
          : new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
        newState.progress.words[word] = {
          status: nextInterval === null ? 'learned' : 'practice',
          interval: nextInterval || 30,
          nextReview: nextDate
        };
      }
      break;
    case 'MARK_INCORRECT':
      {
        const word = action.payload;
        newState.progress.words[word] = {
          status: 'practice',
          interval: 1,
          nextReview: new Date().toLocaleDateString('en-CA')
        };
      }
      break;
  }
  
  return newState;
}

// Dispatch function
function dispatch(action) {
  AppState = updateState(AppState, action);
  saveProgress(AppState.progress);
  render(AppState);
}

// Placeholder render function
function render(appState) {
  const app = document.getElementById('app');
  if (!app) return;
  
  // Placeholder: render based on appState.ui.screen
  app.innerHTML = `
    <div class="app-container">
      <h1>WordForge v3</h1>
      <p>Screen: ${appState.ui.screen}</p>
      <p>Words loaded: ${Object.keys(AllWords).length}</p>
      <p>Words in progress: ${Object.keys(appState.progress.words).length}</p>
    </div>
  `;
}

// Helper function: shuffle array
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Session Initiation Logic
function initiateSession(sessionSize = 8) {
  // Get review-due words first, then fill with practice words
  const reviewDue = getReviewDue(AppState.progress);
  const allPracticeWords = Object.keys(AppState.progress.words)
    .filter(w => AppState.progress.words[w].status === 'practice');
  
  const sessionWords = [
    ...reviewDue.slice(0, sessionSize),
    ...allPracticeWords.slice(0, Math.max(0, sessionSize - reviewDue.length))
  ].slice(0, sessionSize);
  
  AppState.session = {
    words: sessionWords,
    round: 1,
    queue: shuffle(sessionWords),
    current: 0,
    results: {}
  };
  
  dispatch({ type: 'INIT_SESSION', payload: AppState.session });
}

// Initialize app
loadWords().then(() => {
  AppState.progress = loadProgress();
  console.log(`✅ Loaded progress for level ${AppState.progress.level}`);
  render(AppState);
});
