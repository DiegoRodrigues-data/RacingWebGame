import type { RaceSummaryDto } from '@tracado/shared';
import clsx from 'clsx';
import { Check, Copy, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDateTime } from '../lib/format';
import { toast } from './ui';

/** Texto da mensagem conforme a fase: convite, "assista ao vivo" ou resultado. */
export function shareText(race: RaceSummaryDto, position?: number | null): string {
  if (race.status === 'race') return `🔴 Ao vivo agora no Roda Presa: ${race.name}. Vem assistir!`;
  if (race.status === 'finished' || race.status === 'archived')
    return position
      ? `🏁 Terminei em ${position}º na ${race.name} no Roda Presa! Dá para fazer melhor?`
      : `🏁 Saiu o resultado da ${race.name} no Roda Presa.`;
  if (race.crazy)
    return `🤪 Etapa ${race.crazy.round} da ${race.crazy.groupName} na Corrida Maluca: largada ${fmtDateTime(race.timeline.practiceAt)}. Vem assistir!`;
  const vagas = race.capacity.free > 0 ? `${race.capacity.free} vagas` : 'grid cheio (tem fila)';
  return `🏎️ Bora correr comigo na ${race.name} no Roda Presa? Largada ${fmtDateTime(race.timeline.practiceAt)}, ${race.laps} voltas, ${vagas}.`;
}

export const shareUrl = (raceId: string) => `${location.origin}/s/corridas/${raceId}`;

const NETWORKS: { name: string; color: string; href: (text: string, url: string) => string }[] = [
  {
    name: 'WhatsApp',
    color: '#25d366',
    href: (t, u) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}`,
  },
  {
    name: 'Telegram',
    color: '#29a9eb',
    href: (t, u) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`,
  },
  {
    name: 'X',
    color: '#e7e9ea',
    href: (t, u) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`,
  },
  {
    name: 'Facebook',
    color: '#1877f2',
    href: (_t, u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
  },
];

/**
 * Compartilhar uma corrida: no celular abre a folha nativa (Web Share API); no computador, um menu com
 * WhatsApp, Telegram, X, Facebook e "copiar link". O link /s/corridas/:id mostra a prévia nas redes.
 */
export function ShareRace({
  race,
  position,
  compact,
  className,
}: {
  race: RaceSummaryDto;
  position?: number | null;
  compact?: boolean;
  className?: string;
}) {
  const label =
    race.status === 'race'
      ? 'Chamar para assistir'
      : race.status === 'finished' || race.crazy
        ? 'Compartilhar'
        : 'Convidar';
  return (
    <ShareMenu
      title={race.name}
      text={shareText(race, position)}
      url={shareUrl(race.id)}
      label={label}
      compact={compact}
      className={className}
    />
  );
}

/**
 * Menu de compartilhar genérico: folha nativa no celular; no computador, WhatsApp, Telegram, X, Facebook e
 * "copiar link". O `url` deve ser um link /s/... para as redes mostrarem a prévia.
 */
export function ShareMenu({
  title,
  text,
  url,
  label,
  compact,
  className,
}: {
  title: string;
  text: string;
  url: string;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      const inside = ref.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node);
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside) setOpen(false);
    };
    const hide = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  async function onClick() {
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    if (touch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
      } catch {
        /* cancelado pelo usuário */
      }
      return;
    }
    // Menu em portal com posição fixa: os cards animados criam camadas que o esconderiam.
    const r = ref.current!.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(
      window.innerHeight - r.bottom > 320
        ? { top: r.bottom + 8, right }
        : { bottom: window.innerHeight - r.top + 8, right },
    );
    setOpen((o) => !o);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      toast('Link copiado', 'Cole onde quiser chamar a galera.', 'ok');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Não deu para copiar', url, 'warn');
    }
  }
  return (
    <div ref={ref} className={clsx('relative inline-block', className)}>
      <button
        type="button"
        className={clsx('btn-ghost', compact && 'size-9 !p-0')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? `${label}: ${title}` : undefined}
        title={label}
        onClick={() => void onClick()}
      >
        <Share2 size={16} />
        {!compact && label}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', ...pos }}
            className="z-50 w-60 rounded-2xl border border-line bg-night-2 p-2 shadow-xl"
          >
            <p className="px-2 pb-2 text-xs text-muted">{text}</p>
            {NETWORKS.map((n) => (
              <a
                key={n.name}
                role="menuitem"
                href={n.href(text, url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold hover:bg-night-3"
              >
                <span className="size-3 rounded-full" style={{ background: n.color }} aria-hidden />
                {n.name}
              </a>
            ))}
            <button
              role="menuitem"
              type="button"
              onClick={() => void copy()}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold hover:bg-night-3"
            >
              {copied ? <Check size={14} className="text-go" /> : <Copy size={14} />} Copiar link
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
