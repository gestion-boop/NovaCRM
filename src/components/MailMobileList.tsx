import React, { useEffect, useRef, useState } from 'react';
import {
  Loader2, Inbox, Menu, Search, X, Star, RefreshCw, Trash2, MailOpen, Mail,
  FolderOpen, Check,
} from 'lucide-react';
import { GmailMessageSummary, GmailUserLabel } from '@/lib/workspace';
import { TEAM_MEMBERS } from '@/data/teamMembers';

/* ══════════════════════════════════════════════════════════════════════════
   Messagerie — écran mobile façon Gmail
   ══════════════════════════════════════════════════════════════════════════
   Demande explicite (captures Gmail à l'appui) : sur téléphone, la messagerie
   reprend les codes de Gmail — barre de recherche ronde avec le menu à gauche
   et l'avatar à droite, tiroir latéral pour les dossiers, liste dense, et les
   trois gestes du doigt :

     • balayage vers la DROITE  → bascule lu / non lu
     • balayage vers la GAUCHE  → supprime (corbeille, ou définitif si on est
                                  déjà dans la corbeille)
     • appui LONG               → mode sélection, plusieurs messages d'un coup

   Ce fichier ne contient que l'affichage et les gestes : tout ce qui parle à
   l'API Gmail reste dans MailView, qui passe ses fonctions en props. */

export interface MailMobileFolder {
  id: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}

interface MailMobileListProps {
  mails: GmailMessageSummary[];
  loading: boolean;
  folders: MailMobileFolder[];
  activeFolderId: string;
  activeFolderLabel: string;
  customLabels: GmailUserLabel[];
  activeCustomLabelId: string | null;
  unreadCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectFolder: (folderId: string) => void;
  onSelectCustomLabel: (labelId: string) => void;
  onOpenMail: (mail: GmailMessageSummary) => void;
  onToggleStar: (mail: GmailMessageSummary, event?: React.MouseEvent) => void;
  onSetRead: (mails: GmailMessageSummary[], read: boolean) => Promise<void> | void;
  onDelete: (mails: GmailMessageSummary[]) => Promise<void> | void;
  onRefresh: () => void;
  userEmail?: string;
}

/* Distance à parcourir pour qu'un balayage compte (en dessous, le message
   revient en place). ~1/4 d'écran : assez pour ne pas se déclencher pendant
   un défilement de travers, assez court pour rester faisable au pouce. */
const SWIPE_COMMIT = 88;
/* Au-delà, le doigt continue mais la carte suit deux fois moins vite : on
   sent qu'on est arrivé au bout du geste. */
const SWIPE_MAX = 150;
const LONG_PRESS_MS = 480;

const AVATAR_COLORS = [
  'bg-[#8B1E3F] text-rose-100', 'bg-[#0083B0] text-sky-100', 'bg-[#059669] text-emerald-100',
  'bg-[#6B21A8] text-violet-100', 'bg-[#C2410C] text-orange-100', 'bg-[#0E7490] text-cyan-100',
  'bg-[#B45309] text-[#FCE7C8]', 'bg-[#BE185D] text-pink-100', 'bg-[#4F46E5] text-indigo-100',
];

const getAvatarColor = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const getInitial = (name: string) => (name.trim()[0] || '?').toUpperCase();

/* Format Gmail : l'heure pour aujourd'hui, le jour et le mois dans l'année en
   cours, la date complète au-delà. */
const formatMailDate = (raw: string): string => {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

interface MailRowProps {
  mail: GmailMessageSummary;
  selected: boolean;
  selectionMode: boolean;
  isTrash: boolean;
  onOpen: () => void;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onSwipeRead: () => void;
  onSwipeDelete: () => void;
  onToggleStar: (event: React.MouseEvent) => void;
}

const MailRow: React.FC<MailRowProps> = ({
  mail, selected, selectionMode, isTrash, onOpen, onLongPress, onToggleSelect,
  onSwipeRead, onSwipeDelete, onToggleStar,
}) => {
  const [dx, setDx] = useState(0);
  const [gliding, setGliding] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  /* '?' tant que la direction du geste n'est pas tranchée : sans ça, un
     défilement vertical un peu de travers ferait glisser les messages. */
  const axisRef = useRef<'?' | 'x' | 'y'>('?');
  const timerRef = useRef<number | null>(null);
  /* Un appui long ouvre la sélection ; il ne doit pas AUSSI ouvrir le mail au
     relâchement du doigt. Idem après un balayage. */
  const swallowClickRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY };
    axisRef.current = '?';
    swallowClickRef.current = false;
    setGliding(false);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      swallowClickRef.current = true;
      /* Petite vibration de confirmation, comme Gmail — ignorée en silence
         par les navigateurs qui ne la proposent pas (iOS). */
      navigator.vibrate?.(12);
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start) return;
    const touch = e.touches[0];
    const rawX = touch.clientX - start.x;
    const rawY = touch.clientY - start.y;

    if (axisRef.current === '?') {
      if (Math.abs(rawX) > 8 && Math.abs(rawX) > Math.abs(rawY)) {
        axisRef.current = 'x';
        clearTimer();
      } else if (Math.abs(rawY) > 8) {
        axisRef.current = 'y';
        clearTimer();
      }
    }

    /* En mode sélection, le doigt ne sert qu'à cocher : les balayages sont
       neutralisés pour ne pas supprimer un message par accident. */
    if (axisRef.current !== 'x' || selectionMode) return;

    const overshoot = Math.abs(rawX) - SWIPE_COMMIT;
    const eased = overshoot > 0
      ? Math.sign(rawX) * Math.min(SWIPE_MAX, SWIPE_COMMIT + overshoot / 2)
      : rawX;
    setDx(eased);
  };

  const handleTouchEnd = () => {
    clearTimer();
    const committed = Math.abs(dx) >= SWIPE_COMMIT;
    const direction = dx > 0 ? 'right' : 'left';
    startRef.current = null;

    if (!committed) {
      if (dx !== 0) {
        swallowClickRef.current = true;
        setGliding(true);
        setDx(0);
      }
      return;
    }

    swallowClickRef.current = true;
    setGliding(true);

    if (direction === 'right') {
      /* Lu / non lu : le message reste dans la liste, la carte revient donc
         se remettre en place. */
      setDx(0);
      onSwipeRead();
    } else {
      /* Suppression : la carte finit sa course hors de l'écran, puis le
         parent la retire réellement de la liste. */
      setDx(-window.innerWidth);
      window.setTimeout(() => onSwipeDelete(), 180);
    }
  };

  const handleClick = () => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      return;
    }
    if (selectionMode) onToggleSelect();
    else onOpen();
  };

  const senderLabel = mail.fromName || mail.from;
  const isStarred = mail.labelIds.includes('STARRED');
  const senderTeamMember = TEAM_MEMBERS.find(
    (m) => m.email.toLowerCase() === (mail.from || '').toLowerCase()
  );

  return (
    <div className="relative overflow-hidden select-none">
      {/* Fond révélé par le balayage : bleu « lu » à gauche (on tire vers la
          droite), rouge « supprimer » à droite (on tire vers la gauche). */}
      <div
        className={`absolute inset-0 flex items-center px-7 ${
          dx > 0 ? 'justify-start bg-[#0083B0]' : 'justify-end bg-[#8B1E3F]'
        } ${dx === 0 ? 'opacity-0' : 'opacity-100'}`}
        aria-hidden="true"
      >
        {dx > 0 ? (
          <div className="flex items-center gap-2 text-white">
            {mail.isRead ? <Mail className="w-6 h-6" /> : <MailOpen className="w-6 h-6" />}
            <span className="text-xs font-bold">{mail.isRead ? 'Non lu' : 'Lu'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-white">
            <span className="text-xs font-bold">{isTrash ? 'Supprimer définitivement' : 'Supprimer'}</span>
            <Trash2 className="w-6 h-6" />
          </div>
        )}
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          transform: `translateX(${dx}px)`,
          transition: gliding ? 'transform 180ms ease-out' : 'none',
          /* pan-y laisse le défilement vertical au navigateur et nous confie
             l'horizontale : pas besoin de preventDefault (impossible ici, les
             écouteurs tactiles de React sont passifs). */
          touchAction: 'pan-y',
          WebkitTouchCallout: 'none',
        }}
        className={`relative px-4 py-3 flex items-start gap-3 cursor-pointer ${
          selected
            ? 'bg-[#0f3336]'
            : !mail.isRead
              ? 'bg-[#0b292b]'
              : 'bg-[#071f21]'
        }`}
      >
        {selected ? (
          <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center bg-[#F7BC5F] text-[#061719]">
            <Check className="w-5 h-5" strokeWidth={3} />
          </div>
        ) : senderTeamMember?.avatarUrl ? (
          <img
            src={senderTeamMember.avatarUrl}
            alt={senderTeamMember.name}
            className="w-11 h-11 rounded-full shrink-0 object-cover"
          />
        ) : (
          <div className={`w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-base font-black ${getAvatarColor(senderLabel)}`}>
            {getInitial(senderLabel)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[15px] truncate ${!mail.isRead ? 'text-white font-bold' : 'text-slate-300 font-medium'}`}>
              {senderLabel}
            </span>
            <span className={`text-[11px] shrink-0 ${!mail.isRead ? 'text-[#F7BC5F] font-bold' : 'text-slate-500'}`}>
              {formatMailDate(mail.date)}
            </span>
          </div>
          <p className={`text-sm truncate ${!mail.isRead ? 'text-white font-semibold' : 'text-slate-300'}`}>
            {mail.subject || '(Sans objet)'}
          </p>
          <p className="text-[13px] text-slate-500 truncate">{mail.snippet}</p>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleStar(e); }}
          title={isStarred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          className="p-1.5 -mr-1.5 shrink-0 self-center"
        >
          <Star className={`w-5 h-5 ${isStarred ? 'text-[#F7BC5F] fill-[#F7BC5F]' : 'text-slate-600'}`} />
        </button>
      </div>
    </div>
  );
};

export const MailMobileList: React.FC<MailMobileListProps> = ({
  mails, loading, folders, activeFolderId, activeFolderLabel, customLabels,
  activeCustomLabelId, unreadCount, searchQuery, onSearchChange, onSelectFolder,
  onSelectCustomLabel, onOpenMail, onToggleStar, onSetRead, onDelete, onRefresh,
  userEmail,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const selectionMode = selectedIds.length > 0;
  const isTrash = activeFolderId === 'TRASH';

  /* Changer de dossier vide la sélection : les messages cochés ne sont plus
     à l'écran, agir dessus depuis le dossier suivant n'aurait aucun sens. */
  useEffect(() => {
    setSelectedIds([]);
  }, [activeFolderId, activeCustomLabelId]);

  /* Un message supprimé ailleurs (balayage, action groupée) ne doit pas rester
     compté dans la sélection. */
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillThere = prev.filter((id) => mails.some((m) => m.id === id));
      return stillThere.length === prev.length ? prev : stillThere;
    });
  }, [mails]);

  const selectedMails = mails.filter((m) => selectedIds.includes(m.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const currentUserMember = TEAM_MEMBERS.find(
    (m) => m.email.toLowerCase() === (userEmail || '').toLowerCase()
  );

  const runBulkRead = async () => {
    /* Comme Gmail : si au moins un message coché est encore non lu, le lot
       passe en « lu » ; sinon on repasse tout en « non lu ». */
    const targetRead = selectedMails.some((m) => !m.isRead);
    const list = selectedMails;
    setSelectedIds([]);
    await onSetRead(list, targetRead);
  };

  const runBulkDelete = async () => {
    const list = selectedMails;
    setSelectedIds([]);
    await onDelete(list);
  };

  return (
    <div className="flex flex-col min-h-full bg-[#071f21] text-white">
      {/* ── EN-TÊTE ─────────────────────────────────────────────────────────
          Barre de recherche ronde façon Gmail (menu à gauche, avatar à
          droite), remplacée par la barre d'actions dès qu'un message est
          sélectionné. */}
      <div className="sticky top-0 z-30 bg-[#071f21] px-3 pt-3 pb-2">
        {selectionMode ? (
          <div className="flex items-center gap-1 rounded-full bg-[#0b292b] border border-[#F7BC5F]/40 pl-2 pr-1.5 py-2">
            <button
              onClick={() => setSelectedIds([])}
              title="Quitter la sélection"
              className="w-9 h-9 rounded-full flex items-center justify-center text-slate-200 active:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="flex-1 text-[15px] font-bold text-white pl-1">
              {selectedIds.length}
            </span>
            <button
              onClick={() => void runBulkRead()}
              title="Marquer comme lu / non lu"
              className="w-10 h-10 rounded-full flex items-center justify-center text-slate-200 active:bg-white/10"
            >
              {selectedMails.some((m) => !m.isRead)
                ? <MailOpen className="w-5 h-5" />
                : <Mail className="w-5 h-5" />}
            </button>
            <button
              onClick={() => void runBulkDelete()}
              title={isTrash ? 'Supprimer définitivement' : 'Mettre à la corbeille'}
              className="w-10 h-10 rounded-full flex items-center justify-center text-rose-300 active:bg-white/10"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-full bg-[#0b292b] border border-[#1c4448] pl-1.5 pr-1.5 py-1.5 shadow-lg">
            <button
              onClick={() => setDrawerOpen(true)}
              title="Dossiers"
              className="w-10 h-10 rounded-full flex items-center justify-center text-slate-200 active:bg-white/10 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              placeholder="Rechercher dans les messages"
              className="flex-1 min-w-0 bg-transparent text-[15px] text-white placeholder:text-slate-400 focus:outline-none"
            />
            {searchQuery ? (
              <button
                onClick={() => onSearchChange('')}
                title="Effacer"
                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-300 active:bg-white/10 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            ) : searchOpen ? (
              <Search className="w-5 h-5 text-slate-400 mr-2 shrink-0" />
            ) : currentUserMember?.avatarUrl ? (
              <img
                src={currentUserMember.avatarUrl}
                alt={currentUserMember.name}
                className="w-9 h-9 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#F7BC5F] text-[#061719] flex items-center justify-center text-sm font-black shrink-0">
                {getInitial(userEmail || '?')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dossier ouvert + rafraîchissement (Gmail affiche « Toutes les boîtes
          de réception » au même endroit). */}
      <div className="flex items-center justify-between px-5 pt-1 pb-2">
        <p className="text-[13px] font-semibold text-slate-400 truncate">
          {activeFolderLabel}
        </p>
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Actualiser"
          className="w-8 h-8 -mr-1.5 rounded-full flex items-center justify-center text-slate-400 active:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#F7BC5F]' : ''}`} />
        </button>
      </div>

      {/* ── LISTE ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-20">
          <Loader2 className="w-7 h-7 animate-spin text-[#F7BC5F] mb-3" />
          <p className="text-xs font-semibold">Chargement de la boîte...</p>
        </div>
      ) : mails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-20">
          <Inbox className="w-9 h-9 mb-3 text-slate-600" />
          <p className="text-sm font-medium text-slate-400">Aucun message dans ce dossier.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {mails.map((mail) => (
            <MailRow
              key={mail.id}
              mail={mail}
              selected={selectedIds.includes(mail.id)}
              selectionMode={selectionMode}
              isTrash={isTrash}
              onOpen={() => onOpenMail(mail)}
              onLongPress={() => toggleSelect(mail.id)}
              onToggleSelect={() => toggleSelect(mail.id)}
              onSwipeRead={() => void onSetRead([mail], !mail.isRead)}
              onSwipeDelete={() => void onDelete([mail])}
              onToggleStar={(e) => onToggleStar(mail, e)}
            />
          ))}
          {/* Respiration en bas de liste : sans ça, le dernier message se
              retrouve collé sous la barre de navigation du téléphone. */}
          <div className="h-6" />
        </div>
      )}

      {/* ── TIROIR DES DOSSIERS ─────────────────────────────────────────────
          Monté en permanence et simplement translaté hors de l'écran : le
          glissement d'ouverture/fermeture est alors une vraie transition CSS,
          sans keyframes ni bibliothèque. `pointer-events-none` quand il est
          fermé pour qu'il ne capte aucun appui. */}
      <div className={`fixed inset-0 z-[70] ${drawerOpen ? '' : 'pointer-events-none'}`}>
        <div
          onClick={() => setDrawerOpen(false)}
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
            drawerOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <aside
          className={`absolute inset-y-0 left-0 w-[82%] max-w-[330px] bg-[#071f21] border-r border-[#1c4448] flex flex-col transition-transform duration-200 ease-out ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="px-5 pt-5 pb-4 border-b border-white/5">
            <p className="text-lg font-black text-white">Messagerie</p>
            {userEmail && (
              <p className="text-[11px] text-slate-500 truncate mt-0.5">{userEmail}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar py-3">
            <nav className="pr-3 space-y-0.5">
              {folders.map((folder) => {
                const isActive = !activeCustomLabelId && activeFolderId === folder.id;
                const IconComp = folder.icon;
                return (
                  <button
                    key={folder.id}
                    onClick={() => {
                      onSelectFolder(folder.id);
                      setDrawerOpen(false);
                    }}
                    className={`w-full text-left pl-5 pr-3 py-3 rounded-r-full text-[15px] flex items-center gap-4 ${
                      isActive
                        ? 'bg-[#F7BC5F]/15 text-[#F9C977] font-bold'
                        : 'text-slate-300 font-medium active:bg-white/5'
                    }`}
                  >
                    <IconComp className={`w-5 h-5 shrink-0 ${isActive ? 'text-[#F9C977]' : 'text-slate-400'}`} />
                    <span className="flex-1 truncate">{folder.label}</span>
                    {folder.id === 'UNREAD' && unreadCount > 0 && (
                      <span className={`text-[11px] font-black shrink-0 ${isActive ? 'text-[#F9C977]' : 'text-slate-400'}`}>
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {customLabels.length > 0 && (
              <>
                <div className="mx-5 my-3 border-t border-white/5" />
                <p className="px-5 mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Dossiers
                </p>
                <nav className="pr-3 space-y-0.5">
                  {customLabels.map((label) => {
                    const isActive = activeCustomLabelId === label.id;
                    return (
                      <button
                        key={label.id}
                        onClick={() => {
                          onSelectCustomLabel(label.id);
                          setDrawerOpen(false);
                        }}
                        className={`w-full text-left pl-5 pr-3 py-3 rounded-r-full text-[15px] flex items-center gap-4 ${
                          isActive
                            ? 'bg-[#F7BC5F]/15 text-[#F9C977] font-bold'
                            : 'text-slate-300 font-medium active:bg-white/5'
                        }`}
                      >
                        <FolderOpen className={`w-5 h-5 shrink-0 ${isActive ? 'text-[#F9C977]' : 'text-slate-400'}`} />
                        <span className="flex-1 truncate">{label.name}</span>
                      </button>
                    );
                  })}
                </nav>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default MailMobileList;
