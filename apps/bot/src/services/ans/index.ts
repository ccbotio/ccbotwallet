/**
 * Canton ANS (Amulet Name Service) Integration
 *
 * Implementation based on official Canton Network documentation:
 * - https://docs.sync.global/app_dev/api/splice-amulet-name-service/
 * - https://docs.sync.global/app_dev/validator_api/index.html
 * - OpenAPI: ans-external.yaml
 *
 * Flow:
 * 1. User requests name registration via POST /v0/entry/create
 * 2. System returns subscriptionRequestCid (payment request contract)
 * 3. User accepts payment in Canton Wallet
 * 4. After payment, ANS entry becomes active
 *
 * Authentication:
 * - Canton Validator API requires JWT with user's partyId as the `sub` claim
 * - For devnet: HS256 JWT signed with "unsafe" secret
 * - For mainnet: Proper auth token from validator
 */

import { logger } from '../../lib/logger.js';
import * as crypto from 'crypto';

// =============================================================================
// CONFIGURATION
// =============================================================================

export const ANS_CONFIG = {
  mainnet: {
    scanApiUrl: 'https://scan.canton.network/api/scan',
    validatorApiUrl: 'https://validator.canton.network/api/validator',
  },
  devnet: {
    scanApiUrl: 'https://scan.sv-2.dev.canton.network/api/scan',
    validatorApiUrl: 'https://validator.sv-2.dev.canton.network/api/validator',
  },
  // DSO-configured technical name suffix (used for Canton API)
  nameSuffix: '.unverified.cns',
  // User-facing display suffix
  displaySuffix: '.canton',
  // Validation rules
  validation: {
    minLength: 1,
    maxLength: 63,
    maxUrlLength: 255,
    maxDescriptionLength: 140,
  },
} as const;

// =============================================================================
// TYPES - Based on Canton OpenAPI Specification
// =============================================================================

/**
 * ANS Entry as returned by Scan API
 * GET /v0/ans-entries/by-name/{name}
 * GET /v0/ans-entries/by-party/{party}
 */
export interface AnsEntry {
  contractId: string;
  user: string;           // Party ID
  name: string;           // Full name with suffix
  url: string;
  description: string;
  expiresAt: string;      // ISO timestamp
}

/**
 * ANS Entry response from Validator API
 * GET /v0/entry/all
 */
export interface AnsEntryResponse {
  contractId: string;
  name: string;
  amount: string;         // Subscription amount
  unit: string;           // Currency unit (CC)
  expiresAt: string;
  paymentInterval: string;
  paymentDuration: string;
}

/**
 * ANS Rules Configuration from Scan API
 */
export interface AnsRulesConfig {
  contractId: string;
  entryFee: string;                    // Fee in CC
  entryLifetime: { microseconds: string };
  renewalDuration: { microseconds: string };
}

/**
 * Request to create a new ANS entry
 * POST /v0/entry/create
 */
export interface CreateAnsEntryRequest {
  name: string;               // Full name ending with .unverified.cns
  url: string;                // Valid URL or empty (max 255 chars)
  description: string;        // Human-readable (max 140 chars)
}

/**
 * Response from entry creation
 */
export interface CreateAnsEntryResponse {
  name: string;
  url: string;
  description: string;
  entryContextCid: string;        // Entry context contract ID
  subscriptionRequestCid: string; // Payment request contract ID
}

/**
 * Lookup result from Scan API
 */
export interface AnsLookupResult {
  found: boolean;
  entry?: AnsEntry | undefined;
  partyId?: string | undefined;
}

/**
 * Availability check result
 */
export interface AvailabilityResult {
  available: boolean;
  error?: string | undefined;
}

/**
 * Name validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string | undefined;
}

// =============================================================================
// API RESPONSE TYPES (Internal)
// =============================================================================

interface ScanAnsRulesResponse {
  contractId?: string;
  config?: {
    entryFee?: string;
    entryLifetime?: { microseconds?: string };
    renewalDuration?: { microseconds?: string };
  };
}

interface ScanAnsEntryResponse {
  entry?: AnsEntry;
  user?: string;
}

interface ScanAnsEntriesResponse {
  entries?: AnsEntry[];
}

interface ValidatorListEntriesResponse {
  entries?: AnsEntryResponse[];
}

interface ApiErrorResponse {
  error?: string;
  message?: string;
  status?: number;
}

// =============================================================================
// ANS SERVICE CLASS
// =============================================================================

export class AnsService {
  private readonly scanApiUrl: string;
  private readonly validatorApiUrl: string;
  private readonly isDevnet: boolean;

  constructor(isDevnet = true) {
    this.isDevnet = isDevnet;
    const config = isDevnet ? ANS_CONFIG.devnet : ANS_CONFIG.mainnet;
    this.scanApiUrl = config.scanApiUrl;
    this.validatorApiUrl = config.validatorApiUrl;

    logger.info({
      service: 'ANS',
      environment: isDevnet ? 'devnet' : 'mainnet',
      scanApiUrl: this.scanApiUrl,
      validatorApiUrl: this.validatorApiUrl,
    }, 'ANS Service initialized');
  }

  // ===========================================================================
  // CANTON JWT GENERATION
  // ===========================================================================

  /**
   * Create a Canton Validator JWT for the given user partyId
   * The JWT subject (sub) claim must be the user's partyId for ANS operations
   *
   * For devnet: HS256 signed with "unsafe" secret
   * For mainnet: Would need proper auth flow with validator
   */
  private createCantonJwt(partyId: string): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: partyId,  // User's partyId - this is what links the name to the user
      aud: this.isDevnet
        ? 'https://canton.network.global'
        : 'https://canton.network.global',
      iat: now,
      exp: now + 3600, // 1 hour validity
    };

    const headerB64 = this.base64url(JSON.stringify(header));
    const payloadB64 = this.base64url(JSON.stringify(payload));
    const data = `${headerB64}.${payloadB64}`;

    // Sign with "unsafe" secret for devnet
    // For mainnet, this would need proper key management
    const secret = this.isDevnet ? 'unsafe' : process.env.CANTON_JWT_SECRET || 'unsafe';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');

    return `${data}.${signature}`;
  }

  /**
   * Base64URL encode helper
   */
  private base64url(input: string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  // ===========================================================================
  // NAME UTILITIES
  // ===========================================================================

  /**
   * Get full ANS name with DSO-configured suffix
   * @param name - Base name without suffix (e.g., "alice")
   * @returns Full name (e.g., "alice.unverified.cns")
   */
  getFullName(name: string): string {
    const cleanName = name.toLowerCase().trim();
    if (cleanName.endsWith(ANS_CONFIG.nameSuffix)) {
      return cleanName;
    }
    return `${cleanName}${ANS_CONFIG.nameSuffix}`;
  }

  /**
   * Get user-facing display name with .canton suffix
   * @param name - Base name without suffix (e.g., "alice")
   * @returns Display name (e.g., "alice.canton")
   */
  getDisplayName(name: string): string {
    const cleanName = name.toLowerCase().trim();
    return `${cleanName}${ANS_CONFIG.displaySuffix}`;
  }

  /**
   * Extract base name from full name
   * @param fullName - Full name with suffix
   * @returns Base name without suffix
   */
  getBaseName(fullName: string): string {
    if (fullName.endsWith(ANS_CONFIG.nameSuffix)) {
      return fullName.slice(0, -ANS_CONFIG.nameSuffix.length);
    }
    return fullName;
  }

  /**
   * Validate name format according to ANS rules
   * - 1-63 characters
   * - Alphanumeric and hyphens only
   * - Cannot start or end with hyphen
   * - No consecutive hyphens
   */
  validateName(name: string): ValidationResult {
    const cleanName = name.toLowerCase().trim();
    const { validation } = ANS_CONFIG;

    if (cleanName.length < validation.minLength) {
      return { valid: false, error: 'Name is required' };
    }

    if (cleanName.length > validation.maxLength) {
      return { valid: false, error: `Name cannot exceed ${validation.maxLength} characters` };
    }

    // Must start and end with alphanumeric
    if (!/^[a-z0-9]/.test(cleanName)) {
      return { valid: false, error: 'Name must start with a letter or number' };
    }

    if (!/[a-z0-9]$/.test(cleanName)) {
      return { valid: false, error: 'Name must end with a letter or number' };
    }

    // Only alphanumeric and hyphens
    if (!/^[a-z0-9-]+$/.test(cleanName)) {
      return { valid: false, error: 'Name can only contain letters, numbers, and hyphens' };
    }

    // No consecutive hyphens
    if (cleanName.includes('--')) {
      return { valid: false, error: 'Name cannot contain consecutive hyphens' };
    }

    return { valid: true };
  }

  // ===========================================================================
  // SCAN API - PUBLIC QUERIES
  // ===========================================================================

  /**
   * Get ANS rules configuration (fees, lifetime, etc.)
   * Uses Scan API: GET /v0/ans/rules (or similar endpoint)
   */
  async getAnsRules(): Promise<AnsRulesConfig | null> {
    try {
      // Note: Exact endpoint path may vary - check current Canton docs
      const response = await fetch(`${this.scanApiUrl}/v0/ans-rules`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        // Try alternative endpoint format
        const altResponse = await fetch(`${this.scanApiUrl}/v0/ans/rules`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!altResponse.ok) {
          logger.warn({ status: response.status }, 'Failed to fetch ANS rules');
          return null;
        }

        const data = (await altResponse.json()) as ScanAnsRulesResponse;
        return this.parseRulesResponse(data);
      }

      const data = (await response.json()) as ScanAnsRulesResponse;
      return this.parseRulesResponse(data);
    } catch (error) {
      logger.error({ error }, 'Error fetching ANS rules');
      return null;
    }
  }

  private parseRulesResponse(data: ScanAnsRulesResponse): AnsRulesConfig | null {
    if (!data.config) return null;

    return {
      contractId: data.contractId ?? '',
      entryFee: data.config.entryFee ?? '0',
      entryLifetime: {
        microseconds: data.config.entryLifetime?.microseconds ?? '0',
      },
      renewalDuration: {
        microseconds: data.config.renewalDuration?.microseconds ?? '0',
      },
    };
  }

  /**
   * Check if a name is available
   * Uses Scan API: GET /v0/ans-entries/by-name/{name}
   * Returns 404 if name is available
   */
  async checkNameAvailability(name: string): Promise<AvailabilityResult> {
    const validation = this.validateName(name);
    if (!validation.valid) {
      return { available: false, error: validation.error ?? 'Invalid name' };
    }

    try {
      const fullName = this.getFullName(name);
      const encodedName = encodeURIComponent(fullName);

      const response = await fetch(
        `${this.scanApiUrl}/v0/ans-entries/by-name/${encodedName}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.status === 404) {
        // Name not found = available
        return { available: true };
      }

      if (response.ok) {
        // Name exists = not available
        return { available: false, error: 'Name is already registered' };
      }

      logger.warn({ status: response.status, name }, 'Unexpected response checking name availability');
      return { available: false, error: 'Unable to verify availability' };
    } catch (error) {
      logger.error({ error, name }, 'Error checking name availability');
      return { available: false, error: 'Network error' };
    }
  }

  /**
   * Lookup a name and get associated party ID
   * Uses Scan API: GET /v0/ans-entries/by-name/{name}
   */
  async lookupName(name: string): Promise<AnsLookupResult> {
    try {
      const fullName = this.getFullName(name);
      const encodedName = encodeURIComponent(fullName);

      const response = await fetch(
        `${this.scanApiUrl}/v0/ans-entries/by-name/${encodedName}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.status === 404) {
        return { found: false };
      }

      if (!response.ok) {
        logger.warn({ status: response.status, name }, 'Error looking up name');
        return { found: false };
      }

      const data = (await response.json()) as ScanAnsEntryResponse;
      return {
        found: true,
        entry: data.entry,
        partyId: data.entry?.user ?? data.user,
      };
    } catch (error) {
      logger.error({ error, name }, 'Error looking up name');
      return { found: false };
    }
  }

  /**
   * Reverse lookup - get names from party ID
   * Uses Scan API: GET /v0/ans-entries/by-party/{party}
   */
  async reverseLookup(partyId: string): Promise<{ found: boolean; names?: string[] | undefined }> {
    try {
      const encodedParty = encodeURIComponent(partyId);

      const response = await fetch(
        `${this.scanApiUrl}/v0/ans-entries/by-party/${encodedParty}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        return { found: false };
      }

      const data = (await response.json()) as ScanAnsEntriesResponse;
      const names = data.entries?.map(e => e.name).filter(Boolean) ?? [];

      return names.length > 0
        ? { found: true, names }
        : { found: false };
    } catch (error) {
      logger.error({ error, partyId }, 'Error in reverse lookup');
      return { found: false };
    }
  }

  /**
   * Search names by prefix
   * Uses Scan API: GET /v0/ans-entries?name_prefix={prefix}&page_size={size}
   */
  async searchByPrefix(
    prefix: string,
    pageSize = 10
  ): Promise<{ entries: AnsEntry[]; hasMore: boolean }> {
    try {
      const encodedPrefix = encodeURIComponent(prefix.toLowerCase());

      const response = await fetch(
        `${this.scanApiUrl}/v0/ans-entries?name_prefix=${encodedPrefix}&page_size=${pageSize}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        return { entries: [], hasMore: false };
      }

      const data = (await response.json()) as ScanAnsEntriesResponse;
      const entries = data.entries ?? [];

      return {
        entries,
        hasMore: entries.length >= pageSize,
      };
    } catch (error) {
      logger.error({ error, prefix }, 'Error searching by prefix');
      return { entries: [], hasMore: false };
    }
  }

  // ===========================================================================
  // VALIDATOR API - AUTHENTICATED OPERATIONS
  // ===========================================================================

  /**
   * Create ANS entry request
   * Uses Validator API: POST /v0/entry/create
   *
   * This initiates the registration process:
   * 1. Creates an entry context contract
   * 2. Creates a subscription payment request
   * 3. User must accept the payment in their Canton Wallet
   * 4. After payment, the ANS entry becomes active
   *
   * @param name - Base name without suffix
   * @param url - Optional URL (max 255 chars)
   * @param description - Optional description (max 140 chars)
   * @param partyId - User's Canton partyId (used to create JWT and link the name)
   */
  async createEntry(
    name: string,
    url: string,
    description: string,
    partyId: string
  ): Promise<{ success: boolean; data?: CreateAnsEntryResponse; error?: string }> {
    // Validate inputs
    const validation = this.validateName(name);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid name' };
    }

    if (url.length > ANS_CONFIG.validation.maxUrlLength) {
      return { success: false, error: `URL cannot exceed ${ANS_CONFIG.validation.maxUrlLength} characters` };
    }

    if (description.length > ANS_CONFIG.validation.maxDescriptionLength) {
      return { success: false, error: `Description cannot exceed ${ANS_CONFIG.validation.maxDescriptionLength} characters` };
    }

    if (!partyId) {
      return { success: false, error: 'PartyId is required for name registration' };
    }

    try {
      const fullName = this.getFullName(name);

      const requestBody: CreateAnsEntryRequest = {
        name: fullName,
        url: url || '',
        description: description || '',
      };

      // Create Canton JWT with user's partyId as subject
      const cantonJwt = this.createCantonJwt(partyId);

      logger.info({ name: fullName, partyId }, 'Creating ANS entry');

      const response = await fetch(`${this.validatorApiUrl}/v0/entry/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cantonJwt}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        const errorMessage = errorData.error ?? errorData.message ?? `Request failed: ${response.status}`;

        logger.warn({ status: response.status, error: errorMessage, name: fullName }, 'Failed to create ANS entry');

        return { success: false, error: errorMessage };
      }

      const data = (await response.json()) as CreateAnsEntryResponse;

      logger.info({
        name: data.name,
        entryContextCid: data.entryContextCid,
        subscriptionRequestCid: data.subscriptionRequestCid,
      }, 'ANS entry creation initiated');

      return { success: true, data };
    } catch (error) {
      logger.error({ error, name }, 'Error creating ANS entry');
      return { success: false, error: 'Network error' };
    }
  }

  /**
   * List all ANS entries for a user
   * Uses Validator API: GET /v0/entry/all
   *
   * @param partyId - User's Canton partyId
   */
  async listUserEntries(partyId: string): Promise<{
    success: boolean;
    entries?: AnsEntryResponse[] | undefined;
    error?: string | undefined;
  }> {
    if (!partyId) {
      return { success: false, error: 'PartyId is required' };
    }

    try {
      // Create Canton JWT with user's partyId as subject
      const cantonJwt = this.createCantonJwt(partyId);

      const response = await fetch(`${this.validatorApiUrl}/v0/entry/all`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cantonJwt}`,
        },
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        return {
          success: false,
          error: errorData.error ?? errorData.message ?? `Request failed: ${response.status}`,
        };
      }

      const data = (await response.json()) as ValidatorListEntriesResponse;
      return { success: true, entries: data.entries ?? [] };
    } catch (error) {
      logger.error({ error }, 'Error listing user entries');
      return { success: false, error: 'Network error' };
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Get pricing info in human-readable format
   */
  async getPricingInfo(): Promise<{
    entryFee: string;
    entryFeeCC: number;
    lifetimeDays: number;
    renewalDays: number;
  } | null> {
    const rules = await this.getAnsRules();
    if (!rules) return null;

    const microsecondsPerDay = 24 * 60 * 60 * 1000 * 1000;
    const entryFeeCC = parseFloat(rules.entryFee);
    const lifetimeMicroseconds = parseInt(rules.entryLifetime.microseconds);
    const renewalMicroseconds = parseInt(rules.renewalDuration.microseconds);

    return {
      entryFee: `${entryFeeCC} CC`,
      entryFeeCC,
      lifetimeDays: Math.floor(lifetimeMicroseconds / microsecondsPerDay),
      renewalDays: Math.floor(renewalMicroseconds / microsecondsPerDay),
    };
  }

  /**
   * Get service configuration for API responses
   */
  getConfig() {
    return {
      nameSuffix: ANS_CONFIG.nameSuffix,
      displaySuffix: ANS_CONFIG.displaySuffix,
      isDevnet: this.isDevnet,
      validation: ANS_CONFIG.validation,
      endpoints: {
        scan: this.scanApiUrl,
        validator: this.validatorApiUrl,
      },
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const ansService = new AnsService(process.env.NODE_ENV !== 'production');

export default ansService;
