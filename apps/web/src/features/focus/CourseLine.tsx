/**
 * Elapsed time drawn as a course line. With an estimate, a tick marks it (at 80% of the width)
 * and time past it continues dashed. Without one, the line fills over an hour.
 */
export function CourseLine({ elapsed, estimate }: { elapsed: number; estimate: number | null }) {
  const scale = estimate ? Math.max(estimate / 0.8, elapsed * 1.05) : Math.max(60, elapsed * 1.1);
  const pct = (m: number) => Math.min(100, (m / scale) * 100);
  const solidEnd = pct(estimate ? Math.min(elapsed, estimate) : elapsed);
  const overEnd = estimate && elapsed > estimate ? pct(elapsed) : null;

  return (
    <svg
      className="course-line"
      role="img"
      aria-label={estimate ? `${elapsed} of ${estimate} minutes used` : `${elapsed} minutes elapsed`}
      preserveAspectRatio="none"
      viewBox="0 0 100 12"
    >
      <line className="course-track" x1="0" x2="100" y1="6" y2="6" vectorEffect="non-scaling-stroke" />
      <line className="course-run" x1="0" x2={Math.max(solidEnd, 0.5)} y1="6" y2="6" vectorEffect="non-scaling-stroke" />
      {overEnd !== null && (
        <line className="course-over" x1={solidEnd} x2={overEnd} y1="6" y2="6" vectorEffect="non-scaling-stroke" />
      )}
      {estimate && (
        <line className="course-tick" x1={pct(estimate)} x2={pct(estimate)} y1="0" y2="12" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
