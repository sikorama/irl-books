// Panneau détail d'un document, partagé par les deux pages qui peuvent l'ouvrir :
// la page Cloud (filtres propres au numérique) et le catalogue principal, où le
// cloud est une pièce parmi les autres et où une carte cliquée peut être aussi
// bien un livre papier qu'un document.
window.DocDetail = (() => {
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  function fieldRow(label, inputHtml, { full = false } = {}) {
    return `<div class="field-row${full ? ' full' : ''}"><label>${label}</label>${inputHtml}</div>`;
  }

  function fileListHtml(doc) {
    // Un document peut porter plusieurs formats du même contenu : chacun a son
    // lien, et un fichier annoncé mais absent du disque est signalé au lieu
    // d'offrir un lien mort.
    const items = doc.files.map((f) => {
      const label = `${f.format} · ${formatSize(f.file_size)}`;
      if (f.missing) {
        return `<li class="doc-file missing"><span>${escapeHtml(label)}</span> <em>missing from disk</em></li>`;
      }
      const base = `/api/documents/${doc.id}/file?format=${encodeURIComponent(f.format)}`;
      return `<li class="doc-file">
        <a href="${base}" target="_blank" rel="noopener">${escapeHtml(label)}</a>
        <a class="doc-download" href="${base}&download=1" title="Download">⬇️</a>
      </li>`;
    }).join('');
    return items || '<li class="doc-file missing"><em>no file</em></li>';
  }

  // Liste fermée, chargée une seule fois et mémorisée : la langue n'est pas un
  // champ libre, sinon « fr », « fra » et « Français » finiraient par coexister.
  let languages = null;

  async function loadLanguages(uiLang) {
    if (languages) return languages;
    const res = await fetch(`/api/languages?lang=${encodeURIComponent(uiLang || 'fr')}`);
    const data = await res.json().catch(() => ({}));
    languages = data.languages || [];
    return languages;
  }

  function languageOptionsHtml(selected) {
    return ['<option value="">—</option>']
      .concat((languages || []).map((l) => `<option value="${escapeHtml(l.code)}" ${l.code === selected ? 'selected' : ''}>${escapeHtml(l.label)}</option>`))
      .join('');
  }

  // `genreOptionsHtml` et `onSaved` sont fournis par la page appelante : chacune
  // a son propre catalogue de genres déjà chargé et sa propre grille à
  // rafraîchir après une écriture.
  async function open({ id, container, overlay, genreOptionsHtml, onSaved }) {
    await loadLanguages(localStorage.getItem('irl-books:lang') || 'fr');
    const res = await fetch(`/api/documents/${id}`);
    if (!res.ok) return;
    const doc = await res.json();

    const identifierRows = Object.entries(doc.identifiers || {})
      .map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`).join('');

    container.innerHTML = `
      <div class="detail-layout">
        <div class="cover-col">
          <img class="cover" src="/api/documents/${doc.id}/cover" alt="${escapeHtml(doc.title)}">
          <ul class="doc-files">${fileListHtml(doc)}</ul>
          <p class="doc-path" title="${escapeHtml(doc.dir)}">${escapeHtml(doc.dir)}</p>
        </div>
        <div class="detail-fields">
          ${fieldRow('Title', `<input type="text" class="field-input" data-field="title" value="${escapeHtml(doc.title)}">`, { full: true })}
          ${fieldRow('Author(s)', `<input type="text" class="field-input" data-field="authors" value="${escapeHtml(doc.authors.join(', '))}">`, { full: true })}
          ${fieldRow('Genre', `<select class="field-input" data-field="genre">${genreOptionsHtml(doc.genre)}</select>`)}
          ${fieldRow('Year', `<input type="number" class="field-input" data-field="pub_year" value="${escapeHtml(doc.pub_year || '')}">`)}
          ${fieldRow('Publisher', `<input type="text" class="field-input" data-field="publisher" value="${escapeHtml(doc.publisher || '')}">`)}
          ${fieldRow('Language', `<select class="field-input" data-field="language">${languageOptionsHtml(doc.language)}</select>`)}
          ${fieldRow('Series', `<input type="text" class="field-input" data-field="series" value="${escapeHtml(doc.series || '')}">`)}
          ${fieldRow('No. in series', `<input type="number" step="any" class="field-input" data-field="series_index" value="${escapeHtml(doc.series_index ?? '')}">`)}
          ${fieldRow('DOI', `<input type="text" class="field-input" data-field="doi" value="${escapeHtml(doc.doi || '')}">`)}
          ${fieldRow('ISBN', `<input type="text" class="field-input" data-field="isbn" value="${escapeHtml(doc.isbn || '')}">`)}
          ${fieldRow('Tags, comma-separated', `<input type="text" class="field-input" data-field="tags" value="${escapeHtml(doc.tags.join(', '))}">`, { full: true })}
          ${fieldRow('Notes', `<textarea class="field-input" data-field="notes" rows="3">${escapeHtml(doc.notes || '')}</textarea>`, { full: true })}
          <div class="field-row full doc-facts">
            <span>${escapeHtml(doc.format || '—')}</span>
            <span>${formatSize(doc.size)}</span>
            ${doc.pages ? `<span>${doc.pages} pages</span>` : ''}
            <span>added ${escapeHtml((doc.created_at || '').slice(0, 10))}</span>
            <span>metadata: ${escapeHtml(doc.meta_source || '—')}</span>
            ${doc.indexed ? '<span>indexed</span>' : ''}
          </div>
          ${doc.comments ? `<div class="field-row full doc-comments">${escapeHtml(doc.comments)}</div>` : ''}
          ${identifierRows ? `<ul class="doc-identifiers">${identifierRows}</ul>` : ''}
          <p class="field-save-status"></p>
        </div>
      </div>
    `;

    const statusEl = container.querySelector('.field-save-status');

    async function saveField(patch) {
      statusEl.textContent = 'Saving…';
      try {
        const saveRes = await fetch(`/api/documents/${doc.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!saveRes.ok) {
          const err = await saveRes.json().catch(() => ({}));
          throw new Error(err.error || `Not saved (HTTP ${saveRes.status})`);
        }
        Object.assign(doc, await saveRes.json());
        statusEl.textContent = 'Saved ✓';
        if (onSaved) await onSaved(patch, doc);
      } catch (err) {
        statusEl.textContent = err.message;
      }
    }

    container.querySelectorAll('.field-input').forEach((input) => {
      input.addEventListener('change', () => {
        saveField({ [input.dataset.field]: input.type === 'checkbox' ? input.checked : input.value });
      });
    });

    overlay.classList.remove('hidden');
  }

  return { open, formatSize };
})();
