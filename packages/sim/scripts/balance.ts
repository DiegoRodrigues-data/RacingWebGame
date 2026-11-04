import { runBalance } from '../src/balance';

const per = Number(process.argv[2] ?? 30);
const t0 = Date.now();
const r = runBalance(per);
console.log(`Corridas simuladas: ${r.races} em ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
console.log('Lift de vitória por característica (1,00 = neutro; > 2,5 indica possível dominância):');
for (const [f, vals] of Object.entries(r.lift))
  console.log(
    `  ${f.padEnd(12)} ${Object.entries(vals)
      .sort()
      .map(([v, l]) => `${v}=${l.toFixed(2)}`)
      .join('  ')}`,
  );
console.log('\nValor mais frequente no pódio por cenário:');
for (const [sc, f] of Object.entries(r.winnersByScenario))
  console.log(
    `  ${sc.padEnd(22)} ${Object.entries(f)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}`,
  );
console.log(`\nMaior lift: ${r.maxLift.feature}=${r.maxLift.value} (${r.maxLift.lift})`);
console.log(`Estratégia de pneus mais vencedora: ${(r.topStrategyWinShare * 100).toFixed(1)}% das vitórias`);
const ok = r.maxLift.lift <= 3 && r.topStrategyWinShare <= 0.35;
console.log(
  ok
    ? '\nOK: nenhuma configuração dominante.'
    : '\nATENÇÃO: possível configuração dominante, ajuste COEF em src/model.ts.',
);
process.exitCode = ok ? 0 : 1;
