const fs = require('fs');
const path = require('path');

const rawPath = path.join(__dirname, '../data/words.json');
const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
const failuresPath = path.join(__dirname, '../data/words_enrichment_failures.json');

const words = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
const MODEL = process.env.GEMINI_MODEL || 'gemma-4-31b-it';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';

const BATCH_SIZE = 10;
const DELAY_MS = 1000;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 45000;
const ALLOWED_POS = new Set(['noun', 'verb', 'adj', 'adv', 'prep', 'pron', 'det', 'conj', 'interj', 'article']);

function normalizePos(pos, fallbackPos = 'noun') {
  const normalized = String(pos || '').toLowerCase().trim();
  if (ALLOWED_POS.has(normalized)) return normalized;
  return String(fallbackPos || 'noun').toLowerCase();
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
          maxOutputTokens: 1500,
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

function generatePrompt(word, pos, tr) {
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

function extractJSONObject(text) {
  const noFence = text.replace(/```json|```/gi, '').trim();
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

  return callGemini(repairPrompt, `${word}:repair`, FALLBACK_MODEL);
}

async function enrichOne(wordItem, maxRetries = MAX_RETRIES) {
  const { word, pos, tr } = wordItem;
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const modelForAttempt = attempt < maxRetries - 1 ? MODEL : FALLBACK_MODEL;
      const raw = await callGemini(generatePrompt(word, pos, tr), word, modelForAttempt);
      const clean = extractJSONObject(raw);
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch (parseError) {
        const repairedRaw = await repairJSON(raw, word);
        const repairedClean = extractJSONObject(repairedRaw);
        try {
          parsed = JSON.parse(repairedClean);
        } catch {
          throw new Error(`Invalid JSON response for ${word}. Raw response: ${raw.slice(0, 500)}`);
        }
      }
      return { word, data: parsed };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const waitMs = 5000 * Math.pow(2, attempt);
        console.warn(`Attempt ${attempt + 1}/${maxRetries} failed for ${word}, retrying in ${waitMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw new Error(`Failed to enrich ${word} after ${maxRetries} attempts: ${lastError?.message || 'unknown error'}`);
}

async function enrichBatch(wordList) {
  const results = [];
  const failures = [];
  for (const item of wordList) {
    try {
      const result = await enrichOne(item);
      results.push(result);
      console.log(`  enriched: ${result.word}`);
    } catch (error) {
      failures.push({
        word: item.word,
        error: error.message,
      });
      console.error(`  failed: ${item.word} -> ${error.message}`);
    }
    // Small per-item delay to smooth request rate within each batch.
    await new Promise((resolve) => setTimeout(resolve, 300));
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
    const result = await enrichBatch(one);
    console.log(JSON.stringify(result[0], null, 2));
    return;
  }

  console.log(`Found ${workList.length} words to enrich (skipping ${Object.keys(enriched).length})`);

  for (let i = 0; i < workList.length; i += BATCH_SIZE) {
    const batch = workList.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(workList.length / BATCH_SIZE);
    console.log(`Processing batch ${batchNum}/${totalBatches}...`);

    try {
      const batchOutcome = await enrichBatch(batch);
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
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log(`Enrichment complete. Total enriched words: ${Object.keys(enriched).length}`);
}

main().catch((error) => {
  console.error('Unexpected error in enrich script:', error);
  process.exit(1);
});
