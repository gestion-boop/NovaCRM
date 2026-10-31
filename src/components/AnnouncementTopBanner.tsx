import { useEffect, useState } from 'react';
import { Megaphone, Info, AlertTriangle, CheckCircle2, Eye, AlertCircle, PenTool, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

// Bandeau défilant (31 octobre) : demande explicite — « un texte qui
// pourrait défiler sur la barre du CRM version tablette et ordinateur tout
// en haut à la place de tous les onglets ». Remplace entièrement <Header>
// (même emplacement, même hauteur, même repli mobile `hidden md:flex`) tant
// qu'une annonce marquée `show_in_banner` n'a pas été fermée via le bouton
// à droite — App.tsx bascule alors sur <Header> normal.
//
// Volontairement indépendant du message plein écran (AnnouncementBanner.tsx,
// inchangé) : une annonce avec `show_in_banner = true` s'affiche ICI sur
// tablette/ordinateur (AnnouncementBanner.tsx l'exclut alors de son côté,
// voir son commentaire), et garde le message plein écran habituel sur
// mobile, où il n'y a pas de barre du haut à remplacer. Les sondages ne
// passent jamais en bandeau (voter ne tient pas dans une ligne qui défile) :
// ils restent sur le message plein écran, même avec `show_in_banner` coché.
type BannerLevel = 'info' | 'a_verifier' | 'important' | 'succes' | 'veille' | 'reponse_demandee' | 'signature_compromis' | 'signature_acte';

interface BannerAnnouncement {
  id: string;
  message: string;
  level: BannerLevel;
  link: string | null;
}

const BANNER_LEVEL_META: Record<BannerLevel, {
  label: string;
  gradient: string;
  border: string;
  glow: string;
  badgeBg: string;
  badgeText: string;
  buttonBg: string;
  buttonText: string;
  icon: typeof Info;
  obligeLecture: boolean;
}> = {
  info: {
    label: 'Information',
    gradient: 'from-[#2a2110] via-[#342910] to-[#2a2110]',
    border: 'border-[#F7BC5F]/50',
    glow: 'rgba(247,188,95,0.4)',
    badgeBg: 'bg-[#F7BC5F]/20',
    badgeText: 'text-[#F9C977]',
    buttonBg: 'bg-[#F7BC5F] hover:bg-[#d9ab38]',
    buttonText: 'text-[#061719]',
    icon: Info,
    obligeLecture: false,
  },
  a_verifier: {
    label: 'À vérifier',
    gradient: 'from-[#2e2308] via-[#3a2c0a] to-[#2e2308]',
    border: 'border-amber-500/50',
    glow: 'rgba(245,158,11,0.4)',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-200',
    buttonBg: 'bg-amber-500 hover:bg-amber-400',
    buttonText: 'text-amber-950',
    icon: Megaphone,
    obligeLecture: false,
  },
  important: {
    label: 'Important',
    gradient: 'from-[#2b0a12] via-[#3a0d14] to-[#2b0a12]',
    border: 'border-rose-500/50',
    glow: 'rgba(244,63,94,0.5)',
    badgeBg: 'bg-rose-500/20',
    badgeText: 'text-rose-200',
    buttonBg: 'bg-rose-500 hover:bg-rose-400',
    buttonText: 'text-white',
    icon: AlertTriangle,
    obligeLecture: true,
  },
  succes: {
    label: "Offre d'achat validée",
    gradient: 'from-[#0a2419] via-[#0d2e1f] to-[#0a2419]',
    border: 'border-emerald-500/50',
    glow: 'rgba(16,185,129,0.4)',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-emerald-200',
    buttonBg: 'bg-emerald-500 hover:bg-emerald-400',
    buttonText: 'text-emerald-950',
    icon: CheckCircle2,
    obligeLecture: false,
  },
  veille: {
    label: 'Veille',
    gradient: 'from-[#0a1e2b] via-[#0d2636] to-[#0a1e2b]',
    border: 'border-sky-500/50',
    glow: 'rgba(14,165,233,0.4)',
    badgeBg: 'bg-sky-500/20',
    badgeText: 'text-sky-200',
    buttonBg: 'bg-sky-500 hover:bg-sky-400',
    buttonText: 'text-sky-950',
    icon: Eye,
    obligeLecture: false,
  },
  reponse_demandee: {
    label: 'Réponse demandée SVP',
    gradient: 'from-[#2b0a12] via-[#3a0d14] to-[#2b0a12]',
    border: 'border-pink-500/50',
    glow: 'rgba(236,72,153,0.4)',
    badgeBg: 'bg-pink-500/20',
    badgeText: 'text-pink-200',
    buttonBg: 'bg-pink-500 hover:bg-pink-400',
    buttonText: 'text-white',
    icon: AlertCircle,
    obligeLecture: true,
  },
  signature_compromis: {
    label: 'Signature compromis',
    gradient: 'from-[#2e2308] via-[#3a2c0a] to-[#2e2308]',
    border: 'border-amber-400/50',
    glow: 'rgba(245,158,11,0.4)',
    badgeBg: 'bg-amber-400/20',
    badgeText: 'text-[#F9C977]',
    buttonBg: 'bg-amber-500 hover:bg-amber-400',
    buttonText: 'text-amber-950',
    icon: PenTool,
    obligeLecture: false,
  },
  signature_acte: {
    label: 'Signature acte authentique',
    gradient: 'from-[#2e2308] via-[#3a2c0a] to-[#2e2308]',
    border: 'border-[#F7BC5F]/60',
    glow: 'rgba(247,188,95,0.5)',
    badgeBg: 'bg-[#F7BC5F]/25',
    badgeText: 'text-[#FAD592]',
    buttonBg: 'bg-[#F7BC5F] hover:bg-[#d9ab38]',
    buttonText: 'text-[#061719]',
    icon: PenTool,
    obligeLecture: false,
  },
};

interface AnnouncementTopBannerProps {
  // App.tsx a besoin de savoir, dès qu'une annonce bandeau est trouvée,
  // pour masquer <Header> et afficher ce composant à la place.
  onActiveChange: (active: boolean) => void;
}

const AnnouncementTopBanner: React.FC<AnnouncementTopBannerProps> = ({ onActiveChange }) => {
  const { currentUser, activeAgency, userProfile } = useAuth();
  const [announcement, setAnnouncement] = useState<BannerAnnouncement | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!currentUser) { onActiveChange(false); return; }
    let cancelled = false;

    (async () => {
      const [{ data: active }, { data: reads }, { data: restrictions }] = await Promise.all([
        supabase.from('announcements').select('id, message, level, link, expires_at, target_user_id, is_poll, show_in_banner').eq('is_active', true).eq('show_in_banner', true).eq('is_poll', false).order('created_at', { ascending: false }) as unknown as Promise<{ data: any[] | null }>,
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

      const accountCreatedAt = userProfile?.createdAt ? new Date(userProfile.createdAt).getTime() : 0;
      const now = Date.now();

      const next = (active || []).find((a: any) => {
        if (readIds.has(a.id)) return false;
        if (new Date(a.created_at).getTime() < accountCreatedAt) return false;
        if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
        if (a.target_user_id) return a.target_user_id === currentUser.uid;
        if (!restrictedIds.has(a.id)) return true;
        return myAgencyIds.has(a.id);
      });

      if (cancelled) return;
      if (next) {
        const safeLevel: BannerLevel = (Object.keys(BANNER_LEVEL_META) as BannerLevel[]).includes(next.level) ? next.level : 'info';
        setAnnouncement({ id: next.id, message: next.message, level: safeLevel, link: next.link || null });
        onActiveChange(true);
      } else {
        setAnnouncement(null);
        onActiveChange(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, activeAgency.id, userProfile?.agencyIds]);

  const dismiss = async () => {
    if (!announcement || !currentUser || dismissing) return;
    setDismissing(true);
    try {
      await supabase.from('announcement_reads').upsert(
        { announcement_id: announcement.id, user_id: currentUser.uid, read_at: new Date().toISOString() },
        { onConflict: 'announcement_id,user_id' }
      );
      setAnnouncement(null);
      onActiveChange(false);
    } finally {
      setDismissing(false);
    }
  };

  if (!announcement) return null;

  const meta = BANNER_LEVEL_META[announcement.level];
  const Icon = meta.icon;

  return (
    <header
      className={`hidden md:flex bg-gradient-to-r ${meta.gradient} border-b ${meta.border} px-2.5 sm:px-6 items-center gap-3 z-40 shrink-0 select-none pt-0 pt-[env(safe-area-inset-top,0px)] min-h-[3.25rem] sm:min-h-[3.5rem] relative overflow-hidden`}
      style={{ boxShadow: `0 6px 20px -8px ${meta.glow}` }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-80" />

      <span className={`shrink-0 w-9 h-9 rounded-xl ${meta.badgeBg} border ${meta.border} flex items-center justify-center`}>
        <Icon className={`w-4 h-4 ${meta.badgeText}`} />
      </span>

      <span className={`hidden lg:inline-flex shrink-0 text-[10px] sm:text-xs font-black uppercase tracking-wider ${meta.badgeText} ${meta.badgeBg} border ${meta.border} px-2.5 py-1 rounded-full`}>
        {meta.label}
      </span>

      {/* Texte défilant — répété deux fois bout à bout pour un défilement
          continu sans trou, quelle que soit la longueur du message. */}
      <div className="flex-1 min-w-0 overflow-hidden relative h-6" data-swipe-back-exclude>
        <div className="absolute inset-0 flex items-center whitespace-nowrap animate-[nv-banner-marquee_22s_linear_infinite]">
          <span className="text-sm sm:text-[15px] font-semibold text-white pr-16">{announcement.message}</span>
          <span className="text-sm sm:text-[15px] font-semibold text-white pr-16">{announcement.message}</span>
        </div>
      </div>

      {announcement.link && (
        <a
          href={announcement.link}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex shrink-0 items-center gap-1 text-xs font-bold text-white/80 hover:text-white underline underline-offset-2"
        >
          Voir <ExternalLink className="w-3 h-3" />
        </a>
      )}

      <button
        type="button"
        onClick={() => void dismiss()}
        disabled={dismissing}
        className={`shrink-0 px-4 sm:px-5 h-9 rounded-xl ${meta.buttonBg} ${meta.buttonText} text-xs sm:text-sm font-black shadow-md transition-colors disabled:opacity-60 cursor-pointer`}
      >
        {meta.obligeLecture ? "J'ai compris" : 'OK'}
      </button>
    </header>
  );
};

export default AnnouncementTopBanner;
