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

  return `
    <div class="modal-overlay" onclick="if(event.target===this) handleUiAction('close-modal')">
      <div class="modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <label class="modal-label" for="apiKeyInput">Gemini API Key</label>
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
      return `
        <div class="word-row">
          <div><strong>${escapeHtml(word)}</strong> - ${escapeHtml(tr)}</div>
          <div class="word-row-meta">${escapeHtml(data.status || '')}</div>
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

function renderModal(modalType, state, allWords) {
  switch (modalType) {
    case 'settings':
      return renderSettingsModal();
    case 'wordList':
      return renderWordListModal(state, allWords);
    case 'quitConfirm':
      return renderQuitConfirmModal();
    default:
      return '';
  }
}

window.UI = {
  renderModal
};
