import { describe, expect, it } from 'vitest';
import { readTail } from '../src/modules/voice/tail.ts';

const home = { id: 'h', name: 'Home' };
const office = { id: 'o', name: 'Home office' };
const kitchen = { id: 'k', name: 'Kitchen' };
const lisbon = { id: 'l', name: '✈️ Trip to Lisbon' };
const projects = [home, office, kitchen, lisbon];
const read = (s: string) => readTail(s, projects);

describe('spoken label at the end', () => {
  it('reads a project and a priority in either order', () => {
    expect(read('Buy milk and eggs. Home, soon.')).toEqual({ rest: 'Buy milk and eggs', project: home, priority: 'soon' });
    expect(read('Buy milk and eggs. Soon. Home.')).toEqual({ rest: 'Buy milk and eggs', project: home, priority: 'soon' });
    expect(read('Book the flights, trip to Lisbon, priority now')).toEqual({
      rest: 'Book the flights',
      project: lisbon,
      priority: 'now',
    });
  });

  it('takes the longest project name and skips filler', () => {
    expect(read('Fix the desk lamp, uh, home office board, um, someday.')).toEqual({
      rest: 'Fix the desk lamp',
      project: office,
      priority: 'someday',
    });
  });

  it('takes a priority word without a pause', () => {
    expect(read('Reply to Sam now')).toEqual({ rest: 'Reply to Sam', priority: 'now' });
    expect(read('call the plumber no rush')).toEqual({ rest: 'call the plumber', priority: 'someday' });
  });

  it('takes a project without a pause only after a lead-in', () => {
    expect(read('Fix the tap in home')).toEqual({ rest: 'Fix the tap', project: home });
    expect(read('Fix the tap, put it in the Home board, soon')).toEqual({ rest: 'Fix the tap', project: home, priority: 'soon' });
    expect(read('Clean the kitchen')).toEqual({ rest: 'Clean the kitchen' });
    expect(read('Clean the kitchen soon')).toEqual({ rest: 'Clean the kitchen', priority: 'soon' });
    expect(read('Go to home')).toEqual({ rest: 'Go to home' });
  });

  it('files under Inbox when said', () => {
    expect(read('Look into solar panels. Inbox.')).toEqual({ rest: 'Look into solar panels', project: null });
  });

  it('leaves the transcript alone without a label, and never takes all of it', () => {
    expect(read('Call the bank, okay.')).toEqual({ rest: 'Call the bank, okay.' });
    expect(read('Home, soon.')).toEqual({ rest: 'Home', priority: 'soon' });
    expect(read('Home.')).toEqual({ rest: 'Home.' });
    expect(read('Homework for Monday')).toEqual({ rest: 'Homework for Monday' });
    expect(readTail('Buy milk. Home.', [])).toEqual({ rest: 'Buy milk. Home.' });
  });
});
