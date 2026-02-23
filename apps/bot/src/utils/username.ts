/**
 * Username Validation and Utilities
 *
 * Rules:
 * - 3-15 characters
 * - Only a-z, 0-9, _
 * - Must start with a letter
 * - No consecutive underscores
 */

const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,14}$/;
const CONSECUTIVE_UNDERSCORE_REGEX = /__/;

/** Reserved usernames that cannot be used */
const RESERVED_USERNAMES = new Set([
  'admin',
  'root',
  'system',
  'ccbot',
  'canton',
  'wallet',
  'support',
  'help',
  'info',
  'bot',
  'official',
  'team',
  'mod',
  'moderator',
  'staff',
  'test',
  'demo',
  'api',
]);

export interface UsernameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate username format
 */
export function validateUsername(username: string): UsernameValidationResult {
  // Normalize to lowercase
  const normalized = username.toLowerCase().trim();

  // Check length
  if (normalized.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (normalized.length > 15) {
    return { valid: false, error: 'Username must be at most 15 characters' };
  }

  // Check format (starts with letter, only a-z, 0-9, _)
  if (!USERNAME_REGEX.test(normalized)) {
    if (!/^[a-z]/.test(normalized)) {
      return { valid: false, error: 'Username must start with a letter' };
    }
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  // Check consecutive underscores
  if (CONSECUTIVE_UNDERSCORE_REGEX.test(normalized)) {
    return { valid: false, error: 'Username cannot have consecutive underscores' };
  }

  // Check reserved
  if (RESERVED_USERNAMES.has(normalized)) {
    return { valid: false, error: 'This username is reserved' };
  }

  return { valid: true };
}

/**
 * Normalize username (lowercase, trim)
 */
export function normalizeUsername(username: string): string {
  return username.toLowerCase().trim();
}

/**
 * Format username for display (with @)
 */
export function formatUsername(username: string): string {
  return `@${username}`;
}
