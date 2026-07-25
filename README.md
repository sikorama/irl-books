# IRL-Books

A minimal, dependency-free web app (Node.js stdlib only — `http` + `node:sqlite`)
for cataloging and browsing a physical book collection.

## Features

- **Browse & search** — instant search by title, author, publisher or ISBN; filter by room, genre, loaned status, missing cover, or missing ISBN.
- **Add books fast** — scan an ISBN barcode with your phone's camera, auto-fill title/author/publisher/year and cover from the BnF, Open Library and Google Books, then just confirm.
- **Duplicate-aware** — scanning or entering an ISBN already in the catalog opens the existing record instead of creating a copy, with a one-click fix if it's just filed under the wrong room.
- **Inline editing** — click any book to edit every field, replace its cover, or re-run the ISBN lookup.
- **Bulk actions** — multi-select books to move them between rooms or change their genre in one go.
- **Automatic genre tagging** — keyword-based categorization across 20 genres, with manual override.
- **Duplicate & data-quality tools** (Settings page) — detect books sharing an ISBN/import identifier, rename rooms in bulk, re-run auto-categorization, upgrade low-resolution covers in batch with a live progress bar.
- **Calibre export** — generate one EPUB per book with full metadata (and a generated placeholder cover when none exists), ready to import into Calibre.

## Deployment

Requires **Node.js ≥ 22.5** (for `node:sqlite`).

```bash
node server.js            # http://localhost:8321
PORT=9000 node server.js  # to use a different port
```

`library.db` (SQLite) is created automatically on first run and is the only
source of truth — no external database or build step needed.

### ISBN lookup sources

Scanning or typing an ISBN queries three free catalogs in parallel and merges
the answers field by field, in this order of precedence:

| Source | Covers? | Notes |
|---|---|---|
| [BnF](https://catalogue.bnf.fr/api/SRU) (SRU) | no | Best hit rate on French books by a wide margin. No key, no signup. Queried under both the ISBN-13 and ISBN-10 form, because older records are only indexed under the latter. |
| Open Library | yes | Good on English books, patchy on French ones. |
| Google Books | yes | Needs an API key in practice, see below. |

Cover search by title (the 🔍 button on a book) queries five sources at once —
Open Library and Google Books by ISBN, both again by title, plus a DuckDuckGo
image search. `/api/image-search` streams **NDJSON**: one JSON event per line,
written the moment it is known, so thumbnails appear as each source answers
instead of after the slowest one. The panel shows a spinner, elapsed seconds,
how many sources are still running, and how many covers have arrived.

Results are shown in two groups — catalog covers (matched to an edition) first,
web images (a visual likeness, check before picking) after, each labelled with
the host it came from.

The web search matters because the catalogs are jointly unavailable more often
than you'd expect, and simply don't know a large part of a French collection.
It is scraping of an undocumented endpoint (`lib/ddg-images.js`), so treat it as
best-effort: it is isolated in its own module and its failure is never fatal.

Google Books is paused for an hour after a `429`, instead of being re-asked on
every single lookup.

Merging is per-field, so a record with a title but no author on one source can
still be completed from another.

#### `GOOGLE_BOOKS_KEY` (recommended)

Without a key, Google Books requests fall into a shared anonymous daily quota
that is in practice permanently exhausted — every call comes back `HTTP 429`.
ISBN lookups still work (BnF + Open Library cover most of it), but **cover
search by title needs the key**. The server prints a reminder on startup when
it is missing.

Get a free key (1000 requests/day) from the [Google Cloud console](https://console.cloud.google.com/)
by enabling the "Books API", then:

```bash
GOOGLE_BOOKS_KEY=AIza... node server.js
docker run -e GOOGLE_BOOKS_KEY=AIza... ...   # same variable under Docker
```

```yaml
# docker-compose.yml
services:
  irl-books:
    environment:
      GOOGLE_BOOKS_KEY: "AIza..."
```

On startup the server prints which it is using, so you can check the variable
actually reached the process (the key itself is never logged):

```
Google Books: key loaded (…9f3a), country=FR
Google Books: NO KEY (GOOGLE_BOOKS_KEY unset), country=FR
```

#### `GOOGLE_BOOKS_COUNTRY` (defaults to `FR`)

Google Books geolocates the caller's IP to decide which editions it may show.
When it can't — common from a container, a VPN or a hosting provider — it
answers **`503 backendError`** instead of saying so. Every request therefore
carries an explicit `country`. Change it if your collection isn't French.

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
5. Open ⚙️ Settings to set the current room, rename rooms, review/merge
   duplicates, re-run automatic genre categorization, upgrade low-resolution
   covers, or export the whole collection to Calibre.

The **current room** (top of Settings) pre-fills the room on every new book, so
a scanning session doesn't need it typed each time. Filing a book in a different
room makes that one current instead — the setting seeds the default, it doesn't
lock it. It's stored per device (browser `localStorage`), so a phone and a
desktop each keep their own.

### Diagnosing "fetch failed" / unexplained 5xx

Every outbound host the app uses can be probed from wherever the server really
runs — which is the only place that matters when it works from your laptop but
not from the container:

```bash
node net-check.js                                   # locally
docker compose exec <service> node irl-books/net-check.js
```

It prints, per source, the resolved IP addresses, the HTTP status and the exact
network error, then explains how to read the failures. `fetch failed` on its own
is undici's generic wrapper; the real reason (`ENOTFOUND`, `ECONNRESET`,
`ECONNREFUSED`, a TLS error…) lives in its `cause`, which the app now surfaces
everywhere instead of swallowing.

## Maintenance scripts

Both are safe to re-run: they only ever touch books that still need something.

```bash
node fetch-covers.js                  # fills in covers for books that have none
node upgrade-covers.js --dry-run      # lists what an upgrade would replace
node upgrade-covers.js                # replaces low-resolution covers
```

`upgrade-covers.js` re-asks the catalogs for every cover narrower than
`--min-width` (400px by default) and writes a replacement only when a clearly
wider image comes back — at least 250px, and at least 20% wider than the
current one. Books without an ISBN are skipped. Other flags: `--limit N`,
`--delay-ms 250`.

The same job is available from ⚙️ Settings → *Cover quality*, with a progress
bar and a stop button. It runs server-side, so leaving or reloading the page
doesn't interrupt it — reopening Settings reattaches to the running job.

## Project structure

- `lib/yaml-lite.js` — parser for Alexandria's YAML format (not a general-purpose YAML library)
- `lib/db.js` — SQLite schema and connection
- `lib/categorize.js` — keyword-based genre auto-categorization
- `lib/lookup.js` — ISBN metadata + cover retrieval (BnF, Open Library, Google Books)
- `lib/image.js` — image format/dimension sniffing from raw bytes (no dependency)
- `lib/covers.js` — batch upgrade of low-resolution covers
- `lib/epub.js`, `lib/cover-gen.js`, `lib/zip.js`, `lib/png.js` — EPUB export (Calibre)
- `import.js` — one-time yaml+cover → SQLite import from a legacy Alexandria library
- `server.js` — REST API + static files (HTTP, or HTTPS if `certs/` exists)
- `gen-cert.js` — generates a local self-signed certificate (`certs/`) to enable HTTPS
- `public/` — front-end (vanilla HTML/CSS/JS, no build step)
- `public/vendor/` — vendored third-party libraries (ZXing, for barcode scanning)
