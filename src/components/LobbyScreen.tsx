import React, { useEffect, useState } from 'react';
import type { AppScreen, ConnectionStatus } from '../net/types';

const NICK_KEY = 'cxchess-nick';

export type LocalPlayMode = 'ai' | 'red' | 'black';

interface LobbyScreenProps {
  screen: Extract<AppScreen, 'lobby' | 'waiting'>;
  connectionStatus: ConnectionStatus;
  roomCode: string | null;
  statusMessage: string | null;
  peerNick: string | null;
  onStartLocal: (mode: LocalPlayMode) => void;
  onCreateRoom: (nick: string) => void;
  onJoinRoom: (nick: string, roomCode: string) => void;
  onCancelWaiting: () => void;
  onCopyRoomLink: () => void;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  screen,
  connectionStatus,
  roomCode,
  statusMessage,
  peerNick,
  onStartLocal,
  onCreateRoom,
  onJoinRoom,
  onCancelWaiting,
  onCopyRoomLink,
}) => {
  const [nick, setNick] = useState(() => localStorage.getItem(NICK_KEY) || '');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [playAs, setPlayAs] = useState<'red' | 'black'>('red');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) setJoinCode(room.trim().toLowerCase());
  }, []);

  const persistNick = (value: string) => {
    setNick(value);
    localStorage.setItem(NICK_KEY, value.trim());
  };

  const trimmedNick = nick.trim() || 'Player';

  const panelControlStyle = (disabled = false): React.CSSProperties => ({
    backgroundColor: disabled ? 'rgba(28, 25, 23, 0.3)' : 'rgba(28, 25, 23, 0.5)',
    borderColor: disabled ? '#3f3d3a' : '#57534e',
    color: disabled ? '#927659' : '#d6d3d1',
  });
  const panelControlClass =
    'rounded-lg font-bold transition-all border shadow-sm hover:opacity-80 active:scale-95';

  if (screen === 'waiting') {
    const waitingLabel =
      connectionStatus === 'connecting'
        ? 'Connecting to signaling…'
        : connectionStatus === 'waiting'
          ? 'Waiting for opponent…'
          : connectionStatus === 'connected'
            ? 'Connected — starting game…'
            : connectionStatus === 'error'
              ? 'Connection failed'
              : 'Working…';

    return (
      <div className="min-h-screen w-full bg-stone-900 text-stone-200 flex items-center justify-center p-4 relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(180,83,9,0.35), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 80%, rgba(68,64,60,0.5), transparent)',
          }}
        />
        <div className="relative z-10 w-full max-w-md animate-fadeIn">
          <h1 className="text-3xl sm:text-4xl font-black tracking-wide text-amber-500 text-center mb-2">
            Chinese Chess
          </h1>
          <p className="text-center text-stone-400 text-sm mb-8">Online Room</p>

          <div className="rounded-2xl bg-stone-800/80 border border-stone-700 px-6 py-8 text-center shadow-xl">
            <p className="text-stone-400 text-xs uppercase tracking-widest mb-2">Room Code</p>
            <p className="text-4xl font-mono font-bold tracking-[0.35em] text-amber-400 mb-4">
              {roomCode?.toUpperCase() ?? '——'}
            </p>
            <p className="text-stone-300 mb-1">{waitingLabel}</p>
            {peerNick && (
              <p className="text-amber-200/90 text-sm mb-2">Opponent: {peerNick}</p>
            )}
            {statusMessage && (
              <p className="text-rose-300 text-sm mt-2">{statusMessage}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  onCopyRoomLink();
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex-1 py-2.5 rounded-xl bg-stone-700 hover:bg-stone-600 font-semibold text-sm transition-colors"
              >
                {copied ? 'Link copied' : 'Copy invite link'}
              </button>
              <button
                type="button"
                onClick={onCancelWaiting}
                className="flex-1 py-2.5 rounded-xl bg-stone-900 border border-stone-600 hover:border-rose-500/60 font-semibold text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-stone-900 text-stone-200 flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 15%, rgba(180,83,9,0.4), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 90%, rgba(120,53,15,0.35), transparent)',
        }}
      />
      <div className="relative z-10 w-full max-w-md animate-fadeIn">
        <h1 className="text-4xl sm:text-5xl font-black tracking-wide text-amber-500 text-center mb-2">
          中国象棋
        </h1>
        
        <label className="block text-xs text-stone-400 mb-1.5 ml-1">Nickname</label>
        <input
          value={nick}
          onChange={(e) => persistNick(e.target.value)}
          placeholder="Player"
          maxLength={16}
          style={panelControlStyle()}
          className={`w-full mb-6 px-4 py-3 outline-none placeholder:text-stone-500 ${panelControlClass}`}
        />

        <div className="h-px bg-stone-700 mb-6" />

        <p className="text-xs text-stone-500 mb-1 ml-1">Local</p>

        <div className="space-y-3 mb-8">
          <button
            type="button"
            onClick={() => onStartLocal(playAs)}
            style={panelControlStyle()}
            className={`w-full py-3.5 text-base ${panelControlClass}`}
          >
            Player vs Computer
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPlayAs('red')}
              style={{
                ...panelControlStyle(),
                borderColor: playAs === 'red' ? '#57534e' : 'transparent',
              }}
              className={`w-full py-3.5 text-base ${panelControlClass}`}
            >
              Red
            </button>
            <button
              type="button"
              onClick={() => setPlayAs('black')}
              style={{
                ...panelControlStyle(),
                borderColor: playAs === 'black' ? '#57534e' : 'transparent',
              }}
              className={`w-full py-3.5 text-base ${panelControlClass}`}
            >
              Black
            </button>
          </div>
        </div>

        <div className="h-px bg-stone-700 mb-6" />

        <p className="text-xs text-stone-500 mb-1 ml-1">Online</p>
        <button
          type="button"
          onClick={() => onCreateRoom(trimmedNick)}
          style={panelControlStyle()}
          className={`w-full py-3.5 text-base mb-3 ${panelControlClass}`}
        >
          Create Room
        </button>

        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())}
            placeholder="Enter room code"
            maxLength={8}
            style={panelControlStyle()}
            className={`flex-1 px-4 py-3 outline-none font-mono tracking-wider uppercase placeholder:text-stone-500 ${panelControlClass}`}
          />
          <button
            type="button"
            disabled={joinCode.length < 4}
            onClick={() => onJoinRoom(trimmedNick, joinCode)}
            style={panelControlStyle(joinCode.length < 4)}
            className={`px-5 py-3 disabled:opacity-50 disabled:cursor-not-allowed ${panelControlClass}`}
          >
            Join
          </button>
        </div>

        {statusMessage && screen === 'lobby' && (
          <p className="text-rose-300 text-sm mt-4 text-center">{statusMessage}</p>
        )}
      </div>
    </div>
  );
};
