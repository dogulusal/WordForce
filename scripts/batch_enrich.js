/**
 * batch_enrich.js — Enriches multiple words per single API request to conserve quota.
 * Each request handles WORDS_PER_REQUEST words, returning a JSON array.
 *
 * Usage:
 *   $env:TARGET_WORDS = "word1,word2,..."  (optional — otherwise processes all missing)
 *   node scripts/batch_enrich.js
 */

const fs = require('fs');
const path = require('path');

const rawPath = path.join(__dirname, '../data/words.json');
const enrichedPath = path.join(__dirname, '../data/words_enriched.json');

// Load .env manually
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS || 1200);
const WORDS_PER_REQUEST = Number(process.env.WORDS_PER_REQUEST || 5);
const DELAY_MS = Number(process.env.DELAY_MS || 500);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseApiKeys() {
  const rawKeys = [];
  if (process.env.GEMINI_API_KEYS) rawKeys.push(...process.env.GEMINI_API_KEYS.split(/[,;\n]/g));
  if (process.env.GEMINI_API_KEY) rawKeys.push(process.env.GEMINI_API_KEY);
  return [...new Set(rawKeys.map(k => k.trim()).filter(Boolean))];
}

function parseOpenRouterKeys() {
  const rawKeys = [];
  if (process.env.OPENROUTER_API_KEYS) rawKeys.push(...process.env.OPENROUTER_API_KEYS.split(/[,;\n]/g));
  if (process.env.OPENROUTER_API_KEY) rawKeys.push(process.env.OPENROUTER_API_KEY);
  return [...new Set(rawKeys.map(k => k.trim()).filter(Boolean))];
}

const API_KEYS = parseApiKeys();
const OPENROUTER_KEYS = parseOpenRouterKeys();
let keyIndex = 0;

function getNextKey() {
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  return key;
}

async function callGemini(prompt) {
  const apiKey = getNextKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(data?.error?.message || data)}`);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Empty response: ${JSON.stringify(data)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(prompt) {
  if (OPENROUTER_KEYS.length === 0) {
    throw new Error('No OpenRouter keys configured');
  }

  const apiKey = OPENROUTER_KEYS[keyIndex % OPENROUTER_KEYS.length];
  keyIndex++;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wordforce.local',
        'X-Title': 'WordForce',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: OPENROUTER_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`OpenRouter HTTP ${response.status}: ${JSON.stringify(data?.error || data)}`);
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Empty OpenRouter response: ${JSON.stringify(data)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(prompt) {
  const errors = [];
  if (API_KEYS.length > 0) {
    try {
      return await callGemini(prompt);
    } catch (err) {
      errors.push(`Gemini: ${err.message}`);
    }
  }

  if (OPENROUTER_KEYS.length > 0) {
    try {
      return await callOpenRouter(prompt);
    } catch (err) {
      errors.push(`OpenRouter: ${err.message}`);
    }
  }

  throw new Error(errors.join(' | ') || 'No LLM provider configured');
}

function buildBatchPrompt(wordItems) {
  const wordList = wordItems.map(({ word, pos, tr }) =>
    `- "${word}" (${pos}, Turkish: "${tr}")`
  ).join('\n');

  return `You are a language data generator for an English vocabulary learning app.
For each word below, generate learning data for Turkish learners (A1-B1 level).

Words:
${wordList}

Return a JSON array with exactly ${wordItems.length} objects in the same order:
[
  {
    "word": "exact word as given",
    "def": "one short English definition",
    "ex": ["sentence using the word 1", "sentence using the word 2"],
    "ex_tr": ["Turkish translation of ex[0]", "Turkish translation of ex[1]"],
    "ex_distractors": [
      ["wrong Turkish 1", "wrong Turkish 2", "wrong Turkish 3"],
      ["wrong Turkish 1", "wrong Turkish 2", "wrong Turkish 3"]
    ],
    "sb_distractors": [
      ["alt English word 1", "alt English word 2", "alt English word 3"],
      ["alt English word 1", "alt English word 2", "alt English word 3"]
    ]
  }
]

Rules:
- Each "ex" sentence MUST contain the target word
- "ex_tr": Turkish translation of the full example sentence
- "ex_distractors[i]": 3 plausible but WRONG Turkish translations of ex[i] (differ in meaning, grammar, or tense)
- "sb_distractors[i]": 3 English words that fit ex[i]'s sentence structure but change the meaning (same POS as target word)
- All vocabulary in distractors should be simple (A1-B1 level)
- Return ONLY valid JSON array, no markdown, no extra text`;
}

function validateResult(item, wordData) {
  const { def, ex, ex_tr, ex_distractors, sb_distractors } = item;
  if (!def || typeof def !== 'string') return 'missing def';
  if (!Array.isArray(ex) || ex.length < 2) return 'ex must have 2+ sentences';
  if (!Array.isArray(ex_tr) || ex_tr.length !== ex.length) return 'ex_tr length mismatch';
  if (!Array.isArray(ex_distractors) || ex_distractors.length !== ex.length) return 'ex_distractors length mismatch';
  if (!Array.isArray(sb_distractors) || sb_distractors.length !== ex.length) return 'sb_distractors length mismatch';

  const word = wordData.word.toLowerCase();
  for (const sentence of ex) {
    if (!sentence.toLowerCase().includes(word)) return `ex sentence missing word "${word}"`;
  }

  for (const row of ex_distractors) {
    if (!Array.isArray(row) || row.length !== 3) return 'ex_distractors row must have 3 items';
  }
  for (const row of sb_distractors) {
    if (!Array.isArray(row) || row.length !== 3) return 'sb_distractors row must have 3 items';
  }

  return null; // valid
}

function ensureRowOfThree(row, fallbackValues) {
  const items = Array.isArray(row) ? row.filter((v) => typeof v === 'string' && v.trim()) : [];
  while (items.length < 3) {
    items.push(fallbackValues[items.length % fallbackValues.length]);
  }
  return items.slice(0, 3);
}

function normalizeResult(item, wordData) {
  const normalized = { ...item };
  const ex = Array.isArray(item.ex) ? item.ex.filter((s) => typeof s === 'string' && s.trim()) : [];
  normalized.ex = ex;

  const len = ex.length;
  const trFallback = `Bu cumlede "${wordData.word}" farkli bir baglamda kullaniliyor.`;
  const exTr = Array.isArray(item.ex_tr) ? item.ex_tr.filter((s) => typeof s === 'string' && s.trim()) : [];
  while (exTr.length < len) exTr.push(trFallback);
  normalized.ex_tr = exTr.slice(0, len);

  const exDistractors = Array.isArray(item.ex_distractors) ? item.ex_distractors : [];
  normalized.ex_distractors = [];
  for (let i = 0; i < len; i++) {
    normalized.ex_distractors.push(
      ensureRowOfThree(exDistractors[i], ['Anlam farklidir.', 'Cumle yapisi farklidir.', 'Dogru ceviri degildir.'])
    );
  }

  const sbDistractors = Array.isArray(item.sb_distractors) ? item.sb_distractors : [];
  normalized.sb_distractors = [];
  for (let i = 0; i < len; i++) {
    normalized.sb_distractors.push(
      ensureRowOfThree(sbDistractors[i], ['thing', 'person', 'item'])
    );
  }

  return normalized;
}

async function enrichBatch(wordItems) {
  const prompt = buildBatchPrompt(wordItems);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const raw = await callLLM(prompt);

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Try extracting array
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('No JSON array found in response');
        parsed = JSON.parse(match[0]);
      }

      if (!Array.isArray(parsed)) throw new Error('Response is not an array');
      if (parsed.length !== wordItems.length) throw new Error(`Expected ${wordItems.length} items, got ${parsed.length}`);

      return parsed;
    } catch (err) {
      const msg = String(err.message || '');
      const isRetryable = msg.includes('429') || msg.includes('timeout') || msg.includes('500') || msg.includes('503');
      if (attempt < MAX_RETRIES - 1 && isRetryable) {
        const wait = 5000 * (attempt + 1);
        console.warn(`  Attempt ${attempt + 1} failed (${msg.slice(0, 60)}), retrying in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const allWords = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  const enriched = fs.existsSync(enrichedPath)
    ? JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'))
    : {};

  // Determine target words
  let targetWords;
  if (process.env.TARGET_WORDS) {
    targetWords = process.env.TARGET_WORDS.split(',').map(w => w.trim()).filter(Boolean);
  } else {
    // Auto-detect: in raw but not enriched, OR mismatch
    targetWords = Object.keys(allWords).filter(w => {
      if (!enriched[w]) return true;
      const d = enriched[w];
      if (!d.ex || !Array.isArray(d.ex)) return true;
      const len = d.ex.length;
      return !d.ex_tr || d.ex_tr.length !== len ||
             !d.ex_distractors || d.ex_distractors.length !== len ||
             !d.sb_distractors || d.sb_distractors.length !== len;
    });
  }

  // Filter to only words that exist in allWords
  targetWords = targetWords.filter(w => allWords[w]);

  console.log(`Batch enriching ${targetWords.length} words (${WORDS_PER_REQUEST} per request)...`);
  console.log(`Gemini model: ${MODEL} | Gemini keys: ${API_KEYS.length} | OpenRouter model: ${OPENROUTER_MODEL} | OpenRouter keys: ${OPENROUTER_KEYS.length}`);

  const wordItems = targetWords.map(w => ({
    word: w,
    pos: allWords[w].pos || 'noun',
    tr: allWords[w].tr || '',
  }));

  let totalSucceeded = 0;
  let totalFailed = 0;
  const failures = [];

  // Process in batches
  for (let i = 0; i < wordItems.length; i += WORDS_PER_REQUEST) {
    const batchItems = wordItems.slice(i, i + WORDS_PER_REQUEST);
    const batchNum = Math.floor(i / WORDS_PER_REQUEST) + 1;
    const totalBatches = Math.ceil(wordItems.length / WORDS_PER_REQUEST);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batchItems.map(x => x.word).join(', ')})... `);

    try {
      const results = await enrichBatch(batchItems);

      let batchSucceeded = 0;
      for (let j = 0; j < results.length; j++) {
        const result = normalizeResult(results[j], batchItems[j]);
        const wordData = batchItems[j];
        const error = validateResult(result, wordData);

        if (error) {
          console.error(`\n    INVALID ${wordData.word}: ${error}`);
          failures.push({ word: wordData.word, error });
          totalFailed++;
          continue;
        }

        // Merge into enriched data
        const existing = enriched[wordData.word] || {};
        enriched[wordData.word] = {
          ...existing,
          ...allWords[wordData.word],
          def: result.def,
          ex: result.ex,
          ex_tr: result.ex_tr,
          ex_distractors: result.ex_distractors,
          sb_distractors: result.sb_distractors,
        };
        batchSucceeded++;
        totalSucceeded++;
      }

      console.log(`${batchSucceeded}/${batchItems.length} ok`);

      // Save after every batch
      fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
      for (const item of batchItems) {
        failures.push({ word: item.word, error: err.message });
        totalFailed++;
      }
    }

    if (i + WORDS_PER_REQUEST < wordItems.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone. Succeeded: ${totalSucceeded} | Failed: ${totalFailed}`);
  console.log(`Total enriched words: ${Object.keys(enriched).length}`);

  if (failures.length > 0) {
    console.log(`\nFailed words: ${failures.map(f => f.word).join(', ')}`);
  }
}

main().catch(console.error);
