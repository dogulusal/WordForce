const fs = require('fs');
const path = require('path');
const WordPOS = require('wordpos');

const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
const data = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));
const wordpos = new WordPOS();

const MISSING_EX_TR_SENTINEL = '__MISSING_EX_TR__';
const MISSING_EX_DISTRACTOR_SENTINEL = '__MISSING_EX_DISTRACTOR__';

const TRANSLATION_REPAIRS = {
  alarm: 'alarm, uyarı'
};

const ENTRY_REPAIRS = {
  alarm: {
    def: 'A warning sound or signal.',
    ex: [
      'The alarm rang early this morning.',
      "I set the alarm for seven o'clock."
    ]
  }
};

const BAD_PATTERNS = [
  /a word used with a meaning close to/i,
  /to perform an action related to/i,
  /describing something that can be understood as/i,
  /in a way related to/i,
  /a linking word used with a meaning close to/i,
  /appears in today's vocabulary set/i,
  /i saw .* in a sentence and wrote it down/i,
  /bugunku kelime setinde/i,
  /bugünkü kelime setinde/i,
  /kelime setinde geciyor/i,
  /kelime setinde geçiyor/i,
  /bir cumlede gordum/i,
  /bir cümlede gördüm/i,
  /not ettim/i,
  /people often .* when they practice english/i,
  /i try to .* in short daily conversations/i,
  /this lesson is .* for beginners/i,
  /her explanation was .* and easy to follow/i,
  /she spoke .* during the meeting/i,
  /he answered .* and continued the task/i,
  /dogru ceviri degildir/i,
  /doğru çeviri değildir/i,
  /anlam farklidir/i,
  /anlam farklıdır/i,
  /cumle zamani farklidir/i,
  /cümle zamanı farklıdır/i,
  /ozneyi degistirir/i,
  /özneyi değiştirir/i,
  /anlami kaydirir/i,
  /anlamı kaydırır/i,
  /__missing_ex_tr__/i,
  /__missing_ex_distractor__/i
];

function isPlaceholder(value, word) {
  const text = String(value || '').toLowerCase();
  const display = String(word || '').replace(/_/g, ' ').toLowerCase();
  if (!text.trim()) return true;
  return BAD_PATTERNS.some((pattern) => pattern.test(text)) ||
    text.includes(`"${display}" kelimesi bu cumlede kullanilmistir`) ||
    text.includes(`"${display}" kelimesi bu cümlede kullanılmıştır`) ||
    text.includes(`${display} kelimesi bu cumlede kullanilmistir`) ||
    text.includes(`${display} kelimesi bu cümlede kullanılmıştır`);
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWord(sentence, word) {
  const normalizedSentence = normalizeToken(sentence);
  const normalizedWord = normalizeToken(String(word || '').replace(/_/g, ' '));
  return normalizedSentence.split(/\s+/).includes(normalizedWord) || normalizedSentence.includes(normalizedWord);
}

function wordNetPosFor(pos) {
  const value = String(pos || '').toLowerCase();
  if (value === 'noun' || value === 'n') return ['n'];
  if (value === 'verb' || value === 'v') return ['v'];
  if (value === 'adj' || value === 'adjective' || value === 'a') return ['a', 's'];
  if (value === 'adv' || value === 'adverb' || value === 'r') return ['r'];
  return [];
}

function firstGloss(tr) {
  return String(tr || '').split(/[;,]/)[0].trim() || String(tr || '').trim();
}

function fallbackDefinition(pos, tr) {
  const gloss = String(tr || '').trim();
  return gloss ? `Turkish meaning: ${gloss}.` : 'This word needs a dictionary meaning before advanced exercises.';
}

function capitalize(word) {
  const value = String(word || '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function fallbackExamples(word, pos) {
  const display = String(word || '').replace(/_/g, ' ');
  const cap = capitalize(display);
  const value = String(pos || '').toLowerCase();
  if (value === 'verb') {
    return [`We need to ${display} today.`, `They will ${display} when necessary.`];
  }
  if (value === 'adj' || value === 'adjective') {
    return [`This example is ${display}.`, `The answer seems ${display}.`];
  }
  if (value === 'adv' || value === 'adverb') {
    return [`She answered ${display}.`, `They worked ${display}.`];
  }
  if (value === 'prep' || value === 'preposition') {
    return [`The book is ${display} the table.`, `She walked ${display} the road.`];
  }
  if (value === 'conj' || value === 'conjunction') {
    return [`${cap} it was difficult, we continued.`, `${cap} the plan changed, we stayed calm.`];
  }
  return [`The ${display} is important here.`, `I noticed the ${display} today.`];
}

function pickSbDistractors(word, pos) {
  const samePos = Object.entries(data)
    .filter(([candidate, item]) => candidate !== word && String(item?.pos || '').toLowerCase() === String(pos || '').toLowerCase())
    .map(([candidate]) => candidate.replace(/_/g, ' '))
    .slice(0, 3);
  while (samePos.length < 3) samePos.push(['practice', 'example', 'meaning'][samePos.length]);
  return samePos.slice(0, 3);
}

function cleanWordNetExamples(sense, word) {
  const examples = Array.isArray(sense?.exp) ? sense.exp : [];
  return examples
    .map((example) => String(example || '').trim())
    .filter((example) => example && containsWord(example, word) && !isPlaceholder(example, word))
    .slice(0, 2);
}

async function lookupRepair(word, pos) {
  try {
    const senses = await wordpos.lookup(word);
    const allowed = wordNetPosFor(pos);
    const matching = senses.find((sense) => allowed.includes(String(sense?.pos || '').toLowerCase()) && String(sense?.def || '').trim());
    const anySense = senses.find((sense) => String(sense?.def || '').trim());
    const sense = matching || anySense || null;
    return {
      definition: sense ? String(sense.def || '').trim().replace(/\s+/g, ' ') : '',
      examples: cleanWordNetExamples(sense, word)
    };
  } catch {
    return { definition: '', examples: [] };
  }
}

async function main() {
  let definitionsRepaired = 0;
  let examplesRepaired = 0;
  let translationsRepaired = 0;
  let exTrReplaced = 0;
  let distractorsReplaced = 0;
  let wordNetDefinitions = 0;
  let wordNetExamples = 0;

  for (const [word, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') continue;

    if (TRANSLATION_REPAIRS[word] && entry.tr !== TRANSLATION_REPAIRS[word]) {
      entry.tr = TRANSLATION_REPAIRS[word];
      translationsRepaired += 1;
    }

    const forcedRepair = ENTRY_REPAIRS[word] || null;

    const pos = entry.pos || 'other';
    const tr = entry.tr || '';
    const currentExamples = Array.isArray(entry.ex) ? entry.ex : [];
    const hasBadDefinition = isPlaceholder(entry.def, word);
    const hasBadExample = currentExamples.length < 2 || currentExamples.some((example) => isPlaceholder(example, word));
    const hasBadExTr = Array.isArray(entry.ex_tr) && entry.ex_tr.some((value) => isPlaceholder(value, word));
    const hasBadDistractors = Array.isArray(entry.ex_distractors) && entry.ex_distractors.flat().some((value) => isPlaceholder(value, word));

    if (!forcedRepair && !hasBadDefinition && !hasBadExample && !hasBadExTr && !hasBadDistractors) continue;

    const repair = await lookupRepair(word, pos);

    if (forcedRepair || hasBadDefinition) {
      entry.def = forcedRepair?.def || repair.definition || fallbackDefinition(pos, tr);
      definitionsRepaired += 1;
      if (!forcedRepair && repair.definition) wordNetDefinitions += 1;
    }

    if (forcedRepair || hasBadExample) {
      const examples = forcedRepair?.ex ? [...forcedRepair.ex] : [...repair.examples];
      for (const example of fallbackExamples(word, pos)) {
        if (examples.length >= 2) break;
        examples.push(example);
      }
      entry.ex = examples.slice(0, 2);
      examplesRepaired += 1;
      if (!forcedRepair && repair.examples.length > 0) wordNetExamples += 1;
    }

    if (hasBadExTr || hasBadExample || !Array.isArray(entry.ex_tr) || entry.ex_tr.length !== entry.ex.length) {
      entry.ex_tr = entry.ex.map((_, index) => {
        const existing = Array.isArray(entry.ex_tr) ? entry.ex_tr[index] : '';
        if (existing && !isPlaceholder(existing, word) && !hasBadExample) return existing;
        exTrReplaced += 1;
        return MISSING_EX_TR_SENTINEL;
      });
    }

    if (hasBadDistractors || hasBadExample || !Array.isArray(entry.ex_distractors) || entry.ex_distractors.length !== entry.ex.length) {
      entry.ex_distractors = entry.ex.map((_, index) => {
        const row = Array.isArray(entry.ex_distractors?.[index]) ? entry.ex_distractors[index] : [];
        const cleaned = row.map((value) => {
          if (isPlaceholder(value, word)) {
            distractorsReplaced += 1;
            return MISSING_EX_DISTRACTOR_SENTINEL;
          }
          return value;
        });
        while (cleaned.length < 3) cleaned.push(MISSING_EX_DISTRACTOR_SENTINEL);
        return cleaned.slice(0, 3);
      });
    }

    if (!Array.isArray(entry.sb_distractors) || entry.sb_distractors.length !== entry.ex.length) {
      const row = pickSbDistractors(word, pos);
      entry.sb_distractors = entry.ex.map(() => row);
    }
  }

  fs.writeFileSync(enrichedPath, JSON.stringify(data, null, 2));
  console.log(`Repaired definitions=${definitionsRepaired} (wordnet=${wordNetDefinitions}), examples=${examplesRepaired} (wordnet=${wordNetExamples}), translations=${translationsRepaired}, ex_tr=${exTrReplaced}, ex_distractors=${distractorsReplaced}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});