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
  const startedAt = Date.now();
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    return { ms: Date.now() - startedAt, text: addresses.map((a) => a.address).join(', ') };
  } catch (e) {
    return { ms: Date.now() - startedAt, text: `DNS FAILED: ${e.code || e.message}`, failed: true };
  }
}

// A non-2xx body is the single most informative thing here and it was being
// thrown away: a Google API error names its own cause in JSON, whereas an
// intercepting proxy returns HTML.
async function request(url, headers) {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text();
    return {
      ms: Date.now() - startedAt,
      status: res.status,
      ok: res.ok,
      text: `HTTP ${res.status} (${Buffer.byteLength(body)} bytes)`,
      body: res.ok ? null : body.replace(/\s+/g, ' ').trim().slice(0, 220),
    };
  } catch (e) {
    return { ms: Date.now() - startedAt, ok: false, text: `FAILED: ${describeError(e)}`, body: null };
  }
}

async function probe(label, url) {
  const { hostname } = new URL(url);
  const lookup = await resolve(hostname);
  const result = await request(url, { 'User-Agent': USER_AGENT });

  console.log(`${label}`);
  console.log(`   ${hostname} -> ${lookup.text}   [DNS ${lookup.ms}ms]`);
  console.log(`   ${result.text} in ${result.ms}ms`);
  if (result.body) console.log(`   body: ${result.body}`);

  // Same request, default User-Agent. Google's frontend has been the odd one
  // out here, and a manual `node -e fetch(...)` (which sends no custom header)
  // succeeded where the app failed — worth isolating rather than guessing.
  if (!result.ok) {
    const bare = await request(url, {});
    console.log(`   retry without our User-Agent: ${bare.text} in ${bare.ms}ms`);
    if (bare.ok) console.log('   >>> the custom User-Agent is what this host rejects.');
  }
  console.log('');
  return { ok: result.ok, dnsMs: lookup.ms, dnsFailed: Boolean(lookup.failed) };
}

// A uniform multi-second delay on every name is almost always configuration,
// not a slow upstream: an unreachable first nameserver that has to time out, or
// `ndots`/`search` making every lookup try bogus suffixes first.
function showResolverConfig() {
  try {
    const conf = require('node:fs').readFileSync('/etc/resolv.conf', 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    console.log('/etc/resolv.conf:');
    for (const line of conf) console.log(`   ${line}`);
  } catch (e) {
    console.log(`/etc/resolv.conf unreadable: ${e.message}`);
  }
  console.log('');
}

async function main() {
  console.log(`Node ${process.version} — Google Books key: ${KEY ? `set (…${KEY.slice(-4)})` : 'NOT SET'}, country=${COUNTRY}`);
  console.log('');
  showResolverConfig();
  const results = [];
  for (const [label, url] of TARGETS) {
    results.push([label, await probe(label, url)]);
  }

  // A uniform floor across unrelated hosts is never the network; it is the
  // resolver timing out and retrying, and it taxes every single request the
  // app makes.
  const dnsTimes = results.map(([, r]) => r.dnsMs).sort((a, b) => a - b);
  const medianDns = dnsTimes[Math.floor(dnsTimes.length / 2)];
  const dnsFailures = results.filter(([, r]) => r.dnsFailed).length;
  console.log('---');
  console.log(`DNS: median ${medianDns}ms, slowest ${dnsTimes[dnsTimes.length - 1]}ms, ${dnsFailures} outright failure(s)`);
  if (medianDns > 500 || dnsFailures) {
    console.log('  ^ This is slow enough to dominate every request. Point the container at a');
    console.log('    fast resolver (`dns: [1.1.1.1, 9.9.9.9]` on the compose service), or find out');
    console.log('    why the current one takes seconds to answer.');
  }
  console.log('');

  const bad = results.filter(([, r]) => !r.ok);
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
