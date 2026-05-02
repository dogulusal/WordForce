const fs = require('fs');
const path = require('path');

const enrichedPath = path.join(__dirname, '../data/words_enriched.json');

if (!fs.existsSync(enrichedPath)) {
  console.error('Missing data/words_enriched.json. Run scripts/enrich.js first.');
  process.exit(1);
}

const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
const errors = [];

function containsTargetForm(sentence, word) {
  if (typeof sentence !== 'string') return false;
  const normalizedSentence = sentence.toLowerCase();
  const forms = [
    word.toLowerCase(),
    word.toLowerCase().replace(/_/g, ' '),
    word.toLowerCase().replace(/_/g, "'"),
  ];
  return forms.some((form) => normalizedSentence.includes(form));
}

Object.entries(enriched).forEach(([word, data]) => {
  if (!data.def || data.def.trim() === '') errors.push(`MISSING def: ${word}`);
  if (!Array.isArray(data.ex) || data.ex.length < 2) errors.push(`MISSING ex: ${word}`);
  if (!Array.isArray(data.ex_tr) || data.ex_tr.length !== data.ex.length) {
    errors.push(`MISSING/MISMATCHED ex_tr: ${word}`);
  }
  if (!data.ex?.some((s) => containsTargetForm(s, word))) {
    errors.push(`ex missing target form: ${word}`);
  }
  if (!Array.isArray(data.ex_distractors) || data.ex_distractors.length !== data.ex.length) {
    errors.push(`MISSING/MISMATCHED ex_distractors: ${word}`);
  }
  if (!Array.isArray(data.sb_distractors) || data.sb_distractors.length !== data.ex.length) {
    errors.push(`MISSING/MISMATCHED sb_distractors: ${word}`);
  }

  data.ex_distractors?.forEach((dists, i) => {
    if (!Array.isArray(dists) || dists.length !== 3) {
      errors.push(`ex_distractors[${i}] should be 3-item array: ${word}`);
    }
  });

  data.sb_distractors?.forEach((dists, i) => {
    if (!Array.isArray(dists) || dists.length !== 3) {
      errors.push(`sb_distractors[${i}] should be 3-item array: ${word}`);
    }
  });
});

if (errors.length === 0) {
  console.log(`All ${Object.keys(enriched).length} words validated successfully`);
} else {
  console.error(`${errors.length} validation errors:`);
  errors.forEach((err) => console.error(err));
  process.exit(1);
}
