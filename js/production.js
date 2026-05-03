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
  const jsonStr = clean.slice(firstBrace, lastBrace + 1);
  
  // Try to repair common JSON issues
  let repaired = jsonStr
    .replace(/:\s*'([^']*)'/g, ': "$1"')  // Replace single quotes with double quotes
    .replace(/:\s*True/g, ': true')        // Replace True with true
    .replace(/:\s*False/g, ': false');     // Replace False with false
  
  return repaired;
}

async function evaluateProduction(word, userSentence, allWords) {
  const apiKey = localStorage.getItem('wf_api_key') || window.ENV_API_KEY;
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
      temperature: 0.1,
      maxOutputTokens: 200
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
      return { correct: false, feedback: `API error (${response.status}): ${errorText.substring(0, 100)}` };
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Try multiple extraction strategies
    let jsonText = extractJsonObject(raw);
    
    if (!jsonText) {
      // Fallback: just look for "true" or "false" in response
      const hasTrue = raw.toLowerCase().includes('"correct": true');
      return {
        correct: hasTrue,
        feedback: 'Evaluation: ' + raw.substring(0, 150)
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      // Last resort: try to extract just the boolean and craft feedback
      const hasCorrect = jsonText.toLowerCase().includes('true');
      return {
        correct: hasCorrect,
        feedback: 'Sentence evaluated. Keep practicing!'
      };
    }
    
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
