/**
 * Pure DMS + e-sign logic (DMS-01/02/03/04/06/07/08). No I/O — unit-testable.
 * Controllers/services call these; permission decisions live here, not in controllers.
 */
import type { RoleCode } from '../../db/schema';

// ---------- permissions (DMS-07) ----------

export interface DmsUserCtx {
  id: string;
  departmentId: string | null;
  roleCodes: RoleCode[];
}

/** Roles that may read confidential documents/folders besides the uploader. */
export const CONFIDENTIAL_READER_ROLES: RoleCode[] = ['INTERNAL_AUDIT', 'SYSTEM_ADMIN', 'HR_OFFICER'];

export function isConfidentialReader(user: DmsUserCtx): boolean {
  return user.roleCodes.some((r) => CONFIDENTIAL_READER_ROLES.includes(r));
}

/**
 * Confidential documents (own flag OR any ancestor folder confidential) are readable
 * only by the uploader, INTERNAL_AUDIT, SYSTEM_ADMIN and HR_OFFICER. Everything else
 * is readable org-wide.
 */
export function canReadDocument(
  user: DmsUserCtx,
  doc: { uploadedById: string; confidential: boolean },
  folderConfidential = false,
): boolean {
  if (doc.confidential || folderConfidential) {
    return doc.uploadedById === user.id || isConfidentialReader(user);
  }
  return true;
}

export function canReadFolder(user: DmsUserCtx, folder: { confidential: boolean }): boolean {
  return !folder.confidential || isConfidentialReader(user);
}

/**
 * Department folders are readable org-wide but writable only by that department's
 * users + SYSTEM_ADMIN. Non-departmental folders are writable by any authenticated
 * user. Confidential folders additionally require confidential-reader standing.
 */
export function canWriteFolder(
  user: DmsUserCtx,
  folder: { departmentId: string | null; confidential: boolean },
): boolean {
  if (user.roleCodes.includes('SYSTEM_ADMIN')) return true;
  if (folder.confidential && !isConfidentialReader(user)) return false;
  if (folder.departmentId !== null) return user.departmentId === folder.departmentId;
  return true;
}

// ---------- upload sizing (DMS-01) ----------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB decoded

/** Exact decoded size of a base64 string without decoding it. */
export function base64DecodedBytes(b64: string): number {
  const clean = b64.replace(/[\s=]/g, '');
  return Math.floor((clean.length * 3) / 4);
}

// ---------- search snippets (DMS-04) ----------

export interface SnippetResult {
  snippet: string;
  /** highlight offsets INTO `snippet` (start + length), one per match occurrence */
  matches: { start: number; length: number }[];
}

/** Build a match-centred snippet with highlight offsets. Case-insensitive. */
export function makeSnippet(
  text: string | null | undefined,
  query: string,
  radius = 60,
): SnippetResult | null {
  if (!text || !query) return null;
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const first = hay.indexOf(needle);
  if (first < 0) return null;
  const start = Math.max(0, first - radius);
  const end = Math.min(text.length, first + needle.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = prefix + text.slice(start, end) + suffix;
  const matches: { start: number; length: number }[] = [];
  let idx = hay.indexOf(needle, start);
  while (idx >= 0 && idx + needle.length <= end) {
    matches.push({ start: idx - start + prefix.length, length: needle.length });
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return { snippet, matches };
}

/** Escape ILIKE metacharacters in a user query. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------- e-sign ordering (DMS-08b/c/d) ----------

export type SignerStatus = 'PENDING' | 'SIGNED' | 'DECLINED';

export interface SignerCtx {
  id: string;
  orderNo: number;
  status: SignerStatus;
}

/** The lowest-order PENDING signer — the only one allowed to act next. */
export function nextRequiredSigner<T extends SignerCtx>(signers: T[]): T | null {
  const pending = signers.filter((s) => s.status === 'PENDING');
  if (pending.length === 0) return null;
  return pending.reduce((a, b) => (b.orderNo < a.orderNo ? b : a));
}

export type SignDecision = { ok: true } | { ok: false; reason: string };

/** Order enforcement: only the lowest-order PENDING signer may sign or decline. */
export function canSignerAct(signers: SignerCtx[], signerId: string): SignDecision {
  const signer = signers.find((s) => s.id === signerId);
  if (!signer) return { ok: false, reason: 'You are not a signer on this request' };
  if (signer.status === 'SIGNED') return { ok: false, reason: 'You have already signed' };
  if (signer.status === 'DECLINED') return { ok: false, reason: 'You have already declined' };
  if (signers.some((s) => s.status === 'DECLINED'))
    return { ok: false, reason: 'The request was declined by another signer' };
  const next = nextRequiredSigner(signers);
  if (!next || next.id !== signerId)
    return { ok: false, reason: `Not your turn — signer #${next?.orderNo} must sign first` };
  return { ok: true };
}

export function allSigned(signers: SignerCtx[]): boolean {
  return signers.length > 0 && signers.every((s) => s.status === 'SIGNED');
}

// ---------- completion certificate (DMS-08c) ----------

export type SignMethod = 'drawn' | 'typed' | 'saved';
export type SignerVerification = 'internal-session' | 'email-otp';

export interface CertificateSigner {
  name: string;
  method: string;
  signedAt: string; // ISO UTC
  ip: string | null;
  verification: SignerVerification;
}

export interface Certificate {
  documentId: string;
  versionNo: number;
  sha256: string;
  signers: CertificateSigner[];
  completedAt: string; // ISO UTC
}

export function buildCertificate(input: {
  documentId: string;
  versionNo: number;
  sha256: string;
  completedAt: Date;
  signers: {
    orderNo: number;
    name: string;
    method: string;
    signedAt: Date;
    ip: string | null;
    external: boolean;
  }[];
}): Certificate {
  return {
    documentId: input.documentId,
    versionNo: input.versionNo,
    sha256: input.sha256,
    completedAt: input.completedAt.toISOString(),
    signers: [...input.signers]
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((s) => ({
        name: s.name,
        method: s.method,
        signedAt: s.signedAt.toISOString(),
        ip: s.ip,
        verification: s.external ? 'email-otp' : 'internal-session',
      })),
  };
}

/** Does the certificate's hash still match the currently stored bytes' hash? */
export function certificateHashMatches(
  cert: Pick<Certificate, 'sha256'>,
  currentSha256: string | null,
): boolean {
  return currentSha256 !== null && currentSha256 === cert.sha256;
}

/**
 * DMS-10: the outcome of checking a stored document against the hash recorded when it
 * was signed.
 *
 * Four states, not two, because the ways this can fail are not interchangeable:
 *
 *   verified     the bytes are exactly what was signed
 *   altered      the bytes changed — the one state that means someone should be told now
 *   missing      the file is gone from storage; a different problem from tampering, and
 *                sending someone to look for an editor when the disk lost the file wastes
 *                the hours that matter
 *   unverifiable nothing was recorded to compare against, so no claim can be made
 *
 * `unverifiable` exists because of a specific trap: a document with an empty recorded
 * hash, compared against an empty computed hash, is equal — and a naive equality check
 * would call that verified. A tamper check whose failure mode is a clean bill of health
 * is worse than none, so absence of a recorded hash is never a pass.
 */
export type HashVerdict = 'verified' | 'altered' | 'missing' | 'unverifiable';

export function hashVerdict(
  recorded: string | null | undefined,
  actual: string | null,
): HashVerdict {
  const want = (recorded ?? '').trim();
  if (!want) return 'unverifiable';
  if (actual === null) return 'missing';
  const got = actual.trim();
  if (!got) return 'unverifiable';
  // Hex digests are case-insensitive; a difference in casing is not tampering.
  return got.toLowerCase() === want.toLowerCase() ? 'verified' : 'altered';
}
