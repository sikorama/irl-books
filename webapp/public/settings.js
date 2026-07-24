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

  async function loadLibraries() {
    const res = await fetch('/api/libraries');
    const libs = await res.json();
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
          await loadLibraries();
        } catch (e) {
          alert(`Error: ${e.message}`);
          btn.disabled = false;
        }
      });
      librariesList.appendChild(row);
    }
  }

  async function loadGenres() {
    const res = await fetch('/api/genres');
    const data = await res.json();
    genresList.innerHTML = '';
    const sorted = [...data.genres].sort((a, b) => b.count - a.count);
    for (const g of sorted) {
      const row = document.createElement('div');
      row.className = 'library-row';
      row.innerHTML = `
        <span class="library-count">${g.count}</span>
        <span>${escapeHtml(g.label)}</span>
      `;
      genresList.appendChild(row);
    }
    const noGenreRow = document.createElement('div');
    noGenreRow.className = 'library-row';
    noGenreRow.innerHTML = `
      <span class="library-count">${data.no_genre_count}</span>
      <span>No genre</span>
    `;
    genresList.appendChild(noGenreRow);
  }

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
      autoGenreStatus.textContent = `${data.updated} book${data.updated !== 1 ? 's' : ''} categorized out of ${data.total}.`;
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
            <p class="dup-title">${escapeHtml(entry.title)}</p>
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
})();
