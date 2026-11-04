import { defineConfig } from 'tsup';

/** Dependências que ficam fora do bundle e são instaladas na imagem final (WASM/binários nativos). */
export const RUNTIME_EXTERNALS = ['@electric-sql/pglite', '@node-rs/argon2', 'pg-native', 'pino-pretty'];

export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/db/migrate.ts', seed: 'src/db/seed-cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Tudo entra no bundle, exceto as dependências de runtime acima (regex com lookahead negativo).
  noExternal: [new RegExp(`^(?!(${RUNTIME_EXTERNALS.map((e) => e.replace('/', '\\/')).join('|')}))`)],
  external: RUNTIME_EXTERNALS,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
});
