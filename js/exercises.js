const CEFR_RANK = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
const TOKEN_STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'is', 'are', 'am', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'from', 'by', 'as', 'be', 'was', 'were', 'it', 'this', 'that', 'these', 'those', 'or',
  'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their'
]);

const GENERIC_GAP_TEMPLATES = {
  noun: [
    'I bought a new ___.',
    'Can you pass me that ___?',
    'We talked about the ___ yesterday.'
  ],
  verb: [
    'I usually ___ before breakfast.',
    'They ___ every day after work.',
    'Can you ___ this for me?'
  ],
  adj: [
    'The weather is very ___.',
    'That was a ___ idea.',
    'This bag looks ___.'
  ],
  adv: [
    'She speaks very ___.',
    'He finished the task ___.',
    'They arrived ___ than expected.'
  ],
  prep: [
    'The keys are ___ the table.',
    'We met ___ the station.',
    'He sat ___ his friend.'
  ],
  conj: [
    'I stayed home ___ it was raining.',
    'She called me ___ she arrived.',
    'Take a jacket ___ it gets cold.'
  ]
};

function shuffleList(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

function normalizeToken(token) {
  return String(token || '').toLowerCase().replace(/[.,!?;:'"]/g, '');
}

function tokenizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_']/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !TOKEN_STOPWORDS.has(t));
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function flattenSbDistractors(wordData) {
  if (!Array.isArray(wordData?.sb_distractors)) return [];
  return wordData.sb_distractors.flat().map((t) => String(t || '').trim()).filter(Boolean);
}

const TRANSLATION_OVERRIDES = {
  abandon: 'terk etmek, bırakmak'
};

function displayWord(word) {
  return String(word || '').replace(/_/g, ' ');
}

function normalizedDisplayWord(word) {
  return normalizeToken(displayWord(word));
}

function isSameAsEnglishWord(value, word) {
  return normalizeToken(value) === normalizedDisplayWord(word);
}

function isPlaceholderText(text, word) {
  const value = String(text || '').toLowerCase();
  const wordText = displayWord(word).toLowerCase();
  if (!value.trim()) return true;
  return value.includes(`a word used with a meaning close to "${wordText}"`) ||
    value.includes(`the word ${wordText} appears in today's vocabulary set`) ||
    value.includes(`i saw ${wordText} in a sentence and wrote it down`) ||
    value.includes(`"${wordText}" kelimesi bu cumlede kullanilmistir`) ||
    value.includes(`"${wordText}" kelimesi bu cümlede kullanılmıştır`) ||
    value.includes(`${wordText} kelimesi bu cumlede kullanilmistir`) ||
    value.includes(`${wordText} kelimesi bu cümlede kullanılmıştır`) ||
    value.includes('dogru ceviri degildir') ||
    value.includes('doğru çeviri değildir') ||
    value.includes('anlam farklidir') ||
    value.includes('anlam farklıdır') ||
    value.includes('cumle zamani farklidir') ||
    value.includes('cümle zamanı farklıdır') ||
    value.includes('ozneyi degistirir') ||
    value.includes('özneyi değiştirir') ||
    value.includes('anlami kaydirir') ||
    value.includes('anlamı kaydırır');
}

function getUsefulTranslation(word, wordData = {}, meaningData = null) {
  const override = TRANSLATION_OVERRIDES[word];
  if (override) return override;

  const candidates = [meaningData?.tr, wordData.tr].filter(Boolean);
  return candidates.find((value) => !isSameAsEnglishWord(value, word) && !isPlaceholderText(value, word)) || '';
}

function getUsefulDefinition(word, wordData = {}, meaningData = null) {
  const candidates = [meaningData?.def, wordData.def].filter(Boolean);
  return candidates.find((value) => !isPlaceholderText(value, word)) || '';
}

function getUsefulExampleIndex(word, wordData = {}) {
  const examples = Array.isArray(wordData.ex) ? wordData.ex : [];
  return examples.findIndex((example) => !isPlaceholderText(example, word));
}

function getUsefulExamples(word, wordData = {}) {
  const examples = Array.isArray(wordData.ex) ? wordData.ex : [];
  return examples.filter((example) => !isPlaceholderText(example, word));
}

function getFirstUsefulExample(word, wordData = {}) {
  return getUsefulExamples(word, wordData)[0] || '';
}

function isExerciseReadyWord(word, allWords) {
  const wordData = allWords?.[word] || {};
  return Boolean(getUsefulTranslation(word, wordData)) && getUsefulExampleIndex(word, wordData) >= 0;
}

function buildWordKeyLookup(allWords) {
  const lookup = {};
  Object.keys(allWords || {}).forEach((key) => {
    const normKey = normalizeToken(key.replace(/_/g, ' '));
    lookup[normKey] = key;
    lookup[normalizeToken(key.replace(/_/g, "'"))] = key;
  });
  return lookup;
}

function contextTokensForItem(item) {
  const exText = Array.isArray(item?.ex) ? item.ex.join(' ') : '';
  const defText = item?.def || '';
  return tokenizeText(`${defText} ${exText}`);
}

function tokenOverlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) overlap += 1;
  });
  const base = Math.max(a.size, b.size);
  return base > 0 ? overlap / base : 0;
}

function rankSemanticDistractorKeys(word, allWords) {
  const target = allWords[word];
  if (!target) return [];

  const targetRank = CEFR_RANK[target.level] || 1;
  const targetTokens = contextTokensForItem(target);

  const scored = Object.keys(allWords)
    .filter((candidateWord) => candidateWord !== word)
    .map((candidateWord) => ({ key: candidateWord, item: allWords[candidateWord] }))
    .filter(({ item }) => item?.pos === target.pos)
    .map(({ key, item }) => {
      const candidateRank = CEFR_RANK[item.level] || 1;
      const levelDistance = Math.abs(candidateRank - targetRank);
      const candidateTokens = contextTokensForItem(item);
      const contextScore = tokenOverlapScore(targetTokens, candidateTokens);
      const defScore = tokenOverlapScore(tokenizeText(target.def), tokenizeText(item.def));

      let score = 0;
      score += Math.max(0, 3 - levelDistance);
      score += contextScore * 8;
      score += defScore * 5;

      if (item.tr && target.tr && normalizeToken(item.tr) === normalizeToken(target.tr)) {
        score -= 8;
      }

      return { key, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((row) => row.key);
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
  const wordData = allWords[word] || {};
  const def = getUsefulDefinition(word, wordData, data) || getUsefulTranslation(word, wordData, data);
  return {
    type: 'DEFINITION',
    word,
    prompt: `Learn this word: ${word}`,
    def: def || 'No definition available yet.'
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
  const wordData = allWords[word] || {};
  const correctAnswer = getUsefulTranslation(word, wordData, meaningData);
  if (!correctAnswer) return null;

  // Build distractors from Turkish translations of semantically similar words
  const semanticKeys = rankSemanticDistractorKeys(word, allWords);
  const trDistractors = semanticKeys
    .map((key) => getUsefulTranslation(key, allWords[key], getMeaningData(key, allWords)))
    .filter((d) => d && normalizeToken(d) !== normalizeToken(correctAnswer));

  const fallbackTr = selectDistractors(word, allWords, 12, (item, key) => getUsefulTranslation(key, item)).filter(Boolean)
    .filter((d) => normalizeToken(d) !== normalizeToken(correctAnswer));

  const pool = uniqueValues([...trDistractors, ...fallbackTr]);
  const distractors = pool.slice(0, 3);
  const options = shuffleList(uniqueValues([correctAnswer, ...distractors])).slice(0, 4);

  return {
    type: 'EN_TO_TR_MC',
    prompt: `What is the Turkish meaning of '${displayWord(word)}'?`,
    options,
    correct: correctAnswer,
    word,
    meaningIndex
  };
}

function chooseGapSentence(word, allWords, options = {}) {
  const { isPractice = false, preferredExampleIndex = null } = options;
  const wordData = allWords[word] || {};
  const examples = getUsefulExamples(word, wordData);

  if (!isPractice) {
    return examples[0] || `${word} is useful.`;
  }

  const rawExamples = Array.isArray(wordData.ex) ? wordData.ex : [];
  if (Number.isInteger(preferredExampleIndex) && rawExamples[preferredExampleIndex] && !isPlaceholderText(rawExamples[preferredExampleIndex], word)) {
    return rawExamples[preferredExampleIndex];
  }

  const pos = wordData.pos || '';
  const generic = GENERIC_GAP_TEMPLATES[pos] || GENERIC_GAP_TEMPLATES.noun;
  if (examples.length > 0) {
    return examples[Math.floor(Math.random() * examples.length)];
  }
  return generic[Math.floor(Math.random() * generic.length)] || `I use ${word} every day.`;
}

function renderGapFill(word, allWords, meaningIndex = 0, options = {}) {
  const meaningData = getMeaningData(word, allWords, meaningIndex);
  const wordData = allWords[word] || {};
  const sentence = chooseGapSentence(word, allWords, options);
  const displayWord = word.replace(/_/g, ' ');

  // Use regex for multi-word support
  const forms = [word, displayWord, word.replace(/_/g, "'")];
  let gappedSentence = null;
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(sentence)) {
      gappedSentence = sentence.replace(regex, '___');
      break;
    }
  }
  if (!gappedSentence) gappedSentence = `${sentence} (___)`;

  const distractors = selectDistractors(word, allWords, 3, (_, w) => w.replace(/_/g, ' '));
  const shuffledOptions = shuffleList([word.replace(/_/g, ' '), ...distractors]);

  // Use definition as hint (English only)
  const hint = getUsefulDefinition(word, wordData, meaningData) || getUsefulTranslation(word, wordData, meaningData);

  return {
    type: 'GAP_FILL',
    sentence: gappedSentence,
    options: shuffledOptions,
    correct: word.replace(/_/g, ' '),
    hint,
    word,
    meaningIndex
  };
}

function renderSentenceBuilder(word, allWords) {
  const wordData = allWords[word];
  const examples = Array.isArray(wordData.ex) ? wordData.ex : [];
  const translations = Array.isArray(wordData.ex_tr) ? wordData.ex_tr : [];
  const usefulIndexes = examples
    .map((example, index) => ({ example, index, translation: translations[index] || '' }))
    .filter(({ example, translation }) => !isPlaceholderText(example, word) && !isPlaceholderText(translation, word))
    .map(({ index }) => index);
  if (usefulIndexes.length === 0) return null;

  const sentenceIndex = usefulIndexes[Math.floor(Math.random() * usefulIndexes.length)];
  const enSentence = examples[sentenceIndex];
  const meaningData = getMeaningData(word, allWords, 0);
  const tr = getUsefulTranslation(word, wordData, meaningData);
  const sentenceTr = translations[sentenceIndex];
  const def = getUsefulDefinition(word, wordData, meaningData) || `meaning of ${displayWord(word)}`;

  const chips = enSentence.split(/\s+/).map(normalizeToken).filter(Boolean);
  const distractors = (wordData.sb_distractors?.[sentenceIndex] || []).map(normalizeToken).filter(Boolean);
  const mixedChips = shuffleList([...chips, ...distractors]);

  return {
    type: 'SENTENCE_BUILDER',
    definition: def,
    tr,
    sentenceTr,
    chips: mixedChips,
    correct: chips.join(' '),
    correctTokens: chips,
    sentenceIndex,
    word
  };
}

function renderTranslationMC(word, allWords) {
  const wordData = allWords[word];
  const examples = Array.isArray(wordData.ex) ? wordData.ex : [];
  const usefulIndexes = examples
    .map((example, index) => ({ example, index }))
    .filter(({ example }) => !isPlaceholderText(example, word))
    .map(({ index }) => index);
  if (usefulIndexes.length === 0) return null;

  const sentenceIndex = usefulIndexes[Math.floor(Math.random() * usefulIndexes.length)];
  const correctEN = examples[sentenceIndex];
  const def = getUsefulDefinition(word, wordData, getMeaningData(word, allWords, 0)) || `meaning of ${word.replace(/_/g, ' ')}`;

  // Build English sentence distractors
  // Priority 1: Use pre-authored English distractors
  const explicitDistr = Array.isArray(wordData.ex_distractors?.[sentenceIndex])
    ? wordData.ex_distractors[sentenceIndex].filter(s => s && s !== correctEN && !isPlaceholderText(s, word))
    : [];

  let distractors;
  if (explicitDistr.length >= 3) {
    distractors = shuffleList(explicitDistr).slice(0, 3);
  } else {
    // Priority 2: Build distractors by swapping target word
    const sbWords = Array.isArray(wordData.sb_distractors?.[sentenceIndex])
      ? wordData.sb_distractors[sentenceIndex]
      : (Array.isArray(wordData.sb_distractors?.[0]) ? wordData.sb_distractors[0] : []);

    const displayWord = word.replace(/_/g, ' ');
    const swapped = sbWords
      .map(sub => {
        const regex = new RegExp(`\\b${displayWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(correctEN)) {
          return correctEN.replace(regex, sub);
        }
        return null;
      })
      .filter(Boolean)
      .filter(s => s !== correctEN);

    distractors = [...explicitDistr, ...swapped];

    // Priority 3: Fallback to random English sentences from other words
    if (distractors.length < 3) {
      const candidateWords = Object.keys(allWords).filter(w => w !== word && allWords[w].ex?.length > 0);
      const fallback = shuffleList(candidateWords)
        .map(w => getFirstUsefulExample(w, allWords[w]))
        .filter(s => s && s !== correctEN && !distractors.includes(s))
        .slice(0, 12);
      distractors = [...distractors, ...fallback];
    }
    distractors = uniqueValues(distractors).slice(0, 3);
  }

  const options = shuffleList(uniqueValues([correctEN, ...distractors])).slice(0, 4);
  if (options.length < 4) return null;

  return {
    type: 'TRANSLATION_MC',
    definition: def,
    options,
    correct: correctEN,
    sentenceIndex,
    word
  };
}

// ── Round 5: Context Match (Odd-One-Out) ──────────────────────────────────

function hasContextMatchData(word, allWords) {
  const wordData = allWords[word] || {};
  if (Array.isArray(wordData.wrong_usage) && wordData.wrong_usage.length > 0) return true;
  if (Array.isArray(wordData.collocations) && wordData.collocations.length >= 2) return true;
  return false;
}

function generateWrongSentence(word, allWords) {
  const wordData = allWords[word] || {};

  // Priority 1: Pre-authored wrong_usage
  if (Array.isArray(wordData.wrong_usage) && wordData.wrong_usage.length > 0) {
    return wordData.wrong_usage[Math.floor(Math.random() * wordData.wrong_usage.length)];
  }

  // Priority 2: Collocation-break
  if (Array.isArray(wordData.collocations) && wordData.collocations.length >= 2) {
    const collocations = wordData.collocations;
    // Pick a collocation and break it by swapping the partner word
    const targetColloc = collocations[Math.floor(Math.random() * collocations.length)];
    // Find words that don't collocate with the target word for substitution
    const otherWords = Object.keys(allWords).filter(w => {
      if (w === word) return false;
      const otherData = allWords[w];
      return otherData?.pos === wordData.pos && otherData?.level === wordData.level;
    });
    if (otherWords.length > 0) {
      const substitute = otherWords[Math.floor(Math.random() * otherWords.length)];
      // Replace the word in one of the collocation patterns
      const displayWord = word.replace(/_/g, ' ');
      const displaySub = substitute.replace(/_/g, ' ');
      // Build a sentence using the broken collocation
      return `I need to ${displaySub} ${targetColloc.replace(displayWord, '').trim()}.`;
    }
  }

  return null;
}

function renderContextMatch(word, allWords) {
  const wordData = allWords[word] || {};
  const displayWord = word.replace(/_/g, ' ');

  // Get correct sentences (from ex array)
  const correctSentences = getUsefulExamples(word, wordData).slice(0, 3);
  if (correctSentences.length < 2) return null;

  // Generate wrong sentence
  const wrongSentence = generateWrongSentence(word, allWords);
  if (!wrongSentence) return null;

  // Take 3 correct sentences (pad with generic if needed)
  const correct3 = correctSentences.slice(0, 3);
  while (correct3.length < 3) {
    correct3.push(`${displayWord.charAt(0).toUpperCase() + displayWord.slice(1)} is commonly used in English.`);
  }

  const allSentences = shuffleList([...correct3, wrongSentence]);

  return {
    type: 'CONTEXT_MATCH',
    prompt: `Which sentence uses '${displayWord}' incorrectly?`,
    sentences: allSentences,
    correct: wrongSentence,
    word
  };
}

// ── Round 6: Multi-Gap Placement ──────────────────────────────────────────

function findCoOccurrence(wordA, wordB, allWords) {
  const dataA = allWords[wordA] || {};
  const dataB = allWords[wordB] || {};
  const normB = normalizeToken(wordB.replace(/_/g, ' '));
  const normA = normalizeToken(wordA.replace(/_/g, ' '));

  // Check if wordB appears in any of wordA's examples
  for (const sentence of getUsefulExamples(wordA, dataA)) {
    if (normalizeToken(sentence).includes(normB)) {
      return { sentence, words: [wordA, wordB] };
    }
  }
  // Check if wordA appears in any of wordB's examples
  for (const sentence of getUsefulExamples(wordB, dataB)) {
    if (normalizeToken(sentence).includes(normA)) {
      return { sentence, words: [wordB, wordA] };
    }
  }
  return null;
}

function selectSecondWord(currentWord, sessionQueue, allWords) {
  const candidates = sessionQueue.filter(w => {
    if (w === currentWord) return false;
    const data = allWords[w];
    return data && getUsefulExamples(w, data).length > 0;
  });

  if (candidates.length === 0) return null;

  // Priority 1: Natural co-occurrence
  for (const candidate of candidates) {
    const coOccurrence = findCoOccurrence(currentWord, candidate, allWords);
    if (coOccurrence) return { word: candidate, coOccurrence };
  }

  // Priority 2: Different POS (makes compound join more natural)
  const currentPos = allWords[currentWord]?.pos;
  const diffPos = candidates.filter(w => allWords[w]?.pos !== currentPos);
  if (diffPos.length > 0) {
    return { word: diffPos[Math.floor(Math.random() * diffPos.length)], coOccurrence: null };
  }

  // Priority 3: Any session word
  return { word: candidates[Math.floor(Math.random() * candidates.length)], coOccurrence: null };
}

function renderMultiGap(word, sessionQueue, allWords) {
  if (sessionQueue.length < 2) return null;

  const secondResult = selectSecondWord(word, sessionQueue, allWords);
  if (!secondResult) return null;

  const wordB = secondResult.word;
  const displayA = word.replace(/_/g, ' ');
  const displayB = wordB.replace(/_/g, ' ');

  let sentence;
  let gapSentence;
  let mode;

  if (secondResult.coOccurrence) {
    // Natural co-occurrence: single sentence with both words blanked
    sentence = secondResult.coOccurrence.sentence;
    mode = 'single';
  } else {
    // No co-occurrence: show each word's sentence separately (no fake compound joins)
    const sentA = getFirstUsefulExample(word, allWords[word]) || `I use ${displayA} every day.`;
    const sentB = getFirstUsefulExample(wordB, allWords[wordB]) || `I use ${displayB} every day.`;
    sentence = null;
    mode = 'separate';
    gapSentence = [
      { sentence: blankWord(sentA, word), correct: displayA },
      { sentence: blankWord(sentB, wordB), correct: displayB }
    ];
  }

  if (mode !== 'separate') {
    // Blank both words in the co-occurrence sentence
    let blanked = sentence;
    const formsA = [word, word.replace(/_/g, ' '), word.replace(/_/g, "'")].map(normalizeToken);
    const formsB = [wordB, wordB.replace(/_/g, ' '), wordB.replace(/_/g, "'")].map(normalizeToken);

    const tokens = blanked.split(/(\s+)/);
    let blankCount = 0;
    const gaps = [];
    const gappedTokens = tokens.map((part) => {
      if (/^\s+$/.test(part)) return part;
      const norm = normalizeToken(part);
      if (formsA.includes(norm) && !gaps.includes('A')) {
        gaps.push('A');
        blankCount++;
        return `___${blankCount}`;
      }
      if (formsB.includes(norm) && !gaps.includes('B')) {
        gaps.push('B');
        blankCount++;
        return `___${blankCount}`;
      }
      return part;
    });

    if (blankCount < 2) {
      // Couldn't blank both words, fall back to separate
      const sentA = getFirstUsefulExample(word, allWords[word]) || `I use ${displayA} every day.`;
      const sentB = getFirstUsefulExample(wordB, allWords[wordB]) || `I use ${displayB} every day.`;
      mode = 'separate';
      gapSentence = [
        { sentence: blankWord(sentA, word), correct: displayA },
        { sentence: blankWord(sentB, wordB), correct: displayB }
      ];
    } else {
      gapSentence = [{
        sentence: gappedTokens.join(''),
        gaps: gaps.map((g, i) => ({
          id: i + 1,
          correct: g === 'A' ? displayA : displayB
        }))
      }];
    }
  }

  // Build distractors
  const correctWords = [displayA, displayB];
  let distractorPool = buildDistractorPool(word, allWords)
    .filter(w => w !== wordB)
    .map(w => w.replace(/_/g, ' '))
    .filter(d => !correctWords.includes(d));

  if (distractorPool.length < 2) {
    const fallbackPool = Object.keys(allWords)
      .filter(w => w !== word && w !== wordB)
      .map(w => w.replace(/_/g, ' '))
      .filter(d => !correctWords.includes(d));
    distractorPool = uniqueValues([...distractorPool, ...fallbackPool]);
  }

  const distractors = shuffleList(distractorPool).slice(0, 2);
  const chips = shuffleList(uniqueValues([...correctWords, ...distractors]));
  if (chips.length < 4) return null;

  return {
    type: 'MULTI_GAP',
    prompt: `Fill the blanks with the correct words.`,
    gapSentence,
    mode,
    chips,
    correctWords,
    words: [word, wordB]
  };
}

function blankWord(sentence, word) {
  const displayWord = word.replace(/_/g, ' ');
  const forms = [word, displayWord, word.replace(/_/g, "'")];
  // Use regex to handle multi-word entries properly
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(sentence)) {
      return sentence.replace(regex, '___');
    }
  }
  return `${sentence} (___)`;
}

function renderFreeTypeGap(word, allWords) {
  const wordData = allWords[word] || {};
  const examples = Array.isArray(wordData.ex) ? wordData.ex.filter(Boolean) : [];
  const exTr = Array.isArray(wordData.ex_tr) ? wordData.ex_tr : [];

  // Pick a random example sentence
  const sentenceIndex = examples.length > 1
    ? Math.floor(Math.random() * examples.length)
    : 0;
  const sentence = examples[sentenceIndex] || `I use ${word.replace(/_/g, ' ')} every day.`;
  const hint = wordData.def || '';
  const displayWord = word.replace(/_/g, ' ');

  // Use regex for multi-word support
  const forms = [word, displayWord, word.replace(/_/g, "'")];
  let gappedSentence = null;
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(sentence)) {
      gappedSentence = sentence.replace(regex, '___');
      break;
    }
  }
  if (!gappedSentence) gappedSentence = `${sentence} (___)`;

  return {
    type: 'FREE_TYPE_GAP',
    sentence: gappedSentence,
    correct: displayWord,
    hint,
    word,
    def: wordData.def || ''
  };
}

// ── Collocation Match Exercise ────────────────────────────────────────────

function renderCollocationMatch(word, allWords) {
  const wordData = allWords[word] || {};
  const displayWord = word.replace(/_/g, ' ');
  const collocations = Array.isArray(wordData.collocations) ? wordData.collocations : [];

  if (collocations.length === 0) return null;

  const correctCollocation = collocations[Math.floor(Math.random() * collocations.length)];
  const realCollocSet = new Set(collocations.map(c => c.toLowerCase().trim()));

  const distractorCandidates = [];

  // Strategy 1: swap other words into their own collocations with our target word
  // e.g. "break a record" → "set a record", "give advice" → "set advice"
  const otherWordList = shuffleList(
    Object.keys(allWords).filter(w => w !== word && Array.isArray(allWords[w]?.collocations) && allWords[w].collocations.length > 0)
  ).slice(0, 50);

  for (const otherWord of otherWordList) {
    const otherDisplay = otherWord.replace(/_/g, ' ');
    const escaped = otherDisplay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const otherRx = new RegExp(`\\b${escaped}\\b`, 'i');
    for (const colloc of allWords[otherWord].collocations || []) {
      if (!otherRx.test(colloc)) continue;
      const fake = colloc.replace(otherRx, displayWord).toLowerCase().trim();
      if (!realCollocSet.has(fake) && fake !== correctCollocation.toLowerCase() && !distractorCandidates.includes(fake)) {
        distractorCandidates.push(fake);
      }
      if (distractorCandidates.length >= 12) break;
    }
    if (distractorCandidates.length >= 12) break;
  }

  // Fallback: same-POS words' collocations (original approach)
  if (distractorCandidates.length < 3) {
    const samePosWords = Object.keys(allWords).filter(w => {
      if (w === word) return false;
      return allWords[w]?.pos === wordData.pos && Array.isArray(allWords[w].collocations) && allWords[w].collocations.length > 0;
    });
    for (const candidate of shuffleList(samePosWords).slice(0, 15)) {
      for (const colloc of allWords[candidate].collocations || []) {
        if (colloc !== correctCollocation && !distractorCandidates.includes(colloc)) {
          distractorCandidates.push(colloc);
        }
      }
    }
  }

  const distractors = shuffleList(distractorCandidates).slice(0, 3);
  const options = shuffleList([correctCollocation, ...distractors]);

  return {
    type: 'COLLOCATION_MATCH',
    prompt: `Which phrase correctly collocates with "${displayWord}"?`,
    options,
    correct: correctCollocation,
    word,
    hint: wordData.def || ''
  };
}

// ── Error Correction Exercise ─────────────────────────────────────────────

function renderErrorCorrection(word, allWords) {
  const wordData = allWords[word] || {};
  const displayWord = word.replace(/_/g, ' ');
  const examples = getUsefulExamples(word, wordData);

  if (examples.length === 0) return null;

  // Pick a correct sentence
  const correctSentence = examples[Math.floor(Math.random() * examples.length)];

  // Strategy: Create an incorrect version of the sentence by misusing the word
  let incorrectSentence = null;
  let errorType = '';

  // Strategy 1: Replace the target word with a confusing similar word
  const confusables = Object.keys(allWords).filter(w => {
    if (w === word) return false;
    const d = allWords[w];
    return d?.pos === wordData.pos && d?.level === wordData.level;
  });

  if (confusables.length > 0) {
    const wrongWord = confusables[Math.floor(Math.random() * confusables.length)];
    const wrongDisplay = wrongWord.replace(/_/g, ' ');
    const forms = [word, displayWord, word.replace(/_/g, "'")];
    for (const form of forms) {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(correctSentence)) {
        incorrectSentence = correctSentence.replace(regex, wrongDisplay);
        errorType = 'wrong_word';
        break;
      }
    }
  }

  // Strategy 2: Use wrong_usage if available
  const wrongUsage = Array.isArray(wordData.wrong_usage)
    ? wordData.wrong_usage.filter((sentence) => !isPlaceholderText(sentence, word))
    : [];
  if (!incorrectSentence && wrongUsage.length > 0) {
    incorrectSentence = wrongUsage[Math.floor(Math.random() * wrongUsage.length)];
    errorType = 'wrong_usage';
  }

  if (!incorrectSentence) return null;

  // Present: show the INCORRECT sentence, user must identify and correct it
  return {
    type: 'ERROR_CORRECTION',
    prompt: `This sentence has an error. Find and fix it:`,
    incorrectSentence,
    correctSentence,
    correctWord: displayWord,
    errorType,
    word,
    hint: wordData.def || ''
  };
}

window.Exercises = {
  renderDefinition,
  renderSecondaryMeaningDefinition,
  renderENtoTRMC,
  renderGapFill,
  renderFreeTypeGap,
  renderSentenceBuilder,
  renderTranslationMC,
  renderContextMatch,
  renderMultiGap,
  renderCollocationMatch,
  renderErrorCorrection,
  hasContextMatchData,
  isExerciseReadyWord,
  getUsefulTranslation,
  normalizeToken
};
