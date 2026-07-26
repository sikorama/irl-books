'use strict';

// Indexation plein texte des documents. Reprenable : relancer la commande après
// une interruption ne retraite que ce qui reste.
//
// Usage:
//   node index-text.js --root /library
//   node index-text.js --root /library --limit 20     (essai sur 20 documents)
//   node index-text.js --root /library --force        (tout réindexer)

const path = require('path');
const fs = require('fs');
const { openDb, DB_PATH, LIBRARY_ROOT } = require('./lib/db.js');
const { indexDocuments, findCandidates } = require('./lib/text-index.js');
const fts = require('./lib/docs-fts.js');

function parseArgs(argv) {
  const args = { root: LIBRARY_ROOT, force: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--root') args.root = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg.startsWith('--')) {
      console.error(`Option inconnue : ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function formatSize(bytes) {
  if (!bytes) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) {
    console.error(`Racine introuvable : ${root}`);
    process.exit(1);
  }

  const db = openDb();
  const started = Date.now();
  const problems = [];

  console.log(`Index plein texte → ${fts.ftsPath(DB_PATH)}`);

  let totals;
  try {
    totals = await indexDocuments(db, {
      root,
      dbPath: DB_PATH,
      force: args.force,
      limit: args.limit,
      onStart: (total) => {
        if (!total) console.log('Rien à indexer : tout est à jour.');
        else console.log(`${total} document(s) à traiter.`);
      },
      onProgress: (event, t) => {
        if (event.status !== 'indexed') {
          problems.push(event);
        }
        const pct = t.total ? Math.round((t.processed / t.total) * 100) : 100;
        const elapsed = Date.now() - started;
        // Le reste à faire, estimé sur le débit observé : sur une opération de
        // quarante minutes, savoir si on en est au tiers ou aux trois quarts
        // change ce qu'on décide d'en faire.
        const eta = t.processed ? formatDuration((elapsed / t.processed) * (t.total - t.processed)) : '?';
        process.stdout.write(
          `\r  ${t.processed}/${t.total} (${pct}%) · ${t.indexed} indexés · `
          + `${t.empty} sans texte · ${t.failed} en échec · reste ~${eta}      `,
        );
      },
    });
  } catch (e) {
    process.stdout.write('\n');
    console.error(`Interrompu : ${e.message}`);
    process.exit(1);
  }

  process.stdout.write('\n');
  console.log(`Terminé en ${formatDuration(Date.now() - started)}`);
  console.log(`  ${totals.indexed} indexés, ${totals.empty} sans texte exploitable, ${totals.failed} en échec`);
  console.log(`  ${(totals.chars / 1e6).toFixed(1)} millions de caractères extraits`
    + (totals.truncated ? `, ${totals.truncated} document(s) tronqué(s) à la limite` : ''));

  const empty = problems.filter((p) => p.status === 'empty');
  const failed = problems.filter((p) => p.status === 'failed');

  if (empty.length) {
    // Un PDF sans couche texte est presque toujours un scan : c'est la liste des
    // documents qui gagneraient à passer par une OCR.
    console.log(`\nSans texte exploitable — probablement des scans (${empty.length}) :`);
    for (const p of empty.slice(0, 20)) console.log(`  [${p.id}] ${p.title}`);
    if (empty.length > 20) console.log(`  … et ${empty.length - 20} autres`);
  }
  if (failed.length) {
    console.log(`\nÉchecs (${failed.length}) :`);
    for (const p of failed.slice(0, 20)) console.log(`  [${p.id}] ${p.title} — ${p.error}`);
    if (failed.length > 20) console.log(`  … et ${failed.length - 20} autres`);
  }

  const remaining = findCandidates(db, { force: false }).length;
  if (remaining) console.log(`\n${remaining} document(s) restent à indexer (relancez la commande).`);

  const ftsFile = fts.ftsPath(DB_PATH);
  if (fs.existsSync(ftsFile)) {
    console.log(`\nIndex : ${fts.stats(db).indexed} documents, ${formatSize(fs.statSync(ftsFile).size)}`);
    console.log(`Ce fichier est entièrement reconstructible : le supprimer ne perd aucune donnée.`);
  }
}

main();
