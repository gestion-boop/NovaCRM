import { supabase } from '@/lib/supabase';
import { estDossierReserveConseilsFinances, estAgenceConseilsFinances } from '@/lib/dossiersConseilsFinances';
import { getCachedAccessToken } from '@/lib/workspace';
import { NAV_ITEMS } from '@/components/Sidebar';
import type { Contact } from '@/types';

/**
 * Recherche globale de la barre du haut.
 *
 * Demandé le 3 septembre : « essaye de faire en sorte que ça reprenne le
 * maximum de mots qu'il y a dans le CRM : un prénom remonte une fiche client,
 * mais aussi les rendez-vous, les noms des dossiers… ». La barre ne cherchait
 * que dans le nom des clients. Elle parcourt maintenant : les clients (nom,
 * e-mail, téléphone, société, secteur), les tuiles et dossiers de l'accueil,
 * les modules du menu, les rendez-vous (Google Agenda et table appointments),
 * les rappels, les documents, les projets internes, les notes et l'équipe.
 */

export type TypeResultat =
  | 'client' | 'rdv' | 'rappel' | 'dossier' | 'module' | 'document' | 'projet' | 'note' | 'membre';

export interface Resultat {
  cle: string;
  type: TypeResultat;
  titre: string;
  sousTitre?: string;
  /** Ce que fait un clic : ouvrir une fiche, aller sur un écran, une date… */
  action:
    | { genre: 'client'; contactId: string }
    | { genre: 'nav'; nav: string }
    | { genre: 'dossier-accueil'; dossierId: string }
    | { genre: 'agenda'; date: string }
    | { genre: 'lien'; url: string };
}

export const LIBELLES_TYPES: Record<TypeResultat, string> = {
  client: 'Clients',
  rdv: 'Rendez-vous',
  rappel: 'Rappels',
  dossier: 'Dossiers de l\'accueil',
  module: 'Écrans',
  document: 'Documents',
  projet: 'Projets internes',
  note: 'Notes',
  membre: 'Équipe',
};

export const ORDRE_TYPES: TypeResultat[] = ['client', 'rdv', 'rappel', 'dossier', 'module', 'projet', 'document', 'note', 'membre'];

/** Événements : dispatchés par la barre, écoutés par l'Agenda et l'Accueil. */
export const EVENEMENT_AGENDA_ALLER_A = 'nova:agenda-aller-a';
export const EVENEMENT_OUVRIR_DOSSIER_ACCUEIL = 'nova:ouvrir-dossier-accueil';

/** Demande d'ouverture différée : l'écran visé n'est peut-être pas encore
 *  monté au moment du clic ; il relit la demande à son montage. */
const attentes: { agenda?: string; dossier?: string } = {};
export function demanderAgendaAllerA(date: string) {
  attentes.agenda = date;
  window.dispatchEvent(new CustomEvent(EVENEMENT_AGENDA_ALLER_A, { detail: { date } }));
}
export function consommerAgendaAllerA(): string | undefined {
  const d = attentes.agenda; delete attentes.agenda; return d;
}
export function demanderOuvrirDossierAccueil(dossierId: string) {
  attentes.dossier = dossierId;
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_DOSSIER_ACCUEIL, { detail: { dossierId } }));
}
export function consommerOuvrirDossierAccueil(): string | undefined {
  const d = attentes.dossier; delete attentes.dossier; return d;
}

export const normaliser = (s: string | null | undefined) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** Tous les mots tapés doivent apparaître, dans n'importe quel ordre. */
export const correspond = (texte: string | null | undefined, mots: string[]) => {
  const t = normaliser(texte);
  return mots.every((m) => t.includes(m));
};

const motsDe = (q: string) => normaliser(q).split(/\s+/).filter(Boolean);

const dateCourte = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const jourIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─── Sources locales (instantanées) ─────────────────────────────────────────

export function chercherClients(contacts: Contact[], q: string, max = 8): Resultat[] {
  const mots = motsDe(q);
  if (!mots.length) return [];
  const numero = q.replace(/\D/g, '');
  return contacts
    .filter((c) => {
      const champs = [c.name, c.email, c.companyName, c.secteur, c.coBorrower].join(' ');
      if (correspond(champs, mots)) return true;
      return numero.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(numero);
    })
    .slice(0, max)
    .map((c) => ({
      cle: `client-${c.id}`,
      type: 'client' as const,
      titre: c.name,
      sousTitre: [c.companyName, c.email || c.phone].filter(Boolean).join(' · ') || undefined,
      action: { genre: 'client' as const, contactId: c.id },
    }));
}

interface TuileBrute { id: string; title?: string; navTarget?: string; isFolder?: boolean; externalUrl?: string; children?: TuileBrute[] }

/** Tuiles et dossiers de la grille d'accueil enregistrée pour cette agence. */
export function chercherAccueil(agencyId: string | undefined, q: string, agency?: { name?: string | null; slug?: string | null } | null): Resultat[] {
  const cfSeulement = estAgenceConseilsFinances(agency);
  const mots = motsDe(q);
  if (!mots.length) return [];
  const resultats: Resultat[] = [];
  const vus = new Set<string>();
  try {
    const brut = localStorage.getItem(`novasphere_home_tiles_v3_${agencyId || 'default'}`);
    const grille: TuileBrute[] = brut ? JSON.parse(brut) : [];
    const parcourir = (items: TuileBrute[], dossierParent?: TuileBrute) => {
      for (const t of items) {
        // « Banques » / « Assurances » : Conseils Finances uniquement.
        if (estDossierReserveConseilsFinances(t.title) && !cfSeulement) continue;
        if (t.title && correspond(t.title, mots) && !vus.has(t.id)) {
          vus.add(t.id);
          if (t.isFolder) {
            resultats.push({
              cle: `dossier-${t.id}`, type: 'dossier', titre: t.title,
              sousTitre: `${(t.children || []).length} tuile${(t.children || []).length > 1 ? 's' : ''}`,
              action: { genre: 'dossier-accueil', dossierId: t.id },
            });
          } else if (t.externalUrl) {
            resultats.push({ cle: `tuile-${t.id}`, type: 'module', titre: t.title, sousTitre: dossierParent?.title ? `Dans ${dossierParent.title}` : 'Lien', action: { genre: 'lien', url: t.externalUrl } });
          } else if (t.navTarget) {
            resultats.push({ cle: `tuile-${t.id}`, type: 'module', titre: t.title, sousTitre: dossierParent?.title ? `Dans ${dossierParent.title}` : undefined, action: { genre: 'nav', nav: t.navTarget } });
          }
        }
        if (t.children) parcourir(t.children, t);
      }
    };
    parcourir(Array.isArray(grille) ? grille : []);
  } catch { /* grille illisible : on passe */ }
  // Modules du menu, même sans tuile.
  for (const item of NAV_ITEMS) {
    if (item.id === 'accueil' || vus.has(item.id)) continue;
    if (correspond(item.label, mots)) {
      vus.add(item.id);
      resultats.push({ cle: `module-${item.id}`, type: 'module', titre: item.label, action: { genre: 'nav', nav: item.id } });
    }
  }
  return resultats.slice(0, 8);
}

// ─── Sources distantes (Supabase, Google) ───────────────────────────────────

const motif = (q: string) => `%${q.trim().replace(/[%_]/g, '')}%`;

async function chercherRappels(agencyId: string | undefined, q: string): Promise<Resultat[]> {
  let req = supabase.from('reminders').select('id, title, description, due_at, is_done').ilike('title', motif(q)).order('due_at', { ascending: false }).limit(6);
  if (agencyId && agencyId !== 'all') req = req.eq('agency_id', agencyId);
  const { data } = await req;
  return ((data as any[]) || []).map((r) => ({
    cle: `rappel-${r.id}`, type: 'rappel' as const, titre: r.title,
    sousTitre: `${r.is_done ? 'Fait · ' : ''}${dateCourte(r.due_at)}`,
    action: { genre: 'nav' as const, nav: 'rappels' },
  }));
}

async function chercherRendezVousTable(agencyId: string | undefined, q: string): Promise<Resultat[]> {
  let req = supabase.from('appointments').select('id, title, start_at, location').ilike('title', motif(q)).order('start_at', { ascending: false }).limit(6);
  if (agencyId && agencyId !== 'all') req = req.eq('agency_id', agencyId);
  const { data } = await req;
  return ((data as any[]) || []).map((r) => ({
    cle: `rdv-${r.id}`, type: 'rdv' as const, titre: r.title,
    sousTitre: [dateCourte(r.start_at), r.location].filter(Boolean).join(' · '),
    action: { genre: 'agenda' as const, date: jourIso(new Date(r.start_at)) },
  }));
}

/** Google Agenda : recherche plein texte de l'API (titre, description, lieu, invités). */
async function chercherRendezVousGoogle(q: string): Promise<Resultat[]> {
  const token = getCachedAccessToken();
  if (!token) return [];
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - 6);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${encodeURIComponent(q.trim())}&timeMin=${encodeURIComponent(timeMin.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  const items: any[] = data.items || [];
  return items
    .map((g) => {
      const debut: string | undefined = g.start?.dateTime || g.start?.date;
      if (!debut) return null;
      const d = new Date(debut);
      return {
        cle: `gcal-${g.id}`, type: 'rdv' as const, titre: g.summary || 'Événement',
        sousTitre: [g.start?.dateTime ? dateCourte(debut) : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }), g.location].filter(Boolean).join(' · '),
        action: { genre: 'agenda' as const, date: jourIso(d) },
      };
    })
    .filter((r): r is Resultat => Boolean(r))
    // Les plus proches d'aujourd'hui d'abord.
    .sort((a, b) => Math.abs(new Date((a.action as any).date).getTime() - Date.now()) - Math.abs(new Date((b.action as any).date).getTime() - Date.now()));
}

async function chercherDocuments(agencyId: string | undefined, q: string): Promise<Resultat[]> {
  let req = supabase.from('documents').select('id, file_name, drive_web_view_link, is_folder').ilike('file_name', motif(q)).limit(6);
  if (agencyId && agencyId !== 'all') req = req.eq('agency_id', agencyId);
  const { data } = await req;
  return ((data as any[]) || []).map((d) => ({
    cle: `doc-${d.id}`, type: 'document' as const, titre: d.file_name,
    sousTitre: d.is_folder ? 'Dossier' : undefined,
    action: d.drive_web_view_link ? { genre: 'lien' as const, url: d.drive_web_view_link } : { genre: 'nav' as const, nav: 'documents' },
  }));
}

async function chercherProjets(q: string): Promise<Resultat[]> {
  const [{ data: taches }, { data: tableaux }] = await Promise.all([
    supabase.from('internal_project_tasks' as any).select('id, title').ilike('title', motif(q)).limit(5),
    supabase.from('task_boards').select('id, name').ilike('name', motif(q)).limit(3),
  ]);
  return [
    ...(((tableaux as any[]) || []).map((b) => ({ cle: `board-${b.id}`, type: 'projet' as const, titre: b.name, sousTitre: 'Projet', action: { genre: 'nav' as const, nav: 'projets-internes' } }))),
    ...(((taches as any[]) || []).map((t) => ({ cle: `tache-${t.id}`, type: 'projet' as const, titre: t.title, sousTitre: 'Carte', action: { genre: 'nav' as const, nav: 'projets-internes' } }))),
  ];
}

async function chercherNotes(agencyId: string | undefined, q: string): Promise<Resultat[]> {
  let req = supabase.from('notes').select('id, title, body').or(`title.ilike.${motif(q)},body.ilike.${motif(q)}`).limit(5);
  if (agencyId && agencyId !== 'all') req = req.eq('agency_id', agencyId);
  const { data } = await req;
  return ((data as any[]) || []).map((n) => ({
    cle: `note-${n.id}`, type: 'note' as const, titre: n.title || 'Note sans titre',
    sousTitre: (n.body || '').replace(/<[^>]+>/g, '').slice(0, 60) || undefined,
    action: { genre: 'nav' as const, nav: 'notes' },
  }));
}

async function chercherEquipe(q: string): Promise<Resultat[]> {
  const { data } = await supabase.from('profiles').select('id, full_name, email, job_title').or(`full_name.ilike.${motif(q)},email.ilike.${motif(q)}`).limit(5);
  return ((data as any[]) || []).map((p) => ({
    cle: `membre-${p.id}`, type: 'membre' as const, titre: p.full_name || p.email,
    sousTitre: p.job_title || p.email || undefined,
    action: { genre: 'nav' as const, nav: 'equipe' },
  }));
}

/** Toutes les sources distantes, chacune best-effort : une qui échoue n'empêche pas les autres. */
export async function chercherADistance(agencyId: string | undefined, q: string): Promise<Resultat[]> {
  if (q.trim().length < 2) return [];
  const sources = [
    chercherRendezVousGoogle(q),
    chercherRendezVousTable(agencyId, q),
    chercherRappels(agencyId, q),
    chercherDocuments(agencyId, q),
    chercherProjets(q),
    chercherNotes(agencyId, q),
    chercherEquipe(q),
  ];
  const lots = await Promise.allSettled(sources);
  return lots.flatMap((l) => (l.status === 'fulfilled' ? l.value : []));
}

export function grouper(resultats: Resultat[]): { type: TypeResultat; libelle: string; items: Resultat[] }[] {
  const vus = new Set<string>();
  const parType = new Map<TypeResultat, Resultat[]>();
  for (const r of resultats) {
    if (vus.has(r.cle)) continue;
    vus.add(r.cle);
    if (!parType.has(r.type)) parType.set(r.type, []);
    parType.get(r.type)!.push(r);
  }
  return ORDRE_TYPES.filter((t) => parType.has(t)).map((t) => ({ type: t, libelle: LIBELLES_TYPES[t], items: parType.get(t)! }));
}
