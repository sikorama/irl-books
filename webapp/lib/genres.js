'use strict';

// Genres stockés en base, éditables depuis l'interface.
//
// Le catalogue vit en base et non dans le code parce qu'il doit pouvoir changer
// sans redéploiement. Mais l'identité d'un genre reste son `value` : c'est la
// seule chose que `books.genre` et `documents.genre` stockent, donc renommer un
// intitulé ou ajouter une langue ne déplace jamais une fiche.

const {
  SEED_GENRES, LANGS, compileRules, matchGenre, resolveLabel,
} = require('./categorize.js');

const GENRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS genres (
  value TEXT PRIMARY KEY,
  position INTEGER NOT NULL DEFAULT 0,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS genre_labels (
  genre TEXT NOT NULL REFERENCES genres(value) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (genre, lang)
);

-- La colonne lang dit dans quelle liste on range un mot-clé, pas dans quelle
-- langue il faut chercher : la classification confronte le titre à TOUS les
-- mots-clés, quelle que soit leur langue. La langue conventionnelle '*' porte ce
-- qui n'appartient à aucune langue — noms d'auteurs, de séries, de formats.
CREATE TABLE IF NOT EXISTS genre_keywords (
  genre TEXT NOT NULL REFERENCES genres(value) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  keyword TEXT NOT NULL,
  PRIMARY KEY (genre, lang, keyword)
);

CREATE INDEX IF NOT EXISTS idx_genre_keywords_genre ON genre_keywords(genre);

-- Trace des genres du catalogue de départ déjà appliqués une fois. Sans elle,
-- deux comportements souhaitables s'excluraient : livrer un nouveau genre dans
-- une version ultérieure (donc l'insérer s'il manque) et respecter une
-- suppression faite à la main (donc ne pas le réinsérer). Cette table distingue
-- « jamais vu » de « supprimé exprès ».
CREATE TABLE IF NOT EXISTS genre_seed_applied (
  value TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// L'ordre d'évaluation est signifiant (première règle qui correspond), donc les
// positions sont espacées : insérer un genre entre deux autres ne demande pas de
// renuméroter toute la liste.
const POSITION_STEP = 10;

function slugify(input) {
  return String(input || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function ensureGenresSchema(db) {
  db.exec(GENRES_SCHEMA);
  applySeed(db);
}

// Applique les genres du catalogue de départ qui n'ont jamais été appliqués.
// Sur une base vierge, c'est l'intégralité du catalogue. Sur une base existante,
// seulement ce que la version précédente ne connaissait pas — et jamais un genre
// que l'utilisateur a supprimé, puisqu'il reste marqué comme appliqué.
//
// Les libellés et mots-clés d'un genre déjà appliqué ne sont pas réécrits : ils
// ont pu être corrigés depuis l'interface, et le code n'a pas à les reprendre.
function applySeed(db) {
  const applied = new Set(
    db.prepare('SELECT value FROM genre_seed_applied').all().map((r) => r.value),
  );
  const mark = db.prepare('INSERT INTO genre_seed_applied (value) VALUES (?) ON CONFLICT DO NOTHING');
  const existing = new Set(db.prepare('SELECT value FROM genres').all().map((r) => r.value));

  // Première exécution sur une base qui avait déjà des genres (impossible
  // aujourd'hui, mais la table pourrait avoir été peuplée autrement) : on
  // considère l'existant comme déjà appliqué avant de compléter.
  for (const value of existing) {
    if (!applied.has(value)) { mark.run(value); applied.add(value); }
  }

  let added = 0;
  let position = 0;
  for (const genre of SEED_GENRES) {
    if (applied.has(genre.value)) {
      position += POSITION_STEP;
      continue;
    }
    insertGenre(db, { ...genre, builtin: true, position });
    mark.run(genre.value);
    position += POSITION_STEP;
    added++;
  }
  return added;
}

function insertGenre(db, { value, labels, keywords, builtin = false, position = 0 }) {
  db.prepare('INSERT INTO genres (value, position, builtin) VALUES (?, ?, ?)')
    .run(value, position, builtin ? 1 : 0);
  replaceLabels(db, value, labels);
  replaceKeywords(db, value, keywords);
}

function replaceLabels(db, value, labels) {
  db.prepare('DELETE FROM genre_labels WHERE genre = ?').run(value);
  const stmt = db.prepare('INSERT INTO genre_labels (genre, lang, label) VALUES (?, ?, ?)');
  for (const [lang, label] of Object.entries(labels || {})) {
    const clean = String(label || '').trim();
    if (clean) stmt.run(value, lang, clean);
  }
}

function replaceKeywords(db, value, keywords) {
  db.prepare('DELETE FROM genre_keywords WHERE genre = ?').run(value);
  const stmt = db.prepare('INSERT INTO genre_keywords (genre, lang, keyword) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  for (const [lang, list] of Object.entries(keywords || {})) {
    for (const keyword of list || []) {
      const clean = String(keyword || '').trim().toLowerCase();
      if (clean) stmt.run(value, lang, clean);
    }
  }
}

// Lit tout le catalogue, mots-clés compris. Une seule requête par table plutôt
// qu'une par genre : le catalogue est relu à chaque classification en masse.
function listGenres(db) {
  const rows = db.prepare('SELECT value, position, builtin FROM genres ORDER BY position, value').all();
  const labels = new Map();
  for (const r of db.prepare('SELECT genre, lang, label FROM genre_labels').all()) {
    if (!labels.has(r.genre)) labels.set(r.genre, {});
    labels.get(r.genre)[r.lang] = r.label;
  }
  const keywords = new Map();
  for (const r of db.prepare('SELECT genre, lang, keyword FROM genre_keywords ORDER BY keyword').all()) {
    if (!keywords.has(r.genre)) keywords.set(r.genre, {});
    const bag = keywords.get(r.genre);
    if (!bag[r.lang]) bag[r.lang] = [];
    bag[r.lang].push(r.keyword);
  }
  return rows.map((r) => ({
    value: r.value,
    position: r.position,
    builtin: !!r.builtin,
    labels: labels.get(r.value) || {},
    keywords: keywords.get(r.value) || {},
  }));
}

// Compte l'usage sur les deux collections : c'est ce qui autorise ou refuse une
// suppression, et ce qui alimente les compteurs des filtres.
function usageCounts(db) {
  const counts = new Map();
  const add = (genre, n) => counts.set(genre, (counts.get(genre) || 0) + n);
  for (const r of db.prepare('SELECT genre, COUNT(*) c FROM books GROUP BY genre').all()) add(r.genre, r.c);
  for (const r of db.prepare('SELECT genre, COUNT(*) c FROM documents GROUP BY genre').all()) add(r.genre, r.c);
  return counts;
}

// Vue destinée à l'interface : un intitulé déjà résolu dans la langue demandée,
// plus la table complète des libellés pour l'écran d'édition.
function catalogFor(db, lang) {
  const counts = usageCounts(db);
  const genres = listGenres(db).map((g) => ({
    ...g,
    label: resolveLabel(g.labels, lang) || g.value,
    count: counts.get(g.value) || 0,
  }));
  return { genres, no_genre_count: counts.get(null) || 0, langs: LANGS };
}

// Les règles sont recompilées à chaque appel : le catalogue est modifiable en
// cours d'exécution, donc un cache mémoire se désynchroniserait de la base à la
// première édition. Vingt genres et deux mille mots-clés se compilent en une
// fraction de milliseconde.
function compiledRules(db) {
  return compileRules(listGenres(db));
}

function guessGenre(db, entry) {
  return matchGenre(compiledRules(db), entry);
}

function getGenre(db, value) {
  return listGenres(db).find((g) => g.value === value) || null;
}

function createGenre(db, payload) {
  const labels = payload.labels || {};
  const value = slugify(payload.value || labels.fr || labels.en || '');
  if (!value) return { error: 'A genre needs at least one label.' };
  if (db.prepare('SELECT 1 FROM genres WHERE value = ?').get(value)) {
    return { error: `The genre "${value}" already exists.` };
  }
  if (!Object.values(labels).some((l) => String(l || '').trim())) {
    return { error: 'A genre needs at least one label.' };
  }
  // Un genre créé à la main se place en fin de liste, donc il est évalué après
  // tous les autres : ses mots-clés ne peuvent pas détourner une classification
  // existante sans qu'on l'ait voulu en changeant sa position.
  const { max } = db.prepare('SELECT COALESCE(MAX(position), 0) max FROM genres').get();
  insertGenre(db, {
    value,
    labels,
    keywords: payload.keywords || {},
    builtin: false,
    position: max + POSITION_STEP,
  });
  return { genre: getGenre(db, value) };
}

function updateGenre(db, value, payload) {
  if (!db.prepare('SELECT 1 FROM genres WHERE value = ?').get(value)) return null;
  if ('labels' in payload) {
    if (!Object.values(payload.labels || {}).some((l) => String(l || '').trim())) {
      return { error: 'A genre needs at least one label.' };
    }
    replaceLabels(db, value, payload.labels);
  }
  if ('keywords' in payload) replaceKeywords(db, value, payload.keywords);
  if ('position' in payload) {
    const position = Number(payload.position);
    if (Number.isFinite(position)) {
      db.prepare('UPDATE genres SET position = ? WHERE value = ?').run(Math.trunc(position), value);
    }
  }
  return { genre: getGenre(db, value) };
}

// Suppression refusée tant qu'une fiche ou un document y est rangé : le genre
// n'est pas un simple libellé, c'est une valeur référencée, et la supprimer
// laisserait des lignes pointant vers rien.
function deleteGenre(db, value) {
  if (!db.prepare('SELECT 1 FROM genres WHERE value = ?').get(value)) return null;
  const count = usageCounts(db).get(value) || 0;
  if (count > 0) {
    return { error: `${count} item(s) still use this genre. Move them first.` };
  }
  db.prepare('DELETE FROM genre_labels WHERE genre = ?').run(value);
  db.prepare('DELETE FROM genre_keywords WHERE genre = ?').run(value);
  db.prepare('DELETE FROM genres WHERE value = ?').run(value);
  return { ok: true };
}

module.exports = {
  ensureGenresSchema, applySeed, listGenres, catalogFor, usageCounts, compiledRules,
  guessGenre, getGenre, createGenre, updateGenre, deleteGenre, slugify,
  POSITION_STEP,
};
