function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSettingsModal() {
  const apiKey = localStorage.getItem('wf_api_key') || '';
  const model = localStorage.getItem('wf_model') || 'gemma-4-31b-it';
  const envApiKey = window.ENV_API_KEY || '';
  const supabaseUrl = localStorage.getItem('wf_supabase_url') || window.ENV_SUPABASE_URL || '';
  const supabaseAnonKey = localStorage.getItem('wf_supabase_anon_key') || window.ENV_SUPABASE_ANON_KEY || '';
  const cloudAuth = window.WFCloud ? window.WFCloud.getAuthState() : { configured: false, signedIn: false, userEmail: '' };
  const gistToken = (window.WFSync ? window.WFSync.getSyncToken() : '') || '';
  const gistId = (window.WFSync ? window.WFSync.getSyncGistId() : '') || '';

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        ${envApiKey ? `<div style="padding: 8px; margin-bottom: 10px; background: rgba(46,207,149,0.15); border-radius: 8px; font-size: 0.85rem; color: var(--success);">✓ API key loaded from system</div>` : ''}
        <label class="modal-label" for="apiKeyInput">Gemini API Key (optional)</label>
        <input id="apiKeyInput" type="password" value="${escapeHtml(apiKey)}" placeholder="AIza..." class="modal-input">
        <label class="modal-label" for="modelInput">Model</label>
        <input id="modelInput" type="text" value="${escapeHtml(model)}" class="modal-input">
        <div class="modal-actions">
          <button class="btn" data-ui-action="save-settings">Save</button>
          <button class="btn" data-ui-action="close-modal">Close</button>
        </div>
        <hr style="border-color: var(--border); margin: 16px 0;">
        <h3 style="margin-bottom: 8px;">Cloud Sync (Primary: Supabase)</h3>
        <label class="modal-label" for="supabaseUrlInput">Supabase URL</label>
        <input id="supabaseUrlInput" type="text" value="${escapeHtml(supabaseUrl)}" placeholder="https://xyzcompany.supabase.co" class="modal-input">
        <label class="modal-label" for="supabaseAnonKeyInput">Supabase Anon Key</label>
        <input id="supabaseAnonKeyInput" type="password" value="${escapeHtml(supabaseAnonKey)}" placeholder="eyJ..." class="modal-input">
        <div style="font-size:0.8rem; color: var(--text-muted); margin-bottom:8px;">
          Status: ${cloudAuth.signedIn ? `Signed in as ${escapeHtml(cloudAuth.userEmail)}` : (cloudAuth.configured ? 'Configured, not signed in' : 'Not configured')}
        </div>
        <div id="cloud-status" style="font-size:0.82rem; min-height:1.2em; margin-bottom:8px;"></div>
        <div class="modal-actions">
          <button class="btn" data-ui-action="cloud-signin">Sign in with GitHub</button>
          <button class="btn btn-muted" data-ui-action="cloud-sync-now">Sync Now</button>
          <button class="btn btn-muted" data-ui-action="cloud-signout">Sign out</button>
        </div>
        <hr style="border-color: var(--border); margin: 16px 0;">
        <h3 style="margin-bottom: 8px;">Cloud Sync (GitHub Gist)</h3>
        <p style="font-size:0.8rem; color: var(--text-muted); margin-bottom: 8px;">
          Optional fallback backup. Create a token at <strong>github.com → Settings → Developer settings → Personal access tokens</strong> with <code>gist</code> scope only.
        </p>
        <label class="modal-label" for="gistTokenInput">Personal Access Token</label>
        <input id="gistTokenInput" type="password" value="${escapeHtml(gistToken)}" placeholder="ghp_..." class="modal-input">
        ${gistId ? `<div style="font-size:0.75rem; color: var(--text-muted); margin-bottom:6px;">Gist ID: ${escapeHtml(gistId)}</div>` : ''}
        <div id="sync-status" style="font-size:0.82rem; min-height:1.2em; margin-bottom:8px;"></div>
        <div class="modal-actions">
          <button class="btn" data-ui-action="sync-save">Save to Cloud</button>
          <button class="btn btn-muted" data-ui-action="sync-load">Load from Cloud</button>
        </div>
        <hr style="border-color: var(--border); margin: 16px 0;">
        <h3 style="margin-bottom: 8px;">Data</h3>
        <div class="modal-actions">
          <button class="btn btn-muted" data-ui-action="export-progress">Export Progress</button>
          <label class="btn btn-muted" style="cursor:pointer;">Import Progress<input type="file" id="importFileInput" accept=".json" style="display:none;"></label>
        </div>
      </div>
    </div>
  `;
}

function renderWordListModal(state, allWords) {
  const filter = state.ui.wordListFilter || 'practice';
  const progressWords = state.progress.words || {};
  const today = new Date().toLocaleDateString('en-CA');

  function getWordRowAction(activeFilter) {
    if (activeFilter === 'known') {
      return { label: 'Remove', action: 'remove-from-known' };
    }
    if (activeFilter === 'practice') {
      return { label: 'Remove', action: 'remove-from-practice' };
    }
    return { label: 'Move to Known', action: 'add-to-known' };
  }

  const rowAction = getWordRowAction(filter);
  const actionHelp = filter === 'practice'
    ? 'Remove clears this word from the practice list.'
    : filter === 'known'
      ? 'Remove sends this word back to the active pool.'
      : 'Move to Known marks the word as known and removes it from active study.';

  const rows = Object.entries(progressWords)
    .filter(([_, data]) => {
      if (filter === 'review') {
        return (data.status === 'learned' || data.status === 'practice') && data.nextReview && data.nextReview <= today;
      }
      return data.status === filter;
    })
    .map(([word, data]) => {
      const tr = allWords[word]?.tr || '';
      return `
        <div class="word-row">
          <div style="flex:1;">
            <div><strong>${escapeHtml(word)}</strong> - ${escapeHtml(tr)}</div>
          </div>
          <div class="word-row-meta">${escapeHtml(data.status || '')}</div>
          <button class="btn" style="padding: 6px 10px; min-height: 34px; font-size: 0.85rem; margin-left: 8px;" data-ui-action="${rowAction.action}" data-word="${escapeHtml(word)}">${rowAction.label}</button>
        </div>
      `;
    })
    .join('') || '<p>No words in this list.</p>';

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Word list">
        <h2>${escapeHtml(filter)} words</h2>
        <p>${escapeHtml(actionHelp)}</p>
        <div class="word-list">${rows}</div>
        <div class="modal-actions">
          <button class="btn" data-ui-action="close-modal">Close</button>
        </div>
      </div>
    </div>
  `;
}

function renderQuitConfirmModal() {
  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Quit session">
        <h2>End this session?</h2>
        <p>Progress so far will be saved.</p>
        <div class="modal-actions">
          <button class="btn" data-ui-action="quit-session">End Session</button>
          <button class="btn" data-ui-action="close-modal">Keep Going</button>
        </div>
      </div>
    </div>
  `;
}

function renderPrepUnsavedModal(state) {
  const pendingAction = state.ui.prepPendingAction === 'start' ? 'start the session' : 'leave this screen';
  const selectedCount = (state.ui.prepSelectedKnown || []).length;

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Unsaved known words">
        <h2>Unsaved changes</h2>
        <p>You marked ${selectedCount} word${selectedCount === 1 ? '' : 's'} as known but have not saved yet.</p>
        <p>Save them first, or continue without saving before you ${escapeHtml(pendingAction)}.</p>
        <div class="modal-actions">
          <button class="btn" data-ui-action="prep-save-and-continue">Save and Continue</button>
          <button class="btn btn-muted" data-ui-action="prep-discard-and-continue">Continue Without Saving</button>
          <button class="btn btn-muted" data-ui-action="close-modal">Stay Here</button>
        </div>
      </div>
    </div>
  `;
}

function renderModal(modalType, state, allWords) {
  switch (modalType) {
    case 'settings':
      return renderSettingsModal();
    case 'wordList':
      return renderWordListModal(state, allWords);
    case 'quitConfirm':
      return renderQuitConfirmModal();
    case 'prepUnsaved':
      return renderPrepUnsavedModal(state);
    default:
      return '';
  }
}

window.UI = {
  renderModal
};
