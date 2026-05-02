// Spaced Repetition Algorithm

function calculateNextReview(currentInterval, wasCorrect) {
  const intervals = [1, 3, 7, 14, 30];
  if (!wasCorrect) return 1;
  const currentIndex = intervals.indexOf(currentInterval);
  if (currentIndex === -1) return 1; // unknown interval, reset
  if (currentIndex === intervals.length - 1) return null; // retired
  return intervals[currentIndex + 1];
}

function getReviewDue(progress) {
  // Use local date string (timezone-safe) instead of UTC
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  return Object.entries(progress.words)
    .filter(([_, data]) => data.status === 'learned' && data.nextReview <= today)
    .map(([word, _]) => word);
}

// Test
if (typeof module !== 'undefined' && module.exports) {
  console.assert(calculateNextReview(1, true) === 3, "1→3 on correct");
  console.assert(calculateNextReview(3, false) === 1, "3→1 on wrong");
  console.assert(calculateNextReview(30, true) === null, "30→null (retired)");
  console.log("✅ All spaced repetition tests passed");
}
