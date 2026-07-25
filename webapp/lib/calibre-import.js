'use strict';

// Import d'une bibliothèque Calibre dans la table `documents`.
//
// La `metadata.db` de Calibre est ouverte en lecture seule et n'est jamais
// modifiée : tant que la migration n'est pas jugée concluante, Calibre reste
// utilisable sur la même arborescence.
//
// Aucun fichier n'est déplacé ni copié. Le chemin complet d'un fichier se
// reconstruit en `<racine>/<books.path>/<data.name>.<format en minuscules>`, et
// sa couverture en `<racine>/<books.path>/cover.jpg` quand `has_cover` vaut 1.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { refreshDerived, CALIBRE_META_COLUMNS } = require('./docs-db.js');

// Calibre écrit `0101-01-01` (et parfois `0100-...`) comme date de publication
// inconnue — 283 fiches sur 1619. Sans ce filtre, l'interface afficherait « an
// 101 » un peu partout.
const MIN_REAL_YEAR = 1400;

function parseCalibreDate(value) {
  if (!value) return { iso: null, year: null };
  const year = Number(String(value).slice(0, 4));
  if (!Number.isInteger(year) || year < MIN_REAL_YEAR) return { iso: null, year: null };
  const iso = String(value).slice(0, 10);
  return { iso, year };
}

// Quand Calibre importe un fichier dont il ignore la date de publication, il y
// recopie l'horodatage de l'import. Sur les 984 fiches qui semblaient datées,
// 783 sont dans ce cas : sans ce test l'interface afficherait « 2012 » pour des
// centaines de documents qui n'ont rien à voir avec 2012. Il reste 201 dates
// réelles, réparties de 1981 à 2025 — c'est la vérité de cette bibliothèque.
//
// Deux conditions, parce qu'aucune ne suffit seule :
//
//  - même moment que l'import (à 36 h près, pour absorber les décalages de
//    fuseau entre les deux colonnes, écrites l'une avec offset et l'autre sans).
//    Insuffisant seul : Calibre écrit parfois les deux colonnes à quelques
//    secondes d'intervalle, mais aussi un vrai numéro de magazine daté du jour.
//  - heure autre que minuit pile. Un horodatage d'import porte l'heure et les
//    microsecondes de la machine ; une date saisie ou lue dans un catalogue
//    tombe sur minuit. C'est ce test qui sauve « Amstrad Computer User - July
//    1987 », daté 1987-07-01 dans les deux colonnes et pourtant authentique.
const IMPORT_WINDOW_MS = 36 * 3600 * 1000;
const MIDNIGHT_RE = /[T ]00:00:00(\.0+)?([+-]\d\d:?\d\d|Z)?$/;

function isImportTimestamp(pubdate, timestamp) {
  if (!pubdate || !timestamp) return false;
  if (MIDNIGHT_RE.test(String(pubdate))) return false;
  const a = Date.parse(pubdate);
  const b = Date.parse(timestamp);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < IMPORT_WINDOW_MS;
}

// Une fiche dont la date d'ajout est aussi une date bidon garde la date du jour
// via le DEFAULT de la colonne.
function parseTimestamp(value) {
  const { iso } = parseCalibreDate(value);
  return iso ? String(value).slice(0, 19).replace('T', ' ') : null;
}

function groupBy(rows, keyField, valueFn) {
  const map = new Map();
  for (const row of rows) {
    const key = row[keyField];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(valueFn(row));
  }
  return map;
}

// Tout est chargé en quelques requêtes groupées plutôt qu'en interrogeant
// Calibre livre par livre : 1619 fiches × 8 jointures feraient treize mille
// requêtes pour un gain de lisibilité nul.
function readCalibre(metadataPath) {
  const cal = new DatabaseSync(metadataPath, { readOnly: true });
  try {
    const books = cal.prepare(`
      SELECT id, title, sort, timestamp, pubdate, series_index, author_sort,
             isbn, path, has_cover
        FROM books ORDER BY id
    `).all();

    const authors = groupBy(cal.prepare(`
      SELECT l.book, a.name FROM books_authors_link l
      JOIN authors a ON a.id = l.author ORDER BY l.id
    `).all(), 'book', (r) => r.name);

    const tags = groupBy(cal.prepare(`
      SELECT l.book, t.name FROM books_tags_link l
      JOIN tags t ON t.id = l.tag ORDER BY t.name
    `).all(), 'book', (r) => r.name);

    const files = groupBy(cal.prepare(`
      SELECT book, format, name, uncompressed_size FROM data ORDER BY book, format
    `).all(), 'book', (r) => ({
      format: r.format, name: r.name, size: r.uncompressed_size,
    }));

    const identifiers = groupBy(cal.prepare(`
      SELECT book, type, val FROM identifiers
    `).all(), 'book', (r) => ({ type: r.type, val: r.val }));

    const single = (rows) => new Map(rows.map((r) => [r.book, r.value]));
    const publishers = single(cal.prepare(`
      SELECT l.book, p.name AS value FROM books_publishers_link l
      JOIN publishers p ON p.id = l.publisher
    `).all());
    const series = single(cal.prepare(`
      SELECT l.book, s.name AS value FROM books_series_link l
      JOIN series s ON s.id = l.series
    `).all());
    const languages = single(cal.prepare(`
      SELECT l.book, lg.lang_code AS value FROM books_languages_link l
      JOIN languages lg ON lg.id = l.lang_code
    `).all());
    const ratings = single(cal.prepare(`
      SELECT l.book, r.rating AS value FROM books_ratings_link l
      JOIN ratings r ON r.id = l.rating
    `).all());
    const comments = single(cal.prepare('SELECT book, text AS value FROM comments').all());

    return books.map((b) => {
      const ids = identifiers.get(b.id) || [];
      const identMap = {};
      for (const { type, val } of ids) identMap[type] = val;
      const { iso: pubdate, year: pubYear } = isImportTimestamp(b.pubdate, b.timestamp)
        ? { iso: null, year: null }
        : parseCalibreDate(b.pubdate);

      return {
        calibre_id: b.id,
        dir: b.path,
        has_cover: !!b.has_cover,
        added_at: parseTimestamp(b.timestamp),
        title: b.title || '(sans titre)',
        authors: authors.get(b.id) || [],
        series: series.get(b.id) || null,
        series_index: series.has(b.id) ? b.series_index : null,
        publisher: publishers.get(b.id) || null,
        pubdate,
        pub_year: pubYear,
        language: languages.get(b.id) || null,
        // `books.isbn` est vide sur toute cette bibliothèque ; les dix ISBN
        // connus vivent dans la table `identifiers`.
        isbn: (b.isbn && b.isbn.trim()) || identMap.isbn || null,
        doi: identMap.doi || null,
        identifiers: identMap,
        tags: tags.get(b.id) || [],
        rating: ratings.get(b.id) ?? null,
        comments: comments.get(b.id) || null,
        files: files.get(b.id) || [],
      };
    });
  } finally {
    cal.close();
  }
}

// Vérifie sur le disque ce que Calibre prétend, et rapporte les écarts plutôt
// que de les avaler : un fichier absent devient une fiche marquée `missing`, pas
// une fiche silencieusement correcte.
function resolveFiles(root, entry) {
  const dirAbs = path.join(root, entry.dir);
  return entry.files.map((f) => {
    const fileName = `${f.name}.${f.format.toLowerCase()}`;
    let stat = null;
    try {
      stat = fs.statSync(path.join(dirAbs, fileName));
    } catch {
      stat = null;
    }
    return {
      format: f.format,
      file_name: fileName,
      file_size: stat ? stat.size : f.size,
      file_mtime: stat ? stat.mtime.toISOString().slice(0, 19).replace('T', ' ') : null,
      missing: stat ? 0 : 1,
    };
  });
}

function resolveCover(root, entry) {
  if (!entry.has_cover) return null;
  const coverPath = path.join(root, entry.dir, 'cover.jpg');
  return fs.existsSync(coverPath) ? 'cover.jpg' : null;
}

const INSERT_SQL = `
  INSERT INTO documents
    (calibre_id, dir, cover_name, title, authors, series, series_index,
     publisher, pubdate, pub_year, language, isbn, doi, identifiers, tags,
     genre, rating, comments, meta_source, created_at)
  VALUES
    (@calibre_id, @dir, @cover_name, @title, @authors, @series, @series_index,
     @publisher, @pubdate, @pub_year, @language, @isbn, @doi, @identifiers, @tags,
     @genre, @rating, @comments, 'calibre', COALESCE(@added_at, datetime('now')))
`;

function toParams(entry, coverName, genre) {
  return {
    calibre_id: entry.calibre_id,
    dir: entry.dir,
    cover_name: coverName,
    title: entry.title,
    authors: JSON.stringify(entry.authors),
    series: entry.series,
    series_index: entry.series_index,
    publisher: entry.publisher,
    pubdate: entry.pubdate,
    pub_year: entry.pub_year,
    language: entry.language,
    isbn: entry.isbn,
    doi: entry.doi,
    identifiers: Object.keys(entry.identifiers).length
      ? JSON.stringify(entry.identifiers) : null,
    tags: JSON.stringify(entry.tags),
    genre,
    rating: entry.rating,
    comments: entry.comments,
    added_at: entry.added_at,
  };
}

// `refreshMeta` à false (le défaut) ne touche qu'aux faits vérifiables sur le
// disque — chemin, formats, tailles, dates, couverture. Les métadonnées d'une
// fiche déjà importée ne sont pas réécrites, sans quoi un second passage
// annulerait les corrections faites à la main dans l'interface.
function importCalibre(db, options = {}) {
  const {
    metadataPath,
    root,
    dryRun = false,
    refreshMeta = false,
    genre = null,
    onProgress = null,
  } = options;

  const entries = readCalibre(metadataPath);
  const existing = new Map(
    db.prepare('SELECT id, calibre_id FROM documents WHERE calibre_id IS NOT NULL')
      .all().map((r) => [r.calibre_id, r.id]),
  );

  const insertStmt = db.prepare(INSERT_SQL);
  const insertFileStmt = db.prepare(`
    INSERT INTO document_files (document_id, format, file_name, file_size, file_mtime, missing)
    VALUES (@document_id, @format, @file_name, @file_size, @file_mtime, @missing)
    ON CONFLICT(document_id, format) DO UPDATE SET
      file_name = excluded.file_name,
      file_size = excluded.file_size,
      file_mtime = excluded.file_mtime,
      missing = excluded.missing
  `);
  const updateFilesOnlyStmt = db.prepare(`
    UPDATE documents SET dir = @dir, cover_name = @cover_name, updated_at = datetime('now')
     WHERE id = @id
  `);
  const updateMetaStmt = db.prepare(`
    UPDATE documents SET dir = @dir, cover_name = @cover_name,
      ${CALIBRE_META_COLUMNS.map((c) => `${c} = @${c}`).join(', ')},
      meta_source = 'calibre', updated_at = datetime('now')
     WHERE id = @id
  `);

  const stats = {
    total: entries.length,
    added: 0,
    updated: 0,
    files: 0,
    missing_files: 0,
    no_file: 0,
    no_cover: 0,
    failed: 0,
  };
  const report = { missing: [], no_file: [], errors: [] };

  for (const entry of entries) {
    try {
      const files = resolveFiles(root, entry);
      const coverName = resolveCover(root, entry);
      if (!files.length) {
        stats.no_file++;
        report.no_file.push({ calibre_id: entry.calibre_id, title: entry.title });
      }
      if (entry.has_cover && !coverName) stats.no_cover++;
      for (const f of files) {
        stats.files++;
        if (f.missing) {
          stats.missing_files++;
          report.missing.push({
            calibre_id: entry.calibre_id,
            title: entry.title,
            file: path.join(entry.dir, f.file_name),
          });
        }
      }

      if (dryRun) {
        if (existing.has(entry.calibre_id)) stats.updated++;
        else stats.added++;
        if (onProgress) onProgress(entry, stats);
        continue;
      }

      let documentId = existing.get(entry.calibre_id);
      if (documentId === undefined) {
        const info = insertStmt.run(toParams(entry, coverName, genre));
        documentId = Number(info.lastInsertRowid);
        existing.set(entry.calibre_id, documentId);
        stats.added++;
      } else {
        // node:sqlite refuse un paramètre nommé qui n'apparaît pas dans la
        // requête : chaque UPDATE reçoit exactement les colonnes qu'il écrit.
        const all = toParams(entry, coverName, genre);
        const params = { id: documentId, dir: all.dir, cover_name: all.cover_name };
        if (refreshMeta) {
          for (const col of CALIBRE_META_COLUMNS) params[col] = all[col];
          updateMetaStmt.run(params);
        } else {
          updateFilesOnlyStmt.run(params);
        }
        stats.updated++;
      }

      for (const f of files) insertFileStmt.run({ ...f, document_id: documentId });
      refreshDerived(db, documentId);
    } catch (e) {
      stats.failed++;
      report.errors.push({ calibre_id: entry.calibre_id, title: entry.title, error: e.message });
    }
    if (onProgress) onProgress(entry, stats);
  }

  return { ...stats, report };
}

module.exports = { importCalibre, readCalibre };
