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
      </div>
    </div>
  `;
}

function renderWordListModal(state, allWords) {
  const filter = state.ui.wordListFilter || 'practice';
  const progressWords = state.progress.words || {};
  const today = new Date().toLocaleDateString('en-CA');

  const rows = Object.entries(progressWords)
    .filter(([_, data]) => {
      if (filter === 'review') {
        return (data.status === 'learned' || data.status === 'practice') && data.nextReview && data.nextReview <= today;
      }
      return data.status === filter;
    })
    .map(([word, data]) => {
      const tr = allWords[word]?.tr || '';
      const btnLabel = filter === 'known' ? '✕ Remove' : '+ Add';
      const btnAction = filter === 'known' ? 'remove-from-known' : 'add-to-known';
      return `
        <div class="word-row">
          <div style="flex:1;"><strong>${escapeHtml(word)}</strong> - ${escapeHtml(tr)}</div>
          <div class="word-row-meta">${escapeHtml(data.status || '')}</div>
          <button class="btn" style="padding: 6px 10px; min-height: 34px; font-size: 0.85rem; margin-left: 8px;" data-ui-action="${btnAction}" data-word="${escapeHtml(word)}">${btnLabel}</button>
        </div>
      `;
    })
    .join('') || '<p>No words in this list.</p>';

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Word list">
        <h2>${escapeHtml(filter)} words</h2>
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
