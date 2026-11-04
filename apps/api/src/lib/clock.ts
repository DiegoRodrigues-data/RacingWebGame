/** Fonte única de tempo do servidor. Em dev/test pode ser adiantada para percorrer as fases rapidamente. */
export interface Clock {
  now(): number;
  advance?(ms: number): void;
  reset?(): void;
  readonly offset?: number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class OffsetClock implements Clock {
  offset = 0;
  now(): number {
    return Date.now() + this.offset;
  }
  advance(ms: number): void {
    this.offset += ms;
  }
  reset(): void {
    this.offset = 0;
  }
}

export class ManualClock implements Clock {
  constructor(private t: number = Date.UTC(2026, 10, 3, 12, 0, 0)) {}
  get offset(): number {
    return this.t - Date.now();
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
  reset(): void {}
}
