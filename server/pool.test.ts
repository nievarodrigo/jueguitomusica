import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';
import { themeById } from '../shared/themes';
import { byConsensus, effectiveSettings, isSoundAlike, orderByDifficulty, searchQueries, yearVerdict } from './pool';
import type { DzTrack } from './sources';

const s = (patch: Partial<typeof DEFAULT_SETTINGS>) => ({ ...DEFAULT_SETTINGS, ...patch });

describe('searchQueries', () => {
  it('falls back to generic hits when there are no filters', () => {
    expect(searchQueries(s({}))).toEqual(['exitos', 'greatest hits', 'top hits']);
  });

  it('combines genre and country', () => {
    expect(searchQueries(s({ genre: 'rock', country: 'argentina' }))).toEqual(['rock argentina']);
  });

  it('adds one query per decade in the year range', () => {
    expect(searchQueries(s({ genre: 'rock', yearFrom: 1985, yearTo: 1999 }))).toEqual([
      'rock 80s',
      'rock 90s',
    ]);
  });

  it('uses the full year for 2000s and later decades', () => {
    expect(searchQueries(s({ yearFrom: 2010, yearTo: 2012 }))).toEqual(['exitos 2010s']);
  });

  it('caps the number of decades to keep requests bounded', () => {
    expect(searchQueries(s({ yearFrom: 1950, yearTo: 2025 })).length).toBeLessThanOrEqual(4);
  });
});

describe('themes', () => {
  it('search with the theme queries instead of the manual filters', () => {
    const settings = s({ theme: 'rock-nacional', genre: 'pop', yearFrom: 1990, yearTo: 1999 });
    expect(searchQueries(settings)).toEqual(themeById('rock-nacional')!.queries);
  });

  it('ignore manual year filters so no song is rejected by year', () => {
    const settings = effectiveSettings(s({ theme: 'ochentas', yearFrom: 2010, yearTo: 2012 }));
    expect(yearVerdict(1985, settings)).toBe('accept');
  });

  it('apply their own year range, checking the original year of late releases', () => {
    // Real case: Deezer dates Daddy Yankee's "Gasolina" (2004) as 2025 because of a catalog re-release.
    const settings = effectiveSettings(s({ theme: 'reggaeton-viejo' }));
    expect(settings.yearTo).toBe(2012);
    expect(yearVerdict(2005, settings)).toBe('accept');
    expect(yearVerdict(2025, settings)).toBe('check');
  });

  it('keep manual filters when no theme is chosen', () => {
    const settings = effectiveSettings(s({ genre: 'rock', yearFrom: 1980, yearTo: 1989 }));
    expect(settings.genre).toBe('rock');
    expect(yearVerdict(1975, settings)).toBe('reject');
  });
});

describe('byConsensus', () => {
  const t = (id: number, title: string, rank = 500_000): DzTrack => ({
    id,
    readable: true,
    title,
    link: '',
    rank,
    preview: 'x',
    artist: { id: 1, name: title === 'Rabiosa' ? 'Shakira' : 'Daddy Yankee' },
    album: { id, title: 'Album' },
  });
  const classics = Array.from({ length: 25 }, (_, i) => t(i + 1, `Clasico ${i + 1}`));
  const ids = (list: DzTrack[]) => list.map((x) => x.id);

  it('serves songs many playlists agree on before a song only one playlist has', () => {
    const lists = [
      [...classics, t(99, 'Rabiosa', 999_999)],
      ...Array.from({ length: 4 }, () => [...classics]),
    ];
    const order = ids(byConsensus(lists, 'easy'));
    expect(order.indexOf(99)).toBe(order.length - 1);
    expect(order).toHaveLength(26);
  });

  it('counts a playlist once even if it lists the same song twice', () => {
    const lists = [[...classics, t(98, 'Gasolina'), t(99, 'Gasolina')], classics, classics];
    const order = ids(byConsensus(lists, 'easy'));
    expect(order[order.length - 1]).toBeGreaterThanOrEqual(98);
  });

  it('counts votes from unplayable copies too, but only serves a playable one', () => {
    // Real case: Gasolina is in 14 playlists, but 12 of those copies are region-locked (readable:false).
    // The locked copies are the most popular ones: a naive "best version" pick would choose them.
    const locked = (id: number) => ({ ...t(id, 'Gasolina', 990_000), readable: false, preview: '' });
    const lists = [
      [...classics, t(50, 'Gasolina', 900_000)],
      [...classics, t(51, 'Gasolina', 900_000)],
      ...Array.from({ length: 12 }, (_, i) => [...classics, locked(60 + i)]),
      [...classics, t(99, 'Rabiosa')],
    ];
    const order = byConsensus(lists, 'easy');
    expect(order.every((x) => x.readable && x.preview)).toBe(true);
    const ids = order.map((x) => x.id);
    expect(ids.some((id) => id === 50 || id === 51)).toBe(true);
    expect(ids.indexOf(99)).toBe(ids.length - 1);
  });

  it('with a single playlist, uses it whole', () => {
    expect(byConsensus([classics], 'easy')).toHaveLength(25);
  });

  it('relaxes the agreement needed when too few songs would be left to play', () => {
    // Only 3 songs appear in 2+ playlists: not enough for a game, so single-vote songs join the tiers too.
    // A, B, C are the least popular: if they weren't mixed into the tiers they'd be served first on easy.
    const [a, b, c] = [t(101, 'A', 1_000), t(102, 'B', 1_000), t(103, 'C', 1_000)];
    const lists = [
      [a, b, c, ...classics.slice(0, 10)],
      [a, b, c, ...classics.slice(10, 20)],
    ];
    const order = ids(byConsensus(lists, 'easy'));
    expect(order).toHaveLength(23);
    expect(order.slice(0, 3)).not.toContain(101);
    expect(order.slice(-3).sort()).toEqual([101, 102, 103]);
  });
});

describe('isSoundAlike', () => {
  it('flags compilation "artists" that record covers', () => {
    for (const name of ['70s Rock Hits', 'Rock Classic Hits AllStars', 'The Seventies', 'Queen Tribute Band', 'Karaoke Hits'])
      expect(isSoundAlike(name)).toBe(true);
  });

  it('keeps real artists, even with suspicious words in the name', () => {
    for (const name of ['Electric Light Orchestra', 'Creedence Clearwater Revival', 'Hitsville', 'The Cure'])
      expect(isSoundAlike(name)).toBe(false);
  });
});

describe('orderByDifficulty', () => {
  const t = (id: number, title: string, rank: number, artist = 'Artista'): DzTrack => ({
    id,
    readable: true,
    title,
    link: '',
    rank,
    preview: 'x',
    artist: { id: 1, name: artist },
    album: { id: id, title: 'Album' },
  });
  // 9 distinct songs, ranks 900k..100k
  const songs = Array.from({ length: 9 }, (_, i) => t(i + 1, `Tema ${i + 1}`, (9 - i) * 100_000));
  const ids = (list: DzTrack[]) => list.map((x) => x.id);

  it('serves the most popular third first on easy', () => {
    expect(ids(orderByDifficulty(songs, 'easy').slice(0, 3)).sort()).toEqual([1, 2, 3]);
  });

  it('serves the middle third first on medium', () => {
    expect(ids(orderByDifficulty(songs, 'medium').slice(0, 3)).sort()).toEqual([4, 5, 6]);
  });

  it('serves the least popular third first on hard', () => {
    expect(ids(orderByDifficulty(songs, 'hard').slice(0, 3)).sort()).toEqual([7, 8, 9]);
  });

  it('keeps the other songs as a fallback, closest tier first', () => {
    const order = ids(orderByDifficulty(songs, 'easy'));
    expect(order).toHaveLength(9);
    expect(order.slice(3)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('rates a song by its most popular version and plays that version', () => {
    const withCompilation = [...songs, t(99, 'Tema 1 (Remastered)', 1_000)];
    const order = orderByDifficulty(withCompilation, 'hard');
    expect(ids(order)).not.toContain(99);
    expect(ids(order.slice(0, 3)).sort()).toEqual([7, 8, 9]);
  });
});

describe('yearVerdict', () => {
  const range = s({ yearFrom: 1980, yearTo: 1989 });

  it('accepts anything without a range', () => {
    expect(yearVerdict(2020, s({}))).toBe('accept');
  });

  it('accepts a release inside the range', () => {
    expect(yearVerdict(1986, range)).toBe('accept');
  });

  it('rejects a release before the range (the original cannot be later than a release)', () => {
    expect(yearVerdict(1975, range)).toBe('reject');
  });

  it('asks to check the original year when the release is after the range (could be a compilation)', () => {
    expect(yearVerdict(2016, range)).toBe('check');
  });
});
