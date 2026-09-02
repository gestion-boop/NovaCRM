import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  GraduationCap, FileText, PlayCircle, Plus, Search, Trash2, X, Loader2, Upload, Link as LinkIcon, Pencil,
  CheckCircle2, Circle, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { getCachedAccessToken, requestWorkspaceAccessToken } from '@/lib/workspace';
import { uploadDocumentToDrive } from '@/lib/documentDrive';

/**
 * Académy — bibliothèque de procédures (PDF et vidéos) d'une agence.
 *
 * Demandé le 2 septembre : « une tuile Académy ImmoSphera, on regroupera
 * dedans toutes les procédures en PDF et voir vidéos... pour que les agents co
 * se repèrent très facilement ».
 *
 * Le repérage tient à trois choses, et à rien d'autre :
 *   1. des RUBRIQUES visibles d'emblée, en tête d'écran, avec le nombre de
 *      fiches de chacune — on sait où chercher avant même de lire ;
 *   2. une RECHERCHE qui filtre pendant la frappe, pour qui sait déjà ce
 *      qu'il veut ;
 *   3. des fiches qui annoncent leur TYPE et leur DURÉE avant l'ouverture :
 *      personne ne clique sur une vidéo de 20 minutes entre deux rendez-vous
 *      sans le savoir.
 *
 * Les fichiers vivent dans le Google Drive de l'agence (même circuit que le
 * Coffre Documents) : le CRM ne garde que le lien.
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

/**
 * Transforme un lien de partage en lien affichable dans une fenêtre intégrée.
 *
 * Demandé le 2 septembre : « pour les PDF et vidéos, je voudrais avoir un
 * visuel en iframe ». Les PDF passent donc par la même fenêtre que les
 * vidéos, au lieu de partir dans un onglet séparé.
 */
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

export default function AcademyView() {
  const { activeAgency, currentUser, userProfile } = useAuth();
  const estSuperAdmin = userProfile?.role === 'super_admin';

  const [ressources, setRessources] = useState<Ressource[]>([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [rubriqueActive, setRubriqueActive] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<Ressource | null>(null);
  // Demandé le 2 septembre : « les utilisateurs, une fois vu, pourront cocher
  // valider la procédure comme quoi ils l'ont vue. » Validation personnelle :
  // chacun coche pour lui. Les super admins voient en plus combien de
  // personnes ont validé chaque procédure.
  const [validees, setValidees] = useState<Set<string>>(new Set());
  const [validationsParRessource, setValidationsParRessource] = useState<Map<string, number>>(new Map());
  const [validationEnCours, setValidationEnCours] = useState<string | null>(null);

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
  const [enregistrement, setEnregistrement] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);

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
          : e?.message || 'Impossible d\'enregistrer cette validation.'
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
        r.rubrique.toLowerCase().includes(q)
      );
    });
  }, [ressources, recherche, rubriqueActive]);

  // Regroupement par rubrique : sans rubrique active, on garde les intertitres
  // — une longue liste à plat, c'est exactement ce qu'on cherchait à éviter.
  const groupes = useMemo(() => {
    const parRubrique = new Map<string, Ressource[]>();
    visibles.forEach((r) => {
      const liste = parRubrique.get(r.rubrique) || [];
      liste.push(r);
      parRubrique.set(r.rubrique, liste);
    });
    return Array.from(parRubrique.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [visibles]);

  const reinitialiserFormulaire = () => {
    setEnModification(null);
    setTitre('');
    setRubrique(rubriques[0]?.[0] || RUBRIQUES_SUGGEREES[0]);
    setDescription('');
    setType('pdf');
    setDuree('');
    setLienExterne('');
    setFichier(null);
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
    setFormOuvert(true);
  };

  const enregistrer = async () => {
    if (!currentUser || !activeAgency?.id || activeAgency.id === 'all') {
      toast.error('Sélectionnez une société avant d\'ajouter une ressource.');
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
        toast.success('Ressource ajoutée à l\'Académy.');
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
    // n'a lieu que si le lien ne peut pas s'afficher dans un cadre — un
    // partage Dropbox, une page web quelconque.
    if (lienIntegrable(url)) setOuverte(r);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (activeAgency?.id === 'all') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center px-6">
        <GraduationCap className="h-8 w-8 text-slate-500" />
        <p className="text-sm text-slate-400">
          Sélectionnez une société pour ouvrir son Académy.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#050f11] rounded-2xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/30 text-[#F7BC5F] flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">Académy {activeAgency?.name}</h1>
            <p className="text-xs text-gray-400">
              Toutes les procédures de l'agence, en PDF et en vidéo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher une procédure…"
              className="w-56 sm:w-72 pl-9 pr-3 py-2 rounded-xl bg-[#07191b] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
            />
          </div>
          {estSuperAdmin && (
            <button
              onClick={ouvrirAjout}
              className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs flex items-center gap-2 shadow-md shrink-0"
            >
              <Plus className="w-4 h-4" />
              Ajouter
            </button>
          )}
        </div>
      </div>

      {/* Avancement personnel : combien de procédures restent à voir. Un
          chiffre, pas un tableau de bord — il sert à savoir s'il reste
          quelque chose, pas à être analysé. */}
      {ressources.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-[#0a1e20] border border-white/10 px-4 py-3">
          <CheckCircle2
            className={`w-5 h-5 shrink-0 ${validees.size === ressources.length ? 'text-emerald-400' : 'text-slate-500'}`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white">
              {validees.size === ressources.length
                ? 'Toutes les procédures sont validées.'
                : `${validees.size} procédure${validees.size > 1 ? 's' : ''} validée${validees.size > 1 ? 's' : ''} sur ${ressources.length}`}
            </p>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  validees.size === ressources.length ? 'bg-emerald-500' : 'bg-[#F7BC5F]'
                }`}
                style={{ width: `${Math.round((validees.size / ressources.length) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Rubriques — on voit où chercher avant même de lire. */}
      {rubriques.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setRubriqueActive(null)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              rubriqueActive === null
                ? 'bg-[#F7BC5F] text-slate-950 border-[#F7BC5F]'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
            }`}
          >
            Tout ({ressources.length})
          </button>
          {rubriques.map(([nom, nombre]) => (
            <button
              key={nom}
              onClick={() => setRubriqueActive(nom === rubriqueActive ? null : nom)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
                rubriqueActive === nom
                  ? 'bg-[#F7BC5F] text-slate-950 border-[#F7BC5F]'
                  : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
              }`}
            >
              {nom} ({nombre})
            </button>
          ))}
        </div>
      )}

      {chargement ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l'Académy…
        </div>
      ) : ressources.length === 0 ? (
        <div className="p-12 text-center bg-white/5 border border-dashed border-white/10 rounded-2xl">
          <GraduationCap className="w-9 h-9 mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-300">L'Académy est vide pour le moment.</p>
          <p className="text-xs text-slate-500 mt-1">
            {estSuperAdmin
              ? 'Ajoutez une première procédure : un PDF déposé dans le Drive, ou un lien vers une vidéo.'
              : 'Les procédures de l\'agence apparaîtront ici dès qu\'elles seront publiées.'}
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="p-12 text-center text-sm text-slate-400 bg-white/5 border border-white/10 rounded-2xl">
          Aucune procédure ne correspond à « {recherche} ».
        </div>
      ) : (
        <div className="space-y-6">
          {groupes.map(([nom, liste]) => (
            <div key={nom} className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#F9C977]">{nom}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {liste.map((r) => {
                  const estVideo = r.type === 'video';
                  const accent = estVideo ? '#38bdf8' : '#fb7185';
                  return (
                    <div
                      key={r.id}
                      className="group relative rounded-2xl bg-[#0a1e20] border border-white/10 hover:border-[#F7BC5F]/40 transition-colors overflow-hidden flex flex-col"
                    >
                      <button
                        onClick={() => ouvrirRessource(r)}
                        className="flex-1 text-left p-4 flex gap-3.5 min-w-0"
                      >
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
                          style={{ background: `${accent}1a`, borderColor: `${accent}44`, color: accent }}
                        >
                          {estVideo ? <PlayCircle className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-white leading-snug">{r.titre}</p>
                          {r.description && (
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">{r.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2 text-[10px] font-bold uppercase tracking-wider">
                            <span style={{ color: accent }}>{estVideo ? 'Vidéo' : 'PDF'}</span>
                            {r.duree && <span className="text-slate-500">· {r.duree}</span>}
                            {estSuperAdmin && (validationsParRessource.get(r.id) || 0) > 0 && (
                              <span className="text-slate-500 flex items-center gap-1 normal-case tracking-normal">
                                · <Users className="w-3 h-3" />
                                {validationsParRessource.get(r.id)} validée
                                {(validationsParRessource.get(r.id) || 0) > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* La validation est un geste à part, jamais déclenchée
                          par l'ouverture : on coche parce qu'on a lu, pas
                          parce qu'on a cliqué. */}
                      <button
                        onClick={() => void basculerValidation(r)}
                        disabled={validationEnCours === r.id}
                        className={`flex items-center gap-2 px-4 py-2.5 border-t text-xs font-bold transition-colors disabled:opacity-60 ${
                          validees.has(r.id)
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                            : 'border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {validationEnCours === r.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : validees.has(r.id) ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                        {validees.has(r.id) ? 'Procédure validée' : 'Marquer comme vue'}
                      </button>

                      {estSuperAdmin && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => ouvrirModification(r)}
                            title="Modifier"
                            className="w-7 h-7 rounded-lg bg-black/50 border border-white/10 text-slate-300 hover:text-[#F7BC5F] flex items-center justify-center"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void supprimer(r)}
                            title="Retirer de l'Académy"
                            className="w-7 h-7 rounded-lg bg-rose-500/15 border border-rose-500/25 text-rose-300 hover:bg-rose-500/25 flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lecteur vidéo */}
      {ouverte && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOuverte(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full ${ouverte.type === 'video' ? 'max-w-4xl' : 'max-w-5xl'} rounded-2xl bg-[#07191b] border border-[#1b4e52] overflow-hidden shadow-2xl`}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-[#144447]/60">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{ouverte.titre}</p>
                <p className="text-[11px] text-slate-400">{ouverte.rubrique}{ouverte.duree ? ` · ${ouverte.duree}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Certains PDF refusent d'être affichés dans un cadre : la
                    sortie de secours est toujours là, plutôt qu'un cadre
                    blanc sans explication. */}
                <a
                  href={lienOuvrable(ouverte)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-slate-400 hover:text-[#F9C977] underline decoration-dotted underline-offset-4"
                >
                  Ouvrir dans un onglet
                </a>
                <button onClick={() => setOuverte(null)} className="text-slate-400 hover:text-white text-xl leading-none px-1">×</button>
              </div>
            </div>
            {/* Une vidéo garde ses proportions ; un PDF se lit en hauteur. */}
            <div className={ouverte.type === 'video' ? 'aspect-video bg-black' : 'h-[78vh] bg-[#0b1416]'}>
              <iframe
                src={lienIntegrable(lienOuvrable(ouverte)) || ''}
                title={ouverte.titre}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
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
                {enModification ? 'Modifier la ressource' : 'Ajouter une ressource'}
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
              <label className="block text-xs font-bold text-slate-300 mb-1">Description (facultatif)</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Une phrase : à quoi sert cette procédure, quand s'en servir."
                className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Durée ou volume (facultatif)</label>
              <input
                value={duree}
                onChange={(e) => setDuree(e.target.value)}
                placeholder="8 min · 4 pages"
                className="w-full px-3 py-2.5 rounded-xl bg-[#030d0f] border border-[#153c3f] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Affiché sur la fiche : personne ne lance une vidéo de 20 minutes entre deux rendez-vous sans le savoir.
              </p>
            </div>

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
                  <Upload className="w-4 h-4 text-[#F7BC5F]" />
                  {fichier ? fichier.name : 'Déposer un fichier dans le Drive de l\'agence'}
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
