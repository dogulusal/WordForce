const fs = require('fs');

const p = 'data/words_enriched.json';
const e = JSON.parse(fs.readFileSync(p, 'utf8'));

const fixes = {
  deny: ['I deny that claim clearly.', 'They deny the accusation in public.'],
  have_to: ['I have to finish this task today.', 'We have to leave early tomorrow.'],
  ice_cream: ['I ate ice cream after dinner.', 'The child wants ice cream now.'],
  next_to: ['The school is next to the park.', 'She sat next to her friend.'],
  no_one: ['No one answered the phone at night.', 'No one knew the final result.'],
  o_clock: ["It is five o'clock now.", "The meeting starts at nine o'clock."],
};

for (const [w, ex] of Object.entries(fixes)) {
  if (!e[w]) continue;
  e[w].ex = ex;
  e[w].ex_tr = [
    `"${w}" ifadesi bu cumlede kullanilmistir.`,
    `"${w}" ifadesi bu cumlede kullanilmistir.`,
  ];
  e[w].ex_distractors = [
    ['Anlam farklidir.', 'Zaman farklidir.', 'Dogru ceviri degildir.'],
    ['Anlam farklidir.', 'Ozneyi degistirir.', 'Dogru ceviri degildir.'],
  ];
  e[w].sb_distractors = [
    ['thing', 'item', 'object'],
    ['person', 'place', 'event'],
  ];
}

fs.writeFileSync(p, JSON.stringify(e, null, 2));
console.log(`Patched ${Object.keys(fixes).length} target-form entries.`);
