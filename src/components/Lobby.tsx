import { useState } from 'react';
import { DIFFICULTIES, type Difficulty } from '../../shared/game';
import { THEMES } from '../../shared/themes';
import { COUNTRIES, GENRES, type RoomView, type Settings } from '../../shared/types';
import { actions } from '../socket';
import { Scoreboard } from './Scoreboard';

const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];
const CURRENT_YEAR = new Date().getFullYear();

export function Lobby({ room }: { room: RoomView }) {
  const me = room.players.find((p) => p.id === room.meId);
  const isHost = !!me?.isHost;
  const s = room.settings;
  const set = (patch: Partial<Settings>) => actions.settings(patch);
  const decadeActive = (d: number) => s.yearFrom === d && s.yearTo === Math.min(d + 9, CURRENT_YEAR);
  const hasManualFilters = !!(s.genre || s.country || s.yearFrom !== null || s.yearTo !== null);
  const [customOpen, setCustomOpen] = useState(hasManualFilters);
  const custom = !s.theme && (customOpen || hasManualFilters);
  const everything = !s.theme && !custom;
  const clearManual = { genre: '', country: '', yearFrom: null, yearTo: null };

  return (
    <section className="lobby">
      <div className="lobby-head">
        {room.solo ? (
          <h2>Armá tu partida</h2>
        ) : (
          <>
            <p className="muted">Pasales este código a tus amigos</p>
            <h2 className="room-code mono">{room.code}</h2>
          </>
        )}
      </div>

      <div className="lobby-grid">
        <fieldset className="card stack" disabled={!isHost}>
          <legend>¿Qué escuchamos? {!isHost && <span className="muted">(elige el host)</span>}</legend>

          <div className="themes" role="radiogroup" aria-label="Temática">
            <button
              type="button"
              role="radio"
              aria-checked={everything}
              className={`theme ${everything ? 'on' : ''}`}
              onClick={() => {
                setCustomOpen(false);
                set({ theme: '', ...clearManual });
              }}
            >
              <span className="emoji" aria-hidden>
                🎲
              </span>
              <b>De todo</b>
              <small>Sorpresa total</small>
            </button>
            {THEMES.map((t) => (
              <button
                type="button"
                key={t.id}
                role="radio"
                aria-checked={s.theme === t.id}
                className={`theme ${s.theme === t.id ? 'on' : ''}`}
                onClick={() => {
                  setCustomOpen(false);
                  set({ theme: t.id });
                }}
              >
                <span className="emoji" aria-hidden>
                  {t.emoji}
                </span>
                <b>{t.label}</b>
                <small>{t.description}</small>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={custom}
              className={`theme ${custom ? 'on' : ''}`}
              onClick={() => {
                setCustomOpen(true);
                set({ theme: '' });
              }}
            >
              <span className="emoji" aria-hidden>
                ⚙️
              </span>
              <b>A mi manera</b>
              <small>Elegí época, género y país</small>
            </button>
          </div>

          <div className="field">
            <span>Dificultad</span>
            <div className="difficulty" role="radiogroup" aria-label="Dificultad">
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
                <button
                  type="button"
                  key={d}
                  role="radio"
                  aria-checked={s.difficulty === d}
                  className={`diff ${s.difficulty === d ? 'on' : ''}`}
                  onClick={() => set({ difficulty: d })}
                >
                  <b>{DIFFICULTIES[d].label}</b>
                  <small>{DIFFICULTIES[d].description}</small>
                  <span className="mono mult">×{DIFFICULTIES[d].multiplier}</span>
                </button>
              ))}
            </div>
          </div>

          {custom && (
            <>
              <div className="field">
                <span>Época</span>
                <div className="chips">
                  <button
                    type="button"
                    className={`chip ${s.yearFrom === null && s.yearTo === null ? 'on' : ''}`}
                    onClick={() => set({ yearFrom: null, yearTo: null })}
                  >
                    Todas
                  </button>
                  {DECADES.map((d) => (
                    <button
                      type="button"
                      key={d}
                      className={`chip ${decadeActive(d) ? 'on' : ''}`}
                      onClick={() => set({ yearFrom: d, yearTo: Math.min(d + 9, CURRENT_YEAR) })}
                    >
                      {d < 2000 ? `'${String(d).slice(2)}` : d}s
                    </button>
                  ))}
                </div>
                <div className="row">
                  <input
                    type="number"
                    aria-label="Desde el año"
                    placeholder="Desde"
                    min={1950}
                    max={CURRENT_YEAR}
                    value={s.yearFrom ?? ''}
                    onChange={(e) => set({ yearFrom: e.target.value ? Number(e.target.value) : null })}
                  />
                  <span className="muted">a</span>
                  <input
                    type="number"
                    aria-label="Hasta el año"
                    placeholder="Hasta"
                    min={1950}
                    max={CURRENT_YEAR}
                    value={s.yearTo ?? ''}
                    onChange={(e) => set({ yearTo: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
              </div>

              <label className="field">
                <span>Género</span>
                <select value={s.genre} onChange={(e) => set({ genre: e.target.value })}>
                  {GENRES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>País</span>
                <select value={s.country} onChange={(e) => set({ country: e.target.value })}>
                  {COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <div className="row">
            <label className="field grow">
              <span>Canciones</span>
              <select value={s.rounds} onChange={(e) => set({ rounds: Number(e.target.value) })}>
                {[3, 5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {!room.solo && (
              <label className="field grow">
                <span>Tiempo por ronda</span>
                <select value={s.roundSeconds} onChange={(e) => set({ roundSeconds: Number(e.target.value) })}>
                  {[45, 60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </fieldset>

        {!room.solo && (
          <div className="card">
            <h3>Jugadores ({room.players.length})</h3>
            <Scoreboard room={room} showScore={false} />
          </div>
        )}
      </div>

      {room.message && <p className="notice">{room.message}</p>}

      <div className="row actions">
        <button className="btn ghost" onClick={actions.leave}>
          Salir
        </button>
        {isHost ? (
          <button className="btn primary big" onClick={actions.start}>
            ¡Arrancar!
          </button>
        ) : (
          <p className="muted">Esperando que el host arranque…</p>
        )}
      </div>
    </section>
  );
}
