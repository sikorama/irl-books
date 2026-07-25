(() => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');
  const searchInput = document.getElementById('search');
  const libSelect = document.getElementById('library-filter');
  const genreSelect = document.getElementById('genre-filter');
  const addGenreSelect = document.getElementById('add-genre-select');
  const flagInputs = [...document.querySelectorAll('.flag-filters input[data-flag]')];

  const detailOverlay = document.getElementById('detail-overlay');
  const detailContent = document.getElementById('detail-content');
  const quickLibraryOverlay = document.getElementById('quick-library-overlay');
  const quickLibraryTitle = document.getElementById('quick-library-title');
  const quickLibrarySelect = document.getElementById('quick-library-select');
  const quickLibraryStatus = document.getElementById('quick-library-status');
  const quickGenreOverlay = document.getElementById('quick-genre-overlay');
  const quickGenreTitle = document.getElementById('quick-genre-title');
  const quickGenreSelect = document.getElementById('quick-genre-select');
  const quickGenreStatus = document.getElementById('quick-genre-status');
  const addOverlay = document.getElementById('add-overlay');
  const addForm = document.getElementById('add-form');
  const addError = document.getElementById('add-error');
  const coverInput = document.getElementById('cover-input');
  const coverPreview = document.getElementById('cover-preview');
  const librarySelect = document.getElementById('library-select');
  const libraryInput = document.getElementById('library-input');
  const isbnInput = document.getElementById('isbn-input');
  const isbnLookupBtn = document.getElementById('isbn-lookup-btn');
  const isbnLookupStatus = document.getElementById('isbn-lookup-status');
  const isbnGoogleBtn = document.getElementById('isbn-google-btn');
  const isbnScanBtn = document.getElementById('isbn-scan-btn');
  const scanOverlay = document.getElementById('scan-overlay');
  const scanVideo = document.getElementById('scan-video');
  const scanStatus = document.getElementById('scan-status');
  const scanCloseBtn = document.getElementById('scan-close-btn');
  const duplicateOverlay = document.getElementById('duplicate-overlay');
  const duplicateTitle = document.getElementById('duplicate-title');
  const duplicateRoomNote = document.getElementById('duplicate-room-note');
  const duplicateMoveBtn = document.getElementById('duplicate-move-btn');
  const duplicateOpenBtn = document.getElementById('duplicate-open-btn');
  const duplicateIgnoreBtn = document.getElementById('duplicate-ignore-btn');
  const duplicateCloseBtn = document.getElementById('duplicate-close-btn');

  const selectToggleBtn = document.getElementById('select-toggle-btn');
  const selectionBar = document.getElementById('selection-bar');
  const selectAllCheckbox = document.getElementById('select-all');
  const selectionCountEl = document.getElementById('selection-count');
  const moveTargetSelect = document.getElementById('move-target');
  const moveBtn = document.getElementById('move-btn');
  const genreTargetSelect = document.getElementById('genre-target');
  const genreBtn = document.getElementById('genre-btn');
  const cancelSelectBtn = document.getElementById('cancel-select-btn');

  let debounceTimer = null;
  let selectMode = false;
  let currentBooks = [];
  let quickLibraryBookId = null;
  let quickGenreBookId = null;
  let genreCatalog = [];
  const selectedIds = new Set();
  let lastLibrary = localStorage.getItem('irl-books:lastLibrary') || '';
  let lastGenre = localStorage.getItem('irl-books:lastGenre') || '';

  function genreLabel(value) {
    if (!value) return null;
    const entry = genreCatalog.find((g) => g.value === value);
    return entry ? entry.label : value;
  }

  function genreOptionsHtml(selected, { includeAuto = false, includeEmpty = true } = {}) {
    const opts = [];
    if (includeAuto) opts.push(`<option value="">Auto-detect</option>`);
    else if (includeEmpty) opts.push(`<option value="">No genre</option>`);
    for (const g of genreCatalog) {
      opts.push(`<option value="${escapeHtml(g.value)}" ${g.value === selected ? 'selected' : ''}>${escapeHtml(g.label)}</option>`);
    }
    return opts.join('');
  }

  async function loadGenres() {
    const res = await fetch('/api/genres');
    const data = await res.json();
    genreCatalog = data.genres;

    const current = genreSelect.value;
    genreSelect.innerHTML = '<option value="">All genres</option>'
      + data.genres.map((g) => `<option value="${escapeHtml(g.value)}">${escapeHtml(g.label)} (${g.count})</option>`).join('')
      + `<option value="(aucun)">No genre (${data.no_genre_count})</option>`;
    genreSelect.value = current;

    if (addGenreSelect) addGenreSelect.innerHTML = '<option value="">Auto-detect</option>' + genreOptionsHtml(null, { includeEmpty: false });

    const currentGenreTarget = genreTargetSelect.value;
    genreTargetSelect.innerHTML = '<option value="">🏷️ Change genre…</option>'
      + '<option value="__none__">No genre</option>'
      + genreOptionsHtml(null, { includeEmpty: false });
    genreTargetSelect.value = currentGenreTarget;
  }

  let audioCtx = null;
  const BEEP_PATTERNS = {
    scan: [{ freq: 1800, start: 0, dur: 0.07 }],
    success: [{ freq: 880, start: 0, dur: 0.09 }, { freq: 1320, start: 0.1, dur: 0.14 }],
    fail: [{ freq: 320, start: 0, dur: 0.16 }, { freq: 200, start: 0.15, dur: 0.24 }],
  };
  function beep(kind) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const now = ctx.currentTime;
      for (const note of BEEP_PATTERNS[kind] || []) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = note.freq;
        osc.connect(gain).connect(ctx.destination);
        gain.gain.setValueAtTime(0.15, now + note.start);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
        osc.start(now + note.start);
        osc.stop(now + note.start + note.dur + 0.02);
      }
    } catch {
      // Audio feedback is a nicety — autoplay restrictions or missing
      // AudioContext support shouldn't block the actual scan/lookup flow.
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // La révision fait partie de l'URL : sans elle le navigateur garderait
  // l'ancienne couverture en cache et changer d'image n'aurait aucun effet
  // visible.
  function coverUrl(book) {
    return `/api/books/${book.id}/cover?v=${book.cover_rev || 0}`;
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (libSelect.value) params.set('library', libSelect.value);
    if (genreSelect.value) params.set('genre', genreSelect.value);
    for (const input of flagInputs) {
      if (input.checked) params.set(input.dataset.flag, '1');
    }
    return params.toString();
  }

  async function loadLibraries() {
    const res = await fetch('/api/libraries');
    const libs = await res.json();
    const current = libSelect.value;
    [...libSelect.options].slice(1).forEach((o) => o.remove());
    for (const lib of libs) {
      const opt = document.createElement('option');
      opt.value = lib.name;
      opt.textContent = `${lib.name} (${lib.count})`;
      libSelect.appendChild(opt);
    }
    libSelect.value = current;

    const currentLibraryChoice = librarySelect.value;
    librarySelect.innerHTML = '<option value="">Choose a room…</option>' + libs
      .filter((lib) => lib.name)
      .map((lib) => `<option value="${escapeHtml(lib.name)}">${escapeHtml(lib.name)} (${lib.count})</option>`)
      .join('');
    librarySelect.value = currentLibraryChoice;

    const currentMoveTarget = moveTargetSelect.value;
    [...moveTargetSelect.options].slice(1).forEach((o) => o.remove());
    for (const lib of libs.filter((l) => l.name)) {
      const opt = document.createElement('option');
      opt.value = lib.name;
      opt.textContent = `${lib.name} (${lib.count})`;
      moveTargetSelect.appendChild(opt);
    }
    moveTargetSelect.value = currentMoveTarget;
  }

  function toggleSelect(id, checked) {
    if (checked) selectedIds.add(id); else selectedIds.delete(id);
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const n = selectedIds.size;
    selectionCountEl.textContent = `${n} selected`;
    moveBtn.disabled = n === 0 || !moveTargetSelect.value;
    genreBtn.disabled = n === 0 || !genreTargetSelect.value;
    const idsOnPage = currentBooks.map((b) => b.id);
    selectAllCheckbox.checked = idsOnPage.length > 0 && idsOnPage.every((id) => selectedIds.has(id));
  }

  function setSelectMode(on) {
    selectMode = on;
    grid.classList.toggle('select-mode', on);
    selectionBar.classList.toggle('hidden', !on);
    selectToggleBtn.textContent = on ? '✅' : '☑️';
    selectToggleBtn.title = on ? 'Done selecting' : 'Select';
    selectToggleBtn.classList.toggle('active', on);
    if (!on) {
      selectedIds.clear();
      moveTargetSelect.value = '';
      genreTargetSelect.value = '';
      grid.querySelectorAll('.card').forEach((c) => {
        c.classList.remove('selected');
        const input = c.querySelector('.card-select-input');
        if (input) input.checked = false;
      });
    }
    updateSelectionUI();
  }

  function renderCard(book) {
    const card = document.createElement('div');
    card.className = 'card' + (selectedIds.has(book.id) ? ' selected' : '');
    card.dataset.id = book.id;

    const badges = [];
    badges.push(`<span class="badge location">${escapeHtml(book.library || 'Unknown room')}</span>`);
    badges.push(`<span class="badge genre">${escapeHtml(genreLabel(book.genre) || 'No genre')}</span>`);
    if (book.loaned) badges.push('<span class="badge loaned">Loaned</span>');

    card.innerHTML = `
      <div class="cover-wrap">
        <label class="card-select">
          <input type="checkbox" class="card-select-input" ${selectedIds.has(book.id) ? 'checked' : ''}>
        </label>
        <img loading="lazy" src="${coverUrl(book)}" alt="${escapeHtml(book.title)}">
        <div class="badges">${badges.join('')}</div>
      </div>
      <div class="meta">
        <p class="title">${escapeHtml(book.title)}</p>
        <p class="authors">${escapeHtml(book.authors.join(', ') || '—')}</p>
        <p class="isbn">${escapeHtml(book.isbn || '—')}</p>
      </div>
    `;

    card.querySelector('.card-select-input').addEventListener('change', (e) => {
      toggleSelect(book.id, e.target.checked);
      card.classList.toggle('selected', e.target.checked);
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('.badge.location')) {
        e.stopPropagation();
        openQuickLibrary(book);
        return;
      }
      if (e.target.closest('.badge.genre')) {
        e.stopPropagation();
        openQuickGenre(book);
        return;
      }
      if (!selectMode) { openDetail(book.id); return; }
      if (e.target.closest('.card-select')) return;
      const input = card.querySelector('.card-select-input');
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change'));
    });
    return card;
  }

  async function openQuickLibrary(book) {
    quickLibraryBookId = book.id;
    quickLibraryTitle.textContent = book.title;
    quickLibraryStatus.textContent = '';
    const res = await fetch('/api/libraries');
    const libs = await res.json();
    quickLibrarySelect.innerHTML = '<option value="">Unknown room</option>' + libs
      .filter((lib) => lib.name)
      .map((lib) => `<option value="${escapeHtml(lib.name)}" ${lib.name === (book.library || '') ? 'selected' : ''}>${escapeHtml(lib.name)} (${lib.count})</option>`)
      .join('');
    quickLibraryOverlay.classList.remove('hidden');
  }

  quickLibrarySelect.addEventListener('change', async () => {
    const library = quickLibrarySelect.value || null;
    quickLibrarySelect.disabled = true;
    quickLibraryStatus.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/books/${quickLibraryBookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      quickLibraryOverlay.classList.add('hidden');
      await loadLibraries();
      await loadBooks();
    } catch (e) {
      quickLibraryStatus.textContent = e.message;
    } finally {
      quickLibrarySelect.disabled = false;
    }
  });

  function openQuickGenre(book) {
    quickGenreBookId = book.id;
    quickGenreTitle.textContent = book.title;
    quickGenreStatus.textContent = '';
    quickGenreSelect.innerHTML = genreOptionsHtml(book.genre);
    quickGenreOverlay.classList.remove('hidden');
  }

  quickGenreSelect.addEventListener('change', async () => {
    const genre = quickGenreSelect.value || null;
    quickGenreSelect.disabled = true;
    quickGenreStatus.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/books/${quickGenreBookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      quickGenreOverlay.classList.add('hidden');
      await loadGenres();
      await loadBooks();
    } catch (e) {
      quickGenreStatus.textContent = e.message;
    } finally {
      quickGenreSelect.disabled = false;
    }
  });

  async function loadBooks() {
    const qs = buildQuery();
    status.textContent = 'Loading…';
    const res = await fetch(`/api/books${qs ? '?' + qs : ''}`);
    const books = await res.json();
    currentBooks = books;
    grid.innerHTML = '';
    for (const book of books) grid.appendChild(renderCard(book));
    empty.classList.toggle('hidden', books.length > 0);
    status.textContent = `${books.length} book${books.length !== 1 ? 's' : ''}`;
    updateSelectionUI();
  }

  function debouncedLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadBooks, 200);
  }

  searchInput.addEventListener('input', debouncedLoad);
  libSelect.addEventListener('change', loadBooks);
  genreSelect.addEventListener('change', loadBooks);
  flagInputs.forEach((i) => i.addEventListener('change', loadBooks));

  selectToggleBtn.addEventListener('click', () => setSelectMode(!selectMode));
  cancelSelectBtn.addEventListener('click', () => setSelectMode(false));

  selectAllCheckbox.addEventListener('change', () => {
    const idsOnPage = currentBooks.map((b) => b.id);
    if (selectAllCheckbox.checked) {
      idsOnPage.forEach((id) => selectedIds.add(id));
    } else {
      idsOnPage.forEach((id) => selectedIds.delete(id));
    }
    grid.querySelectorAll('.card').forEach((card) => {
      const id = Number(card.dataset.id);
      const checked = selectedIds.has(id);
      card.classList.toggle('selected', checked);
      const input = card.querySelector('.card-select-input');
      if (input) input.checked = checked;
    });
    updateSelectionUI();
  });

  moveTargetSelect.addEventListener('change', updateSelectionUI);

  moveBtn.addEventListener('click', async () => {
    const library = moveTargetSelect.value;
    if (!library || selectedIds.size === 0) return;
    moveBtn.disabled = true;
    const originalText = moveBtn.textContent;
    moveBtn.textContent = 'Moving…';
    try {
      const res = await fetch('/api/books/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], library }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');

      if (data.failed && data.failed.length) {
        const names = data.failed.map((f) => f.title || `#${f.id}`).join(', ');
        alert(`${data.count} book(s) moved.\n${data.failed.length} book(s) not moved (a book with the same import identifier already exists in "${library}"): ${names}`);
        data.moved.forEach((id) => selectedIds.delete(id));
        await loadLibraries();
        await loadBooks();
      } else {
        setSelectMode(false);
        await loadLibraries();
        await loadBooks();
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      moveBtn.disabled = false;
      moveBtn.textContent = originalText;
    }
  });

  genreTargetSelect.addEventListener('change', updateSelectionUI);

  genreBtn.addEventListener('click', async () => {
    const choice = genreTargetSelect.value;
    if (!choice || selectedIds.size === 0) return;
    const genre = choice === '__none__' ? null : choice;
    genreBtn.disabled = true;
    const originalText = genreBtn.textContent;
    genreBtn.textContent = 'Applying…';
    try {
      const res = await fetch('/api/books/set-genre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], genre }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setSelectMode(false);
      await loadGenres();
      await loadBooks();
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      genreBtn.disabled = false;
      genreBtn.textContent = originalText;
    }
  });

  function fieldRow(label, inputHtml, { full = false } = {}) {
    return `<div class="field-row${full ? ' full' : ''}"><label>${label}</label>${inputHtml}</div>`;
  }

  async function openDetail(id) {
    const [bookRes, libsRes] = await Promise.all([
      fetch(`/api/books/${id}`),
      fetch('/api/libraries'),
    ]);
    const book = await bookRes.json();
    const libs = await libsRes.json();
    const libraryOptions = '<option value="">Unknown room</option>' + libs
      .filter((lib) => lib.name)
      .map((lib) => `<option value="${escapeHtml(lib.name)}" ${lib.name === (book.library || '') ? 'selected' : ''}>${escapeHtml(lib.name)} (${lib.count})</option>`)
      .join('');
    detailContent.innerHTML = `
      <div class="detail-layout">
        <div class="cover-col">
          <label class="cover-edit">
            <input type="file" accept="image/*" class="cover-edit-input">
            <img class="cover" src="${coverUrl(book)}" alt="${escapeHtml(book.title)}">
            <span class="cover-edit-hint">Change cover</span>
          </label>
          <div class="cover-search-actions">
            <button type="button" class="secondary icon-btn image-search-btn" title="Search for cover images">🔍</button>
            <button type="button" class="secondary icon-btn google-search-btn" title="Search Google Images">🌐</button>
          </div>
        </div>
        <div class="detail-fields">
          ${fieldRow('Title', `<input type="text" class="field-input" data-field="title" value="${escapeHtml(book.title)}">`, { full: true })}
          ${fieldRow('Author(s)', `<input type="text" class="field-input" data-field="authors" value="${escapeHtml(book.authors.join(', '))}">`, { full: true })}
          ${fieldRow('Room', `<select class="field-input" data-field="library">${libraryOptions}</select>`)}
          ${fieldRow('Genre', `<select class="field-input" data-field="genre">${genreOptionsHtml(book.genre)}</select>`)}
          ${fieldRow('Publisher', `<input type="text" class="field-input" data-field="publisher" value="${escapeHtml(book.publisher || '')}">`)}
          ${fieldRow('Year', `<input type="number" class="field-input" data-field="publishing_year" value="${escapeHtml(book.publishing_year || '')}">`)}
          ${fieldRow('Edition', `<input type="text" class="field-input" data-field="edition" value="${escapeHtml(book.edition || '')}">`)}
          ${fieldRow('ISBN', `
            <div class="isbn-row">
              <input type="text" class="field-input" data-field="isbn" inputmode="numeric" value="${escapeHtml(book.isbn || '')}">
              <button type="button" class="secondary icon-btn isbn-scan-detail-btn" title="Scan the barcode">📷</button>
              <button type="button" class="secondary icon-btn isbn-lookup-detail-btn" title="Look up">🔎</button>
              <button type="button" class="secondary icon-btn isbn-google-detail-btn hidden" title="Search Google for this ISBN">🌐</button>
            </div>`, { full: true })}
          ${fieldRow('Loaned', `
            <div class="loaned-row">
              <input type="checkbox" class="field-input" data-field="loaned" ${book.loaned ? 'checked' : ''}>
              <input type="text" class="field-input" data-field="loaned_to" placeholder="to whom?" value="${escapeHtml(book.loaned_to || '')}">
            </div>`, { full: true })}
          ${fieldRow('Notes', `<textarea class="field-input" data-field="notes" rows="3">${escapeHtml(book.notes || '')}</textarea>`, { full: true })}
          <p class="field-save-status"></p>
          <p class="cover-upload-error error"></p>
        </div>
      </div>
      <div class="image-search-results hidden"></div>
    `;

    const statusEl = detailContent.querySelector('.field-save-status');
    const coverImg = detailContent.querySelector('img.cover');

    // Point de passage unique pour écrire une couverture : la révision
    // renvoyée par le serveur est reportée sur `book` pour que l'aperçu ici et
    // les vignettes de la grille pointent tous vers la nouvelle image.
    async function saveCover(cover_base64) {
      const res = await fetch(`/api/books/${book.id}/cover`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_base64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Cover not saved (HTTP ${res.status})`);
      book.cover_rev = data.cover_rev ?? (book.cover_rev || 0) + 1;
      book.has_cover = true;
      coverImg.src = coverUrl(book);
      await loadBooks();
    }

    async function saveField(patch) {
      statusEl.textContent = 'Saving…';
      try {
        const res = await fetch(`/api/books/${book.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Unknown error');
        }
        const updated = await res.json();
        Object.assign(book, updated);
        statusEl.textContent = 'Saved ✓';
        if ('library' in patch) await loadLibraries();
        if ('genre' in patch) await loadGenres();
        await loadBooks();
      } catch (err) {
        statusEl.textContent = err.message;
      }
    }

    const imageSearchBtn = detailContent.querySelector('.image-search-btn');
    const imageSearchResults = detailContent.querySelector('.image-search-results');

    function closeImageSearch() {
      imageSearchResults.classList.add('hidden');
      imageSearchResults.innerHTML = '';
    }

    async function setCoverFromSearch(cover_base64) {
      try {
        await saveCover(cover_base64);
      } catch (err) {
        statusEl.textContent = err.message;
        return;
      }
      closeImageSearch();
    }

    imageSearchBtn.addEventListener('click', async () => {
      const titleVal = detailContent.querySelector('[data-field="title"]').value;
      const authorsVal = detailContent.querySelector('[data-field="authors"]').value;
      const isbnVal = detailContent.querySelector('[data-field="isbn"]').value.trim();
      const query = [titleVal, authorsVal].filter(Boolean).join(' ');
      if (!query.trim() && !isbnVal) return;

      imageSearchBtn.disabled = true;
      imageSearchResults.classList.remove('hidden');
      // Les résultats de catalogue correspondent à une édition identifiée, les
      // images du web sont une simple ressemblance : la provenance doit être
      // visible avant de cliquer. Les deux grilles existent dès le départ pour
      // pouvoir y verser les vignettes au fil de leur arrivée.
      imageSearchResults.innerHTML = `
        <p class="image-search-status search-progress">
          <span class="spinner" aria-hidden="true"></span><span class="progress-label">Starting…</span>
        </p>
        <div class="image-search-section hidden" data-group="catalog">
          <p class="image-search-group">From catalogs (matched edition)</p>
          <div class="image-search-grid"></div>
        </div>
        <div class="image-search-section hidden" data-group="web">
          <p class="image-search-group">From the web (check it matches)</p>
          <div class="image-search-grid"></div>
        </div>
        <p class="image-search-status error search-problems"></p>
        <button type="button" class="secondary image-search-close">None of these</button>
      `;
      imageSearchResults.querySelector('.image-search-close').addEventListener('click', closeImageSearch);

      const progressEl = imageSearchResults.querySelector('.search-progress');
      const labelEl = imageSearchResults.querySelector('.progress-label');
      const problemsEl = imageSearchResults.querySelector('.search-problems');
      const startedAt = Date.now();
      const problems = [];
      let pending = 0;
      let found = 0;

      const tick = setInterval(() => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        labelEl.textContent = `Searching ${pending} source${pending !== 1 ? 's' : ''}… ${seconds}s · ${found} cover${found !== 1 ? 's' : ''} found`;
      }, 250);

      function addResult(result) {
        found++;
        const section = imageSearchResults.querySelector(`.image-search-section[data-group="${result.group === 'web' ? 'web' : 'catalog'}"]`);
        section.classList.remove('hidden');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'image-search-thumb';
        btn.title = [result.title, result.source].filter(Boolean).join(' — ');
        btn.innerHTML = `<img src="${result.cover_base64}" alt="${escapeHtml(result.title || '')}">`;
        btn.addEventListener('click', () => setCoverFromSearch(result.cover_base64));
        section.querySelector('.image-search-grid').appendChild(btn);
      }

      function handleEvent(event) {
        if (event.type === 'start') pending = event.sources.length;
        if (event.type === 'result') addResult(event.result);
        if (event.type === 'source') {
          pending = Math.max(0, pending - 1);
          if (event.state === 'error') {
            problems.push(`${event.name}: ${event.message}`);
            problemsEl.textContent = problems.join(' · ');
          }
        }
      }

      try {
        const params = new URLSearchParams();
        if (titleVal) params.set('title', titleVal);
        if (authorsVal) params.set('authors', authorsVal);
        if (isbnVal) params.set('isbn', isbnVal);

        const res = await fetch(`/api/image-search?${params}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // la dernière peut être incomplète
          for (const line of lines) {
            if (line.trim()) handleEvent(JSON.parse(line));
          }
        }

        const seconds = Math.round((Date.now() - startedAt) / 1000);
        if (found) {
          progressEl.textContent = `${found} cover${found !== 1 ? 's' : ''} found in ${seconds}s.`;
        } else {
          progressEl.textContent = problems.length
            ? `No cover found in ${seconds}s — every source failed.`
            : 'No results found.';
        }
      } catch (err) {
        progressEl.textContent = '';
        problems.push(err.message);
        problemsEl.textContent = problems.join(' · ');
      } finally {
        clearInterval(tick);
        imageSearchBtn.disabled = false;
      }
    });

    detailContent.querySelector('.google-search-btn').addEventListener('click', () => {
      const titleVal = detailContent.querySelector('[data-field="title"]').value;
      const authorsVal = detailContent.querySelector('[data-field="authors"]').value;
      const query = [titleVal, authorsVal].filter(Boolean).join(' ');
      const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
      window.open(url, '_blank', 'noopener');
    });

    detailContent.querySelectorAll('.field-input[data-field]').forEach((el) => {
      const field = el.dataset.field;
      el.addEventListener('change', () => {
        let value = el.type === 'checkbox' ? el.checked : el.value;
        if (field === 'authors') value = value.split(',').map((s) => s.trim()).filter(Boolean);
        if (field === 'publishing_year') value = value ? Number(value) : null;
        if (field === 'library') value = value.trim() || null;
        saveField({ [field]: value });
      });
    });

    const isbnGoogleDetailBtn = detailContent.querySelector('.isbn-google-detail-btn');
    isbnGoogleDetailBtn.addEventListener('click', () => {
      const isbn = detailContent.querySelector('[data-field="isbn"]').value.trim();
      if (!isbn) return;
      window.open(`https://www.google.com/search?q=${encodeURIComponent(isbn)}`, '_blank', 'noopener');
    });

    let detailIsbnLookupSeq = 0;
    detailContent.querySelector('.isbn-lookup-detail-btn').addEventListener('click', async () => {
      const isbnField = detailContent.querySelector('[data-field="isbn"]');
      const isbn = isbnField.value.trim();
      if (!isbn) return;
      const seq = ++detailIsbnLookupSeq;
      isbnGoogleDetailBtn.classList.add('hidden');
      statusEl.textContent = 'Looking up…';
      try {
        const res = await fetch(`/api/isbn-lookup/${encodeURIComponent(isbn)}`);
        const data = await res.json();
        if (seq !== detailIsbnLookupSeq) return; // a newer lookup has since started — don't show a stale result

        if (!data.found) {
          beep('fail');
          statusEl.textContent = 'No result found for this ISBN.';
          isbnGoogleDetailBtn.classList.remove('hidden');
          return;
        }
        const patch = {};
        if (data.title) patch.title = data.title;
        if (data.authors && data.authors.length) patch.authors = data.authors;
        if (data.publisher) patch.publisher = data.publisher;
        if (data.publishing_year) patch.publishing_year = data.publishing_year;

        const FIELD_LABELS = { title: 'Title', authors: 'Author(s)', publisher: 'Publisher', publishing_year: 'Year' };
        const asText = (v) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));
        const overwrites = [];
        for (const [field, newValue] of Object.entries(patch)) {
          const currentText = asText(book[field]);
          if (asText(newValue) === currentText) {
            delete patch[field];
          } else if (currentText !== '') {
            overwrites.push(`${FIELD_LABELS[field]}: "${currentText}" → "${asText(newValue)}"`);
          }
        }
        const overwritesCover = Boolean(data.cover_base64 && book.has_cover);

        if (overwrites.length || overwritesCover) {
          const details = overwrites.slice();
          if (overwritesCover) details.push('Cover image will be replaced');
          const ok = confirm(`The lookup returned different values for fields that already have data:\n\n${details.join('\n')}\n\nOverwrite them?`);
          if (!ok) {
            statusEl.textContent = 'Lookup cancelled — no changes saved.';
            return;
          }
        }

        if (Object.keys(patch).length) await saveField(patch);

        if (patch.title) detailContent.querySelector('[data-field="title"]').value = patch.title;
        if (patch.authors) detailContent.querySelector('[data-field="authors"]').value = patch.authors.join(', ');
        if (patch.publisher) detailContent.querySelector('[data-field="publisher"]').value = patch.publisher;
        if (patch.publishing_year) detailContent.querySelector('[data-field="publishing_year"]').value = patch.publishing_year;

        if (data.cover_base64) {
          await saveCover(data.cover_base64);
        }
        beep('success');
        statusEl.textContent = 'Fields updated ✓';
      } catch (err) {
        if (seq !== detailIsbnLookupSeq) return;
        beep('fail');
        statusEl.textContent = err.message;
        isbnGoogleDetailBtn.classList.remove('hidden');
      }
    });

    detailContent.querySelector('.isbn-scan-detail-btn').addEventListener('click', () => {
      const isbnField = detailContent.querySelector('[data-field="isbn"]');
      startScanner((code) => {
        isbnField.value = code;
        isbnField.dispatchEvent(new Event('change'));
        detailContent.querySelector('.isbn-lookup-detail-btn').click();
      });
    });

    const fileInput = detailContent.querySelector('.cover-edit-input');
    const uploadError = detailContent.querySelector('.cover-upload-error');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadError.textContent = '';
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        await saveCover(dataUrl);
      } catch (err) {
        uploadError.textContent = err.message;
      }
    });

    detailOverlay.classList.remove('hidden');
  }

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.overlay').classList.add('hidden');
    });
  });
  [detailOverlay, addOverlay, quickLibraryOverlay, quickGenreOverlay].forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  let addFormScannerUsed = false;

  librarySelect.addEventListener('change', () => {
    if (librarySelect.value) libraryInput.value = librarySelect.value;
  });
  libraryInput.addEventListener('input', () => {
    if (librarySelect.value && librarySelect.value !== libraryInput.value) librarySelect.value = '';
  });

  function rememberLastSelection({ library, genre }) {
    lastLibrary = library || '';
    lastGenre = genre || '';
    localStorage.setItem('irl-books:lastLibrary', lastLibrary);
    localStorage.setItem('irl-books:lastGenre', lastGenre);
  }

  function openAddForm() {
    addForm.reset();
    coverPreview.src = '/nocover.jpg';
    coverPreview.dataset.base64 = '';
    addError.textContent = '';
    isbnLookupStatus.textContent = '';
    addFormScannerUsed = false;
    libraryInput.value = lastLibrary;
    librarySelect.value = lastLibrary;
    addGenreSelect.value = lastGenre;
    addOverlay.classList.remove('hidden');
  }

  document.getElementById('add-book-btn').addEventListener('click', openAddForm);

  document.getElementById('scan-book-btn').addEventListener('click', () => {
    openAddForm();
    scanIsbnIntoAddForm();
  });

  let zxingReader = null;

  function stopScanner() {
    if (zxingReader) {
      try { zxingReader.reset(); } catch { /* already stopped */ }
    }
    scanOverlay.classList.add('hidden');
  }

  async function startScanner(onDecoded) {
    scanStatus.textContent = 'Starting the camera…';
    scanOverlay.classList.remove('hidden');

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scanStatus.textContent = 'Camera unavailable: the site must be served over HTTPS to access it from a phone (see README).';
      return;
    }

    let handled = false;
    try {
      if (!zxingReader) {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A,
        ]);
        zxingReader = new ZXing.BrowserMultiFormatReader(hints);
      }
      await zxingReader.decodeFromConstraints(
        { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
        scanVideo,
        (result) => {
          // ZXing can fire this callback for several consecutive frames matching
          // the same barcode before reset() actually stops the stream — only
          // act on the first one.
          if (!result || handled) return;
          handled = true;
          const code = result.getText();
          scanStatus.textContent = `Detected: ${code}`;
          beep('scan');
          stopScanner();
          onDecoded(code);
        },
      );
    } catch (e) {
      scanStatus.textContent = `Camera error: ${e.message}`;
    }
  }

  scanCloseBtn.addEventListener('click', stopScanner);
  scanOverlay.addEventListener('click', (e) => {
    if (e.target === scanOverlay) stopScanner();
  });

  function scanIsbnIntoAddForm() {
    startScanner((code) => {
      isbnInput.value = code;
      addFormScannerUsed = true;
      lookupIsbn();
    });
  }

  isbnScanBtn.addEventListener('click', scanIsbnIntoAddForm);

  let duplicateBook = null;
  let duplicateWasScanning = false;

  // Les boutons du doublon portent une icône et un libellé séparés (tuiles
  // carrées sur mobile) : écrire dans le bouton lui-même effacerait l'icône.
  function setActionButton(btn, icon, label) {
    if (icon) btn.querySelector('.dup-action-icon').textContent = icon;
    btn.querySelector('.dup-action-label').textContent = label;
    btn.title = label;
  }

  function handleExistingBook(existing) {
    const currentRoom = libraryInput.value.trim();
    duplicateBook = existing;
    duplicateWasScanning = addFormScannerUsed;

    duplicateTitle.textContent = existing.title;
    if (currentRoom && (existing.library || '') !== currentRoom) {
      // Les deux pièces vont dans la note : le libellé du bouton reste court,
      // sinon un nom de pièce à rallonge déborde de la tuile carrée.
      duplicateRoomNote.textContent = `Currently in "${existing.library || 'Unknown room'}" — you are filing into "${currentRoom}".`;
      setActionButton(duplicateMoveBtn, '📦', 'Move it here');
      duplicateMoveBtn.dataset.target = currentRoom;
      duplicateMoveBtn.classList.remove('hidden');
    } else {
      duplicateRoomNote.textContent = '';
      duplicateMoveBtn.classList.add('hidden');
    }
    if (duplicateWasScanning) {
      setActionButton(duplicateIgnoreBtn, '📷', 'Ignore, scan another');
    } else {
      setActionButton(duplicateIgnoreBtn, '✖', 'Ignore, new entry');
    }

    addOverlay.classList.add('hidden');
    duplicateOverlay.classList.remove('hidden');
  }

  function closeDuplicateOverlay() {
    duplicateOverlay.classList.add('hidden');
    duplicateBook = null;
  }

  duplicateMoveBtn.addEventListener('click', async () => {
    if (!duplicateBook) return;
    const target = duplicateMoveBtn.dataset.target;
    duplicateMoveBtn.disabled = true;
    try {
      await fetch(`/api/books/${duplicateBook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library: target }),
      });
      duplicateBook.library = target;
      duplicateRoomNote.textContent = `Moved to "${target}" ✓`;
      duplicateMoveBtn.classList.add('hidden');
      await loadLibraries();
      await loadBooks();
    } finally {
      duplicateMoveBtn.disabled = false;
    }
  });

  duplicateOpenBtn.addEventListener('click', async () => {
    const id = duplicateBook.id;
    closeDuplicateOverlay();
    await openDetail(id);
  });

  function ignoreDuplicate() {
    const wasScanning = duplicateWasScanning;
    closeDuplicateOverlay();
    openAddForm();
    if (wasScanning) scanIsbnIntoAddForm();
  }

  duplicateIgnoreBtn.addEventListener('click', ignoreDuplicate);
  duplicateCloseBtn.addEventListener('click', ignoreDuplicate);
  duplicateOverlay.addEventListener('click', (e) => {
    if (e.target === duplicateOverlay) ignoreDuplicate();
  });

  let isbnLookupSeq = 0;
  async function lookupIsbn() {
    const isbn = isbnInput.value.trim();
    if (!isbn) return;
    const seq = ++isbnLookupSeq;
    isbnLookupBtn.disabled = true;
    isbnGoogleBtn.classList.add('hidden');
    isbnGoogleBtn.dataset.isbn = isbn;
    isbnLookupStatus.textContent = 'Looking up…';
    try {
      const res = await fetch(`/api/isbn-lookup/${encodeURIComponent(isbn)}`);
      const data = await res.json();
      if (seq !== isbnLookupSeq) return; // a newer lookup has since started — don't show a stale result

      if (data.existing) {
        beep('success');
        await handleExistingBook(data.existing);
        return;
      }
      if (!data.found) {
        beep('fail');
        isbnLookupStatus.textContent = 'No result found for this ISBN.';
        isbnGoogleBtn.classList.remove('hidden');
        return;
      }
      if (data.title) addForm.elements.title.value = data.title;
      if (data.authors && data.authors.length) addForm.elements.authors.value = data.authors.join(', ');
      if (data.publisher) addForm.elements.publisher.value = data.publisher;
      if (data.publishing_year) addForm.elements.publishing_year.value = data.publishing_year;
      if (data.cover_base64) {
        coverPreview.src = data.cover_base64;
        coverPreview.dataset.base64 = data.cover_base64;
      }
      beep('success');
      isbnLookupStatus.textContent = 'Found ✓ — check and complete before saving.';
    } catch (err) {
      if (seq !== isbnLookupSeq) return;
      beep('fail');
      isbnLookupStatus.textContent = `Error: ${err.message}`;
      isbnGoogleBtn.classList.remove('hidden');
    } finally {
      if (seq === isbnLookupSeq) isbnLookupBtn.disabled = false;
    }
  }
  isbnLookupBtn.addEventListener('click', lookupIsbn);
  isbnInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lookupIsbn(); }
  });
  isbnGoogleBtn.addEventListener('click', () => {
    const isbn = isbnGoogleBtn.dataset.isbn || isbnInput.value.trim();
    if (!isbn) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(isbn)}`, '_blank', 'noopener');
  });

  coverInput.addEventListener('change', () => {
    const file = coverInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      coverPreview.src = reader.result;
      coverPreview.dataset.base64 = reader.result;
    };
    reader.readAsDataURL(file);
  });

  function buildAddPayload() {
    const fd = new FormData(addForm);
    return {
      title: fd.get('title'),
      authors: fd.get('authors'),
      isbn: fd.get('isbn'),
      publisher: fd.get('publisher'),
      publishing_year: fd.get('publishing_year') ? Number(fd.get('publishing_year')) : null,
      edition: fd.get('edition'),
      library: fd.get('library'),
      genre: fd.get('genre') || null,
      notes: fd.get('notes'),
      loaned: fd.get('loaned') === 'on',
      cover_base64: coverPreview.dataset.base64 || null,
    };
  }

  async function saveAddedBook() {
    const payload = buildAddPayload();
    const res = await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Unknown error');
    }
    return payload;
  }

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addError.textContent = '';
    try {
      const payload = await saveAddedBook();
      rememberLastSelection(payload);
      addOverlay.classList.add('hidden');
      await loadLibraries();
      await loadBooks();
    } catch (err) {
      addError.textContent = err.message;
    }
  });

  document.getElementById('add-another-btn').addEventListener('click', async () => {
    addError.textContent = '';
    if (!addForm.reportValidity()) return;
    try {
      const payload = await saveAddedBook();
      rememberLastSelection(payload);
      await loadLibraries();
      await loadBooks();
      const rescan = addFormScannerUsed;
      openAddForm();
      if (rescan) scanIsbnIntoAddForm();
    } catch (err) {
      addError.textContent = err.message;
    }
  });

  Promise.all([loadLibraries(), loadGenres()]).then(loadBooks).then(() => {
    const params = new URLSearchParams(window.location.search);
    const openBookId = params.get('openBook');
    if (openBookId) {
      openDetail(Number(openBookId));
      params.delete('openBook');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    }
  });
})();
