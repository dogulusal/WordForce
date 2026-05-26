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
  const activeTheme = localStorage.getItem('wf_theme') || 'dark';

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <div class="modal-actions">
          <button class="btn" data-ui-action="close-modal">Close</button>
        </div>
        <hr style="border-color: var(--border); margin: 16px 0;">
        <h3 style="margin-bottom: 8px;">Appearance</h3>
        <div style="font-size:0.8rem; color: var(--text-muted); margin-bottom:8px;">Choose app theme:</div>
        <div class="modal-actions" style="margin-bottom:8px;">
          <button class="btn ${activeTheme === 'dark' ? '' : 'btn-muted'}" data-ui-action="set-theme" data-theme="dark">Dark</button>
          <button class="btn ${activeTheme === 'light' ? '' : 'btn-muted'}" data-ui-action="set-theme" data-theme="light">Light</button>
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

function renderSessionSizeModal(state) {
  const currentSize = state.ui.sessionSize || 10;
  const currentLevel = state.ui.sessionStartLevel || 'ALL';
  const sizeOptions = [5, 10, 15, 20].map((size) => {
    const activeClass = size === currentSize ? '' : 'btn-muted';
    return `<button class="btn ${activeClass}" data-ui-action="select-session-size" data-size="${size}">${size} words</button>`;
  }).join('');
  const levelOptions = ['ALL', 'A1', 'A2', 'B1', 'B2', 'C1'].map((level) => {
    const activeClass = level === currentLevel ? 'active' : '';
    return `<button class="prep-level ${activeClass}" data-action="session-start-select-level" data-level="${level}">${level}</button>`;
  }).join('');

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Start session">
        <h2>Start Session</h2>
        <p>Choose a level and session size.</p>
        <div style="margin-bottom:14px;">
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;">Level</div>
          <div class="prep-levels" style="margin-bottom:0;">${levelOptions}</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;">Session size</div>
          <div class="modal-actions" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
            ${sizeOptions}
          </div>
        </div>
        <div class="modal-actions" style="margin-top:12px;justify-content:space-between;">
          <button class="btn btn-muted" data-ui-action="close-modal">Cancel</button>
          <button class="btn" data-action="session-start-confirm">Start</button>
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
      return { label: 'Remove', action: 'remove-from-known', btnClass: 'btn-muted' };
    }
    if (activeFilter === 'practice') {
      return { label: 'Remove', action: 'remove-from-practice', btnClass: 'btn-muted' };
    }
    return { label: 'Move to Known', action: 'add-to-known', btnClass: '' };
  }

  const rowAction = getWordRowAction(filter);

  const filterDescriptions = {
    practice: 'Words currently in your practice queue.',
    known: 'Words you marked as already known.',
    learned: 'Words you mastered through exercises.',
    review: 'Words due for spaced repetition review.'
  };

  const filterIcons = {
    practice: '🔄',
    known: '✅',
    learned: '🎓',
    review: '📋'
  };

  const filteredEntries = Object.entries(progressWords)
    .filter(([_, data]) => {
      if (filter === 'review') {
        return (data.status === 'learned' || data.status === 'practice') && data.nextReview && data.nextReview <= today;
      }
      return data.status === filter;
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  const wordCount = filteredEntries.length;

  const rows = filteredEntries
    .map(([word, data]) => {
      const tr = allWords[word]?.tr || '';
      const level = allWords[word]?.level || '';
      const levelColor = { A1: '#4caf50', A2: '#8bc34a', B1: '#ffc107', B2: '#ff9800', C1: '#f44336' }[level] || 'var(--text-secondary)';
      return `
        <div class="word-row">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;">
              <strong style="white-space:nowrap;">${escapeHtml(word)}</strong>
              <span style="font-size:0.65rem;padding:1px 5px;border-radius:4px;background:${levelColor}20;color:${levelColor};font-weight:600;">${level}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tr)}</div>
          </div>
          <button class="btn ${rowAction.btnClass} btn-press" style="padding:6px 10px;min-height:34px;font-size:0.82rem;white-space:nowrap;" data-ui-action="${rowAction.action}" data-word="${escapeHtml(word)}">${rowAction.label}</button>
        </div>
      `;
    })
    .join('') || '<p style="padding:20px;text-align:center;color:var(--text-secondary);">No words in this list.</p>';

  // Tab buttons for switching between filters
  const tabs = ['learned', 'known', 'review', 'practice'].map(f => {
    const isActive = f === filter;
    const count = Object.entries(progressWords).filter(([_, d]) => {
      if (f === 'review') return (d.status === 'learned' || d.status === 'practice') && d.nextReview && d.nextReview <= today;
      return d.status === f;
    }).length;
    return `<button class="session-size-btn ${isActive ? 'active' : ''}" style="font-size:0.75rem;padding:5px 10px;min-height:30px;" data-ui-action="switch-word-filter" data-filter="${f}">${filterIcons[f]} ${f} <span style="opacity:0.7;">${count}</span></button>`;
  }).join('');

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Word list" style="max-height:85vh;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h2 style="margin:0;">${filterIcons[filter] || ''} ${escapeHtml(filter)} words</h2>
          <span style="font-size:0.8rem;color:var(--text-secondary);">${wordCount} word${wordCount !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">${tabs}</div>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 10px;">${filterDescriptions[filter] || ''}</p>
        <div class="word-list" style="flex:1;overflow-y:auto;">${rows}</div>
        <div class="modal-actions" style="margin-top:12px;justify-content:space-between;flex-wrap:wrap;">
          <button class="btn btn-press" data-ui-action="start-filter-session" ${wordCount === 0 ? 'disabled' : ''}>Start Session from This List</button>
          <button class="btn btn-muted" data-ui-action="close-modal">Close</button>
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

function renderPrepSessionConfirmModal(state) {
  const picks = [...(state.ui.prepSelectedSession || [])].sort();
  const count = picks.length;
  const chips = picks.map(w =>
    `<button class="session-confirm-chip" data-action="remove-session-pick" data-word="${escapeHtml(w)}" title="Remove">${escapeHtml(w)} ✕</button>`
  ).join('');
  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Confirm session picks" style="max-height:80vh;display:flex;flex-direction:column;">
        <h2 style="margin-bottom:4px;">Start Session</h2>
        <p style="margin-bottom:12px;">You picked <strong>${count}</strong> word${count !== 1 ? 's' : ''}. Tap any word to remove it before starting.</p>
        <div class="session-confirm-chips">${chips || '<p style="color:var(--text-secondary);">No picks — use Back to add words.</p>'}</div>
        <div class="modal-actions" style="margin-top:14px;justify-content:space-between;">
          <button class="btn btn-muted" data-ui-action="close-modal">← Back</button>
          <button class="btn" data-action="confirm-session-picks" ${count === 0 ? 'disabled' : ''}>Start (${count} words)</button>
        </div>
      </div>
    </div>
  `;
}

function renderModal(modalType, state, allWords) {
  switch (modalType) {
    case 'settings':
      return renderSettingsModal();
    case 'sessionSize':
      return renderSessionSizeModal(state);
    case 'wordList':
      return renderWordListModal(state, allWords);
    case 'quitConfirm':
      return renderQuitConfirmModal();
    case 'prepUnsaved':
      return renderPrepUnsavedModal(state);
    case 'prepSessionConfirm':
      return renderPrepSessionConfirmModal(state);
    default:
      return '';
  }
}

window.UI = {
  renderModal
};
