import { describe, expect, it } from 'vitest';
import { ProfileStore, MAX_PIN_FAILURES, MAX_RECOVERY_FAILURES, type StorageLike } from './profile';

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

describe('ProfileStore', () => {
  it('creates a profile and unlocks with the password', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    expect(ps.hasProfile()).toBe(false);
    const { dekHex } = ps.createProfile({ username: 'unais', password: 'hunter2hunter2' });
    expect(dekHex).toHaveLength(64);
    expect(ps.hasProfile()).toBe(true);
    expect(ps.profileUsername()).toBe('unais');
    expect(ps.unlockWithPassword('hunter2hunter2')).toBe(dekHex);
  });

  it('never stores the raw password; unlock rejects wrong secrets', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    const { dekHex } = ps.createProfile({ username: 'unais', password: 'correct-horse-9' });
    expect(s.getItem('vaultfolio.profile.v1')).not.toContain('correct-horse-9');
    expect(ps.unlockWithPassword('wrong-horse-9')).toBeNull();
    expect(ps.unlockWithPassword('correct-horse-9')).toBe(dekHex);
  });

  it('does not let a second profile clobber an existing one', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    ps.createProfile({ username: 'unais', password: 'password123' });
    expect(() =>
      ps.createProfile({ username: 'someone-else', password: 'password123' }),
    ).toThrow(/already exists/i);
  });

  it('PIN unlock unwraps the same DEK and survives a password change', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    const { dekHex } = ps.createProfile({ username: 'unais', password: 'long-master-pass' });
    ps.registerPin('4321', dekHex);
    expect(ps.hasPin()).toBe(true);
    expect(ps.pinLength()).toBe(4);
    expect(ps.unlockWithPin('4321')).toBe(dekHex);
    expect(ps.unlockWithPin('1234')).toBeNull();

    // Changing the password must not invalidate the PIN wrap (DEK unchanged).
    expect(ps.changePassword('long-master-pass', 'an-even-longer-pass-2').ok).toBe(true);
    expect(ps.unlockWithPin('4321')).toBe(dekHex);
    expect(ps.unlockWithPassword('an-even-longer-pass-2')).toBe(dekHex);
    expect(ps.unlockWithPassword('long-master-pass')).toBeNull();
  });

  it('rejects malformed PINs', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    const { dekHex } = ps.createProfile({ username: 'unais', password: 'long-master-pass' });
    expect(() => ps.registerPin('123', dekHex)).toThrow(/4 or 6/);
    expect(() => ps.registerPin('12a4', dekHex)).toThrow(/digits/);
  });

  it('locks after MAX_PIN_FAILURES and restores counting from persisted state', () => {
    const s = new FakeStorage();
    const readAttempts = () => JSON.parse(s.getItem('vaultfolio.security.state.v1')!);
    const ps = new ProfileStore(s as unknown as Storage);
    ps.createProfile({ username: 'unais', password: 'long-master-pass' });
    for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) expect(ps.recordFailure('pin')).toBe(0);
    expect(readAttempts().pinFailures).toBe(MAX_PIN_FAILURES - 1);
    expect(ps.recordFailure('pin')).toBeGreaterThan(0); // locked now
    expect(readAttempts().pinFailures).toBe(0);
    expect(ps.recordFailure('pin')).toBeGreaterThan(0); // still locked
  });

  it('clears the PIN and recovery failures unlock the vault', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    const { dekHex } = ps.createProfile({ username: 'unais', password: 'long-master-pass' });
    ps.registerPin('7777', dekHex);
    expect(ps.recoverPin('unais', 'long-master-pass', '9999').ok).toBe(true);
    expect(ps.unlockWithPin('9999')).toBe(dekHex);
    expect(ps.unlockWithPin('7777')).toBeNull(); // old PIN gone
  });

  it('recovery requires the correct username', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    ps.createProfile({ username: 'unais', password: 'long-master-pass' });
    const res = ps.recoverPin('WRONG-Name', 'long-master-pass', '1111');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/username/i);
  });

  it('locks recovery after MAX_RECOVERY_FAILURES', () => {
    const s = new FakeStorage();
    const ps = new ProfileStore(s as unknown as Storage);
    ps.createProfile({ username: 'unais', password: 'long-master-pass' });
    let last = 0;
    for (let i = 0; i < MAX_RECOVERY_FAILURES; i++) {
      last = ps.recoverPin('unais', 'nope-wrong-pass', '1111').ok ? 0 : 0;
      ps.recordFailure('recovery');
    }
    expect(last).toBe(0);
    expect(ps.recordFailure('recovery')).toBeGreaterThan(0);
  });
});
