import { describe, it, expect } from 'vitest';
import {
  base32Encode, base32Decode, hotp, totp, verifyTotp, generateTotpSecret,
  generateBackupCodes, hashBackupCode, lockoutMinutes,
} from './totp';
import { moduleFor, actionFor } from './permission-map';

describe('TOTP (AUTH-02)', () => {
  it('base32 round-trips', () => {
    const buf = Buffer.from('WEWE ERP 2FA test vector');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('matches RFC 4226 HOTP test vectors', () => {
    // RFC 4226 appendix D: secret "12345678901234567890"
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });

  it('verifies current code and ±1 step window, rejects outside', () => {
    const secret = generateTotpSecret();
    const now = 1_754_300_000_000;
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true);  // one step later
    expect(verifyTotp(secret, code, now + 90_000)).toBe(false); // three steps later
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });

  it('backup codes hash and match case/space-insensitively', () => {
    const { plain, hashes } = generateBackupCodes(3);
    expect(new Set(hashes).size).toBe(3);
    expect(hashes).toContain(hashBackupCode(` ${plain[0].toUpperCase()} `));
  });
});

describe('lockout (AUTH-04)', () => {
  it('no lock below 5 failures, doubling after, hard lock at 10', () => {
    expect(lockoutMinutes(4)).toBe(0);
    expect(lockoutMinutes(5)).toBe(1);
    expect(lockoutMinutes(7)).toBe(4);
    expect(lockoutMinutes(9)).toBe(16);
    expect(lockoutMinutes(10)).toBe(1440);
  });
});

describe('permission map (matrix runtime enforcement)', () => {
  it('maps paths to modules and unmapped personal surfaces to null', () => {
    expect(moduleFor('/v1/requisitions/abc/action')).toBe('requisitions');
    expect(moduleFor('/v1/purchase-orders')).toBe('procurement');
    expect(moduleFor('/v1/dashboard')).toBeNull();
    expect(moduleFor('/v1/notifications')).toBeNull();
  });
  it('maps methods and sub-actions to matrix actions', () => {
    expect(actionFor('GET', '/v1/vendors')).toBe('VIEW');
    expect(actionFor('POST', '/v1/requisitions')).toBe('CREATE');
    expect(actionFor('POST', '/v1/requisitions/x/action')).toBe('APPROVE');
    expect(actionFor('POST', '/v1/requisitions/x/submit')).toBe('SUBMIT');
    expect(actionFor('POST', '/v1/vendors/x/blacklist')).toBe('EDIT');
    expect(actionFor('PATCH', '/v1/vendors/x')).toBe('EDIT');
  });
});
