// ⚠️ CLÉ DE SERVICE — lire NOVA_SERVICE_KEY en priorité (31/08/2026).
//
// Ces fonctions lisaient `SUPABASE_SERVICE_ROLE_KEY`, la variable injectée
// automatiquement par Supabase, qui porte l'ANCIENNE clé JWT. En désactivant
// les clés héritées après la rotation, les sept fonctions se sont arrêtées
// d'un coup — notifications, e-mails, automatisations, agenda Google, jetons
// Workspace, synchronisation caméra et dépôt de documents. Le symptôme visible
// a été « Diane ne reçoit plus les notifications » ; en réalité plus personne
// n'en recevait.
//
// Supabase interdit de définir un secret dont le nom commence par `SUPABASE_` :
// impossible donc d'y placer la nouvelle clé. D'où cette variable au nom libre.
//
// Le repli sur l'ancienne variable est VOLONTAIRE : il permet de déployer ces
// fonctions sans rien casser tant que NOVA_SERVICE_KEY n'est pas renseignée.
// Une fois le secret posé et les fonctions redéployées, les clés héritées
// peuvent être désactivées pour de bon.

// Web Push sender using VAPID keys (no external deps)
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("NOVA_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_TOKEN = Deno.env.get("INTERNAL_PUSH_TOKEN") || "";

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

async function importVapidKey() {
  const d = b64urlToBytes(VAPID_PRIVATE);
  const pub = b64urlToBytes(VAPID_PUBLIC);
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);

  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64url(d),
    x: bytesToB64url(x),
    y: bytesToB64url(y),
    ext: true,
  };

  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function vapidJWT(audience: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  };

  const encH = bytesToB64url(enc.encode(JSON.stringify(header)));
  const encP = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const data = enc.encode(`${encH}.${encP}`);

  const key = await importVapidKey();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data));

  return `${encH}.${encP}.${bytesToB64url(sig)}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));

  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concatBytes(info, new Uint8Array([1]))));

  return t1.slice(0, length);
}

async function encryptPayload(payload: Uint8Array, p256dhB64: string, authB64: string) {
  const userPub = b64urlToBytes(p256dhB64);
  const userAuth = b64urlToBytes(authB64);

  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;

  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));

  const receiverKey = await crypto.subtle.importKey("raw", userPub, { name: "ECDH", namedCurve: "P-256" }, false, []);

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, ephemeral.privateKey, 256),
  );

  const keyInfo = concatBytes(enc.encode("WebPush: info\0"), userPub, ephemeralPubRaw);
  const ikm = await hkdf(userAuth, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const padded = concatBytes(payload, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);

  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);

  const header = concatBytes(salt, rs, new Uint8Array([ephemeralPubRaw.length]), ephemeralPubRaw);

  return concatBytes(header, ciphertext);
}

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
  user_agent?: string;
  created_at?: string;
  updated_at?: string;
};

function pushProvider(endpoint: string) {
  const host = new URL(endpoint).host;
  if (host.endsWith("push.apple.com")) return "apple";
  if (host.includes("fcm.googleapis.com")) return "fcm";
  if (host.includes("mozilla.com")) return "mozilla";
  return "webpush";
}

function isDefinitivePushFailure(status: number) {
  // 404/410 unambiguously mean the endpoint no longer exists. A 400/403 can
  // come from a temporary VAPID/header problem and must not delete a healthy
  // phone subscription.
  return status === 404 || status === 410;
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: any) {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await vapidJWT(audience);

  const body = enc.encode(JSON.stringify(payload));
  const encrypted = await encryptPayload(body, sub.p256dh, sub.auth);

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    TTL: "2419200",
    Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
    Urgency: "high",
  };

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers,
    body: encrypted,
  });

  const responseText = await res.text().catch(() => "");

  return {
    status: res.status,
    ok: res.ok,
    body: responseText,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      return new Response(JSON.stringify({ publicKey: VAPID_PUBLIC }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const internalToken = req.headers.get("x-internal-token") || "";
    const isInternal = INTERNAL_TOKEN !== "" && internalToken === INTERNAL_TOKEN;

    const decodeJwtPayload = (token: string): Record<string, unknown> => {
      try {
        const part = token.split(".")[1];
        if (!part) return {};
        const pad = "=".repeat((4 - (part.length % 4)) % 4);
        return JSON.parse(atob((part + pad).replace(/-/g, "+").replace(/_/g, "/")));
      } catch {
        return {};
      }
    };

    let callerId: string | null = null;
    let isServiceRole = false;

    if (!isInternal) {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");

      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const claims = decodeJwtPayload(token);

      if (claims.role === "service_role") {
        isServiceRole = true;
      } else {
        const { data: userData, error: authErr } = await supabase.auth.getUser(token);

        if (authErr || !userData?.user) {
          return new Response(JSON.stringify({ error: "Invalid token" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        callerId = userData.user.id;
      }
    }

    const body = await req.json().catch(() => ({}));

    const {
      user_ids,
      conversation_id,
      channel_id,
      message_id,
      lead_id,
      sender_id,
      title = "NovaSphere",
      message = "",
      url: explicitUrl,
      tag,
      badge,
      badgeType,
    } = body || {};

    const effectiveSenderId = sender_id || callerId;

    // Ticket #12 (nouvelle base) : quand l'appelant ne précise pas `url`
    // (ex. un trigger base de données qui ne connaît que conversation_id /
    // channel_id / message_id), la notification retombait sur "/" par
    // défaut — clic sans effet, l'appli s'ouvrait sur l'accueil sans jamais
    // atteindre le message. On reconstruit ici une URL exploitable dès que
    // possible plutôt que de dépendre du bon vouloir de chaque appelant.
    let url: string = explicitUrl || "/";
    if (!explicitUrl) {
      if (conversation_id && message_id) {
        url = `/messagerie?highlight=${message_id}`;
      } else if (conversation_id) {
        url = `/messagerie?conversation=${conversation_id}`;
      } else if (channel_id && message_id) {
        url = `/messagerie?highlight=${message_id}`;
      } else if (lead_id) {
        url = `/clients/${lead_id}`;
      }
    }

    let targets: string[] = [];

    if (isInternal || isServiceRole) {
      if (Array.isArray(user_ids) && user_ids.length > 0) {
        targets = user_ids;
      } else if (lead_id && effectiveSenderId) {
        const { data: lead } = await supabase
          .from("leads")
          .select("created_by, assigned_to")
          .eq("id", lead_id)
          .maybeSingle();

        const { data: shares } = await supabase
          .from("client_shares")
          .select("shared_with, shared_by")
          .eq("lead_id", lead_id);

        const targetSet = new Set<string>();

        if (lead?.created_by && lead.created_by !== effectiveSenderId) {
          targetSet.add(lead.created_by);
        }

        if (lead?.assigned_to && lead.assigned_to !== effectiveSenderId) {
          targetSet.add(lead.assigned_to);
        }

        for (const share of shares ?? []) {
          if (share.shared_with && share.shared_with !== effectiveSenderId) {
            targetSet.add(share.shared_with);
          }

          if (share.shared_by && share.shared_by !== effectiveSenderId) {
            targetSet.add(share.shared_by);
          }
        }

        targetSet.delete(effectiveSenderId);
        targets = [...targetSet];
      } else if (callerId) {
        targets = [callerId];
      }
    } else if (conversation_id && callerId) {
      const { data: membership } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("conversation_id", conversation_id)
        .eq("user_id", callerId)
        .maybeSingle();

      if (!membership) {
        return new Response(JSON.stringify({ error: "Not a member of this conversation" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: otherMembers } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversation_id)
        .neq("user_id", callerId);

      targets = (otherMembers ?? []).map((m: any) => m.user_id);
    } else if (lead_id && callerId) {
      // Verify caller is a participant of this lead before allowing push
      const { data: leadAccess } = await supabase
        .from("leads")
        .select("id, created_by, assigned_to, agency_id")
        .eq("id", lead_id)
        .maybeSingle();
      const { data: callerShare } = await supabase
        .from("client_shares")
        .select("id")
        .eq("lead_id", lead_id)
        .eq("shared_with", callerId)
        .maybeSingle();
      let sameAgency = false;
      if (leadAccess?.agency_id) {
        const { data: membership } = await supabase
          .from("agency_members")
          .select("agency_id")
          .eq("agency_id", leadAccess.agency_id)
          .eq("user_id", callerId)
          .maybeSingle();
        sameAgency = !!membership;
      }
      const { data: callerRoles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId);
      const isAdmin = (callerRoles ?? []).some((r: any) =>
        r.role === "admin" || r.role === "super_admin"
      );
      const isParticipant =
        !!leadAccess &&
        (leadAccess.created_by === callerId ||
          leadAccess.assigned_to === callerId ||
          !!callerShare ||
          sameAgency ||
          isAdmin);
      if (!isParticipant) {
        return new Response(
          JSON.stringify({
            error: "Not a participant of this lead",

            debug: {
              callerId,
              leadId: lead_id,

              leadFound: !!leadAccess,

              createdBy: leadAccess?.created_by ?? null,
              assignedTo: leadAccess?.assigned_to ?? null,

              hasCallerShare: !!callerShare,

              createdByMatchesCaller: leadAccess?.created_by === callerId,

              assignedToMatchesCaller: leadAccess?.assigned_to === callerId,
            },
          }),
          {
            status: 403,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }

      const { data: lead } = await supabase
        .from("leads")
        .select("created_by, assigned_to")
        .eq("id", lead_id)
        .maybeSingle();

      const { data: shares } = await supabase
        .from("client_shares")
        .select("shared_with, shared_by")
        .eq("lead_id", lead_id);

      const targetSet = new Set<string>();

      if (lead?.created_by && lead.created_by !== callerId) {
        targetSet.add(lead.created_by);
      }

      if (lead?.assigned_to && lead.assigned_to !== callerId) {
        targetSet.add(lead.assigned_to);
      }

      for (const share of shares ?? []) {
        if (share.shared_with && share.shared_with !== callerId) {
          targetSet.add(share.shared_with);
        }

        if (share.shared_by && share.shared_by !== callerId) {
          targetSet.add(share.shared_by);
        }
      }

      targetSet.delete(callerId);
      targets = [...targetSet];
    } else {
      targets = callerId ? [callerId] : [];
    }

    targets = [...new Set(targets)].filter(Boolean);

    // Only exclude the sender when explicitly provided (so self-test still works)
    if (sender_id) {
      targets = targets.filter((id) => id !== effectiveSenderId);
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ error: "No targets" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subs, error: dbErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id, user_agent, created_at, updated_at")
      .in("user_id", targets);

    if (dbErr) {
      return new Response(JSON.stringify({ error: dbErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      title,
      body: message,
      url,
      tag,
      badge,
      badgeType,
      conversation_id: conversation_id ?? null,
      lead_id: lead_id ?? null,
    };

    // Chaque endpoint représente une installation/appareil distinct. Ne jamais
    // dédupliquer les abonnements Apple par utilisateur : un même compte peut
    // légitimement être installé sur plusieurs iPhone/iPad ou plusieurs domaines.
    // Seuls les endpoints réellement rejetés par le fournisseur sont supprimés.
    const activeSubs = (subs ?? []) as PushSubscriptionRow[];
    const results = [];

    for (const s of activeSubs) {
      const provider = pushProvider(s.endpoint);
      try {
        const r = await sendPush(s, payload);

        const result = {
          id: s.id,
          user_id: s.user_id,
          provider,
          status: r.status,
          ok: r.ok,
          body: r.body,
        };
        results.push(result);

        console.log("push_send_result", JSON.stringify(result));

        if (isDefinitivePushFailure(r.status)) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        }
      } catch (e: any) {
        const result = {
          id: s.id,
          user_id: s.user_id,
          provider,
          error: String(e?.message || e),
        };
        results.push(result);
        console.log("push_send_error", JSON.stringify(result));
      }
    }

    const delivered = results.filter((result) => result.ok).length;
    return new Response(JSON.stringify({ sent: delivered, attempted: results.length, targets, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
