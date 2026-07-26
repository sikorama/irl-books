(() => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');
  const searchInput = document.getElementById('search');
  const libSelect = document.getElementById('library-filter');
  const genreSelect = document.getElementById('genre-filter');
  const addGenreSelect = document.getElementById('add-genre-select');
  const flagInputs = [...document.querySelectorAll('.flag-filters input[data-flag]')];
  const cloudToggle = document.getElementById('cloud-toggle');
  const statsLink = document.getElementById('stats-link');

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
  const addImageSearchBtn = document.getElementById('add-image-search-btn');
  const addImageSearchResults = document.getElementById('add-image-search');
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
  const duplicateCover = document.getElementById('duplicate-cover');
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
  let quickGenreEndpoint = 'books';
  let genreCatalog = [];
  const selectedIds = new Set();
  let lastLibrary = localStorage.getItem('irl-books:lastLibrary') || '';
  let lastGenre = localStorage.getItem('irl-books:lastGenre') || '';

  // Le cloud est une pièce du catalogue : les documents numérisés y vivent comme
  // les livres papier vivent dans le Grand Bureau ou le Grenier.
  const CLOUD_ROOM = 'cloud';

  function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  }

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

  // La langue n'affecte que les intitulés : les `value` renvoyés sont les mêmes
  // et ce sont eux qui sont stockés dans les fiches.
  function uiLang() {
    return localStorage.getItem('irl-books:lang') || 'fr';
  }

  // Le catalogue de langues est chargé une fois : c'est une liste fermée, pas un
  // champ libre, pour que « fr », « fra » et « Français » ne cohabitent pas.
  let languageCatalog = [];

  async function loadLanguages() {
    const res = await fetch(`/api/languages?lang=${encodeURIComponent(uiLang())}`);
    const data = await res.json();
    languageCatalog = data.languages || [];
  }

  function languageOptionsHtml(selected) {
    return ['<option value="">—</option>']
      .concat(languageCatalog.map((l) => `<option value="${escapeHtml(l.code)}" ${l.code === selected ? 'selected' : ''}>${escapeHtml(l.label)}</option>`))
      .join('');
  }

  async function loadGenres() {
    const res = await fetch(`/api/genres?lang=${encodeURIComponent(uiLang())}`);
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
    // La recherche de couverture a ses propres bips : même famille que ceux du
    // scan, pour qu'ils restent reconnaissables, mais un ton en dessous, plus
    // courts et plus discrets. C'est voulu — ils ponctuent une recherche partie
    // toute seule, pas un geste de l'utilisateur, et pendant une séance de
    // scan ils ne doivent pas se confondre avec le bip du code-barres.
    searchStart: [{ freq: 1500, start: 0, dur: 0.05, gain: 0.09 }],
    searchDone: [{ freq: 780, start: 0, dur: 0.07, gain: 0.09 }, { freq: 1170, start: 0.08, dur: 0.11, gain: 0.09 }],
    searchNone: [{ freq: 420, start: 0, dur: 0.11, gain: 0.09 }],
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
        gain.gain.setValueAtTime(note.gain ?? 0.15, now + note.start);
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

  // L'URL vient du serveur, parce que les deux collections ne la construisent
  // pas pareil : une fiche papier porte sa révision de couverture (sans elle le
  // navigateur garderait l'ancienne image en cache et changer de couverture
  // n'aurait aucun effet visible), un document du cloud est servi depuis le
  // disque avec un ETag sur la taille et la date.
  function coverUrl(entry) {
    if (entry.cover_url) return entry.cover_url;
    return `/api/books/${entry.id}/cover?v=${entry.cover_rev || 0}`;
  }

  // --- Recherche de couverture ---------------------------------------------
  //
  // Ce panneau était propre à la fiche détaillée. Il est devenu commun le jour
  // où le formulaire d'ajout a dû lancer la même recherche : deux copies du
  // même flux d'événements auraient dérivé l'une de l'autre, et c'est le
  // chemin le plus emprunté de l'application — celui d'une séance de scan.
  //
  // `host` est le conteneur où se dessine le panneau, `onPick` reçoit l'image
  // choisie. Le reste — provenance, progression, pannes de source — est
  // identique partout.

  function coverSearchIsPossible({ title, authors, isbn }) {
    return Boolean((title || '').trim() || (authors || '').trim() || (isbn || '').trim());
  }

  // La recherche qui part toute seule à l'ouverture d'une fiche ne part qu'une
  // fois par livre et par session : sans cela, parcourir les centaines de fiches
  // sans couverture interrogerait les catalogues à chaque coup d'œil, pour la
  // même réponse. Le bouton 🔍 et l'enchaînement après une recherche d'ISBN
  // restent libres — ils sont demandés explicitement, eux.
  //
  // `sessionStorage` plutôt qu'une variable : la marque survit à un
  // rechargement de la page, mais pas à la fermeture de l'onglet — une nouvelle
  // séance retente, les sources ayant pu s'enrichir entre-temps.
  const AUTO_SEARCH_KEY = 'irl-books:autoCoverSearched';

  function autoSearchAlreadyDone(bookId) {
    try {
      const done = JSON.parse(sessionStorage.getItem(AUTO_SEARCH_KEY) || '[]');
      return Array.isArray(done) && done.includes(bookId);
    } catch {
      return false;
    }
  }

  function markAutoSearchDone(bookId) {
    try {
      const done = JSON.parse(sessionStorage.getItem(AUTO_SEARCH_KEY) || '[]');
      const list = Array.isArray(done) ? done : [];
      if (!list.includes(bookId)) list.push(bookId);
      sessionStorage.setItem(AUTO_SEARCH_KEY, JSON.stringify(list));
    } catch {
      // Stockage indisponible (navigation privée, quota) : on retombe sur le
      // comportement précédent — la recherche repartira à la prochaine
      // ouverture. C'est du bruit réseau, pas une perte de données.
    }
  }

  async function runImageSearch({ host, title, authors, isbn, onPick, sound = false }) {
    const query = { title: (title || '').trim(), authors: (authors || '').trim(), isbn: (isbn || '').trim() };
    if (!coverSearchIsPossible(query)) return 0;

    function close() {
      host.classList.add('hidden');
      host.innerHTML = '';
    }

    host.classList.remove('hidden');
    // Le panneau est en tête de la fiche : on remonte la modale pour que les
    // vignettes arrivent sous les yeux, sans avoir à chercher plus bas.
    const scroller = host.closest('.modal');
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });

    // Les résultats de catalogue correspondent à une édition identifiée, les
    // images du web sont une simple ressemblance : la provenance doit être
    // visible avant de cliquer. Les deux grilles existent dès le départ pour
    // pouvoir y verser les vignettes au fil de leur arrivée.
    host.innerHTML = `
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
    host.querySelector('.image-search-close').addEventListener('click', close);

    const progressEl = host.querySelector('.search-progress');
    const labelEl = host.querySelector('.progress-label');
    const problemsEl = host.querySelector('.search-problems');
    const startedAt = Date.now();
    const problems = [];
    let pending = 0;
    let found = 0;

    if (sound) beep('searchStart');

    const tick = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      labelEl.textContent = `Searching ${pending} source${pending !== 1 ? 's' : ''}… ${seconds}s · ${found} cover${found !== 1 ? 's' : ''} found`;
    }, 250);

    function addResult(result) {
      found++;
      const section = host.querySelector(`.image-search-section[data-group="${result.group === 'web' ? 'web' : 'catalog'}"]`);
      section.classList.remove('hidden');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'image-search-thumb';
      btn.title = [result.title, result.source].filter(Boolean).join(' — ');
      btn.innerHTML = `<img src="${result.cover_base64}" alt="${escapeHtml(result.title || '')}">`;
      btn.addEventListener('click', async () => {
        const kept = await onPick(result.cover_base64);
        if (kept !== false) close();
      });
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
      if (query.title) params.set('title', query.title);
      if (query.authors) params.set('authors', query.authors);
      if (query.isbn) params.set('isbn', query.isbn);

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
      // Le second bip dit aussi s'il y a quelque chose à regarder : pendant une
      // séance de scan, c'est ce qui permet de ne pas lever les yeux pour rien.
      if (sound) beep(found ? 'searchDone' : 'searchNone');
    } catch (err) {
      progressEl.textContent = '';
      problems.push(err.message);
      problemsEl.textContent = problems.join(' · ');
      if (sound) beep('searchNone');
    } finally {
      clearInterval(tick);
    }
    return found;
  }

  function buildQuery() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (libSelect.value) params.set('library', libSelect.value);
    if (genreSelect.value) params.set('genre', genreSelect.value);
    // Les documents numériques n'entrent que sur demande — le serveur ne les
    // ajoute au catalogue que si ce drapeau est là.
    if (cloudToggle.checked) params.set('cloud', '1');
    for (const input of flagInputs) {
      if (input.checked) params.set(input.dataset.flag, '1');
    }
    return params.toString();
  }

  async function loadLibraries() {
    const res = await fetch('/api/libraries');
    const libs = await res.json();
    // Le cloud est une pièce du catalogue, donc présent dans le filtre — mais
    // c'est une pièce virtuelle : on ne peut pas y « déplacer » un livre papier,
    // ni en créer un dedans. Toute liste de destination l'exclut.
    const realRooms = libs.filter((lib) => lib.name && !lib.virtual);
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
    librarySelect.innerHTML = '<option value="">Choose a room…</option>' + realRooms
      .map((lib) => `<option value="${escapeHtml(lib.name)}">${escapeHtml(lib.name)} (${lib.count})</option>`)
      .join('');
    librarySelect.value = currentLibraryChoice;

    const currentMoveTarget = moveTargetSelect.value;
    [...moveTargetSelect.options].slice(1).forEach((o) => o.remove());
    for (const lib of realRooms) {
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
    const idsOnPage = currentBooks.map((b) => b.uid);
    selectAllCheckbox.checked = idsOnPage.length > 0 && idsOnPage.every((id) => selectedIds.has(id));
    // Déplacer vers une pièce n'a de sens que pour du papier : si la sélection
    // ne contient que des documents du cloud, le bouton reste inerte.
    const hasBooks = [...selectedIds].some((uid) => String(uid).startsWith('b'));
    moveBtn.disabled = moveBtn.disabled || !hasBooks;
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

  // Une carte est soit une fiche papier, soit un document du cloud. Ce qui
  // diffère : la troisième ligne (ISBN pour le papier, année et poids du fichier
  // pour un document), et le fait que la pastille de pièce d'un document n'est
  // pas cliquable — on ne déménage pas un fichier dans le Grenier.
  function renderCard(entry) {
    const isDoc = entry.kind === 'document';
    const card = document.createElement('div');
    card.className = 'card' + (selectedIds.has(entry.uid) ? ' selected' : '') + (isDoc ? ' doc-card' : '');
    card.dataset.id = entry.uid;

    const badges = [];
    // La pastille de format est un lien direct vers le fichier : c'est le geste
    // le plus fréquent sur un document, il ne mérite pas de passer par la fiche.
    // `target="_blank"` laisse le navigateur décider — visionneuse intégrée pour
    // un PDF, téléchargement pour le reste.
    badges.push(isDoc
      ? (entry.file_count
        ? `<a class="badge location cloud" href="/api/documents/${entry.id}/file" target="_blank" rel="noopener" title="Open ${escapeHtml(entry.format || 'file')}">☁️ ${escapeHtml(entry.format || CLOUD_ROOM)}</a>`
        : `<span class="badge location cloud">☁️ ${escapeHtml(CLOUD_ROOM)}</span>`)
      : `<span class="badge location">${escapeHtml(entry.library || 'Unknown room')}</span>`);
    badges.push(`<span class="badge genre">${escapeHtml(genreLabel(entry.genre) || 'No genre')}</span>`);
    if (entry.loaned) badges.push('<span class="badge loaned">Loaned</span>');
    if (isDoc && entry.missing_count) badges.push('<span class="badge loaned">Missing</span>');
    else if (isDoc && !entry.file_count) badges.push('<span class="badge loaned">No file</span>');

    const thirdLine = isDoc
      ? [entry.pub_year, formatSize(entry.size)].filter(Boolean).join(' · ')
      : entry.isbn;

    card.innerHTML = `
      <div class="cover-wrap">
        <label class="card-select">
          <input type="checkbox" class="card-select-input" ${selectedIds.has(entry.uid) ? 'checked' : ''}>
        </label>
        <img loading="lazy" src="${coverUrl(entry)}" alt="${escapeHtml(entry.title)}">
        <div class="badges">${badges.join('')}</div>
      </div>
      <div class="meta">
        <p class="title">${escapeHtml(entry.title)}</p>
        <p class="authors">${escapeHtml(entry.authors.join(', ') || '—')}</p>
        <p class="isbn">${escapeHtml(thirdLine || '—')}</p>
      </div>
    `;

    card.querySelector('.card-select-input').addEventListener('change', (e) => {
      toggleSelect(entry.uid, e.target.checked);
      card.classList.toggle('selected', e.target.checked);
    });

    card.addEventListener('click', (e) => {
      // Le lien de la pastille fait son travail tout seul : on ne veut pas
      // ouvrir la fiche par-dessus.
      if (e.target.closest('a.badge')) { e.stopPropagation(); return; }
      if (!isDoc && e.target.closest('.badge.location')) {
        e.stopPropagation();
        openQuickLibrary(entry);
        return;
      }
      if (e.target.closest('.badge.genre')) {
        e.stopPropagation();
        openQuickGenre(entry);
        return;
      }
      if (!selectMode) {
        if (isDoc) openDocumentDetail(entry.id);
        else openDetail(entry.id);
        return;
      }
      if (e.target.closest('.card-select')) return;
      const input = card.querySelector('.card-select-input');
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change'));
    });
    return card;
  }

  function openDocumentDetail(id) {
    return window.DocDetail.open({
      id,
      container: detailContent,
      overlay: detailOverlay,
      genreOptionsHtml: (selected) => genreOptionsHtml(selected),
      onSaved: async () => {
        await loadGenres();
        await loadBooks();
      },
    });
  }

  async function openQuickLibrary(book) {
    quickLibraryBookId = book.id;
    quickLibraryTitle.textContent = book.title;
    quickLibraryStatus.textContent = '';
    const res = await fetch('/api/libraries');
    const libs = await res.json();
    quickLibrarySelect.innerHTML = '<option value="">Unknown room</option>' + libs
      .filter((lib) => lib.name && !lib.virtual)
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

  function openQuickGenre(entry) {
    quickGenreBookId = entry.id;
    // Le genre existe des deux côtés, mais pas au même endroit de l'API.
    quickGenreEndpoint = entry.kind === 'document' ? 'documents' : 'books';
    quickGenreTitle.textContent = entry.title;
    quickGenreStatus.textContent = '';
    quickGenreSelect.innerHTML = genreOptionsHtml(entry.genre);
    quickGenreOverlay.classList.remove('hidden');
  }

  quickGenreSelect.addEventListener('change', async () => {
    const genre = quickGenreSelect.value || null;
    quickGenreSelect.disabled = true;
    quickGenreStatus.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/${quickGenreEndpoint}/${quickGenreBookId}`, {
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
    // La page de statistiques lit les mêmes paramètres que cette grille : le lien
    // les emporte, pour que « filtrer ici puis regarder les chiffres » porte sur
    // exactement la sélection qu'on a sous les yeux.
    if (statsLink) statsLink.href = `/stats.html${qs ? '?' + qs : ''}`;
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
  libSelect.addEventListener('change', () => {
    // Choisir la pièce « cloud » puis ne rien voir serait absurde : la bascule
    // suit. Elle n'est pas remise à zéro en sortant du cloud — c'est un choix
    // que l'utilisateur défait lui-même, comme les autres filtres.
    if (libSelect.value === CLOUD_ROOM) cloudToggle.checked = true;
    loadBooks();
  });
  genreSelect.addEventListener('change', loadBooks);
  cloudToggle.addEventListener('change', () => {
    // Décocher alors qu'on regarde justement la pièce cloud viderait la grille
    // sans rien expliquer : on revient à toutes les pièces.
    if (!cloudToggle.checked && libSelect.value === CLOUD_ROOM) libSelect.value = '';
    loadBooks();
  });
  flagInputs.forEach((i) => i.addEventListener('change', loadBooks));

  selectToggleBtn.addEventListener('click', () => setSelectMode(!selectMode));
  cancelSelectBtn.addEventListener('click', () => setSelectMode(false));

  selectAllCheckbox.addEventListener('change', () => {
    const idsOnPage = currentBooks.map((b) => b.uid);
    if (selectAllCheckbox.checked) {
      idsOnPage.forEach((id) => selectedIds.add(id));
    } else {
      idsOnPage.forEach((id) => selectedIds.delete(id));
    }
    grid.querySelectorAll('.card').forEach((card) => {
      const id = card.dataset.id;
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
        // Chaque échec porte sa propre raison : conflit d'identifiant d'import
        // pour un livre, absence de pièce physique pour un document du cloud.
        const lines = data.failed.map((f) => `• ${f.title || `#${f.id}`} — ${f.error}`).join('\n');
        alert(`${data.count} item(s) moved.\n${data.failed.length} not moved:\n${lines}`);
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
      .filter((lib) => lib.name && !lib.virtual)
      .map((lib) => `<option value="${escapeHtml(lib.name)}" ${lib.name === (book.library || '') ? 'selected' : ''}>${escapeHtml(lib.name)} (${lib.count})</option>`)
      .join('');
    detailContent.innerHTML = `
      <div class="image-search-results hidden"></div>
      <div class="detail-layout">
        <div class="cover-col">
          <label class="cover-edit">
            <input type="file" accept="image/*" class="cover-edit-input">
            <img class="cover" src="${coverUrl(book)}" alt="${escapeHtml(book.title)}">
            <span class="cover-edit-hint">Change cover</span>
          </label>
          <!-- Les trois mêmes actions qu'au formulaire d'ajout, dans le même
               ordre : recherche automatique, Google Images, photo de l'appareil.
               Le 📷 déclenche le champ fichier caché dans l'étiquette au-dessus,
               pour qu'il n'y ait qu'une seule entrée de fichier par fiche. -->
          <div class="cover-search-actions">
            <button type="button" class="secondary icon-btn image-search-btn" title="Search for a cover automatically">🔍</button>
            <button type="button" class="secondary icon-btn google-search-btn" title="Search Google Images">🌐</button>
            <button type="button" class="secondary icon-btn cover-file-btn" title="Add a photo from this device">📷</button>
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
          ${fieldRow('Language', `<select class="field-input" data-field="language">${languageOptionsHtml(book.language)}</select>`)}
          ${fieldRow('Series', `<input type="text" class="field-input" data-field="series" value="${escapeHtml(book.series || '')}">`)}
          ${fieldRow('No. in series', `<input type="number" step="any" class="field-input" data-field="series_index" value="${escapeHtml(book.series_index ?? '')}">`)}
          ${fieldRow('Tags, comma-separated', `<input type="text" class="field-input" data-field="tags" value="${escapeHtml((book.tags || []).join(', '))}">`, { full: true })}
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

    async function setCoverFromSearch(cover_base64) {
      try {
        await saveCover(cover_base64);
      } catch (err) {
        statusEl.textContent = err.message;
        return false; // le panneau reste ouvert : la vignette n'a pas été retenue
      }
      return true;
    }

    async function searchCover({ sound = false } = {}) {
      imageSearchBtn.disabled = true;
      try {
        await runImageSearch({
          host: imageSearchResults,
          title: detailContent.querySelector('[data-field="title"]').value,
          authors: detailContent.querySelector('[data-field="authors"]').value,
          isbn: detailContent.querySelector('[data-field="isbn"]').value,
          onPick: setCoverFromSearch,
          sound,
        });
      } finally {
        imageSearchBtn.disabled = false;
      }
    }

    imageSearchBtn.addEventListener('click', () => searchCover());

    detailContent.querySelector('.google-search-btn').addEventListener('click', () => {
      const titleVal = detailContent.querySelector('[data-field="title"]').value;
      const authorsVal = detailContent.querySelector('[data-field="authors"]').value;
      const isbnVal = detailContent.querySelector('[data-field="isbn"]').value.trim();
      // À défaut de titre — une fiche à peine créée depuis un scan — l'ISBN reste
      // une requête utile dans Google Images.
      const query = [titleVal, authorsVal].filter(Boolean).join(' ').trim() || isbnVal;
      if (!query) return;
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

        // Le catalogue a répondu mais sans image, et la fiche n'en a toujours
        // pas : la recherche enchaîne sans qu'on ait à la demander, maintenant
        // que le titre et l'auteur qui viennent d'arriver donnent de quoi
        // chercher. Elle attend le bip de succès pour ne pas se superposer.
        if (!book.has_cover) searchCover({ sound: true });
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
    // Le bouton 📷 et le clic sur la couverture ouvrent le même sélecteur : deux
    // chemins vers un seul champ fichier, pas deux champs.
    detailContent.querySelector('.cover-file-btn').addEventListener('click', () => fileInput.click());
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

    // Une fiche sans couverture lance la recherche d'elle-même : c'est la seule
    // raison d'ouvrir une telle fiche neuf fois sur dix, et l'attente des
    // sources court pendant qu'on relit le reste des champs. Avec le son, parce
    // qu'on n'a pas forcément les yeux sur l'écran quand ça arrive. Une fois par
    // livre et par session — rouvrir la même fiche ne rappelle pas les sources.
    if (!book.has_cover
      && !autoSearchAlreadyDone(book.id)
      && coverSearchIsPossible({ title: book.title, authors: (book.authors || []).join(', '), isbn: book.isbn })) {
      markAutoSearchDone(book.id);
      searchCover({ sound: true });
    }
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
    // Les vignettes du livre précédent n'ont rien à faire au-dessus du suivant.
    addImageSearchResults.classList.add('hidden');
    addImageSearchResults.innerHTML = '';
    isbnGoogleBtn.classList.add('hidden');
    addFormScannerUsed = false;
    libraryInput.value = lastLibrary;
    librarySelect.value = lastLibrary;
    addGenreSelect.value = lastGenre;
    addOverlay.classList.remove('hidden');
  }

  // Un seul bouton pour ajouter un livre. Les deux d'avant — « ajouter » et
  // « scanner » — menaient au même formulaire ; celui-ci commence par la caméra,
  // parce que scanner le code-barres est le geste courant et la saisie complète
  // l'exception. Sans caméra (ordinateur de bureau, HTTP sans TLS, permission
  // refusée) la fenêtre de scan se referme aussitôt et le formulaire, déjà
  // ouvert derrière, prend le relais : jamais d'impasse.
  document.getElementById('add-book-btn').addEventListener('click', async () => {
    openAddForm();
    const started = await startScanner((code) => {
      isbnInput.value = code;
      addFormScannerUsed = true;
      lookupIsbn();
    }, { quiet: true });
    if (!started) {
      stopScanner();
      isbnLookupStatus.textContent = 'No camera available — type the ISBN, or fill the fields by hand.';
      isbnInput.focus();
    }
  });

  let zxingReader = null;

  function stopScanner() {
    if (zxingReader) {
      try { zxingReader.reset(); } catch { /* already stopped */ }
    }
    scanOverlay.classList.add('hidden');
  }

  // Renvoie `true` si la caméra a démarré. L'appelant peut donc enchaîner sur
  // autre chose quand il n'y en a pas — c'est ce qui permet au bouton d'ajout
  // unique de retomber sur la saisie manuelle. `quiet` supprime le message
  // d'erreur dans la fenêtre de scan, pour les appelants qui ont un plan B et
  // n'ont pas besoin d'annoncer une panne.
  async function startScanner(onDecoded, { quiet = false } = {}) {
    scanStatus.textContent = 'Starting the camera…';
    scanOverlay.classList.remove('hidden');

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!quiet) scanStatus.textContent = 'Camera unavailable: the site must be served over HTTPS to access it from a phone (see README).';
      return false;
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
      return true;
    } catch (e) {
      if (!quiet) scanStatus.textContent = `Camera error: ${e.message}`;
      return false;
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
  // Le libellé doit rester court pour la tuile : `title` porte la formulation
  // complète quand elle apporte quelque chose.
  function setActionButton(btn, icon, label, title = label) {
    if (icon) btn.querySelector('.dup-action-icon').textContent = icon;
    btn.querySelector('.dup-action-label').textContent = label;
    btn.title = title;
  }

  function handleExistingBook(existing) {
    const currentRoom = libraryInput.value.trim();
    duplicateBook = existing;
    duplicateWasScanning = addFormScannerUsed;

    duplicateTitle.textContent = existing.title;
    // Voir la couverture déjà en base est le moyen le plus rapide de trancher :
    // c'est bien ce livre-là (donc doublon) ou une autre édition.
    duplicateCover.src = coverUrl(existing);
    duplicateCover.alt = existing.title || '';
    if (currentRoom && (existing.library || '') !== currentRoom) {
      // Les deux pièces vont dans la note : le libellé du bouton reste court,
      // sinon un nom de pièce à rallonge déborde de la tuile carrée.
      duplicateRoomNote.textContent = `Currently in "${existing.library || 'Unknown room'}" — you are filing into "${currentRoom}".`;
      setActionButton(duplicateMoveBtn, '📦', 'Move here', `Move to "${currentRoom}"`);
      duplicateMoveBtn.dataset.target = currentRoom;
      duplicateMoveBtn.classList.remove('hidden');
    } else {
      duplicateRoomNote.textContent = '';
      duplicateMoveBtn.classList.add('hidden');
    }
    // Libellés courts pour tenir dans une tuile ; la phrase complète reste en
    // infobulle (voir setActionButton).
    if (duplicateWasScanning) {
      setActionButton(duplicateIgnoreBtn, '📷', 'Scan another', 'Ignore this duplicate and scan another book');
    } else {
      setActionButton(duplicateIgnoreBtn, '✖', 'New entry', 'Ignore, add it as a new entry anyway');
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

      // Le cœur d'une séance de scan : le catalogue a rendu la fiche mais pas
      // d'image, donc la recherche de couverture part immédiatement, avec le
      // titre et l'auteur qui viennent d'arriver. Rien à cliquer — on scanne le
      // livre suivant pendant que les sources répondent, et les deux bips disent
      // quand c'est fini et s'il y a quelque chose à choisir.
      if (!coverPreview.dataset.base64) searchCoverForAddForm({ sound: true });
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

  // Les trois actions de couverture du formulaire d'ajout, identiques à celles
  // de la fiche détaillée. Ici la vignette choisie n'est pas enregistrée tout de
  // suite : elle attend l'enregistrement du livre, comme les autres champs.
  async function searchCoverForAddForm({ sound = false } = {}) {
    addImageSearchBtn.disabled = true;
    try {
      await runImageSearch({
        host: addImageSearchResults,
        title: addForm.elements.title.value,
        authors: addForm.elements.authors.value,
        isbn: isbnInput.value,
        onPick: (cover_base64) => {
          coverPreview.src = cover_base64;
          coverPreview.dataset.base64 = cover_base64;
        },
        sound,
      });
    } finally {
      addImageSearchBtn.disabled = false;
    }
  }

  addImageSearchBtn.addEventListener('click', () => searchCoverForAddForm());
  document.getElementById('add-cover-file-btn').addEventListener('click', () => coverInput.click());
  document.getElementById('add-google-images-btn').addEventListener('click', () => {
    const query = [addForm.elements.title.value, addForm.elements.authors.value]
      .filter(Boolean).join(' ').trim() || isbnInput.value.trim();
    if (!query) return;
    window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`, '_blank', 'noopener');
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

  // Un filtre nommé dans l'URL qui n'existe pas dans la liste est ajouté plutôt
  // qu'ignoré : une pièce vide n'apparaît pas au catalogue des pièces, et sans
  // cela `?library=cloud` retomberait en silence sur « toutes les pièces » —
  // c'est-à-dire sur une grille qui n'est pas celle qu'on a demandée.
  function selectValue(select, value) {
    select.value = value;
    if (select.value === value) return;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${value} (0)`;
    select.appendChild(opt);
    select.value = value;
  }

  // La bibliothèque lit ses filtres dans l'URL : c'est ce qui fait qu'un lien
  // venu de la page de statistiques — « voir ces titres dans le catalogue » —
  // arrive sur la même sélection que celle qu'on y regardait.
  function applyUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('q')) searchInput.value = params.get('q');
    if (params.has('genre')) selectValue(genreSelect, params.get('genre'));
    if (params.has('library')) selectValue(libSelect, params.get('library'));
    cloudToggle.checked = params.get('cloud') === '1' || params.get('library') === CLOUD_ROOM;
    for (const input of flagInputs) {
      if (params.get(input.dataset.flag) === '1') input.checked = true;
    }
  }

  Promise.all([loadLibraries(), loadGenres(), loadLanguages()])
    .then(() => {
      applyUrlFilters();
      return loadBooks();
    })
    .then(() => {
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
