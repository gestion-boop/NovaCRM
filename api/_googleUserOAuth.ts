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

// Le nom de la variable qui a fourni la valeur, et les autres noms de la
// même société qui portent une valeur DIFFÉRENTE. Vécu le 3 septembre :
// Google répond « The OAuth client was not found » (invalid_client) pour
// ImmoSphera — l'identifiant envoyé n'existe pas chez Google. Comme
// plusieurs noms sont acceptés pour une même clé, une ancienne valeur
// laissée sous le premier nom prend le pas sur la bonne, posée sous un
// autre : le diagnostic doit montrer laquelle est réellement lue.
const provenance = (cles: string[]): { source: string | null; autresValeurs: string[] } => {
  let source: string | null = null;
  let retenue: string | null = null;
  const autresValeurs: string[] = [];
  for (const cle of cles) {
    const valeur = (process.env[cle] || '').trim();
    if (!valeur) continue;
    if (retenue === null) { source = cle; retenue = valeur; continue; }
    if (valeur !== retenue) autresValeurs.push(cle);
  }
  return { source, autresValeurs };
};

const normaliser = (texte: string): string =>
  texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const ressembleAUnId = (v: string) => v.endsWith('.apps.googleusercontent.com');
const ressembleAUnSecret = (v: string) => v.startsWith('GOCSPX-');

// Les deux valeurs d'une société, remises dans le bon sens si elles ont été
// saisies à l'envers (vécu le 3 septembre : l'ID dans la variable du secret
// et le secret dans celle de l'ID). Une valeur qui n'a la forme ni d'un ID
// ni d'un secret est laissée telle quelle.
const valeursDe = (societe: (typeof SOCIETES)[number]): { clientId: string | null; clientSecret: string | null; inversees: boolean } => {
  const id = premiereValeur(societe.clesId);
  const secret = premiereValeur(societe.clesSecret);
  if (id && secret && ressembleAUnSecret(id) && ressembleAUnId(secret)) {
    return { clientId: secret, clientSecret: id, inversees: true };
  }
  return { clientId: id, clientSecret: secret, inversees: false };
};

const clientDe = (societe: (typeof SOCIETES)[number]): ClientGoogleSociete | null => {
  const { clientId, clientSecret } = valeursDe(societe);
  if (!clientId || !clientSecret) return null;
  return { entite: societe.entite, nom: societe.nom, domaine: societe.domaine, clientId, clientSecret };
};

/**
 * Diagnostic : quelles sociétés ont leurs deux clés dans cet environnement.
 * Uniquement des booléens — jamais une valeur.
 */
export function etatConfiguration(): Record<
  EntiteGoogle,
  {
    presentes: boolean;
    inversees: boolean;
    id: string | null;
    idValide: boolean;
    idRessembleAUnSecret: boolean;
    secretValide: boolean;
    secretLongueur: number;
    idSource: string | null;
    secretSource: string | null;
    autresNomsAvecUneValeurDifferente: string[];
  }
> {
  const etat = {} as ReturnType<typeof etatConfiguration>;
  for (const s of SOCIETES) {
    const { clientId: id, clientSecret: secret, inversees } = valeursDe(s);
    const idValide = !!id && ressembleAUnId(id);
    const provId = provenance(s.clesId);
    const provSecret = provenance(s.clesSecret);
    etat[s.entite] = {
      presentes: !!id && !!secret,
      // `true` : les deux variables étaient à l'envers, remises d'aplomb ici.
      inversees,
      // L'ID client n'est pas un secret : il figure dans l'adresse de chaque
      // écran d'autorisation Google. On l'affiche pour le comparer à celui
      // de la console — mais SEULEMENT s'il a la forme d'un ID : le
      // 3 septembre, un secret collé dans la variable de l'ID s'est retrouvé
      // affiché ici. Une valeur d'une autre forme n'est jamais montrée.
      id: idValide ? id : null,
      idValide,
      idRessembleAUnSecret: !!id && ressembleAUnSecret(id),
      secretValide: !!secret && ressembleAUnSecret(secret),
      secretLongueur: secret ? secret.length : 0,
      // D'où vient chaque valeur, et les autres noms qui en portent une
      // différente (à supprimer : seule la première est lue).
      idSource: provId.source,
      secretSource: provSecret.source,
      autresNomsAvecUneValeurDifferente: [...provId.autresValeurs, ...provSecret.autresValeurs],
    };
  }
  return etat;
}

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
