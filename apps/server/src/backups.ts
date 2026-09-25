import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface BackupOptions {
  dir: string;
  /** How many daily copies to keep. */
  keep: number;
  /** Takes a consistent copy of the live database (see DbHandle.backup). */
  backup: (dest: string) => Promise<unknown>;
  now?: () => Date;
  log?: (line: string) => void;
}

const NAME = /^helm-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Makes today's copy (`helm-YYYY-MM-DD.db`, UTC) unless it already exists, then deletes all but
 * the newest `keep`. Returns the file name when a copy was made.
 */
export async function backupIfDue(o: BackupOptions): Promise<string | null> {
  const now = (o.now ?? (() => new Date()))();
  const name = `helm-${now.toISOString().slice(0, 10)}.db`;
  mkdirSync(o.dir, { recursive: true });
  const existing = () => readdirSync(o.dir).filter((f) => NAME.test(f)).sort();
  if (existing().includes(name)) return null;

  // Write under a temporary name first, so a crash never leaves a half copy that looks complete.
  const tmp = join(o.dir, `${name}.partial`);
  rmSync(tmp, { force: true });
  await o.backup(tmp);
  renameSync(tmp, join(o.dir, name));

  for (const old of existing().slice(0, -o.keep)) rmSync(join(o.dir, old), { force: true });
  o.log?.(`Backup saved: ${join(o.dir, name)} (keeping ${o.keep})`);
  return name;
}

/** A copy a minute after start, then a check every hour. Returns a function that stops it. */
export function scheduleBackups(o: BackupOptions): () => void {
  const log = o.log ?? console.log;
  const run = () =>
    backupIfDue({ ...o, log }).catch((e: unknown) =>
      log(`Backup failed: ${e instanceof Error ? e.message : String(e)}. Will try again within the hour.`),
    );
  const first = setTimeout(run, 60_000);
  const hourly = setInterval(run, 60 * 60_000);
  first.unref();
  hourly.unref();
  return () => {
    clearTimeout(first);
    clearInterval(hourly);
  };
}
