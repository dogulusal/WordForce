// Quick debug script to test Gemini API response format
// Run: node scripts/debug_gemini.js

// Load .env
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function test() {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  
  const prompt = 'Return a JSON array of 5 common A2 English words with Turkish translations. Format: [{"word":"...","pos":"noun","tr":"..."}]. Only return the JSON array, nothing else.';
  
  console.log(`Testing model: ${model}`);
  
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });

  const d = await r.json();
  console.log('HTTP Status:', r.status);
  
  if (!r.ok) {
    console.error('Error:', JSON.stringify(d, null, 2));
    return;
  }
  
  const candidates = d?.candidates || [];
  console.log('Candidates:', candidates.length);
  
  const parts = candidates[0]?.content?.parts || [];
  console.log('Parts count:', parts.length);
  
  parts.forEach((part, i) => {
    console.log(`Part[${i}] keys:`, Object.keys(part));
    if (part.text) {
      console.log(`Part[${i}] text length:`, part.text.length);
      console.log(`Part[${i}] text:`, part.text.substring(0, 500));
    }
    if (part.thought) {
      console.log(`Part[${i}] thinking (first 100 chars):`, String(part.thought || '').substring(0, 100));
    }
  });
}

test().catch(console.error);
