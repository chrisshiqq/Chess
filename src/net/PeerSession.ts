import Peer, { type DataConnection } from 'peerjs';
import type { NetMessage } from './types';

const PEER_PREFIX = 'cxchess-';

export function roomCodeToPeerId(roomCode: string): string {
  return `${PEER_PREFIX}${roomCode.toLowerCase()}`;
}

export function generateRoomCode(length = 6): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return code;
}

export type PeerSessionHandlers = {
  onOpen?: () => void;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onError?: (message: string) => void;
  onMessage?: (msg: NetMessage) => void;
};

export class PeerSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private destroyed = false;
  private handlers: PeerSessionHandlers;

  readonly roomCode: string;
  readonly role: 'host' | 'guest';

  constructor(roomCode: string, role: 'host' | 'guest', handlers: PeerSessionHandlers = {}) {
    this.roomCode = roomCode.toLowerCase();
    this.role = role;
    this.handlers = handlers;
  }

  get isConnected(): boolean {
    return !!this.conn?.open;
  }

  async start(): Promise<void> {
    if (this.role === 'host') {
      await this.startHost();
    } else {
      await this.startGuest();
    }
  }

  send(msg: NetMessage): boolean {
    if (!this.conn?.open) return false;
    this.conn.send(msg);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.conn = null;
    this.peer = null;
  }

  private bindConnection(conn: DataConnection): void {
    this.conn = conn;

    conn.on('open', () => {
      if (this.destroyed) return;
      this.handlers.onConnected?.();
    });

    conn.on('data', (data: unknown) => {
      if (this.destroyed) return;
      const msg = data as NetMessage;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
      this.handlers.onMessage?.(msg);
    });

    conn.on('close', () => {
      if (this.destroyed) return;
      this.handlers.onDisconnected?.('对方已断开');
    });

    conn.on('error', (err: Error) => {
      if (this.destroyed) return;
      this.handlers.onError?.(err.message || '连接错误');
    });
  }

  private startHost(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peerId = roomCodeToPeerId(this.roomCode);
      const peer = new Peer(peerId);
      this.peer = peer;

      peer.on('open', () => {
        if (this.destroyed) return;
        this.handlers.onOpen?.();
        resolve();
      });

      peer.on('connection', (conn) => {
        if (this.destroyed) return;
        // 只接受第一个连接
        if (this.conn) {
          conn.close();
          return;
        }
        this.bindConnection(conn);
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (this.destroyed) return;
        const message =
          err.type === 'unavailable-id'
            ? '房间码已被占用，请重开一局'
            : err.message || '信令错误';
        this.handlers.onError?.(message);
        reject(err);
      });

      peer.on('disconnected', () => {
        if (this.destroyed) return;
        // 尝试重连信令服务器
        try {
          peer.reconnect();
        } catch {
          this.handlers.onDisconnected?.('信令断开');
        }
      });
    });
  }

  private startGuest(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;

      peer.on('open', () => {
        if (this.destroyed) return;
        this.handlers.onOpen?.();
        const conn = peer.connect(roomCodeToPeerId(this.roomCode), { reliable: true });
        this.bindConnection(conn);
        resolve();
      });

      peer.on('error', (err: Error) => {
        if (this.destroyed) return;
        this.handlers.onError?.(err.message || '无法加入房间');
        reject(err);
      });

      peer.on('disconnected', () => {
        if (this.destroyed) return;
        try {
          peer.reconnect();
        } catch {
          this.handlers.onDisconnected?.('信令断开');
        }
      });
    });
  }
}
