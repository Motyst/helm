import { describe, expect, it } from 'vitest';
import { matchProject, parseEstimate, parseQuickAdd } from './quickadd.ts';

describe('parseQuickAdd', () => {
  it('extracts project, priority and estimate', () => {
    expect(parseQuickAdd('Call the bank #home !now ~15m')).toEqual({
      title: 'Call the bank',
      projectQuery: 'home',
      priority: 'now',
      estimateMinutes: 15,
    });
  });

  it('leaves plain text and unknown tokens alone', () => {
    expect(parseQuickAdd('Fix bug #')).toMatchObject({ title: 'Fix bug #', projectQuery: null });
    expect(parseQuickAdd('Say hi! ~ok')).toMatchObject({ title: 'Say hi! ~ok', priority: null, estimateMinutes: null });
    expect(parseQuickAdd('!urgent thing')).toMatchObject({ title: '!urgent thing', priority: null });
  });

  it('accepts short priority aliases', () => {
    expect(parseQuickAdd('x !s').priority).toBe('soon');
    expect(parseQuickAdd('x !later').priority).toBe('someday');
  });
});

describe('parseEstimate', () => {
  it.each([
    ['30', 30],
    ['30m', 30],
    ['45min', 45],
    ['1h', 60],
    ['1.5h', 90],
    ['1h30', 90],
    ['2h15m', 135],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseEstimate(input)).toBe(expected);
  });
});

describe('matchProject', () => {
  const projects = [{ name: 'Helm' }, { name: 'Home Admin' }, { name: 'Writing' }];
  it('prefers exact, then prefix, then substring', () => {
    expect(matchProject('helm', projects)?.name).toBe('Helm');
    expect(matchProject('ho', projects)?.name).toBe('Home Admin');
    expect(matchProject('homeadmin', projects)?.name).toBe('Home Admin');
    expect(matchProject('rit', projects)?.name).toBe('Writing');
    expect(matchProject('zzz', projects)).toBeNull();
  });
});
