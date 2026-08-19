import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

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

  const solo = {
    email: `solo_${unique}@test.com`,
    password: 'Password123',
    accountType: 'individual',
    role: 'bride',
    displayName: 'E2E Solo',
  };
  const groom = {
    email: `groom_${unique}@test.com`,
    password: 'Password123',
    accountType: 'individual',
    role: 'groom',
    displayName: 'E2E Groom',
  };
  const agent = {
    email: `agent_${unique}@test.com`,
    password: 'Password123',
    accountType: 'agent',
    displayName: 'E2E Agency',
  };
  const vendor = {
    email: `vendor_${unique}@test.com`,
    password: 'Password123',
    accountType: 'vendor',
    displayName: 'E2E Venue Co',
  };

  let soloToken: string;
  let groomToken: string;
  let agentToken: string;
  let vendorToken: string;
  let groomProfileId: string;

  const http = () => request(app.getHttpServer());

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

  it('lets a solo user sign in on their own, with no agent involved', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: solo.email, password: solo.password })
      .expect(200);
    soloToken = res.body.accessToken;
    expect(res.body.user.managedByAgentId).toBeNull();
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
    await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${soloToken}`)
      .send({ displayName: 'Solo', gender: 'Female', dateOfBirth: '1996-01-01', city: 'Mumbai' })
      .expect(200);

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
          contactEmail: `blocked_${unique}@test.com`,
          contactPhone: '+919876500000',
        })
        .expect(403);
    });

    it('requires an email and a mobile number on a managed profile', async () => {
      // Registered but still unapproved, so these fail validation before authz
      // would matter — both fields are mandatory by design.
      await http()
        .put('/api/agents/agency')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ agencyName: `E2E Agency ${unique}`, city: 'Mumbai' })
        .expect(200);

      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ displayName: 'No contact details' })
        .expect(400);
    });

    it('keeps stewardship away from ordinary individuals and providers', async () => {
      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${soloToken}`)
        .send({
          displayName: 'Nope',
          contactEmail: `nope_${unique}@test.com`,
          contactPhone: '+919876500001',
        })
        .expect(403);

      await http()
        .post('/api/agents/profiles')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          displayName: 'Nope',
          contactEmail: `nope2_${unique}@test.com`,
          contactPhone: '+919876500002',
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

  it('runs the interest to accept flow between two individuals', async () => {
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
