# WordForge v3 Setup

## Quick Start

1. **Start HTTP Server:**
   ```bash
   cd c:\Users\dogul\learning_english
   python -m http.server 5501
   ```

2. **Open Browser:**
   ```
   http://localhost:5501
   ```

## Gemini API Key Setup (Optional)

### Option 1: Environment Variable (Recommended)

1. Edit `.env` file:
   ```
   API_KEY=your-gemini-api-key-here
   ```
   
2. Load with environment setup script (coming soon)

### Option 2: Manual Entry

1. Open app → Settings
2. Paste your API key
3. Click Save
4. Key is saved in localStorage (persists across sessions)

> Get API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Features

- **Gate Screen:** Option to go back to home
- **Word List:** Add/Remove buttons for managing words
- **Translation MC:** Fixed to use English sentences only
- **Centered Layout:** Responsive design with vertical centering
- **Auto API Key:** Loads from environment if available

## Project Structure

```
├── index.html           Entry point
├── .env                 API key (git-ignored)
├── .gitignore          Ignores .env, node_modules, etc
├── css/style.css       Warm Night theme + layouts
├── js/
│   ├── app.js          State + routing
│   ├── exercises.js    5 exercise types
│   ├── production.js   Gemini API
│   ├── ui.js           Modals
│   └── progress.js     Spaced repetition
└── data/words_enriched.json  842 A1 words
```

## Controls

- **1-4** — Select option
- **Enter** — Submit answer
- **Backspace** — Remove word (Sentence Builder)
- **Escape** — Close modal

## Notes

- No npm/build system needed (vanilla JS)
- All progress saved to localStorage
- API key never shared (stays local)
