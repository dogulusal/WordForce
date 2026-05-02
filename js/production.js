function renderProduction(word, allWords) {
  return {
    type: 'PRODUCTION',
    prompt: `Write your own sentence using '${word}'.`,
    word,
    pos: allWords[word]?.pos || 'unknown'
  };
}

function extractJsonObject(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return clean.slice(firstBrace, lastBrace + 1);
}

async function evaluateProduction(word, userSentence, allWords) {
  const apiKey = localStorage.getItem('wf_api_key');
  if (!apiKey) {
    return { correct: false, feedback: 'API key not configured in Settings.' };
  }

  const pos = allWords[word]?.pos || 'unknown';
  const model = localStorage.getItem('wf_model') || 'gemma-4-31b-it';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      role: 'user',
      parts: [{
        text: `Evaluate this sentence for correct use of the word "${word}" (${pos}).\nSentence: "${userSentence}"\nReply in JSON only: { "correct": true/false, "feedback": "one sentence explanation" }\nIf correct, feedback should confirm why it works.\nIf incorrect, explain the specific error clearly in one sentence.`
      }]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 300
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { correct: false, feedback: `API error (${response.status}): ${errorText}` };
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonText = extractJsonObject(raw);

    if (!jsonText) {
      return { correct: false, feedback: 'Could not parse model response. Please try again.' };
    }

    const parsed = JSON.parse(jsonText);
    return {
      correct: Boolean(parsed.correct),
      feedback: parsed.feedback || 'No feedback provided.'
    };
  } catch (error) {
    return { correct: false, feedback: `Network/API failure: ${error.message}` };
  }
}

window.Production = {
  renderProduction,
  evaluateProduction
};
