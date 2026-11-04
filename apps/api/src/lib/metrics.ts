import client from 'prom-client';

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'tracado_' });
  const m = {
    registry,
    httpDuration: new client.Histogram({
      name: 'tracado_http_request_duration_seconds',
      help: 'Duração das requisições HTTP',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [registry],
    }),
    wsConnections: new client.Gauge({
      name: 'tracado_ws_connections',
      help: 'Sockets conectados',
      registers: [registry],
    }),
    wsMessagesOut: new client.Counter({
      name: 'tracado_ws_messages_out_total',
      help: 'Mensagens WS enviadas',
      labelNames: ['type'],
      registers: [registry],
    }),
    racesByStatus: new client.Gauge({
      name: 'tracado_races',
      help: 'Corridas por fase',
      labelNames: ['status'],
      registers: [registry],
    }),
    entries: new client.Counter({
      name: 'tracado_entries_total',
      help: 'Inscrições',
      labelNames: ['result'],
      registers: [registry],
    }),
    transitionLag: new client.Histogram({
      name: 'tracado_phase_transition_lag_seconds',
      help: 'Atraso real da transição de fase em relação ao horário planejado',
      labelNames: ['to'],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 120],
      registers: [registry],
    }),
    engineTick: new client.Histogram({
      name: 'tracado_engine_tick_seconds',
      help: 'Duração do tick do motor de fases',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [registry],
    }),
    simDuration: new client.Histogram({
      name: 'tracado_sim_duration_seconds',
      help: 'Duração da simulação (classificação + corrida)',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [registry],
    }),
    errors: new client.Counter({
      name: 'tracado_errors_total',
      help: 'Erros por código',
      labelNames: ['code'],
      registers: [registry],
    }),
  };
  return m;
}
export type Metrics = ReturnType<typeof createMetrics>;
