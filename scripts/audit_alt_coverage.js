const fs = require('fs');
const path = require('path');
const WordPOS = require('wordpos');

const enrichedPath = path.join(__dirname, '../data/words_enriched.json');
const reportPath = path.join(__dirname, '../data/alt_meaning_coverage_report.json');

if (!fs.existsSync(enrichedPath)) {
  console.error('Missing data/words_enriched.json');
  process.exit(1);
}

const wordpos = new WordPOS();
const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));

function toSenseSummary(results) {
  if (!Array.isArray(results)) return { total: 0, noun: 0, verb: 0, adj: 0, adv: 0 };

  const summary = { total: results.length, noun: 0, verb: 0, adj: 0, adv: 0 };
  results.forEach((sense) => {
    const p = String(sense?.pos || '').toLowerCase();
    if (p === 'n' || p === 'noun') summary.noun += 1;
    if (p === 'v' || p === 'verb') summary.verb += 1;
    if (p === 'a' || p === 's' || p === 'adj') summary.adj += 1;
    if (p === 'r' || p === 'adv') summary.adv += 1;
  });
  return summary;
}

async function main() {
  const words = Object.keys(enriched).sort();
  const threshold = Number(process.env.POLYSEMY_THRESHOLD || 3);
  const maxWords = Number(process.env.MAX_WORDS || 0);
  const selected = maxWords > 0 ? words.slice(0, maxWords) : words;

  const report = {
    generatedAt: new Date().toISOString(),
    threshold,
    totals: {
      wordsChecked: selected.length,
      wordsWithAltMeanings: 0,
      wordsWithoutAltMeanings: 0,
      highPolysemyMissingAlt: 0,
    },
    highPolysemyMissingAlt: [],
  };

  for (const word of selected) {
    const entry = enriched[word] || {};
    const altCount = Array.isArray(entry.alt_meanings) ? entry.alt_meanings.length : 0;

    if (altCount > 0) {
      report.totals.wordsWithAltMeanings += 1;
      continue;
    }

    report.totals.wordsWithoutAltMeanings += 1;

    try {
      const lookup = await wordpos.lookup(word);
      const summary = toSenseSummary(lookup);
      if (summary.total >= threshold) {
        report.totals.highPolysemyMissingAlt += 1;
        report.highPolysemyMissingAlt.push({
          word,
          wordnetSenseCount: summary.total,
          byPos: {
            noun: summary.noun,
            verb: summary.verb,
            adj: summary.adj,
            adv: summary.adv,
          },
        });
      }
    } catch (error) {
      report.highPolysemyMissingAlt.push({
        word,
        error: String(error?.message || error),
      });
    }
  }

  report.highPolysemyMissingAlt.sort((a, b) => {
    const cA = Number(a.wordnetSenseCount || -1);
    const cB = Number(b.wordnetSenseCount || -1);
    if (cA !== cB) return cB - cA;
    return String(a.word || '').localeCompare(String(b.word || ''));
  });

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Coverage report written: ${reportPath}`);
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((error) => {
  console.error('Failed to build alt-meaning coverage report:', error);
  process.exit(1);
});
