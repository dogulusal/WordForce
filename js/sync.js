// WordForge — GitHub Gist Sync
// Stores wf_progress + wf_streak to a private GitHub Gist.
// The Personal Access Token (PAT) needs only the `gist` scope.

const SYNC_TOKEN_KEY = 'wf_gist_token';
const SYNC_GIST_ID_KEY = 'wf_gist_id';
const SYNC_GIST_FILENAME = 'wordforge-progress.json';
const GIST_API = 'https://api.github.com/gists';

function getSyncToken() {
  return localStorage.getItem(SYNC_TOKEN_KEY) || '';
}

function setSyncToken(token) {
  localStorage.setItem(SYNC_TOKEN_KEY, token.trim());
}

function getSyncGistId() {
  return localStorage.getItem(SYNC_GIST_ID_KEY) || '';
}

function setSyncGistId(id) {
  localStorage.setItem(SYNC_GIST_ID_KEY, id);
}

function buildSyncPayload() {
  const progress = JSON.parse(localStorage.getItem('wf_progress') || 'null');
  const streak = JSON.parse(localStorage.getItem('wf_streak') || 'null');
  return {
    progress,
    streak,
    savedAt: new Date().toISOString(),
    version: 1
  };
}

async function saveToGist() {
  const token = getSyncToken();
  if (!token) return { ok: false, message: 'No GitHub token set. Enter your PAT first.' };

  const payload = buildSyncPayload();
  const fileContent = JSON.stringify(payload, null, 2);
  const gistId = getSyncGistId();

  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json'
  };

  try {
    let response;
    if (gistId) {
      response = await fetch(`${GIST_API}/${gistId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          files: { [SYNC_GIST_FILENAME]: { content: fileContent } }
        })
      });
      // If the gist was deleted externally, fall through to create a new one
      if (response.status === 404) {
        setSyncGistId('');
        return saveToGist();
      }
    } else {
      response = await fetch(GIST_API, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: 'WordForge progress backup',
          public: false,
          files: { [SYNC_GIST_FILENAME]: { content: fileContent } }
        })
      });
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 401) return { ok: false, message: 'Invalid or expired token.' };
      return { ok: false, message: err.message || `GitHub API error ${response.status}` };
    }

    const data = await response.json();
    setSyncGistId(data.id);
    return { ok: true, message: `Saved at ${new Date().toLocaleTimeString()}` };
  } catch (e) {
    return { ok: false, message: 'Network error — check your connection.' };
  }
}

async function loadFromGist() {
  const token = getSyncToken();
  if (!token) return { ok: false, message: 'No GitHub token set. Enter your PAT first.' };

  const gistId = getSyncGistId();
  if (!gistId) return { ok: false, message: 'No cloud save found. Save first from this or another device.' };

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json'
  };

  try {
    const response = await fetch(`${GIST_API}/${gistId}`, { headers });

    if (response.status === 401) return { ok: false, message: 'Invalid or expired token.' };
    if (response.status === 404) {
      setSyncGistId('');
      return { ok: false, message: 'Cloud save not found — it may have been deleted.' };
    }
    if (!response.ok) return { ok: false, message: `GitHub API error ${response.status}` };

    const gist = await response.json();
    const file = gist.files?.[SYNC_GIST_FILENAME];
    if (!file) return { ok: false, message: 'Cloud save file is missing or corrupted.' };

    let remote;
    try {
      remote = JSON.parse(file.content);
    } catch {
      return { ok: false, message: 'Cloud save file could not be parsed.' };
    }

    // Conflict resolution: last write wins, based on savedAt timestamp
    const localProgress = JSON.parse(localStorage.getItem('wf_progress') || 'null');
    const localSavedAt = localProgress?._savedAt || null;
    const remoteSavedAt = remote.savedAt || null;

    if (localSavedAt && remoteSavedAt && localSavedAt > remoteSavedAt) {
      return {
        ok: false,
        message: `Local data is newer (${new Date(localSavedAt).toLocaleString()}) than cloud (${new Date(remoteSavedAt).toLocaleString()}). Use "Save to Cloud" to push local data.`
      };
    }

    if (remote.progress) {
      localStorage.setItem('wf_progress', JSON.stringify(remote.progress));
    }
    if (remote.streak) {
      localStorage.setItem('wf_streak', JSON.stringify(remote.streak));
    }

    return {
      ok: true,
      message: `Loaded! Cloud save is from ${new Date(remoteSavedAt).toLocaleString()}. Reloading…`,
      reload: true
    };
  } catch (e) {
    return { ok: false, message: 'Network error — check your connection.' };
  }
}

window.WFSync = { saveToGist, loadFromGist, getSyncToken, setSyncToken, getSyncGistId };
