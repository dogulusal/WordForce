/**
 * generate_words.js
 *
 * Generates new common English words (with CEFR level, POS, Turkish translation)
 * for each level, deduplicates against existing words.json, and adds them.
 *
 * Usage:
 *   node scripts/generate_words.js
 *
 * Env vars (optional):
 *   TARGET_LEVEL=A2  — only generate for this level
 *   BATCH_COUNT=5    — number of Gemini calls per level (each returns ~30 words)
 *   GEMINI_API_KEY   — (or read from .env)
 */

const fs = require('fs');
const path = require('path');

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

const wordsPath = path.join(__dirname, '../data/words.json');
const words = JSON.parse(fs.readFileSync(wordsPath, 'utf-8'));
const existingKeys = new Set(Object.keys(words).map((w) => w.toLowerCase()));

const API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-preview-05-20';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS || 1800);

const TARGET_LEVEL = process.env.TARGET_LEVEL || null;
const WORDS_PER_BATCH = 15;  // max words per Gemini call (smaller = less truncation)
const MAX_BATCHES = Number(process.env.MAX_BATCHES || 0);  // 0 = no limit
const REQUEST_TIMEOUT_MS = 30000;

// How many new words we need per level (to reach 3000 total from 1456)
// Current: A1=842, A2=214, B1=150, B2=150, C1=100
// Target distribution for 3000 total:
const LEVEL_TARGETS = {
  A2: 600,
  B1: 700,
  B2: 600,
  C1: 300,
};

const ALLOWED_POS = new Set(['noun', 'verb', 'adj', 'adv', 'prep', 'pron', 'det', 'conj', 'interj']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOpenRouterKeys() {
  const rawKeys = [];
  if (typeof process.env.OPENROUTER_API_KEYS === 'string' && process.env.OPENROUTER_API_KEYS.trim()) {
    rawKeys.push(...process.env.OPENROUTER_API_KEYS.split(/[,;\n]/g));
  }
  if (typeof OPENROUTER_API_KEY === 'string' && OPENROUTER_API_KEY.trim()) {
    rawKeys.push(OPENROUTER_API_KEY);
  }
  return [...new Set(rawKeys.map((k) => String(k).trim()).filter(Boolean))];
}

const OPENROUTER_KEYS = parseOpenRouterKeys();

async function callGemini(prompt, modelName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(prompt, modelName, apiKey) {
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
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: OPENROUTER_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${JSON.stringify(data)}`);

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from OpenRouter');
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(prompt, modelName) {
  const errors = [];

  if (API_KEY) {
    try {
      return await callGemini(prompt, modelName);
    } catch (err) {
      errors.push(`Gemini: ${err.message}`);
    }
  }

  for (const key of OPENROUTER_KEYS) {
    try {
      return await callOpenRouter(prompt, OPENROUTER_MODEL, key);
    } catch (err) {
      errors.push(`OpenRouter: ${err.message}`);
    }
  }

  throw new Error(errors.join(' | ') || 'No LLM provider configured');
}

function extractJSON(text) {
  // Strip markdown fences
  const noFence = String(text || '').replace(/```json|```/gi, '').trim();
  // Try to find a JSON array [...]
  const firstArr = noFence.indexOf('[');
  const lastArr = noFence.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) {
    return noFence.slice(firstArr, lastArr + 1);
  }
  // Fallback: try to find JSON object {"words": [...]}
  const firstObj = noFence.indexOf('{');
  const lastObj = noFence.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) {
    return noFence.slice(firstObj, lastObj + 1);
  }
  return noFence;
}

function buildPrompt(level, alreadyAdded, batchIndex) {
  const alreadyHave = Object.keys(words).filter(
    (w) => (words[w].level || '').toUpperCase() === level.toUpperCase()
  );

  // Pass ALL existing words at this level to maximize avoidance
  const existingAtLevel = alreadyHave.map((w) => w.toLowerCase()).join(', ');
  const existingNew = alreadyAdded.slice(-30).join(', ');

  // Rotate POS focus to get variety across batches
  const posOptions = ['nouns', 'verbs', 'adjectives', 'adverbs, prepositions, conjunctions', 'mixed (all parts of speech)'];
  const posFocus = posOptions[batchIndex % posOptions.length];

  const lowerLevels = { A2: 'A1', B1: 'A1 or A2', B2: 'A1, A2, or B1', C1: 'A1, A2, B1, or B2' };
  const simpler = lowerLevels[level] || 'simpler';

  return `You are a CEFR vocabulary expert. Generate exactly ${WORDS_PER_BATCH} English words SPECIFICALLY at ${level} CEFR level.

CRITICAL: Do NOT generate words from the list below (they already exist in the database):
EXISTING ${level} WORDS (avoid all of these): ${existingAtLevel}
RECENTLY ADDED (also avoid): ${existingNew}

Rules:
- Words must be genuinely ${level} difficulty — NOT ${simpler} words
- Focus this batch on: ${posFocus}
- Include accurate Turkish translation for each word
- Choose practical, high-frequency vocabulary for ${level} learners

Return ONLY a valid JSON array, no markdown:
[{"word":"...","pos":"noun","tr":"Türkçe"},{"word":"...","pos":"verb","tr":"Türkçe"}]

Return exactly ${WORDS_PER_BATCH} words not already in the EXISTING list above.`;
}

async function generateForLevel(level, targetCount) {
  console.log(`\nGenerating words for level ${level} (target: ${targetCount} total)...`);

  const currentCount = Object.keys(words).filter(
    (w) => (words[w].level || '').toUpperCase() === level.toUpperCase()
  ).length;

  const needed = Math.max(0, targetCount - currentCount);
  if (needed <= 0) {
    console.log(`  Level ${level} already has ${currentCount} words (target: ${targetCount}). Skipping.`);
    return [];
  }

  const batchCount = Math.ceil((needed / WORDS_PER_BATCH) * 2);  // 2x buffer for deduplication
  const actualBatchCount = MAX_BATCHES > 0 ? Math.min(batchCount, MAX_BATCHES) : batchCount;
  console.log(`  Current ${level} words: ${currentCount}, need ${needed} more (~${actualBatchCount} batches)`);

  const newWords = [];

  for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
    if (newWords.length >= needed) break;
    if (MAX_BATCHES > 0 && batchIdx >= MAX_BATCHES) break;

    console.log(`  Batch ${batchIdx + 1}/${batchCount} (${newWords.length}/${needed} done)...`);

    let batchSucceeded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const modelName = attempt < 2 ? MODEL : FALLBACK_MODEL;
      try {
        const prompt = buildPrompt(level, newWords.map((w) => w.word), batchIdx);
        const raw = await callLLM(prompt, modelName);
        const clean = extractJSON(raw);
        const parsed = JSON.parse(clean);
        // Accept both array format and {"words": [...]} format
        const wordList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.words) ? parsed.words : null);
        if (!wordList) {
          console.warn(`  Batch ${batchIdx + 1}: not an array, retrying...`);
          await sleep(1000);
          continue;
        }

        let addedThisBatch = 0;
        for (const entry of wordList) {
          if (!entry.word || typeof entry.word !== 'string') continue;
          const wordLower = entry.word.toLowerCase().trim();

          // Skip if already in words.json
          if (existingKeys.has(wordLower)) continue;

          // Skip if we already added it in this run
          if (newWords.some((nw) => nw.word.toLowerCase() === wordLower)) continue;

          // Normalize POS
          let pos = String(entry.pos || '').toLowerCase().trim();
          if (!ALLOWED_POS.has(pos)) {
            const posMap = { adjective: 'adj', adverb: 'adv', preposition: 'prep', pronoun: 'pron', conjunction: 'conj' };
            pos = posMap[pos] || 'noun';
          }

          const tr = String(entry.tr || '').trim();
          if (!tr) continue;

          newWords.push({
            word: entry.word.trim(),
            level: level,
            pos: pos,
            tr: tr,
          });

          existingKeys.add(wordLower);
          addedThisBatch++;
        }

        console.log(`  Batch ${batchIdx + 1}: +${addedThisBatch} new words (total: ${newWords.length}/${needed})`);
        batchSucceeded = true;
        break;
      } catch (error) {
        console.warn(`  Batch ${batchIdx + 1} attempt ${attempt + 1} failed: ${error.message}`);
        if (attempt < 2) await sleep(2000 * (attempt + 1));
      }
    }

    if (!batchSucceeded) {
      console.warn(`  Batch ${batchIdx + 1} failed after all attempts, continuing...`);
    }

    await sleep(600);
  }

  return newWords;
}

async function main() {
  if (!API_KEY && OPENROUTER_KEYS.length === 0) {
    console.error('No LLM keys configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY(S) in .env.');
    process.exit(1);
  }

  console.log(`Starting word generation. Current total: ${Object.keys(words).length}`);
  console.log(`Target: 3000 total words`);

  const levels = TARGET_LEVEL ? [TARGET_LEVEL.toUpperCase()] : Object.keys(LEVEL_TARGETS);
  const allNewWords = [];

  for (const level of levels) {
    const target = LEVEL_TARGETS[level];
    if (!target) {
      console.warn(`No target defined for level ${level}`);
      continue;
    }

    const newForLevel = await generateForLevel(level, target);
    allNewWords.push(...newForLevel);
    console.log(`  Level ${level}: generated ${newForLevel.length} new words`);

    if (levels.indexOf(level) < levels.length - 1) {
      await sleep(1000);
    }
  }

  if (allNewWords.length === 0) {
    console.log('No new words generated. Nothing to add.');
    return;
  }

  // Add new words to words.json
  for (const entry of allNewWords) {
    words[entry.word] = {
      level: entry.level,
      pos: entry.pos,
      tr: entry.tr,
    };
  }

  // Sort alphabetically
  const sorted = {};
  Object.keys(words).sort().forEach((key) => {
    sorted[key] = words[key];
  });

  fs.writeFileSync(wordsPath, JSON.stringify(sorted, null, 2));

  console.log(`\n=== WORD GENERATION COMPLETE ===`);
  console.log(`Added: ${allNewWords.length} new words`);
  console.log(`Total words now: ${Object.keys(sorted).length}`);

  // Show level breakdown
  const byLevel = {};
  for (const [word, data] of Object.entries(sorted)) {
    const lvl = data.level || 'unknown';
    byLevel[lvl] = (byLevel[lvl] || 0) + 1;
  }
  console.log('Level breakdown:');
  for (const [lvl, count] of Object.entries(byLevel).sort()) {
    const target = LEVEL_TARGETS[lvl];
    const status = target ? (count >= target ? '✓' : `need ${target - count} more`) : '';
    console.log(`  ${lvl}: ${count}${target ? ` / ${target} ${status}` : ''}`);
  }

  // Save list of new words for enrichment
  const newWordsList = allNewWords.map((w) => w.word).join(',');
  fs.writeFileSync(path.join(__dirname, 'new_words_to_enrich.txt'), newWordsList);
  console.log(`\nSaved ${allNewWords.length} new word names to scripts/new_words_to_enrich.txt`);
  console.log('Now run enrich.js with TARGET_WORDS from that file to enrich them.');
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
