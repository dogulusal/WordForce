function renderProduction(word, allWords) {
  return {
    type: 'PRODUCTION',
    prompt: `Write your own sentence using '${word}'.`,
    word,
    pos: allWords[word]?.pos || 'unknown'
  };
}

function toProductionResult(correct, feedback, correctedSentence = '') {
  return {
    correct: Boolean(correct),
    feedback: feedback || '',
    correctedSentence: correctedSentence || ''
  };
}

function extractJsonObject(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const jsonStr = clean.slice(firstBrace, lastBrace + 1);
  
  // Try to repair common JSON issues
  let repaired = jsonStr
    .replace(/:\s*'([^']*)'/g, ': "$1"')  // Replace single quotes with double quotes
    .replace(/:\s*True/g, ': true')        // Replace True with true
    .replace(/:\s*False/g, ': false');     // Replace False with false
  
  return repaired;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function callGeminiWithRetry(url, payload, maxAttempts = 3) {
  const TIMEOUT_MS = 8000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, TIMEOUT_MS);

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
          continue;
        }
        return { ok: false, error: `Server error (${res.status}). Please try again shortly.` };
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { ok: false, error: `API error (${res.status}).` };
      }

      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt < maxAttempts) continue;
        return { ok: false, error: 'Request timed out. Check your connection and try again.' };
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
        continue;
      }
      return { ok: false, error: 'Connection failed. Please try again.' };
    }
  }
  return { ok: false, error: 'All attempts failed.' };
}

async function evaluateProduction(word, userSentence, allWords) {
  const apiKey = localStorage.getItem('wf_api_key') || window.ENV_API_KEY;
  if (!apiKey) {
    return toProductionResult(false, 'No API key — go to Settings to add your Gemini key.');
  }

  const pos = allWords[word]?.pos || 'unknown';
  const model = localStorage.getItem('wf_model') || 'gemma-4-31b-it';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      role: 'user',
      parts: [{
        text: [
          `Evaluate whether this English sentence uses the word "${word}" (${pos}) correctly.`,
          `Sentence: "${userSentence}"`,
          ``,
          `Reply ONLY with valid JSON on a single line, no markdown:`,
          `{"correct":true,"feedback":"one sentence"}`,
          `or if wrong:`,
          `{"correct":false,"feedback":"brief error description","correctedSentence":"improved version"}`
        ].join('\n')
      }]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 150 }
  };

  const { ok, data, error } = await callGeminiWithRetry(url, payload);
  if (!ok) return toProductionResult(false, error);

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonText = extractJsonObject(raw);

  if (!jsonText) {
    const strictCorrect = /"correct"\s*:\s*true/i.test(raw);
    return toProductionResult(strictCorrect, strictCorrect ? 'Looks correct!' : 'Could not read the model response clearly. Please try again.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_) {
    const strictCorrect = /"correct"\s*:\s*true/i.test(jsonText);
    return toProductionResult(strictCorrect, strictCorrect ? 'Looks correct!' : 'Model response was unclear. Please try again.');
  }

  return toProductionResult(
    Boolean(parsed.correct),
    parsed.feedback || (parsed.correct ? 'Well done!' : 'Something seems off — try again.'),
    parsed.correctedSentence || parsed.suggestion || ''
  );
}

window.Production = {
  renderProduction,
  evaluateProduction
};
