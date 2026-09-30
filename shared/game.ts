export type HintKey =
  | 'year'
  | 'genre'
  | 'popularity'
  | 'country'
  | 'artistInitial'
  | 'titlePattern'
  | 'album';

/** Each level lets you hear more of the song but pays less. */
export const LEVELS = [
  { seconds: 0.3, points: 1000 },
  { seconds: 1, points: 700 },
  { seconds: 5, points: 400 },
  { seconds: 15, points: 200 },
] as const;

export const LAST_LEVEL = LEVELS.length - 1;
export const EXTRA_HINT_COST = 100;
export const FIRST_CORRECT_BONUS = 150;

/** Hints that come "for free" when you ask for more time (the level itself already costs points). */
const LEVEL_HINTS: HintKey[] = ['year', 'genre', 'popularity'];

/** Hints you can buy at any moment. */
export const EXTRA_HINTS: { key: HintKey; label: string }[] = [
  { key: 'country', label: 'País del artista' },
  { key: 'artistInitial', label: 'Inicial del artista' },
  { key: 'titlePattern', label: 'Forma del título' },
  { key: 'album', label: 'Álbum' },
];

export function hintsUnlockedAt(level: number): HintKey[] {
  return LEVEL_HINTS.slice(0, Math.max(0, Math.min(level, LEVEL_HINTS.length)));
}

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Difficulty = how well known the songs are (by popularity within the chosen filters). */
export const DIFFICULTIES: Record<Difficulty, { label: string; description: string; multiplier: number }> = {
  easy: { label: 'Fácil', description: 'Los hits que conoce todo el mundo', multiplier: 1 },
  medium: { label: 'Medio', description: 'Conocidas, pero no las más gastadas', multiplier: 1.25 },
  hard: { label: 'Difícil', description: 'Temas menos conocidos, para expertos', multiplier: 1.5 },
};

export function roundPoints(input: {
  level: number;
  extraHints: number;
  first?: boolean;
  difficulty?: Difficulty;
}): number {
  const base = LEVELS[Math.min(input.level, LAST_LEVEL)].points;
  const earned = Math.max(0, base - input.extraHints * EXTRA_HINT_COST);
  const multiplier = DIFFICULTIES[input.difficulty ?? 'easy'].multiplier;
  return Math.round(earned * multiplier) + (input.first ? FIRST_CORRECT_BONUS : 0);
}
