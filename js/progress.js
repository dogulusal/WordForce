// Spaced Repetition Algorithm

const REVIEW_INTERVALS = [1, 3, 7, 14, 30];

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
    calculateNextReview,
    getReviewDue,
  };
}
