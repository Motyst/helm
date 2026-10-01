import { CHANGELOG } from './changelog.ts';

const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const day = (iso: string) => dayFormat.format(new Date(`${iso}T12:00:00`));

/** The latest release's changes, with older ones folded away. */
export function UpdatesSection() {
  const [latest, ...older] = CHANGELOG;
  if (!latest) return null;

  return (
    <section className="settings-section updates" aria-labelledby="updates-heading">
      <h2 id="updates-heading" className="settings-subtitle">
        Recent updates
      </h2>
      <Release date={latest.date} changes={latest.changes} />
      {older.length > 0 && (
        <details className="updates-older">
          <summary>Earlier updates</summary>
          {older.map((r) => (
            <Release key={r.date} date={r.date} changes={r.changes} />
          ))}
        </details>
      )}
    </section>
  );
}

function Release({ date, changes }: { date: string; changes: string[] }) {
  return (
    <div className="updates-release">
      <time dateTime={date}>{day(date)}</time>
      <ul>
        {changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
