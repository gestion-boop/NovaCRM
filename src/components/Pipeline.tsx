import React, { useState, useEffect } from 'react';
import { Deal, AGENCIES } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { 
  TrendingUp, Award, ArrowLeftRight, Trash2, Plus, 
  ArrowLeft, ArrowRight, User, Building, Sparkles, X, ChevronDown, GripHorizontal 
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useDeals } from '@/hooks/useDeals';
import { useContacts } from '@/hooks/useContacts';

const INITIAL_STAGES: Deal['stage'][] = [
  'To-Do List', 
  'Prise de contact', 
  'Montage bancaire', 
  'En Banque', 
  'Att Retour Caution', 
  'Accord banque / Rendez-vous', 
  'Attente édition des offres', 
  'Décompte / Rendez-vous notaire', 
  'Dossier facture'
];

const STAGE_HOVER_COLORS: Record<string, string> = {
  'To-Do List': 'hover:shadow-[0_0_15px_rgba(20,184,166,0.3)] hover:border-teal-500/80',
  'Prise de contact': 'hover:shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:border-amber-500/80',
  'Montage bancaire': 'hover:shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:border-purple-500/80',
  'En Banque': 'hover:shadow-[0_0_15px_rgba(14,165,233,0.3)] hover:border-sky-500/80',
  'Att Retour Caution': 'hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:border-emerald-500/80',
  'Accord banque / Rendez-vous': 'hover:shadow-[0_0_15px_rgba(244,63,94,0.3)] hover:border-rose-500/80',
  'Attente édition des offres': 'hover:shadow-[0_0_15px_rgba(236,72,153,0.3)] hover:border-pink-500/80',
  'Décompte / Rendez-vous notaire': 'hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] hover:border-orange-500/80',
  'Dossier facture': 'hover:shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:border-indigo-500/80',
};

const STAGE_COLORS: Record<string, string> = {
  'To-Do List': 'text-teal-400',
  'Prise de contact': 'text-amber-400',
  'Montage bancaire': 'text-purple-400',
  'En Banque': 'text-sky-400',
  'Att Retour Caution': 'text-emerald-400',
  'Accord banque / Rendez-vous': 'text-rose-400',
  'Attente édition des offres': 'text-pink-400',
  'Décompte / Rendez-vous notaire': 'text-orange-400',
  'Dossier facture': 'text-indigo-400',
};

export default function Pipeline({
  onSelectContact
}: {
  onSelectContact?: (contactId: string) => void;
} = {}) {
  const { deals = [], addDeal, updateDeal, deleteDeal } = useDeals();
  const { contacts } = useContacts();
  const [isMounted, setIsMounted] = useState(false);
  const [stages, setStages] = useState<Deal['stage'][]>(INITIAL_STAGES);

  // Show / Hide creation modal
  const [showAddModal, setShowAddModal] = useState(false);

  // New Deal fields
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newStage, setNewStage] = useState<Deal['stage']>('To-Do List');
  const [newAgencyId, setNewAgencyId] = useState(AGENCIES[0].id);
  const [newContactId, setNewContactId] = useState('');

  // Selected deal for detailed viewing
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const getStageTotal = (stage: Deal['stage']) => {
    return deals
      .filter(d => d.stage === stage)
      .reduce((sum, d) => sum + d.amount, 0);
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newAmount || !newContactId) return;

    await addDeal.mutateAsync({
      title: newTitle,
      amount: Number(newAmount),
      stage: newStage,
      agencyId: newAgencyId,
      contactId: newContactId,
    });

    setNewTitle('');
    setNewAmount('');
    setNewContactId('');
    setShowAddModal(false);
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId, type } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    if (type === 'COLUMN') {
      const newStages = Array.from(stages);
      const [removed] = newStages.splice(source.index, 1);
      newStages.splice(destination.index, 0, removed);
      setStages(newStages);
      return;
    }

    if (type === 'DEAL') {
      const deal = deals.find(d => d.id === draggableId);
      if (!deal) return;

      const newStage = destination.droppableId as Deal['stage'];
      if (deal.stage !== newStage) {
        await updateDeal.mutateAsync({ id: deal.id, updates: { stage: newStage } });
      }
    }
  };

  if (!isMounted) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Suivi des Opportunités & Pipeline</h2>
          <p className="text-xs text-slate-400">Évaluation des encours financiers et étapes d'approbation bancaire. Glissez les leads entre les étapes.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          Lancer une Nouvelle Affaire
        </button>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="board" type="COLUMN" direction="horizontal">
          {(provided) => (
            <div 
              ref={provided.innerRef} 
              {...provided.droppableProps} 
              className="flex gap-4 overflow-x-auto pb-4 items-start"
            >
              {stages.map((stage, index) => {
                const stageDeals = deals.filter(d => d.stage === stage);
                const stageTotal = getStageTotal(stage);
                const hoverColorClass = STAGE_HOVER_COLORS[stage] || STAGE_HOVER_COLORS['To-Do List'];
                const textColorClass = STAGE_COLORS[stage] || STAGE_COLORS['To-Do List'];

                return (
                  <Draggable key={stage} draggableId={stage} index={index}>
                    {(provided, snapshot) => (
                      <div 
                        ref={provided.innerRef} 
                        {...provided.draggableProps} 
                        className={`rounded-2xl bg-[#07191b] border border-[#144447]/60 p-4 space-y-4 w-[280px] flex-shrink-0 flex flex-col justify-start transition-all duration-300 shadow-xl ${hoverColorClass} ${snapshot.isDragging ? 'opacity-80 scale-105 z-50 shadow-2xl' : ''}`}
                      >
                        <div className="space-y-1" {...provided.dragHandleProps}>
                          <div className="flex justify-between items-center cursor-grab active:cursor-grabbing pb-1">
                            <span className={`text-[12px] font-black uppercase tracking-wider flex items-center gap-2 ${textColorClass}`}>
                              <GripHorizontal className="w-3.5 h-3.5 opacity-50" />
                              {stage}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setNewStage(stage);
                                  setShowAddModal(true);
                                }}
                                className="p-1 rounded bg-black/20 hover:bg-black/60 text-slate-400 hover:text-white transition-colors"
                                title="Ajouter une affaire dans cette étape"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <span className="px-2 py-0.5 rounded-md bg-black/40 text-[10px] text-slate-400 font-bold font-mono">
                                {stageDeals.length}
                              </span>
                            </div>
                          </div>
                          <div className="text-xs font-black text-amber-500 font-mono">
                            {formatCurrency(stageTotal)}
                          </div>
                          <div className="h-[2px] w-full bg-[#143c3f]/30 mt-2" />
                        </div>

                        <Droppable droppableId={stage} type="DEAL">
                          {(provided, snapshot) => (
                            <div 
                              ref={provided.innerRef} 
                              {...provided.droppableProps} 
                              className={`space-y-3 flex-1 overflow-y-auto max-h-[60vh] py-1 px-1 -mx-1 min-h-[100px] transition-colors rounded-xl ${snapshot.isDraggingOver ? 'bg-[#0a2427]' : ''}`}
                            >
                              {stageDeals.length === 0 && !snapshot.isDraggingOver ? (
                                <div className="py-8 text-center text-[10px] text-slate-500 border border-dashed border-[#143c3f]/40 rounded-xl">
                                  Aucun dossier
                                </div>
                              ) : null}

                              {stageDeals.map((deal, dealIndex) => {
                                const contact = contacts.find(c => c.id === deal.contactId);
                                const agency = AGENCIES.find(a => a.id === deal.agencyId);

                                return (
                                  <Draggable key={deal.id} draggableId={deal.id} index={dealIndex}>
                                    {(provided, snapshot) => (
                                      <div 
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={`p-3.5 rounded-xl bg-[#030d0f]/80 border border-[#144447]/60 hover:border-[#1e5d61] hover:bg-[#051416] shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 space-y-3 relative group ${snapshot.isDragging ? 'opacity-90 shadow-2xl scale-105 border-amber-500/50' : ''}`}
                                      >
                                        <div onClick={() => setSelectedDeal(deal)} className="cursor-pointer space-y-2">
                                          <div className="text-[11px] font-bold text-white leading-tight group-hover:text-amber-400 transition-colors">
                                            {deal.title}
                                          </div>
                                          <div className="text-xs font-black text-white font-mono">
                                            {formatCurrency(deal.amount)}
                                          </div>

                                          <div className="space-y-1">
                                            {contact && (
                                              <div 
                                                onClick={(e) => {
                                                  if (onSelectContact) {
                                                    e.stopPropagation();
                                                    onSelectContact(contact.id);
                                                  }
                                                }}
                                                className="flex items-center gap-1.5 text-[9px] text-slate-400 hover:text-amber-400 cursor-pointer"
                                                title="Voir la fiche client"
                                              >
                                                <User className="w-3 h-3 text-slate-500" />
                                                <span className="truncate">{contact.name}</span>
                                              </div>
                                            )}
                                            {agency && (
                                              <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                                                <Building className="w-3 h-3 text-slate-500" />
                                                <span>{agency.name}</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                );
                              })}
                              {provided.placeholder}
                            </div>
                          )}
                        </Droppable>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add Deal Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#07191b] border border-[#144447]/80 rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up relative shadow-2xl transition-all duration-300">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-sm uppercase font-black tracking-widest text-amber-500 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <span>Créer une opportunité d'affaire</span>
            </h3>

            <form onSubmit={handleCreateDeal} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Titre de l'Affaire / Prêt</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Financement Villa Cap d'Antibes"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Associer un Client / Prospect</label>
                <select
                  required
                  value={newContactId}
                  onChange={(e) => setNewContactId(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Choisir un client --</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Montant Demandé (€)</label>
                  <input
                    type="number"
                    required
                    placeholder="245000"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Pôle Agence</label>
                  <select
                    value={newAgencyId}
                    onChange={(e) => setNewAgencyId(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {AGENCIES.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Étape du Cycle</label>
                <select
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value as Deal['stage'])}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {INITIAL_STAGES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer shadow-lg mt-4 transition-all"
              >
                Créer l'opportunité d'affaire
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Deal detail modal */}
      {selectedDeal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#07191b] border border-[#144447]/80 rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up relative shadow-2xl transition-all duration-300">
            <button
              onClick={() => setSelectedDeal(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-amber-500 tracking-wider">Fiche Affaire</span>
              <h3 className="text-base font-black text-white">{selectedDeal.title}</h3>
              <p className="text-[10px] text-slate-400">Créé le {formatDate(selectedDeal.createdAt)}</p>
            </div>

            <div className="p-4 rounded-2xl bg-[#030d0f]/60 border border-[#153c3f] space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Montant d'acquisition :</span>
                <span className="font-extrabold text-white">{formatCurrency(selectedDeal.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Agence émettrice :</span>
                <span className="font-extrabold text-white">
                  {AGENCIES.find(a => a.id === selectedDeal.agencyId)?.name || 'Inconnue'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Statut du dossier :</span>
                <select
                  value={selectedDeal.stage}
                  onChange={async (e) => {
                    const stage = e.target.value as Deal['stage'];
                    await onUpdateDeal(selectedDeal.id, { stage });
                    setSelectedDeal({ ...selectedDeal, stage });
                  }}
                  className="bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-amber-500 font-bold focus:outline-none"
                >
                  {INITIAL_STAGES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-between items-center">
              <button
                onClick={async () => {
                  if (confirm(`Voulez-vous supprimer ce dossier d'affaires : ${selectedDeal.title} ?`)) {
                    await onDeleteDeal(selectedDeal.id);
                    setSelectedDeal(null);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-xs font-bold text-rose-400 cursor-pointer flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
              <button
                onClick={() => setSelectedDeal(null)}
                className="px-4 py-2 rounded-xl bg-[#143c3f] hover:bg-[#256064] text-xs font-bold text-white cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
