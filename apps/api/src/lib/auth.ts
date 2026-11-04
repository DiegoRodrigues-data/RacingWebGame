import { AppError, ACCESS_TOKEN_TTL_S, type Role } from '@tracado/shared';
import type { FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';

export interface AuthUser {
  id: string;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    tokenError: boolean;
  }
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function signAccessToken(secret: string, user: AuthUser, now: number): Promise<string> {
  return new SignJWT({ roles: user.roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + ACCESS_TOKEN_TTL_S)
    .setIssuer('tracado')
    .sign(enc(secret));
}

export async function verifyAccessToken(secret: string, token: string, now: number): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, enc(secret), { issuer: 'tracado', currentDate: new Date(now) });
  if (!payload.sub) throw new Error('sub ausente');
  return { id: payload.sub, roles: (payload.roles as Role[]) ?? ['player'] };
}

export function requireAuth(req: FastifyRequest): AuthUser {
  if (!req.user)
    throw new AppError(
      'UNAUTHORIZED',
      req.tokenError ? 'Sessão expirada.' : 'É preciso entrar na sua conta.',
    );
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const u = requireAuth(req);
  if (!u.roles.some((r) => roles.includes(r))) throw new AppError('FORBIDDEN', 'Permissão insuficiente.');
  return u;
}

export const isAdmin = (u: AuthUser | null) => !!u?.roles.includes('admin');
