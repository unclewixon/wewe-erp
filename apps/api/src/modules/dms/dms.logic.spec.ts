import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  allSigned, base64DecodedBytes, buildCertificate, canReadDocument, canSignerAct,
  canWriteFolder, certificateHashMatches, escapeLike, hashVerdict, makeSnippet, nextRequiredSigner,
  type DmsUserCtx, type SignerCtx,
} from './dms.logic';

const user = (over: Partial<DmsUserCtx> = {}): DmsUserCtx => ({
  id: 'u1', departmentId: 'prg', roleCodes: ['INITIATOR'], ...over,
});

// ---------- e-sign order enforcement (DMS-08b/d) ----------

const signers = (states: [string, number, SignerCtx['status']][]): SignerCtx[] =>
  states.map(([id, orderNo, status]) => ({ id, orderNo, status }));

describe('signer order enforcement', () => {
  it('picks the lowest-order PENDING signer as next', () => {
    const s = signers([['a', 1, 'SIGNED'], ['c', 3, 'PENDING'], ['b', 2, 'PENDING']]);
    expect(nextRequiredSigner(s)?.id).toBe('b');
  });

  it('returns null when nobody is pending', () => {
    expect(nextRequiredSigner(signers([['a', 1, 'SIGNED']]))).toBeNull();
    expect(nextRequiredSigner([])).toBeNull();
  });

  it('only the lowest-order pending signer may act', () => {
    const s = signers([['a', 1, 'PENDING'], ['b', 2, 'PENDING']]);
    expect(canSignerAct(s, 'a').ok).toBe(true);
    const out = canSignerAct(s, 'b');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/turn/i);
  });

  it('advances the turn after each signature', () => {
    const s = signers([['a', 1, 'SIGNED'], ['b', 2, 'PENDING'], ['c', 3, 'PENDING']]);
    expect(canSignerAct(s, 'b').ok).toBe(true);
    expect(canSignerAct(s, 'c').ok).toBe(false);
  });

  it('blocks double-signing and non-signers', () => {
    const s = signers([['a', 1, 'SIGNED'], ['b', 2, 'PENDING']]);
    expect(canSignerAct(s, 'a').ok).toBe(false);
    expect(canSignerAct(s, 'zz').ok).toBe(false);
  });

  it('a decline halts the request for everyone', () => {
    const s = signers([['a', 1, 'DECLINED'], ['b', 2, 'PENDING']]);
    expect(canSignerAct(s, 'b').ok).toBe(false);
    expect(canSignerAct(s, 'a').ok).toBe(false);
  });

  it('allSigned only when every signer signed and there is at least one', () => {
    expect(allSigned(signers([['a', 1, 'SIGNED'], ['b', 2, 'SIGNED']]))).toBe(true);
    expect(allSigned(signers([['a', 1, 'SIGNED'], ['b', 2, 'PENDING']]))).toBe(false);
    expect(allSigned(signers([['a', 1, 'SIGNED'], ['b', 2, 'DECLINED']]))).toBe(false);
    expect(allSigned([])).toBe(false);
  });
});

// ---------- certificate + hash logic (DMS-08c) ----------

describe('completion certificate', () => {
  const cert = buildCertificate({
    documentId: 'doc1', versionNo: 3, sha256: 'abc123',
    completedAt: new Date('2026-08-05T10:00:00Z'),
    signers: [
      { orderNo: 2, name: 'Ext One', method: 'typed', signedAt: new Date('2026-08-05T09:00:00Z'), ip: '1.2.3.4', external: true },
      { orderNo: 1, name: 'Tunde Balogun', method: 'drawn', signedAt: new Date('2026-08-04T09:00:00Z'), ip: '10.0.0.1', external: false },
    ],
  });

  it('carries document identity, version and hash', () => {
    expect(cert.documentId).toBe('doc1');
    expect(cert.versionNo).toBe(3);
    expect(cert.sha256).toBe('abc123');
    expect(cert.completedAt).toBe('2026-08-05T10:00:00.000Z');
  });

  it('sorts signers by order and tags verification method', () => {
    expect(cert.signers.map((s) => s.name)).toEqual(['Tunde Balogun', 'Ext One']);
    expect(cert.signers[0].verification).toBe('internal-session');
    expect(cert.signers[1].verification).toBe('email-otp');
    expect(cert.signers[0].signedAt).toBe('2026-08-04T09:00:00.000Z');
    expect(cert.signers[1].ip).toBe('1.2.3.4');
  });

  it('hash match: true only when current bytes hash equals the signed hash', () => {
    expect(certificateHashMatches(cert, 'abc123')).toBe(true);
    expect(certificateHashMatches(cert, 'tampered')).toBe(false);
    expect(certificateHashMatches(cert, null)).toBe(false); // file gone (e.g. disposed)
  });
});

// ---------- DMS-10: hash verification verdicts ----------
//
// These run against real SHA-256 digests of real buffers rather than stand-in strings,
// because the property under test is that a changed FILE is detected — not that two
// unequal strings are unequal. A single flipped byte is the case that matters: it is
// what a quiet edit to a signed document actually looks like.

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('hash verification (DMS-10)', () => {
  const original = Buffer.from('Signed award amendment — payment schedule B.\n', 'utf8');
  const recorded = sha(original);

  it('verifies bytes that are unchanged', () => {
    expect(hashVerdict(recorded, sha(Buffer.from(original)))).toBe('verified');
  });

  it('detects a single flipped byte', () => {
    const tampered = Buffer.from(original);
    tampered[0] = tampered[0] ^ 0x01;
    expect(sha(tampered)).not.toBe(recorded);
    expect(hashVerdict(recorded, sha(tampered))).toBe('altered');
  });

  it('detects an appended byte, which leaves the original content intact', () => {
    const appended = Buffer.concat([original, Buffer.from('x')]);
    expect(hashVerdict(recorded, sha(appended))).toBe('altered');
  });

  it('detects truncation', () => {
    expect(hashVerdict(recorded, sha(original.subarray(0, original.length - 1)))).toBe('altered');
  });

  it('reports a missing file as missing, never as altered or verified', () => {
    expect(hashVerdict(recorded, null)).toBe('missing');
  });

  it('never reports verified when nothing was recorded to compare against', () => {
    // The trap: '' === '' is true, so a naive equality check calls this verified.
    expect(hashVerdict('', '')).toBe('unverifiable');
    expect(hashVerdict(null, sha(original))).toBe('unverifiable');
    expect(hashVerdict(undefined, sha(original))).toBe('unverifiable');
    expect(hashVerdict(recorded, '')).toBe('unverifiable');
  });

  it('treats digest casing and surrounding whitespace as equal, not as tampering', () => {
    expect(hashVerdict(recorded.toUpperCase(), sha(original))).toBe('verified');
    expect(hashVerdict(`  ${recorded}  `, sha(original))).toBe('verified');
  });

  it('does not confuse two different documents of the same length', () => {
    const other = Buffer.from('Signed award amendment — payment schedule C.\n', 'utf8');
    expect(other.length).toBe(original.length);
    expect(hashVerdict(recorded, sha(other))).toBe('altered');
  });
});

// ---------- permissions (DMS-07) ----------

describe('document permissions', () => {
  const doc = (confidential: boolean, uploadedById = 'owner') => ({ uploadedById, confidential });

  it('non-confidential documents are readable org-wide', () => {
    expect(canReadDocument(user(), doc(false))).toBe(true);
  });

  it('confidential documents: uploader + privileged roles only', () => {
    expect(canReadDocument(user(), doc(true))).toBe(false);
    expect(canReadDocument(user({ id: 'owner' }), doc(true))).toBe(true);
    for (const role of ['INTERNAL_AUDIT', 'SYSTEM_ADMIN', 'HR_OFFICER'] as const) {
      expect(canReadDocument(user({ roleCodes: [role] }), doc(true))).toBe(true);
    }
    expect(canReadDocument(user({ roleCodes: ['FINANCE'] }), doc(true))).toBe(false);
  });

  it('folder confidentiality cascades to its documents', () => {
    expect(canReadDocument(user(), doc(false), true)).toBe(false);
    expect(canReadDocument(user({ roleCodes: ['INTERNAL_AUDIT'] }), doc(false), true)).toBe(true);
  });

  it('department folders: writable by that department + SYSTEM_ADMIN only', () => {
    const folder = { departmentId: 'fin', confidential: false };
    expect(canWriteFolder(user({ departmentId: 'fin' }), folder)).toBe(true);
    expect(canWriteFolder(user({ departmentId: 'prg' }), folder)).toBe(false);
    expect(canWriteFolder(user({ departmentId: 'prg', roleCodes: ['SYSTEM_ADMIN'] }), folder)).toBe(true);
    expect(canWriteFolder(user(), { departmentId: null, confidential: false })).toBe(true);
  });
});

// ---------- search snippets + sizing ----------

describe('search snippet (DMS-04)', () => {
  it('returns a match-centred snippet with correct highlight offsets', () => {
    const text = 'The annual procurement policy requires three quotes for purchases above the threshold.';
    const out = makeSnippet(text, 'Policy', 20)!;
    expect(out).not.toBeNull();
    for (const m of out.matches) {
      expect(out.snippet.slice(m.start, m.start + m.length).toLowerCase()).toBe('policy');
    }
  });

  it('marks every in-window occurrence and handles no match', () => {
    const out = makeSnippet('aaa X bbb X ccc', 'X', 100)!;
    expect(out.matches.length).toBe(2);
    expect(makeSnippet('nothing here', 'zebra')).toBeNull();
    expect(makeSnippet(null, 'x')).toBeNull();
  });

  it('escapes ILIKE metacharacters', () => {
    expect(escapeLike('100%_\\done')).toBe('100\\%\\_\\\\done');
  });
});

describe('upload sizing (DMS-01)', () => {
  it('computes decoded base64 size without decoding', () => {
    const buf = Buffer.from('hello world!!');
    expect(base64DecodedBytes(buf.toString('base64'))).toBe(buf.length);
    const buf2 = Buffer.alloc(1000, 7);
    expect(base64DecodedBytes(buf2.toString('base64'))).toBe(1000);
  });
});
