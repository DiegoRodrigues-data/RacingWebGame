import { describe, expect, it } from 'vitest';
import { __music } from './audio';

describe('trilha (partituras)', () => {
  it('converte notas para MIDI e frequência', () => {
    expect(__music.midi('A4')).toBe(69);
    expect(__music.midi('C4')).toBe(60);
    expect(__music.midi('G#4')).toBe(68);
    expect(__music.midi('Bb2')).toBe(46);
    expect(__music.freq(69)).toBeCloseTo(440);
  });

  it('cada seção tem a melodia exatamente do tamanho dos compassos (16 passos por compasso)', () => {
    for (const [name, song] of Object.entries(__music.songs)) {
      expect(song.drums, name).toHaveLength(16);
      expect(song.bass, name).toHaveLength(16);
      for (const [sec, s] of Object.entries(song.sections)) {
        const steps = s.lead.reduce((a, [, len]) => a + len, 0);
        expect(steps, `${name}/${sec}`).toBe(s.chords.length * 16);
        for (const [note] of s.lead) if (note) expect(() => __music.midi(note)).not.toThrow();
        for (const c of s.chords)
          for (const n of [c.root, ...c.arp]) expect(() => __music.midi(n)).not.toThrow();
      }
      for (const sec of song.order) expect(song.sections[sec], `${name} usa ${sec}`).toBeTruthy();
    }
  });
});
