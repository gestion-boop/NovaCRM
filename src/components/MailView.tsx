import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Edit, Inbox, Loader2, Mail, RefreshCw, Reply, ReplyAll, Forward, Send, X,
  Trash2, AlertTriangle, Star, CheckCircle2, ShieldAlert, Archive, Eye, EyeOff,
  CornerUpLeft, SendHorizontal, FileText, ChevronRight, ChevronLeft, Sparkles,
  MailOpen, FolderOpen, ChevronDown,
} from 'lucide-react';
import {
  fetchGmailMessages,
  fetchGmailUserLabels,
  GmailUserLabel,
  fetchGmailSignature,
  getCachedAccessToken,
  GmailMessageSummary,
  requestWorkspaceAccessToken,
  reconnectGoogleWorkspace,
  sendGmailMessage,
  modifyGmailMessageLabels,
  trashGmailMessage,
  untrashGmailMessage,
  deleteGmailMessagePermanently,
} from '@/lib/workspace';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { useContacts } from '@/hooks/useContacts';
import { Contact } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';
import MailMobileList from './MailMobileList';
import MailMobileReader from './MailMobileReader';

type MailFolder = 'INBOX' | 'UNREAD' | 'SENT' | 'SPAM' | 'TRASH' | 'STARRED' | 'DRAFT';

interface FolderConfig {
  id: MailFolder;
  label: string;
  icon: React.FC<{ className?: string }>;
  query?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

// Onglets principaux, affichés en haut façon Gmail V1 (Réception / Non lus / Spam / Envoyés)
const PRIMARY_FOLDERS: FolderConfig[] = [
  { id: 'INBOX', label: 'Réception', icon: Inbox, labelIds: ['INBOX'] },
  { id: 'UNREAD', label: 'Non lus', icon: MailOpen, labelIds: ['UNREAD'] },
  { id: 'SPAM', label: 'Spam', icon: ShieldAlert, labelIds: ['SPAM'], includeSpamTrash: true },
  { id: 'SENT', label: 'Envoyés', icon: SendHorizontal, labelIds: ['SENT'] },
];

// Dossiers moins utilisés — affichés directement à la suite des principaux
// sur la même ligne d'onglets (plus de menu "..." séparé).
const SECONDARY_FOLDERS: FolderConfig[] = [
  { id: 'STARRED', label: 'Favoris', icon: Star, labelIds: ['STARRED'] },
  { id: 'DRAFT', label: 'Brouillons', icon: FileText, labelIds: ['DRAFT'] },
  { id: 'TRASH', label: 'Corbeille', icon: Trash2, labelIds: ['TRASH'], includeSpamTrash: true },
];

const FOLDERS: FolderConfig[] = [...PRIMARY_FOLDERS, ...SECONDARY_FOLDERS];

// Signalé : "comme Gmail, la même interface sur ordinateur mais en plus
// design, avec les dossiers créés, favoris..." — sur ordinateur, les
// dossiers passent d'onglets horizontaux (façon mobile) à une vraie colonne
// latérale façon Gmail. Ordre pensé pour cette colonne (hiérarchie Gmail :
// Réception/Non lus/Favoris/Envoyés/Brouillons en avant, Spam/Corbeille en
// retrait) — distinct de l'ordre des onglets mobiles (PRIMARY puis
// SECONDARY, inchangé) pour ne pas perturber une habitude déjà acquise.
const SIDEBAR_FOLDER_ORDER: MailFolder[] = ['INBOX', 'UNREAD', 'STARRED', 'SENT', 'DRAFT', 'SPAM', 'TRASH'];
const SIDEBAR_FOLDERS: FolderConfig[] = SIDEBAR_FOLDER_ORDER
  .map((id) => FOLDERS.find((f) => f.id === id))
  .filter((f): f is FolderConfig => Boolean(f));

// Palette d'avatars colorés générée à partir du nom de l'expéditeur, façon
// icônes Gmail — stable (même expéditeur → même couleur) sans dépendre d'un
// vrai logo/favicon.
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

// Perf (audit du 20 octobre) : marquer lu/non lu ou supprimer une sélection
// de messages appelait l'API Gmail une fois PAR MESSAGE, strictement l'un
// après l'autre — une sélection de plusieurs dizaines de messages prenait
// plusieurs secondes. Traité par lots de LOT_MAX en parallèle plutôt que
// tout d'un coup, pour accélérer sans risquer de heurter les quotas par
// seconde de l'API Gmail sur une très grosse sélection.
const LOT_MAX_API_GMAIL = 5;
async function executerParLots<T>(items: T[], tache: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += LOT_MAX_API_GMAIL) {
    await Promise.all(items.slice(i, i + LOT_MAX_API_GMAIL).map(tache));
  }
}

/**
 * Convertit la signature Gmail (HTML) en texte lisible pour l'insérer dans le
 * corps du message, qui reste en texte brut (Content-Type: text/plain côté
 * envoi — voir sendGmailMessage). On préserve les sauts de ligne (<br>,
 * <p>, <li>) et on laisse le navigateur décoder les entités HTML (&eacute;...).
 */
const htmlSignatureToText = (html: string): string => {
  if (!html?.trim()) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n');
  const container = document.createElement('div');
  container.innerHTML = withBreaks;
  const text = container.textContent || '';
  return text
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Échappe le texte tapé par l'utilisateur avant de l'insérer dans un e-mail
 * HTML (corps + signature HTML avec photo — voir handleSend), pour ne jamais
 * interpréter accidentellement du HTML tapé par erreur dans le compositeur. */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Corps HTML final envoyé quand une signature HTML personnalisée (Paramètres
 * > Mail) est configurée : texte tapé (échappé, sauts de ligne préservés) +
 * signature HTML brute (mise en forme et photo conservées telles quelles). */
const buildHtmlBody = (plainBody: string, signatureHtml: string): string =>
  `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:13px;">${escapeHtml(plainBody)}</div><br>${signatureHtml}`;

/**
 * Rend le corps HTML d'un e-mail dans une <iframe> sandboxée.
 *
 * Les templates d'e-mails marketing contiennent souvent des balises <style>
 * avec des sélecteurs globaux non isolés (ex: `div { flex-grow: 1; }`, un
 * classique des hacks Gmail/Outlook dark-mode). Injecté directement dans la
 * page via dangerouslySetInnerHTML, ce CSS s'échappait du mail et cassait la
 * mise en page de toute l'application (avatars étirés, barre latérale
 * déformée...). L'iframe isole totalement le CSS/JS du mail — comme le font
 * Gmail et Outlook — et bloque aussi tout script malveillant (sandbox sans
 * allow-scripts ni allow-same-origin).
 */
const EmailHtmlFrame: React.FC<{ html: string }> = ({ html }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const resizeToContent = () => {
    const doc = iframeRef.current?.contentDocument;
    if (doc?.body) {
      setHeight(Math.min(doc.body.scrollHeight + 16, 2000));
    }
  };

  const handleFrameLoad = () => {
    resizeToContent();

    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;

    // Les signatures (photo, logo...) chargent leurs images de façon
    // asynchrone : au moment du `onLoad` de l'iframe, le document est prêt
    // mais les images n'ont pas forcément fini de charger, donc la hauteur
    // calculée à cet instant est trop courte et coupe le bas du contenu
    // (photo tronquée). On observe les images non encore chargées, et on
    // recalcule la hauteur à chacune de leurs fins de chargement — un
    // ResizeObserver sur le corps du document couvre aussi tout changement
    // de mise en page ultérieur (polices, etc.).
    Array.from(doc.querySelectorAll('img')).forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', resizeToContent, { once: true });
        img.addEventListener('error', resizeToContent, { once: true });
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => resizeToContent());
      observer.observe(doc.body);
      // Le document de l'iframe est recréé à chaque changement de `html`
      // (srcDoc) : pas besoin de déconnecter manuellement, l'ancien iframe
      // (et son observer) est simplement détruit par React.
    }
  };

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      onLoad={handleFrameLoad}
      // `allow-same-origin` (SANS `allow-scripts`) est nécessaire pour que le
      // code React puisse lire `contentDocument` et calculer la hauteur
      // réelle du contenu (photo de signature, etc.) — sans lui, l'accès à
      // contentDocument est bloqué par le sandbox (origine opaque), le
      // calcul de hauteur échouait silencieusement et la hauteur restait
      // bloquée sur la valeur de secours (200px), tronquant le bas du mail.
      // Le mail reste protégé : sans `allow-scripts`, aucun JS de l'e-mail
      // ne peut s'exécuter, qu'il ait ou non la même origine.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      title="Contenu du courriel"
      className="w-full border-0 rounded-lg bg-white"
      style={{ height }}
    />
  );
};

/**
 * Signalé : "quand on écrit un mail, essaie de prendre dans la base de
 * données du CRM pour gagner du temps" — champ Destinataire/Cc avec
 * suggestions issues des fiches contact du CRM (nom + e-mail), au lieu de
 * taper l'adresse en entier à chaque fois. Fonctionne aussi avec plusieurs
 * destinataires séparés par des virgules : la recherche/le remplacement ne
 * portent que sur le SEGMENT en cours de saisie (après la dernière
 * virgule), les destinataires déjà choisis avant restent intacts.
 */
const EmailAutocompleteInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
  contacts: Contact[];
  multiple?: boolean;
}> = ({ value, onChange, placeholder, required, contacts, multiple }) => {
  const [open, setOpen] = useState(false);
  const lastCommaIdx = value.lastIndexOf(',');
  const currentSegment = (lastCommaIdx >= 0 ? value.slice(lastCommaIdx + 1) : value).trim().toLowerCase();
  const suggestions = currentSegment.length >= 2
    ? contacts
        .filter((c) => c.email && (c.name?.toLowerCase().includes(currentSegment) || c.email.toLowerCase().includes(currentSegment)))
        .slice(0, 6)
    : [];

  const selectSuggestion = (email: string) => {
    const prefix = lastCommaIdx >= 0 ? `${value.slice(0, lastCommaIdx + 1)} ` : '';
    onChange(`${prefix}${email}`);
    setOpen(false);
  };

  return (
    <div className="relative flex-1 min-w-0">
      <input
        type={multiple ? 'email' : 'text'}
        multiple={multiple}
        required={required}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Délai court : sans lui, le clic sur une suggestion (onMouseDown)
        // n'a pas le temps de s'exécuter avant que le blur ne referme déjà
        // la liste.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0b292b] border border-[#1c4448] text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#0b292b] border border-[#1c4448] rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto custom-scrollbar">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(c.email); }}
              className="w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 hover:bg-white/5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[#F7BC5F]/20 text-[#F9C977] flex items-center justify-center text-[10px] font-black shrink-0">
                {getInitial(c.name || c.email)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{c.name || c.email}</p>
                <p className="text-[10px] text-slate-400 truncate">{c.email}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface MailViewProps {
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
  // Appelée après toute action qui change le nombre de mails non lus (lu/non
  // lu, spam, corbeille...) pour resynchroniser immédiatement la pastille de
  // la barre latérale, au lieu d'attendre son prochain sondage périodique.
  onUnreadCountChanged?: () => void;
  // Compteur réel de mails non lus (Gmail, `labels/UNREAD`) — la même source
  // que la tuile Accueil (ordinateur ET mobile). Utilisé pour le badge de
  // l'onglet "Non lus" au lieu de compter les mails localement chargés (qui
  // ne reflètent que le dossier actuellement affiché et sa pagination) —
  // sinon le badge ne correspond au vrai total que par coïncidence.
  unreadMailCount?: number;
  // Pré-remplit et ouvre le composeur avec ce destinataire (ex: depuis
  // "Nouveau Mail" dans la fiche client). `onInitialComposeConsumed` est
  // appelé une fois pris en compte pour éviter de rouvrir le composeur
  // à chaque re-render.
  initialComposeTo?: string | null;
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : automatisation
  // de pipeline — "sur Oui, ouvre un brouillon modifiable dans le CRM,
  // jamais d'envoi silencieux". Sujet/corps pré-remplis (le corps reste
  // modifiable avant tout envoi, comme un brouillon normal).
  initialComposeSubject?: string | null;
  initialComposeBody?: string | null;
  onInitialComposeConsumed?: () => void;
  // Dossier ouvert à l'arrivée (ex: 'UNREAD' depuis la tuile "Messagerie" de
  // l'accueil, qui doit ouvrir directement les mails non lus). Consommé une
  // fois pris en compte pour qu'un retour ultérieur par un autre chemin
  // (barre latérale, etc.) rouvre normalement la boîte de réception.
  initialFolder?: MailFolder;
  onInitialFolderConsumed?: () => void;
  // Compteur incrémenté par la barre du bas mobile (bouton « + ») pour
  // ouvrir un nouveau message. Un simple booléen ne suffirait pas : il
  // resterait à `true` après la première ouverture, et refermer puis
  // redemander un brouillon ne déclencherait plus rien.
  composeSignal?: number;
  // Prévient la coquille mobile qu'un message est ouvert : la barre du bas
  // remplace alors son « + Écrire » — pendant une lecture, l'action utile
  // est Répondre, et elle vit dans l'écran de lecture lui-même.
  onReadingChange?: (reading: boolean) => void;
}

export const MailView: React.FC<MailViewProps> = ({ fullScreen = false, onToggleFullScreen, onUnreadCountChanged, unreadMailCount, initialComposeTo, initialComposeSubject, initialComposeBody, onInitialComposeConsumed, initialFolder, onInitialFolderConsumed, composeSignal, onReadingChange }) => {
  const { currentUser } = useAuth();
  // Suggestions du composeur (À/Cc) — voir EmailAutocompleteInput plus haut.
  const { contacts } = useContacts();
  // Sur téléphone, la liste des messages est un écran à part entière (façon
  // Gmail : recherche ronde, tiroir de dossiers, gestes du doigt) — voir
  // MailMobileList. La lecture d'un message et le composeur restent communs
  // aux deux formats.
  const isMobile = useIsMobile();

  const [activeFolder, setActiveFolder] = useState<MailFolder>(initialFolder ?? 'INBOX');
  // Demande explicite : "des utilisateurs ont créé des dossiers [Gmail], il
  // faut synchroniser avec l'ordinateur et le téléphone" — jusqu'ici seuls
  // les 7 dossiers système fixes (FOLDERS ci-dessus) étaient proposés,
  // jamais les libellés personnalisés créés dans Gmail. Chargés en direct
  // depuis l'API Gmail (jamais stockés localement) : automatiquement
  // identiques sur tous les appareils, rien à synchroniser en plus.
  const [customLabels, setCustomLabels] = useState<GmailUserLabel[]>([]);
  const [activeCustomLabelId, setActiveCustomLabelId] = useState<string | null>(null);
  const [showLabelsMenu, setShowLabelsMenu] = useState(false);
  // Signalé (mobile) : cliquer sur "Mail" (dock d'accueil) ouvrait toujours
  // Réception au lieu de Non lus — useState(initialFolder) ne s'applique
  // qu'au tout premier montage du composant ; si MailView était déjà monté
  // pour une raison quelconque, une nouvelle valeur de `initialFolder` était
  // silencieusement ignorée. Ce useEffect réagit explicitement à chaque
  // changement de `initialFolder`, plus fiable que l'état initial seul.
  useEffect(() => {
    if (initialFolder) {
      setActiveFolder(initialFolder);
      onInitialFolderConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFolder]);
  const [mails, setMails] = useState<GmailMessageSummary[]>([]);
  const [selectedMail, setSelectedMail] = useState<GmailMessageSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Composer State
  const [showComposer, setShowComposer] = useState(false);
  const [composerMode, setComposerMode] = useState<'new' | 'reply' | 'reply-all' | 'forward'>('new');
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [replyThreadId, setReplyThreadId] = useState<string | undefined>();

  // Resynchronise le compteur de non-lus dès l'ouverture de la messagerie
  // (au lieu d'attendre le prochain sondage périodique de la tuile Accueil,
  // jusqu'à 5 min plus tard).
  useEffect(() => {
    onUnreadCountChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signature Gmail personnelle de l'utilisateur (récupérée une fois via
  // l'API Gmail, jamais remplacée par une signature commune à l'app).
  const [gmailSignature, setGmailSignature] = useState('');

  useEffect(() => {
    if (!currentUser) {
      setGmailSignature('');
      return;
    }
    (async () => {
      try {
        const token = await getGoogleToken();
        const html = await fetchGmailSignature(token);
        setGmailSignature(htmlSignatureToText(html));
      } catch (e) {
        console.warn('Impossible de récupérer la signature Gmail :', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // Signature HTML personnalisée configurée dans Paramètres > Mail (avec
  // photo éventuelle) — prioritaire sur la signature Gmail texte ci-dessus,
  // car elle seule permet de conserver mise en forme et images à l'envoi.
  const [customSignatureHtml, setCustomSignatureHtml] = useState('');

  useEffect(() => {
    if (!currentUser) {
      setCustomSignatureHtml('');
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from('user_ui_settings')
          .select('mail_signature_html, mail_signature_image_url')
          .eq('user_id', currentUser.uid)
          .maybeSingle();

        const html = (data?.mail_signature_html as string) || '';
        const imageUrl = (data?.mail_signature_image_url as string) || '';

        if (!html && !imageUrl) {
          setCustomSignatureHtml('');
          return;
        }

        // On ajoute automatiquement l'image en bas de la signature si elle
        // n'est pas déjà référencée dans le HTML (l'utilisateur peut aussi
        // l'insérer lui-même à un endroit précis dans le texte HTML).
        const hasImageAlready = imageUrl && html.includes(imageUrl);
        const imageTag = imageUrl && !hasImageAlready
          ? `<br><img src="${imageUrl}" alt="Signature" style="max-height:120px;">`
          : '';

        setCustomSignatureHtml(`${html}${imageTag}`);
      } catch (e) {
        console.warn('Impossible de récupérer la signature personnalisée :', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const getGoogleToken = async () => {
    let token = getCachedAccessToken();
    if (!token) {
      token = await requestWorkspaceAccessToken();
    }
    return token;
  };

  const loadMails = async (folder: MailFolder = activeFolder, customLabelId: string | null = activeCustomLabelId) => {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getGoogleToken();
      const folderCfg = FOLDERS.find(f => f.id === folder) || FOLDERS[0];

      const loaded = await fetchGmailMessages(token, customLabelId
        ? { maxResults: 50, labelIds: [customLabelId] }
        : { maxResults: 50, labelIds: folderCfg.labelIds, includeSpamTrash: folderCfg.includeSpamTrash }
      );

      setMails(loaded);

      if (selectedMail) {
        const refreshed = loaded.find(m => m.id === selectedMail.id);
        setSelectedMail(refreshed || null);
      }
    } catch (loadError) {
      console.error(loadError);
      setError((loadError as Error).message || 'Impossible de charger Gmail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMails(activeFolder, activeCustomLabelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, activeFolder, activeCustomLabelId]);

  // Charge la liste des libellés personnalisés une seule fois (indépendant
  // du dossier actif) — voir le commentaire sur customLabels plus haut.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getGoogleToken();
        const labels = await fetchGmailUserLabels(token);
        if (!cancelled) setCustomLabels(labels);
      } catch {
        // Best-effort : l'absence de dossiers personnalisés ne doit jamais
        // bloquer l'affichage des dossiers système normaux.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const filteredMails = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return mails;

    return mails.filter(mail =>
      mail.fromName.toLowerCase().includes(query) ||
      mail.from.toLowerCase().includes(query) ||
      mail.to.toLowerCase().includes(query) ||
      mail.subject.toLowerCase().includes(query) ||
      mail.snippet.toLowerCase().includes(query)
    );
  }, [mails, searchQuery]);

  const handleSelectMail = async (mail: GmailMessageSummary) => {
    setSelectedMail(mail);

    // Dans l'onglet "Non lus", un mail qu'on vient d'ouvrir reste visible
    // tant qu'on est en train de le lire (pas de disparition surprise sous
    // les yeux de l'utilisateur) — il ne sort réellement de la liste "Non
    // lus" qu'au moment où on clique sur un AUTRE mail.
    if (activeFolder === 'UNREAD') {
      setMails(prev => prev.filter(m => m.id === mail.id || !m.isRead));
    }

    if (!mail.isRead) {
      // Mise à jour optimiste immédiate : le mail quitte visuellement l'état
      // "non lu" dès le clic, sans attendre la réponse de l'API Gmail.
      mail.isRead = true;
      setMails(prev => prev.map(m => m.id === mail.id ? { ...m, isRead: true } : m));

      try {
        const token = await getGoogleToken();
        await modifyGmailMessageLabels(token, mail.id, [], ['UNREAD']);
        onUnreadCountChanged?.();
      } catch (e) {
        console.warn('Failed to auto-mark email as read:', e);
      }
    }
  };

  // Mail Actions
  const toggleStar = async (mail: GmailMessageSummary, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isStarred = mail.labelIds.includes('STARRED');
    setActionBusy(mail.id);
    try {
      const token = await getGoogleToken();
      if (isStarred) {
        await modifyGmailMessageLabels(token, mail.id, [], ['STARRED']);
      } else {
        await modifyGmailMessageLabels(token, mail.id, ['STARRED'], []);
      }
      setMails(prev => prev.map(m => {
        if (m.id !== mail.id) return m;
        const nextLabels = isStarred
          ? m.labelIds.filter(l => l !== 'STARRED')
          : [...m.labelIds, 'STARRED'];
        return { ...m, labelIds: nextLabels };
      }));
      if (selectedMail?.id === mail.id) {
        setSelectedMail(prev => prev ? {
          ...prev,
          labelIds: isStarred ? prev.labelIds.filter(l => l !== 'STARRED') : [...prev.labelIds, 'STARRED']
        } : null);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la mise à jour de l\'étoile.');
    } finally {
      setActionBusy(null);
    }
  };

  const toggleReadStatus = async (mail: GmailMessageSummary) => {
    setActionBusy(mail.id);
    try {
      const token = await getGoogleToken();
      if (mail.isRead) {
        await modifyGmailMessageLabels(token, mail.id, ['UNREAD'], []);
      } else {
        await modifyGmailMessageLabels(token, mail.id, [], ['UNREAD']);
      }
      const nextRead = !mail.isRead;
      setMails(prev => prev.map(m => m.id === mail.id ? { ...m, isRead: nextRead } : m));
      if (selectedMail?.id === mail.id) {
        setSelectedMail(prev => prev ? { ...prev, isRead: nextRead } : null);
      }
      onUnreadCountChanged?.();
    } catch (err: any) {
      setError(err.message || 'Erreur lors du changement de statut de lecture.');
    } finally {
      setActionBusy(null);
    }
  };

  const moveToSpam = async (mail: GmailMessageSummary) => {
    setActionBusy(mail.id);
    try {
      const token = await getGoogleToken();
      const isSpam = mail.labelIds.includes('SPAM');
      if (isSpam) {
        await modifyGmailMessageLabels(token, mail.id, ['INBOX'], ['SPAM']);
        setSuccess('Message déplacé dans la Boîte de réception.');
      } else {
        await modifyGmailMessageLabels(token, mail.id, ['SPAM'], ['INBOX']);
        setSuccess('Message signalé comme spam et déplacé.');
      }
      setMails(prev => prev.filter(m => m.id !== mail.id));
      if (selectedMail?.id === mail.id) setSelectedMail(null);
      onUnreadCountChanged?.();
    } catch (err: any) {
      setError(err.message || 'Erreur lors du traitement du spam.');
    } finally {
      setActionBusy(null);
    }
  };

  const moveToTrash = async (mail: GmailMessageSummary) => {
    setActionBusy(mail.id);
    try {
      const token = await getGoogleToken();
      await trashGmailMessage(token, mail.id);
      setSuccess('Message déplacé dans la corbeille.');
      setMails(prev => prev.filter(m => m.id !== mail.id));
      if (selectedMail?.id === mail.id) setSelectedMail(null);
      onUnreadCountChanged?.();
    } catch (err: any) {
      setError(err.message || 'Erreur lors du déplacement dans la corbeille.');
    } finally {
      setActionBusy(null);
    }
  };

  const restoreFromTrash = async (mail: GmailMessageSummary) => {
    setActionBusy(mail.id);
    try {
      const token = await getGoogleToken();
      await untrashGmailMessage(token, mail.id);
      setSuccess('Message restauré depuis la corbeille.');
      setMails(prev => prev.filter(m => m.id !== mail.id));
      if (selectedMail?.id === mail.id) setSelectedMail(null);
      onUnreadCountChanged?.();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la restauration.');
    } finally {
      setActionBusy(null);
    }
  };

  const deletePermanently = async (mail: GmailMessageSummary) => {
    if (!window.confirm('Supprimer définitivement ce courriel ? Cette action est irréversible.')) return;
    setActionBusy(mail.id);
    try {
      const token = await getGoogleToken();
      await deleteGmailMessagePermanently(token, mail.id);
      setSuccess('Message supprimé définitivement.');
      setMails(prev => prev.filter(m => m.id !== mail.id));
      if (selectedMail?.id === mail.id) setSelectedMail(null);
      onUnreadCountChanged?.();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression définitive.');
    } finally {
      setActionBusy(null);
    }
  };

  // Actions GROUPÉES — utilisées par l'écran mobile : un balayage n'agit que
  // sur un message, une sélection par appui long peut en viser plusieurs.
  // Écrites à part des fonctions unitaires ci-dessus pour ne demander
  // confirmation qu'UNE fois pour tout le lot, ne resynchroniser le compteur
  // de non-lus qu'à la fin, et ne retirer de la liste que ce qui est
  // réellement passé côté Gmail (si le lot casse en cours de route, les
  // messages restants restent affichés plutôt que de disparaître à tort).
  const setMailsRead = async (list: GmailMessageSummary[], read: boolean): Promise<boolean> => {
    if (list.length === 0) return false;
    setActionBusy(list[0].id);
    const done: string[] = [];
    try {
      const token = await getGoogleToken();
      await executerParLots(list, async (mail) => {
        if (mail.isRead !== read) {
          if (read) await modifyGmailMessageLabels(token, mail.id, [], ['UNREAD']);
          else await modifyGmailMessageLabels(token, mail.id, ['UNREAD'], []);
        }
        done.push(mail.id);
      });
    } catch (err: any) {
      setError(err.message || 'Erreur lors du changement de statut de lecture.');
    } finally {
      if (done.length > 0) {
        const ids = new Set(done);
        setMails(prev => prev.map(m => (ids.has(m.id) ? { ...m, isRead: read } : m)));
        if (selectedMail && ids.has(selectedMail.id)) {
          setSelectedMail(prev => (prev ? { ...prev, isRead: read } : null));
        }
        onUnreadCountChanged?.();
      }
      setActionBusy(null);
    }
    return done.length > 0;
  };

  const deleteMails = async (list: GmailMessageSummary[]): Promise<boolean> => {
    if (list.length === 0) return false;
    // Dans la corbeille, il n'y a plus de filet : la suppression est
    // définitive, donc confirmée — une fois pour tout le lot.
    //
    // Relecture : `activeFolder` ne se remet PAS à zéro quand on ouvre un
    // dossier personnalisé (seul `activeCustomLabelId` change). Sans le
    // premier test, passer par la Corbeille puis ouvrir un dossier Gmail
    // personnalisé faisait supprimer DÉFINITIVEMENT les messages balayés.
    const permanent = !activeCustomLabelId && activeFolder === 'TRASH';
    if (permanent) {
      const question = list.length > 1
        ? `Supprimer définitivement ces ${list.length} courriels ? Cette action est irréversible.`
        : 'Supprimer définitivement ce courriel ? Cette action est irréversible.';
      if (!window.confirm(question)) return false;
    } else if (list.length > 1) {
      // Signalé : « je coche des messages, j'appuie sur corbeille et ça part
      // directement ». Un balayage ne vise qu'un message et reste facile à
      // rattraper ; une sélection peut en emporter dix d'un seul geste, sans
      // aucune annulation possible ensuite. Ce lot-là se confirme.
      if (!window.confirm(`Mettre ces ${list.length} messages à la corbeille ?`)) return false;
    }
    setActionBusy(list[0].id);
    const done: string[] = [];
    try {
      const token = await getGoogleToken();
      await executerParLots(list, async (mail) => {
        if (permanent) await deleteGmailMessagePermanently(token, mail.id);
        else await trashGmailMessage(token, mail.id);
        done.push(mail.id);
      });
      setSuccess(
        permanent
          ? (list.length > 1 ? `${list.length} messages supprimés définitivement.` : 'Message supprimé définitivement.')
          : (list.length > 1 ? `${list.length} messages déplacés dans la corbeille.` : 'Message déplacé dans la corbeille.')
      );
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression.');
    } finally {
      if (done.length > 0) {
        const ids = new Set(done);
        setMails(prev => prev.filter(m => !ids.has(m.id)));
        if (selectedMail && ids.has(selectedMail.id)) setSelectedMail(null);
        onUnreadCountChanged?.();
      }
      setActionBusy(null);
    }
    return done.length > 0;
  };

  // Composer Actions
  const resetComposer = () => {
    setComposeTo('');
    setComposeCc('');
    setComposeSubject('');
    setComposeBody('');
    setReplyThreadId(undefined);
    setShowCc(false);
    setComposerMode('new');
  };

  // Signature HTML personnalisée (Paramètres > Mail, avec photo) prioritaire
  // sur la signature Gmail texte : quand elle existe, elle n'est PAS insérée
  // dans le texte tapé (elle est affichée à part, en aperçu, et ajoutée en
  // HTML réel à l'envoi — voir handleSend) pour ne pas afficher du HTML brut
  // dans un simple champ texte.
  const usingHtmlSignature = Boolean(customSignatureHtml.trim());

  // Ajoutée en bas du corps de chaque nouveau message quand il n'y a pas de
  // signature HTML personnalisée — la signature réelle de l'utilisateur
  // telle que configurée dans SON compte Gmail.
  const signatureBlock = !usingHtmlSignature && gmailSignature ? `\n\n${gmailSignature}` : '';

  const openNewMessage = () => {
    resetComposer();
    setComposerMode('new');
    setComposeBody(signatureBlock);
    setError(null);
    setSuccess(null);
    setShowComposer(true);
  };

  // Ouverture automatique du composeur avec un destinataire pré-rempli
  // (déclenché depuis "Nouveau Mail" sur la fiche client).
  useEffect(() => {
    // `initialComposeTo` seul déclenchait avant ; une automatisation de
    // pipeline sans e-mail client renseigné doit quand même ouvrir le
    // brouillon (sujet/corps prêts, destinataire à compléter à la main) —
    // sinon on perdrait silencieusement le sujet/corps préparés.
    if (!initialComposeTo && !initialComposeSubject && !initialComposeBody) return;
    resetComposer();
    setComposerMode('new');
    setComposeTo(initialComposeTo || '');
    // Brouillon d'automatisation de pipeline (sujet/corps pré-remplis) —
    // sinon comportement inchangé (juste la signature).
    setComposeSubject(initialComposeSubject || '');
    setComposeBody(initialComposeBody ? `${initialComposeBody}\n\n${signatureBlock}` : signatureBlock);
    setError(null);
    setSuccess(null);
    setShowComposer(true);
    onInitialComposeConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialComposeTo, initialComposeSubject, initialComposeBody]);

  // Bouton « + » de la barre du bas, sur téléphone : ouvre un brouillon vide.
  //
  // Relecture : comparer le compteur à 0 ne suffisait pas. MailView est
  // démonté quand on quitte l'écran Mail ; en y revenant, l'effet se
  // rejouait avec un compteur toujours supérieur à 0 et rouvrait le
  // composeur tout seul — en écrasant au passage un brouillon pré-rempli
  // venu de la fiche client. On mémorise donc la dernière valeur TRAITÉE,
  // initialisée à la valeur reçue au montage : un remontage ne déclenche
  // plus rien, seul un nouvel appui sur « + » le fait.
  const lastComposeSignal = useRef(composeSignal ?? 0);
  useEffect(() => {
    const signal = composeSignal ?? 0;
    if (signal === lastComposeSignal.current) return;
    lastComposeSignal.current = signal;
    if (!signal) return;
    // Un composeur déjà ouvert n'est jamais réinitialisé sous les doigts de
    // l'utilisateur : le « + » reste visible au-dessus du composeur sur
    // certains téléphones, un appui malheureux effacerait le brouillon.
    if (showComposer) return;
    openNewMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeSignal, showComposer]);

  const openReply = (mail: GmailMessageSummary) => {
    resetComposer();
    setComposerMode('reply');
    setComposeTo(mail.from);
    setComposeSubject(
      mail.subject.toLowerCase().startsWith('re:') ? mail.subject : `Re: ${mail.subject}`
    );
    setComposeBody(`${signatureBlock}\n\n--- Message d'origine ---\nDe : ${mail.fromName} <${mail.from}>\nDate : ${mail.date}\nObjet : ${mail.subject}\n\n${mail.bodyText}`);
    setReplyThreadId(mail.threadId);
    setError(null);
    setSuccess(null);
    setShowComposer(true);
  };

  const openReplyAll = (mail: GmailMessageSummary) => {
    resetComposer();
    setComposerMode('reply-all');
    setComposeTo(mail.from);
    if (mail.to) {
      setComposeCc(mail.to);
      setShowCc(true);
    }
    setComposeSubject(
      mail.subject.toLowerCase().startsWith('re:') ? mail.subject : `Re: ${mail.subject}`
    );
    setComposeBody(`${signatureBlock}\n\n--- Message d'origine ---\nDe : ${mail.fromName} <${mail.from}>\nÀ : ${mail.to}\nDate : ${mail.date}\nObjet : ${mail.subject}\n\n${mail.bodyText}`);
    setReplyThreadId(mail.threadId);
    setError(null);
    setSuccess(null);
    setShowComposer(true);
  };

  const openForward = (mail: GmailMessageSummary) => {
    resetComposer();
    setComposerMode('forward');
    setComposeTo('');
    setComposeSubject(
      mail.subject.toLowerCase().startsWith('fwd:') || mail.subject.toLowerCase().startsWith('tr:')
        ? mail.subject
        : `Tr: ${mail.subject}`
    );
    setComposeBody(`${signatureBlock}\n\n-------- Message transféré --------\nDe : ${mail.fromName} <${mail.from}>\nDate : ${mail.date}\nObjet : ${mail.subject}\nÀ : ${mail.to}\n\n${mail.bodyText}`);
    setError(null);
    setSuccess(null);
    setShowComposer(true);
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!composeTo.trim()) {
      setError("L'adresse du destinataire est obligatoire.");
      return;
    }

    if (!composeSubject.trim()) {
      setError("L'objet est obligatoire.");
      return;
    }

    if (!composeBody.trim()) {
      setError('Le message est vide.');
      return;
    }

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getGoogleToken();

      let finalTo = composeTo.trim();
      if (composeCc.trim()) {
        finalTo += `, ${composeCc.trim()}`;
      }

      await sendGmailMessage(token, {
        to: finalTo,
        subject: composeSubject.trim(),
        body: composeBody.trim(),
        // Signature HTML personnalisée (avec photo) : le message est alors
        // envoyé en HTML pour la conserver telle quelle chez le destinataire.
        bodyHtml: usingHtmlSignature ? buildHtmlBody(composeBody.trim(), customSignatureHtml) : undefined,
        threadId: replyThreadId,
      });

      setSuccess('Le message a été envoyé avec succès via Gmail.');
      resetComposer();
      setShowComposer(false);
      await loadMails(activeFolder);
    } catch (sendError) {
      console.error(sendError);
      setError((sendError as Error).message || "Impossible d'envoyer le message.");
    } finally {
      setSending(false);
    }
  };

  // Source unique de vérité (Gmail `labels/UNREAD`, partagée avec la tuile
  // Accueil) — jamais la liste locale, qui ne couvre que le dossier ouvert.
  const unreadCount = unreadMailCount ?? 0;

  // Écran mobile complet (liste + tiroir de dossiers + gestes du doigt) tant
  // qu'aucun message n'est ouvert ; dès qu'on en lit un, on retombe sur le
  // panneau de lecture, commun aux deux formats.
  const mobileList = isMobile && !selectedMail;
  const mobileReader = isMobile && !!selectedMail;
  const inTrash = !activeCustomLabelId && activeFolder === 'TRASH';

  useEffect(() => {
    onReadingChange?.(mobileReader);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileReader]);
  // Quitter l'écran Mail démonte MailView : la barre du bas doit alors
  // retrouver son « + », sans quoi il resterait masqué au prochain passage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onReadingChange?.(false), []);
  // Le bandeau mobile est un calque posé au-dessus de la liste : laissé
  // affiché, il masque une ligne de messages, et une vieille erreur non
  // fermée cachait toutes les confirmations suivantes (le bandeau n'en
  // affiche qu'une). Il s'efface donc de lui-même.
  useEffect(() => {
    if (!mobileList || (!error && !success)) return;
    const timer = window.setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [mobileList, error, success]);
  const activeFolderLabel = activeCustomLabelId
    ? (customLabels.find((l) => l.id === activeCustomLabelId)?.name || 'Dossier')
    : (FOLDERS.find((f) => f.id === activeFolder)?.label || 'Réception');

  return (
    // Signalé : sur mobile, en lisant un mail, l'espace entre la barre
    // Retour/Répondre/Transférer et le contenu (puis tout le cadre autour du
    // mail lui-même) prenait trop de place à l'écran pour peu de gain —
    // resserré ci-dessous et sur le panneau de lecture juste en dessous.
    // `h-full` bornait la colonne mobile à la hauteur de la fenêtre : au-delà
    // d'un écran de messages, la barre de recherche « collée en haut » sortait
    // du champ de son conteneur et disparaissait. `min-h-full` la laisse
    // s'étendre avec la liste. L'ordinateur garde `h-full`, dont dépendent la
    // colonne latérale et le panneau de lecture.
    <div className={`${mobileList ? 'min-h-full' : mobileReader ? 'h-full' : 'p-4 sm:p-6 h-full'} max-w-[1600px] mx-auto flex flex-col gap-2 sm:gap-4 text-white`}>
      {/* `mobileList`, et non `isMobile` : sur téléphone, ce test était
          toujours vrai, la branche de LECTURE juste en dessous n'était donc
          jamais atteinte. Appuyer sur un message enregistrait la sélection
          mais la liste restait affichée — le message ne s'ouvrait pas. */}
      {mobileList ? (
        <>
          {/* Retours d'action : la liste mobile occupe tout l'écran, le
              message s'affiche donc en surimpression, juste au-dessus de la
              barre de navigation du bas. */}
          {(error || success) && (
            <div
              // Les nuances 200 ne sont pas reprises par le remappage d'encre
              // du mode jour (il ne couvre que les nuances 300 à 500) : le
              // texte restait pastel sur fond clair, illisible. 400 tombe sur
              // --ink-red / --ink-emerald en mode jour, et reste lisible sur
              // fond sombre en mode nuit.
              className={`fixed left-3 right-3 z-[65] px-4 py-3 rounded-2xl text-xs font-semibold flex items-center justify-between gap-3 shadow-2xl bg-[#0b292b] border ${
                error ? 'border-rose-500/40 text-rose-400' : 'border-emerald-500/40 text-emerald-400'
              }`}
              style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
            >
              <span className="min-w-0">{error || success}</span>
              <button
                onClick={() => { setError(null); setSuccess(null); }}
                className="shrink-0 opacity-70"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <MailMobileList
            mails={filteredMails}
            loading={loading}
            folders={SIDEBAR_FOLDERS}
            activeFolderId={activeFolder}
            activeFolderLabel={activeFolderLabel}
            isTrash={inTrash}
            customLabels={customLabels}
            activeCustomLabelId={activeCustomLabelId}
            unreadCount={unreadCount}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectFolder={(id) => {
              setActiveFolder(id as MailFolder);
              setActiveCustomLabelId(null);
              setSelectedMail(null);
            }}
            onSelectCustomLabel={(id) => {
              setActiveCustomLabelId(id);
              setSelectedMail(null);
            }}
            onOpenMail={handleSelectMail}
            onToggleStar={toggleStar}
            onSetRead={setMailsRead}
            onDelete={deleteMails}
            onRefresh={() => void loadMails(activeFolder)}
            userEmail={currentUser?.email ?? undefined}
          />
        </>
      ) : mobileReader && selectedMail ? (
        <>
          {(error || success) && (
            <div
              className={`fixed left-3 right-3 z-[65] px-4 py-3 rounded-2xl text-xs font-semibold flex items-center justify-between gap-3 shadow-2xl bg-[#0b292b] border ${
                error ? 'border-rose-500/40 text-rose-400' : 'border-emerald-500/40 text-emerald-400'
              }`}
              style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
            >
              <span className="min-w-0">{error || success}</span>
              <button
                onClick={() => { setError(null); setSuccess(null); }}
                className="shrink-0 opacity-70"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <MailMobileReader
            mail={selectedMail}
            folderLabel={activeFolderLabel}
            isTrash={inTrash}
            body={selectedMail.bodyHtml ? (
              <EmailHtmlFrame html={selectedMail.bodyHtml} />
            ) : (
              <pre className="px-3 text-sm text-slate-200 whitespace-pre-wrap font-sans leading-relaxed break-words">
                {selectedMail.bodyText}
              </pre>
            )}
            onBack={() => setSelectedMail(null)}
            onReply={() => openReply(selectedMail)}
            onReplyAll={() => openReplyAll(selectedMail)}
            onForward={() => openForward(selectedMail)}
            onToggleRead={() => void toggleReadStatus(selectedMail)}
            onToggleStar={(e) => toggleStar(selectedMail, e)}
            onSpam={() => void moveToSpam(selectedMail)}
            onTrash={() => void moveToTrash(selectedMail)}
            onRestore={() => void restoreFromTrash(selectedMail)}
            onDeleteForever={() => void deletePermanently(selectedMail)}
          />
        </>
      ) : (
      <>
      {/* ONGLETS PRINCIPAUX — remplace l'ancienne barre d'en-tête séparée
          (titre "Mail" + recherche + actions), fusionnée ici pour libérer
          une ligne entière au profit de la lecture du mail. */}
      {/* Signalé (03/09/2026) : sur ordinateur, cette rangée ne portait plus
          que la petite recherche Gmail (jugée inutile : elle ne filtrait que
          les messages déjà chargés) et le bouton Actualiser. Elle est donc
          masquée sur grand écran tant qu'aucun message n'est ouvert ; la
          recherche reste dans la liste mobile et Actualiser passe dans la
          colonne latérale. */}
      <div className={`${selectedMail ? '' : 'lg:hidden '}shrink-0 flex items-center gap-2 bg-[#071f21] border border-[#1c4448] p-1.5 rounded-2xl relative overflow-x-auto`}>
        {/* Ticket #32 (nouvelle base) : ces onglets restaient affichés même
            en train de lire un message, poussant le bouton "Retour" hors de
            l'écran sur mobile (toute la ligne défilait horizontalement) —
            sans moyen visible de revenir à la liste sans repasser par
            Réception. On les masque pendant la lecture d'un message.
            Signalé : "comme Gmail sur ordinateur" — sur grand écran, les
            dossiers vivent désormais dans la colonne latérale (ci-dessous),
            cette rangée d'onglets redevient donc mobile-only. */}
        {!selectedMail && FOLDERS.map(folder => {
          const isActive = !activeCustomLabelId && activeFolder === folder.id;
          const IconComp = folder.icon;
          return (
            <button
              key={folder.id}
              onClick={() => {
                setActiveFolder(folder.id);
                setActiveCustomLabelId(null);
                setSelectedMail(null);
              }}
              className={`lg:hidden px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-all shrink-0 ${
                isActive
                  ? 'bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/40'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <IconComp className="w-3.5 h-3.5" />
              {folder.label}
              {folder.id === 'UNREAD' && unreadCount > 0 && (
                <span className="text-[10px] bg-[#F7BC5F] text-[#061719] rounded-full px-1.5 py-0.5 font-black">{unreadCount}</span>
              )}
            </button>
          );
        })}

        {/* Dossiers personnalisés Gmail (libellés créés par l'utilisateur,
            hors dossiers système ci-dessus) — regroupés dans un petit menu
            à part plutôt qu'ajoutés un par un à la ligne d'onglets, pour ne
            pas la faire déborder si quelqu'un a créé beaucoup de libellés.
            Mobile uniquement : sur ordinateur, ils sont listés directement
            dans la colonne latérale, plus besoin de menu déroulant. */}
        {!selectedMail && customLabels.length > 0 && (
          <div className="lg:hidden relative shrink-0">
            <button
              onClick={() => setShowLabelsMenu((v) => !v)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-all shrink-0 ${
                activeCustomLabelId
                  ? 'bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/40'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {customLabels.find((l) => l.id === activeCustomLabelId)?.name || 'Dossiers'}
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {showLabelsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowLabelsMenu(false)} />
                <div className="absolute top-full left-0 mt-1.5 z-50 w-56 max-h-72 overflow-y-auto custom-scrollbar bg-[#0b292b] border border-[#1c4448] rounded-xl shadow-2xl py-1.5">
                  {customLabels.map((label) => (
                    <button
                      key={label.id}
                      onClick={() => {
                        setActiveCustomLabelId(label.id);
                        setSelectedMail(null);
                        setShowLabelsMenu(false);
                      }}
                      className={`w-full text-left px-3.5 py-2 text-xs font-semibold flex items-center gap-2 truncate ${
                        activeCustomLabelId === label.id ? 'text-[#F7BC5F] bg-[#F7BC5F]/10' : 'text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{label.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {selectedMail && (
          <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-white/10 shrink-0 flex-wrap">
            <button
              onClick={() => setSelectedMail(null)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white flex items-center gap-1.5 border border-white/10"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Retour
            </button>
            <button
              onClick={() => openReply(selectedMail)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white flex items-center gap-1.5 border border-white/10"
            >
              <Reply className="w-3.5 h-3.5 text-[#F7BC5F]" />
              Répondre
            </button>
            <button
              onClick={() => openReplyAll(selectedMail)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white flex items-center gap-1.5 border border-white/10"
            >
              <ReplyAll className="w-3.5 h-3.5 text-[#F7BC5F]" />
              Tous
            </button>
            <button
              onClick={() => openForward(selectedMail)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white flex items-center gap-1.5 border border-white/10 mr-1"
            >
              <Forward className="w-3.5 h-3.5 text-[#F7BC5F]" />
              Transférer
            </button>

            <button
              onClick={() => toggleReadStatus(selectedMail)}
              title={selectedMail.isRead ? 'Marquer non lu' : 'Marquer lu'}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"
            >
              <Mail className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => moveToSpam(selectedMail)}
              title={selectedMail.labelIds.includes('SPAM') ? 'Non spam' : 'Marquer comme Spam'}
              className="p-2 rounded-lg bg-[#F7BC5F]/10 text-[#FAD592] border border-[#F7BC5F]/20 hover:bg-[#F7BC5F]/20"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
            </button>

            {activeFolder === 'TRASH' ? (
              <>
                <button
                  onClick={() => restoreFromTrash(selectedMail)}
                  title="Restaurer"
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                >
                  Restaurer
                </button>
                <button
                  onClick={() => deletePermanently(selectedMail)}
                  title="Supprimer définitivement"
                  className="p-2 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={() => moveToTrash(selectedMail)}
                title="Mettre à la corbeille"
                className="p-2 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0 pl-2 ml-1 border-l border-white/10 ml-auto">
          <button
            onClick={() => void loadMails(activeFolder)}
            disabled={loading}
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-50 flex items-center justify-center transition-all shrink-0"
            title="Actualiser"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#F7BC5F]' : ''}`} />
          </button>

          {/* Sur ordinateur, "Nouveau message" vit désormais tout en haut de
              la colonne latérale façon Gmail (ci-dessous) — gardé ici en
              mobile uniquement pour ne pas en avoir deux à l'écran. */}
          <button
            onClick={() => openNewMessage()}
            className="lg:hidden bg-[#F7BC5F] hover:bg-[#d9ab38] text-[#061719] font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-[#F7BC5F]/10 cursor-pointer whitespace-nowrap"
          >
            <Edit className="w-4 h-4" />
            <span>Nouveau</span>
          </button>
        </div>
      </div>

      {/* Signalé : "comme Gmail, la même interface sur ordinateur mais en
          plus design, avec les dossiers créés, favoris..." — colonne
          latérale visible en permanence sur grand écran (Gmail : dossiers
          toujours accessibles d'un clic, jamais cachés dans un onglet ou un
          menu). Masquée sur mobile, où la rangée d'onglets du haut reste le
          bon format (peu de place verticale disponible). */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Signalé (30/08/2026, capture d'écran) : "on ne voit rien sur la
            gauche" — cette colonne était totalement transparente (aucun
            fond), donc directement sur l'image de fond personnalisée
            quand elle est active, illisible. Fond opaque ajouté, même
            principe que le panneau Chat équipe (bg-[#050f11], blanc en
            mode jour via le remap déjà en place). */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col gap-4 overflow-y-auto custom-scrollbar bg-[#050f11] rounded-2xl p-3">
          <button
            onClick={() => openNewMessage()}
            className="w-full bg-[#F7BC5F] hover:bg-[#d9ab38] text-[#061719] font-black text-sm px-4 py-3 rounded-2xl flex items-center justify-center gap-2.5 transition-all shadow-lg shadow-[#F7BC5F]/20 cursor-pointer"
          >
            <Edit className="w-4.5 h-4.5" />
            Nouveau message
          </button>
          <button
            onClick={() => void loadMails(activeFolder)}
            disabled={loading}
            title="Actualiser"
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#F7BC5F]' : ''}`} />
            Actualiser
          </button>

          <nav className="space-y-0.5">
            {SIDEBAR_FOLDERS.map((folder) => {
              const isActive = !activeCustomLabelId && activeFolder === folder.id;
              const IconComp = folder.icon;
              // Halo doux + pastille active façon Gmail (pilule collée au
              // bord gauche, arrondie seulement à droite) plutôt qu'un
              // simple bouton plein — plus proche du modèle Gmail et plus
              // distinctif visuellement ("en plus design").
              return (
                <button
                  key={folder.id}
                  onClick={() => {
                    setActiveFolder(folder.id);
                    setActiveCustomLabelId(null);
                    setSelectedMail(null);
                  }}
                  className={`w-full text-left pl-4 pr-3 py-2.5 rounded-r-full text-[13px] flex items-center gap-3 transition-all ${
                    isActive
                      ? 'bg-[#F7BC5F]/15 text-[#F9C977] font-bold shadow-[inset_3px_0_0_0_#F7BC5F]'
                      : 'text-slate-300 font-medium hover:bg-white/5'
                  }`}
                >
                  <IconComp className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#F9C977]' : 'text-slate-400'}`} />
                  <span className="flex-1 truncate">{folder.label}</span>
                  {folder.id === 'UNREAD' && unreadCount > 0 && (
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-black shrink-0 ${isActive ? 'bg-[#F7BC5F] text-[#061719]' : 'bg-white/10 text-slate-300'}`}>
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Dossiers créés (libellés Gmail personnalisés) — visibles en
              permanence ici sur ordinateur, plus besoin d'ouvrir un menu. */}
          {customLabels.length > 0 && (
            <div>
              <p className="px-4 mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Dossiers</p>
              <nav className="space-y-0.5">
                {customLabels.map((label) => {
                  const isActive = activeCustomLabelId === label.id;
                  return (
                    <button
                      key={label.id}
                      onClick={() => {
                        setActiveCustomLabelId(label.id);
                        setSelectedMail(null);
                      }}
                      className={`w-full text-left pl-4 pr-3 py-2.5 rounded-r-full text-[13px] flex items-center gap-3 transition-all ${
                        isActive
                          ? 'bg-[#F7BC5F]/15 text-[#F9C977] font-bold shadow-[inset_3px_0_0_0_#F7BC5F]'
                          : 'text-slate-300 font-medium hover:bg-white/5'
                      }`}
                    >
                      <FolderOpen className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#F9C977]' : 'text-slate-400'}`} />
                      <span className="flex-1 truncate">{label.name}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2 sm:gap-4 min-h-0">
      {/* NOTIFICATIONS */}
      {error && (
        <div className="shrink-0 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Signalé (3 septembre, Pauline / ImmoSphera) : l'erreur d'accès
                Google restait affichée sans issue. Le bouton relance
                l'autorisation Google de sa société, là où l'erreur se voit. */}
            {/google|workspace|authenti|scope|401|403/i.test(error) && (
              <button
                type="button"
                onClick={() => { void reconnectGoogleWorkspace().catch((e: any) => setError(e?.message || String(e))); }}
                className="px-3 py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-xs flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reconnecter Google
              </button>
            )}
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="shrink-0 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* MAIN GRID — liste pleine largeur tant qu'aucun mail n'est sélectionné,
          puis split liste (réduite) + détail façon Gmail V1. flex-1 + min-h-0
          pour occuper TOUT l'espace vertical restant de la fenêtre (au lieu
          d'une hauteur figée trop petite). */}
      {/* Signalé (suivi) : en lisant un mail court sur mobile, la carte de
          contenu restait "petite" en haut avec un grand vide sombre en
          dessous jusqu'à la barre du bas. Cause : la grille CSS étire par
          défaut ("stretch") chaque colonne à la même hauteur que la ligne —
          donc le panneau de lecture prenait toujours TOUTE la hauteur
          disponible de l'écran, même quand son contenu (un mail de 5
          lignes) était bien plus court, laissant ce vide visible en
          dessous. `items-start` sur mobile laisse chaque panneau se
          dimensionner selon son propre contenu — le vide disparaît, la
          page défile normalement s'il y a plus de contenu que l'écran. */}
      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 items-start lg:items-stretch">
        {/* MAILS LIST */}
        <div className={`${selectedMail ? 'hidden lg:flex lg:col-span-4' : 'lg:col-span-12 flex'} bg-[#071f21] border border-[#1c4448] rounded-2xl flex-col overflow-hidden min-h-0`}>
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-12">
              <Loader2 className="w-7 h-7 animate-spin text-[#F7BC5F] mb-3" />
              <p className="text-xs font-semibold">Chargement de la boîte...</p>
            </div>
          ) : filteredMails.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-12">
              <Inbox className="w-8 h-8 mb-3 text-slate-600" />
              <p className="text-xs font-medium text-slate-400">Aucun message trouvé dans ce dossier.</p>
            </div>
          ) : (
            <div className="overflow-y-auto custom-scrollbar flex-1 min-h-0 divide-y divide-white/5">
              {filteredMails.map(mail => {
                const isSelected = selectedMail?.id === mail.id;
                const isStarred = mail.labelIds.includes('STARRED');
                const senderLabel = mail.fromName || mail.from;
                // Ticket #17 (nouvelle base) : affiche la vraie photo du
                // collaborateur quand l'adresse de l'expéditeur correspond à
                // un membre de l'équipe, au lieu d'une pastille d'initiale
                // générique dans tous les cas.
                const senderTeamMember = TEAM_MEMBERS.find(
                  (m) => m.email.toLowerCase() === (mail.from || '').toLowerCase()
                );
                return (
                  <div
                    key={mail.id}
                    onClick={() => handleSelectMail(mail)}
                    className={`px-4 py-3.5 flex items-start gap-3 cursor-pointer transition-colors border-l-4 ${
                      isSelected
                        ? 'bg-[#0f3336] border-l-[#F7BC5F]'
                        : !mail.isRead
                          ? 'bg-[#0b292b]/60 border-l-[#F7BC5F]/50 hover:bg-[#0f2a2d]'
                          : 'border-l-transparent hover:bg-white/5'
                    }`}
                  >
                    {senderTeamMember?.avatarUrl ? (
                      <img
                        src={senderTeamMember.avatarUrl}
                        alt={senderTeamMember.name}
                        className="w-9 h-9 rounded-full shrink-0 object-cover"
                      />
                    ) : (
                      <div className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-black ${getAvatarColor(senderLabel)}`}>
                        {getInitial(senderLabel)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs truncate ${!mail.isRead ? 'text-white font-extrabold' : 'text-slate-300 font-semibold'}`}>
                          {senderLabel}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {mail.date ? new Date(mail.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <p className={`text-xs truncate ${!mail.isRead ? 'text-white font-bold' : 'text-slate-300 font-medium'}`}>
                        {mail.subject || '(Sans objet)'}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {mail.snippet}
                      </p>
                    </div>

                    <button
                      onClick={e => toggleStar(mail, e)}
                      title={isStarred ? 'Désétoiler' : 'Étoiler'}
                      className="p-1 hover:text-[#F7BC5F] transition-colors shrink-0"
                    >
                      <Star className={`w-3.5 h-3.5 ${isStarred ? 'text-[#F7BC5F] fill-[#F7BC5F]' : 'text-slate-600'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MAIL DETAIL VIEW */}
        <div className={`${selectedMail ? 'flex lg:col-span-8' : 'hidden'} bg-transparent sm:bg-[#071f21] border-0 sm:border sm:border-[#1c4448] rounded-none sm:rounded-2xl p-0 sm:px-6 sm:pb-6 sm:pt-3.5 flex-col justify-between transition-all overflow-hidden min-h-0`}>
          {selectedMail ? (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex-1 min-h-0 flex flex-col space-y-1.5 sm:space-y-2 overflow-hidden">
                {/* Barre d'outils (Retour/Répondre/Tous/Transférer + lu/spam/
                    corbeille) entièrement déplacée sur la ligne des onglets
                    (Réception/Non lus...) au-dessus — plus aucune ligne dédiée
                    ici, toute la hauteur gagnée revient à la lecture du mail. */}

                {/* SUBJECT & METADATA — signalé : "limite au maximum le
                    haut pour gagner sur la lecture du mail" — l'ancien
                    encadré (fond, bordure, padding, deux lignes De/À)
                    remplacé par une seule ligne compacte sans cadre.
                    Corrige au passage un bug visible sur la capture :
                    l'étiquette "De :" en largeur fixe trop étroite (w-6)
                    faisait retourner le ":" tout seul à la ligne suivante. */}
                <div className="shrink-0">
                  <h2 className="text-sm sm:text-base font-bold text-white leading-tight truncate">
                    {selectedMail.subject || '(Sans objet)'}
                  </h2>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400 min-w-0">
                    <span className="text-white font-bold shrink-0">{selectedMail.fromName || selectedMail.from}</span>
                    <span className="truncate">&lt;{selectedMail.from}&gt;</span>
                    {selectedMail.to && (
                      <>
                        <span className="text-slate-600 shrink-0">·</span>
                        <span className="truncate">à {selectedMail.to}</span>
                      </>
                    )}
                    <span className="ml-auto shrink-0 pl-2">{selectedMail.date}</span>
                  </div>
                </div>

                {/* CONTENT PREVIEW — occupe tout l'espace restant de la fenêtre de
                    lecture. Toujours le rendu HTML quand il existe (plus de
                    bascule "Afficher texte brut", qui ne servait à rien et
                    prenait de la place) — texte brut seulement en repli, si
                    l'e-mail n'a pas de version HTML. */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 min-h-[320px] p-1 sm:p-4 rounded-none sm:rounded-xl bg-transparent sm:bg-[#031112] border-0 sm:border sm:border-[#1c4448] overflow-y-auto custom-scrollbar">
                    {selectedMail.bodyHtml ? (
                      <EmailHtmlFrame html={selectedMail.bodyHtml} />
                    ) : (
                      <pre className="text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed break-words">
                        {selectedMail.bodyText}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs py-12">
              <Mail className="w-10 h-10 mb-3 text-slate-600" />
              <p className="font-semibold text-slate-400">Sélectionnez un courriel pour le lire</p>
              <p className="text-[11px] text-slate-500 mt-1">Vous pourrez y répondre, le transférer ou le classer.</p>
            </div>
          )}
        </div>
      </div>
        </div>
      {/* fin colonne (dossiers + contenu) */}
      </div>

      {/* COMPOSER MODAL */}
      </>
      )}

      {/* Bug nº 2 (consigne du 1er septembre) : sur téléphone, le bas du
          composeur — dont le bouton « Envoyer » — passait sous la barre de
          navigation du bas. L'écran parent porte un `z-10` qui enferme le
          `z-[100]` de la fenêtre dans son contexte d'empilement : on la sort
          donc dans <body>, comme les autres fenêtres du CRM. */}
      {showComposer && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {/* Ticket #16 (nouvelle base) : fenêtre sans hauteur limitée ni
              défilement propre — avec Cc, objet, message et signature, le
              contenu dépassait souvent la hauteur de l'écran et devenait
              impossible à faire défiler correctement (même bug déjà corrigé
              sur la modale Agenda). */}
          <div className="w-full max-w-3xl max-h-[90vh] bg-[#071f21] border border-[#1c4448] rounded-3xl shadow-2xl overflow-y-auto custom-scrollbar flex flex-col">
            <div className="p-5 border-b border-[#1c4448] flex items-center justify-between bg-[#061719]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#F7BC5F]/20 text-[#F7BC5F] flex items-center justify-center font-bold">
                  {composerMode === 'reply' || composerMode === 'reply-all' ? <Reply className="w-4 h-4"/> : composerMode === 'forward' ? <Forward className="w-4 h-4"/> : <Edit className="w-4 h-4"/>}
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    {composerMode === 'reply' ? 'Répondre' : composerMode === 'reply-all' ? 'Répondre à tous' : composerMode === 'forward' ? 'Transférer' : 'Nouveau message'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Envoi instantané via Google Workspace API ({currentUser?.email})
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  resetComposer();
                  setShowComposer(false);
                }}
                disabled={sending}
                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Signalé (4 septembre) : « j'appuie sur envoyer, ça ne
                fonctionne pas » — l'envoi échouait bien (jeton Google
                Workspace expiré, le cas le plus fréquent vu la mécanique de
                renouvellement plus haut dans workspace.ts), `error` était
                bien renseigné, mais son affichage (plus bas dans cet écran,
                z-index normal) restait entièrement caché DERRIÈRE ce panneau
                (portail plein écran, fond opaque, z-[100]) — le formulaire
                restait ouvert sans le moindre signe visible de ce qui
                clochait, exactement comme si le bouton ne faisait rien.
                Répété ici, à l'intérieur du panneau, pour rester visible
                pendant que l'utilisateur compose. */}
            {error && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="min-w-0">{error}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/google|workspace|authenti|scope|401|403/i.test(error) && (
                    <button
                      type="button"
                      onClick={() => { void reconnectGoogleWorkspace().catch((e: any) => setError(e?.message || String(e))); }}
                      className="px-3 py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-xs flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reconnecter Google
                    </button>
                  )}
                  <button type="button" onClick={() => setError(null)} className="text-rose-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSend} className="p-6 space-y-4">
              {/* Ticket #16 (nouvelle base, correctif) : labels à largeur fixe
                  (w-24) à côté du champ — sur un écran de téléphone, ça ne
                  laissait quasiment plus de place pour taper. Empilé sur
                  mobile, ligne unique à partir de sm:. */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                  <label className="sm:w-24 shrink-0 text-xs font-semibold text-slate-400">Destinataire (À) :</label>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <EmailAutocompleteInput
                      value={composeTo}
                      onChange={setComposeTo}
                      placeholder="client@exemple.fr"
                      required
                      contacts={contacts}
                      multiple
                    />
                    {!showCc && (
                      <button
                        type="button"
                        onClick={() => setShowCc(true)}
                        className="text-xs text-[#F7BC5F] hover:underline px-2 shrink-0"
                      >
                        + Cc
                      </button>
                    )}
                  </div>
                </div>

                {showCc && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                    <label className="sm:w-24 shrink-0 text-xs font-semibold text-slate-400">Copie (Cc) :</label>
                    <EmailAutocompleteInput
                      value={composeCc}
                      onChange={setComposeCc}
                      placeholder="autre@exemple.fr"
                      contacts={contacts}
                    />
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                  <label className="sm:w-24 shrink-0 text-xs font-semibold text-slate-400">Objet :</label>
                  <input
                    type="text"
                    required
                    value={composeSubject}
                    onChange={e => setComposeSubject(e.target.value)}
                    placeholder="Objet du message"
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#0b292b] border border-[#1c4448] text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Message :
                </label>
                <textarea
                  rows={10}
                  required
                  value={composeBody}
                  onChange={e => setComposeBody(e.target.value)}
                  placeholder="Rédigez votre message ici..."
                  className="w-full p-4 rounded-xl bg-[#031112] border border-[#1c4448] text-xs text-white focus:outline-none focus:border-[#F7BC5F] resize-none leading-relaxed font-sans"
                />
              </div>

              {usingHtmlSignature && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Signature (Paramètres &gt; Mail) — ajoutée automatiquement à l'envoi :
                  </label>
                  <div className="rounded-xl bg-white border border-[#1c4448] p-3">
                    <EmailHtmlFrame html={customSignatureHtml} />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    resetComposer();
                    setShowComposer(false);
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  disabled={sending}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold bg-[#F7BC5F] text-[#061719] hover:bg-[#d9ab38] disabled:opacity-50 flex items-center gap-2 shadow-lg cursor-pointer"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Envoi en cours...' : 'Envoyer le message'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default MailView;
