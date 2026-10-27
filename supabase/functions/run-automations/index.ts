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
import { resolveUserOAuthClientsForRefresh } from "../_shared/google-user-oauth-clients.ts";

// Ticket #25 (nouvelle base) : automatisations Nova IA — "récap de ma
// journée" à heure fixe, "récap mails" plusieurs fois par jour. Appelée par
// un cron externe (Vercel Cron, voir api/automations/trigger.ts) toutes les
// 15 minutes. Chaque automatisation a des horaires (`times`, ex "09:00") ;
// on ne déclenche que si l'heure actuelle correspond (± 15 min) et que ce
// créneau n'a pas déjà été déclenché aujourd'hui (`last_fired_slot`).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function getValidGmailToken(admin: any, userId: string): Promise<string | null> {
  const { data: row } = await admin.from("user_google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (row.access_token && expiresAt - Date.now() > 60_000) return row.access_token;
  if (!row.refresh_token) return null;

  for (const oauthClient of await resolveUserOAuthClientsForRefresh(admin, userId)) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.access_token) {
      await admin
        .from("user_google_tokens")
        .update({
          access_token: data.access_token,
          expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
        })
        .eq("user_id", userId);
      return data.access_token as string;
    }
  }
  return null;
}

function nowSlots(): { hhmm: string; dateKey: string } {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = now.getMinutes() < 30 ? "00" : "30"; // tolérance de 30 min sur l'horaire configuré
  return { hhmm: `${hh}:${mm}`, dateKey: now.toISOString().slice(0, 10) };
}

async function runDailyBrief(admin: any, userId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: reminders } = await admin
    .from("reminders")
    .select("title, due_at, priority")
    .eq("user_id", userId)
    .eq("is_done", false)
    .lte("due_at", todayEnd.toISOString())
    .order("due_at", { ascending: true })
    .limit(8);

  const count = reminders?.length ?? 0;
  const list = (reminders ?? []).map((r: any) => `• ${r.title}`).join("\n");

  await admin.rpc("create_notification", {
    _user_id: userId,
    _type: "daily_summary",
    _title: "☀️ Votre récap du jour",
    _message: count > 0 ? `${count} rappel(s) à traiter aujourd'hui :\n${list}` : "Rien de prévu pour l'instant — bonne journée !",
    _entity_type: "system",
    _entity_id: null,
    _agency_id: null,
    _metadata: {},
  });
}

async function runMailDigest(admin: any, userId: string) {
  const token = await getValidGmailToken(admin, userId);
  if (!token) {
    // Pas de jeton Google exploitable (jamais connecté, ou révoqué) : on ne
    // spamme pas l'utilisateur à chaque créneau, une seule notification
    // explicative suffit — voir garde plus bas côté appelant.
    return "no_token";
  }

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=10",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return "gmail_error";
  const data = await res.json();
  const refs: { id: string }[] = data.messages || [];

  const subjects: string[] = [];
  for (const ref of refs.slice(0, 5)) {
    const mRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const m = await mRes.json().catch(() => null);
    const headers = m?.payload?.headers || [];
    const subject = headers.find((h: any) => h.name === "Subject")?.value || "(sans objet)";
    const from = headers.find((h: any) => h.name === "From")?.value?.split("<")[0]?.trim() || "";
    subjects.push(`• ${from ? `${from} — ` : ""}${subject}`);
  }

  const total = refs.length;
  await admin.rpc("create_notification", {
    _user_id: userId,
    _type: "message",
    _title: total > 0 ? `📬 ${total} mail(s) non lu(s)` : "📬 Boîte mail à jour",
    _message: subjects.length > 0 ? subjects.join("\n") + (total > 5 ? `\n… et ${total - 5} de plus` : "") : "Aucun nouveau mail depuis le dernier récap.",
    _entity_type: "system",
    _entity_id: null,
    _agency_id: null,
    _metadata: {},
  });
  return "ok";
}

// Envoi différé (Chat Équipe) : traite les lignes `scheduled_messages` dues
// à chaque déclenchement de cette fonction (~15 min). Table créée
// directement en base pour cette fonctionnalité, jamais branchée à aucun
// code jusqu'ici (migration 20260904090000 pour la sécurité RLS) — voir
// `ChatViewSupabase.tsx` pour les deux chemins qu'elle imite :
//   - `channel_id` renseigné → reproduit `sendMessage()` (table
//     `chat_messages`, un canal de dossier/projet).
//   - `conversation_id` renseigné → reproduit `sendConvMessage()` (table
//     `messages`, une conversation directe).
// `messages.channel_id` existe dans le schéma mais n'est écrit par aucun
// code applicatif (chemin mort) : on n'y touche jamais ici.
async function runScheduledMessages(admin: any): Promise<number> {
  const { data: dues } = await admin
    .from("scheduled_messages")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString());

  let sent = 0;
  for (const row of dues ?? []) {
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name, email")
        .eq("id", row.user_id)
        .maybeSingle();
      const senderName = profile?.full_name || profile?.email || "Utilisateur";

      let sentMessageId: string | null = null;
      let bodyText = row.body || "";
      let mediaKind = row.kind || "text";
      let attachmentUrl: string | null = null;
      let attachmentMime: string | null = null;

      if (row.body && row.body.startsWith('{"__media__":true')) {
        try {
          const parsed = JSON.parse(row.body);
          bodyText = parsed.text || "";
          mediaKind = parsed.kind || mediaKind;
          attachmentUrl = parsed.attachmentUrl || null;
          attachmentMime = parsed.attachmentMime || (mediaKind === "image" ? "image/jpeg" : mediaKind === "video" ? "video/mp4" : null);
        } catch (_) {}
      }

      if (row.channel_id) {
        const { data: channel } = await admin
          .from("chat_channels")
          .select("id, name, project_id")
          .eq("id", row.channel_id)
          .maybeSingle();
        if (!channel) throw new Error("Canal introuvable (supprimé depuis la programmation ?).");

        sentMessageId = crypto.randomUUID();
        const dataPayload: any = {
          body: bodyText,
          kind: mediaKind,
          sender_id: row.user_id,
          sender_name: senderName,
          created_at: new Date().toISOString(),
        };
        if (attachmentUrl) {
          dataPayload.attachmentUrl = attachmentUrl;
          dataPayload.attachment_url = attachmentUrl;
          dataPayload.attachmentMime = attachmentMime;
        }

        const { error: insertError } = await admin.from("chat_messages").insert({
          id: sentMessageId,
          channel: channel.id,
          data: dataPayload,
          sender_id: row.user_id,
          is_deleted: false,
          read_by: [{ userId: row.user_id, userName: senderName, readAt: new Date().toISOString() }],
        });
        if (insertError) throw insertError;

        await admin.from("chat_channels").update({ last_message_at: new Date().toISOString() }).eq("id", channel.id);

        // Notification des membres du projet, sur le modèle de
        // `notifierMembresDuDossier` (aucun déclencheur base n'existe sur
        // `chat_messages`, contrairement à `messages` ci-dessous).
        const { data: chatProject } = await admin
          .from("chat_projects")
          .select("name, agency_id")
          .eq("id", channel.project_id)
          .maybeSingle();
        const { data: membres } = await admin
          .from("chat_project_members")
          .select("user_id")
          .eq("project_id", channel.project_id);
        const destinataires = Array.from(
          new Set(((membres ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((uid) => uid && uid !== row.user_id))
        );
        const notifTexte = bodyText || (mediaKind === "image" ? "📷 Photo" : mediaKind === "video" ? "🎥 Vidéo" : "Message");
        await Promise.all(
          destinataires.map((uid) =>
            admin.rpc("create_notification", {
              _user_id: uid,
              _type: "message",
              _title: `💬 ${chatProject?.name || "Projet interne"} · ${channel.name}`,
              _message: `${senderName} : ${notifTexte}`.slice(0, 180),
              _entity_type: "chat_channel",
              _entity_id: channel.id,
              _agency_id: chatProject?.agency_id ?? null,
              _metadata: { url: "/messagerie" },
            })
          )
        );
      } else if (row.conversation_id) {
        const messageInsert: any = {
          conversation_id: row.conversation_id,
          user_id: row.user_id,
          kind: mediaKind,
          body: bodyText,
        };
        if (attachmentUrl) {
          messageInsert.attachment_url = attachmentUrl;
          messageInsert.attachment_mime = attachmentMime;
        }

        const { data: inserted, error: insertError } = await admin
          .from("messages")
          .insert(messageInsert)
          .select("id")
          .single();
        if (insertError) throw insertError;
        sentMessageId = inserted?.id ?? null;

        await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", row.conversation_id);
        // Pas de notification à dupliquer ici : un déclencheur base existant
        // s'en charge déjà pour tout insert dans `messages` (voir
        // `sendConvMessage` dans ChatViewSupabase.tsx).
      } else {
        throw new Error("Ni channel_id ni conversation_id renseigné.");
      }

      await admin
        .from("scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), sent_message_id: sentMessageId })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      console.error("scheduled message failed", row.id, e);
      await admin
        .from("scheduled_messages")
        .update({ status: "failed", error: (e as { message?: string })?.message || String(e) })
        .eq("id", row.id);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-automation-secret");
  if (!secret || secret !== Deno.env.get("AUTOMATION_CRON_SECRET")) {
    return json({ error: "unauthorized" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("NOVA_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { hhmm, dateKey } = nowSlots();
  const slotId = `${dateKey}T${hhmm}`;

  const { data: automations } = await admin.from("automations").select("*").eq("is_active", true);

  let fired = 0;
  for (const a of automations ?? []) {
    const times: string[] = a.times ?? [];
    // Correspondance à ±30 min de chaque horaire configuré.
    const due = times.some((t) => {
      const [th, tm] = t.split(":").map(Number);
      const [nh, nm] = hhmm.split(":").map(Number);
      const diff = Math.abs(th * 60 + tm - (nh * 60 + nm));
      return diff <= 30;
    });
    if (!due || a.last_fired_slot === slotId) continue;

    try {
      if (a.type === "daily_brief") await runDailyBrief(admin, a.user_id);
      else if (a.type === "mail_digest") await runMailDigest(admin, a.user_id);
      await admin.from("automations").update({ last_fired_slot: slotId, updated_at: new Date().toISOString() }).eq("id", a.id);
      fired++;
    } catch (e) {
      console.error("automation failed", a.id, e);
    }
  }

  const sentMessages = await runScheduledMessages(admin);

  return json({ ok: true, checked: automations?.length ?? 0, fired, slotId, sentMessages });
});
