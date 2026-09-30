import type { Difficulty, HintKey } from '../shared/game';
import { cleanTitle, normalize, titlePattern } from '../shared/match';
import { themeById } from '../shared/themes';
import type { Settings } from '../shared/types';
import type { Song, SongSource } from './room';
import { artistCountry, dz, dzList, musicBrainzInfo, youtubeViews, type DzTrack } from './sources';

const MAX_DECADES = 4;
const RELEVANT_PLAYLISTS = 5;
const MAX_SCAN = 120;
const BATCH = 8;
/** MusicBrainz allows ~1 request/s: two checks fit comfortably inside a round. */
const BACKGROUND_CONFIRMS = 2;
const JUNK =
  /karaoke|tribute|made famous|originally performed|in the style of|backing track|8-bit|lullaby|cover version/i;

// ------------------------------------------------------------ pure helpers

function decades(settings: Settings): string[] {
  if (settings.yearFrom === null && settings.yearTo === null) return [];
  const from = Math.floor((settings.yearFrom ?? 1950) / 10) * 10;
  const to = Math.floor((settings.yearTo ?? new Date().getFullYear()) / 10) * 10;
  const all: number[] = [];
  for (let d = from; d <= to; d += 10) all.push(d);
  const picked =
    all.length <= MAX_DECADES
      ? all
      : Array.from({ length: MAX_DECADES }, (_, i) => all[Math.round((i * (all.length - 1)) / (MAX_DECADES - 1))]);
  return picked.map((d) => (d < 2000 ? `${d % 100}s` : `${d}s`));
}

/** Playlist search terms for the chosen filters. Deezer has no year/country filter, so we lean on playlists. */
/** With a theme, its curated searches replace the manual genre/country/year filters. */
export function effectiveSettings(settings: Settings): Settings {
  const theme = themeById(settings.theme);
  if (!theme) return settings;
  return { ...settings, genre: '', country: '', yearFrom: theme.yearFrom ?? null, yearTo: theme.yearTo ?? null };
}

const SOUND_ALIKE = /\bhits\b|all ?stars|tribute|karaoke|\bcovers?\b|^the (sixties|seventies|eighties|nineties)$/i;

/** Compilation "artists" that record covers of famous songs ("70s Rock Hits", "The Seventies"). */
export function isSoundAlike(artist: string): boolean {
  return SOUND_ALIKE.test(artist.trim());
}

/** Karaoke, tributes, covers: never served. */
export function isJunk(t: DzTrack): boolean {
  return JUNK.test(`${t.title} ${t.artist.name} ${t.album.title}`) || isSoundAlike(t.artist.name);
}

export function searchQueries(settings: Settings): string[] {
  const theme = themeById(settings.theme);
  if (theme) return theme.queries;
  const base = [settings.genre, settings.country].filter(Boolean).join(' ');
  const ds = decades(settings);
  if (!base && ds.length === 0) return ['exitos', 'greatest hits', 'top hits'];
  if (ds.length === 0) return [base];
  return ds.map((d) => `${base || 'exitos'} ${d}`);
}

/**
 * A Deezer release year is always >= the song's original year (compilations, remasters).
 * So "before the range" is a safe reject, but "after the range" needs the original year.
 */
export function yearVerdict(releaseYear: number | null, settings: Settings): 'accept' | 'reject' | 'check' {
  const { yearFrom, yearTo } = settings;
  if (yearFrom === null && yearTo === null) return 'accept';
  if (releaseYear === null) return 'check';
  if (yearFrom !== null && releaseYear < yearFrom) return 'reject';
  if (yearTo !== null && releaseYear > yearTo) return 'check';
  return 'accept';
}

export const inRange = (year: number, s: Settings) =>
  (s.yearFrom === null || year >= s.yearFrom) && (s.yearTo === null || year <= s.yearTo);

/**
 * Orders candidates for a difficulty. Popularity is relative to this search (niche filters have
 * low absolute ranks), and a song is rated by its most popular version so a classic that also
 * appears on a compilation doesn't end up in "hard". The target third comes first, shuffled;
 * the rest follows as a fallback, closest tier first, so strict filters don't end the game early.
 */
export function orderByDifficulty(tracks: DzTrack[], difficulty: Difficulty): DzTrack[] {
  const { sorted, cuts } = rankTiers(tracks);
  const tier = { easy: 0, medium: 1, hard: 2 }[difficulty];
  const [lo, hi] = [cuts[tier], cuts[tier + 1]];
  const distance = (i: number) => (i < lo ? lo - i : i - hi + 1);
  const rest = sorted
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i < lo || i >= hi)
    .sort((a, b) => distance(a.i) - distance(b.i) || a.i - b.i)
    .map(({ t }) => t);
  return [...shuffle(sorted.slice(lo, hi)), ...rest];
}

/** One version per song (the most popular), sorted by popularity and cut into thirds. */
export function rankTiers(tracks: DzTrack[]): { sorted: DzTrack[]; cuts: number[] } {
  const best = new Map<string, DzTrack>();
  for (const t of tracks) {
    const current = best.get(songKey(t));
    if (!current || t.rank > current.rank) best.set(songKey(t), t);
  }
  const sorted = [...best.values()].sort((a, b) => b.rank - a.rank);
  const n = sorted.length;
  return { sorted, cuts: [0, Math.round(n / 3), Math.round((2 * n) / 3), n] };
}

const MIN_CORE_SONGS = 20;
export const songKey = (t: DzTrack) => `${normalize(cleanTitle(t.title))}|${normalize(t.artist.name)}`;

/**
 * Playlists are made by random people, so one of them calling "Rabiosa" old-school reggaeton
 * shouldn't be enough. A song must be in several of the fetched playlists to be served; the
 * agreement needed scales with how many playlists we have and relaxes if too few songs pass.
 * Single-vote songs are kept at the end, as a fallback. Pass the playlists unfiltered: a vote
 * means "this song belongs here", even when that particular copy is not playable.
 */
export function byConsensus(playlists: DzTrack[][], difficulty: Difficulty): DzTrack[] {
  const { core, reserve } = consensus(playlists);
  return [...orderByDifficulty(core, difficulty), ...orderByDifficulty(reserve, 'easy')];
}

export type Consensus = { votes: Map<string, number>; needed: number; core: DzTrack[]; reserve: DzTrack[] };

export function consensus(playlists: DzTrack[][]): Consensus {
  const votes = new Map<string, number>();
  for (const list of playlists) {
    for (const key of new Set(list.map(songKey))) votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  // Votes count every copy (many are region-locked), but only playable copies can be served.
  const all = playlists.flat().filter((t) => t.readable && t.preview);
  let needed = playlists.length <= 1 ? 1 : Math.max(2, Math.ceil(playlists.length * 0.15));
  const agreed = (n: number) => all.filter((t) => (votes.get(songKey(t)) ?? 0) >= n);
  while (needed > 1 && new Set(agreed(needed).map(songKey)).size < MIN_CORE_SONGS) needed--;

  const core = agreed(needed);
  const reserve = all.filter((t) => (votes.get(songKey(t)) ?? 0) < needed);
  return { votes, needed, core, reserve };
}

const yearOf = (date?: string) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------ Deezer source

type PlaylistHit = { id: number; title: string; nb_tracks: number };

/**
 * The playlists a game (or the catalog report) draws from: the most relevant hits of each search,
 * each playlist once. Lists come unfiltered, since unplayable copies still count as votes.
 */
export async function fetchPlaylists(
  settings: Settings,
): Promise<{ playlists: { id: number; title: string }[]; lists: DzTrack[][] }> {
  const queries = searchQueries(settings);
  const hits = await Promise.all(
    queries.map((q) =>
      dzList<PlaylistHit>(`/search/playlist?q=${encodeURIComponent(q)}&limit=15`).catch(() => [] as PlaylistHit[]),
    ),
  );
  // Only the most relevant hits: further down, searches drift (Brazilian or Mexican rock, etc).
  // The same playlist often shows up for several queries: it must vote only once.
  const unique = new Map<number, PlaylistHit>();
  for (const ps of hits)
    for (const p of ps.filter((p) => p.nb_tracks >= 10).slice(0, RELEVANT_PLAYLISTS)) unique.set(p.id, p);
  const chosen = [...unique.values()];
  const lists = await Promise.all(
    chosen.map((p) => dzList<DzTrack>(`/playlist/${p.id}/tracks?limit=100`).catch(() => [] as DzTrack[])),
  );
  const usable = chosen
    .map((p, i) => ({ p, list: lists[i] }))
    .filter(({ list }) => list.some((t) => t.readable && t.preview));
  if (usable.length > 0) {
    return { playlists: usable.map(({ p }) => ({ id: p.id, title: p.title })), lists: usable.map(({ list }) => list) };
  }
  // No usable playlists: fall back to a plain track search.
  const found = await Promise.all(
    queries.map((q) => dzList<DzTrack>(`/search?q=${encodeURIComponent(q)}&limit=50`).catch(() => [] as DzTrack[])),
  );
  return { playlists: [], lists: [found.flat().filter((t) => t.readable && t.preview)] };
}

export class DeezerSource implements SongSource {
  private candidates: Promise<DzTrack[]> | null = null;
  private seen = new Set<string>();
  private scanned = 0;
  private prefetched: Promise<Song | null> | null = null;
  private ready: Song[] = [];
  private toConfirm: DzTrack[] = [];

  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = effectiveSettings(settings);
  }

  /** Returns the next song and immediately starts looking for the one after, so rounds start fast. */
  next(): Promise<Song | null> {
    const current = this.prefetched ?? this.findNext();
    this.prefetched = current.then((song) => (song ? this.findNext() : null));
    return current;
  }

  async preview(song: Song): Promise<string> {
    const fresh = await dz<DzTrack>(`/track/${song.id}`);
    return fresh.preview;
  }

  async hint(song: Song, key: HintKey): Promise<{ label: string; value: string }> {
    switch (key) {
      case 'year': {
        const info = await musicBrainzInfo(song.isrc, song.title, song.artist);
        if (info.year && (!song.year || info.year < song.year)) song.year = info.year;
        return { label: 'Año', value: song.year ? String(song.year) : 'Desconocido' };
      }
      case 'genre': {
        const album = await dz<{ genres?: { data: { name: string }[] } }>(`/album/${song.albumId}`);
        const names = album.genres?.data.map((g) => g.name) ?? [];
        return { label: 'Género', value: names.length ? names.join(' / ') : 'Sin datos' };
      }
      case 'popularity': {
        const views = await youtubeViews(song.title, song.artist).catch(() => null);
        if (views !== null) {
          return {
            label: 'Visitas en YouTube',
            value: new Intl.NumberFormat('es-AR', { notation: 'compact' }).format(views),
          };
        }
        const stars = Math.min(5, Math.max(1, Math.ceil(song.rank / 200_000)));
        return { label: 'Popularidad', value: '★'.repeat(stars) + '☆'.repeat(5 - stars) };
      }
      case 'country': {
        const info = await musicBrainzInfo(song.isrc, song.title, song.artist);
        const country = await artistCountry(info.artistMbid, song.artist);
        return { label: 'País del artista', value: country ?? 'Desconocido' };
      }
      case 'artistInitial': {
        const words = song.artist.trim().split(/\s+/).length;
        return {
          label: 'Artista',
          value: `Empieza con "${song.artist.trim()[0]?.toUpperCase()}" · ${words} palabra${words > 1 ? 's' : ''}`,
        };
      }
      case 'titlePattern':
        return { label: 'Título', value: titlePattern(song.title) };
      case 'album':
        return {
          label: 'Álbum',
          value:
            normalize(cleanTitle(song.album)) === normalize(cleanTitle(song.title))
              ? 'Es un single (se llama igual que la canción)'
              : song.album,
        };
    }
  }

  /**
   * Fast path first: inspect Deezer tracks in parallel batches and take one whose release year
   * already fits. Tracks that might be compilations wait in `toConfirm` for the slow
   * (1 req/s) MusicBrainz check, which only runs when a batch yields nothing.
   */
  private async findNext(): Promise<Song | null> {
    // This usually runs as the prefetch, while a round is being played: confirm a couple of late
    // releases then (re-released classics like Gasolina) and shuffle them in, at no visible cost.
    if (this.ready.length && this.toConfirm.length) await this.mixInConfirmed(BACKGROUND_CONFIRMS);
    if (this.ready.length) return this.ready.shift()!;
    const candidates = await this.loadCandidates();
    while (candidates.length && this.scanned < MAX_SCAN) {
      const batch = candidates.splice(0, BATCH);
      this.scanned += batch.length;
      const inspected = await Promise.all(batch.map((c) => this.inspect(c).catch(() => null)));
      for (const r of inspected) {
        if (r?.verdict === 'accept') this.ready.push(toSong(r.track, releaseYear(r.track)));
        else if (r?.verdict === 'check') this.toConfirm.push(r.track);
      }
      if (this.ready.length) return this.ready.shift()!;
      const confirmed = await this.confirmSome(2);
      if (confirmed) return confirmed;
    }
    return this.confirmSome(Infinity);
  }

  private async mixInConfirmed(max: number) {
    for (let i = 0; i < max && this.toConfirm.length; i++) {
      const song = await this.confirm(this.toConfirm.shift()!).catch(() => null);
      if (song) this.ready.splice(Math.floor(Math.random() * (this.ready.length + 1)), 0, song);
    }
  }

  private async confirmSome(max: number): Promise<Song | null> {
    for (let i = 0; i < max && this.toConfirm.length; i++) {
      const song = await this.confirm(this.toConfirm.shift()!).catch(() => null);
      if (song) return song;
    }
    return null;
  }

  private loadCandidates(): Promise<DzTrack[]> {
    this.candidates ??= fetchPlaylists(this.settings).then(({ lists }) => byConsensus(lists, this.settings.difficulty));
    return this.candidates;
  }

  /** Fetches full track data and classifies it by year, without touching MusicBrainz. */
  private async inspect(c: DzTrack): Promise<{ track: DzTrack; verdict: 'accept' | 'check' } | null> {
    const key = songKey(c);
    if (this.seen.has(key) || isJunk(c)) return null;
    this.seen.add(key);

    const t = await dz<DzTrack>(`/track/${c.id}`);
    if (!t.readable || !t.preview) return null;
    const verdict = yearVerdict(releaseYear(t), this.settings);
    return verdict === 'reject' ? null : { track: t, verdict };
  }

  /** Slow path: ask MusicBrainz for the original year of a probable compilation track. */
  private async confirm(t: DzTrack): Promise<Song | null> {
    const info = await musicBrainzInfo(t.isrc, t.title, t.artist.name);
    return info.year && inRange(info.year, this.settings) ? toSong(t, info.year) : null;
  }
}

export const releaseYear = (t: DzTrack) => yearOf(t.release_date) ?? yearOf(t.album.release_date);

function toSong(t: DzTrack, year: number | null): Song {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist.name,
    album: t.album.title,
    cover: t.album.cover_medium ?? '',
    link: t.link,
    isrc: t.isrc ?? '',
    year,
    rank: t.rank,
    albumId: t.album.id,
  };
}
