import {
  driverStyle,
  LEVEL_LABELS,
  randomDriverProfile,
  type DriverProfile,
  type GameSettings,
  type Level,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Dices, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DriverSliders } from '../../components/DriverProfile';
import { Spinner, toast } from '../../components/ui';
import { errorMessage, get, patch, post, put } from '../../lib/api';
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
  driver: DriverProfile;
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
  summary: {
    total: number;
    enabled: number;
    activeToday: number;
    onlineNow: number;
    pendingPlans: number;
    poolSize: number;
  };
  bots: Bot[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const hours = (b: Bot) =>
  b.hourFrom === b.hourTo ? 'o dia todo' : `${b.hourFrom}h às ${b.hourTo === 0 ? 24 : b.hourTo}h`;
const style = (b: Bot) =>
  b.aggression > 0.66 ? 'agressivo' : b.aggression < 0.33 ? 'conservador' : 'equilibrado';

type Edit = Pick<
  Bot,
  'active' | 'skill' | 'aggression' | 'pitRisk' | 'joinRate' | 'hourFrom' | 'hourTo' | 'driver'
>;

/** Controle de 0 a 100% para os atributos da persona (guardados de 0 a 1). */
function Pct({
  label,
  value,
  onChange,
  left,
  right,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-sm">
        <span className="font-bold">{label}</span>
        <span className="font-mono text-muted">{pct(value)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="mt-1 w-full accent-[#ffcc00]"
      />
      <span className="flex justify-between text-[11px] text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </label>
  );
}

/** Edição de um piloto simulado: persona (habilidade, estilo, horário, vontade de correr) e perfil do piloto. */
function BotEditor({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const qc = useQueryClient();
  const pick = (b: Bot): Edit => ({
    active: b.active,
    skill: b.skill,
    aggression: b.aggression,
    pitRisk: b.pitRisk,
    joinRate: b.joinRate,
    hourFrom: b.hourFrom,
    hourTo: b.hourTo,
    driver: b.driver,
  });
  const [v, setV] = useState<Edit>(pick(bot));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setV(pick(bot));
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [bot.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Edit>) => setV({ ...v, ...p });
  const dirty = JSON.stringify(v) !== JSON.stringify(pick(bot));
  async function save() {
    setBusy(true);
    try {
      const r = await patch<{ leftRaces: number }>(`/admin/bots/${bot.userId}`, v);
      await qc.invalidateQueries({ queryKey: ['admin-bots'] });
      toast(
        `${bot.nickname} atualizado`,
        r.leftRaces
          ? `Desligado: saiu de ${r.leftRaces} corrida(s) ainda abertas.`
          : 'O perfil vale a partir das próximas inscrições.',
        'ok',
      );
    } catch (x) {
      toast('Não deu para salvar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section ref={ref} className="card space-y-4 border-race" aria-label={`Editar ${bot.nickname}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl">{bot.nickname}</h2>
          <p className="text-xs text-muted">
            {LEVEL_LABELS[bot.level]} · {bot.city} · {bot.races} corridas
          </p>
        </div>
        <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Fechar edição">
          <X size={18} />
        </button>
      </div>
      <Toggle
        label="Ligado (se inscreve nas corridas)"
        checked={v.active}
        onChange={(a) => set({ active: a })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="label">Persona</h3>
          <Pct
            label="Habilidade"
            value={v.skill}
            onChange={(x) => set({ skill: x })}
            left="erra traçado e setup"
            right="perto do ideal"
          />
          <Pct
            label="Estilo de setup"
            value={v.aggression}
            onChange={(x) => set({ aggression: x })}
            left="duros, motor econômico"
            right="macios, motor potente"
          />
          <Pct
            label="Arrisca parada extra"
            value={v.pitRisk}
            onChange={(x) => set({ pitRisk: x })}
            left="nunca"
            right="sempre"
          />
          <Pct
            label="Vontade de correr"
            value={v.joinRate}
            onChange={(x) => set({ joinRate: x })}
            left="quase nunca entra"
            right="entra em todas"
          />
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Joga das (h)"
              value={v.hourFrom}
              min={0}
              max={23}
              onChange={(x) => set({ hourFrom: x ?? 0 })}
            />
            <Num
              label="até (h)"
              value={v.hourTo}
              min={0}
              max={23}
              onChange={(x) => set({ hourTo: x ?? 0 })}
            />
          </div>
          <p className="text-[11px] text-muted">Hora de Brasília. Início igual ao fim = o dia todo.</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="label">Perfil do piloto · {driverStyle(v.driver)}</h3>
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1 !px-2 !py-1 text-xs"
              onClick={() => set({ driver: randomDriverProfile(Math.random) })}
            >
              <Dices size={14} aria-hidden /> Sortear
            </button>
          </div>
          <DriverSliders value={v.driver} onChange={(d) => set({ driver: d })} />
          <p className="text-[11px] text-muted">
            Em cada corrida ele mexe um pouco no perfil (até 8 pontos), como um jogador faria no box.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {dirty ? 'Salvar piloto' : 'Salvo'}
        </button>
        {dirty && (
          <button className="btn-ghost" onClick={() => setV(pick(bot))}>
            Desfazer
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Pilotos simulados da grade automática: personagens que se inscrevem sozinhos e aparecem para os jogadores como
 * gente. Aqui ficam a configuração (seção `botPool` das configurações do jogo), a lista com a edição de cada um
 * (persona e perfil do piloto) e a criação de mais pilotos.
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
  const [editing, setEditing] = useState<string | null>(null);
  const [more, setMore] = useState(5);
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

  async function createMore() {
    setBusy(true);
    try {
      const r = await post<{ created: number }>('/admin/bots', { count: more });
      await qc.invalidateQueries({ queryKey: ['admin-bots'] });
      toast(`${r.created} piloto(s) criado(s)`, 'Entram no rodízio de ativos a partir de agora.', 'ok');
    } catch (x) {
      toast('Não deu para criar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  const s = bots.data?.summary;
  const editBot = bots.data?.bots.find((b) => b.userId === editing) ?? null;
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
          {editBot && <BotEditor bot={editBot} onClose={() => setEditing(null)} />}
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
                    <th>Perfil</th>
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
                        <span className="font-bold">{driverStyle(b.driver)}</span>
                        <div className="font-mono text-muted" title="Ataque · Defesa · Ritmo">
                          {b.driver.attack}·{b.driver.defense}·{b.driver.pace}
                        </div>
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
                        <div className="flex justify-end gap-1">
                          <button
                            className={clsx(
                              'btn-ghost !px-2 !py-1 text-xs',
                              editing === b.userId && 'border-race text-race',
                            )}
                            onClick={() => setEditing(b.userId)}
                          >
                            Editar
                          </button>
                          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleBot(b)}>
                            {b.active ? 'Desligar' : 'Ligar'}
                          </button>
                        </div>
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
                label="Grid alvo, de"
                value={pool.gridMin}
                min={0}
                max={22}
                onChange={(v) => set({ gridMin: v ?? 0 })}
              />
              <Num
                label="até (carros)"
                value={pool.gridMax}
                min={0}
                max={22}
                onChange={(v) => set({ gridMax: v ?? 0 })}
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
              <li>
                Cada corrida sorteia um grid alvo entre os dois números (gente + simulados). Se faltar gente
                online no horário, entram outros pilotos simulados; nos 10 minutos antes do treino o motor
                completa o que faltar até o mínimo.
              </li>
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
          <Section
            title="Mais pilotos"
            hint={`O rodízio mantém pelo menos ${s?.poolSize ?? '…'} personas (o maior entre ativos por dia e grid alvo, mais folga). Crie mais para variar quem aparece.`}
          >
            <div className="flex items-end gap-2">
              <Num label="Quantos" value={more} min={1} max={30} onChange={(v) => setMore(v ?? 1)} />
              <button className="btn-ghost shrink-0" disabled={busy} onClick={createMore}>
                Criar pilotos
              </button>
            </div>
          </Section>
        </aside>
      </div>
    </AdminPage>
  );
}
