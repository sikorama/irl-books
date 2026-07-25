'use strict';

// Best-effort recovery of missing covers for books that have an ISBN, using
// the free/keyless Open Library Covers API. Safe to re-run: only touches
// books whose `cover` is still NULL.
//
// Usage: node fetch-covers.js [--delay-ms 250] [--limit N]

const { openDb } = require('./lib/db.js');
const { fetchCoverImage, isbnVariants } = require('./lib/lookup.js');

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

// Returns { buf, mime } or null. Both ISBN forms are tried: some records are
// only indexed under one of them.
async function fetchCover(isbn) {
  for (const variant of isbnVariants(String(isbn).replace(/[^0-9Xx]/g, '').toUpperCase())) {
    const image = await fetchCoverImage(
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(variant)}-L.jpg?default=false`,
    );
    if (image) return image;
  }
  return null;
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
        updateStmt.run(cover.buf, cover.mime, row.id);
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
