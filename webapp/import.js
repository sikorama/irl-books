'use strict';

// One-time (idempotent) import of the legacy Alexandria yaml/cover library
// into SQLite. Usage: node import.js [path-to-db-alexandria]

const fs = require('fs');
const path = require('path');
const { parseBookYaml } = require('./lib/yaml-lite.js');
const { openDb } = require('./lib/db.js');
const { guessGenre } = require('./lib/genres.js');

const SKIP_DIRS = new Set(['covers']);

function detectMime(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  return 'application/octet-stream';
}

function findCover(dir, baseName) {
  const coverPath = path.join(dir, baseName + '.cover');
  if (fs.existsSync(coverPath)) {
    const buf = fs.readFileSync(coverPath);
    return { data: buf, mime: detectMime(buf) };
  }
  return { data: null, mime: null };
}

function main() {
  const root = process.argv[2] || path.join(__dirname, '..', 'db-alexandria');
  if (!fs.existsSync(root)) {
    console.error(`Directory not found: ${root}`);
    process.exit(1);
  }

  const db = openDb();
  const insertStmt = db.prepare(`
    INSERT INTO books
      (library, ident, isbn, title, authors, publisher, publishing_year,
       edition, notes, own, want, redd, loaned, loaned_to, rating, tags, genre,
       cover, cover_mime)
    VALUES
      (@library, @ident, @isbn, @title, @authors, @publisher, @publishing_year,
       @edition, @notes, @own, @want, @redd, @loaned, @loaned_to, @rating, @tags, @genre,
       @cover, @cover_mime)
    ON CONFLICT(library, ident) WHERE ident IS NOT NULL DO NOTHING
  `);

  const libDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name));

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const dirent of libDirs) {
    const libraryName = dirent.name;
    const dir = path.join(root, libraryName);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));

    for (const file of files) {
      const baseName = file.slice(0, -'.yaml'.length);
      const full = path.join(dir, file);
      try {
        const buf = fs.readFileSync(full);
        const book = parseBookYaml(buf);
        const cover = findCover(dir, baseName);
        const title = book.title || '(untitled)';
        const authors = book.authors || [];

        const info = insertStmt.run({
          library: libraryName,
          ident: book.saved_ident || baseName,
          isbn: book.isbn || null,
          title,
          authors: JSON.stringify(authors),
          publisher: book.publisher || null,
          publishing_year: typeof book.publishing_year === 'number' ? book.publishing_year : null,
          edition: book.edition || null,
          notes: book.notes || null,
          own: book.own ? 1 : 0,
          want: book.want ? 1 : 0,
          redd: book.redd ? 1 : 0,
          loaned: book.loaned ? 1 : 0,
          loaned_to: book.loaned_to || null,
          rating: typeof book.rating === 'number' ? book.rating : null,
          tags: JSON.stringify(book.tags || []),
          genre: guessGenre(db, { title, authors }),
          cover: cover.data,
          cover_mime: cover.mime,
        });

        if (info.changes > 0) imported++;
        else skipped++;
      } catch (e) {
        failed++;
        console.error(`Import failed for ${full}: ${e.message}`);
      }
    }
  }

  console.log(`Import complete: ${imported} added, ${skipped} already present, ${failed} failed.`);
}

main();
