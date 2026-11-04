// Gera o package.json mínimo da imagem de produção com as versões instaladas das dependências externas.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const externals = ['@electric-sql/pglite', '@node-rs/argon2'];
const deps = Object.fromEntries(
  externals.map((n) => [
    n,
    JSON.parse(readFileSync(resolve(root, 'node_modules', n, 'package.json'), 'utf8')).version,
  ]),
);
const out = process.argv[2] ?? 'dist/package.json';
writeFileSync(
  out,
  JSON.stringify({ name: 'tracado-api-runtime', private: true, type: 'module', dependencies: deps }, null, 2),
);
console.log(`runtime package.json → ${out}`, deps);
