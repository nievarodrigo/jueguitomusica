import { useState } from 'react';
import { LEVELS } from '../../shared/game';
import { actions } from '../socket';

const NAME_KEY = 'jm:name';
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

export function Home() {
  const [name, setName] = useState(readName);
  const [code, setCode] = useState('');
  const player = name.trim() || 'Anónimo';

  const remember = () => {
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      /* private mode */
    }
  };

  return (
    <section className="home">
      <div className="hero">
        <h1>
          ¿La sacás en <em>0.3</em> segundos?
        </h1>
        <p className="lead">
          Escuchá un fragmento cortísimo y adiviná la canción. Si necesitás más tiempo o pistas, la canción vale
          menos.
        </p>
        <ol className="ladder" aria-label="Niveles">
          {LEVELS.map((l) => (
            <li key={l.seconds}>
              <span className="mono">{l.seconds}s</span>
              <b>{l.points}</b>
            </li>
          ))}
        </ol>
      </div>

      <div className="card stack">
        <label className="field">
          <span>Tu nombre</span>
          <input
            value={name}
            maxLength={20}
            placeholder="Ej: Rodri"
            onChange={(e) => setName(e.target.value)}
            onBlur={remember}
          />
        </label>

        <button
          className="btn primary big"
          onClick={() => {
            remember();
            actions.create(player, true);
          }}
        >
          Jugar solo
        </button>

        <div className="divider">
          <span>online con amigos</span>
        </div>

        <button
          className="btn"
          onClick={() => {
            remember();
            actions.create(player, false);
          }}
        >
          Crear sala
        </button>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim().length < 4) return;
            remember();
            actions.join(player, code);
          }}
        >
          <input
            className="code-input mono"
            value={code}
            maxLength={4}
            placeholder="CÓDIGO"
            aria-label="Código de sala"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn" type="submit" disabled={code.trim().length < 4}>
            Unirme
          </button>
        </form>
      </div>
    </section>
  );
}
