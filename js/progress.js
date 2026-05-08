// Spaced Repetition Algorithm

const REVIEW_INTERVALS = [1, 3, 7, 14, 30];

function toLocalDate(daysToAdd = 0) {
  return new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
}

function getPrimaryMeaningState(wordProgress = {}) {
  return wordProgress.meanings?.[0] ?? { status: wordProgress.status, interval: wordProgress.interval };
}

function ensureMeaningsArray(wordProgress = {}) {
  // Lazy initialization only; do not migrate persisted data in bulk.
  if (!Array.isArray(wordProgress.meanings)) {
    wordProgress.meanings = [getPrimaryMeaningState(wordProgress)];
    return wordProgress.meanings;
  }

  if (!wordProgress.meanings[0]) {
    wordProgress.meanings[0] = getPrimaryMeaningState(wordProgress);
  }

  return wordProgress.meanings;
}

function getMeaningState(wordProgress = {}, meaningIndex = 0) {
  if (meaningIndex === 0) return getPrimaryMeaningState(wordProgress);
  if (!Array.isArray(wordProgress.meanings)) return null;
  return wordProgress.meanings[meaningIndex] || null;
}

function setMeaningState(wordProgress = {}, meaningIndex = 0, patch = {}) {
  const meanings = ensureMeaningsArray(wordProgress);
  const current = meanings[meaningIndex] || { status: 'queued', interval: 1 };
  meanings[meaningIndex] = { ...current, ...patch };
  return meanings[meaningIndex];
}

function normalizeUnlockAfter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 14;
  return REVIEW_INTERVALS.includes(numeric) ? numeric : 14;
}

function unlockSecondaryMeaningsForWord(word, wordData = {}, wordProgress = {}) {
  const altMeanings = Array.isArray(wordData.alt_meanings) ? wordData.alt_meanings : [];
  if (altMeanings.length === 0) return [];

  const primary = getPrimaryMeaningState(wordProgress);
  const primaryInterval = Number(primary.interval || wordProgress.interval || 0);
  const unlocked = [];

  altMeanings.forEach((meaning, altIndex) => {
    const meaningIndex = altIndex + 1;
    const existing = getMeaningState(wordProgress, meaningIndex);

    if (existing && ['queued', 'pending', 'learned'].includes(existing.status)) {
      return;
    }

    const unlockAfter = normalizeUnlockAfter(meaning?.unlockAfter);
    if (primaryInterval < unlockAfter) {
      return;
    }

    setMeaningState(wordProgress, meaningIndex, {
      status: 'queued',
      interval: 1,
      unlockedAt: toLocalDate(),
      meaningIndex,
    });

    unlocked.push({
      word,
      meaningIndex,
      tr: meaning?.tr || '',
      pos: meaning?.pos || '',
      unlockAfter,
    });
  });

  return unlocked;
}

function applySecondaryMeaningUnlocks(progress = {}, allWords = {}, reviewedWords = []) {
  const wordsProgress = progress.words || {};
  const candidates = reviewedWords.length > 0 ? reviewedWords : Object.keys(wordsProgress);
  const unlocked = [];

  candidates.forEach((word) => {
    const wordData = allWords[word];
    const wordProgress = wordsProgress[word];
    if (!wordData || !wordProgress) return;

    const items = unlockSecondaryMeaningsForWord(word, wordData, wordProgress);
    if (items.length > 0) unlocked.push(...items);
  });

  return unlocked;
}

function calculateNextReview(currentInterval, wasCorrect) {
  if (!wasCorrect) return 1;
  const currentIndex = REVIEW_INTERVALS.indexOf(currentInterval);
  if (currentIndex === -1) return 1; // unknown interval, reset
  if (currentIndex === REVIEW_INTERVALS.length - 1) return null; // retired
  return REVIEW_INTERVALS[currentIndex + 1];
}

function getReviewDue(progress) {
  // Use local date string (timezone-safe) instead of UTC
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  return Object.entries(progress.words)
    .filter(([_, data]) => {
      const primary = getPrimaryMeaningState(data);
      return primary.status === 'learned' && data.nextReview <= today;
    })
    .map(([word, _]) => word);
}

// Test
if (typeof module !== 'undefined' && module.exports) {
  const legacy = { status: 'learned', interval: 3 };
  const primary = getPrimaryMeaningState(legacy);
  console.assert(primary.status === 'learned', 'fallback primary status');
  console.assert(primary.interval === 3, 'fallback primary interval');

  const modern = { meanings: [{ status: 'learned', interval: 7 }] };
  const modernPrimary = getPrimaryMeaningState(modern);
  console.assert(modernPrimary.interval === 7, 'meanings[0] primary interval');

  const mutable = { status: 'practice', interval: 1 };
  setMeaningState(mutable, 1, { status: 'queued', interval: 1 });
  console.assert(Array.isArray(mutable.meanings), 'lazy meanings initialization');
  console.assert(mutable.meanings.length >= 2, 'secondary meaning initialized');

  const unlockWordData = {
    alt_meanings: [
      { tr: 'ağaç kabuğu', pos: 'noun', unlockAfter: 14 },
      { tr: 'gemi tipi', pos: 'noun', unlockAfter: 30 },
    ],
  };
  const unlockWordProgress = { status: 'learned', interval: 14, meanings: [{ status: 'learned', interval: 14 }] };
  const unlocked = unlockSecondaryMeaningsForWord('bark', unlockWordData, unlockWordProgress);
  console.assert(unlocked.length === 1, 'unlocks only eligible secondary meanings');
  console.assert(unlockWordProgress.meanings[1].status === 'queued', 'queued status is assigned');

  const sharedProgress = {
    words: {
      bark: { status: 'learned', interval: 14, meanings: [{ status: 'learned', interval: 14 }] },
    },
  };
  const sharedWords = { bark: unlockWordData };
  const sharedUnlocked = applySecondaryMeaningUnlocks(sharedProgress, sharedWords, ['bark']);
  console.assert(sharedUnlocked.length === 1, 'applySecondaryMeaningUnlocks unlocks via reviewed words');

  console.assert(calculateNextReview(1, true) === 3, "1→3 on correct");
  console.assert(calculateNextReview(3, false) === 1, "3→1 on wrong");
  console.assert(calculateNextReview(30, true) === null, "30→null (retired)");
  console.log("✅ All spaced repetition tests passed");

  module.exports = {
    REVIEW_INTERVALS,
    getPrimaryMeaningState,
    ensureMeaningsArray,
    getMeaningState,
    setMeaningState,
    unlockSecondaryMeaningsForWord,
    applySecondaryMeaningUnlocks,
    calculateNextReview,
    getReviewDue,
  };
}
