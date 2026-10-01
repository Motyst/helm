/** What changed in the app, newest first, for Settings → Recent updates. Add to the top with each release. */
export const CHANGELOG: { date: string; changes: string[] }[] = [
  {
    date: '2026-10-01',
    changes: [
      'Voice: end with a board and now, soon or someday (“…, Home, soon”) and the task goes there.',
      'Voice picks the board from the topic when it’s clear, like a dentist visit under Health.',
      'Add a task right inside a panel: type, press Enter, type the next.',
      'Swipe a task right to finish it, left to start or pause it.',
      'Deleting a task is one tap, with Undo.',
      'On phones, the + button sits next to the mic.',
      'Slimmer top and bottom bars in the task form.',
      'Fixed: dragging a task near the top or bottom of the screen could blank the app.',
      'Recent updates, here in Settings.',
    ],
  },
  {
    date: '2026-09-30',
    changes: [
      'The board is the home screen, with a tab for each project.',
      'Long panels show 10 tasks, then “Show more”.',
      'Pick a task’s project with one tap.',
      'Done opens on today.',
      'Add subtask stays above the phone keyboard.',
      'Focus layouts: One thing, Vital three and Compass.',
    ],
  },
  {
    date: '2026-09-29',
    changes: ['Hand tasks to AI agents, with an activity log and Undo.'],
  },
  {
    date: '2026-09-28',
    changes: [
      'A countdown timer that rings on every device.',
      'Reorder and delete projects from the board menu.',
      'A new app icon.',
    ],
  },
  {
    date: '2026-09-26',
    changes: ['A sky along the top of each theme, and the Neo Tokyo theme.', 'Project icons and bolder panels.'],
  },
];
