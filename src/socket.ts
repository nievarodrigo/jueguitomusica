import { io } from 'socket.io-client';
import type { HintKey } from '../shared/game';
import type { TrackRef } from '../shared/match';
import type { Settings } from '../shared/types';

/** Private per-tab identity: survives reconnects and reloads so you keep your seat. */
function playerId(): string {
  const KEY = 'jm:pid';
  try {
    let pid = sessionStorage.getItem(KEY);
    if (!pid) {
      pid = crypto.randomUUID();
      sessionStorage.setItem(KEY, pid);
    }
    return pid;
  } catch {
    return crypto.randomUUID();
  }
}

export const socket = io({ auth: { pid: playerId() }, path: '/socket.io/connect', addTrailingSlash: false, transports: ['websocket'] });

export const actions = {
  create: (name: string, solo: boolean) => socket.emit('create', { name, solo }),
  join: (name: string, code: string) => socket.emit('join', { name, code }),
  leave: () => socket.emit('leave'),
  settings: (patch: Partial<Settings>) => socket.emit('settings', patch),
  start: () => socket.emit('start'),
  next: () => socket.emit('next'),
  lobby: () => socket.emit('lobby'),
  moreTime: () => socket.emit('moreTime'),
  hint: (key: HintKey) => socket.emit('hint', key),
  guess: (guess: TrackRef) => socket.emit('guess', guess),
  giveUp: () => socket.emit('giveUp'),
};
