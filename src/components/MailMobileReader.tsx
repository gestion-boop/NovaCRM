import React from 'react';
import {
  ChevronLeft, Reply, ReplyAll, Forward, Trash2, ShieldAlert, Mail, MailOpen,
  Star, RotateCcw,
} from 'lucide-react';
import { GmailMessageSummary } from '@/lib/workspace';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { getAvatarColor, getInitial } from './MailMobileList';
import { useSwipeBack } from '@/hooks/useSwipeBack';

/* ══════════════════════════════════════════════════════════════════════════
   Lecture d'un message — écran mobile façon Gmail
   ══════════════════════════════════════════════════════════════════════════
   Signalé sur capture : en lisant un message, la barre du haut reprenait la
   rangée d'onglets de la liste (« Retour · Répondre · Tous · Transférer · … »)
   qui débordait horizontalement et sortait de l'écran, le bas du message
   passait sous la barre de navigation, et le « + Écrire » restait affiché
   alors que l'action utile, là, c'est Répondre.

   Gmail sépare les deux : une ligne d'ICÔNES en haut pour classer (revenir,
   non lu, spam, corbeille), et Répondre / Transférer en bas, à portée de
   pouce. C'est ce que fait cet écran. */

interface MailMobileReaderProps {
  mail: GmailMessageSummary;
  folderLabel: string;
  isTrash: boolean;
  // Le corps est rendu par MailView (cadre HTML isolé ou texte brut) et passé
  // tel quel : cet écran ne s'occupe que de la mise en page autour.
  body: React.ReactNode;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onToggleRead: () => void;
  onToggleStar: (event: React.MouseEvent) => void;
  onSpam: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
}

const formatFullDate = (raw: string): string => {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const MailMobileReader: React.FC<MailMobileReaderProps> = ({
  mail, folderLabel, isTrash, body, onBack, onReply, onReplyAll, onForward,
  onToggleRead, onToggleStar, onSpam, onTrash, onRestore, onDeleteForever,
}) => {
  const senderLabel = mail.fromName || mail.from;
  const isStarred = mail.labelIds.includes('STARRED');
  const isSpam = mail.labelIds.includes('SPAM');
  const senderTeamMember = TEAM_MEMBERS.find(
    (m) => m.email.toLowerCase() === (mail.from || '').toLowerCase()
  );
  const swipeBackRef = useSwipeBack<HTMLDivElement>(onBack, true);

  return (
    <div ref={swipeBackRef} className="flex flex-col h-full min-h-0 bg-[#071f21] text-white">
      {/* ── BARRE D'ACTIONS (haut) ─────────────────────────────────────────
          Des icônes, pas des libellés : quatre boutons tiennent dans la
          largeur de n'importe quel téléphone, alors que « Retour · Répondre ·
          Tous · Transférer » débordait toujours. */}
      <div className="shrink-0 flex items-center gap-0.5 px-1.5 py-2 border-b border-white/5">
        <button
          onClick={onBack}
          title="Retour à la liste"
          aria-label="Retour à la liste"
          className="w-11 h-11 rounded-full flex items-center justify-center text-slate-200 active:bg-white/10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div className="flex-1 min-w-0" />

        {isTrash ? (
          <>
            <button
              onClick={onRestore}
              title="Restaurer"
              aria-label="Restaurer"
              className="w-11 h-11 rounded-full flex items-center justify-center text-emerald-300 active:bg-white/10"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              onClick={onDeleteForever}
              title="Supprimer définitivement"
              aria-label="Supprimer définitivement"
              className="w-11 h-11 rounded-full flex items-center justify-center text-rose-300 active:bg-white/10"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onToggleRead}
              title={mail.isRead ? 'Marquer comme non lu' : 'Marquer comme lu'}
              aria-label={mail.isRead ? 'Marquer comme non lu' : 'Marquer comme lu'}
              className="w-11 h-11 rounded-full flex items-center justify-center text-slate-200 active:bg-white/10"
            >
              {mail.isRead ? <MailOpen className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
            </button>
            <button
              onClick={onSpam}
              title={isSpam ? 'Ce n’est pas un spam' : 'Signaler comme spam'}
              aria-label={isSpam ? 'Ce n’est pas un spam' : 'Signaler comme spam'}
              className="w-11 h-11 rounded-full flex items-center justify-center text-[#FAD592] active:bg-white/10"
            >
              <ShieldAlert className="w-5 h-5" />
            </button>
            <button
              onClick={onTrash}
              title="Mettre à la corbeille"
              aria-label="Mettre à la corbeille"
              className="w-11 h-11 rounded-full flex items-center justify-center text-rose-300 active:bg-white/10"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* ── MESSAGE ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        {/* Signalé en revue (25 octobre) : le corps HTML est rendu par une
            <iframe> (EmailHtmlFrame) — les événements tactiles qui
            commencent dedans vont à SON document et ne remontent jamais au
            parent, donc le geste de retour (bord gauche) ne fonctionnait
            plus une fois le mail défilé jusqu'au corps. Bande transparente,
            hors de l'iframe, posée par-dessus la zone défilante : en enfant
            direct de ce conteneur relatif (et non de la div qui défile), elle
            reste fixée sur le bord visible quelle que soit la position de
            défilement, sans bloquer la lecture au-delà des premiers 24px.
            `pointer-events-auto` : par défaut ce conteneur relatif ne gêne
            rien, seule cette bande doit capter le toucher. */}
        <div className="absolute left-0 top-0 bottom-0 w-6 z-10 pointer-events-auto" data-mail-reader-edge-strip />
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
        <div className="px-4 pt-4">
          <div className="flex items-start gap-3">
            <h1 className="flex-1 text-xl font-bold leading-snug text-white" style={{ textWrap: 'balance' } as React.CSSProperties}>
              {mail.subject || '(Sans objet)'}
            </h1>
            <button
              onClick={onToggleStar}
              title={isStarred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              aria-label={isStarred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              className="p-1.5 -mr-1.5 shrink-0"
            >
              <Star className={`w-6 h-6 ${isStarred ? 'text-[#F7BC5F] fill-[#F7BC5F]' : 'text-slate-600'}`} />
            </button>
          </div>

          <span className="inline-block mt-2 px-2.5 py-1 rounded-md bg-[#0b292b] text-[11px] font-semibold text-slate-400">
            {folderLabel}
          </span>

          {/* Expéditeur — même pastille colorée que dans la liste, pour qu'on
              reconnaisse d'un coup d'œil le message qu'on vient d'ouvrir. */}
          <div className="flex items-center gap-3 mt-4">
            {senderTeamMember?.avatarUrl ? (
              <img
                src={senderTeamMember.avatarUrl}
                alt={senderTeamMember.name}
                className="w-10 h-10 rounded-full shrink-0 object-cover"
              />
            ) : (
              <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-black ${getAvatarColor(senderLabel)}`}>
                {getInitial(senderLabel)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{senderLabel}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {mail.to ? `à ${mail.to}` : mail.from}
              </p>
            </div>
            <span className="text-[11px] text-slate-500 shrink-0 self-start pt-0.5">
              {formatFullDate(mail.date)}
            </span>
          </div>
        </div>

        {/* Corps du message. La marge basse évite que la dernière ligne (ou un
            lien) se retrouve collée sous la barre d'actions. */}
        <div className="mt-3 px-1 pb-6">
          {body}
        </div>
        </div>
      </div>

      {/* ── RÉPONDRE / TRANSFÉRER (bas) ────────────────────────────────────
          À portée de pouce, comme Gmail. Dans la colonne `h-full` de
          MailView, cette barre s'arrête juste au-dessus de la barre de
          navigation de l'application : plus rien ne passe dessous. */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-white/5 bg-[#071f21]">
        <button
          onClick={onReply}
          className="flex-1 h-11 rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white flex items-center justify-center gap-2 active:bg-white/10"
        >
          <Reply className="w-4 h-4 text-[#F7BC5F]" />
          Répondre
        </button>
        <button
          onClick={onReplyAll}
          title="Répondre à tous"
          aria-label="Répondre à tous"
          className="w-11 h-11 shrink-0 rounded-full border border-white/15 bg-white/5 flex items-center justify-center active:bg-white/10"
        >
          <ReplyAll className="w-4 h-4 text-[#F7BC5F]" />
        </button>
        <button
          onClick={onForward}
          className="flex-1 h-11 rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white flex items-center justify-center gap-2 active:bg-white/10"
        >
          <Forward className="w-4 h-4 text-[#F7BC5F]" />
          Transférer
        </button>
      </div>
    </div>
  );
};

export default MailMobileReader;
