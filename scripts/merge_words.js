// Merge all level-specific word files into words.json, removing duplicates
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

// Load existing A1 words
const a1 = JSON.parse(fs.readFileSync(path.join(dataDir, 'words.json'), 'utf8'));
const a1Keys = new Set(Object.keys(a1));

// Load new level files
const a2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'words_a2.json'), 'utf8'));
const b1 = JSON.parse(fs.readFileSync(path.join(dataDir, 'words_b1.json'), 'utf8'));
const b2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'words_b2.json'), 'utf8'));
const c1 = JSON.parse(fs.readFileSync(path.join(dataDir, 'words_c1.json'), 'utf8'));

const merged = { ...a1 };
let added = 0;
let skipped = 0;

[a2, b1, b2, c1].forEach((levelData) => {
  Object.entries(levelData).forEach(([word, data]) => {
    if (merged[word]) {
      skipped++;
      return;
    }
    merged[word] = data;
    added++;
  });
});

// Sort alphabetically
const sorted = {};
Object.keys(merged).sort().forEach(key => {
  sorted[key] = merged[key];
});

fs.writeFileSync(path.join(dataDir, 'words.json'), JSON.stringify(sorted, null, 2));

console.log(`Merged successfully!`);
console.log(`  A1 (existing): ${a1Keys.size}`);
console.log(`  Added: ${added}`);
console.log(`  Skipped (duplicates): ${skipped}`);
console.log(`  Total: ${Object.keys(sorted).length}`);

// Also update words_enriched.json to include new words with basic format
const enriched = JSON.parse(fs.readFileSync(path.join(dataDir, 'words_enriched.json'), 'utf8'));
let enrichedAdded = 0;

Object.entries(sorted).forEach(([word, data]) => {
  if (enriched[word]) return;
  // Add with basic enriched format (enough for all exercise types)
  enriched[word] = {
    level: data.level,
    pos: data.pos,
    tr: data.tr,
    def: data.def || '',
    ex: data.ex || [],
    ex_tr: [],
    ex_distractors: [],
    sb_distractors: []
  };
  enrichedAdded++;
});

const sortedEnriched = {};
Object.keys(enriched).sort().forEach(key => {
  sortedEnriched[key] = enriched[key];
});

fs.writeFileSync(path.join(dataDir, 'words_enriched.json'), JSON.stringify(sortedEnriched, null, 2));
console.log(`  Enriched file updated: ${enrichedAdded} new entries added`);
