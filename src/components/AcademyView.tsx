import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, PlayCircle, Plus, Search, Trash2, X, Loader2, Upload, Link as LinkIcon, Pencil,
  CheckCircle2, Circle, Users, ImagePlus, GraduationCap, LayoutGrid, List as ListIcon,
  MoreVertical, ImageOff, Maximize2, Minimize2, Unlock, ArrowUp, ArrowDown, ArrowLeft,
  Folder, ChevronRight, ExternalLink,
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

  const [menuOptionsAdmin, setMenuOptionsAdmin] = useState(false);
  const optionsAdminRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOptionsAdmin) return;
    const onClic = (e: MouseEvent) => {
      if (optionsAdminRef.current && !optionsAdminRef.current.contains(e.target as Node)) {
        setMenuOptionsAdmin(false);
      }
    };
    document.addEventListener('mousedown', onClic);
    return () => document.removeEventListener('mousedown', onClic);
  }, [menuOptionsAdmin]);

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
  // Demande explicite (14 septembre) : « je ne peux pas bouger l'ordre des
  // dossiers » — le drag-and-drop ne faisait QUE nester (déposer sur un
  // dossier = devenir son sous-dossier), il n'y avait aucun moyen de
  // simplement réordonner par glisser-déposer, seulement les flèches
  // Monter/Descendre planquées dans le menu "...". Ce state retient
  // l'intention détectée pendant le survol — déposer sur le quart gauche/
  // droit d'un dossier le RÉORDONNE avant/après lui, déposer au centre le
  // NESTE dedans (comportement d'origine, conservé).
  const [dossierSurvolIntention, setDossierSurvolIntention] = useState<'avant' | 'apres' | 'dans' | null>(null);
  const entrerDossier = (nom: string) => setCheminDossiers((chemin) => [...chemin, nom]);
  const allerAuNiveau = (index: number) => setCheminDossiers((chemin) => chemin.slice(0, index + 1));
  const [dossierEnDepot, setDossierEnDepot] = useState<string | null>(null);
  const [dossierSurvole, setDossierSurvole] = useState<string | null>(null);
  const [deplacementEnCours, setDeplacementEnCours] = useState<string | null>(null);
  // Demande explicite (1er octobre) : « quand on rentre dans un dossier, je
  // voudrais avoir la possibilité d'organiser comme je le souhaite en
  // glisser-déposer, les documents qui sont à l'intérieur » — jusqu'ici, une
  // procédure se glissait déjà (draggable={estSuperAdmin} sur chaque
  // <article>, voir plus bas), mais UNIQUEMENT vers un autre dossier (les
  // pastilles de rubrique) : rien ne consommait ce glisser en le déposant sur
  // une AUTRE procédure, donc aucun moyen de les réordonner entre elles au
  // sein d'un même dossier. Même mécanique que dossierSurvoleParDossier/
  // dossierSurvolIntention ci-dessus (avant/après selon la moitié gauche/
  // droite survolée), simplifiée : pas de notion "dans" ici, une procédure
  // ne peut pas en contenir une autre.
  const [ressourceEnDrag, setRessourceEnDrag] = useState<string | null>(null);
  const [ressourceSurvolee, setRessourceSurvolee] = useState<string | null>(null);
  const [ressourceSurvolIntention, setRessourceSurvolIntention] = useState<'avant' | 'apres' | null>(null);
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
  // Bascule le champ Rubrique vers la saisie libre d'un nom inédit — demandé
  // le 1er octobre : « avoir plus de choix dans la rubrique pour pouvoir le
  // déplacer facilement ». Par défaut (false), la rubrique est un menu
  // déroulant listant tous les dossiers existants : en modification, changer
  // de dossier tient en un seul choix dans la liste, visible d'un coup —
  // l'ancien champ texte + suggestions au clavier (datalist) ne montrait
  // aucun choix tant qu'on n'avait pas commencé à taper, et le datalist ne
  // s'affiche pas du tout sur certaines tablettes.
  const [nouvelleRubrique, setNouvelleRubrique] = useState(false);
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
    return ressources
      .filter((r) => {
        if (dossierActif && r.rubrique !== dossierActif) return false;
        if (!q) return true;
        return (
          r.titre.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.auteur || '').toLowerCase().includes(q) ||
          r.rubrique.toLowerCase().includes(q)
        );
      })
      // Tri explicite (1er octobre, glisser-déposer pour réordonner) :
      // `ressources` n'est trié que lors du CHARGEMENT initial (même ordre à
      // 3 clés que la requête `.order()` dans `charger` : rubrique, position,
      // created_at) — après une mise à jour optimiste de position par
      // renumeroterRessources, l'ORDRE du tableau ne change pas, seul le
      // champ `position` de chaque élément change. Sans ce tri ici, la
      // grille ne refléterait le nouvel ordre qu'après un rechargement
      // complet. Rubrique conservée en première clé pour ne rien changer à
      // l'affichage pendant une recherche (plusieurs rubriques mélangées) :
      // sans objet ici (dossierActif filtre déjà à une seule rubrique) quand
      // on réordonne réellement.
      .sort((a, b) =>
        a.rubrique.localeCompare(b.rubrique, 'fr') ||
        a.position - b.position ||
        a.created_at.localeCompare(b.created_at)
      );
  }, [ressources, recherche, dossierActif]);

  const reinitialiserFormulaire = () => {
    setEnModification(null);
    setTitre('');
    // Pré-rempli sur le dossier actuellement ouvert, s'il y en a un — on
    // ajoute presque toujours une procédure DEPUIS le dossier où on veut la
    // ranger, pas en pigeant une rubrique au hasard dans la liste.
    setRubrique(dossierActif || rubriques[0]?.[0] || RUBRIQUES_SUGGEREES[0]);
    setNouvelleRubrique(false);
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
    setNouvelleRubrique(false);
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
   * Renumérote toute une fratrie de dossiers (même parent) selon l'ordre
   * `nouvelOrdre` — position 0, 1, 2… dans cet ordre. Bug corrigé (14
   * septembre, rapporté « je ne peux pas bouger l'ordre des dossiers » /
   * « rien ne se passe ») : Monter/Descendre ÉCHANGEAIT deux positions,
   * ce qui ne change rien de VISIBLE quand elles sont déjà égales — le
   * cas par défaut, puisque tout dossier naît à position 0. Renumérote
   * systématiquement toute la liste à la place. Écrit ligne par ligne
   * (upsert séquentiel plutôt qu'un upsert groupé en un seul appel) pour
   * ne dépendre d'aucune hypothèse sur le comportement d'un upsert
   * multi-lignes vis-à-vis des lignes RLS/on_conflict.
   */
  const renumeroterFratrie = async (nouvelOrdre: string[]) => {
    setDossiers((prev) => {
      const parNom = new Map(prev.map((d) => [d.nom, d]));
      nouvelOrdre.forEach((nom, i) => {
        parNom.set(nom, { ...(parNom.get(nom) ?? { nom, parent_nom: dossierActif }), parent_nom: dossierActif, position: i });
      });
      return Array.from(parNom.values());
    });
    try {
      for (let i = 0; i < nouvelOrdre.length; i++) {
        const { error } = await supabase
          .from('academy_folders' as any)
          .upsert(
            {
              agency_id: activeAgency!.id,
              nom: nouvelOrdre[i],
              parent_nom: dossierActif,
              position: i,
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: 'agency_id,nom' }
          );
        if (error) throw error;
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer ce nouvel ordre.");
      await charger();
    }
  };

  /**
   * Réordonne par glisser-déposer — déposer `nomSource` sur le quart
   * gauche/droit de `nomCible` le place juste avant/après lui, parmi les
   * dossiers actuellement affichés (donc déjà tous du même parent).
   */
  const reordonnerDossier = async (nomSource: string, nomCible: string, position: 'avant' | 'apres') => {
    if (nomSource === nomCible) return;
    const fratrie = dossiersEnfants.map((d) => d.nom).filter((n) => n !== nomSource);
    let indexCible = fratrie.indexOf(nomCible);
    if (indexCible === -1) return;
    if (position === 'apres') indexCible += 1;
    fratrie.splice(indexCible, 0, nomSource);
    await renumeroterFratrie(fratrie);
  };

  /**
   * Même principe que renumeroterFratrie/reordonnerDossier ci-dessus, pour
   * les procédures d'une même rubrique (dossier) — demande explicite (1er
   * octobre) : glisser-déposer pour organiser les documents à l'intérieur
   * d'un dossier. Écrit ligne par ligne (même raison que pour les dossiers :
   * ne dépendre d'aucune hypothèse sur le comportement d'une écriture
   * multi-lignes vis-à-vis des règles RLS).
   */
  const renumeroterRessources = async (rubrique: string, nouvelOrdre: string[]) => {
    const avant = ressources;
    setRessources((prev) => {
      const parId = new Map(prev.map((r) => [r.id, r]));
      nouvelOrdre.forEach((id, i) => {
        const r = parId.get(id);
        if (r) parId.set(id, { ...r, position: i });
      });
      return Array.from(parId.values());
    });
    try {
      for (let i = 0; i < nouvelOrdre.length; i++) {
        const { error } = await supabase
          .from('academy_resources' as any)
          .update({ position: i } as any)
          .eq('id', nouvelOrdre[i]);
        if (error) throw error;
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'enregistrer ce nouvel ordre.");
      setRessources(avant);
    }
  };

  const reordonnerRessource = async (idSource: string, idCible: string, position: 'avant' | 'apres') => {
    if (idSource === idCible) return;
    const cible = ressources.find((r) => r.id === idCible);
    const source = ressources.find((r) => r.id === idSource);
    if (!cible || !source || source.rubrique !== cible.rubrique) return;
    const fratrie = ressources
      .filter((r) => r.rubrique === cible.rubrique)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
      .map((r) => r.id)
      .filter((id) => id !== idSource);
    let indexCible = fratrie.indexOf(idCible);
    if (indexCible === -1) return;
    if (position === 'apres') indexCible += 1;
    fratrie.splice(indexCible, 0, idSource);
    await renumeroterRessources(cible.rubrique, fratrie);
  };

  /**
   * Réordonne les dossiers de MÊME parent — demande explicite (16
   * septembre) : « dans les sous dossiers, je veux pouvoir aussi les
   * mettre dans l'ordre que je veux ». Fait glisser le dossier d'un cran
   * dans la liste affichée, puis renumérote toute la fratrie.
   */
  const deplacerDossier = async (nom: string, direction: 'monter' | 'descendre') => {
    const fratrie = dossiersEnfants.map((d) => d.nom);
    const index = fratrie.indexOf(nom);
    const indexVoisin = direction === 'monter' ? index - 1 : index + 1;
    if (index === -1 || indexVoisin < 0 || indexVoisin >= fratrie.length) return;
    [fratrie[index], fratrie[indexVoisin]] = [fratrie[indexVoisin], fratrie[index]];
    await renumeroterFratrie(fratrie);
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
      className="academy-root -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 min-h-[calc(100vh-4rem)] relative overflow-hidden"
    >
      {/* Fond sombre et halos réservés au mode nuit (neutralisés en mode jour) */}
      <div className="academy-dark-glow pointer-events-none absolute inset-0 bg-[#071317]" />
      <div className="academy-dark-glow pointer-events-none absolute inset-0 bg-gradient-to-b from-[#071317] via-[#091a20] to-[#050e11]" />
      <div className="academy-dark-glow pointer-events-none absolute -top-40 left-1/4 w-[500px] h-[500px] bg-[#F7BC5F]/[0.035] rounded-full blur-3xl" />
      <div className="academy-dark-glow pointer-events-none absolute top-1/3 -right-20 w-[450px] h-[450px] bg-[#0ea5e9]/[0.025] rounded-full blur-3xl" />

      {/* Bandeau d'image de l'agence avec dégradé cinématique vers le fond sombre */}
      {fond && (
        <div
          className="relative w-full overflow-hidden"
          style={{ height: 'clamp(140px, 18vw, 320px)' }}
        >
          <img
            src={fond}
            alt="Bannière Académy"
            className="w-full h-full object-cover object-center brightness-[0.82] contrast-[1.08]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#071317] via-[#071317]/50 to-transparent" />
        </div>
      )}

      <div
        className="px-4 sm:px-6 lg:px-8 pb-16 relative z-10"
        style={{ paddingTop: fond ? '1.5rem' : '2rem' }}
      >
        <div className="max-w-6xl mx-auto">
          {!fond && (
            <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#F7BC5F] to-[#C88C12] flex items-center justify-center text-slate-950 shadow-lg shadow-[#F7BC5F]/20 shrink-0">
                  <GraduationCap className="w-6 h-6 stroke-[2.2]" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    Académy <span className="text-[#F7BC5F]">{activeAgency?.name || ''}</span>
                  </h1>
                  <p className="mt-0.5 text-xs sm:text-sm text-slate-400">
                    Toutes les procédures, formations et tutoriels de l'agence, rangés par dossier.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Barre unique sobre et design : navigation + recherche + actions */}
          <div className="bg-[#0b1e22]/85 backdrop-blur-xl rounded-2xl p-2.5 sm:p-3 border border-white/12 shadow-[0_12px_36px_rgba(0,0,0,0.5)] flex flex-wrap items-center justify-between gap-2.5 mb-6">
            {/* Gauche : Fil d'Ariane si on est dans un dossier, sinon Recherche */}
            {!auNiveauDossiers && !enRecherche ? (
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <button
                  onClick={() => {
                    if (cheminDossiers.length > 1) {
                      allerAuNiveau(cheminDossiers.length - 2);
                    } else {
                      setCheminDossiers([]);
                    }
                  }}
                  className="h-9 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 border border-white/10 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Retour</span>
                </button>
                <button
                  onClick={() => setCheminDossiers([])}
                  className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Dossiers
                </button>
                {cheminDossiers.map((nom, index) => (
                  <React.Fragment key={nom}>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0 hidden sm:block" />
                    <button
                      onClick={() => allerAuNiveau(index)}
                      disabled={index === cheminDossiers.length - 1}
                      className={`px-2.5 py-1 rounded-lg text-xs sm:text-sm font-extrabold truncate max-w-[200px] sm:max-w-xs transition-colors ${
                        index === cheminDossiers.length - 1
                          ? 'text-[#FAD592]'
                          : 'text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer'
                      }`}
                    >
                      {nom}
                    </button>
                  </React.Fragment>
                ))}
                <span className="px-2.5 py-1 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#FAD592] text-[11px] font-bold shrink-0">
                  {visibles.length} procédure{visibles.length > 1 ? 's' : ''}
                </span>
              </div>
            ) : null}

            {/* Champ de recherche */}
            <div className={`relative flex-1 min-w-[180px] ${!auNiveauDossiers && !enRecherche ? 'sm:max-w-xs ml-auto' : 'max-w-md'}`}>
              <Search className="w-4 h-4 text-[#F7BC5F] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={dossierActif ? `Rechercher dans ${dossierActif}…` : 'Rechercher une procédure…'}
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-[#051113]/90 text-white placeholder-slate-400 text-xs sm:text-sm border border-white/15 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F] transition-all"
              />
              {recherche && (
                <button
                  type="button"
                  onClick={() => setRecherche('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Droite : progression + vue + actions admin */}
            <div className="flex items-center gap-2 flex-wrap ml-auto sm:ml-0">
              {auNiveauDossiers && ressources.length > 0 && (
                <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/6 border border-white/10 text-xs text-slate-300">
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${validees.size === ressources.length ? 'text-emerald-400' : 'text-[#F7BC5F]'}`}
                  />
                  <span className="font-semibold">{validees.size}/{ressources.length} lue{validees.size > 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Sélecteur Grille ou Liste */}
              <div className="flex items-center rounded-xl bg-[#051113] p-0.5 border border-white/10">
                <button
                  onClick={() => choisirVue('grille')}
                  title="Affichage en grille"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    vueDossiers === 'grille' ? 'bg-[#F7BC5F] text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => choisirVue('liste')}
                  title="Affichage en liste"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    vueDossiers === 'liste' ? 'bg-[#F7BC5F] text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ListIcon className="w-3.5 h-3.5" />
                </button>
              </div>

              {estSuperAdmin && (
                <>
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

                  {!enRecherche && (
                    <button
                      onClick={() => void creerSousDossier(dossierActif)}
                      className="h-9 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/12 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#F7BC5F]" />
                      <span>{dossierActif ? 'Sous-dossier' : 'Dossier'}</span>
                    </button>
                  )}

                  <button
                    onClick={ouvrirAjout}
                    className="h-9 px-3.5 rounded-xl bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-[#F7BC5F]/20 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Procédure</span>
                  </button>

                  {auNiveauDossiers && (
                    <div className="relative" ref={optionsAdminRef}>
                      <button
                        type="button"
                        onClick={() => setMenuOptionsAdmin((v) => !v)}
                        title="Options d'administration"
                        className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 text-slate-300 border border-white/10 flex items-center justify-center transition-all cursor-pointer"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {menuOptionsAdmin && (
                        <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-[#091a1e] border border-white/15 shadow-2xl py-1 z-30 text-xs text-slate-200">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOptionsAdmin(false);
                              champFond.current?.click();
                            }}
                            disabled={fondEnCours}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-slate-200 hover:bg-white/10 font-medium text-left cursor-pointer"
                          >
                            {fondEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5 text-[#F7BC5F]" />}
                            <span>Changer la bannière</span>
                          </button>
                          {ressources.some((r) => r.drive_file_id) && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOptionsAdmin(false);
                                void rendrePublicsLesFichiersExistants();
                              }}
                              disabled={reparationEnCours}
                              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-slate-200 hover:bg-white/10 font-medium text-left border-t border-white/10 cursor-pointer"
                            >
                              {reparationEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5 text-[#F7BC5F]" />}
                              <span>Rendre fichiers publics</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* En-tête de recherche si recherche active */}
          {enRecherche && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">
                {visibles.length} résultat{visibles.length > 1 ? 's' : ''} pour « {recherche.trim()} »
                {dossierActif ? ` dans ${dossierActif}` : ''}
              </p>
              <button
                onClick={() => setRecherche('')}
                className="text-xs font-bold text-slate-600 hover:text-slate-900 underline cursor-pointer"
              >
                Effacer la recherche
              </button>
            </div>
          )}

          {/* ── LES DOSSIERS (racine ou sous-dossiers) ─────────────────────── */}
          {(auNiveauDossiers || dansUnDossier) && !chargement && dossiersEnfants.length > 0 && (
            <div className={dansUnDossier ? 'mb-6' : ''}>
              {dansUnDossier && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#F7BC5F] mb-2.5">
                  Sous-dossiers
                </p>
              )}

              {vueDossiers === 'grille' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {dossiersEnfants.map(({ nom, nombre }, index) => {
                    const vues = ressources.filter((r) => r.rubrique === nom && validees.has(r.id)).length;
                    return (
                      <div
                        key={nom}
                        onClick={() => entrerDossier(nom)}
                        draggable={estSuperAdmin}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', `dossier:${nom}`); e.stopPropagation(); }}
                        onDragOver={(e) => {
                          if (!estSuperAdmin) return;
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const fraction = (e.clientX - rect.left) / rect.width;
                          setDossierSurvoleParDossier(nom);
                          setDossierSurvolIntention(fraction < 0.25 ? 'avant' : fraction > 0.75 ? 'apres' : 'dans');
                        }}
                        onDragLeave={() => {
                          setDossierSurvoleParDossier((v) => (v === nom ? null : v));
                          setDossierSurvolIntention((v) => (dossierSurvoleParDossier === nom ? null : v));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDossierSurvoleParDossier(null);
                          const intention = dossierSurvolIntention;
                          setDossierSurvolIntention(null);
                          setRessourceEnDrag(null);
                          const donnee = e.dataTransfer.getData('text/plain');
                          if (donnee.startsWith('dossier:')) {
                            const nomSource = donnee.slice('dossier:'.length);
                            if (intention === 'avant' || intention === 'apres') {
                              void reordonnerDossier(nomSource, nom, intention);
                            } else {
                              void deplacerDossierVersParent(nomSource, nom);
                            }
                          } else {
                            const ressource = ressources.find((r) => r.id === donnee);
                            if (ressource) void deplacerVers(ressource, nom);
                          }
                        }}
                        className={`group relative bg-[#0b1e22]/75 hover:bg-[#0f282e]/95 backdrop-blur-md rounded-2xl p-4 border border-white/10 hover:border-[#F7BC5F]/50 shadow-lg hover:shadow-[0_12px_36px_rgba(0,0,0,0.5)] transition-all duration-300 hover:-translate-y-0.5 flex items-center gap-3.5 cursor-pointer select-none ${
                          dossierSurvoleParDossier === nom && dossierSurvolIntention === 'dans'
                            ? 'ring-2 ring-[#F7BC5F] bg-[#102c32]'
                            : ''
                        }`}
                      >
                        {dossierSurvoleParDossier === nom && dossierSurvolIntention === 'avant' && (
                          <span className="absolute -left-1.5 top-2 bottom-2 w-1 rounded-full bg-[#F7BC5F]" />
                        )}
                        {dossierSurvoleParDossier === nom && dossierSurvolIntention === 'apres' && (
                          <span className="absolute -right-1.5 top-2 bottom-2 w-1 rounded-full bg-[#F7BC5F]" />
                        )}

                        {/* Icône dossier ambre/or épurée (ou miniature choisie) */}
                        <div className="relative w-12 h-10 shrink-0">
                          <div className="absolute inset-x-0 top-[14%] bottom-0 rounded-lg bg-gradient-to-b from-[#E8B33A] to-[#C88C12] shadow-xs" />
                          <div className="absolute left-[6%] top-0 h-[20%] w-[44%] rounded-t-md bg-gradient-to-b from-[#F2C55C] to-[#E3AE33]" />
                          <div className="absolute inset-x-0 top-[30%] bottom-0 rounded-lg bg-gradient-to-b from-[#FFD976] to-[#EFB52C] border-t border-white/50 overflow-hidden flex items-center justify-center">
                            {visuelsDossiers.get(nom) && (
                              <img
                                src={visuelsDossiers.get(nom)}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                        </div>

                        {/* Nom + compteur clair */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white leading-snug line-clamp-2 group-hover:text-[#FAD592] transition-colors">
                            {nom}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                            <span>{nombre} procédure{nombre > 1 ? 's' : ''}</span>
                            {vues > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/25">
                                <CheckCircle2 className="w-3 h-3" />
                                {vues}/{nombre}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Menu admin ou chevron */}
                        {estSuperAdmin ? (
                          <button
                            type="button"
                            data-menu-dossier=""
                            title="Gérer ce dossier"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuDossier(menuDossier === nom ? null : nom);
                            }}
                            className="w-8 h-8 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center shrink-0 transition-colors"
                          >
                            {dossierEnDepot === nom ? (
                              <Loader2 className="w-4 h-4 animate-spin text-[#F7BC5F]" />
                            ) : (
                              <MoreVertical className="w-4 h-4" />
                            )}
                          </button>
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white shrink-0 transition-colors" />
                        )}

                        {estSuperAdmin && menuDossier === nom && (
                          <div
                            data-menu-dossier=""
                            onClick={(e) => e.stopPropagation()}
                            className="absolute z-30 right-2 top-full mt-1 w-48 rounded-xl bg-[#091a1e] border border-white/15 shadow-2xl py-1 text-left text-slate-200"
                          >
                            <button
                              type="button"
                              onClick={() => { setMenuDossier(null); void renommerDossier(nom); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[#F7BC5F]" />
                              Renommer
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuDossier(null);
                                dossierPourVisuel.current = nom;
                                champVisuelDossier.current?.click();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                            >
                              <ImagePlus className="w-3.5 h-3.5 text-[#F7BC5F]" />
                              {visuelsDossiers.get(nom) ? "Changer l'image" : 'Ajouter une image'}
                            </button>
                            {visuelsDossiers.get(nom) && (
                              <button
                                type="button"
                                onClick={() => { setMenuDossier(null); void retirerVisuelDossier(nom); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                              >
                                <ImageOff className="w-3.5 h-3.5 text-[#F7BC5F]" />
                                Retirer l'image
                              </button>
                            )}
                            <div className="my-1 border-t border-white/10" />
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => { if (index > 0) { setMenuDossier(null); void deplacerDossier(nom, 'monter'); } }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold ${index === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-slate-200 hover:bg-white/10'}`}
                            >
                              <ArrowUp className="w-3.5 h-3.5 text-slate-400" />
                              Déplacer avant
                            </button>
                            <button
                              type="button"
                              disabled={index === dossiersEnfants.length - 1}
                              onClick={() => { if (index < dossiersEnfants.length - 1) { setMenuDossier(null); void deplacerDossier(nom, 'descendre'); } }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold ${index === dossiersEnfants.length - 1 ? 'text-slate-600 cursor-not-allowed' : 'text-slate-200 hover:bg-white/10'}`}
                            >
                              <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
                              Déplacer après
                            </button>
                            <div className="my-1 border-t border-white/10" />
                            <button
                              type="button"
                              onClick={() => { setMenuDossier(null); void supprimerDossier(nom, nombre); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/15"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Supprimer
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-[#0b1e22]/75 backdrop-blur-md border border-white/10 shadow-lg divide-y divide-white/10 overflow-hidden">
                  {dossiersEnfants.map(({ nom, nombre }, index) => {
                    const vues = ressources.filter((r) => r.rubrique === nom && validees.has(r.id)).length;
                    return (
                      <div
                        key={nom}
                        onClick={() => entrerDossier(nom)}
                        draggable={estSuperAdmin}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', `dossier:${nom}`); e.stopPropagation(); }}
                        onDragOver={(e) => {
                          if (!estSuperAdmin) return;
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const fraction = (e.clientY - rect.top) / rect.height;
                          setDossierSurvoleParDossier(nom);
                          setDossierSurvolIntention(fraction < 0.25 ? 'avant' : fraction > 0.75 ? 'apres' : 'dans');
                        }}
                        onDragLeave={() => {
                          setDossierSurvoleParDossier((v) => (v === nom ? null : v));
                          setDossierSurvolIntention((v) => (dossierSurvoleParDossier === nom ? null : v));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDossierSurvoleParDossier(null);
                          const intention = dossierSurvolIntention;
                          setDossierSurvolIntention(null);
                          setRessourceEnDrag(null);
                          const donnee = e.dataTransfer.getData('text/plain');
                          if (donnee.startsWith('dossier:')) {
                            const nomSource = donnee.slice('dossier:'.length);
                            if (intention === 'avant' || intention === 'apres') {
                              void reordonnerDossier(nomSource, nom, intention);
                            } else {
                              void deplacerDossierVersParent(nomSource, nom);
                            }
                          } else {
                            const ressource = ressources.find((r) => r.id === donnee);
                            if (ressource) void deplacerVers(ressource, nom);
                          }
                        }}
                        className={`relative w-full flex items-center gap-3.5 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer ${
                          dossierSurvoleParDossier === nom && dossierSurvolIntention === 'dans' ? 'bg-[#102c32]' : ''
                        }`}
                      >
                        <div className="relative w-9 h-7 shrink-0">
                          <span className="absolute inset-x-0 top-[14%] bottom-0 rounded bg-gradient-to-b from-[#E8B33A] to-[#C88C12]" />
                          <span className="absolute left-[6%] top-0 h-[20%] w-[46%] rounded-t-sm bg-[#F2C55C]" />
                          <span className="absolute inset-x-0 top-[32%] bottom-0 rounded bg-gradient-to-b from-[#FFD976] to-[#EFB52C] border-t border-white/40" />
                        </div>
                        <span className="flex-1 min-w-0 text-sm font-bold text-white truncate">{nom}</span>
                        {vues > 0 && (
                          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/25">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {vues}/{nombre}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 tabular-nums">
                          {nombre} procédure{nombre > 1 ? 's' : ''}
                        </span>
                        {estSuperAdmin ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              title="Renommer"
                              onClick={() => void renommerDossier(nom)}
                              className="w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[#F7BC5F]" />
                            </button>
                            <button
                              type="button"
                              title="Supprimer"
                              onClick={() => void supprimerDossier(nom, nombre)}
                              className="w-7 h-7 rounded-lg text-rose-400 hover:bg-rose-500/20 flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Zone de dépôt vers un autre dossier : s'affiche UNIQUEMENT quand on glisse une procédure */}
          {ressourceEnDrag && estSuperAdmin && rubriques.length > 1 && (
            <div className="mb-5 p-3 rounded-2xl bg-[#0b1e22]/90 border border-[#F7BC5F]/40 shadow-lg">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#F7BC5F] mb-2">
                Déposer dans un autre dossier :
              </p>
              <div className="flex flex-wrap gap-1.5">
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
                        setRessourceEnDrag(null);
                        const id = e.dataTransfer.getData('text/plain');
                        const ressource = ressources.find((r) => r.id === id);
                        if (ressource) void deplacerVers(ressource, nom);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                        dossierSurvole === nom
                          ? 'bg-[#F7BC5F] border-[#F7BC5F] text-slate-950 scale-105 shadow-md'
                          : 'bg-[#051113] border-white/10 text-slate-200'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 text-[#F7BC5F]" />
                      <span className="truncate max-w-[180px]">{nom}</span>
                      <span className="opacity-60 text-[10px]">({nombre})</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* ── LES PROCÉDURES (dans un dossier ou lors d'une recherche) ─── */}
          {chargement ? (
            <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-[#F7BC5F]" />
              <span className="text-sm">Chargement de l'Académy…</span>
            </div>
          ) : ressources.length === 0 && dossiersEnfants.length === 0 ? (
            <div className="p-12 text-center bg-[#0b1e22]/60 border border-dashed border-white/15 rounded-2xl shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 mx-auto mb-3.5 flex items-center justify-center text-[#F7BC5F]">
                <GraduationCap className="w-6 h-6 stroke-[2]" />
              </div>
              <p className="text-sm font-bold text-white">L'Académy est vide pour le moment.</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {estSuperAdmin
                  ? 'Créez un dossier ou ajoutez votre première procédure (PDF ou vidéo).'
                  : "Les procédures de l'agence apparaîtront ici dès qu'elles seront publiées."}
              </p>
            </div>
          ) : auNiveauDossiers ? null : visibles.length === 0 && dossiersEnfants.length === 0 ? (
            <div className="p-10 text-center bg-[#0b1e22]/60 border border-white/10 rounded-2xl shadow-xl">
              <p className="text-sm font-semibold text-slate-300">
                {enRecherche
                  ? `Aucune procédure ne correspond à « ${recherche} ».`
                  : 'Ce dossier ne contient pas encore de procédure.'}
              </p>
              {estSuperAdmin && !enRecherche && (
                <button
                  onClick={ouvrirAjout}
                  className="mt-3.5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] text-slate-950 text-xs font-bold shadow-md shadow-[#F7BC5F]/20 hover:brightness-110 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  Ajouter une procédure ici
                </button>
              )}
            </div>
          ) : visibles.length === 0 ? null : vueDossiers === 'liste' ? (
            /* Affichage en LISTE des procédures : ultra lisible et moderne */
            <div className="rounded-2xl bg-[#0b1e22]/75 backdrop-blur-md border border-white/10 shadow-lg divide-y divide-white/10 overflow-hidden">
              {visibles.map((r) => {
                const estVideo = r.type === 'video';
                const estValidee = validees.has(r.id);
                return (
                  <div
                    key={r.id}
                    onClick={() => ouvrirRessource(r)}
                    draggable={estSuperAdmin}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', r.id);
                      setRessourceEnDrag(r.id);
                    }}
                    onDragEnd={() => setRessourceEnDrag(null)}
                    className="group flex items-center gap-3.5 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    {/* Miniature ou icône */}
                    {r.image_url ? (
                      <img
                        src={r.image_url}
                        alt=""
                        className="w-14 h-10 rounded-lg object-cover bg-[#051113] border border-white/10 shrink-0"
                      />
                    ) : (
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                          estVideo
                            ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                            : 'bg-[#F7BC5F]/15 border-[#F7BC5F]/30 text-[#FAD592]'
                        }`}
                      >
                        {estVideo ? <PlayCircle className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                      </div>
                    )}

                    {/* Titre & infos */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-white group-hover:text-[#FAD592] transition-colors truncate">
                          {r.titre}
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase shrink-0 border ${
                            estVideo
                              ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                              : 'bg-white/10 text-slate-300 border-white/15'
                          }`}
                        >
                          {estVideo ? 'Vidéo' : 'PDF'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {enRecherche ? `${r.rubrique} · ` : ''}
                        {r.description || (r.auteur ? `Par ${r.auteur}` : 'Cliquer pour ouvrir')}
                        {r.duree ? ` · ${r.duree}` : ''}
                      </p>
                    </div>

                    {/* Bouton Lu / Marquer lu */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void basculerValidation(r);
                      }}
                      disabled={validationEnCours === r.id}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
                        estValidee
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-xs'
                          : 'bg-white/8 text-slate-300 hover:bg-white/15 border border-white/10'
                      }`}
                    >
                      {validationEnCours === r.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F7BC5F]" />
                      ) : estValidee ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Circle className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">{estValidee ? 'Lu' : 'Marquer lu'}</span>
                    </button>

                    {estSuperAdmin && (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => ouvrirModification(r)}
                          title="Modifier"
                          className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5 text-[#F7BC5F]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void supprimer(r)}
                          title="Supprimer"
                          className="w-8 h-8 rounded-lg text-rose-400 hover:bg-rose-500/20 flex items-center justify-center transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Affichage en GRILLE des procédures : cartes épurées, design et lisibles */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visibles.map((r) => {
                const estVideo = r.type === 'video';
                const estValidee = validees.has(r.id);
                const nbValidations = validationsParRessource.get(r.id) || 0;
                return (
                  <article
                    key={r.id}
                    draggable={estSuperAdmin}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', r.id);
                      setRessourceEnDrag(r.id);
                    }}
                    onDragEnd={() => setRessourceEnDrag(null)}
                    onDragOver={(e) => {
                      if (!estSuperAdmin || !dansUnDossier) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const fraction = (e.clientX - rect.left) / rect.width;
                      setRessourceSurvolee(r.id);
                      setRessourceSurvolIntention(fraction < 0.5 ? 'avant' : 'apres');
                    }}
                    onDragLeave={() => {
                      setRessourceSurvolee((v) => (v === r.id ? null : v));
                      setRessourceSurvolIntention((v) => (ressourceSurvolee === r.id ? null : v));
                    }}
                    onDrop={(e) => {
                      if (!estSuperAdmin || !dansUnDossier) return;
                      e.preventDefault();
                      const intention = ressourceSurvolIntention;
                      setRessourceSurvolee(null);
                      setRessourceSurvolIntention(null);
                      setRessourceEnDrag(null);
                      const idSource = e.dataTransfer.getData('text/plain');
                      if (idSource && intention) void reordonnerRessource(idSource, r.id, intention);
                    }}
                    className={`group relative bg-[#0b1e22]/75 hover:bg-[#0f282e]/95 backdrop-blur-md rounded-2xl border border-white/10 hover:border-[#F7BC5F]/50 overflow-hidden shadow-lg hover:shadow-[0_16px_40px_rgba(0,0,0,0.6)] flex flex-col transition-all duration-300 hover:-translate-y-1 ${
                      deplacementEnCours === r.id ? 'opacity-50' : ''
                    } ${
                      ressourceSurvolee === r.id
                        ? ressourceSurvolIntention === 'avant'
                          ? 'border-l-4 border-l-[#F7BC5F]'
                          : 'border-r-4 border-r-[#F7BC5F]'
                        : ''
                    }`}
                  >
                    {/* Aperçu visuel sobre */}
                    <button
                      onClick={() => ouvrirRessource(r)}
                      className="relative block w-full aspect-[16/9] bg-[#051113] overflow-hidden border-b border-white/10 cursor-pointer"
                    >
                      {r.image_url ? (
                        <img
                          src={r.image_url}
                          alt=""
                          className="w-full h-full object-contain object-center transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div
                          className={`w-full h-full flex flex-col items-center justify-center gap-1.5 ${
                            estVideo ? 'bg-gradient-to-br from-[#0c2229] to-[#081518] text-blue-400' : 'bg-gradient-to-br from-[#122327] to-[#081417] text-[#F7BC5F]'
                          }`}
                        >
                          {estVideo ? <PlayCircle className="w-10 h-10 stroke-[1.75]" /> : <FileText className="w-10 h-10 stroke-[1.75]" />}
                          <span className="text-[11px] font-semibold text-slate-300">
                            {estVideo ? 'Regarder la vidéo' : 'Ouvrir le document'}
                          </span>
                        </div>
                      )}

                      {/* Pastille PDF / Vidéo */}
                      <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-lg bg-black/75 backdrop-blur-md text-white border border-white/15 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md">
                        {estVideo ? <PlayCircle className="w-3 h-3 text-blue-400" /> : <FileText className="w-3 h-3 text-[#F7BC5F]" />}
                        {estVideo ? 'Vidéo' : 'PDF'}
                        {r.duree && <span className="font-normal text-slate-300">· {r.duree}</span>}
                      </span>
                    </button>

                    {/* Actions admin au survol */}
                    {estSuperAdmin && (
                      <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          type="button"
                          onClick={() => {
                            ressourcePourCouverture.current = r;
                            champCouvertureRapide.current?.click();
                          }}
                          title={r.image_url ? "Changer l'image" : 'Ajouter une image'}
                          className="w-7 h-7 rounded-lg bg-black/80 backdrop-blur-md text-white hover:text-[#F7BC5F] border border-white/15 flex items-center justify-center shadow-md cursor-pointer transition-colors"
                        >
                          {couvertureEnCours === r.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F7BC5F]" />
                          ) : (
                            <ImagePlus className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => ouvrirModification(r)}
                          title="Modifier"
                          className="w-7 h-7 rounded-lg bg-black/80 backdrop-blur-md text-white hover:text-[#F7BC5F] border border-white/15 flex items-center justify-center shadow-md cursor-pointer transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void supprimer(r)}
                          title="Supprimer"
                          className="w-7 h-7 rounded-lg bg-rose-600/90 text-white hover:bg-rose-600 border border-rose-400/40 flex items-center justify-center shadow-md cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Corps de la carte */}
                    <div className="flex-1 flex flex-col justify-between p-3.5 gap-3">
                      <div>
                        {enRecherche && (
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#F7BC5F] mb-1 truncate">
                            {r.rubrique}
                          </p>
                        )}
                        <button onClick={() => ouvrirRessource(r)} className="text-left w-full cursor-pointer">
                          <h3 className="text-sm font-bold text-white leading-snug line-clamp-2 group-hover:text-[#FAD592] transition-colors">
                            {r.titre}
                          </h3>
                        </button>
                        {r.description && (
                          <p className="mt-1 text-xs text-slate-400 leading-relaxed line-clamp-2">{r.description}</p>
                        )}
                      </div>

                      {/* Pied de carte : auteur/lecteurs + bouton Lu */}
                      <div className="pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {r.auteur_photo_url ? (
                            <img
                              src={r.auteur_photo_url}
                              alt=""
                              className="w-6 h-6 rounded-full object-cover ring-1 ring-white/20 shrink-0"
                            />
                          ) : r.auteur ? (
                            <span className="w-6 h-6 rounded-full bg-white/10 text-[#FAD592] border border-white/15 text-[10px] font-bold flex items-center justify-center shrink-0">
                              {initiales(r.auteur)}
                            </span>
                          ) : null}
                          {r.auteur ? (
                            <span className="text-xs text-slate-300 truncate">{r.auteur}</span>
                          ) : estSuperAdmin && nbValidations > 0 ? (
                            <span className="text-[11px] text-slate-400 flex items-center gap-1" title={`${nbValidations} validation(s)`}>
                              <Users className="w-3 h-3 text-[#F7BC5F]" /> {nbValidations}
                            </span>
                          ) : <span />}
                        </div>

                        <button
                          type="button"
                          onClick={() => void basculerValidation(r)}
                          disabled={validationEnCours === r.id}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors shrink-0 cursor-pointer disabled:opacity-60 ${
                            estValidee
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/8 text-slate-300 hover:bg-white/15 border border-white/10'
                          }`}
                        >
                          {validationEnCours === r.id ? (
                            <Loader2 className="w-3 h-3 animate-spin text-[#F7BC5F]" />
                          ) : estValidee ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <Circle className="w-3 h-3" />
                          )}
                          <span>{estValidee ? 'Lu' : 'Marquer lu'}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── LECTEUR PLEIN ÉCRAN ───────────────────────────────────────────── */}
      {ouverte && (
        <div ref={cadreLecteur} className="fixed inset-0 z-[100] bg-[#050f11] flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-white/10 bg-[#07191b] shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => setOuverte(null)}
                title="Retour"
                className="shrink-0 h-9 px-3 rounded-xl flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Retour</span>
              </button>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{ouverte.titre}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  {ouverte.rubrique}
                  {ouverte.auteur ? ` · ${ouverte.auteur}` : ''}
                  {ouverte.duree ? ` · ${ouverte.duree}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => void basculerValidation(ouverte)}
                disabled={validationEnCours === ouverte.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer disabled:opacity-60 ${
                  validees.has(ouverte.id)
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-white/10 text-white border-white/15 hover:bg-white/15'
                }`}
              >
                {validationEnCours === ouverte.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : validees.has(ouverte.id) ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Circle className="w-3.5 h-3.5" />
                )}
                <span>{validees.has(ouverte.id) ? 'Lu' : 'Marquer lu'}</span>
              </button>

              <button
                onClick={() => void basculerPleinEcran()}
                title={pleinEcran ? 'Quitter le plein écran' : 'Plein écran'}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-bold cursor-pointer"
              >
                {pleinEcran ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              <a
                href={lienOuvrable(ouverte)}
                target="_blank"
                rel="noopener noreferrer"
                title="Ouvrir dans un nouvel onglet"
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>

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

      {/* ── MODALE D'AJOUT / MODIFICATION SIMPLIFIÉE ──────────────────────── */}
      {formOuvert && estSuperAdmin && (
        <div
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !enregistrement && setFormOuvert(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar rounded-2xl bg-[#091a1e] border border-white/15 p-5 sm:p-6 space-y-4 shadow-2xl text-white"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="text-base font-extrabold text-white">
                {enModification ? 'Modifier la procédure' : 'Nouvelle procédure'}
              </h3>
              <button
                onClick={() => setFormOuvert(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. Le fichier ou le lien (en premier : pré-remplit le titre et le type automatiquement) */}
            <div className="rounded-xl border border-white/10 bg-[#051113] p-3.5 space-y-2.5">
              <label className="block text-xs font-bold text-slate-300">1. Document PDF ou vidéo</label>
              <input
                ref={champFichier}
                type="file"
                accept="application/pdf,video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFichier(f);
                  if (f) {
                    if (f.type.startsWith('video/')) setType('video');
                    else if (f.type === 'application/pdf') setType('pdf');
                    if (!titre.trim()) {
                      setTitre(f.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '));
                    }
                  }
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => champFichier.current?.click()}
                className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 hover:border-[#F7BC5F]/60 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 text-white cursor-pointer transition-colors"
              >
                <Upload className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                <span className="truncate">
                  {fichier ? fichier.name : 'Choisir un fichier PDF ou une vidéo sur votre appareil'}
                </span>
              </button>

              <div className="relative">
                <LinkIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={lienExterne}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLienExterne(val);
                    if (/youtube\.com|youtu\.be|vimeo\.com/i.test(val)) setType('video');
                  }}
                  placeholder="Ou coller un lien YouTube, Vimeo ou Google Drive…"
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-white/15 bg-[#030c0e] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
            </div>

            {/* 2. Titre & Dossier */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">2. Titre de la procédure</label>
                <input
                  value={titre}
                  onChange={(e) => setTitre(e.target.value)}
                  placeholder="Ex : Rédiger un mandat exclusif"
                  className="w-full px-3 py-2.5 rounded-xl border border-white/15 bg-[#051113] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1">Dossier</label>
                  {nouvelleRubrique ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={rubrique}
                        onChange={(e) => setRubrique(e.target.value)}
                        placeholder="Nom du nouveau dossier"
                        className="w-full min-w-0 px-3 py-2 rounded-xl border border-white/15 bg-[#051113] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setNouvelleRubrique(false);
                          setRubrique(dossierActif || rubriques[0]?.[0] || RUBRIQUES_SUGGEREES[0]);
                        }}
                        className="shrink-0 text-xs font-bold text-[#F7BC5F] hover:text-[#ffcd78] underline cursor-pointer"
                      >
                        Liste
                      </button>
                    </div>
                  ) : (
                    <select
                      value={rubrique}
                      onChange={(e) => {
                        if (e.target.value === '__nouvelle__') {
                          setNouvelleRubrique(true);
                          setRubrique('');
                        } else {
                          setRubrique(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-white/15 bg-[#051113] text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                    >
                      {[...new Set([...rubriques.map(([n]) => n), ...RUBRIQUES_SUGGEREES, rubrique])]
                        .filter(Boolean)
                        .sort((a, b) => a.localeCompare(b, 'fr'))
                        .map((n) => (
                          <option key={n} value={n} className="bg-[#091a1e] text-white">{n}</option>
                        ))}
                      <option value="__nouvelle__" className="bg-[#091a1e] text-[#F7BC5F]">+ Nouveau dossier…</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Format</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as 'pdf' | 'video')}
                    className="w-full px-3 py-2 rounded-xl border border-white/15 bg-[#051113] text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  >
                    <option value="pdf" className="bg-[#091a1e] text-white">Document PDF</option>
                    <option value="video" className="bg-[#091a1e] text-white">Vidéo</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 3. Courte description & image de couverture (optionnels) */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Description courte <span className="font-normal text-slate-500">(optionnel)</span>
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="En une phrase : ce qu'on retrouve dans cette procédure…"
                  className="w-full px-3 py-2 rounded-xl border border-white/15 bg-[#051113] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] resize-y"
                />
              </div>

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
                  className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <ImagePlus className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                  <span className="truncate">
                    {couverture ? couverture.name : couvertureActuelle ? "Changer l'image de couverture" : 'Ajouter une image de couverture (optionnel)'}
                  </span>
                </button>
              </div>
            </div>

            {/* Options supplémentaires repliées par défaut */}
            <details className="rounded-xl border border-white/10 bg-[#051113]/70 px-3.5 py-2.5 text-xs">
              <summary className="font-bold text-[#F7BC5F] cursor-pointer select-none">
                Plus d'options (auteur, durée…)
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Auteur</label>
                  <input
                    value={auteur}
                    onChange={(e) => setAuteur(e.target.value)}
                    placeholder="Prénom Nom"
                    className="w-full px-3 py-2 rounded-lg border border-white/15 bg-[#030c0e] text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Durée ou nb de pages</label>
                  <input
                    value={duree}
                    onChange={(e) => setDuree(e.target.value)}
                    placeholder="Ex : 5 min ou 3 pages"
                    className="w-full px-3 py-2 rounded-lg border border-white/15 bg-[#030c0e] text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="sm:col-span-2">
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
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 hover:bg-white/10 text-xs text-slate-300 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <ImagePlus className="w-3.5 h-3.5 text-[#F7BC5F]" />
                    <span className="truncate">
                      {portrait ? portrait.name : portraitActuel ? "Changer la photo de l'auteur" : "Photo de l'auteur (optionnel)"}
                    </span>
                  </button>
                </div>
              </div>
            </details>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setFormOuvert(false)}
                disabled={enregistrement}
                className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-white/10 text-xs font-bold cursor-pointer transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => void enregistrer()}
                disabled={enregistrement}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] hover:brightness-110 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-md shadow-[#F7BC5F]/20 cursor-pointer transition-all"
              >
                {enregistrement && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {enModification ? 'Enregistrer' : 'Ajouter la procédure'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
