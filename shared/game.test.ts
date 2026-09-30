import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  type Difficulty,
  EXTRA_HINT_COST,
  FIRST_CORRECT_BONUS,
  LEVELS,
  hintsUnlockedAt,
  roundPoints,
} from './game';

describe('roundPoints', () => {
  it('pays the full level value when guessed at the first level with no hints', () => {
    expect(roundPoints({ level: 0, extraHints: 0 })).toBe(LEVELS[0].points);
  });

  it('pays less the more listening time was used', () => {
    const points = LEVELS.map((_, level) => roundPoints({ level, extraHints: 0 }));
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeLessThan(points[i - 1]);
  });

  it('subtracts the cost of every extra hint', () => {
    expect(roundPoints({ level: 1, extraHints: 2 })).toBe(LEVELS[1].points - 2 * EXTRA_HINT_COST);
  });

  it('never goes below zero', () => {
    expect(roundPoints({ level: 3, extraHints: 50 })).toBe(0);
  });

  it('adds the first-correct bonus on top', () => {
    expect(roundPoints({ level: 0, extraHints: 0, first: true })).toBe(
      LEVELS[0].points + FIRST_CORRECT_BONUS,
    );
  });

  it('multiplies the earned points by the difficulty, but not the bonus', () => {
    expect(roundPoints({ level: 1, extraHints: 1, difficulty: 'hard' })).toBe(
      (LEVELS[1].points - EXTRA_HINT_COST) * DIFFICULTIES.hard.multiplier,
    );
    expect(roundPoints({ level: 0, extraHints: 0, first: true, difficulty: 'medium' })).toBe(
      LEVELS[0].points * DIFFICULTIES.medium.multiplier + FIRST_CORRECT_BONUS,
    );
  });

  it('rewards harder difficulties more', () => {
    const at = (difficulty: Difficulty) => roundPoints({ level: 0, extraHints: 0, difficulty });
    expect(at('easy')).toBeLessThan(at('medium'));
    expect(at('medium')).toBeLessThan(at('hard'));
  });
});

describe('hintsUnlockedAt', () => {
  it('reveals nothing at the first level', () => {
    expect(hintsUnlockedAt(0)).toEqual([]);
  });

  it('reveals year, then genre, then popularity as levels go up', () => {
    expect(hintsUnlockedAt(1)).toEqual(['year']);
    expect(hintsUnlockedAt(2)).toEqual(['year', 'genre']);
    expect(hintsUnlockedAt(3)).toEqual(['year', 'genre', 'popularity']);
  });
});
