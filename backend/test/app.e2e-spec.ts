import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { isValidAadhaar } from '../src/common/util/government-id';

/**
 * A valid Aadhaar number nobody has used yet.
 *
 * The check digit is found by asking the platform's own validator rather than
 * reimplementing Verhoeff in the fixture — a second copy of that table is a
 * second chance to get it wrong, in the one place a mistake would look like a
 * bug in the thing under test.
 *
 * One document, one profile is enforced by a unique index, so each call has to
 * produce a number no earlier call did.
 */
let aadhaarSeed = 0;
function freshAadhaar(): string {
  aadhaarSeed += 1;
  const body = `2${String(Date.now()).slice(-7)}${String(aadhaarSeed).padStart(3, '0')}`;
  for (let check = 0; check < 10; check += 1) {
    const candidate = `${body}${check}`;
    if (isValidAadhaar(candidate)) return candidate;
  }
  throw new Error(`no valid check digit for ${body}`);
}

/**
 * Functional / integration (DFT) tests. These hit real HTTP endpoints against a
 * real Postgres + Redis, so run them with the test stack up:
 *
 *   docker compose -f docker/docker-compose.test.yml up -d
 *   npm run migration:run
 *   npm run test:e2e
 */
describe('WOW API (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();

  /**
   * A registration name is a person's name: letters and spaces, no digits. The
   * fixtures used to read "E2E Solo", which the platform now — correctly —
   * refuses, so uniqueness lives in the email address where it belongs.
   *
   * A business account must also carry a mobile number. In this market that is
   * the channel a vendor or an agency is actually reached on, and it is the key
   * duplicate detection runs against, so it is not optional for them.
   */
  const solo = {
    email: `solo_${unique}@test.com`,
    password: 'Password123',
    accountType: 'individual',
    role: 'bride',
    displayName: 'Solo Sharma',
  };
  const groom = {
    email: `groom_${unique}@test.com`,
    password: 'Password123',
    accountType: 'individual',
    role: 'groom',
    displayName: 'Groom Reddy',
  };
  const agent = {
    email: `agent_${unique}@test.com`,
    password: 'Password123',
    accountType: 'agent',
    displayName: 'Anita Rao',
    phone: `98765${String(unique).slice(-5)}`,
  };
  const vendor = {
    email: `vendor_${unique}@test.com`,
    password: 'Password123',
    accountType: 'vendor',
    displayName: 'Vikram Nair',
    phone: `98764${String(unique).slice(-5)}`,
  };

  let soloToken: string;
  let groomToken: string;
  let agentToken: string;
  let vendorToken: string;
  let groomProfileId: string;
  let soloProfileId: string;

  const http = () => request(app.getHttpServer());

  /**
   * Intake records how the family gave permission, so every agency-built
   * profile carries one of these. A walk-in is overwhelmingly in person, with a
   * parent doing the talking.
   */
  const consent = (allowsCirculation = false) => ({
    method: 'in_person',
    givenByRelation: 'father',
    givenByName: 'Ramesh Sharma',
    givenAt: '2026-08-01',
    allowsCirculation,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers one account of each persona', async () => {
    const r1 = await http().post('/api/auth/register').send(solo).expect(201);
    soloToken = r1.body.accessToken;
    expect(r1.body.user.role).toBe('bride');
    // A self-registered user is never tied to an agency.
    expect(r1.body.user.managedByAgentId).toBeNull();
    expect(r1.body.user.permissions).toContain('booking:create');
    // The refresh token is an httpOnly cookie now, not a field in the body.
    expect(r1.body.refreshToken).toBeUndefined();
    expect(String(r1.headers['set-cookie'])).toContain('HttpOnly');

    const r2 = await http().post('/api/auth/register').send(groom).expect(201);
    groomToken = r2.body.accessToken;

    const r3 = await http().post('/api/auth/register').send(agent).expect(201);
    agentToken = r3.body.accessToken;
    expect(r3.body.user.role).toBe('agent');
    expect(r3.body.user.permissions).toContain('managed_profile:manage');

    const r4 = await http().post('/api/auth/register').send(vendor).expect(201);
    vendorToken = r4.body.accessToken;
    expect(r4.body.user.role).toBe('vendor');
    // A vendor must never be handed buy-side capabilities.
    expect(r4.body.user.permissions).not.toContain('booking:create');
    expect(r4.body.user.permissions).not.toContain('match:browse');
  });

  it('refuses a registration name with digits or symbols in it', async () => {
    // "E2E Solo" is a plausible-looking name that is not one. A display name
    // reaches other families on a biodata, so it has to read as a person.
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `digits_${unique}@test.com`, displayName: 'E2E Solo' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `symbols_${unique}@test.com`, displayName: 'Priya <script>' })
      .expect(400);
  });

  it('insists a business account carries a mobile number', async () => {
    // An individual may sign up on an email alone — proven by `solo` above,
    // which carries no phone — while a vendor or an agency is reached on their
    // number, and duplicate detection keys on it.
    const { phone: _agentPhone, ...agentWithoutPhone } = agent;
    await http()
      .post('/api/auth/register')
      .send({ ...agentWithoutPhone, email: `nophone_agent_${unique}@test.com` })
      .expect(400);

    const { phone: _vendorPhone, ...vendorWithoutPhone } = vendor;
    await http()
      .post('/api/auth/register')
      .send({ ...vendorWithoutPhone, email: `nophone_vendor_${unique}@test.com` })
      .expect(400);
  });

  it('lets a solo user sign in on their own, with no agent involved', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: solo.email, password: solo.password })
      .expect(200);
    soloToken = res.body.accessToken;
    expect(res.body.user.managedByAgentId).toBeNull();
  });

  /**
   * The mobile apps cannot hold a cookie, so they are handed the refresh token
   * itself. The whole risk of that lives in how the two are told apart, which
   * is why the third case here is the one worth having: a page script can set
   * `X-Client-Platform` as easily as the app can, and if that were enough it
   * would hand an XSS bug the 30-day credential the httpOnly cookie exists to
   * keep away from it. The `Origin` header is what actually decides, because a
   * browser always sends it on a POST and script may not touch it.
   */
  describe('native clients and the refresh token', () => {
    const login = () => ({ email: solo.email, password: solo.password });

    it('hands the token to a native client, and sets no cookie', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('X-Client-Platform', 'ios')
        .send(login())
        .expect(200);

      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.refreshToken.length).toBeGreaterThan(0);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('keeps the cookie, and the silence, for a browser', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:8085')
        .send(login())
        .expect(200);

      expect(res.body.refreshToken).toBeUndefined();
      expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
    });

    it('refuses a browser that claims to be an app', async () => {
      const res = await http()
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:8085')
        .set('X-Client-Platform', 'ios')
        .send(login())
        .expect(200);

      expect(res.body.refreshToken).toBeUndefined();
      expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
    });

    it('refreshes from the body, with no cookie anywhere in the exchange', async () => {
      const first = await http()
        .post('/api/auth/login')
        .set('X-Client-Platform', 'android')
        .send(login())
        .expect(200);

      const second = await http()
        .post('/api/auth/refresh')
        .set('X-Client-Platform', 'android')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);

      expect(typeof second.body.accessToken).toBe('string');
      // Rotated, not reissued: presenting the old one again is treated as reuse.
      expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
      expect(second.headers['set-cookie']).toBeUndefined();
    });
  });

  it('refuses to mint privileged roles through registration', async () => {
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `esc1_${unique}@test.com`, role: 'admin' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ email: `esc2_${unique}@test.com`, password: 'Password123', accountType: 'admin' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `esc3_${unique}@test.com`, role: 'vendor' })
      .expect(400);
  });

  it('rejects registration with a bad payload (validation)', async () => {
    await http()
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);

    // whitelist + forbidNonWhitelisted: server-owned fields cannot be injected.
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `extra_${unique}@test.com`, isVerified: true })
      .expect(400);

    // Weak passwords are refused everywhere, not just at the client.
    await http()
      .post('/api/auth/register')
      .send({ ...solo, email: `weak_${unique}@test.com`, password: 'alllowercase' })
      .expect(400);
  });

  it('rejects protected routes without a token', async () => {
    await http().get('/api/users/me').expect(401);
  });

  it('creates profiles for both individuals', async () => {
    const solo = await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({ displayName: 'Solo', gender: 'Female', dateOfBirth: '1996-01-01', city: 'Mumbai' })
      .expect(200);
    soloProfileId = solo.body.id;

    const res = await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${groomToken}`)
      .send({ displayName: 'Groom', gender: 'Male', dateOfBirth: '1994-01-01', city: 'Mumbai' })
      .expect(200);
    groomProfileId = res.body.id;
  });

  describe('agent stewardship', () => {
    it('blocks an unvetted agency from building profiles', async () => {
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          displayName: 'Blocked',
          contactPhone: '+919876500000',
          consent: consent(),
        })
        .expect(403);
    });

    it('requires a mobile number and a consent record, but not an email', async () => {
      await http()
        .put('/api/agents/agency')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ agencyName: `E2E Agency ${unique}`, city: 'Mumbai' })
        .expect(200);

      // Validation runs before the approval check, so these 400 rather than 403.
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ displayName: 'No phone', consent: consent() })
        .expect(400);

      // @ValidateNested alone passes when the property is absent, so this
      // previously reached the service and crashed. It must be a 400.
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ displayName: 'No consent', contactPhone: '+919876500009' })
        .expect(400);
    });

    it('keeps stewardship away from ordinary individuals and providers', async () => {
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${soloToken}`)
        .send({
          displayName: 'Nope',
          contactPhone: '+919876500001',
          consent: consent(),
        })
        .expect(403);

      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          displayName: 'Nope',
          contactPhone: '+919876500002',
          consent: consent(),
        })
        .expect(403);
    });

    it('requires an agent to name a profile before browsing matches', async () => {
      await http()
        .get('/api/matches/suggestions')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(400);
    });
  });

  /**
   * Identity verification, through the real OTP flow.
   *
   * Sending and accepting an interest both require the subject profile's
   * document to have been confirmed, so this is a precondition of the flow
   * below rather than a test of its own. `AADHAAR_PROVIDER=mock` returns the
   * code on the response, which is what makes it possible here.
   */
  const verifyIdentity = async (profileId: string, token: string) => {
    const started = await http()
      .post(`/api/profiles/${profileId}/identity/aadhaar/send-otp`)
      .set('Authorization', `Bearer ${token}`)
      .send({ aadhaarNumber: freshAadhaar() })
      .expect(200);

    await http()
      .post(`/api/profiles/${profileId}/identity/aadhaar/verify-otp`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId: started.body.sessionId, code: started.body.devCode })
      .expect(200);
  };

  it('will not let an unverified profile send an interest', async () => {
    await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({ toProfileId: groomProfileId })
      .expect(403);
  });

  it('runs the interest to accept flow between two individuals', async () => {
    await verifyIdentity(soloProfileId, soloToken);
    await verifyIdentity(groomProfileId, groomToken);

    const sent = await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({ toProfileId: groomProfileId })
      .expect(201);

    await http()
      .put(`/api/matches/${sent.body.id}/accept`)
      .set('Authorization', `Bearer ${groomToken}`)
      .expect(200);
  });

  it('never returns an exact date of birth to another user', async () => {
    const res = await http()
      .get('/api/matches/suggestions')
      .set('Authorization', `Bearer ${soloToken}`)
      .expect(200);
    for (const item of res.body.data ?? []) {
      expect(item.profile.dateOfBirth).toBeUndefined();
      expect(item.profile).toHaveProperty('ageRange');
    }
  });

  it('keeps provider personas out of the buy side and matchmaking', async () => {
    await http().get('/api/matches/suggestions').set('Authorization', `Bearer ${vendorToken}`).expect(403);

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ providerType: 'vendor', providerId: groomProfileId, amount: 100 })
      .expect(403);

    await http()
      .post('/api/vendors')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({ name: 'Not mine', category: 'venue' })
      .expect(403);
  });

  it('keeps the wedding marketplace to the couple', async () => {
    // An agency introduces two families and is paid for that. Once the match is
    // fixed the couple hires their own vendors and holds their own escrow, so
    // an agent has no booking surface at all — and the field that used to let
    // them book for a client is gone from the API rather than merely refused.
    expect((await http().post('/api/auth/login').send({ email: agent.email, password: agent.password })).body.user.permissions).not.toContain(
      'booking:create',
    );

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ providerType: 'vendor', providerId: groomProfileId, amount: 100 })
      .expect(403);

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        providerType: 'vendor',
        providerId: groomProfileId,
        amount: 100,
        onBehalfOfUserId: groomProfileId,
      })
      .expect(400);
  });

  it('leaves the couple their own albums and assistant', async () => {
    // A vendor selling into the marketplace has no wedding of their own here:
    // albums and the planning assistant belong to the couple, and a vendor
    // holding them saw two menu entries onto somebody else's wedding.
    await http().get('/api/media/albums').set('Authorization', `Bearer ${vendorToken}`).expect(403);

    await http()
      .post('/api/ai/budget-insight')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ totalBudget: 100000 })
      .expect(403);

    await http().get('/api/media/albums').set('Authorization', `Bearer ${soloToken}`).expect(200);
  });

  it('closes the admin surface to every non-admin persona', async () => {
    for (const token of [soloToken, groomToken, agentToken, vendorToken]) {
      await http().get('/api/admin/analytics').set('Authorization', `Bearer ${token}`).expect(403);
      await http().get('/api/admin/users').set('Authorization', `Bearer ${token}`).expect(403);
      await http().get('/api/admin/audit').set('Authorization', `Bearer ${token}`).expect(403);
      await http().get('/api/admin/agents/pending').set('Authorization', `Bearer ${token}`).expect(403);
    }
  });

  describe('password recovery', () => {
    it('never reveals whether an address is registered', async () => {
      await http()
        .post('/api/auth/password/forgot')
        .send({ email: `nobody_${unique}@test.com` })
        .expect(200);
    });

    it('refuses an invalid reset token', async () => {
      await http()
        .post('/api/auth/password/reset')
        .send({ token: 'x'.repeat(32), password: 'Password123' })
        .expect(400);
    });
  });

  it('refuses an unsigned payment webhook', async () => {
    await http()
      .post('/api/payments/webhook')
      .send({ id: 'evt_1', event: 'payment.captured' })
      .expect(400);
  });

  it('refuses an invalid invitation token', async () => {
    await http().get(`/api/auth/invitations/${'x'.repeat(32)}`).expect(404);
  });

  it('refuses an invalid biodata share link', async () => {
    await http().get(`/api/circulation/biodata/${'x'.repeat(32)}`).expect(404);
  });

  it('keeps the network pool to approved agents', async () => {
    await http().get('/api/circulation/pool').set('Authorization', `Bearer ${soloToken}`).expect(403);
    await http().get('/api/circulation/pool').set('Authorization', `Bearer ${vendorToken}`).expect(403);
  });

  it('exposes public search endpoints', async () => {
    await http().get('/api/vendors/search').expect(200);
    await http().get('/api/wedding-planners/search').expect(200);
    await http().get('/api/auth/account-types').expect(200);
  });

  it('enforces the configured pagination ceiling', async () => {
    await http().get('/api/vendors/search?limit=100000').expect(400);
  });

  it('serves health readiness', async () => {
    await http().get('/api/health').expect(200);
  });
});
