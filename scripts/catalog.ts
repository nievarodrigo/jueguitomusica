/**
 * Catalog report: which songs each theme serves, per difficulty.
 * Uses the exact same functions the game uses (fetchPlaylists → consensus → rankTiers), so the
 * page shows what a game would actually draw from. Playlists change over time: re-run to refresh.
 *
 *   npm run catalog [-- out.html]
 */
import { writeFileSync } from 'node:fs';
import { cleanTitle } from '../shared/match';
import { THEMES } from '../shared/themes';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import {
  consensus,
  effectiveSettings,
  fetchPlaylists,
  inRange,
  isJunk,
  rankTiers,
  releaseYear,
  songKey,
  yearVerdict,
} from '../server/pool';
import { dz, musicBrainzInfo, type DzTrack } from '../server/sources';

type Status = 'ok' | 'junk' | 'year-out';
type Row = { t: string; a: string; r: number; v: number; y: number | null; s: Status };
type ThemeReport = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  queries: string[];
  yearTo: number | null;
  playlists: { id: number; title: string }[];
  needed: number;
  tiers: [Row[], Row[], Row[]];
  reserve: Row[];
};

const out = process.argv[2] ?? 'catalog.html';

async function yearStatus(t: DzTrack, settings: Settings): Promise<{ year: number | null; status: Status }> {
  if (settings.yearFrom === null && settings.yearTo === null) return { year: null, status: 'ok' };
  const full = await dz<DzTrack>(`/track/${t.id}`);
  const deezerYear = releaseYear(full);
  const verdict = yearVerdict(deezerYear, settings);
  if (verdict === 'accept') return { year: deezerYear, status: 'ok' };
  if (verdict === 'reject') return { year: deezerYear, status: 'year-out' };
  // Same slow path as the game: late Deezer dates are checked against the original year.
  const info = await musicBrainzInfo(full.isrc, full.title, full.artist.name);
  return info.year && inRange(info.year, settings)
    ? { year: info.year, status: 'ok' }
    : { year: info.year ?? deezerYear, status: 'year-out' };
}

async function report(theme: (typeof THEMES)[number]): Promise<ThemeReport> {
  const settings = effectiveSettings({ ...DEFAULT_SETTINGS, theme: theme.id });
  const { playlists, lists } = await fetchPlaylists(settings);
  const { votes, needed, core, reserve } = consensus(lists);
  const { sorted, cuts } = rankTiers(core);

  const rows: Row[] = [];
  for (const t of sorted) {
    const junk = isJunk(t);
    const { year, status } = junk ? { year: null, status: 'junk' as Status } : await yearStatus(t, settings);
    rows.push({
      t: cleanTitle(t.title),
      a: t.artist.name,
      r: t.rank,
      v: votes.get(songKey(t)) ?? 0,
      y: year,
      s: status,
    });
  }
  const reserveRows = rankTiers(reserve).sorted.map<Row>((t) => ({
    t: cleanTitle(t.title),
    a: t.artist.name,
    r: t.rank,
    v: votes.get(songKey(t)) ?? 0,
    y: null,
    s: isJunk(t) ? 'junk' : 'ok',
  }));

  return {
    id: theme.id,
    label: theme.label,
    emoji: theme.emoji,
    description: theme.description,
    queries: theme.queries,
    yearTo: theme.yearTo ?? null,
    playlists,
    needed,
    tiers: [rows.slice(cuts[0], cuts[1]), rows.slice(cuts[1], cuts[2]), rows.slice(cuts[2], cuts[3])],
    reserve: reserveRows,
  };
}

async function main() {
  const reports: ThemeReport[] = [];
  for (const theme of THEMES) {
    const t0 = Date.now();
    reports.push(await report(theme));
    const r = reports.at(-1)!;
    console.log(
      `${theme.emoji} ${theme.label.padEnd(20)} ${r.tiers.map((x) => x.filter((s) => s.s === 'ok').length).join(' / ')} playable (easy/medium/hard) · reserve ${r.reserve.length} · ${Date.now() - t0}ms`,
    );
  }

  const data = JSON.stringify({ generatedAt: new Date().toISOString(), themes: reports }).replace(/</g, '\\u003c');
  writeFileSync(
    out,
    TEMPLATE.replace('__DATA__', () => data),
  );
  console.log(`\nWrote ${out}`);
}

// --------------------------------------------------------------------------------------- page

const TEMPLATE = String.raw`<title>Catálogo jueguitomúsica</title>
<meta name="description" content="Qué canciones sirve cada temática del juego, por dificultad.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=JetBrains+Mono:wght@400;700&display=swap">
<style>
:root {
  --bg: #f4efe6; --surface: #fffaf2; --ink: #1a1320; --muted: #6d6474; --line: #e2d8c9;
  --accent: #ff3d6e; --accent-soft: rgba(255, 61, 110, 0.12); --ok: #2f9e44; --warn: #b7791f; --strike: #a0949f;
  --mark: #ffe066;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #110d16; --surface: #1b1622; --ink: #f4eefb; --muted: #a399ad; --line: #2e2638;
    --accent: #ff4f7b; --accent-soft: rgba(255, 79, 123, 0.16); --ok: #b5f23d; --warn: #f2b33d; --strike: #6d6474;
    --mark: #7a5a00; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #110d16; --surface: #1b1622; --ink: #f4eefb; --muted: #a399ad; --line: #2e2638;
  --accent: #ff4f7b; --accent-soft: rgba(255, 79, 123, 0.16); --ok: #b5f23d; --warn: #f2b33d; --strike: #6d6474;
  --mark: #7a5a00; color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.45 "Bricolage Grotesque", system-ui, sans-serif;
}
.wrap { max-width: 1180px; margin: 0 auto; padding-inline: 16px; padding-block: 24px 64px; display: grid; gap: 20px; }
.mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
h1 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.2rem); letter-spacing: -0.02em; text-wrap: balance; }
h1 b { color: var(--accent); }
.sub { margin: 4px 0 0; color: var(--muted); }
.search { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.search input {
  flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--surface);
  border: 1.5px solid var(--line); border-radius: 12px; padding: 11px 14px;
}
.search input:focus-visible, .chip:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.hitsum { color: var(--muted); font-size: 0.9rem; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  font: inherit; font-size: 0.92rem; cursor: pointer; display: inline-flex; gap: 6px; align-items: center;
  border: 1.5px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 6px 12px;
}
.chip:hover { border-color: var(--ink); }
.chip[aria-selected="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.chip .count { font-size: 0.75rem; background: var(--accent); color: #fff; border-radius: 999px; padding: 0 7px; }
.chip.dim { opacity: 0.45; }
.summary { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); font-size: 0.9rem; }
.summary b { color: var(--ink); }
.cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.col { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 14px; min-width: 0; }
.col h2 { margin: 0 0 2px; font-size: 1.05rem; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.col h2 small { color: var(--muted); font-weight: 400; font-size: 0.8rem; }
.col p.range { margin: 0 0 10px; color: var(--muted); font-size: 0.78rem; }
ol.songs { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.songs li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 6px 8px; border-radius: 8px; }
.songs li:hover { background: var(--accent-soft); }
.songs .t { font-weight: 600; overflow-wrap: anywhere; }
.songs .a { color: var(--muted); font-size: 0.85rem; grid-column: 1; overflow-wrap: anywhere; }
.songs .meta { grid-row: 1 / span 2; grid-column: 2; text-align: right; font-size: 0.72rem; color: var(--muted); display: grid; align-content: center; gap: 2px; }
.votes { color: var(--ink); font-weight: 700; }
.songs li.junk .t, .songs li.year-out .t { text-decoration: line-through; color: var(--strike); }
.why { font-size: 0.72rem; color: var(--warn); grid-column: 1; }
mark { background: var(--mark); color: inherit; border-radius: 3px; padding: 0 1px; }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; }
summary { cursor: pointer; font-weight: 600; }
details .inner { margin-top: 10px; }
.reserve-note, .pl { color: var(--muted); font-size: 0.85rem; margin: 0 0 8px; }
.pl-list { margin: 0; padding-left: 18px; color: var(--muted); font-size: 0.88rem; display: grid; gap: 2px; }
.pl-list a { color: var(--ink); }
.empty { color: var(--muted); font-size: 0.85rem; padding: 6px 8px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.8rem; color: var(--muted); }
@media (max-width: 820px) { .cols { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">
  <header>
    <h1>Catálogo <b>jueguitomúsica</b></h1>
    <p class="sub" id="generated"></p>
  </header>

  <div class="search">
    <input id="q" type="search" placeholder="Buscar artista o canción (ej: pibes chorros)" aria-label="Buscar artista o canción" autocomplete="off">
    <span class="hitsum" id="hitsum" role="status"></span>
  </div>

  <nav class="chips" id="tabs" role="tablist" aria-label="Temáticas"></nav>

  <section id="theme" aria-live="polite"></section>
</div>

<script>
const DATA = __DATA__;
const LEVELS = ['Fácil', 'Medio', 'Difícil'];
const fmt = new Intl.NumberFormat('es-AR');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const state = { theme: DATA.themes[0].id, q: '' };
try { const saved = localStorage.getItem('catalog:theme'); if (saved && DATA.themes.some((t) => t.id === saved)) state.theme = saved; } catch {}

document.getElementById('generated').textContent =
  'Generado el ' + new Date(DATA.generatedAt).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' }) +
  ' con la misma lógica que usa el juego. Las playlists de Deezer cambian: regeneralo con npm run catalog.';

const matches = (row) => !state.q || norm(row.t + ' ' + row.a).includes(state.q);
const hitCount = (theme) => theme.tiers.flat().filter((r) => r.s === 'ok' && matches(r)).length;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function highlight(text) {
  const frag = document.createDocumentFragment();
  if (!state.q) { frag.append(text); return frag; }
  const n = norm(text);
  let i = 0, at;
  while ((at = n.indexOf(state.q, i)) !== -1) {
    frag.append(text.slice(i, at), el('mark', { text: text.slice(at, at + state.q.length) }));
    i = at + state.q.length;
  }
  frag.append(text.slice(i));
  return frag;
}

function songRow(r) {
  const why = r.s === 'junk' ? 'Descartado: cover, karaoke o tributo'
    : r.s === 'year-out' ? 'Descartado: fuera de años' + (r.y ? ' (' + r.y + ')' : '') : null;
  return el('li', { class: r.s },
    el('span', { class: 't' }, highlight(r.t)),
    el('span', { class: 'meta mono' },
      el('span', { class: 'votes', title: 'Aparece en ' + r.v + ' playlists', text: r.v + ' ' + (r.v === 1 ? 'voto' : 'votos') }),
      el('span', { title: 'Popularidad en Deezer', text: fmt.format(r.r) })),
    el('span', { class: 'a' }, highlight(r.a), r.y && r.s === 'ok' ? ' · ' + r.y : ''),
    why ? el('span', { class: 'why', text: why }) : null);
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.replaceChildren(...DATA.themes.map((t) => {
    const hits = state.q ? hitCount(t) : null;
    const b = el('button', {
      class: 'chip' + (state.q && !hits ? ' dim' : ''), role: 'tab', type: 'button',
      'aria-selected': String(t.id === state.theme), id: 'tab-' + t.id,
    }, t.emoji + ' ' + t.label, hits ? el('span', { class: 'count mono', text: String(hits) }) : null);
    b.addEventListener('click', () => {
      state.theme = t.id;
      try { localStorage.setItem('catalog:theme', t.id); } catch {}
      render();
    });
    return b;
  }));
  const sum = document.getElementById('hitsum');
  if (!state.q) { sum.textContent = ''; return; }
  const total = DATA.themes.reduce((n, t) => n + hitCount(t), 0);
  const where = DATA.themes.filter(hitCount).map((t) => t.label);
  sum.textContent = total ? total + ' temas jugables en ' + where.join(', ') : 'No aparece en ninguna temática (fuera de la reserva)';
}

function renderTheme() {
  const t = DATA.themes.find((x) => x.id === state.theme);
  const ok = t.tiers.map((tier) => tier.filter((r) => r.s === 'ok').length);
  const range = (tier) => tier.length ? fmt.format(tier.at(-1).r) + ' – ' + fmt.format(tier[0].r) : '';

  const summary = el('p', { class: 'summary' },
    el('span', {}, el('b', { text: String(ok[0] + ok[1] + ok[2]) }), ' temas jugables'),
    el('span', {}, el('b', { text: String(t.playlists.length) }), ' playlists'),
    el('span', {}, 'hacen falta ', el('b', { text: String(t.needed) }), ' votos'),
    t.yearTo ? el('span', {}, 'hasta ', el('b', { text: String(t.yearTo) })) : null,
    el('span', {}, el('b', { text: String(t.reserve.length) }), ' en reserva'));

  const cols = el('div', { class: 'cols' }, ...t.tiers.map((tier, i) => {
    const shown = tier.filter(matches);
    return el('div', { class: 'col' },
      el('h2', {}, LEVELS[i], el('small', { class: 'mono', text: ok[i] + ' jugables' })),
      el('p', { class: 'range mono', text: 'popularidad ' + range(tier) }),
      shown.length ? el('ol', { class: 'songs' }, ...shown.map(songRow))
        : el('p', { class: 'empty', text: state.q ? 'Sin coincidencias en este nivel.' : 'Vacío.' }));
  }));

  const reserveShown = t.reserve.filter(matches);
  const reserve = el('details', { id: 'reserve' },
    el('summary', { text: 'Reserva: ' + t.reserve.length + ' temas con menos votos' + (state.q ? ' (' + reserveShown.length + ' coinciden)' : '') }),
    el('div', { class: 'inner' },
      el('p', { class: 'reserve-note', text: 'Solo se juegan si una partida agota los tres niveles de arriba, algo que en la práctica casi no pasa.' }),
      reserveShown.length ? el('ol', { class: 'songs' }, ...reserveShown.slice(0, 300).map(songRow)) : el('p', { class: 'empty', text: 'Sin coincidencias.' }),
      reserveShown.length > 300 ? el('p', { class: 'empty', text: '… y ' + (reserveShown.length - 300) + ' más.' }) : null));
  if (state.q && reserveShown.length) reserve.open = true;

  const sources = el('details', {},
    el('summary', { text: 'De dónde salen: ' + t.playlists.length + ' playlists de Deezer' }),
    el('div', { class: 'inner' },
      el('p', { class: 'pl', text: 'Búsquedas: ' + t.queries.join(' · ') }),
      el('ol', { class: 'pl-list' }, ...t.playlists.map((p) =>
        el('li', {}, el('a', { href: 'https://www.deezer.com/playlist/' + p.id, target: '_blank', rel: 'noreferrer', text: p.title }))))));

  const legend = el('p', { class: 'legend' },
    el('span', { text: 'Votos: en cuántas playlists aparece el tema' }),
    el('span', { text: 'Número de abajo: popularidad en Deezer' }),
    el('span', { text: 'Tachado: el juego lo descarta' }));

  document.getElementById('theme').replaceChildren(
    el('div', { style: 'display:grid;gap:14px' },
      el('div', {}, el('h2', { style: 'margin:0;font-size:1.3rem', text: t.emoji + ' ' + t.label }), el('p', { class: 'sub', text: t.description })),
      summary, legend, cols, reserve, sources));
}

function render() { renderTabs(); renderTheme(); }

let timer;
document.getElementById('q').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.q = norm(e.target.value.trim());
    if (state.q) {
      const best = DATA.themes.map((t) => [t, hitCount(t)]).sort((a, b) => b[1] - a[1])[0];
      const current = DATA.themes.find((t) => t.id === state.theme);
      if (!hitCount(current) && best[1]) state.theme = best[0].id;
    }
    render();
  }, 120);
});
render();
</script>`;

await main();
