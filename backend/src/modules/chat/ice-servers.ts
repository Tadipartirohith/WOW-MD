import { createHmac } from 'crypto';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * The ICE servers a browser is handed when a call starts.
 *
 * STUN is enough for most home and mobile networks: both sides discover their
 * public address and connect directly. A symmetric NAT on either side needs a
 * TURN relay, which carries the audio and therefore costs real money — which is
 * why it is configured rather than assumed.
 *
 * Two ways to configure it, and the difference matters more than it looks.
 *
 * **Static credentials** (`TURN_USERNAME` / `TURN_CREDENTIAL`) are what most
 * guides show. They are also handed, in full, to every browser that starts a
 * call — so the first person to open developer tools has a relay they can use
 * for anything, indefinitely, on your bill.
 *
 * **Ephemeral credentials** (`TURN_STATIC_AUTH_SECRET`) are coturn's REST
 * convention: the username is an expiry timestamp, the password is an HMAC of
 * it under a secret the browser never sees. The relay validates it without any
 * shared database, and a leaked credential is worthless within the hour. The
 * secret stays on the server.
 *
 * Ephemeral wins when both are set, because there is no reason to prefer the
 * weaker one.
 */
export function buildIceServers(
  env: NodeJS.ProcessEnv,
  now: () => number = Date.now,
): IceServer[] {
  const servers: IceServer[] = [
    { urls: (env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((u) => u.trim()) },
  ];

  const turnUrl = env.TURN_URL?.trim();
  if (!turnUrl) return servers;

  const urls = turnUrl.split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return servers;

  const secret = env.TURN_STATIC_AUTH_SECRET?.trim();
  if (secret) {
    // coturn's `use-auth-secret` scheme. The username is the unix time the
    // credential stops working; the password is its HMAC-SHA1, base64.
    const ttl = Number(env.TURN_CREDENTIAL_TTL_SECONDS) || 8 * 60 * 60;
    const expiry = Math.floor(now() / 1000) + ttl;

    // A realm-qualified username is what a multi-tenant relay expects; without
    // one coturn is happy with the bare timestamp.
    const realm = env.TURN_REALM?.trim();
    const username = realm ? `${expiry}:${realm}` : String(expiry);
    const credential = createHmac('sha1', secret).update(username).digest('base64');

    servers.push({ urls, username, credential });
    return servers;
  }

  const username = env.TURN_USERNAME?.trim();
  const credential = env.TURN_CREDENTIAL?.trim();
  if (username && credential) {
    servers.push({ urls, username, credential });
  }

  // A TURN_URL with no credentials at all is a misconfiguration rather than a
  // choice: the relay will refuse every allocation. Left out entirely so the
  // browser does not spend the call setup timing out against it.
  return servers;
}
