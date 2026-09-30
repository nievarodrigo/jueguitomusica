/**
 * One-tap presets. A theme is NOT genre + country + years: "cumbia cheta" can't be expressed
 * with those filters. Each theme carries its own Deezer playlist searches, checked by hand
 * against real results (e.g. "rock nacional" alone returns Brazilian rock, "cuarteto" returns
 * El Cuarteto de Nos).
 */
export type Theme = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  queries: string[];
  /** Late Deezer release dates (re-releases, remasters) are checked against the original year. */
  yearFrom?: number;
  yearTo?: number;
};

export const THEMES: Theme[] = [
  {
    id: 'reggaeton-viejo',
    label: 'Reggaetón viejo',
    emoji: '🔥',
    description: 'Gasolina, perreo old school',
    queries: ['reggaeton viejo', 'perreo viejo', 'reggaeton old school', 'reggaeton 2000s'],
    yearTo: 2012,
  },
  {
    id: 'rock-nacional',
    label: 'Rock nacional',
    emoji: '🎸',
    description: 'Soda, Charly, los Redondos',
    queries: ['rock nacional argentino', 'rock argentino clasicos', 'rock argentino 80 90'],
  },
  {
    id: 'rock-internacional',
    label: 'Rock internacional',
    emoji: '🤘',
    description: 'Rock en inglés de los 90 y 2000',
    queries: ['rock en ingles 90 2000', '90s rock', '2000s rock'],
  },
  {
    id: 'rock-clasico',
    label: 'Rock clásico',
    emoji: '🌼',
    description: 'Creedence, Zeppelin, los 60 y 70',
    queries: ['70s rock anthems', '60s rock'],
  },
  {
    id: 'pop-2000',
    label: 'Pop 2000',
    emoji: '💿',
    description: 'Britney, Shakira, Black Eyed Peas',
    queries: ['pop hits 2000s', '00s pop', '00s hits'],
  },
  {
    id: 'ochentas',
    label: 'Los 80',
    emoji: '📼',
    description: 'Hits ochentosos',
    queries: ['80s hits', '80s pop', 'exitos de los 80 en ingles'],
  },
  {
    id: 'cumbia-villera',
    label: 'Cumbia villera',
    emoji: '🍻',
    description: 'Damas Gratis, Pibes Chorros',
    queries: ['cumbia villera', 'cumbia villera 2000'],
  },
  {
    id: 'cumbia-cheta',
    label: 'Cumbia cheta',
    emoji: '🏝️',
    description: 'Marama, Rombai, Agapornis',
    queries: ['cumbias chetas', 'cumbia cheta', 'cumbia pop uruguaya'],
  },
  {
    id: 'trap-argentino',
    label: 'Trap argentino',
    emoji: '🎤',
    description: 'Duki, Paulo, Khea',
    queries: ['trap argentino'],
  },
  {
    id: 'cuarteto',
    label: 'Cuarteto',
    emoji: '💃',
    description: 'La Mona, Ulises, Q’ Lokura',
    queries: ['cuarteto cordobes'],
  },
  {
    id: 'baladas',
    label: 'Baladas en español',
    emoji: '💘',
    description: 'Para cantar abrazado',
    queries: ['baladas en español', 'baladas romanticas en español'],
  },
];

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}
