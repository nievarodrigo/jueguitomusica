// server/index.ts
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";

// shared/match.ts
function normalize(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s-\s.*$/, " ").replace(/\b(feat|ft|featuring)\b\.?.*$/, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function cleanTitle(title) {
  const cleaned = title.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\s-\s.*$/, " ").replace(/\s(remaster(ed|izad[oa])?|en vivo|live|(mtv )?unplugged)(\s\d{4})?\s*$/i, " ").replace(/\s+/g, " ").trim();
  return cleaned || title.trim();
}
function isCorrectGuess(answer, guess) {
  if (answer.id === guess.id) return true;
  if (normalize(cleanTitle(answer.title)) !== normalize(cleanTitle(guess.title))) return false;
  const a = normalize(answer.artist);
  const g = normalize(guess.artist);
  return a === g || g.includes(a) || a.includes(g);
}
function titlePattern(title) {
  return cleanTitle(title).replace(/[\p{L}\p{N}]/gu, "_");
}

// shared/game.ts
var LEVELS = [
  { seconds: 0.3, points: 1e3 },
  { seconds: 1, points: 700 },
  { seconds: 5, points: 400 },
  { seconds: 15, points: 200 }
];
var LAST_LEVEL = LEVELS.length - 1;
var EXTRA_HINT_COST = 100;
var FIRST_CORRECT_BONUS = 150;
var LEVEL_HINTS = ["year", "genre", "popularity"];
var EXTRA_HINTS = [
  { key: "country", label: "Pa\xEDs del artista" },
  { key: "artistInitial", label: "Inicial del artista" },
  { key: "titlePattern", label: "Forma del t\xEDtulo" },
  { key: "album", label: "\xC1lbum" }
];
function hintsUnlockedAt(level) {
  return LEVEL_HINTS.slice(0, Math.max(0, Math.min(level, LEVEL_HINTS.length)));
}
var DIFFICULTIES = {
  easy: { label: "F\xE1cil", description: "Los hits que conoce todo el mundo", multiplier: 1 },
  medium: { label: "Medio", description: "Conocidas, pero no las m\xE1s gastadas", multiplier: 1.25 },
  hard: { label: "Dif\xEDcil", description: "Temas menos conocidos, para expertos", multiplier: 1.5 }
};
function roundPoints(input) {
  const base = LEVELS[Math.min(input.level, LAST_LEVEL)].points;
  const earned = Math.max(0, base - input.extraHints * EXTRA_HINT_COST);
  const multiplier = DIFFICULTIES[input.difficulty ?? "easy"].multiplier;
  return Math.round(earned * multiplier) + (input.first ? FIRST_CORRECT_BONUS : 0);
}

// server/analyze.ts
import { MPEGDecoder } from "mpg123-decoder";

// server/mp3.ts
function id3Size(buf) {
  if (buf.length < 10 || buf[0] !== 73 || buf[1] !== 68 || buf[2] !== 51) return 0;
  const size = buf[6] << 21 | buf[7] << 14 | buf[8] << 7 | buf[9];
  return 10 + size;
}
function nextFrame(buf, from) {
  for (let i = from; i < buf.length - 1; i++) if (buf[i] === 255 && (buf[i + 1] & 224) === 224) return i;
  return buf.length;
}
function sliceMp3(buf, seconds, totalSeconds, fromSeconds = 0) {
  const tag = id3Size(buf);
  const bytesPerSecond = (buf.length - tag) / totalSeconds;
  const end = Math.min(buf.length, tag + Math.round((fromSeconds + seconds) * bytesPerSecond));
  if (fromSeconds <= 0) return seconds >= totalSeconds ? buf : buf.subarray(0, end);
  const start = nextFrame(buf, tag + Math.round(fromSeconds * bytesPerSecond));
  const out = new Uint8Array(tag + Math.max(0, end - start));
  out.set(buf.subarray(0, tag));
  out.set(buf.subarray(start, Math.max(start, end)), tag);
  return out;
}
var WINDOW_SECONDS = 0.05;
var ABSOLUTE_FLOOR = 0.02;
var RELATIVE_FLOOR = 0.2;
function soundStart(samples, sampleRate, maxSeconds = Infinity) {
  const win = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  const rms = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / win));
  }
  if (rms.length === 0) return 0;
  const typical = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)];
  const first = rms.findIndex((r) => r >= Math.max(ABSOLUTE_FLOOR, RELATIVE_FLOOR * typical));
  return first <= 0 ? 0 : Math.min(maxSeconds, first * WINDOW_SECONDS);
}

// server/analyze.ts
var decoder = null;
var queue = Promise.resolve();
function detectSoundStart(mp3, previewSeconds, maxSkip) {
  const run = queue.then(async () => {
    decoder ??= (async () => {
      const d2 = new MPEGDecoder();
      await d2.ready;
      return d2;
    })();
    const d = await decoder;
    try {
      const head = sliceMp3(mp3, maxSkip + 1, previewSeconds);
      const { channelData, sampleRate } = d.decode(head);
      return channelData[0]?.length ? soundStart(channelData[0], sampleRate, maxSkip) : 0;
    } finally {
      await d.reset();
    }
  });
  queue = run.catch(() => void 0);
  return run.catch((err) => {
    console.error("[audio] could not analyse preview", err);
    return 0;
  });
}

// shared/themes.ts
var THEMES = [
  {
    id: "reggaeton-viejo",
    label: "Reggaet\xF3n viejo",
    emoji: "\u{1F525}",
    description: "Gasolina, perreo old school",
    queries: ["reggaeton viejo", "perreo viejo", "reggaeton old school", "reggaeton 2000s"],
    yearTo: 2012
  },
  {
    id: "rock-nacional",
    label: "Rock nacional",
    emoji: "\u{1F3B8}",
    description: "Soda, Charly, los Redondos",
    queries: ["rock nacional argentino", "rock argentino clasicos", "rock argentino 80 90"]
  },
  {
    id: "rock-internacional",
    label: "Rock internacional",
    emoji: "\u{1F918}",
    description: "Rock en ingl\xE9s de los 90 y 2000",
    queries: ["rock en ingles 90 2000", "90s rock", "2000s rock"]
  },
  {
    id: "rock-clasico",
    label: "Rock cl\xE1sico",
    emoji: "\u{1F33C}",
    description: "Creedence, Zeppelin, los 60 y 70",
    queries: ["70s rock anthems", "60s rock"]
  },
  {
    id: "pop-2000",
    label: "Pop 2000",
    emoji: "\u{1F4BF}",
    description: "Britney, Shakira, Black Eyed Peas",
    queries: ["pop hits 2000s", "00s pop", "00s hits"]
  },
  {
    id: "ochentas",
    label: "Los 80",
    emoji: "\u{1F4FC}",
    description: "Hits ochentosos",
    queries: ["80s hits", "80s pop", "exitos de los 80 en ingles"]
  },
  {
    id: "cumbia-villera",
    label: "Cumbia villera",
    emoji: "\u{1F37B}",
    description: "Damas Gratis, Pibes Chorros",
    queries: ["cumbia villera", "cumbia villera 2000"]
  },
  {
    id: "cumbia-cheta",
    label: "Cumbia cheta",
    emoji: "\u{1F3DD}\uFE0F",
    description: "Marama, Rombai, Agapornis",
    queries: ["cumbias chetas", "cumbia cheta", "cumbia pop uruguaya"]
  },
  {
    id: "trap-argentino",
    label: "Trap argentino",
    emoji: "\u{1F3A4}",
    description: "Duki, Paulo, Khea",
    queries: ["trap argentino"]
  },
  {
    id: "cuarteto",
    label: "Cuarteto",
    emoji: "\u{1F483}",
    description: "La Mona, Ulises, Q\u2019 Lokura",
    queries: ["cuarteto cordobes"]
  },
  {
    id: "baladas",
    label: "Baladas en espa\xF1ol",
    emoji: "\u{1F498}",
    description: "Para cantar abrazado",
    queries: ["baladas en espa\xF1ol", "baladas romanticas en espa\xF1ol"]
  }
];
function themeById(id) {
  return THEMES.find((t) => t.id === id);
}

// server/sources.ts
var UA = `jueguitomusica/0.1 (${process.env.MB_CONTACT ?? "dev"})`;
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(1e4) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.json();
}
var QuotaError = class extends Error {
  constructor() {
    super("Deezer: Quota limit exceeded");
  }
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withQuotaRetry(fn, wait = sleep, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof QuotaError) || i >= attempts) throw err;
      await wait(1e3 * i + Math.random() * 500);
    }
  }
}
function dz(path2) {
  return withQuotaRetry(async () => {
    const json = await getJson(`https://api.deezer.com${path2}`);
    if (json.error?.code === 4) throw new QuotaError();
    if (json.error) throw new Error(`Deezer: ${json.error.message}`);
    return json;
  });
}
async function dzList(path2) {
  return (await dz(path2)).data ?? [];
}
var mbQueue = Promise.resolve();
var mbLast = 0;
function mb(path2) {
  const run = mbQueue.then(async () => {
    const wait = mbLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    return getJson(`https://musicbrainz.org/ws/2${path2}${path2.includes("?") ? "&" : "?"}fmt=json`, {
      "User-Agent": UA
    });
  });
  mbQueue = run.catch(() => void 0);
  return run;
}
var lucene = (s) => s.replace(/["\\]/g, " ");
var yearOf = (date) => date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
var mbInfoCache = /* @__PURE__ */ new Map();
function musicBrainzInfo(isrc, title, artist) {
  const key = isrc || `${title}|${artist}`;
  let cached = mbInfoCache.get(key);
  if (!cached) {
    cached = lookupMbInfo(isrc, title, artist).catch(() => ({ year: null, artistMbid: null }));
    mbInfoCache.set(key, cached);
  }
  return cached;
}
async function lookupMbInfo(isrc, title, artist) {
  let recordings = [];
  if (isrc) {
    recordings = (await mb(`/recording/?query=isrc:${isrc}&limit=10`)).recordings ?? [];
  }
  if (recordings.length === 0) {
    const q = encodeURIComponent(`recording:"${lucene(title)}" AND artist:"${lucene(artist)}"`);
    const found = (await mb(`/recording/?query=${q}&limit=25`)).recordings ?? [];
    recordings = found.filter((r) => r.score >= 90 && normalize(r.title) === normalize(title));
  }
  const years = recordings.map((r) => yearOf(r["first-release-date"])).filter((y) => y !== null);
  return {
    year: years.length ? Math.min(...years) : null,
    artistMbid: recordings[0]?.["artist-credit"]?.[0]?.artist.id ?? null
  };
}
var regionNames = new Intl.DisplayNames(["es"], { type: "region" });
async function artistCountry(artistMbid, artistName) {
  let artist;
  if (artistMbid) artist = await mb(`/artist/${artistMbid}`);
  if (!artist?.country && !artist?.area) {
    const q = encodeURIComponent(`artist:"${lucene(artistName)}"`);
    const found = (await mb(`/artist/?query=${q}&limit=3`)).artists ?? [];
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
async function youtubeViews(title, artist) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const q = encodeURIComponent(`${artist} ${title}`);
  const search = await getJson(
    `https://www.googleapis.com/youtube/v3/search?part=id&type=video&maxResults=1&q=${q}&key=${key}`
  );
  const videoId = search.items?.[0]?.id.videoId;
  if (!videoId) return null;
  const stats = await getJson(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${key}`
  );
  const views = stats.items?.[0]?.statistics.viewCount;
  return views ? Number(views) : null;
}

// server/pool.ts
var MAX_DECADES = 4;
var RELEVANT_PLAYLISTS = 5;
var MAX_SCAN = 120;
var BATCH = 8;
var BACKGROUND_CONFIRMS = 2;
var JUNK = /karaoke|tribute|made famous|originally performed|in the style of|backing track|8-bit|lullaby|cover version/i;
function decades(settings) {
  if (settings.yearFrom === null && settings.yearTo === null) return [];
  const from = Math.floor((settings.yearFrom ?? 1950) / 10) * 10;
  const to = Math.floor((settings.yearTo ?? (/* @__PURE__ */ new Date()).getFullYear()) / 10) * 10;
  const all = [];
  for (let d = from; d <= to; d += 10) all.push(d);
  const picked = all.length <= MAX_DECADES ? all : Array.from({ length: MAX_DECADES }, (_, i) => all[Math.round(i * (all.length - 1) / (MAX_DECADES - 1))]);
  return picked.map((d) => d < 2e3 ? `${d % 100}s` : `${d}s`);
}
function effectiveSettings(settings) {
  const theme = themeById(settings.theme);
  if (!theme) return settings;
  return { ...settings, genre: "", country: "", yearFrom: theme.yearFrom ?? null, yearTo: theme.yearTo ?? null };
}
var SOUND_ALIKE = /\bhits\b|all ?stars|tribute|karaoke|\bcovers?\b|^the (sixties|seventies|eighties|nineties)$/i;
function isSoundAlike(artist) {
  return SOUND_ALIKE.test(artist.trim());
}
function isJunk(t) {
  return JUNK.test(`${t.title} ${t.artist.name} ${t.album.title}`) || isSoundAlike(t.artist.name);
}
function searchQueries(settings) {
  const theme = themeById(settings.theme);
  if (theme) return theme.queries;
  const base = [settings.genre, settings.country].filter(Boolean).join(" ");
  const ds = decades(settings);
  if (!base && ds.length === 0) return ["exitos", "greatest hits", "top hits"];
  if (ds.length === 0) return [base];
  return ds.map((d) => `${base || "exitos"} ${d}`);
}
function yearVerdict(releaseYear2, settings) {
  const { yearFrom, yearTo } = settings;
  if (yearFrom === null && yearTo === null) return "accept";
  if (releaseYear2 === null) return "check";
  if (yearFrom !== null && releaseYear2 < yearFrom) return "reject";
  if (yearTo !== null && releaseYear2 > yearTo) return "check";
  return "accept";
}
var inRange = (year, s) => (s.yearFrom === null || year >= s.yearFrom) && (s.yearTo === null || year <= s.yearTo);
function orderByDifficulty(tracks, difficulty) {
  const { sorted, cuts } = rankTiers(tracks);
  const tier = { easy: 0, medium: 1, hard: 2 }[difficulty];
  const [lo, hi] = [cuts[tier], cuts[tier + 1]];
  const distance = (i) => i < lo ? lo - i : i - hi + 1;
  const rest = sorted.map((t, i) => ({ t, i })).filter(({ i }) => i < lo || i >= hi).sort((a, b) => distance(a.i) - distance(b.i) || a.i - b.i).map(({ t }) => t);
  return [...shuffle(sorted.slice(lo, hi)), ...rest];
}
function rankTiers(tracks) {
  const best = /* @__PURE__ */ new Map();
  for (const t of tracks) {
    const current = best.get(songKey(t));
    if (!current || t.rank > current.rank) best.set(songKey(t), t);
  }
  const sorted = [...best.values()].sort((a, b) => b.rank - a.rank);
  const n = sorted.length;
  return { sorted, cuts: [0, Math.round(n / 3), Math.round(2 * n / 3), n] };
}
var MIN_CORE_SONGS = 20;
var songKey = (t) => `${normalize(cleanTitle(t.title))}|${normalize(t.artist.name)}`;
function byConsensus(playlists, difficulty) {
  const { core, reserve } = consensus(playlists);
  return [...orderByDifficulty(core, difficulty), ...orderByDifficulty(reserve, "easy")];
}
function consensus(playlists) {
  const votes = /* @__PURE__ */ new Map();
  for (const list of playlists) {
    for (const key of new Set(list.map(songKey))) votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  const all = playlists.flat().filter((t) => t.readable && t.preview);
  let needed = playlists.length <= 1 ? 1 : Math.max(2, Math.ceil(playlists.length * 0.15));
  const agreed = (n) => all.filter((t) => (votes.get(songKey(t)) ?? 0) >= n);
  while (needed > 1 && new Set(agreed(needed).map(songKey)).size < MIN_CORE_SONGS) needed--;
  const core = agreed(needed);
  const reserve = all.filter((t) => (votes.get(songKey(t)) ?? 0) < needed);
  return { votes, needed, core, reserve };
}
var yearOf2 = (date) => date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
async function fetchPlaylists(settings) {
  const queries = searchQueries(settings);
  const hits = await Promise.all(
    queries.map(
      (q) => dzList(`/search/playlist?q=${encodeURIComponent(q)}&limit=15`).catch(() => [])
    )
  );
  const unique = /* @__PURE__ */ new Map();
  for (const ps of hits)
    for (const p of ps.filter((p2) => p2.nb_tracks >= 10).slice(0, RELEVANT_PLAYLISTS)) unique.set(p.id, p);
  const chosen = [...unique.values()];
  const lists = await Promise.all(
    chosen.map((p) => dzList(`/playlist/${p.id}/tracks?limit=100`).catch(() => []))
  );
  const usable = chosen.map((p, i) => ({ p, list: lists[i] })).filter(({ list }) => list.some((t) => t.readable && t.preview));
  if (usable.length > 0) {
    return { playlists: usable.map(({ p }) => ({ id: p.id, title: p.title })), lists: usable.map(({ list }) => list) };
  }
  const found = await Promise.all(
    queries.map((q) => dzList(`/search?q=${encodeURIComponent(q)}&limit=50`).catch(() => []))
  );
  return { playlists: [], lists: [found.flat().filter((t) => t.readable && t.preview)] };
}
var DeezerSource = class {
  candidates = null;
  seen = /* @__PURE__ */ new Set();
  scanned = 0;
  prefetched = null;
  ready = [];
  toConfirm = [];
  settings;
  constructor(settings) {
    this.settings = effectiveSettings(settings);
  }
  /** Returns the next song and immediately starts looking for the one after, so rounds start fast. */
  next() {
    const current = this.prefetched ?? this.findNext();
    this.prefetched = current.then((song) => song ? this.findNext() : null);
    return current;
  }
  async preview(song) {
    const fresh = await dz(`/track/${song.id}`);
    return fresh.preview;
  }
  async hint(song, key) {
    switch (key) {
      case "year": {
        const info = await musicBrainzInfo(song.isrc, song.title, song.artist);
        if (info.year && (!song.year || info.year < song.year)) song.year = info.year;
        return { label: "A\xF1o", value: song.year ? String(song.year) : "Desconocido" };
      }
      case "genre": {
        const album = await dz(`/album/${song.albumId}`);
        const names = album.genres?.data.map((g) => g.name) ?? [];
        return { label: "G\xE9nero", value: names.length ? names.join(" / ") : "Sin datos" };
      }
      case "popularity": {
        const views = await youtubeViews(song.title, song.artist).catch(() => null);
        if (views !== null) {
          return {
            label: "Visitas en YouTube",
            value: new Intl.NumberFormat("es-AR", { notation: "compact" }).format(views)
          };
        }
        const stars = Math.min(5, Math.max(1, Math.ceil(song.rank / 2e5)));
        return { label: "Popularidad", value: "\u2605".repeat(stars) + "\u2606".repeat(5 - stars) };
      }
      case "country": {
        const info = await musicBrainzInfo(song.isrc, song.title, song.artist);
        const country = await artistCountry(info.artistMbid, song.artist);
        return { label: "Pa\xEDs del artista", value: country ?? "Desconocido" };
      }
      case "artistInitial": {
        const words = song.artist.trim().split(/\s+/).length;
        return {
          label: "Artista",
          value: `Empieza con "${song.artist.trim()[0]?.toUpperCase()}" \xB7 ${words} palabra${words > 1 ? "s" : ""}`
        };
      }
      case "titlePattern":
        return { label: "T\xEDtulo", value: titlePattern(song.title) };
      case "album":
        return {
          label: "\xC1lbum",
          value: normalize(cleanTitle(song.album)) === normalize(cleanTitle(song.title)) ? "Es un single (se llama igual que la canci\xF3n)" : song.album
        };
    }
  }
  /**
   * Fast path first: inspect Deezer tracks in parallel batches and take one whose release year
   * already fits. Tracks that might be compilations wait in `toConfirm` for the slow
   * (1 req/s) MusicBrainz check, which only runs when a batch yields nothing.
   */
  async findNext() {
    if (this.ready.length && this.toConfirm.length) await this.mixInConfirmed(BACKGROUND_CONFIRMS);
    if (this.ready.length) return this.ready.shift();
    const candidates = await this.loadCandidates();
    while (candidates.length && this.scanned < MAX_SCAN) {
      const batch = candidates.splice(0, BATCH);
      this.scanned += batch.length;
      const inspected = await Promise.all(batch.map((c) => this.inspect(c).catch(() => null)));
      for (const r of inspected) {
        if (r?.verdict === "accept") this.ready.push(toSong(r.track, releaseYear(r.track)));
        else if (r?.verdict === "check") this.toConfirm.push(r.track);
      }
      if (this.ready.length) return this.ready.shift();
      const confirmed = await this.confirmSome(2);
      if (confirmed) return confirmed;
    }
    return this.confirmSome(Infinity);
  }
  async mixInConfirmed(max) {
    for (let i = 0; i < max && this.toConfirm.length; i++) {
      const song = await this.confirm(this.toConfirm.shift()).catch(() => null);
      if (song) this.ready.splice(Math.floor(Math.random() * (this.ready.length + 1)), 0, song);
    }
  }
  async confirmSome(max) {
    for (let i = 0; i < max && this.toConfirm.length; i++) {
      const song = await this.confirm(this.toConfirm.shift()).catch(() => null);
      if (song) return song;
    }
    return null;
  }
  loadCandidates() {
    this.candidates ??= fetchPlaylists(this.settings).then(({ lists }) => byConsensus(lists, this.settings.difficulty));
    return this.candidates;
  }
  /** Fetches full track data and classifies it by year, without touching MusicBrainz. */
  async inspect(c) {
    const key = songKey(c);
    if (this.seen.has(key) || isJunk(c)) return null;
    this.seen.add(key);
    const t = await dz(`/track/${c.id}`);
    if (!t.readable || !t.preview) return null;
    const verdict = yearVerdict(releaseYear(t), this.settings);
    return verdict === "reject" ? null : { track: t, verdict };
  }
  /** Slow path: ask MusicBrainz for the original year of a probable compilation track. */
  async confirm(t) {
    const info = await musicBrainzInfo(t.isrc, t.title, t.artist.name);
    return info.year && inRange(info.year, this.settings) ? toSong(t, info.year) : null;
  }
};
var releaseYear = (t) => yearOf2(t.release_date) ?? yearOf2(t.album.release_date);
function toSong(t, year) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist.name,
    album: t.album.title,
    cover: t.album.cover_medium ?? "",
    link: t.link,
    isrc: t.isrc ?? "",
    year,
    rank: t.rank,
    albumId: t.album.id
  };
}

// shared/types.ts
var DEFAULT_SETTINGS = {
  rounds: 5,
  difficulty: "medium",
  theme: "",
  yearFrom: null,
  yearTo: null,
  genre: "",
  country: "",
  roundSeconds: 90
};

// server/room.ts
var HINT_ORDER = [...hintsUnlockedAt(LAST_LEVEL), ...EXTRA_HINTS.map((h) => h.key)];
var emptyRound = (status) => ({
  level: 0,
  status,
  points: 0,
  hints: [],
  extraHintsUsed: [],
  wrongGuesses: []
});
var GameRoom = class {
  constructor(opts) {
    this.opts = opts;
    this.code = opts.code;
    this.solo = opts.solo;
    this.settings = { ...DEFAULT_SETTINGS, roundSeconds: opts.solo ? 0 : DEFAULT_SETTINGS.roundSeconds };
  }
  opts;
  code;
  solo;
  players = [];
  hostId = null;
  settings;
  phase = "lobby";
  roundIndex = -1;
  song = null;
  roundEndsAt = null;
  timer = null;
  message = null;
  source = null;
  hintCache = /* @__PURE__ */ new Map();
  /** Bumps on every round so late async work from a previous round is discarded. */
  roundToken = 0;
  get isEmpty() {
    return this.players.length === 0;
  }
  addPlayer(id, name) {
    if (this.players.some((p) => p.id === id)) return;
    this.players.push({ id, name: name.slice(0, 20) || "An\xF3nimo", score: 0, connected: true, audioUrl: null, round: emptyRound("waiting") });
    this.hostId ??= id;
    this.changed();
  }
  /** A dropped player keeps their seat (and score) but no longer blocks the round or holds the host role. */
  setConnected(id, connected) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    if (!connected && this.hostId === id) this.hostId = this.players.find((x) => x.connected)?.id ?? id;
    if (connected && !this.players.some((x) => x.id === this.hostId && x.connected)) this.hostId = id;
    this.maybeEndRound();
    this.changed();
  }
  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) this.hostId = (this.players.find((p) => p.connected) ?? this.players[0])?.id ?? null;
    if (this.isEmpty) this.clearTimer();
    else this.maybeEndRound();
    this.changed();
  }
  updateSettings(by, patch) {
    if (by !== this.hostId || this.phase !== "lobby") return;
    const s = { ...this.settings, ...patch };
    s.rounds = clamp(Math.round(s.rounds), 1, 20);
    if (!(s.difficulty in DIFFICULTIES)) s.difficulty = this.settings.difficulty;
    if (s.theme && !themeById(s.theme)) s.theme = this.settings.theme;
    s.roundSeconds = s.roundSeconds === 0 ? 0 : clamp(Math.round(s.roundSeconds), 20, 300);
    this.settings = s;
    this.changed();
  }
  async start(by) {
    if (by !== this.hostId || this.phase !== "lobby" && this.phase !== "finished") return;
    this.players.forEach((p) => p.score = 0);
    this.roundIndex = -1;
    this.message = null;
    this.source = this.opts.createSource(this.settings);
    await this.startRound();
  }
  async next(by) {
    if (by !== this.hostId || this.phase !== "reveal") return;
    if (this.roundIndex + 1 >= this.settings.rounds) {
      this.phase = "finished";
      this.changed();
      return;
    }
    await this.startRound();
  }
  backToLobby(by) {
    if (by !== this.hostId || this.phase !== "finished") return;
    this.phase = "lobby";
    this.message = null;
    this.changed();
  }
  async moreTime(id) {
    const p = this.playing(id);
    if (!p || p.round.level >= LAST_LEVEL) return;
    await this.advanceLevel(p);
  }
  async buyHint(id, key) {
    const p = this.playing(id);
    if (!p || !EXTRA_HINTS.some((h) => h.key === key) || p.round.extraHintsUsed.includes(key)) return;
    p.round.extraHintsUsed.push(key);
    this.changed();
    await this.reveal(p, [key]);
  }
  async guess(id, guess) {
    const p = this.playing(id);
    if (!p || !this.song) return;
    if (isCorrectGuess(this.song, guess)) {
      const first = !this.solo && !this.players.some((o) => o.round.status === "correct");
      p.round.status = "correct";
      p.round.points = roundPoints({
        level: p.round.level,
        extraHints: p.round.extraHintsUsed.length,
        first,
        difficulty: this.settings.difficulty
      });
      p.score += p.round.points;
      this.maybeEndRound();
      this.changed();
      return;
    }
    p.round.wrongGuesses.push(`${cleanTitle(guess.title)} \u2014 ${guess.artist}`);
    if (p.round.level >= LAST_LEVEL) return this.fail(p);
    await this.advanceLevel(p);
  }
  async giveUp(id) {
    const p = this.playing(id);
    if (p) this.fail(p);
  }
  view(forId) {
    const me = this.players.find((p) => p.id === forId);
    const players = [...this.players].sort((a, b) => b.score - a.score).map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      status: p.round.status,
      level: p.round.level,
      roundPoints: p.round.points,
      isHost: p.id === this.hostId,
      connected: p.connected
    }));
    const showSong = (this.phase === "reveal" || this.phase === "finished") && this.song;
    return {
      code: this.code,
      solo: this.solo,
      meId: forId,
      phase: this.phase,
      settings: this.settings,
      players,
      roundIndex: this.roundIndex,
      audioUrl: (this.phase === "playing" || this.phase === "reveal") && me ? me.audioUrl : null,
      roundEndsAt: this.phase === "playing" ? this.roundEndsAt : null,
      me: me ? me.round : null,
      reveal: showSong ? {
        id: this.song.id,
        title: cleanTitle(this.song.title),
        artist: this.song.artist,
        album: this.song.album,
        cover: this.song.cover,
        year: this.song.year,
        link: this.song.link
      } : null,
      message: this.message
    };
  }
  dispose() {
    this.clearTimer();
  }
  // ---------------------------------------------------------------- internals
  async startRound() {
    const token = ++this.roundToken;
    this.clearTimer();
    this.phase = "loading";
    this.changed();
    let song = null;
    let url = null;
    try {
      song = await this.source.next();
      if (song) url = await this.source.preview(song);
    } catch (err) {
      console.error("[room] could not load song", err);
    }
    if (token !== this.roundToken) return;
    if (!song || !url) {
      const noneYet = this.roundIndex === -1;
      this.phase = noneYet ? "lobby" : "finished";
      this.message = noneYet ? "No encontr\xE9 canciones con esos filtros. Prob\xE1 con algo m\xE1s amplio." : "Me qued\xE9 sin canciones con esos filtros, \xA1terminamos antes!";
      this.changed();
      return;
    }
    this.roundIndex++;
    this.song = song;
    this.hintCache.clear();
    for (const p of this.players) {
      p.round = emptyRound("playing");
      p.audioUrl = this.opts.registerAudio(url, () => this.allowedSeconds(p.id, token));
    }
    this.phase = "playing";
    if (this.settings.roundSeconds > 0) {
      this.roundEndsAt = Date.now() + this.settings.roundSeconds * 1e3;
      this.timer = setTimeout(() => this.onTimeout(token), this.settings.roundSeconds * 1e3);
    } else {
      this.roundEndsAt = null;
    }
    void this.resolveHint("year");
    this.changed();
  }
  allowedSeconds(id, token) {
    if (token !== this.roundToken) return 0;
    if (this.phase === "reveal" || this.phase === "finished") return Infinity;
    const p = this.players.find((x) => x.id === id);
    return this.phase === "playing" && p ? LEVELS[p.round.level].seconds : 0;
  }
  onTimeout(token) {
    if (token !== this.roundToken || this.phase !== "playing") return;
    this.players.filter((p) => p.round.status === "playing").forEach((p) => p.round.status = "failed");
    this.maybeEndRound();
    this.changed();
  }
  playing(id) {
    if (this.phase !== "playing") return null;
    const p = this.players.find((x) => x.id === id);
    return p && p.round.status === "playing" ? p : null;
  }
  async advanceLevel(p) {
    const before = hintsUnlockedAt(p.round.level);
    p.round.level++;
    const unlocked = hintsUnlockedAt(p.round.level).filter((k) => !before.includes(k));
    this.changed();
    await this.reveal(p, unlocked);
  }
  async reveal(p, keys) {
    const token = this.roundToken;
    for (const key of keys) {
      const hint = await this.resolveHint(key);
      if (token !== this.roundToken) return;
      if (!p.round.hints.some((h) => h.key === key)) {
        p.round.hints.push(hint);
        p.round.hints.sort((a, b) => HINT_ORDER.indexOf(a.key) - HINT_ORDER.indexOf(b.key));
      }
    }
    this.changed();
  }
  resolveHint(key) {
    let cached = this.hintCache.get(key);
    if (!cached) {
      const song = this.song;
      cached = this.source.hint(song, key).then((h) => ({ key, ...h })).catch(() => ({ key, label: key, value: "No disponible" }));
      this.hintCache.set(key, cached);
    }
    return cached;
  }
  fail(p) {
    p.round.status = "failed";
    p.round.points = 0;
    this.maybeEndRound();
    this.changed();
  }
  maybeEndRound() {
    if (this.phase !== "playing") return;
    if (this.players.some((p) => p.connected && p.round.status === "playing")) return;
    this.clearTimer();
    this.players.filter((p) => p.round.status === "playing").forEach((p) => p.round.status = "failed");
    this.phase = "reveal";
  }
  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  changed() {
    this.opts.onChange();
  }
};
var clamp = (n, min, max) => Math.min(max, Math.max(min, n || min));

// server/index.ts
var PORT = Number(process.env.PORT ?? 3001);
var app = express();
var http = createServer(app);
var io = new Server(http);
var PREVIEW_SECONDS = 30;
var SLICE_MARGIN_SECONDS = 0.5;
var audio = /* @__PURE__ */ new Map();
var mp3Cache = /* @__PURE__ */ new Map();
var MAX_SKIP_SECONDS = PREVIEW_SECONDS - LEVELS[LAST_LEVEL].seconds;
function registerAudio(url, allowed) {
  const token = randomBytes(12).toString("hex");
  audio.set(token, { url, allowed, expires: Date.now() + 30 * 6e4 });
  return `/api/audio/${token}`;
}
function fetchMp3(url) {
  let cached = mp3Cache.get(url);
  if (!cached) {
    const data = fetch(url, { signal: AbortSignal.timeout(15e3) }).then(async (r) => {
      if (!r.ok) throw new Error(`preview ${r.status}`);
      const mp3 = new Uint8Array(await r.arrayBuffer());
      return { data: mp3, start: await detectSoundStart(mp3, PREVIEW_SECONDS, MAX_SKIP_SECONDS) };
    });
    data.catch(() => mp3Cache.delete(url));
    cached = { data, expires: Date.now() + 30 * 6e4 };
    mp3Cache.set(url, cached);
  }
  return cached.data;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of audio) if (v.expires < now) audio.delete(k);
  for (const [k, v] of mp3Cache) if (v.expires < now) mp3Cache.delete(k);
}, 6e4).unref();
app.get("/api/audio/:token", async (req, res) => {
  const entry = audio.get(req.params.token);
  if (!entry) return void res.status(404).end();
  const seconds = entry.allowed();
  if (seconds <= 0) return void res.status(403).end();
  try {
    const preview = await fetchMp3(entry.url);
    const body = sliceMp3(preview.data, seconds + SLICE_MARGIN_SECONDS, PREVIEW_SECONDS, preview.start);
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "no-store");
    res.send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  } catch {
    res.status(502).end();
  }
});
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return void res.json([]);
  try {
    const tracks = await dzList(`/search?q=${encodeURIComponent(q)}&limit=25`);
    const seen = /* @__PURE__ */ new Set();
    const results = [];
    for (const t of tracks) {
      const title = cleanTitle(t.title);
      const key = `${normalize(title)}|${normalize(t.artist.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ id: t.id, title, artist: t.artist.name, cover: t.album.cover_small ?? "" });
      if (results.length === 8) break;
    }
    res.json(results);
  } catch {
    res.status(502).json([]);
  }
});
var rooms = /* @__PURE__ */ new Map();
var seats = /* @__PURE__ */ new Map();
var RECONNECT_GRACE_MS = 6e4;
function newCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  while (rooms.has(code));
  return code;
}
function pidOf(socket) {
  const pid = socket.handshake.auth?.pid;
  return typeof pid === "string" && /^[\w-]{16,64}$/.test(pid) ? pid : socket.id;
}
function broadcast(room) {
  for (const id of io.sockets.adapter.rooms.get(room.code) ?? []) {
    const seat = seats.get(io.sockets.sockets.get(id)?.data.pid);
    if (seat?.room === room) io.to(id).emit("room", room.view(seat.seat));
  }
}
function createRoom(solo) {
  const code = newCode();
  const room = new GameRoom({
    code,
    solo,
    createSource: (settings) => new DeezerSource(settings),
    registerAudio,
    onChange: () => broadcast(room)
  });
  rooms.set(code, room);
  return room;
}
function join(socket, room, name) {
  const pid = socket.data.pid;
  leave(pid);
  const seat = randomBytes(8).toString("hex");
  seats.set(pid, { room, seat });
  socket.join(room.code);
  room.addPlayer(seat, name);
}
function leave(pid) {
  const entry = seats.get(pid);
  if (!entry) return;
  clearTimeout(entry.grace);
  seats.delete(pid);
  for (const s of io.sockets.sockets.values()) if (s.data.pid === pid) s.leave(entry.room.code);
  entry.room.removePlayer(entry.seat);
  if (entry.room.isEmpty) {
    entry.room.dispose();
    rooms.delete(entry.room.code);
  }
}
io.on("connection", (socket) => {
  const pid = pidOf(socket);
  socket.data.pid = pid;
  const existing = seats.get(pid);
  if (existing) {
    clearTimeout(existing.grace);
    existing.grace = void 0;
    socket.join(existing.room.code);
    existing.room.setConnected(existing.seat, true);
    socket.emit("room", existing.room.view(existing.seat));
  } else {
    socket.emit("room", null);
  }
  const seat = () => seats.get(pid);
  const act = (fn) => async (...args) => {
    const s = seat();
    if (!s) return;
    try {
      await fn(s.room, s.seat, ...args);
    } catch (err) {
      console.error("[socket]", err);
      socket.emit("toast", "Algo sali\xF3 mal, prob\xE1 de nuevo.");
    }
  };
  socket.on("create", ({ name, solo }) => join(socket, createRoom(!!solo), name));
  socket.on("join", ({ name, code }) => {
    const target = rooms.get(String(code).toUpperCase().trim());
    if (!target || target.solo) return void socket.emit("toast", "No existe una sala con ese c\xF3digo.");
    join(socket, target, name);
  });
  socket.on("leave", () => {
    leave(pid);
    socket.emit("room", null);
  });
  socket.on("settings", act((r, id, patch) => r.updateSettings(id, patch)));
  socket.on("start", act((r, id) => r.start(id)));
  socket.on("next", act((r, id) => r.next(id)));
  socket.on("lobby", act((r, id) => r.backToLobby(id)));
  socket.on("moreTime", act((r, id) => r.moreTime(id)));
  socket.on("hint", act((r, id, key) => r.buyHint(id, key)));
  socket.on("guess", act((r, id, guess) => r.guess(id, guess)));
  socket.on("giveUp", act((r, id) => r.giveUp(id)));
  socket.on("disconnect", () => {
    const s = seat();
    if (!s) return;
    const stillHere = [...io.sockets.sockets.values()].some((o) => o.id !== socket.id && o.data.pid === pid);
    if (stillHere) return;
    s.room.setConnected(s.seat, false);
    clearTimeout(s.grace);
    s.grace = setTimeout(() => leave(pid), RECONNECT_GRACE_MS);
  });
});
var dist = path.resolve(import.meta.dirname, "../dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
if (!process.env.VERCEL) {
  http.listen(PORT, () => console.log(`\u{1F3B5} jueguitomusica server on http://localhost:${PORT}`));
}
var index_default = http;
export {
  index_default as default
};
