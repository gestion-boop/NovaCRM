import React, { useMemo, useState } from 'react';
import {
  X, Sparkles, LayoutDashboard, Users, Bell, GitFork, Calendar, MessageSquare,
  Mail, FileText, FileEdit, Camera, LifeBuoy, Settings, Bot, HelpCircle,
  CheckCircle2, XCircle, RotateCcw, GraduationCap, BookOpen,
} from 'lucide-react';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Ticket #49 : lance la visite guidée interactive (spotlight sur les
  // vrais éléments de l'interface) — optionnel, ce modal reste utilisable
  // sans si l'appelant ne la fournit pas.
  onStartTour?: () => void;
}

// Ticket #31 (nouvelle base) : le tutoriel se limitait à 4 blocs très
// sommaires. Mise à jour majeure — un vrai guide couvrant chaque module du
// CRM, plus un quiz de 20 questions (10 tirées au hasard à chaque tentative)
// pour vérifier ce qui a été retenu.
const GUIDE_SECTIONS = [
  {
    icon: LayoutDashboard,
    color: 'text-[#F7BC5F]',
    title: 'Accueil & raccourcis',
    text: "L'écran d'accueil regroupe des tuiles personnalisables (\"Mes espaces\") vers chaque module. Glissez-déposez pour réordonner, cliquez sur la palette pour changer une couleur, ou sur \"Ajouter raccourci / dossier\" pour créer les vôtres. Le bloc \"Ma journée\" et \"Priorités\" en haut donnent un résumé instantané de votre agenda et de vos tâches en attente.",
  },
  {
    icon: Users,
    color: 'text-emerald-400',
    title: 'Clients & Leads',
    text: "Consultez, filtrez et modifiez tous vos contacts. \"+ Nouveau lead\" ouvre une fiche complète (coordonnées, budget, type de projet). Chaque fiche client centralise rendez-vous, notes, documents, e-mails échangés et historique du pipeline. Vous pouvez partager un contact avec un collègue, ou l'archiver sans le supprimer.",
  },
  {
    icon: GitFork,
    color: 'text-sky-400',
    title: 'Pipeline',
    text: "Vue Kanban de vos dossiers, de la prospection à la signature. Faites glisser une carte d'une étape à l'autre pour la faire progresser. Un dossier archivé (signé ou perdu) sort automatiquement du pipeline actif.",
  },
  {
    icon: Calendar,
    color: 'text-purple-400',
    title: 'Agenda',
    text: "Synchronisé avec Google Agenda dans les deux sens : un rendez-vous créé dans Nova CRM apparaît dans Google Agenda, et inversement. Gérez date/heure de fin, événements toute la journée, participants et disponibilité (libre/occupé) directement depuis la fiche du rendez-vous.",
  },
  {
    icon: MessageSquare,
    color: 'text-blue-400',
    title: 'Chat & Messagerie interne',
    text: "Discutez en canaux d'équipe (par projet) ou en messages directs. Réagissez avec un emoji, éditez ou supprimez vos messages, et suivez l'accusé de lecture (✓✓) sur vos envois.",
  },
  {
    icon: Mail,
    color: 'text-cyan-400',
    title: 'Mail',
    text: "Boîte Gmail intégrée : Réception, Non lus, Envoyés, Corbeille... Répondez, transférez ou composez directement depuis le CRM, avec votre signature configurée dans Paramètres > Mail.",
  },
  {
    icon: FileText,
    color: 'text-orange-400',
    title: 'Documents',
    text: "Stockage centralisé par client ou par dossier général. L'icône œil ouvre un aperçu sans télécharger le fichier.",
  },
  {
    icon: FileEdit,
    color: 'text-teal-400',
    title: 'Notes',
    text: "Organisées en dossiers. Sur ordinateur, une vue en trois colonnes (dossiers / liste / contenu) permet de naviguer rapidement, comme dans un bloc-notes classique.",
  },
  {
    icon: Bot,
    color: 'text-[#F9C977]',
    title: 'Assistant Nova',
    text: "Demandez-lui de créer un contact, une tâche, une note ou un rendez-vous en langage naturel — plusieurs actions à la fois si besoin. Elle peut aussi répondre à des questions générales grâce à une recherche web intégrée.",
  },
  {
    icon: Camera,
    color: 'text-fuchsia-400',
    title: 'Réserver une caméra',
    text: "Réservez le matériel photo/vidéo de l'agence pour vos visites. Une demande est soumise à validation par un administrateur avant confirmation.",
  },
  {
    icon: LifeBuoy,
    color: 'text-rose-400',
    title: 'Support',
    text: "Signalez un bug ou une idée d'amélioration : Sylvain et Mélanie sont notifiés et peuvent échanger avec vous directement sur le ticket jusqu'à sa résolution.",
  },
  {
    icon: Settings,
    color: 'text-slate-400',
    title: 'Paramètres',
    text: "Votre profil, vos notifications, l'ordre des onglets de la barre latérale, l'apparence (couleur, fond d'écran) et — pour les administrateurs — la gestion des utilisateurs et la diffusion d'annonces à toute l'équipe.",
  },
];

interface QuizQuestion {
  q: string;
  options: string[];
  correct: number;
}

const QUIZ_BANK: QuizQuestion[] = [
  { q: "Où crée-t-on un nouveau contact ?", options: ["Bouton \"+ Nouveau lead\"", "Dans Paramètres", "Dans Support"], correct: 0 },
  { q: "Le Pipeline s'organise sous quelle forme ?", options: ["Liste triée", "Tableau Kanban", "Calendrier"], correct: 1 },
  { q: "Un rendez-vous créé dans Nova CRM se synchronise avec...", options: ["Rien, c'est local", "Google Agenda (dans les deux sens)", "Uniquement Outlook"], correct: 1 },
  { q: "Comment savoir si un message envoyé a été lu ?", options: ["Un point rouge", "Une double coche ✓✓", "Rien ne l'indique"], correct: 1 },
  { q: "Où gère-t-on la signature de ses e-mails ?", options: ["Paramètres > Mail", "Dans chaque message", "Impossible actuellement"], correct: 0 },
  { q: "Que fait l'icône en forme d'œil dans Documents ?", options: ["Supprime le fichier", "Ouvre un aperçu sans le télécharger", "Le partage par mail"], correct: 1 },
  { q: "Sur ordinateur, comment sont organisées les Notes ?", options: ["Une seule longue liste", "Dossiers / liste / contenu en 3 colonnes", "Par ordre alphabétique uniquement"], correct: 1 },
  { q: "Nova peut-elle créer plusieurs éléments en une seule demande ?", options: ["Non, un seul à la fois", "Oui (contact + tâche + note ensemble, par exemple)", "Seulement des tâches"], correct: 1 },
  { q: "Une réservation de caméra est...", options: ["Automatiquement confirmée", "Soumise à validation d'un administrateur", "Impossible à annuler"], correct: 1 },
  { q: "Qui reçoit une notification quand vous ouvrez un ticket Support ?", options: ["Personne", "Sylvain et Mélanie", "Tous les utilisateurs"], correct: 1 },
  { q: "Un dossier archivé dans le pipeline...", options: ["Reste affiché indéfiniment", "Sort automatiquement du pipeline actif", "Doit être supprimé manuellement"], correct: 1 },
  { q: "Où personnalise-t-on l'ordre des onglets de la barre latérale ?", options: ["Paramètres > Ordre des onglets", "Impossible", "Dans chaque page"], correct: 0 },
  { q: "Que se passe-t-il si vous glissez une carte Pipeline vers une autre étape ?", options: ["Rien, il faut valider ailleurs", "Le dossier progresse vers cette étape", "Le contact est supprimé"], correct: 1 },
  { q: "Les tuiles de l'accueil (\"Mes espaces\") peuvent être...", options: ["Réordonnées et recolorées", "Uniquement dans l'ordre par défaut", "Modifiées par un admin uniquement"], correct: 0 },
  { q: "Une annonce publiée par un administrateur s'affiche...", options: ["Nulle part visiblement", "Au centre de l'écran pour tous les concernés", "Uniquement par e-mail"], correct: 1 },
  { q: "Peut-on partager un contact avec un collègue ?", options: ["Non", "Oui, depuis la fiche client", "Uniquement un administrateur peut le faire"], correct: 1 },
  { q: "Le bloc \"Ma journée\" sur l'accueil affiche...", options: ["La météo", "Un résumé de votre agenda du jour", "Les ventes du mois"], correct: 1 },
  { q: "Comment archiver un contact sans le supprimer ?", options: ["Ce n'est pas possible", "Menu Actions > Archiver sur la fiche client", "Il faut le faire depuis Paramètres"], correct: 1 },
  { q: "Nova peut-elle répondre à des questions générales (hors CRM) ?", options: ["Non, jamais", "Oui, grâce à une recherche web intégrée", "Seulement sur la météo"], correct: 1 },
  { q: "Où consulte-t-on les e-mails déjà échangés avec un contact ?", options: ["Nulle part", "Dans l'onglet \"Emails\" de sa fiche client", "Uniquement dans Gmail directement"], correct: 1 },
  { q: "Que fait le bouton plein écran dans le header ?", options: ["Ferme l'application", "Bascule le CRM en plein écran navigateur", "Change le thème"], correct: 1 },
  { q: "Un rappel/rendez-vous \"toute la journée\" est possible dans l'Agenda ?", options: ["Non", "Oui", "Seulement le week-end"], correct: 1 },
];

const QUIZ_SIZE = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose, onStartTour }) => {
  const [tab, setTab] = useState<'guide' | 'quiz'>('guide');
  const [quiz, setQuiz] = useState<QuizQuestion[]>(() => shuffle(QUIZ_BANK).slice(0, QUIZ_SIZE));
  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(QUIZ_SIZE).fill(null));
  const [submitted, setSubmitted] = useState(false);

  const score: number = useMemo(
    () => answers.reduce<number>((acc, a, i) => acc + (a === quiz[i]?.correct ? 1 : 0), 0),
    [answers, quiz]
  );

  const restartQuiz = () => {
    setQuiz(shuffle(QUIZ_BANK).slice(0, QUIZ_SIZE));
    setAnswers(Array(QUIZ_SIZE).fill(null));
    setSubmitted(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-2xl w-full p-6 shadow-2xl text-white relative max-h-[90vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-gray-400 hover:text-white bg-white/5"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#F7BC5F] text-black flex items-center justify-center font-bold shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Guide d'utilisation Nova CRM</h2>
            <p className="text-xs text-gray-400">Formation complète et quiz de connaissance</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mb-4 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/10 w-fit">
            <button
              onClick={() => setTab('guide')}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
                tab === 'guide' ? 'bg-[#F7BC5F] text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Guide
            </button>
            <button
              onClick={() => setTab('quiz')}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
                tab === 'quiz' ? 'bg-[#F7BC5F] text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" /> Quiz (10 questions)
            </button>
          </div>
          {/* Ticket #49 : visite guidée interactive de 3 min, en plus du
              texte statique ci-dessous — touche directement les vrais
              boutons de l'interface plutôt que de les décrire. */}
          {onStartTour && (
            <button
              onClick={() => { onClose(); onStartTour(); }}
              className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Lancer la visite guidée (3 min)
            </button>
          )}
        </div>

        {tab === 'guide' ? (
          <div className="space-y-3 text-sm text-gray-300 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
            {GUIDE_SECTIONS.map((s) => (
              <div key={s.title} className="p-3.5 bg-white/5 rounded-xl border border-white/5 flex gap-3">
                <s.icon className={`w-5 h-5 ${s.color} shrink-0 mt-0.5`} />
                <div>
                  <h4 className="font-semibold text-white text-xs mb-0.5">{s.title}</h4>
                  <p className="text-xs text-gray-400">{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0 space-y-4">
            {!submitted ? (
              <>
                {quiz.map((question, qi) => (
                  <div key={qi} className="p-3.5 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-xs font-bold text-white mb-2 flex items-start gap-2">
                      <HelpCircle className="w-4 h-4 text-[#F9C977] shrink-0 mt-0.5" />
                      {qi + 1}. {question.q}
                    </p>
                    <div className="space-y-1.5 pl-6">
                      {question.options.map((opt, oi) => (
                        <label
                          key={oi}
                          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                            answers[qi] === oi
                              ? 'border-[#F7BC5F]/60 bg-[#F7BC5F]/10 text-white'
                              : 'border-white/5 text-gray-400 hover:bg-white/5'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q-${qi}`}
                            checked={answers[qi] === oi}
                            onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                            className="accent-[#F7BC5F]"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setSubmitted(true)}
                  disabled={answers.some((a) => a === null)}
                  className="w-full py-2.5 rounded-xl text-xs font-bold text-black bg-[#F7BC5F] hover:bg-[#d9ab38] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Valider mes réponses
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-center">
                  <p className="text-3xl font-black text-[#F7BC5F]">{score}/{QUIZ_SIZE}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {score === QUIZ_SIZE
                      ? 'Parfait, vous maîtrisez le CRM !'
                      : score >= QUIZ_SIZE * 0.7
                      ? 'Très bon score !'
                      : 'Repassez sur le Guide pour revoir les points ratés.'}
                  </p>
                </div>
                {quiz.map((question, qi) => {
                  const isCorrect = answers[qi] === question.correct;
                  return (
                    <div key={qi} className={`p-3.5 rounded-xl border ${isCorrect ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20'}`}>
                      <p className="text-xs font-bold text-white mb-1.5 flex items-start gap-2">
                        {isCorrect ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        {qi + 1}. {question.q}
                      </p>
                      <p className="text-[11px] text-gray-400 pl-6">
                        Bonne réponse : <span className="text-emerald-300 font-semibold">{question.options[question.correct]}</span>
                      </p>
                    </div>
                  );
                })}
                <button
                  onClick={restartQuiz}
                  className="w-full py-2.5 rounded-xl text-xs font-bold text-white bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Refaire le quiz (nouvelles questions)
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-white/10 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-xs font-bold text-black bg-[#F7BC5F] hover:bg-[#d9ab38]"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
export default TutorialModal;
