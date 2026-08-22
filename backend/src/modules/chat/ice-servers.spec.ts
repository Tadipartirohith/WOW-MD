import { createHmac } from 'crypto';
import { buildIceServers } from './ice-servers';

/** A fixed clock, so an expiry can be asserted rather than approximated. */
const NOW = 1_700_000_000_000;
const now = () => NOW;

describe('buildIceServers', () => {
  it('offers public STUN when nothing is configured', () => {
    const servers = buildIceServers({}, now);
    expect(servers).toHaveLength(1);
    expect(servers[0].urls[0]).toContain('stun:');
    expect(servers[0].username).toBeUndefined();
  });

  it('takes a comma-separated STUN list and trims it', () => {
    const servers = buildIceServers({ STUN_URLS: 'stun:a:3478, stun:b:3478' }, now);
    expect(servers[0].urls).toEqual(['stun:a:3478', 'stun:b:3478']);
  });

  describe('with a relay configured', () => {
    it('uses static credentials when that is all there is', () => {
      const servers = buildIceServers(
        {
          TURN_URL: 'turn:relay.example.com:3478',
          TURN_USERNAME: 'wow',
          TURN_CREDENTIAL: 'hunter2',
        },
        now,
      );
      expect(servers).toHaveLength(2);
      expect(servers[1]).toEqual({
        urls: ['turn:relay.example.com:3478'],
        username: 'wow',
        credential: 'hunter2',
      });
    });

    it('mints an ephemeral credential when a secret is set', () => {
      const servers = buildIceServers(
        { TURN_URL: 'turn:relay.example.com:3478', TURN_STATIC_AUTH_SECRET: 's3cret' },
        now,
      );

      const expiry = Math.floor(NOW / 1000) + 8 * 60 * 60;
      expect(servers[1].username).toBe(String(expiry));
      expect(servers[1].credential).toBe(
        createHmac('sha1', 's3cret').update(String(expiry)).digest('base64'),
      );
    });

    it('honours a shorter TTL', () => {
      const servers = buildIceServers(
        {
          TURN_URL: 'turn:relay.example.com:3478',
          TURN_STATIC_AUTH_SECRET: 's3cret',
          TURN_CREDENTIAL_TTL_SECONDS: '3600',
        },
        now,
      );
      expect(servers[1].username).toBe(String(Math.floor(NOW / 1000) + 3600));
    });

    it('qualifies the username with a realm when the relay is multi-tenant', () => {
      const servers = buildIceServers(
        {
          TURN_URL: 'turn:relay.example.com:3478',
          TURN_STATIC_AUTH_SECRET: 's3cret',
          TURN_REALM: 'wow.example.com',
        },
        now,
      );
      expect(servers[1].username).toBe(
        `${Math.floor(NOW / 1000) + 8 * 60 * 60}:wow.example.com`,
      );
    });

    /**
     * The point of the whole exercise: a credential that reaches a browser must
     * not be one that works forever. If both are configured, the weaker one
     * must not win.
     */
    it('prefers the ephemeral secret over static credentials', () => {
      const servers = buildIceServers(
        {
          TURN_URL: 'turn:relay.example.com:3478',
          TURN_USERNAME: 'wow',
          TURN_CREDENTIAL: 'hunter2',
          TURN_STATIC_AUTH_SECRET: 's3cret',
        },
        now,
      );
      expect(servers[1].username).not.toBe('wow');
      expect(servers[1].credential).not.toBe('hunter2');
    });

    it('never leaks the secret itself', () => {
      const servers = buildIceServers(
        { TURN_URL: 'turn:relay.example.com:3478', TURN_STATIC_AUTH_SECRET: 's3cret' },
        now,
      );
      expect(JSON.stringify(servers)).not.toContain('s3cret');
    });

    it('takes several relay URLs', () => {
      const servers = buildIceServers(
        {
          TURN_URL: 'turn:a.example.com:3478, turns:b.example.com:5349',
          TURN_STATIC_AUTH_SECRET: 's3cret',
        },
        now,
      );
      expect(servers[1].urls).toEqual(['turn:a.example.com:3478', 'turns:b.example.com:5349']);
    });

    /**
     * A relay with no credentials refuses every allocation, so offering it
     * costs the caller the ICE timeout and gains nothing.
     */
    it('leaves out a relay that has no credentials at all', () => {
      const servers = buildIceServers({ TURN_URL: 'turn:relay.example.com:3478' }, now);
      expect(servers).toHaveLength(1);
    });

    it('ignores a blank TURN_URL', () => {
      const servers = buildIceServers({ TURN_URL: '   ', TURN_STATIC_AUTH_SECRET: 's' }, now);
      expect(servers).toHaveLength(1);
    });
  });
});
