const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };

function shuffleList(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function normalizeToken(token) {
  return String(token || '').toLowerCase().replace(/[.,!?;:]/g, '');
}

function buildDistractorPool(word, allWords) {
  const target = allWords[word];
  if (!target) return [];

  const samePosSameLevel = Object.keys(allWords)
    .filter((w) => w !== word && allWords[w].pos === target.pos && allWords[w].level === target.level);

  if (samePosSameLevel.length >= 3) return samePosSameLevel;

  const targetRank = CEFR_RANK[target.level] || 1;
  return Object.keys(allWords)
    .filter((w) => {
      if (w === word) return false;
      const item = allWords[w];
      const rank = CEFR_RANK[item.level] || 1;
      return item.pos === target.pos && Math.abs(rank - targetRank) <= 1;
    });
}

function selectDistractors(word, allWords, count, valueSelector) {
  const pool = buildDistractorPool(word, allWords);
  const picked = shuffleList(pool).slice(0, count).map((w) => valueSelector(allWords[w], w)).filter(Boolean);

  if (picked.length >= count) return picked;

  const fallback = shuffleList(Object.keys(allWords))
    .filter((w) => w !== word)
    .map((w) => valueSelector(allWords[w], w))
    .filter((value) => Boolean(value) && !picked.includes(value));

  return [...picked, ...fallback].slice(0, count);
}

function renderDefinition(word, allWords) {
  const data = allWords[word];
  return {
    type: 'DEFINITION',
    word,
    prompt: `Learn this word: ${word}`,
    def: data?.def || 'No definition available yet.'
  };
}

function renderENtoTRMC(word, allWords) {
  const wordData = allWords[word];
  const correctTr = wordData.tr;
  const distractors = selectDistractors(word, allWords, 3, (item) => item.tr);
  const options = shuffleList([correctTr, ...distractors]);

  return {
    type: 'EN_TO_TR_MC',
    prompt: `What does '${word}' mean in Turkish?`,
    options,
    correct: correctTr,
    word
  };
}

function renderGapFill(word, allWords) {
  const wordData = allWords[word];
  const sentence = (wordData.ex && wordData.ex[0]) || `${word} is useful.`;
  const targetForms = [word, word.replace(/_/g, ' '), word.replace(/_/g, "'")].map(normalizeToken);
  const tokens = sentence.split(/(\s+)/);
  let replaced = false;

  const gappedTokens = tokens.map((part) => {
    if (replaced || /^\s+$/.test(part)) return part;
    const normalized = normalizeToken(part);
    if (targetForms.includes(normalized)) {
      replaced = true;
      return '___';
    }
    return part;
  });

  const gappedSentence = replaced ? gappedTokens.join('') : `${sentence} (___)`;
  const distractors = selectDistractors(word, allWords, 3, (_, w) => w.replace(/_/g, ' '));
  const options = shuffleList([word.replace(/_/g, ' '), ...distractors]);

  return {
    type: 'GAP_FILL',
    sentence: gappedSentence,
    options,
    correct: word.replace(/_/g, ' '),
    word
  };
}

function renderSentenceBuilder(word, allWords) {
  const wordData = allWords[word];
  const sentenceIndex = Math.floor(Math.random() * (wordData.ex?.length || 1));
  const trSentence = wordData.ex_tr?.[sentenceIndex] || wordData.tr;
  const enSentence = wordData.ex?.[sentenceIndex] || `${word} is important.`;

  const chips = enSentence.split(/\s+/).map(normalizeToken).filter(Boolean);
  const distractors = (wordData.sb_distractors?.[sentenceIndex] || []).map(normalizeToken).filter(Boolean);
  const mixedChips = shuffleList([...chips, ...distractors]);

  return {
    type: 'SENTENCE_BUILDER',
    trSentence,
    chips: mixedChips,
    correct: chips.join(' '),
    sentenceIndex,
    word
  };
}

function renderTranslationMC(word, allWords) {
  const wordData = allWords[word];
  const sentenceIndex = Math.floor(Math.random() * (wordData.ex?.length || 1));
  const trSentence = wordData.ex_tr?.[sentenceIndex] || wordData.tr;
  const correctEN = wordData.ex?.[sentenceIndex] || `${word} is useful.`;
  const distractors = wordData.ex_distractors?.[sentenceIndex] || [];
  const options = shuffleList([correctEN, ...distractors]).slice(0, 4);

  return {
    type: 'TRANSLATION_MC',
    trSentence,
    options,
    correct: correctEN,
    sentenceIndex,
    word
  };
}

window.Exercises = {
  renderDefinition,
  renderENtoTRMC,
  renderGapFill,
  renderSentenceBuilder,
  renderTranslationMC,
  normalizeToken
};
