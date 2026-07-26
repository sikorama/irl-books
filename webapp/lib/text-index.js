'use strict';

// Indexation du texte des documents.
//
// Une seule passe de `pdftotext` par document produit deux choses : le texte
// intégral, qui part dans l'index FTS5, et le texte de la page 1, mis de côté
// pour la réparation des métadonnées (phase suivante). Sur 1501 PDF et 10 Go,
// compter vingt à quarante minutes — d'où un travail interruptible, reprenable,
// et qui rend compte de sa progression au fil de l'eau.

const path = require('path');
const fs = require('fs');
const { extractFullText, extractFirstPage, extractInfo, popplerAvailable } = require('./pdf-text.js');
const fts = require('./docs-fts.js');

// Seuls ces formats ont une chaîne d'extraction. PS, DOC, PPT, CBR et compagnie
// sont laissés de côté : 62 documents sur 1619, et chacun demanderait un outil
// distinct pour un gain marginal.
const INDEXABLE_FORMATS = new Set(['PDF']);

// La signature sert de clé de cache : si ni la taille ni la date du fichier
// n'ont changé, son texte n'a pas changé non plus et on ne relance pas poppler.
function fileSignature(file) {
  return `${file.file_size || 0}-${file.file_mtime || ''}`;
}

// `in_index` interroge l'index lui-même plutôt que de se fier au seul
// horodatage : le fichier FTS est annoncé comme supprimable sans perte, donc
// après l'avoir effacé la base prétendrait à tort que tout est indexé. Croiser
// les deux rend la reprise auto-réparante.
const CANDIDATE_SQL = `
  SELECT d.id, d.title, d.authors, d.dir, d.primary_format,
         d.text_sig, d.text_indexed_at,
         f.file_name, f.file_size, f.file_mtime,
         EXISTS(SELECT 1 FROM docs.doc_text t WHERE t.rowid = d.id) AS in_index
    FROM documents d
    JOIN document_files f
      ON f.document_id = d.id AND f.format = d.primary_format AND f.missing = 0
   WHERE d.primary_format IN (${[...INDEXABLE_FORMATS].map((f) => `'${f}'`).join(',')})
   ORDER BY d.id
`;

// `force` réindexe tout ; sinon seuls les documents jamais indexés, absents de
// l'index, ou dont le fichier a bougé sont repris. C'est ce qui rend l'opération
// relançable après une interruption sans repartir de zéro.
function findCandidates(db, { force = false } = {}) {
  const rows = db.prepare(CANDIDATE_SQL).all();
  const candidates = [];
  for (const row of rows) {
    const sig = fileSignature(row);
    const upToDate = row.text_indexed_at && row.text_sig === sig && row.in_index;
    if (!force && upToDate) continue;
    candidates.push({ ...row, sig });
  }
  return candidates;
}

async function indexOne(db, root, doc) {
  const abs = path.join(root, doc.dir, doc.file_name);
  const result = { id: doc.id, title: doc.title, status: 'indexed', chars: 0, truncated: false, error: null };

  if (!fs.existsSync(abs)) {
    result.status = 'failed';
    result.error = 'fichier absent du disque';
    return result;
  }

  const full = await extractFullText(abs);
  if (!full.ok) {
    result.status = 'failed';
    result.error = full.error;
    if (full.missingTool) result.missingTool = true;
    return result;
  }

  // Les deux passes restantes sont indépendantes : les lancer ensemble économise
  // un aller-retour de processus par document, soit plusieurs minutes sur 1501.
  const [first, info] = await Promise.all([extractFirstPage(abs), extractInfo(abs)]);

  const authors = (() => {
    try {
      return JSON.parse(doc.authors || '[]').join(', ');
    } catch {
      return '';
    }
  })();

  fts.indexDocument(db, {
    documentId: doc.id,
    title: doc.title,
    authors,
    body: full.text,
    firstPage: first.ok ? first.text : '',
  });

  db.prepare(`
    UPDATE documents
       SET text_indexed_at = datetime('now'),
           text_sig = @sig,
           text_chars = @chars,
           text_truncated = @truncated,
           text_error = NULL,
           pages = COALESCE(@pages, pages)
     WHERE id = @id
  `).run({
    id: doc.id,
    sig: doc.sig,
    chars: full.text.length,
    truncated: full.truncated ? 1 : 0,
    pages: info.ok ? info.pages : null,
  });

  result.chars = full.text.length;
  result.truncated = !!full.truncated;
  // Un PDF de scan sans couche texte produit quelques caractères de bruit. Ce
  // n'est pas un échec — il n'y a simplement rien à indexer — mais le signaler
  // permet de savoir quels documents mériteraient une OCR.
  if (full.text.length < 200) result.status = 'empty';
  return result;
}

function recordFailure(db, doc, error) {
  db.prepare(`
    UPDATE documents SET text_error = @error, text_sig = @sig, updated_at = datetime('now')
     WHERE id = @id
  `).run({ id: doc.id, error: String(error).slice(0, 500), sig: doc.sig });
}

// `onProgress(event, totals)` est appelé après chaque document, `shouldStop()`
// consulté avant chacun : une exécution de quarante minutes doit pouvoir
// s'arrêter proprement sans laisser d'écriture à moitié faite.
async function indexDocuments(db, options = {}) {
  const {
    root,
    dbPath,
    force = false,
    limit = Infinity,
    onStart = null,
    onProgress = null,
    shouldStop = null,
  } = options;

  if (!popplerAvailable()) {
    throw new Error('pdftotext introuvable : installez poppler-utils (déjà présent dans l\'image Docker).');
  }
  fts.attachFts(db, dbPath);

  const candidates = findCandidates(db, { force }).slice(0, limit);
  if (onStart) onStart(candidates.length);

  const totals = {
    total: candidates.length, processed: 0, indexed: 0, empty: 0, failed: 0,
    truncated: 0, chars: 0,
  };

  for (const doc of candidates) {
    if (shouldStop && shouldStop()) break;
    let event;
    try {
      event = await indexOne(db, root, doc);
    } catch (e) {
      event = { id: doc.id, title: doc.title, status: 'failed', error: e.message, chars: 0 };
    }
    if (event.status === 'failed') {
      recordFailure(db, doc, event.error);
      totals.failed++;
      // poppler absent : inutile de tenter les 1500 suivants.
      if (event.missingTool) {
        totals.processed++;
        if (onProgress) onProgress(event, totals);
        throw new Error(event.error);
      }
    } else {
      totals.indexed++;
      totals.chars += event.chars;
      if (event.status === 'empty') totals.empty++;
      if (event.truncated) totals.truncated++;
    }
    totals.processed++;
    if (onProgress) onProgress(event, totals);
  }

  return totals;
}

module.exports = { indexDocuments, findCandidates, INDEXABLE_FORMATS };
