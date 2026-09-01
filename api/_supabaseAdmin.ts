import { createClient } from '@supabase/supabase-js';

/**
 * Client Supabase côté serveur (clé service_role — jamais exposée au
 * navigateur) pour les fonctions serverless Vercel sous /api/admin/*.
 *
 * Remplace l'ancien serveur Express (server.ts) qui ne tourne PAS en
 * production sur Vercel (voir vercel.json : rewrite catch-all vers
 * index.html, aucune fonction Express déployée). Ces fichiers sous /api
 * SONT de vraies Vercel Serverless Functions, détectées et déployées
 * automatiquement par Vercel, et prioritaires sur le rewrite catch-all.
 */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rbzizzzvitxwnfygdpzo.supabase.co';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUPER_ADMIN_EMAIL = 's.grazia@conseilfinances.fr';

/**
 * Vérifie que l'appelant est authentifié (jeton Supabase envoyé par le
 * client via `Authorization: Bearer <token>`, voir `api()` dans
 * ParametresView.tsx) ET qu'il a le rôle super_admin — même règle que
 * `requireAdmin()` dans l'ancien server.ts, mais avec de vrais jetons
 * Supabase uniquement.
 */
/**
 * Extrait et vérifie le jeton Supabase envoyé par le client (Authorization:
 * Bearer <token>), sans exiger de rôle particulier — utilisé par les routes
 * accessibles à tout utilisateur connecté (ex. /api/settings/bootstrap).
 */
export async function getAuthedUser(req: { headers: Record<string, string | string[] | undefined> }) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurée côté serveur.');
  }

  const rawAuth = req.headers.authorization || req.headers.Authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    throw new Error('Utilisateur non authentifié.');
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new Error('Session invalide ou expirée.');
  }

  return userData.user;
}

/** true si l'utilisateur authentifié est super_admin (email racine ou rôle en base). */
export async function isSuperAdminUser(user: { id: string; email?: string | null }): Promise<boolean> {
  if ((user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL) return true;
  const { data: roleRows } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .limit(1);
  return roleRows?.[0]?.role === 'super_admin';
}

export async function requireSuperAdmin(req: { headers: Record<string, string | string[] | undefined> }) {
  const user = await getAuthedUser(req);
  if (await isSuperAdminUser(user)) {
    return user;
  }
  throw new Error('Action réservée aux super administrateurs.');
}

// Signalé : les liens d'invitation/magiclink pointaient vers
// novasphere.nova360.space (ancien alias, supprimé le 25/08). Cause réelle :
// Supabase Auth n'honore `redirectTo` que s'il correspond EXACTEMENT à une
// entrée de sa liste blanche de redirection — sans le "/" final, aucune
// correspondance, et Supabase retombe silencieusement sur son "Site URL"
// par défaut (resté sur l'ancien domaine). Systématiser le "/" final ici
// corrige tous les appelants d'un coup. On limite aussi aux domaines
// connus : jamais confiance aveugle en Origin/Referer (un onglet resté sur
// un domaine périmé pourrait sinon régénérer le même problème).
const ALLOWED_PUBLIC_ORIGINS = new Set(['https://test.nova360.space', 'https://app.nova360.space', 'https://client.nova360.space']);
// Repli quand la requête n'annonce ni Origin ni Referer reconnaissable.
// Il pointait sur le site de TEST : un collaborateur invité depuis la
// production pouvait donc recevoir un lien vers la recette. Le repli d'un
// lien envoyé à un vrai utilisateur doit être la production (01/09/2026).
const CANONICAL_PUBLIC_ORIGIN = 'https://app.nova360.space';

// Demande explicite : "créer client.nova360.space pour le différencier du
// Test, c'est-à-dire que quand le lien est envoyé, il s'envoie sur cette
// adresse-là" — les liens d'invitation/reconnexion destinés à un CLIENT
// (jamais à un collaborateur) doivent TOUJOURS cibler ce domaine dédié,
// quel que soit le domaine (app/test) depuis lequel le membre de l'équipe
// qui déclenche l'invitation est connecté. Utilisé par api/clients/guest.ts.
export const CLIENT_PUBLIC_ORIGIN = 'https://client.nova360.space/';

export function resolvePublicOrigin(req: { headers: Record<string, string | string[] | undefined> }): string {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (origin && ALLOWED_PUBLIC_ORIGINS.has(origin)) return `${origin}/`;

  const refHeader = req.headers.referer;
  const referer = Array.isArray(refHeader) ? refHeader[0] : refHeader;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (ALLOWED_PUBLIC_ORIGINS.has(refOrigin)) return `${refOrigin}/`;
    } catch {
      // ignore, fall through to default
    }
  }

  return `${CANONICAL_PUBLIC_ORIGIN}/`;
}

/**
 * Ticket "Inviter un stagiaire" (suivi) : "je crée l'invitation mais je ne
 * reçois pas de mail, il faut que ça parte à chaque fois du mail de
 * Sylvain." Appelle l'Edge Function send-system-email (supabase/functions/
 * send-system-email), qui envoie TOUJOURS depuis le Gmail de Sylvain (jeton
 * déjà connecté, auto-renouvelé — ticket #117), quel que soit l'admin qui
 * déclenche l'action. Ne concerne QUE les e-mails "système" (invitation de
 * compte) — les e-mails composés par un utilisateur (Mail, questionnaires…)
 * continuent de partir depuis son propre Gmail connecté, inchangé.
 */
export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-system-email`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) {
      // Signalé : un échec d'envoi (token Google invalidé par Google lui-même
      // — ex. reconfiguration de l'appli OAuth — sans que la date d'expiration
      // stockée ne le reflète) ne laissait dans les logs que le message
      // générique "Échec de l'envoi Gmail", sans jamais le `detail` (la vraie
      // erreur HTTP Gmail) que l'edge function renvoie pourtant déjà — rendait
      // le diagnostic bien plus long qu'il n'aurait dû l'être.
      console.warn('[sendSystemEmail] échec:', body?.error || response.status, body?.detail ? `— détail: ${body.detail}` : '');
      return { ok: false, error: body?.error || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('[sendSystemEmail] exception:', e.message);
    return { ok: false, error: e.message };
  }
}

export function inviteEmailHtml(recipientName: string | null | undefined, actionLink: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#0f172a;">Bienvenue sur Nova CRM${recipientName ? ', ' + recipientName : ''} !</h2>
      <p>Voici votre lien pour accéder à Nova CRM :</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${actionLink}" style="background:#F7BC5F;color:#0f172a;font-weight:bold;padding:12px 28px;border-radius:10px;text-decoration:none;display:inline-block;">Accéder à Nova CRM</a>
      </p>
      <p style="font-size:12px;color:#64748b;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${actionLink}</p>
    </div>`;
}

/** Code HTTP approprié selon le message d'erreur (403 pour les refus
 * d'authentification/autorisation, 500 sinon). */
export function statusForError(message: string): number {
  if (
    message.includes('authentifié') ||
    message.includes('réservée') ||
    message.includes('invalide') ||
    message.includes('refusé') ||
    message.includes('désactivé')
  ) {
    return 403;
  }
  return 500;
}
