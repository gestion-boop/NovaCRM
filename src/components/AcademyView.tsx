import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, PlayCircle, Plus, Search, Trash2, X, Loader2, Upload, Link as LinkIcon, Pencil,
  CheckCircle2, Circle, Users, ImagePlus, GraduationCap,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { getCachedAccessToken, requestWorkspaceAccessToken } from '@/lib/workspace';
import { uploadDocumentToDrive } from '@/lib/documentDrive';

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
  const [rubriqueActive, setRubriqueActive] = useState<string | null>(null);
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
  const [fond, setFond] = useState<string | null>(null);
  const [fondEnCours, setFondEnCours] = useState(false);
  const champFond = useRef<HTMLInputElement>(null);

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

  const rubriques = useMemo(() => {
    const compte = new Map<string, number>();
    ressources.forEach((r) => compte.set(r.rubrique, (compte.get(r.rubrique) || 0) + 1));
    return Array.from(compte.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [ressources]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return ressources.filter((r) => {
      if (rubriqueActive && r.rubrique !== rubriqueActive) return false;
      if (!q) return true;
      return (
        r.titre.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.auteur || '').toLowerCase().includes(q) ||
        r.rubrique.toLowerCase().includes(q)
      );
    });
  }, [ressources, recherche, rubriqueActive]);

  const reinitialiserFormulaire = () => {
    setEnModification(null);
    setTitre('');
    setRubrique(rubriques[0]?.[0] || RUBRIQUES_SUGGEREES[0]);
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
      let driveId: string | null = enModification?.drive_file_id ?? null;
      let driveLien: string | null = enModification?.drive_web_view_link ?? null;

      if (fichier) {
        // Même circuit que le Coffre Documents : le fichier part dans le Drive
        // de l'agence, le CRM ne garde que le lien.
        let token = getCachedAccessToken();
        if (!token) token = await requestWorkspaceAccessToken();
        if (!token) throw new Error('Connexion Google Drive nécessaire pour déposer un fichier.');
        const envoi = await uploadDocumentToDrive(token, fichier, `${activeAgency.name} — Académy`);
        driveId = envoi.fileId;
        driveLien = envoi.fileUrl;
      }

      const imageUrl = couverture ? await deposerImage(couverture, 'couverture') : couvertureActuelle;
      const portraitUrl = portrait ? await deposerImage(portrait, 'portrait') : portraitActuel;

      const valeurs = {
        agency_id: activeAgency.id,
        rubrique: rubrique.trim() || 'Général',
        titre: titre.trim(),
        description: description.trim() || null,
        type,
        drive_file_id: driveId,
        drive_web_view_link: driveLien,
        external_url: lienExterne.trim() || null,
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
    if (!window.confirm(`Supprimer « ${r.titre} » de l'Académy ? Le fichier reste dans le Drive.`)) return;
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

  // Deux niveaux, comme demandé : d'abord des DOSSIERS, puis les formations
  // qu'ils contiennent. La recherche, elle, court-circuite les dossiers : qui
  // sait ce qu'il cherche ne veut pas ouvrir trois classeurs.
  const enRecherche = recherche.trim().length > 0;
  const auNiveauDossiers = rubriqueActive === null && !enRecherche;

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
      <div className={`px-4 sm:px-6 lg:px-8 pb-16 ${fond ? 'pt-32 sm:pt-44' : 'pt-10'}`}>
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

          {/* Recherche + actions */}
          <div className="flex flex-wrap items-center gap-3 justify-center">
            <div className="relative flex-1 min-w-[240px] max-w-2xl">
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher une procédure…"
                className="w-full pl-6 pr-14 py-3.5 rounded-full bg-white text-slate-800 placeholder-slate-400 text-sm shadow-lg border border-black/5 focus:outline-none focus:ring-2 focus:ring-[#E0A21A]"
              />
              <Search className="w-5 h-5 text-slate-400 absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {estSuperAdmin && (
              <>
                <button
                  onClick={ouvrirAjout}
                  className="px-4 py-3 rounded-full bg-[#1b2b2e] hover:bg-[#0f1c1e] text-white font-bold text-xs flex items-center gap-2 shadow-lg"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter une procédure
                </button>
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
                  className="px-4 py-3 rounded-full bg-white/80 hover:bg-white border border-black/10 text-slate-700 font-bold text-xs flex items-center gap-2 shadow disabled:opacity-60"
                >
                  {fondEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                  Image de fond
                </button>
              </>
            )}
          </div>

          {/* Avancement personnel */}
          {ressources.length > 0 && (
            <div className="mt-5 flex items-center justify-center gap-2.5 text-xs text-slate-700">
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

          {/* ── NIVEAU 1 : les dossiers ─────────────────────────────────
              Demandé : « un vrai dossier jaune comme on a l'habitude de voir,
              et quand on clique dedans on accède aux différentes formations ».
              Le dossier est dessiné en CSS — onglet, corps, rabat avant — pour
              rester net à toutes les tailles et suivre le thème sans image. */}
          {auNiveauDossiers && !chargement && rubriques.length > 0 && (
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-8">
              {rubriques.map(([nom, nombre]) => {
                const vues = ressources.filter((r) => r.rubrique === nom && validees.has(r.id)).length;
                return (
                  <button
                    key={nom}
                    onClick={() => setRubriqueActive(nom)}
                    className="group flex flex-col items-center focus:outline-none"
                  >
                    <div className="relative w-full max-w-[210px] aspect-[5/4] transition-transform duration-200 group-hover:-translate-y-1.5">
                      {/* dos du dossier */}
                      <div className="absolute inset-x-0 top-[12%] bottom-0 rounded-xl bg-gradient-to-b from-[#E8B33A] to-[#C88C12] shadow-[0_14px_24px_-12px_rgba(0,0,0,0.55)]" />
                      {/* onglet */}
                      <div className="absolute left-[4%] top-[2%] h-[16%] w-[46%] rounded-t-lg bg-gradient-to-b from-[#F2C55C] to-[#E3AE33]" />
                      {/* rabat avant */}
                      <div className="absolute inset-x-0 top-[28%] bottom-0 rounded-xl bg-gradient-to-b from-[#FFD976] to-[#EFB52C] border-t border-white/40 shadow-inner" />
                      {/* compteur */}
                      <span className="absolute right-3 top-[36%] px-2.5 py-1 rounded-full bg-black/25 text-white text-[11px] font-black">
                        {nombre}
                      </span>
                      {vues > 0 && (
                        <span className="absolute left-3 bottom-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/80 text-[10px] font-bold text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          {vues}/{nombre}
                        </span>
                      )}
                    </div>
                    <span className="mt-3 text-sm font-bold text-slate-800 text-center leading-snug group-hover:text-black">
                      {nom}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── NIVEAU 2 : le contenu d'un dossier ─────────────────────── */}
          {!auNiveauDossiers && (
            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={() => { setRubriqueActive(null); setRecherche(''); }}
                className="px-3.5 py-2 rounded-full bg-white/80 hover:bg-white border border-black/10 text-slate-700 text-xs font-bold shadow-sm"
              >
                ← Tous les dossiers
              </button>
              <h2 className="text-lg font-black text-slate-900 truncate">
                {enRecherche ? `Résultats pour « ${recherche.trim()} »` : rubriqueActive}
              </h2>
              <span className="text-xs text-slate-500">
                {visibles.length} procédure{visibles.length > 1 ? 's' : ''}
              </span>
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
                    className="group relative bg-white rounded-sm overflow-hidden shadow-xl flex flex-col transition-transform duration-200 hover:-translate-y-1"
                  >
                    {/* Couverture */}
                    <button
                      onClick={() => ouvrirRessource(r)}
                      className="relative block w-full aspect-[16/10] bg-slate-200 overflow-hidden"
                    >
                      {r.image_url ? (
                        <img
                          src={r.image_url}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                          {estVideo ? <PlayCircle className="w-10 h-10" /> : <FileText className="w-10 h-10" />}
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
        <div className="fixed inset-0 z-[100] bg-[#050f11] flex flex-col">
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
              <a
                href={lienOuvrable(ouverte)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-slate-400 hover:text-[#F9C977] underline decoration-dotted underline-offset-4 hidden sm:inline"
              >
                Ouvrir dans un onglet
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
                    {fichier ? fichier.name : "Déposer un fichier dans le Drive de l'agence"}
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
