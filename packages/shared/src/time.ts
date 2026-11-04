/**
 * Estimativa do desvio entre relógio local e do servidor (algoritmo NTP simplificado).
 * offset = serverTime - (t0 + t1) / 2. Mantém a amostra de menor RTT.
 */
export class ClockSync {
  private best: { rtt: number; offset: number } | null = null;
  sample(clientSentAt: number, serverTime: number, clientReceivedAt: number): void {
    const rtt = clientReceivedAt - clientSentAt;
    const offset = serverTime - (clientSentAt + clientReceivedAt) / 2;
    // Mantém a amostra de menor RTT, mas aceita saltos grandes (relógio do servidor ajustado).
    if (!this.best || rtt <= this.best.rtt || Math.abs(offset - this.best.offset) > 1000 + rtt)
      this.best = { rtt, offset };
  }
  /** Ajuste passivo a partir de qualquer mensagem com serverTime (útil antes do primeiro ping). */
  passive(serverTime: number, receivedAt: number): void {
    const est = serverTime - receivedAt;
    // Sem amostra ainda, ou salto grande (> 2 s) no relógio do servidor: adota a estimativa passiva.
    if (!this.best || Math.abs(est - this.best.offset) > 2000)
      this.best = { rtt: Number.POSITIVE_INFINITY, offset: est };
  }
  get offset(): number {
    return this.best?.offset ?? 0;
  }
  get rtt(): number | null {
    return this.best && Number.isFinite(this.best.rtt) ? this.best.rtt : null;
  }
  now(local = Date.now()): number {
    return local + this.offset;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatLapTime(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
