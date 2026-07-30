export type IceServerConfig = RTCIceServer;

const STUN_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Open Relay 公开的 coturn static-auth secret（文档用于 Nextcloud Talk） */
const OPEN_RELAY_STATIC_SECRET = 'openrelayprojectsecret';

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** 生成 coturn TURN REST（static-auth）凭证 */
async function createStaticAuthTurnServers(
  host: string,
  secret: string,
  ttlSeconds = 24 * 3600,
): Promise<IceServerConfig[]> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:cxchess`;
  const credential = await hmacSha1Base64(secret, username);
  return [
    {
      urls: [
        `turn:${host}:80`,
        `turn:${host}:80?transport=tcp`,
        `turn:${host}:443`,
        `turns:${host}:443?transport=tcp`,
      ],
      username,
      credential,
    },
  ];
}

async function fetchMeteredIceServers(): Promise<IceServerConfig[] | null> {
  const apiUrl = import.meta.env.VITE_METERED_TURN_URL as string | undefined;
  const apiKey = import.meta.env.VITE_METERED_API_KEY as string | undefined;
  if (!apiUrl && !apiKey) return null;

  try {
    const url =
      apiUrl ||
      `https://cxchess.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey!)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = (await response.json()) as IceServerConfig[] | { iceServers: IceServerConfig[] };
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.iceServers)) return data.iceServers;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 组装 ICE 服务器：多 STUN（含国内可达）+ TURN 中继。
 * 手机流量/跨运营商场景几乎必须有 TURN，否则 DataChannel 会一直连不上。
 */
export async function getIceServers(): Promise<IceServerConfig[]> {
  const servers: IceServerConfig[] = [...STUN_SERVERS];

  const metered = await fetchMeteredIceServers();
  if (metered?.length) {
    servers.push(...metered);
  } else {
    try {
      const turn = await createStaticAuthTurnServers(
        'staticauth.openrelay.metered.ca',
        OPEN_RELAY_STATIC_SECRET,
      );
      servers.push(...turn);
    } catch {
      /* ignore */
    }

    // 旧版静态账号（部分环境仍可用，作为额外候选）
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=tcp',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }

  return servers;
}
