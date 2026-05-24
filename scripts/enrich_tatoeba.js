/**
 * Tatoeba Enrichment Script
 * 
 * Fetches additional example sentences from Tatoeba API for each word in the lexicon.
 * Adds Turkish translations when available.
 * Also searches for natural co-occurrence sentences (two words in one sentence).
 * 
 * Usage:
 *   node scripts/enrich_tatoeba.js [--limit=50] [--word=specific_word]
 * 
 * This is an offline enrichment tool — results are saved to words_enriched.json.
 * No runtime API calls are made by the app.
 */

const fs = require('fs');
const path = require('path');

const enrichedPath = path.join(__dirname, '../data/words_enriched.json');

const TATOEBA_API = 'https://api.tatoeba.org/v1/sentences';
const DELAY_MS = 1200; // Rate limiting: ~50 req/min
const MAX_SENTENCES_PER_WORD = 5;
const MIN_WORD_COUNT = 4;
const MAX_WORD_COUNT = 15;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  });
  return args;
}

async function fetchTatoebaSentences(word, options = {}) {
  const { withTurkish = true, wordCount = `${MIN_WORD_COUNT}-${MAX_WORD_COUNT}`, limit = 10 } = options;

  const params = new URLSearchParams({
    lang: 'eng',
    q: word.replace(/_/g, ' '),
    word_count: wordCount,
    sort: 'relevance',
    limit: String(limit),
    is_unapproved: 'no',
  });

  if (withTurkish) {
    params.set('trans:lang', 'tur');
    params.set('showtrans', 'matching');
  } else {
    params.set('showtrans', 'none');
  }

  const url = `${TATOEBA_API}?${params.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  [WARN] Tatoeba API returned ${response.status} for "${word}"`);
      return [];
    }
    const json = await response.json();
    return (json.data || []).map(sentence => ({
      text: sentence.text,
      id: sentence.id,
      translations: (sentence.translations || [])
        .flat()
        .filter(t => t && t.lang === 'tur')
        .map(t => t.text)
    }));
  } catch (err) {
    console.warn(`  [WARN] Fetch failed for "${word}": ${err.message}`);
    return [];
  }
}

async function findCoOccurrenceSentences(wordA, wordB) {
  // Search for sentences containing both words
  const query = `${wordA.replace(/_/g, ' ')} ${wordB.replace(/_/g, ' ')}`;
  const params = new URLSearchParams({
    lang: 'eng',
    q: query,
    word_count: `${MIN_WORD_COUNT + 2}-${MAX_WORD_COUNT + 5}`,
    sort: 'relevance',
    limit: '5',
    is_unapproved: 'no',
    showtrans: 'none',
  });

  const url = `${TATOEBA_API}?${params.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const json = await response.json();

    // Filter: both words must actually appear in the sentence
    const normA = wordA.replace(/_/g, ' ').toLowerCase();
    const normB = wordB.replace(/_/g, ' ').toLowerCase();

    return (json.data || [])
      .filter(s => {
        const lower = s.text.toLowerCase();
        return lower.includes(normA) && lower.includes(normB);
      })
      .map(s => ({ text: s.text, id: s.id }));
  } catch (err) {
    return [];
  }
}

function sentenceContainsWord(sentence, word) {
  const normalized = word.replace(/_/g, ' ').toLowerCase();
  const sentLower = sentence.toLowerCase();
  // Check whole word boundary
  const regex = new RegExp(`(^|[^a-z])${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
  return regex.test(sentLower);
}

async function enrichWord(word, wordData, existingExamples) {
  const results = {
    newExamples: [],
    newExamplesTr: [],
    tatoebaIds: [],
  };

  const sentences = await fetchTatoebaSentences(word);

  for (const sentence of sentences) {
    // Skip if we already have this sentence
    if (existingExamples.some(ex => ex.toLowerCase() === sentence.text.toLowerCase())) continue;
    // Verify the word actually appears
    if (!sentenceContainsWord(sentence.text, word)) continue;

    results.newExamples.push(sentence.text);
    results.newExamplesTr.push(sentence.translations[0] || '');
    results.tatoebaIds.push(sentence.id);

    if (results.newExamples.length >= MAX_SENTENCES_PER_WORD) break;
  }

  return results;
}

async function main() {
  const args = parseArgs();
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
  const targetWord = args.word || null;

  console.log('Loading words_enriched.json...');
  const allWords = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
  const wordKeys = Object.keys(allWords);
  console.log(`Loaded ${wordKeys.length} words.`);

  let processed = 0;
  let enriched = 0;

  const wordsToProcess = targetWord ? [targetWord] : wordKeys;

  for (const word of wordsToProcess) {
    if (processed >= limit) break;
    if (!allWords[word]) {
      if (targetWord) console.log(`Word "${word}" not found in lexicon.`);
      continue;
    }

    const wordData = allWords[word];
    const existingEx = wordData.ex || [];

    // Skip if already has enough examples
    if (existingEx.length >= MAX_SENTENCES_PER_WORD && !targetWord) {
      continue;
    }

    processed++;
    process.stdout.write(`  [${processed}] ${word}...`);

    const result = await enrichWord(word, wordData, existingEx);

    if (result.newExamples.length > 0) {
      // Append new examples (don't exceed max total)
      const maxToAdd = MAX_SENTENCES_PER_WORD - existingEx.length;
      const toAdd = result.newExamples.slice(0, Math.max(0, maxToAdd));
      const toAddTr = result.newExamplesTr.slice(0, Math.max(0, maxToAdd));

      if (toAdd.length > 0) {
        wordData.ex = [...existingEx, ...toAdd];
        wordData.ex_tr = [...(wordData.ex_tr || []), ...toAddTr];
        if (!wordData.tatoeba_ids) wordData.tatoeba_ids = [];
        wordData.tatoeba_ids.push(...result.tatoebaIds.slice(0, toAdd.length));
        enriched++;
        console.log(` +${toAdd.length} sentences`);
      } else {
        console.log(' (already full)');
      }
    } else {
      console.log(' (no new sentences found)');
    }

    await sleep(DELAY_MS);
  }

  // Save results
  console.log(`\nEnriched ${enriched}/${processed} words. Saving...`);
  fs.writeFileSync(enrichedPath, JSON.stringify(allWords, null, 2), 'utf-8');
  console.log('Done.');

  // Co-occurrence search (optional, for top word pairs in practice)
  if (!targetWord && args.cooccurrence !== 'false') {
    console.log('\n── Co-occurrence search ──');
    const coOccurrences = {};
    const practiceWords = wordKeys.filter(w => (allWords[w].ex || []).length >= 2).slice(0, 50);

    let pairsChecked = 0;
    for (let i = 0; i < practiceWords.length && pairsChecked < 30; i++) {
      for (let j = i + 1; j < practiceWords.length && pairsChecked < 30; j++) {
        const wA = practiceWords[i];
        const wB = practiceWords[j];

        const results = await findCoOccurrenceSentences(wA, wB);
        if (results.length > 0) {
          const key = `${wA}+${wB}`;
          coOccurrences[key] = results.map(r => r.text).slice(0, 2);
          console.log(`  Found co-occurrence: ${wA} + ${wB} (${results.length} sentences)`);
        }

        pairsChecked++;
        await sleep(DELAY_MS);
      }
    }

    if (Object.keys(coOccurrences).length > 0) {
      const coOccPath = path.join(__dirname, '../data/co_occurrences.json');
      fs.writeFileSync(coOccPath, JSON.stringify(coOccurrences, null, 2), 'utf-8');
      console.log(`Saved ${Object.keys(coOccurrences).length} co-occurrence pairs.`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
