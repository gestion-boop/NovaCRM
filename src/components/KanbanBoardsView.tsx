import React, { useEffect, useState } from 'react';
import { Plus, ChevronLeft, Loader2, Trash2, X, LayoutGrid, List } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

// Demande explicite : "je veux qu'on ait la possibilité de créer d'autres
// colonnes kanban comme si c'était une nouvelle interface, comme des
// Pipelines complètement différentes" — plusieurs tableaux indépendants,
// chacun avec ses PROPRES colonnes nommées librement (contrairement à
// "Projet", colonnes fixes À faire/En cours/À vérifier/Terminé, qui reste
// inchangé). Onglet séparé dans ProjetsInternes.tsx, table dédiée
// (kanban_boards/kanban_columns/kanban_cards, migration 20260826207000).

const BOARD_COLORS = ['#38BDF8', '#F7BC5F', '#A78BFA', '#34D399', '#FB7185', '#94A3B8', '#F472B6', '#FACC15'];

interface Board { id: string; name: string; }
interface Column { id: string; boardId: string; name: string; color: string | null; sortOrder: number; }
interface Card { id: string; boardId: string; columnId: string; title: string; description: string | null; sortOrder: number; }

const KanbanBoardsView: React.FC<{ agencyId: string }> = ({ agencyId }) => {
  const { currentUser } = useAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);
  // Demande explicite : "je voudrais également avoir une vue en liste et en
  // grille" pour l'écran listant les tableaux — préférence mémorisée par navigateur.
  const [boardsViewMode, setBoardsViewMode] = useState<'grid' | 'list'>(() => {
    try { return (localStorage.getItem('kanbanBoardsViewMode') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; }
  });
  const setViewMode = (mode: 'grid' | 'list') => {
    setBoardsViewMode(mode);
    try { localStorage.setItem('kanbanBoardsViewMode', mode); } catch { /* ignore */ }
  };

  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [showNewColumnModal, setShowNewColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnColor, setNewColumnColor] = useState(BOARD_COLORS[0]);
  const [addingCardToColumn, setAddingCardToColumn] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');

  const selectedBoard = boards.find((b) => b.id === selectedBoardId) || null;

  const loadBoards = async () => {
    setLoadingBoards(true);
    const { data } = await supabase.from('kanban_boards' as any).select('*').eq('agency_id', agencyId).order('sort_order');
    setBoards(((data as any[]) || []).map((r) => ({ id: r.id, name: r.name })));
    setLoadingBoards(false);
  };

  useEffect(() => { void loadBoards(); }, [agencyId]);

  useEffect(() => {
    if (!agencyId) return;
    const channel = supabase
      .channel(`kanban_boards:${agencyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kanban_boards', filter: `agency_id=eq.${agencyId}` }, () => void loadBoards())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  const loadBoardContent = async (boardId: string) => {
    setLoadingBoard(true);
    const [{ data: cols }, { data: crds }] = await Promise.all([
      supabase.from('kanban_columns' as any).select('*').eq('board_id', boardId).order('sort_order'),
      supabase.from('kanban_cards' as any).select('*').eq('board_id', boardId).order('sort_order'),
    ]);
    setColumns(((cols as any[]) || []).map((r) => ({ id: r.id, boardId: r.board_id, name: r.name, color: r.color, sortOrder: r.sort_order })));
    setCards(((crds as any[]) || []).map((r) => ({ id: r.id, boardId: r.board_id, columnId: r.column_id, title: r.title, description: r.description, sortOrder: r.sort_order })));
    setLoadingBoard(false);
  };

  useEffect(() => {
    if (!selectedBoardId) return;
    void loadBoardContent(selectedBoardId);
    const channel = supabase
      .channel(`kanban_board_content:${selectedBoardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kanban_columns', filter: `board_id=eq.${selectedBoardId}` }, () => void loadBoardContent(selectedBoardId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kanban_cards', filter: `board_id=eq.${selectedBoardId}` }, () => void loadBoardContent(selectedBoardId))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoardId]);

  async function createBoard() {
    if (!newBoardName.trim() || !currentUser || creatingBoard) return;
    setCreatingBoard(true);
    try {
      const { data, error } = await supabase.from('kanban_boards' as any).insert({
        agency_id: agencyId, name: newBoardName.trim(), created_by: currentUser.uid, sort_order: boards.length,
      }).select('*').single();
      if (error) throw error;
      // Deux colonnes de départ raisonnables — librement renommables/supprimables ensuite.
      await supabase.from('kanban_columns' as any).insert([
        { board_id: (data as any).id, name: 'À faire', color: BOARD_COLORS[0], sort_order: 0 },
        { board_id: (data as any).id, name: 'Terminé', color: BOARD_COLORS[2], sort_order: 1 },
      ]);
      setNewBoardName('');
      setShowNewBoardModal(false);
      await loadBoards();
      setSelectedBoardId((data as any).id);
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de créer le tableau.');
    } finally {
      setCreatingBoard(false);
    }
  }

  async function deleteBoard(id: string) {
    if (!confirm('Supprimer ce tableau et toutes ses cartes ? Action définitive.')) return;
    await supabase.from('kanban_boards' as any).delete().eq('id', id);
    if (selectedBoardId === id) setSelectedBoardId(null);
    await loadBoards();
  }

  async function createColumn() {
    if (!newColumnName.trim() || !selectedBoardId) return;
    await supabase.from('kanban_columns' as any).insert({
      board_id: selectedBoardId, name: newColumnName.trim(), color: newColumnColor, sort_order: columns.length,
    });
    setNewColumnName('');
    setShowNewColumnModal(false);
  }

  async function deleteColumn(id: string) {
    if (!confirm('Supprimer cette colonne et ses cartes ? Action définitive.')) return;
    await supabase.from('kanban_columns' as any).delete().eq('id', id);
  }

  async function addCard(columnId: string) {
    if (!newCardTitle.trim() || !currentUser || !selectedBoardId) return;
    const columnCards = cards.filter((c) => c.columnId === columnId);
    await supabase.from('kanban_cards' as any).insert({
      board_id: selectedBoardId, column_id: columnId, title: newCardTitle.trim(), created_by: currentUser.uid, sort_order: columnCards.length,
    });
    setNewCardTitle('');
    setAddingCardToColumn(null);
  }

  async function deleteCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('kanban_cards' as any).delete().eq('id', id);
  }

  // Glisser-déposer horizontal (changer de colonne) ET vertical (réordonner
  // dans la même colonne) — même mécanique éprouvée que "Projet"/"Liste".
  function handleDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newColumnId = destination.droppableId;
    const destIds = cards.filter((c) => c.columnId === newColumnId && c.id !== draggableId).map((c) => c.id);
    destIds.splice(destination.index, 0, draggableId);

    setCards((prev) => prev.map((c) => {
      const idx = destIds.indexOf(c.id);
      if (idx === -1) return c;
      return c.id === draggableId ? { ...c, columnId: newColumnId, sortOrder: idx } : { ...c, sortOrder: idx };
    }));

    void Promise.all(
      destIds.map((id, idx) =>
        supabase.from('kanban_cards' as any).update({
          sort_order: idx,
          ...(id === draggableId ? { column_id: newColumnId, updated_at: new Date().toISOString() } : {}),
        }).eq('id', id)
      )
    ).catch((err) => {
      console.error('Erreur réorganisation tableau :', err);
      toast.error("Impossible d'enregistrer le nouvel ordre.");
      if (selectedBoardId) void loadBoardContent(selectedBoardId);
    });
  }

  // ── Vue liste des tableaux ──────────────────────────────────────────
  if (!selectedBoard) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400 flex-1">Tableaux indépendants, chacun avec ses propres colonnes — aucun lien avec "Projet" ni "Liste".</p>
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              title="Vue en grille"
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${boardsViewMode === 'grid' ? 'bg-[#F7BC5F] text-slate-950' : 'text-gray-400 hover:text-white'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              title="Vue en liste"
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${boardsViewMode === 'list' ? 'bg-[#F7BC5F] text-slate-950' : 'text-gray-400 hover:text-white'}`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={() => setShowNewBoardModal(true)}
            className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-md shrink-0"
          >
            <Plus className="w-4 h-4" /> Nouveau tableau
          </button>
        </div>

        {loadingBoards ? (
          <div className="p-12 flex items-center justify-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin text-[#F7BC5F]" /></div>
        ) : boards.length === 0 ? (
          <div className="p-12 text-center text-gray-500 bg-white/5 border border-dashed border-white/10 rounded-2xl">
            <LayoutGrid className="w-9 h-9 mx-auto mb-3 text-gray-600" />
            <p className="text-sm">Aucun tableau pour l'instant.</p>
          </div>
        ) : boardsViewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {boards.map((b) => (
              <div key={b.id} className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-3 hover:border-[#F7BC5F]/40 transition-colors relative group">
                <button onClick={() => setSelectedBoardId(b.id)} className="w-full text-left space-y-1">
                  <div className="w-9 h-9 rounded-xl bg-[#F7BC5F]/15 text-[#F9C977] flex items-center justify-center"><LayoutGrid className="w-4 h-4" /></div>
                  <p className="font-bold text-white text-sm pt-1">{b.name}</p>
                </button>
                <button
                  onClick={() => void deleteBoard(b.id)}
                  className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Supprimer le tableau"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-white/10 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            {boards.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors group">
                <button onClick={() => setSelectedBoardId(b.id)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[#F7BC5F]/15 text-[#F9C977] flex items-center justify-center shrink-0"><LayoutGrid className="w-3.5 h-3.5" /></div>
                  <p className="font-bold text-white text-sm truncate">{b.name}</p>
                </button>
                <button
                  onClick={() => void deleteBoard(b.id)}
                  className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Supprimer le tableau"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showNewBoardModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowNewBoardModal(false)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-sm w-full p-6 text-white">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-[#F7BC5F]">Nouveau tableau</h3>
                <button onClick={() => setShowNewBoardModal(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <input
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createBoard(); }}
                placeholder="Nom du tableau (ex: Marketing)"
                autoFocus
                className="w-full bg-black/20 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] mb-4"
              />
              <button
                onClick={() => void createBoard()}
                disabled={!newBoardName.trim() || creatingBoard}
                className="w-full py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {creatingBoard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Créer
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Vue détail d'un tableau ─────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setSelectedBoardId(null)} className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" /> Tous les tableaux
        </button>
        <h2 className="text-base font-bold text-white flex-1 text-center truncate">{selectedBoard.name}</h2>
        <button
          onClick={() => setShowNewColumnModal(true)}
          className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 shadow-md shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Colonne
        </button>
      </div>

      {loadingBoard ? (
        <div className="p-12 flex items-center justify-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin text-[#F7BC5F]" /></div>
      ) : columns.length === 0 ? (
        <div className="p-12 text-center text-gray-500 bg-white/5 border border-dashed border-white/10 rounded-2xl text-sm">
          Aucune colonne. Ajoutez-en une avec le bouton "+ Colonne".
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
            {columns.map((col) => {
              const accent = col.color || '#94A3B8';
              const columnCards = cards.filter((c) => c.columnId === col.id);
              return (
                <Droppable droppableId={col.id} key={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="rounded-2xl border p-3 space-y-2 min-h-[140px] transition-colors bg-white/[0.02]"
                      style={{ borderColor: snapshot.isDraggingOver ? accent : 'rgba(255,255,255,0.1)' }}
                    >
                      <div className="flex items-center justify-between px-1 group">
                        <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 min-w-0" style={{ color: accent }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
                          <span className="truncate">{col.name}</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-gray-500 font-mono">{columnCards.length}</span>
                          <button onClick={() => void deleteColumn(col.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-rose-500/10 text-gray-500 hover:text-rose-300">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {columnCards.map((card, index) => (
                        <Draggable draggableId={card.id} index={index} key={card.id}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={`group/card p-3 bg-white/5 border-y border-r rounded-xl border-l-4 flex items-start justify-between gap-2 ${dragSnapshot.isDragging ? 'shadow-2xl' : 'transition-colors'}`}
                              style={{
                                ...dragProvided.draggableProps.style,
                                borderLeftColor: accent,
                                borderTopColor: 'rgba(255,255,255,0.1)',
                                borderRightColor: 'rgba(255,255,255,0.1)',
                                borderBottomColor: 'rgba(255,255,255,0.1)',
                              }}
                            >
                              <p className="text-sm text-white break-words flex-1 min-w-0">{card.title}</p>
                              <button onClick={() => void deleteCard(card.id)} className="opacity-0 group-hover/card:opacity-100 transition-opacity shrink-0 text-gray-500 hover:text-rose-300">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {addingCardToColumn === col.id ? (
                        <div className="space-y-1.5">
                          <input
                            value={newCardTitle}
                            onChange={(e) => setNewCardTitle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void addCard(col.id); if (e.key === 'Escape') setAddingCardToColumn(null); }}
                            placeholder="Titre de la carte..."
                            autoFocus
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                          />
                          <div className="flex gap-1.5">
                            <button onClick={() => void addCard(col.id)} disabled={!newCardTitle.trim()} className="flex-1 py-1.5 rounded-lg bg-[#F7BC5F] text-slate-950 text-[11px] font-bold disabled:opacity-40">Ajouter</button>
                            <button onClick={() => { setAddingCardToColumn(null); setNewCardTitle(''); }} className="px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-400 text-[11px]">Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAddingCardToColumn(col.id); setNewCardTitle(''); }}
                          className="w-full py-2 rounded-lg text-[11px] font-bold text-gray-400 hover:text-white hover:bg-white/5 flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Carte
                        </button>
                      )}
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}

      {showNewColumnModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowNewColumnModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-sm w-full p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#F7BC5F]">Nouvelle colonne</h3>
              <button onClick={() => setShowNewColumnModal(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <input
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createColumn(); }}
              placeholder="Nom de la colonne (ex: Idée)"
              autoFocus
              className="w-full bg-black/20 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] mb-3"
            />
            <div className="flex gap-2 mb-4">
              {BOARD_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColumnColor(c)}
                  className={`w-7 h-7 rounded-full shrink-0 ${newColumnColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0E1A20]' : ''}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <button
              onClick={() => void createColumn()}
              disabled={!newColumnName.trim()}
              className="w-full py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" /> Créer
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default KanbanBoardsView;
