import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** E-mail de contato de quem hospeda o jogo (`VITE_CONTACT_EMAIL`, lido no build). */
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL ?? '').trim();
const UPDATED = '4 de novembro de 2026';

function ContactLink() {
  if (!CONTACT) return <>o contato de quem administra este servidor</>;
  return (
    <a className="text-race underline" href={`mailto:${CONTACT}`}>
      {CONTACT}
    </a>
  );
}

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed text-muted [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink">
      <h1 className="font-display text-3xl text-ink">{title}</h1>
      <p className="text-xs">Atualizado em {UPDATED}.</p>
      {children}
    </article>
  );
}

export function Privacy() {
  return (
    <Doc title="Política de Privacidade">
      <p>
        Esta política explica quais dados o <strong>Roda Presa</strong> coleta, para que usa e quais são os
        seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).
      </p>
      <h2>Dados que coletamos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> e-mail, apelido, país, estado e cidade. Com e-mail e senha, guardamos só o
          hash da senha (Argon2id), nunca a senha.
        </li>
        <li>
          <strong>Login com Google:</strong> o identificador da sua conta Google, e-mail e nome. Não temos
          acesso à sua senha do Google nem a outros dados da conta.
        </li>
        <li>
          <strong>Jogo:</strong> inscrições, setups, traçados, resultados, pontos e rankings.
        </li>
        <li>
          <strong>Segurança:</strong> endereço IP no cadastro e nas sessões, para limitar abusos e contas
          falsas.
        </li>
      </ul>
      <h2>Para que usamos</h2>
      <ul>
        <li>Criar e manter sua conta e sua sessão.</li>
        <li>Rodar as corridas e montar os rankings local, regional, nacional e mundial.</li>
        <li>Mostrar seu apelido, país e resultados para outros jogadores.</li>
        <li>Enviar avisos do jogo (e e-mails de lembrete, só se você ativar).</li>
        <li>Prevenir fraude e abuso.</li>
      </ul>
      <h2>Cookies e armazenamento</h2>
      <p>
        Usamos um cookie de sessão essencial (httpOnly) para manter você conectado e o armazenamento local do
        navegador para guardar rascunhos de traçado e setup. Não usamos cookies de publicidade nem de
        rastreamento de terceiros.
      </p>
      <h2>Compartilhamento</h2>
      <p>
        Não vendemos nem alugamos seus dados. O Google participa apenas quando você escolhe entrar com a conta
        Google. Podemos fornecer dados quando exigido por lei ou ordem judicial.
      </p>
      <h2>Por quanto tempo guardamos</h2>
      <p>
        Enquanto sua conta existir. Resultados de corridas fazem parte do histórico dos rankings. Cópias de
        segurança do banco são mantidas por até 14 dias.
      </p>
      <h2>Seus direitos</h2>
      <p>
        Você pode acessar e corrigir seus dados na página <Link to="/conta">Minha conta</Link> e pedir a
        exclusão da conta ou uma cópia dos seus dados por <ContactLink />.
      </p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Termos de Uso">
      <p>
        Ao criar uma conta ou jogar o <strong>Roda Presa</strong>, você concorda com estes termos.
      </p>
      <h2>O jogo</h2>
      <p>
        Roda Presa é um jogo gratuito de corrida estratégica. As corridas são simuladas pelo servidor a partir
        do setup e do traçado de cada piloto; o resultado oficial é o calculado pelo servidor.
      </p>
      <h2>Sua conta</h2>
      <ul>
        <li>Uma conta por pessoa. Você é responsável pelo acesso a ela.</li>
        <li>O apelido não pode ser ofensivo nem se passar por outra pessoa.</li>
        <li>Informe estado e cidade verdadeiros: eles definem seus rankings.</li>
      </ul>
      <h2>Jogo limpo</h2>
      <p>
        É proibido usar contas múltiplas, automatizar a interface, explorar falhas ou atacar o serviço. A
        direção de prova pode anular resultados e suspender contas que violem estas regras.
      </p>
      <h2>Disponibilidade</h2>
      <p>
        O serviço é oferecido como está. Podemos alterar regras, categorias, horários e estes termos; mudanças
        relevantes serão avisadas no próprio jogo.
      </p>
      <h2>Contato</h2>
      <p>
        Dúvidas ou pedidos: <ContactLink />. Veja também a{' '}
        <Link to="/privacidade">Política de Privacidade</Link>.
      </p>
    </Doc>
  );
}
