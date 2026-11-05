import { ExternalLink, Heart } from 'lucide-react';
import type { ReactNode } from 'react';
import authorPhoto from '../assets/about/diego.jpg';

const AUTHOR = 'Diego de Castro Rodrigues';
const LINKEDIN = 'https://www.linkedin.com/in/diego-rodrigues-ph-d-914a395a/';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-display text-lg text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-race underline hover:text-ink" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function About() {
  return (
    <article className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed text-muted [&_strong]:text-ink">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-ink">
          Sobre o RODA <span className="text-race">PRESA</span>
        </h1>
        <p>
          Um jogo multiplayer de corrida estratégica: você não pilota, você monta o setup e desenha o traçado
          antes da largada. O servidor simula a corrida e transmite tudo ao vivo.
        </p>
      </header>

      <Section title="Autoria">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <img
            src={authorPhoto}
            alt={`Foto de ${AUTHOR}`}
            width={160}
            height={160}
            className="size-40 shrink-0 rounded-xl border-2 border-race object-cover object-top"
          />
          <div className="space-y-3">
            <p>
              Criado, desenvolvido e mantido por <strong>{AUTHOR}</strong>.
            </p>
            <a
              className="btn-ghost w-fit"
              href={LINKEDIN}
              target="_blank"
              rel="noreferrer"
              aria-label="Perfil no LinkedIn (abre em nova aba)"
            >
              LinkedIn <ExternalLink size={16} aria-hidden />
            </a>
          </div>
        </div>
      </Section>

      <Section title="Agradecimentos">
        <p>
          <Heart size={14} className="mr-1 inline text-hot" aria-hidden />
          Um obrigado enorme ao <strong>Kenney</strong>, que criou e distribui de graça o{' '}
          <strong>Racing Pack</strong>: os carros, a pista e os objetos do cenário vêm dele, com licença{' '}
          <Ext href="https://creativecommons.org/publicdomain/zero/1.0/">Creative Commons Zero (CC0)</Ext>. O
          crédito não é obrigatório, mas é dado com gratidão.
        </p>
        <a
          className="btn-primary w-fit"
          href="https://kenney.nl/"
          target="_blank"
          rel="noreferrer"
          aria-label="Visitar kenney.nl (abre em nova aba)"
        >
          Visitar kenney.nl <ExternalLink size={16} aria-hidden />
        </a>
      </Section>

      <Section title="Outros créditos">
        <ul className="space-y-1 [&_li]:ml-5 [&_li]:list-disc">
          <li>
            Fontes <Ext href="https://fonts.google.com/specimen/Russo+One">Russo One</Ext>,{' '}
            <Ext href="https://fonts.google.com/specimen/Inter">Inter</Ext> e{' '}
            <Ext href="https://fonts.google.com/specimen/JetBrains+Mono">JetBrains Mono</Ext>, via Google
            Fonts (SIL Open Font License).
          </li>
          <li>
            Ícones <Ext href="https://lucide.dev">Lucide</Ext> (ISC).
          </li>
          <li>Trilha e efeitos sonoros sintetizados no próprio jogo.</li>
        </ul>
      </Section>
    </article>
  );
}
