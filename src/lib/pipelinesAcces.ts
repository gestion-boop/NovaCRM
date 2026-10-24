// Accès aux pipelines (demande du 22 octobre) :
// les pipelines de la société restent visibles. Un pipeline personnel n'est
// visible que par son créateur. « Pipelines Transactions » d'Immosphera est
// visible de toute l'agence sauf Sarah. Titres, colonnes et leur ordre :
// Mélanie et Sylvain seulement. Personne ne peut supprimer ce pipeline.

export const IMMOSPHERA_AGENCY_ID = '15157da9-71ea-4760-ae1c-3bc99d9caa20';
export const TRANSACTIONS_PIPELINE_ID = '8f79d05c-d191-43bb-8323-bedbd722f9f2';

export const SYLVAIN_UID = '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29';
export const MELANIE_UID = '15bcec53-de3e-40b8-8b7e-bb6874836f29';
export const SARAH_UID = '3fd7bce8-cdd5-471c-96df-67c10a55d4b6';

const SYLVAIN_EMAIL = 's.grazia@conseilfinances.fr';
const MELANIE_EMAIL = 'gestion@immosphera.fr';
const SARAH_EMAIL = 'combressarah725@gmail.com';

export type UtilisateurPipeline = {
  uid?: string | null;
  email?: string | null;
};

export type PipelinePourAcces = {
  id: string;
  name?: string | null;
  agencyId?: string | null;
  ownerId?: string | null;
  officiel?: boolean;
  verrouille?: boolean;
};

const sansAccent = (valeur: string) =>
  valeur.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const emailDe = (user: UtilisateurPipeline) => (user.email || '').toLowerCase().trim();

/** Le pipeline partagé d'Immosphera, reconnu par son identifiant ou par son nom dans cette agence. */
export function estPipelineTransactions(pipeline: {
  id?: string | null;
  name?: string | null;
  agencyId?: string | null;
}): boolean {
  if (pipeline.id && pipeline.id === TRANSACTIONS_PIPELINE_ID) return true;
  if (!pipeline.agencyId || pipeline.agencyId !== IMMOSPHERA_AGENCY_ID) return false;
  return /\bpipelines?\s+transactions\b/.test(sansAccent(pipeline.name || ''));
}

export function estCommunitySarah(user: UtilisateurPipeline): boolean {
  return user.uid === SARAH_UID || emailDe(user) === SARAH_EMAIL;
}

export function estMelanieOuSylvain(user: UtilisateurPipeline): boolean {
  const email = emailDe(user);
  return user.uid === SYLVAIN_UID || user.uid === MELANIE_UID || email === SYLVAIN_EMAIL || email === MELANIE_EMAIL;
}

/**
 * Menu des pipelines.
 * Les pipelines de la société (sans propriétaire, ou marqués officiels) restent
 * visibles pour tout le monde : les cacher vidait Conseils Finances et Novavisio.
 * Un pipeline créé par quelqu'un n'est visible que par son créateur.
 * Transactions (Immosphera) est visible de l'agence, sauf Sarah.
 */
export function pipelineVisiblePour(pipeline: PipelinePourAcces, user: UtilisateurPipeline): boolean {
  if (!user.uid && !emailDe(user)) return false;
  if (estPipelineTransactions(pipeline)) return !estCommunitySarah(user);
  if (!user.uid) return false;
  if (!pipeline.ownerId || pipeline.officiel) return true;
  return pipeline.ownerId === user.uid;
}

/** Titre du pipeline et titres des colonnes. */
export function peutRenommerPipeline(
  pipeline: PipelinePourAcces | null | undefined,
  user: UtilisateurPipeline,
  estSuperAdmin: boolean
): boolean {
  if (!pipeline) return false;
  if (estPipelineTransactions(pipeline)) return estMelanieOuSylvain(user);
  if (estSuperAdmin) return true;
  if (pipeline.officiel || pipeline.verrouille) return false;
  return !!pipeline.ownerId && pipeline.ownerId === user.uid;
}

/** Suppression : jamais Transactions. Le reste suit la règle déjà en place. */
export function peutSupprimerPipeline(
  pipeline: PipelinePourAcces | null | undefined,
  user: UtilisateurPipeline,
  estSuperAdmin: boolean
): boolean {
  if (!pipeline || estPipelineTransactions(pipeline)) return false;
  if (estSuperAdmin) return true;
  if (pipeline.officiel || pipeline.verrouille) return false;
  return !!pipeline.ownerId && pipeline.ownerId === user.uid;
}

/**
 * Ajouter, supprimer ou réordonner les colonnes.
 * Le glisser des cartes d'une colonne à l'autre n'est pas concerné.
 */
export function peutGererColonnes(
  pipeline: PipelinePourAcces | null | undefined,
  user: UtilisateurPipeline,
  estSuperAdmin: boolean
): boolean {
  if (!pipeline) return false;
  if (estPipelineTransactions(pipeline)) return estMelanieOuSylvain(user);
  return estSuperAdmin;
}
