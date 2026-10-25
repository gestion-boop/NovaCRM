import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

// Ticket #114/#116 (suivi) : migré de @hello-pangea/dnd vers @dnd-kit — même
// mécanisme déjà utilisé pour les tuiles de l'accueil (dont la fluidité sert
// justement de référence dans le retour utilisateur), pour une sensation de
// glisser-déposer cohérente dans tout le CRM.
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';

import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { formatCurrency, htDepuisTtc, ttcDepuisHt } from '@/lib/utils';
import { toValidUuidOrNull } from '@/data/teamMembers';
import {
  estPipelineTransactions,
  peutGererColonnes,
  peutRenommerPipeline,
  peutSupprimerPipeline,
  pipelineVisiblePour,
  type PipelinePourAcces,
} from '@/lib/pipelinesAcces';
import { couleurNovavisio, couleurEtapeNovavisio, estAgenceNovavisio } from '@/lib/couleursNovavisio';
// Ticket #277 (suite) : même détection de mode jour que l'accueil, pour que
// les colonnes du pipeline suivent la même bascule vers de vraies couleurs
// claires (au lieu du filtre global qui pâlit juste le bleu canard).
import { useIsLightMode } from './AccueilGrid';
import TransactionChecklistModal, {
  STAGE_CHECKLISTS,
  getStageChecklistConfig,
  IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID,
  IMMOSPHERA_AGENCY_ID,
  usePreviousStageMissingCount,
  useCurrentStageChecklistCount,
} from './TransactionChecklistModal';
import { ClipboardList } from 'lucide-react';

import {
  AlertTriangle,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Shield,
  Star,
  Trash2,
} from 'lucide-react';

import {
  AGENCIES,
  Contact,
  Deal,
  PipelineDef,
} from '@/types';



import {
  useAuth,
} from '@/context/AuthContext';

import {
  useDeals,
} from '@/hooks/useDeals';

import {
  useContacts,
} from '@/hooks/useContacts';

import {
  useTasks,
} from '@/hooks/useTasks';

import { getTaskDateStatus } from '@/lib/taskUtils';

// Ticket #106 : "toujours conditionner la création d'un pipeline à un
// renommage, ne jamais laisser un nom générique type « Mon Pipeline »" —
// bloque les intitulés placeholder les plus courants (création ET
// renommage), pour ne plus jamais se retrouver avec un pipeline qui reste
// nommé comme un brouillon.
const GENERIC_PIPELINE_NAMES = ['mon pipeline', 'nouveau pipeline', 'pipeline', 'sans titre', 'sans nom'];
const isGenericPipelineName = (name: string) => GENERIC_PIPELINE_NAMES.includes(name.trim().toLowerCase());

const BASE_PIPELINES: PipelineDef[] = [
  {
    id: 'pipe-principal',
    name: 'Pipeline principal',
    stages: [
      'Nouveau',
      'À contacter',
      'En cours',
      'En attente',
      'Finalisation',
      'Terminé',
    ],
  },
];

interface StoredPipeline extends PipelineDef {
  agencyId: string;
  sortOrder: number;
  createdAt: string;
  // Demandé le 2 septembre : « les utilisateurs peuvent supprimer les
  // pipelines, sauf les officiels » puis « c'est LEUR pipeline qu'ils
  // pourront modifier uniquement, et je veux pouvoir en verrouiller ».
  //
  //   officiel    : le pipeline marqué par défaut pour la société — celui de
  //                 référence, sur lequel tout le monde travaille.
  //   verrouille  : posé par un super admin sur n'importe quel pipeline.
  //   proprietaire: qui l'a créé (colonne owner_id) ; vide sur les pipelines
  //                 antérieurs, qui restent donc réservés aux super admins.
  officiel: boolean;
  verrouille: boolean;
  proprietaire: string | null;
  // Jamais chargée depuis la base ni écrite à la création : optionnelle,
  // plutôt que déclarée obligatoire et toujours absente.
  updatedAt?: string;
}

interface PipelineProps {
  onSelectContact?: (contactId: string) => void;
  // Ticket #105 : venant d'un clic sur une colonne du graphique du tableau
  // de bord, fait défiler directement jusqu'à cette étape du pipeline et la
  // met brièvement en surbrillance. `onInitialStageHandled` prévient une
  // fois le défilement fait, pour ne pas re-déclencher au moindre re-render.
  initialStage?: string | null;
  onInitialStageHandled?: () => void;
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : ouvre le
  // composeur Mail avec un brouillon pré-rempli (jamais d'envoi automatique)
  // — voir App.tsx (mailComposeTo/Subject/Body) et MailView.tsx.
  onOpenMailDraft?: (to: string, subject: string, body: string) => void;
  // Demande explicite : "mets Nova dans Pipeline" — ouvre Nova avec le
  // libellé du dossier déjà prêt à compléter (voir App.tsx).
  onOpenNova?: (dealTitle: string) => void;
}

// Palette cyclique de liserets colorés par colonne, pour un effet plus vivant
// sans dépendre du nom métier de l'étape.
const STAGE_ACCENT_COLORS = [
  '#F7BC5F', // ambre (marque)
  '#38BDF8', // sky
  '#34D399', // emerald
  '#A78BFA', // violet
  '#FB7185', // rose
  '#22D3EE', // cyan
];

// Contenu visuel d'une carte, sans les hooks de glisser-déposer — réutilisé
// tel quel par la carte "vivante" (PipelineCard) ET par son clone flottant
// affiché dans le DragOverlay pendant le glisser.
// Demande explicite (28/08/2026, Immosphera / Pipeline Transactions V2) :
// checklist par étape, construite une étape à la fois — voir
// TransactionChecklistModal.tsx. N'apparaît QUE sur cette pipeline précise,
// jamais ailleurs.
const TransactionsV2ChecklistBadge: React.FC<{ deal: Deal; onOpen: () => void }> = ({ deal, onOpen }) => {
  const hasChecklist = !!getStageChecklistConfig(deal.stage);
  const missingFromPrevStage = usePreviousStageMissingCount(deal.contactId, deal.stage);
  const currentCount = useCurrentStageChecklistCount(deal.contactId, deal.stage);

  if (!hasChecklist && !missingFromPrevStage) return null;

  return (
    <div className="mt-3 pt-3 border-t border-[#143c3f]/50">
      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Suivi</span>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {hasChecklist && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#F7BC5F] text-[10px] font-bold hover:bg-[#F7BC5F]/25 transition-colors cursor-pointer"
          >
            <ClipboardList className="w-3 h-3" />
            Checklist
            {currentCount && <span className="text-[9px] opacity-80">{currentCount.done}/{currentCount.total}</span>}
          </button>
        )}
        {!!missingFromPrevStage && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            title={`${missingFromPrevStage} document(s) obligatoire(s) reporté(s) des étapes précédentes — cliquez pour régulariser.`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-[10px] font-black transition-colors cursor-pointer"
          >
            {missingFromPrevStage} manquant{missingFromPrevStage > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );
};

const PipelineCardContent: React.FC<{
  deal: Deal;
  contact: Contact | undefined;
  taskStatus: ReturnType<typeof getTaskDateStatus> | null | undefined;
  onDelete?: (dealId: string) => void;
  onOpenChecklist?: (deal: Deal) => void;
  onOpenNova?: (dealTitle: string) => void;
}> = ({ deal, contact, taskStatus, onDelete, onOpenChecklist, onOpenNova }) => {
  const initials = (deal.title || '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'D';
  const showContactSub = contact && contact.name && contact.name.trim().toLowerCase() !== deal.title.trim().toLowerCase();

  return (
    <>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#F7BC5F]/20 via-amber-500/10 to-[#F7BC5F]/5 border border-[#F7BC5F]/35 text-[#FAD592] text-xs font-black flex items-center justify-center shadow-inner">
              {initials}
            </div>
            {taskStatus !== undefined && (
              taskStatus ? (
                <span
                  title={`Prochaine tâche : ${taskStatus.label}`}
                  className={`absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full ring-2 ring-[#07191c] ${taskStatus.dotClass}`}
                />
              ) : (
                <span title="Aucune tâche planifiée" className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-[#07191c]" />
              )
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-white group-hover:text-[#FAD592] transition-colors truncate leading-snug">
              {deal.title}
            </h4>
            {showContactSub && (
              <p className="text-xs text-slate-400 truncate mt-0.5">{contact.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onOpenNova && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenNova(deal.title); }}
              title="Demander à Nova (changer d'étape, ajouter une note...)"
              className="w-6 h-6 rounded-full overflow-hidden shrink-0 hover:scale-110 hover:ring-2 hover:ring-[#F7BC5F]/60 transition-all shadow-sm"
            >
              <img src="/nova-mascotte.png" alt="Nova" className="w-full h-full object-cover" />
            </button>
          )}
          {onDelete && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }}
              className="w-6 h-6 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 flex items-center justify-center transition-colors"
              title="Supprimer ce dossier"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Montant estimé</span>
        <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${
          deal.amount > 0
            ? 'bg-gradient-to-r from-[#F7BC5F]/15 to-amber-500/10 border border-[#F7BC5F]/35 text-[#FAD592] shadow-[0_0_12px_rgba(247,188,95,0.15)]'
            : 'bg-white/[0.04] border border-white/10 text-slate-400'
        }`}>
          {deal.amount.toLocaleString('fr-FR')} €
        </span>
      </div>
      {onOpenChecklist && deal.pipelineId === IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID && (
        <TransactionsV2ChecklistBadge deal={deal} onOpen={() => onOpenChecklist(deal)} />
      )}
    </>
  );
};

// Carte déplaçable d'un dossier — pas de réordonnancement au sein d'une
// colonne (aucune position n'est persistée, seule l'étape compte), donc un
// simple `useDraggable` suffit : plus léger et sans effet de "poussée" des
// voisines pendant le survol, contrairement à un `useSortable` complet.
// Rendue invisible pendant le glisser (le vrai rendu visible passe par le
// DragOverlay, qui échappe au `overflow-hidden` de la colonne).
// Signalé : "le déplacement des cartes saccade, pas fluide". Cause réelle
// trouvée (même bug que sur le tableau des tâches internes, voir
// InternalProjectBoard.tsx) : `useDroppable` (dropzone de la colonne)
// change de valeur `isOver` à chaque déplacement du pointeur pendant un
// glisser — sans React.memo, CETTE colonne se re-rend alors en entier à
// chaque frame, ce qui recrée TOUTES ses cartes (même la carte
// actuellement déplacée n'affecte pas cette colonne — c'est le simple
// survol qui déclenche ça). Les props (`onSelectContact`, `onDelete`)
// étaient déjà stables ici (passées telles quelles, pas de closure recréée
// dans le `.map()`), donc React.memo suffit à éliminer ce re-rendu
// inutile.
// Signalé (25/09/2026, tablettes) : "on ne peut plus scroller en haut et en
// bas quand on est [dans] pipelines" — la carte entière sert de poignée de
// glisser (`{...listeners}` ci-dessous) et portait `touch-action: none`
// (`touch-none`), qui coupe TOUT geste tactile natif dès qu'on pose le
// doigt dessus, y compris le simple défilement vertical de la page — sur
// tablette, où les cartes occupent une grande partie de l'écran, il ne
// restait quasi aucune zone "libre" pour amorcer un scroll au doigt.
// `TouchSensor` était pourtant déjà configuré en `delay: 200` (glisser
// seulement après une pression tenue, pour laisser passer un balayage
// rapide) — un réglage pensé pour cohabiter avec un `touch-action` qui
// laisse le défilement natif au navigateur, pas avec `none` (qui rend ce
// délai inopérant : le scroll est déjà bloqué dès le premier contact, quoi
// que décide `TouchSensor` ensuite).
// Signalé à nouveau (24 octobre, téléphone) : "je ne peux pas scroller vers
// les colonnes suivantes" — le correctif ci-dessus n'avait autorisé que le
// défilement VERTICAL (`touch-pan-y`), pas l'horizontal, alors que ce sont
// les colonnes elles-mêmes qui défilent horizontalement (voir
// `overflow-x-auto`/`touch-pan-x` sur leur conteneur plus bas) : un doigt
// posé sur une carte (qui remplit presque toute la colonne) ne pouvait donc
// jamais déclencher ce défilement latéral, quelle que soit la rapidité du
// geste. `touch-auto` laisse le navigateur choisir l'axe (vertical OU
// horizontal, selon le geste et le conteneur défilant rencontré) sans rien
// retirer à `TouchSensor`, qui continue de détecter un glisser-déposer
// volontaire (pression tenue 200ms + déplacement) avant qu'un défilement
// natif n'ait eu le temps de s'engager.
const PipelineCard = React.memo<{
  deal: Deal;
  contact: Contact | undefined;
  taskStatus: ReturnType<typeof getTaskDateStatus> | null | undefined;
  onSelectContact?: (contactId: string) => void;
  onDelete: (dealId: string) => void;
  onOpenChecklist?: (deal: Deal) => void;
  onOpenNova?: (dealTitle: string) => void;
}>(function PipelineCard({ deal, contact, taskStatus, onSelectContact, onDelete, onOpenChecklist, onOpenNova }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { type: 'card' as const, stage: deal.stage },
  });
  const couleur = couleurNovavisio(deal);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => { if (contact && onSelectContact) onSelectContact(contact.id); }}
      style={couleur ? { borderLeft: `4px solid ${couleur}`, backgroundColor: `${couleur}15` } : undefined}
      className={`group relative p-3.5 rounded-2xl bg-gradient-to-b from-white/[0.07] via-white/[0.02] to-black/60 border transition-all duration-200 touch-auto select-none backdrop-blur-md shadow-md overflow-hidden ${
        contact ? 'cursor-pointer hover:-translate-y-0.5' : ''
      } ${
        isDragging
          ? 'opacity-0'
          : 'border-white/10 hover:border-[#F7BC5F]/60 hover:shadow-[0_10px_30px_-5px_rgba(0,0,0,0.7),0_0_20px_rgba(247,188,95,0.18)]'
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-[#F7BC5F]/50 transition-all" />
      <PipelineCardContent deal={deal} contact={contact} taskStatus={taskStatus} onDelete={onDelete} onOpenChecklist={onOpenChecklist} onOpenNova={onOpenNova} />
    </div>
  );
});

// Une colonne du pipeline : déplaçable elle-même (réordonnancement des
// étapes, poignée dédiée) ET zone de dépôt pour les cartes glissées depuis
// une autre colonne. Deux identifiants distincts (`stage` pour la colonne
// triable, `dropzone-${stage}` pour la zone de dépôt des cartes) pour ne
// jamais les confondre côté détection de collision.
const PipelineColumn: React.FC<{
  stage: string;
  stageDeals: Deal[];
  stageTotal: number;
  // Ticket #35 : « le HT doit etre en haut de la colonne visible par Melanie
  // et Sylvain », et « le hors taxe des conseillers pourra etre vu par
  // seulement chaque conseiller personnellement ». D'ou deux lectures de la
  // meme colonne : le total de l'agence pour les super admins, sa propre
  // commission pour un conseiller.
  estSuperAdmin: boolean;
  // Infobulle du total de la colonne : « Commission agence, hors taxes »
  // partout, sauf Conseils Finances où c'est « Honoraires agence, TTC »
  // (5 septembre : « il n'y a pas de hors taxes dans Conseils Finances »).
  libelleMontant?: string;
  stageMonHt: number;
  // Commission conseiller cumulée de la colonne, convertie en HT.
  stageAdvisorHt: number;
  accentColor: string;
  canManageStructure: boolean;
  // Demande explicite (23 septembre) : le créateur d'un pipeline (non
  // officiel/verrouillé) peut renommer ses colonnes, même sans être super
  // admin — ajouter/supprimer/réordonner (canManageStructure) reste réservé
  // aux super admins. Calculé par pipeline, pas par colonne (voir le site
  // d'appel : `peutRenommerOuSupprimerPipeline(activePipeline)`).
  canRenameStage: boolean;
  contactsById: Map<string, Contact>;
  taskStatusByContactId: Map<string, ReturnType<typeof getTaskDateStatus> | null>;
  onSelectContact?: (contactId: string) => void;
  onDeleteDeal: (dealId: string) => void;
  onOpenChecklist?: (deal: Deal) => void;
  onOpenNova?: (dealTitle: string) => void;
  onRename: (stage: string) => void;
  onRequestDelete: (stage: string) => void;
  justArrived: boolean;
}> = ({
  stage, stageDeals, stageTotal, stageAdvisorHt, estSuperAdmin, stageMonHt, accentColor, canManageStructure, canRenameStage, libelleMontant,
  contactsById, taskStatusByContactId, onSelectContact, onDeleteDeal, onOpenChecklist, onOpenNova, onRename, onRequestDelete, justArrived,
}) => {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } = useSortable({
    id: stage,
    disabled: !canManageStructure,
    data: { type: 'column' as const },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `dropzone-${stage}`,
    data: { type: 'dropzone' as const, stage },
  });
  const [hovered, setHovered] = useState(false);

  return (
    <div
      id={`pipeline-stage-${stage}`}
      ref={setSortableRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderTopColor: accentColor,
        boxShadow: isDragging
          ? `0 16px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px ${accentColor}55`
          : justArrived
          ? `0 0 0 2px ${accentColor}, 0 0 32px 4px ${accentColor}55`
          : hovered
          ? `0 0 0 1px ${accentColor}66, 0 0 24px 2px ${accentColor}33`
          : undefined,
      }}
      // Signalé : colonnes trop transparentes (gris quasi invisible même à
      // 20% d'opacité) — remplacé par le bleu canard (dark teal) déjà
      // utilisé comme fond de carte partout ailleurs dans le CRM (#0a1e20),
      // en plein (non transparent) pour bien se détacher du fond de page.
      // Correctif annulé (mode jour) : garder cette couleur dans les deux
      // modes, pas de fond blanc uni — seul le filtre global l'éclaircit.
      // Essai (30/08/2026, demande explicite) : "le blanc en mode jour ne
      // mets pas ça, plutôt un gris hyper clair anthracite... 30% [d'opacité]
      // pour voir. Essaye d'abord sur le panneau pipeline." — classe dédiée
      // `pipeline-column-bg` ajoutée UNIQUEMENT pour cibler cette colonne
      // précisément en CSS (voir index.css), sans toucher aux autres
      // éléments qui partagent le même bg-[#0a1e20] ailleurs dans l'appli
      // (essai isolé, pas encore généralisé).
      className={`pipeline-column-bg w-[85vw] max-w-[320px] sm:w-[310px] shrink-0 snap-center snap-always bg-[#07191c]/90 backdrop-blur-xl border border-white/10 border-t-[3px] rounded-2xl transition-all duration-200 shadow-[0_12px_32px_rgba(0,0,0,0.4)] max-h-[65dvh] overflow-y-auto sm:max-h-none sm:overflow-visible ${
        isDragging ? 'scale-[1.01] opacity-70 z-30' : ''
      }`}
    >
      <div className="pipeline-column-bg bg-gradient-to-b from-white/[0.06] to-transparent sticky top-0 z-10 rounded-t-2xl p-3.5 border-b border-white/10 flex items-center justify-between gap-2 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          {canManageStructure && (
            <span {...attributes} {...listeners} className="text-slate-500 hover:text-[#F7BC5F] cursor-grab active:cursor-grabbing touch-none p-0.5">
              <GripVertical className="w-4 h-4" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-black text-white truncate tracking-tight">{stage}</h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-slate-300">
                {stageDeals.length} affaire{stageDeals.length > 1 ? 's' : ''}
              </span>
              {estSuperAdmin ? (
                stageTotal > 0 && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/35 text-[#FAD592] shadow-sm" title={libelleMontant || 'Commission agence, hors taxes'}>
                    {formatCurrency(stageTotal)}
                  </span>
                )
              ) : (
                stageMonHt > 0 && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/35 text-[#FAD592] shadow-sm" title="Ta commission conseiller sur cette colonne, saisie TTC et convertie hors taxes. Personne d'autre ne la voit.">
                    {formatCurrency(stageMonHt)} HT
                  </span>
                )
              )}
            </div>
          </div>
        </div>

        {(canManageStructure || canRenameStage) && (
          <div className="flex items-center gap-1">
            {canRenameStage && (
              <button
                onClick={() => onRename(stage)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
                title="Renommer la colonne"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {canManageStructure && (
              <button
                onClick={() => onRequestDelete(stage)}
                className="p-1.5 rounded-lg hover:bg-rose-500/10 text-gray-400 hover:text-rose-300"
                title="Supprimer la colonne"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <div
        ref={setDropRef}
        style={{
          boxShadow: isOver ? `inset 0 0 0 2px ${accentColor}88, inset 0 0 32px 4px ${accentColor}22` : undefined,
          backgroundColor: isOver ? `${accentColor}0d` : undefined,
        }}
        className="p-3 min-h-[180px] space-y-2.5 sm:space-y-2 rounded-b-2xl transition-shadow duration-150"
      >
        {stageDeals.map((deal) => {
          const contact = contactsById.get(deal.contactId);
          const taskStatus = contact ? taskStatusByContactId.get(contact.id) ?? null : undefined;
          return (
            <PipelineCard
              key={deal.id}
              deal={deal}
              contact={contact}
              taskStatus={taskStatus}
              onSelectContact={onSelectContact}
              onDelete={onDeleteDeal}
              onOpenChecklist={onOpenChecklist}
              onOpenNova={onOpenNova}
            />
          );
        })}
      </div>
    </div>
  );
};

export const Pipeline: React.FC<PipelineProps> = ({ onSelectContact, initialStage, onInitialStageHandled, onOpenMailDraft, onOpenNova }) => {
  const {
    currentUser,
    userProfile,
    activeAgency,
  } = useAuth();

  const {
    deals,
    allDeals,
    addDeal,
    updateDeal,
    deleteDeal,
  } = useDeals();

  const queryClient = useQueryClient();

  const {
    contacts,
  } = useContacts();

  const {
    tasks,
  } = useTasks();

  // Pastille de statut par carte, basée sur la tâche la plus urgente (non
  // terminée) rattachée au contact du dossier — même logique de couleurs
  // que Rappels (rouge = en retard/aujourd'hui, orange = demain, vert =
  // plus tard). `null` = aucune tâche planifiée pour ce contact.
  const taskStatusByContactId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getTaskDateStatus> | null>();
    contacts.forEach((contact) => {
      const pendingTasks = tasks.filter((t) => t.contactId === contact.id && !t.completed);
      if (pendingTasks.length === 0) {
        map.set(contact.id, null);
        return;
      }
      const statuses = pendingTasks.map((t) => getTaskDateStatus(t.dueDate));
      // La plus urgente = celle avec le plus petit diffDays (en retard en premier).
      const mostUrgent = statuses.reduce((a, b) => (a.diffDays <= b.diffDays ? a : b));
      map.set(contact.id, mostUrgent);
    });
    return map;
  }, [contacts, tasks]);

  // Ticket #114 : chaque carte du pipeline cherchait son contact avec
  // `contacts.find(...)` (recherche linéaire) à CHAQUE rendu — avec des
  // centaines de dossiers, ça retombait sur du O(dossiers × contacts) à
  // chaque frame pendant un glisser-déposer (hello-pangea re-rend tout le
  // plateau en continu), d'où la latence/les blocages remontés. Un Map
  // (recherche O(1)), recalculé seulement quand `contacts` change.
  const contactsById = useMemo(() => {
    const map = new Map<string, (typeof contacts)[number]>();
    contacts.forEach((contact) => map.set(contact.id, contact));
    return map;
  }, [contacts]);

  const [
    pipelines,
    setPipelines,
  ] = useState<StoredPipeline[]>([]);

  const [
    activePipelineId,
    setActivePipelineId,
  ] = useState('');

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<string | null>(null);

  const [
    success,
    setSuccess,
  ] = useState<string | null>(null);

  const [
    showCreatePipelineModal,
    setShowCreatePipelineModal,
  ] = useState(false);

  const [
    showRenamePipelineModal,
    setShowRenamePipelineModal,
  ] = useState(false);

  const [
    showDeletePipelineModal,
    setShowDeletePipelineModal,
  ] = useState(false);

  const [
    showAddStageModal,
    setShowAddStageModal,
  ] = useState(false);

  const [
    newPipelineName,
    setNewPipelineName,
  ] = useState('');

  const [
    renamePipelineTitle,
    setRenamePipelineTitle,
  ] = useState('');

  const [
    newStageName,
    setNewStageName,
  ] = useState('');

  const [
    stageToDelete,
    setStageToDelete,
  ] = useState<string | null>(null);

  const [
    stageToRename,
    setStageToRename,
  ] = useState<string | null>(null);

  const [
    renameStageValue,
    setRenameStageValue,
  ] = useState('');

  // Checklist par étape (Immosphera / Pipeline Transactions V2) — voir
  // TransactionChecklistModal.tsx.
  const [checklistDeal, setChecklistDeal] = useState<Deal | null>(null);

  const canManageStructure = !!currentUser && userProfile?.role === 'super_admin';

  // Cloisonnement par utilisateur (Immosphera, demande explicite du 16
  // septembre) : un admin (pas seulement super admin, contrairement à
  // canManageStructure ci-dessus, réservé à la structure des colonnes) voit
  // tous les dossiers de l'agence dans chaque pipeline ; les autres ne
  // voient que les leurs. Voir la policy RLS "leads: lecture par les
  // membres de l'agence" (migration 20260916150000) : ceci reflète côté
  // UI ce que Supabase filtre déjà réellement côté serveur.
  const estAdminVueDossiers = canManageStructure || userProfile?.role === 'admin';

  // Chacun ne renomme et ne supprime que son pipeline (officiel ou verrouillé
  // : non). Pipelines Transactions est à part : titres et colonnes pour
  // Mélanie et Sylvain seulement, suppression interdite à tous. Le détail
  // est dans src/lib/pipelinesAcces.ts, et la suppression réelle dans
  // api/admin/announcements.ts.
  const utilisateurAcces = { uid: currentUser?.uid, email: currentUser?.email };
  const versDroit = (pipeline?: StoredPipeline | null): PipelinePourAcces | null =>
    pipeline
      ? {
          id: pipeline.id,
          name: pipeline.name,
          agencyId: pipeline.agencyId,
          ownerId: pipeline.proprietaire,
          officiel: pipeline.officiel,
          verrouille: pipeline.verrouille,
        }
      : null;
  // Titres : le créateur sur son pipeline, Mélanie et Sylvain sur Transactions.
  // La suppression est la même règle, sauf Transactions que personne n'enlève.
  const peutRenommerOuSupprimerPipeline = (pipeline?: StoredPipeline | null) =>
    peutRenommerPipeline(versDroit(pipeline), utilisateurAcces, canManageStructure);
  const peutSupprimerCePipeline = (pipeline?: StoredPipeline | null) =>
    peutSupprimerPipeline(versDroit(pipeline), utilisateurAcces, canManageStructure);
  const peutGererLesColonnes = (pipeline?: StoredPipeline | null) =>
    peutGererColonnes(versDroit(pipeline), utilisateurAcces, canManageStructure);

  // Ticket #219 : le Pipeline était volontairement verrouillé sur Conseils
  // Finances ("temporaire", cf. historique) — toutes les autres agences
  // affichaient donc silencieusement les pipelines de Conseils Finances au
  // lieu des leurs, et un déplacement de dossier y écrivait par erreur.
  // On utilise désormais la véritable agence active du sélecteur, comme le
  // reste de l'application (`activeAgency` déjà utilisé plus bas dans ce
  // fichier pour `agencyDeals`/la répartition par colonne).
  const currentAgencyId = activeAgency.id;

  const currentAgency =
    AGENCIES.find(
      (agency) =>
        agency.id === currentAgencyId
    );

  const activePipeline =
    pipelines.find(
      (pipeline) =>
        pipeline.id ===
        activePipelineId
    ) ||
    pipelines[0];

  // Pipeline par défaut choisi par l'utilisateur, par agence — restauré à
  // chaque ouverture de l'onglet Pipeline au lieu du premier de la liste.
  //
  // Signalé : « quand on met par défaut, souvent cela ne s'enregistre pas ».
  // Ça s'enregistrait en réalité toujours — mais uniquement dans le
  // localStorage du NAVIGATEUR (novasphere_default_pipeline_<uid>_<agencyId>)
  // : jamais restauré sur un autre appareil/navigateur, perdu en navigation
  // privée ou si les données du site sont effacées — vécu comme « ça ne
  // s'enregistre pas ». Même cause, même remède que les tuiles masquées de
  // l'accueil (migration 20260902210000) : la préférence rejoint les
  // réglages du compte (user_ui_settings.default_pipelines), en
  // dictionnaire par agence — peuplé dans loadPipelines() ci-dessous (pas
  // un effet séparé : les deux chargements sont asynchrones et rien ne
  // garantit qu'un effet à part ait fini avant que loadPipelines() n'en ait
  // besoin pour choisir le pipeline à restaurer).
  const [defaultPipelinesByAgency, setDefaultPipelinesByAgency] = useState<Record<string, string>>({});
  const defaultPipelineId = defaultPipelinesByAgency[currentAgencyId] ?? null;

  // Ticket #105 : colonne visée depuis le tableau de bord — surbrillance
  // temporaire le temps que l'utilisateur la repère, puis s'efface seule.
  const [justArrivedStage, setJustArrivedStage] = useState<string | null>(null);

  // Ticket #114/#116 (suivi) : glisser-déposer @dnd-kit — mêmes réglages de
  // capteurs que les tuiles de l'accueil (distance de 8px avant activation à
  // la souris, léger délai au toucher pour ne pas voler le scroll tactile).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );
  const [activeDragDeal, setActiveDragDeal] = useState<Deal | null>(null);

  useEffect(() => {
    if (!initialStage || !activePipeline) return;
    if (!activePipeline.stages.includes(initialStage)) return;
    const el = document.getElementById(`pipeline-stage-${initialStage}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      setJustArrivedStage(initialStage);
      const timer = setTimeout(() => setJustArrivedStage(null), 2500);
      onInitialStageHandled?.();
      return () => clearTimeout(timer);
    }
    onInitialStageHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStage, activePipeline]);

  const isActivePipelineDefault = !!activePipeline && defaultPipelineId === activePipeline.id;

  const setPipelineAsDefault = async () => {
    if (!currentUser || !activePipeline) return;
    const precedent = defaultPipelinesByAgency;
    // Optimiste : affiché tout de suite, annulé si l'écriture échoue.
    setDefaultPipelinesByAgency((prev) => ({ ...prev, [currentAgencyId]: activePipeline.id }));
    const { data: existing } = await supabase
      .from('user_ui_settings')
      .select('default_pipelines')
      .eq('user_id', currentUser.uid)
      .maybeSingle();
    const base = (existing as { default_pipelines?: Record<string, string> } | null)?.default_pipelines;
    const merge = { ...(base && typeof base === 'object' ? base : {}), [currentAgencyId]: activePipeline.id };
    const { error } = await supabase
      .from('user_ui_settings')
      .upsert({ user_id: currentUser.uid, default_pipelines: merge } as any, { onConflict: 'user_id' });
    if (error) {
      setDefaultPipelinesByAgency(precedent);
      toast.error(`Pipeline par défaut non enregistré : ${error.message}`);
    }
  };

  // On filtre `allDeals` (NON scopé par l'agence active du sélecteur en
  // haut à gauche), pas `deals` : `deals` est déjà filtré par
  // `activeAgency` via useDeals(), donc filtrer une seconde fois sur
  // Conseils Finances ne donnait un résultat non-vide QUE si le sélecteur
  // pointait déjà sur Conseils Finances — dès qu'on changeait d'agence
  // ailleurs dans l'app, le Pipeline (censé être verrouillé sur Conseils
  // Finances, cf. currentAgencyId ci-dessus) se vidait silencieusement, et
  // ses chiffres décrochaient de ceux du Tableau de bord.
  const agencyDeals =
    useMemo(() => {
      if (
        currentAgencyId === 'all'
      ) {
        return [];
      }

      // Ticket #107 : `allDeals` (par design, cf. commentaire ci-dessus)
      // n'exclut pas les dossiers archivés comme le fait `deals` — sans ce
      // `!deal.archivedAt`, un client archivé réapparaissait dans le
      // pipeline dès qu'on changeait d'agence.
      const base = allDeals.filter(
        (deal) =>
          deal.agencyId ===
          currentAgencyId &&
          !deal.archivedAt
      );

      // Cloisonnement par utilisateur (16 septembre, Immosphera) : chaque
      // pipeline est désormais cloisonné par utilisateur (les admins
      // voient tout), SAUF Pipeline Transactions V2, laissé pour
      // l'instant visible de tous. Ce n'est plus un filtre client — c'est
      // la policy RLS "leads: lecture par les membres de l'agence" qui ne
      // renvoie déjà que les bonnes lignes (voir migration
      // 20260916150000_leads_immosphera_pipeline_siloing) : `base` ne
      // contient donc déjà que ce que l'utilisateur a le droit de voir,
      // aucun filtre supplémentaire n'est nécessaire ici.
      //
      // Précédemment (7 septembre) c'était l'inverse — Transactions V2
      // seule restreinte, filtrée côté client — remplacé par ce qui
      // précède.
      return base;
    }, [
      allDeals,
      currentAgencyId,
      activePipeline?.id,
      canManageStructure,
      currentUser?.uid,
    ]);

  // Ticket #114 : chaque colonne refaisait `agencyDeals.filter(...)` sur
  // TOUTE la liste à CHAQUE rendu (donc à chaque frame pendant un
  // glisser-déposer, hello-pangea-dnd re-rendant tout le plateau en
  // continu) — avec beaucoup de dossiers, ce O(colonnes × dossiers) répété
  // en boucle est ce qui donnait l'impression de lenteur/blocages. Un seul
  // regroupement mémoïsé, recalculé seulement quand `agencyDeals` change.
  const dealsByStage = useMemo(() => {
    const map = new Map<string, typeof agencyDeals>();
    if (!activePipeline) return map;
    // Filet de sécurité posé après l'incident du 1er septembre : une affaire
    // dont le nom d'étape ne correspond à AUCUNE colonne du pipeline
    // n'apparaissait nulle part — elle semblait supprimée alors qu'elle était
    // bien en base. Elle est désormais rangée dans la première colonne, où on
    // peut la voir et la remettre à sa place. Mieux vaut une carte au mauvais
    // endroit qu'une carte introuvable.
    const colonnes = new Set(activePipeline.stages);
    const premiere = activePipeline.stages[0];
    agencyDeals.forEach((deal) => {
      if ((deal.pipelineId || activePipeline.id) !== activePipeline.id) return;
      const colonne = colonnes.has(deal.stage) ? deal.stage : premiere;
      if (!colonne) return;
      const existing = map.get(colonne);
      if (existing) existing.push(deal);
      else map.set(colonne, [deal]);
    });
    return map;
  }, [agencyDeals, activePipeline]);
  const EMPTY_DEALS: typeof agencyDeals = [];

  /*
   * =====================================================
   * CONFIGURATION PIPELINE PAR SOCIÉTÉ
   * =====================================================
   *
   * Collection :
   * pipeline_configs/{agencyId}__{pipelineId}
   *
   * Chaque société possède sa propre copie de configuration.
   * Au premier démarrage, les 3 sociétés reçoivent la même
   * structure de base, mais elles évoluent indépendamment.
   */
  useEffect(() => {
    if (!currentUser) {
      setPipelines([]);
      setLoading(false);
      return;
    }

    if (currentAgencyId === 'all') {
      setPipelines([]);
      setActivePipelineId('');
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const loadPipelines = async () => {
      try {
        const { data: rawPipes, error: pipeErr } = await supabase
          .from('pipelines')
          .select('*')
          .eq('agency_id', currentAgencyId);

        if (pipeErr) throw pipeErr;

        let pipeList = rawPipes ? [...rawPipes] : [];

        if (pipeList.length === 0 && canManageStructure) {
          const now = new Date().toISOString();
          for (let i = 0; i < BASE_PIPELINES.length; i++) {
            const basePipe = BASE_PIPELINES[i];
            const { data: newPipe } = await supabase
              .from('pipelines')
              .insert({
                agency_id: currentAgencyId,
                name: basePipe.name,
                is_default: i === 0,
                created_at: now,
              })
              .select()
              .single();

            if (newPipe) {
              pipeList.push(newPipe);
              const stageInserts = basePipe.stages.map((stageName, pos) => ({
                agency_id: currentAgencyId,
                pipeline_id: newPipe.id,
                name: stageName,
                position: pos,
                created_at: now,
              }));
              await supabase.from('pipeline_stages').insert(stageInserts);
            }
          }
        }

        // Demande explicite : certains utilisateurs ne doivent avoir accès
        // qu'à un sous-ensemble des pipelines de leur agence (ex. Isabelle →
        // uniquement "Pipeline Transactions V2"). Table déjà prévue en base
        // pour ça (user_pipeline_hidden) mais jamais exploitée côté front
        // jusqu'ici — appliquée ici en excluant les pipelines que CET
        // utilisateur a explicitement en liste masquée.
        const { data: hiddenRows } = await supabase
          .from('user_pipeline_hidden')
          .select('pipeline_id')
          .eq('user_id', currentUser.uid);
        const hiddenPipelineIds = new Set((hiddenRows || []).map((r: any) => r.pipeline_id));
        const utilisateur = { uid: currentUser.uid, email: currentUser.email };
        // Pipelines de la société (sans propriétaire, ou officiels) : tout
        // le monde. Pipeline personnel : seulement son créateur. Transactions
        // reste visible chez Immosphera sauf Sarah, et un masque personnel
        // ne peut pas le cacher.
        pipeList = pipeList.filter((p: any) => {
          const fiche = {
            id: p.id as string,
            name: p.name as string,
            agencyId: p.agency_id as string,
            ownerId: (p.owner_id as string | null) ?? null,
            officiel: Boolean(p.is_default),
          };
          if (!estPipelineTransactions(fiche) && hiddenPipelineIds.has(p.id)) return false;
          return pipelineVisiblePour(fiche, utilisateur);
        });

        const pipeIds = pipeList.map((p) => p.id);
        const { data: stagesData } = pipeIds.length
          ? await supabase
              .from('pipeline_stages')
              .select('*')
              .in('pipeline_id', pipeIds)
              .order('position', { ascending: true })
          : { data: [] };

        const loadedPipelines: StoredPipeline[] = pipeList.map((p) => {
          const pStages = (stagesData || [])
            .filter((s) => s.pipeline_id === p.id)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .map((s) => s.name);

          return {
            id: p.id,
            name: p.name,
            agencyId: p.agency_id,
            stages: pStages.length > 0 ? pStages : [...BASE_PIPELINES[0].stages],
            officiel: Boolean(p.is_default),
            verrouille: Boolean((p as { locked?: boolean }).locked),
            proprietaire: ((p as { owner_id?: string | null }).owner_id) ?? null,
            sortOrder: p.is_default ? 0 : 1,
            createdAt: p.created_at,
          };
        });

        // Pipeline par défaut : serveur d'abord (voir le commentaire détaillé
        // sur defaultPipelinesByAgency plus haut), repli sur l'ancienne clé
        // localStorage pour ne pas perdre un choix déjà fait avant ce
        // correctif — migré vers le serveur dès qu'il sert une fois ici.
        const { data: uiSettings } = await supabase
          .from('user_ui_settings')
          .select('default_pipelines')
          .eq('user_id', currentUser.uid)
          .maybeSingle();
        const dictServeur = (uiSettings as { default_pipelines?: Record<string, string> } | null)?.default_pipelines;
        const dict = dictServeur && typeof dictServeur === 'object' ? dictServeur : {};
        if (isMounted) setDefaultPipelinesByAgency(dict);

        if (isMounted) {
          setPipelines(loadedPipelines);
          if (loadedPipelines.length > 0) {
            const legacyDefaultId = localStorage.getItem(`novasphere_default_pipeline_${currentUser.uid}_${currentAgencyId}`);
            const candidatId = dict[currentAgencyId] || legacyDefaultId;
            const preferredId =
              candidatId && loadedPipelines.some((lp) => lp.id === candidatId)
                ? candidatId
                : loadedPipelines[0].id;

            // Ancienne préférence trouvée uniquement en localStorage : migrée
            // vers le compte pour de bon, sans attendre que l'utilisateur
            // reclique sur l'étoile.
            if (!dict[currentAgencyId] && legacyDefaultId && loadedPipelines.some((lp) => lp.id === legacyDefaultId)) {
              const migre = { ...dict, [currentAgencyId]: legacyDefaultId };
              setDefaultPipelinesByAgency(migre);
              void supabase
                .from('user_ui_settings')
                .upsert({ user_id: currentUser.uid, default_pipelines: migre } as any, { onConflict: 'user_id' });
            }

            setActivePipelineId((prev) =>
              loadedPipelines.some((lp) => lp.id === prev) ? prev : preferredId
            );
          }
        }
      } catch (snapshotError) {
        console.error(snapshotError);
        if (isMounted) setError("Impossible de charger le pipeline de cette société depuis Supabase.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPipelines();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.uid, currentAgencyId, canManageStructure]);

  const updatePipelineConfig = async (
    pipelineId: string,
    updates: Partial<Pick<StoredPipeline, 'name' | 'stages' | 'sortOrder'>>,
    // Demande explicite (23 septembre) : « qu'un courtier puisse modifier le
    // nom des colonnes de son pipeline qu'il aura créé ». Ajouter, supprimer
    // ou réordonner des colonnes reste réservé aux super admins (une colonne
    // supprimée déplace tous les dossiers qui s'y trouvent, un ajout/
    // réordonnancement touche tout le monde sur ce pipeline) — mais
    // RENOMMER une colonne ne fait que changer une étiquette, exactement
    // comme renommer le pipeline lui-même : même droit que
    // `peutRenommerOuSupprimerPipeline` (le propriétaire d'un pipeline non
    // officiel/verrouillé, ou un super admin). `onlyRename` distingue ce cas
    // précis des trois autres, qui continuent à passer par `updates.stages`
    // sans ce marqueur.
    { onlyRename = false }: { onlyRename?: boolean } = {}
  ) => {
    // Le renommage suit la règle « sauf les pipelines officiels » ; ce qui
    // touche à la STRUCTURE des colonnes (ajout, suppression, réordre)
    // reste réservé aux super admins.
    const cible = pipelines.find((p) => p.id === pipelineId);
    const droit = versDroit(cible);
    const structure = Boolean(updates.stages && !onlyRename);
    const transactions = estPipelineTransactions(droit || { id: pipelineId, agencyId: currentAgencyId });
    const droitRequis = structure
      ? peutGererColonnes(droit, utilisateurAcces, canManageStructure)
      : peutRenommerPipeline(droit, utilisateurAcces, canManageStructure);
    if (!droitRequis) {
      setError(
        structure
          ? transactions
            ? 'Seul Mélanie ou Sylvain peut ajouter, supprimer ou déplacer les colonnes du pipeline Transactions.'
            : "Seul un super admin peut ajouter, supprimer ou réordonner les colonnes d'un pipeline."
          : transactions
            ? 'Seul Mélanie ou Sylvain peut modifier les titres du pipeline Transactions.'
            : updates.stages
              ? 'Seul le créateur de ce pipeline (ou un super admin) peut renommer ses colonnes.'
              : 'Seul le créateur de ce pipeline (ou un super admin) peut le renommer.'
      );
      throw new Error('Accès refusé');
    }

    if (updates.name) {
      // Même piège que la suppression des fiches : si la sécurité de la base
      // refuse la modification, PostgREST ne renvoie pas d'erreur — zéro
      // ligne est simplement modifiée. On redemande donc la ligne pour ne
      // pas annoncer un renommage qui n'a pas eu lieu.
      const { data: modifiees, error: err } = await supabase
        .from('pipelines')
        .update({ name: updates.name })
        .eq('id', pipelineId)
        .select('id');
      if (err) throw err;
      if (!modifiees || modifiees.length === 0) {
        throw new Error(
          "Renommage refusé par la base de données : votre compte n'a pas le droit de modifier ce pipeline. Un super admin doit ouvrir ce droit."
        );
      }
    }

    if (updates.stages) {
      // INCIDENT DU 30/08/2026 — « j'ai créé une colonne Location validée et
      // cela m'a effacé tout ce qu'il y avait dans les autres colonnes ».
      //
      // Ce bloc faisait un DELETE de toutes les étapes du pipeline suivi d'un
      // INSERT complet. Les étapes étaient donc recréées avec de NOUVEAUX
      // identifiants, et les dossiers, qui pointent sur `stage_id`, perdaient
      // leur position — 21 dossiers détachés d'un coup ce soir-là, sur la
      // simple AJOUT d'une colonne. Le même code s'exécutait à chaque
      // renommage ou réorganisation d'étape, sur tous les pipelines.
      //
      // On ne détruit plus rien : les étapes conservées gardent leur ligne
      // (donc leur identifiant, donc les dossiers qui s'y trouvent), seules
      // les étapes réellement retirées sont supprimées, et seules les
      // nouvelles sont créées.
      const { data: existing } = await supabase
        .from('pipeline_stages')
        .select('id, name, position')
        .eq('pipeline_id', pipelineId);

      const normalize = (value: string) => value.trim().toLowerCase();
      const remaining = [...(existing || [])];
      const wanted = updates.stages;

      // Rapprochement par nom : c'est le seul lien stable entre la liste
      // affichée (des chaînes) et les lignes en base.
      const matched = new Map<number, { id: string; name: string }>();
      wanted.forEach((stageName, idx) => {
        const hit = remaining.findIndex((row) => normalize(row.name) === normalize(stageName));
        if (hit !== -1) {
          matched.set(idx, remaining[hit] as { id: string; name: string });
          remaining.splice(hit, 1);
        }
      });

      // Une étape non retrouvée par son nom, alors qu'il reste des lignes
      // orphelines, est très probablement un RENOMMAGE : on réutilise la
      // ligne plutôt que d'en créer une neuve, ce qui garderait les dossiers
      // sur l'ancien nom.
      wanted.forEach((stageName, idx) => {
        if (matched.has(idx) || remaining.length === 0) return;
        const reused = remaining.shift() as { id: string; name: string };
        matched.set(idx, reused);
      });

      const toUpdate = wanted
        .map((stageName, idx) => ({ stageName, idx, row: matched.get(idx) }))
        .filter((entry) => entry.row);
      const toInsert = wanted
        .map((stageName, idx) => ({ stageName, idx }))
        .filter((entry) => !matched.has(entry.idx));

      for (const entry of toUpdate) {
        const { error: upErr } = await supabase
          .from('pipeline_stages')
          .update({ name: entry.stageName, position: entry.idx })
          .eq('id', (entry.row as { id: string }).id);
        if (upErr) throw upErr;
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('pipeline_stages').insert(
          toInsert.map((entry) => ({
            agency_id: currentAgencyId,
            pipeline_id: pipelineId,
            name: entry.stageName,
            position: entry.idx,
          }))
        );
        if (insErr) throw insErr;
      }

      // Ce qui reste après appariement a réellement été retiré de la liste.
      for (const leftover of remaining) {
        const { error: delErr } = await supabase
          .from('pipeline_stages')
          .delete()
          .eq('id', (leftover as { id: string }).id);
        if (delErr) throw delErr;
      }
    }

    // INCIDENT DU 1er SEPTEMBRE — « il y a deux fiches clients que j'ai mises
    // dans À facturer et elles ont disparu ».
    //
    // Rien n'était supprimé : les affaires devenaient INVISIBLES. Le
    // dictionnaire « identifiant d'étape -> nom » vit dans useDeals sous la
    // clé ['pipeline-stages-all'], et RIEN ne l'invalidait quand une étape
    // était créée. Une affaire déplacée dans l'étape neuve portait donc un
    // stage_id que ce dictionnaire ne connaissait pas : son nom d'étape
    // retombait sur la température (« chaud »...) ou sur « Nouveau », et
    // comme aucune colonne ne porte ce nom, elle n'était affichée nulle part.
    // Un rechargement complet de la page la faisait réapparaître — ce qui
    // désignait le cache, pas la base.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pipeline-stages-all'] }),
      queryClient.invalidateQueries({ queryKey: ['pipeline-stages-positions'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-pipelines'] }),
      queryClient.invalidateQueries({ queryKey: ['deals'] }),
    ]);
  };

  const handleCreatePipeline = async (event: React.FormEvent) => {
    event.preventDefault();

    // Demande explicite (7 septembre) : « je veux aussi qu'ils puissent
    // créer leur propre pipeline » — ouvert à tout utilisateur connecté,
    // plus seulement au super admin. `owner_id` (ci-dessous) reste posé sur
    // le créateur, ce qui le rend visible seulement à lui (et à
    // l'administrateur) dans le menu déroulant — voir le filtre plus haut.
    if (!currentUser || !newPipelineName.trim() || currentAgencyId === 'all') {
      return;
    }

    const name = newPipelineName.trim();

    if (isGenericPipelineName(name)) {
      setError('Choisissez un nom qui décrit vraiment ce pipeline (pas « Mon Pipeline » ou « Nouveau pipeline »).');
      return;
    }

    const now = new Date().toISOString();

    try {
      setError(null);
      const { data: createdPipe, error: pipeErr } = await supabase
        .from('pipelines')
        .insert({
          agency_id: currentAgencyId,
          name,
          is_default: false,
          created_at: now,
          // Sans propriétaire, personne ne peut « modifier son pipeline » :
          // la colonne existait mais n'était jamais renseignée.
          owner_id: toValidUuidOrNull(currentUser?.uid || '') ,
        })
        .select()
        .single();

      if (pipeErr || !createdPipe) throw pipeErr || new Error('Erreur création pipeline');

      const initialStages = [...BASE_PIPELINES[0].stages];
      const stageInserts = initialStages.map((stageName, idx) => ({
        agency_id: currentAgencyId,
        pipeline_id: createdPipe.id,
        name: stageName,
        position: idx,
        created_at: now,
      }));

      await supabase.from('pipeline_stages').insert(stageInserts);

      const newPipeObj: StoredPipeline = {
        id: createdPipe.id,
        agencyId: currentAgencyId,
        name,
        stages: initialStages,
        // Un pipeline fraîchement créé n'est jamais celui de référence.
        officiel: false,
        verrouille: false,
        proprietaire: currentUser?.uid ?? null,
        sortOrder: pipelines.length,
        createdAt: now,
      };

      setPipelines((prev) => [...prev, newPipeObj]);
      setActivePipelineId(createdPipe.id);
      setNewPipelineName('');
      setShowCreatePipelineModal(false);
      setSuccess('Pipeline créé pour cette société dans Supabase.');
    } catch (createError: any) {
      console.error(createError);
      setError('Impossible de créer le pipeline.');
    }
  };

  const handleRenamePipeline = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!activePipeline || !renamePipelineTitle.trim()) {
      return;
    }

    const newName = renamePipelineTitle.trim();

    if (isGenericPipelineName(newName)) {
      setError('Choisissez un nom qui décrit vraiment ce pipeline (pas « Mon Pipeline » ou « Nouveau pipeline »).');
      return;
    }

    try {
      setError(null);
      await updatePipelineConfig(activePipeline.id, {
        name: newName,
      });

      setPipelines((prev) =>
        prev.map((p) => (p.id === activePipeline.id ? { ...p, name: newName } : p))
      );

      setShowRenamePipelineModal(false);
      setSuccess('Pipeline renommé pour cette société.');
    } catch (renameError: any) {
      console.error(renameError);
      setError(renameError?.message || 'Impossible de renommer le pipeline.');
    }
  };

  // « Peut-être trouver une solution que je peux verrouiller des pipelines
  // quand elles sont créées » : un super admin fige n'importe quel pipeline,
  // y compris celui créé par quelqu'un d'autre. Le pipeline officiel de la
  // société (marqué par défaut) est protégé sans avoir à être verrouillé.
  const basculerVerrouPipeline = async () => {
    if (!canManageStructure || !activePipeline) return;
    if (estPipelineTransactions(versDroit(activePipeline)!)) {
      setError('Le pipeline Transactions reste verrouillé. Seuls Mélanie et Sylvain en modifient les titres et les colonnes.');
      return;
    }
    setError(null);
    const suivant = !activePipeline.verrouille;
    try {
      const { data: modifiees, error: majErr } = await supabase
        .from('pipelines')
        .update({ locked: suivant } as any)
        .eq('id', activePipeline.id)
        .select('id');
      if (majErr) throw majErr;
      if (!modifiees || modifiees.length === 0) {
        throw new Error(
          "Verrouillage refusé par la base de données. La colonne « locked » existe-t-elle bien (migration 20260902140000) ?"
        );
      }
      setPipelines((prev) =>
        prev.map((p) => (p.id === activePipeline.id ? { ...p, verrouille: suivant } : p))
      );
      setSuccess(
        suivant
          ? `« ${activePipeline.name} » est verrouillé : seuls les super admins peuvent le renommer ou le supprimer.`
          : `« ${activePipeline.name} » est déverrouillé.`
      );
    } catch (verrouError: any) {
      console.error(verrouError);
      setError(verrouError?.message || 'Impossible de changer le verrou de ce pipeline.');
    }
  };

  const handleDeletePipeline = async () => {
    if (!activePipeline || !peutSupprimerCePipeline(activePipeline)) {
      return;
    }

    // Le serveur refuse encore de supprimer le dernier pipeline de la
    // société. Ici on ne bloque plus sur « le dernier que je vois » : les
    // autres peuvent appartenir à d'autres personnes. Les contacts ne sont
    // pas déplacés vers un pipeline de repli.

    // Ticket #231 (v3) : la suppression directe côté client
    // (`supabase.from('pipelines').delete()`) était bloquée en silence par
    // les policies RLS pour certains pipelines/agences — l'interface
    // annonçait "supprimé" alors que rien n'avait réellement disparu en
    // base. On passe désormais par une route serveur dédiée
    // (/api/admin/announcements?resource=pipeline, clé service_role) qui
    // garantit la suppression réelle ET retire les contacts de ce pipeline
    // sans les poser dans un autre. Le second `window.confirm()` natif
    // qui pouvait rester invisible par-dessus la fenêtre déjà affichée a
    // aussi été retiré : le nombre d'affaires concernées est annoncé
    // directement dans la fenêtre de confirmation de l'application.

    try {
      if (!currentUser) throw new Error('Utilisateur non authentifié.');
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `/api/admin/announcements?resource=pipeline&id=${encodeURIComponent(activePipeline.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || `Erreur HTTP ${response.status}`);
      }

      const reste = pipelines.filter((p) => p.id !== activePipeline.id);
      setPipelines(reste);
      setActivePipelineId(reste[0]?.id || '');
      setShowDeletePipelineModal(false);
      setSuccess('Pipeline supprimé. Les contacts sont restés dans la fiche des contacts.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    } catch (deleteError: any) {
      console.error(deleteError);
      setError(deleteError?.message || 'Impossible de supprimer le pipeline.');
    }
  };

  const handleAddStage =
    async (
      event: React.FormEvent
    ) => {
      event.preventDefault();

      if (
        !activePipeline ||
        !newStageName.trim()
      ) {
        return;
      }

      const name =
        newStageName.trim();

      if (
        activePipeline.stages.includes(
          name
        )
      ) {
        setError(
          'Cette colonne existe déjà.'
        );
        return;
      }

      try {
        await updatePipelineConfig(
          activePipeline.id,
          {
            stages: [
              ...activePipeline.stages,
              name,
            ],
          }
        );

        // Signalé le 2 septembre : « quand je crée une colonne dans un
        // pipeline, elle ne s'affiche pas instantanément, je dois faire un
        // hard refresh ». Les colonnes affichées viennent de l'état local
        // `pipelines`, chargé une seule fois au montage : l'écriture en base
        // réussissait, mais rien ne le disait à l'écran. Le renommage, lui,
        // mettait déjà cet état à jour — l'ajout et la suppression non.
        setPipelines((prev) =>
          prev.map((p) =>
            p.id === activePipeline.id ? { ...p, stages: [...p.stages, name] } : p
          )
        );

        setNewStageName('');
        setShowAddStageModal(
          false
        );

        setSuccess(
          'Colonne ajoutée à cette société.'
        );
      } catch (
        addStageError
      ) {
        console.error(
          addStageError
        );
      }
    };

  const handleRenameStage =
    async (
      event: React.FormEvent
    ) => {
      event.preventDefault();

      if (
        !activePipeline ||
        !stageToRename ||
        !renameStageValue.trim()
      ) {
        return;
      }

      const newName = renameStageValue.trim();

      try {
        setError(null);
        const updatedStages = activePipeline.stages.map((stage) =>
          stage === stageToRename ? newName : stage
        );

        await updatePipelineConfig(
          activePipeline.id,
          { stages: updatedStages },
          { onlyRename: true }
        );

        setPipelines((prev) =>
          prev.map((p) =>
            p.id === activePipeline.id ? { ...p, stages: updatedStages } : p
          )
        );

        const affectedDeals =
          agencyDeals.filter(
            (deal) =>
              deal.pipelineId ===
                activePipeline.id &&
              deal.stage ===
                stageToRename
          );

        for (const deal of affectedDeals) {
          await updateDeal.mutateAsync({
            id:
              deal.id,

            updates: {
              stage:
                newName,
            },
          });
        }

        setStageToRename(
          null
        );

        setRenameStageValue(
          ''
        );

        setSuccess(
          'Colonne renommée pour cette société.'
        );
      } catch (
        renameStageError
      ) {
        console.error(
          renameStageError
        );

        setError(
          'Impossible de renommer la colonne.'
        );
      }
    };

  const handleDeleteStage =
    async () => {
      if (
        !activePipeline ||
        !stageToDelete ||
        !canManageStructure
      ) {
        return;
      }

      if (
        activePipeline.stages
          .length <= 1
      ) {
        setError(
          'Il faut conserver au moins une colonne.'
        );
        return;
      }

      const fallbackStage =
        activePipeline.stages.find(
          (stage) =>
            stage !==
            stageToDelete
        );

      if (!fallbackStage) {
        return;
      }

      const affectedDeals =
        agencyDeals.filter(
          (deal) =>
            deal.pipelineId ===
              activePipeline.id &&
            deal.stage ===
              stageToDelete
        );

      const confirmed =
        affectedDeals.length ===
        0 ||
        window.confirm(
          `${affectedDeals.length} affaire(s) seront déplacées vers "${fallbackStage}". Continuer ?`
        );

      if (!confirmed) {
        return;
      }

      try {
        for (const deal of affectedDeals) {
          await updateDeal.mutateAsync({
            id:
              deal.id,

            updates: {
              stage:
                fallbackStage,
            },
          });
        }

        await updatePipelineConfig(
          activePipeline.id,
          {
            stages:
              activePipeline.stages.filter(
                (stage) =>
                  stage !==
                  stageToDelete
              ),
          }
        );

        // Même correctif que pour l'ajout ci-dessus : sans cette ligne, la
        // colonne supprimée restait affichée jusqu'au rechargement.
        setPipelines((prev) =>
          prev.map((p) =>
            p.id === activePipeline.id
              ? { ...p, stages: p.stages.filter((stage) => stage !== stageToDelete) }
              : p
          )
        );

        setStageToDelete(
          null
        );

        setSuccess(
          'Colonne supprimée pour cette société.'
        );
      } catch (
        deleteStageError
      ) {
        console.error(
          deleteStageError
        );

        setError(
          'Impossible de supprimer la colonne.'
        );
      }
    };

  // Signalé (3 septembre, pipeline Immosphera) : « le drag and drop n'est
  // pas bon quand on veut basculer sur la colonne de gauche Récolte docs,
  // c'est presque impossible ». Cause : `closestCenter` compare la carte au
  // CENTRE de chaque zone de dépôt. Une colonne de 26 dossiers a son centre
  // très bas ; une carte lâchée en haut de cette colonne est plus proche du
  // centre de la petite colonne voisine (180 px de haut), qui gagne. On
  // regarde d'abord la zone SOUS le pointeur, puis celle que la carte
  // recouvre, et seulement en dernier recours la plus proche. Les colonnes
  // (réordonnancement) gardent la règle du centre le plus proche.
  const detecterColonneDeDepot: CollisionDetection = (args) => {
    const type = args.active.data.current?.type;
    if (type === 'card') {
      const zones = args.droppableContainers.filter((c) => c.data.current?.type === 'dropzone');
      const sousPointeur = pointerWithin({ ...args, droppableContainers: zones });
      if (sousPointeur.length) return sousPointeur;
      const recouvertes = rectIntersection({ ...args, droppableContainers: zones });
      if (recouvertes.length) return recouvertes;
      return closestCenter({ ...args, droppableContainers: zones });
    }
    const colonnes = args.droppableContainers.filter((c) => c.data.current?.type === 'column');
    return closestCenter({ ...args, droppableContainers: colonnes.length ? colonnes : args.droppableContainers });
  };

  // Ticket #114/#116 (suivi) : `over.id` peut être soit la zone de dépôt
  // d'une colonne (`dropzone-<stage>`, visée en lâchant une carte), soit
  // directement le nom d'une étape (visée en lâchant une colonne sur une
  // autre) — on résout les deux vers le même nom d'étape ici.
  const resolveStageFromOverId = (id: string): string | null => {
    if (!activePipeline) return null;
    const idStr = String(id);
    if (idStr.startsWith('dropzone-')) {
      const stage = idStr.slice('dropzone-'.length);
      return activePipeline.stages.includes(stage) ? stage : null;
    }
    return activePipeline.stages.includes(idStr) ? idStr : null;
  };

  const handlePipelineDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'card') {
      const deal = agencyDeals.find((d) => d.id === String(event.active.id));
      setActiveDragDeal(deal || null);
    }
  };

  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : "quand un
  // client change d'étape avec automatisation, propose 'Oui, préparer
  // l'email' / 'Non' — jamais d'envoi silencieux". Confirmation manuelle
  // avant tout, résolue APRÈS le déplacement réel de la carte (jamais avant
  // — la carte doit bouger même si l'utilisateur répond Non).
  const [pendingAutomationPrompt, setPendingAutomationPrompt] = useState<{
    dealId: string;
    dealTitle: string;
    contactEmail: string | null;
    contactName: string;
    subject: string;
    body: string;
  } | null>(null);

  // Demandé le 2 septembre : « quand c'est à facturer, on met le montant ».
  // Le chiffre d'affaires de l'agence se calcule sur la commission agence HT
  // (leads.estimated_value) : c'est au moment où le dossier entre dans
  // « À facturer » qu'on la connaît. Posée APRÈS le déplacement, jamais
  // avant : la carte ne doit pas rester bloquée si on annule.
  const [pendingMontantPrompt, setPendingMontantPrompt] = useState<{
    dealId: string;
    dealTitle: string;
    etape: string;
    // Conciergerie : « ce sera le même système, le TTC sera comptabilisé dans
    // le chiffre d'affaires de l'agence ». Même champ, même circuit — seul
    // l'intitulé change, parce que ce n'est pas une commission HT.
    ttc: boolean;
  } | null>(null);
  const [montantHtSaisi, setMontantHtSaisi] = useState('');
  const [montantHtEnCours, setMontantHtEnCours] = useState(false);

  const estEtapeAFacturer = (nom: string) => {
    const sansAccents = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    // Novavisio facture par « Envoi facture » puis « À régler » : les deux
    // étapes appellent la même question sur le montant.
    return sansAccents.includes('factur') || sansAccents.includes('regler');
  };

  // Novavisio saisit sa commission agence en TTC ; la base conserve le HT,
  // comme le champ « Commission agence » de la fiche client. Les autres
  // agences confirment en HT — on ne touche pas à leur historique.
  const estNovavisio = /novavisio/i.test(activeAgency?.name || '');
  // « Il n'y a pas de hors taxes dans Conseils Finances, c'est que du TTC »
  // (5 septembre) : montant enregistré tel que saisi (comme ici pour les
  // autres agences), mais nommé TTC — honoraires agence.
  const estConseilsFinances = /conseils?\s*finances?/i.test(activeAgency?.name || '');
  const libelleUniteMontant = estNovavisio || estConseilsFinances ? 'TTC' : 'hors taxes';

  const validerMontantHt = async () => {
    if (!pendingMontantPrompt) return;
    // Virgule ou point, au choix — même règle que la modale d'archivage.
    const saisi = montantHtSaisi.trim().replace(',', '.');
    if (saisi === '') { setPendingMontantPrompt(null); return; }
    const montant = Number(saisi);
    if (!Number.isFinite(montant) || montant < 0) {
      toast.error(`Le montant ${libelleUniteMontant} n'est pas un nombre valide.`);
      return;
    }
    setMontantHtEnCours(true);
    try {
      await updateDeal.mutateAsync({
        id: pendingMontantPrompt.dealId,
        updates: { amount: estNovavisio ? Math.round(htDepuisTtc(montant) * 100) / 100 : montant },
      });
      toast.success(
        estConseilsFinances
          ? 'Honoraires agence TTC enregistrés'
          : `Commission agence ${estNovavisio ? 'TTC' : 'HT'} enregistrée`
      );
      setPendingMontantPrompt(null);
    } catch (montantError: any) {
      toast.error(montantError?.message || "Impossible d'enregistrer le montant.");
    } finally {
      setMontantHtEnCours(false);
    }
  };

  // Une relance en attente n'a plus lieu d'être si le dossier a réellement
  // bougé depuis — c'est exactement le signal "il y a eu du mouvement" qui
  // évite une relance inutile.
  const cancelPendingFollowups = (leadId: string) => {
    supabase
      .from('deal_followups' as any)
      .update({ status: 'cancelled' } as any)
      .eq('lead_id', leadId)
      .eq('status', 'pending')
      .then(() => {}, () => {});
  };

  const handlePipelineDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragDeal(null);
    if (!over || !activePipeline) {
      return;
    }

    if (active.data.current?.type === 'card') {
      const dealId = String(active.id);
      const deal = agencyDeals.find((item) => item.id === dealId);
      if (!deal) return;

      const destinationStage = resolveStageFromOverId(String(over.id));
      if (!destinationStage || destinationStage === deal.stage) return;

      await updateDeal.mutateAsync({
        id: deal.id,
        updates: {
          stage: destinationStage,
          pipelineId: activePipeline.id,
        },
      });

      // Relance programmée (voir plus bas, cancelPendingFollowups) : un vrai
      // mouvement vient d'avoir lieu, toute relance en attente sur ce
      // dossier n'a plus lieu d'être.
      const demandeMontant = estEtapeAFacturer(destinationStage);
      if (deal.contactId) {
        cancelPendingFollowups(deal.contactId);
      }
      if (demandeMontant) {
        const fiche = contacts.find((c) => c.id === deal.contactId);
        setMontantHtSaisi(
          deal.amount
            ? String(estNovavisio ? Math.round(ttcDepuisHt(deal.amount) * 100) / 100 : deal.amount)
            : ''
        );
        setPendingMontantPrompt({
          dealId: deal.id,
          dealTitle: deal.title,
          etape: destinationStage,
          ttc: /concierg/i.test(fiche?.clientType || ''),
        });
      }

      // Automatisation éventuelle pour cette étape — jamais bloquant, jamais
      // silencieux : la carte a déjà bougé, on propose juste ensuite.
      // Signalé : "pas de fenêtre qui apparaît" sans la moindre erreur —
      // l'échec de cette vérification était auparavant totalement silencieux
      // (console.warn uniquement, invisible pour l'utilisateur). setError la
      // rend visible pour diagnostiquer si ça se reproduit.
      try {
        const { data: matches, error: automationQueryError } = await supabase
          .from('pipeline_automations' as any)
          .select('*')
          .eq('agency_id', activeAgency.id)
          .eq('stage_name', destinationStage)
          .eq('is_active', true)
          .limit(1);
        if (automationQueryError) throw automationQueryError;
        const automation = (matches as any[])?.[0];
        if (automation) {
          const contact = contacts.find((c) => c.id === deal.contactId);
          const firstName = (contact?.name || '').split(' ')[0] || '';
          const lastName = (contact?.name || '').split(' ').slice(1).join(' ') || '';
          const subject = String(automation.email_subject || '').replace(/\{\{prenom\}\}/gi, firstName).replace(/\{\{nom\}\}/gi, lastName);
          const body = String(automation.email_body || '').replace(/\{\{prenom\}\}/gi, firstName).replace(/\{\{nom\}\}/gi, lastName);
          setPendingAutomationPrompt({
            dealId: deal.id,
            dealTitle: deal.title,
            contactEmail: contact?.email || null,
            contactName: contact?.name || 'ce client',
            subject,
            body,
          });
        }
      } catch (automationErr: any) {
        console.warn('Erreur vérification automatisation pipeline :', automationErr);
        setError(`Vérification automatisation impossible : ${automationErr?.message || automationErr}`);
      }
      return;
    }

    // Colonne (réordonnancement des étapes). Les cartes, elles, restent
    // déplaçables par toute personne qui voit le pipeline.
    if (!peutGererLesColonnes(activePipeline)) {
      setError(
        estPipelineTransactions(versDroit(activePipeline)!)
          ? 'Seul Mélanie ou Sylvain peut déplacer les colonnes du pipeline Transactions.'
          : "Seul un administrateur peut modifier l'ordre des colonnes."
      );
      return;
    }

    const activeStage = String(active.id);
    const targetStage = resolveStageFromOverId(String(over.id));
    if (!targetStage || activeStage === targetStage) return;

    const oldIndex = activePipeline.stages.indexOf(activeStage);
    const newIndex = activePipeline.stages.indexOf(targetStage);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(activePipeline.stages, oldIndex, newIndex);

    try {
      await updatePipelineConfig(activePipeline.id, { stages: reordered });
      setSuccess("Ordre des colonnes modifié pour cette société.");
    } catch (reorderError) {
      console.error(reorderError);
    }
  };

  if (
    activeAgency.id ===
    'all'
  ) {
    return (
      <div className="p-6 text-white">
        <div className="p-8 rounded-2xl bg-white/5 border border-white/10">
          <h2 className="text-lg font-bold">
            Pipeline
          </h2>

          <p className="text-sm text-gray-400 mt-2">
            Sélectionnez Conseils Finances, NovaVisio ou ImmoSphera pour afficher son pipeline indépendant.
          </p>
        </div>
      </div>
    );
  }

  if (
    loading
  ) {
    return (
      <div className="p-12 text-center text-gray-400">
        Chargement du pipeline de {currentAgency?.name || 'la société'}...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 text-white">
      {/* Signalé (30/08/2026) : bandeau d'en-tête Pipeline avec le design unifié Noir & Or / Novavisio */}
      <div className="relative nv-card-hero rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 overflow-hidden backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F] to-transparent opacity-85" />
        <div className="relative z-10">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Pipeline</span>
            <span className="text-[#F7BC5F]/70 font-light">·</span>
            <span className="text-white/90">{currentAgency?.name}</span>
          </h1>

          <p className="text-xs text-slate-400 mt-1">
            Configuration et flux d'affaires de cette société.
          </p>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-2">
          <select
            value={
              activePipelineId
            }
            onChange={(
              event
            ) =>
              setActivePipelineId(
                event.target.value
              )
            }
            className="px-3.5 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white font-medium hover:border-[#F7BC5F]/50 shadow-inner transition-colors outline-none cursor-pointer"
          >
            {pipelines.map(
              (pipeline) => (
                <option
                  key={
                    pipeline.id
                  }
                  value={
                    pipeline.id
                  }
                  className="bg-[#0b1719] text-white"
                >
                  {
                    pipeline.name
                  }
                </option>
              )
            )}
          </select>

          <button
            onClick={setPipelineAsDefault}
            disabled={isActivePipelineDefault}
            title={isActivePipelineDefault ? 'Ce pipeline est déjà votre pipeline par défaut' : 'Définir comme pipeline par défaut'}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isActivePipelineDefault
                ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/40 text-[#F7BC5F] cursor-default shadow-sm'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20 hover:text-white cursor-pointer active:scale-95'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${isActivePipelineDefault ? 'fill-[#F7BC5F]' : ''}`} />
            <span className="hidden sm:inline">{isActivePipelineDefault ? 'Par défaut' : 'Définir par défaut'}</span>
          </button>

          {peutRenommerOuSupprimerPipeline(activePipeline) && (
            <button
              onClick={() => {
                setError(null);
                setRenamePipelineTitle(
                  activePipeline?.name || ''
                );
                setShowRenamePipelineModal(
                  true
                );
              }}
              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-200 hover:text-white hover:bg-white/10 hover:border-white/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <Pencil className="w-3.5 h-3.5" />
              Renommer pipeline
            </button>
          )}

          {/* Réservé aux super admins. À ne pas confondre avec l'étoile
              ci-dessus, qui reste un choix personnel d'ouverture. */}
          {canManageStructure && activePipeline && !activePipeline.officiel && !estPipelineTransactions(versDroit(activePipeline)!) && (
            <button
              onClick={() => void basculerVerrouPipeline()}
              title={
                activePipeline.verrouille
                  ? 'Déverrouiller : son créateur pourra de nouveau le renommer ou le supprimer'
                  : "Verrouiller : personne d'autre ne pourra le renommer ni le supprimer"
              }
              className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activePipeline.verrouille
                  ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/40 text-[#F7BC5F] hover:bg-[#F7BC5F]/25 cursor-pointer shadow-sm'
                  : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/20 hover:text-white cursor-pointer active:scale-95'
              }`}
            >
              <Shield className={`w-3.5 h-3.5 ${activePipeline.verrouille ? 'fill-[#F7BC5F]/40' : ''}`} />
              <span className="hidden sm:inline">
                {activePipeline.verrouille ? 'Verrouillé' : 'Verrouiller'}
              </span>
            </button>
          )}

          {!!currentUser && (
            <button
              onClick={() => {
                setError(null);
                setShowCreatePipelineModal(
                  true
                );
              }}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FDE047] via-[#F7BC5F] to-[#E5A642] text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              Nouveau pipeline
            </button>
          )}

          {peutSupprimerCePipeline(activePipeline) && (
            <button
              onClick={() =>
                setShowDeletePipelineModal(
                  true
                )
              }
              className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer pipeline
            </button>
          )}

          {/* Un pipeline qu'on ne peut pas modifier : on dit pourquoi, plutôt
              que de laisser chercher des boutons absents. */}
          {activePipeline && !peutRenommerOuSupprimerPipeline(activePipeline) && (
            <span className="px-3 py-2 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 text-[#F9C977] text-xs font-semibold flex items-center gap-1.5 shadow-sm">
              <Shield className="w-3.5 h-3.5" />
              {estPipelineTransactions(versDroit(activePipeline)!)
                ? 'Pipeline Transactions verrouillé'
                : activePipeline.officiel
                  ? 'Pipeline officiel'
                  : activePipeline.verrouille
                    ? 'Pipeline verrouillé'
                    : "Pipeline d'un autre membre"}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs">
          {success}
        </div>
      )}

      {!activePipeline ? (
        <div className="p-10 text-center text-gray-500 border border-dashed border-white/10 rounded-2xl">
          Aucun pipeline disponible pour cette société.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={detecterColonneDeDepot}
          onDragStart={handlePipelineDragStart}
          onDragEnd={(event) => void handlePipelineDragEnd(event)}
          // Ticket #114 (suivi) : la ligne des colonnes a un scroll-snap
          // CSS (pour le swipe mobile entre colonnes, ticket #93) — le
          // défilement automatique par défaut de dnd-kit essayait de
          // scroller la même rangée pendant le glisser d'une carte près
          // du bord, et le snap-mandatory forçait un "retour en arrière"
          // à chaque tentative : exactement la saccade remontée en
          // changeant de colonne. Désactivé ici, le swipe manuel (hors
          // glisser-déposer) n'est pas concerné et reste fluide.
          autoScroll={false}
        >
          {/* Sélecteur d'étape rapide pour mobile */}
          <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-2.5 -mx-1 px-1 custom-scrollbar snap-x mb-2">
            {activePipeline.stages.map((stage, idx) => {
              const stageDeals = dealsByStage.get(stage) || EMPTY_DEALS;
              const accentColor =
                (estAgenceNovavisio(currentAgencyId) && couleurEtapeNovavisio(stage)) ||
                STAGE_ACCENT_COLORS[idx % STAGE_ACCENT_COLORS.length];
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`pipeline-stage-${stage}`);
                    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full nv-bento-dark border border-white/10 hover:border-[#F7BC5F]/40 text-slate-200 text-xs font-bold whitespace-nowrap shrink-0 snap-start active:scale-95 shadow-sm transition-all"
                >
                  <span className="w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: accentColor, color: accentColor }} />
                  <span className="truncate max-w-[120px]">{stage}</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/10 border border-white/15 text-white font-black shadow-inner">
                    {stageDeals.length}
                  </span>
                </button>
              );
            })}
          </div>

          <SortableContext items={activePipeline.stages} strategy={horizontalListSortingStrategy}>
            <div
              // Demande explicite (mobile) : le défilement horizontal entre
              // colonnes de pipeline "flottait" sans jamais se caler —
              // snap-x/snap-mandatory fait que chaque swipe se bloque
              // proprement sur une colonne entière, centrée à l'écran
              // (snap-center sur chaque colonne ci-dessous).
              className="flex gap-3 sm:gap-4 overflow-x-auto pb-6 -webkit-overflow-scrolling-touch touch-pan-x snap-x snap-mandatory scroll-px-4"
            >
              {activePipeline.stages.map((stage, stageIndex) => {
                const stageDeals = dealsByStage.get(stage) || EMPTY_DEALS;
                const stageTotal = stageDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);
                // Demandé : la commission conseiller est saisie TTC et doit
                // remonter en HT sur la colonne.
                const stageAdvisorHt = stageDeals.reduce(
                  (sum, deal) => sum + htDepuisTtc(deal.advisorCommissionTtc),
                  0
                );
                // Sa propre commission, pour un conseiller : seules les
                // affaires qui lui sont attribuees.
                const stageMonHt = currentUser
                  ? stageDeals.reduce(
                      (sum, deal) =>
                        deal.advisorId === currentUser.uid
                          ? sum + htDepuisTtc(deal.advisorCommissionTtc)
                          : sum,
                      0
                    )
                  : 0;
                // Novavisio : la colonne prend la couleur de Natacha (par son nom)
                // pour s'accorder avec ses cartes ; sinon la palette cyclique.
                const accentColor =
                  (estAgenceNovavisio(currentAgencyId) && couleurEtapeNovavisio(stage)) ||
                  STAGE_ACCENT_COLORS[stageIndex % STAGE_ACCENT_COLORS.length];

                // Cloisonnement par utilisateur (16 septembre, Immosphera) :
                // `agencyDeals` ne contient déjà (via la policy RLS) que
                // les dossiers du conseiller pour un non-admin, sur tout
                // pipeline Immosphera SAUF Transactions V2 (laissé visible
                // de tous pour l'instant) — `stageTotal` ne porte donc que
                // SES dossiers à lui sur ces pipelines-là, et peut
                // s'afficher sans rien dévoiler du reste de l'agence.
                const estVueDossiersPropres =
                  currentAgencyId === IMMOSPHERA_AGENCY_ID &&
                  activePipeline.id !== IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID &&
                  !estAdminVueDossiers;

                return (
                  <PipelineColumn
                    key={stage}
                    stage={stage}
                    stageDeals={stageDeals}
                    stageTotal={stageTotal}
                    stageAdvisorHt={stageAdvisorHt}
                    estSuperAdmin={canManageStructure || estVueDossiersPropres}
                    libelleMontant={estVueDossiersPropres ? 'Montant de tes dossiers' : estConseilsFinances ? 'Honoraires agence, TTC' : 'Commission agence, hors taxes'}
                    stageMonHt={stageMonHt}
                    accentColor={accentColor}
                    canManageStructure={peutGererLesColonnes(activePipeline)}
                    canRenameStage={peutRenommerOuSupprimerPipeline(activePipeline)}
                    contactsById={contactsById}
                    taskStatusByContactId={taskStatusByContactId}
                    onSelectContact={onSelectContact}
                    onDeleteDeal={(dealId) => void deleteDeal.mutateAsync(dealId)}
                    onOpenChecklist={(deal) => setChecklistDeal(deal)}
                    onOpenNova={onOpenNova}
                    onRename={(s) => { setStageToRename(s); setRenameStageValue(s); }}
                    onRequestDelete={(s) => setStageToDelete(s)}
                    justArrived={justArrivedStage === stage}
                  />
                );
              })}

              {peutGererLesColonnes(activePipeline) && (
                <button
                  onClick={() => setShowAddStageModal(true)}
                  className="w-[220px] shrink-0 min-h-[130px] rounded-2xl border border-dashed border-[#F7BC5F]/30 text-[#F7BC5F] hover:bg-[#F7BC5F]/5 flex flex-col items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-xs font-bold">Ajouter une colonne</span>
                </button>
              )}
            </div>
          </SortableContext>

          {/* Clone flottant d'une carte en cours de glisser — rendu hors de
              la colonne (portée par dnd-kit dans document.body), donc jamais
              rogné par le `overflow-hidden` de la colonne d'origine.
              `dropAnimation={null}` : sans ça, dnd-kit anime par défaut le
              retour de ce clone vers sa position de départ au lâcher (pensé
              pour un `useSortable`, absent ici — simple `useDraggable`),
              provoquant un rebond parasite vers la colonne d'origine
              (signalé). Le clone disparaît maintenant instantanément, pile
              là où la souris l'a lâché. */}
          <DragOverlay dropAnimation={null}>
            {activeDragDeal ? (
              <div className="p-4 sm:p-3 rounded-xl bg-[#0b1719] border border-[#F7BC5F]/60 shadow-[0_20px_36px_-10px_rgba(0,0,0,0.7),0_0_0_3px_rgba(229,184,66,0.25)] scale-[1.03] rotate-1 w-[280px] cursor-grabbing">
                <PipelineCardContent
                  deal={activeDragDeal}
                  contact={contactsById.get(activeDragDeal.contactId)}
                  taskStatus={
                    contactsById.get(activeDragDeal.contactId)
                      ? taskStatusByContactId.get(contactsById.get(activeDragDeal.contactId)!.id) ?? null
                      : undefined
                  }
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* CREATE PIPELINE */}
      {showCreatePipelineModal && (
        <ModalShell
          title="Créer un pipeline"
          onClose={() =>
            setShowCreatePipelineModal(
              false
            )
          }
        >
          <form
            onSubmit={
              handleCreatePipeline
            }
            className="space-y-4"
          >
            <input
              value={
                newPipelineName
              }
              onChange={(
                event
              ) =>
                setNewPipelineName(
                  event.target.value
                )
              }
              placeholder="Nom du pipeline (ex: Prêts immobiliers, Prospection...)"
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white"
            />

            {error && (
              <p className="text-xs text-rose-300 -mt-2">{error}</p>
            )}

            <ModalActions
              onCancel={() =>
                setShowCreatePipelineModal(
                  false
                )
              }
              submitLabel="Créer"
            />
          </form>
        </ModalShell>
      )}

      {/* RENAME PIPELINE */}
      {showRenamePipelineModal && (
        <ModalShell
          title="Renommer le pipeline"
          onClose={() =>
            setShowRenamePipelineModal(
              false
            )
          }
        >
          <form
            onSubmit={
              handleRenamePipeline
            }
            className="space-y-4"
          >
            <input
              value={
                renamePipelineTitle
              }
              onChange={(
                event
              ) =>
                setRenamePipelineTitle(
                  event.target.value
                )
              }
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white"
            />

            {error && (
              <p className="text-xs text-rose-300 -mt-2">{error}</p>
            )}

            <ModalActions
              onCancel={() =>
                setShowRenamePipelineModal(
                  false
                )
              }
              submitLabel="Enregistrer"
            />
          </form>
        </ModalShell>
      )}

      {/* DELETE PIPELINE */}
      {showDeletePipelineModal && (
        <ModalShell
          title="Supprimer le pipeline"
          onClose={() =>
            setShowDeletePipelineModal(
              false
            )
          }
        >
          <p className="text-sm text-gray-300">
            Cette suppression concerne uniquement {currentAgency?.name}. Les contacts
            restent dans la fiche des contacts, sans être envoyés vers un autre pipeline.
          </p>

          {activePipeline && (() => {
            const affectedCount = agencyDeals.filter(
              (deal) => deal.pipelineId === activePipeline.id
            ).length;
            if (affectedCount === 0) return null;
            return (
              <p className="text-sm text-amber-400 mt-2">
                {affectedCount} contact(s) quitteront ce pipeline et resteront dans les fiches.
              </p>
            );
          })()}

          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() =>
                setShowDeletePipelineModal(
                  false
                )
              }
              className="px-4 py-2 rounded-xl bg-white/5 text-xs"
            >
              Annuler
            </button>

            <button
              onClick={() =>
                void handleDeletePipeline()
              }
              className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
            >
              Supprimer
            </button>
          </div>
        </ModalShell>
      )}

      {/* ADD STAGE */}
      {showAddStageModal && (
        <ModalShell
          title="Ajouter une colonne"
          onClose={() =>
            setShowAddStageModal(
              false
            )
          }
        >
          <form
            onSubmit={
              handleAddStage
            }
            className="space-y-4"
          >
            <input
              value={
                newStageName
              }
              onChange={(
                event
              ) =>
                setNewStageName(
                  event.target.value
                )
              }
              placeholder="Nom de la colonne"
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white"
            />

            <ModalActions
              onCancel={() =>
                setShowAddStageModal(
                  false
                )
              }
              submitLabel="Ajouter"
            />
          </form>
        </ModalShell>
      )}

      {checklistDeal && (
        <TransactionChecklistModal
          leadId={checklistDeal.contactId}
          pipelineId={checklistDeal.pipelineId || IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID}
          stageName={checklistDeal.stage}
          onClose={() => setChecklistDeal(null)}
        />
      )}

      {/* RENAME STAGE */}
      {stageToRename && (
        <ModalShell
          title="Renommer la colonne"
          onClose={() =>
            setStageToRename(
              null
            )
          }
        >
          <form
            onSubmit={
              handleRenameStage
            }
            className="space-y-4"
          >
            <input
              value={
                renameStageValue
              }
              onChange={(
                event
              ) =>
                setRenameStageValue(
                  event.target.value
                )
              }
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-sm text-white"
            />

            <ModalActions
              onCancel={() =>
                setStageToRename(
                  null
                )
              }
              submitLabel="Enregistrer"
            />
          </form>
        </ModalShell>
      )}

      {/* DELETE STAGE */}
      {stageToDelete && (
        <ModalShell
          title="Supprimer la colonne"
          onClose={() =>
            setStageToDelete(
              null
            )
          }
        >
          <p className="text-sm text-gray-300">
            Cette suppression concerne uniquement {currentAgency?.name}.
          </p>

          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() =>
                setStageToDelete(
                  null
                )
              }
              className="px-4 py-2 rounded-xl bg-white/5 text-xs"
            >
              Annuler
            </button>

            <button
              onClick={() =>
                void handleDeleteStage()
              }
              className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
            >
              Supprimer
            </button>
          </div>
        </ModalShell>
      )}

      {pendingMontantPrompt && (
        <ModalShell
          title={
            pendingMontantPrompt.ttc
              ? 'Montant TTC (conciergerie)'
              : `${estConseilsFinances ? 'Honoraires' : 'Commission'} agence, ${libelleUniteMontant}`
          }
          onClose={() => setPendingMontantPrompt(null)}
        >
          <p className="text-sm text-gray-300 mb-4">
            "{pendingMontantPrompt.dealTitle}" vient de passer en « {pendingMontantPrompt.etape} ».
            {pendingMontantPrompt.ttc
              ? ' Quel est le montant TTC de la prestation de conciergerie ?'
              : ` Quel est le montant ${estConseilsFinances ? 'des honoraires agence' : 'de la commission agence'}, ${libelleUniteMontant} ?`}
          </p>
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={montantHtSaisi}
            onChange={(event) => setMontantHtSaisi(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void validerMontantHt(); }}
            disabled={montantHtEnCours}
            placeholder="Non renseigné"
            className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-60"
          />
          <p className="text-[11px] text-gray-500 mt-2 mb-4 leading-relaxed">
            C'est ce montant qui apparaît en « CA à venir » sur le Tableau de bord, puis dans le
            chiffre d'affaires de l'agence une fois le dossier archivé. Laissé vide, le montant
            déjà enregistré est conservé.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingMontantPrompt(null)}
              className="px-4 py-2 rounded-xl bg-white/5 text-xs"
            >
              Plus tard
            </button>
            <button
              type="button"
              onClick={() => void validerMontantHt()}
              disabled={montantHtEnCours}
              className="px-4 py-2 rounded-xl bg-[#F7BC5F] text-black text-xs font-bold disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </ModalShell>
      )}

      {pendingAutomationPrompt && (
        <ModalShell title="Automatisation détectée" onClose={() => setPendingAutomationPrompt(null)}>
          <p className="text-sm text-gray-300 mb-4">
            "{pendingAutomationPrompt.dealTitle}" vient d'atteindre une étape avec une automatisation configurée. Préparer l'e-mail pour {pendingAutomationPrompt.contactName} ?
          </p>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-4 space-y-1">
            <p className="text-xs text-gray-400">Sujet : <span className="text-white font-semibold">{pendingAutomationPrompt.subject}</span></p>
            <p className="text-xs text-gray-400 line-clamp-3">{pendingAutomationPrompt.body}</p>
          </div>
          {!pendingAutomationPrompt.contactEmail && (
            <p className="text-xs text-amber-400 mb-3">Ce client n'a pas d'adresse e-mail renseignée — le brouillon s'ouvrira sans destinataire, à compléter manuellement.</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingAutomationPrompt(null)}
              className="px-4 py-2 rounded-xl bg-white/5 text-gray-300 text-xs font-bold"
            >
              Non
            </button>
            <button
              onClick={() => {
                onOpenMailDraft?.(pendingAutomationPrompt.contactEmail || '', pendingAutomationPrompt.subject, pendingAutomationPrompt.body);
                setPendingAutomationPrompt(null);
              }}
              className="px-4 py-2 rounded-xl bg-[#F7BC5F] text-slate-950 text-xs font-bold"
            >
              Oui, préparer l'e-mail
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-[#0b1719] border border-white/10 p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-bold text-white">
            {title}
          </h2>

          <button
            onClick={
              onClose
            }
            className="text-gray-500 hover:text-white"
          >
            ×
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  submitLabel,
}: {
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={
          onCancel
        }
        className="px-4 py-2 rounded-xl bg-white/5 text-xs"
      >
        Annuler
      </button>

      <button
        type="submit"
        className="px-4 py-2 rounded-xl bg-[#F7BC5F] text-black text-xs font-bold"
      >
        {
          submitLabel
        }
      </button>
    </div>
  );
}

export default Pipeline;