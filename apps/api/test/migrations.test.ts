import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('migrações', () => {
  it('datas do journal crescentes (o drizzle pula migração com data anterior à última aplicada)', () => {
    const j = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    for (let i = 1; i < j.entries.length; i++)
      expect(j.entries[i]!.when, j.entries[i]!.tag).toBeGreaterThan(j.entries[i - 1]!.when);
  });
});
