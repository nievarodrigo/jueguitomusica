import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIFFICULTIES, EXTRA_HINT_COST, FIRST_CORRECT_BONUS, LAST_LEVEL, LEVELS } from '../shared/game';
import { DEFAULT_SETTINGS } from '../shared/types';
import { GameRoom, type Song, type SongSource } from './room';

const song = (id: number, title: string, artist: string): Song => ({
  id,
  title,
  artist,
  album: `${title} (album)`,
  cover: '',
  link: '',
  isrc: '',
  year: 1990,
  rank: 1000,
  albumId: id,
});

const SONGS = [song(1, 'De Música Ligera', 'Soda Stereo'), song(2, 'Lamento Boliviano', 'Enanitos Verdes')];

function fakeSource(songs = SONGS): SongSource {
  const queue = [...songs];
  return {
    next: async () => queue.shift() ?? null,
    preview: async (s) => `https://preview/${s.id}.mp3`,
    hint: async (s, key) => ({ label: key, value: `${key}-of-${s.id}` }),
  };
}

function makeRoom(solo: boolean, songs = SONGS) {
  return new GameRoom({
    code: 'ABCD',
    solo,
    createSource: () => fakeSource(songs),
    registerAudio: (url) => `/api/audio/${encodeURIComponent(url)}`,
    onChange: () => {},
  });
}

/** Points at the default difficulty. */
const pts = (raw: number) => Math.round(raw * DIFFICULTIES[DEFAULT_SETTINGS.difficulty].multiplier);

const right = (s: Song) => ({ id: s.id, title: s.title, artist: s.artist });
const wrong = { id: 999, title: 'Otra', artist: 'Nadie' };

describe('GameRoom solo', () => {
  let room: GameRoom;
  beforeEach(async () => {
    room = makeRoom(true);
    room.addPlayer('p1', 'Rodri');
    await room.start('p1');
  });

  it('starts the first round at level 0 with audio and no hints', () => {
    const v = room.view('p1');
    expect(v.phase).toBe('playing');
    expect(v.audioUrl).toContain('preview');
    expect(v.me?.level).toBe(0);
    expect(v.me?.hints).toEqual([]);
    expect(v.roundEndsAt).toBeNull();
  });

  it('never leaks the answer while playing', () => {
    expect(JSON.stringify(room.view('p1'))).not.toContain('Ligera');
  });

  it('pays the full value for a correct guess at level 0 and reveals the song', async () => {
    await room.guess('p1', right(SONGS[0]));
    const v = room.view('p1');
    expect(v.phase).toBe('reveal');
    expect(v.me?.points).toBe(pts(LEVELS[0].points));
    expect(v.players[0].score).toBe(pts(LEVELS[0].points));
    expect(v.reveal?.title).toBe('De Música Ligera');
  });

  it('asking for more time raises the level and reveals the year hint', async () => {
    await room.moreTime('p1');
    const v = room.view('p1');
    expect(v.me?.level).toBe(1);
    expect(v.me?.hints.map((h) => h.key)).toEqual(['year']);
    await room.guess('p1', right(SONGS[0]));
    expect(room.view('p1').me?.points).toBe(pts(LEVELS[1].points));
  });

  it('keeps hints in a stable order even when they resolve out of order', async () => {
    const slowYear: SongSource = {
      ...fakeSource(),
      hint: async (s, key) => {
        if (key === 'year') await new Promise((r) => setTimeout(r, 30));
        return { label: key, value: `${key}-of-${s.id}` };
      },
    };
    const r = new GameRoom({
      code: 'SLOW',
      solo: true,
      createSource: () => slowYear,
      registerAudio: (u) => u,
      onChange: () => {},
    });
    r.addPlayer('p1', 'Rodri');
    await r.start('p1');
    await Promise.all([r.buyHint('p1', 'country'), r.moreTime('p1'), r.moreTime('p1')]);
    expect(r.view('p1').me?.hints.map((h) => h.key)).toEqual(['year', 'genre', 'country']);
  });

  it('records wrong guesses without version noise', async () => {
    await room.guess('p1', { id: 7, title: 'Trátame Suavemente Remasterizado 2007', artist: 'Soda Stereo' });
    expect(room.view('p1').me?.wrongGuesses).toEqual(['Trátame Suavemente — Soda Stereo']);
  });

  it('buying an extra hint costs points and cannot be bought twice', async () => {
    await room.buyHint('p1', 'country');
    await room.buyHint('p1', 'country');
    expect(room.view('p1').me?.extraHintsUsed).toEqual(['country']);
    await room.guess('p1', right(SONGS[0]));
    expect(room.view('p1').me?.points).toBe(pts(LEVELS[0].points - EXTRA_HINT_COST));
  });

  it('a wrong guess costs a level, and failing at the last level ends the round with 0', async () => {
    for (let i = 0; i < LAST_LEVEL; i++) await room.guess('p1', wrong);
    expect(room.view('p1').me?.level).toBe(LAST_LEVEL);
    await room.guess('p1', wrong);
    const v = room.view('p1');
    expect(v.me?.status).toBe('failed');
    expect(v.me?.points).toBe(0);
    expect(v.phase).toBe('reveal');
  });

  it('finishes after the configured rounds', async () => {
    room.updateSettings('p1', { rounds: 2 });
    await room.giveUp('p1');
    await room.next('p1');
    expect(room.view('p1').phase).toBe('playing');
    await room.giveUp('p1');
    await room.next('p1');
    expect(room.view('p1').phase).toBe('finished');
  });

  it('finishes early with a message when the source runs out of songs', async () => {
    room.updateSettings('p1', { rounds: 10 });
    await room.giveUp('p1');
    await room.next('p1');
    await room.giveUp('p1');
    await room.next('p1');
    const v = room.view('p1');
    expect(v.phase).toBe('finished');
    expect(v.message).toBeTruthy();
  });
});

describe('GameRoom audio allowance', () => {
  it('lets each player download only what their level allows, and everything at reveal', async () => {
    const allowances = new Map<string, () => number>();
    const room = new GameRoom({
      code: 'AUD',
      solo: false,
      createSource: () => fakeSource(),
      registerAudio: (_url, allowed) => {
        const token = `t${allowances.size}`;
        allowances.set(token, allowed);
        return `/api/audio/${token}`;
      },
      onChange: () => {},
    });
    room.addPlayer('a', 'Ana');
    room.addPlayer('b', 'Beto');
    await room.start('a');

    const urlA = room.view('a').audioUrl!;
    const urlB = room.view('b').audioUrl!;
    expect(urlA).not.toBe(urlB);
    const allowedA = allowances.get(urlA.split('/').pop()!)!;
    const allowedB = allowances.get(urlB.split('/').pop()!)!;

    expect(allowedA()).toBe(LEVELS[0].seconds);
    await room.moreTime('a');
    expect(allowedA()).toBe(LEVELS[1].seconds);
    expect(allowedB()).toBe(LEVELS[0].seconds);

    await room.giveUp('a');
    await room.giveUp('b');
    expect(allowedB()).toBe(Infinity);
    room.dispose();
  });
});

describe('GameRoom start', () => {
  it('stays in the lobby with a message when no songs match the filters', async () => {
    const room = makeRoom(true, []);
    room.addPlayer('p1', 'Rodri');
    await room.start('p1');
    const v = room.view('p1');
    expect(v.phase).toBe('lobby');
    expect(v.message).toBeTruthy();
  });

  it('only the host can start or change settings', async () => {
    const room = makeRoom(false);
    room.addPlayer('host', 'A');
    room.addPlayer('guest', 'B');
    room.updateSettings('guest', { rounds: 9 });
    await room.start('guest');
    expect(room.view('guest').phase).toBe('lobby');
    expect(room.view('guest').settings.rounds).not.toBe(9);
  });

  it('accepts a known theme and ignores an unknown one', () => {
    const room = makeRoom(true);
    room.addPlayer('p1', 'Rodri');
    room.updateSettings('p1', { theme: 'cumbia-villera' });
    expect(room.view('p1').settings.theme).toBe('cumbia-villera');
    room.updateSettings('p1', { theme: 'inventada' });
    expect(room.view('p1').settings.theme).toBe('cumbia-villera');
  });

  it('ignores an unknown difficulty sent by a client', () => {
    const room = makeRoom(true);
    room.addPlayer('p1', 'Rodri');
    room.updateSettings('p1', { difficulty: 'imposible' as never });
    expect(room.view('p1').settings.difficulty).toBe('medium');
  });

  it('passes the host to someone else when the host leaves', () => {
    const room = makeRoom(false);
    room.addPlayer('host', 'A');
    room.addPlayer('guest', 'B');
    room.removePlayer('host');
    expect(room.view('guest').players[0].isHost).toBe(true);
  });
});

describe('GameRoom multiplayer', () => {
  let room: GameRoom;
  beforeEach(async () => {
    vi.useFakeTimers();
    room = makeRoom(false);
    room.addPlayer('a', 'Ana');
    room.addPlayer('b', 'Beto');
    await room.start('a');
  });
  afterEach(() => vi.useRealTimers());

  it('gives the first-correct bonus only to the first player', async () => {
    await room.guess('a', right(SONGS[0]));
    expect(room.view('a').phase).toBe('playing');
    await room.guess('b', right(SONGS[0]));
    expect(room.view('a').me?.points).toBe(pts(LEVELS[0].points) + FIRST_CORRECT_BONUS);
    expect(room.view('b').me?.points).toBe(pts(LEVELS[0].points));
    expect(room.view('a').phase).toBe('reveal');
  });

  it('hides other players private hints', async () => {
    await room.moreTime('a');
    expect(room.view('b').me?.hints).toEqual([]);
    expect(room.view('b').players.find((p) => p.id === 'a')?.level).toBe(1);
  });

  it('fails everyone still playing when the timer runs out', async () => {
    await room.guess('a', right(SONGS[0]));
    await vi.advanceTimersByTimeAsync(room.view('a').settings.roundSeconds * 1000);
    expect(room.view('b').me?.status).toBe('failed');
    expect(room.view('a').phase).toBe('reveal');
  });

  it('does not wait for a disconnected player to end the round', async () => {
    room.setConnected('b', false);
    await room.guess('a', right(SONGS[0]));
    expect(room.view('a').phase).toBe('reveal');
    expect(room.view('a').players.find((p) => p.id === 'b')?.status).toBe('failed');
  });

  it('keeps score and round progress when a player reconnects', async () => {
    await room.moreTime('b');
    room.setConnected('b', false);
    expect(room.view('a').players.find((p) => p.id === 'b')?.connected).toBe(false);
    room.setConnected('b', true);
    const v = room.view('b');
    expect(v.me?.level).toBe(1);
    expect(v.players.find((p) => p.id === 'b')?.connected).toBe(true);
  });

  it('passes the host to a connected player when the host drops', () => {
    room.setConnected('a', false);
    expect(room.view('b').players.find((p) => p.id === 'b')?.isHost).toBe(true);
  });

  it('ends the round when the only player still playing leaves', async () => {
    await room.guess('a', right(SONGS[0]));
    room.removePlayer('b');
    expect(room.view('a').phase).toBe('reveal');
  });
});
