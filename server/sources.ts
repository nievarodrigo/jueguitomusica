/** Thin clients for the external music APIs. No game logic lives here. */
import { normalize } from '../shared/match';

/** MusicBrainz asks for an identifying User-Agent; set MB_CONTACT to your email or URL. */
const UA = `jueguitomusica/0.1 (${process.env.MB_CONTACT ?? 'dev'})`;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

// ------------------------------------------------------------------ Deezer

export type DzTrack = {
  id: number;
  readable: boolean;
  title: string;
  link: string;
  rank: number;
  preview: string;
  isrc?: string;
  release_date?: string;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_small?: string; cover_medium?: string; release_date?: string };
};

type DzList<T> = { data?: T[]; error?: { message: string } };

/** Deezer allows ~50 requests per 5 seconds and answers with error code 4 past that. */
export class QuotaError extends Error {
  constructor() {
    super('Deezer: Quota limit exceeded');
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withQuotaRetry<T>(
  fn: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
  attempts = 5,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof QuotaError) || i >= attempts) throw err;
      await wait(1000 * i + Math.random() * 500);
    }
  }
}

export function dz<T>(path: string): Promise<T> {
  return withQuotaRetry(async () => {
    const json = await getJson<T & { error?: { message: string; code?: number } }>(`https://api.deezer.com${path}`);
    if (json.error?.code === 4) throw new QuotaError();
    if (json.error) throw new Error(`Deezer: ${json.error.message}`);
    return json;
  });
}

export async function dzList<T>(path: string): Promise<T[]> {
  return (await dz<DzList<T>>(path)).data ?? [];
}

// ------------------------------------------------------------ MusicBrainz

/** MusicBrainz allows ~1 request per second per client: serialize and space calls. */
let mbQueue: Promise<unknown> = Promise.resolve();
let mbLast = 0;
function mb<T>(path: string): Promise<T> {
  const run = mbQueue.then(async () => {
    const wait = mbLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    return getJson<T>(`https://musicbrainz.org/ws/2${path}${path.includes('?') ? '&' : '?'}fmt=json`, {
      'User-Agent': UA,
    });
  });
  mbQueue = run.catch(() => undefined);
  return run;
}

type MbRecording = {
  title: string;
  score: number;
  'first-release-date'?: string;
  'artist-credit'?: { artist: { id: string; name: string } }[];
};

const lucene = (s: string) => s.replace(/["\\]/g, ' ');
const yearOf = (date?: string) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

export type MbInfo = { year: number | null; artistMbid: string | null };
const mbInfoCache = new Map<string, Promise<MbInfo>>();

/** Original release year of a song (Deezer often reports the compilation/remaster date). */
export function musicBrainzInfo(isrc: string | undefined, title: string, artist: string): Promise<MbInfo> {
  const key = isrc || `${title}|${artist}`;
  let cached = mbInfoCache.get(key);
  if (!cached) {
    cached = lookupMbInfo(isrc, title, artist).catch(() => ({ year: null, artistMbid: null }));
    mbInfoCache.set(key, cached);
  }
  return cached;
}

async function lookupMbInfo(isrc: string | undefined, title: string, artist: string): Promise<MbInfo> {
  let recordings: MbRecording[] = [];
  if (isrc) {
    recordings = (await mb<{ recordings?: MbRecording[] }>(`/recording/?query=isrc:${isrc}&limit=10`)).recordings ?? [];
  }
  if (recordings.length === 0) {
    const q = encodeURIComponent(`recording:"${lucene(title)}" AND artist:"${lucene(artist)}"`);
    const found = (await mb<{ recordings?: MbRecording[] }>(`/recording/?query=${q}&limit=25`)).recordings ?? [];
    recordings = found.filter((r) => r.score >= 90 && normalize(r.title) === normalize(title));
  }
  const years = recordings.map((r) => yearOf(r['first-release-date'])).filter((y): y is number => y !== null);
  return {
    year: years.length ? Math.min(...years) : null,
    artistMbid: recordings[0]?.['artist-credit']?.[0]?.artist.id ?? null,
  };
}

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' });

export async function artistCountry(artistMbid: string | null, artistName: string): Promise<string | null> {
  type MbArtist = { country?: string; area?: { name: string }; score?: number; name?: string };
  let artist: MbArtist | undefined;
  if (artistMbid) artist = await mb<MbArtist>(`/artist/${artistMbid}`);
  if (!artist?.country && !artist?.area) {
    const q = encodeURIComponent(`artist:"${lucene(artistName)}"`);
    const found = (await mb<{ artists?: MbArtist[] }>(`/artist/?query=${q}&limit=3`)).artists ?? [];
    artist = found.find((a) => (a.score ?? 0) >= 95 && (a.country || a.area));
  }
  if (!artist) return null;
  if (artist.country) {
    try {
      return regionNames.of(artist.country) ?? artist.country;
    } catch {
      return artist.country;
    }
  }
  return artist.area?.name ?? null;
}

// ---------------------------------------------------------------- YouTube

/** Optional: only used when YOUTUBE_API_KEY is set. Costs ~101 quota units per call. */
export async function youtubeViews(title: string, artist: string): Promise<number | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const q = encodeURIComponent(`${artist} ${title}`);
  const search = await getJson<{ items?: { id: { videoId: string } }[] }>(
    `https://www.googleapis.com/youtube/v3/search?part=id&type=video&maxResults=1&q=${q}&key=${key}`,
  );
  const videoId = search.items?.[0]?.id.videoId;
  if (!videoId) return null;
  const stats = await getJson<{ items?: { statistics: { viewCount: string } }[] }>(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${key}`,
  );
  const views = stats.items?.[0]?.statistics.viewCount;
  return views ? Number(views) : null;
}
