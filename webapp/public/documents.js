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
  const inTextToggle = document.getElementById('in-text');
  const indexBar = document.getElementById('index-bar');
  const indexSummary = document.getElementById('index-summary');
  const indexProgress = document.getElementById('index-progress');
  const indexStartBtn = document.getElementById('index-start-btn');
  const indexCancelBtn = document.getElementById('index-cancel-btn');
  const indexLogWrap = document.getElementById('index-log-wrap');
  const indexLog = document.getElementById('index-log');

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

  // En mode plein texte, l'ordre vient de la pertinence et les indicateurs
  // d'anomalie ne s'appliquent pas : les contrôles correspondants sont désactivés
  // plutôt que d'être ignorés en silence.
  function textMode() {
    return inTextToggle.checked && searchInput.value.trim().length > 0;
  }

  function syncControls() {
    const inText = inTextToggle.checked;
    sortSelect.disabled = inText;
    flagInputs.forEach((i) => { i.disabled = inText; });
    sortSelect.title = inText ? 'Sorted by relevance in full-text mode' : 'Sort';
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (formatSelect.value) params.set('format', formatSelect.value);
    if (genreSelect.value) params.set('genre', genreSelect.value);
    if (seriesSelect.value) params.set('series', seriesSelect.value);
    if (textMode()) {
      params.set('in_text', '1');
      return params.toString();
    }
    if (sortSelect.value && sortSelect.value !== 'title') params.set('sort', sortSelect.value);
    for (const input of flagInputs) {
      if (input.checked) params.set(input.dataset.flag, '1');
    }
    return params.toString();
  }

  function uiLang() {
    return localStorage.getItem('irl-books:lang') || 'fr';
  }

  async function loadGenres() {
    const res = await fetch(`/api/genres?lang=${encodeURIComponent(uiLang())}`);
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
    // Lien direct vers le fichier : le geste le plus fréquent sur un document ne
    // passe pas par la fiche. Le navigateur choisit d'ouvrir ou de télécharger
    // selon le format.
    if (doc.format) {
      badges.push(doc.file_count
        ? `<a class="badge location" href="/api/documents/${doc.id}/file" target="_blank" rel="noopener" title="Open ${escapeHtml(doc.format)}">${escapeHtml(doc.format)}</a>`
        : `<span class="badge location">${escapeHtml(doc.format)}</span>`);
    }
    badges.push(`<span class="badge genre">${escapeHtml(genreLabel(doc.genre) || 'No genre')}</span>`);
    if (doc.missing_count) badges.push('<span class="badge loaned">Missing</span>');
    else if (!doc.file_count) badges.push('<span class="badge loaned">No file</span>');

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
        ${doc.snippet ? `<p class="doc-snippet">${doc.snippet}</p>` : ''}
      </div>
    `;

    card.querySelector('.card-select-input').addEventListener('change', (e) => {
      toggleSelect(doc.id, e.target.checked);
      card.classList.toggle('selected', e.target.checked);
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('a.badge')) { e.stopPropagation(); return; }
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
    const label = `${docs.length} document${docs.length !== 1 ? 's' : ''} · ${formatSize(bytes)}`;
    status.textContent = textMode() ? `${label} · by relevance` : label;
    updateSelectionUI();
  }

  function debouncedLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadDocuments, 200);
  }

  searchInput.addEventListener('input', debouncedLoad);
  inTextToggle.addEventListener('change', () => { syncControls(); loadDocuments(); });
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
    await window.DocDetail.open({
      id,
      container: detailContent,
      overlay: detailOverlay,
      genreOptionsHtml,
      onSaved: async (patch) => {
        if ('genre' in patch || 'series' in patch) await loadFacets();
        await loadDocuments();
      },
    });
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

  // --- Indexation du texte -------------------------------------------------
  //
  // Le travail dure vingt à quarante minutes côté serveur : la page ne fait que
  // sonder son état. Le sondage s'arrête dès que le travail est fini, pour ne pas
  // interroger le serveur indéfiniment.
  let indexPollTimer = null;

  function renderIndexState(state) {
    const running = !!state.running;
    const pending = state.pending;

    indexStartBtn.classList.toggle('hidden', running);
    indexCancelBtn.classList.toggle('hidden', !running);
    indexProgress.classList.toggle('hidden', !running || !state.total);

    if (running) {
      const pct = state.total ? Math.round((state.processed / state.total) * 100) : 0;
      indexProgress.value = pct;
      const current = state.current ? ` · ${state.current.title}` : '';
      indexSummary.textContent = `Indexing ${state.processed}/${state.total} (${pct}%)`
        + ` · ${state.indexed} done · ${state.failed} failed${current}`;
    } else if (state.error) {
      indexSummary.textContent = `Indexing stopped: ${state.error}`;
    } else if (state.finished) {
      indexSummary.textContent = `Indexed ${state.indexed} document(s)`
        + (state.empty ? `, ${state.empty} with no usable text` : '')
        + (state.failed ? `, ${state.failed} failed` : '')
        + (pending ? ` · ${pending} still to do` : ' · index up to date');
    } else if (pending === null) {
      indexSummary.textContent = 'Full-text index unavailable';
    } else if (pending === 0) {
      indexSummary.textContent = 'Full-text index up to date';
    } else {
      indexSummary.textContent = `${pending} document(s) not indexed yet`;
    }

    // Le journal ne retient que les anomalies : un PDF sans couche texte est
    // presque toujours un scan, et c'est la liste de ce qui gagnerait une OCR.
    const entries = state.log || [];
    indexLogWrap.classList.toggle('hidden', entries.length === 0);
    if (entries.length) {
      indexLog.innerHTML = entries.map((e) => `<li>${escapeHtml(e.title || '#' + e.id)}`
        + ` — ${escapeHtml(e.status === 'empty' ? 'no text (scan?)' : e.error || e.status)}</li>`).join('');
    }

    // Une seule condition pour continuer à sonder : le travail tourne encore.
    if (running) {
      if (!indexPollTimer) indexPollTimer = setInterval(pollIndex, 1500);
    } else if (indexPollTimer) {
      clearInterval(indexPollTimer);
      indexPollTimer = null;
      loadFacets();
      loadDocuments();
    }
  }

  async function pollIndex() {
    try {
      const res = await fetch('/api/documents/index');
      renderIndexState(await res.json());
    } catch {
      // Serveur momentanément occupé par une extraction : on réessaiera au
      // prochain tour plutôt que d'afficher une erreur passagère.
    }
  }

  indexStartBtn.addEventListener('click', async () => {
    indexStartBtn.disabled = true;
    try {
      const res = await fetch('/api/documents/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      renderIndexState({ ...data, pending: null });
    } catch (e) {
      indexSummary.textContent = e.message;
    } finally {
      indexStartBtn.disabled = false;
    }
  });

  indexCancelBtn.addEventListener('click', async () => {
    indexCancelBtn.disabled = true;
    try {
      await fetch('/api/documents/index/cancel', { method: 'POST' });
    } finally {
      indexCancelBtn.disabled = false;
    }
  });

  (async () => {
    syncControls();
    await loadGenres();
    await loadFacets();
    await loadDocuments();
    indexBar.classList.remove('hidden');
    await pollIndex();
  })();
})();
