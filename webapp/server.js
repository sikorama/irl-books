'use strict';

const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { openDb } = require('./lib/db.js');
const { buildEpub } = require('./lib/epub.js');
const { GENRES, guessGenre } = require('./lib/categorize.js');
const { lookupIsbn, imageSearchStream, hasGoogleBooksKey, describeGoogleBooksKey } = require('./lib/lookup.js');
const { upgradeCovers, DEFAULT_MIN_WIDTH } = require('./lib/covers.js');

// Usage: node server.js [--http]
function parseArgs() {
  const args = { forceHttp: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--http') args.forceHttp = true;
  }
  return args;
}
const ARGS = parseArgs();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8321;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CERT_FILE = path.join(__dirname, 'certs', 'cert.pem');
const KEY_FILE = path.join(__dirname, 'certs', 'key.pem');

const db = openDb();

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decodeCoverBase64(coverBase64) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(coverBase64);
  if (m) return { buf: Buffer.from(m[2], 'base64'), mime: m[1] };
  return { buf: Buffer.from(coverBase64, 'base64'), mime: 'image/jpeg' };
}

function rowToBook(row) {
  return {
    id: row.id,
    library: row.library,
    ident: row.ident,
    isbn: row.isbn,
    title: row.title,
    authors: JSON.parse(row.authors || '[]'),
    publisher: row.publisher,
    publishing_year: row.publishing_year,
    edition: row.edition,
    notes: row.notes,
    own: !!row.own,
    want: !!row.want,
    redd: !!row.redd,
    loaned: !!row.loaned,
    loaned_to: row.loaned_to,
    rating: row.rating,
    tags: JSON.parse(row.tags || '[]'),
    genre: row.genre,
    has_cover: row.cover !== null,
    created_at: row.created_at,
  };
}

const BOOK_COLUMNS = `
  id, library, ident, isbn, title, authors, publisher, publishing_year,
  edition, notes, own, want, redd, loaned, loaned_to, rating, tags, genre,
  cover, created_at
`;

function listBooks(query) {
  const clauses = [];
  const params = {};

  if (query.q) {
    clauses.push('(title LIKE @q OR authors LIKE @q OR publisher LIKE @q OR isbn LIKE @q)');
    params.q = `%${query.q}%`;
  }
  if (query.library) {
    clauses.push('library = @library');
    params.library = query.library;
  }
  if (query.genre) {
    if (query.genre === '(aucun)') {
      clauses.push('genre IS NULL');
    } else {
      clauses.push('genre = @genre');
      params.genre = query.genre;
    }
  }
  if (query.loaned === '1' || query.loaned === '0') {
    clauses.push('loaned = @loaned');
    params.loaned = Number(query.loaned);
  }
  if (query.no_cover === '1') {
    clauses.push('cover IS NULL');
  }
  if (query.no_isbn === '1') {
    clauses.push("(isbn IS NULL OR isbn = '')");
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT ${BOOK_COLUMNS} FROM books ${where} ORDER BY title COLLATE NOCASE ASC`;
  const rows = db.prepare(sql).all(params);
  return rows.map(rowToBook);
}

function getLibraries() {
  return db.prepare('SELECT library, COUNT(*) c FROM books GROUP BY library ORDER BY library COLLATE NOCASE')
    .all()
    .map((r) => ({ name: r.library, count: r.c }));
}

function getGenres() {
  const counts = new Map(
    db.prepare('SELECT genre, COUNT(*) c FROM books GROUP BY genre').all()
      .map((r) => [r.genre, r.c]),
  );
  const catalog = GENRES.map((g) => ({ ...g, count: counts.get(g.value) || 0 }));
  const noGenreCount = counts.get(null) || 0;
  return { genres: catalog, no_genre_count: noGenreCount };
}

function autoGenre(overwrite) {
  const rows = db.prepare('SELECT id, title, authors, genre FROM books').all();
  const stmt = db.prepare('UPDATE books SET genre = ? WHERE id = ?');
  let updated = 0;
  for (const row of rows) {
    if (row.genre && !overwrite) continue;
    const guessed = guessGenre({ title: row.title, authors: JSON.parse(row.authors || '[]') });
    if (!guessed || guessed === row.genre) continue;
    stmt.run(guessed, row.id);
    updated++;
  }
  return { updated, total: rows.length };
}

function getDuplicates() {
  // Group on ISBN when present, otherwise fall back to the legacy import
  // ident. Catches both old scan duplicates and new manual entries that
  // happen to share an ISBN with something already in the catalog.
  const keyed = db.prepare(`
    SELECT id, library, title, isbn, ident, cover IS NOT NULL AS has_cover,
           COALESCE(NULLIF(isbn, ''), ident) AS dup_key
    FROM books
    WHERE COALESCE(NULLIF(isbn, ''), ident) IS NOT NULL
  `).all();

  const groups = new Map();
  for (const row of keyed) {
    if (!groups.has(row.dup_key)) groups.set(row.dup_key, []);
    groups.get(row.dup_key).push(row);
  }

  const result = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const titles = new Set(rows.map((r) => String(r.title || '').trim().toLowerCase()));
    result.push({
      key,
      same_title: titles.size === 1,
      entries: rows.map((r) => ({
        id: r.id, library: r.library, title: r.title, isbn: r.isbn, has_cover: !!r.has_cover,
      })),
    });
  }
  // Surface the ambiguous (different-title) groups first.
  result.sort((a, b) => Number(a.same_title) - Number(b.same_title));
  return result;
}

function sanitizeFilename(name) {
  return String(name).replace(/[/\\?%*:|"<>]/g, '').trim().slice(0, 150) || 'book';
}

const EXPORT_DIR = path.join(__dirname, '..', 'calibre-export');

function exportCalibre() {
  const rows = db.prepare(`SELECT ${BOOK_COLUMNS}, cover_mime FROM books ORDER BY title COLLATE NOCASE ASC`).all();

  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const usedNames = new Set();
  let count = 0;
  for (const row of rows) {
    const book = {
      id: row.id,
      title: row.title,
      authors: JSON.parse(row.authors || '[]'),
      isbn: row.isbn,
      publisher: row.publisher,
      publishing_year: row.publishing_year,
      edition: row.edition,
      notes: row.notes,
      library: row.library,
      tags: JSON.parse(row.tags || '[]'),
      cover: row.cover,
      cover_mime: row.cover_mime,
    };

    const epubBuf = buildEpub(book);
    const baseName = sanitizeFilename(`${book.title} - ${book.authors.join(', ') || 'Unknown author'}`);
    let filename = `${baseName}.epub`;
    let suffix = 2;
    while (usedNames.has(filename)) {
      filename = `${baseName} (${suffix}).epub`;
      suffix++;
    }
    usedNames.add(filename);
    fs.writeFileSync(path.join(EXPORT_DIR, filename), epubBuf);
    count++;
  }

  return { count, path: EXPORT_DIR };
}

// Le ré-upgrade des couvertures dure plusieurs minutes : il tourne en tâche de
// fond et la page interroge son état. Un seul travail à la fois, gardé en
// mémoire après la fin pour que le résultat survive à un rechargement de page.
const COVER_JOB_LOG_MAX = 60;
let coverJob = null;

function startCoverUpgrade({ minWidth, dryRun }) {
  const job = {
    running: true,
    cancelled: false,
    min_width: minWidth,
    dry_run: dryRun,
    total: null,
    processed: 0,
    upgraded: 0,
    unchanged: 0,
    failed: 0,
    current: null,
    log: [],
    source_errors: {},
    error: null,
    finished: false,
  };
  coverJob = job;

  upgradeCovers(db, {
    minWidth,
    dryRun,
    onStart: (total) => { job.total = total; },
    onProgress: (event, totals) => {
      job.processed = totals.processed;
      job.upgraded = totals.upgraded;
      job.unchanged = totals.unchanged;
      job.failed = totals.failed;
      job.current = { id: event.id, title: event.title };
      if (event.status === 'unchanged') return;
      job.log.push({
        id: event.id,
        title: event.title,
        width: event.width,
        new_width: event.new_width,
        status: event.status,
        error: event.error || null,
      });
      if (job.log.length > COVER_JOB_LOG_MAX) job.log.shift();
    },
    shouldStop: () => job.cancelled,
  })
    .then((result) => { job.source_errors = result.source_errors; })
    .catch((e) => { job.error = e.message; })
    .finally(() => {
      job.running = false;
      job.current = null;
      job.finished = true;
    });

  return job;
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'books') {
    const query = Object.fromEntries(url.searchParams.entries());
    return sendJson(res, 200, listBooks(query));
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'libraries') {
    return sendJson(res, 200, getLibraries());
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'genres') {
    return sendJson(res, 200, getGenres());
  }

  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'books' && parts[2] === 'auto-genre') {
    let payload = {};
    try {
      const raw = await readBody(req);
      if (raw.length) payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }
    const result = autoGenre(!!payload.overwrite);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === 'PATCH' && parts.length === 2 && parts[1] === 'libraries') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }
    const newName = payload.new ? String(payload.new).trim() : '';
    if (!newName) return sendJson(res, 400, { error: 'The new name cannot be empty.' });
    const oldName = payload.old != null ? String(payload.old) : null;
    if (oldName === null) {
      db.prepare('UPDATE books SET library = ? WHERE library IS NULL').run(newName);
    } else {
      db.prepare('UPDATE books SET library = ? WHERE library = ?').run(newName, oldName);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'duplicates') {
    return sendJson(res, 200, getDuplicates());
  }

  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'export' && parts[2] === 'calibre') {
    try {
      const result = exportCalibre();
      return sendJson(res, 200, { ok: true, count: result.count, path: result.path });
    } catch (e) {
      return sendJson(res, 500, { error: `Export failed: ${e.message}` });
    }
  }

  if (parts.length >= 3 && parts[1] === 'covers' && parts[2] === 'upgrade') {
    if (req.method === 'GET' && parts.length === 3) {
      return sendJson(res, 200, coverJob || { running: false, finished: false });
    }
    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'cancel') {
      if (!coverJob || !coverJob.running) return sendJson(res, 409, { error: 'No upgrade in progress.' });
      coverJob.cancelled = true;
      return sendJson(res, 200, coverJob);
    }
    if (req.method === 'POST' && parts.length === 3) {
      if (coverJob && coverJob.running) {
        return sendJson(res, 409, { error: 'An upgrade is already running.' });
      }
      let payload = {};
      try {
        const raw = await readBody(req);
        if (raw.length) payload = JSON.parse(raw.toString('utf8'));
      } catch (e) {
        return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
      }
      const minWidth = Number.isFinite(Number(payload.min_width))
        ? Math.min(Math.max(Math.trunc(Number(payload.min_width)), 50), 4000)
        : DEFAULT_MIN_WIDTH;
      return sendJson(res, 202, startCoverUpgrade({ minWidth, dryRun: !!payload.dry_run }));
    }
  }

  // Flux NDJSON : une ligne JSON par évènement, écrite dès qu'elle est connue.
  // La recherche interroge cinq sources dont certaines mettent une vingtaine de
  // secondes ; attendre la plus lente pour tout afficher d'un coup donnait
  // l'impression que rien ne se passait.
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'image-search') {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    const emit = (event) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await imageSearchStream({
        title: url.searchParams.get('title'),
        authors: url.searchParams.get('authors'),
        isbn: url.searchParams.get('isbn'),
      }, emit);
    } catch (e) {
      emit({ type: 'source', name: 'search', state: 'error', message: e.message });
      emit({ type: 'done' });
    }
    return res.end();
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'isbn-lookup') {
    try {
      const cleanIsbn = String(parts[2]).replace(/[^0-9Xx]/g, '');
      if (cleanIsbn) {
        const existingRow = db.prepare(`SELECT ${BOOK_COLUMNS} FROM books WHERE isbn = ?`).get(cleanIsbn);
        if (existingRow) {
          return sendJson(res, 200, { found: true, existing: rowToBook(existingRow) });
        }
      }
      const result = await lookupIsbn(parts[2]);
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 502, { found: false, error: `Lookup failed: ${e.message}` });
    }
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'books') {
    const id = Number(parts[2]);
    const row = db.prepare(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`).get(id);
    if (!row) return sendJson(res, 404, { error: 'not found' });
    return sendJson(res, 200, rowToBook(row));
  }

  if (req.method === 'GET' && parts.length === 4 && parts[1] === 'books' && parts[3] === 'cover') {
    const id = Number(parts[2]);
    const row = db.prepare('SELECT cover, cover_mime FROM books WHERE id = ?').get(id);
    if (!row || !row.cover) {
      return fs.readFile(path.join(__dirname, '..', 'db-alexandria', 'nocover.jpg'), (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(data);
      });
    }
    res.writeHead(200, {
      'Content-Type': row.cover_mime || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return res.end(row.cover);
  }

  if (req.method === 'PATCH' && parts.length === 4 && parts[1] === 'books' && parts[3] === 'cover') {
    const id = Number(parts[2]);
    const existing = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
    if (!existing) return sendJson(res, 404, { error: 'not found' });

    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }
    if (!payload.cover_base64) {
      return sendJson(res, 400, { error: 'cover_base64 missing.' });
    }

    let coverBuf;
    let coverMime;
    try {
      const decoded = decodeCoverBase64(payload.cover_base64);
      coverBuf = decoded.buf;
      coverMime = payload.cover_mime || decoded.mime;
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid cover image: ${e.message}` });
    }

    db.prepare('UPDATE books SET cover = ?, cover_mime = ? WHERE id = ?').run(coverBuf, coverMime, id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'PATCH' && parts.length === 3 && parts[1] === 'books') {
    const id = Number(parts[2]);
    const existing = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
    if (!existing) return sendJson(res, 404, { error: 'not found' });

    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }

    const EDITABLE_FIELDS = [
      'library', 'isbn', 'title', 'publisher', 'publishing_year',
      'edition', 'notes', 'loaned', 'loaned_to', 'genre',
    ];
    const sets = [];
    const params = { id };
    for (const field of EDITABLE_FIELDS) {
      if (!(field in payload)) continue;
      let value = payload[field];
      if (field === 'library') value = value ? String(value).trim() || null : null;
      if (field === 'genre') value = value ? String(value).trim() || null : null;
      if (field === 'loaned') value = value ? 1 : 0;
      sets.push(`${field} = @${field}`);
      params[field] = value;
    }
    if ('authors' in payload) {
      const authors = Array.isArray(payload.authors)
        ? payload.authors
        : String(payload.authors || '').split(',').map((s) => s.trim()).filter(Boolean);
      sets.push('authors = @authors');
      params.authors = JSON.stringify(authors);
    }
    if (sets.length === 0) return sendJson(res, 400, { error: 'No field to update.' });
    if ('title' in payload && !String(payload.title).trim()) {
      return sendJson(res, 400, { error: 'Title cannot be empty.' });
    }

    try {
      db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = @id`).run(params);
    } catch {
      return sendJson(res, 400, { error: "Another book in this room already has the same import identifier (duplicate conflict)." });
    }
    const row = db.prepare(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`).get(id);
    return sendJson(res, 200, rowToBook(row));
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'books') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }

    if (!payload.title || !String(payload.title).trim()) {
      return sendJson(res, 400, { error: 'Title is required.' });
    }

    let coverBuf = null;
    let coverMime = null;
    if (payload.cover_base64) {
      try {
        const decoded = decodeCoverBase64(payload.cover_base64);
        coverBuf = decoded.buf;
        coverMime = payload.cover_mime || decoded.mime;
      } catch (e) {
        return sendJson(res, 400, { error: `Invalid cover image: ${e.message}` });
      }
    }

    const authors = Array.isArray(payload.authors)
      ? payload.authors
      : String(payload.authors || '').split(',').map((s) => s.trim()).filter(Boolean);

    const title = String(payload.title).trim();
    const genre = payload.genre ? String(payload.genre).trim() : guessGenre({ title, authors });

    const stmt = db.prepare(`
      INSERT INTO books
        (library, ident, isbn, title, authors, publisher, publishing_year,
         edition, notes, own, want, redd, loaned, loaned_to, rating, tags, genre,
         cover, cover_mime)
      VALUES
        (@library, NULL, @isbn, @title, @authors, @publisher, @publishing_year,
         @edition, @notes, @own, @want, @redd, @loaned, @loaned_to, @rating, @tags, @genre,
         @cover, @cover_mime)
    `);

    const info = stmt.run({
      library: payload.library || 'Ajouts manuels',
      isbn: payload.isbn || null,
      title,
      authors: JSON.stringify(authors),
      publisher: payload.publisher || null,
      publishing_year: Number.isInteger(payload.publishing_year) ? payload.publishing_year : null,
      edition: payload.edition || null,
      notes: payload.notes || null,
      own: 0,
      want: 0,
      redd: 0,
      loaned: payload.loaned ? 1 : 0,
      loaned_to: payload.loaned_to || null,
      rating: Number.isInteger(payload.rating) ? payload.rating : null,
      tags: JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
      genre: genre || null,
      cover: coverBuf,
      cover_mime: coverMime,
    });

    const row = db.prepare(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`).get(info.lastInsertRowid);
    return sendJson(res, 201, rowToBook(row));
  }

  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'books' && parts[2] === 'move') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }
    const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Number.isInteger) : [];
    const library = payload.library ? String(payload.library).trim() : '';
    if (!ids.length) return sendJson(res, 400, { error: 'No book selected.' });
    if (!library) return sendJson(res, 400, { error: 'Destination room missing.' });

    const titleStmt = db.prepare('SELECT title FROM books WHERE id = ?');
    const moveStmt = db.prepare('UPDATE books SET library = ? WHERE id = ?');
    const moved = [];
    const failed = [];
    for (const id of ids) {
      try {
        moveStmt.run(library, id);
        moved.push(id);
      } catch {
        const row = titleStmt.get(id);
        failed.push({
          id,
          title: row ? row.title : null,
          error: `Another book in "${library}" already has the same import identifier (duplicate conflict).`,
        });
      }
    }
    return sendJson(res, 200, { ok: true, count: moved.length, moved, failed });
  }

  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'books' && parts[2] === 'set-genre') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: `Invalid body: ${e.message}` });
    }
    const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Number.isInteger) : [];
    const genre = payload.genre ? String(payload.genre).trim() || null : null;
    if (!ids.length) return sendJson(res, 400, { error: 'No book selected.' });

    const setGenreStmt = db.prepare('UPDATE books SET genre = ? WHERE id = ?');
    for (const id of ids) setGenreStmt.run(genre, id);
    return sendJson(res, 200, { ok: true, count: ids.length, updated: ids });
  }

  if (req.method === 'DELETE' && parts.length === 3 && parts[1] === 'books') {
    const id = Number(parts[2]);
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    res.writeHead(204);
    return res.end();
  }

  sendJson(res, 404, { error: 'Unknown route' });
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e.message });
  }
}

const hasCert = fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
const useHttps = hasCert && !ARGS.forceHttp;
const protocol = useHttps ? 'https' : 'http';
const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, requestHandler)
  : http.createServer(requestHandler);

function localNetworkAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

server.listen(PORT, () => {
  console.log(`IRL-Books: ${protocol}://localhost:${PORT}`);
  for (const addr of localNetworkAddresses()) {
    console.log(`  reachable on the network: ${protocol}://${addr}:${PORT}`);
  }
  if (!useHttps) {
    if (ARGS.forceHttp && hasCert) {
      console.log('(HTTPS forced off via --http.)');
    } else {
      console.log('(HTTPS disabled: run `node gen-cert.js` then restart the server to enable it.)');
    }
    console.log('WARNING: running over plain HTTP — camera barcode scanning will not work on phones/other devices (only `localhost` is exempt from the secure-context requirement).');
  }
  console.log(`Google Books: ${describeGoogleBooksKey()}`);
  if (!hasGoogleBooksKey()) {
    console.log('  (keyless requests share an anonymous daily quota that is usually already exhausted — HTTP 429. ISBN lookups still work via the BnF and Open Library; cover search by title is degraded. See README.)');
  }
});
