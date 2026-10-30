import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { prisma } from './db.js';
import { forbidden, unauthorized } from './errors.js';

export type AuthUser = { id: string; email: string; name: string; role: Role };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser, secret: string, expiresIn: string): string {
  return jwt.sign({ sub: user.id, role: user.role }, secret, {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function toPublicUser(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Verifies the Bearer token and loads the current user (so role changes take effect at once). */
export function requireAuth(secret: string): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let userId: string;
    try {
      const payload = jwt.verify(header.slice('Bearer '.length), secret);
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error();
      userId = payload.sub;
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized('Your session has expired. Please sign in again.');
    req.user = toPublicUser(user);
    next();
  };
}

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (req.user?.role !== role) throw forbidden(`Only a ${role} can do this`);
    next();
  };
}

/** The authenticated user. Only call after `requireAuth`. */
export function currentUser(req: Express.Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Inspectors may only touch their own inspections; supervisors may touch all. */
export function canAccessInspection(user: AuthUser, inspection: { inspectorId: string }): boolean {
  return user.role === 'supervisor' || inspection.inspectorId === user.id;
}
