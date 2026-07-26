'use strict';

// Schéma de la collection numérique.
//
// Les fiches papier (`books`) et les documents (`documents`) vivent dans la même
// base mais dans deux tables distinctes : les corpus sont disjoints (3 titres
// communs sur 1170 × 1619) et les colonnes ne se recouvrent qu'à moitié. Greffer
// un drapeau sur `books` aurait laissé huit colonnes physiques mortes (pièce,
// prêt, own/want) sur 1619 lignes, et six colonnes de fichier mortes sur les
// fiches papier.
//
// Différence de stockage importante : les couvertures des documents restent sur
// le disque, à côté des fichiers (Calibre écrit un `cover.jpg` par dossier, 172
// Ko en moyenne, ~250 Mo pour 1502 documents). Seul leur nom est en base.

const DOCUMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calibre_id INTEGER,
  dir TEXT NOT NULL,
  cover_name TEXT,
  title TEXT NOT NULL,
  authors TEXT,
  series TEXT,
  series_index REAL,
  publisher TEXT,
  pubdate TEXT,
  pub_year INTEGER,
  language TEXT,
  isbn TEXT,
  doi TEXT,
  identifiers TEXT,
  pages INTEGER,
  tags TEXT,
  genre TEXT,
  rating INTEGER,
  notes TEXT,
  comments TEXT,
  redd INTEGER NOT NULL DEFAULT 0,
  meta_source TEXT,
  primary_format TEXT,
  primary_size INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  text_indexed_at TEXT,
  text_sig TEXT,
  text_chars INTEGER,
  text_truncated INTEGER NOT NULL DEFAULT 0,
  text_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un document peut porter plusieurs formats du même contenu (5 cas sur 1619
-- côté Calibre). Cette table est la source de vérité ; les colonnes
-- primary_format / primary_size / file_count / missing_count de documents en
-- sont dérivées et recalculées à chaque écriture, pour que lister et filtrer
-- 1619 lignes ne demande pas de jointure.
CREATE TABLE IF NOT EXISTS document_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_mtime TEXT,
  missing INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_calibre
  ON documents(calibre_id) WHERE calibre_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_dir ON documents(dir);
CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_documents_genre ON documents(genre);
CREATE INDEX IF NOT EXISTS idx_documents_series ON documents(series);
CREATE INDEX IF NOT EXISTS idx_documents_format ON documents(primary_format);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_files_unique
  ON document_files(document_id, format);
CREATE INDEX IF NOT EXISTS idx_document_files_doc ON document_files(document_id);
`;

// Colonnes que l'import Calibre a le droit de réécrire quand on lui demande
// explicitement de rafraîchir les métadonnées. Tout ce qui n'est pas là est
// considéré comme pouvant avoir été édité à la main, et n'est jamais écrasé.
const CALIBRE_META_COLUMNS = [
  'title', 'authors', 'series', 'series_index', 'publisher', 'pubdate',
  'pub_year', 'language', 'isbn', 'doi', 'identifiers', 'tags', 'rating',
  'comments',
];

// La table `documents` existe déjà sur les installations où l'import Calibre a
// tourné avant la phase d'indexation : les colonnes de suivi du texte sont donc
// ajoutées après coup plutôt que dans le CREATE TABLE.
const TEXT_COLUMNS = [
  ['text_sig', 'TEXT'],
  ['text_chars', 'INTEGER'],
  ['text_truncated', 'INTEGER NOT NULL DEFAULT 0'],
  ['text_error', 'TEXT'],
];

function ensureDocumentsSchema(db) {
  db.exec(DOCUMENTS_SCHEMA);
  const columns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
  for (const [name, decl] of TEXT_COLUMNS) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${decl}`);
  }
  // Après les ALTER, jamais avant : sur une base où l'import Calibre a déjà
  // tourné, la colonne n'existe pas encore quand le schéma initial est rejoué.
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_text_sig ON documents(text_sig)');
}

// Ordre de préférence du format « principal » — celui qu'on ouvre, qu'on indexe
// et dont on tire la couverture. Prendre le plus gros fichier semblait naturel
// mais se trompe en pratique : sur les cinq documents multi-format de la
// bibliothèque, ça désignait un DOC de 150 Ko plutôt que son PDF, et trois EPUB
// plutôt que leur PDF. Le PDF est le format qui porte la pagination réelle et
// le seul que la chaîne d'extraction sait lire.
const FORMAT_PRIORITY = [
  'PDF', 'EPUB', 'DJVU', 'MOBI', 'AZW3', 'CBR', 'CBZ',
  'DOC', 'DOCX', 'PPT', 'PPTX', 'PS', 'CHM', 'TXT', 'MD',
];

function formatRank(format) {
  const i = FORMAT_PRIORITY.indexOf(String(format || '').toUpperCase());
  return i === -1 ? FORMAT_PRIORITY.length : i;
}

// Recalcule les colonnes dérivées d'un document depuis ses fichiers.
function refreshDerived(db, documentId) {
  const files = db.prepare(`
    SELECT format, file_size, missing FROM document_files WHERE document_id = ?
  `).all(documentId);

  // Un fichier présent passe toujours devant un fichier annoncé mais absent du
  // disque ; à présence égale, l'ordre de préférence, puis la taille.
  files.sort((a, b) => a.missing - b.missing
    || formatRank(a.format) - formatRank(b.format)
    || (b.file_size || 0) - (a.file_size || 0));

  const primary = files[0] || null;
  db.prepare(`
    UPDATE documents
       SET primary_format = @format,
           primary_size = @size,
           file_count = @count,
           missing_count = @missing,
           updated_at = datetime('now')
     WHERE id = @id
  `).run({
    id: documentId,
    format: primary ? primary.format : null,
    size: primary ? primary.file_size : null,
    count: files.length,
    missing: files.filter((f) => f.missing).length,
  });
}

module.exports = {
  ensureDocumentsSchema, refreshDerived, CALIBRE_META_COLUMNS, FORMAT_PRIORITY,
};
