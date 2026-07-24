'use strict';

// Best-effort recovery of missing covers for books that have an ISBN, using
// the free/keyless Open Library Covers API. Safe to re-run: only touches
// books whose `cover` is still NULL.
//
// Usage: node fetch-covers.js [--delay-ms 250] [--limit N]

const { openDb } = require('./lib/db.js');

function parseArgs() {
  const args = { delayMs: 250, limit: Infinity };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--delay-ms') args.delayMs = Number(argv[++i]);
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCover(isbn) {
  const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) return null; // guards against tiny placeholder responses
  return buf;
}

async function main() {
  const { delayMs, limit } = parseArgs();
  const db = openDb();

  const rows = db.prepare(`
    SELECT id, isbn, title FROM books
    WHERE cover IS NULL AND isbn IS NOT NULL AND isbn != ''
    ORDER BY id
  `).all().slice(0, limit);

  const updateStmt = db.prepare('UPDATE books SET cover = ?, cover_mime = ? WHERE id = ?');

  let found = 0;
  let missed = 0;
  let errors = 0;

  console.log(`${rows.length} books to process…`);

  for (const row of rows) {
    try {
      const cover = await fetchCover(row.isbn);
      if (cover) {
        updateStmt.run(cover, 'image/jpeg', row.id);
        found++;
        console.log(`OK    #${row.id} ${row.isbn} — ${row.title}`);
      } else {
        missed++;
      }
    } catch (e) {
      errors++;
      console.error(`ERR   #${row.id} ${row.isbn}: ${e.message}`);
    }
    await sleep(delayMs);
  }

  console.log('---');
  console.log(`Found: ${found} / Not found: ${missed} / Errors: ${errors}`);
}

main();
