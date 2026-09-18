/**
 * List Categories with Icons and Colors
 * Für Übersichtlichkeit bei mehreren Listen
 */

export const LIST_CATEGORIES = {
  groceries: {
    name: 'Lebensmittel',
    icon: '🛒',
    color: '#10b981', // emerald
    emoji: '🥕🍎🥛',
    description: 'Obst, Gemüse, Milchprodukte, etc.'
  },
  drugstore: {
    name: 'Drogerie & Kosmetik',
    icon: '💅',
    color: '#ec4899', // pink
    emoji: '🧴🧼💄',
    description: 'Zahnpasta, Shampoo, Körperpflege'
  },
  hardware: {
    name: 'Baumarkt',
    icon: '🔨',
    color: '#f59e0b', // amber
    emoji: '🔧⚒️🪛',
    description: 'Werkzeuge, Nägel, Farbe'
  },
  household: {
    name: 'Haushalt',
    icon: '🏠',
    color: '#3b82f6', // blue
    emoji: '🧻🧽🧴',
    description: 'Putzmittel, Wäsche, Zubehör'
  },
  pets: {
    name: 'Haustiere',
    icon: '🐾',
    color: '#8b5cf6', // purple
    emoji: '🐕🐈🦴',
    description: 'Tierfutter, Zubehör, Medikamente'
  },
  clothing: {
    name: 'Kleidung & Schuhe',
    icon: '👕',
    color: '#06b6d4', // cyan
    emoji: '👔👗👟',
    description: 'Klamotten, Schuhe, Accessoires'
  },
  office: {
    name: 'Büro & Papier',
    icon: '📝',
    color: '#6366f1', // indigo
    emoji: '✏️📎📕',
    description: 'Stifte, Papier, Büromaterial'
  },
  toys: {
    name: 'Spielzeug',
    icon: '🎮',
    color: '#f97316', // orange
    emoji: '🧸🎲🚂',
    description: 'Spielzeug, Spiele, Aktivitäten'
  },
  books: {
    name: 'Bücher & Medien',
    icon: '📚',
    color: '#64748b', // slate
    emoji: '📖📕📗',
    description: 'Bücher, DVDs, Musik'
  },
  sports: {
    name: 'Sport & Fitness',
    icon: '⚽',
    color: '#ef4444', // red
    emoji: '🏃‍♂️🚴🏋️',
    description: 'Sportausrüstung, Fitness, Outdoor'
  },
  automotive: {
    name: 'Auto & Motorrad',
    icon: '🚗',
    color: '#14b8a6', // teal
    emoji: '🚙⛽🔧',
    description: 'Autobedarf, Ersatzteile, Reinigung'
  },
  kitchen: {
    name: 'Küche & Kochen',
    icon: '🍳',
    color: '#dc2626', // rose
    emoji: '🍴🥄🍽️',
    description: 'Küchengeräte, Geschirr, Zubehör'
  },
  other: {
    name: 'Sonstiges',
    icon: '📌',
    color: '#78716c', // stone
    emoji: '❓',
    description: 'Andere Kategorien'
  }
};

/**
 * Get category by key
 */
export function getCategory(key) {
  return LIST_CATEGORIES[key] || LIST_CATEGORIES.other;
}

/**
 * Get all categories for dropdown
 */
export function getAllCategories() {
  return Object.entries(LIST_CATEGORIES).map(([key, value]) => ({
    key,
    ...value
  }));
}

export default {
  LIST_CATEGORIES,
  getCategory,
  getAllCategories
};
