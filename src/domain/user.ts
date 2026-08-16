import { randomUUID } from 'node:crypto';

import { UserValidationError } from './errors';

/**
 * User account. MiniLab is a multi-user local application: the first account
 * (created on first-run setup) is the `owner`; every user owns their own Labs
 * (`labs.owner_user_id`) and their own preferences.
 *
 * `passwordHash` is the scrypt-encoded digest (`scrypt$N$r$p$salt$hash`) and is
 * never exposed by `toUserView`. `preferences` is a JSON blob split into the
 * settings-center sections: general / voice / personalize.
 */
export type UserRole = 'owner' | 'member';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserPreferences {
  general?: {
    /** UI language code, e.g. 'zh-CN' or 'en'. */
    language?: string;
    /** Start minimized to tray instead of showing the window. */
    startMinimized?: boolean;
  };
  voice?: {
    /** Master switch for voice features. */
    enabled?: boolean;
    /** TTS voice name (DashScope CosyVoice speaker). */
    ttsVoice?: string;
    /** TTS speed multiplier (0.5 – 2.0). */
    ttsSpeed?: number;
    /** ASR language hint, e.g. 'zh' / 'en'. */
    asrLanguage?: string;
  };
  personalize?: {
    theme?: ThemeMode;
    accentColor?: string;
    density?: 'compact' | 'comfortable';
  };
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  role: UserRole;
  passwordHash: string;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
  role: UserRole;
  passwordHash: string;
}

export interface UserView {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  role: UserRole;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{2,32}$/;

/** Validates a username: 2–32 chars of letters/digits/underscore. */
export function validateUsername(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UserValidationError('username must be a string');
  }
  const trimmed = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new UserValidationError('username must be 2–32 characters (letters, digits, underscore)');
  }
  return trimmed;
}

/** Creates a new User with an immutable ID and UTC timestamps. */
export function createUser(input: CreateUserInput): User {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    username: validateUsername(input.username),
    displayName: input.displayName ?? null,
    avatar: input.avatar ?? null,
    bio: input.bio ?? null,
    role: input.role,
    passwordHash: input.passwordHash,
    preferences: {},
    createdAt: now,
    updatedAt: now,
  };
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {};

/** Parses a stored preferences JSON blob, falling back to defaults. */
export function parsePreferences(raw: string | null | undefined): UserPreferences {
  if (!raw) return { ...DEFAULT_USER_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as UserPreferences) };
    }
  } catch {
    // fall through to defaults on malformed JSON
  }
  return { ...DEFAULT_USER_PREFERENCES };
}

/** Projection that never exposes the password hash or any secret material. */
export function toUserView(user: User): UserView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    role: user.role,
    preferences: user.preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
