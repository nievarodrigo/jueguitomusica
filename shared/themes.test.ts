import { describe, expect, it } from 'vitest';
import { THEMES, themeById } from './themes';

describe('THEMES', () => {
  it('have unique ids and at least one search query each', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const t of THEMES) expect(t.queries.length).toBeGreaterThan(0);
  });

  it('never search the ambiguous "rock nacional" alone (Deezer returns Brazilian rock)', () => {
    for (const t of THEMES) expect(t.queries).not.toContain('rock nacional');
  });

  it('finds a theme by id and ignores unknown ids', () => {
    expect(themeById('cumbia-cheta')?.label).toBe('Cumbia cheta');
    expect(themeById('nope')).toBeUndefined();
    expect(themeById('')).toBeUndefined();
  });
});
