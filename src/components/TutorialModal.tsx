import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Sparkles, LayoutDashboard, Users, GitFork, Calendar, MessageSquare,
  Mail, FileText, FileEdit, Camera, LifeBuoy, Settings, Bot, HelpCircle,
  CheckCircle2, XCircle, RotateCcw, GraduationCap, BookOpen, Compass,
  ArrowRight, Check, Search, Lightbulb, Play, Trophy, Target, ChevronRight,
} from 'lucide-react';

export type TutorialActionTarget =
  | 'accueil'
  | 'clients'
  | 'nouveau-lead'
  | 'pipeline'
  | 'agenda'
  | 'chat'
  | 'mail'
  | 'documents'
  | 'notes'
  | 'assistant-ia'
  | 'camera'
  | 'support'
  | 'parametres';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTour?: () => void;
  onNavigateAction?: (target: TutorialActionTarget) => void;
}

type ModuleCategory = 'all' | 'commercial' | 'communication' | 'organisation' | 'ia';

interface GuideModule {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badgeBg: string;
  category: Exclude<ModuleCategory, 'all'>;
  categoryLabel: string;
  title: string;
  subtitle: string;
  text: string;
  highlights: string[];
  proTip: string;
  tryExample?: string;
  actionTarget: TutorialActionTarget;
  actionLabel: string;
}

const GUIDE_MODULES: GuideModule[] = [
  {
    id: 'accueil',
    icon: LayoutDashboard,
    color: 'text-[#F7BC5F]',
    badgeBg: 'bg-[#F7BC5F]/15 border-[#F7BC5F]/30',
    category: 'organisation',
    categoryLabel: 'Organisation',
    title: 'Accueil & Tableau de bord',
    subtitle: 'Votre cockpit quotidien en un coup d’œil',
    text: "L'écran d'accueil centralise vos modules, vos statistiques clés et le suivi de votre activité. Les blocs « Ma journée » et « Priorités » affichent instantanément vos rendez-vous du jour et vos rappels urgents.",
    highlights: [
      'Accès direct en 1 clic à tous les espaces de travail du CRM',
      'Vue synthétique des priorités, rappels en retard et messages non lus',
      'Bandeau récapitulatif de votre activité commerciale en temps réel',
    ],
    proTip: 'Consultez le bloc « Priorités » chaque matin : un clic sur une tâche vous emmène directement sur la fiche du client concerné.',
    actionTarget: 'accueil',
    actionLabel: "Aller à l'Accueil",
  },
  {
    id: 'clients',
    icon: Users,
    color: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/15 border-emerald-500/30',
    category: 'commercial',
    categoryLabel: 'Commercial',
    title: 'Clients & Leads',
    subtitle: 'Fiches contacts 360° & suivi complet',
    text: "Consultez, filtrez et enrichissez tous vos contacts. Le bouton « + Nouveau lead » crée une fiche complète (coordonnées, budget, projet). Chaque fiche centralise rendez-vous, notes, documents, e-mails échangés, checklist de dossier et Espace Client.",
    highlights: [
      'Création rapide avec détection et liaison Vendeur ↔ Acquéreur',
      'Historique complet : RDV, notes, e-mails, documents et checklists',
      'Partage de fiche avec un collègue ou archivage sans perte de données',
    ],
    proTip: 'Depuis une fiche client, cliquez sur l’icône Nova IA pour lui dicter une note ou programmer un rappel déjà rattaché à ce client.',
    tryExample: 'Créez un contact test ou ouvrez la liste de vos leads.',
    actionTarget: 'clients',
    actionLabel: 'Ouvrir Clients & Leads',
  },
  {
    id: 'pipeline',
    icon: GitFork,
    color: 'text-sky-400',
    badgeBg: 'bg-sky-500/15 border-sky-500/30',
    category: 'commercial',
    categoryLabel: 'Commercial',
    title: 'Pipeline & Checklists',
    subtitle: 'Suivi Kanban des transactions jusqu’à l’acte',
    text: "Visualisez vos dossiers sous forme de tableau Kanban, du premier contact jusqu'à la signature. Glissez-déposez une carte pour la faire avancer. Chaque étape dispose de sa checklist documentaire interactive.",
    highlights: [
      'Glisser-déposer fluide entre les étapes commerciales',
      'Checklist intelligente : tout document oublié est automatiquement reporté aux étapes suivantes',
      'Archivage automatique des dossiers signés ou perdus hors du pipeline actif',
    ],
    proTip: 'Sur Immosphera, si un document manque lors d’un changement d’étape, il reste visible en rappel prioritaire sur les étapes suivantes jusqu’à sa validation.',
    actionTarget: 'pipeline',
    actionLabel: 'Ouvrir le Pipeline',
  },
  {
    id: 'assistant-ia',
    icon: Bot,
    color: 'text-[#F9C977]',
    badgeBg: 'bg-[#F7BC5F]/15 border-[#F7BC5F]/35',
    category: 'ia',
    categoryLabel: 'IA & Outils',
    title: 'Assistant Nova IA (Voix & Texte)',
    subtitle: 'Votre copilote intelligent à la voix ou au clavier',
    text: "Demandez à Nova de créer un contact, une tâche, une note ou un rendez-vous en langage naturel — même plusieurs actions en une seule phrase ! Utilisez le micro pour dicter vos comptes-rendus après un rendez-vous.",
    highlights: [
      'Dictée vocale instantanée : parlez au micro, Nova exécute vos demandes CRM',
      'Actions multiples combinées (ex. créer un contact + ajouter une note + fixer un rappel)',
      'Recherche web intégrée pour répondre à vos questions juridiques, fiscales ou générales',
    ],
    proTip: 'Dites par exemple au micro : « Crée un lead Sophie Martin au 06 12 34 56 78 et ajoute une tâche pour la rappeler demain à 14h ».',
    tryExample: '« Ajoute une note sur mon dernier rendez-vous et programme un rappel demain à 10h »',
    actionTarget: 'assistant-ia',
    actionLabel: 'Essayer Nova IA',
  },
  {
    id: 'agenda',
    icon: Calendar,
    color: 'text-purple-400',
    badgeBg: 'bg-purple-500/15 border-purple-500/30',
    category: 'organisation',
    categoryLabel: 'Organisation',
    title: 'Agenda synchronisé',
    subtitle: 'Synchronisation bidirectionnelle avec Google Agenda',
    text: "Un rendez-vous créé dans Nova CRM apparaît automatiquement dans votre Google Agenda, et inversement. Gérez les horaires, les événements sur toute la journée, les participants et votre disponibilité.",
    highlights: [
      'Synchronisation temps réel dans les deux sens avec Google Agenda',
      'Rattachement direct d’un rendez-vous à une fiche client',
      'Personnalisation de la couleur de votre calendrier dans Paramètres',
    ],
    proTip: 'Associez toujours un contact à votre événement Agenda : il apparaîtra automatiquement dans l’historique RDV de sa fiche client.',
    actionTarget: 'agenda',
    actionLabel: "Ouvrir l'Agenda",
  },
  {
    id: 'chat',
    icon: MessageSquare,
    color: 'text-blue-400',
    badgeBg: 'bg-blue-500/15 border-blue-500/30',
    category: 'communication',
    categoryLabel: 'Communication',
    title: 'Chat & Messagerie interne',
    subtitle: 'Échanges rapides en direct ou par canal projet',
    text: "Discutez en messages directs avec vos collègues ou dans des canaux thématiques. Partagez des fichiers, réagissez avec des emojis, répondez à un message précis et vérifiez la lecture grâce à la double coche ✓✓.",
    highlights: [
      'Canaux d’équipe et conversations privées 1-à-1 en temps réel',
      'Accusés de lecture (✓✓), réactions emoji et partage de pièces jointes',
      'Notifications instantanées avec accès direct au message concerné',
    ],
    proTip: 'Survolez ou maintenez un message pour y répondre directement en citant son auteur ou y ajouter une réaction rapide.',
    actionTarget: 'chat',
    actionLabel: 'Ouvrir le Chat',
  },
  {
    id: 'mail',
    icon: Mail,
    color: 'text-cyan-400',
    badgeBg: 'bg-cyan-500/15 border-cyan-500/30',
    category: 'communication',
    categoryLabel: 'Communication',
    title: 'Boîte Mail intégrée',
    subtitle: 'Vos e-mails Gmail synchronisés avec vos contacts',
    text: "Retrouvez votre boîte Gmail (Réception, Non lus, Envoyés, Brouillons, Corbeille) sans quitter Nova CRM. Les e-mails échangés avec vos clients sont automatiquement reliés à leur fiche contact.",
    highlights: [
      'Rédaction, réponse et transfert avec pièces jointes intégrées',
      'Signature HTML personnalisable dans Paramètres > Mail',
      'Retrouvez tous les échanges d’un client dans l’onglet « Emails » de sa fiche',
    ],
    proTip: 'Cliquez sur l’adresse e-mail d’un client depuis sa fiche pour ouvrir directement le compositeur pré-rempli.',
    actionTarget: 'mail',
    actionLabel: 'Ouvrir la Boîte Mail',
  },
  {
    id: 'documents',
    icon: FileText,
    color: 'text-orange-400',
    badgeBg: 'bg-orange-500/15 border-orange-500/30',
    category: 'organisation',
    categoryLabel: 'Organisation',
    title: 'Documents & Coffre-fort',
    subtitle: 'Centralisation et aperçu instantané des pièces',
    text: "Stockez et classez tous vos fichiers par client ou par dossier général. Prévisualisez vos PDF et images en un clic grâce à l'icône œil sans avoir à les télécharger sur votre appareil.",
    highlights: [
      'Aperçu instantané (icône œil) des PDF, contrats et photos',
      'Classement structuré par dossier client ou répertoire d’agence',
      'Partage sécurisé avec l’Espace Client',
    ],
    proTip: 'Utilisez l’icône œil pour vérifier un justificatif en 1 seconde pendant un appel client sans encombrer vos téléchargements.',
    actionTarget: 'documents',
    actionLabel: 'Ouvrir Documents',
  },
  {
    id: 'notes',
    icon: FileEdit,
    color: 'text-teal-400',
    badgeBg: 'bg-teal-500/15 border-teal-500/30',
    category: 'organisation',
    categoryLabel: 'Organisation',
    title: 'Notes & Comptes-rendus',
    subtitle: 'Bloc-notes structuré en 3 colonnes',
    text: "Organisez vos idées et comptes-rendus par dossiers. Sur ordinateur, l'interface en trois colonnes (Dossiers / Liste / Éditeur) permet de passer d'une note à l'autre instantanément.",
    highlights: [
      'Classement par dossiers personnalisés et recherche rapide',
      'Synchronisation automatique entre ordinateur et mobile',
      'Création possible à la voix via l’assistant Nova IA',
    ],
    proTip: 'Dictez vos notes à chaud dans la voiture après une visite via Nova IA : elles seront rangées proprement sans effort.',
    actionTarget: 'notes',
    actionLabel: 'Ouvrir les Notes',
  },
  {
    id: 'camera',
    icon: Camera,
    color: 'text-fuchsia-400',
    badgeBg: 'bg-fuchsia-500/15 border-fuchsia-500/30',
    category: 'ia',
    categoryLabel: 'IA & Outils',
    title: 'Réservation Caméra 360°',
    subtitle: 'Planning du matériel photo/vidéo de l’agence',
    text: "Réservez le matériel photo/vidéo ou la caméra 360° pour vos reportages et visites virtuelles. Chaque demande est notifiée et validée par un administrateur.",
    highlights: [
      'Calendrier de disponibilité du matériel en temps réel',
      'Validation administrateur avec notification automatique',
      'Suivi de vos créneaux réservés',
    ],
    proTip: 'Anticipez votre réservation dès la prise du mandat pour garantir la disponibilité du matériel le jour du shooting.',
    actionTarget: 'camera',
    actionLabel: 'Réserver une caméra',
  },
  {
    id: 'support',
    icon: LifeBuoy,
    color: 'text-rose-400',
    badgeBg: 'bg-rose-500/15 border-rose-500/30',
    category: 'ia',
    categoryLabel: 'IA & Outils',
    title: 'Support & Suggestions',
    subtitle: 'Assistance directe et suivi des tickets',
    text: "Besoin d'aide, un bug constaté ou une idée d'amélioration ? Ouvrez un ticket en quelques secondes : Sylvain et Mélanie sont immédiatement notifiés et échangent avec vous sur le fil du ticket.",
    highlights: [
      'Fil de discussion dédié sur chaque ticket ouvert',
      'Notification instantanée des administrateurs (Sylvain & Mélanie)',
      'Suivi du statut (Ouvert, En cours, Résolu)',
    ],
    proTip: 'Joignez une capture d’écran ou décrivez l’écran concerné dans votre ticket pour une résolution encore plus rapide.',
    actionTarget: 'support',
    actionLabel: 'Ouvrir le Support',
  },
  {
    id: 'parametres',
    icon: Settings,
    color: 'text-slate-300',
    badgeBg: 'bg-slate-500/15 border-slate-500/30',
    category: 'organisation',
    categoryLabel: 'Organisation',
    title: 'Paramètres & Personnalisation',
    subtitle: 'Thème, signature mail, notifications et équipe',
    text: "Personnalisez votre profil, votre thème (mode sombre ou jour, fond d'écran, couleur d'accentuation), l'ordre du menu latéral, votre signature e-mail et vos alertes push.",
    highlights: [
      'Mode Sombre / Mode Jour et personnalisation du fond d’écran',
      'Configuration de la signature e-mail et de la connexion Google',
      'Espace Administrateur : gestion des utilisateurs et diffusion d’annonces',
    ],
    proTip: 'Activez les notifications sur votre téléphone et votre ordinateur dans Paramètres > Notifications pour ne manquer aucun message ni rappel.',
    actionTarget: 'parametres',
    actionLabel: 'Ouvrir les Paramètres',
  },
];

interface OnboardingMission {
  id: string;
  title: string;
  description: string;
  duration: string;
  actionLabel: string;
  type: 'tour' | 'nav' | 'quiz';
  target?: TutorialActionTarget;
}

const ONBOARDING_MISSIONS: OnboardingMission[] = [
  {
    id: 'mission_tour',
    title: 'Suivre la visite guidée interactive',
    description: 'Découvrez en 3 minutes les boutons clés directement sur votre écran avec le projecteur interactif.',
    duration: '3 min',
    actionLabel: 'Lancer la visite',
    type: 'tour',
  },
  {
    id: 'mission_lead',
    title: 'Créer ou simuler un premier contact',
    description: 'Ouvrez le formulaire « + Nouveau lead » pour découvrir la fiche contact et ses champs.',
    duration: '1 min',
    actionLabel: '+ Nouveau lead',
    type: 'nav',
    target: 'nouveau-lead',
  },
  {
    id: 'mission_nova',
    title: 'Dicter ou écrire une demande à Nova IA',
    description: 'Demandez à Nova de créer une tâche, une note ou de répondre à une question au micro ou au clavier.',
    duration: '1 min',
    actionLabel: 'Ouvrir Nova IA',
    type: 'nav',
    target: 'assistant-ia',
  },
  {
    id: 'mission_pipeline',
    title: 'Explorer le Pipeline & les Checklists',
    description: 'Visualisez vos colonnes Kanban et cliquez sur la checklist documentaire d’un dossier.',
    duration: '2 min',
    actionLabel: 'Voir le Pipeline',
    type: 'nav',
    target: 'pipeline',
  },
  {
    id: 'mission_agenda',
    title: 'Vérifier votre Agenda synchronisé',
    description: 'Consultez votre planning et la synchronisation bidirectionnelle avec Google Agenda.',
    duration: '1 min',
    actionLabel: "Ouvrir l'Agenda",
    type: 'nav',
    target: 'agenda',
  },
  {
    id: 'mission_chat',
    title: 'Saluer l’équipe dans la Messagerie',
    description: 'Découvrez les canaux d’équipe et les messages directs avec accusé de lecture ✓✓.',
    duration: '1 min',
    actionLabel: 'Ouvrir le Chat',
    type: 'nav',
    target: 'chat',
  },
  {
    id: 'mission_quiz',
    title: 'Obtenir au moins 7/10 au Quiz Nova CRM',
    description: 'Testez vos connaissances avec le quiz interactif et ses explications instantanées.',
    duration: '2 min',
    actionLabel: 'Lancer le Quiz',
    type: 'quiz',
  },
];

interface QuizQuestion {
  q: string;
  options: string[];
  correct: number;
  explanation: string;
}

const QUIZ_BANK: QuizQuestion[] = [
  {
    q: 'Où crée-t-on rapidement un nouveau contact ou prospect ?',
    options: ['Via le bouton « + Nouveau lead » (ou en le dictant à Nova IA)', 'Uniquement dans Paramètres', 'Dans le module Support'],
    correct: 0,
    explanation: 'Vous pouvez créer un contact en 1 clic via le bouton « + Nouveau lead » en haut de l’écran, ou simplement en le demandant à la voix à Nova IA !',
  },
  {
    q: 'Sous quelle forme s’organise le suivi des dossiers dans le Pipeline ?',
    options: ['Une liste figée non modifiable', 'Un tableau Kanban interactif par étapes', 'Uniquement un calendrier'],
    correct: 1,
    explanation: 'Le Pipeline utilise une vue Kanban : glissez-déposez vos cartes d’une colonne à l’autre pour faire progresser vos dossiers.',
  },
  {
    q: 'Que se passe-t-il dans la checklist Immosphera si un document est oublié à une étape ?',
    options: [
      'Il est définitivement perdu',
      'Il est automatiquement reporté et signalé sur les étapes suivantes jusqu’à sa complétion',
      'Le dossier est supprimé',
    ],
    correct: 1,
    explanation: 'Aucun oubli possible : les documents non cochés des étapes précédentes sont automatiquement reportés dans un bloc dédié sur l’étape en cours.',
  },
  {
    q: 'Un rendez-vous créé dans Nova CRM se synchronise avec...',
    options: ['Rien, il reste uniquement local', 'Google Agenda dans les deux sens (bidirectionnel)', 'Uniquement par SMS'],
    correct: 1,
    explanation: 'La synchronisation est bidirectionnelle : tout événement ajouté dans Nova CRM apparaît dans Google Agenda et inversement.',
  },
  {
    q: 'Comment savoir si votre message envoyé dans le Chat interne a été lu ?',
    options: ['Une icône cadenas', 'Une double coche ✓✓ sur le message', 'Aucun indicateur n’existe'],
    correct: 1,
    explanation: 'La double coche ✓✓ vous confirme en temps réel que votre destinataire a lu votre message.',
  },
  {
    q: 'Où personnalise-t-on sa signature automatique pour les e-mails ?',
    options: ['Dans Paramètres > Mail', 'Dans le module Documents', 'Ce n’est pas personnalisable'],
    correct: 0,
    explanation: 'Rendez-vous dans Paramètres > Mail pour définir votre signature, qui sera ajoutée automatiquement à vos nouveaux messages.',
  },
  {
    q: 'Que permet l’icône en forme d’œil dans le module Documents ?',
    options: ['Supprimer définitivement le fichier', 'Ouvrir un aperçu immédiat sans télécharger le fichier', 'Renommer le client'],
    correct: 1,
    explanation: 'L’icône œil ouvre une visionneuse intégrée (PDF, images) pour consulter vos pièces en une seconde sans encombrer votre appareil.',
  },
  {
    q: 'Sur ordinateur, comment sont organisées vos Notes ?',
    options: ['Une seule colonne sans tri', 'En 3 colonnes : Dossiers / Liste des notes / Contenu', 'Uniquement dans l’Agenda'],
    correct: 1,
    explanation: 'La vue en 3 colonnes permet de classer vos notes par dossiers et de naviguer instantanément d’un compte-rendu à un autre.',
  },
  {
    q: 'L’assistant Nova IA peut-il exécuter plusieurs actions en une seule phrase (voix ou texte) ?',
    options: [
      'Non, une seule action à la fois',
      'Oui (ex: créer un contact + ajouter une note + programmer un rappel en une seule demande)',
      'Non, le micro sert uniquement à dicter des e-mails',
    ],
    correct: 1,
    explanation: 'Nova IA comprend les demandes composées à la voix comme à l’écrit et exécute toutes les actions CRM correspondantes.',
  },
  {
    q: 'Une réservation de caméra dans le CRM est...',
    options: ['Confirmée après validation par un administrateur', 'Anonyme et sans suivi', 'Payante à chaque clic'],
    correct: 0,
    explanation: 'Votre demande bloque le créneau souhaité et notifie un administrateur qui confirme la réservation du matériel.',
  },
  {
    q: 'Qui est notifié lorsque vous ouvrez un ticket dans le module Support ?',
    options: ['Personne', 'Sylvain et Mélanie, qui peuvent vous répondre directement dans le ticket', 'Tous les clients de l’agence'],
    correct: 1,
    explanation: 'Sylvain et Mélanie reçoivent immédiatement une notification et suivent votre demande jusqu’à sa résolution.',
  },
  {
    q: 'Que devient un dossier archivé (signé ou perdu) dans le Pipeline ?',
    options: ['Il reste affiché au milieu des dossiers en cours', 'Il sort automatiquement du pipeline actif tout en restant consultable en archive', 'Il est effacé de la base'],
    correct: 1,
    explanation: 'Archiver un dossier allège votre Pipeline actif sans jamais perdre l’historique du client.',
  },
  {
    q: 'Peut-on partager la fiche d’un contact avec un collègue de l’agence ?',
    options: ['Non, chaque fiche est strictement isolée', 'Oui, directement depuis la fiche client', 'Uniquement en recréant le contact en double'],
    correct: 1,
    explanation: 'Depuis la fiche d’un client, vous pouvez la partager avec un ou plusieurs collaborateurs pour travailler en binôme.',
  },
  {
    q: 'Où retrouve-t-on automatiquement les e-mails échangés avec un client ?',
    options: ['Uniquement hors du CRM', 'Dans l’onglet « Emails » de sa fiche client ainsi que dans le module Mail', 'Dans les Notes'],
    correct: 1,
    explanation: 'Nova CRM relie automatiquement les e-mails de l’adresse du contact directement dans l’onglet « Emails » de sa fiche.',
  },
];

const QUIZ_SIZE = 10;
const STORAGE_EXPLORED_KEY = 'nova_tutorial_explored_v2';
const STORAGE_MISSIONS_KEY = 'nova_tutorial_missions_v2';
const STORAGE_BEST_SCORE_KEY = 'nova_tutorial_best_score_v2';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({
  isOpen,
  onClose,
  onStartTour,
  onNavigateAction,
}) => {
  const [tab, setTab] = useState<'guide' | 'missions' | 'quiz'>('guide');
  const [selectedModuleId, setSelectedModuleId] = useState<string>(GUIDE_MODULES[0].id);
  const [categoryFilter, setCategoryFilter] = useState<ModuleCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Progression persistée (modules explorés, missions accomplies, meilleur score quiz)
  const [exploredIds, setExploredIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EXPLORED_KEY);
      return raw ? JSON.parse(raw) : [GUIDE_MODULES[0].id];
    } catch {
      return [GUIDE_MODULES[0].id];
    }
  });

  const [completedMissions, setCompletedMissions] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MISSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [bestScore, setBestScore] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_BEST_SCORE_KEY);
      return raw !== null ? Number(raw) : null;
    } catch {
      return null;
    }
  });

  // État du Quiz interactif pas-à-pas
  const [quiz, setQuiz] = useState<QuizQuestion[]>(() => shuffle(QUIZ_BANK).slice(0, QUIZ_SIZE));
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(QUIZ_SIZE).fill(null));
  const [quizFinished, setQuizFinished] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_EXPLORED_KEY, JSON.stringify(exploredIds));
    } catch { /* ignore */ }
  }, [exploredIds]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MISSIONS_KEY, JSON.stringify(completedMissions));
    } catch { /* ignore */ }
  }, [completedMissions]);

  const markModuleExplored = (id: string) => {
    setExploredIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const toggleMission = (id: string) => {
    setCompletedMissions((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const markMissionDone = (id: string) => {
    setCompletedMissions((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const filteredModules = useMemo(() => {
    return GUIDE_MODULES.filter((m) => {
      const matchCat = categoryFilter === 'all' || m.category === categoryFilter;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return matchCat;
      return (
        matchCat &&
        (m.title.toLowerCase().includes(q) ||
          m.subtitle.toLowerCase().includes(q) ||
          m.text.toLowerCase().includes(q) ||
          m.proTip.toLowerCase().includes(q))
      );
    });
  }, [categoryFilter, searchQuery]);

  const activeModule = useMemo(
    () =>
      filteredModules.find((m) => m.id === selectedModuleId) ||
      filteredModules[0] ||
      GUIDE_MODULES[0],
    [filteredModules, selectedModuleId]
  );

  const score: number = useMemo(
    () => answers.reduce<number>((acc, a, i) => acc + (a === quiz[i]?.correct ? 1 : 0), 0),
    [answers, quiz]
  );

  const handleSelectOption = (optionIndex: number) => {
    if (answers[currentQuestionIdx] !== null) return; // Déjà répondu à cette question
    setAnswers((prev) => prev.map((a, i) => (i === currentQuestionIdx ? optionIndex : a)));
  };

  const handleNextQuestion = () => {
    if (currentQuestionIdx + 1 < QUIZ_SIZE) {
      setCurrentQuestionIdx((i) => i + 1);
    } else {
      setQuizFinished(true);
      if (bestScore === null || score > bestScore) {
        setBestScore(score);
        try {
          localStorage.setItem(STORAGE_BEST_SCORE_KEY, String(score));
        } catch { /* ignore */ }
      }
      if (score >= 7) {
        markMissionDone('mission_quiz');
      }
    }
  };

  const restartQuiz = () => {
    setQuiz(shuffle(QUIZ_BANK).slice(0, QUIZ_SIZE));
    setAnswers(Array(QUIZ_SIZE).fill(null));
    setCurrentQuestionIdx(0);
    setQuizFinished(false);
  };

  const handleTriggerAction = (target: TutorialActionTarget, moduleId?: string, missionId?: string) => {
    if (moduleId) markModuleExplored(moduleId);
    if (missionId) markMissionDone(missionId);
    onClose();
    onNavigateAction?.(target);
  };

  if (!isOpen) return null;

  const exploredCount = exploredIds.length;
  const missionsCount = completedMissions.length;
  const currentQ = quiz[currentQuestionIdx];
  const currentAnswer = answers[currentQuestionIdx];

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[250] flex items-center justify-center p-2.5 sm:p-5 overflow-hidden"
      onClick={onClose}
    >
      <div
        className="relative bg-gradient-to-b from-[#081f23] to-[#051417] border border-[#F7BC5F]/25 rounded-2xl sm:rounded-3xl max-w-4xl w-full max-h-[calc(100dvh-1.5rem)] sm:max-h-[88vh] flex flex-col shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ligne d'accentuation dorée supérieure */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-[#F7BC5F] to-transparent opacity-80 shrink-0" />

        {/* En-tête fixe */}
        <div className="px-4 sm:px-6 pt-4 pb-3.5 border-b border-white/[0.08] bg-[#081f23]/90 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#F7BC5F] to-[#d99b38] text-slate-950 flex items-center justify-center font-bold shrink-0 shadow-[0_0_25px_rgba(247,188,95,0.3)]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                    Académie & Guide interactif Nova CRM
                  </h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#F7BC5F]/15 text-[#F7BC5F] border border-[#F7BC5F]/30">
                    Interactif
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Explorez chaque module en direct, validez vos missions de prise en main et testez vos connaissances
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="Fermer le tutoriel"
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Barre de navigation des onglets + bouton Visite Guidée */}
          <div className="flex items-center justify-between gap-2.5 mt-3.5 flex-wrap">
            <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl border border-white/[0.08] overflow-x-auto max-w-full">
              <button
                onClick={() => setTab('guide')}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  tab === 'guide'
                    ? 'bg-[#F7BC5F] text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Explorer les modules</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                    tab === 'guide' ? 'bg-black/20 text-slate-950' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {exploredCount}/{GUIDE_MODULES.length}
                </span>
              </button>

              <button
                onClick={() => setTab('missions')}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  tab === 'missions'
                    ? 'bg-[#F7BC5F] text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>Missions</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                    tab === 'missions'
                      ? 'bg-black/20 text-slate-950'
                      : missionsCount === ONBOARDING_MISSIONS.length
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {missionsCount}/{ONBOARDING_MISSIONS.length}
                </span>
              </button>

              <button
                onClick={() => setTab('quiz')}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  tab === 'quiz'
                    ? 'bg-[#F7BC5F] text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5" />
                <span>Quiz interactif</span>
                {bestScore !== null && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                      tab === 'quiz' ? 'bg-black/20 text-slate-950' : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    ★ {bestScore}/{QUIZ_SIZE}
                  </span>
                )}
              </button>
            </div>

            {onStartTour && (
              <button
                onClick={() => {
                  markMissionDone('mission_tour');
                  onClose();
                  onStartTour();
                }}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#F7BC5F] to-[#f4b146] hover:brightness-110 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-[0_4px_15px_rgba(247,188,95,0.25)] transition-all shrink-0"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Visite guidée sur l'écran (3 min)</span>
              </button>
            )}
          </div>
        </div>

        {/* Corps défilant selon l'onglet actif */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6">
          {tab === 'guide' && (
            <div className="space-y-4">
              {/* Barre de recherche + Filtres par catégorie */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {(
                    [
                      { id: 'all', label: 'Tous (12)' },
                      { id: 'commercial', label: 'Commercial' },
                      { id: 'communication', label: 'Communication' },
                      { id: 'organisation', label: 'Organisation' },
                      { id: 'ia', label: 'IA & Outils' },
                    ] as { id: ModuleCategory; label: string }[]
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap border ${
                        categoryFilter === cat.id
                          ? 'bg-[#F7BC5F]/20 text-[#F7BC5F] border-[#F7BC5F]/40'
                          : 'bg-white/[0.03] text-slate-400 border-white/[0.07] hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[210px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher une fonction..."
                    className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-black/30 border border-white/[0.08] focus:border-[#F7BC5F]/50 text-xs text-white placeholder-slate-500 outline-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Vue maître-détail interactive (Grille de sélection à gauche + Fiche interactive à droite sur desktop) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                {/* Liste des modules (5 colonnes sur 12) */}
                <div className="md:col-span-5 space-y-1.5 max-h-[380px] md:max-h-[430px] overflow-y-auto pr-1 custom-scrollbar">
                  {filteredModules.map((mod) => {
                    const isSelected = activeModule.id === mod.id;
                    const isExplored = exploredIds.includes(mod.id);
                    const Icon = mod.icon;
                    return (
                      <button
                        key={mod.id}
                        onClick={() => {
                          setSelectedModuleId(mod.id);
                          markModuleExplored(mod.id);
                        }}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/50 shadow-[0_0_20px_rgba(247,188,95,0.1)]'
                            : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${mod.badgeBg}`}
                          >
                            <Icon className={`w-4 h-4 ${mod.color}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-xs text-white truncate">{mod.title}</h4>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{mod.subtitle}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isExplored && (
                            <span
                              title="Module consulté"
                              className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400"
                            >
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                          <ChevronRight
                            className={`w-4 h-4 transition-transform ${
                              isSelected ? 'text-[#F7BC5F] translate-x-0.5' : 'text-slate-500'
                            }`}
                          />
                        </div>
                      </button>
                    );
                  })}

                  {filteredModules.length === 0 && (
                    <div className="p-6 text-center rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs text-slate-400">
                      Aucun module ne correspond à « {searchQuery} ».
                    </div>
                  )}
                </div>

                {/* Panneau interactif détaillé du module sélectionné (7 colonnes sur 12) */}
                {activeModule && (
                  <div className="md:col-span-7 rounded-2xl bg-white/[0.03] border border-white/[0.09] p-4 sm:p-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-4">
                      {/* En-tête de la carte détaillée */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${activeModule.badgeBg}`}
                          >
                            <activeModule.icon className={`w-6 h-6 ${activeModule.color}`} />
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                              {activeModule.categoryLabel}
                            </span>
                            <h3 className="text-base font-extrabold text-white mt-1">
                              {activeModule.title}
                            </h3>
                            <p className="text-xs text-slate-400">{activeModule.subtitle}</p>
                          </div>
                        </div>
                      </div>

                      {/* Explication principale */}
                      <p className="text-xs sm:text-[13px] text-slate-200 leading-relaxed bg-black/25 p-3.5 rounded-xl border border-white/[0.05]">
                        {activeModule.text}
                      </p>

                      {/* Points clés à retenir */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                          Ce que vous pouvez faire :
                        </p>
                        <div className="space-y-1.5">
                          {activeModule.highlights.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2.5 text-xs text-slate-200 bg-white/[0.02] px-3 py-2 rounded-lg border border-white/[0.05]"
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Astuce Pro */}
                      <div className="p-3.5 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-start gap-3">
                        <Lightbulb className="w-4 h-4 text-[#F7BC5F] shrink-0 mt-0.5" />
                        <div className="text-xs">
                          <span className="font-extrabold text-[#F7BC5F] block mb-0.5">
                            Astuce Pro
                          </span>
                          <span className="text-slate-200 leading-relaxed">{activeModule.proTip}</span>
                        </div>
                      </div>
                    </div>

                    {/* Barre d'action directe pour tester le module */}
                    <div className="pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">
                        Passez directement à la pratique :
                      </span>
                      <div className="flex items-center gap-2">
                        {activeModule.id === 'clients' && onNavigateAction && (
                          <button
                            onClick={() => handleTriggerAction('nouveau-lead', activeModule.id, 'mission_lead')}
                            className="px-3 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.12] text-white font-bold text-xs flex items-center gap-1.5 transition-all"
                          >
                            <span>+ Créer un lead</span>
                          </button>
                        )}
                        {onNavigateAction && (
                          <button
                            onClick={() => handleTriggerAction(activeModule.actionTarget, activeModule.id)}
                            className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#f9c977] text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md transition-all"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{activeModule.actionLabel}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'missions' && (
            <div className="space-y-4">
              {/* En-tête de progression des missions */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-[#F7BC5F]/15 via-[#F7BC5F]/5 to-transparent border border-[#F7BC5F]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-[#F7BC5F]" />
                    <span>Parcours de prise en main ({missionsCount}/{ONBOARDING_MISSIONS.length} complétées)</span>
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Réalisez ces 7 actions concrètes pour maîtriser 100 % de Nova CRM. Cliquez sur « Lancer » pour essayer directement.
                  </p>
                </div>
                <div className="w-full sm:w-44 shrink-0">
                  <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                    <span className="text-slate-300">Progression</span>
                    <span className="text-[#F7BC5F]">
                      {Math.round((missionsCount / ONBOARDING_MISSIONS.length) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-black/40 overflow-hidden p-0.5 border border-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#F7BC5F] to-emerald-400 transition-all duration-300"
                      style={{ width: `${(missionsCount / ONBOARDING_MISSIONS.length) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Liste des 7 missions interactives */}
              <div className="space-y-2.5">
                {ONBOARDING_MISSIONS.map((mission, idx) => {
                  const isDone = completedMissions.includes(mission.id);
                  return (
                    <div
                      key={mission.id}
                      className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isDone
                          ? 'bg-emerald-500/[0.07] border-emerald-500/25'
                          : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          onClick={() => toggleMission(mission.id)}
                          title={isDone ? 'Marquer comme non fait' : 'Marquer comme terminé'}
                          className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                            isDone
                              ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                              : 'bg-black/30 border-white/20 hover:border-[#F7BC5F]'
                          }`}
                        >
                          {isDone ? (
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          ) : (
                            <span className="text-[11px] font-bold text-slate-400">{idx + 1}</span>
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4
                              className={`text-xs sm:text-sm font-bold ${
                                isDone ? 'line-through text-slate-400' : 'text-white'
                              }`}
                            >
                              {mission.title}
                            </h4>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 border border-white/[0.06]">
                              ⏱ {mission.duration}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{mission.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end shrink-0">
                        <button
                          onClick={() => {
                            if (mission.type === 'tour') {
                              markMissionDone(mission.id);
                              onClose();
                              onStartTour?.();
                            } else if (mission.type === 'quiz') {
                              setTab('quiz');
                            } else if (mission.target) {
                              handleTriggerAction(mission.target, undefined, mission.id);
                            }
                          }}
                          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                            isDone
                              ? 'bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 border border-white/[0.1]'
                              : 'bg-[#F7BC5F] hover:bg-[#f9c977] text-slate-950 shadow-sm'
                          }`}
                        >
                          <span>{mission.actionLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'quiz' && (
            <div className="space-y-4">
              {!quizFinished && currentQ ? (
                <div className="space-y-4">
                  {/* Barre de progression du Quiz */}
                  <div className="flex items-center justify-between gap-3 bg-white/[0.03] p-3.5 rounded-2xl border border-white/[0.08]">
                    <div className="flex items-center gap-2.5">
                      <span className="px-2.5 py-1 rounded-lg bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/30 text-xs font-extrabold">
                        Question {currentQuestionIdx + 1} / {QUIZ_SIZE}
                      </span>
                      <span className="text-xs text-slate-400 hidden sm:inline">
                        Cliquez sur une réponse pour vérifier immédiatement
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-lg">
                        Score : {score} pt{score > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Jauge visuelle */}
                  <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#F7BC5F] to-emerald-400 transition-all duration-300"
                      style={{ width: `${((currentQuestionIdx + 1) / QUIZ_SIZE) * 100}%` }}
                    />
                  </div>

                  {/* Carte de la question courante */}
                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.09] space-y-4">
                    <h3 className="text-sm sm:text-base font-extrabold text-white flex items-start gap-2.5">
                      <HelpCircle className="w-5 h-5 text-[#F7BC5F] shrink-0 mt-0.5" />
                      <span>{currentQ.q}</span>
                    </h3>

                    <div className="space-y-2.5">
                      {currentQ.options.map((opt, oi) => {
                        const isAnswered = currentAnswer !== null;
                        const isSelected = currentAnswer === oi;
                        const isCorrectOption = currentQ.correct === oi;

                        let btnStyle =
                          'border-white/[0.08] bg-black/25 text-slate-200 hover:bg-white/[0.06] hover:border-white/[0.18]';
                        if (isAnswered) {
                          if (isCorrectOption) {
                            btnStyle =
                              'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]';
                          } else if (isSelected && !isCorrectOption) {
                            btnStyle = 'border-rose-500/60 bg-rose-500/15 text-rose-200';
                          } else {
                            btnStyle = 'border-white/[0.05] bg-black/15 text-slate-500 opacity-60';
                          }
                        }

                        return (
                          <button
                            key={oi}
                            type="button"
                            disabled={isAnswered}
                            onClick={() => handleSelectOption(oi)}
                            className={`w-full text-left px-4 py-3.5 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 transition-all ${btnStyle}`}
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0 border ${
                                  isAnswered && isCorrectOption
                                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                                    : isAnswered && isSelected && !isCorrectOption
                                    ? 'bg-rose-500 text-white border-rose-400'
                                    : 'bg-white/[0.06] text-slate-300 border-white/[0.1]'
                                }`}
                              >
                                {String.fromCharCode(65 + oi)}
                              </span>
                              <span>{opt}</span>
                            </div>
                            {isAnswered && isCorrectOption && (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                            )}
                            {isAnswered && isSelected && !isCorrectOption && (
                              <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Explication instantanée dès que l'utilisateur a cliqué */}
                    {currentAnswer !== null && (
                      <div
                        className={`p-4 rounded-xl border flex items-start justify-between gap-4 flex-col sm:flex-row sm:items-center ${
                          currentAnswer === currentQ.correct
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-100'
                        }`}
                      >
                        <div className="space-y-1 text-xs">
                          <p className="font-extrabold flex items-center gap-1.5">
                            {currentAnswer === currentQ.correct ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                <span className="text-emerald-300">Bonne réponse !</span>
                              </>
                            ) : (
                              <>
                                <Lightbulb className="w-4 h-4 text-amber-400 shrink-0" />
                                <span className="text-amber-300">Bon à savoir :</span>
                              </>
                            )}
                          </p>
                          <p className="text-slate-200 leading-relaxed">{currentQ.explanation}</p>
                        </div>

                        <button
                          onClick={handleNextQuestion}
                          className="px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#f9c977] text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shrink-0 shadow-md transition-all self-end sm:self-center"
                        >
                          <span>
                            {currentQuestionIdx + 1 < QUIZ_SIZE
                              ? 'Question suivante'
                              : 'Voir mon score final'}
                          </span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Écran de résultat final du Quiz */
                <div className="space-y-4">
                  <div className="p-6 rounded-2xl bg-gradient-to-b from-[#F7BC5F]/15 to-white/[0.02] border border-[#F7BC5F]/30 text-center space-y-2">
                    <div className="w-14 h-14 rounded-2xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/40 text-[#F7BC5F] flex items-center justify-center mx-auto mb-2">
                      <Trophy className="w-7 h-7" />
                    </div>
                    <p className="text-3xl font-black text-[#F7BC5F]">
                      {score} / {QUIZ_SIZE}
                    </p>
                    <p className="text-sm font-bold text-white">
                      {score === QUIZ_SIZE
                        ? 'Sans-faute ! Vous maîtrisez Nova CRM sur le bout des doigts 🏆'
                        : score >= 7
                        ? 'Bravo ! Votre certification de prise en main est validée ✨'
                        : 'Bon début ! Explorez les fiches modules pour découvrir toutes les astuces.'}
                    </p>
                    <div className="pt-2 flex items-center justify-center gap-2.5 flex-wrap">
                      <button
                        onClick={restartQuiz}
                        className="px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#f9c977] text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-md transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Rejouer avec 10 nouvelles questions</span>
                      </button>
                      <button
                        onClick={() => setTab('guide')}
                        className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] font-bold text-xs transition-all"
                      >
                        Revoir les modules
                      </button>
                    </div>
                  </div>

                  {/* Récapitulatif détaillé */}
                  <div className="space-y-2">
                    {quiz.map((question, qi) => {
                      const isCorrect = answers[qi] === question.correct;
                      return (
                        <div
                          key={qi}
                          className={`p-3.5 rounded-xl border ${
                            isCorrect
                              ? 'bg-emerald-500/[0.06] border-emerald-500/25'
                              : 'bg-rose-500/[0.06] border-rose-500/25'
                          }`}
                        >
                          <p className="text-xs font-bold text-white mb-1 flex items-start gap-2">
                            {isCorrect ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            )}
                            <span>
                              {qi + 1}. {question.q}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-300 pl-6">
                            Bonne réponse :{' '}
                            <span className="text-emerald-300 font-bold">
                              {question.options[question.correct]}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400 pl-6 mt-0.5">
                            {question.explanation}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pied de page fixe */}
        <div className="px-4 sm:px-6 py-3 border-t border-white/[0.08] bg-[#051417]/95 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-400 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            <span>
              {exploredCount}/{GUIDE_MODULES.length} modules explorés · {missionsCount}/{ONBOARDING_MISSIONS.length} missions validées
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-extrabold text-slate-950 bg-[#F7BC5F] hover:bg-[#f9c977] transition-all shadow-sm"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default TutorialModal;
