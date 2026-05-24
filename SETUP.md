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

## GitHub Pages Deployment

This repo now includes an Actions workflow at [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

1. Push your changes to the `main` branch.
2. Open GitHub -> Repository Settings -> Pages.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Wait for the `Deploy to GitHub Pages` workflow to finish in the Actions tab.
5. Open your Pages URL:
   - `https://<username>.github.io/<repo>/`
   - For this repo: `https://dogulusal.github.io/WordForce/`

If you used a lowercase path before (`/wordForce/`), switch to the repo-cased path (`/WordForce/`).

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
- **Cloud Sync (Primary):** Supabase + GitHub login (works on phone and desktop)
- **Fallback Backup:** Optional GitHub Gist export/import

## Supabase Cloud Setup (Recommended)

1. Create a Supabase project (free tier).
2. In Supabase SQL Editor, run:

```sql
create table if not exists public.user_progress (
   user_id uuid primary key references auth.users(id) on delete cascade,
   level text not null default 'A1',
   words jsonb not null default '{}'::jsonb,
   streak jsonb not null default '{"currentStreak":0,"lastSessionDate":null,"longestStreak":0}'::jsonb,
   updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

drop policy if exists "select own progress" on public.user_progress;
drop policy if exists "insert own progress" on public.user_progress;
drop policy if exists "update own progress" on public.user_progress;

create policy "select own progress"
on public.user_progress
for select
using (auth.uid() = user_id);

create policy "insert own progress"
on public.user_progress
for insert
with check (auth.uid() = user_id);

create policy "update own progress"
on public.user_progress
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

3. In Supabase Auth -> Providers, enable GitHub provider.
4. In app Settings, fill:
    - Supabase URL
    - Supabase Anon Key
5. Click **Sign in with GitHub**.
6. After login, your progress is synced automatically (cloud is primary, localStorage is cache).

### Optional .env entries

```bash
API_KEY=your-gemini-api-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

If set, these values are auto-loaded on startup.

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
- Progress is cached in localStorage and persisted to Supabase when signed in
- API key never shared (stays local)
