import { randomBytes } from 'node:crypto';

/**
 * In-memory session store for browser authentication.
 *
 * Sessions live only for the lifetime of the process — restarting MiniLab
 * clears them, so the user must re-enter their password on every launch (the
 * product requirement). Tray-resident sessions survive window closes but not
 * a full restart.
 */
export interface Session {
  userId: string;
  expiresAt: number;
}

export interface SessionStore {
  create(userId: string): string;
  get(token: string): Session | null;
  revoke(token: string): void;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(userId: string): string {
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  get(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }
}
