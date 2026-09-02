import { supabaseAdmin } from './_supabaseAdmin.js';

/**
 * Client OAuth Google « interne » de la société de l'utilisateur.
 *
 * Décidé le 2 septembre : trois Google Workspace distincts (Conseils
 * Finances, Novavisio, ImmoSphera), donc trois applications Google Cloud
 * déclarées « Interne », une par société. Chaque collaborateur autorise
 * Gmail, Drive et Agenda sur l'application de SA société — plus de
 * vérification Google, plus d'écran d'avertissement, plus de jeton qui
 * expire au bout de sept jours.
 *
 * Même correspondance que côté Supabase (supabase/functions/_shared/
 * google-user-oauth-clients.ts), qui renouvelle ensuite ces jetons : les
 * noms de variables sont identiques des deux côtés, y compris l'ancienne
 * orthographe « IMOSPHERA » encore acceptée.
 */

export type EntiteGoogle = 'conseil_finances' | 'novavisio' | 'immosphera';

export interface ClientGoogleSociete {
  entite: EntiteGoogle;
  nom: string;
  domaine: string;
  clientId: string;
  clientSecret: string;
}

const SOCIETES: {
  entite: EntiteGoogle;
  nom: string;
  domaine: string;
  clesId: string[];
  clesSecret: string[];
  motsAgence: string[];
}[] = [
  {
    entite: 'conseil_finances',
    nom: 'Conseils Finances',
    domaine: 'conseilfinances.fr',
    clesId: ['GOOGLE_OAUTH_CLIENT_ID_CONSEIL_FINANCES', 'GOOGLE_CLIENT_ID_CONSEIL_FINANCES'],
    clesSecret: ['GOOGLE_OAUTH_CLIENT_SECRET_CONSEIL_FINANCES', 'GOOGLE_CLIENT_SECRET_CONSEIL_FINANCES'],
    motsAgence: ['conseil', 'finance'],
  },
  {
    entite: 'novavisio',
    nom: 'Novavisio',
    domaine: 'novavisio.fr',
    clesId: ['GOOGLE_OAUTH_CLIENT_ID_NOVAVISIO', 'GOOGLE_CLIENT_ID_NOVAVISIO'],
    clesSecret: ['GOOGLE_OAUTH_CLIENT_SECRET_NOVAVISIO', 'GOOGLE_CLIENT_SECRET_NOVAVISIO'],
    motsAgence: ['novavisio', 'nova visio'],
  },
  {
    entite: 'immosphera',
    nom: 'ImmoSphera',
    domaine: 'immosphera.fr',
    clesId: [
      'GOOGLE_OAUTH_CLIENT_ID_IMMOSPHERA',
      'GOOGLE_OAUTH_CLIENT_ID_IMOSPHERA',
      'GOOGLE_CLIENT_ID_IMMOSPHERA',
      'GOOGLE_CLIENT_ID_IMOSPHERA',
    ],
    clesSecret: [
      'GOOGLE_OAUTH_CLIENT_SECRET_IMMOSPHERA',
      'GOOGLE_OAUTH_CLIENT_SECRET_IMOSPHERA',
      'GOOGLE_CLIENT_SECRET_IMMOSPHERA',
      'GOOGLE_CLIENT_SECRET_IMOSPHERA',
    ],
    motsAgence: ['immosphera', 'imosphera'],
  },
];

// Ce que le CRM demande à Google pour un collaborateur : les mêmes portées
// que la connexion historique (src/lib/workspace.ts), plus l'identité pour
// connaître l'adresse de la boîte réellement connectée.
export const PORTEES_WORKSPACE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const premiereValeur = (cles: string[]): string | null => {
  for (const cle of cles) {
    const valeur = process.env[cle];
    if (valeur && valeur.trim()) return valeur.trim();
  }
  return null;
};

const normaliser = (texte: string): string =>
  texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const clientDe = (societe: (typeof SOCIETES)[number]): ClientGoogleSociete | null => {
  const clientId = premiereValeur(societe.clesId);
  const clientSecret = premiereValeur(societe.clesSecret);
  if (!clientId || !clientSecret) return null;
  return { entite: societe.entite, nom: societe.nom, domaine: societe.domaine, clientId, clientSecret };
};

/** Le client d'une société, s'il est configuré (variables Vercel). */
export function clientPourEntite(entite: string): ClientGoogleSociete | null {
  const societe = SOCIETES.find((s) => s.entite === entite);
  return societe ? clientDe(societe) : null;
}

function societeParDomaine(email: string | null | undefined) {
  const domaine = String(email || '').toLowerCase().split('@').pop() || '';
  if (!domaine) return null;
  return SOCIETES.find((s) => domaine === s.domaine || domaine.endsWith(`.${s.domaine}`)) || null;
}

function societeParNomAgence(nom: string | null | undefined) {
  const n = normaliser(nom || '');
  if (!n) return null;
  return SOCIETES.find((s) => s.motsAgence.some((mot) => n.includes(normaliser(mot)))) || null;
}

/**
 * La société d'un utilisateur, d'abord par le domaine de son adresse (sa
 * vraie boîte), sinon par l'agence à laquelle il est rattaché dans le CRM.
 * `null` si aucune société ne correspond OU si la société trouvée n'a pas
 * encore ses clés : l'appelant retombe alors sur la connexion historique.
 */
export async function clientPourUtilisateur(user: { id: string; email?: string | null }): Promise<{
  societe: { entite: EntiteGoogle; nom: string; domaine: string } | null;
  client: ClientGoogleSociete | null;
}> {
  let societe = societeParDomaine(user.email);

  if (!societe) {
    const { data: membre } = await supabaseAdmin
      .from('agency_members')
      .select('agency_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    const agencyId = (membre as { agency_id?: string } | null)?.agency_id;
    if (agencyId) {
      const { data: agence } = await supabaseAdmin.from('agencies').select('name').eq('id', agencyId).maybeSingle();
      societe = societeParNomAgence((agence as { name?: string } | null)?.name);
    }
  }

  if (!societe) return { societe: null, client: null };
  return {
    societe: { entite: societe.entite, nom: societe.nom, domaine: societe.domaine },
    client: clientDe(societe),
  };
}
