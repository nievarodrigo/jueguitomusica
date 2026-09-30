import { roundPoints } from '../../shared/game';
import type { RoomView } from '../../shared/types';
import { actions } from '../socket';
import { Scoreboard } from './Scoreboard';

export function Final({ room }: { room: RoomView }) {
  const isHost = !!room.players.find((p) => p.id === room.meId)?.isHost;
  const winner = room.players[0];
  const max = room.settings.rounds * roundPoints({ level: 0, extraHints: 0, difficulty: room.settings.difficulty });

  return (
    <section className="final stack">
      {room.solo ? (
        <>
          <p className="muted">Puntaje final</p>
          <h1 className="mono big-score">{winner?.score ?? 0}</h1>
          <p className="muted">de {max} posibles</p>
        </>
      ) : (
        <>
          <p className="muted">Ganó</p>
          <h1>🏆 {winner?.name}</h1>
          <div className="card">
            <Scoreboard room={room} />
          </div>
        </>
      )}
      {room.message && <p className="notice">{room.message}</p>}
      <div className="row actions">
        <button className="btn ghost" onClick={actions.leave}>
          Salir
        </button>
        {isHost && (
          <>
            <button className="btn" onClick={actions.lobby}>
              Cambiar filtros
            </button>
            <button className="btn primary big" onClick={actions.start}>
              Jugar de nuevo
            </button>
          </>
        )}
      </div>
    </section>
  );
}
