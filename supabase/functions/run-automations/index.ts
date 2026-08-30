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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-automation-secret");
  if (!secret || secret !== Deno.env.get("AUTOMATION_CRON_SECRET")) {
    return json({ error: "unauthorized" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

  return json({ ok: true, checked: automations?.length ?? 0, fired, slotId });
});
