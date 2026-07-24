'use strict';

// Automatic categorization by keyword (title + authors). Deliberately
// simple: no external dependency, no network call — open catalogs (Open
// Library, Google Books) only cover books with an ISBN (~80% here) and their
// genre taxonomies don't map cleanly onto our home-grown categories; keyword
// matching on title/author is more reliable and covers 100% of the books.
//
// The keyword lists in RULES below are intentionally left in French: they
// match against a French-language book collection, so translating them
// would break the categorization. Only the display labels are localized.

const GENRES = [
  { value: 'bd', label: 'Comics' },
  { value: 'fantastique-sf', label: 'Fantasy & Sci-Fi' },
  { value: 'policier', label: 'Crime & Mystery' },
  { value: 'roman-classique', label: 'Classic Novels' },
  { value: 'poesie', label: 'Poetry' },
  { value: 'mythologie-contes', label: 'Mythology & Folktales' },
  { value: 'spiritualite-esoterisme', label: 'Spirituality & Esotericism' },
  { value: 'developpement-personnel', label: 'Personal Development' },
  { value: 'sante-bien-etre', label: 'Health & Wellness' },
  { value: 'jardinage', label: 'Garden & Nature' },
  { value: 'cuisine', label: 'Cooking' },
  { value: 'bricolage-maison', label: 'DIY & Home' },
  { value: 'artisanat-couture', label: 'Crafts & Sewing' },
  { value: 'art-peinture', label: 'Art & Painting' },
  { value: 'histoire-archeologie', label: 'History & Archaeology' },
  { value: 'voyage-randonnee', label: 'Travel & Hiking' },
  { value: 'philosophie', label: 'Philosophy' },
  { value: 'linguistique', label: 'Linguistics' },
  { value: 'economique-social', label: 'Economics & Society' },
  { value: 'science-technologie', label: 'Science & Technology' },
];

const GENRE_LABELS = new Map(GENRES.map((g) => [g.value, g.label]));

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalize(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ');
}

// Rules are evaluated in order: the first match wins. The most specific
// entries (known series, identified authors) come before generic keywords
// to avoid false positives (e.g. "god" in a new-age title shouldn't get
// classified as "crime" because another word in the same title matches a
// rule further down).
const RULES = [
  {
    genre: 'bd',
    keywords: [
      'bande dessinee', ' bd ', 'comics', 'manga', 'snoopy', 'peanuts', 'asterix',
      'tintin', 'lucky luke', 'gaston lagaffe', 'spirou', 'thorgal', 'blake et mortimer',
      'boule et bill', 'largo winch', 'corto maltese', 'schtroumpf',
    ],
  },
  {
    genre: 'fantastique-sf',
    keywords: [
      'seigneur anneaux', 'seigneur des anneaux', 'silmarillion', 'hobbit', 'tolkien',
      'asimov', 'ray bradbury', 'bradbury', 'philip k dick', 'philip k. dick',
      'cthulhu', 'lovecraft', 'fondation asimov', 'dune', 'planete des singes',
      'fahrenheit 451', 'chroniques martiennes', 'meilleur des mondes', 'huxley',
      'e t l extra terrestre', 'extraterrestre', 'science fiction', 'fantasy',
      'elfe', 'sorcellerie', 'magie noire',
    ],
  },
  {
    genre: 'policier',
    keywords: [
      'assassin', 'meurtre', 'polar', 'detective', 'enquete criminelle', 'simenon',
      'maigret', 'agatha christie',
    ],
  },
  {
    genre: 'poesie',
    keywords: [
      'poesie', 'poeme', 'poemes', 'poete', 'rimbaud', 'baudelaire', 'verlaine', 'georgiques', 'bucoliques',
    ],
  },
  {
    genre: 'mythologie-contes',
    keywords: [
      'mythe ', 'mythes ', 'mythologie', 'mythique', 'legende', 'legendes', 'legendaire',
      'conte ', 'contes ', 'conte de fees', 'contes de fees', 'fable ', 'fables',
      'iliade', 'odyssee', 'mille et une nuits', 'roman de renard', 'table ronde',
    ],
  },
  {
    genre: 'roman-classique',
    keywords: [
      'moliere', 'voltaire', 'balzac', 'flaubert', 'zola', 'maupassant', 'stendhal',
      'victor hugo', 'colette', 'nerval', 'cervantes', 'don quichotte', 'dostoievski',
      'tolstoi', 'homere', 'virgile', 'sartre', 'nausee', 'candide', 'gargantua',
      'pantagruel', 'idiot', 'roi boiteux', 'oedipe', 'princesse de cleve',
      'colonel chabert', 'ecole des femmes', 'malade imaginaire', 'avare',
      'bourgeois gentilhomme', 'fourberies de scapin', 'tartuffe', 'noces barbares',
    ],
  },
  {
    genre: 'spiritualite-esoterisme',
    keywords: [
      'tarot', 'kabbale', 'chakra', 'esoteris', 'esoterique', 'alchimi', 'occultisme',
      'radiesthesie', 'voyance', 'horoscope', 'feng shui', 'reincarnation',
      'vies anterieures', 'vie anterieure', 'medium', 'astrologie', 'bible', 'evangile',
      'evangiles', 'jesus', ' christ ', 'sacrement', 'chretien', 'gnostique', 'gnostiques',
      'kabbala', 'karma', 'zen ', 'bouddh', 'sagesse', 'mystique', 'divinatoire',
      'symbolisme hermetique', 'templiers', 'cathares', 'druides', 'chamane',
      'compostelle', 'pelerinage', 'pelerin', 'ange ', 'anges', 'angelique',
      'immortel', 'immortels', 'reincarnations', 'vie eternelle', 'initiation',
      'spirituel', 'spiritualite', 'prophetie', 'prophetique', 'prosperite',
      'subconscient', 'vies eternelles', 'sacre ', 'sacres', 'divin', 'psaume',
      'psaumes', 'tibetain', 'apocalypse', 'symboles', 'symbolique', 'symbolisme',
      'oracle', 'signes et', 'rites mortuaires', 'au dela', 'medium', 'anges et',
      'guerisseur', 'chance', 'destin', 'prieres', 'priere', 'religieux', 'religion',
      'saints', 'saint ', 'sainte ',
    ],
  },
  {
    genre: 'developpement-personnel',
    keywords: [
      'developpement personnel', 'confiance en soi', 'estime de soi', 'bonheur',
      'optimisme', 'psychologie', 'mieux vivre', 'realisez vos reves', 'motivation',
      'gerer son temps', 'atteindre vos buts', 'reussir sa vie',
    ],
  },
  {
    genre: 'sante-bien-etre',
    keywords: [
      'sante', 'medecine', 'phytotherapie', 'homeopathie', 'aromatherapie', 'massage',
      'maigrir', 'regime', 'minceur', 'mincir', 'guerir', 'guerison', 'sophrologie',
      'acupuncture', 'digitopuncture', 'therapie', 'naturopathie', 'remedes naturels',
      'remede naturel', 'yoga', 'stretching', 'gymnastique', 'douleur', 'nutrition',
      'herboriste', 'plantes medicinales', 'medicinales', 'reves et', 'interpretation des reves',
      'symboles de vos reves', 'ventre plat', 'rajeunir', 'jeunesse', 'anti age',
      'hypnotisme', 'hypnose', 'digestion', 'circulation veineuse', 'beaute', 'soins de beaute',
      'centenaires', 'fatigue', 'foie', 'vue', 'yeux',
    ],
  },
  {
    genre: 'jardinage',
    keywords: [
      'jardin', 'jardinage', 'jardiner', 'potager', 'rosier', 'rosiers', 'gazon',
      'bulbes', 'arbuste', 'arbustes', 'semer', 'greffer', 'bouturage', 'haies',
      'plantes d appartement', 'plantes de la maison', 'herbier', 'fleurs sauvages',
      'fleurs seches', 'bouquet', 'bouquets', 'plante', 'plantes', 'fleur', 'fleurs',
      'legumes', 'champignons', 'arbres', 'arbre ',
      'biologie', 'genetique', 'zoologie', 'botanique', 'ecologie', 'evolution',
      'especes', 'oiseaux', 'insectes', 'mammiferes', 'naturaliste',
      'sciences naturelles', 'faune', 'flore', 'anatomie', 'physiologie',
      'entomologie', 'ornithologie',
    ],
  },
  {
    genre: 'cuisine',
    keywords: [
      'cuisine', 'recette', 'recettes', 'gourmandise', 'gourmandises', 'machine a pain',
      'faire son pain', 'bons pains',
    ],
  },
  {
    genre: 'bricolage-maison',
    keywords: [
      'bricolage', 'plomberie', 'menuiserie', 'carrelage', 'soudure', 'maconnerie',
      'electricite', 'rangement', 'meuble', 'meubles', 'recup', 'entretenir ma maison',
      'entretien maison', 'decoration', 'decorer', 'restaurer', 'renover', 'pochoir',
      'pochoirs', 'brocante', 'brocanteur', 'brocanteurs', 'chiner', 'cartonnage',
      'coussins', 'paniers', 'motifs',
    ],
  },
  {
    genre: 'artisanat-couture',
    keywords: [
      'couture', 'broderie', 'broder', 'patchwork', 'crochet', 'tricot', 'point de croix',
      'poupee', 'poupees', 'tapisserie', 'textile', 'tissu', 'quilt', 'encadrement',
      'ouvrages de dames', 'chiffon', 'chiffons', 'galons', 'rubans',
    ],
  },
  {
    genre: 'art-peinture',
    keywords: [
      'peinture', 'peindre', 'aquarelle', 'dessin', 'dessiner', 'sculpture', 'gravure',
      'durer', 'picasso', 'histoire de l art', 'graphologie', 'ikebana',
      'art roman', 'symbolisme de l art', 'artiste', 'artistes', 'artisans',
    ],
  },
  {
    genre: 'histoire-archeologie',
    keywords: [
      'histoire', 'archeologie', 'prehistoire', 'prehistorique', 'egypte', 'egyptien',
      'moyen age', 'moyen ge', 'gallo romain', 'gaule', 'antiquite', 'cathedrale',
      'abbaye', 'chateau', 'chateaux', 'romane', 'genealogie', 'momies', 'hieroglyphe',
      'hieroglyphes', 'vestiges', 'monuments', 'folklore', 'patrimoine', 'civilisation',
      'gauloise', 'romains', 'monde antique',
    ],
  },
  {
    genre: 'voyage-randonnee',
    keywords: [
      'randonnee', 'sentier', 'sentiers', 'trekking', 'chemins de', 'chemin de',
      'carte de randonnee', 'topo guide', 'topo guides', 'guide de voyage',
      'guides ethnologues', 'villages de france', 'plus beaux villages',
    ],
  },
  {
    genre: 'philosophie',
    keywords: [
      'philosophie', 'philosophe', 'nietzsche', 'epictete', 'epicure', 'kant',
      'descartes', 'platon', 'metaphysique', 'stoicien', 'existentialisme',
    ],
  },
  {
    genre: 'linguistique',
    keywords: [
      'linguistique', 'linguiste', 'grammaire', 'syntaxe', 'etymologie', 'semantique',
      'morphologie', 'phonetique', 'dialecte', 'dialectes', 'patois',
      'sociolinguistique', 'lexicologie', 'lexique', 'orthographe', 'conjugaison',
      'langage', 'langue francaise', 'langues vivantes',
    ],
  },
  {
    genre: 'economique-social',
    keywords: [
      'economie', 'economique', 'economiste', 'capitalisme', 'liberalisme',
      'marxisme', 'socialisme', 'chomage', 'syndicat', 'syndicalisme', 'finances',
      'finance', 'bourse', 'marche du travail', 'mondialisation', 'inegalites',
      'sociologie', 'sociologue', 'politique sociale', 'affaires sociales',
      'demographie', 'immigration', 'classes sociales', 'droit du travail',
      'entreprise', 'entreprises', 'management', 'marketing', 'commerce',
    ],
  },
  {
    genre: 'science-technologie',
    keywords: [
      'informatique', 'ordinateur', 'ordinateurs', 'robot', 'robots', 'robotique',
      'physique', 'chimie', 'mathematiques', 'astronomie', 'astrophysique',
      'technologie', 'electronique', 'numerique', 'internet', 'ingenierie',
      'mineraux', 'roches', 'geologie', 'meteorites', 'intelligence artificielle',
      'algorithme', 'informaticien',
    ],
  },
];

const COMPILED_RULES = RULES.map((rule) => ({
  genre: rule.genre,
  needles: rule.keywords.map((k) => normalize(k)),
}));

function guessGenre(book) {
  const haystack = ` ${normalize(book.title)} ${normalize((book.authors || []).join(' '))} `.replace(/ +/g, ' ');
  for (const rule of COMPILED_RULES) {
    for (const needle of rule.needles) {
      if (needle && haystack.includes(needle)) return rule.genre;
    }
  }
  return null;
}

module.exports = { GENRES, GENRE_LABELS, guessGenre };
