import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getValidUserGoogleToken } from "../_shared/user-google-token.ts";

// Ticket #117 : "je dois très souvent me reconnecter avec Google" — le
// jeton Google (Gmail/Drive/Agenda) capté via Supabase Auth n'est valable
// qu'~1h et n'était jamais renouvelé automatiquement. Cette fonction
// centralise le renouvellement côté serveur (via le refresh_token, stocké
// une seule fois à la connexion) pour que le CRM reste connecté à Google
// indéfiniment, sans jamais redemander de consentement à l'utilisateur.
//
// Actions :
//  - "connect"    : enregistre (upsert) le refresh_token obtenu au moment
//                    de la connexion Google via Supabase Auth.
//  - "token"      : renvoie un access_token toujours valide (rafraîchi au
//                    besoin). C'est l'action par défaut.
//  - "status"     : indique si un jeton Google est enregistré pour ce compte.
//  - "disconnect" : supprime le jeton enregistré.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "not_authenticated" }, 200);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return json({ error: "not_authenticated" }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "token";

    if (action === "status") {
      const { data: row } = await admin
        .from("user_google_tokens")
        .select("google_email, scope, updated_at, refresh_token")
        .eq("user_id", user.id)
        .maybeSingle();
      return json({ connected: !!(row as any)?.refresh_token, email: (row as any)?.google_email ?? null });
    }

    if (action === "disconnect") {
      await admin.from("user_google_tokens").delete().eq("user_id", user.id);
      return json({ ok: true });
    }

    if (action === "connect") {
      const refreshToken: string | undefined = body.refreshToken;
      const accessToken: string | undefined = body.accessToken;
      const expiresIn: number = Number(body.expiresIn) || 3600;
      const scope: string = body.scope || "";
      const email: string | null = body.email || null;

      if (!refreshToken) {
        // Google ne renvoie un refresh_token que la toute première fois
        // qu'un compte consent (ou avec prompt=consent) — sans lui, rien à
        // enregistrer de nouveau ; on garde celui déjà stocké s'il existe.
        return json({ ok: false, reason: "no_refresh_token" }, 200);
      }

      const payload = {
        user_id: user.id,
        google_email: email,
        access_token: accessToken || "",
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scope,
        updated_at: new Date().toISOString(),
      };

      const { error } = await admin.from("user_google_tokens").upsert(payload, { onConflict: "user_id" });
      if (error) return json({ ok: false, error: error.message }, 200);
      return json({ ok: true });
    }

    // action === "token"
    const tokenInfo = await getValidUserGoogleToken(admin, user.id);
    if (!tokenInfo) return json({ error: "not_connected" }, 200);
    return json({ accessToken: tokenInfo.token, email: tokenInfo.email, scope: tokenInfo.scope });
  } catch (err) {
    console.error("google-token error:", err);
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return json({ error: msg }, 500);
  }
});
