const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const wordsPath = path.join(__dirname, '..', 'data', 'words_enriched.json');
const exercisesPath = path.join(__dirname, '..', 'js', 'exercises.js');

const allWords = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(exercisesPath, 'utf8'), context);

const Exercises = context.window.Exercises;

const BAD_PATTERNS = [
  /a word used with a meaning close to/i,
  /appears in today's vocabulary set/i,
  /i saw .* in a sentence and wrote it down/i,
  /dogru ceviri degildir/i,
  /anlam farklidir/i,
  /cumle zamani farklidir/i,
  /ozneyi degistirir/i,
  /anlami kaydirir/i
];

function normalize(value) {
  return String(value || '').toLowerCase().trim().replace(/[.,!?;:'"()\[\]]/g, '').replace(/\s+/g, ' ');
}

function hasBadText(value) {
  const text = String(value || '');
  return BAD_PATTERNS.some((pattern) => pattern.test(text));
}

function assertCleanText(value, label) {
  assert.ok(String(value || '').trim(), `${label} is empty`);
  assert.ok(!hasBadText(value), `${label} contains placeholder text: ${value}`);
}

function assertUniqueOptions(options, label, min = 4) {
  assert.ok(Array.isArray(options), `${label} options must be an array`);
  assert.ok(options.length >= min, `${label} should have at least ${min} options`);
  const normalized = options.map(normalize);
  assert.strictEqual(new Set(normalized).size, normalized.length, `${label} options should be unique`);
  options.forEach((option, index) => assertCleanText(option, `${label} option[${index}]`));
}

function assertTargetWordNotAnswer(word, value, label) {
  assert.notStrictEqual(normalize(value), normalize(word.replace(/_/g, ' ')), `${label} should not equal the English target word`);
}

function readyWords() {
  return Object.keys(allWords).filter((word) => Exercises.isExerciseReadyWord(word, allWords));
}

function sample(list, count) {
  return list.slice(0, count);
}

function testDefinition(word) {
  const exercise = Exercises.renderDefinition(word, allWords);
  assertCleanText(exercise.def, `DEFINITION ${word}`);
}

function testEnToTr(word) {
  const exercise = Exercises.renderENtoTRMC(word, allWords);
  assert.ok(exercise, `EN_TO_TR_MC ${word} should build`);
  assertCleanText(exercise.prompt, `EN_TO_TR_MC ${word} prompt`);
  assertCleanText(exercise.correct, `EN_TO_TR_MC ${word} correct`);
  assertTargetWordNotAnswer(word, exercise.correct, `EN_TO_TR_MC ${word} correct`);
  assertUniqueOptions(exercise.options, `EN_TO_TR_MC ${word}`);
  assert.ok(exercise.options.includes(exercise.correct), `EN_TO_TR_MC ${word} options should include correct answer`);
  exercise.options.forEach((option) => assertTargetWordNotAnswer(word, option, `EN_TO_TR_MC ${word} option`));
}

function testGapFill(word) {
  const exercise = Exercises.renderGapFill(word, allWords);
  assertCleanText(exercise.sentence, `GAP_FILL ${word} sentence`);
  assert.ok(exercise.sentence.includes('___'), `GAP_FILL ${word} should contain a blank`);
  assertCleanText(exercise.hint, `GAP_FILL ${word} hint`);
  assertUniqueOptions(exercise.options, `GAP_FILL ${word}`);
  assert.ok(exercise.options.includes(exercise.correct), `GAP_FILL ${word} options should include correct answer`);
}

function testSentenceBuilder(word) {
  const exercise = Exercises.renderSentenceBuilder(word, allWords);
  assert.ok(exercise, `SENTENCE_BUILDER ${word} should build`);
  assertCleanText(exercise.sentenceTr, `SENTENCE_BUILDER ${word} sentenceTr`);
  assertCleanText(exercise.tr, `SENTENCE_BUILDER ${word} tr`);
  assertCleanText(exercise.correct, `SENTENCE_BUILDER ${word} correct`);
  assert.ok(Array.isArray(exercise.correctTokens) && exercise.correctTokens.length >= 3, `SENTENCE_BUILDER ${word} should have correct tokens`);
  exercise.correctTokens.forEach((token) => {
    assert.ok(exercise.chips.includes(token), `SENTENCE_BUILDER ${word} chips should include token: ${token}`);
  });
}

function testTranslationMc(word) {
  const exercise = Exercises.renderTranslationMC(word, allWords);
  assert.ok(exercise, `TRANSLATION_MC ${word} should build`);
  assertCleanText(exercise.definition, `TRANSLATION_MC ${word} definition`);
  assertCleanText(exercise.correct, `TRANSLATION_MC ${word} correct`);
  assertUniqueOptions(exercise.options, `TRANSLATION_MC ${word}`);
  assert.ok(exercise.options.includes(exercise.correct), `TRANSLATION_MC ${word} options should include correct answer`);
}

function testContextMatch(word) {
  const exercise = Exercises.renderContextMatch(word, allWords);
  if (!exercise) return false;
  assertCleanText(exercise.prompt, `CONTEXT_MATCH ${word} prompt`);
  assertUniqueOptions(exercise.sentences, `CONTEXT_MATCH ${word}`);
  assert.ok(exercise.sentences.includes(exercise.correct), `CONTEXT_MATCH ${word} sentences should include correct answer`);
  return true;
}

function testMultiGap(word, queue) {
  const exercise = Exercises.renderMultiGap(word, queue, allWords);
  if (!exercise) return false;
  assertUniqueOptions(exercise.chips, `MULTI_GAP ${word}`, 4);
  exercise.correctWords.forEach((correct) => assert.ok(exercise.chips.includes(correct), `MULTI_GAP ${word} chips should include ${correct}`));
  exercise.gapSentence.forEach((row, index) => assertCleanText(row.sentence || JSON.stringify(row), `MULTI_GAP ${word} gapSentence[${index}]`));
  return true;
}

function testCollocationMatch(word) {
  const exercise = Exercises.renderCollocationMatch(word, allWords);
  if (!exercise) return false;
  assertCleanText(exercise.prompt, `COLLOCATION_MATCH ${word} prompt`);
  assertUniqueOptions(exercise.options, `COLLOCATION_MATCH ${word}`);
  assert.ok(exercise.options.includes(exercise.correct), `COLLOCATION_MATCH ${word} options should include correct answer`);
  return true;
}

function testErrorCorrection(word) {
  const exercise = Exercises.renderErrorCorrection(word, allWords);
  if (!exercise) return false;
  assertCleanText(exercise.incorrectSentence, `ERROR_CORRECTION ${word} incorrectSentence`);
  assertCleanText(exercise.correctSentence, `ERROR_CORRECTION ${word} correctSentence`);
  assert.notStrictEqual(normalize(exercise.incorrectSentence), normalize(exercise.correctSentence), `ERROR_CORRECTION ${word} incorrect/correct should differ`);
  return true;
}

const ready = readyWords();
assert.ok(ready.length >= 100, `expected many ready words, got ${ready.length}`);

const commonSample = sample(ready, 150);
const sentenceBuilderSupported = ready.filter((word) => Boolean(Exercises.renderSentenceBuilder(word, allWords)));
assert.ok(sentenceBuilderSupported.length >= 100, `expected many sentence-builder capable words, got ${sentenceBuilderSupported.length}`);

commonSample.forEach(testDefinition);
commonSample.forEach(testEnToTr);
commonSample.forEach(testGapFill);
sample(sentenceBuilderSupported, 150).forEach(testSentenceBuilder);
commonSample.forEach(testTranslationMc);

const contextCount = ready.reduce((count, word) => count + (testContextMatch(word) ? 1 : 0), 0);
const multiGapCount = ready.reduce((count, word) => count + (testMultiGap(word, ready.slice(0, 20)) ? 1 : 0), 0);
const collocationCount = ready.reduce((count, word) => count + (testCollocationMatch(word) ? 1 : 0), 0);
const errorCorrectionCount = ready.reduce((count, word) => count + (testErrorCorrection(word) ? 1 : 0), 0);

assert.ok(contextCount >= 10, `expected at least 10 context match exercises, got ${contextCount}`);
assert.ok(multiGapCount >= 10, `expected at least 10 multi-gap exercises, got ${multiGapCount}`);
assert.ok(collocationCount >= 10, `expected at least 10 collocation exercises, got ${collocationCount}`);
assert.ok(errorCorrectionCount >= 10, `expected at least 10 error-correction exercises, got ${errorCorrectionCount}`);

console.log(`exercise quality tests passed: ready=${ready.length}, sentenceBuilder=${sentenceBuilderSupported.length}, sampled=${commonSample.length}, context=${contextCount}, multiGap=${multiGapCount}, collocation=${collocationCount}, errorCorrection=${errorCorrectionCount}`);