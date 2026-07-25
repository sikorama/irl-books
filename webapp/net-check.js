'use strict';

// Checks every outbound host the app depends on, from wherever the server
// actually runs. Meant to be run inside the container:
//
//   docker compose exec <service> node irl-books/net-check.js
//
// The point is to tell apart the failures the UI cannot: a DNS answer that
// resolves to nowhere, a blocked port, a TLS interception, and a genuine HTTP
// error from the remote service all surface as "fetch failed" otherwise.

const dns = require('node:dns').promises;

const USER_AGENT = 'IRL-Books/1.0 (personal library catalog)';
const TIMEOUT_MS = 15000;
const KEY = process.env.GOOGLE_BOOKS_KEY || '';
const COUNTRY = process.env.GOOGLE_BOOKS_COUNTRY || 'FR';

const TARGETS = [
  ['BnF (metadata)', 'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve'
    + '&query=bib.isbn%20any%20%222070360024%22&recordSchema=dublincore&maximumRecords=1'],
  ['Open Library (metadata)', 'https://openlibrary.org/api/books?bibkeys=ISBN:9782070360024&format=json&jscmd=data'],
  ['Open Library (title search)', 'https://openlibrary.org/search.json?title=Germinal&limit=1&fields=title'],
  ['Open Library (covers)', 'https://covers.openlibrary.org/b/isbn/9782020796569-L.jpg?default=false'],
  ['Google Books (API)', `https://www.googleapis.com/books/v1/volumes?q=isbn:9782070360024&country=${COUNTRY}${KEY ? `&key=${KEY}` : ''}`],
  ['Google Books (covers)', 'https://books.google.com/books/content?id=o1goAQAAIAAJ&printsec=frontcover&img=1&zoom=3'],
  ['DuckDuckGo (web images)', 'https://duckduckgo.com/?q=test&iax=images&ia=images'],
];

function describeError(e) {
  const detail = e && e.cause && (e.cause.message || e.cause.code);
  return detail ? `${e.message} (${detail})` : (e && e.message) || String(e);
}

async function resolve(hostname) {
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    return addresses.map((a) => a.address).join(', ');
  } catch (e) {
    return `DNS FAILED: ${e.code || e.message}`;
  }
}

async function probe(label, url) {
  const { hostname } = new URL(url);
  const addresses = await resolve(hostname);
  const startedAt = Date.now();
  let outcome;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.arrayBuffer();
    outcome = `HTTP ${res.status} (${body.byteLength} bytes)`;
  } catch (e) {
    outcome = `FAILED: ${describeError(e)}`;
  }
  const ms = `${Date.now() - startedAt}ms`;
  console.log(`${label}`);
  console.log(`   ${hostname} -> ${addresses}`);
  console.log(`   ${outcome} in ${ms}`);
  console.log('');
  return !outcome.startsWith('FAILED') && !outcome.startsWith('HTTP 5');
}

async function main() {
  console.log(`Node ${process.version} — Google Books key: ${KEY ? `set (…${KEY.slice(-4)})` : 'NOT SET'}, country=${COUNTRY}`);
  console.log('');
  const results = [];
  for (const [label, url] of TARGETS) {
    results.push([label, await probe(label, url)]);
  }
  const bad = results.filter(([, ok]) => !ok);
  console.log('---');
  if (!bad.length) {
    console.log('Every source is reachable from here.');
    return;
  }
  console.log(`Unreachable or erroring: ${bad.map(([label]) => label).join(', ')}`);
  console.log('');
  console.log('Reading the failures:');
  console.log('  ENOTFOUND / EAI_AGAIN  -> DNS. Under Docker this is often the embedded');
  console.log('     resolver (127.0.0.11) dropping concurrent queries; set an explicit');
  console.log('     `dns:` list on the service, or check an upstream DNS filter.');
  console.log('  0.0.0.0 / 127.0.0.1 in the resolved addresses -> a DNS blocklist');
  console.log('     (Pi-hole, AdGuard, NextDNS) is nulling that host.');
  console.log('  ECONNREFUSED / ETIMEDOUT -> egress firewall or missing route.');
  console.log('  UNABLE_TO_VERIFY_LEAF_SIGNATURE / SELF_SIGNED -> a TLS-intercepting');
  console.log('     proxy; the container needs its CA certificate.');
  console.log('  HTTP 5xx with DNS fine -> the remote service really is failing.');
}

main();
