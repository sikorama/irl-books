'use strict';

// Best-effort recovery of missing covers for books that have an ISBN, using
// the free/keyless Open Library Covers API. Safe to re-run: only touches
// books whose `cover` is still NULL.
//
// Usage: node fetch-covers.js [--delay-ms 250] [--limit N]

const { openDb } = require('./lib/db.js');
const { fetchCoverImageDetailed, isbnVariants } = require('./lib/lookup.js');

function parseArgs() {
  const args = { delayMs: 250, limit: Infinity };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--delay-ms') args.delayMs = Number(argv[++i]);
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

// « effacer la ligne » en ANSI. Écrit en séquence d'échappement plutôt qu'avec
// l'octet ESC brut : un caractère de contrôle invisible dans le source finit
// par se faire manger par un copier-coller ou un outil de diff.
const CLEAR_LINE = '\u001b[2K';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns { image, reason, failed }. Both ISBN forms are tried: some records
// are only indexed under one of them. On échoue en distinguant l'absence
// (Open Library ne connaît pas ce livre) de la panne (serveur injoignable) :
// sans cette distinction, une coupure réseau se lit « aucune couverture
// trouvée » et on conclut à tort que le rattrapage est terminé.
async function fetchCover(isbn) {
  let last = { image: null, reason: 'aucun ISBN exploitable', failed: false };
  for (const variant of isbnVariants(String(isbn).replace(/[^0-9Xx]/g, '').toUpperCase())) {
    last = await fetchCoverImageDetailed(
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(variant)}-L.jpg?default=false`,
    );
    if (last.image) return last;
  }
  return last;
}

async function main() {
  const { delayMs, limit } = parseArgs();
  const db = openDb();

  const rows = db.prepare(`
    SELECT id, isbn, title FROM books
    WHERE cover IS NULL AND isbn IS NOT NULL AND isbn != ''
    ORDER BY id
  `).all().slice(0, limit);

  const updateStmt = db.prepare('UPDATE books SET cover = ?, cover_mime = ?, cover_rev = cover_rev + 1 WHERE id = ?');

  let found = 0;
  let missed = 0;
  let errors = 0;
  let done = 0;

  // Open Library n'a de couverture que pour une petite part d'un fonds
  // francophone : l'immense majorité des tentatives sont des 404. Sans trace de
  // progression, le script se taisait plusieurs minutes d'affilée et paraissait
  // planté — c'est ce silence qu'on corrige ici, pas le téléchargement.
  //
  // Sur un terminal la ligne se réécrit sur place, pour ne pas dérouler 290
  // lignes. Redirigé vers un fichier, `\r` ne veut plus rien dire : on écrit
  // alors une ligne de loin en loin, qui reste lisible dans un journal.
  const interactive = process.stdout.isTTY;
  const startedAt = Date.now();

  // `tick` marque l'appel qui suit un livre terminé. Lui seul a le droit
  // d'écrire une ligne en mode journal : l'appel d'avant-traitement ne sert qu'à
  // afficher le titre en cours sur un terminal, et le laisser journaliser
  // imprimait deux fois le même palier.
  function progress(current, { tick = false } = {}) {
    const pct = Math.round((done / rows.length) * 100);
    const elapsed = (Date.now() - startedAt) / 1000;
    // La vitesse se mesure sur ce qui est déjà fait ; l'estimation ne vaut
    // qu'une fois quelques livres passés, sinon elle danse.
    let eta = '';
    if (done >= 5 && done < rows.length) {
      const left = Math.round((elapsed / done) * (rows.length - done));
      eta = left < 60 ? ` · ~${left}s left` : ` · ~${Math.round(left / 60)} min left`;
    }
    const line = `${done}/${rows.length} (${pct}%) · ${found} found · ${missed} not on Open Library`
      + `${errors ? ` · ${errors} unreachable` : ''}${eta}`;
    if (interactive) {
      const suffix = current ? ` — ${current.slice(0, 40)}` : '';
      process.stdout.write(`\r${CLEAR_LINE}${line}${suffix}`);
    } else if (tick && (done === rows.length || done % 25 === 0)) {
      console.log(line);
    }
  }

  // Une ligne écrite par-dessus la barre de progression doit d'abord l'effacer,
  // sinon les deux se mélangent sur la même ligne du terminal.
  function report(text, stream = process.stdout) {
    if (interactive) stream.write(`\r${CLEAR_LINE}`);
    stream.write(`${text}\n`);
  }

  console.log(`${rows.length} book${rows.length === 1 ? '' : 's'} with an ISBN and no cover — asking Open Library…`);
  if (!rows.length) {
    console.log('Nothing to do.');
    return;
  }

  for (const row of rows) {
    progress(row.title);
    try {
      const { image, reason, failed } = await fetchCover(row.isbn);
      if (image) {
        updateStmt.run(image.buf, image.mime, row.id);
        found++;
        report(`OK    #${row.id} ${row.isbn} — ${row.title} (${image.width}×${image.height})`);
      } else if (failed) {
        // Injoignable : ce livre n'a pas été jugé, il a été manqué. Le dire,
        // parce qu'une série de ces lignes veut dire « relance plus tard », pas
        // « ces livres n'ont pas de couverture ».
        errors++;
        report(`FAIL  #${row.id} ${row.isbn}: ${reason}`, process.stderr);
      } else {
        missed++;
      }
    } catch (e) {
      errors++;
      report(`ERR   #${row.id} ${row.isbn}: ${e.message}`, process.stderr);
    }
    done++;
    progress(row.title, { tick: true });
    await sleep(delayMs);
  }

  if (interactive) process.stdout.write('\n');
  console.log('---');
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`Found: ${found} / Not on Open Library: ${missed} / Unreachable: ${errors} — in ${seconds}s`);
  if (errors) {
    console.log(`${errors} book${errors === 1 ? '' : 's'} could not be checked at all (network or server). Re-run to retry just those.`);
  }
  if (!found && missed && !errors) {
    console.log('Every ISBN was answered, none had a cover on Open Library. The 🔍 search in a book\'s detail panel tries more sources.');
  }
}

main();
