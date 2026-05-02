const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const rawPath = path.join(__dirname, '../data/words.json');
const enrichedPath = path.join(__dirname, '../data/words_enriched.json');

const words = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});
const MODEL = process.env.GEMINI_MODEL || 'gemma-4-31b-it';

const BATCH_SIZE = 10;
const DELAY_MS = 1000;
const MAX_RETRIES = 3;

function generatePrompt(word, pos, tr) {
  return `You are a language data generator. For the English word "${word}" (${pos}, meaning "${tr}" in Turkish):
Return ONLY a JSON object with no markdown:
{
  "def": "one short English definition, A1-friendly",
  "ex": ["sentence 1", "sentence 2", "sentence 3"],
  "ex_tr": ["turkish translation 1", "turkish translation 2", "turkish translation 3"],
  "ex_distractors": [["alt eng 1", "alt eng 2", "alt eng 3"], ["alt eng 1", "alt eng 2", "alt eng 3"], ["alt eng 1", "alt eng 2", "alt eng 3"]],
  "sb_distractors": [["alt word 1", "alt word 2", "alt word 3"], ["alt word 1", "alt word 2", "alt word 3"], ["alt word 1", "alt word 2", "alt word 3"]]
}
Rules:
- def, ex, ex_tr as before
- ex_distractors[i]: 3 plausible but incorrect translations of ex[i] (differ in grammar, pronoun, tense)
- sb_distractors[i]: 3 English word alternatives that fit sentence structure (same pos as target word)
- All alternatives must be A1-level vocabulary, contextually relevant`;
}

async function enrichOne(wordItem, maxRetries = MAX_RETRIES) {
  const { word, pos, tr } = wordItem;
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: generatePrompt(word, pos, tr),
        config: {
          temperature: 0.2,
          maxOutputTokens: 1500,
        },
      });

      const raw = response.text || '';
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
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
  const promises = wordList.map((item) => enrichOne(item));
  return Promise.all(promises);
}

async function main() {
  console.log(`Loaded ${Object.keys(words).length} words`);

  if (!process.env.GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY is missing. Exiting without enrichment.');
    return;
  }

  console.log(`Using model: ${MODEL}`);

  let enriched = {};
  if (fs.existsSync(enrichedPath)) {
    enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
  }

  const toEnrich = Object.keys(words)
    .filter((word) => !enriched[word])
    .map((word) => ({ word, ...words[word] }));

  if (process.env.TEST_ONE === '1' && toEnrich.length > 0) {
    const one = [toEnrich[0]];
    const result = await enrichBatch(one);
    console.log(JSON.stringify(result[0], null, 2));
    return;
  }

  console.log(`Found ${toEnrich.length} words to enrich (skipping ${Object.keys(enriched).length})`);

  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toEnrich.length / BATCH_SIZE);
    console.log(`Processing batch ${batchNum}/${totalBatches}...`);

    try {
      const results = await enrichBatch(batch);
      results.forEach(({ word, data }) => {
        enriched[word] = { ...words[word], ...data };
      });
      fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));
      console.log(`Batch ${batchNum} completed`);
    } catch (error) {
      console.error(`Batch ${batchNum} failed: ${error.message}`);
      console.error('Stopping enrichment. Fix the issue and rerun; resume support will skip completed words.');
      process.exit(1);
    }

    if (i + BATCH_SIZE < toEnrich.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log(`Enrichment complete. Total enriched words: ${Object.keys(enriched).length}`);
}

main().catch((error) => {
  console.error('Unexpected error in enrich script:', error);
  process.exit(1);
});
