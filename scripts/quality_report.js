#!/usr/bin/env node
// WordForge — Data & Exercise Quality Report
// Usage:
//   node scripts/quality_report.js                  # all words
//   node scripts/quality_report.js --recent 5       # words changed in last N commits
//   node scripts/quality_report.js --level B1       # filter by level
//   node scripts/quality_report.js --level B1 --recent 3

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const recentIdx = args.indexOf('--recent');
const levelIdx = args.indexOf('--level');
const recentN = recentIdx !== -1 ? parseInt(args[recentIdx + 1], 10) : null;
const levelFilter = levelIdx !== -1 ? args[levelIdx + 1] : null;

// ── Load data ─────────────────────────────────────────────────────────────────
const dataPath = path.resolve(__dirname, '../data/words_enriched.json');
const allWords = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// ── Recent words filter (via git log) ─────────────────────────────────────────
function getRecentlyChangedWords(n) {
  try {
    const diff = execSync(
      `git log -p -${n} -- data/words_enriched.json`,
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const added = new Set();
    const wordPattern = /^\+"([A-Za-z][^"]+)":\s*\{/gm;
    let m;
    while ((m = wordPattern.exec(diff)) !== null) {
      added.add(m[1]);
    }
    return added.size > 0 ? added : null;
  } catch {
    console.warn('⚠  Could not run git log. Showing all words.');
    return null;
  }
}

let targetSet = null;
if (recentN && !isNaN(recentN)) {
  targetSet = getRecentlyChangedWords(recentN);
  if (!targetSet) targetSet = null;
}

// ── Checks ────────────────────────────────────────────────────────────────────
const SHORT_EXAMPLE_THRESHOLD = 5;
const DISTRACTOR_MIN = 3;

// Short example whitelist: single-letter words, abbreviations, proper nouns that are
// legitimately short (months handled by naturalness)
const SHORT_EXAMPLE_WHITELIST = new Set(['I', 'Mr', 'Mrs', 'Dr', 'OK', 'TV', 'PC', 'CD', 'DJ', 'ID', 'IT']);

const errors = [];
const warnings = [];

function addError(word, type, detail) {
  errors.push({ word, type, detail });
}
function addWarning(word, type, detail) {
  warnings.push({ word, type, detail });
}

let checked = 0;
const levelCounts = {};

for (const [word, data] of Object.entries(allWords)) {
  // Apply filters
  if (targetSet && !targetSet.has(word)) continue;
  if (levelFilter && data.level !== levelFilter) continue;

  checked++;
  levelCounts[data.level] = (levelCounts[data.level] || 0) + 1;

  // ── Core field checks ───────────────────────────────────────────────────────
  if (!data.tr) addError(word, 'missing_tr', 'No Turkish translation');
  if (!data.def) addError(word, 'missing_def', 'No definition');
  if (!data.pos) addError(word, 'missing_pos', 'No part of speech');

  // ── Primary examples ────────────────────────────────────────────────────────
  if (!Array.isArray(data.ex) || data.ex.length < 2) {
    addError(word, 'missing_examples', `Only ${(data.ex || []).length} primary example(s), need 2`);
  }

  if (!Array.isArray(data.ex_tr) || data.ex_tr.length < (data.ex || []).length) {
    addError(word, 'missing_ex_tr', 'ex_tr count does not match ex count');
  }

  // Short examples
  if (Array.isArray(data.ex)) {
    data.ex.forEach((sentence, i) => {
      if (typeof sentence === 'string' && sentence.split(' ').length < SHORT_EXAMPLE_THRESHOLD) {
        if (!SHORT_EXAMPLE_WHITELIST.has(word)) {
          addWarning(word, 'short_example', `Example ${i + 1} is only ${sentence.split(' ').length} words: "${sentence}"`);
        }
      }
    });
  }

  // ── Distractor checks ───────────────────────────────────────────────────────
  if (!Array.isArray(data.ex_distractors) || data.ex_distractors.length === 0) {
    addError(word, 'missing_ex_distractors', 'No ex_distractors');
  } else {
    // Count mismatch with ex
    if (data.ex && data.ex_distractors.length !== data.ex.length) {
      addError(word, 'ex_distractors_count_mismatch',
        `ex has ${data.ex.length} items but ex_distractors has ${data.ex_distractors.length}`);
    }
    data.ex_distractors.forEach((arr, i) => {
      if (!Array.isArray(arr) || arr.length < DISTRACTOR_MIN) {
        addError(word, 'ex_distractors_too_few', `ex_distractors[${i}] has only ${(arr || []).length} options, need ${DISTRACTOR_MIN}`);
      }
    });
  }

  if (!Array.isArray(data.sb_distractors) || data.sb_distractors.length === 0) {
    addError(word, 'missing_sb_distractors', 'No sb_distractors');
  } else {
    data.sb_distractors.forEach((arr, i) => {
      if (!Array.isArray(arr) || arr.length < DISTRACTOR_MIN) {
        addError(word, 'sb_distractors_too_few', `sb_distractors[${i}] has only ${(arr || []).length} options, need ${DISTRACTOR_MIN}`);
      }
    });
  }

  // ── Alt meanings checks ─────────────────────────────────────────────────────
  if (Array.isArray(data.alt_meanings) && data.alt_meanings.length > 0) {
    data.alt_meanings.forEach((meaning, i) => {
      if (!meaning.def) addError(word, 'alt_missing_def', `alt_meanings[${i}] has no def`);
      if (!meaning.pos) addError(word, 'alt_missing_pos', `alt_meanings[${i}] has no pos`);
      if (!Array.isArray(meaning.ex) || meaning.ex.length < 1) {
        addError(word, 'alt_missing_examples', `alt_meanings[${i}] has no examples`);
      }
      if (!Array.isArray(meaning.ex_distractors) || meaning.ex_distractors.length === 0) {
        addError(word, 'alt_missing_ex_distractors', `alt_meanings[${i}] has no ex_distractors`);
      }
      if (!Array.isArray(meaning.sb_distractors) || meaning.sb_distractors.length === 0) {
        addError(word, 'alt_missing_sb_distractors', `alt_meanings[${i}] has no sb_distractors`);
      }
    });
  }
}

// ── Grouped summary ───────────────────────────────────────────────────────────
const errorsByType = {};
errors.forEach(e => {
  errorsByType[e.type] = (errorsByType[e.type] || []);
  errorsByType[e.type].push(e);
});
const warnsByType = {};
warnings.forEach(w => {
  warnsByType[w.type] = (warnsByType[w.type] || []);
  warnsByType[w.type].push(w);
});

// ── Console output ────────────────────────────────────────────────────────────
const line = '═'.repeat(50);
const filter = [
  targetSet ? `last ${recentN} commits` : null,
  levelFilter ? `level=${levelFilter}` : null
].filter(Boolean).join(', ') || 'all words';

console.log(`\nWordForge Quality Report — ${new Date().toISOString().slice(0, 10)}`);
console.log(line);
console.log(`Total in dataset: ${Object.keys(allWords).length}   Checked: ${checked}   Filter: ${filter}`);

if (Object.keys(levelCounts).length) {
  const breakdown = Object.entries(levelCounts).sort().map(([l, c]) => `${l}:${c}`).join('  ');
  console.log(`Level breakdown: ${breakdown}`);
}

console.log('');

if (errors.length === 0) {
  console.log('✅ No errors found');
} else {
  console.log(`❌ ERRORS (${errors.length} total)\n`);
  for (const [type, items] of Object.entries(errorsByType)) {
    console.log(`  [${type}] — ${items.length} word(s)`);
    items.slice(0, 5).forEach(e => console.log(`    • ${e.word}: ${e.detail}`));
    if (items.length > 5) console.log(`    … and ${items.length - 5} more`);
  }
}

console.log('');

if (warnings.length === 0) {
  console.log('✅ No warnings');
} else {
  console.log(`⚠️  WARNINGS (${warnings.length} total)\n`);
  for (const [type, items] of Object.entries(warnsByType)) {
    console.log(`  [${type}] — ${items.length} word(s)`);
    items.slice(0, 3).forEach(w => console.log(`    • ${w.word}: ${w.detail}`));
    if (items.length > 3) console.log(`    … and ${items.length - 3} more`);
  }
}

// ── Write JSON report ─────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  filter: { recent: recentN || null, level: levelFilter || null },
  summary: {
    totalInDataset: Object.keys(allWords).length,
    checked,
    errors: errors.length,
    warnings: warnings.length,
    levelCounts
  },
  errorsByType: Object.fromEntries(
    Object.entries(errorsByType).map(([t, items]) => [t, items])
  ),
  warningsByType: Object.fromEntries(
    Object.entries(warnsByType).map(([t, items]) => [t, items])
  )
};

const outPath = path.resolve(__dirname, '../data/quality_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nFull report → data/quality_report.json\n`);

// Exit with error code if there are errors (useful for CI)
process.exit(errors.length > 0 ? 1 : 0);
