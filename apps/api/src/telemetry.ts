import type { Config } from './config';

/** Observabilidade opcional: Sentry (SENTRY_DSN) e OpenTelemetry (OTEL_EXPORTER_OTLP_ENDPOINT). Carregados só se configurados. */
export async function initTelemetry(cfg: Config, log: (m: string) => void) {
  if (cfg.SENTRY_DSN) {
    try {
      const mod = '@sentry/node';
      const Sentry = (await import(/* @vite-ignore */ mod)) as { init(o: object): void };
      Sentry.init({ dsn: cfg.SENTRY_DSN, environment: cfg.NODE_ENV, tracesSampleRate: 0.1 });
      log('Sentry ativado');
    } catch {
      log('SENTRY_DSN definido, mas @sentry/node não está instalado (pnpm add @sentry/node)');
    }
  }
  if (cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      const sdkMod = '@opentelemetry/sdk-node';
      const autoMod = '@opentelemetry/auto-instrumentations-node';
      const { NodeSDK } = (await import(/* @vite-ignore */ sdkMod)) as {
        NodeSDK: new (o: object) => { start(): void };
      };
      const { getNodeAutoInstrumentations } = (await import(/* @vite-ignore */ autoMod)) as {
        getNodeAutoInstrumentations(): unknown;
      };
      new NodeSDK({ serviceName: 'tracado-api', instrumentations: [getNodeAutoInstrumentations()] }).start();
      log('OpenTelemetry ativado');
    } catch {
      log('OTEL_EXPORTER_OTLP_ENDPOINT definido, mas os pacotes OpenTelemetry não estão instalados');
    }
  }
}
