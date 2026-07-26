'use strict';

// Requêtes et service de fichiers de la collection numérique.

const fs = require('fs');
const path = require('path');
const fts = require('./docs-fts.js');
const { normalizeLang } = require('./languages.js');

const DOCUMENT_COLUMNS = `
  id, calibre_id, dir, cover_name, title, authors, series, series_index,
  publisher, pubdate, pub_year, language, isbn, doi, identifiers, pages,
  tags, genre, rating, notes, comments, redd, meta_source,
  primary_format, primary_size, file_count, missing_count, text_indexed_at,
  created_at, updated_at
`;

// Les résumés viennent de Calibre, qui les récupère de sources web : c'est du
// HTML d'origine non contrôlée, et le panneau détail l'affiche en innerHTML.
// Plutôt qu'une liste blanche de balises à maintenir, on ne garde que le texte et
// les sauts de paragraphe — 28 fiches concernées, la mise en forme n'y vaut pas
// une surface d'attaque.
function stripHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function rowToDocument(row) {
  return {
    id: row.id,
    calibre_id: row.calibre_id,
    title: row.title,
    authors: JSON.parse(row.authors || '[]'),
    series: row.series,
    series_index: row.series_index,
    publisher: row.publisher,
    pubdate: row.pubdate,
    pub_year: row.pub_year,
    language: row.language,
    isbn: row.isbn,
    doi: row.doi,
    identifiers: row.identifiers ? JSON.parse(row.identifiers) : {},
    pages: row.pages,
    tags: JSON.parse(row.tags || '[]'),
    genre: row.genre,
    rating: row.rating,
    notes: row.notes,
    comments: stripHtml(row.comments),
    redd: !!row.redd,
    meta_source: row.meta_source,
    format: row.primary_format,
    size: row.primary_size,
    file_count: row.file_count,
    missing_count: row.missing_count,
    has_cover: !!row.cover_name,
    indexed: !!row.text_indexed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Le cloud est une pièce du catalogue comme le Grand Bureau ou le Grenier : un
// document et un livre papier doivent pouvoir cohabiter dans la même grille.
// Cette projection est le plus petit dénominateur commun des deux — juste ce
// qu'une carte affiche. Le détail, lui, reste spécifique à chaque type.
//
// `uid` existe parce que les deux tables ont leur propre AUTOINCREMENT : le
// livre 42 et le document 42 existent tous les deux. Le client a besoin d'une
// identité qui ne collisionne pas pour la sélection multiple, alors que `id`
// reste l'identifiant local utilisé dans les URL d'API.
const CLOUD_ROOM = 'cloud';

function toCatalogEntry(doc) {
  return {
    uid: `d${doc.id}`,
    kind: 'document',
    id: doc.id,
    library: CLOUD_ROOM,
    title: doc.title,
    authors: doc.authors,
    isbn: doc.isbn,
    genre: doc.genre,
    has_cover: doc.has_cover,
    cover_url: `/api/documents/${doc.id}/cover`,
    loaned: false,
    format: doc.format,
    size: doc.size,
    pub_year: doc.pub_year,
    missing_count: doc.missing_count,
    file_count: doc.file_count,
  };
}

const SORTS = {
  title: 'title COLLATE NOCASE ASC',
  added: 'created_at DESC, id DESC',
  size: 'primary_size DESC',
  year: 'pub_year DESC NULLS LAST, title COLLATE NOCASE ASC',
  pages: 'pages DESC NULLS LAST',
};

function listDocuments(db, query) {
  const clauses = [];
  const params = {};

  if (query.q) {
    clauses.push('(title LIKE @q OR authors LIKE @q OR series LIKE @q OR publisher LIKE @q OR tags LIKE @q)');
    params.q = `%${query.q}%`;
  }
  if (query.format) {
    clauses.push('primary_format = @format');
    params.format = query.format;
  }
  if (query.genre) {
    if (query.genre === '(aucun)') clauses.push('genre IS NULL');
    else {
      clauses.push('genre = @genre');
      params.genre = query.genre;
    }
  }
  if (query.series) {
    clauses.push('series = @series');
    params.series = query.series;
  }
  if (query.language) {
    clauses.push('language = @language');
    params.language = query.language;
  }
  if (query.no_cover === '1') clauses.push('cover_name IS NULL');
  // Deux anomalies distinctes, un seul filtre : un fichier annoncé par Calibre
  // mais absent du disque, et une fiche qui n'a jamais eu de fichier (10 cas sur
  // 1619). La seconde a missing_count = 0 et serait passée sous le radar.
  if (query.missing === '1') clauses.push('(missing_count > 0 OR file_count = 0)');
  if (query.no_author === '1') clauses.push(`(authors = '[]' OR authors LIKE '%Unknown%')`);
  if (query.not_indexed === '1') clauses.push('text_indexed_at IS NULL');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = SORTS[query.sort] || SORTS.title;
  return db.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM documents ${where} ORDER BY ${order}`)
    .all(params)
    .map(rowToDocument);
}

// Recherche *dans* les documents, par opposition à `listDocuments` qui cherche
// dans les métadonnées. Les deux sont volontairement distinctes : sur ce corpus
// de papiers et de datasheets, 37 % des auteurs valent « Unknown » et beaucoup de
// titres sont des noms de fichier — chercher dans le contenu est souvent le seul
// moyen de retrouver un document, mais le résultat est classé par pertinence et
// non par titre, ce qui n'est pas le même outil.
function searchDocumentsText(db, dbPath, query, filters = {}) {
  fts.attachFts(db, dbPath);
  const hits = fts.searchText(db, query, { limit: 300 });
  if (!hits.length) return [];

  const byId = new Map(hits.map((h) => [h.document_id, h]));
  const ids = [...byId.keys()];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id IN (${placeholders})
  `).all(...ids);

  // L'ordre de pertinence de FTS5 fait foi : on le réapplique après le SELECT,
  // qui l'aurait perdu.
  const docs = rows
    .map((row) => {
      const doc = rowToDocument(row);
      const hit = byId.get(doc.id);
      doc.snippet = hit.snippet;
      doc.score = hit.score;
      return doc;
    })
    .filter((doc) => {
      if (filters.format && doc.format !== filters.format) return false;
      if (filters.genre) {
        if (filters.genre === '(aucun)') return doc.genre !== null;
        if (doc.genre !== filters.genre) return false;
      }
      if (filters.series && doc.series !== filters.series) return false;
      return true;
    })
    .sort((a, b) => a.score - b.score);
  return docs;
}

function getDocument(db, id) {
  const row = db.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ?`).get(id);
  if (!row) return null;
  const doc = rowToDocument(row);
  doc.dir = row.dir;
  doc.files = db.prepare(`
    SELECT format, file_name, file_size, file_mtime, missing
      FROM document_files WHERE document_id = ? ORDER BY format
  `).all(id).map((f) => ({ ...f, missing: !!f.missing }));
  return doc;
}

// Facettes de filtrage, calculées côté base : sur 1619 documents c'est
// instantané, et ça évite de dupliquer les règles de comptage dans le client.
function getFacets(db) {
  const rows = (sql) => db.prepare(sql).all();
  return {
    total: db.prepare('SELECT COUNT(*) c FROM documents').get().c,
    formats: rows(`
      SELECT primary_format AS value, COUNT(*) c FROM documents
       WHERE primary_format IS NOT NULL
       GROUP BY primary_format ORDER BY c DESC
    `).map((r) => ({ value: r.value, count: r.c })),
    series: rows(`
      SELECT series AS value, COUNT(*) c FROM documents
       WHERE series IS NOT NULL
       GROUP BY series ORDER BY value COLLATE NOCASE
    `).map((r) => ({ value: r.value, count: r.c })),
    languages: rows(`
      SELECT language AS value, COUNT(*) c FROM documents
       WHERE language IS NOT NULL
       GROUP BY language ORDER BY c DESC
    `).map((r) => ({ value: r.value, count: r.c })),
    genres: rows(`
      SELECT genre AS value, COUNT(*) c FROM documents
       WHERE genre IS NOT NULL
       GROUP BY genre ORDER BY c DESC
    `).map((r) => ({ value: r.value, count: r.c })),
    no_genre_count: db.prepare('SELECT COUNT(*) c FROM documents WHERE genre IS NULL').get().c,
    counts: db.prepare(`
      SELECT SUM(cover_name IS NULL) no_cover,
             SUM(missing_count > 0 OR file_count = 0) missing,
             SUM(text_indexed_at IS NULL) not_indexed,
             SUM(primary_size) bytes
        FROM documents
    `).get(),
  };
}

const EDITABLE_FIELDS = [
  'title', 'series', 'publisher', 'isbn', 'doi', 'genre', 'notes',
];

function updateDocument(db, id, payload) {
  const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
  if (!existing) return null;

  const sets = [];
  const params = { id };
  for (const field of EDITABLE_FIELDS) {
    if (!(field in payload)) continue;
    const raw = payload[field];
    params[field] = raw == null || String(raw).trim() === '' ? null : String(raw).trim();
    sets.push(`${field} = @${field}`);
  }
  if ('authors' in payload) {
    const authors = Array.isArray(payload.authors)
      ? payload.authors
      : String(payload.authors || '').split(',').map((s) => s.trim()).filter(Boolean);
    sets.push('authors = @authors');
    params.authors = JSON.stringify(authors);
  }
  if ('tags' in payload) {
    const tags = Array.isArray(payload.tags)
      ? payload.tags
      : String(payload.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    sets.push('tags = @tags');
    params.tags = JSON.stringify(tags);
  }
  // Champ contraint, pas libre : voir lib/languages.js.
  if ('language' in payload) {
    sets.push('language = @language');
    params.language = normalizeLang(payload.language);
  }
  if ('pub_year' in payload) {
    const year = Number(payload.pub_year);
    sets.push('pub_year = @pub_year');
    params.pub_year = Number.isInteger(year) && year > 0 ? year : null;
  }
  if ('series_index' in payload) {
    const idx = Number(payload.series_index);
    sets.push('series_index = @series_index');
    params.series_index = Number.isFinite(idx) ? idx : null;
  }
  if ('rating' in payload) {
    const rating = Number(payload.rating);
    sets.push('rating = @rating');
    params.rating = Number.isInteger(rating) && rating >= 0 ? rating : null;
  }
  if ('redd' in payload) {
    sets.push('redd = @redd');
    params.redd = payload.redd ? 1 : 0;
  }
  if (!sets.length) return { error: 'No field to update.' };
  if ('title' in payload && !String(payload.title || '').trim()) {
    return { error: 'Title cannot be empty.' };
  }

  // Toute édition manuelle marque la fiche : l'import Calibre relancé avec
  // --refresh-meta n'a alors plus de raison de la considérer comme intacte, et
  // la phase de réparation automatique saura qu'elle a été validée à la main.
  sets.push("meta_source = 'manual'", "updated_at = datetime('now')");
  db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return { document: getDocument(db, id) };
}

// Résout un chemin sous la racine de la bibliothèque en refusant tout ce qui en
// sortirait. Les chemins viennent de la base, mais un `dir` mal formé (import
// d'une autre bibliothèque, édition manuelle du SQLite) ne doit pas pouvoir
// faire servir /etc/passwd.
function resolveInLibrary(root, ...segments) {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, ...segments);
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
    // Un refus ici veut dire qu'une ligne de la base pointe hors de la
    // bibliothèque : ça ne doit pas passer inaperçu, même si la requête est
    // correctement rejetée.
    console.warn(`[documents] chemin hors bibliothèque refusé : ${path.join(...segments)}`);
    return null;
  }
  return target;
}

function coverPath(db, root, id) {
  const row = db.prepare('SELECT dir, cover_name FROM documents WHERE id = ?').get(id);
  if (!row || !row.cover_name) return null;
  return resolveInLibrary(root, row.dir, row.cover_name);
}

// Le fichier demandé, ou à défaut le format principal du document.
function filePath(db, root, id, format) {
  const row = db.prepare('SELECT dir FROM documents WHERE id = ?').get(id);
  if (!row) return null;
  const file = format
    ? db.prepare('SELECT format, file_name FROM document_files WHERE document_id = ? AND format = ?').get(id, String(format).toUpperCase())
    : db.prepare(`
        SELECT f.format, f.file_name FROM document_files f
        JOIN documents d ON d.id = f.document_id
        WHERE f.document_id = ? AND f.format = d.primary_format
      `).get(id);
  if (!file) return null;
  const abs = resolveInLibrary(root, row.dir, file.file_name);
  return abs ? { abs, format: file.format, name: file.file_name } : null;
}

const FILE_TYPES = {
  PDF: 'application/pdf',
  EPUB: 'application/epub+zip',
  TXT: 'text/plain; charset=utf-8',
  MD: 'text/markdown; charset=utf-8',
  CSV: 'text/csv; charset=utf-8',
  ZIP: 'application/zip',
  GZ: 'application/gzip',
  PS: 'application/postscript',
  DOC: 'application/msword',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PPT: 'application/vnd.ms-powerpoint',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  CBR: 'application/vnd.comicbook-rar',
  CBZ: 'application/vnd.comicbook+zip',
  CHM: 'application/vnd.ms-htmlhelp',
};

// Sert un fichier du disque en gérant les requêtes Range. C'est indispensable
// ici : la visionneuse PDF du navigateur lit un document par morceaux, et sans
// Range elle téléchargerait les 77 Mo du plus gros magazine avant d'afficher la
// première page.
function sendFile(req, res, abs, { contentType, filename, download = false } = {}) {
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('File not found on disk');
  }

  const disposition = download
    ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    : `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const etag = `"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
  const baseHeaders = {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Disposition': disposition,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'private, max-age=3600',
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': baseHeaders['Cache-Control'] });
    return res.end();
  }

  const range = req.headers.range;
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match) {
    let start = match[1] === '' ? null : Number(match[1]);
    let end = match[2] === '' ? null : Number(match[2]);
    if (start === null) {
      // « bytes=-500 » : les 500 derniers octets.
      start = Math.max(stat.size - (end || 0), 0);
      end = stat.size - 1;
    } else if (end === null || end >= stat.size) {
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    return fs.createReadStream(abs, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
  return fs.createReadStream(abs).pipe(res);
}

module.exports = {
  listDocuments, searchDocumentsText, getDocument, getFacets, updateDocument, toCatalogEntry,
  coverPath, filePath, sendFile, resolveInLibrary, FILE_TYPES, CLOUD_ROOM,
};
