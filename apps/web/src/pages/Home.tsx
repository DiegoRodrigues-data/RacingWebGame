import { motion } from 'motion/react';
import { Link } from 'react-router';
import { RaceCard } from '../components/RaceCard';
import { CarIcon, Empty, Flag, Skeleton } from '../components/ui';
import { carImage } from '../game/assets';
import { useLobby } from '../lib/queries';
import { useSession } from '../lib/session';

const HERO_PATH = 'M 60 160 C 60 60, 200 40, 300 70 S 520 40, 560 120 S 480 250, 360 220 S 160 280, 60 160 Z';

/**
 * Pista animada da home. Os carros andam dentro do próprio SVG (animateMotion), então seguem a linha
 * em qualquer largura de tela; com "reduzir animações" ficam parados em pontos fixos da pista.
 */
function HeroTrack() {
  const cars: [string, number][] = [
    ['red', 1],
    ['blue', 3],
    ['yellow', 2],
    ['green', 4],
    ['black', 5],
  ];
  const reduce =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('reduce-motion'));
  const LAP_S = 11;
  return (
    <div className="relative mx-auto w-full max-w-xl" aria-hidden>
      <svg viewBox="0 0 620 300" className="block h-auto w-full overflow-visible">
        <defs>
          <path id="hero-path" d={HERO_PATH} />
        </defs>
        <path d={HERO_PATH} fill="none" stroke="#27ae60" strokeWidth="64" strokeLinejoin="round" />
        <path d={HERO_PATH} fill="none" stroke="#fff" strokeWidth="40" />
        <path d={HERO_PATH} fill="none" stroke="#ff5a5a" strokeWidth="40" strokeDasharray="10 10" />
        <path d={HERO_PATH} fill="none" stroke="#a6c9cb" strokeWidth="34" />
        <path
          d={HERO_PATH}
          fill="none"
          stroke="#ffcc00"
          strokeWidth="3"
          strokeDasharray="2 10"
          strokeLinecap="round"
          opacity="0.9"
        />
        {cars.map(([c, m], i) => {
          // Carros em fila, com leve diferença de ritmo; o sprite aponta para cima, por isso gira 90°.
          const dur = LAP_S + i * 0.45;
          const offset = (i * 0.09) % 1;
          return (
            <g key={c}>
              {reduce ? null : (
                <animateMotion
                  dur={`${dur}s`}
                  begin={`${-offset * dur}s`}
                  repeatCount="indefinite"
                  rotate="auto"
                  keyPoints="0;1"
                  keyTimes="0;1"
                  calcMode="linear"
                >
                  <mpath href="#hero-path" />
                </animateMotion>
              )}
              <g transform={reduce ? staticPose(offset + i * 0.11) : undefined}>
                <image
                  href={carImage(c, m)}
                  width="14"
                  height="26"
                  x="-7"
                  y="-13"
                  transform={`translate(0 ${(i % 2 ? 1 : -1) * 6}) rotate(90)`}
                />
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Pose fixa (sem animação) a uma fração da volta. */
function staticPose(frac: number): string {
  if (typeof document === 'undefined') return '';
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', HERO_PATH);
  const len = p.getTotalLength();
  const a = p.getPointAtLength((frac % 1) * len),
    b = p.getPointAtLength(((frac % 1) * len + 1) % len);
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return `translate(${a.x} ${a.y}) rotate(${deg})`;
}

function Steps() {
  const steps = [
    [
      '📅',
      'Escolha uma largada',
      'Tem corrida toda hora cheia, o dia inteiro. Inscreva-se em qualquer uma: até 22 carros por grid.',
    ],
    [
      '🔧',
      'Acerte o carro',
      'Escolha seu carro e ajuste pneus, paradas (pelo menos uma é obrigatória), calibragem, asa, motor e câmbio.',
    ],
    [
      '✍️',
      'Desenhe o traçado',
      'A linha começa no meio da pista: arraste os pontos para abrir antes da curva e tocar o ápice. Teste no treino.',
    ],
    [
      '🏁',
      'Assista e suba no ranking',
      'O servidor simula a corrida de forma justa e transmite ao vivo. Ranqueadas valem pontos local, regional e mundial.',
    ],
  ];
  return (
    <section aria-labelledby="como" className="mt-10 scroll-mt-20" id="como-funciona">
      <h2 id="como" className="font-display text-2xl">
        Como funciona
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([icon, t, d], i) => (
          <motion.div
            key={t}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ delay: i * 0.08 }}
            className="card"
          >
            <div className="text-3xl">{icon}</div>
            <div className="mt-2 font-display">{t}</div>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function Home() {
  const me = useSession((s) => s.me);
  const { data, isLoading } = useLobby();
  return (
    <div>
      <section className="grid items-center gap-6 lg:grid-cols-2">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="font-display text-4xl leading-tight sm:text-5xl"
          >
            Desenhe a linha.
            <br />
            Acerte o carro.
            <br />
            <span className="text-race">Vença no detalhe.</span>
          </motion.h1>
          <p className="mt-4 max-w-lg text-muted">
            Corridas multiplayer de estratégia com até <b className="text-ink">22 carros</b>, com largada toda
            hora cheia. Treino, janela de traçado, classificação e corrida, tudo controlado pelo servidor.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {me ? (
              <Link to="/calendario" className="btn-primary">
                Escolher corrida
              </Link>
            ) : (
              <Link to="/cadastro" className="btn-primary">
                Criar conta e correr
              </Link>
            )}
            <a href="#como-funciona" className="btn-ghost">
              Como funciona
            </a>
          </div>
          {data && (
            <div className="mt-6 flex gap-6 text-sm text-muted">
              <div>
                <b className="block font-display text-2xl text-ink">{data.stats.players}</b>
                pilotos
              </div>
              <div>
                <b className="block font-display text-2xl text-hot">{data.stats.liveRaces}</b>
                corridas em andamento
              </div>
              <div>
                <b className="block font-display text-2xl text-go">{data.stats.online}</b>
                online agora
              </div>
            </div>
          )}
        </div>
        <HeroTrack />
      </section>

      <Steps />

      {me && data && data.mine.length > 0 && (
        <section className="mt-10" aria-labelledby="minhas">
          <h2 id="minhas" className="font-display text-2xl">
            Minhas corridas
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.mine.map((r) => (
              <RaceCard
                key={r.id}
                race={r}
                cta={
                  r.status === 'race' ? (
                    <Link className="btn-danger !py-1.5" to={`/corridas/${r.id}/ao-vivo`}>
                      Ao vivo
                    </Link>
                  ) : r.status === 'finished' ? (
                    <Link className="btn-ghost !py-1.5" to={`/corridas/${r.id}/resultado`}>
                      Resultado
                    </Link>
                  ) : (
                    <Link className="btn-primary !py-1.5" to={`/corridas/${r.id}/box`}>
                      Ir para o box
                    </Link>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {data && data.live.length > 0 && (
        <section className="mt-10" aria-labelledby="aovivo">
          <h2 id="aovivo" className="flex items-center gap-2 font-display text-2xl">
            <span className="size-3 animate-pulse-soft rounded-full bg-hot" /> Acontecendo agora
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.live.map((r) => (
              <RaceCard
                key={r.id}
                race={r}
                cta={
                  r.status === 'race' ? (
                    <Link className="btn-danger !py-1.5" to={`/corridas/${r.id}/ao-vivo`}>
                      Assistir
                    </Link>
                  ) : r.test && r.status === 'registration_open' ? (
                    <Link className="btn-primary !py-1.5" to={`/corridas/${r.id}`}>
                      Correr
                    </Link>
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10" aria-labelledby="proximas">
        <div className="flex items-end justify-between">
          <h2 id="proximas" className="font-display text-2xl">
            Próximas largadas
          </h2>
          <Link to="/calendario" className="text-sm font-bold text-race hover:underline">
            Calendário completo →
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {isLoading && [1, 2, 3].map((i) => <Skeleton key={i} className="h-52" />)}
          {data?.upcoming.map((r) => (
            <RaceCard key={r.id} race={r} />
          ))}
        </div>
        {data && !data.upcoming.length && (
          <Empty title="Nenhuma corrida agendada">
            Volte em breve: a direção de prova publica novas corridas todos os dias.
          </Empty>
        )}
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recentes" className="min-w-0">
          <h2 id="recentes" className="font-display text-2xl">
            Resultados recentes
          </h2>
          <div className="mt-4 space-y-3">
            {data?.recent.length === 0 && <Empty title="Ainda sem resultados" icon="⏱️" />}
            {data?.recent.map(({ race, podium }) => (
              <Link
                key={race.id}
                to={`/corridas/${race.id}/resultado`}
                className="card flex flex-wrap items-center gap-x-4 gap-y-2 hover:border-race/60"
              >
                <div className="min-w-40 flex-1">
                  <div className="truncate font-bold">{race.name}</div>
                  <div className="text-xs text-muted">{race.track.name}</div>
                </div>
                <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {podium.map((p) => (
                    <li key={p.userId} className="flex items-center gap-1">
                      <span>{['🥇', '🥈', '🥉'][p.position - 1]}</span>
                      <span className="max-w-20 truncate font-semibold">{p.nickname}</span>
                    </li>
                  ))}
                </ol>
              </Link>
            ))}
          </div>
        </section>
        <section aria-labelledby="top" className="min-w-0">
          <h2 id="top" className="font-display text-2xl">
            Top 5 mundial
          </h2>
          <ol className="card mt-4 divide-y divide-line">
            {data?.top.length === 0 && (
              <li className="py-6 text-center text-sm text-muted">
                A temporada está começando. Seja o primeiro a pontuar!
              </li>
            )}
            {data?.top.map((r) => (
              <li key={r.userId} className="flex items-center gap-3 py-2.5">
                <span className="w-7 text-center font-display text-lg text-race">{r.position}</span>
                <Flag country={r.country} />
                <Link to={`/pilotos/${r.userId}`} className="flex-1 truncate font-bold hover:text-race">
                  {r.nickname}
                </Link>
                <span className="font-mono font-bold">{r.points} pts</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap justify-center gap-2 opacity-80" aria-hidden>
            {(['red', 'blue', 'green', 'yellow', 'black'] as const).map((c, i) => (
              <CarIcon key={c} color={c} model={i + 1} className="h-7 sm:h-10" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
