import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, PlayCircle, Plus, Search, Trash2, X, Loader2, Upload, Link as LinkIcon, Pencil,
  CheckCircle2, Circle, Users, ImagePlus, GraduationCap, LayoutGrid, List as ListIcon,
  MoreVertical, ImageOff, Maximize2, Minimize2, Unlock, ArrowUp, ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { getCachedAccessToken, requestWorkspaceAccessToken } from '@/lib/workspace';

/**
 * Académy — catalogue de procédures (PDF et vidéos) d'une agence.
 *
 * Demandé le 2 septembre : « une tuile Académy ImmoSphera, on regroupera
 * dedans toutes les procédures en PDF et voir vidéos... pour que les agents co
 * se repèrent très facilement », puis, capture d'academie.modelo.fr à l'appui :
 * « est-ce qu'on ne pourrait pas faire une présentation comme ça, que cela ne
 * fasse pas trop intelligence artificielle ? ».
 *
 * Ce qui fait la différence sur cette référence n'est pas la mise en page,
 * c'est qu'on y voit des PHOTOS et des AUTEURS. Une fiche portée par une
 * personne et une image de métier se lit comme une formation ; la même fiche
 * réduite à une icône colorée se lit comme un dossier informatique. D'où :
 *   - une couverture en haut de chaque fiche, sur toute la largeur ;
 *   - un titre en capitales, sombre sur fond clair, comme un catalogue ;
 *   - l'auteur en bas, avec son portrait rond ;
 *   - des filtres en une ligne de texte et une grande barre de recherche
 *     centrée, au lieu de pastilles colorées.
 *
 * Le repérage, lui, reste servi par les rubriques, la recherche, et le type et
 * la durée annoncés avant l'ouverture : personne ne lance une vidéo de vingt
 * minutes entre deux rendez-vous sans le savoir.
 *
 * Les fichiers vivent dans le Google Drive de l'agence (même circuit que le
 * Coffre Documents) ; seules les images de couverture sont stockées par le
 * CRM, dans un compartiment public dédié — une photo doit s'afficher sans
 * négociation, et aucune donnée client ne s'y trouve.
 */

interface Ressource {
  id: string;
  agency_id: string;
  rubrique: string;
  titre: string;
  description: string | null;
  type: 'pdf' | 'video';
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  external_url: string | null;
  duree: string | null;
  image_url: string | null;
  auteur: string | null;
  auteur_photo_url: string | null;
  position: number;
  created_at: string;
}

// Rubriques proposées à la création. Ce ne sont que des suggestions : le champ
// reste libre, une rubrique nouvelle apparaît d'elle-même dans les filtres.
const RUBRIQUES_SUGGEREES = [
  'Prise en main du CRM',
  'Prospection',
  'Mandat & estimation',
  'Vente & compromis',
  'Location',
  'Juridique & conformité',
  'Outils & logiciels',
];

const lienOuvrable = (r: Ressource) => r.external_url || r.drive_web_view_link || '';

/** Transforme un lien de partage en lien affichable dans une fenêtre intégrée. */
function lienIntegrable(url: string): string | null {
  const drive = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  // Un PDF servi en direct s'affiche tel quel dans un cadre : le lecteur du
  // navigateur s'en charge, sans bibliothèque à embarquer.
  if (/\.pdf(\?|#|$)/i.test(url)) return url;
  return null;
}

const initiales = (nom: string) =>
  nom
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((mot) => mot.charAt(0).toUpperCase())
    .join('');

export default function AcademyView() {
  const { activeAgency, currentUser, userProfile } = useAuth();
  const estSuperAdmin = userProfile?.role === 'super_admin';

  const [ressources, setRessources] = useState<Ressource[]>([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  // Demande explicite (15 septembre) : « je veux créer des dossiers avec
  // des sous-dossiers pour ne pas se perdre » — un seul niveau
  // (rubriqueActive: string | null) ne suffit plus. `cheminDossiers` est
  // le fil d'Ariane depuis la racine (ex. ['Vente', 'Mandats']) ; le
  // dossier réellement affiché est toujours son dernier élément.
  const [cheminDossiers, setCheminDossiers] = useState<string[]>([]);
  const dossierActif = cheminDossiers[cheminDossiers.length - 1] ?? null;
  const [ouverte, setOuverte] = useState<Ressource | null>(null);

  // Validation de lecture : chacun coche pour lui. Les super admins voient en
  // plus combien de personnes ont validé chaque procédure.
  const [validees, setValidees] = useState<Set<string>>(new Set());
  const [validationsParRessource, setValidationsParRessource] = useState<Map<string, number>>(new Map());
  const [validationEnCours, setValidationEnCours] = useState<string | null>(null);
  // Demandé le 2 septembre : « voilà ce que je voudrais que tu mettes dans
  // ImmoSphera Académie en fond d'écran, et par-dessus on pourra mettre les
  // dossiers qui sont alignés ». L'image porte le logo et l'identité de la
  // société : elle se règle depuis l'écran, par un super admin, et se range
  // avec les autres réglages d'apparence de l'agence — pas dans le code, sans
  // quoi il faudrait une livraison à chaque changement de visuel.
  // Demandé le 2 septembre : « qu'on puisse mettre le dossier en forme de
  // grille ou en forme de liste ». Le choix est personnel et tient dans le
  // navigateur : il n'a pas à voyager d'un poste à l'autre.
  const [vueDossiers, setVueDossiers] = useState<'grille' | 'liste'>(() => {
    try {
      return localStorage.getItem('nova_academy_vue') === 'liste' ? 'liste' : 'grille';
    } catch {
      return 'grille';
    }
  });
  const choisirVue = (v: 'grille' | 'liste') => {
    setVueDossiers(v);
    try { localStorage.setItem('nova_academy_vue', v); } catch { /* stockage indisponible */ }
  };

  // Image de fond propre à chaque dossier (table academy_folders, liée par le
  // nom de la rubrique). Un dossier sans ligne reste un dossier valide,
  // simplement sans visuel.
  const [visuelsDossiers, setVisuelsDossiers] = useState<Map<string, string>>(new Map());
  // Hiérarchie complète des dossiers (nom + parent_nom), chargée depuis
  // `academy_folders` — un dossier peut désormais exister SANS aucune
  // ressource dedans (un sous-dossier vide reste affiché), contrairement
  // aux anciens dossiers qui n'existaient qu'à travers leurs ressources.
  const [dossiers, setDossiers] = useState<{ nom: string; parent_nom: string | null; position: number }[]>([]);
  // Demande explicite (16 septembre) : ordre manuel des dossiers, et
  // dossier survolé par un AUTRE dossier en train d'être glissé (pour
  // distinguer visuellement « je le range ici » de « je le range comme
  // sous-dossier de celui-ci » — voir onDragOver/onDrop sur chaque
  // dossier plus bas).
  const [dossierSurvoleParDossier, setDossierSurvoleParDossier] = useState<string | null>(null);
  const entrerDossier = (nom: string) => setCheminDossiers((chemin) => [...chemin, nom]);
  const allerAuNiveau = (index: number) => setCheminDossiers((chemin) => chemin.slice(0, index + 1));
  const [dossierEnDepot, setDossierEnDepot] = useState<string | null>(null);
  const [dossierSurvole, setDossierSurvole] = useState<string | null>(null);
  const [deplacementEnCours, setDeplacementEnCours] = useState<string | null>(null);
  const dossierPourVisuel = useRef<string | null>(null);
  const [menuDossier, setMenuDossier] = useState<string | null>(null);
  // Demandé le 2 septembre : « ici, je voudrais rajouter une image de fond au
  // choix » — sur la fiche elle-même, sans passer par le formulaire complet.
  const ressourcePourCouverture = useRef<Ressource | null>(null);
  const champCouvertureRapide = useRef<HTMLInputElement>(null);
  const [couvertureEnCours, setCouvertureEnCours] = useState<string | null>(null);
  const cadreLecteur = useRef<HTMLDivElement>(null);
  const [pleinEcran, setPleinEcran] = useState(false);
  const champVisuelDossier = useRef<HTMLInputElement>(null);

  const [fond, setFond] = useState<string | null>(null);
  const [fondEnCours, setFondEnCours] = useState(false);
  const champFond = useRef<HTMLInputElement>(null);

  // Demande explicite (15 septembre) : « fais en sorte que les fichiers
  // déjà mis soient accessibles à tout le monde en lecture seule ». Les
  // procédures déposées AVANT ce correctif vivent dans le Drive de
  // l'agence, avec le partage par défaut du compte qui les a envoyées —
  // pas forcément "Anyone with the link". Action ponctuelle, réservée aux
  // super admins : ouvre chaque fichier Drive existant en lecture pour
  // n'importe qui possédant le lien (Drive API permissions.create,
  // type=anyone/role=reader), une bonne fois pour toutes — les nouveaux
  // dépôts, eux, ne passent plus du tout par Drive (voir deposerFichier).
  const [reparationEnCours, setReparationEnCours] = useState(false);
  const rendrePublicsLesFichiersExistants = async () => {
    const idsDrive = [...new Set(ressources.map((r) => r.drive_file_id).filter(Boolean))] as string[];
    if (idsDrive.length === 0) {
      toast.success('Aucun fichier Drive à ouvrir : déjà tout dans le nouveau stockage public.');
      return;
    }
    if (!window.confirm(`Rendre les ${idsDrive.length} fichier(s) Drive existant(s) accessibles à tout le monde (lecture seule, sans connexion Google) ?`)) return;
    setReparationEnCours(true);
    try {
      let token = getCachedAccessToken();
      if (!token) token = await requestWorkspaceAccessToken();
      if (!token) throw new Error('Connexion Google nécessaire pour cette réparation ponctuelle.');
      let ok = 0;
      const echecs: string[] = [];
      for (const fileId of idsDrive) {
        try {
          const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'anyone', role: 'reader' }),
            }
          );
          if (res.ok) ok += 1;
          else echecs.push(fileId);
        } catch {
          echecs.push(fileId);
        }
      }
      if (echecs.length === 0) {
        toast.success(`${ok} fichier(s) rendus accessibles à tous, sans connexion Google.`);
      } else {
        toast.error(`${ok} réussi(s), ${echecs.length} échec(s) — probablement des fichiers dont vous n'êtes pas propriétaire sur Drive.`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Impossible de lancer cette réparation.');
    } finally {
      setReparationEnCours(false);
    }
  };

  // Formulaire d'ajout / modification (super admins)
  const [formOuvert, setFormOuvert] = useState(false);
  const [enModification, setEnModification] = useState<Ressource | null>(null);
  const [titre, setTitre] = useState('');
  const [rubrique, setRubrique] = useState(RUBRIQUES_SUGGEREES[0]);
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'pdf' | 'video'>('pdf');
  const [duree, setDuree] = useState('');
  const [lienExterne, setLienExterne] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [auteur, setAuteur] = useState('');
  const [couverture, setCouverture] = useState<File | null>(null);
  const [couvertureActuelle, setCouvertureActuelle] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [portraitActuel, setPortraitActuel] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);
  const champCouverture = useRef<HTMLInputElement>(null);
  const champPortrait = useRef<HTMLInputElement>(null);

  const charger = async () => {
    if (!activeAgency?.id || activeAgency.id === 'all') {
      setRessources([]);
      setChargement(false);
      return;
    }
    setChargement(true);
    const { data, error } = await supabase
      .from('academy_resources' as any)
      .select('*')
      .eq('agency_id', activeAgency.id)
      .order('rubrique', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Académy — chargement :', error);
      toast.error(
        error.message.includes('academy_resources')
          ? "La table de l'Académy n'existe pas encore : la migration 20260902160000 doit être appliquée."
          : error.message
      );
    }
    const liste = ((data as unknown as Ressource[]) || []);
    setRessources(liste);
    setChargement(false);

    // Les validations arrivent séparément : la table est filtrée par la
    // sécurité de la base (chacun les siennes, les super admins toutes), donc
    // le même appel sert aux deux usages sans traitement particulier ici.
    if (liste.length > 0 && currentUser?.uid) {
      const { data: lectures } = await supabase
        .from('academy_reads' as any)
        .select('resource_id, user_id')
        .in('resource_id', liste.map((r) => r.id));
      const miennes = new Set<string>();
      const compte = new Map<string, number>();
      ((lectures as unknown as { resource_id: string; user_id: string }[]) || []).forEach((l) => {
        compte.set(l.resource_id, (compte.get(l.resource_id) || 0) + 1);
        if (l.user_id === currentUser.uid) miennes.add(l.resource_id);
      });
      setValidees(miennes);
      setValidationsParRessource(compte);
    } else {
      setValidees(new Set());
      setValidationsParRessource(new Map());
    }

    const { data: lignesDossiers } = await supabase
      .from('academy_folders' as any)
      .select('nom, image_url, parent_nom, position')
      .eq('agency_id', activeAgency.id);
    const visuels = new Map<string, string>();
    const dossiersCharges = ((lignesDossiers as unknown as { nom: string; image_url: string | null; parent_nom: string | null; position: number | null }[]) || []);
    dossiersCharges.forEach((d) => {
      if (d.image_url) visuels.set(d.nom, d.image_url);
    });
    setVisuelsDossiers(visuels);
    setDossiers(dossiersCharges.map((d) => ({ nom: d.nom, parent_nom: d.parent_nom, position: d.position ?? 0 })));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void charger(); }, [activeAgency?.id, currentUser?.uid]);

  useEffect(() => {
    if (!activeAgency?.id || activeAgency.id === 'all') { setFond(null); return; }
    let vivant = true;
    (async () => {
      const { data } = await supabase
        .from('agency_ui_settings' as any)
        .select('academy_background_url')
        .eq('agency_id', activeAgency.id)
        .maybeSingle();
      if (!vivant) return;
      setFond(((data as { academy_background_url: string | null } | null)?.academy_background_url) || null);
    })();
    return () => { vivant = false; };
  }, [activeAgency?.id]);

  // Signalé le 2 septembre : « quand je clique sur les trois points du
  // dossier, la fenêtre est toujours visible, je suis obligé de faire un hard
  // refresh pour qu'elle disparaisse ». Le menu ne se fermait qu'en
  // re-cliquant sur les trois points ou en choisissant une action : un clic
  // ailleurs ne le concernait pas.
  //
  // L'écoute est posée sur `mousedown`, qui précède le clic de React : on
  // reconnaît donc ce qui appartient au menu par un attribut plutôt que par
  // l'arrêt de propagation, qui arriverait trop tard.
  useEffect(() => {
    if (!menuDossier) return;
    const fermerSiDehors = (e: MouseEvent) => {
      const cible = e.target as Element | null;
      if (cible?.closest('[data-menu-dossier]')) return;
      setMenuDossier(null);
    };
    const fermerSiEchap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuDossier(null);
    };
    document.addEventListener('mousedown', fermerSiDehors);
    document.addEventListener('keydown', fermerSiEchap);
    return () => {
      document.removeEventListener('mousedown', fermerSiDehors);
      document.removeEventListener('keydown', fermerSiEchap);
    };
  }, [menuDossier]);

  // Changer d'écran ou de dossier referme le menu : il n'a plus de sens une
  // fois qu'on a quitté la grille des dossiers.
  useEffect(() => { setMenuDossier(null); }, [dossierActif, vueDossiers, activeAgency?.id]);

  // Plein écran demandé le 2 septembre : « on peut cliquer sur un logo en
  // haut à droite, plein écran — sans partir sur une ouverture avec un onglet
  // différent, ça je ne veux pas ». On utilise donc le plein écran du
  // navigateur sur le cadre du lecteur : on ne quitte ni l'application, ni la
  // page, ni l'onglet.
  useEffect(() => {
    const suivre = () => setPleinEcran(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', suivre);
    return () => document.removeEventListener('fullscreenchange', suivre);
  }, []);

  const basculerPleinEcran = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (cadreLecteur.current) await cadreLecteur.current.requestFullscreen();
    } catch (e) {
      console.warn('Plein écran indisponible', e);
      toast.error("Le plein écran n'est pas disponible sur ce navigateur.");
    }
  };

  const basculerValidation = async (r: Ressource) => {
    if (!currentUser?.uid) return;
    const dejaValidee = validees.has(r.id);
    setValidationEnCours(r.id);
    try {
      if (dejaValidee) {
        const { error } = await supabase
          .from('academy_reads' as any)
          .delete()
          .eq('resource_id', r.id)
          .eq('user_id', currentUser.uid);
        if (error) throw error;
        setValidees((prev) => { const suivant = new Set(prev); suivant.delete(r.id); return suivant; });
        setValidationsParRessource((prev) => {
          const suivant = new Map(prev);
          suivant.set(r.id, Math.max(0, (suivant.get(r.id) || 1) - 1));
          return suivant;
        });
      } else {
        const { error } = await supabase
          .from('academy_reads' as any)
          .insert({ resource_id: r.id, user_id: currentUser.uid } as any);
        if (error) throw error;
        setValidees((prev) => new Set(prev).add(r.id));
        setValidationsParRessource((prev) => {
          const suivant = new Map(prev);
          suivant.set(r.id, (suivant.get(r.id) || 0) + 1);
          return suivant;
        });
        toast.success(`« ${r.titre} » validée.`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(
        String(e?.message || '').includes('academy_reads')
          ? "Le suivi de lecture n'est pas encore en place : la migration 20260902170000 doit être appliquée."
          : e?.message || "Impossible d'enregistrer cette validation."
      );
    } finally {
      setValidationEnCours(null);
    }
  };

  // Comptage par dossier (feuille), tous niveaux confondus — sert au
  // datalist de création de ressource, au repli par défaut, et aux cibles
  // du glisser-déposer (n'importe quel dossier reste une cible valide,
  // quel que soit son niveau d'imbrication). Inclut les dossiers VIDES
  // (sans ressource, désormais possibles grâce à `academy_folders`).
  const rubriques = useMemo(() => {
    const compte = new Map<string, number>();
    dossiers.forEach((d) => compte.set(d.nom, 0));
    ressources.forEach((r) => compte.set(r.rubrique, (compte.get(r.rubrique) || 0) + 1));
    return Array.from(compte.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [ressources, dossiers]);

  // Demande explicite (15 septembre) : sous-dossiers — ne montre que les
  // dossiers ENFANTS du dossier actuellement ouvert (ou les dossiers
  // racine si on est à la racine). Un dossier historique, jamais créé
  // explicitement (juste une rubrique tapée sur une ressource, sans ligne
  // dans `academy_folders`), est traité comme un dossier racine — c'est
  // déjà ce qu'il était avant ce correctif.
  const dossiersEnfants = useMemo(() => {
    const nomsConnus = new Set(dossiers.map((d) => d.nom));
    const positions = new Map<string, number>();
    const enfantsDirects = new Set<string>();
    dossiers.filter((d) => d.parent_nom === dossierActif).forEach((d) => {
      enfantsDirects.add(d.nom);
      positions.set(d.nom, d.position);
    });
    if (dossierActif === null) {
      // Rubriques orphelines (sans ligne academy_folders) : toujours à la
      // racine, jamais sous un sous-dossier.
      ressources.forEach((r) => {
        if (!nomsConnus.has(r.rubrique)) enfantsDirects.add(r.rubrique);
      });
    }
    // Demande explicite (14 septembre) : « quand les dossiers sont dedans
    // le compteur dans le dossier reste à zéro » — le compteur affiché sur
    // un dossier doit inclure les procédures de TOUS ses descendants (pas
    // seulement celles directement rangées dedans), sinon un dossier qui ne
    // contient que des sous-dossiers affiche toujours 0.
    // Fonction locale (plutôt que estSoiMemeOuDescendant, définie plus bas
    // dans le composant) : useMemo exécute ce calcul dès le premier rendu,
    // avant que ce const-là n'existe encore (TDZ).
    const estDescendantDe = (nomCandidat: string, nomAncetre: string): boolean => {
      if (nomCandidat === nomAncetre) return true;
      return dossiers
        .filter((d) => d.parent_nom === nomAncetre)
        .some((d) => estDescendantDe(nomCandidat, d.nom));
    };
    const compte = new Map<string, number>();
    enfantsDirects.forEach((nom) => compte.set(nom, 0));
    ressources.forEach((r) => {
      for (const nom of enfantsDirects) {
        if (estDescendantDe(r.rubrique, nom)) {
          compte.set(nom, (compte.get(nom) || 0) + 1);
        }
      }
    });
    // Demande explicite (16 septembre) : « les mettre dans l'ordre que je
    // veux » — tri par `position` (ordre manuel, voir deplacerDossierApres
    // plus bas), l'alphabétique ne servant plus qu'à départager une égalité
    // (ex. tous à 0 avant le premier rangement manuel).
    return Array.from(compte.entries())
      .map(([nom, nombre]) => ({ nom, nombre, position: positions.get(nom) ?? 0 }))
      .sort((a, b) => a.position - b.position || a.nom.localeCompare(b.nom, 'fr'));
  }, [ressources, dossiers, dossierActif]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return ressources.filter((r) => {
      if (dossierActif && r.rubrique !== dossierActif) return false;
      if (!q) return true;
      return (
        r.titre.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.auteur || '').toLowerCase().includes(q) ||
        r.rubrique.toLowerCase().includes(q)
      );
    });
  }, [ressources, recherche, dossierActif]);

  const reinitialiserFormulaire = () => {
    setEnModification(null);
    setTitre('');
    // Pré-rempli sur le dossier actuellement ouvert, s'il y en a un — on
    // ajoute presque toujours une procédure DEPUIS le dossier où on veut la
    // ranger, pas en pigeant une rubrique au hasard dans la liste.
    setRubrique(dossierActif || rubriques[0]?.[0] || RUBRIQUES_SUGGEREES[0]);
    setDescription('');
    setType('pdf');
    setDuree('');
    setLienExterne('');
    setFichier(null);
    setAuteur('');
    setCouverture(null);
    setCouvertureActuelle(null);
    setPortrait(null);
    setPortraitActuel(null);
  };

  const ouvrirAjout = () => {
    reinitialiserFormulaire();
    setFormOuvert(true);
  };

  const ouvrirModification = (r: Ressource) => {
    setEnModification(r);
    setTitre(r.titre);
    setRubrique(r.rubrique);
    setDescription(r.description || '');
    setType(r.type);
    setDuree(r.duree || '');
    setLienExterne(r.external_url || '');
    setFichier(null);
    setAuteur(r.auteur || '');
    setCouverture(null);
    setCouvertureActuelle(r.image_url);
    setPortrait(null);
    setPortraitActuel(r.auteur_photo_url);
    setFormOuvert(true);
  };

  /** Dépose une image dans le compartiment public de l'Académy. */
  const deposerImage = async (image: File, prefixe: string): Promise<string> => {
    const extension = (image.name.split('.').pop() || 'jpg').toLowerCase();
    const chemin = `${activeAgency?.id}/${prefixe}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage
      .from('academy')
      .upload(chemin, image, { contentType: image.type || 'image/jpeg', upsert: true });
    if (error) {
      throw new Error(
        error.message.toLowerCase().includes('bucket')
          ? "Le stockage des visuels n'existe pas encore : la migration 20260902180000 doit être appliquée."
          : error.message
      );
    }
    return supabase.storage.from('academy').getPublicUrl(chemin).data.publicUrl;
  };

  /**
   * Dépose un PDF (ou une vidéo) dans le MÊME compartiment public que les
   * visuels de l'Académy — plus besoin du Drive de l'agence.
   *
   * Demande explicite (15 septembre) : « je voudrais simplement mettre des
   * fichiers PDF à l'intérieur sans qu'il y ait une connexion particulière à
   * Google, pour éviter la friction avec les personnes qui veulent se
   * connecter dessus ». Jusqu'ici, `enregistrer` exigeait un token
   * `requestWorkspaceAccessToken()` avant même de pouvoir déposer un fichier
   * — la MOINDRE friction Google (token expiré, jamais connecté) bloquait
   * l'ajout d'une simple procédure PDF, sans rapport avec Google Workspace.
   * Le compartiment `academy` est déjà public en lecture (voir deposerImage
   * ci-dessus) : un PDF y est donc directement consultable par tous, sans
   * la moindre connexion.
   */
  const deposerFichier = async (fichier: File, prefixe: string): Promise<string> => {
    // Signalé (15 septembre, erreur 400 au dépôt d'un PDF) : le vrai motif
    // Supabase (taille dépassée, type refusé...) était masqué derrière un
    // message générique. Vérification de taille faite ICI, avant l'envoi,
    // avec un message exploitable — 200 Mo est la limite posée sur ce
    // compartiment (voir la policy de stockage), donc inutile de tenter
    // l'envoi d'un fichier plus gros pour se le faire dire par le serveur.
    const LIMITE_OCTETS = 200 * 1024 * 1024;
    if (fichier.size > LIMITE_OCTETS) {
      throw new Error(`Ce fichier fait ${Math.round(fichier.size / 1024 / 1024)} Mo : la limite est de 200 Mo.`);
    }
    const extension = (fichier.name.split('.').pop() || 'pdf').toLowerCase();
    const chemin = `${activeAgency?.id}/fichiers/${prefixe}.${extension}`;
    const { error } = await supabase.storage
      .from('academy')
      .upload(chemin, fichier, { contentType: fichier.type || 'application/octet-stream', upsert: true });
    if (error) {
      throw new Error(
        error.message.toLowerCase().includes('bucket')
          ? "Le stockage des visuels n'existe pas encore : la migration 20260902180000 doit être appliquée."
          : `Le dépôt du fichier a échoué : ${error.message}`
      );
    }
    return supabase.storage.from('academy').getPublicUrl(chemin).data.publicUrl;
  };

  const changerFond = async (image: File) => {
    if (!activeAgency?.id || activeAgency.id === 'all') return;
    setFondEnCours(true);
    try {
      const url = await deposerImage(image, 'fond');
      const { error } = await supabase
        .from('agency_ui_settings' as any)
        .upsert({ agency_id: activeAgency.id, academy_background_url: url } as any, { onConflict: 'agency_id' });
      if (error) {
        throw new Error(
          error.message.includes('academy_background_url')
            ? "La colonne de l'image de fond n'existe pas encore : la migration 20260902190000 doit être appliquée."
            : error.message
        );
      }
      setFond(url);
      toast.success("Image de fond mise à jour pour toute l'agence.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer cette image de fond.");
    } finally {
      setFondEnCours(false);
    }
  };

  /** Pose ou remplace l'image de fond d'un dossier. */
  const changerVisuelDossier = async (nomDossier: string, image: File) => {
    if (!activeAgency?.id || activeAgency.id === 'all') return;
    setDossierEnDepot(nomDossier);
    try {
      const url = await deposerImage(image, `dossier-${nomDossier.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
      const { error } = await supabase
        .from('academy_folders' as any)
        .upsert(
          { agency_id: activeAgency.id, nom: nomDossier, image_url: url, updated_at: new Date().toISOString() } as any,
          { onConflict: 'agency_id,nom' }
        );
      if (error) {
        throw new Error(
          error.message.includes('academy_folders')
            ? "Les dossiers n'ont pas encore leur table : la migration 20260902200000 doit être appliquée."
            : error.message
        );
      }
      setVisuelsDossiers((prev) => new Map(prev).set(nomDossier, url));
      toast.success(`Image posée sur « ${nomDossier} ».`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer cette image.");
    } finally {
      setDossierEnDepot(null);
    }
  };

  /**
   * Déplace une procédure d'un dossier à l'autre.
   *
   * Demandé le 2 septembre : « déplacer les formations des autres dossiers
   * dans les autres dossiers, de façon à ce que si on s'est trompé on puisse
   * avoir une solution de repli ». Le déplacement est donc toujours
   * réversible : il ne fait que changer la rubrique, rien n'est copié ni
   * supprimé, et le chemin inverse est le même geste.
   */
  const deplacerVers = async (ressource: Ressource, nomDossier: string) => {
    if (ressource.rubrique === nomDossier) return;
    setDeplacementEnCours(ressource.id);
    const precedent = ressource.rubrique;
    try {
      const { data, error } = await supabase
        .from('academy_resources' as any)
        .update({ rubrique: nomDossier, updated_at: new Date().toISOString() } as any)
        .eq('id', ressource.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Déplacement refusé par la base : action réservée aux super admins.');
      }
      setRessources((prev) =>
        prev.map((r) => (r.id === ressource.id ? { ...r, rubrique: nomDossier } : r))
      );
      toast.success(`« ${ressource.titre} » déplacée vers « ${nomDossier} ». Elle était dans « ${precedent} ».`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Impossible de déplacer cette procédure.');
    } finally {
      setDeplacementEnCours(null);
    }
  };

  /** Pose ou remplace la couverture d'une procédure, depuis sa fiche. */
  const changerCouvertureRapide = async (ressource: Ressource, image: File) => {
    setCouvertureEnCours(ressource.id);
    try {
      const url = await deposerImage(image, `couverture-${ressource.id}`);
      const { data, error } = await supabase
        .from('academy_resources' as any)
        .update({ image_url: url, updated_at: new Date().toISOString() } as any)
        .eq('id', ressource.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Modification refusée par la base : action réservée aux super admins.');
      }
      setRessources((prev) => prev.map((r) => (r.id === ressource.id ? { ...r, image_url: url } : r)));
      toast.success(`Image posée sur « ${ressource.titre} ».`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer cette image.");
    } finally {
      setCouvertureEnCours(null);
    }
  };

  const retirerVisuelDossier = async (nomDossier: string) => {
    if (!activeAgency?.id) return;
    const { error } = await supabase
      .from('academy_folders' as any)
      .update({ image_url: null, updated_at: new Date().toISOString() } as any)
      .eq('agency_id', activeAgency.id)
      .eq('nom', nomDossier);
    if (error) { toast.error(error.message); return; }
    setVisuelsDossiers((prev) => { const suivant = new Map(prev); suivant.delete(nomDossier); return suivant; });
    toast.success(`Image retirée de « ${nomDossier} ».`);
  };

  /** Un dossier est-il lui-même ou un descendant de `nomAncetre` ? Sert à
   *  refuser un glisser-déposer qui créerait un cycle (déposer un dossier
   *  DANS l'un de ses propres sous-dossiers). */
  const estSoiMemeOuDescendant = (nomCandidat: string, nomAncetre: string): boolean => {
    if (nomCandidat === nomAncetre) return true;
    const enfants = dossiers.filter((d) => d.parent_nom === nomAncetre).map((d) => d.nom);
    return enfants.some((enfant) => estSoiMemeOuDescendant(nomCandidat, enfant));
  };

  /**
   * Glisser-déposer un dossier SUR un autre pour qu'il en devienne le
   * sous-dossier — demande explicite (16 septembre) : « en tant que admin
   * je puisse faire un drag and drop dans les dossiers pour que les sous
   * dossiers se mettent ».
   */
  const deplacerDossierVersParent = async (nomSource: string, nomCibleParent: string) => {
    if (nomSource === nomCibleParent) return;
    if (estSoiMemeOuDescendant(nomCibleParent, nomSource)) {
      toast.error('Impossible de déposer un dossier dans lui-même ou dans un de ses propres sous-dossiers.');
      return;
    }
    try {
      // Upsert plutôt qu'update : `nomSource` peut être un dossier « orphelin »
      // (une rubrique qui n'a jamais eu sa propre ligne dans academy_folders,
      // seulement portée par des ressources) — un update sur une ligne
      // inexistante réussit silencieusement (0 ligne affectée, pas d'erreur),
      // d'où le bug rapporté (« le message dit que c'est fait, mais le
      // dossier ne se met pas dedans ») : le toast de succès mentait.
      const existant = dossiers.find((d) => d.nom === nomSource);
      const position = existant?.position ?? 1 + Math.max(0, ...dossiers.filter((d) => d.parent_nom === nomCibleParent).map((d) => d.position));
      const { error } = await supabase
        .from('academy_folders' as any)
        .upsert(
          {
            agency_id: activeAgency!.id,
            nom: nomSource,
            parent_nom: nomCibleParent,
            position,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'agency_id,nom' }
        );
      if (error) throw error;
      setDossiers((prev) =>
        existant
          ? prev.map((d) => (d.nom === nomSource ? { ...d, parent_nom: nomCibleParent } : d))
          : [...prev, { nom: nomSource, parent_nom: nomCibleParent, position }]
      );
      toast.success(`« ${nomSource} » est maintenant un sous-dossier de « ${nomCibleParent} ».`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Impossible de déplacer ce dossier.');
    }
  };

  /**
   * Réordonne les dossiers de MÊME parent — demande explicite (16
   * septembre) : « dans les sous dossiers, je veux pouvoir aussi les
   * mettre dans l'ordre que je veux ». Échange simplement la `position`
   * du dossier avec celle de son voisin immédiat (précédent ou suivant
   * dans l'ordre affiché) — pas besoin de renuméroter toute la fratrie.
   */
  const deplacerDossier = async (nom: string, direction: 'monter' | 'descendre') => {
    const fratrie = dossiersEnfants;
    const index = fratrie.findIndex((d) => d.nom === nom);
    const indexVoisin = direction === 'monter' ? index - 1 : index + 1;
    if (index === -1 || indexVoisin < 0 || indexVoisin >= fratrie.length) return;
    const courant = fratrie[index];
    const voisin = fratrie[indexVoisin];
    setDossiers((prev) => {
      // upsert local : courant/voisin peuvent être des dossiers orphelins
      // pas encore présents dans `dossiers` (jamais eu de ligne dédiée).
      const parNom = new Map(prev.map((d) => [d.nom, d]));
      parNom.set(courant.nom, { ...(parNom.get(courant.nom) ?? { nom: courant.nom, parent_nom: dossierActif }), position: voisin.position });
      parNom.set(voisin.nom, { ...(parNom.get(voisin.nom) ?? { nom: voisin.nom, parent_nom: dossierActif }), position: courant.position });
      return Array.from(parNom.values());
    });
    try {
      // Upsert (même raison que deplacerDossierVersParent) : courant/voisin
      // peuvent être des dossiers orphelins sans ligne academy_folders.
      const { error: err1 } = await supabase
        .from('academy_folders' as any)
        .upsert(
          {
            agency_id: activeAgency!.id,
            nom: courant.nom,
            parent_nom: dossierActif,
            position: voisin.position,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'agency_id,nom' }
        );
      const { error: err2 } = await supabase
        .from('academy_folders' as any)
        .upsert(
          {
            agency_id: activeAgency!.id,
            nom: voisin.nom,
            parent_nom: dossierActif,
            position: courant.position,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'agency_id,nom' }
        );
      if (err1 || err2) throw err1 || err2;
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer ce nouvel ordre.");
      await charger();
    }
  };

  /**
   * Crée un sous-dossier VIDE sous `parentNom` — demande explicite (15
   * septembre) : « des dossiers avec des sous-dossiers pour ne pas se
   * perdre ». Contrairement aux dossiers historiques (qui n'existaient
   * qu'à travers une ressource déjà déposée dedans), un sous-dossier créé
   * ici vit tout seul dans `academy_folders`, avec ou sans procédure —
   * indispensable pour organiser à l'avance avant d'y ranger quoi que ce
   * soit.
   */
  const creerSousDossier = async (parentNom: string | null) => {
    const nom = window.prompt(
      parentNom ? `Nom du sous-dossier, dans « ${parentNom} » :` : 'Nom du nouveau dossier :'
    )?.trim();
    if (!nom) return;
    if (rubriques.some(([n]) => n === nom)) {
      toast.error(`Un dossier « ${nom} » existe déjà (les noms de dossiers sont uniques, quel que soit leur niveau).`);
      return;
    }
    // Nouveau dossier toujours en dernière position parmi ses futurs
    // frères et sœurs, plutôt qu'à 0 (qui le mettrait en tête, au hasard
    // de l'ordre alphabétique parmi ceux jamais réordonnés manuellement).
    const positionInitiale =
      1 + Math.max(0, ...dossiers.filter((d) => d.parent_nom === parentNom).map((d) => d.position));
    try {
      const { error } = await supabase
        .from('academy_folders' as any)
        .insert({ agency_id: activeAgency!.id, nom, parent_nom: parentNom, position: positionInitiale } as any);
      if (error) throw error;
      setDossiers((prev) => [...prev, { nom, parent_nom: parentNom, position: positionInitiale }]);
      if (parentNom) entrerDossier(nom);
      toast.success(parentNom ? `Sous-dossier « ${nom} » créé dans « ${parentNom} ».` : `Dossier « ${nom} » créé.`);
    } catch (e: any) {
      console.error(e);
      toast.error(
        String(e?.message || '').includes('parent_nom')
          ? "Les sous-dossiers ne sont pas encore en place : la migration 20260915120000 doit être appliquée."
          : e?.message || 'Impossible de créer ce sous-dossier.'
      );
    }
  };

  /**
   * Renomme un dossier.
   *
   * Le dossier n'est qu'un NOM porté par ses procédures : le renommer, c'est
   * renommer la rubrique de chacune — et la ligne qui porte son image. Les
   * deux vont ensemble, sans quoi le dossier perdrait son visuel en changeant
   * de nom.
   */
  const renommerDossier = async (ancien: string) => {
    const nouveau = window.prompt(`Nouveau nom pour le dossier « ${ancien} » :`, ancien)?.trim();
    if (!nouveau || nouveau === ancien) return;
    if (rubriques.some(([n]) => n === nouveau)) {
      toast.error(`Un dossier « ${nouveau} » existe déjà. Déplacez plutôt les procédures dedans.`);
      return;
    }
    try {
      const { error } = await supabase
        .from('academy_resources' as any)
        .update({ rubrique: nouveau, updated_at: new Date().toISOString() } as any)
        .eq('agency_id', activeAgency!.id)
        .eq('rubrique', ancien);
      if (error) throw error;
      // Upsert (même raison qu'ailleurs) : un dossier orphelin n'a pas de
      // ligne à renommer via UPDATE (0 ligne affectée, pas d'erreur) — il
      // faut créer sa ligne directement sous le nouveau nom.
      const existant = dossiers.find((d) => d.nom === ancien);
      if (existant) {
        await supabase
          .from('academy_folders' as any)
          .update({ nom: nouveau, updated_at: new Date().toISOString() } as any)
          .eq('agency_id', activeAgency!.id)
          .eq('nom', ancien);
      } else {
        await supabase
          .from('academy_folders' as any)
          .upsert(
            { agency_id: activeAgency!.id, nom: nouveau, parent_nom: null, position: 0, updated_at: new Date().toISOString() } as any,
            { onConflict: 'agency_id,nom' }
          );
      }
      setRessources((prev) => prev.map((r) => (r.rubrique === ancien ? { ...r, rubrique: nouveau } : r)));
      setVisuelsDossiers((prev) => {
        const suivant = new Map(prev);
        const image = suivant.get(ancien);
        suivant.delete(ancien);
        if (image) suivant.set(nouveau, image);
        return suivant;
      });
      // La base met déjà à jour le `parent_nom` des sous-dossiers (ON
      // UPDATE CASCADE) — on répercute la même chose ici pour ne pas
      // attendre un rechargement complet avant de les revoir sous le
      // dossier renommé.
      setDossiers((prev) =>
        existant
          ? prev.map((d) =>
              d.nom === ancien
                ? { ...d, nom: nouveau }
                : d.parent_nom === ancien
                  ? { ...d, parent_nom: nouveau }
                  : d
            )
          : [...prev, { nom: nouveau, parent_nom: null, position: 0 }]
      );
      setCheminDossiers((chemin) => chemin.map((n) => (n === ancien ? nouveau : n)));
      toast.success(`Dossier renommé « ${nouveau} ».`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Impossible de renommer ce dossier.');
    }
  };

  /**
   * Supprime un dossier SANS supprimer son contenu : les procédures rejoignent
   * « Général ». Effacer d'un clic plusieurs formations qu'on a mis du temps à
   * écrire serait une bien mauvaise surprise ; elles restent donc, ailleurs.
   */
  const supprimerDossier = async (nomDossier: string, nombre: number) => {
    const sousDossiers = dossiers.filter((d) => d.parent_nom === nomDossier).length;
    const phraseProcedures =
      nombre > 0
        ? `Ses ${nombre} procédure${nombre > 1 ? 's' : ''} ne ${nombre > 1 ? 'seront' : 'sera'} pas supprimée${nombre > 1 ? 's' : ''} : elle${nombre > 1 ? 's' : ''} rejoin${nombre > 1 ? 'dront' : 'dra'} le dossier « Général ».`
        : '';
    const phraseSousDossiers =
      sousDossiers > 0
        ? ` ${sousDossiers > 1 ? 'Ses' : 'Son'} ${sousDossiers} sous-dossier${sousDossiers > 1 ? 's' : ''} ne ${sousDossiers > 1 ? 'seront' : 'sera'} pas supprimé${sousDossiers > 1 ? 's' : ''} non plus : ${sousDossiers > 1 ? 'ils remonteront' : 'il remontera'} à la racine.`
        : '';
    const message =
      nombre === 0 && sousDossiers === 0
        ? `Supprimer le dossier vide « ${nomDossier} » ?`
        : `Supprimer le dossier « ${nomDossier} » ?\n\n${phraseProcedures}${phraseSousDossiers}`;
    if (!window.confirm(message)) return;
    try {
      if (nombre > 0) {
        const { error } = await supabase
          .from('academy_resources' as any)
          .update({ rubrique: 'Général', updated_at: new Date().toISOString() } as any)
          .eq('agency_id', activeAgency!.id)
          .eq('rubrique', nomDossier);
        if (error) throw error;
      }
      await supabase
        .from('academy_folders' as any)
        .delete()
        .eq('agency_id', activeAgency!.id)
        .eq('nom', nomDossier);
      setRessources((prev) => prev.map((r) => (r.rubrique === nomDossier ? { ...r, rubrique: 'Général' } : r)));
      setVisuelsDossiers((prev) => { const suivant = new Map(prev); suivant.delete(nomDossier); return suivant; });
      // Non destructif comme pour les ressources : les SOUS-dossiers du
      // dossier supprimé remontent à la racine (la base le fait déjà via
      // ON DELETE SET NULL), au lieu de disparaître avec lui.
      setDossiers((prev) =>
        prev
          .filter((d) => d.nom !== nomDossier)
          .map((d) => (d.parent_nom === nomDossier ? { ...d, parent_nom: null } : d))
      );
      // Si le dossier supprimé était dans le chemin courant, on remonte
      // juste avant lui plutôt que de tout réinitialiser à la racine.
      setCheminDossiers((chemin) => {
        const position = chemin.indexOf(nomDossier);
        return position === -1 ? chemin : chemin.slice(0, position);
      });
      toast.success(
        nombre > 0
          ? `Dossier supprimé. ${nombre} procédure${nombre > 1 ? 's' : ''} déplacée${nombre > 1 ? 's' : ''} vers « Général ».`
          : 'Dossier supprimé.'
      );
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Impossible de supprimer ce dossier.');
    }
  };

  const enregistrer = async () => {
    if (!currentUser || !activeAgency?.id || activeAgency.id === 'all') {
      toast.error("Sélectionnez une société avant d'ajouter une ressource.");
      return;
    }
    if (!titre.trim()) {
      toast.error('Donnez un titre à cette ressource.');
      return;
    }
    if (!enModification && !fichier && !lienExterne.trim()) {
      toast.error('Déposez un fichier ou collez un lien.');
      return;
    }

    setEnregistrement(true);
    try {
      // Demande explicite (15 septembre) : plus de dépôt dans le Drive de
      // l'agence (qui exigeait une connexion Google pour CHAQUE ajout) — le
      // fichier part directement dans le compartiment public `academy`
      // (voir deposerFichier ci-dessus), accessible à tous en lecture seule
      // sans la moindre connexion. drive_file_id/drive_web_view_link ne sont
      // plus renseignés pour un nouvel envoi (conservés tels quels si on
      // modifie une ressource sans déposer de nouveau fichier).
      const lienUploade = fichier ? await deposerFichier(fichier, `fichier-${Date.now()}`) : null;

      const imageUrl = couverture ? await deposerImage(couverture, 'couverture') : couvertureActuelle;
      const portraitUrl = portrait ? await deposerImage(portrait, 'portrait') : portraitActuel;

      const valeurs = {
        agency_id: activeAgency.id,
        rubrique: rubrique.trim() || 'Général',
        titre: titre.trim(),
        description: description.trim() || null,
        type,
        drive_file_id: fichier ? null : (enModification?.drive_file_id ?? null),
        drive_web_view_link: fichier ? null : (enModification?.drive_web_view_link ?? null),
        external_url: lienUploade || lienExterne.trim() || null,
        duree: duree.trim() || null,
        image_url: imageUrl,
        auteur: auteur.trim() || null,
        auteur_photo_url: portraitUrl,
        updated_at: new Date().toISOString(),
      };

      if (enModification) {
        const { error } = await supabase
          .from('academy_resources' as any)
          .update(valeurs as any)
          .eq('id', enModification.id);
        if (error) throw error;
        toast.success('Ressource mise à jour.');
      } else {
        const { error } = await supabase
          .from('academy_resources' as any)
          .insert({ ...valeurs, created_by: currentUser.uid, position: ressources.length } as any);
        if (error) throw error;
        toast.success("Ressource ajoutée à l'Académy.");
      }

      setFormOuvert(false);
      reinitialiserFormulaire();
      await charger();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer cette ressource.");
    } finally {
      setEnregistrement(false);
    }
  };

  const supprimer = async (r: Ressource) => {
    if (!window.confirm(`Supprimer « ${r.titre} » de l'Académy ? Le fichier reste disponible via son lien direct.`)) return;
    const { data, error } = await supabase
      .from('academy_resources' as any)
      .delete()
      .eq('id', r.id)
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error('Suppression refusée par la base : action réservée aux super admins.');
      return;
    }
    toast.success('Ressource retirée.');
    await charger();
  };

  const ouvrirRessource = (r: Ressource) => {
    const url = lienOuvrable(r);
    if (!url) { toast.error('Aucun fichier ni lien sur cette ressource.'); return; }
    // Vidéo comme PDF : on reste dans l'application. Le passage par un onglet
    // n'a lieu que si le lien ne peut pas s'afficher dans un cadre.
    if (lienIntegrable(url)) setOuverte(r);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (activeAgency?.id === 'all') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center px-6">
        <GraduationCap className="h-8 w-8 text-slate-500" />
        <p className="text-sm text-slate-400">Sélectionnez une société pour ouvrir son Académy.</p>
      </div>
    );
  }

  // Dossiers avec sous-dossiers, comme demandé (15 septembre) : « pour ne
  // pas se perdre ». La recherche, elle, court-circuite toujours les
  // dossiers : qui sait ce qu'il cherche ne veut pas ouvrir trois classeurs.
  const enRecherche = recherche.trim().length > 0;
  // À la racine : QUE la grille des dossiers (comme avant ce correctif).
  const auNiveauDossiers = dossierActif === null && !enRecherche;
  // Dans un dossier (peu importe sa profondeur) : ses éventuels
  // sous-dossiers d'abord, puis ses propres procédures juste en dessous —
  // les deux dans le même écran, sans écran intermédiaire supplémentaire.
  const dansUnDossier = dossierActif !== null && !enRecherche;

  return (
    <div
      className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 min-h-[calc(100vh-4rem)]"
      style={{
        backgroundColor: '#F7F1E5',
        backgroundImage: fond ? `url(${fond})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'top center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'local',
      }}
    >
      {/* Signalé le 2 septembre, capture à l'appui : la barre passait encore
          sur « ACADEMY ». L'image est affichée en `cover` et ancrée en haut :
          sa hauteur à l'écran suit donc la LARGEUR de la fenêtre, et un
          espacement en pixels fixes ne peut pas suivre. L'espacement est
          exprimé en pourcentage de la largeur (17vw), borné pour rester
          raisonnable sur un très petit et un très grand écran. */}
      <div
        className="px-4 sm:px-6 lg:px-8 pb-16"
        style={{ paddingTop: fond ? 'clamp(140px, 17vw, 380px)' : '2.5rem' }}
      >
        <div className="max-w-6xl mx-auto">
          {/* Sans image de fond, l'écran a besoin de son titre. Avec, l'image
              le porte déjà — le répéter ferait double emploi. */}
          {!fond && (
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                Académy {activeAgency?.name}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Toutes les procédures de l'agence, en documents et en vidéo.
              </p>
            </div>
          )}

          {/* Recherche et actions calées à DROITE : à gauche, l'image de fond
              porte le logo et le titre « IMMOSPHERA ACADEMY » — une barre
              centrée passait dessus et le rendait illisible. */}
          <div className="flex flex-wrap items-center gap-2.5 justify-end">
            <div className="relative w-full sm:w-auto sm:min-w-[260px] sm:max-w-sm">
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher une procédure…"
                // Style en ligne : une règle globale impose un fond sombre à
                // TOUT champ de saisie de l'application (voir index.css, « 8.
                // Champs de formulaire »). Sur ce seul écran, clair, il faut
                // passer devant elle.
                style={{ backgroundColor: '#ffffff', color: '#1f2937', borderColor: 'rgba(0,0,0,0.12)' }}
                className="w-full pl-5 pr-11 py-2.5 rounded-full placeholder-slate-400 text-sm shadow-md border focus:outline-none focus:ring-2 focus:ring-[#E0A21A]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Grille ou liste */}
            <div className="flex items-center rounded-full bg-white/90 border border-black/10 p-0.5 shadow-md">
              <button
                onClick={() => choisirVue('grille')}
                title="Afficher les dossiers en grille"
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  vueDossiers === 'grille' ? 'bg-[#E0A21A] text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => choisirVue('liste')}
                title="Afficher les dossiers en liste"
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  vueDossiers === 'liste' ? 'bg-[#E0A21A] text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <ListIcon className="w-4 h-4" />
              </button>
            </div>

            {estSuperAdmin && (
              <>
                <button
                  onClick={ouvrirAjout}
                  className="px-3.5 py-2.5 rounded-full bg-[#1b2b2e] hover:bg-[#0f1c1e] text-white font-bold text-xs flex items-center gap-2 shadow-md"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter une procédure
                </button>
                {/* Dossier racine, VIDE si besoin — demande explicite (15
                    septembre) : « des dossiers avec des sous-dossiers pour
                    ne pas se perdre ». Le sous-dossier, lui, se crée depuis
                    l'intérieur d'un dossier (voir le fil d'Ariane). */}
                {auNiveauDossiers && (
                  <button
                    onClick={() => void creerSousDossier(null)}
                    className="px-3.5 py-2.5 rounded-full bg-white/90 hover:bg-white border border-black/10 text-slate-700 font-bold text-xs flex items-center gap-2 shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    Nouveau dossier
                  </button>
                )}
                <input
                  ref={champCouvertureRapide}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const image = e.target.files?.[0];
                    const cible = ressourcePourCouverture.current;
                    e.target.value = '';
                    ressourcePourCouverture.current = null;
                    if (image && cible) void changerCouvertureRapide(cible, image);
                  }}
                  className="hidden"
                />
                <input
                  ref={champVisuelDossier}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const image = e.target.files?.[0];
                    const cible = dossierPourVisuel.current;
                    e.target.value = '';
                    dossierPourVisuel.current = null;
                    if (image && cible) void changerVisuelDossier(cible, image);
                  }}
                  className="hidden"
                />
                <input
                  ref={champFond}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const image = e.target.files?.[0];
                    e.target.value = '';
                    if (image) void changerFond(image);
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => champFond.current?.click()}
                  disabled={fondEnCours}
                  title="Choisir l'image de fond de l'Académy"
                  className="px-3.5 py-2.5 rounded-full bg-white/90 hover:bg-white border border-black/10 text-slate-700 font-bold text-xs flex items-center gap-2 shadow-md disabled:opacity-60"
                >
                  {fondEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                  Image de fond
                </button>
                {ressources.some((r) => r.drive_file_id) && (
                  <button
                    onClick={() => void rendrePublicsLesFichiersExistants()}
                    disabled={reparationEnCours}
                    title="Ouvrir en lecture les anciens fichiers Drive, sans connexion Google pour les lire"
                    className="px-3.5 py-2.5 rounded-full bg-white/90 hover:bg-white border border-black/10 text-slate-700 font-bold text-xs flex items-center gap-2 shadow-md disabled:opacity-60"
                  >
                    {reparationEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                    Rendre les fichiers existants publics
                  </button>
                )}
              </>
            )}
          </div>

          {/* Avancement personnel */}
          {ressources.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-2.5 text-xs text-slate-700">
              <CheckCircle2
                className={`w-4 h-4 ${validees.size === ressources.length ? 'text-emerald-600' : 'text-slate-400'}`}
              />
              {validees.size === ressources.length
                ? 'Toutes les procédures sont validées.'
                : `${validees.size} validée${validees.size > 1 ? 's' : ''} sur ${ressources.length}`}
              <span className="w-28 h-1.5 rounded-full bg-black/10 overflow-hidden">
                <span
                  className={`block h-full rounded-full transition-all duration-500 ${
                    validees.size === ressources.length ? 'bg-emerald-600' : 'bg-[#E0A21A]'
                  }`}
                  style={{ width: `${Math.round((validees.size / ressources.length) * 100)}%` }}
                />
              </span>
            </div>
          )}

          {/* ── Le contenu d'un dossier, à N'IMPORTE QUEL niveau ──────────
              Demande explicite (15 septembre) : « des dossiers avec des
              sous-dossiers pour ne pas se perdre » — fil d'Ariane cliquable
              à chaque niveau (au lieu d'un seul retour "Tous les dossiers"),
              pour toujours savoir où l'on est ET pouvoir remonter d'un
              coup à n'importe quel palier, pas seulement à la racine.
              Affiché AVANT la grille des sous-dossiers ci-dessous : on sait
              où l'on est avant de voir ce qu'il y a dedans. */}
          {!auNiveauDossiers && (
            <div className="mt-8 flex flex-wrap items-center gap-x-1.5 gap-y-2">
              <button
                onClick={() => { setCheminDossiers([]); setRecherche(''); }}
                className="px-3.5 py-2 rounded-full bg-white/80 hover:bg-white border border-black/10 text-slate-700 text-xs font-bold shadow-sm"
              >
                ← Tous les dossiers
              </button>
              {!enRecherche && cheminDossiers.map((nom, index) => (
                <React.Fragment key={nom}>
                  <span className="text-slate-400 text-xs">/</span>
                  <button
                    onClick={() => allerAuNiveau(index)}
                    disabled={index === cheminDossiers.length - 1}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                      index === cheminDossiers.length - 1
                        ? 'text-slate-900'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    {nom}
                  </button>
                </React.Fragment>
              ))}
              {enRecherche && (
                <h2 className="text-lg font-black text-slate-900 truncate">
                  Résultats pour « {recherche.trim()} »
                </h2>
              )}
              <span className="text-xs text-slate-500 ml-1">
                {visibles.length} procédure{visibles.length > 1 ? 's' : ''}
              </span>
              {/* Sous-dossier : créable à n'importe quel niveau, y compris
                  vide — la grille des dossiers ci-dessus n'existait
                  jusqu'ici QU'à travers une ressource déjà déposée dedans. */}
              {estSuperAdmin && !enRecherche && dossierActif && (
                <button
                  onClick={() => void creerSousDossier(dossierActif)}
                  className="ml-auto px-3.5 py-2 rounded-full bg-white/80 hover:bg-white border border-black/10 text-slate-700 text-xs font-bold shadow-sm flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Sous-dossier
                </button>
              )}
            </div>
          )}

          {/* ── NIVEAU 1 : les dossiers ─────────────────────────────────
              Demandé : « un vrai dossier jaune comme on a l'habitude de voir,
              et quand on clique dedans on accède aux différentes formations ».
              Le dossier est dessiné en CSS — onglet, corps, rabat avant — pour
              rester net à toutes les tailles et suivre le thème sans image. */}
          {(auNiveauDossiers || dansUnDossier) && !chargement && dossiersEnfants.length > 0 && (
            vueDossiers === 'grille' ? (
              <div className={`grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-x-4 gap-y-6 ${auNiveauDossiers ? 'mt-8' : 'mt-4'}`}>
                {dossiersEnfants.map(({ nom, nombre }, index) => {
                  const vues = ressources.filter((r) => r.rubrique === nom && validees.has(r.id)).length;
                  return (
                    <button
                      key={nom}
                      onClick={() => entrerDossier(nom)}
                      // Demande explicite (16 septembre) : « drag and drop
                      // dans les dossiers pour que les sous dossiers se
                      // mettent » — déposer un dossier SUR un autre en fait
                      // un sous-dossier de celui-ci. Réordonner entre eux
                      // se fait, lui, par les flèches du menu "..." (voir
                      // plus bas) : plus fiable qu'un repérage au pixel
                      // près pour savoir si on dépose "sur" ou "entre".
                      draggable={estSuperAdmin}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', `dossier:${nom}`); e.stopPropagation(); }}
                      onDragOver={(e) => {
                        if (!estSuperAdmin) return;
                        e.preventDefault();
                        setDossierSurvoleParDossier(nom);
                      }}
                      onDragLeave={() => setDossierSurvoleParDossier((v) => (v === nom ? null : v))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDossierSurvoleParDossier(null);
                        const donnee = e.dataTransfer.getData('text/plain');
                        if (donnee.startsWith('dossier:')) {
                          void deplacerDossierVersParent(donnee.slice('dossier:'.length), nom);
                        } else {
                          const ressource = ressources.find((r) => r.id === donnee);
                          if (ressource) void deplacerVers(ressource, nom);
                        }
                      }}
                      className={`group flex flex-col items-center focus:outline-none rounded-xl transition-colors ${dossierSurvoleParDossier === nom ? 'ring-2 ring-[#E0A21A] ring-offset-2 ring-offset-[#F7F1E5]' : ''}`}
                      title={`${nom} — ${nombre} procédure${nombre > 1 ? 's' : ''}`}
                    >
                      {/* Dossier réduit : signalé « beaucoup trop gros ». Il
                          reste reconnaissable — onglet, corps, rabat — mais
                          plusieurs tiennent maintenant sur une ligne. */}
                      <div className="relative w-full max-w-[104px] aspect-[5/4] transition-transform duration-200 group-hover:-translate-y-1">
                        <div className="absolute inset-x-0 top-[12%] bottom-0 rounded-lg bg-gradient-to-b from-[#E8B33A] to-[#C88C12] shadow-[0_10px_16px_-10px_rgba(0,0,0,0.55)]" />
                        <div className="absolute left-[5%] top-[2%] h-[16%] w-[46%] rounded-t-md bg-gradient-to-b from-[#F2C55C] to-[#E3AE33]" />
                        <div className="absolute inset-x-0 top-[28%] bottom-0 rounded-lg bg-gradient-to-b from-[#FFD976] to-[#EFB52C] border-t border-white/40 overflow-hidden">
                          {/* « Je voudrais pouvoir mettre une image de fond
                              dans les dossiers » : elle habille le rabat avant,
                              le jaune restant visible autour pour que le
                              dossier reste un dossier. */}
                          {visuelsDossiers.get(nom) && (
                            <img
                              src={visuelsDossiers.get(nom)}
                              alt=""
                              className="absolute inset-[6%] rounded object-cover w-[88%] h-[88%]"
                            />
                          )}
                        </div>
                        <span className="absolute right-1.5 top-[34%] min-w-[18px] px-1.5 py-0.5 rounded-full bg-black/40 text-white text-[10px] font-black text-center">
                          {nombre}
                        </span>
                        {estSuperAdmin && (
                          <span
                            role="button"
                            data-menu-dossier=""
                            title="Gérer ce dossier"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuDossier(menuDossier === nom ? null : nom);
                            }}
                            className={`absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#1b2b2e] text-white flex items-center justify-center transition-opacity shadow ${
                              menuDossier === nom ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            {dossierEnDepot === nom ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <MoreVertical className="w-3 h-3" />
                            )}
                          </span>
                        )}
                        {vues > 0 && (
                          <span className="absolute left-1.5 bottom-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/85 text-[9px] font-bold text-emerald-700">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            {vues}/{nombre}
                          </span>
                        )}
                      </div>
                      <span className="mt-2 text-[11px] font-bold text-slate-800 text-center leading-tight line-clamp-2 group-hover:text-black">
                        {nom}
                      </span>

                      {/* Gérer le dossier : changer ou retirer son image, le
                          renommer, le supprimer. Un menu plutôt que trois
                          pastilles : sur un dossier de 104 px, elles se
                          marcheraient dessus. */}
                      {estSuperAdmin && menuDossier === nom && (
                        <span
                          data-menu-dossier=""
                          onClick={(e) => e.stopPropagation()}
                          className="absolute z-20 top-[70%] left-1/2 -translate-x-1/2 w-52 rounded-xl bg-white border border-black/10 shadow-2xl py-1 text-left"
                        >
                          <span
                            role="button"
                            onClick={() => {
                              setMenuDossier(null);
                              dossierPourVisuel.current = nom;
                              champVisuelDossier.current?.click();
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <ImagePlus className="w-3.5 h-3.5 text-slate-500" />
                            {visuelsDossiers.get(nom) ? "Changer l'image" : 'Choisir une image'}
                          </span>
                          {visuelsDossiers.get(nom) && (
                            <span
                              role="button"
                              onClick={() => { setMenuDossier(null); void retirerVisuelDossier(nom); }}
                              className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <ImageOff className="w-3.5 h-3.5 text-slate-500" />
                              Retirer l'image
                            </span>
                          )}
                          {/* Demande explicite (16 septembre) : « dans les
                              sous dossiers, je veux pouvoir aussi les
                              mettre dans l'ordre que je veux » — échange
                              de position avec le voisin immédiat, désactivé
                              en bout de rangée. */}
                          <span
                            role="button"
                            aria-disabled={index === 0}
                            onClick={() => { if (index > 0) { setMenuDossier(null); void deplacerDossier(nom, 'monter'); } }}
                            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold ${index === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-100'}`}
                          >
                            <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                            Monter
                          </span>
                          <span
                            role="button"
                            aria-disabled={index === dossiersEnfants.length - 1}
                            onClick={() => { if (index < dossiersEnfants.length - 1) { setMenuDossier(null); void deplacerDossier(nom, 'descendre'); } }}
                            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold ${index === dossiersEnfants.length - 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-100'}`}
                          >
                            <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                            Descendre
                          </span>
                          <span
                            role="button"
                            onClick={() => { setMenuDossier(null); void renommerDossier(nom); }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="w-3.5 h-3.5 text-slate-500" />
                            Renommer le dossier
                          </span>
                          <span
                            role="button"
                            onClick={() => { setMenuDossier(null); void supprimerDossier(nom, nombre); }}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Supprimer le dossier
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={`max-w-3xl rounded-2xl bg-white/85 border border-black/10 shadow-lg divide-y divide-black/5 overflow-hidden ${auNiveauDossiers ? 'mt-8' : 'mt-4'}`}>
                {dossiersEnfants.map(({ nom, nombre }, index) => {
                  const vues = ressources.filter((r) => r.rubrique === nom && validees.has(r.id)).length;
                  return (
                    <button
                      key={nom}
                      onClick={() => entrerDossier(nom)}
                      draggable={estSuperAdmin}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', `dossier:${nom}`); e.stopPropagation(); }}
                      onDragOver={(e) => { if (!estSuperAdmin) return; e.preventDefault(); setDossierSurvoleParDossier(nom); }}
                      onDragLeave={() => setDossierSurvoleParDossier((v) => (v === nom ? null : v))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDossierSurvoleParDossier(null);
                        const donnee = e.dataTransfer.getData('text/plain');
                        if (donnee.startsWith('dossier:')) {
                          void deplacerDossierVersParent(donnee.slice('dossier:'.length), nom);
                        } else {
                          const ressource = ressources.find((r) => r.id === donnee);
                          if (ressource) void deplacerVers(ressource, nom);
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#E0A21A]/10 transition-colors text-left ${dossierSurvoleParDossier === nom ? 'bg-[#E0A21A]/20' : ''}`}
                    >
                      {/* Même dossier, en miniature : la liste garde le repère
                          visuel, elle ne le remplace pas par une puce. */}
                      <span className="relative w-9 h-7 shrink-0">
                        <span className="absolute inset-x-0 top-[14%] bottom-0 rounded bg-gradient-to-b from-[#E8B33A] to-[#C88C12]" />
                        <span className="absolute left-[6%] top-0 h-[20%] w-[46%] rounded-t-sm bg-[#F2C55C]" />
                        <span className="absolute inset-x-0 top-[32%] bottom-0 rounded bg-gradient-to-b from-[#FFD976] to-[#EFB52C] border-t border-white/40" />
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 truncate">{nom}</span>
                      {vues > 0 && (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {vues}/{nombre}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 tabular-nums">
                        {nombre} procédure{nombre > 1 ? 's' : ''}
                      </span>
                      {estSuperAdmin && (
                        <>
                          <span
                            role="button"
                            title="Monter"
                            onClick={(e) => { e.stopPropagation(); if (index > 0) void deplacerDossier(nom, 'monter'); }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${index === 0 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-slate-800 hover:bg-black/5'}`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </span>
                          <span
                            role="button"
                            title="Descendre"
                            onClick={(e) => { e.stopPropagation(); if (index < dossiersEnfants.length - 1) void deplacerDossier(nom, 'descendre'); }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${index === dossiersEnfants.length - 1 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-slate-800 hover:bg-black/5'}`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </span>
                          <span
                            role="button"
                            title="Renommer le dossier"
                            onClick={(e) => { e.stopPropagation(); void renommerDossier(nom); }}
                            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-black/5 flex items-center justify-center"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </span>
                          <span
                            role="button"
                            title="Supprimer le dossier"
                            onClick={(e) => { e.stopPropagation(); void supprimerDossier(nom, nombre); }}
                            className="w-7 h-7 rounded-lg text-rose-500 hover:bg-rose-50 flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Glisser-déposer entre dossiers — « de façon à ce que si on s'est
              trompé, on puisse avoir une solution de repli ». Le déplacement
              ne fait que changer le dossier d'une procédure : rien n'est copié
              ni supprimé, et le chemin inverse est le même geste. */}
          {!auNiveauDossiers && estSuperAdmin && rubriques.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Glisser une procédure vers
              </span>
              {rubriques
                .filter(([nom]) => nom !== dossierActif)
                .map(([nom, nombre]) => (
                  <span
                    key={nom}
                    onDragOver={(e) => { e.preventDefault(); setDossierSurvole(nom); }}
                    onDragLeave={() => setDossierSurvole((v) => (v === nom ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDossierSurvole(null);
                      const id = e.dataTransfer.getData('text/plain');
                      const ressource = ressources.find((r) => r.id === id);
                      if (ressource) void deplacerVers(ressource, nom);
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
                      dossierSurvole === nom
                        ? 'bg-[#E0A21A] border-[#E0A21A] text-white scale-105'
                        : 'bg-white/85 border-black/10 text-slate-700'
                    }`}
                  >
                    <span className="relative w-5 h-4 shrink-0">
                      <span className="absolute inset-x-0 top-[16%] bottom-0 rounded-sm bg-gradient-to-b from-[#E8B33A] to-[#C88C12]" />
                      <span className="absolute left-[8%] top-0 h-[22%] w-[46%] rounded-t-[2px] bg-[#F2C55C]" />
                      <span className="absolute inset-x-0 top-[34%] bottom-0 rounded-sm bg-gradient-to-b from-[#FFD976] to-[#EFB52C]" />
                    </span>
                    {nom}
                    <span className="opacity-60">{nombre}</span>
                  </span>
                ))}
            </div>
          )}

          {/* Le catalogue — au niveau 2, ou dès qu'une recherche est en cours */}
          {chargement ? (
            <div className="flex items-center justify-center py-20 text-slate-600 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l'Académy…
            </div>
          ) : ressources.length === 0 ? (
            <div className="mt-10 p-12 text-center bg-white/70 border border-dashed border-black/10 rounded-2xl">
              <GraduationCap className="w-9 h-9 mx-auto mb-3 text-slate-400" />
              <p className="text-sm text-slate-700">L'Académy est vide pour le moment.</p>
              <p className="text-xs text-slate-500 mt-1">
                {estSuperAdmin
                  ? 'Ajoutez une première procédure : un document, une vidéo, une photo de couverture et son auteur.'
                  : "Les procédures de l'agence apparaîtront ici dès qu'elles seront publiées."}
              </p>
            </div>
          ) : auNiveauDossiers ? null : visibles.length === 0 ? (
            <div className="mt-8 p-12 text-center text-sm text-slate-600 bg-white/70 border border-black/10 rounded-2xl">
              Aucune procédure ne correspond à « {recherche} ».
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {visibles.map((r) => {
                const estVideo = r.type === 'video';
                const estValidee = validees.has(r.id);
                return (
                  <article
                    key={r.id}
                    draggable={estSuperAdmin}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
                    className={`group relative bg-white rounded-sm overflow-hidden shadow-xl flex flex-col transition-transform duration-200 hover:-translate-y-1 ${
                      estSuperAdmin ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${deplacementEnCours === r.id ? 'opacity-50' : ''}`}
                  >
                    {/* Couverture */}
                    <button
                      onClick={() => ouvrirRessource(r)}
                      className="relative block w-full aspect-[16/10] bg-slate-200 overflow-hidden"
                    >
                      {r.image_url ? (
                        // Signalé le 2 septembre : « les images ne sont pas
                        // centrées ». Elles l'étaient, mais RECADRÉES :
                        // `object-cover` remplit la vignette en rognant les
                        // bords, et une diapositive de formation y perdait son
                        // logo et son titre. On affiche donc l'image ENTIÈRE,
                        // centrée, quitte à laisser un liseré clair autour :
                        // sur une couverture qui porte du texte, tout voir
                        // vaut mieux que tout remplir.
                        <img
                          src={r.image_url}
                          alt=""
                          className="w-full h-full object-contain object-center transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <span className="w-full h-full flex flex-col items-center justify-center gap-3 bg-slate-100 text-slate-400">
                          {estVideo ? <PlayCircle className="w-10 h-10" /> : <FileText className="w-10 h-10" />}
                          {/* Poser l'image depuis la fiche : ouvrir le
                              formulaire complet pour une seule photo faisait
                              un détour inutile. */}
                          {estSuperAdmin && (
                            <span
                              role="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                ressourcePourCouverture.current = r;
                                champCouvertureRapide.current?.click();
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-black/10 text-slate-700 text-[11px] font-bold shadow-sm hover:bg-slate-50"
                            >
                              {couvertureEnCours === r.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ImagePlus className="w-3.5 h-3.5" />
                              )}
                              Ajouter une image
                            </span>
                          )}
                        </span>
                      )}
                      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        {estVideo ? <PlayCircle className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                        {estVideo ? 'Vidéo' : 'PDF'}
                        {r.duree && <span className="font-normal opacity-80">· {r.duree}</span>}
                      </span>
                      {estValidee && (
                        <span className="absolute top-3 right-3 w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                          <CheckCircle2 className="w-4 h-4" />
                        </span>
                      )}
                    </button>

                    <div className="flex-1 flex flex-col p-6">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-[#B45309]">{r.rubrique}</p>
                      <button onClick={() => ouvrirRessource(r)} className="text-left">
                        <h3 className="mt-2 text-xl font-extrabold uppercase text-slate-900 leading-tight">
                          {r.titre}
                        </h3>
                      </button>
                      {r.description && (
                        <p className="mt-4 text-sm text-slate-600 leading-relaxed">{r.description}</p>
                      )}

                      {/* Auteur — c'est lui qui fait qu'une fiche se lit comme
                          une formation et non comme un fichier. */}
                      <div className="mt-6 pt-4 flex items-center gap-3">
                        {r.auteur_photo_url ? (
                          <img
                            src={r.auteur_photo_url}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200"
                          />
                        ) : r.auteur ? (
                          <span className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center">
                            {initiales(r.auteur)}
                          </span>
                        ) : null}
                        {r.auteur && <span className="text-sm text-slate-700">{r.auteur}</span>}

                        <button
                          onClick={() => void basculerValidation(r)}
                          disabled={validationEnCours === r.id}
                          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-60 ${
                            estValidee
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {validationEnCours === r.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : estValidee ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <Circle className="w-3.5 h-3.5" />
                          )}
                          {estValidee ? 'Validée' : 'Marquer comme vue'}
                        </button>
                      </div>

                      {estSuperAdmin && (validationsParRessource.get(r.id) || 0) > 0 && (
                        <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                          <Users className="w-3 h-3" />
                          {validationsParRessource.get(r.id)} personne
                          {(validationsParRessource.get(r.id) || 0) > 1 ? 's ont' : ' a'} validé cette procédure
                        </p>
                      )}
                    </div>

                    {estSuperAdmin && (
                      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.image_url && (
                          <button
                            onClick={() => {
                              ressourcePourCouverture.current = r;
                              champCouvertureRapide.current?.click();
                            }}
                            title="Changer l'image"
                            className="w-8 h-8 rounded-full bg-black/70 text-white hover:text-[#F7BC5F] flex items-center justify-center"
                          >
                            {couvertureEnCours === r.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ImagePlus className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => ouvrirModification(r)}
                          title="Modifier"
                          className="w-8 h-8 rounded-full bg-black/70 text-white hover:text-[#F7BC5F] flex items-center justify-center"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void supprimer(r)}
                          title="Retirer de l'Académy"
                          className="w-8 h-8 rounded-full bg-rose-600/90 text-white hover:bg-rose-600 flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lecteur plein écran — demandé le 2 septembre : « quand on clique sur
          le dossier, je voudrais qu'ils apparaissent plein écran, qu'ils
          utilisent toute l'interface du CRM ». Une procédure se lit, elle ne
          se consulte pas dans une vignette : le document occupe donc tout
          l'écran, avec un simple bandeau au-dessus. */}
      {ouverte && (
        <div ref={cadreLecteur} className="fixed inset-0 z-[100] bg-[#050f11] flex flex-col">
          <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-[#144447]/60 bg-[#07191b] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {ouverte.auteur_photo_url ? (
                <img src={ouverte.auteur_photo_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#F7BC5F] flex items-center justify-center shrink-0">
                  {ouverte.type === 'video' ? <PlayCircle className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{ouverte.titre}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  {ouverte.rubrique}
                  {ouverte.auteur ? ` · ${ouverte.auteur}` : ''}
                  {ouverte.duree ? ` · ${ouverte.duree}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Valider ici même : c'est au moment où l'on referme un document
                  qu'on sait qu'on l'a lu. */}
              <button
                onClick={() => void basculerValidation(ouverte)}
                disabled={validationEnCours === ouverte.id}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-60 ${
                  validees.has(ouverte.id)
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
              >
                {validationEnCours === ouverte.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : validees.has(ouverte.id) ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Circle className="w-3.5 h-3.5" />
                )}
                {validees.has(ouverte.id) ? 'Validée' : 'Marquer comme vue'}
              </button>

              {/* Certains PDF refusent d'être affichés dans un cadre : la
                  sortie de secours est toujours là, plutôt qu'un écran blanc
                  sans explication. */}
              {/* Plein écran par le navigateur : on ne quitte ni
                  l'application, ni la page, ni l'onglet — « partir sur une
                  ouverture avec un onglet différent, ça je ne veux pas ». */}
              <button
                onClick={() => void basculerPleinEcran()}
                title={pleinEcran ? 'Quitter le plein écran' : 'Afficher en plein écran'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-[11px] font-bold"
              >
                {pleinEcran ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{pleinEcran ? 'Réduire' : 'Plein écran'}</span>
              </button>

              {/* Sortie de secours, pour les rares fichiers qu'un serveur
                  refuse d'afficher dans un cadre — pas une façon d'obtenir le
                  plein écran. */}
              <a
                href={lienOuvrable(ouverte)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-slate-500 hover:text-[#F9C977] underline decoration-dotted underline-offset-4 hidden lg:inline"
              >
                Ouvrir le fichier
              </a>

              <button
                onClick={() => setOuverte(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-[11px] font-bold"
              >
                <X className="w-3.5 h-3.5" />
                Fermer
              </button>
            </div>
          </div>

          {/* Le document occupe tout ce qui reste. Fond noir pour une vidéo,
              gris sombre pour un document : c'est ce que fait un lecteur. */}
          <div className={`flex-1 min-h-0 ${ouverte.type === 'video' ? 'bg-black' : 'bg-[#0b1416]'}`}>
            <iframe
              src={lienIntegrable(lienOuvrable(ouverte)) || ''}
              title={ouverte.titre}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>
        </div>
      )}

      {/* Ajout / modification — super admins */}
      {formOuvert && estSuperAdmin && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !enregistrement && setFormOuvert(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[88vh] overflow-y-auto custom-scrollbar rounded-2xl bg-[#07191b] border border-[#1b4e52] p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {enModification ? 'Modifier la procédure' : 'Ajouter une procédure'}
              </h3>
              <button onClick={() => setFormOuvert(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Titre</label>
              <input
                value={titre}
                onChange={(e) => setTitre(e.target.value)}
                placeholder="Ex : Rédiger un mandat exclusif"
                className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Rubrique</label>
                <input
                  list="academy-rubriques"
                  value={rubrique}
                  onChange={(e) => setRubrique(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                />
                <datalist id="academy-rubriques">
                  {[...new Set([...rubriques.map(([n]) => n), ...RUBRIQUES_SUGGEREES])].map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'pdf' | 'video')}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                >
                  <option value="pdf">PDF</option>
                  <option value="video">Vidéo</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ce que l'agent saura faire après. Deux ou trois phrases."
                className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Auteur</label>
                <input
                  value={auteur}
                  onChange={(e) => setAuteur(e.target.value)}
                  placeholder="Prénom Nom"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Durée ou volume</label>
                <input
                  value={duree}
                  onChange={(e) => setDuree(e.target.value)}
                  placeholder="8 min · 4 pages"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
            </div>

            {/* Visuels */}
            <div className="rounded-xl border border-[#153c3f] bg-[#030d0f] p-3 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Les visuels</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    ref={champCouverture}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCouverture(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => champCouverture.current?.click()}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs text-white flex items-center gap-2"
                  >
                    <ImagePlus className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="truncate">
                      {couverture ? couverture.name : couvertureActuelle ? 'Changer la couverture' : 'Photo de couverture'}
                    </span>
                  </button>
                </div>
                <div>
                  <input
                    ref={champPortrait}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPortrait(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => champPortrait.current?.click()}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs text-white flex items-center gap-2"
                  >
                    <ImagePlus className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="truncate">
                      {portrait ? portrait.name : portraitActuel ? "Changer le portrait" : "Portrait de l'auteur"}
                    </span>
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Sans couverture, la fiche reste lisible mais perd ce qui la fait ressembler à une
                formation plutôt qu'à un fichier.
              </p>
            </div>

            {/* Contenu */}
            <div className="rounded-xl border border-[#153c3f] bg-[#030d0f] p-3 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Le contenu</p>
              <div>
                <input
                  ref={champFichier}
                  type="file"
                  accept="application/pdf,video/*"
                  onChange={(e) => setFichier(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => champFichier.current?.click()}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm text-white flex items-center gap-2"
                >
                  <Upload className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                  <span className="truncate">
                    {fichier ? fichier.name : 'Déposer un PDF ou une vidéo'}
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className="flex-1 h-px bg-white/10" /> ou <span className="flex-1 h-px bg-white/10" />
              </div>

              <div className="relative">
                <LinkIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={lienExterne}
                  onChange={(e) => setLienExterne(e.target.value)}
                  placeholder="Coller un lien YouTube, Vimeo ou Drive"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#07191b] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              {enModification && !fichier && (
                <p className="text-[10px] text-slate-500">
                  Sans nouveau fichier ni nouveau lien, le contenu actuel est conservé.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setFormOuvert(false)}
                disabled={enregistrement}
                className="px-4 py-2 rounded-xl text-slate-300 hover:text-white text-xs font-bold"
              >
                Annuler
              </button>
              <button
                onClick={() => void enregistrer()}
                disabled={enregistrement}
                className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] disabled:opacity-50 text-black text-xs font-bold flex items-center gap-2"
              >
                {enregistrement && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {enModification ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
