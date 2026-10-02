import { describe, expect, it } from 'vitest';
import { keyWordsIn, locate, ruleKeyWords, splitKeyed } from './keywords.ts';

describe('locate', () => {
  it('matches whole words only, ignoring case', () => {
    expect(locate('Connect bank grok bot', 'Bank')).toEqual({ start: 8, end: 12 });
    expect(locate('Check top skills', 'kill')).toBeNull();
  });
  it('handles punctuation inside a pick', () => {
    expect(locate('Read https://x.ai/bot/guides now', 'x.ai/bot/guides')).not.toBeNull();
    expect(locate("App: David's girl app", "David's")).not.toBeNull();
  });
});

describe('keyWordsIn', () => {
  it('keeps picks as the title spells them', () => {
    expect(keyWordsIn('Get better pinned posts for tik tok', ['Pinned Posts', 'TIK TOK'])).toEqual(['pinned posts', 'tik tok']);
  });
  it('drops picks not in the title, overlapping ones, long ones, and anything past two', () => {
    expect(keyWordsIn('Contact Georgi and MetaGuy about AI', ['Bob', 'Georgi', 'Georgi and', 'MetaGuy', 'AI'])).toEqual([
      'Georgi',
      'MetaGuy',
    ]);
    expect(keyWordsIn('Outline essay on ambient tools', ['essay on ambient tools'])).toEqual([]);
  });
});

describe('splitKeyed', () => {
  it('cuts the title around the key words', () => {
    expect(splitKeyed('Check top skills github repos', ['top skills', 'github repos'])).toEqual([
      { text: 'Check ', key: false },
      { text: 'top skills', key: true },
      { text: ' ', key: false },
      { text: 'github repos', key: true },
    ]);
  });
  it('shows the plain title when the words are gone or missing', () => {
    expect(splitKeyed('Call mum', ['dentist'])).toEqual([{ text: 'Call mum', key: false }]);
    expect(splitKeyed('Call mum', null)).toEqual([{ text: 'Call mum', key: false }]);
  });
});

describe('ruleKeyWords', () => {
  it('skips filler and action words', () => {
    expect(ruleKeyWords('Check davids monetization')).toEqual(['monetization']);
  });
  it('prefers the word fewest tasks use', () => {
    const seen = (w: string) => (w === 'calls' ? 3 : 1);
    expect(ruleKeyWords('Write to clients calls', seen)).toEqual(['clients']);
  });
  it('prefers the later word on a tie', () => {
    expect(ruleKeyWords('Plant tulip bulbs')).toEqual(['bulbs']);
  });
  it('keeps a short title whole', () => {
    expect(ruleKeyWords('Portfolio')).toEqual(['Portfolio']);
    expect(ruleKeyWords('Experience levels')).toEqual(['Experience levels']);
  });
});
