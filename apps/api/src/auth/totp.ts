/**
 * AUTH-02: RFC-6238 TOTP with zero dependencies (Node crypto only).
 * Compatible with Google/Microsoft Authenticator (SHA1, 6 digits, 30s step).
 */
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'crypto';

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit
}

export function hotp(secretB32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function totp(secretB32: string, atMs = Date.now(), stepSeconds = 30): string {
  return hotp(secretB32, Math.floor(atMs / 1000 / stepSeconds));
}

/** Verify with ±1 step window (clock drift tolerance). */
export function verifyTotp(secretB32: string, code: string, atMs = Date.now(), stepSeconds = 30): boolean {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  for (const c of [counter - 1, counter, counter + 1]) {
    const expected = hotp(secretB32, c);
    if (expected.length === clean.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

export function otpauthUri(secretB32: string, accountEmail: string, issuer = 'WEWE ERP'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

export function generateBackupCodes(n = 10): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: n }, () => randomBytes(5).toString('hex')); // 10-char codes
  const hashes = plain.map((p) => createHash('sha256').update(p).digest('hex'));
  return { plain, hashes };
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/** AUTH-04: progressive lockout — minutes to lock after `attempts` consecutive failures. */
export function lockoutMinutes(attempts: number): number {
  if (attempts < 5) return 0;
  if (attempts >= 10) return 24 * 60; // hard lock — admin unlock expected
  return 2 ** (attempts - 5); // 1, 2, 4, 8, 16 minutes
}
