// WordForge — Supabase Cloud Sync (primary persistence)

const WF_LOCAL_UPDATED_KEY = 'wf_local_updated_at';
const WF_SUPABASE_URL_KEY = 'wf_supabase_url';
const WF_SUPABASE_ANON_KEY = 'wf_supabase_anon_key';

// Default project config — anon key is public by design, RLS protects user data
const BUILTIN_SUPABASE_URL = 'https://iubqmclazvkdcyzfgxkg.supabase.co';
const BUILTIN_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1YnFtY2xhenZrZGN5emZneGtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2Mjc0MzUsImV4cCI6MjA5NTIwMzQzNX0.xc64QzxqID2GoXjf-sA1A3TeB9RZVTxqd8GCMPi5v5M';

const DEFAULT_STREAK = { currentStreak: 0, lastSessionDate: null, longestStreak: 0 };

const CloudState = {
  client: null,
  user: null,
  pushTimer: null,
  applyingRemote: false,
  onRemoteApplied: null,
  onStatus: null,
};

function getConfig() {
  return {
    url: localStorage.getItem(WF_SUPABASE_URL_KEY) || BUILTIN_SUPABASE_URL,
    anonKey: localStorage.getItem(WF_SUPABASE_ANON_KEY) || BUILTIN_SUPABASE_ANON_KEY,
  };
}

function setConfig(url, anonKey) {
  localStorage.setItem(WF_SUPABASE_URL_KEY, (url || '').trim());
  localStorage.setItem(WF_SUPABASE_ANON_KEY, (anonKey || '').trim());
}

function emitStatus(message, ok = true) {
  if (typeof CloudState.onStatus === 'function') {
    CloudState.onStatus({ message, ok });
  }
}

function localTimeMs() {
  const value = localStorage.getItem(WF_LOCAL_UPDATED_KEY);
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function remoteTimeMs(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLocalSnapshot() {
  const progress = JSON.parse(localStorage.getItem('wf_progress') || '{"level":"A1","words":{}}');
  const streak = JSON.parse(localStorage.getItem('wf_streak') || JSON.stringify(DEFAULT_STREAK));
  return {
    progress,
    streak,
    localUpdatedAt: localStorage.getItem(WF_LOCAL_UPDATED_KEY),
  };
}

function mirrorProgressToLegacy(progress) {
  const payload = JSON.stringify(progress);
  localStorage.setItem('wf_progress', payload);
  localStorage.setItem('wordforge_progress', payload);
  localStorage.setItem('progress', payload);
}

function applyRemoteSnapshot(remoteRow) {
  const remoteProgress = {
    level: remoteRow.level || 'A1',
    words: remoteRow.words || {},
  };
  const remoteStreak = remoteRow.streak || DEFAULT_STREAK;

  CloudState.applyingRemote = true;
  mirrorProgressToLegacy(remoteProgress);
  localStorage.setItem('wf_streak', JSON.stringify(remoteStreak));
  if (remoteRow.updated_at) {
    localStorage.setItem(WF_LOCAL_UPDATED_KEY, remoteRow.updated_at);
  }
  CloudState.applyingRemote = false;

  if (typeof CloudState.onRemoteApplied === 'function') {
    CloudState.onRemoteApplied(remoteProgress);
  }
}

async function pushLocalToCloud() {
  if (!CloudState.client || !CloudState.user) return { ok: false, message: 'Not signed in.' };
  if (CloudState.applyingRemote) return { ok: true, message: 'Skipping push while applying remote data.' };

  const { progress, streak } = getLocalSnapshot();
  const updatedAt = new Date().toISOString();

  const payload = {
    user_id: CloudState.user.id,
    level: progress.level || 'A1',
    words: progress.words || {},
    streak: streak || DEFAULT_STREAK,
    updated_at: updatedAt,
  };

  const { error } = await CloudState.client
    .from('user_progress')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    return { ok: false, message: error.message || 'Failed to push data to cloud.' };
  }

  localStorage.setItem(WF_LOCAL_UPDATED_KEY, updatedAt);
  return { ok: true, message: 'Cloud sync complete.' };
}

async function pullFromCloud() {
  if (!CloudState.client || !CloudState.user) return { ok: false, message: 'Not signed in.' };

  const { data, error } = await CloudState.client
    .from('user_progress')
    .select('level, words, streak, updated_at')
    .eq('user_id', CloudState.user.id)
    .maybeSingle();

  if (error) return { ok: false, message: error.message || 'Failed to fetch cloud data.' };

  if (!data) {
    // First sign-in on this account: seed cloud from local state.
    return pushLocalToCloud();
  }

  const localMs = localTimeMs();
  const remoteMs = remoteTimeMs(data.updated_at);

  if (remoteMs > localMs) {
    applyRemoteSnapshot(data);
    return { ok: true, message: 'Loaded newer cloud progress.' };
  }

  if (localMs > remoteMs) {
    return pushLocalToCloud();
  }

  return { ok: true, message: 'Local and cloud are already in sync.' };
}

function schedulePush() {
  if (!CloudState.client || !CloudState.user || CloudState.applyingRemote) return;

  if (CloudState.pushTimer) {
    clearTimeout(CloudState.pushTimer);
  }

  CloudState.pushTimer = setTimeout(async () => {
    CloudState.pushTimer = null;
    const result = await pushLocalToCloud();
    if (!result.ok) emitStatus(result.message, false);
  }, 1500);
}

async function init(options = {}) {
  CloudState.onRemoteApplied = options.onRemoteApplied || null;
  CloudState.onStatus = options.onStatus || null;

  const { url, anonKey } = getConfig();
  if (!url || !anonKey) {
    emitStatus('Supabase is not configured yet.', false);
    return { ok: false, message: 'Missing Supabase URL/Anon key.' };
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    emitStatus('Supabase client library is missing.', false);
    return { ok: false, message: 'Supabase client is unavailable.' };
  }

  CloudState.client = window.supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const { data: { session } } = await CloudState.client.auth.getSession();
  CloudState.user = session?.user || null;

  CloudState.client.auth.onAuthStateChange(async (_event, newSession) => {
    CloudState.user = newSession?.user || null;
    if (!CloudState.user) {
      emitStatus('Signed out from cloud.', true);
      return;
    }
    const result = await pullFromCloud();
    emitStatus(result.message, result.ok);
  });

  if (CloudState.user) {
    const result = await pullFromCloud();
    emitStatus(result.message, result.ok);
    return result;
  }

  emitStatus('Not signed in. Use GitHub login to enable cloud sync.', false);
  return { ok: true, message: 'Supabase configured.' };
}

async function signInWithGitHub() {
  if (!CloudState.client) return { ok: false, message: 'Configure Supabase first.' };

  // Use a stable callback URL without hash/query so OAuth callback params are readable.
  const redirectUrl = new URL(window.location.href);
  redirectUrl.search = '';
  redirectUrl.hash = '';
  const redirectTo = redirectUrl.toString();

  const { error } = await CloudState.client.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo },
  });

  if (error) return { ok: false, message: error.message || 'GitHub sign-in failed.' };
  return { ok: true, message: 'Redirecting to GitHub…' };
}

async function signOut() {
  if (!CloudState.client) return { ok: false, message: 'Cloud client is not initialized.' };

  const { error } = await CloudState.client.auth.signOut();
  if (error) return { ok: false, message: error.message || 'Sign-out failed.' };
  CloudState.user = null;
  return { ok: true, message: 'Signed out.' };
}

function getAuthState() {
  const { url, anonKey } = getConfig();
  return {
    configured: Boolean(url && anonKey),
    signedIn: Boolean(CloudState.user),
    userEmail: CloudState.user?.email || '',
  };
}

function notifyLocalChange() {
  schedulePush();
}

async function syncNow() {
  if (!CloudState.user) return { ok: false, message: 'Sign in first.' };
  return pullFromCloud();
}

window.WFCloud = {
  init,
  setConfig,
  getConfig,
  getAuthState,
  signInWithGitHub,
  signOut,
  syncNow,
  notifyLocalChange,
};
