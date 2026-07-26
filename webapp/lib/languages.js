'use strict';

// Langues des fiches et des documents.
//
// Codes ISO 639-1 à deux lettres, parce que c'est ce que comprend l'attribut
// `lang` du HTML et ce que produisent les navigateurs. Attention aux fausses
// évidences : l'espagnol est `es` (español) et non `sp`, l'allemand `de`
// (Deutsch) et non `ge`.
//
// Calibre, lui, stocke des codes à trois lettres (639-2/3) : la bibliothèque
// importée contient `eng`, `fra` et `slv`. `normalizeLang` ramène ces valeurs —
// et quelques saisies libres courantes — vers le code à deux lettres, pour que la
// liste déroulante et les données existantes parlent de la même chose.

const LANGUAGES = [
  { code: 'fr', labels: { fr: 'Français', en: 'French' } },
  { code: 'en', labels: { fr: 'Anglais', en: 'English' } },
  { code: 'es', labels: { fr: 'Espagnol', en: 'Spanish' } },
  { code: 'de', labels: { fr: 'Allemand', en: 'German' } },
  { code: 'it', labels: { fr: 'Italien', en: 'Italian' } },
  { code: 'pt', labels: { fr: 'Portugais', en: 'Portuguese' } },
  { code: 'nl', labels: { fr: 'Néerlandais', en: 'Dutch' } },
  { code: 'la', labels: { fr: 'Latin', en: 'Latin' } },
  { code: 'el', labels: { fr: 'Grec', en: 'Greek' } },
  { code: 'ru', labels: { fr: 'Russe', en: 'Russian' } },
  { code: 'pl', labels: { fr: 'Polonais', en: 'Polish' } },
  { code: 'cs', labels: { fr: 'Tchèque', en: 'Czech' } },
  { code: 'sl', labels: { fr: 'Slovène', en: 'Slovenian' } },
  { code: 'hu', labels: { fr: 'Hongrois', en: 'Hungarian' } },
  { code: 'ro', labels: { fr: 'Roumain', en: 'Romanian' } },
  { code: 'sv', labels: { fr: 'Suédois', en: 'Swedish' } },
  { code: 'no', labels: { fr: 'Norvégien', en: 'Norwegian' } },
  { code: 'da', labels: { fr: 'Danois', en: 'Danish' } },
  { code: 'fi', labels: { fr: 'Finnois', en: 'Finnish' } },
  { code: 'tr', labels: { fr: 'Turc', en: 'Turkish' } },
  { code: 'ar', labels: { fr: 'Arabe', en: 'Arabic' } },
  { code: 'he', labels: { fr: 'Hébreu', en: 'Hebrew' } },
  { code: 'ja', labels: { fr: 'Japonais', en: 'Japanese' } },
  { code: 'zh', labels: { fr: 'Chinois', en: 'Chinese' } },
  { code: 'ko', labels: { fr: 'Coréen', en: 'Korean' } },
  { code: 'ca', labels: { fr: 'Catalan', en: 'Catalan' } },
  { code: 'eu', labels: { fr: 'Basque', en: 'Basque' } },
  { code: 'br', labels: { fr: 'Breton', en: 'Breton' } },
  { code: 'oc', labels: { fr: 'Occitan', en: 'Occitan' } },
  { code: 'mul', labels: { fr: 'Multilingue', en: 'Multilingual' } },
];

const VALID = new Set(LANGUAGES.map((l) => l.code));

// Alias vers le code canonique. Les trois lettres viennent de Calibre, les
// abréviations fautives (`sp`, `ge`) et les noms en clair d'une saisie libre.
const ALIASES = {
  eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ger: 'de', deu: 'de', ita: 'it',
  por: 'pt', dut: 'nl', nld: 'nl', lat: 'la', gre: 'el', ell: 'el', rus: 'ru',
  pol: 'pl', cze: 'cs', ces: 'cs', slv: 'sl', hun: 'hu', rum: 'ro', ron: 'ro',
  swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', tur: 'tr', ara: 'ar', heb: 'he',
  jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', cat: 'ca', baq: 'eu', eus: 'eu',
  bre: 'br', oci: 'oc', und: null, mis: null,
  sp: 'es', ge: 'de', gb: 'en', us: 'en',
  francais: 'fr', français: 'fr', anglais: 'en', english: 'en', french: 'fr',
  espagnol: 'es', spanish: 'es', allemand: 'de', german: 'de',
  italien: 'it', italian: 'it', latin: 'la',
};

// Renvoie le code canonique, ou null si la valeur n'est pas reconnue. Refuser
// plutôt que d'inventer : une langue fausse est plus gênante qu'une langue vide,
// et un champ vide se voit dans les filtres.
function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  // « fr-FR », « en_US » : on ne garde que la partie langue.
  const base = raw.split(/[-_]/)[0];
  if (VALID.has(base)) return base;
  if (base in ALIASES) return ALIASES[base];
  if (raw in ALIASES) return ALIASES[raw];
  return null;
}

function isValidLang(code) {
  return VALID.has(String(code || ''));
}

function languageCatalog(uiLang) {
  const pick = (labels) => labels[uiLang] || labels.fr || labels.en;
  return LANGUAGES
    .map((l) => ({ code: l.code, label: pick(l.labels), labels: l.labels }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLang || 'fr'));
}

module.exports = { LANGUAGES, normalizeLang, isValidLang, languageCatalog };
