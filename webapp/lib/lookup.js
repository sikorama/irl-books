'use strict';

// Récupération des métadonnées et des couvertures à partir d'un ISBN.
//
// Trois catalogues sont interrogés en parallèle puis fusionnés champ par champ,
// par ordre de confiance décroissant : BnF, Open Library, Google Books.
//
// La BnF passe en tête parce que le fonds catalogué est très majoritairement
// francophone — c'est précisément le trou de couverture des deux autres. Sur un
// échantillon de 25 ISBN de la base : BnF 21/25, Open Library 13/25, union des
// trois 22/25.
//
// La fusion est faite champ par champ (et non « le premier qui répond gagne »)
// parce qu'une fiche Open Library avec un titre mais sans auteur empêchait
// jusqu'ici de consulter les autres sources, alors qu'elles avaient l'auteur.

const { sniffImageMime, imageSize, looksLikeCover } = require('./image.js');
const { searchImages } = require('./ddg-images.js');

// Combien de vignettes proposer, par provenance.
const CATALOG_RESULTS = 5;
const WEB_RESULTS = 5;

const USER_AGENT = 'IRL-Books/1.0 (catalogue de bibliothèque personnelle)';
const TIMEOUT_MS = 8000;
const COVER_TIMEOUT_MS = 12000;

// Sans clé, les appels tombent dans un quota anonyme partagé qui est en
// pratique constamment épuisé (HTTP 429). Une clé gratuite (1000 req/jour)
// s'obtient sur https://console.cloud.google.com → API « Books API ».
const GOOGLE_BOOKS_KEY = process.env.GOOGLE_BOOKS_KEY || '';

// Google Books géolocalise l'IP appelante pour décider quelles éditions il a le
// droit de montrer. Quand il n'y arrive pas — ce qui est courant depuis un
// conteneur, un VPN ou un hébergeur — il répond « 503 backendError » au lieu
// d'une erreur explicite. Envoyer le pays systématiquement supprime le
// problème.
const GOOGLE_BOOKS_COUNTRY = process.env.GOOGLE_BOOKS_COUNTRY || 'FR';

async function httpGet(url, { timeout = TIMEOUT_MS, accept, retries = 1 } = {}) {
  const headers = { 'User-Agent': USER_AGENT };
  if (accept) headers.Accept = accept;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    try {
      const res = await fetch(String(url), { headers, signal: AbortSignal.timeout(timeout) });
      // Un 5xx est une panne passagère du catalogue et vaut d'être retenté ;
      // un 4xx ne changera pas si on redemande la même chose.
      if (res.status >= 500 && attempt < retries) continue;
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('injoignable');
}

// Le quota Google Books est journalier. Une fois épuisé, redemander à chaque
// recherche n'ajoute que de la latence et du bruit dans les logs : on met la
// source en pause et on la re-teste au bout d'une heure — assez court pour se
// remettre d'un pic passager, assez long pour ne pas marteler l'API.
const GOOGLE_BOOKS_COOLDOWN_MS = 60 * 60 * 1000;
let googleBooksPausedUntil = 0;

function pauseGoogleBooks() {
  googleBooksPausedUntil = Date.now() + GOOGLE_BOOKS_COOLDOWN_MS;
  console.warn('[isbn] quota Google Books épuisé — source mise en pause 1 h.');
}

function googleBooksPaused() {
  return Date.now() < googleBooksPausedUntil;
}

// --- ISBN ------------------------------------------------------------------

function cleanIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function isbn13to10(isbn13) {
  if (!/^978\d{10}$/.test(isbn13)) return null;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

function isbn10to13(isbn10) {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return null;
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * Number(core[i]);
  return core + String((10 - (sum % 10)) % 10);
}

// Les deux formes d'un même ISBN. La BnF indexe les livres anciens sous leur
// ISBN-10 uniquement : chercher « 9782070360024 » ne rend rien, « 2070360024 »
// rend la fiche.
function isbnVariants(clean) {
  const other = clean.length === 13 ? isbn13to10(clean) : isbn10to13(clean);
  return other && other !== clean ? [clean, other] : [clean];
}

// --- Images ----------------------------------------------------------------

// Télécharge une image et la valide sur son contenu, jamais sur l'URL ou le
// `Content-Type` annoncé. Renvoie { buf, mime, width, height } ou null.
// Les couvertures des catalogues font quelques dizaines de Ko ; une image
// trouvée sur le web peut peser plusieurs Mo, et elle finit stockée en base.
const MAX_COVER_BYTES = 5 * 1024 * 1024;

async function fetchCoverImage(url) {
  try {
    const res = await httpGet(url, { timeout: COVER_TIMEOUT_MS, accept: 'image/*' });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > MAX_COVER_BYTES) return null;
    const mime = sniffImageMime(buf);
    if (!mime) return null; // page d'erreur HTML ou format inconnu
    const size = imageSize(buf);
    if (!looksLikeCover(size)) return null;
    return { buf, mime, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

async function fetchCoverBase64(url) {
  const image = await fetchCoverImage(url);
  return image ? `data:${image.mime};base64,${image.buf.toString('base64')}` : null;
}

// Une couverture candidate : l'URL voulue, plus l'URL d'origine à retenter si
// la première ne rend rien.
async function fetchCover(cover) {
  if (!cover) return null;
  const best = await fetchCoverBase64(cover.url);
  if (best) return best;
  return cover.fallback ? fetchCoverBase64(cover.fallback) : null;
}

// `imageLinks.thumbnail` pointe sur du 128×181, beaucoup trop petit pour être
// stocké comme couverture. Le même endpoint sert du 300×424 en zoom=2 et du
// 575×813 en zoom=3. `edge=curl` incruste un faux effet de page cornée sur le
// bord droit de l'image : on le retire.
function googleCover(thumbUrl) {
  const fallback = String(thumbUrl).replace(/^http:/, 'https:');
  let url = fallback;
  try {
    const parsed = new URL(fallback);
    parsed.searchParams.delete('edge');
    parsed.searchParams.set('zoom', '3');
    url = parsed.toString();
  } catch {
    // URL inattendue : on garde l'originale plutôt que de perdre la couverture.
  }
  return { url, fallback };
}

// `default=false` : sans ce paramètre, Open Library répond 200 avec un GIF
// transparent de 43 octets au lieu de signaler l'absence par un 404.
function openLibraryCoverUrl(isbn, size = 'L') {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-${size}.jpg?default=false`;
}

function googleBooksUrl(params) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (GOOGLE_BOOKS_COUNTRY) url.searchParams.set('country', GOOGLE_BOOKS_COUNTRY);
  if (GOOGLE_BOOKS_KEY) url.searchParams.set('key', GOOGLE_BOOKS_KEY);
  return url;
}

// --- Sources ---------------------------------------------------------------

function decodeXmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlTagValues(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))]
    .map((m) => decodeXmlEntities(m[1]).trim())
    .filter(Boolean);
}

// La BnF liste aussi les contributeurs secondaires dans <dc:creator>.
const BNF_SECONDARY_ROLE = /\b(illustrateur|illustratrice|traducteur|traductrice|préfacier|préfacière|éditeur scientifique|éditrice scientifique|photographe|dessinateur|dessinatrice|annotateur|annotatrice|adaptateur|adaptatrice|directeur de publication|directrice de publication|compilateur|compilatrice|graveur|cartographe)\b/i;

// « Camus, Albert (1913-1960). Auteur du texte / Autrice du texte »
//   → « Albert Camus »
function cleanBnfCreator(raw) {
  if (BNF_SECONDARY_ROLE.test(raw)) return null;
  let name = raw
    .replace(/\.\s*(auteur|autrice)\b.*$/i, '')  // mention de rôle en fin de chaîne
    .replace(/\s*\([^)]*\)\s*$/, '')             // dates de vie
    .replace(/[.,;\s]+$/, '')
    .trim();
  const inverted = /^([^,]+),\s*(.+)$/.exec(name);
  if (inverted) name = `${inverted[2].trim()} ${inverted[1].trim()}`;
  return name || null;
}

async function lookupIsbnBnf(variants) {
  // Les variantes ne contiennent que des chiffres et « X » (cf. cleanIsbn),
  // rien à échapper dans la requête CQL.
  const query = `bib.isbn any "${variants.join(' ')}"`;
  const url = new URL('https://catalogue.bnf.fr/api/SRU');
  url.search = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    query,
    recordSchema: 'dublincore',
    maximumRecords: '1',
  }).toString();

  const res = await httpGet(url, { accept: 'application/xml' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (/<srw:numberOfRecords>0</.test(xml)) return null;

  // « L'Étranger / Albert Camus » — le titre BnF suffixe la mention d'auteur.
  const title = (xmlTagValues(xml, 'dc:title')[0] || '').split(' / ')[0].trim();
  if (!title) return null;

  const authors = xmlTagValues(xml, 'dc:creator').map(cleanBnfCreator).filter(Boolean);
  // « Gallimard (Paris) » — on retire le lieu d'édition.
  const publisher = (xmlTagValues(xml, 'dc:publisher')[0] || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const year = /\d{4}/.exec(xmlTagValues(xml, 'dc:date')[0] || '');

  return {
    title,
    authors,
    publisher: publisher || null,
    publishing_year: year ? Number(year[0]) : null,
    cover: null, // le SRU BnF n'expose pas d'images
  };
}

async function lookupIsbnOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await httpGet(url, { accept: 'application/json' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const entry = data[`ISBN:${isbn}`];
  if (!entry) return null;

  const title = [entry.title, entry.subtitle].filter(Boolean).join(' : ');
  if (!title) return null;
  const year = /\d{4}/.exec(entry.publish_date || '');
  const coverUrl = entry.cover && (entry.cover.large || entry.cover.medium);

  return {
    title,
    authors: (entry.authors || []).map((a) => a.name).filter(Boolean),
    publisher: (entry.publishers || []).map((p) => p.name).join(', ') || null,
    publishing_year: year ? Number(year[0]) : null,
    cover: coverUrl ? { url: coverUrl, fallback: null } : null,
  };
}

async function lookupIsbnGoogleBooks(isbn) {
  if (googleBooksPaused()) return null;
  const res = await httpGet(googleBooksUrl({ q: `isbn:${isbn}` }), { accept: 'application/json' });
  if (res.status === 429) {
    pauseGoogleBooks();
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item) return null;
  const info = item.volumeInfo || {};
  if (!info.title) return null;

  const thumb = info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail);
  const year = /\d{4}/.exec(info.publishedDate || '');

  return {
    title: info.title,
    authors: info.authors || [],
    publisher: info.publisher || null,
    publishing_year: year ? Number(year[0]) : null,
    cover: thumb ? googleCover(thumb) : null,
  };
}

// --- Fusion ----------------------------------------------------------------

// Une source injoignable ne doit pas faire échouer les autres, mais elle doit
// rester visible dans les logs : c'est ce qui manquait pour repérer que les
// appels Google Books sans clé étaient tous rejetés en 429.
async function runSource(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[isbn] ${name} indisponible : ${e.message}`);
    return null;
  }
}

function mergeSources(sources) {
  const merged = { title: null, authors: [], publisher: null, publishing_year: null, cover: null };
  for (const source of sources) {
    if (!source) continue;
    if (!merged.title && source.title) merged.title = source.title;
    if (!merged.authors.length && source.authors && source.authors.length) merged.authors = source.authors;
    if (!merged.publisher && source.publisher) merged.publisher = source.publisher;
    if (!merged.publishing_year && source.publishing_year) merged.publishing_year = source.publishing_year;
    if (!merged.cover && source.cover) merged.cover = source.cover;
  }
  return merged;
}

async function lookupIsbn(isbn) {
  const clean = cleanIsbn(isbn);
  if (!clean) return { found: false };
  const variants = isbnVariants(clean);

  const sources = await Promise.all([
    runSource('BnF', () => lookupIsbnBnf(variants)),
    runSource('Open Library', () => lookupIsbnOpenLibrary(clean)),
    runSource('Google Books', () => lookupIsbnGoogleBooks(clean)),
  ]);

  const merged = mergeSources(sources);
  if (!merged.title) return { found: false };

  return {
    found: true,
    title: merged.title,
    authors: merged.authors,
    publisher: merged.publisher,
    publishing_year: merged.publishing_year,
    cover_base64: await fetchCover(merged.cover),
  };
}

// --- Recherche de couvertures ----------------------------------------------

// Candidats Google Books pour une recherche titre/auteur.
async function googleTitleCandidates(query, limit) {
  if (googleBooksPaused()) throw new Error('quota épuisé, source en pause');
  const res = await httpGet(googleBooksUrl({ q: query, maxResults: '20', printType: 'books' }), {
    accept: 'application/json',
  });
  if (res.status === 429) {
    pauseGoogleBooks();
    throw new Error('HTTP 429 (quota journalier épuisé)');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const candidates = [];
  for (const item of Array.isArray(data.items) ? data.items : []) {
    if (candidates.length >= limit) break;
    const info = item.volumeInfo || {};
    const thumb = info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail);
    if (!thumb) continue;
    candidates.push({ title: info.title || null, authors: info.authors || [], cover: googleCover(thumb) });
  }
  return candidates;
}

// Candidats Open Library. `search.json` n'accepte pas correctement une requête
// en texte libre pour ce genre de titre (0 résultat, ou une latence de plus de
// 30 s) : il faut lui passer `title` et `author` séparément.
async function openLibraryTitleCandidates(title, authors, limit) {
  const params = new URLSearchParams({ fields: 'title,author_name,cover_i', limit: String(limit * 2) });
  if (title) params.set('title', title);
  if (authors) params.set('author', authors);
  if (!params.has('title') && !params.has('author')) return [];

  // `search.json` est nettement plus lent que le reste d'Open Library (3 à 15 s
  // mesurées) : le délai commun de 8 s le coupait avant qu'il ait répondu.
  const res = await httpGet(`https://openlibrary.org/search.json?${params}`, {
    accept: 'application/json',
    timeout: 20000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const candidates = [];
  for (const doc of Array.isArray(data.docs) ? data.docs : []) {
    if (candidates.length >= limit) break;
    if (!doc.cover_i) continue;
    candidates.push({
      title: doc.title || null,
      authors: doc.author_name || [],
      cover: { url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`, fallback: null },
    });
  }
  return candidates;
}

// Recherche par titre/auteur sur les deux catalogues. Google Books était
// jusqu'ici la seule source : dès qu'il tombait (429/503), la fonctionnalité
// entière ne rendait plus rien.
async function coverSearchByTitle(title, authors, limit, report) {
  const query = [title, authors].filter(Boolean).join(' ').trim();
  const collect = async (name, fn) => {
    try {
      const candidates = await fn();
      report.ok++;
      return candidates;
    } catch (e) {
      report.errors.push(`${name}: ${e.message}`);
      return [];
    }
  };

  const [google, openLibrary] = await Promise.all([
    query ? collect('Google Books', () => googleTitleCandidates(query, limit + 3)) : [],
    collect('Open Library', () => openLibraryTitleCandidates(title, authors, limit + 3)),
  ]);

  // On alterne les deux sources pour qu'aucune ne monopolise la grille.
  const ordered = [];
  for (let i = 0; i < Math.max(google.length, openLibrary.length); i++) {
    if (google[i]) ordered.push(google[i]);
    if (openLibrary[i]) ordered.push(openLibrary[i]);
  }

  const covers = await Promise.all(ordered.map((c) => fetchCover(c.cover)));
  return ordered
    .map((c, i) => ({ title: c.title, authors: c.authors, source: 'catalog', cover_base64: covers[i] }))
    .filter((r) => r.cover_base64)
    .slice(0, limit);
}

// Recherche web, proposée en complément parce que les catalogues sont
// régulièrement indisponibles et ignorent purement et simplement une partie du
// fonds. Les images ne sont pas rattachées à une édition précise : c'est à
// l'utilisateur de trancher visuellement, d'où l'étiquette de provenance.
async function webCoverCandidates(title, authors, limit, report) {
  const query = [title, authors, 'livre couverture'].filter(Boolean).join(' ').trim();
  let candidates = [];
  try {
    candidates = await searchImages(query, limit + 3);
    report.ok++;
  } catch (e) {
    report.errors.push(`Recherche web: ${e.message}`);
    return [];
  }

  const covers = await Promise.all(candidates.map((c) => fetchCover(c.cover)));
  return candidates
    .map((c, i) => ({ title: c.title, authors: [], source: c.source, cover_base64: covers[i] }))
    .filter((r) => r.cover_base64)
    .slice(0, limit);
}

// Renvoie { results, errors, ok } où `ok` compte les sources qui ont
// effectivement répondu. Une source qui répond « rien » est un résultat
// légitime ; une source qui tombe ne l'est pas, et rien ne distinguait les deux
// côté utilisateur jusqu'ici.
async function imageSearch({ title, authors, isbn }) {
  const results = [];
  const report = { errors: [], ok: 0 };
  const { errors } = report;

  // Une couverture indexée par ISBN correspond bien plus souvent à l'édition
  // exacte qu'une recherche titre/auteur en texte libre — les éditions
  // Gallimard/Folio, par exemple, n'ont souvent pas d'`imageLinks` chez Google
  // alors qu'Open Library a bien une image pour ce même ISBN.
  const clean = cleanIsbn(isbn);
  if (clean) {
    const olCover = await fetchCoverBase64(openLibraryCoverUrl(clean));
    if (olCover) results.push({ title: 'Open Library', authors: [], source: 'catalog', cover_base64: olCover });

    try {
      const gb = await lookupIsbnGoogleBooks(clean);
      report.ok++;
      if (gb && gb.cover) {
        const cover = await fetchCover(gb.cover);
        if (cover) results.push({ title: gb.title, authors: gb.authors, source: 'catalog', cover_base64: cover });
      }
    } catch (e) {
      errors.push(`Google Books (ISBN): ${e.message}`);
    }
  }

  const cleanTitle = String(title || '').trim();
  const cleanAuthors = String(authors || '').trim();

  // Catalogues et recherche web en parallèle : attendre les premiers pour
  // décider s'il faut lancer la seconde doublerait le temps d'attente les jours
  // où les catalogues sont en panne, c'est-à-dire précisément quand on a besoin
  // du repli.
  const [catalog, web] = await Promise.all([
    results.length < CATALOG_RESULTS
      ? coverSearchByTitle(cleanTitle, cleanAuthors, CATALOG_RESULTS - results.length, report)
      : [],
    (cleanTitle || cleanAuthors)
      ? webCoverCandidates(cleanTitle, cleanAuthors, WEB_RESULTS, report)
      : [],
  ]);

  // Les couvertures de catalogue passent devant : elles correspondent à une
  // édition identifiée, là où une image du web est une ressemblance.
  results.push(...catalog, ...web);

  return { results, errors, ok: report.ok };
}

// La couverture que Google Books associe à cet ISBN, sous forme de spécification
// { url, fallback } exploitable par fetchCoverImage. Lève si l'API est
// injoignable, pour que l'appelant puisse distinguer « pas de couverture » de
// « source indisponible ».
async function googleBooksCover(isbn) {
  const info = await lookupIsbnGoogleBooks(cleanIsbn(isbn));
  return info ? info.cover : null;
}

module.exports = {
  lookupIsbn,
  imageSearch,
  fetchCoverImage,
  googleBooksCover,
  openLibraryCoverUrl,
  cleanIsbn,
  isbnVariants,
  googleBooksPaused,
  hasGoogleBooksKey: () => Boolean(GOOGLE_BOOKS_KEY),
  // De quoi vérifier au démarrage que la clé a bien traversé docker compose,
  // sans l'écrire en clair dans les logs.
  describeGoogleBooksKey: () => (GOOGLE_BOOKS_KEY
    ? `key loaded (…${GOOGLE_BOOKS_KEY.slice(-4)}), country=${GOOGLE_BOOKS_COUNTRY}`
    : `NO KEY (GOOGLE_BOOKS_KEY unset), country=${GOOGLE_BOOKS_COUNTRY}`),
};
