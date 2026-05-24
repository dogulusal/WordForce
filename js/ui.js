function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSettingsModal() {
  const cloudConfig = window.WFCloud ? window.WFCloud.getConfig() : null;
  const supabaseUrl = (cloudConfig && cloudConfig.url) || localStorage.getItem('wf_supabase_url') || window.ENV_SUPABASE_URL || '';
  const hasBuiltInSupabase = Boolean(supabaseUrl);
  const cloudAuth = window.WFCloud ? window.WFCloud.getAuthState() : { configured: false, signedIn: false, userEmail: '' };
  const quickActionHint = cloudAuth.signedIn
    ? 'You are signed in. Use Sync Now to fetch latest progress.'
    : 'Sign in once with GitHub, then use Sync Now anytime.';
  const cloudActionButtons = cloudAuth.signedIn
    ? `
      <button class="btn" data-ui-action="cloud-sync-now">Sync Now</button>
      <button class="btn btn-muted" data-ui-action="cloud-signout">Sign out</button>
    `
    : `
      <button class="btn" data-ui-action="cloud-connect">Connect with GitHub</button>
    `;

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <div class="modal-actions">
          <button class="btn" data-ui-action="close-modal">Close</button>
        </div>
        <hr style="border-color: var(--border); margin: 16px 0;">
        <h3 style="margin-bottom: 8px;">Cloud Sync (Primary: Supabase)</h3>
        <div style="font-size:0.8rem; color: var(--text-muted); margin-bottom:8px;">
          Status: ${cloudAuth.signedIn ? `Signed in as ${escapeHtml(cloudAuth.userEmail)}` : (cloudAuth.configured ? 'Configured, not signed in' : 'Not configured')}
        </div>
        <div style="font-size:0.8rem; color: var(--text-muted); margin-bottom:8px;">
          ${hasBuiltInSupabase ? 'Supabase config is ready in this app.' : 'Supabase config is missing. You can still use GitHub Gist backup below.'}
        </div>
        <div style="font-size:0.8rem; color: var(--text-muted); margin-bottom:8px;">${escapeHtml(quickActionHint)}</div>
        <div id="cloud-status" style="font-size:0.82rem; min-height:1.2em; margin-bottom:8px;"></div>
        <div class="modal-actions">
          ${cloudActionButtons}
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
