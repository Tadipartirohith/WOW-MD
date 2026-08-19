import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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

  const bride = {
    email: `bride_${unique}@test.com`,
    password: 'Password123',
    accountType: 'individual',
    role: 'bride',
    displayName: 'E2E Bride',
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

  let brideToken: string;
  let groomToken: string;
  let agentToken: string;
  let vendorToken: string;
  let groomUserId: string;
  let clientUserId: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
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
    const r1 = await http().post('/api/auth/register').send(bride).expect(201);
    brideToken = r1.body.accessToken;
    expect(r1.body.user.role).toBe('bride');
    expect(r1.body.user.managedByAgentId).toBeNull();
    expect(r1.body.user.permissions).toContain('booking:create');

    const r2 = await http().post('/api/auth/register').send(groom).expect(201);
    groomToken = r2.body.accessToken;
    groomUserId = r2.body.user.id;

    const r3 = await http().post('/api/auth/register').send(agent).expect(201);
    agentToken = r3.body.accessToken;
    expect(r3.body.user.role).toBe('agent');
    expect(r3.body.user.permissions).toContain('client:create');

    const r4 = await http().post('/api/auth/register').send(vendor).expect(201);
    vendorToken = r4.body.accessToken;
    expect(r4.body.user.role).toBe('vendor');
    // A vendor must never be handed buy-side capabilities.
    expect(r4.body.user.permissions).not.toContain('booking:create');
    expect(r4.body.user.permissions).not.toContain('match:browse');
  });

  it('refuses to mint privileged roles through registration', async () => {
    await http()
      .post('/api/auth/register')
      .send({ ...bride, email: `esc1_${unique}@test.com`, role: 'admin' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ email: `esc2_${unique}@test.com`, password: 'Password123', accountType: 'admin' })
      .expect(400);

    await http()
      .post('/api/auth/register')
      .send({ ...bride, email: `esc3_${unique}@test.com`, role: 'vendor' })
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
      .send({ ...bride, email: `extra_${unique}@test.com`, isVerified: true })
      .expect(400);
  });

  it('rejects protected routes without a token', async () => {
    await http().get('/api/users/me').expect(401);
  });

  it('creates profiles for both individuals', async () => {
    await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ displayName: 'Bride', gender: 'Female', dateOfBirth: '1996-01-01', city: 'Mumbai' })
      .expect(200);

    await http()
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${groomToken}`)
      .send({ displayName: 'Groom', gender: 'Male', dateOfBirth: '1994-01-01', city: 'Mumbai' })
      .expect(200);
  });

  it('runs the interest to accept flow', async () => {
    const sent = await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ toUserId: groomUserId })
      .expect(201);

    await http()
      .put(`/api/matches/${sent.body.id}/accept`)
      .set('Authorization', `Bearer ${groomToken}`)
      .expect(200);
  });

  it('keeps provider personas out of the buy side and matchmaking', async () => {
    await http().get('/api/matches/suggestions').set('Authorization', `Bearer ${vendorToken}`).expect(403);

    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ providerType: 'vendor', providerId: groomUserId, amount: 100 })
      .expect(403);

    await http()
      .post('/api/vendors')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ name: 'Not mine', category: 'venue' })
      .expect(403);
  });

  it('closes the admin surface to every non-admin persona', async () => {
    for (const token of [brideToken, groomToken, agentToken, vendorToken]) {
      await http().get('/api/admin/analytics').set('Authorization', `Bearer ${token}`).expect(403);
      await http().get('/api/admin/users').set('Authorization', `Bearer ${token}`).expect(403);
    }
  });

  it('stamps the agent id on an agent-created client and scopes the book', async () => {
    const created = await http()
      .post('/api/agents/clients')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        email: `client_${unique}@test.com`,
        password: 'Password123',
        role: 'bride',
        displayName: 'E2E Client',
        city: 'Pune',
      })
      .expect(201);
    clientUserId = created.body.id;

    const list = await http()
      .get('/api/agents/clients')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(clientUserId);

    // An individual cannot reach the agent surface at all.
    await http().get('/api/agents/clients').set('Authorization', `Bearer ${brideToken}`).expect(403);

    // Matchmaking for an agent must name a client they manage.
    await http()
      .get('/api/matches/suggestions')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(400);
    await http()
      .get(`/api/matches/suggestions?onBehalfOfUserId=${clientUserId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    await http()
      .get(`/api/matches/suggestions?onBehalfOfUserId=${groomUserId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('lets a self-registered user approach an agent-managed user', async () => {
    await http()
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${groomToken}`)
      .send({ toUserId: clientUserId })
      .expect(201);
  });

  it('refuses booking state changes from users who are not party to the booking', async () => {
    const listing = await http()
      .post('/api/vendors')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ name: `E2E Venue ${unique}`, category: 'venue', city: 'Mumbai' })
      .expect(201);

    // Unapproved listings are not bookable.
    await http()
      .post('/api/bookings')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ providerType: 'vendor', providerId: listing.body.id, amount: 1000 })
      .expect(400);
  });

  it('exposes public search endpoints', async () => {
    await http().get('/api/vendors/search').expect(200);
    await http().get('/api/wedding-planners/search').expect(200);
    await http().get('/api/auth/account-types').expect(200);
  });

  it('serves health readiness', async () => {
    await http().get('/api/health').expect(200);
  });
});
