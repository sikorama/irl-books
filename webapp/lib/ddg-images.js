'use strict';

// Recherche d'images DuckDuckGo, en dernier recours quand les catalogues de
// livres ne répondent pas.
//
// C'est du scraping d'une API non publique : elle peut changer sans préavis.
// Le module est isolé exprès, et tout appelant doit traiter son échec comme
// normal. Ce qu'on y gagne : DDG répond même sur des titres obscurs là où
// Google Books et Open Library ne connaissent rien du livre.
//
// Déroulé : la page de recherche porte un jeton `vqd` à usage unique, sans
// lequel l'endpoint JSON refuse de répondre. Il faut donc deux requêtes.

// Une requête d'API maison se fait renvoyer ; on se présente en navigateur.
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12000;

async function fetchVqd(query) {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const match = /vqd="([^"]+)"/.exec(html) || /vqd=([\w-]{20,})/.exec(html);
  if (!match) throw new Error('jeton vqd introuvable (format de page modifié ?)');
  return match[1];
}

// Une couverture de livre est portrait, ou carrée dans le pire des cas. Une
// recherche d'images ramène aussi des photos de rayonnages et des bannières :
// ce filtre les écarte avant de les proposer.
const MAX_COVER_RATIO = 1.1;

// Le champ `source` de DDG nomme l'index amont (« Bing »), ce qui n'aide pas à
// juger un résultat. Le domaine hébergeant l'image, si : voir « amazon.fr » ou
// « booknode.com » renseigne bien plus sur ce qu'on s'apprête à choisir.
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Renvoie [{ title, source, cover: { url, fallback } }], la plus pertinente en
// premier. `fallback` est la vignette proxifiée par DDG, qui reste
// téléchargeable quand l'hôte d'origine bloque le hotlink (environ la moitié
// des cas mesurés).
async function searchImages(query, limit = 5) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  const vqd = await fetchVqd(trimmed);
  const params = new URLSearchParams({
    l: 'fr-fr', o: 'json', q: trimmed, vqd, f: ',,,', p: '1',
  });
  const res = await fetch(`https://duckduckgo.com/i.js?${params}`, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://duckduckgo.com/' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const candidates = [];
  for (const item of Array.isArray(data.results) ? data.results : []) {
    if (candidates.length >= limit) break;
    if (!item.image) continue;
    if (item.width && item.height && item.width / item.height > MAX_COVER_RATIO) continue;
    candidates.push({
      title: item.title || null,
      source: hostOf(item.image) || 'web',
      cover: { url: item.image, fallback: item.thumbnail || null },
    });
  }
  return candidates;
}

module.exports = { searchImages };
