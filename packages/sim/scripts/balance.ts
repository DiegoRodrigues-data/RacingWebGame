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
console.log('\nPerfil do piloto, posição média de chegada por faixa (11,5 = neutro):');
for (const [f, bands] of Object.entries(r.avgPosition))
  console.log(
    `  ${f.padEnd(12)} ${['low', 'mid', 'high'].map((b) => `${b}=${bands[b]?.toFixed(2) ?? '-'}`).join('  ')}`,
  );
const pr = r.perRace;
console.log(
  `\nPor corrida: ${pr.overtakes} ultrapassagens, ${pr.collisions} toques, ${pr.damagePits} avarias com ida aos boxes, ` +
    `${pr.collisionDnfs} abandonos por toque, ${pr.dnfs} abandonos no total`,
);
console.log(`\nMaior lift: ${r.maxLift.feature}=${r.maxLift.value} (${r.maxLift.lift})`);
console.log(`Estratégia de pneus mais vencedora: ${(r.topStrategyWinShare * 100).toFixed(1)}% das vitórias`);
// Nenhuma faixa do perfil pode render mais que ~1,5 posição de vantagem média sobre a pior da mesma característica.
const spread = Math.max(
  ...Object.values(r.avgPosition).map((b) => Math.max(...Object.values(b)) - Math.min(...Object.values(b))),
);
console.log(`Maior diferença de posição média entre faixas do perfil: ${spread.toFixed(2)}`);
const ok =
  r.maxLift.lift <= 3 &&
  r.topStrategyWinShare <= 0.35 &&
  spread <= 1.5 &&
  pr.collisions >= 0.5 &&
  pr.collisions <= 6 &&
  pr.collisionDnfs <= 1.2;
console.log(
  ok
    ? '\nOK: nenhuma configuração dominante e colisões numa faixa razoável.'
    : '\nATENÇÃO: possível configuração dominante ou colisões fora da faixa, ajuste COEF em src/model.ts.',
);
process.exitCode = ok ? 0 : 1;
