// Shared helpers for signing/verifying the OAuth `state` parameter using HMAC-SHA256.
// Prevents an attacker from forging a callback URL with a victim's user_id.

function getKey(): string {
  // We re-use the service role key as a server-side HMAC secret. It never
  // leaves the edge function runtime and is rotated alongside the project.
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("INTERNAL_PUSH_TOKEN") || "";
  if (!k) throw new Error("oauth_state_secret_unavailable");
  return k;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return b64urlEncode(new Uint8Array(sig));
}

export async function signState(data: Record<string, unknown>): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(data)));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyState<T = Record<string, unknown>>(
  raw: string,
): Promise<T | null> {
  try {
    const dot = raw.indexOf(".");
    if (dot < 0) {
      // Legacy unsigned state — reject for security.
      return null;
    }
    const payload = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = await hmac(payload);
    if (!timingSafeEqual(sig, expected)) return null;
    const json = new TextDecoder().decode(b64urlDecode(payload));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

const ALLOWED_ORIGIN_HOSTS = new Set([
  "nova360.space",
  "www.nova360.space",
  "novasphere-v2.lovable.app",
]);
const ALLOWED_ORIGIN_SUFFIXES = [".lovable.app", ".lovableproject.com"];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (ALLOWED_ORIGIN_HOSTS.has(u.hostname)) return true;
    return ALLOWED_ORIGIN_SUFFIXES.some((s) => u.hostname.endsWith(s));
  } catch {
    return false;
  }
}