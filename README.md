# jueguitomúsica

Adiviná la canción escuchando 0.3s → 1s → 5s → 15s. Pedir más tiempo o pistas baja el puntaje.
Modo solo o salas online con código.

```bash
npm install
npm run dev      # web en http://localhost:5173 (API + sockets en :3001)
npm test
```

Producción: `npm run build && npm start` (un solo proceso Node sirve front, API y WebSockets).
Necesita un host con proceso persistente (Railway, Render, Fly, VPS) porque las salas viven en memoria.

## Cómo funciona

| Pieza | Qué hace |
| --- | --- |
| `shared/game.ts` | Niveles, puntaje y pistas (reglas puras, testeadas) |
| `shared/themes.ts` | Temáticas de un toque (búsquedas de playlists curadas y verificadas a mano) |
| `shared/match.ts` | Normaliza títulos y decide si una respuesta es correcta |
| `server/room.ts` | Motor de sala: rondas, timer, pistas, puntajes. No conoce ni Deezer ni sockets |
| `server/pool.ts` | Arma la playlist desde Deezer según filtros; valida el año original con MusicBrainz |
| `server/sources.ts` | Clientes de Deezer, MusicBrainz (1 req/s) y YouTube (opcional) |
| `server/index.ts` | Express + Socket.IO, proxy de audio con tokens opacos |
| `src/audio.ts` | Web Audio API: recorta snippets con precisión de muestra |

- **Audio**: previews de 30s de Deezer. El cliente nunca ve el id del tema: baja el audio por `/api/audio/<token>`,
  un token por jugador y ronda. El server corta el MP3 y entrega solo los segundos desbloqueados (+0.5s de margen);
  el tema completo recién en la revelación (`server/mp3.ts`).
- **Reconexión**: cada pestaña manda un id privado en el handshake (`sessionStorage`). Si se corta o recargás, volvés a
  tu asiento con puntaje y nivel. Hay 60s de gracia; mientras tanto no bloqueás la ronda y el host pasa a otro.
  La sala solo expone un "asiento" público, así nadie puede robarte el lugar copiando tu id.
- **Año**: Deezer suele dar la fecha del compilado/remaster; MusicBrainz (por ISRC) da el año original.
- **Visitas de YouTube**: configurá `YOUTUBE_API_KEY` (ver `.env.example`); sin key se muestra popularidad de Deezer.
