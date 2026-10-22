import { useEffect, useState } from 'react';
import { Megaphone, Info, AlertTriangle, CheckCircle2, Eye, ExternalLink, AlertCircle, PenTool, BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import FireworksOverlay from './FireworksOverlay';
import ConfettiOverlay from './ConfettiOverlay';

/**
 * Bandeau d'annonce — ticket #22 (nouvelle base), étendu au ticket
 * "Paramètres/Nova/Utilisateurs/Annonces" (16/16), puis au ticket #241 qui
 * fait passer le système de 3 à 5 niveaux : Information (or) / À vérifier
 * (ambre) / Important (rouge) / Succès (vert) / Veille (bleu), chacun avec
 * sa propre mascotte Nova. L'ancien niveau "urgent" est retiré (remappé sur
 * "important" par la migration SQL du ticket #241) — c'est donc désormais
 * "important" qui porte la lecture obligatoire (aucun moyen de fermer sans
 * "J'ai compris" — les autres niveaux ont un "OK" plus discret), ciblage
 * personne/agence/toutes agences, lien direct vers un élément du CRM,
 * historique de lecture (announcement_reads, déjà en place), expiration
 * automatique.
 */
type AnnouncementLevel = 'info' | 'a_verifier' | 'important' | 'succes' | 'veille' | 'reponse_demandee' | 'signature_acte';

interface ActiveAnnouncement {
  id: string;
  message: string;
  level: AnnouncementLevel;
  link: string | null;
  isPoll: boolean;
}

interface PollOption {
  id: string;
  label: string;
}

const LEVEL_META: Record<AnnouncementLevel, {
  label: string;
  border: string;
  headerBg: string;
  iconBg: string;
  iconColor: string;
  buttonBg: string;
  buttonText: string;
  icon: typeof Info;
  mascotte: string;
}> = {
  // Ticket #241 : mascotte Nova réelle (fond transparent) au lieu de
  // l'ancien panneau entièrement dessiné en CSS. Sur demande explicite, on
  // utilise les logos "solo" individuels (public/nova/expressions/, images
  // nettes non issues d'un découpage de pancarte composite) plutôt que les
  // mascottes recadrées depuis les pancartes. Le texte affiché reste
  // toujours celui de `meta.label`/l'annonce elle-même (jamais un texte
  // figé dans l'image).
  info: {
    label: 'Information',
    border: 'border-[#F7BC5F]/50',
    headerBg: 'bg-[#F7BC5F]/10',
    iconBg: 'bg-[#F7BC5F]/20',
    iconColor: 'text-[#F9C977]',
    buttonBg: 'bg-[#F7BC5F] hover:bg-[#d9ab38]',
    buttonText: 'text-[#061719]',
    icon: Info,
    mascotte: '/nova/expressions/nova-neutre.png',
  },
  a_verifier: {
    label: 'À vérifier',
    border: 'border-amber-500/50',
    headerBg: 'bg-amber-500/10',
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-300',
    buttonBg: 'bg-amber-500 hover:bg-amber-400',
    buttonText: 'text-amber-950',
    icon: Megaphone,
    mascotte: '/nova/expressions/nova-attention.png',
  },
  important: {
    // Ancien "urgent" : c'est désormais "Important" qui porte la lecture
    // obligatoire (couleur rouge, aucun "Ignorer" possible).
    label: 'Important — lecture obligatoire',
    border: 'border-rose-500/50',
    headerBg: 'bg-rose-500/10',
    iconBg: 'bg-rose-500/20',
    iconColor: 'text-rose-300',
    buttonBg: 'bg-rose-500 hover:bg-rose-400',
    buttonText: 'text-white',
    icon: AlertTriangle,
    // Demandé (30/08/2026, mis à jour) : d'abord nova-important-alerte.png
    // (fond sombre non détouré, premier envoi) puis remplacée par
    // nova-novadji-danger.png — même mascotte panneau-danger, mais issue de
    // la planche "novadji" complète fournie ensuite (fond transparent
    // d'origine, cohérente avec le reste du jeu utilisé dans le chat, voir
    // src/lib/novaReactions.tsx). Règle "la dernière version envoyée prime".
    // Revu (30/08/2026, "gagner du temps envoi/réception") : .webp
    // allégé (~41 Ko au lieu de 617 Ko), voir novaReactions.tsx pour le
    // détail du redimensionnement — cette bannière est toujours résolue en
    // direct depuis cette constante (pas de chemin stocké par annonce en
    // base), donc aucun historique à préserver ici contrairement au chat.
    mascotte: '/nova/expressions/nova-novadji-danger.webp',
  },
  succes: {
    label: "Offre d'achat validée",
    border: 'border-emerald-500/50',
    headerBg: 'bg-emerald-500/10',
    iconBg: 'bg-emerald-500/20',
    iconColor: 'text-emerald-300',
    buttonBg: 'bg-emerald-500 hover:bg-emerald-400',
    buttonText: 'text-emerald-950',
    icon: CheckCircle2,
    mascotte: '/nova/expressions/nova-succes.png',
  },
  veille: {
    label: 'Veille',
    border: 'border-sky-500/50',
    headerBg: 'bg-sky-500/10',
    iconBg: 'bg-sky-500/20',
    iconColor: 'text-sky-300',
    buttonBg: 'bg-sky-500 hover:bg-sky-400',
    buttonText: 'text-sky-950',
    icon: Eye,
    mascotte: '/nova/expressions/nova-veille.png',
  },
  // Ticket #242 : deux pancartes spéciales supplémentaires, sur le modèle
  // des visuels "RÉPONSE DEMANDÉE SVP" / "SIGNATURE D'UN ACTE" fournis —
  // même principe que les 5 niveaux ci-dessus (mascotte + icône en médaillon
  // + gros titre + texte 100% dynamique en dessous, jamais de texte figé
  // dans une image).
  reponse_demandee: {
    label: 'Réponse demandée SVP',
    border: 'border-rose-500/50',
    headerBg: 'bg-rose-500/10',
    iconBg: 'bg-rose-500/20',
    iconColor: 'text-rose-300',
    buttonBg: 'bg-rose-500 hover:bg-rose-400',
    buttonText: 'text-white',
    icon: AlertCircle,
    mascotte: '/nova/expressions/nova-reponse-demandee.png',
  },
  signature_acte: {
    label: "Signature d'un acte authentique",
    border: 'border-[#F7BC5F]/50',
    headerBg: 'bg-[#F7BC5F]/10',
    iconBg: 'bg-[#F7BC5F]/20',
    iconColor: 'text-[#F9C977]',
    buttonBg: 'bg-[#F7BC5F] hover:bg-[#d9ab38]',
    buttonText: 'text-[#061719]',
    icon: PenTool,
    mascotte: '/nova/expressions/nova-signature.png',
  },
};

// Ticket #242 : "Sondage" n'est pas un niveau de plus — c'est le flag
// `is_poll` déjà existant (case "Transformer en sondage" du composeur) qui
// prend le dessus visuellement sur le niveau choisi, quel qu'il soit.
const POLL_META = {
  label: 'Sondage',
  border: 'border-[#F7BC5F]/50',
  headerBg: 'bg-[#F7BC5F]/10',
  iconBg: 'bg-[#F7BC5F]/20',
  iconColor: 'text-[#F9C977]',
  buttonBg: 'bg-[#F7BC5F] hover:bg-[#d9ab38]',
  buttonText: 'text-[#061719]',
  icon: BarChart3,
  mascotte: '/nova/expressions/nova-sourire.png',
};

const AnnouncementBanner = () => {
  const { currentUser, activeAgency, userProfile } = useAuth();
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [dismissing, setDismissing] = useState(false);
  // Demande explicite : "possibilité de créer un sondage" — options de
  // l'annonce active (si s'en est une) et choix sélectionné avant envoi.
  const [pollOptions, setPollOptions] = useState<PollOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;

    (async () => {
      const [{ data: active }, { data: reads }, { data: restrictions }] = await Promise.all([
        supabase.from('announcements').select('id, message, created_at, level, link, expires_at, target_user_id, is_poll').eq('is_active', true).order('created_at', { ascending: false }) as unknown as Promise<{ data: any[] | null }>,
        supabase.from('announcement_reads').select('announcement_id').eq('user_id', currentUser.uid),
        supabase.from('announcement_agencies').select('announcement_id, agency_id'),
      ]);
      if (cancelled) return;

      const readIds = new Set((reads || []).map((r: any) => r.announcement_id));
      const restrictedIds = new Set((restrictions || []).map((r: any) => r.announcement_id));
      const myAgencyIds = new Set(
        (restrictions || [])
          .filter((r: any) => userProfile?.agencyIds?.includes(r.agency_id) || activeAgency.id === r.agency_id)
          .map((r: any) => r.announcement_id)
      );

      // Signalé : "ne mets pas les annonces antécédentes" — un utilisateur
      // (ex. un stagiaire qui vient d'être invité) ne doit pas se retrouver
      // avec tout le backlog d'annonces publiées AVANT la création de son
      // compte marqué "non lu". On ne montre que celles postérieures.
      const accountCreatedAt = userProfile?.createdAt ? new Date(userProfile.createdAt).getTime() : 0;
      const now = Date.now();

      const next = (active || []).find((a: any) => {
        if (readIds.has(a.id)) return false;
        if (new Date(a.created_at).getTime() < accountCreatedAt) return false;
        // Expiration automatique — une annonce expirée n'est plus montrée,
        // même jamais lue.
        if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
        // Ciblage sur une personne précise : invisible pour tout le monde
        // d'autre, quelle que soit la restriction d'agence par ailleurs.
        if (a.target_user_id) return a.target_user_id === currentUser.uid;
        // Pas de restriction d'agence pour cette annonce → visible par tous.
        if (!restrictedIds.has(a.id)) return true;
        // Restreinte → seulement si l'agence de l'utilisateur est concernée.
        return myAgencyIds.has(a.id);
      });

      if (next) {
        // L'ancien niveau "urgent" (retiré du modèle à 5 niveaux) est
        // remappé en mémoire sur "important" au cas où une ligne n'aurait
        // pas été migrée en base.
        const rawLevel = next.level === 'urgent' ? 'important' : next.level;
        const safeLevel: AnnouncementLevel = (['info', 'a_verifier', 'important', 'succes', 'veille', 'reponse_demandee', 'signature_acte'] as const).includes(rawLevel) ? rawLevel : 'info';
        setAnnouncement({ id: next.id, message: next.message, level: safeLevel, link: next.link || null, isPoll: !!next.is_poll });
        if (next.is_poll) {
          const { data: options } = await supabase
            .from('announcement_poll_options' as any)
            .select('id, label')
            .eq('announcement_id', next.id)
            .order('sort_order', { ascending: true });
          if (!cancelled) setPollOptions(((options || []) as any[]).map((o) => ({ id: o.id, label: o.label })));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentUser, activeAgency.id, userProfile?.agencyIds]);

  const dismiss = async () => {
    if (!announcement || !currentUser || dismissing) return;
    // Un sondage se ferme en votant, pas en cliquant simplement le bouton —
    // la sélection d'un choix est obligatoire.
    if (announcement.isPoll && !selectedOptionId) return;
    setDismissing(true);
    try {
      if (announcement.isPoll && selectedOptionId) {
        await supabase.from('announcement_poll_votes' as any).upsert(
          { announcement_id: announcement.id, option_id: selectedOptionId, user_id: currentUser.uid, updated_at: new Date().toISOString() },
          { onConflict: 'announcement_id,user_id' }
        );
      }
      await supabase.from('announcement_reads').upsert(
        { announcement_id: announcement.id, user_id: currentUser.uid, read_at: new Date().toISOString() },
        { onConflict: 'announcement_id,user_id' }
      );
      setAnnouncement(null);
      setPollOptions([]);
      setSelectedOptionId(null);
    } finally {
      setDismissing(false);
    }
  };

  if (!announcement) return null;

  // Filet de sécurité : une annonce déjà en cache/en cours de lecture côté
  // client au moment du passage aux 5 niveaux peut encore porter l'ancienne
  // valeur "urgent" (ou toute autre valeur inattendue) — sans repli sur
  // 'info', `LEVEL_META[...]` renvoie undefined et fait planter tout le
  // bandeau (`meta.icon` sur undefined), bloquant même les annonces valides.
  // Ticket #242 : un sondage prend toujours le visuel "Sondage" dédié,
  // indépendamment du niveau choisi par ailleurs (Information, Important...).
  const meta = announcement.isPoll ? POLL_META : LEVEL_META[announcement.level] || LEVEL_META.info;
  const Icon = meta.icon;
  // Demande explicite (30/08/2026) : "le logo n'est pas centré, ni sur
  // mobile" — la mise en page "mascotte calée à gauche, chevauchant la
  // carte" (flex items-end, marge négative) était propre à cette taille de
  // médaillon et se retrouvait décentrée sur petit écran. Le traitement
  // "logo en haut, centré" déjà validé pour "Signature d'un acte" est
  // désormais utilisé pour TOUS les niveaux — seules la largeur de la carte
  // et la taille du médaillon restent un peu plus généreuses pour
  // "Signature d'un acte" (pancarte quasi plein écran, cf. ticket #242).
  const isSignatureLayout = announcement.level === 'signature_acte';

  return (
    <div className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      {/* Signalé : "le succès c'est confettis et signature de l'acte c'est
          feu d'artifice" — inversé par rapport à l'association initiale
          (tickets #254/#263), corrigé ici. */}
      {announcement.level === 'succes' && <ConfettiOverlay />}
      {announcement.level === 'signature_acte' && <FireworksOverlay />}
      {/* Ticket #241 : reprend le style des pancartes Nova fournies
          (mascotte détourée à gauche, cadre lumineux coloré à droite avec
          icône en médaillon + titre + séparateur) plutôt que de réutiliser
          l'image composite telle quelle — le texte doit toujours rester
          celui, dynamique, de l'annonce (jamais un texte figé dans une
          image). */}
      {/* z-10 : sans position/z-index propre, ce panneau (contenu normal du
          flux) se retrouverait paradoxalement DERRIÈRE le canvas du feu
          d'artifice (position fixed + z-index positif) malgré l'ordre du
          DOM — les éléments positionnés à z-index positif passent toujours
          devant le flux normal, quelle que soit la valeur numérique. */}
      {/* Demande explicite, "signature d'un acte" : logo en haut, centré,
          pancarte qui prend (presque) tout l'écran — plutôt que la mascotte
          qui déborde à gauche d'une carte étroite (mise en page normale,
          gardée pour tous les autres types d'annonce). */}
      <div className={`w-full ${isSignatureLayout ? 'max-w-3xl' : 'max-w-xl'} flex flex-col items-center relative z-10`}>
        <div className={`${isSignatureLayout ? 'w-40 sm:w-56' : 'w-28 sm:w-36'} shrink-0 mb-3 relative z-10 drop-shadow-[0_8px_24px_rgba(0,0,0,0.55)]`}>
          <img src={meta.mascotte} alt="Nova" className="w-full h-auto object-contain" />
        </div>
        <div
          className={`w-full bg-[#0a1e10] border-2 ${meta.border} rounded-2xl shadow-2xl overflow-hidden`}
          style={{ boxShadow: `0 0 0 1px rgba(255,255,255,0.03), 0 0 32px -4px var(--tw-shadow-color, transparent)` }}
        >
          <div className={`px-5 pt-5 pb-4 flex items-center justify-center gap-2.5 ${meta.headerBg}`}>
            <span className={`w-7 h-7 rounded-full border-2 ${meta.border} flex items-center justify-center shrink-0`}>
              <Icon className={`w-3.5 h-3.5 ${meta.iconColor}`} />
            </span>
            <h2 className={`text-lg font-extrabold uppercase tracking-wide text-center leading-tight ${meta.iconColor}`}>
              {meta.label.split(' — ')[0]}
            </h2>
          </div>
          <div className={`h-px mx-5 ${meta.border} opacity-40 bg-current`} />

          {/* "Défile" : l'annonce peut être longue — le texte défile
              verticalement dans une zone de hauteur limitée plutôt que
              d'imposer une fenêtre géante ou un ticker illisible. */}
          <div className="px-5 pt-4 pb-5 max-h-[45vh] overflow-y-auto custom-scrollbar space-y-3 text-center">
          <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
            {announcement.message}
          </p>
          {announcement.link && (
            <a
              href={announcement.link}
              className={`inline-flex items-center gap-1.5 text-xs font-bold ${meta.iconColor} hover:underline`}
            >
              Voir directement <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {/* Demande explicite : "possibilité de créer un sondage" — voter
              tient lieu de fermeture/lecture, un choix doit être
              sélectionné avant de pouvoir valider. */}
          {announcement.isPoll && (
            <div className="space-y-2 pt-1">
              {pollOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedOptionId(opt.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                    selectedOptionId === opt.id
                      ? `${meta.buttonBg} ${meta.buttonText} border-transparent`
                      : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          </div>

          <div className="p-4 border-t border-white/10 flex justify-end">
            <button
              onClick={() => void dismiss()}
              disabled={dismissing || (announcement.isPoll && !selectedOptionId)}
              className={`px-6 py-2.5 rounded-xl ${meta.buttonBg} ${meta.buttonText} text-sm font-bold disabled:opacity-50 transition-colors`}
            >
              {announcement.isPoll
                ? 'Valider mon vote'
                : announcement.level === 'important' || announcement.level === 'reponse_demandee'
                ? "J'ai compris"
                : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementBanner;
