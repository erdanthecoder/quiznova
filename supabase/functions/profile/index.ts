/* Who somebody is, and which board they belong on.
 *
 * A person signs in through Firebase — with Google, or with an email and a
 * password — and the browser gets an ID token. The browser cannot be trusted to
 * say who it is or what role it has, so this function checks the token itself:
 * signature, issuer, audience and expiry, against Google's published keys. Only
 * then does it read or write that person's one row with the service role.
 *
 * The role matters more than it looks. It decides which site somebody lands on
 * and what they are allowed to do there, so it is never taken from a query
 * string, a cookie or local storage — only from this table, keyed by a user id
 * that came out of a verified token.
 *
 * verify_jwt is off because the caller holds a Google token, not a Supabase
 * one; the check below is the authentication, and nothing reaches the database
 * until it passes.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PROJECT = 'quiznova-88751';
const CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* Google's signing keys rotate, so they are fetched and kept only briefly. */
let certCache: { at: number; keys: Record<string, CryptoKey> } | null = null;

async function googleKeys(): Promise<Record<string, CryptoKey>> {
  if (certCache && Date.now() - certCache.at < 30 * 60 * 1000) return certCache.keys;
  const pems: Record<string, string> = await (await fetch(CERTS)).json();
  const keys: Record<string, CryptoKey> = {};
  for (const [kid, pem] of Object.entries(pems)) {
    try { keys[kid] = await keyFromCert(pem); } catch { /* skip one bad cert, not all */ }
  }
  certCache = { at: Date.now(), keys };
  return keys;
}

/* Pull the public key out of an X.509 certificate by hand: Deno has no X.509
 * parser, but the SubjectPublicKeyInfo can be found by structure. */
async function keyFromCert(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const oid = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  let at = -1;
  outer: for (let i = 0; i + oid.length < der.length; i++) {
    for (let j = 0; j < oid.length; j++) if (der[i + j] !== oid[j]) continue outer;
    at = i; break;
  }
  if (at < 0) throw new Error('no rsaEncryption in certificate');
  let start = at - 1;
  while (start >= 0 && der[start] !== 0x30) start--;
  let head = start;
  while (head > 0 && !(der[head] === 0x30 && lengthOf(der, head) + headerLen(der, head) + head >= at + oid.length)) head--;
  const spki = der.slice(head, head + headerLen(der, head) + lengthOf(der, head));
  return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

function headerLen(d: Uint8Array, i: number) {
  const n = d[i + 1];
  return n < 0x80 ? 2 : 2 + (n & 0x7f);
}
function lengthOf(d: Uint8Array, i: number) {
  const n = d[i + 1];
  if (n < 0x80) return n;
  let len = 0;
  for (let k = 0; k < (n & 0x7f); k++) len = len * 256 + d[i + 2 + k];
  return len;
}

const b64url = (s: string) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(pad + '='.repeat((4 - pad.length % 4) % 4)), (c) => c.charCodeAt(0));
};

async function whoIs(token: string): Promise<{ uid: string; email: string; name: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let head: any, claims: any;
  try {
    head = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { return null; }

  if (head.alg !== 'RS256') return null;
  if (claims.aud !== PROJECT) return null;
  if (claims.iss !== `https://securetoken.google.com/${PROJECT}`) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) return null;
  if (claims.iat && claims.iat > now + 300) return null;
  if (!claims.sub) return null;

  const keys = await googleKeys();
  const key = keys[head.kid];
  if (!key) return null;
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed);
  return ok ? { uid: claims.sub, email: claims.email || '', name: claims.name || '' } : null;
}

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const T = 'quoldek_profiles';
const ROLES = ['teacher', 'student'];

/* Progress is a small object of counters, not a free-for-all: a browser that
 * can post anything it likes into a jsonb column is a browser that can post a
 * megabyte of it. Only the keys the game actually uses survive, and each is
 * clamped to something a real term of playing could produce. */
function cleanProgress(raw: any) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (v: any, cap: number) => Math.max(0, Math.min(cap, Math.round(Number(v) || 0)));
  const ids = (v: any) => Array.isArray(v)
    ? [...new Set(v.map(Number).filter(Number.isFinite).map((n) => Math.max(0, Math.round(n))))].slice(0, 400)
    : [];
  const owned: Record<string, number[]> = {};
  if (r.owned && typeof r.owned === 'object') {
    for (const [kind, list] of Object.entries(r.owned).slice(0, 12)) {
      if (/^[a-z]{1,16}$/.test(kind)) owned[kind] = ids(list);
    }
  }
  return {
    coins: num(r.coins, 5_000_000),
    lifetime: num(r.lifetime, 5_000_000),
    games: num(r.games, 200_000),
    seenLevel: Math.max(1, num(r.seenLevel, 100)),
    blook: Number.isFinite(Number(r.blook)) ? num(r.blook, 1_000_000) : null,
    hat: Number.isFinite(Number(r.hat)) ? num(r.hat, 500) : null,
    owned,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const auth = req.headers.get('authorization') || '';
  const who = auth.startsWith('Bearer ') ? await whoIs(auth.slice(7)) : null;
  if (!who) return json({ error: 'Sign in again.' }, 401);

  if (req.method === 'GET') {
    const { data, error } = await db.from(T).select('role, display_name, progress').eq('uid', who.uid).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ profile: null, email: who.email, name: who.name });
    return json({
      profile: { role: data.role, name: data.display_name, progress: data.progress || {} },
      email: who.email, name: who.name,
    });
  }

  if (req.method === 'POST') {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'bad body' }, 400); }

    const row: Record<string, unknown> = { uid: who.uid, email: who.email, updated_at: new Date().toISOString() };

    /* A role is chosen once, on the way in. Changing it later is a real
     * decision — a student who could flip to teacher would get the whole
     * quiz-making side — so it is only accepted while there is no row yet. */
    if (typeof body?.role === 'string') {
      if (!ROLES.includes(body.role)) return json({ error: 'unknown role' }, 400);
      const { data: existing } = await db.from(T).select('role').eq('uid', who.uid).maybeSingle();
      if (!existing) row.role = body.role;
      else if (existing.role !== body.role) return json({ error: 'Your account is already set up.' }, 409);
    }
    if (typeof body?.name === 'string') row.display_name = body.name.slice(0, 60);
    if (body?.progress !== undefined) row.progress = cleanProgress(body.progress);

    const { error } = await db.from(T).upsert(row, { onConflict: 'uid' });
    if (error) return json({ error: error.message }, 500);

    const { data } = await db.from(T).select('role, display_name, progress').eq('uid', who.uid).maybeSingle();
    return json({ profile: data ? { role: data.role, name: data.display_name, progress: data.progress || {} } : null });
  }

  return json({ error: 'not allowed' }, 405);
});
