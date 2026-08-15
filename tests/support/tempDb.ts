import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Creates a unique temp directory and returns a database file path inside it. */
export function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'minilab-test-'));
  return join(dir, 'test.db');
}

/**
 * Removes the temp directory that owns a database file.
 *
 * On Windows SQLite may release its file handles a moment after `db.close()`,
 * so `rmSync` can transiently fail with EBUSY/EPERM (a file is still locked)
 * or ENOTEMPTY (a `-wal`/`-shm` file is still being removed). Retry those a few
 * times with a short backoff before giving up so the suite stays green on
 * Windows (parallel test files make a transient lock more likely, so we retry
 * a little more generously than strictly necessary).
 */
export function cleanupTempDb(path: string): void {
  const dir = dirname(path);
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const retryable = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!retryable.has(code ?? '')) {
        throw err;
      }
      if (attempt < 7) {
        sleep(40);
      }
    }
  }
  rmSync(dir, { recursive: true, force: true }); // last attempt; throws if still locked
}
