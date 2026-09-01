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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getValidUserGoogleToken } from "../_shared/user-google-token.ts";

// Ticket "Inviter un stagiaire" (suivi) : "je crée l'invitation mais je ne
// reçois pas de mail, il faut que ça parte à chaque fois du mail de Sylvain."
//
// Jusqu'ici, la création d'un utilisateur (POST /api/admin/users) générait
// un simple lien magique copié dans le presse-papiers — aucun e-mail réel
// n'était envoyé, à charge pour l'admin de le transmettre lui-même. Cette
// fonction envoie désormais un vrai e-mail, TOUJOURS depuis le compte Gmail
// de Sylvain (peu importe quel admin crée l'invitation), en réutilisant le
// jeton Google déjà connecté et auto-renouvelé (ticket #117, cf.
// _shared/user-google-token.ts) — pas de nouvelle connexion Google à gérer.
//
// Sécurité : appelée uniquement en interne par server.ts, authentifiée avec
// la clé service_role (jamais exposée au navigateur). Un utilisateur normal
// ne peut pas l'invoquer pour envoyer un mail arbitraire depuis Sylvain.
//
// SYLVAIN_USER_ID est fixé en dur : c'est le seul compte depuis lequel les
// e-mails système (invitations...) doivent partir, quel que soit l'admin
// qui déclenche l'action — cf. demande explicite de l'utilisateur.
const SYLVAIN_USER_ID = "4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("NOVA_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTIONS_SECRET")!;

    // Appel interne uniquement : un secret dédié (jamais la clé service_role,
    // qui peut être rotée côté plateforme indépendamment) partagé uniquement
    // entre server.ts et cette fonction — jamais accessible côté navigateur.
    const providedSecret = req.headers.get("x-internal-secret") || "";
    if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
      return json({ error: "forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const to: string = String(body.to || "").trim();
    const subject: string = String(body.subject || "").trim();
    const html: string = String(body.html || "");
    if (!to || !subject || !html) return json({ error: "to, subject et html sont requis" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const tokenInfo = await getValidUserGoogleToken(admin, SYLVAIN_USER_ID);
    if (!tokenInfo) return json({ error: "Compte Google de Sylvain non connecté ou jeton invalide." }, 200);

    const fromEmail = tokenInfo.email || "s.grazia@conseilfinances.fr";
    const fromName = "Sylvain Grazia — Nova CRM";

    const mime =
      `From: ${fromName} <${fromEmail}>\r\n` +
      `To: ${to}\r\n` +
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      html;

    const raw = base64UrlEncode(mime);

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenInfo.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    const sendText = await sendRes.text();
    if (!sendRes.ok) {
      console.error("send-system-email Gmail error:", sendText);
      return json({ error: "Échec de l'envoi Gmail", detail: sendText }, 200);
    }

    return json({ ok: true, from: fromEmail });
  } catch (err) {
    console.error("send-system-email error:", err);
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return json({ error: msg }, 500);
  }
});
