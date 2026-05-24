const fs = require('fs');

const words = JSON.parse(fs.readFileSync('data/words.json', 'utf8'));
const enriched = JSON.parse(fs.readFileSync('data/words_enriched.json', 'utf8'));

let mismatch = 0;
let targetMissing = 0;

for (const [word, d] of Object.entries(enriched)) {
  const ex = Array.isArray(d.ex) ? d.ex : [];
  const ok1 = Array.isArray(d.ex_tr) && d.ex_tr.length === ex.length;
  const ok2 =
    Array.isArray(d.ex_distractors) &&
    d.ex_distractors.length === ex.length &&
    d.ex_distractors.every((r) => Array.isArray(r) && r.length === 3);
  const ok3 =
    Array.isArray(d.sb_distractors) &&
    d.sb_distractors.length === ex.length &&
    d.sb_distractors.every((r) => Array.isArray(r) && r.length === 3);

  const forms = [
    word.toLowerCase(),
    word.toLowerCase().replace(/_/g, ' '),
    word.toLowerCase().replace(/_/g, "'"),
  ];
  const hasTarget = ex.some((s) => forms.some((f) => String(s || '').toLowerCase().includes(f)));

  if (!(ok1 && ok2 && ok3)) mismatch++;
  if (!hasTarget) targetMissing++;
}

console.log('Total:', Object.keys(words).length);
console.log('Enriched:', Object.keys(enriched).length);
console.log('Missing:', Object.keys(words).filter((k) => !enriched[k]).length);
console.log('Core mismatch words:', mismatch);
console.log('Target-missing words:', targetMissing);
