import { ROOM, type NotificationDto, type NotificationType } from '@tracado/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { notifications, profiles, users } from '../../db/schema';

type P = Record<string, unknown> & { raceName?: string };

const TEMPLATES: Record<NotificationType, (p: P) => { title: string; body: string }> = {
  entry_confirmed: (p) => ({ title: 'Inscrição confirmada', body: `Você está no grid de ${p.raceName}.` }),
  entry_waitlisted: (p) => ({
    title: 'Você está na fila',
    body: `${p.raceName} lotou. Você é o ${p.position}º da fila.`,
  }),
  entry_promoted: (p) => ({
    title: 'Vaga liberada!',
    body: `Uma vaga abriu e você entrou no grid de ${p.raceName}.`,
  }),
  trace_window_open: (p) => ({
    title: 'Hora de traçar!',
    body: `A janela de 5 minutos de ${p.raceName} abriu. Desenhe seu traçado.`,
  }),
  trace_window_closing: (p) => ({
    title: 'Falta 1 minuto',
    body: `A janela de traçado de ${p.raceName} fecha em 1 minuto.`,
  }),
  qualifying_ready: (p) => ({
    title: 'Classificação definida',
    body: `Você larga em ${p.position}º em ${p.raceName}.`,
  }),
  race_started: (p) => ({ title: 'Luzes apagadas!', body: `${p.raceName} começou. Acompanhe ao vivo.` }),
  result_published: (p) => ({
    title: 'Resultado publicado',
    body: `Você terminou em ${p.position}º em ${p.raceName} (${p.points} pts).`,
  }),
  race_cancelled: (p) => ({
    title: 'Corrida cancelada',
    body: `${p.raceName} foi cancelada. ${p.reason ?? ''}`.trim(),
  }),
  result_annulled: (p) => ({
    title: 'Resultado anulado',
    body: `O resultado de ${p.raceName} foi anulado. ${p.reason ?? ''}`.trim(),
  }),
  level_changed: (p) => ({ title: 'Novo nível', body: `Seu nível agora é ${p.level}.` }),
};
const EMAIL_TYPES: NotificationType[] = ['trace_window_open', 'race_started', 'entry_promoted'];

export function toDto(r: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    payload: r.payload,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Uma notificação por usuário: grava, envia por WS e, se o jogador optou, por e-mail. */
export async function notify(
  ctx: Ctx,
  userIds: string[] | { userId: string; payload: P }[],
  type: NotificationType,
  payload: P = {},
) {
  const items = userIds.map((u) =>
    typeof u === 'string'
      ? { userId: u, payload }
      : { userId: u.userId, payload: { ...payload, ...u.payload } },
  );
  if (!items.length) return;
  const rows = await ctx.db
    .insert(notifications)
    .values(
      items.map((i) => ({
        userId: i.userId,
        type,
        ...TEMPLATES[type](i.payload),
        payload: i.payload,
        createdAt: new Date(ctx.clock.now()),
      })),
    )
    .returning();
  for (const r of rows) await ctx.hub.publish(ROOM.user(r.userId), 'notification', toDto(r));
  if (EMAIL_TYPES.includes(type)) {
    const wants = await ctx.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          inArray(
            users.id,
            items.map((i) => i.userId),
          ),
          eq(profiles.emailReminders, true),
          eq(users.isBot, false),
        ),
      );
    for (const w of wants) {
      const r = rows.find((x) => x.userId === w.id)!;
      await ctx.mailer.send(w.email, r.title, `${r.body}\n${ctx.config.PUBLIC_WEB_URL}`);
    }
  }
}

export async function list(ctx: Ctx, userId: string, limit = 50) {
  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map(toDto);
}

export async function markRead(ctx: Ctx, userId: string, id: string | 'all') {
  const now = new Date(ctx.clock.now());
  await ctx.db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        id === 'all' ? undefined : eq(notifications.id, id),
      ),
    );
}
