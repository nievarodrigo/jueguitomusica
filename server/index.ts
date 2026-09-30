import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { cleanTitle, normalize, type TrackRef } from '../shared/match';
import type { SearchResult, Settings } from '../shared/types';
import { LAST_LEVEL, LEVELS, type HintKey } from '../shared/game';
import { detectSoundStart } from './analyze';
import { sliceMp3 } from './mp3';
import { DeezerSource } from './pool';
import { GameRoom } from './room';
import { dzList, type DzTrack } from './sources';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
const http = createServer(app);
const io = new Server(http);

// ------------------------------------------------------------ audio proxy

/**
 * The client only ever sees /api/audio/<random token>, never the Deezer track id, and each
 * request gets only the seconds the player has unlocked (plus a small decoding margin).
 */
const PREVIEW_SECONDS = 30;
const SLICE_MARGIN_SECONDS = 0.5;
type AudioEntry = { url: string; allowed: () => number; expires: number };
const audio = new Map<string, AudioEntry>();
/** A downloaded preview plus where its music actually starts (some previews open with silence). */
type Preview = { data: Uint8Array; start: number };
const mp3Cache = new Map<string, { data: Promise<Preview>; expires: number }>();
/** Sound must start early enough to leave room for the longest level inside the 30s preview. */
const MAX_SKIP_SECONDS = PREVIEW_SECONDS - LEVELS[LAST_LEVEL].seconds;

function registerAudio(url: string, allowed: () => number): string {
  const token = randomBytes(12).toString('hex');
  audio.set(token, { url, allowed, expires: Date.now() + 30 * 60_000 });
  return `/api/audio/${token}`;
}

function fetchMp3(url: string): Promise<Preview> {
  let cached = mp3Cache.get(url);
  if (!cached) {
    const data = fetch(url, { signal: AbortSignal.timeout(15_000) }).then(async (r) => {
      if (!r.ok) throw new Error(`preview ${r.status}`);
      const mp3 = new Uint8Array(await r.arrayBuffer());
      return { data: mp3, start: await detectSoundStart(mp3, PREVIEW_SECONDS, MAX_SKIP_SECONDS) };
    });
    data.catch(() => mp3Cache.delete(url));
    cached = { data, expires: Date.now() + 30 * 60_000 };
    mp3Cache.set(url, cached);
  }
  return cached.data;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of audio) if (v.expires < now) audio.delete(k);
  for (const [k, v] of mp3Cache) if (v.expires < now) mp3Cache.delete(k);
}, 60_000).unref();

app.get('/api/audio/:token', async (req, res) => {
  const entry = audio.get(req.params.token);
  if (!entry) return void res.status(404).end();
  const seconds = entry.allowed();
  if (seconds <= 0) return void res.status(403).end();
  try {
    const preview = await fetchMp3(entry.url);
    const body = sliceMp3(preview.data, seconds + SLICE_MARGIN_SECONDS, PREVIEW_SECONDS, preview.start);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  } catch {
    res.status(502).end();
  }
});

// ------------------------------------------------------------ search (guess autocomplete)

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return void res.json([]);
  try {
    const tracks = await dzList<DzTrack>(`/search?q=${encodeURIComponent(q)}&limit=25`);
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const t of tracks) {
      const title = cleanTitle(t.title);
      const key = `${normalize(title)}|${normalize(t.artist.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ id: t.id, title, artist: t.artist.name, cover: t.album.cover_small ?? '' });
      if (results.length === 8) break;
    }
    res.json(results);
  } catch {
    res.status(502).json([]);
  }
});

// ------------------------------------------------------------ rooms

const rooms = new Map<string, GameRoom>();

/**
 * A player is identified by a private id the browser keeps (handshake auth), not by the socket:
 * sockets change on every reconnect. Rooms only ever see a public seat id, so leaking it
 * to other players does not let anyone take over someone else's seat.
 */
type Seat = { room: GameRoom; seat: string; grace?: ReturnType<typeof setTimeout> };
const seats = new Map<string, Seat>();
const RECONNECT_GRACE_MS = 60_000;

function newCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code: string;
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

function pidOf(socket: Socket): string {
  const pid = (socket.handshake.auth as { pid?: unknown } | undefined)?.pid;
  return typeof pid === 'string' && /^[\w-]{16,64}$/.test(pid) ? pid : socket.id;
}

function broadcast(room: GameRoom) {
  for (const id of io.sockets.adapter.rooms.get(room.code) ?? []) {
    const seat = seats.get(io.sockets.sockets.get(id)?.data.pid);
    if (seat?.room === room) io.to(id).emit('room', room.view(seat.seat));
  }
}

function createRoom(solo: boolean): GameRoom {
  const code = newCode();
  const room: GameRoom = new GameRoom({
    code,
    solo,
    createSource: (settings: Settings) => new DeezerSource(settings),
    registerAudio,
    onChange: () => broadcast(room),
  });
  rooms.set(code, room);
  return room;
}

function join(socket: Socket, room: GameRoom, name: string) {
  const pid: string = socket.data.pid;
  leave(pid);
  const seat = randomBytes(8).toString('hex');
  seats.set(pid, { room, seat });
  socket.join(room.code);
  room.addPlayer(seat, name);
}

function leave(pid: string) {
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

io.on('connection', (socket) => {
  const pid = pidOf(socket);
  socket.data.pid = pid;

  // Coming back after a network drop: resume the same seat.
  const existing = seats.get(pid);
  if (existing) {
    clearTimeout(existing.grace);
    existing.grace = undefined;
    socket.join(existing.room.code);
    existing.room.setConnected(existing.seat, true);
    socket.emit('room', existing.room.view(existing.seat));
  } else {
    socket.emit('room', null);
  }

  const seat = () => seats.get(pid);
  const act =
    <A extends unknown[]>(fn: (room: GameRoom, seat: string, ...args: A) => unknown) =>
    async (...args: A) => {
      const s = seat();
      if (!s) return;
      try {
        await fn(s.room, s.seat, ...args);
      } catch (err) {
        console.error('[socket]', err);
        socket.emit('toast', 'Algo salió mal, probá de nuevo.');
      }
    };

  socket.on('create', ({ name, solo }: { name: string; solo: boolean }) => join(socket, createRoom(!!solo), name));
  socket.on('join', ({ name, code }: { name: string; code: string }) => {
    const target = rooms.get(String(code).toUpperCase().trim());
    if (!target || target.solo) return void socket.emit('toast', 'No existe una sala con ese código.');
    join(socket, target, name);
  });
  socket.on('leave', () => {
    leave(pid);
    socket.emit('room', null);
  });
  socket.on('settings', act((r, id, patch: Partial<Settings>) => r.updateSettings(id, patch)));
  socket.on('start', act((r, id) => r.start(id)));
  socket.on('next', act((r, id) => r.next(id)));
  socket.on('lobby', act((r, id) => r.backToLobby(id)));
  socket.on('moreTime', act((r, id) => r.moreTime(id)));
  socket.on('hint', act((r, id, key: HintKey) => r.buyHint(id, key)));
  socket.on('guess', act((r, id, guess: TrackRef) => r.guess(id, guess)));
  socket.on('giveUp', act((r, id) => r.giveUp(id)));

  socket.on('disconnect', () => {
    const s = seat();
    if (!s) return;
    const stillHere = [...io.sockets.sockets.values()].some((o) => o.id !== socket.id && o.data.pid === pid);
    if (stillHere) return;
    s.room.setConnected(s.seat, false);
    clearTimeout(s.grace);
    s.grace = setTimeout(() => leave(pid), RECONNECT_GRACE_MS);
  });
});

// ------------------------------------------------------------ static (production)

const dist = path.resolve(import.meta.dirname, '../dist');
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

if (!process.env.VERCEL) {
  http.listen(PORT, () => console.log(`🎵 jueguitomusica server on http://localhost:${PORT}`));
}

export default http;
