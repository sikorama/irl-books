(() => {
  const librariesList = document.getElementById('libraries-list');
  const duplicatesList = document.getElementById('duplicates-list');
  const exportBtn = document.getElementById('export-calibre-btn');
  const exportStatus = document.getElementById('export-status');
  const genresList = document.getElementById('genres-list');
  const genreOverwriteCheckbox = document.getElementById('genre-overwrite-checkbox');
  const autoGenreBtn = document.getElementById('auto-genre-btn');
  const autoGenreStatus = document.getElementById('auto-genre-status');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Même clé que le formulaire d'ajout dans app.js : régler la pièce courante
  // ici et en filer une depuis la bibliothèque écrivent au même endroit, la
  // dernière action gagne.
  const CURRENT_ROOM_KEY = 'irl-books:lastLibrary';
  const currentRoomSelect = document.getElementById('current-room-select');
  const currentRoomInput = document.getElementById('current-room-input');
  const currentRoomStatus = document.getElementById('current-room-status');

  function describeCurrentRoom(room, known) {
    if (!room) return 'No current room — new books will go to "Ajouts manuels".';
    if (!known) return `New books will be filed in "${room}" (a room with no books yet).`;
    return `New books will be filed in "${room}".`;
  }

  function renderCurrentRoom(libs) {
    const room = localStorage.getItem(CURRENT_ROOM_KEY) || '';
    const names = libs.map((lib) => lib.name).filter(Boolean);
    currentRoomSelect.innerHTML = '<option value="">Choose a room…</option>'
      + names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    currentRoomSelect.value = names.includes(room) ? room : '';
    currentRoomInput.value = room;
    currentRoomStatus.textContent = describeCurrentRoom(room, names.includes(room));
  }

  function saveCurrentRoom(room) {
    localStorage.setItem(CURRENT_ROOM_KEY, room);
    const known = [...currentRoomSelect.options].some((o) => o.value && o.value === room);
    currentRoomStatus.textContent = `Saved ✓ — ${describeCurrentRoom(room, known)}`;
  }

  currentRoomSelect.addEventListener('change', () => {
    currentRoomInput.value = currentRoomSelect.value;
    saveCurrentRoom(currentRoomSelect.value);
  });
  currentRoomInput.addEventListener('change', () => {
    const room = currentRoomInput.value.trim();
    currentRoomInput.value = room;
    currentRoomSelect.value = [...currentRoomSelect.options].some((o) => o.value === room) ? room : '';
    saveCurrentRoom(room);
  });

  async function loadLibraries() {
    const res = await fetch('/api/libraries');
    const libs = (await res.json()).filter((lib) => !lib.virtual);
    // Le cloud est une pièce virtuelle : la renommer ne toucherait aucune fiche
    // papier, donc elle n'a rien à faire dans l'outil de renommage en masse.
    renderCurrentRoom(libs);
    librariesList.innerHTML = '';
    for (const lib of libs) {
      const row = document.createElement('div');
      row.className = 'library-row';
      row.innerHTML = `
        <span class="library-count">${lib.count}</span>
        <input type="text" class="library-name-input" value="${escapeHtml(lib.name || '')}" placeholder="Unknown room">
        <button class="secondary icon-btn rename-btn" title="Rename">✏️</button>
      `;
      const input = row.querySelector('.library-name-input');
      const btn = row.querySelector('.rename-btn');
      btn.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) { alert('Name cannot be empty.'); return; }
        if (newName === (lib.name || '')) return;
        btn.disabled = true;
        try {
          const patchRes = await fetch('/api/libraries', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old: lib.name, new: newName }),
          });
          const data = await patchRes.json();
          if (!patchRes.ok) throw new Error(data.error || 'Unknown error');
          // Renommer la pièce courante ne doit pas la laisser pointer sur un
          // nom qui n'existe plus.
          if (lib.name && localStorage.getItem(CURRENT_ROOM_KEY) === lib.name) {
            localStorage.setItem(CURRENT_ROOM_KEY, newName);
          }
          await loadLibraries();
        } catch (e) {
          alert(`Error: ${e.message}`);
          btn.disabled = false;
        }
      });
      librariesList.appendChild(row);
    }
  }

  // --- Éditeur de genres ----------------------------------------------------
  //
  // Toute l'interface ne manipule que le `value` d'un genre. Les intitulés et les
  // mots-clés sont des données éditables ; changer la langue d'affichage ne
  // touche donc jamais à la classification, c'est le point de tout ce système.

  const LANG_KEY = 'irl-books:lang';
  let uiLang = localStorage.getItem(LANG_KEY) || 'fr';
  let genreCatalog = { genres: [], langs: ['fr', 'en'], no_genre_count: 0 };

  const langSelect = document.getElementById('lang-select');
  const addGenreBtn = document.getElementById('add-genre-btn');
  const genreEditStatus = document.getElementById('genre-edit-status');

  function labelOf(g) {
    return g.labels[uiLang] || g.labels.fr || g.labels.en || g.value;
  }

  function keywordsFor(g, lang) {
    return (g.keywords[lang] || []).join(', ');
  }

  async function saveGenre(value, patch) {
    genreEditStatus.textContent = 'Saving…';
    const res = await fetch(`/api/genres/${encodeURIComponent(value)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Not saved (HTTP ${res.status})`);
    genreEditStatus.textContent = 'Saved ✓';
    return data;
  }

  function parseKeywordList(raw) {
    return String(raw || '')
      .split(/[,\n]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  }

  function renderGenreRow(g) {
    const row = document.createElement('details');
    row.className = 'genre-row';
    const langs = genreCatalog.langs;
    // `*` est proposé comme une langue de plus, parce que c'est exactement son
    // rôle du point de vue de l'édition : une liste de mots-clés parmi d'autres.
    const keywordLangs = [...langs, '*'];

    row.innerHTML = `
      <summary>
        <span class="library-count">${g.count}</span>
        <span class="genre-name">${escapeHtml(labelOf(g))}</span>
        <code class="genre-slug">${escapeHtml(g.value)}</code>
      </summary>
      <div class="genre-body">
        <div class="genre-labels">
          ${langs.map((l) => `
            <label>Label (${escapeHtml(l)})
              <input type="text" data-label-lang="${escapeHtml(l)}" value="${escapeHtml(g.labels[l] || '')}">
            </label>`).join('')}
        </div>
        ${keywordLangs.map((l) => `
          <label class="genre-keywords">Keywords (${escapeHtml(l)}) — comma-separated
            <textarea rows="2" data-kw-lang="${escapeHtml(l)}">${escapeHtml(keywordsFor(g, l))}</textarea>
          </label>`).join('')}
        <div class="genre-row-actions">
          <button type="button" class="secondary genre-save">Save</button>
          <button type="button" class="secondary genre-delete"${g.count ? ' disabled title="Move its items to another genre first"' : ''}>Delete</button>
          <span class="genre-row-note">${g.count ? `${g.count} item(s) use this genre` : 'unused — can be deleted'}</span>
        </div>
      </div>
    `;

    row.querySelector('.genre-save').addEventListener('click', async () => {
      const labels = {};
      row.querySelectorAll('[data-label-lang]').forEach((i) => { labels[i.dataset.labelLang] = i.value; });
      const keywords = {};
      row.querySelectorAll('[data-kw-lang]').forEach((t) => { keywords[t.dataset.kwLang] = parseKeywordList(t.value); });
      try {
        await saveGenre(g.value, { labels, keywords });
        await loadGenres();
      } catch (e) {
        genreEditStatus.textContent = e.message;
      }
    });

    row.querySelector('.genre-delete').addEventListener('click', async () => {
      if (!confirm(`Delete the genre "${labelOf(g)}"? Its keywords are lost.`)) return;
      genreEditStatus.textContent = 'Deleting…';
      const res = await fetch(`/api/genres/${encodeURIComponent(g.value)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        genreEditStatus.textContent = data.error || `Not deleted (HTTP ${res.status})`;
        return;
      }
      genreEditStatus.textContent = 'Deleted ✓';
      await loadGenres();
    });

    return row;
  }

  async function loadGenres() {
    const res = await fetch(`/api/genres?lang=${encodeURIComponent(uiLang)}`);
    genreCatalog = await res.json();

    const current = langSelect.value;
    langSelect.innerHTML = genreCatalog.langs
      .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
    langSelect.value = current || uiLang;

    genresList.innerHTML = '';
    // Dans l'ordre d'évaluation, pas par nombre de fiches : c'est cet ordre qui
    // décide quel genre gagne, donc c'est celui qu'il faut voir pour comprendre.
    for (const g of genreCatalog.genres) genresList.appendChild(renderGenreRow(g));

    const noGenreRow = document.createElement('div');
    noGenreRow.className = 'genre-row genre-row-static';
    noGenreRow.innerHTML = `
      <span class="library-count">${genreCatalog.no_genre_count}</span>
      <span class="genre-name">No genre</span>
    `;
    genresList.appendChild(noGenreRow);
  }

  langSelect.addEventListener('change', async () => {
    uiLang = langSelect.value;
    localStorage.setItem(LANG_KEY, uiLang);
    await loadGenres();
  });

  addGenreBtn.addEventListener('click', async () => {
    const fr = prompt('French label for the new genre?');
    if (!fr || !fr.trim()) return;
    const en = prompt('English label? (optional)') || '';
    genreEditStatus.textContent = 'Creating…';
    try {
      const res = await fetch('/api/genres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: { fr: fr.trim(), en: en.trim() }, keywords: {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Not created (HTTP ${res.status})`);
      // Créé en fin de liste, donc évalué en dernier : ses mots-clés ne peuvent
      // pas détourner une classification existante sans intention explicite.
      genreEditStatus.textContent = `Created "${data.value}" — added at the end of the evaluation order.`;
      await loadGenres();
    } catch (e) {
      genreEditStatus.textContent = e.message;
    }
  });

  autoGenreBtn.addEventListener('click', async () => {
    const overwrite = genreOverwriteCheckbox.checked;
    autoGenreBtn.disabled = true;
    const originalText = autoGenreBtn.textContent;
    autoGenreBtn.textContent = '⏳';
    autoGenreStatus.textContent = '';
    try {
      const res = await fetch('/api/books/auto-genre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Categorization failed.');
      const per = Object.entries(data.by_collection || {})
        .map(([k, v]) => `${v.updated}/${v.total} ${k === 'books' ? 'books' : 'documents'}`)
        .join(' · ');
      autoGenreStatus.textContent = `${data.updated} item(s) categorized out of ${data.total}${per ? ` (${per})` : ''}.`;
      await loadGenres();
    } catch (e) {
      autoGenreStatus.textContent = `Error: ${e.message}`;
    } finally {
      autoGenreBtn.disabled = false;
      autoGenreBtn.textContent = originalText;
    }
  });

  function renderDuplicates(groups) {
    duplicatesList.innerHTML = '';
    if (groups.length === 0) {
      duplicatesList.innerHTML = '<p class="dup-empty">No duplicates detected 🎉</p>';
      return;
    }
    for (const group of groups) {
      const box = document.createElement('div');
      box.className = 'dup-group' + (group.same_title ? '' : ' conflict');
      box.innerHTML = `
        <p class="dup-group-label">${group.same_title ? 'Same title — likely 2 copies of the same book (nothing to do if that’s intended)' : '⚠️ Different titles for the same ISBN — likely a scanning error in the source, not a real duplicate: only delete if one of the two is genuinely a mistake'} (ISBN/key: ${escapeHtml(group.key)})</p>
        <div class="dup-entries"></div>
      `;
      const entriesEl = box.querySelector('.dup-entries');
      for (const entry of group.entries) {
        const el = document.createElement('div');
        el.className = 'dup-entry';
        el.innerHTML = `
          <img src="/api/books/${entry.id}/cover" alt="">
          <div class="dup-info">
            <p class="dup-title"><a href="/?openBook=${entry.id}" title="Open this book's details">${escapeHtml(entry.title)}</a></p>
            <p class="dup-meta">${escapeHtml(entry.library || 'Unknown room')} · #${entry.id}</p>
          </div>
          <button data-id="${entry.id}" class="icon-btn" title="Delete">🗑️</button>
        `;
        el.querySelector('button').addEventListener('click', async () => {
          if (!confirm(`Delete "${entry.title}" (#${entry.id})?`)) return;
          await fetch(`/api/books/${entry.id}`, { method: 'DELETE' });
          await loadDuplicates();
          await loadLibraries();
        });
        entriesEl.appendChild(el);
      }
      duplicatesList.appendChild(box);
    }
  }

  async function loadDuplicates() {
    duplicatesList.innerHTML = '<p class="dup-empty">Loading…</p>';
    const res = await fetch('/api/duplicates');
    const groups = await res.json();
    renderDuplicates(groups);
  }

  const upgradeCoversBtn = document.getElementById('upgrade-covers-btn');
  const cancelCoversBtn = document.getElementById('cancel-covers-btn');
  const coverMinWidth = document.getElementById('cover-min-width');
  const coverDryRun = document.getElementById('cover-dry-run');
  const coverProgress = document.getElementById('cover-progress');
  const coverProgressFill = document.getElementById('cover-progress-fill');
  const coverProgressText = document.getElementById('cover-progress-text');
  const coverProgressLog = document.getElementById('cover-progress-log');
  const upgradeCoversStatus = document.getElementById('upgrade-covers-status');

  let coverPollTimer = null;

  function renderCoverJob(job) {
    if (!job || (!job.running && !job.finished)) {
      coverProgress.classList.add('hidden');
      return;
    }
    coverProgress.classList.remove('hidden');

    const total = job.total;
    const pct = total ? Math.round((job.processed / total) * 100) : 0;
    coverProgressFill.style.width = `${pct}%`;

    const counts = `${job.upgraded} upgraded · ${job.unchanged} left alone`
      + (job.failed ? ` · ${job.failed} failed` : '');
    if (job.running) {
      const position = total === null ? 'Listing covers…' : `${job.processed}/${total} (${pct}%)`;
      const current = job.current ? ` — ${job.current.title}` : '';
      coverProgressText.textContent = `${position} · ${counts}${current}`;
    } else {
      const stopped = job.cancelled ? 'Stopped' : 'Done';
      coverProgressText.textContent = `${stopped} — ${job.processed} book(s) examined · ${counts}`;
    }

    coverProgressLog.innerHTML = job.log.map((entry) => {
      if (entry.status === 'failed') {
        return `<li class="failed">#${entry.id} ${escapeHtml(entry.title)} — ${escapeHtml(entry.error || 'error')}</li>`;
      }
      return `<li><span class="gain">${entry.width}px → ${entry.new_width}px</span> ${escapeHtml(entry.title)}</li>`;
    }).reverse().join('');

    upgradeCoversBtn.disabled = job.running;
    upgradeCoversBtn.textContent = job.running ? '⏳' : '🖼️';
    cancelCoversBtn.classList.toggle('hidden', !job.running);

    if (job.running) return;

    const notes = [];
    if (job.error) notes.push(`Error: ${job.error}`);
    if (job.dry_run) notes.push('Simulation — nothing was written.');
    for (const [source, count] of Object.entries(job.source_errors || {})) {
      notes.push(`${source} was unreachable on ${count} book(s).`);
    }
    upgradeCoversStatus.textContent = notes.join(' ');
  }

  async function pollCoverJob() {
    try {
      const res = await fetch('/api/covers/upgrade');
      const job = await res.json();
      renderCoverJob(job);
      if (!job.running && coverPollTimer) {
        clearInterval(coverPollTimer);
        coverPollTimer = null;
      }
    } catch {
      // Perte de réseau passagère : le prochain tick réessaiera.
    }
  }

  function watchCoverJob() {
    if (coverPollTimer) return;
    coverPollTimer = setInterval(pollCoverJob, 1000);
  }

  upgradeCoversBtn.addEventListener('click', async () => {
    upgradeCoversBtn.disabled = true;
    upgradeCoversStatus.textContent = '';
    coverProgressLog.innerHTML = '';
    try {
      const res = await fetch('/api/covers/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          min_width: Number(coverMinWidth.value) || 400,
          dry_run: coverDryRun.checked,
        }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Could not start the upgrade.');
      renderCoverJob(job);
      watchCoverJob();
    } catch (e) {
      upgradeCoversStatus.textContent = `Error: ${e.message}`;
      upgradeCoversBtn.disabled = false;
    }
  });

  cancelCoversBtn.addEventListener('click', async () => {
    cancelCoversBtn.disabled = true;
    try {
      await fetch('/api/covers/upgrade/cancel', { method: 'POST' });
    } finally {
      cancelCoversBtn.disabled = false;
    }
  });

  // Un travail lancé avant un rechargement de page continue côté serveur : on
  // se raccroche à son état au chargement.
  async function resumeCoverJob() {
    const res = await fetch('/api/covers/upgrade');
    const job = await res.json();
    renderCoverJob(job);
    if (job.running) watchCoverJob();
  }

  exportBtn.addEventListener('click', async () => {
    const originalText = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = '⏳';
    exportStatus.textContent = '';
    try {
      const res = await fetch('/api/export/calibre', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed.');
      exportStatus.textContent = `${data.count} book${data.count !== 1 ? 's' : ''} exported to: ${data.path}`;
    } catch (e) {
      exportStatus.textContent = `Error: ${e.message}`;
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalText;
    }
  });

  loadLibraries();
  loadGenres();
  loadDuplicates();
  resumeCoverJob();
})();
