import { useEffect, useState } from 'react';
import type { RoomView } from '../shared/types';
import { Final } from './components/Final';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { socket } from './socket';

export function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onRoom = (r: RoomView | null) => setRoom(r);
    const onToast = (msg: string) => setToast(msg);
    const onConnect = () => setConnected(true);
    // Keep the room on screen: the server holds the seat and resends state on reconnect.
    const onDisconnect = () => setConnected(false);
    socket.on('room', onRoom);
    socket.on('toast', onToast);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // The socket connects on import, possibly before these listeners existed.
    setConnected(socket.connected);
    return () => {
      socket.off('room', onRoom);
      socket.off('toast', onToast);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="app">
      <header className="brand">
        <span className="brand-dot" aria-hidden />
        jueguito<b>música</b>
      </header>
      {!connected && (
        <div className="offline" role="status">
          {room ? 'Se cortó la conexión. Reconectando… (tu lugar te espera 60s)' : 'Conectando…'}
        </div>
      )}
      <main>{screen(room)}</main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function screen(room: RoomView | null) {
  if (!room) return <Home />;
  switch (room.phase) {
    case 'lobby':
      return <Lobby room={room} />;
    case 'finished':
      return <Final room={room} />;
    default:
      return <Game room={room} />;
  }
}
