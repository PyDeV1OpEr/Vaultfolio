import {
  aeadDecrypt,
  aeadEncrypt,
  checkVerifier,
  deriveKek,
  fromHex,
  freshKey,
  makeVerifier,
  toHex,
  toBase64,
  fromBase64,
  type KdfParams,
  type PasswordVerifier,
} from './crypto';

/**
 * Local profile & application security for the offline-first desktop app.
 *
 * Model (documented honestly in SECURITY.md and the README):
 *  - The profile is a LOCAL application identity — not a cloud account.
 *    Nothing here contacts any server; it works fully offline.
 *  - Passwords and PINs are NEVER stored. Only scrypt verifiers with unique
 *    salts are persisted.
 *  - A random 256-bit Data-Encryption Key (DEK) encrypts the portfolio.
 *    The DEK is stored wrapped (AES-256-GCM) under a password-derived KEK
 *    and, when a PIN is set, under a separate PIN-derived KEK — so
 *    changing the PIN never requires re-encrypting the data.
 *  - Failed-attempt state is persisted so restarting the app cannot reset
 *    the five-attempt protection.
 *
 * Everything is client-state in the app's own profile storage; a user with
 * full disk access to the profile can read the ciphertexts but not the
 * plaintext this design protects (see SECURITY.md limitations).
 */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PROFILE_KEY = 'vaultfolio.profile.v1';
const PIN_KEY = 'vaultfolio.pin.v1';
const ATTEMPTS_KEY = 'vaultfolio.security.state.v1';

export const MAX_PIN_FAILURES = 5;
export const PIN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_RECOVERY_FAILURES = 5;
export const RECOVERY_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export interface LocalProfile {
  v: 1;
  username: string;
  displayName: string | null;
  currency: 'LKR' | 'USD';
  locale: string;
  createdAt: string;
  /** Password verifier (scrypt) — the raw password is never stored. */
  passwordVerifier: PasswordVerifier;
  /** Random KEK salt so a password-KEK differs across profiles/reinstalls. */
  dekKekSalt: string; // hex
  /** DEK wrapped under the password-derived KEK. */
  dekWrappedByPassword: string; // base64 iv+ct, AAD "vf-dek-pw-v1"
}

export interface PinRecord {
  v: 1;
  length: 4 | 6;
  verifier: PasswordVerifier;
  wrapSalt: string; // hex, unique per PIN record
  /** DEK wrapped under the PIN-derived KEK. */
  dekWrappedByPin: string; // base64 iv+ct, AAD "vf-dek-pin-v1"
  createdAt: string;
}

const AAD_DEK_PW = 'vf-dek-pw-v1';
const AAD_DEK_PIN = 'vf-dek-pin-v1';

interface AttemptState {
  pinFailures: number;
  pinLockedUntil: number | null;
  recoveryFailures: number;
  recoveryLockedUntil: number | null;
  lastFailureAt: number | null;
}

const DEFAULT_ATTEMPTS: AttemptState = {
  pinFailures: 0,
  pinLockedUntil: null,
  recoveryFailures: 0,
  recoveryLockedUntil: null,
  lastFailureAt: null,
};

/* ---------------- storage plumbing (injectable for tests) ---------------- */

export class ProfileStore {
  constructor(private readonly store: StorageLike = localStorage) {}

  hasProfile(): boolean {
    return this.store.getItem(PROFILE_KEY) !== null;
  }

  profileUsername(): string | null {
    const p = this.readJson<LocalProfile>(PROFILE_KEY);
    return p ? p.username : null;
  }

  readProfile(): LocalProfile | null {
    return this.readJson<LocalProfile>(PROFILE_KEY);
  }

  private readJson<T>(key: string): T | null {
    const raw = this.store.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  getAttemptState(): AttemptState {
    const s = this.readJson<AttemptState>(ATTEMPTS_KEY);
    if (!s) return { ...DEFAULT_ATTEMPTS };
    // Cooldown that expired while the app was closed is cleared on read.
    const now = Date.now();
    return {
      ...s,
      pinLockedUntil: s.pinLockedUntil && s.pinLockedUntil > now ? s.pinLockedUntil : null,
      recoveryLockedUntil:
        s.recoveryLockedUntil && s.recoveryLockedUntil > now ? s.recoveryLockedUntil : null,
    };
  }

  private persistAttempts(a: AttemptState) {
    this.store.setItem(ATTEMPTS_KEY, JSON.stringify(a));
  }

  /** Seconds remaining until attempts of `kind` unlock (0 = not locked). */
  cooldownRemaining(kind: 'pin' | 'recovery'): number {
    const s = this.getAttemptState();
    const until = kind === 'pin' ? s.pinLockedUntil : s.recoveryLockedUntil;
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  recordFailure(kind: 'pin' | 'recovery') {
    const s = this.getAttemptState();
    if (kind === 'pin') {
      s.pinFailures += 1;
      if (s.pinFailures >= MAX_PIN_FAILURES) {
        s.pinLockedUntil = Date.now() + PIN_COOLDOWN_MS;
        s.pinFailures = 0;
      }
      s.lastFailureAt = Date.now();
    } else {
      s.recoveryFailures += 1;
      if (s.recoveryFailures >= MAX_RECOVERY_FAILURES) {
        s.recoveryLockedUntil = Date.now() + RECOVERY_COOLDOWN_MS;
        s.recoveryFailures = 0;
      }
    }
    this.persistAttempts(s);
    return this.cooldownRemaining(kind);
  }

  recordSuccess(kind: 'pin' | 'recovery') {
    const s = this.getAttemptState();
    if (kind === 'pin') s.pinFailures = 0;
    else s.recoveryFailures = 0;
    this.persistAttempts(s);
  }

  hasPin(): boolean {
    return this.readJson<PinRecord>(PIN_KEY) !== null;
  }

  pinLength(): 4 | 6 | null {
    const p = this.readJson<PinRecord>(PIN_KEY);
    return p ? p.length : null;
  }

  /* ---------------- profile lifecycle ---------------- */

  /** Creates the profile and returns the freshly generated DEK (hex) to hold in memory for the session. */
  createProfile(input: {
    username: string;
    password: string;
    displayName?: string | null;
    currency?: 'LKR' | 'USD';
    locale?: string;
  }): { dekHex: string; profile: LocalProfile } {
    if (this.hasProfile()) throw new Error('A profile already exists on this device');
    if (!input.username || input.username.length < 3) throw new Error('Username must be at least 3 characters');
    if (!input.password || input.password.length < 8) throw new Error('Password must be at least 8 characters');
    const dek = freshKey();
    const dekHex = toHex(dek);
    const kekSalt = crypto.getRandomValues(new Uint8Array(16));
    const kek = deriveKek(input.password, kekSalt);
    const profile: LocalProfile = {
      v: 1,
      username: input.username.trim(),
      displayName: input.displayName?.trim() || null,
      currency: input.currency ?? 'LKR',
      locale: input.locale ?? 'en-US',
      createdAt: new Date().toISOString(),
      passwordVerifier: makeVerifier(input.password),
      dekKekSalt: toHex(kekSalt),
      dekWrappedByPassword: aeadEncrypt(kek, dekHex, AAD_DEK_PW),
    };
    this.store.setItem(PROFILE_KEY, JSON.stringify(profile));
    return { dekHex, profile };
  }

  /** Verify the master password; on success unwraps the session DEK. */
  unlockWithPassword(password: string): string | null {
    const profile = this.readProfile();
    if (!profile) return null;
    if (!checkVerifier(password, profile.passwordVerifier)) return null;
    const kek = deriveKek(password, fromHex(profile.dekKekSalt));
    try {
      const dekHex = aeadDecrypt(kek, profile.dekWrappedByPassword, AAD_DEK_PW);
      // Sanity check the DEK shape before trusting it.
      if (fromHex(dekHex).length !== 32) return null;
      return dekHex;
    } catch {
      return null;
    }
  }

  /* ---------------- PIN lifecycle ---------------- */

  /** Registers/replaces the PIN verifier and re-wraps the DEK under the PIN KEK. */
  registerPin(pin: string, dekHex: string): PinRecord {
    if (this.readProfile() === null) throw new Error('No profile');
    if (!/^\d+$/.test(pin)) throw new Error('PIN must contain only digits');
    if (pin.length !== 4 && pin.length !== 6) throw new Error('PIN must be 4 or 6 digits');
    const kekSalt = crypto.getRandomValues(new Uint8Array(16));
    const kek = deriveKek(pin, kekSalt);
    const rec: PinRecord = {
      v: 1,
      length: pin.length as 4 | 6,
      verifier: makeVerifier(pin),
      wrapSalt: toHex(kekSalt),
      dekWrappedByPin: aeadEncrypt(kek, dekHex, AAD_DEK_PIN),
      createdAt: new Date().toISOString(),
    };
    this.store.setItem(PIN_KEY, JSON.stringify(rec));
    return rec;
  }

  /** Verify a PIN; on success unwraps the session DEK. Returns null on failure. */
  unlockWithPin(pin: string): string | null {
    const rec = this.readJson<PinRecord>(PIN_KEY);
    if (!rec) return null;
    if (!checkVerifier(pin, rec.verifier)) return null;
    try {
      const kek = deriveKek(pin, fromHex(rec.wrapSalt));
      const dekHex = aeadDecrypt(kek, rec.dekWrappedByPin, AAD_DEK_PIN);
      if (fromHex(dekHex).length !== 32) return null;
      return dekHex;
    } catch {
      return null;
    }
  }

  /**
   * Recovery: verify username + password, then set the new PIN.
   * Requires the DEK to be re-wrapped under the new PIN — unwrapped from
   * the password KEK. Nothing is exposed beyond the caller.
   */
  recoverPin(username: string, password: string, newPin: string): { ok: boolean; error?: string } {
    const profile = this.readProfile();
    if (!profile) return { ok: false, error: 'No profile exists on this device' };
    if (profile.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
      return { ok: false, error: 'Username does not match this device’s profile' };
    }
    if (!checkVerifier(password, profile.passwordVerifier)) {
      return { ok: false, error: 'Password is incorrect' };
    }
    const kek = deriveKek(password, fromHex(profile.dekKekSalt));
    let dekHex: string;
    try {
      dekHex = aeadDecrypt(kek, profile.dekWrappedByPassword, AAD_DEK_PW);
    } catch {
      return { ok: false, error: 'Could not unlock the vault with this password' };
    }
    try {
      this.registerPin(newPin, dekHex);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: true };
  }

  changePassword(currentPassword: string, newPassword: string): { ok: boolean; error?: string } {
    const profile = this.readProfile();
    if (!profile) return { ok: false, error: 'No profile' };
    if (!newPassword || newPassword.length < 8) return { ok: false, error: 'New password must be at least 8 characters' };
    if (!checkVerifier(currentPassword, profile.passwordVerifier)) {
      return { ok: false, error: 'Current password is incorrect' };
    }
    // Unwrap DEK from old KEK, re-wrap under new KEK. Data ciphertexts do not change.
    const oldKek = deriveKek(currentPassword, fromHex(profile.dekKekSalt));
    let dekHex: string;
    try {
      dekHex = aeadDecrypt(oldKek, profile.dekWrappedByPassword, AAD_DEK_PW);
    } catch {
      return { ok: false, error: 'Could not unlock the vault with the current password' };
    }
    const newSalt = crypto.getRandomValues(new Uint8Array(16));
    const newKek = deriveKek(newPassword, newSalt);
    profile.passwordVerifier = makeVerifier(newPassword);
    profile.dekKekSalt = toHex(newSalt);
    profile.dekWrappedByPassword = aeadEncrypt(newKek, dekHex, AAD_DEK_PW);
    this.store.setItem(PROFILE_KEY, JSON.stringify(profile));
    return { ok: true };
  }

  changePin(currentPin: string, newPin: string, dekHex?: string): { ok: boolean; error?: string } {
    const rec = this.readJson<PinRecord>(PIN_KEY);
    if (!rec) return { ok: false, error: 'No PIN is set' };
    if (!/^\d+$/.test(newPin) || (newPin.length !== 4 && newPin.length !== 6)) return { ok: false, error: 'New PIN must be 4 or 6 digits' };
    let dek: string | null = null;
    if (dekHex) {
      dek = dekHex;
    } else {
      if (!checkVerifier(currentPin, rec.verifier)) return { ok: false, error: 'Current PIN is incorrect' };
      const kek = deriveKek(currentPin, fromHex(rec.wrapSalt));
      try {
        dek = aeadDecrypt(kek, rec.dekWrappedByPin, AAD_DEK_PIN);
      } catch {
        return { ok: false, error: 'Could not unlock the vault with the current PIN' };
      }
    }
    this.store.removeItem(PIN_KEY);
    this.registerPin(newPin, dek);
    return { ok: true };
  }

  removePin(): void {
    this.store.removeItem(PIN_KEY);
  }

  /* ---------------- helpers for tests ---------------- */

  static dekToBytes(dekHex: string): Uint8Array {
    return fromHex(dekHex);
  }

  static dekToB64(dekHex: string): string {
    return toBase64(fromHex(dekHex));
  }

  static b64ToDekHex(b64: string): string {
    const bytes = fromBase64(b64);
    if (bytes.length !== 32) throw new Error('not a DEK blob');
    return toHex(bytes);
  }
}

/** Ciphertext blob type shared with the encrypted local storage adapter. */
export interface EncryptedDoc {
  v: 1;
  alg: 'AES-256-GCM';
  payload: string; // base64 iv+ct
}
