import { z } from 'zod';
import { roleSchema, type Level, type Role } from './schemas';

/**
 * Gestão de usuários (modelo do Gerador_Prompt): situação da conta, regra de novos cadastros, Master definido
 * pelo ambiente e administradores por e-mail (`ADMIN_EMAILS`).
 */

/** active: joga normalmente; pending: cadastro aguardando o admin aprovar; blocked: não entra mais. */
export const USER_STATUSES = ['active', 'pending', 'blocked'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Regra de novos cadastros, para as três portas de entrada (e-mail e senha, Google e convidado):
 * - open: a conta nova entra na hora;
 * - approval: a conta nova fica aguardando o admin aprovar (convidado, que não tem como voltar, é recusado);
 * - closed: só entra quem já tem conta (o admin ainda cadastra pelo painel).
 * Os e-mails de `ADMIN_EMAILS` entram pelo Google mesmo com os cadastros fechados ou sob aprovação.
 */
export const SIGNUP_MODES = ['open', 'approval', 'closed'] as const;
export const signupModeSchema = z.enum(SIGNUP_MODES);
export type SignupMode = z.infer<typeof signupModeSchema>;

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^@/, ''))
  .pipe(
    z
      .string()
      .max(100)
      .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Domínio inválido'),
  );

export const accessPolicySchema = z.object({
  signupMode: signupModeSchema,
  /** Domínios de e-mail aceitos em contas novas; vazio = qualquer um. Com a lista, convidado não entra. */
  signupDomains: z
    .array(domain)
    .max(20)
    .transform((ds) => [...new Set(ds)]),
});
export type AccessPolicy = z.infer<typeof accessPolicySchema>;
export const DEFAULT_ACCESS_POLICY: AccessPolicy = { signupMode: 'open', signupDomains: [] };

/** Domínio permitido para um e-mail (lista vazia = qualquer domínio). */
export const emailDomainAllowed = (email: string, domains: readonly string[]) =>
  !domains.length || domains.includes(email.split('@').pop()!.toLowerCase());

/** Frase digitada para excluir uma conta (igual no servidor e no painel). */
export const SAFETY_PHRASE = 'EXCLUIR DEFINITIVAMENTE';

const nickname = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_\-À-ÿ]+$/u, 'Use letras, números, _ ou -');
const email = z.string().trim().toLowerCase().email().max(254);

/** Conta criada pelo admin no painel: já entra ativa e com o e-mail dado como verificado. */
export const adminUserCreateSchema = z.object({
  nickname,
  email,
  password: z.string().min(8).max(128),
  region: z.string().trim().min(2).max(40).optional(),
  city: z.string().trim().min(2).max(60).optional(),
});
export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;

/** Edição pelo admin. Senha em branco mantém a atual; trocar a senha encerra as sessões da pessoa. */
export const adminUserUpdateSchema = z.object({
  nickname: nickname.optional(),
  email: email.optional(),
  password: z.string().min(8).max(128).optional(),
  roles: z.array(roleSchema).min(1).optional(),
  flagged: z.boolean().optional(),
});
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

/** Aprovar (pending → active), bloquear ou desbloquear. */
export const adminUserStatusSchema = z.object({ status: z.enum(['active', 'blocked']) });

export const adminUserDeleteSchema = z.object({ confirmation: z.string().max(60) });

/** De onde vem o acesso de admin: o Master (ADMIN_EMAIL), um e-mail de ADMIN_EMAILS ou o papel dado no painel. */
export type AdminSource = 'master' | 'email' | 'role' | null;

export interface AdminUserDto {
  id: string;
  email: string;
  nickname: string;
  roles: Role[];
  status: UserStatus;
  adminSource: AdminSource;
  google: boolean;
  guest: boolean;
  isBot: boolean;
  hasPassword: boolean;
  flagged: boolean;
  verified: boolean;
  level: Level;
  careerRaces: number;
  createdAt: string;
  lastLoginAt: string | null;
  signupIp: string | null;
}

export interface AdminUsersDto {
  users: AdminUserDto[];
  /** Cadastros aguardando aprovação (independe do filtro). */
  pending: number;
}

export interface AccessDto extends AccessPolicy {
  googleLogin: boolean;
}
