/**
 * QuickBooks Online — LIVE integration (OAuth2 + JournalEntry posting).
 *
 * Turns the queued qb_outbox JOURNAL payloads into real QuickBooks Online journal
 * entries. Configuration is split between environment (app credentials, static) and
 * the settings table (per-org tokens + account mapping, runtime):
 *
 *   ENV (set in .env / compose):
 *     QBO_CLIENT_ID       Intuit app client id
 *     QBO_CLIENT_SECRET   Intuit app client secret
 *     QBO_REDIRECT_URI    e.g. https://erp.weweng.org/v1/qb/callback  (must match the Intuit app)
 *     QBO_ENV             'sandbox' (default) | 'production'
 *
 *   SETTINGS (written by the OAuth flow / admin):
 *     qb.oauth      { accessToken, refreshToken, realmId, expiresAt, refreshExpiresAt }
 *     qb.accounts   { bank, staffAdvances, programExpense, reimbursementExpense }  → QBO Account Ids
 *     qb.oauthState one-shot CSRF state for the connect round-trip
 *
 * Nothing here runs unless qb.mode = 'live' AND the app is connected. Sandbox mode
 * (the default) is untouched and still handled in qb.ts.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '73';

export type QbOAuth = {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: string;        // ISO — access token expiry
  refreshExpiresAt: string; // ISO — refresh token expiry
};
export type QbAccounts = {
  bank?: string;
  staffAdvances?: string;
  programExpense?: string;
  reimbursementExpense?: string;
};

export function qbEnvCreds() {
  const clientId = process.env.QBO_CLIENT_ID || '';
  const clientSecret = process.env.QBO_CLIENT_SECRET || '';
  const redirectUri = process.env.QBO_REDIRECT_URI || '';
  const production = (process.env.QBO_ENV || 'sandbox').toLowerCase() === 'production';
  const apiBase = production ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
  return { clientId, clientSecret, redirectUri, production, apiBase, configured: !!(clientId && clientSecret && redirectUri) };
}

// ---- settings helpers (untyped keys stored directly in the settings table) ----
async function readSetting<T>(key: string): Promise<T | null> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return row ? (row.value as T) : null;
}
async function writeSetting(key: string, value: unknown): Promise<void> {
  await db.insert(schema.settings).values({ key, value: value as any })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: value as any, updatedAt: new Date() } });
}
async function deleteSetting(key: string): Promise<void> {
  await db.delete(schema.settings).where(eq(schema.settings.key, key));
}

export const getOAuth = () => readSetting<QbOAuth>('qb.oauth');
export const getAccounts = async (): Promise<QbAccounts> => (await readSetting<QbAccounts>('qb.accounts')) ?? {};
export const setAccounts = (a: QbAccounts) => writeSetting('qb.accounts', a);
export const setMode = (mode: 'sandbox' | 'live') => writeSetting('qb.mode', mode);

/** Is the app both credential-configured and token-connected to a QBO company? */
export async function isConnected(): Promise<boolean> {
  return qbEnvCreds().configured && !!(await getOAuth());
}

// ---- OAuth2 authorization-code flow ----
export async function buildAuthorizeUrl(): Promise<string> {
  const { clientId, redirectUri, configured } = qbEnvCreds();
  if (!configured) throw new Error('QuickBooks app credentials are not set (QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI).');
  const state = `${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}`;
  await writeSetting('qb.oauthState', { state, createdAt: new Date().toISOString() });
  const p = new URLSearchParams({
    client_id: clientId, response_type: 'code', scope: SCOPE, redirect_uri: redirectUri, state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<any> {
  const { clientId, clientSecret } = qbEnvCreds();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks token endpoint ${res.status}: ${json.error_description || json.error || 'unknown error'}`);
  return json;
}

function storeTokens(realmId: string, tok: any): QbOAuth {
  const now = Date.now();
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    realmId,
    expiresAt: new Date(now + (Number(tok.expires_in ?? 3600) - 60) * 1000).toISOString(),
    refreshExpiresAt: new Date(now + (Number(tok.x_refresh_token_expires_in ?? 8640000) - 60) * 1000).toISOString(),
  };
}

/** Handle the redirect back from Intuit: validate state, exchange code, persist tokens. */
export async function handleCallback(code: string, realmId: string, state: string): Promise<void> {
  const saved = await readSetting<{ state: string }>('qb.oauthState');
  if (!saved || saved.state !== state) throw new Error('OAuth state mismatch — restart the QuickBooks connection.');
  const { redirectUri } = qbEnvCreds();
  const tok = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
  }));
  await writeSetting('qb.oauth', storeTokens(realmId, tok));
  await deleteSetting('qb.oauthState');
}

/** Return a valid access token, refreshing with the refresh token when expired. */
export async function getValidAccessToken(): Promise<{ token: string; realmId: string }> {
  const oauth = await getOAuth();
  if (!oauth) throw new Error('QuickBooks is not connected — authorize via /v1/qb/connect.');
  if (new Date(oauth.expiresAt).getTime() > Date.now()) {
    return { token: oauth.accessToken, realmId: oauth.realmId };
  }
  if (new Date(oauth.refreshExpiresAt).getTime() <= Date.now()) {
    throw new Error('QuickBooks refresh token has expired — reconnect via /v1/qb/connect.');
  }
  const tok = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken }));
  const next = storeTokens(oauth.realmId, tok);
  await writeSetting('qb.oauth', next);
  return { token: next.accessToken, realmId: next.realmId };
}

export async function disconnect(): Promise<void> {
  const oauth = await getOAuth();
  if (oauth) {
    const { clientId, clientSecret } = qbEnvCreds();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: oauth.refreshToken }),
    }).catch(() => undefined);
  }
  await deleteSetting('qb.oauth');
}

// ---- journal mapping + posting ----
const koboToAmount = (koboStr: string): number => Number(BigInt(koboStr || '0')) / 100;

type Leg = { account?: string; posting: 'Debit' | 'Credit' };
function legsFor(entry: string, accounts: QbAccounts): { debit: Leg; credit: Leg } {
  switch (entry) {
    case 'ADVANCE_DISBURSEMENT':
      return { debit: { account: accounts.staffAdvances, posting: 'Debit' }, credit: { account: accounts.bank, posting: 'Credit' } };
    case 'ADVANCE_RETIREMENT':
      return { debit: { account: accounts.programExpense, posting: 'Debit' }, credit: { account: accounts.staffAdvances, posting: 'Credit' } };
    case 'REIMBURSEMENT':
      return { debit: { account: accounts.reimbursementExpense ?? accounts.programExpense, posting: 'Debit' }, credit: { account: accounts.bank, posting: 'Credit' } };
    default:
      throw new Error(`Unknown journal entry type '${entry}'.`);
  }
}

/**
 * Post one queued JOURNAL payload to QuickBooks Online. Returns the QBO reference
 * (DocNumber or entity Id) to store as qbRef. Throws with an actionable message on
 * misconfiguration (missing account mapping) or API/auth failure.
 */
export async function postJournalEntry(payload: Record<string, any>): Promise<string> {
  const entry = String(payload.entry ?? '');
  const amount = koboToAmount(String(payload.amountKobo ?? payload.totalKobo ?? '0'));
  if (!(amount > 0)) throw new Error(`Journal for ${payload.txRef ?? entry} has a non-positive amount.`);

  const accounts = await getAccounts();
  const { debit, credit } = legsFor(entry, accounts);
  if (!debit.account || !credit.account) {
    throw new Error('QuickBooks account mapping incomplete — set qb.accounts (bank, staffAdvances, programExpense, reimbursementExpense) via POST /v1/qb/accounts.');
  }

  const { token, realmId } = await getValidAccessToken();
  const { apiBase } = qbEnvCreds();
  const docNumber = String(payload.txRef ?? '').slice(0, 21) || undefined;
  const privateNote = [payload.entry, payload.txRef, payload.donorCode].filter(Boolean).join(' · ');
  const body = {
    DocNumber: docNumber,
    PrivateNote: privateNote,
    Line: [
      { DetailType: 'JournalEntryLineDetail', Amount: amount, Description: privateNote, JournalEntryLineDetail: { PostingType: debit.posting, AccountRef: { value: debit.account } } },
      { DetailType: 'JournalEntryLineDetail', Amount: amount, Description: privateNote, JournalEntryLineDetail: { PostingType: credit.posting, AccountRef: { value: credit.account } } },
    ],
  };

  const url = `${apiBase}/v3/company/${realmId}/journalentry?minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = json?.Fault?.Error?.[0];
    throw new Error(`QuickBooks post ${res.status}: ${fault ? `${fault.Message} — ${fault.Detail}` : JSON.stringify(json).slice(0, 300)}`);
  }
  const je = json?.JournalEntry;
  return je?.DocNumber || je?.Id || `QBO-${Date.now()}`;
}
