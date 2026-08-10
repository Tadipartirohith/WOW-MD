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
  const bride = { email: `bride_${unique}@test.com`, password: 'Password123', role: 'bride' };
  const groom = { email: `groom_${unique}@test.com`, password: 'Password123', role: 'groom' };
  let brideToken: string;
  let groomToken: string;
  let groomUserId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a bride and a groom', async () => {
    const r1 = await request(app.getHttpServer()).post('/api/auth/register').send(bride).expect(201);
    brideToken = r1.body.accessToken;
    expect(brideToken).toBeDefined();

    const r2 = await request(app.getHttpServer()).post('/api/auth/register').send(groom).expect(201);
    groomToken = r2.body.accessToken;
    groomUserId = r2.body.user.id;
  });

  it('rejects registration with a bad payload (validation)', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);
  });

  it('rejects protected routes without a token', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('creates profiles for both users', async () => {
    await request(app.getHttpServer())
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ displayName: 'Bride', gender: 'Female', dateOfBirth: '1996-01-01', city: 'Mumbai' })
      .expect(200);

    await request(app.getHttpServer())
      .put('/api/users/me/profile')
      .set('Authorization', `Bearer ${groomToken}`)
      .send({ displayName: 'Groom', gender: 'Male', dateOfBirth: '1994-01-01', city: 'Mumbai' })
      .expect(200);
  });

  it('runs the interest to accept flow', async () => {
    const sent = await request(app.getHttpServer())
      .post('/api/matches/interest')
      .set('Authorization', `Bearer ${brideToken}`)
      .send({ toUserId: groomUserId })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/api/matches/${sent.body.id}/accept`)
      .set('Authorization', `Bearer ${groomToken}`)
      .expect(200);
  });

  it('exposes public vendor search', async () => {
    await request(app.getHttpServer()).get('/api/vendors/search').expect(200);
  });

  it('serves health readiness', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});
