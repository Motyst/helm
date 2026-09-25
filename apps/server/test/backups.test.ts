import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '@helm/db';
import { afterEach, describe, expect, it } from 'vitest';
import { backupIfDue } from '../src/backups.ts';

describe('backupIfDue', () => {
  let dir: string;
  let handle: ReturnType<typeof openDb> | undefined;

  afterEach(() => {
    handle?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function open() {
    dir = mkdtempSync(join(tmpdir(), 'helm-backup-'));
    handle = openDb({ path: join(dir, 'helm.db') });
    return { backups: join(dir, 'backups'), backup: handle.backup };
  }

  it('saves a readable copy once a day', async () => {
    const { backups, backup } = open();
    const now = () => new Date('2026-09-24T22:30:00Z');
    expect(await backupIfDue({ dir: backups, keep: 3, backup, now })).toBe('helm-2026-09-24.db');
    expect(await backupIfDue({ dir: backups, keep: 3, backup, now })).toBeNull();

    const copy = new Database(join(backups, 'helm-2026-09-24.db'), { readonly: true });
    const tables = copy.prepare("select name from sqlite_master where type = 'table'").pluck().all();
    copy.close();
    expect(tables).toContain('tasks');
  });

  it('keeps only the newest copies and ignores other files', async () => {
    const { backups, backup } = open();
    await backupIfDue({ dir: backups, keep: 2, backup, now: () => new Date('2026-09-20T12:00:00Z') });
    writeFileSync(join(backups, 'notes.txt'), 'mine');
    for (const day of ['21', '22', '23'])
      await backupIfDue({ dir: backups, keep: 2, backup, now: () => new Date(`2026-09-${day}T12:00:00Z`) });
    expect(readdirSync(backups).sort()).toEqual(['helm-2026-09-22.db', 'helm-2026-09-23.db', 'notes.txt']);
  });
});
