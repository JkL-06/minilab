import type { User, UserPreferences } from '../domain/user';
import { createUser, validateUsername } from '../domain/user';
import { AuthenticationError, UserNotFoundError } from '../domain/errors';
import { hashPassword, validateNewPassword, verifyPassword } from './password';
import type { UserRepository } from './userRepository';
import type { LabRepository } from './labRepository';

/**
 * Application service for user accounts.
 *
 * Covers first-run setup (creating the 0th `owner` account and adopting legacy
 * `local-pi` data), password authentication, and profile/preference updates.
 * Password hashing uses node:crypto scrypt (see ./password).
 */
export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly labs: LabRepository,
  ) {}

  countUsers(): number {
    return this.users.count();
  }

  /** Creates the very first account (role `owner`). No-ops if users already exist. */
  createFirstUser(input: { username: string; password: string; displayName?: string }): User {
    if (this.users.count() > 0) {
      throw new AuthenticationError();
    }
    const user = createUser({
      username: validateUsername(input.username),
      displayName: input.displayName ?? null,
      role: 'owner',
      passwordHash: hashPassword(validateNewPassword(input.password)),
    });
    this.users.insert(user);
    return user;
  }

  /** Verifies credentials and returns the authenticated user. */
  authenticate(username: string, password: string): User {
    const user = this.users.findByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AuthenticationError();
    }
    return user;
  }

  getUser(userId: string): User {
    const user = this.users.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }
    return user;
  }

  updateProfile(
    userId: string,
    patch: { displayName?: string | null; avatar?: string | null; bio?: string | null },
  ): User {
    const user = this.requireUser(userId);
    const next: User = { ...user };
    if ('displayName' in patch) {
      const v = patch.displayName;
      next.displayName = v == null ? null : String(v).trim().slice(0, 80) || null;
    }
    if ('avatar' in patch) {
      const v = patch.avatar;
      next.avatar = v == null ? null : String(v).trim().slice(0, 16) || null;
    }
    if ('bio' in patch) {
      const v = patch.bio;
      next.bio = v == null ? null : String(v).trim().slice(0, 300) || null;
    }
    next.updatedAt = new Date().toISOString();
    this.users.update(next);
    return next;
  }

  /**
   * Merges a partial preferences patch by section (general / voice /
   * personalize). Keys whose patch value is `undefined` mean "not provided"
   * and keep their stored value — a form that only touches `voice.ttsSpeed`
   * must not wipe `voice.enabled`.
   */
  updatePreferences(userId: string, patch: Partial<UserPreferences>): User {
    const user = this.requireUser(userId);
    const mergeSection = (base: Record<string, unknown> | undefined, section: Record<string, unknown> | undefined) => {
      const out: Record<string, unknown> = { ...(base ?? {}) };
      for (const [key, value] of Object.entries(section ?? {})) {
        if (value === undefined) continue;
        out[key] = value;
      }
      return out;
    };
    const merged: UserPreferences = {
      general: mergeSection(user.preferences.general, patch.general),
      voice: mergeSection(user.preferences.voice, patch.voice),
      personalize: mergeSection(user.preferences.personalize, patch.personalize),
    };
    // Drop sections that became empty objects to keep the blob tidy.
    for (const key of ['general', 'voice', 'personalize'] as const) {
      if (merged[key] && Object.keys(merged[key] as object).length === 0) {
        delete merged[key];
      }
    }
    const next: User = { ...user, preferences: merged, updatedAt: new Date().toISOString() };
    this.users.update(next);
    return next;
  }

  changePassword(userId: string, oldPassword: string, newPassword: string): void {
    const user = this.requireUser(userId);
    if (!verifyPassword(oldPassword, user.passwordHash)) {
      throw new AuthenticationError();
    }
    const next: User = {
      ...user,
      passwordHash: hashPassword(validateNewPassword(newPassword)),
      updatedAt: new Date().toISOString(),
    };
    this.users.update(next);
  }

  /**
   * First-run data migration: transfers every Lab currently owned by the legacy
   * `local-pi` identity to the new owner account. Returns the count adopted.
   */
  adoptLegacyData(newOwnerUserId: string, legacyOwnerUserId = 'local-pi'): number {
    return this.labs.reassignOwner(legacyOwnerUserId, newOwnerUserId);
  }

  private requireUser(userId: string): User {
    const user = this.users.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }
    return user;
  }
}
