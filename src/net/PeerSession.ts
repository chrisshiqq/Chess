import Peer, { type DataConnection } from 'peerjs';
import { getIceServers } from './iceServers';
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

const CROSS_NET_HINT =
  'Direct connection failed across networks. Prefer the same Wi‑Fi; if it still fails, the network may block P2P.';

export class PeerSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private destroyed = false;
  private connectedNotified = false;
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

  private async createPeer(id?: string): Promise<Peer> {
    const iceServers = await getIceServers();
    const options = {
      debug: 1 as const,
      config: {
        iceServers,
        sdpSemantics: 'unified-plan',
        iceTransportPolicy: 'all' as RTCIceTransportPolicy,
      },
    };
    return id ? new Peer(id, options) : new Peer(options);
  }

  private notifyConnected(): void {
    if (this.destroyed || this.connectedNotified) return;
    this.connectedNotified = true;
    this.handlers.onConnected?.();
  }

  private bindConnection(conn: DataConnection): void {
    this.conn = conn;

    const onOpen = () => {
      if (this.destroyed) return;
      this.notifyConnected();
    };

    conn.on('open', onOpen);
    // 部分环境 connection 事件触发时通道已 open，会错过 open 事件
    if (conn.open) {
      onOpen();
    }

    conn.on('data', (data: unknown) => {
      if (this.destroyed) return;
      const msg = data as NetMessage;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
      this.handlers.onMessage?.(msg);
    });

    conn.on('close', () => {
      if (this.destroyed) return;
      this.handlers.onDisconnected?.('Opponent disconnected');
    });

    conn.on('error', (err: Error) => {
      if (this.destroyed) return;
      this.handlers.onError?.(err.message || 'Connection error');
    });

    this.watchIce(conn);
  }

  private watchIce(conn: DataConnection): void {
    const pc = conn.peerConnection;
    if (!pc) return;

    pc.addEventListener('iceconnectionstatechange', () => {
      if (this.destroyed) return;
      const state = pc.iceConnectionState;
      if (state === 'failed') {
        this.handlers.onError?.(CROSS_NET_HINT);
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      if (this.destroyed) return;
      if (pc.connectionState === 'failed') {
        this.handlers.onError?.(CROSS_NET_HINT);
      }
    });
  }

  private startHost(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const peerId = roomCodeToPeerId(this.roomCode);
        const peer = await this.createPeer(peerId);
        this.peer = peer;

        peer.on('open', () => {
          if (this.destroyed) return;
          this.handlers.onOpen?.();
          resolve();
        });

        peer.on('connection', (conn) => {
          if (this.destroyed) return;
          if (this.conn?.open) {
            conn.close();
            return;
          }
          if (this.conn) {
            try {
              this.conn.close();
            } catch {
              /* ignore */
            }
          }
          this.connectedNotified = false;
          this.bindConnection(conn);
        });

        peer.on('error', (err: Error & { type?: string }) => {
          if (this.destroyed) return;
          const message =
            err.type === 'unavailable-id'
              ? 'Room code taken — create a new room'
              : err.type === 'network'
                ? 'Cannot reach signaling server. Check network and retry.'
                : err.message || 'Signaling error';
          this.handlers.onError?.(message);
          reject(err);
        });

        peer.on('disconnected', () => {
          if (this.destroyed) return;
          try {
            peer.reconnect();
          } catch {
            this.handlers.onDisconnected?.('Signaling disconnected');
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private startGuest(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const peer = await this.createPeer();
        this.peer = peer;

        peer.on('open', () => {
          if (this.destroyed) return;
          this.handlers.onOpen?.();
          const conn = peer.connect(roomCodeToPeerId(this.roomCode), {
            reliable: true,
            serialization: 'json',
          });
          this.bindConnection(conn);
          resolve();
        });

        peer.on('error', (err: Error & { type?: string }) => {
          if (this.destroyed) return;
          const message =
            err.type === 'peer-unavailable'
              ? 'Room not found or host not ready. Check the room code.'
              : err.type === 'network'
                ? 'Cannot reach signaling server. Check network and retry.'
                : err.message || 'Could not join room';
          this.handlers.onError?.(message);
          reject(err);
        });

        peer.on('disconnected', () => {
          if (this.destroyed) return;
          try {
            peer.reconnect();
          } catch {
            this.handlers.onDisconnected?.('Signaling disconnected');
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }
}
