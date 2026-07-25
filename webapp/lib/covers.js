'use strict';

// Remplacement des couvertures basse résolution par une meilleure version.
//
// La majorité des couvertures de la base sont les vignettes 128×181 que
// renvoyait `imageLinks.thumbnail` de Google Books avant qu'on force `zoom=3`
// (largeur médiane relevée : 116 px). Ce module reprend chaque livre trop
// petit, redemande sa couverture aux catalogues et n'écrit que si l'image
// obtenue est nettement plus large.

const { imageSize } = require('./image.js');
const {
  fetchCoverImage, googleBooksCover, openLibraryCoverUrl, cleanIsbn, isbnVariants, googleBooksPaused,
  describeError,
} = require('./lookup.js');

const DEFAULT_MIN_WIDTH = 400;

// Une image de remplacement doit être franchement meilleure : sans marge, on
// réécrirait la base pour gagner quelques pixels.
const MIN_GAIN_RATIO = 1.2;
const MIN_REPLACEMENT_WIDTH = 250;

const SELECT_SQL = `
  SELECT id, title, isbn, cover
  FROM books
  WHERE cover IS NOT NULL AND isbn IS NOT NULL AND isbn != ''
  ORDER BY id
`;

// Les livres dont la couverture actuelle est plus étroite que `minWidth`.
// Une couverture illisible (format inconnu, en-tête tronqué) est traitée comme
// candidate : elle ne peut qu'être améliorée.
function findCandidates(db, minWidth = DEFAULT_MIN_WIDTH) {
  const candidates = [];
  for (const row of db.prepare(SELECT_SQL).all()) {
    const size = imageSize(row.cover);
    const width = size ? size.width : 0;
    if (width >= minWidth) continue;
    candidates.push({ id: row.id, title: row.title, isbn: row.isbn, width, height: size ? size.height : 0 });
  }
  return candidates;
}

// Toutes les couvertures connues pour cet ISBN, la plus large en premier.
// `onSourceError` est appelé quand un catalogue est injoignable, pour pouvoir
// distinguer « ce livre n'a pas de couverture ailleurs » de « la source est
// tombée » — sans quoi un quota épuisé ressemble à un catalogue vide.
async function fetchBestCover(isbn, onSourceError) {
  const clean = cleanIsbn(isbn);
  if (!clean) return null;

  const urls = isbnVariants(clean).map((variant) => openLibraryCoverUrl(variant));

  let google = null;
  try {
    google = await googleBooksCover(clean);
  } catch (e) {
    if (onSourceError) onSourceError('Google Books', e);
  }
  if (google) {
    urls.push(google.url);
    if (google.fallback) urls.push(google.fallback);
  }

  const images = (await Promise.all(urls.map((url) => fetchCoverImage(url)))).filter(Boolean);
  if (!images.length) return null;
  images.sort((a, b) => b.width - a.width);
  return images[0];
}

function isWorthReplacing(current, candidate) {
  return candidate.width >= MIN_REPLACEMENT_WIDTH
    && candidate.width >= current.width * MIN_GAIN_RATIO;
}

// Parcourt les candidats et met la base à jour au fil de l'eau.
//
// `onStart(total)` est appelé une fois les candidats connus, `onProgress(event,
// totals)` après chaque livre. `shouldStop()` est consulté avant chaque livre,
// ce qui permet d'interrompre proprement une exécution longue sans laisser
// d'écriture à moitié faite.
async function upgradeCovers(db, options = {}) {
  const {
    minWidth = DEFAULT_MIN_WIDTH,
    limit = Infinity,
    delayMs = 250,
    dryRun = false,
    onStart = null,
    onProgress = null,
    shouldStop = null,
  } = options;

  const candidates = findCandidates(db, minWidth).slice(0, limit);
  if (onStart) onStart(candidates.length);
  const updateStmt = db.prepare('UPDATE books SET cover = ?, cover_mime = ? WHERE id = ?');
  const totals = { total: candidates.length, processed: 0, upgraded: 0, unchanged: 0, failed: 0 };
  const sourceErrors = new Map();
  const noteSourceError = (source, err) => {
    sourceErrors.set(source, (sourceErrors.get(source) || 0) + 1);
    if (sourceErrors.get(source) === 1) console.warn(`[covers] ${source} indisponible : ${describeError(err)}`);
  };

  for (const book of candidates) {
    if (shouldStop && shouldStop()) break;

    const event = { ...book, status: 'unchanged', new_width: null };
    try {
      const best = await fetchBestCover(book.isbn, noteSourceError);
      if (best && isWorthReplacing(book, best)) {
        if (!dryRun) updateStmt.run(best.buf, best.mime, book.id);
        event.status = 'upgraded';
        event.new_width = best.width;
        totals.upgraded++;
      } else {
        totals.unchanged++;
      }
    } catch (e) {
      event.status = 'failed';
      event.error = describeError(e);
      totals.failed++;
    }

    totals.processed++;
    if (onProgress) onProgress(event, totals);
    if (delayMs && totals.processed < candidates.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Quota épuisé : la source se met en pause d'elle-même et cesse de lever,
  // donc le compteur d'erreurs ci-dessus ne la verrait plus. Sans cette ligne,
  // un run entier passerait sous silence le fait que Google a été ignoré.
  if (googleBooksPaused() && !sourceErrors.has('Google Books')) {
    sourceErrors.set('Google Books', totals.processed);
  }

  return { ...totals, source_errors: Object.fromEntries(sourceErrors) };
}

module.exports = { upgradeCovers, findCandidates, DEFAULT_MIN_WIDTH };
