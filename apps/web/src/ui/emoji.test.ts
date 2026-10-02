import { describe, expect, it } from 'vitest';
import { closedAt, exactEmoji, searchEmoji, toEmojis, typingAt } from './emoji.ts';

const all = toEmojis({
  '😀': ['grinning_face', 'face', 'smile', 'happy'],
  '😍': ['smiling_face_with_heart_eyes', 'love', 'heart'],
  '❤️': ['red_heart', 'love', 'heart'],
  '🔥': ['fire', 'hot', 'flame'],
  '🧯': ['fire_extinguisher', 'quench'],
  '🚒': ['fire_engine', 'truck'],
});
const names = (q: string) => searchEmoji(all, q).map((e) => e.emoji);

describe('emoji search', () => {
  it('ranks the name, then names that start with it, then keywords', () => {
    expect(names('fire')).toEqual(['🔥', '🚒', '🧯']);
    expect(names('heart')).toEqual(['😍', '❤️']);
    expect(names('red')).toEqual(['❤️']);
    expect(names('smi')).toEqual(['😍', '😀']);
    expect(names('fi')).toEqual(['🔥', '🚒', '🧯']);
    expect(names('zzz')).toEqual([]);
  });

  it('finds the emoji for a whole :name:', () => {
    expect(exactEmoji(all, 'fire')?.emoji).toBe('🔥');
    expect(exactEmoji(all, 'love')?.emoji).toBe('😍');
    expect(exactEmoji(all, 'fir')).toBeNull();
  });
});

describe('emoji trigger', () => {
  it('starts after a space or at the start, with two letters', () => {
    expect(typingAt('Buy :fi', 7)).toEqual({ start: 4, query: 'fi' });
    expect(typingAt(':Fire', 5)).toEqual({ start: 0, query: 'fire' });
    expect(typingAt('(:ok', 4)).toEqual({ start: 1, query: 'ok' });
    expect(typingAt('Buy :f', 6)).toBeNull();
    expect(typingAt('at 10:30', 8)).toBeNull();
    expect(typingAt('Note: x', 7)).toBeNull();
    expect(typingAt('http://x', 8)).toBeNull();
    expect(typingAt('Buy :fire now', 7)).toEqual({ start: 4, query: 'fi' });
  });

  it('spots a whole :name:', () => {
    expect(closedAt('Ship it :fire:', 14)).toEqual({ start: 8, name: 'fire' });
    expect(closedAt('a:fire:', 7)).toBeNull();
    expect(closedAt('Ship it :fire', 13)).toBeNull();
  });
});
