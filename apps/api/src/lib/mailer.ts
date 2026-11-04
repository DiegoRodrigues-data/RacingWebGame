import type { FastifyBaseLogger } from 'fastify';

/** Envio de e-mail. No MVP apenas registra no log (o provedor real é uma decisão pendente). */
export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
  readonly sent: { to: string; subject: string; body: string }[];
}

export class LogMailer implements Mailer {
  readonly sent: { to: string; subject: string; body: string }[] = [];
  constructor(private readonly log: FastifyBaseLogger) {}
  async send(to: string, subject: string, body: string) {
    this.sent.push({ to, subject, body });
    if (this.sent.length > 200) this.sent.shift();
    this.log.info({ mail: { to, subject } }, `E-mail (simulado): ${subject}\n${body}`);
  }
}
