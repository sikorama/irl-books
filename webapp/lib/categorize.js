'use strict';

// Catalogue de départ des genres, et primitives de classification.
//
// Trois principes portent tout le reste :
//
//  1. **L'identité d'un genre est son `value`, jamais son intitulé.** Les fiches
//     et les documents ne stockent que ce slug. Changer un libellé, ajouter une
//     langue ou basculer l'interface du français à l'anglais ne touche donc
//     aucune classification.
//
//  2. **Les mots-clés sont rangés par langue mais utilisés tous ensemble.** Le
//     `lang` d'un mot-clé sert à savoir quelle liste on édite, pas à filtrer la
//     recherche : un titre anglais dans une bibliothèque affichée en français
//     doit être classé aussi bien que l'inverse. La langue `*` est là pour ce qui
//     n'appartient à aucune langue — noms propres, séries, marques.
//
//  3. **L'ordre compte.** La première règle qui correspond gagne, donc les
//     entrées spécifiques (auteurs, séries identifiées) passent avant les mots
//     génériques. Les deux genres qui décrivent une *forme* plutôt qu'un sujet —
//     « Manuels et documentation », « Romans et nouvelles » — sont placés après
//     les genres de fiction identifiables mais avant les genres thématiques, et
//     leurs mots-clés sont volontairement resserrés : voir leurs commentaires.
//
// Ce catalogue n'est qu'une graine : il est copié en base au premier démarrage,
// après quoi c'est la base qui fait foi et l'interface permet de le modifier.

const SEED_GENRES = [
  {
    value: 'bd',
    labels: { fr: 'Bandes dessinées', en: 'Comics' },
    keywords: {
      fr: ['bande dessinee', ' bd ', 'planche dessinee'],
      en: ['comics', 'comic book', 'graphic novel'],
      '*': [
        'manga', 'snoopy', 'peanuts', 'asterix', 'tintin', 'lucky luke',
        'gaston lagaffe', 'spirou', 'thorgal', 'blake et mortimer',
        'boule et bill', 'largo winch', 'corto maltese', 'schtroumpf',
      ],
    },
  },
  {
    value: 'fantastique-sf',
    labels: { fr: 'Fantastique et science-fiction', en: 'Fantasy & Sci-Fi' },
    keywords: {
      fr: [
        'seigneur anneaux', 'seigneur des anneaux', 'planete des singes',
        'chroniques martiennes', 'meilleur des mondes', 'extraterrestre',
        'science fiction', 'elfe', 'sorcellerie', 'magie noire',
        'e t l extra terrestre',
      ],
      en: [
        'lord of the rings', 'science fiction', 'sci fi', 'fantasy novel',
        'sword and sorcery', 'space opera', 'time travel',
      ],
      '*': [
        'silmarillion', 'hobbit', 'tolkien', 'asimov', 'ray bradbury', 'bradbury',
        'philip k dick', 'philip k. dick', 'cthulhu', 'lovecraft',
        'fondation asimov', 'dune', 'fahrenheit 451', 'huxley',
      ],
    },
  },
  {
    value: 'policier',
    labels: { fr: 'Policier et suspense', en: 'Crime & Mystery' },
    keywords: {
      fr: ['assassin', 'meurtre', 'polar', 'detective', 'enquete criminelle'],
      en: ['murder', 'detective', 'crime novel', 'whodunit', 'thriller'],
      '*': ['simenon', 'maigret', 'agatha christie'],
    },
  },
  {
    value: 'roman-classique',
    labels: { fr: 'Roman classique', en: 'Classic Novels' },
    keywords: {
      fr: ['nausee', 'candide', 'roi boiteux', 'princesse de cleve', 'colonel chabert',
        'ecole des femmes', 'malade imaginaire', 'avare', 'bourgeois gentilhomme',
        'fourberies de scapin', 'noces barbares'],
      en: ['classic literature'],
      '*': [
        'moliere', 'voltaire', 'balzac', 'flaubert', 'zola', 'maupassant', 'stendhal',
        'victor hugo', 'colette', 'nerval', 'cervantes', 'don quichotte', 'dostoievski',
        'tolstoi', 'homere', 'virgile', 'sartre', 'gargantua', 'pantagruel', 'idiot',
        'oedipe', 'tartuffe',
      ],
    },
  },
  {
    value: 'poesie',
    labels: { fr: 'Poésie', en: 'Poetry' },
    keywords: {
      fr: ['poesie', 'poeme', 'poemes', 'poete', 'georgiques', 'bucoliques'],
      en: ['poetry', 'poem', 'poems', 'poet', 'verse anthology'],
      '*': ['rimbaud', 'baudelaire', 'verlaine'],
    },
  },
  {
    value: 'mythologie-contes',
    labels: { fr: 'Mythologie et contes', en: 'Mythology & Folktales' },
    keywords: {
      fr: [
        'mythe ', 'mythes ', 'mythologie', 'mythique', 'legende', 'legendes',
        'legendaire', 'conte ', 'contes ', 'conte de fees', 'contes de fees',
        'fable ', 'fables', 'mille et une nuits', 'roman de renard', 'table ronde',
      ],
      en: ['mythology', 'myths', 'folklore tales', 'fairy tale', 'fairy tales', 'legends of'],
      '*': ['iliade', 'odyssee'],
    },
  },
  {
    value: 'musique',
    labels: { fr: 'Musique', en: 'Music' },
    keywords: {
      fr: [
        'musique', 'musical', 'musicale', 'partition', 'partitions', 'solfege',
        'harmonie musicale', 'chanson', 'chansons', 'chorale', 'orchestre',
        'guitare', 'piano', 'violon', 'batterie', 'accordeon', 'instrument de musique',
        'lutherie', 'discographie',
      ],
      en: [
        'music', 'musical', 'sheet music', 'score', 'scores', 'songbook',
        'chord', 'chords', 'guitar', 'piano', 'violin', 'drum', 'drums',
        'improvisation', 'harmony and', 'music theory', 'fingerpicking',
        'transcription', 'real book',
      ],
      '*': [
        'jazz', 'blues', 'bebop', 'bossanova', 'swing', 'aebersold', 'tablature',
        'opus ', 'sonate', 'sonata', 'symphonie', 'symphony', 'concerto',
      ],
    },
  },
  {
    value: 'manuels-documentation',
    labels: { fr: 'Manuels et documentation', en: 'Manuals & Documentation' },
    // « Manuels et documentation » décrit une *forme*, pas un sujet : il entre
    // donc en concurrence avec tous les genres thématiques, alors qu'un document
    // n'a qu'un seul genre. Deux choix en découlent.
    //
    // Position : avant les genres de sujet, sinon il ne gagnerait jamais — un
    // « Aide-mémoire d'électronique » partirait en science, un « Z80 User
    // Manual » aussi, et le genre resterait vide.
    //
    // Précision : en échange, seuls les marqueurs sans ambiguïté sont retenus.
    // « manuel » seul, « guide pratique », « cours de » ou « how to » sont
    // volontairement absents — ils captureraient un manuel de jardinage ou un
    // guide de voyage. Mieux vaut rater un manuel que déplacer un livre de
    // cuisine.
    keywords: {
      fr: [
        'aide memoire', 'mode d emploi', 'notice technique',
        'documentation technique', 'manuel d utilisation', 'manuel utilisateur',
        'guide de l utilisateur', 'guide utilisateur', 'fiche technique',
        'fiches techniques', 'memento', 'formulaire technique',
      ],
      en: [
        'user manual', 'users manual', 'user guide', 'users guide',
        'owners manual', 'reference manual', 'reference guide', 'handbook',
        'datasheet', 'data sheet', 'quick start', 'installation guide',
        'service manual', 'technical documentation', 'firmware guide',
      ],
      '*': ['readme', 'faq'],
    },
  },
  {
    value: 'spiritualite-esoterisme',
    labels: { fr: 'Spiritualité et ésotérisme', en: 'Spirituality & Esotericism' },
    keywords: {
      fr: [
        'tarot', 'kabbale', 'chakra', 'esoteris', 'esoterique', 'alchimi', 'occultisme',
        'radiesthesie', 'voyance', 'horoscope', 'feng shui', 'reincarnation',
        'vies anterieures', 'vie anterieure', 'medium', 'astrologie', 'bible', 'evangile',
        'evangiles', 'jesus', ' christ ', 'sacrement', 'chretien', 'gnostique', 'gnostiques',
        'karma', 'zen ', 'bouddh', 'sagesse', 'mystique', 'divinatoire',
        'symbolisme hermetique', 'templiers', 'cathares', 'druides', 'chamane',
        'compostelle', 'pelerinage', 'pelerin', 'ange ', 'anges', 'angelique',
        'immortel', 'immortels', 'reincarnations', 'vie eternelle', 'initiation',
        'spirituel', 'spiritualite', 'prophetie', 'prophetique', 'prosperite',
        'subconscient', 'vies eternelles', 'sacre ', 'sacres', 'divin', 'psaume',
        'psaumes', 'tibetain', 'apocalypse', 'symboles', 'symbolique', 'symbolisme',
        'oracle', 'signes et', 'rites mortuaires', 'au dela', 'anges et',
        'guerisseur', 'chance', 'destin', 'prieres', 'priere', 'religieux', 'religion',
        'saints', 'saint ', 'sainte ',
      ],
      en: [
        'esoteric', 'occult', 'astrology', 'reincarnation', 'spirituality',
        'mysticism', 'sacred geometry', 'prophecy', 'meditation', 'buddhism',
        'gnostic', 'alchemy', 'divination', 'pilgrimage',
      ],
      '*': ['kabbala', 'gospel', 'psalm'],
    },
  },
  {
    value: 'developpement-personnel',
    labels: { fr: 'Développement personnel', en: 'Personal Development' },
    keywords: {
      fr: [
        'developpement personnel', 'confiance en soi', 'estime de soi', 'bonheur',
        'optimisme', 'psychologie', 'mieux vivre', 'realisez vos reves', 'motivation',
        'gerer son temps', 'atteindre vos buts', 'reussir sa vie',
      ],
      en: [
        'self help', 'self esteem', 'personal development', 'happiness',
        'time management', 'productivity', 'psychology of',
      ],
      '*': [],
    },
  },
  {
    value: 'sante-bien-etre',
    labels: { fr: 'Santé et bien-être', en: 'Health & Wellness' },
    keywords: {
      fr: [
        'sante', 'medecine', 'phytotherapie', 'homeopathie', 'aromatherapie', 'massage',
        'maigrir', 'regime', 'minceur', 'mincir', 'guerir', 'guerison', 'sophrologie',
        'acupuncture', 'digitopuncture', 'therapie', 'naturopathie', 'remedes naturels',
        'remede naturel', 'stretching', 'gymnastique', 'douleur', 'nutrition',
        'herboriste', 'plantes medicinales', 'medicinales', 'reves et',
        'interpretation des reves', 'symboles de vos reves', 'ventre plat', 'rajeunir',
        'jeunesse', 'anti age', 'hypnotisme', 'hypnose', 'digestion',
        'circulation veineuse', 'beaute', 'soins de beaute', 'centenaires', 'fatigue',
        'foie', 'vue', 'yeux', 'biostatistique', 'biostatistiques',
      ],
      en: [
        'health', 'medicine', 'homeopathy', 'aromatherapy', 'nutrition',
        'weight loss', 'healing', 'wellness', 'acupuncture', 'herbal remedies',
        'biostatistics',
      ],
      '*': ['yoga'],
    },
  },
  {
    value: 'jardinage',
    labels: { fr: 'Jardin et nature', en: 'Garden & Nature' },
    keywords: {
      fr: [
        'jardin', 'jardinage', 'jardiner', 'potager', 'rosier', 'rosiers', 'gazon',
        'bulbes', 'arbuste', 'arbustes', 'semer', 'greffer', 'bouturage', 'haies',
        'plantes d appartement', 'plantes de la maison', 'herbier', 'fleurs sauvages',
        'fleurs seches', 'bouquet', 'bouquets', 'plante', 'plantes', 'fleur', 'fleurs',
        'legumes', 'champignons', 'arbres', 'arbre ',
        'biologie', 'genetique des populations', 'heredite', 'zoologie',
        'botanique', 'ecologie',
        'especes', 'oiseaux', 'insectes', 'mammiferes', 'naturaliste',
        'sciences naturelles', 'faune', 'flore', 'anatomie', 'physiologie',
        'entomologie', 'ornithologie',
      ],
      en: [
        'gardening', 'garden', 'orchard', 'botany', 'botanical', 'zoology',
        'ornithology', 'entomology', 'wildlife', 'natural history', 'ecology',
        'flowers', 'shrubs', 'mushrooms',
      ],
      '*': [],
    },
  },
  {
    value: 'cuisine',
    labels: { fr: 'Cuisine', en: 'Cooking' },
    keywords: {
      fr: [
        'cuisine', 'recette', 'recettes', 'gourmandise', 'gourmandises',
        'machine a pain', 'faire son pain', 'bons pains', 'patisserie',
      ],
      en: ['cooking', 'cookbook', 'recipe', 'recipes', 'baking', 'pastry', 'cuisine'],
      '*': [],
    },
  },
  {
    value: 'bricolage-maison',
    labels: { fr: 'Bricolage et maison', en: 'DIY & Home' },
    keywords: {
      fr: [
        'bricolage', 'plomberie', 'menuiserie', 'carrelage', 'soudure', 'maconnerie',
        'rangement', 'meuble', 'meubles', 'recup', 'entretenir ma maison',
        'entretien maison', 'decoration', 'decorer', 'restaurer', 'renover', 'pochoir',
        'pochoirs', 'brocante', 'brocanteur', 'brocanteurs', 'chiner', 'cartonnage',
        'coussins', 'paniers', 'motifs',
      ],
      en: [
        'do it yourself', 'plumbing', 'carpentry', 'woodworking', 'masonry',
        'home repair', 'home improvement', 'interior decoration', 'restoration of',
      ],
      '*': [],
    },
  },
  {
    value: 'artisanat-couture',
    labels: { fr: 'Artisanat et couture', en: 'Crafts & Sewing' },
    keywords: {
      fr: [
        'couture', 'broderie', 'broder', 'crochet', 'tricot', 'point de croix',
        'poupee', 'poupees', 'tapisserie', 'textile', 'tissu', 'encadrement',
        'ouvrages de dames', 'chiffon', 'chiffons', 'galons', 'rubans',
      ],
      en: [
        'sewing', 'embroidery', 'knitting', 'crochet', 'cross stitch',
        'quilting', 'weaving', 'needlework',
      ],
      '*': ['patchwork', 'quilt'],
    },
  },
  {
    value: 'art-peinture',
    labels: { fr: 'Art et peinture', en: 'Art & Painting' },
    keywords: {
      fr: [
        'peinture', 'peindre', 'aquarelle', 'dessin', 'dessiner', 'sculpture', 'gravure',
        'histoire de l art', 'graphologie', 'art roman', 'symbolisme de l art',
        'artiste', 'artistes', 'artisans',
      ],
      en: [
        'painting', 'watercolour', 'watercolor', 'drawing', 'sculpture',
        'engraving', 'art history', 'fine arts',
      ],
      '*': ['durer', 'picasso', 'ikebana'],
    },
  },
  {
    value: 'histoire-archeologie',
    labels: { fr: 'Histoire et archéologie', en: 'History & Archaeology' },
    keywords: {
      fr: [
        'histoire', 'archeologie', 'prehistoire', 'prehistorique', 'egypte', 'egyptien',
        'moyen age', 'moyen ge', 'gallo romain', 'gaule', 'antiquite', 'cathedrale',
        'abbaye', 'chateau', 'chateaux', 'romane', 'genealogie', 'momies', 'hieroglyphe',
        'hieroglyphes', 'vestiges', 'monuments', 'folklore', 'patrimoine', 'civilisation',
        'gauloise', 'romains', 'monde antique',
      ],
      en: [
        'history of', 'archaeology', 'archeology', 'prehistoric', 'ancient egypt',
        'middle ages', 'medieval', 'antiquity', 'cathedral', 'abbey',
        'genealogy', 'hieroglyph', 'civilisation', 'civilization',
      ],
      '*': [],
    },
  },
  {
    value: 'voyage-randonnee',
    labels: { fr: 'Voyage et randonnée', en: 'Travel & Hiking' },
    keywords: {
      fr: [
        'randonnee', 'sentier', 'sentiers', 'chemins de', 'chemin de',
        'carte de randonnee', 'topo guide', 'topo guides', 'guide de voyage',
        'guides ethnologues', 'villages de france', 'plus beaux villages',
      ],
      en: [
        'hiking', 'trail', 'trails', 'travel guide', 'travelogue', 'walking tours',
      ],
      '*': ['trekking'],
    },
  },
  {
    value: 'philosophie',
    labels: { fr: 'Philosophie', en: 'Philosophy' },
    keywords: {
      fr: ['philosophie', 'philosophe', 'metaphysique', 'stoicien', 'existentialisme'],
      en: ['philosophy', 'philosopher', 'metaphysics', 'stoicism', 'existentialism', 'ethics of'],
      '*': ['nietzsche', 'epictete', 'epicure', 'kant', 'descartes', 'platon'],
    },
  },
  {
    value: 'linguistique',
    labels: { fr: 'Linguistique et littérature', en: 'Linguistics & Literature' },
    keywords: {
      fr: [
        'linguistique', 'linguiste', 'grammaire', 'syntaxe', 'etymologie', 'semantique',
        'morphologie', 'phonetique', 'dialecte', 'dialectes', 'patois',
        'sociolinguistique', 'lexicologie', 'lexique', 'orthographe', 'conjugaison',
        'langage', 'langue francaise', 'langues vivantes', 'litterature',
        'critique litteraire', 'traduction',
      ],
      en: [
        'linguistics', 'grammar', 'syntax', 'etymology', 'semantics', 'phonetics',
        'lexicon', 'spelling', 'literature', 'literary criticism', 'translation',
      ],
      '*': [],
    },
  },
  {
    value: 'economique-social',
    labels: { fr: 'Économie et société', en: 'Economics & Society' },
    keywords: {
      fr: [
        'economie', 'economique', 'economiste', 'capitalisme', 'liberalisme',
        'marxisme', 'socialisme', 'chomage', 'syndicat', 'syndicalisme', 'finances',
        'finance', 'bourse', 'marche du travail', 'mondialisation', 'inegalites',
        'sociologie', 'sociologue', 'politique sociale', 'affaires sociales',
        'demographie', 'immigration', 'classes sociales', 'droit du travail',
        'entreprise', 'entreprises', 'commerce',
      ],
      en: [
        'economics', 'economy', 'capitalism', 'socialism', 'unemployment',
        'sociology', 'demography', 'labour market', 'labor market', 'globalisation',
        'globalization', 'inequality', 'management', 'marketing',
      ],
      '*': [],
    },
  },
  {
    value: 'science-technologie',
    labels: { fr: 'Science et technologie', en: 'Science & Technology' },
    keywords: {
      fr: [
        'informatique', 'ordinateur', 'ordinateurs', 'robotique', 'physique', 'chimie',
        'mathematiques', 'astronomie', 'astrophysique', 'technologie', 'electronique',
        'numerique', 'ingenierie', 'mineraux', 'roches', 'geologie', 'meteorites',
        'intelligence artificielle', 'algorithme', 'algorithmes', 'informaticien',
        'electricite', 'ondelettes', 'traitement du signal', 'automate', 'automates',
        'programmation', 'assembleur', 'compilateur', 'reseaux de neurones',
        'algorithme genetique', 'programmation genetique',
      ],
      en: [
        'computer', 'computing', 'software', 'hardware', 'physics', 'chemistry',
        'mathematics', 'mathematical', 'astronomy', 'astrophysics', 'technology',
        'electronics', 'engineering', 'geology', 'artificial intelligence',
        'algorithm', 'algorithms', 'neural network', 'neural networks',
        'genetic programming', 'genetic algorithm', 'machine learning',
        'signal processing', 'wavelet', 'wavelets', 'probability', 'statistics',
        'quantum', 'semiconductor', 'datasheet', 'circuit', 'circuits',
      ],
      '*': ['robot', 'robots', 'internet', 'z80', 'fpga', 'vhdl', 'basic', 'unix', 'opengl'],
    },
  },
  {
    value: 'romans-nouvelles',
    labels: { fr: 'Romans et nouvelles', en: 'Novels & Short Stories' },
    // Dernier de la liste, et c'est ce qui rend ses mots-clés utilisables. Placé
    // plus haut, « roman » attrapait « art roman » et « gallo romain », et
    // « novel » attrapait tous les « a novel algorithm for… » d'un corpus
    // d'articles scientifiques. En fourre-tout de fin de liste, il ne se
    // déclenche que si aucun genre plus spécifique n'a reconnu le titre — donc
    // « Roman classique » garde ses classiques, et les romans quelconques
    // tombent ici.
    keywords: {
      fr: [
        'roman', 'romans', 'nouvelle', 'nouvelles', 'recit', 'recits', 'novella',
        'recueil de nouvelles', 'nouvelles choisies', 'fiction', 'saga',
      ],
      en: [
        'novel', 'novels', 'novella', 'short stories', 'short story',
        'collected stories', 'complete stories', 'selected stories', 'fiction',
        'saga', 'tales',
      ],
      '*': [],
    },
  },
];

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalize(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ');
}

// Toutes les langues sont fondues dans un seul jeu d'aiguilles : c'est ce qui
// rend la classification indépendante de la langue d'affichage.
function compileRules(genres) {
  return genres.map((genre) => {
    const needles = [];
    for (const list of Object.values(genre.keywords || {})) {
      for (const keyword of list || []) {
        const needle = normalize(keyword);
        if (needle) needles.push(needle);
      }
    }
    return { genre: genre.value, needles };
  });
}

function matchGenre(rules, entry) {
  const haystack = ` ${normalize(entry.title)} ${normalize((entry.authors || []).join(' '))} `
    .replace(/ +/g, ' ');
  for (const rule of rules) {
    for (const needle of rule.needles) {
      if (haystack.includes(needle)) return rule.genre;
    }
  }
  return null;
}

// Les langues que l'interface sait proposer, dans l'ordre de repli : un libellé
// manquant en anglais retombe sur le français plutôt que d'afficher le slug.
const LANGS = ['fr', 'en'];

function resolveLabel(labels, lang) {
  if (!labels) return null;
  const chain = [lang, ...LANGS].filter(Boolean);
  for (const candidate of chain) {
    if (labels[candidate]) return labels[candidate];
  }
  const first = Object.values(labels).find(Boolean);
  return first || null;
}

module.exports = {
  SEED_GENRES, LANGS, normalize, compileRules, matchGenre, resolveLabel,
};
