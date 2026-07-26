'use strict';

// Index plein texte des documents (FTS5).
//
// Il vit dans un **fichier séparé**, attaché à la base principale. Le texte de
// 1501 PDF pèse plusieurs centaines de méga-octets, alors que `library.db` fait
// 12 Mo : les mélanger rendrait la sauvegarde du catalogue coûteuse alors que
// l'index, lui, est entièrement reconstructible depuis les fichiers. On peut le
// supprimer sans rien perdre.

const path = require('path');

// `remove_diacritics 2` rend la recherche insensible aux accents dans les deux
// sens : « evolution » trouve « évolution » et réciproquement. Indispensable sur
// un corpus moitié français moitié anglais.
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS docs.doc_text USING fts5(
  title, authors, body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Le texte de la première page, mis de côté pour la réparation des métadonnées
-- (deviner un titre, interroger Crossref). Il n'a pas à être indexé : il est
-- déjà contenu dans la colonne body ci-dessus.
CREATE TABLE IF NOT EXISTS docs.doc_first_page (
  document_id INTEGER PRIMARY KEY,
  text TEXT
);
`;

function ftsPath(dbPath) {
  if (process.env.DOCS_FTS_DB) return path.resolve(process.env.DOCS_FTS_DB);
  return path.join(path.dirname(dbPath), 'docs-fts.db');
}

// L'attachement est fait à la demande plutôt qu'à l'ouverture : la plupart des
// requêtes de l'application ne touchent pas au plein texte, et créer un fichier
// de plusieurs centaines de Mo au premier démarrage serait une surprise.
function attachFts(db, dbPath) {
  if (db.__ftsAttached) return true;
  const target = ftsPath(dbPath);
  db.exec(`ATTACH DATABASE '${target.replace(/'/g, "''")}' AS docs`);
  db.exec(FTS_SCHEMA);
  db.__ftsAttached = true;
  return true;
}

function isAttached(db) {
  return !!db.__ftsAttached;
}

// Le rowid de la table FTS est l'id du document : la jointure avec `documents`
// est directe, et réindexer un document est un simple delete/insert.
// Deuxième barrière, indépendante de l'extraction : rien n'entre dans l'index
// avec des caractères de contrôle, quelle que soit la provenance du texte (un
// titre saisi à la main, un futur extracteur EPUB). C'est ce qui rend le
// surlignage des extraits sûr par construction.
function stripControls(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, '');
}

function indexDocument(db, { documentId, title, authors, body, firstPage }) {
  db.prepare('DELETE FROM docs.doc_text WHERE rowid = ?').run(documentId);
  db.prepare('INSERT INTO docs.doc_text (rowid, title, authors, body) VALUES (?, ?, ?, ?)')
    .run(documentId, stripControls(title), stripControls(authors), stripControls(body));
  db.prepare('INSERT INTO docs.doc_first_page (document_id, text) VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET text = excluded.text')
    .run(documentId, stripControls(firstPage));
}

function removeDocument(db, documentId) {
  db.prepare('DELETE FROM docs.doc_text WHERE rowid = ?').run(documentId);
  db.prepare('DELETE FROM docs.doc_first_page WHERE document_id = ?').run(documentId);
}

function getFirstPage(db, documentId) {
  const row = db.prepare('SELECT text FROM docs.doc_first_page WHERE document_id = ?').get(documentId);
  return row ? row.text : null;
}

// FTS5 refuse une requête syntaxiquement invalide (parenthèse orpheline,
// opérateur en fin de chaîne). Comme la chaîne vient d'une barre de recherche où
// l'on tape au fil de l'eau, on la réécrit en une conjonction de termes cités
// plutôt que de renvoyer une erreur à chaque frappe. Un terme suivi de `*` garde
// son préfixe, et une expression entre guillemets reste une expression exacte.
function sanitizeMatchQuery(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;

  const tokens = [];
  const phraseRe = /"([^"]*)"/g;
  let rest = input;
  let m;
  while ((m = phraseRe.exec(input)) !== null) {
    const phrase = m[1].trim();
    if (phrase) tokens.push(`"${phrase.replace(/"/g, '')}"`);
  }
  rest = input.replace(phraseRe, ' ');

  for (const word of rest.split(/[^\p{L}\p{N}*_-]+/u)) {
    const clean = word.replace(/\*+$/, '');
    if (!clean) continue;
    tokens.push(word.endsWith('*') ? `"${clean}"*` : `"${clean}"`);
  }
  if (!tokens.length) return null;
  return tokens.join(' AND ');
}

// bm25 pondère les colonnes : un mot dans le titre compte bien plus que la même
// occurrence noyée dans 200 pages de corps de texte.
const BM25_WEIGHTS = '10.0, 4.0, 1.0';

// L'extrait doit être affiché en HTML pour que le surlignage existe, mais son
// texte vient des PDF — donc d'une source non fiable. Un document contenant
// `<img onerror=...>` exécuterait du script dans la page. FTS5 encadre donc les
// correspondances avec deux caractères de contrôle qui ne peuvent pas apparaître
// dans du texte extrait ; on échappe tout, puis on ne rétablit que ces deux-là en
// balises. C'est le seul HTML qui puisse ressortir d'ici.
const MARK_OPEN = '\u0001';
const MARK_CLOSE = '\u0002';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function snippetToSafeHtml(raw) {
  if (!raw || !raw.includes(MARK_OPEN)) return null;
  return escapeHtml(raw)
    .split(MARK_OPEN).join('<mark>')
    .split(MARK_CLOSE).join('</mark>');
}

function searchText(db, rawQuery, { limit = 300 } = {}) {
  const match = sanitizeMatchQuery(rawQuery);
  if (!match) return [];
  const rows = db.prepare(`
    SELECT rowid AS document_id,
           bm25(doc_text, ${BM25_WEIGHTS}) AS score,
           snippet(doc_text, 2, @open, @close, '…', 24) AS snippet
      FROM docs.doc_text
     WHERE doc_text MATCH @match
     ORDER BY score
     LIMIT @limit
  `).all({ match, limit, open: MARK_OPEN, close: MARK_CLOSE });

  // Quand la correspondance est dans le titre et pas dans le corps, FTS5 renvoie
  // pour `snippet` le simple début du corps, sans marqueur. Affiché tel quel, ça
  // ressemble à un faux positif — un extrait qui ne contient visiblement pas ce
  // qu'on a cherché. `snippetToSafeHtml` renvoie alors null : le titre parle de
  // lui-même.
  return rows.map((r) => ({ ...r, snippet: snippetToSafeHtml(r.snippet) }));
}

function stats(db) {
  const row = db.prepare('SELECT COUNT(*) c FROM docs.doc_text').get();
  return { indexed: row.c };
}

module.exports = {
  attachFts, isAttached, ftsPath, indexDocument, removeDocument, getFirstPage,
  searchText, sanitizeMatchQuery, stats,
};
