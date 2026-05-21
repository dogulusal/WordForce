const fs = require('fs');
const path = require('path');

const rawPath = path.join(__dirname, '../data/words.json');
const enrichedPath = path.join(__dirname, '../data/words_enriched.json');

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));

function getPosPool(rawData) {
  const pool = new Map();
  for (const [word, item] of Object.entries(rawData)) {
    const pos = String(item?.pos || 'other').toLowerCase();
    if (!pool.has(pos)) pool.set(pos, []);
    pool.get(pos).push(word);
  }
  return pool;
}

function pickDistractors(word, pos, posPool) {
  const base = posPool.get(pos) || [];
  const picked = [];
  for (const candidate of base) {
    if (candidate.toLowerCase() === word.toLowerCase()) continue;
    picked.push(candidate);
    if (picked.length === 3) break;
  }
  while (picked.length < 3) {
    picked.push(['thing', 'item', 'object'][picked.length % 3]);
  }
  return picked;
}

function buildDefinition(word, pos, tr) {
  const safeTr = String(tr || '').trim();
  if (pos === 'verb') return `To perform an action related to "${safeTr}".`;
  if (pos === 'adjective') return `Describing something that can be understood as "${safeTr}".`;
  if (pos === 'adverb') return `In a way related to "${safeTr}".`;
  if (pos === 'conjunction') return `A linking word used with a meaning close to "${safeTr}".`;
  return `A word used with a meaning close to "${safeTr}".`;
}

function buildExamples(word, pos) {
  const w = String(word);
  if (pos === 'verb') {
    return [
      `People often ${w} when they practice English.`,
      `I try to ${w} in short daily conversations.`,
    ];
  }
  if (pos === 'adjective') {
    return [
      `This lesson is ${w} for beginners.`,
      `Her explanation was ${w} and easy to follow.`,
    ];
  }
  if (pos === 'adverb') {
    return [
      `She spoke ${w} during the meeting.`,
      `He answered ${w} and continued the task.`,
    ];
  }
  return [
    `The word ${w} appears in today's vocabulary set.`,
    `I saw ${w} in a sentence and wrote it down.`,
  ];
}

function buildEntry(word, source, posPool) {
  const pos = String(source?.pos || 'other').toLowerCase();
  const tr = String(source?.tr || '');
  const ex = buildExamples(word, pos);
  const sb1 = pickDistractors(word, pos, posPool);
  const sb2 = pickDistractors(word, pos, posPool).reverse();

  return {
    level: source?.level || 'A2',
    pos: source?.pos || 'other',
    tr,
    def: buildDefinition(word, pos, tr),
    ex,
    ex_tr: [
      `"${word}" kelimesi bugunku kelime setinde geciyor.`,
      `"${word}" kelimesini bir cumlede gordum ve not ettim.`,
    ],
    ex_distractors: [
      ['Anlam farklidir.', 'Cumle zamani farklidir.', 'Dogru ceviri degildir.'],
      ['Ozneyi degistirir.', 'Anlami kaydirir.', 'Dogru ceviri degildir.'],
    ],
    sb_distractors: [sb1, sb2],
  };
}

function ensureRowOfThree(row, fallback) {
  const items = Array.isArray(row)
    ? row.filter((x) => typeof x === 'string' && x.trim())
    : [];
  while (items.length < 3) items.push(fallback[items.length % fallback.length]);
  return items.slice(0, 3);
}

function normalizeEntry(word, entry, source, posPool) {
  const pos = String(entry?.pos || source?.pos || 'other').toLowerCase();
  const tr = String(entry?.tr || source?.tr || '');

  const ex = Array.isArray(entry?.ex)
    ? entry.ex.filter((s) => typeof s === 'string' && s.trim())
    : [];
  if (ex.length < 2) {
    const fallbackEx = buildExamples(word, pos);
    while (ex.length < 2) ex.push(fallbackEx[ex.length % fallbackEx.length]);
  }

  const exTr = Array.isArray(entry?.ex_tr)
    ? entry.ex_tr.filter((s) => typeof s === 'string' && s.trim())
    : [];
  while (exTr.length < ex.length) {
    exTr.push(`"${word}" kelimesi bu cumlede kullanilmistir.`);
  }

  const exDistractors = Array.isArray(entry?.ex_distractors) ? entry.ex_distractors : [];
  const sbDistractors = Array.isArray(entry?.sb_distractors) ? entry.sb_distractors : [];

  const normalizedExDistractors = [];
  const normalizedSbDistractors = [];
  for (let i = 0; i < ex.length; i++) {
    normalizedExDistractors.push(
      ensureRowOfThree(exDistractors[i], ['Anlam farklidir.', 'Cumle zamani farklidir.', 'Dogru ceviri degildir.'])
    );
    normalizedSbDistractors.push(
      ensureRowOfThree(sbDistractors[i], pickDistractors(word, pos, posPool))
    );
  }

  return {
    ...entry,
    level: entry?.level || source?.level || 'A2',
    pos: entry?.pos || source?.pos || 'other',
    tr,
    def: entry?.def && String(entry.def).trim() ? entry.def : buildDefinition(word, pos, tr),
    ex,
    ex_tr: exTr.slice(0, ex.length),
    ex_distractors: normalizedExDistractors,
    sb_distractors: normalizedSbDistractors,
  };
}

function main() {
  const posPool = getPosPool(raw);
  const missing = Object.keys(raw).filter((word) => !enriched[word]);

  for (const word of missing) {
    enriched[word] = buildEntry(word, raw[word], posPool);
  }

  for (const [word, item] of Object.entries(enriched)) {
    enriched[word] = normalizeEntry(word, item, raw[word] || {}, posPool);
  }

  fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));
  console.log(`Filled ${missing.length} missing words locally.`);
  console.log(`Total enriched words: ${Object.keys(enriched).length}`);
}

main();
