const fs = require('fs');
const path = require('path');

const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
const failuresPath = path.join(__dirname, '../data/words_enrichment_failures.json');
const spotCheckPath = path.join(__dirname, '../data/spot_check_review.json');

if (!fs.existsSync(enrichedPath)) {
  console.error('Missing data/words_enriched.json. Run scripts/enrich.js first.');
  process.exit(1);
}

const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));

function containsTargetForm(sentence, word) {
  if (typeof sentence !== 'string') return false;
  const normalizedSentence = sentence.toLowerCase();
  const forms = [
    word.toLowerCase(),
    word.toLowerCase().replace(/_/g, ' '),
    word.toLowerCase().replace(/_/g, "'"),
  ];
  return forms.some((form) => normalizedSentence.includes(form));
}

function normalizeGloss(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"()\[\]]/g, '');
}

function addError(errors, word, code, message) {
  errors.push({
    source: 'validate',
    word,
    code,
    error: message,
  });
}

function validateCoreFields(word, data, errors) {
  if (!data.def || data.def.trim() === '') addError(errors, word, 'MISSING_DEF', 'MISSING def');
  if (!Array.isArray(data.ex) || data.ex.length < 2) addError(errors, word, 'MISSING_EX', 'MISSING ex (expected >= 2)');
  if (!Array.isArray(data.ex_tr) || data.ex_tr.length !== data.ex.length) {
    addError(errors, word, 'MISMATCH_EX_TR', 'MISSING/MISMATCHED ex_tr');
  }
  if (!data.ex?.some((s) => containsTargetForm(s, word))) {
    addError(errors, word, 'TARGET_FORM_MISSING', 'ex missing target form');
  }
  if (!Array.isArray(data.ex_distractors) || data.ex_distractors.length !== data.ex.length) {
    addError(errors, word, 'MISMATCH_EX_DISTRACTORS', 'MISSING/MISMATCHED ex_distractors');
  }
  if (!Array.isArray(data.sb_distractors) || data.sb_distractors.length !== data.ex.length) {
    addError(errors, word, 'MISMATCH_SB_DISTRACTORS', 'MISSING/MISMATCHED sb_distractors');
  }

  data.ex_distractors?.forEach((dists, i) => {
    if (!Array.isArray(dists) || dists.length !== 3) {
      addError(errors, word, 'INVALID_EX_DISTRACTOR_ROW', `ex_distractors[${i}] should be 3-item array`);
    }
  });

  data.sb_distractors?.forEach((dists, i) => {
    if (!Array.isArray(dists) || dists.length !== 3) {
      addError(errors, word, 'INVALID_SB_DISTRACTOR_ROW', `sb_distractors[${i}] should be 3-item array`);
    }
  });
}

function validateAltMeanings(word, data, errors) {
  const altMeanings = Array.isArray(data.alt_meanings) ? data.alt_meanings : [];

  if (altMeanings.length > 3) {
    addError(errors, word, 'ALT_MEANINGS_MAX_EXCEEDED', 'alt_meanings.length must be <= 3');
  }

  const primaryGloss = normalizeGloss(data.tr);
  const seenGlosses = new Set(primaryGloss ? [primaryGloss] : []);
  const seenSenseIds = new Set();
  let previousRank = -Infinity;

  altMeanings.forEach((meaning, index) => {
    if (!meaning || typeof meaning !== 'object') {
      addError(errors, word, 'INVALID_ALT_MEANING', `alt_meanings[${index}] must be an object`);
      return;
    }

    if (!meaning.tr || !String(meaning.tr).trim()) {
      addError(errors, word, 'ALT_MISSING_TR', `alt_meanings[${index}] missing tr`);
    }
    if (!meaning.def || !String(meaning.def).trim()) {
      addError(errors, word, 'ALT_MISSING_DEF', `alt_meanings[${index}] missing def`);
    }
    if (!Array.isArray(meaning.ex) || meaning.ex.length < 1 || !String(meaning.ex[0] || '').trim()) {
      addError(errors, word, 'ALT_MISSING_EX', `alt_meanings[${index}] must include ex[0]`);
    }

    if (![1, 3, 7, 14, 30].includes(Number(meaning.unlockAfter))) {
      addError(errors, word, 'INVALID_UNLOCK_AFTER', `alt_meanings[${index}] unlockAfter must be one of 1|3|7|14|30`);
    }

    const normalized = normalizeGloss(meaning.tr);
    if (normalized) {
      if (seenGlosses.has(normalized)) {
        addError(errors, word, 'DUPLICATE_GLOSS', `duplicate Turkish gloss in alt_meanings[${index}]`);
      }
      seenGlosses.add(normalized);
    }

    const source = meaning.source || {};
    const senseId = source.senseId;
    if (!senseId) {
      addError(errors, word, 'MISSING_SENSE_ID', `alt_meanings[${index}] missing source.senseId`);
    } else {
      if (seenSenseIds.has(senseId)) {
        addError(errors, word, 'DUPLICATE_SENSE_ID', `duplicate source.senseId (${senseId})`);
      }
      seenSenseIds.add(senseId);
    }

    const llmRank = Number(source.llmRank);
    if (!Number.isFinite(llmRank)) {
      addError(errors, word, 'MISSING_LLM_RANK', `alt_meanings[${index}] missing source.llmRank`);
    } else {
      if (llmRank < previousRank) {
        addError(errors, word, 'RANK_ORDER_INVALID', 'alt_meanings must be sorted by source.llmRank ascending');
      }
      previousRank = llmRank;
    }
  });
}

function buildSpotCheckFlags(word, data) {
  const flags = [];
  const altMeanings = Array.isArray(data.alt_meanings) ? data.alt_meanings : [];
  const meta = data.alt_meanings_meta || {};
  const excluded = Array.isArray(data.alt_meanings_excluded) ? data.alt_meanings_excluded : [];

  const topTwo = altMeanings
    .map((meaning) => ({
      wordnetRank: Number(meaning?.source?.wordnetRank),
      llmRank: Number(meaning?.source?.llmRank),
    }))
    .filter((item) => Number.isFinite(item.wordnetRank) && Number.isFinite(item.llmRank) && item.llmRank <= 2);

  if (topTwo.some((item) => item.wordnetRank !== item.llmRank)) {
    flags.push({
      type: 'ORDER_MISMATCH',
      reason: 'LLM reranker changed WordNet top-2 order',
    });
  }

  const wordnetSenseCount = Number(meta.wordnetSenseCount || 0);
  const selectedCount = Number(meta.selectedSenseCount || altMeanings.length || 0);
  if (wordnetSenseCount >= 4 && selectedCount === 1) {
    flags.push({
      type: 'HEAVY_PRUNING',
      reason: `WordNet sense count ${wordnetSenseCount} but selected count is 1`,
    });
  }

  if (wordnetSenseCount >= 3 && altMeanings.length === 0) {
    flags.push({
      type: 'NO_ALT_MEANINGS',
      reason: `WordNet sense count ${wordnetSenseCount} but no alt_meanings produced`,
    });
  }

  if (excluded.length >= 3 && altMeanings.length <= 1) {
    flags.push({
      type: 'EXCLUSION_HEAVY',
      reason: `${excluded.length} excluded senses with <=1 selected meaning`,
    });
  }

  return flags;
}

const validationErrors = [];
const spotCheck = [];

Object.entries(enriched).forEach(([word, data]) => {
  validateCoreFields(word, data, validationErrors);
  validateAltMeanings(word, data, validationErrors);

  const flags = buildSpotCheckFlags(word, data);
  if (flags.length > 0) {
    spotCheck.push({
      word,
      flags,
    });
  }
});

let existingFailures = [];
if (fs.existsSync(failuresPath)) {
  try {
    existingFailures = JSON.parse(fs.readFileSync(failuresPath, 'utf-8'));
    if (!Array.isArray(existingFailures)) existingFailures = [];
  } catch {
    existingFailures = [];
  }
}

const nonValidateFailures = existingFailures.filter((item) => item?.source !== 'validate');
const mergedFailures = [...nonValidateFailures, ...validationErrors.map((item) => ({
  ...item,
  timestamp: new Date().toISOString(),
}))];

fs.writeFileSync(failuresPath, JSON.stringify(mergedFailures, null, 2));
fs.writeFileSync(spotCheckPath, JSON.stringify(spotCheck, null, 2));

if (validationErrors.length === 0) {
  console.log(`All ${Object.keys(enriched).length} words validated successfully`);
  console.log(`Spot-check file written: ${spotCheckPath} (${spotCheck.length} flagged words)`);
} else {
  console.error(`${validationErrors.length} validation errors:`);
  validationErrors.forEach((err) => {
    console.error(`[${err.code}] ${err.word}: ${err.error}`);
  });
  console.error(`Updated failures written to ${failuresPath}`);
  console.error(`Spot-check file written: ${spotCheckPath} (${spotCheck.length} flagged words)`);
  process.exit(1);
}
