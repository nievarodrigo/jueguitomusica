import { useEffect, useRef, useState } from 'react';
import type { SearchResult } from '../../shared/types';

/** Autocomplete over Deezer: a guess is always a real track, so "soda stereo musica ligera" typos don't matter. */
export function GuessInput({ onGuess, disabled }: { onGuess: (r: SearchResult) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<SearchResult[]>)
        .then((data) => {
          setResults(data);
          setActive(0);
          setOpen(true);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const pick = (r: SearchResult) => {
    onGuess(r);
    setQ('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="guess">
      <input
        ref={inputRef}
        value={q}
        disabled={disabled}
        placeholder="Escribí canción o artista…"
        aria-label="Tu respuesta"
        aria-autocomplete="list"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="suggestions" role="listbox">
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
            >
              {r.cover && <img src={r.cover} alt="" width={36} height={36} />}
              <span>
                <b>{r.title}</b>
                <small>{r.artist}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
