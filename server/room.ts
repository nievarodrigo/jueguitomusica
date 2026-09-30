import {
  DIFFICULTIES,
  EXTRA_HINTS,
  LAST_LEVEL,
  LEVELS,
  hintsUnlockedAt,
  roundPoints,
  type HintKey,
} from '../shared/game';
import { themeById } from '../shared/themes';
import { cleanTitle, isCorrectGuess, type TrackRef } from '../shared/match';
import {
  DEFAULT_SETTINGS,
  type Hint,
  type MyRound,
  type Phase,
  type PublicPlayer,
  type RoomView,
  type Settings,
} from '../shared/types';

export type Song = {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string;
  link: string;
  isrc: string;
  year: number | null;
  rank: number;
  albumId: number;
};

export interface SongSource {
  /** Next song of this game's pool, or null when there are no more. */
  next(): Promise<Song | null>;
  /** A fresh, playable preview URL (Deezer ones expire). */
  preview(song: Song): Promise<string>;
  hint(song: Song, key: HintKey): Promise<{ label: string; value: string }>;
}

type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  audioUrl: string | null;
  round: MyRound;
};

type Options = {
  code: string;
  solo: boolean;
  createSource: (settings: Settings) => SongSource;
  /**
   * Maps a real preview URL to an opaque, per-player URL. The server serves only as many
   * seconds as `allowedSeconds()` says at request time, so the full song never reaches
   * the browser before the reveal.
   */
  registerAudio: (previewUrl: string, allowedSeconds: () => number) => string;
  onChange: () => void;
};

/** Free level hints first (in unlock order), then bought ones. */
const HINT_ORDER: HintKey[] = [...hintsUnlockedAt(LAST_LEVEL), ...EXTRA_HINTS.map((h) => h.key)];

const emptyRound = (status: MyRound['status']): MyRound => ({
  level: 0,
  status,
  points: 0,
  hints: [],
  extraHintsUsed: [],
  wrongGuesses: [],
});

export class GameRoom {
  readonly code: string;
  readonly solo: boolean;
  private players: Player[] = [];
  private hostId: string | null = null;
  private settings: Settings;
  private phase: Phase = 'lobby';
  private roundIndex = -1;
  private song: Song | null = null;
  private roundEndsAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private message: string | null = null;
  private source: SongSource | null = null;
  private hintCache = new Map<HintKey, Promise<Hint>>();
  /** Bumps on every round so late async work from a previous round is discarded. */
  private roundToken = 0;

  constructor(private opts: Options) {
    this.code = opts.code;
    this.solo = opts.solo;
    this.settings = { ...DEFAULT_SETTINGS, roundSeconds: opts.solo ? 0 : DEFAULT_SETTINGS.roundSeconds };
  }

  get isEmpty() {
    return this.players.length === 0;
  }

  addPlayer(id: string, name: string) {
    if (this.players.some((p) => p.id === id)) return;
    this.players.push({ id, name: name.slice(0, 20) || 'Anónimo', score: 0, connected: true, audioUrl: null, round: emptyRound('waiting') });
    this.hostId ??= id;
    this.changed();
  }

  /** A dropped player keeps their seat (and score) but no longer blocks the round or holds the host role. */
  setConnected(id: string, connected: boolean) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    if (!connected && this.hostId === id) this.hostId = this.players.find((x) => x.connected)?.id ?? id;
    if (connected && !this.players.some((x) => x.id === this.hostId && x.connected)) this.hostId = id;
    this.maybeEndRound();
    this.changed();
  }

  removePlayer(id: string) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) this.hostId = (this.players.find((p) => p.connected) ?? this.players[0])?.id ?? null;
    if (this.isEmpty) this.clearTimer();
    else this.maybeEndRound();
    this.changed();
  }

  updateSettings(by: string, patch: Partial<Settings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings, ...patch };
    s.rounds = clamp(Math.round(s.rounds), 1, 20);
    if (!(s.difficulty in DIFFICULTIES)) s.difficulty = this.settings.difficulty;
    if (s.theme && !themeById(s.theme)) s.theme = this.settings.theme;
    s.roundSeconds = s.roundSeconds === 0 ? 0 : clamp(Math.round(s.roundSeconds), 20, 300);
    this.settings = s;
    this.changed();
  }

  async start(by: string) {
    if (by !== this.hostId || (this.phase !== 'lobby' && this.phase !== 'finished')) return;
    this.players.forEach((p) => (p.score = 0));
    this.roundIndex = -1;
    this.message = null;
    this.source = this.opts.createSource(this.settings);
    await this.startRound();
  }

  async next(by: string) {
    if (by !== this.hostId || this.phase !== 'reveal') return;
    if (this.roundIndex + 1 >= this.settings.rounds) {
      this.phase = 'finished';
      this.changed();
      return;
    }
    await this.startRound();
  }

  backToLobby(by: string) {
    if (by !== this.hostId || this.phase !== 'finished') return;
    this.phase = 'lobby';
    this.message = null;
    this.changed();
  }

  async moreTime(id: string) {
    const p = this.playing(id);
    if (!p || p.round.level >= LAST_LEVEL) return;
    await this.advanceLevel(p);
  }

  async buyHint(id: string, key: HintKey) {
    const p = this.playing(id);
    if (!p || !EXTRA_HINTS.some((h) => h.key === key) || p.round.extraHintsUsed.includes(key)) return;
    p.round.extraHintsUsed.push(key);
    this.changed();
    await this.reveal(p, [key]);
  }

  async guess(id: string, guess: TrackRef) {
    const p = this.playing(id);
    if (!p || !this.song) return;
    if (isCorrectGuess(this.song, guess)) {
      const first = !this.solo && !this.players.some((o) => o.round.status === 'correct');
      p.round.status = 'correct';
      p.round.points = roundPoints({
        level: p.round.level,
        extraHints: p.round.extraHintsUsed.length,
        first,
        difficulty: this.settings.difficulty,
      });
      p.score += p.round.points;
      this.maybeEndRound();
      this.changed();
      return;
    }
    p.round.wrongGuesses.push(`${cleanTitle(guess.title)} — ${guess.artist}`);
    if (p.round.level >= LAST_LEVEL) return this.fail(p);
    await this.advanceLevel(p);
  }

  async giveUp(id: string) {
    const p = this.playing(id);
    if (p) this.fail(p);
  }

  view(forId: string): RoomView {
    const me = this.players.find((p) => p.id === forId);
    const players: PublicPlayer[] = [...this.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        status: p.round.status,
        level: p.round.level,
        roundPoints: p.round.points,
        isHost: p.id === this.hostId,
        connected: p.connected,
      }));
    const showSong = (this.phase === 'reveal' || this.phase === 'finished') && this.song;
    return {
      code: this.code,
      solo: this.solo,
      meId: forId,
      phase: this.phase,
      settings: this.settings,
      players,
      roundIndex: this.roundIndex,
      audioUrl: (this.phase === 'playing' || this.phase === 'reveal') && me ? me.audioUrl : null,
      roundEndsAt: this.phase === 'playing' ? this.roundEndsAt : null,
      me: me ? me.round : null,
      reveal: showSong
        ? {
            id: this.song!.id,
            title: cleanTitle(this.song!.title),
            artist: this.song!.artist,
            album: this.song!.album,
            cover: this.song!.cover,
            year: this.song!.year,
            link: this.song!.link,
          }
        : null,
      message: this.message,
    };
  }

  dispose() {
    this.clearTimer();
  }

  // ---------------------------------------------------------------- internals

  private async startRound() {
    const token = ++this.roundToken;
    this.clearTimer();
    this.phase = 'loading';
    this.changed();

    let song: Song | null = null;
    let url: string | null = null;
    try {
      song = await this.source!.next();
      if (song) url = await this.source!.preview(song);
    } catch (err) {
      console.error('[room] could not load song', err);
    }
    if (token !== this.roundToken) return;

    if (!song || !url) {
      const noneYet = this.roundIndex === -1;
      this.phase = noneYet ? 'lobby' : 'finished';
      this.message = noneYet
        ? 'No encontré canciones con esos filtros. Probá con algo más amplio.'
        : 'Me quedé sin canciones con esos filtros, ¡terminamos antes!';
      this.changed();
      return;
    }

    this.roundIndex++;
    this.song = song;
    this.hintCache.clear();
    for (const p of this.players) {
      p.round = emptyRound('playing');
      p.audioUrl = this.opts.registerAudio(url, () => this.allowedSeconds(p.id, token));
    }
    this.phase = 'playing';
    if (this.settings.roundSeconds > 0) {
      this.roundEndsAt = Date.now() + this.settings.roundSeconds * 1000;
      this.timer = setTimeout(() => this.onTimeout(token), this.settings.roundSeconds * 1000);
    } else {
      this.roundEndsAt = null;
    }
    // Resolve the original year in the background so the reveal doesn't show a remaster's date.
    void this.resolveHint('year');
    this.changed();
  }

  private allowedSeconds(id: string, token: number): number {
    if (token !== this.roundToken) return 0;
    if (this.phase === 'reveal' || this.phase === 'finished') return Infinity;
    const p = this.players.find((x) => x.id === id);
    return this.phase === 'playing' && p ? LEVELS[p.round.level].seconds : 0;
  }

  private onTimeout(token: number) {
    if (token !== this.roundToken || this.phase !== 'playing') return;
    this.players.filter((p) => p.round.status === 'playing').forEach((p) => (p.round.status = 'failed'));
    this.maybeEndRound();
    this.changed();
  }

  private playing(id: string) {
    if (this.phase !== 'playing') return null;
    const p = this.players.find((x) => x.id === id);
    return p && p.round.status === 'playing' ? p : null;
  }

  private async advanceLevel(p: Player) {
    const before = hintsUnlockedAt(p.round.level);
    p.round.level++;
    const unlocked = hintsUnlockedAt(p.round.level).filter((k) => !before.includes(k));
    this.changed();
    await this.reveal(p, unlocked);
  }

  private async reveal(p: Player, keys: HintKey[]) {
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

  private resolveHint(key: HintKey): Promise<Hint> {
    let cached = this.hintCache.get(key);
    if (!cached) {
      const song = this.song!;
      cached = this.source!
        .hint(song, key)
        .then((h) => ({ key, ...h }))
        .catch(() => ({ key, label: key, value: 'No disponible' }));
      this.hintCache.set(key, cached);
    }
    return cached;
  }

  private fail(p: Player) {
    p.round.status = 'failed';
    p.round.points = 0;
    this.maybeEndRound();
    this.changed();
  }

  private maybeEndRound() {
    if (this.phase !== 'playing') return;
    if (this.players.some((p) => p.connected && p.round.status === 'playing')) return;
    this.clearTimer();
    // Anyone still "playing" here dropped mid-round: they did not get it.
    this.players.filter((p) => p.round.status === 'playing').forEach((p) => (p.round.status = 'failed'));
    this.phase = 'reveal';
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private changed() {
    this.opts.onChange();
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n || min));
