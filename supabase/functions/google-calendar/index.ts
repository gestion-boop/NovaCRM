import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveUserOAuthClientsForRefresh } from "../_shared/google-user-oauth-clients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

type TokenInfo = { token: string; email: string | null; scope: string };

function hasCalendarScope(scope: string | null | undefined): boolean {
  const scopes = String(scope ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return CALENDAR_SCOPES.some((required) => scopes.includes(required));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getValidAccessToken(admin: any, userId: string): Promise<TokenInfo | null> {
  const { data: row } = await admin.from("user_google_tokens").select("*").eq("user_id", userId).maybeSingle();

  if (!row) return null;

  const scope = row.scope ?? "";
  const expiresAt = new Date(row.expires_at).getTime();

  if (row.access_token && expiresAt - Date.now() > 60_000) {
    return { token: row.access_token, email: row.google_email ?? null, scope };
  }

  if (!row.refresh_token) return null;

  let refreshData: any = null;
  for (const oauthClient of await resolveUserOAuthClientsForRefresh(admin, userId)) {
    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    refreshData = await refreshRes.json().catch(() => ({}));
    if (refreshRes.ok && refreshData?.access_token) break;

    console.error("google calendar refresh failed", { entity: oauthClient.entity, refreshData });
    refreshData = null;
  }

  if (!refreshData?.access_token) return null;

  const newAccess = refreshData.access_token as string;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
  const newScope = refreshData.scope ?? scope;

  await admin
    .from("user_google_tokens")
    .update({ access_token: newAccess, expires_at: newExpiresAt, scope: newScope })
    .eq("user_id", userId);

  return { token: newAccess, email: row.google_email ?? null, scope: newScope };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "not_connected" }, 200);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return json({ error: "not_connected" }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "list";

    if (action === "status") {
      const { data: row } = await admin
        .from("user_google_tokens")
        .select("google_email, scope, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();

      const connected = !!row;
      const missingCalendarScope = connected && !hasCalendarScope((row as any)?.scope);

      return json({
        connected,
        email: (row as any)?.google_email ?? null,
        missingCalendarScope,
        scope: (row as any)?.scope ?? "",
      });
    }

    if (action === "disconnect") {
      await admin.from("user_google_tokens").delete().eq("user_id", user.id);
      return json({ ok: true });
    }

    const tokenInfo = await getValidAccessToken(admin, user.id);
    if (!tokenInfo) return json({ error: "not_connected" }, 200);
    if (!hasCalendarScope(tokenInfo.scope)) return json({ error: "missing_calendar_scope" }, 200);

    const gHeaders = {
      Authorization: `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    if (action === "list") {
      const timeMin: string = body.timeMin ?? new Date().toISOString();
      const timeMax: string = body.timeMax ?? new Date(Date.now() + 30 * 86400_000).toISOString();
      const calendarId: string = body.calendarId ?? "primary";

      const url = new URL(`${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "250");

      const res = await fetch(url.toString(), { headers: gHeaders });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("gcal list failed", data);
        const status = data?.error?.status;
        const message = data?.error?.message ?? "Google Calendar indisponible";
        if (status === "PERMISSION_DENIED" || res.status === 403)
          return json({ error: "missing_calendar_scope", details: message });
        return json({ error: "list_failed", details: message }, 200);
      }

      return json({ items: data.items ?? [] });
    }

    if (action === "create") {
      const calendarId: string = body.calendarId ?? "primary";
      const event = body.event;
      if (!event?.summary || !event?.start || !event?.end) return json({ error: "summary, start, end requis" }, 400);

      const res = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        headers: gHeaders,
        body: JSON.stringify(event),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("gcal create failed", data);
        if (res.status === 403)
          return json({ error: "missing_calendar_scope", details: data?.error?.message ?? "Accès refusé" });
        return json({ error: "create_failed", details: data?.error?.message ?? data }, 200);
      }
      return json({ event: data });
    }

    if (action === "update") {
      const calendarId: string = body.calendarId ?? "primary";
      const eventId: string = body.eventId;
      const event = body.event;
      if (!eventId || !event) return json({ error: "eventId et event requis" }, 400);

      const res = await fetch(
        `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: gHeaders,
          body: JSON.stringify(event),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("gcal update failed", data);
        if (res.status === 403)
          return json({ error: "missing_calendar_scope", details: data?.error?.message ?? "Accès refusé" });
        return json({ error: "update_failed", details: data?.error?.message ?? data }, 200);
      }
      return json({ event: data });
    }

    if (action === "delete") {
      const calendarId: string = body.calendarId ?? "primary";
      const eventId: string = body.eventId;
      if (!eventId) return json({ error: "eventId requis" }, 400);

      const res = await fetch(
        `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: "DELETE",
          headers: gHeaders,
        },
      );

      if (!res.ok && res.status !== 410 && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        console.error("gcal delete failed", data);
        if (res.status === 403)
          return json({ error: "missing_calendar_scope", details: data?.error?.message ?? "Accès refusé" });
        return json({ error: "delete_failed", details: data?.error?.message ?? data }, 200);
      }

      return json({ ok: true });
    }

    return json({ error: "action inconnue" }, 400);
  } catch (err) {
    console.error("google-calendar error:", err);
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return json({ error: msg }, 500);
  }
});
