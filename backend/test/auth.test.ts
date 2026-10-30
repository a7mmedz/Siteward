import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/db.js';
import { PASSWORD, createUser, makeApp, resetDb } from './helpers.js';

const app = makeApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('POST /api/auth/login', () => {
  it('returns a token and the public user for valid credentials', async () => {
    const user = await createUser('inspector', 'Ina');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: user.id,
      email: user.email,
      name: 'Ina',
      role: 'inspector',
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    const user = await createUser('inspector');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.test', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    });
  });

  it('validates the body with field-level details (AC9)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'email', message: 'Enter a valid email address' },
        { path: 'password', message: 'Password is required' },
      ]),
    );
  });

  it('rejects malformed JSON with INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rate-limits repeated attempts', async () => {
    const limited = makeApp({ loginRateLimit: 2 });
    const send = () =>
      request(limited).post('/api/auth/login').send({ email: 'a@example.test', password: 'x' });
    await send();
    await send();
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user for a valid token', async () => {
    const user = await createUser('supervisor', 'Sue');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: 'supervisor' });
  });

  it('requires a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a token signed with another secret', async () => {
    const user = await createUser('inspector');
    const forged = jwt.sign({ sub: user.id, role: 'supervisor' }, 'some-other-secret-value');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const user = await createUser('inspector');
    const expired = jwt.sign({ sub: user.id }, process.env.JWT_SECRET!, { expiresIn: -10 });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/sign in again/);
  });
});

describe('misc', () => {
  it('GET /api/health reports the database status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('unknown routes return the standard error shape', async () => {
    const res = await request(app).get('/api/nope');
    // Unknown /api routes sit behind auth, so they are 401 without a token.
    expect(res.status).toBe(401);
    const res2 = await request(app).get('/not-api');
    expect(res2.status).toBe(404);
    expect(res2.body.error.code).toBe('NOT_FOUND');
  });

  it('sets security headers and CORS for allowed origins only', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    const denied = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
