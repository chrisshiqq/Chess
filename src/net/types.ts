import type { Color, Position } from '../domain/types';

export type AppScreen = 'lobby' | 'waiting' | 'game';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type NetMessage =
  | { type: 'hello'; nick: string; color: Color }
  | { type: 'ready' }
  | { type: 'move'; from: Position; to: Position; ply: number }
  | { type: 'resign' }
  | { type: 'ping' };

export interface OnlineSessionInfo {
  roomCode: string;
  role: 'host' | 'guest';
  myColor: Color;
  myNick: string;
  peerNick: string | null;
}
