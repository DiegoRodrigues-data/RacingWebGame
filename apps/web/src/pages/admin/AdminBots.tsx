import { LEVEL_LABELS, type GameSettings, type Level } from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Spinner, toast } from '../../components/ui';
import { errorMessage, get, patch, put } from '../../lib/api';
import { AdminPage } from './AdminNav';
import { Num, Section, Toggle } from './AdminSettings';

type Pool = GameSettings['botPool'];

interface Bot {
  userId: string;
  nickname: string;
  city: string;
  level: Level;
  active: boolean;
  activeToday: boolean;
  onlineNow: boolean;
  skill: number;
  aggression: number;
  pitRisk: number;
  joinRate: number;
  hourFrom: number;
  hourTo: number;
  races: number;
  wins: number;
  avgPosition: number | null;
  seasonPoints: number;
  entries24h: number;
}
interface BotsDto {
  settings: Pool;
  summary: { total: number; enabled: number; activeToday: number; onlineNow: number; pendingPlans: number };
  bots: Bot[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const hours = (b: Bot) =>
  b.hourFrom === b.hourTo ? 'o dia todo' : `${b.hourFrom}h às ${b.hourTo === 0 ? 24 : b.hourTo}h`;
const style = (b: Bot) =>
  b.aggression > 0.66 ? 'agressivo' : b.aggression < 0.33 ? 'conservador' : 'equilibrado';

/**
 * Pilotos simulados da grade automática: personagens que se inscrevem sozinhos e aparecem para os jogadores como
 * gente. Aqui ficam a configuração (seção `botPool` das configurações do jogo) e a lista para ligar ou desligar cada um.
 */
export default function AdminBots() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => get<{ settings: GameSettings }>('/admin/settings'),
  });
  const bots = useQuery({
    queryKey: ['admin-bots'],
    queryFn: () => get<BotsDto>('/admin/bots'),
    refetchInterval: 30_000,
  });
  const [pool, setPool] = useState<Pool | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'online' | 'off'>('all');
  useEffect(() => {
    if (settings.data) setPool(settings.data.settings.botPool);
  }, [settings.data]);
  if (!settings.data || !pool) return <Spinner />;
  const saved = settings.data.settings.botPool;
  const dirty = JSON.stringify(pool) !== JSON.stringify(saved);
  const set = (p: Partial<Pool>) => setPool({ ...pool, ...p });

  async function save() {
    setBusy(true);
    try {
      await put('/admin/settings', { ...settings.data!.settings, botPool: pool });
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      await qc.invalidateQueries({ queryKey: ['admin-bots'] });
      toast('Pilotos simulados salvos', 'Vale a partir da próxima corrida automática.', 'ok');
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBot(b: Bot) {
    try {
      const r = await patch<{ leftRaces: number }>(`/admin/bots/${b.userId}`, { active: !b.active });
      await qc.invalidateQueries({ queryKey: ['admin-bots'] });
      toast(
        b.active ? `${b.nickname} desligado` : `${b.nickname} ligado`,
        b.active && r.leftRaces ? `Saiu de ${r.leftRaces} corrida(s) ainda abertas.` : undefined,
        'ok',
      );
    } catch (x) {
      toast('Erro', errorMessage(x), 'error');
    }
  }

  const s = bots.data?.summary;
  const list = (bots.data?.bots ?? []).filter((b) =>
    filter === 'online' ? b.onlineNow : filter === 'off' ? !b.active : true,
  );

  return (
    <AdminPage
      title="Pilotos simulados"
      actions={
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {dirty ? 'Salvar' : 'Salvo'}
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {s && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Ligados', `${s.enabled} de ${s.total}`],
                ['Ativos hoje', s.activeToday],
                ['Online agora', s.onlineNow],
                ['Inscrições na fila', s.pendingPlans],
              ].map(([k, v]) => (
                <div key={k} className="card !p-3">
                  <div className="text-xs uppercase text-muted">{k}</div>
                  <div className="font-display text-2xl">{v}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['all', 'Todos'],
                ['online', 'Online agora'],
                ['off', 'Desligados'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={clsx(
                  'rounded-xl px-3 py-1.5 text-sm font-bold',
                  filter === k ? 'bg-race text-night' : 'bg-night-2 text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {!bots.data ? (
            <Spinner />
          ) : !bots.data.bots.length ? (
            <p className="card text-sm text-muted">
              Nenhum piloto simulado ainda. Ligue ao lado e salve: as personas são criadas na hora.
            </p>
          ) : (
            <div className="card overflow-x-auto !p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="p-3">Piloto</th>
                    <th>Habilidade</th>
                    <th>Estilo</th>
                    <th>Joga</th>
                    <th className="text-right">Corridas</th>
                    <th className="text-right">Vitórias</th>
                    <th className="text-right">Pts temp.</th>
                    <th className="pr-3 text-right">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => (
                    <tr key={b.userId} className={clsx('border-t border-line', !b.active && 'opacity-50')}>
                      <td className="p-3">
                        <Link to={`/pilotos/${b.userId}`} className="font-bold hover:text-race">
                          {b.nickname}
                        </Link>
                        <div className="text-xs text-muted">
                          {LEVEL_LABELS[b.level]} · {b.city}
                        </div>
                      </td>
                      <td>
                        <div className="h-1.5 w-20 rounded bg-night-2">
                          <div className="h-1.5 rounded bg-race" style={{ width: pct(b.skill) }} />
                        </div>
                        <span className="text-xs text-muted">{pct(b.skill)}</span>
                      </td>
                      <td className="text-xs">
                        {style(b)}
                        <div className="text-muted">entra em {pct(b.joinRate)}</div>
                      </td>
                      <td className="text-xs">
                        {hours(b)}
                        <div className={clsx(b.onlineNow ? 'text-go' : 'text-muted')}>
                          {b.onlineNow ? '● online' : b.activeToday ? 'ativo hoje' : 'folga hoje'}
                        </div>
                      </td>
                      <td className="text-right">
                        {b.races}
                        {b.avgPosition != null && (
                          <div className="text-xs text-muted">média {b.avgPosition.toFixed(1)}º</div>
                        )}
                      </td>
                      <td className="text-right">{b.wins}</td>
                      <td className="text-right">{b.seasonPoints}</td>
                      <td className="pr-3 text-right">
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleBot(b)}>
                          {b.active ? 'Desligar' : 'Ligar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Section
            title="Configuração"
            hint="Só na grade automática. Para os jogadores são pilotos comuns: sem marca de bot, com nível, cidade e histórico."
          >
            <Toggle
              label="Pilotos simulados ligados"
              checked={pool.enabled}
              onChange={(v) => set({ enabled: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Num
                label="Ativos por dia, de"
                value={pool.activeMin}
                min={0}
                max={60}
                onChange={(v) => set({ activeMin: v ?? 0 })}
              />
              <Num
                label="até"
                value={pool.activeMax}
                min={0}
                max={60}
                onChange={(v) => set({ activeMax: v ?? 0 })}
              />
              <Num
                label="No máximo por corrida"
                value={pool.perRaceMax}
                min={1}
                max={21}
                onChange={(v) => set({ perRaceMax: v ?? 1 })}
              />
              <Num
                label="Vagas guardadas p/ gente"
                value={pool.reserveSeats}
                min={0}
                max={10}
                onChange={(v) => set({ reserveSeats: v ?? 0 })}
              />
            </div>
            <Toggle
              label="Aparecem no ranking"
              checked={pool.inRanking}
              onChange={(v) => set({ inRanking: v })}
            />
            <Toggle
              label="Somam na contagem de online"
              checked={pool.countOnline}
              onChange={(v) => set({ countOnline: v })}
            />
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
              <li>Cada dia sorteia quem fica ativo; cada um só aparece no horário em que costuma jogar.</li>
              <li>Inscrevem-se aos poucos, nas 3 horas antes do treino, mais perto da largada.</li>
              <li>Com o grid cheio, o último que entrou cede a vaga para quem é gente.</li>
              <li>
                Desligar um piloto tira ele das corridas ainda abertas. Desligar todos só para as inscrições
                novas.
              </li>
              <li>
                Com eles ligados, o campo “Bots completando o grid” da grade automática em{' '}
                <Link to="/admin/configuracoes" className="font-bold text-race underline">
                  Configurações
                </Link>{' '}
                não é usado.
              </li>
            </ul>
          </Section>
        </aside>
      </div>
    </AdminPage>
  );
}
