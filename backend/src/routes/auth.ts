import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config.js';
import { prisma } from '../lib/db.js';
import { AppError, parse } from '../lib/errors.js';
import { currentUser, requireAuth, signToken, toPublicUser } from '../lib/auth.js';

const loginSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address')),
  password: z.string({ message: 'Password is required' }).min(1, 'Password is required').max(200),
});

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('siteward-timing-guard', 10);

export function authRouter(config: Config) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' },
      });
    },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const publicUser = toPublicUser(user);
    res.json({
      token: signToken(publicUser, config.jwtSecret, config.jwtExpiresIn),
      user: publicUser,
    });
  });

  router.get('/me', requireAuth(config.jwtSecret), (req, res) => {
    res.json({ user: currentUser(req) });
  });

  return router;
}
