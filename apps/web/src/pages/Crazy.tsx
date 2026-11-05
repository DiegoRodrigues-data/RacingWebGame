import {
  CAR_COLORS,
  CRAZY_AWARDS,
  DEFAULT_GAME_SETTINGS,
  PHASE_LABELS,
  type AuthResponse,
  type CrazyAwardKey,
  type CrazyGroupDto,
  type CrazyGroupSummaryDto,
  type CrazyInviteDto,
  type CrazyRaceDto,
  type RacePhase,
} from '@tracado/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import clsx from 'clsx';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CAR_COLOR_LABEL } from '../components/CarPicker';
import { AwardList, CarDot, RaceReadyBar } from '../components/CrazyBits';
import { RaceMiniMap } from '../components/RaceMiniMap';
import { ShareMenu } from '../components/ShareRace';
import { CarIcon, Countdown, Empty, PhaseBadge, Segmented, Skeleton, Spinner, toast } from '../components/ui';
import { ApiError, errorMessage, get, post } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { usePublicSettings } from '../lib/queries';
import { realtime } from '../lib/realtime';
import { useSession } from '../lib/session';

const STATUS_LABEL: Record<CrazyGroupSummaryDto['status'], string> = {
  upcoming: 'Vai começar',
  running: 'Rolando',
  finished: 'Encerrado',
};
const STATUS_CLASS: Record<CrazyGroupSummaryDto['status'], string> = {
  upcoming: 'border-sky text-sky',
  running: 'border-go text-go',
  finished: 'border-muted text-muted',
};

const AWARD_KEYS = Object.keys(CRAZY_AWARDS) as CrazyAwardKey[];

function Hero({ children }: { children?: ReactNode }) {
  const maxRaces = (usePublicSettings().data?.crazy ?? DEFAULT_GAME_SETTINGS.crazy).maxRaces;
  return (
    <header className="card relative overflow-hidden border-violet/60">
      <div className="pointer-events-none absolute -right-6 -top-6 select-none text-[120px] leading-none opacity-15">
        🤪
      </div>
      <h1 className="font-display text-4xl">
        Corrida <span className="text-violet">Maluca</span>
      </h1>
      <p className="mt-2 max-w-2xl text-muted">
        Monte uma corrida ou um campeonato de até {maxRaces} corridas só para a sua turma. Mande o link no
        grupo, cada um coloca o apelido e entra. Não vale ranking: vale a resenha.
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Troféus da zoeira">
        {AWARD_KEYS.map((k) => (
          <li key={k} className="chip border-line text-ink" title={CRAZY_AWARDS[k].what}>
            {CRAZY_AWARDS[k].emoji} {CRAZY_AWARDS[k].title}
          </li>
        ))}
      </ul>
      {children}
    </header>
  );
}

function GroupCard({ g }: { g: CrazyGroupSummaryDto }) {
  return (
    <Link to={`/corrida-maluca/${g.id}`} className="card block space-y-2 transition hover:border-violet">
      {g.featured && (
        <div className="relative">
          <RaceMiniMap race={g.featured} className="aspect-[16/8] w-full" />
          <span className="absolute bottom-2 left-2 rounded-full bg-night/85 px-2 py-0.5 text-[11px] font-bold backdrop-blur">
            {g.races > 1 && `Etapa ${g.featured.crazy?.round ?? 1} · `}
            {g.featured.track.name}
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-xl">{g.name}</div>
          <div className="text-xs text-muted">organizado por {g.ownerNickname}</div>
        </div>
        <span className={clsx('chip', STATUS_CLASS[g.status])}>{STATUS_LABEL[g.status]}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          🏁 {g.finishedRaces}/{g.races} {g.races > 1 ? 'corridas' : 'corrida'}
        </span>
        <span>👥 {g.members} na turma</span>
        {g.featured &&
        !['scheduled', 'registration_open'].includes(g.featured.status) &&
        g.status !== 'finished' ? (
          <span className="font-bold text-race">● {PHASE_LABELS[g.featured.status]} agora</span>
        ) : (
          g.nextRaceAt && (
            <span>
              ⏱️ próxima em <Countdown to={g.nextRaceAt} className="text-ink" />
            </span>
          )
        )}
      </div>
    </Link>
  );
}

/** Grupos encerrados: uma linha por grupo, recolhido depois dos 5 primeiros (para não ocupar a tela). */
function GroupHistory({ groups }: { groups: CrazyGroupSummaryDto[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, 5);
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">
        Histórico <span className="text-base text-muted">({groups.length})</span>
      </h2>
      <div className="card !p-0">
        <ul className="divide-y divide-line/60">
          {shown.map((g) => (
            <li key={g.id}>
              <Link
                to={`/corrida-maluca/${g.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-night-3/50"
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted">
                  {g.featured
                    ? new Date(g.featured.timeline.practiceAt).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                      })
                    : ''}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {g.finishedRaces}/{g.races} {g.races > 1 ? 'corridas' : 'corrida'} · {g.members} na turma
                    · por {g.ownerNickname}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-bold text-violet">Ver tabela</span>
              </Link>
            </li>
          ))}
        </ul>
        {groups.length > 5 && (
          <button
            className="w-full border-t border-line/60 py-2 text-sm font-bold text-muted hover:text-ink"
            onClick={() => setAll((v) => !v)}
          >
            {all ? 'Mostrar menos' : `Ver todos (${groups.length})`}
          </button>
        )}
      </div>
    </section>
  );
}

function localInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const START_OPTIONS = [
  { value: 5, label: 'Em 5 min' },
  { value: 15, label: 'Em 15 min' },
  { value: 30, label: 'Em 30 min' },
  { value: 60, label: 'Em 1 h' },
  { value: -1, label: 'Escolher' },
];
const INTERVAL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 20, label: '20 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 1440, label: '1 dia' },
  { value: 10080, label: '1 semana' },
];

/** Duração em texto curto: "2 min", "90 s", "1 min 30 s". */
const dur = (sec: number) =>
  sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}` : `${sec} s`;

function CreateGroup() {
  const pub = usePublicSettings().data;
  const lim = pub?.crazy ?? DEFAULT_GAME_SETTINGS.crazy;
  const ph = pub?.phases ?? DEFAULT_GAME_SETTINGS.phases;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [races, setRaces] = useState(1);
  const [laps, setLaps] = useState(lim.lapsDefault);
  const [startIn, setStartIn] = useState(15);
  const [startAt, setStartAt] = useState(() => localInput(Date.now() + 60 * 60_000));
  const [interval, setIntervalMin] = useState(20);
  const [chaos, setChaos] = useState(lim.chaosDefault);
  const [bots, setBots] = useState(lim.botFillDefault > 0);
  const [botFill, setBotFill] = useState(lim.botFillDefault || 8);
  const [busy, setBusy] = useState(false);
  // Padrões do admin chegam depois do primeiro render: aplica uma vez.
  const applied = useRef(false);
  useEffect(() => {
    if (!pub || applied.current) return;
    applied.current = true;
    setLaps(pub.crazy.lapsDefault);
    setChaos(pub.crazy.chaosDefault);
    setBots(pub.crazy.botFillDefault > 0);
    if (pub.crazy.botFillDefault) setBotFill(pub.crazy.botFillDefault);
  }, [pub]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const at = startIn > 0 ? realtime.clock.now() + startIn * 60_000 : new Date(startAt).getTime();
    setBusy(true);
    try {
      const g = await post<CrazyGroupDto>('/crazy/groups', {
        name: name.trim(),
        races,
        laps,
        startAt: new Date(at).toISOString(),
        intervalMinutes: interval,
        chaos,
        botFill: bots ? botFill : 0,
      });
      await qc.invalidateQueries({ queryKey: ['crazy-groups'] });
      void confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } });
      nav(`/corrida-maluca/${g.id}?novo=1`);
    } catch (x) {
      toast('Não deu para criar o grupo', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="font-display text-2xl">Criar grupo</h2>
      <label className="block">
        <span className="label">Nome do grupo</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Copa do Churrasco"
          minLength={3}
          maxLength={40}
          required
        />
      </label>
      <div>
        <span className="label">Quantas corridas</span>
        <Segmented
          label="Quantas corridas"
          value={races}
          onChange={setRaces}
          options={[...new Set([1, 2, 3, 5, 8, 10, lim.maxRaces])]
            .filter((n) => n <= lim.maxRaces)
            .sort((a, b) => a - b)
            .map((n) => ({ value: n, label: n === 1 ? 'Só uma' : `${n} (campeonato)` }))}
        />
      </div>
      <div>
        <span className="label">Voltas por corrida</span>
        <Segmented
          label="Voltas por corrida"
          value={laps}
          onChange={setLaps}
          options={[
            { value: 5, label: '5 · relâmpago' },
            { value: 8, label: '8 · rápida' },
            { value: 12, label: '12 · média' },
            { value: 20, label: '20 · longa' },
            ...([5, 8, 12, 20].includes(lim.lapsDefault)
              ? []
              : [{ value: lim.lapsDefault, label: `${lim.lapsDefault} · padrão` }]),
          ].sort((a, b) => a.value - b.value)}
        />
      </div>
      <div>
        <span className="label">Começa (treino da primeira corrida)</span>
        <Segmented label="Começa" value={startIn} onChange={setStartIn} options={START_OPTIONS} />
        {startIn < 0 && (
          <input
            type="datetime-local"
            className="input mt-2 max-w-xs"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            required
            aria-label="Data e hora da primeira corrida"
          />
        )}
        <p className="mt-1 text-xs text-muted">
          Cada corrida tem treino ({dur(Math.round(ph.practiceMin * 60))}), classificação ao vivo (
          {dur(ph.qualifyingSec)}) e a corrida. O traçado e o setup valem até o fim do treino.
        </p>
      </div>
      {races > 1 && (
        <div>
          <span className="label">Uma corrida a cada</span>
          <Segmented
            label="Intervalo entre corridas"
            value={interval}
            onChange={setIntervalMin}
            options={INTERVAL_OPTIONS}
          />
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={chaos}
          onChange={(e) => setChaos(e.target.checked)}
          className="mt-0.5 size-4 accent-[#9b7bff]"
        />
        <span>
          <b>Modo caos</b>: óleo na pista, safety car e motor que quebra. Mais zoeira, menos justiça.
        </span>
      </label>
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={bots}
            onChange={(e) => setBots(e.target.checked)}
            className="mt-0.5 size-4 accent-[#9b7bff]"
          />
          <span>
            <b>Completar o grid com bots</b> se faltar gente. Desligado, só correm os amigos. Bots nunca
            pontuam nem levam troféu.
          </span>
        </label>
        {bots && (
          <div className="pl-6">
            <span className="label">Completar até</span>
            <Segmented
              label="Completar o grid até"
              value={botFill}
              onChange={setBotFill}
              options={[6, 8, 12, 16, 22].map((n) => ({ value: n, label: `${n} carros` }))}
            />
          </div>
        )}
      </div>
      <button className="btn-primary" disabled={busy || name.trim().length < 3}>
        {busy ? 'Criando…' : 'Criar e pegar o link de convite'}
      </button>
    </form>
  );
}

/** /corrida-maluca: meus grupos e criação. */
export function CrazyHome() {
  const me = useSession((s) => s.me);
  const { data, isLoading } = useQuery({
    queryKey: ['crazy-groups'],
    queryFn: () => get<CrazyGroupSummaryDto[]>('/crazy/groups'),
    enabled: !!me,
    refetchInterval: 30_000,
  });
  const active = (data ?? []).filter((g) => g.status !== 'finished');
  const ended = (data ?? []).filter((g) => g.status === 'finished');
  return (
    <div className="space-y-6">
      <Hero />
      {me && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Meus grupos</h2>
          {isLoading && <Skeleton className="h-28" />}
          {data && !data.length && (
            <p className="text-sm text-muted">
              Você ainda não está em nenhum grupo. Crie um ou abra um convite.
            </p>
          )}
          {data && data.length > 0 && !active.length && (
            <p className="text-sm text-muted">Nenhum grupo rolando agora. Que tal criar outro?</p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((g) => (
              <GroupCard key={g.id} g={g} />
            ))}
          </div>
        </section>
      )}
      {ended.length > 0 && <GroupHistory groups={ended} />}
      {!me && (
        <div className="card space-y-2">
          <p>
            Para <b>criar</b> um grupo, entre na sua conta. Recebeu um <b>convite</b>? É só abrir o link que
            te mandaram: dá para entrar só com o apelido.
          </p>
          <Link to="/entrar?voltar=/corrida-maluca" className="btn-primary">
            Entrar para criar um grupo
          </Link>
        </div>
      )}
      {me?.guest && (
        <div className="card space-y-2">
          <p className="text-sm">
            Você entrou como convidado. Para <b>criar</b> o seu próprio grupo, transforme seu acesso em conta
            (só e-mail e senha, o apelido continua o mesmo).
          </p>
          <Link to="/conta" className="btn-ghost">
            Criar minha conta
          </Link>
        </div>
      )}
      {me && !me.guest && <CreateGroup />}
    </div>
  );
}

/** /corrida-maluca/convite/:code — entra no grupo (com conta ou só com apelido). */
export function CrazyInvite() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me, apply } = useSession();
  const { data, error, isLoading } = useQuery({
    queryKey: ['crazy-invite', code, me?.id ?? null],
    queryFn: () => get<CrazyInviteDto>(`/crazy/invite/${code}`),
  });
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState<string>('red');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.isMember) nav(`/corrida-maluca/${data.id}`, { replace: true });
  }, [data, nav]);
  if (isLoading) return <Spinner />;
  if (error || !data)
    return (
      <Empty title="Convite não encontrado" icon="🤔">
        <p className="text-sm text-muted">Confira o link com quem te chamou.</p>
      </Empty>
    );

  async function joinWithAccount() {
    setBusy(true);
    try {
      const r = await post<{ groupId: string }>(`/crazy/invite/${code}/join`);
      await qc.invalidateQueries({ queryKey: ['crazy-groups'] });
      nav(`/corrida-maluca/${r.groupId}?novo=1`);
    } catch (x) {
      toast('Não deu para entrar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function joinAsGuest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSuggestion(null);
    try {
      const r = await post<AuthResponse & { groupId: string }>('/auth/guest', {
        inviteCode: code,
        nickname: nickname.trim(),
        carColor: color,
      });
      apply(r);
      realtime.reconnect();
      nav(`/corrida-maluca/${r.groupId}?novo=1`);
    } catch (x) {
      if (x instanceof ApiError && x.code === 'NICKNAME_TAKEN')
        setSuggestion((x.details as { suggestion?: string } | undefined)?.suggestion ?? null);
      toast('Não deu para entrar', errorMessage(x), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="card space-y-3 border-violet/60 text-center">
        <div className="text-5xl">🤪</div>
        <div className="text-sm font-bold uppercase tracking-wider text-violet">
          Convite para a Corrida Maluca
        </div>
        <h1 className="font-display text-3xl">{data.name}</h1>
        <p className="text-sm text-muted">
          {data.ownerNickname} chamou você para{' '}
          {data.races > 1 ? `um campeonato de ${data.races} corridas` : 'uma corrida'}.
          {data.nextRaceAt && (
            <>
              {' '}
              {data.status === 'running' ? 'Próxima corrida em' : 'Começa em'}{' '}
              <Countdown to={data.nextRaceAt} className="text-ink" />.
            </>
          )}
        </p>
        <ul className="flex flex-wrap justify-center gap-1.5">
          {data.members.map((n) => (
            <li key={n} className="chip border-line text-ink">
              {n}
            </li>
          ))}
        </ul>
      </div>
      {data.status === 'finished' ? (
        <div className="card text-center text-sm text-muted">Este campeonato já terminou.</div>
      ) : data.full ? (
        <div className="card text-center text-sm text-muted">O grupo já está completo.</div>
      ) : me ? (
        <div className="card space-y-3 text-center">
          <p>
            Você vai entrar como <b className="text-race">{me.profile.nickname}</b>.
          </p>
          <button className="btn-primary w-full" disabled={busy} onClick={joinWithAccount}>
            Entrar no grupo
          </button>
        </div>
      ) : (
        <form onSubmit={joinAsGuest} className="card space-y-4">
          <label className="block">
            <span className="label">Seu apelido</span>
            <input
              className="input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Ex.: Zé_do_Kart"
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_\-À-ÿ]+"
              title="Letras, números, _ ou - (sem espaço)"
              autoFocus
              required
            />
          </label>
          {suggestion && (
            <p className="text-sm text-muted">
              Esse já tem dono. Que tal{' '}
              <button
                type="button"
                className="font-bold text-race underline"
                onClick={() => setNickname(suggestion)}
              >
                {suggestion}
              </button>
              ?
            </p>
          )}
          <div>
            <span className="label">Cor do carro</span>
            <Segmented
              label="Cor do carro"
              value={color}
              onChange={setColor}
              options={CAR_COLORS.map((c) => ({
                value: c,
                label: (
                  <span className="flex items-center gap-1.5" title={CAR_COLOR_LABEL[c]}>
                    <CarIcon color={c} model={1} className="h-6" />
                  </span>
                ),
              }))}
            />
          </div>
          <button className="btn-primary w-full" disabled={busy || nickname.trim().length < 3}>
            {busy ? 'Entrando…' : 'Entrar na corrida 🏁'}
          </button>
          <p className="text-center text-xs text-muted">
            Sem e-mail nem senha. Já tem conta?{' '}
            <Link
              to={`/entrar?voltar=/corrida-maluca/convite/${code}`}
              className="font-bold text-race underline"
            >
              Entre com ela
            </Link>
            .
          </p>
        </form>
      )}
    </div>
  );
}

/** /corrida-maluca/voltar/:key — link pessoal do convidado para entrar em outro aparelho. */
export function CrazyResume() {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const apply = useSession((s) => s.apply);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    post<AuthResponse>('/auth/guest/resume', { key })
      .then((r) => {
        apply(r);
        realtime.reconnect();
        nav('/corrida-maluca', { replace: true });
      })
      .catch((x) => setErr(errorMessage(x)));
  }, [key, apply, nav]);
  if (!err) return <Spinner label="Entrando" />;
  return (
    <Empty title="Não deu para entrar" icon="🔑">
      <p className="text-sm text-muted">{err}</p>
    </Empty>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex gap-2">
      <input
        className="input min-w-0 flex-1 font-mono text-xs"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        className="btn-ghost !px-3"
        aria-label={`Copiar ${label}`}
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => toast('Copiado!', undefined, 'ok'))
            .catch(() => toast('Não deu para copiar', 'Selecione e copie o texto.', 'warn'))
        }
      >
        <Copy size={16} />
      </button>
    </div>
  );
}

function InviteCard({ g }: { g: CrazyGroupDto }) {
  // Link /s/...: o WhatsApp mostra a prévia do convite (nome do grupo e quem chamou) e redireciona.
  const url = `${window.location.origin}/s/maluca/${g.inviteCode}`;
  const text = `🤪 Bora correr na Corrida Maluca "${g.name}"? Entra só com o apelido, sem cadastro:`;
  return (
    <section className="card space-y-2 border-violet/60">
      <h2 className="font-display text-xl">Chame a turma</h2>
      <p className="text-sm text-muted">
        Quem abrir o link coloca o apelido e já entra em todas as próximas corridas.
      </p>
      <CopyField value={url} label="link de convite" />
      <div className="flex flex-wrap gap-2">
        <a
          className="btn-go !py-1.5"
          href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Mandar no WhatsApp
        </a>
        <ShareMenu title={g.name} text={text} url={url} label="Outras redes" />
      </div>
    </section>
  );
}

/** Compartilhar o grupo (tabela e resenha; no fim, o campeão). Não leva o convite. */
function ShareGroup({ g }: { g: CrazyGroupDto }) {
  const champ = g.standings[0];
  const text =
    g.status === 'finished' && champ?.races
      ? `🏆 ${champ.nickname} venceu a ${g.name} na Corrida Maluca! Olha a resenha e os troféus da zoeira:`
      : `🤪 Acompanhe a ${g.name} na Corrida Maluca: tabela e resenha de cada corrida.`;
  return (
    <ShareMenu
      title={g.name}
      text={text}
      url={`${window.location.origin}/s/grupo/${g.id}`}
      label="Compartilhar"
    />
  );
}

function GuestCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card space-y-2">
      <h2 className="font-display text-lg">Você está como convidado</h2>
      <p className="text-sm text-muted">
        Seu acesso fica neste navegador. Para entrar de outro celular ou computador, guarde seu link pessoal
        de volta (não mande para ninguém: quem tiver o link entra como você).
      </p>
      {url ? (
        <CopyField value={url} label="link de volta" />
      ) : (
        <button
          className="btn-ghost !py-1.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setUrl((await post<{ url: string }>('/crazy/guest-link')).url);
            } catch (x) {
              toast('Erro', errorMessage(x), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          🔑 Gerar meu link de volta
        </button>
      )}
      <p className="text-xs text-muted">
        Ou{' '}
        <Link to="/conta" className="font-bold text-race underline">
          crie sua conta
        </Link>{' '}
        com e-mail e senha (mantém apelido e histórico).
      </p>
    </section>
  );
}

function RaceCta({ r, member }: { r: CrazyRaceDto; member: boolean }) {
  const s = r.status as RacePhase;
  if (s === 'race' || s === 'qualifying')
    return (
      <Link className="btn-danger !py-1.5 text-sm" to={`/corridas/${r.raceId}/ao-vivo`}>
        Ao vivo
      </Link>
    );
  if (s === 'finished' || s === 'archived')
    return (
      <Link className="btn-ghost !py-1.5 text-sm" to={`/corridas/${r.raceId}/replay`}>
        Replay
      </Link>
    );
  if (member && ['registration_open', 'practice', 'trace_window', 'scheduled'].includes(s))
    return (
      <Link className="btn-primary !py-1.5 text-sm" to={`/corridas/${r.raceId}/box`}>
        Ir para o box
      </Link>
    );
  if (s === 'setup_lock')
    return (
      <Link className="btn-ghost !py-1.5 text-sm" to={`/corridas/${r.raceId}`}>
        Acompanhar
      </Link>
    );
  return null;
}

function RaceRow({ r, member, highlight }: { r: CrazyRaceDto; member: boolean; highlight: boolean }) {
  const done = r.status === 'finished' || r.status === 'archived';
  const [open, setOpen] = useState(highlight);
  return (
    <li className={clsx('card space-y-3', highlight && 'border-race')}>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/corridas/${r.raceId}`}
          className="relative block shrink-0"
          aria-label={`Etapa ${r.round}`}
        >
          <RaceMiniMap race={r.race} className="aspect-[16/8] w-28 sm:w-32" />
          <span className="absolute bottom-1 left-1 grid size-6 place-items-center rounded-lg bg-night/85 font-display text-sm">
            {r.round}
          </span>
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/corridas/${r.raceId}`} className="block truncate font-bold hover:text-race">
            {r.trackName}
          </Link>
          <div className="text-xs text-muted">
            {r.laps} voltas · treino {fmtDateTime(r.practiceAt)}
          </div>
        </div>
        {!done && r.status !== 'cancelled' && (
          <span className="text-sm text-muted">
            {['scheduled', 'registration_open'].includes(r.status) ? (
              <>
                treino em <Countdown to={r.practiceAt} className="text-ink" />
              </>
            ) : (
              <PhaseBadge phase={r.status as RacePhase} />
            )}
          </span>
        )}
        {r.status === 'cancelled' && (
          <span className="chip border-hot text-hot">{PHASE_LABELS.cancelled}</span>
        )}
        <RaceCta r={r} member={member} />
      </div>
      {highlight && ['practice', 'trace_window'].includes(r.status) && <RaceReadyBar raceId={r.raceId} />}
      {done && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {r.podium.map((p) => (
              <span key={p.userId} className="chip border-line text-ink">
                {['🥇', '🥈', '🥉'][p.position - 1]} {p.nickname}
              </span>
            ))}
            <button
              className="ml-auto text-sm font-bold text-violet hover:underline"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Esconder a resenha' : `Ver a resenha (${r.awards.length} troféus)`}
            </button>
          </div>
          {open && <AwardList awards={r.awards} />}
        </>
      )}
    </li>
  );
}

function Standings({ g }: { g: CrazyGroupDto }) {
  const meId = useSession((s) => s.me?.id);
  return (
    <section className="card !p-0">
      <h2 className="px-4 pt-4 font-display text-xl">
        {g.races > 1 ? 'Tabela do campeonato' : 'Classificação'}
      </h2>
      <p className="px-4 text-xs text-muted">
        Pontos entre os amigos: 10, 8, 6, 5, 4, 3, 2 e 1 para todo mundo que largar. Bots não contam.
      </p>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="py-2">Piloto</th>
              <th className="py-2 text-right">Pts</th>
              <th className="hidden py-2 text-right sm:table-cell">Vitórias</th>
              <th className="px-4 py-2">Troféus</th>
            </tr>
          </thead>
          <tbody>
            {g.standings.map((s) => (
              <tr
                key={s.userId}
                className={clsx('border-t border-line/60', s.userId === meId && 'text-race')}
              >
                <td className="px-4 py-2 font-mono">{s.races ? s.position : '–'}</td>
                <td className="py-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <CarDot color={s.carColor} /> {s.nickname}
                  </span>
                </td>
                <td className="py-2 text-right font-mono font-bold">{s.points}</td>
                <td className="hidden py-2 text-right font-mono sm:table-cell">{s.wins}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-wrap gap-1">
                    {AWARD_KEYS.filter((k) => s.trophies[k]).map((k) => (
                      <span
                        key={k}
                        title={`${CRAZY_AWARDS[k].title}: ${s.trophies[k]}`}
                        className="whitespace-nowrap"
                      >
                        {CRAZY_AWARDS[k].emoji}
                        {s.trophies[k]! > 1 && <sub className="text-[10px] text-muted">×{s.trophies[k]}</sub>}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Honors({ g }: { g: CrazyGroupDto }) {
  const champ = g.standings[0];
  if (g.status !== 'finished' || !champ?.races) return null;
  return (
    <section className="card space-y-3 border-race">
      <h2 className="font-display text-2xl">🏆 Fim de papo!</h2>
      <p>
        <b className="text-race">{champ.nickname}</b> é {g.races > 1 ? 'campeão' : 'o vencedor'} da {g.name}{' '}
        com {champ.points} pontos.
      </p>
      {g.honors.length > 0 && (
        <>
          <h3 className="label">Títulos de honra (quem mais levou cada troféu)</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {g.honors.map((h) => (
              <li
                key={h.key}
                className="flex items-center gap-3 rounded-xl border border-line bg-night-2/60 p-3"
              >
                <span className="text-3xl">{CRAZY_AWARDS[h.key].emoji}</span>
                <span>
                  <span className="font-display">{CRAZY_AWARDS[h.key].title} do campeonato</span>
                  <br />
                  <b className="text-race">{h.nickname}</b>{' '}
                  <span className="text-xs text-muted">
                    ({h.count}× {CRAZY_AWARDS[h.key].what})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** /corrida-maluca/:id — página do grupo. */
export function CrazyGroup() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const me = useSession((s) => s.me);
  const {
    data: g,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['crazy-group', id, me?.id ?? null],
    queryFn: () => get<CrazyGroupDto>(`/crazy/groups/${id}`),
    refetchInterval: 15_000,
  });
  const welcomed = useRef(false);
  useEffect(() => {
    if (g && params.get('novo') && !welcomed.current) {
      welcomed.current = true;
      toast(
        g.isOwner ? 'Grupo criado! 🎉' : 'Você está na turma! 🏁',
        g.isOwner ? 'Agora mande o link para a galera.' : 'Já está inscrito nas próximas corridas.',
        'ok',
      );
    }
  }, [g, params]);
  if (isLoading) return <Spinner />;
  if (error || !g)
    return (
      <Empty title="Grupo não encontrado" icon="🤔">
        <Link to="/corrida-maluca" className="btn-ghost mt-3">
          Voltar
        </Link>
      </Empty>
    );
  const next = g.schedule.find((r) => !['finished', 'archived', 'cancelled'].includes(r.status));
  const meGuest = me?.guest;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/corrida-maluca" className="text-sm text-violet hover:underline">
            🤪 Corrida Maluca
          </Link>
          <h1 className="font-display text-4xl">{g.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className={clsx('chip', STATUS_CLASS[g.status])}>{STATUS_LABEL[g.status]}</span>
            <span>organizado por {g.ownerNickname}</span>
            <span>
              · {g.races > 1 ? `${g.races} corridas` : '1 corrida'} de {g.laps} voltas
            </span>
            {g.chaos && <span className="chip border-hot text-hot">modo caos</span>}
            <span className="chip border-line">
              {g.botFill ? `bots até ${g.botFill} carros` : 'sem bots'}
            </span>
          </div>
        </div>
        <ShareGroup g={g} />
        {next && (
          <div className="text-right">
            <div className="label !mb-0">
              {['scheduled', 'registration_open'].includes(next.status) ? 'Próxima' : 'Agora'}: etapa{' '}
              {next.round}
            </div>
            {['scheduled', 'registration_open'].includes(next.status) ? (
              <div className="text-2xl">
                <Countdown to={next.practiceAt} />
              </div>
            ) : (
              <div className="font-display text-xl text-race">{PHASE_LABELS[next.status as RacePhase]}</div>
            )}
          </div>
        )}
      </header>

      <Honors g={g} />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <section className="space-y-3">
            <h2 className="font-display text-xl">{g.races > 1 ? 'Calendário' : 'A corrida'}</h2>
            <ol className="space-y-3">
              {g.schedule.map((r) => (
                <RaceRow key={r.raceId} r={r} member={g.isMember} highlight={r.raceId === next?.raceId} />
              ))}
            </ol>
          </section>
          <Standings g={g} />
        </div>
        <aside className="space-y-5">
          {g.isMember && g.inviteCode && g.status !== 'finished' && <InviteCard g={g} />}
          {g.isMember && meGuest && <GuestCard />}
          {!g.isMember && (
            <div className="card text-sm text-muted">
              Este é um grupo fechado. Para entrar, peça o link de convite.
            </div>
          )}
          <section className="card space-y-2">
            <h2 className="font-display text-lg">A turma ({g.memberList.length})</h2>
            <ul className="space-y-1.5">
              {g.memberList.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 text-sm">
                  <CarDot color={m.carColor} />
                  <span className="font-semibold">{m.nickname}</span>
                  {m.owner && <span className="text-xs text-race">organizador</span>}
                  {m.guest && <span className="text-xs text-muted">convidado</span>}
                </li>
              ))}
            </ul>
          </section>
          <section className="card space-y-1 text-sm text-muted">
            <h2 className="font-display text-lg text-ink">Como funciona</h2>
            <p>
              Cada um prepara o carro e o traçado no box antes de cada corrida. Depois é só assistir junto.
            </p>
            <p>Ninguém entrou no box? O carro corre no padrão (e ganha o troféu 🛋️ Piloto de Sofá).</p>
            <p>Não vale ranking oficial nem nível: é só para a resenha.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default CrazyHome;
