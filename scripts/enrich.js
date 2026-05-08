const fs = require('fs');
const path = require('path');
const WordPOS = require('wordpos');

const rawPath = path.join(__dirname, '../data/words.json');
const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
const failuresPath = path.join(__dirname, '../data/words_enrichment_failures.json');
const frequencyGatePath = path.join(__dirname, '../data/word_frequency_gate.json');

const words = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
const wordpos = new WordPOS();

const MODEL = process.env.GEMINI_MODEL || 'gemma-4-31b-it';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';

const BATCH_SIZE = 10;
const DELAY_MS = 1000;
const PER_ALT_MEANING_DELAY_MS = Number(process.env.PER_ALT_MEANING_DELAY_MS || 300);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 45000;
const COSINE_MERGE_THRESHOLD = Number(process.env.COSINE_MERGE_THRESHOLD || 0.85);

const ALLOWED_POS = new Set(['noun', 'verb', 'adj', 'adv', 'prep', 'pron', 'det', 'conj', 'interj', 'article']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePos(pos, fallbackPos = 'noun') {
  const normalized = String(pos || '').toLowerCase().trim();
  if (ALLOWED_POS.has(normalized)) return normalized;
  return String(fallbackPos || 'noun').toLowerCase();
}

function mapWordNetPos(pos) {
  const p = String(pos || '').toLowerCase();
  if (p === 'n' || p === 'noun') return 'noun';
  if (p === 'v' || p === 'verb') return 'verb';
  if (p === 'a' || p === 's' || p === 'adj') return 'adj';
  if (p === 'r' || p === 'adv') return 'adv';
  return 'noun';
}

function normalizeAltMeaning(rawMeaning, inheritedPos) {
  if (!rawMeaning || typeof rawMeaning !== 'object') return null;

  const tr = typeof rawMeaning.tr === 'string' ? rawMeaning.tr.trim() : '';
  const def = typeof rawMeaning.def === 'string' ? rawMeaning.def.trim() : '';
  const ex = Array.isArray(rawMeaning.ex)
    ? rawMeaning.ex.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!tr || !def || ex.length === 0) return null;

  const meaning = {
    tr,
    pos: normalizePos(rawMeaning.pos, inheritedPos),
    def,
    ex,
    unlockAfter: Number.isFinite(rawMeaning.unlockAfter) ? Number(rawMeaning.unlockAfter) : 14,
  };

  if (rawMeaning.source && typeof rawMeaning.source === 'object') {
    meaning.source = rawMeaning.source;
  }

  return meaning;
}

function normalizeEnrichedData(baseWordData, generatedData) {
  const merged = { ...baseWordData, ...generatedData };
  const normalizedPos = normalizePos(merged.pos, baseWordData?.pos || 'noun');
  merged.pos = normalizedPos;

  const candidateAltMeanings = Array.isArray(generatedData?.alt_meanings)
    ? generatedData.alt_meanings
    : [];

  if (candidateAltMeanings.length > 0) {
    merged.alt_meanings = candidateAltMeanings
      .map((meaning) => normalizeAltMeaning(meaning, normalizedPos))
      .filter(Boolean)
      .slice(0, 3);
  } else {
    delete merged.alt_meanings;
  }

  return merged;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function toTermFrequency(tokens) {
  const tf = new Map();
  tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
  return tf;
}

function cosineSimilarity(textA, textB) {
  const tfA = toTermFrequency(tokenize(textA));
  const tfB = toTermFrequency(tokenize(textB));

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const value of tfA.values()) magA += value * value;
  for (const value of tfB.values()) magB += value * value;

  for (const [term, valueA] of tfA.entries()) {
    const valueB = tfB.get(term) || 0;
    dot += valueA * valueB;
  }

  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function classifyErrorCode(message) {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('timeout')) return 'TIMEOUT';
  if (msg.includes('http 429')) return 'RATE_LIMIT';
  if (/http 5\d\d/.test(msg)) return 'UPSTREAM_5XX';
  if (msg.includes('invalid json')) return 'INVALID_JSON';
  if (msg.includes('wordnet')) return 'WORDNET_ERROR';
  return 'UNKNOWN';
}

function isRetryableError(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (msg.includes('timeout')) return true;
  if (msg.includes('http 429')) return true;
  return /http 5\d\d/.test(msg);
}

function loadFrequencyGate() {
  if (!fs.existsSync(frequencyGatePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(frequencyGatePath, 'utf-8'));
  } catch {
    console.warn('Frequency gate JSON is invalid; skipping frequency gate.');
    return null;
  }
}

function passesFrequencyGate(word, gateConfig) {
  if (!gateConfig || typeof gateConfig !== 'object') return true;

  const normalizedWord = String(word || '').toLowerCase();
  const blocked = new Set((gateConfig.blockedWords || []).map((w) => String(w).toLowerCase()));
  if (blocked.has(normalizedWord)) return false;

  const allowed = new Set((gateConfig.allowedWords || []).map((w) => String(w).toLowerCase()));
  if (allowed.size > 0 && !allowed.has(normalizedWord)) return false;

  const zipfByWord = gateConfig.zipfByWord || {};
  const minZipf = Number(gateConfig.minZipf || 0);
  if (minZipf > 0) {
    const score = Number(zipfByWord[normalizedWord] || 0);
    if (score < minZipf) return false;
  }

  return true;
}

async function getWordNetSenses(word) {
  try {
    const lookup = await wordpos.lookup(word);
    return lookup.map((sense, idx) => ({
      index: idx + 1,
      senseId: `${word}.${mapWordNetPos(sense.pos)}.${idx + 1}`,
      pos: mapWordNetPos(sense.pos),
      gloss: String(sense.def || '').trim(),
    })).filter((sense) => sense.gloss.length > 0);
  } catch (error) {
    throw new Error(`WordNet lookup failed for ${word}: ${error.message}`);
  }
}

function buildMergeCandidates(senses) {
  const candidates = [];
  for (let i = 0; i < senses.length; i++) {
    for (let j = i + 1; j < senses.length; j++) {
      const score = cosineSimilarity(senses[i].gloss, senses[j].gloss);
      if (score > COSINE_MERGE_THRESHOLD) {
        candidates.push({
          a: senses[i].index,
          b: senses[j].index,
          cosine: Number(score.toFixed(3)),
        });
      }
    }
  }
  return candidates;
}

async function callGemini(prompt, word, modelName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1600,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${word}: ${JSON.stringify(data)}`);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Empty Gemini response for ${word}: ${JSON.stringify(data)}`);
    }

    return text;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms (generateContent:${word})`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractJSONObject(text) {
  const noFence = String(text || '').replace(/```json|```/gi, '').trim();
  const firstBrace = noFence.indexOf('{');
  const lastBrace = noFence.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return noFence;
  }

  return noFence.slice(firstBrace, lastBrace + 1);
}

async function repairJSON(rawText, word) {
  const repairPrompt = `You must return ONLY one valid JSON object.
Fix/complete this malformed response for word "${word}".
Required schema:
{
  "def": "string",
  "ex": ["string", "string"],
  "ex_tr": ["string", "string"],
  "ex_distractors": [["string", "string", "string"], ["string", "string", "string"]],
  "sb_distractors": [["string", "string", "string"], ["string", "string", "string"]]
}

Malformed text:
${rawText}`;

  return callGemini(repairPrompt, `${word}:repair-primary`, FALLBACK_MODEL);
}

async function repairRerankerJSON(rawText, word, senses) {
  const senseIndexes = senses.map((sense) => sense.index).join(', ');
  const repairPrompt = `Return ONLY one valid JSON object.
Fix this malformed reranker output for word "${word}".
Allowed WordNet indexes: [${senseIndexes}].
Required schema:
{
  "selected": [{"wordnetIndex": 1, "rank": 1}],
  "merged": [{"kept": 1, "dropped": 2, "reason": "..."}],
  "excluded": [{"wordnetIndex": 3, "reason": "..."}]
}

Malformed text:
${rawText}`;

  return callGemini(repairPrompt, `${word}:repair-reranker`, FALLBACK_MODEL);
}

async function repairSecondaryJSON(rawText, word, senseId) {
  const repairPrompt = `Return ONLY one valid JSON object.
Fix malformed secondary-meaning JSON for word "${word}" and sense "${senseId}".
Required schema:
{
  "tr": "string",
  "pos": "noun|verb|adj|adv",
  "def": "string",
  "ex": ["string"]
}

Malformed text:
${rawText}`;

  return callGemini(repairPrompt, `${word}:repair-secondary:${senseId}`, FALLBACK_MODEL);
}

async function callGeminiWithRetries(prompt, word, repairFn) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const modelForAttempt = attempt < MAX_RETRIES - 1 ? MODEL : FALLBACK_MODEL;
      const raw = await callGemini(prompt, word, modelForAttempt);
      const clean = extractJSONObject(raw);
      try {
        return JSON.parse(clean);
      } catch {
        if (!repairFn) throw new Error(`Invalid JSON response for ${word}`);
        const repairedRaw = await repairFn(raw);
        const repairedClean = extractJSONObject(repairedRaw);
        return JSON.parse(repairedClean);
      }
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1 && isRetryableError(error)) {
        const waitMs = 5000 * Math.pow(2, attempt);
        console.warn(`Attempt ${attempt + 1}/${MAX_RETRIES} failed for ${word}, retrying in ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      break;
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts (${word}): ${lastError?.message || 'unknown error'}`);
}

function generatePrimaryPrompt(word, pos, tr) {
  return `You are a language data generator. For the English word "${word}" (${pos}, meaning "${tr}" in Turkish):
Return ONLY a JSON object with no markdown:
{
  "def": "one short English definition, A1-friendly",
  "ex": ["sentence 1", "sentence 2"],
  "ex_tr": ["turkish translation 1", "turkish translation 2"],
  "ex_distractors": [["alt eng 1", "alt eng 2", "alt eng 3"], ["alt eng 1", "alt eng 2", "alt eng 3"]],
  "sb_distractors": [["alt word 1", "alt word 2", "alt word 3"], ["alt word 1", "alt word 2", "alt word 3"]]
}
Rules:
- def, ex, ex_tr as before
- ex_distractors[i]: 3 plausible but incorrect translations of ex[i] (differ in grammar, pronoun, tense)
- sb_distractors[i]: 3 English word alternatives that fit sentence structure (same pos as target word)
- All alternatives must be A1-level vocabulary, contextually relevant
- Return ONLY one valid JSON object and nothing else`;
}

function generateRerankerPrompt(word, senses, mergeCandidates) {
  const sensesText = senses
    .map((sense) => `${sense.index}. (${sense.pos}) ${sense.gloss}`)
    .join('\n');

  const mergeText = mergeCandidates.length > 0
    ? mergeCandidates.map((pair) => `(${pair.a}, ${pair.b}, cosine=${pair.cosine})`).join(', ')
    : 'none';

  return `WordNet senses (in WordNet order):\n${sensesText}\n\nMerge candidates (cosine > ${COSINE_MERGE_THRESHOLD}): ${mergeText}\nWord: ${word}\nTarget audience: Turkish learners (A2-B1)\n\nStep 1: For each merge candidate pair, decide if they are the same sense.\nIf yes, keep the clearer gloss and note merged index.\nStep 2: From remaining senses, select those common in everyday spoken English.\nRank by casual conversation and general media frequency.\nStep 3: For each excluded or merged sense, write one short reason.\n\nReturn JSON only:\n{\n  "selected": [{"wordnetIndex": 1, "rank": 1}],\n  "merged": [{"kept": 1, "dropped": 4, "reason": "..."}],\n  "excluded": [{"wordnetIndex": 3, "reason": "..."}]\n}`;
}

function generateSecondaryMeaningPrompt(word, sense, primaryTr, primaryPos) {
  return `Generate learner-facing content for a secondary meaning.
Word: ${word}
Primary meaning (already known): ${primaryTr} [${primaryPos}]
Secondary sense gloss: ${sense.gloss} [${sense.pos}]
Sense id: ${sense.senseId}

Return JSON only:
{
  "tr": "Turkish translation for this sense only",
  "pos": "${sense.pos}",
  "def": "short, learner-friendly English definition",
  "ex": ["one natural sentence using this sense"]
}
Rules:
- Do not repeat primary meaning translation.
- Keep it common spoken usage.
- Keep sentence simple and natural.
- Return only JSON.`;
}

function normalizeRerankerResponse(raw, senses) {
  const maxIndex = senses.length;
  const selected = Array.isArray(raw?.selected)
    ? raw.selected
        .map((item) => ({
          wordnetIndex: Number(item.wordnetIndex),
          rank: Number(item.rank),
        }))
        .filter((item) => Number.isFinite(item.wordnetIndex) && item.wordnetIndex >= 1 && item.wordnetIndex <= maxIndex)
        .sort((a, b) => (a.rank || 999) - (b.rank || 999))
    : [];

  const merged = Array.isArray(raw?.merged)
    ? raw.merged.map((item) => ({
        kept: Number(item.kept),
        dropped: Number(item.dropped),
        reason: String(item.reason || ''),
      }))
    : [];

  const excluded = Array.isArray(raw?.excluded)
    ? raw.excluded.map((item) => ({
        wordnetIndex: Number(item.wordnetIndex),
        reason: String(item.reason || ''),
      }))
    : [];

  return { selected, merged, excluded };
}

function toSelectedSenses(senses, rerankerResponse, maxCount = 3) {
  const droppedIndexes = new Set(rerankerResponse.merged.map((item) => item.dropped));
  const deduped = rerankerResponse.selected
    .filter((item) => !droppedIndexes.has(item.wordnetIndex))
    .map((item) => senses[item.wordnetIndex - 1])
    .filter(Boolean);

  const uniqueBySenseId = [];
  const seen = new Set();
  for (const sense of deduped) {
    if (seen.has(sense.senseId)) continue;
    seen.add(sense.senseId);
    uniqueBySenseId.push(sense);
  }

  return uniqueBySenseId.slice(0, maxCount);
}

async function enrichOne(wordItem, frequencyGateConfig) {
  const { word, pos, tr } = wordItem;

  const primaryData = await callGeminiWithRetries(
    generatePrimaryPrompt(word, pos, tr),
    `${word}:primary`,
    (raw) => repairJSON(raw, word)
  );

  if (!passesFrequencyGate(word, frequencyGateConfig)) {
    return { word, data: primaryData };
  }

  const senses = await getWordNetSenses(word);
  if (senses.length < 2) {
    return { word, data: primaryData };
  }

  const mergeCandidates = buildMergeCandidates(senses);
  const rerankerRaw = await callGeminiWithRetries(
    generateRerankerPrompt(word, senses, mergeCandidates),
    `${word}:reranker`,
    (raw) => repairRerankerJSON(raw, word, senses)
  );

  const rerankerResponse = normalizeRerankerResponse(rerankerRaw, senses);
  const selectedSenses = toSelectedSenses(senses, rerankerResponse, 3);

  const alt_meanings = [];
  for (let i = 0; i < selectedSenses.length; i++) {
    const sense = selectedSenses[i];
    const secondaryRaw = await callGeminiWithRetries(
      generateSecondaryMeaningPrompt(word, sense, tr, pos),
      `${word}:secondary:${sense.senseId}`,
      (raw) => repairSecondaryJSON(raw, word, sense.senseId)
    );

    const normalizedSecondary = normalizeAltMeaning(
      {
        ...secondaryRaw,
        pos: sense.pos,
        unlockAfter: 14,
        source: {
          lexicon: 'wordnet',
          senseId: sense.senseId,
          wordnetRank: sense.index,
          llmRank: i + 1,
          orderChanged: sense.index !== i + 1,
          selectionReason: 'top_k_spoken',
        },
      },
      pos
    );

    if (normalizedSecondary) {
      alt_meanings.push(normalizedSecondary);
    }

    if (i < selectedSenses.length - 1) {
      await sleep(PER_ALT_MEANING_DELAY_MS);
    }
  }

  primaryData.alt_meanings_excluded = rerankerResponse.excluded;
  primaryData.alt_meanings_merged = rerankerResponse.merged;
  primaryData.alt_meanings_meta = {
    wordnetSenseCount: senses.length,
    selectedSenseCount: selectedSenses.length,
    mergeCandidateCount: mergeCandidates.length,
  };

  if (alt_meanings.length > 0) {
    primaryData.alt_meanings = alt_meanings.slice(0, 3);
  }

  return { word, data: primaryData };
}

async function enrichBatch(wordList, frequencyGateConfig) {
  const results = [];
  const failures = [];

  for (const item of wordList) {
    try {
      const result = await enrichOne(item, frequencyGateConfig);
      results.push(result);
      console.log(`  enriched: ${result.word}`);
    } catch (error) {
      failures.push({
        word: item.word,
        code: classifyErrorCode(error.message),
        error: error.message,
      });
      console.error(`  failed: ${item.word} -> ${error.message}`);
    }

    await sleep(300);
  }

  return { results, failures };
}

async function main() {
  console.log(`Loaded ${Object.keys(words).length} words`);

  if (!process.env.GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY is missing. Exiting without enrichment.');
    return;
  }

  console.log(`Using model: ${MODEL} (fallback: ${FALLBACK_MODEL})`);

  const frequencyGateConfig = loadFrequencyGate();
  if (frequencyGateConfig) {
    console.log('Frequency gate loaded from data/word_frequency_gate.json');
  } else {
    console.log('No frequency gate JSON found; frequency gate is permissive.');
  }

  let enriched = {};
  let failures = [];
  if (fs.existsSync(enrichedPath)) {
    enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
  }
  if (fs.existsSync(failuresPath)) {
    failures = JSON.parse(fs.readFileSync(failuresPath, 'utf-8'));
  }

  const toEnrich = Object.keys(words)
    .filter((word) => !enriched[word])
    .map((word) => ({ word, ...words[word] }));

  const maxWords = Number(process.env.MAX_WORDS || 0);
  const workList = maxWords > 0 ? toEnrich.slice(0, maxWords) : toEnrich;

  if (process.env.TEST_ONE === '1' && workList.length > 0) {
    const one = [workList[0]];
    const outcome = await enrichBatch(one, frequencyGateConfig);
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  console.log(`Found ${workList.length} words to enrich (skipping ${Object.keys(enriched).length})`);

  for (let i = 0; i < workList.length; i += BATCH_SIZE) {
    const batch = workList.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(workList.length / BATCH_SIZE);
    console.log(`Processing batch ${batchNum}/${totalBatches}...`);

    try {
      const batchOutcome = await enrichBatch(batch, frequencyGateConfig);
      batchOutcome.results.forEach(({ word, data }) => {
        enriched[word] = normalizeEnrichedData(words[word], data);
      });
      failures = [
        ...failures,
        ...batchOutcome.failures.map((failure) => ({
          ...failure,
          batch: batchNum,
          timestamp: new Date().toISOString(),
        })),
      ];
      fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));
      fs.writeFileSync(failuresPath, JSON.stringify(failures, null, 2));
      console.log(`Batch ${batchNum} completed (${batchOutcome.results.length} succeeded, ${batchOutcome.failures.length} failed)`);
    } catch (error) {
      console.error(`Batch ${batchNum} failed: ${error.message}`);
      console.error('Stopping enrichment. Fix the issue and rerun; resume support will skip completed words.');
      process.exit(1);
    }

    if (i + BATCH_SIZE < workList.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`Enrichment complete. Total enriched words: ${Object.keys(enriched).length}`);
}

main().catch((error) => {
  console.error('Unexpected error in enrich script:', error);
  process.exit(1);
});
