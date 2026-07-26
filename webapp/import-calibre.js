'use strict';

// Import (idempotent) d'une bibliothèque Calibre dans la collection numérique.
//
// Usage:
//   node import-calibre.js --root /library [--metadata /library/metadata.db]
//   node import-calibre.js --root /library --dry-run
//   node import-calibre.js --root /library --refresh-meta
//   node import-calibre.js --root /library --genre science-technologie
//
// --dry-run       n'écrit rien, rapporte ce qui serait fait et les anomalies
// --refresh-meta  réécrit aussi les métadonnées des fiches déjà importées
//                 (par défaut elles sont préservées : elles ont pu être
//                 corrigées à la main)
// --genre         genre appliqué aux fiches créées, faute de catégorisation
//                 automatique pertinente sur ce corpus

const fs = require('fs');
const path = require('path');
const { openDb, LIBRARY_ROOT } = require('./lib/db.js');
const { importCalibre } = require('./lib/calibre-import.js');

function parseArgs(argv) {
  const args = { root: LIBRARY_ROOT, metadata: null, dryRun: false, refreshMeta: false, genre: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--refresh-meta') args.refreshMeta = true;
    else if (arg === '--root') args.root = argv[++i];
    else if (arg === '--metadata') args.metadata = argv[++i];
    else if (arg === '--genre') args.genre = argv[++i];
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const metadataPath = args.metadata
    ? path.resolve(args.metadata)
    : path.join(root, 'metadata.db');

  if (!fs.existsSync(root)) {
    console.error(`Racine introuvable : ${root}`);
    console.error('Indiquez-la avec --root, ou via la variable LIBRARY_ROOT.');
    process.exit(1);
  }
  if (!fs.existsSync(metadataPath)) {
    console.error(`metadata.db introuvable : ${metadataPath}`);
    process.exit(1);
  }

  const db = openDb();
  const started = Date.now();
  let lastTick = 0;

  const result = importCalibre(db, {
    metadataPath,
    root,
    dryRun: args.dryRun,
    refreshMeta: args.refreshMeta,
    genre: args.genre,
    onProgress: (entry, stats) => {
      const done = stats.added + stats.updated + stats.failed;
      if (done - lastTick < 100 && done !== stats.total) return;
      lastTick = done;
      process.stdout.write(`\r  ${done}/${stats.total}…`);
    },
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write('\r');
  console.log(`${args.dryRun ? '[dry-run] ' : ''}Import terminé en ${elapsed}s`);
  console.log(`  ${result.added} créées, ${result.updated} déjà présentes, ${result.failed} en échec`);
  console.log(`  ${result.files} fichiers référencés, dont ${result.missing_files} absents du disque`);
  if (result.no_file) console.log(`  ${result.no_file} fiches sans aucun fichier`);
  if (result.no_cover) console.log(`  ${result.no_cover} fiches annoncées avec couverture mais sans cover.jpg`);

  const { report } = result;
  if (report.no_file.length) {
    console.log('\nFiches sans fichier :');
    for (const r of report.no_file) console.log(`  [${r.calibre_id}] ${r.title}`);
  }
  if (report.missing.length) {
    console.log(`\nFichiers introuvables (${report.missing.length}) :`);
    for (const r of report.missing.slice(0, 30)) console.log(`  [${r.calibre_id}] ${r.file}`);
    if (report.missing.length > 30) console.log(`  … et ${report.missing.length - 30} autres`);
  }
  if (report.errors.length) {
    console.log(`\nÉchecs (${report.errors.length}) :`);
    for (const r of report.errors.slice(0, 30)) console.log(`  [${r.calibre_id}] ${r.title} — ${r.error}`);
  }

  if (!args.dryRun) {
    const totals = db.prepare(`
      SELECT COUNT(*) n, SUM(primary_size) bytes,
             SUM(cover_name IS NOT NULL) covers
        FROM documents
    `).get();
    console.log(`\nCollection : ${totals.n} documents, ${formatSize(totals.bytes)}, ${totals.covers} couvertures`);
    console.log(db.prepare(`
      SELECT primary_format f, COUNT(*) c FROM documents
       GROUP BY primary_format ORDER BY c DESC LIMIT 8
    `).all().map((r) => `${r.c} ${r.f || '(aucun)'}`).join(' · '));
  }
}

main();
