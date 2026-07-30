import React, { useEffect, useState } from 'react';
import type { AppScreen, ConnectionStatus } from '../net/types';

const NICK_KEY = 'cxchess-nick';

export type LocalPlayMode = 'ai' | 'local';

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) setJoinCode(room.trim().toLowerCase());
  }, []);

  const persistNick = (value: string) => {
    setNick(value);
    localStorage.setItem(NICK_KEY, value.trim());
  };

  const trimmedNick = nick.trim() || '棋友';

  if (screen === 'waiting') {
    const waitingLabel =
      connectionStatus === 'connecting'
        ? '正在连接信令…'
        : connectionStatus === 'waiting'
          ? '等待对手加入…'
          : connectionStatus === 'connected'
            ? '已连接，进入对局…'
            : connectionStatus === 'error'
              ? '连接失败'
              : '处理中…';

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
            中国象棋
          </h1>
          <p className="text-center text-stone-400 text-sm mb-8">联机房间</p>

          <div className="rounded-2xl bg-stone-800/80 border border-stone-700 px-6 py-8 text-center shadow-xl">
            <p className="text-stone-400 text-xs uppercase tracking-widest mb-2">房间码</p>
            <p className="text-4xl font-mono font-bold tracking-[0.35em] text-amber-400 mb-4">
              {roomCode?.toUpperCase() ?? '——'}
            </p>
            <p className="text-stone-300 mb-1">{waitingLabel}</p>
            {peerNick && (
              <p className="text-amber-200/90 text-sm mb-2">对手：{peerNick}</p>
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
                {copied ? '已复制链接' : '复制邀请链接'}
              </button>
              <button
                type="button"
                onClick={onCancelWaiting}
                className="flex-1 py-2.5 rounded-xl bg-stone-900 border border-stone-600 hover:border-rose-500/60 font-semibold text-sm transition-colors"
              >
                取消
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
        <p className="text-center text-stone-400 text-sm mb-8">本地对弈 · WebRTC 联机</p>

        <label className="block text-xs text-stone-400 mb-1.5 ml-1">昵称</label>
        <input
          value={nick}
          onChange={(e) => persistNick(e.target.value)}
          placeholder="棋友"
          maxLength={16}
          className="w-full mb-6 px-4 py-3 rounded-xl bg-stone-800 border border-stone-600 focus:border-amber-500 outline-none text-stone-100"
        />

        <div className="space-y-3 mb-8">
          <button
            type="button"
            onClick={() => onStartLocal('ai')}
            className="w-full py-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-base transition-colors shadow-lg shadow-amber-900/30"
          >
            人机对弈
          </button>
          <button
            type="button"
            onClick={() => onStartLocal('local')}
            className="w-full py-3.5 rounded-xl bg-stone-700 hover:bg-stone-600 font-bold text-base transition-colors"
          >
            本地双人
          </button>
        </div>

        <div className="h-px bg-stone-700 mb-6" />

        <p className="text-xs text-stone-500 mb-3 ml-1">联机对战（P2P）</p>
        <button
          type="button"
          onClick={() => onCreateRoom(trimmedNick)}
          className="w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-base transition-colors mb-3"
        >
          开房
        </button>

        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())}
            placeholder="输入房间码"
            maxLength={8}
            className="flex-1 px-4 py-3 rounded-xl bg-stone-800 border border-stone-600 focus:border-amber-500 outline-none font-mono tracking-wider uppercase"
          />
          <button
            type="button"
            disabled={joinCode.length < 4}
            onClick={() => onJoinRoom(trimmedNick, joinCode)}
            className="px-5 py-3 rounded-xl bg-stone-100 text-stone-900 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white transition-colors"
          >
            加入
          </button>
        </div>

        {statusMessage && screen === 'lobby' && (
          <p className="text-rose-300 text-sm mt-4 text-center">{statusMessage}</p>
        )}
      </div>
    </div>
  );
};
