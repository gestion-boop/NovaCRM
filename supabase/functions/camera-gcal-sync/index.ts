import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveUserOAuthClientsForRefresh } from "../_shared/google-user-oauth-clients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const APPROVER_EMAILS = ["melanie.grazia@immosphera.fr", "gestion@immosphera.fr"];

// Agences dont TOUS les membres doivent voir la réservation caméra dans leur
// agenda (pour connaître la disponibilité), même s'ils ne sont pas
// directement concernés — cf. point #9 du cahier des charges.
const NOTIFIED_AGENCY_IDS = [
  "15157da9-71ea-4760-ae1c-3bc99d9caa20", // Immosphera
  "0cd9362c-316e-4b57-af0b-b6cea092961b", // Novavisio
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeData(raw: string | null) {
  const defaults = { equipment: {} as Record<string, boolean>, lieu: "", mandat: "", projet: "", note: "" };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { ...defaults, ...parsed, equipment: parsed.equipment ?? parsed.checklist ?? {} };
    }
  } catch {}
  return { ...defaults, note: raw };
}

const EQUIPMENT_LABELS: Record<string, string> = {
  giraffe: "Caméra Giraffe",
  dji: "Caméra DJI",
  x4: "Caméra X4",
  cm: "Community Manager",
};

// `forOwner`: true pour le demandeur (événement "Occupé" dans son propre
// agenda) ; false pour les collègues simplement informés de la
// disponibilité de la caméra (événement "Libre" — ne doit jamais bloquer un
// autre rendez-vous sur leur créneau).
function buildGoogleEvent(reservation: any, requesterName: string, agencyName: string, forOwner: boolean) {
  const data = decodeData(reservation.description);
  const equipList = Object.entries(data.equipment)
    .filter(([, v]) => !!v)
    .map(([k]) => EQUIPMENT_LABELS[k] ?? k)
    .join(", ");

  const summary = `📷 Réservation caméra — ${requesterName}`;
  const lines: string[] = [];
  lines.push(`Demandeur : ${requesterName}`);
  if (agencyName) lines.push(`Agence : ${agencyName}`);
  lines.push(`Statut : ${reservation.status === "accepted" ? "Validée" : reservation.status}`);
  if (equipList) lines.push(`Matériel : ${equipList}`);
  if (data.lieu) lines.push(`Lieu : ${data.lieu}`);
  if (data.mandat) lines.push(`Mandat : ${data.mandat}`);
  if (data.projet) lines.push(`Projet : ${data.projet}`);
  if (data.note) lines.push("", "Note :", data.note);
  if (!forOwner) lines.push("", "(Information — ne bloque pas votre disponibilité)");

  return {
    summary,
    description: lines.join("\n"),
    start: { dateTime: new Date(reservation.start_at).toISOString() },
    end: { dateTime: new Date(reservation.end_at).toISOString() },
    // "opaque" = Occupé (bloque le créneau), "transparent" = Libre (informatif
    // uniquement). C'est le cœur de la demande #9 : seul le demandeur doit
    // être bloqué par sa propre réservation.
    transparency: forOwner ? "opaque" : "transparent",
  };
}

async function getAccessTokenForUser(admin: any, userId: string): Promise<string | null> {
  const { data: row } = await admin.from("user_google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (row.access_token && expiresAt - Date.now() > 60_000) return row.access_token;
  if (!row.refresh_token) return null;

  for (const oauthClient of await resolveUserOAuthClientsForRefresh(admin, userId)) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const d = await r.json().catch(() => ({}) as any);
    if (r.ok && d?.access_token) {
      const newExpiresAt = new Date(Date.now() + (d.expires_in ?? 3600) * 1000).toISOString();
      await admin
        .from("user_google_tokens")
        .update({ access_token: d.access_token, expires_at: newExpiresAt, scope: d.scope ?? row.scope })
        .eq("user_id", userId);
      return d.access_token;
    }
  }
  return null;
}

async function callerCanActOn(admin: any, callerId: string, callerEmail: string, reservation: any): Promise<boolean> {
  if (reservation.user_id === callerId) return true;
  if (APPROVER_EMAILS.includes((callerEmail || "").toLowerCase())) return true;
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "super_admin")
    .maybeSingle();
  return !!role;
}

async function persist(admin: any, reservationId: string, fields: Record<string, unknown>) {
  await admin
    .from("camera_reservations")
    .update({ ...fields, last_synced_at: new Date().toISOString() })
    .eq("id", reservationId);
}

// Tous les destinataires à synchroniser : le demandeur (Occupé) + tous les
// membres des agences ImmoSphera/NovaVisio (Libre), sans doublon.
async function resolveRecipients(admin: any, requesterId: string): Promise<{ userId: string; isOwner: boolean }[]> {
  const { data: members } = await admin
    .from("agency_members")
    .select("user_id, agency_id")
    .in("agency_id", NOTIFIED_AGENCY_IDS);

  const ids = new Set<string>();
  (members ?? []).forEach((m: any) => ids.add(m.user_id));
  ids.add(requesterId);

  return [...ids].map((userId) => ({ userId, isOwner: userId === requesterId }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}) as any);
    const action: string = body.action ?? "";

    // Authentification : soit JWT utilisateur, soit appel interne (trigger Supabase via pg_net)
    // Utilise le même INTERNAL_PUSH_TOKEN que l'edge function send-push.
    const INTERNAL_TOKEN = Deno.env.get("INTERNAL_PUSH_TOKEN") ?? "";
    const xInternalToken = req.headers.get("x-internal-token") ?? "";
    const isInternalCall = INTERNAL_TOKEN !== "" && xInternalToken === INTERNAL_TOKEN;

    let caller: { id: string; email: string } | null = null;
    if (!isInternalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "not_authenticated" }, 401);
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return json({ error: "not_authenticated" }, 401);
      caller = { id: user.id, email: user.email ?? "" };
    }

    // ─── PUSH (create/update Google event dans le calendrier de CHAQUE
    // destinataire concerné — demandeur en "Occupé", collègues informés en
    // "Libre") ─────────────────────────────────────────────────────────────
    if (action === "push") {
      const reservationId: string = body.reservationId;
      if (!reservationId) return json({ error: "reservationId requis" }, 400);

      const { data: r } = await admin.from("camera_reservations").select("*").eq("id", reservationId).maybeSingle();
      if (!r) return json({ error: "reservation_not_found" }, 404);

      if (!isInternalCall && caller && !(await callerCanActOn(admin, caller.id, caller.email, r))) {
        return json({ error: "forbidden" }, 403);
      }
      if (r.status !== "accepted") {
        return json({ skipped: "status_not_accepted" });
      }

      const { data: profile } = await admin
        .from("profiles")
        .select("full_name, email")
        .eq("id", r.user_id)
        .maybeSingle();
      const requesterName =
        (profile as any)?.full_name ||
        ((profile as any)?.email ? String((profile as any).email).split("@")[0] : "Collaborateur");

      const { data: agency } = await admin.from("agencies").select("name").eq("id", r.agency_id).maybeSingle();
      const agencyName = (agency as any)?.name ?? "";

      const recipients = await resolveRecipients(admin, r.user_id);
      const eventIds: Record<string, string> = { ...(r.gcal_event_ids ?? {}) };
      const results: any[] = [];

      for (const { userId, isOwner } of recipients) {
        const token = await getAccessTokenForUser(admin, userId);
        if (!token) {
          results.push({ userId, skipped: "not_connected" });
          continue;
        }

        const event = buildGoogleEvent(r, requesterName, agencyName, isOwner);
        const gHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const existingEventId = eventIds[userId];

        try {
          if (existingEventId) {
            const res = await fetch(`${GCAL_BASE}/calendars/primary/events/${encodeURIComponent(existingEventId)}`, {
              method: "PATCH",
              headers: gHeaders,
              body: JSON.stringify(event),
            });
            if (res.status === 404 || res.status === 410) {
              const cres = await fetch(`${GCAL_BASE}/calendars/primary/events`, {
                method: "POST",
                headers: gHeaders,
                body: JSON.stringify(event),
              });
              const cdata = await cres.json().catch(() => ({}) as any);
              if (!cres.ok) throw new Error(cdata?.error?.message ?? "create_failed");
              eventIds[userId] = cdata.id;
              results.push({ userId, recreated: true });
            } else {
              const data = await res.json().catch(() => ({}) as any);
              if (!res.ok) throw new Error(data?.error?.message ?? "update_failed");
              results.push({ userId, updated: true });
            }
          } else {
            const res = await fetch(`${GCAL_BASE}/calendars/primary/events`, {
              method: "POST",
              headers: gHeaders,
              body: JSON.stringify(event),
            });
            const data = await res.json().catch(() => ({}) as any);
            if (!res.ok) throw new Error(data?.error?.message ?? "create_failed");
            eventIds[userId] = data.id;
            results.push({ userId, created: true });
          }
        } catch (e: any) {
          results.push({ userId, error: String(e?.message ?? e) });
        }
      }

      await persist(admin, r.id, { gcal_event_ids: eventIds, gcal_event_id: eventIds[r.user_id] ?? null, sync_error: null });
      return json({ ok: true, results });
    }

    // ─── DELETE (supprime l'événement dans TOUS les calendriers où il a été
    // créé) ─────────────────────────────────────────────────────────────────
    if (action === "delete") {
      const reservationId: string | undefined = body.reservationId;
      if (!reservationId) return json({ ok: true, skipped: "no_reservation_id" });

      const { data: r } = await admin.from("camera_reservations").select("*").eq("id", reservationId).maybeSingle();
      if (!r) return json({ ok: true, skipped: "reservation_not_found" });

      if (!isInternalCall && caller && !(await callerCanActOn(admin, caller.id, caller.email, r))) {
        return json({ error: "forbidden" }, 403);
      }

      const eventIds: Record<string, string> = r.gcal_event_ids ?? (r.gcal_event_id ? { [r.user_id]: r.gcal_event_id } : {});
      const results: any[] = [];

      for (const [userId, eventId] of Object.entries(eventIds)) {
        const token = await getAccessTokenForUser(admin, userId);
        if (!token) {
          results.push({ userId, skipped: "not_connected" });
          continue;
        }
        const res = await fetch(`${GCAL_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        results.push({ userId, ok: res.ok || res.status === 404 || res.status === 410 });
      }

      await persist(admin, reservationId, { gcal_event_ids: {}, gcal_event_id: null, sync_error: null });
      return json({ ok: true, results });
    }

    // ─── PULL (Google → CRM for caller's own reservations) ──────────────────────
    if (action === "pull") {
      if (!caller) return json({ error: "not_authenticated" }, 401);
      const token = await getAccessTokenForUser(admin, caller.id);
      if (!token) return json({ ok: true, skipped: "not_connected" });

      const { data: rows } = await admin
        .from("camera_reservations")
        .select("*")
        .eq("user_id", caller.id)
        .not("gcal_event_id", "is", null);

      const results: any[] = [];
      for (const r of rows ?? []) {
        try {
          const res = await fetch(`${GCAL_BASE}/calendars/primary/events/${encodeURIComponent(r.gcal_event_id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.status === 404 || res.status === 410) {
            await admin.from("camera_reservations").delete().eq("id", r.id);
            results.push({ id: r.id, deleted: true });
            continue;
          }

          const data = await res.json().catch(() => ({}) as any);
          if (!res.ok) {
            results.push({ id: r.id, error: data?.error?.message });
            continue;
          }

          if (data.status === "cancelled") {
            await admin.from("camera_reservations").delete().eq("id", r.id);
            results.push({ id: r.id, cancelled: true });
            continue;
          }

          const gStart = data.start?.dateTime ?? data.start?.date;
          const gEnd = data.end?.dateTime ?? data.end?.date;
          if (!gStart || !gEnd) continue;

          const newStart = new Date(gStart).toISOString();
          const newEnd = new Date(gEnd).toISOString();
          const dbStart = new Date(r.start_at).toISOString();
          const dbEnd = new Date(r.end_at).toISOString();

          if (newStart !== dbStart || newEnd !== dbEnd || (data.etag && data.etag !== r.gcal_etag)) {
            await admin
              .from("camera_reservations")
              .update({
                start_at: newStart,
                end_at: newEnd,
                gcal_etag: data.etag ?? r.gcal_etag,
                last_synced_at: new Date().toISOString(),
                sync_error: null,
              })
              .eq("id", r.id);
            results.push({ id: r.id, updated: true });
          }
        } catch (e: any) {
          results.push({ id: r.id, error: String(e?.message ?? e) });
        }
      }
      return json({ ok: true, results });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error("camera-gcal-sync error:", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
