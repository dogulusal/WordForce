const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };

function shuffleList(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function normalizeToken(token) {
  return String(token || '').toLowerCase().replace(/[.,!?;:'"]/g, '');
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

function getMeaningData(word, allWords, meaningIndex = 0) {
  const wordData = allWords[word] || {};
  if (meaningIndex === 0) {
    return {
      tr: wordData.tr,
      pos: wordData.pos,
      def: wordData.def,
      ex: wordData.ex,
      ex_tr: wordData.ex_tr,
    };
  }

  const alt = Array.isArray(wordData.alt_meanings) ? wordData.alt_meanings[meaningIndex - 1] : null;
  return {
    tr: alt?.tr,
    pos: alt?.pos || wordData.pos,
    def: alt?.def,
    ex: alt?.ex,
    ex_tr: [],
  };
}

function renderDefinition(word, allWords) {
  const data = getMeaningData(word, allWords, 0);
  return {
    type: 'DEFINITION',
    word,
    prompt: `Learn this word: ${word}`,
    def: data?.def || 'No definition available yet.'
  };
}

function renderSecondaryMeaningDefinition(word, meaningIndex, allWords) {
  const primary = getMeaningData(word, allWords, 0);
  const secondary = getMeaningData(word, allWords, meaningIndex);
  return {
    type: 'SECONDARY_MEANING_DEFINITION',
    word,
    meaningIndex,
    meaningPos: secondary?.pos || '',
    primaryPos: primary?.pos || '',
    primaryTr: primary?.tr || '',
    primaryExample: (primary?.ex && primary.ex[0]) || '',
    secondaryTr: secondary?.tr || '',
    secondaryExample: (secondary?.ex && secondary.ex[0]) || '',
    def: secondary?.def || 'No secondary definition available yet.',
  };
}

function renderENtoTRMC(word, allWords, meaningIndex = 0) {
  const meaningData = getMeaningData(word, allWords, meaningIndex);
  const correctTr = meaningData.tr;
  const distractors = selectDistractors(word, allWords, 3, (item) => item.tr);
  const options = shuffleList([correctTr, ...distractors]);

  return {
    type: 'EN_TO_TR_MC',
    prompt: `What does '${word}' mean in Turkish?`,
    options,
    correct: correctTr,
    word,
    meaningIndex
  };
}

function renderGapFill(word, allWords, meaningIndex = 0) {
  const meaningData = getMeaningData(word, allWords, meaningIndex);
  const sentence = (meaningData.ex && meaningData.ex[0]) || `${word} is useful.`;
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
    word,
    meaningIndex
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
  
  // Use English sentences from other words as distractors
  const candidateWords = Object.keys(allWords).filter(w => w !== word && allWords[w].ex?.length > 0);
  const enDisractors = shuffleList(candidateWords).slice(0, 10).map(w => allWords[w].ex[0]).filter(s => s && s !== correctEN).slice(0, 3);
  const options = shuffleList([correctEN, ...enDisractors]).slice(0, 4);

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
  renderSecondaryMeaningDefinition,
  renderENtoTRMC,
  renderGapFill,
  renderSentenceBuilder,
  renderTranslationMC,
  normalizeToken
};
