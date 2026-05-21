const fs = require('fs');
const path = require('path');

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

const wordsPath = path.join(__dirname, '../data/words.json');
const missingPath = path.join(__dirname, './pdf_missing_words.txt');

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const BATCH_SIZE = Number(process.env.ADD_BATCH_SIZE || 50);
const REQUEST_TIMEOUT_MS = Number(process.env.ADD_REQUEST_TIMEOUT_MS || 60000);
const DELAY_MS = Number(process.env.ADD_DELAY_MS || 800);
const MAX_RETRIES = Number(process.env.ADD_MAX_RETRIES || 3);

const ALLOWED_POS = new Set(['noun', 'verb', 'adj', 'adv', 'prep', 'pron', 'det', 'conj', 'interj']);
const ALLOWED_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1']);

function parseOpenRouterKeys() {
  const rawKeys = [];
  if (typeof process.env.OPENROUTER_API_KEYS === 'string' && process.env.OPENROUTER_API_KEYS.trim()) {
    rawKeys.push(...process.env.OPENROUTER_API_KEYS.split(/[,;\n]/g));
  }
  if (typeof process.env.OPENROUTER_API_KEY === 'string' && process.env.OPENROUTER_API_KEY.trim()) {
    rawKeys.push(process.env.OPENROUTER_API_KEY);
  }
  return [...new Set(rawKeys.map((k) => String(k).trim()).filter(Boolean))];
}

function parseGeminiKeys() {
  const rawKeys = [];
  if (typeof process.env.GEMINI_API_KEYS === 'string' && process.env.GEMINI_API_KEYS.trim()) {
    rawKeys.push(...process.env.GEMINI_API_KEYS.split(/[,;\n]/g));
  }
  if (typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.trim()) {
    rawKeys.push(process.env.GEMINI_API_KEY);
  }
  return [...new Set(rawKeys.map((k) => String(k).trim()).filter(Boolean))];
}

const OPENROUTER_KEYS = parseOpenRouterKeys();
const GEMINI_KEYS = parseGeminiKeys();
let keyIndex = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePos(pos) {
  const p = String(pos || '').toLowerCase().trim();
  if (ALLOWED_POS.has(p)) return p;
  if (p === 'adjective') return 'adj';
  if (p === 'adverb') return 'adv';
  return 'noun';
}

function normalizeLevel(level) {
  const lv = String(level || '').toUpperCase().trim();
  if (ALLOWED_LEVELS.has(lv)) return lv;
  return 'B1';
}

function sanitizeWord(word) {
  return String(word || '').trim();
}

function buildPrompt(words) {
  const wordLines = words.map((w, i) => `${i + 1}. ${w}`).join('\n');
  return `You are preparing English vocabulary metadata for a Turkish learner app.

For each item below, return exactly one object with:
- word: exact original input string
- pos: one of noun|verb|adj|adv|prep|pron|det|conj|interj
- tr: concise Turkish translation for the most common meaning
- level: one of A1|A2|B1|B2|C1

Words:
${wordLines}

Return ONLY JSON array in the same order as input:
[{"word":"...","pos":"noun","tr":"...","level":"B1"}]`;
}

async function callOpenRouter(prompt, apiKey) {
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
        max_tokens: 2400,
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`OpenRouter HTTP ${response.status}: ${JSON.stringify(data?.error || data)}`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenRouter empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}: ${JSON.stringify(data?.error || data)}`);
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseArray(text) {
  const clean = String(text || '').replace(/```json|```/gi, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start !== -1 && end > start) {
      const sliced = clean.slice(start, end + 1);
      const parsed = JSON.parse(sliced);
      return Array.isArray(parsed) ? parsed : null;
    }
    return null;
  }
}

function heuristicFallback(word) {
  return {
    word,
    pos: 'noun',
    tr: word,
    level: 'B1',
  };
}

function normalizeItem(raw, fallbackWord) {
  const word = sanitizeWord(raw?.word || fallbackWord);
  const tr = String(raw?.tr || word).trim() || word;
  return {
    word,
    pos: normalizePos(raw?.pos),
    tr,
    level: normalizeLevel(raw?.level),
  };
}

async function getBatchMetadata(batch) {
  if (process.env.ADD_USE_FALLBACK_ONLY === '1') {
    return batch.map((w) => heuristicFallback(w));
  }

  const prompt = buildPrompt(batch);
  const providers = [];

  if (OPENROUTER_KEYS.length > 0) {
    providers.push(...OPENROUTER_KEYS.map((k) => ({ type: 'openrouter', key: k })));
  }
  if (GEMINI_KEYS.length > 0) {
    providers.push(...GEMINI_KEYS.map((k) => ({ type: 'gemini', key: k })));
  }

  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    for (let i = 0; i < providers.length; i++) {
      const idx = (keyIndex + i) % providers.length;
      const provider = providers[idx];
      try {
        const raw = provider.type === 'openrouter'
          ? await callOpenRouter(prompt, provider.key)
          : await callGemini(prompt, provider.key);
        const arr = parseArray(raw);
        if (!arr || arr.length === 0) {
          throw new Error('Could not parse metadata array');
        }
        keyIndex = idx + 1;
        return arr;
      } catch (err) {
        lastError = err;
      }
    }
    await sleep(1200 * (attempt + 1));
  }

  throw lastError || new Error('No provider configured');
}

async function main() {
  if (!fs.existsSync(wordsPath)) {
    throw new Error('Missing data/words.json');
  }
  if (!fs.existsSync(missingPath)) {
    throw new Error('Missing scripts/pdf_missing_words.txt');
  }

  const wordsJson = JSON.parse(fs.readFileSync(wordsPath, 'utf-8'));
  const existingLower = new Set(Object.keys(wordsJson).map((w) => w.toLowerCase()));

  const missingRaw = fs.readFileSync(missingPath, 'utf-8')
    .split(/\r?\n/g)
    .map((w) => sanitizeWord(w))
    .filter(Boolean);

  const missing = missingRaw.filter((w) => !existingLower.has(w.toLowerCase()));
  if (missing.length === 0) {
    console.log('No new missing words to add.');
    return;
  }

  console.log(`Adding ${missing.length} words from PDF diff...`);

  let added = 0;
  let fallbackUsed = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(missing.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} words)`);

    let metadata = [];
    try {
      metadata = await getBatchMetadata(batch);
    } catch (err) {
      console.warn(`  Metadata batch failed, using fallback. Reason: ${err.message}`);
      metadata = batch.map((w) => heuristicFallback(w));
      fallbackUsed += batch.length;
    }

    for (let j = 0; j < batch.length; j++) {
      const originalWord = batch[j];
      const rawItem = metadata[j] || heuristicFallback(originalWord);
      if (!metadata[j]) fallbackUsed += 1;
      const item = normalizeItem(rawItem, originalWord);

      const key = originalWord;
      if (existingLower.has(key.toLowerCase())) continue;
      wordsJson[key] = {
        level: item.level,
        pos: item.pos,
        tr: item.tr,
      };
      existingLower.add(key.toLowerCase());
      added += 1;
    }

    await sleep(DELAY_MS);
  }

  const sorted = {};
  Object.keys(wordsJson).sort((a, b) => a.localeCompare(b)).forEach((k) => {
    sorted[k] = wordsJson[k];
  });

  fs.writeFileSync(wordsPath, JSON.stringify(sorted, null, 2));
  console.log(`Added: ${added}`);
  console.log(`Fallback used: ${fallbackUsed}`);
  console.log(`New total words: ${Object.keys(sorted).length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});