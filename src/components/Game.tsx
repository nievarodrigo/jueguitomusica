import { useEffect, useRef, useState } from 'react';
import { DIFFICULTIES, EXTRA_HINTS, EXTRA_HINT_COST, LAST_LEVEL, LEVELS, roundPoints } from '../../shared/game';
import { themeById } from '../../shared/themes';
import type { RoomView } from '../../shared/types';
import { SnippetPlayer } from '../audio';
import { actions } from '../socket';
import { GuessInput } from './GuessInput';
import { Scoreboard } from './Scoreboard';

/** Log scale so 0.3s is still visible next to 15s. */
const MAX_SECONDS = LEVELS[LAST_LEVEL].seconds;
const scale = (s: number) => Math.log1p(s) / Math.log1p(MAX_SECONDS);

type AudioState = 'loading' | 'ready' | 'error';

export function Game({ room }: { room: RoomView }) {
  const player = useRef<SnippetPlayer>(null);
  player.current ??= new SnippetPlayer();
  const [audio, setAudio] = useState<AudioState>('loading');
  const [playing, setPlaying] = useState<{ start: number; seconds: number } | null>(null);
  const me = room.me;
  const level = me?.level ?? 0;
  const isHost = !!room.players.find((p) => p.id === room.meId)?.isHost;

  // The server only hands out the seconds you've unlocked, so each level (and the reveal) is a new download.
  const revealed = room.phase === 'reveal';
  useEffect(() => {
    if (!room.audioUrl) return;
    setAudio('loading');
    player.current!.load(`${room.audioUrl}?s=${revealed ? 'full' : level}`).then(
      () => setAudio('ready'),
      () => setAudio('error'),
    );
  }, [room.audioUrl, level, revealed]);

  useEffect(() => () => player.current?.stop(), []);

  const play = (seconds: number) => {
    player.current!
      .play(seconds, () => setPlaying(null))
      .then(() => setPlaying({ start: performance.now(), seconds }))
      .catch(() => setAudio('error'));
  };

  // Asking for more time (or missing a guess) plays the longer snippet right away.
  const prevLevel = useRef(level);
  useEffect(() => {
    if (level > prevLevel.current && me?.status === 'playing' && audio === 'ready') play(LEVELS[level].seconds);
    prevLevel.current = level;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  // New round: reset.
  useEffect(() => {
    prevLevel.current = 0;
    player.current!.stop();
    setPlaying(null);
  }, [room.roundIndex]);

  if (room.phase === 'loading') {
    return (
      <section className="game center">
        <div className="vinyl spin" aria-hidden />
        <p className="muted">Buscando la próxima canción…</p>
      </section>
    );
  }

  const reveal = room.phase === 'reveal' ? room.reveal : null;
  const difficulty = room.settings.difficulty;
  const theme = themeById(room.settings.theme);
  const potential = me ? roundPoints({ level, extraHints: me.extraHintsUsed.length, difficulty }) : 0;
  const soloScore = room.players.find((p) => p.id === room.meId)?.score ?? 0;
  const lastRound = room.roundIndex + 1 >= room.settings.rounds;

  return (
    <section className="game">
      <div className="topbar">
        <span className="mono">
          Canción {room.roundIndex + 1}/{room.settings.rounds}
          {theme && ` · ${theme.emoji} ${theme.label}`} · {DIFFICULTIES[difficulty].label}
        </span>
        {room.roundEndsAt && <Countdown until={room.roundEndsAt} />}
        {room.solo && <span className="mono">Puntaje {soloScore}</span>}
      </div>

      <div className="game-grid">
        <div className="stack">
          <div className="card deck">
            {reveal ? (
              <Reveal room={room} onListen={() => play(30)} audio={audio} />
            ) : (
              <>
                <button
                  className={`play ${playing ? 'is-playing' : ''}`}
                  disabled={audio !== 'ready' || me?.status !== 'playing'}
                  onClick={() => (playing ? (player.current!.stop(), setPlaying(null)) : play(LEVELS[level].seconds))}
                  aria-label={playing ? 'Detener' : `Escuchar ${LEVELS[level].seconds} segundos`}
                >
                  {audio === 'loading' ? '…' : playing ? '■' : '▶'}
                </button>
                <Track level={level} playing={playing} />
                <p className="worth">
                  {me?.status === 'playing' ? (
                    <>
                      Si la sacás ahora: <b className="mono">{potential}</b> pts
                    </>
                  ) : me?.status === 'correct' ? (
                    <>
                      ¡La sacaste! <b className="mono">+{me.points}</b> · esperando al resto…
                    </>
                  ) : me?.status === 'waiting' ? (
                    <>Entraste a mitad de ronda: jugás desde la próxima.</>
                  ) : (
                    <>No la sacaste · esperando al resto…</>
                  )}
                </p>
                {audio === 'error' && <p className="notice">No pude cargar el audio de esta canción.</p>}
              </>
            )}
          </div>

          {me?.status === 'playing' && !reveal && (
            <>
              <GuessInput onGuess={(r) => actions.guess({ id: r.id, title: r.title, artist: r.artist })} />
              {me.wrongGuesses.length > 0 && (
                <ul className="wrong">
                  {me.wrongGuesses.map((g, i) => (
                    <li key={i}>✗ {g}</li>
                  ))}
                </ul>
              )}
              <div className="row">
                {level < LAST_LEVEL ? (
                  <button className="btn grow" onClick={actions.moreTime}>
                    Escuchar {LEVELS[level + 1].seconds}s{' '}
                    <small>
                      (vale {roundPoints({ level: level + 1, extraHints: me.extraHintsUsed.length, difficulty })})
                    </small>
                  </button>
                ) : null}
                <button className="btn ghost" onClick={actions.giveUp}>
                  Me rindo
                </button>
              </div>
            </>
          )}

          {reveal && (
            <div className="row actions">
              {isHost ? (
                <button className="btn primary big" onClick={actions.next}>
                  {lastRound ? 'Ver resultados' : 'Siguiente canción →'}
                </button>
              ) : (
                <p className="muted">Esperando al host…</p>
              )}
            </div>
          )}
        </div>

        <aside className="stack">
          {me && (me.hints.length > 0 || me.status === 'playing') && (
            <div className="card">
              <h3>Pistas</h3>
              <ul className="hints">
                {me.hints.map((h) => (
                  <li key={h.key}>
                    <small>{h.label}</small>
                    {h.key === 'titlePattern' ? <TitlePattern pattern={h.value} /> : <b>{h.value}</b>}
                  </li>
                ))}
              </ul>
              {me.status === 'playing' && !reveal && (
                <div className="buy">
                  {EXTRA_HINTS.filter((h) => !me.extraHintsUsed.includes(h.key)).map((h) => (
                    <button key={h.key} className="chip" onClick={() => actions.hint(h.key)}>
                      {h.label} <small>−{EXTRA_HINT_COST}</small>
                    </button>
                  ))}
                </div>
              )}
              {me.status === 'playing' && level < LAST_LEVEL && (
                <p className="muted small">Pedir más tiempo también te da una pista gratis.</p>
              )}
            </div>
          )}
          {!room.solo && (
            <div className="card">
              <h3>Tabla</h3>
              <Scoreboard room={room} />
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Track({ level, playing }: { level: number; playing: { start: number; seconds: number } | null }) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    if (!playing) {
      el.style.width = '0%';
      return;
    }
    let raf = 0;
    const tick = () => {
      const elapsed = Math.min((performance.now() - playing.start) / 1000, playing.seconds);
      el.style.width = `${scale(elapsed) * 100}%`;
      if (elapsed < playing.seconds) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className="track" aria-hidden>
      <div className="track-unlocked" style={{ width: `${scale(LEVELS[level].seconds) * 100}%` }} />
      <div className="track-fill" ref={fillRef} />
      {LEVELS.map((l, i) => (
        <span
          key={l.seconds}
          className={`tick ${i <= level ? 'on' : ''}`}
          style={{ left: `${scale(l.seconds) * 100}%` }}
        >
          <small className="mono">{l.seconds}s</small>
        </span>
      ))}
    </div>
  );
}

function Reveal({ room, onListen, audio }: { room: RoomView; onListen: () => void; audio: AudioState }) {
  const song = room.reveal!;
  const me = room.me;
  return (
    <div className="reveal">
      {song.cover && <img src={song.cover} alt="" width={160} height={160} />}
      <div className="stack">
        <p className={`verdict ${me?.status === 'correct' ? 'ok' : 'ko'}`}>
          {me?.status === 'correct' ? `¡La sacaste! +${me.points}` : 'Esta vez no…'}
        </p>
        <h2>{song.title}</h2>
        <p className="artist">
          {song.artist}
          {song.year ? <span className="muted"> · {song.year}</span> : null}
        </p>
        <div className="row">
          <button className="btn" onClick={onListen} disabled={audio !== 'ready'}>
            ▶ Escuchar
          </button>
          <a className="btn ghost" href={song.link} target="_blank" rel="noreferrer">
            Abrir en Deezer ↗
          </a>
        </div>
      </div>
    </div>
  );
}

/** "__ ______" as separate dashes per letter so you can actually count them. */
function TitlePattern({ pattern }: { pattern: string }) {
  const words = pattern.split(' ').filter(Boolean);
  return (
    <span className="pattern" aria-label={words.map((w) => `${w.length} letras`).join(', ')}>
      {words.map((word, i) => (
        <span className="word" key={i}>
          {[...word].map((c, j) => (c === '_' ? <i key={j} /> : <b key={j}>{c}</b>))}
          <small>{word.replace(/[^_]/g, '').length}</small>
        </span>
      ))}
    </span>
  );
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return <span className={`mono countdown ${left <= 10 ? 'hurry' : ''}`}>⏱ {left}s</span>;
}
