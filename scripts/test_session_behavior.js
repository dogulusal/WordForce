const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createContext(words = {}) {
  const appEl = { innerHTML: '' };
  const modalEl = { innerHTML: '' };
  const dummyEl = {
    addEventListener() {},
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {} },
    appendChild() {},
    remove() {},
    getBoundingClientRect() { return { left: 0, width: 0 }; },
    style: {},
    dataset: {},
  };

  const localStorageData = new Map();
  const context = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    localStorage: {
      getItem(key) { return localStorageData.has(key) ? localStorageData.get(key) : null; },
      setItem(key, value) { localStorageData.set(key, String(value)); },
      removeItem(key) { localStorageData.delete(key); },
    },
    document: {
      getElementById(id) {
        if (id === 'app') return appEl;
        if (id === 'modal-container') return modalEl;
        return dummyEl;
      },
      addEventListener() {},
      querySelectorAll() { return []; },
      body: { appendChild() {} },
    },
    window: {},
    UI: { renderModal() { return ''; } },
    fetch: async (url) => {
      if (String(url).includes('words_enriched.json')) {
        return { ok: true, async json() { return words; } };
      }
      return { ok: false, async text() { return ''; }, async json() { return {}; } };
    },
    getReviewDue(progress) {
      const today = new Date().toLocaleDateString('en-CA');
      return Object.entries(progress.words || {})
        .filter(([_, data]) => data.status === 'learned' && data.nextReview && data.nextReview <= today)
        .map(([word]) => word);
    },
    applyReviewCollisionPolicy() { return false; },
    Exercises: {
      renderDefinition(word) { return { type: 'DEFINITION', word, def: 'x' }; },
      renderENtoTRMC(word) { return { type: 'EN_TO_TR_MC', word, options: ['x'], correct: 'x' }; },
      renderGapFill(word) { return { type: 'GAP_FILL', word, sentence: '___', correct: word, options: [word] }; },
      renderSentenceBuilder(word) { return { type: 'SENTENCE_BUILDER', word, trSentence: 'x', words: [word] }; },
      renderTranslationMC(word) { return { type: 'TRANSLATION_MC', word, trSentence: 'x', options: ['x'], correct: 'x' }; },
      renderContextMatch(word) { return { type: 'CONTEXT_MATCH', word, prompt: 'x', sentences: ['x'], correct: 'x' }; },
      renderMultiGap(word) { return { type: 'MULTI_GAP', word, gapSentence: [], mode: 'separate', chips: [], correctWords: [] }; },
      hasContextMatchData() { return false; },
      normalizeToken(value) { return String(value || '').toLowerCase(); }
    }
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  vm.runInContext(source, context);
  return context;
}

function getJson(context, expression) {
  return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

(async function run() {
  {
    const context = createContext({ alpha: { level: 'A1' }, beta: { level: 'A1' } });
    await vm.runInContext('init()', context);
    vm.runInContext(`
      AppState.progress = { level: 'A1', words: {} };
      AppState.session = {
        words: ['alpha', 'beta'],
        queue: ['alpha', 'beta'],
        templateHistory: {},
        skipped: {},
        levelFilter: 'ALL',
        round: 1,
        current: 0,
        results: {},
        currentExercise: { type: 'DEFINITION', word: 'alpha', def: 'x' }
      };
      AppState.ui.screen = 'round';
    `, context);

    vm.runInContext(`handleAction('round-skip');`, context);
    const session = getJson(context, 'AppState.session');
    const progress = getJson(context, 'AppState.progress');

    assert.deepStrictEqual(session.queue, ['beta', 'alpha'], 'first skip should defer word to end of queue');
    assert.strictEqual(session.current, 0, 'current index should stay on next active word');
    assert.ok(!progress.words.alpha, 'first skip should not mark word for practice yet');
  }

  {
    const context = createContext({ alpha: { level: 'A1' } });
    await vm.runInContext('init()', context);
    vm.runInContext(`
      AppState.progress = { level: 'A1', words: { alpha: { status: 'known', interval: null, nextReview: null } } };
      AllWords = { alpha: { level: 'A1' } };
    `, context);

    vm.runInContext(`initiateSession(10, 'ALL', true);`, context);
    const screen = vm.runInContext('AppState.ui.screen', context);
    const exercise = vm.runInContext('AppState.session.currentExercise', context);

    assert.notStrictEqual(screen, 'round', 'empty session should not leave app on round screen');
    assert.strictEqual(exercise, null, 'empty session should not fabricate an exercise');
  }

  {
    const context = createContext({ alpha: { level: 'A1' }, beta: { level: 'A1' } });
    await vm.runInContext('init()', context);
    vm.runInContext(`
      AppState.progress = {
        level: 'A1',
        words: {
          alpha: { status: 'practice', interval: 1, nextReview: '2099-01-01' },
          beta: { status: 'known', interval: null, nextReview: null }
        }
      };
      AllWords = { alpha: { level: 'A1' }, beta: { level: 'A1' } };
    `, context);

    const picked = getJson(context, 'pickSessionWords(10, "ALL")');
    assert.deepStrictEqual(picked, ['alpha'], 'future-dated practice words should seed session when nothing else is available');
  }

  console.log('session behavior tests passed');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
