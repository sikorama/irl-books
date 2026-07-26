'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { ensureDocumentsSchema } = require('./docs-db.js');
const { ensureGenresSchema } = require('./genres.js');

const DB_PATH = process.env.LIBRARY_DB
  ? path.resolve(process.env.LIBRARY_DB)
  : path.join(__dirname, '..', 'library.db');

// Racine de la bibliothèque numérique : l'arborescence Calibre
// (`<racine>/<Auteur>/<Titre> (<id>)/`) montée en volume. La base ne stocke que
// des chemins relatifs à cette racine, pour qu'un déplacement du volume ne
// demande aucune migration.
const LIBRARY_ROOT = process.env.LIBRARY_ROOT || '/library';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library TEXT,
  ident TEXT,
  isbn TEXT,
  title TEXT NOT NULL,
  authors TEXT,
  publisher TEXT,
  publishing_year INTEGER,
  edition TEXT,
  notes TEXT,
  own INTEGER NOT NULL DEFAULT 0,
  want INTEGER NOT NULL DEFAULT 0,
  redd INTEGER NOT NULL DEFAULT 0,
  loaned INTEGER NOT NULL DEFAULT 0,
  loaned_to TEXT,
  rating INTEGER,
  tags TEXT,
  genre TEXT,
  cover BLOB,
  cover_mime TEXT,
  cover_rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_books_library ON books(library);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_library_ident
  ON books(library, ident) WHERE ident IS NOT NULL;
`;

function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
  if (!columns.includes('genre')) {
    db.exec('ALTER TABLE books ADD COLUMN genre TEXT');
  }
  // La couverture vit derrière une URL stable (/api/books/:id/cover) mise en
  // cache très longtemps par le navigateur. Ce compteur, incrémenté à chaque
  // écriture, sert de version dans l'URL : changer d'image change l'URL, donc
  // la vignette se met réellement à jour au lieu de rester dans le cache.
  if (!columns.includes('cover_rev')) {
    db.exec('ALTER TABLE books ADD COLUMN cover_rev INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre)');
}

function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  migrate(db);
  ensureDocumentsSchema(db);
  // Après le schéma des documents : le semis des genres compte leur usage sur
  // les deux collections, donc la table `documents` doit exister.
  ensureGenresSchema(db);
  return db;
}

module.exports = { openDb, DB_PATH, LIBRARY_ROOT };
