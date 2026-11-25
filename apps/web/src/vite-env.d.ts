/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  /** E-mail de contato exibido nas páginas de Privacidade e Termos. */
  readonly VITE_CONTACT_EMAIL?: string;
}
declare module '*.xml?raw' {
  const s: string;
  export default s;
}
