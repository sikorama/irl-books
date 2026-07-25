(() => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');
  const searchInput = document.getElementById('search');
  const formatSelect = document.getElementById('format-filter');
  const genreSelect = document.getElementById('genre-filter');
  const seriesSelect = document.getElementById('series-filter');
  const sortSelect = document.getElementById('sort-select');
  const flagInputs = [...document.querySelectorAll('.flag-filters input[data-flag]')];

  const detailOverlay = document.getElementById('detail-overlay');
  const detailContent = document.getElementById('detail-content');
  const quickGenreOverlay = document.getElementById('quick-genre-overlay');
  const quickGenreTitle = document.getElementById('quick-genre-title');
  const quickGenreSelect = document.getElementById('quick-genre-select');
  const quickGenreStatus = document.getElementById('quick-genre-status');

  const selectionBar = document.getElementById('selection-bar');
  const selectionCount = document.getElementById('selection-count');
  const selectAllCheckbox = document.getElementById('select-all');
  const selectToggleBtn = document.getElementById('select-toggle-btn');
  const cancelSelectBtn = document.getElementById('cancel-select-btn');
  const genreTargetSelect = document.getElementById('genre-target');
  const genreBtn = document.getElementById('genre-btn');

  let currentDocs = [];
  let genreCatalog = [];
  let quickGenreDocId = null;
  let selectMode = false;
  let debounceTimer = null;
  const selectedIds = new Set();

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

  function genreLabel(value) {
    if (!value) return null;
    const entry = genreCatalog.find((g) => g.value === value);
    return entry ? entry.label : value;
  }

  function genreOptionsHtml(selected) {
    return ['<option value="">No genre</option>']
      .concat(genreCatalog.map((g) => `<option value="${escapeHtml(g.value)}" ${g.value === selected ? 'selected' : ''}>${escapeHtml(g.label)}</option>`))
      .join('');
  }

  // La couverture est un fichier du disque servi avec un ETag calculé sur sa
  // taille et sa date : pas besoin du compteur de révision des fiches papier,
  // le navigateur revalide et voit tout de suite un remplacement.
  function coverUrl(doc) {
    return `/api/documents/${doc.id}/cover`;
  }

  function fieldRow(label, inputHtml, { full = false } = {}) {
    return `<div class="field-row${full ? ' full' : ''}"><label>${label}</label>${inputHtml}</div>`;
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (formatSelect.value) params.set('format', formatSelect.value);
    if (genreSelect.value) params.set('genre', genreSelect.value);
    if (seriesSelect.value) params.set('series', seriesSelect.value);
    if (sortSelect.value && sortSelect.value !== 'title') params.set('sort', sortSelect.value);
    for (const input of flagInputs) {
      if (input.checked) params.set(input.dataset.flag, '1');
    }
    return params.toString();
  }

  async function loadGenres() {
    const res = await fetch('/api/genres');
    const data = await res.json();
    genreCatalog = data.genres;

    const current = genreTargetSelect.value;
    genreTargetSelect.innerHTML = '<option value="">🏷️ Change genre…</option>'
      + '<option value="__none__">No genre</option>'
      + genreCatalog.map((g) => `<option value="${escapeHtml(g.value)}">${escapeHtml(g.label)}</option>`).join('');
    genreTargetSelect.value = current;
  }

  // Les facettes sont recomptées à chaque écriture : après une correction de
  // genre ou de série, les compteurs des filtres doivent suivre.
  async function loadFacets() {
    const res = await fetch('/api/documents/facets');
    const data = await res.json();

    const fill = (select, items, allLabel, labelFn) => {
      const current = select.value;
      select.innerHTML = `<option value="">${allLabel}</option>`
        + items.map((it) => `<option value="${escapeHtml(it.value)}">${escapeHtml(labelFn ? labelFn(it) : it.value)} (${it.count})</option>`).join('');
      select.value = current;
    };

    fill(formatSelect, data.formats, 'All formats');
    fill(seriesSelect, data.series, 'All series');

    const currentGenre = genreSelect.value;
    genreSelect.innerHTML = '<option value="">All genres</option>'
      + (data.genres || []).map((it) => `<option value="${escapeHtml(it.value)}">${escapeHtml(genreLabel(it.value) || it.value)} (${it.count})</option>`).join('')
      + `<option value="(aucun)">No genre (${data.no_genre_count || 0})</option>`;
    genreSelect.value = currentGenre;

    return data;
  }

  function toggleSelect(id, checked) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectionUI();
  }

  function updateSelectionUI() {
    selectionCount.textContent = `${selectedIds.size} selected`;
    genreBtn.disabled = selectedIds.size === 0 || !genreTargetSelect.value;
    const idsOnPage = currentDocs.map((d) => d.id);
    selectAllCheckbox.checked = idsOnPage.length > 0 && idsOnPage.every((id) => selectedIds.has(id));
  }

  function setSelectMode(on) {
    selectMode = on;
    selectionBar.classList.toggle('hidden', !on);
    document.body.classList.toggle('select-mode', on);
    if (!on) {
      selectedIds.clear();
      grid.querySelectorAll('.card').forEach((c) => {
        c.classList.remove('selected');
        const input = c.querySelector('.card-select-input');
        if (input) input.checked = false;
      });
    }
    updateSelectionUI();
  }

  function renderCard(doc) {
    const card = document.createElement('div');
    card.className = 'card' + (selectedIds.has(doc.id) ? ' selected' : '');
    card.dataset.id = doc.id;

    const badges = [];
    if (doc.format) badges.push(`<span class="badge location">${escapeHtml(doc.format)}</span>`);
    badges.push(`<span class="badge genre">${escapeHtml(genreLabel(doc.genre) || 'No genre')}</span>`);
    if (doc.missing_count) badges.push('<span class="badge loaned">Missing</span>');

    const subtitle = [doc.pub_year, formatSize(doc.size)].filter(Boolean).join(' · ');

    card.innerHTML = `
      <div class="cover-wrap">
        <label class="card-select">
          <input type="checkbox" class="card-select-input" ${selectedIds.has(doc.id) ? 'checked' : ''}>
        </label>
        <img loading="lazy" src="${coverUrl(doc)}" alt="${escapeHtml(doc.title)}">
        <div class="badges">${badges.join('')}</div>
      </div>
      <div class="meta">
        <p class="title">${escapeHtml(doc.title)}</p>
        <p class="authors">${escapeHtml(doc.authors.join(', ') || '—')}</p>
        <p class="isbn">${escapeHtml(subtitle || '—')}</p>
      </div>
    `;

    card.querySelector('.card-select-input').addEventListener('change', (e) => {
      toggleSelect(doc.id, e.target.checked);
      card.classList.toggle('selected', e.target.checked);
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('.badge.genre')) {
        e.stopPropagation();
        openQuickGenre(doc);
        return;
      }
      if (!selectMode) { openDetail(doc.id); return; }
      if (e.target.closest('.card-select')) return;
      const input = card.querySelector('.card-select-input');
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change'));
    });
    return card;
  }

  function openQuickGenre(doc) {
    quickGenreDocId = doc.id;
    quickGenreTitle.textContent = doc.title;
    quickGenreStatus.textContent = '';
    quickGenreSelect.innerHTML = genreOptionsHtml(doc.genre);
    quickGenreOverlay.classList.remove('hidden');
  }

  quickGenreSelect.addEventListener('change', async () => {
    const genre = quickGenreSelect.value || null;
    quickGenreSelect.disabled = true;
    quickGenreStatus.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/documents/${quickGenreDocId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      quickGenreOverlay.classList.add('hidden');
      await loadDocuments();
    } catch (e) {
      quickGenreStatus.textContent = e.message;
    } finally {
      quickGenreSelect.disabled = false;
    }
  });

  async function loadDocuments() {
    const qs = buildQuery();
    status.textContent = 'Loading…';
    const res = await fetch(`/api/documents${qs ? '?' + qs : ''}`);
    const docs = await res.json();
    currentDocs = docs;
    grid.innerHTML = '';
    for (const doc of docs) grid.appendChild(renderCard(doc));
    empty.classList.toggle('hidden', docs.length > 0);
    const bytes = docs.reduce((sum, d) => sum + (d.size || 0), 0);
    status.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''} · ${formatSize(bytes)}`;
    updateSelectionUI();
  }

  function debouncedLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadDocuments, 200);
  }

  searchInput.addEventListener('input', debouncedLoad);
  [formatSelect, genreSelect, seriesSelect, sortSelect].forEach((el) => el.addEventListener('change', loadDocuments));
  flagInputs.forEach((i) => i.addEventListener('change', loadDocuments));

  selectToggleBtn.addEventListener('click', () => setSelectMode(!selectMode));
  cancelSelectBtn.addEventListener('click', () => setSelectMode(false));
  genreTargetSelect.addEventListener('change', updateSelectionUI);

  selectAllCheckbox.addEventListener('change', () => {
    const idsOnPage = currentDocs.map((d) => d.id);
    if (selectAllCheckbox.checked) idsOnPage.forEach((id) => selectedIds.add(id));
    else idsOnPage.forEach((id) => selectedIds.delete(id));
    grid.querySelectorAll('.card').forEach((card) => {
      const id = Number(card.dataset.id);
      const checked = selectedIds.has(id);
      card.classList.toggle('selected', checked);
      const input = card.querySelector('.card-select-input');
      if (input) input.checked = checked;
    });
    updateSelectionUI();
  });

  genreBtn.addEventListener('click', async () => {
    const raw = genreTargetSelect.value;
    if (!raw || !selectedIds.size) return;
    const genre = raw === '__none__' ? null : raw;
    genreBtn.disabled = true;
    status.textContent = 'Applying genre…';
    try {
      const res = await fetch('/api/documents/set-genre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], genre }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setSelectMode(false);
      await loadDocuments();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      genreBtn.disabled = false;
    }
  });

  async function openDetail(id) {
    const res = await fetch(`/api/documents/${id}`);
    const doc = await res.json();

    // Un document peut porter plusieurs formats du même contenu : chacun a son
    // lien, et un fichier annoncé mais absent du disque est signalé au lieu
    // d'offrir un lien mort.
    const fileList = doc.files.map((f) => {
      const label = `${f.format} · ${formatSize(f.file_size)}`;
      if (f.missing) {
        return `<li class="doc-file missing"><span>${escapeHtml(label)}</span> <em>missing from disk</em></li>`;
      }
      return `<li class="doc-file">
        <a href="/api/documents/${doc.id}/file?format=${encodeURIComponent(f.format)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>
        <a class="doc-download" href="/api/documents/${doc.id}/file?format=${encodeURIComponent(f.format)}&download=1" title="Download">⬇️</a>
      </li>`;
    }).join('');

    const identifierRows = Object.entries(doc.identifiers || {})
      .map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`).join('');

    detailContent.innerHTML = `
      <div class="detail-layout">
        <div class="cover-col">
          <img class="cover" src="${coverUrl(doc)}" alt="${escapeHtml(doc.title)}">
          <ul class="doc-files">${fileList || '<li class="doc-file missing"><em>no file</em></li>'}</ul>
          <p class="doc-path" title="${escapeHtml(doc.dir)}">${escapeHtml(doc.dir)}</p>
        </div>
        <div class="detail-fields">
          ${fieldRow('Title', `<input type="text" class="field-input" data-field="title" value="${escapeHtml(doc.title)}">`, { full: true })}
          ${fieldRow('Author(s)', `<input type="text" class="field-input" data-field="authors" value="${escapeHtml(doc.authors.join(', '))}">`, { full: true })}
          ${fieldRow('Genre', `<select class="field-input" data-field="genre">${genreOptionsHtml(doc.genre)}</select>`)}
          ${fieldRow('Year', `<input type="number" class="field-input" data-field="pub_year" value="${escapeHtml(doc.pub_year || '')}">`)}
          ${fieldRow('Publisher', `<input type="text" class="field-input" data-field="publisher" value="${escapeHtml(doc.publisher || '')}">`)}
          ${fieldRow('Language', `<input type="text" class="field-input" data-field="language" value="${escapeHtml(doc.language || '')}">`)}
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
          ${doc.comments ? `<div class="field-row full doc-comments">${doc.comments}</div>` : ''}
          ${identifierRows ? `<ul class="doc-identifiers">${identifierRows}</ul>` : ''}
          <p class="field-save-status"></p>
        </div>
      </div>
    `;

    const statusEl = detailContent.querySelector('.field-save-status');

    async function saveField(patch) {
      statusEl.textContent = 'Saving…';
      try {
        const saveRes = await fetch(`/api/documents/${doc.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!saveRes.ok) {
          const err = await saveRes.json();
          throw new Error(err.error || 'Unknown error');
        }
        Object.assign(doc, await saveRes.json());
        statusEl.textContent = 'Saved ✓';
        if ('genre' in patch || 'series' in patch) await loadFacets();
        await loadDocuments();
      } catch (err) {
        statusEl.textContent = err.message;
      }
    }

    detailContent.querySelectorAll('.field-input').forEach((input) => {
      input.addEventListener('change', () => {
        const field = input.dataset.field;
        saveField({ [field]: input.type === 'checkbox' ? input.checked : input.value });
      });
    });

    detailOverlay.classList.remove('hidden');
  }

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.overlay').classList.add('hidden'));
  });
  document.querySelectorAll('.overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => o.classList.add('hidden'));
  });

  (async () => {
    await loadGenres();
    await loadFacets();
    await loadDocuments();
  })();
})();
