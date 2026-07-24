# IRL-Books

A minimal, dependency-free web app (Node.js stdlib only — `http` + `node:sqlite`)
for cataloging and browsing a physical book collection.

## Features

- **Browse & search** — instant search by title, author, publisher or ISBN; filter by room, genre, loaned status, missing cover, or missing ISBN.
- **Add books fast** — scan an ISBN barcode with your phone's camera, auto-fill title/author/publisher/year and cover from Open Library, then just confirm.
- **Duplicate-aware** — scanning or entering an ISBN already in the catalog opens the existing record instead of creating a copy, with a one-click fix if it's just filed under the wrong room.
- **Inline editing** — click any book to edit every field, replace its cover, or re-run the ISBN lookup.
- **Bulk actions** — multi-select books to move them between rooms or change their genre in one go.
- **Automatic genre tagging** — keyword-based categorization across 20 genres, with manual override.
- **Duplicate & data-quality tools** (Settings page) — detect books sharing an ISBN/import identifier, rename rooms in bulk, re-run auto-categorization.
- **Calibre export** — generate one EPUB per book with full metadata (and a generated placeholder cover when none exists), ready to import into Calibre.

## Deployment

Requires **Node.js ≥ 22.5** (for `node:sqlite`).

```bash
node server.js            # http://localhost:8321
PORT=9000 node server.js  # to use a different port
```

`library.db` (SQLite) is created automatically on first run and is the only
source of truth — no external database or build step needed.

### HTTPS (required for barcode scanning from a phone)

The site runs over HTTP by default, reachable on the local network at the
address printed on startup — fine for everything except one thing: mobile
browsers refuse camera access outside of HTTPS (or `localhost`), so the 📷
scan button won't work until the site is served over HTTPS.

```bash
node gen-cert.js   # generates a self-signed certificate (requires openssl), once
node server.js     # detects certs/cert.pem + certs/key.pem and switches to HTTPS automatically
```

On the first connection from a phone, the browser will warn about an
unrecognized certificate — that's expected for a self-signed cert, accept
the exception to continue. If the server's IP changes (new network), rerun
`node gen-cert.js` to regenerate the certificate.

### Importing an existing legacy Alexandria library (optional)

If you're migrating from the old GNOME [Alexandria](https://alexandria.rubyforge.org/)
book cataloguer, its `.yaml`/`.cover` files can be imported once:

```bash
node import.js /path/to/db-alexandria
```

The import is idempotent — rerunning it never duplicates anything, and
books added later through the web UI are never touched.

## Usage

1. Start the server (see Deployment) and open the printed URL in a browser.
2. Use ➕ to add a book manually, or 📷 to scan a barcode — either way, missing
   details are pulled automatically from Open Library when available.
3. Search and filter from the top bar; click a book's cover to open and edit it,
   or click its room/genre badge for a quick change without opening the full record.
4. Use ☑️ to select multiple books and move them or change their genre in bulk.
5. Open ⚙️ Settings to rename rooms, review/merge duplicates, re-run automatic
   genre categorization, or export the whole collection to Calibre.

## Project structure

- `lib/yaml-lite.js` — parser for Alexandria's YAML format (not a general-purpose YAML library)
- `lib/db.js` — SQLite schema and connection
- `lib/categorize.js` — keyword-based genre auto-categorization
- `lib/epub.js`, `lib/cover-gen.js`, `lib/zip.js`, `lib/png.js` — EPUB export (Calibre)
- `import.js` — one-time yaml+cover → SQLite import from a legacy Alexandria library
- `server.js` — REST API + static files (HTTP, or HTTPS if `certs/` exists)
- `gen-cert.js` — generates a local self-signed certificate (`certs/`) to enable HTTPS
- `public/` — front-end (vanilla HTML/CSS/JS, no build step)
- `public/vendor/` — vendored third-party libraries (ZXing, for barcode scanning)
