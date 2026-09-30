import { LEVELS } from '../../shared/game';
import type { PlayerStatus, RoomView } from '../../shared/types';

const STATUS: Record<PlayerStatus, string> = {
  waiting: '⏳',
  playing: '🎧',
  correct: '✅',
  failed: '❌',
};

export function Scoreboard({ room, showScore = true }: { room: RoomView; showScore?: boolean }) {
  const inRound = room.phase === 'playing' || room.phase === 'reveal';
  return (
    <ol className="scoreboard">
      {room.players.map((p, i) => (
        <li key={p.id} className={[p.id === room.meId && 'me', !p.connected && 'away'].filter(Boolean).join(' ')}>
          {showScore && <span className="pos mono">{i + 1}</span>}
          <span className="name">
            {p.name}
            {p.isHost && <small className="tag">host</small>}
            {!p.connected && <small className="tag">desconectado</small>}
          </span>
          {inRound && (
            <span className="status" title={p.status}>
              {STATUS[p.status]}
              {p.status === 'playing' && <small className="mono"> {LEVELS[p.level].seconds}s</small>}
              {room.phase === 'reveal' && p.roundPoints > 0 && <small className="gain">+{p.roundPoints}</small>}
            </span>
          )}
          {showScore && <b className="mono score">{p.score}</b>}
        </li>
      ))}
    </ol>
  );
}
