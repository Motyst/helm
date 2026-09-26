import { describe, expect, it } from 'vitest';
import { autoIcon, projectIcon } from './project-icon.ts';

describe('project icons', () => {
  it('picks an emoji from words in the name', () => {
    expect(autoIcon('Home')).toBe('🏠');
    expect(autoIcon('Trip to Lisbon')).toBe('✈️');
    expect(autoIcon('Garden')).toBe('🌱');
    expect(autoIcon('Client meetings')).toBe('💼');
    expect(autoIcon('Portfolio website')).toBe('💻');
    expect(autoIcon('Zanzibar')).toBeNull();
  });

  it('prefers the chosen icon, and gives the Inbox its own', () => {
    expect(projectIcon({ name: 'Home', icon: '🏡' })).toBe('🏡');
    expect(projectIcon({ name: 'Home', icon: null })).toBe('🏠');
    expect(projectIcon(null)).toBe('📥');
  });
});
