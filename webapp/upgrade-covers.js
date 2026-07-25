'use strict';

// Replaces low-resolution covers with a better version from Open Library /
// Google Books. Safe to re-run: a book is only written when a strictly wider
// cover is actually found.
//
// The same job is available from the Settings page, with a progress bar.
//
// Usage: node upgrade-covers.js [--min-width 400] [--limit N] [--delay-ms 250] [--dry-run]

const { openDb } = require('./lib/db.js');
const { upgradeCovers, findCandidates, DEFAULT_MIN_WIDTH } = require('./lib/covers.js');

function parseArgs() {
  const args = { minWidth: DEFAULT_MIN_WIDTH, limit: Infinity, delayMs: 250, dryRun: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-width') args.minWidth = Number(argv[++i]);
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    if (argv[i] === '--delay-ms') args.delayMs = Number(argv[++i]);
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const { minWidth, limit, delayMs, dryRun } = parseArgs();
  const db = openDb();

  const candidates = findCandidates(db, minWidth);
  console.log(`${candidates.length} covers narrower than ${minWidth}px (of the books that have an ISBN).`);
  if (dryRun) console.log('--dry-run: nothing will be written.');

  const result = await upgradeCovers(db, {
    minWidth,
    limit,
    delayMs,
    dryRun,
    onProgress: (event, totals) => {
      const position = `${totals.processed}/${totals.total}`.padStart(9);
      if (event.status === 'upgraded') {
        console.log(`${position} OK    #${event.id} ${event.width}px → ${event.new_width}px — ${event.title}`);
      } else if (event.status === 'failed') {
        console.error(`${position} ERR   #${event.id} ${event.error} — ${event.title}`);
      }
    },
  });

  console.log('---');
  console.log(`Upgraded: ${result.upgraded} / Left alone: ${result.unchanged} / Errors: ${result.failed}`);
  for (const [source, count] of Object.entries(result.source_errors)) {
    console.log(`(${source} was unreachable on ${count} of them.)`);
  }
}

main();
