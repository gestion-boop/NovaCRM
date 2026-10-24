import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  FileEdit, Folder, FolderPlus, Loader2, Plus, Search, Trash2, User, X,
  ChevronLeft, Pencil, MoreVertical, ArrowRightLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import { NoteItem } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useContacts } from '@/hooks/useContacts';

interface StoredNote extends NoteItem {
  createdByUserId: string;
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  folderId: string | null;
}

interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

// Table `note_folders` — déjà présente côté Supabase (avec hiérarchie via
// parent_id) mais jusqu'ici jamais utilisée par aucune vue de l'app. On s'en
// sert ici pour le principe "dossiers puis notes dedans" façon mobile.
interface NoteFolderRow {
  id: string;
  user_id: string;
  agency_id: string | null;
  parent_id: string | null;
  scope: string;
  name: string;
  sort_order: number | null;
}

interface NoteRow {
  id: string;
  agency_id: string | null;
  user_id: string | null;
  title: string | null;
  body: string | null;
  folder_id: string | null;
  is_pinned: boolean | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string | null;
}

export const NotesView: React.FC = () => {
  const { activeAgency, currentUser, userProfile } = useAuth();
  const { contacts } = useContacts();

  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Navigation "façon mobile" : null = vue des dossiers, sinon id du dossier ouvert.
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [editingNote, setEditingNote] = useState<StoredNote | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('Général');
  const [selectedContactId, setSelectedContactId] = useState('');

  const [showFolderModal, setShowFolderModal] = useState<'new' | NoteFolder | null>(null);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [movingNote, setMovingNote] = useState<StoredNote | null>(null);
  // Ticket #115 : dossier en cours de glisser-déposer (vue mobile en tuiles),
  // pour le déposer sur un autre et l'y imbriquer.
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [openMenuNoteId, setOpenMenuNoteId] = useState<string | null>(null);
  // Signalé : "je ne peux pas déplacer la note" — glisser-déposer d'une NOTE
  // directement sur un dossier (en plus du bouton "Déplacer" déjà existant),
  // même mécanisme que le glisser-déposer dossier-sur-dossier ci-dessus mais
  // avec un état dédié (les deux peuvent survoler les mêmes dossiers).
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  // Signalé : "replie par défaut les dossiers" — arborescence de la colonne
  // bureau : un dossier ayant des sous-dossiers démarre replié, un chevron
  // permet de le déplier. Vide par défaut = tout replié.
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const toggleFolderExpanded = (id: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Ticket #28 (nouvelle base) : sur ordinateur, présentation façon appli
  // Notes iPhone — dossiers à gauche, liste des notes au centre, contenu de
  // la note sélectionnée à droite — au lieu d'une simple grille de cartes.
  // Le comportement mobile (dossiers en tuiles, drill-down) reste inchangé.
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const loadAll = async () => {
    if (!currentUser) {
      setNotes([]);
      setFolders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ data: noteRows, error: noteErr }, { data: folderRows, error: folderErr }] = await Promise.all([
        supabase.from('notes').select('*'),
        supabase.from('note_folders').select('*').eq('user_id', currentUser.uid).order('sort_order', { ascending: true }),
      ]);
      if (noteErr) throw noteErr;
      if (folderErr) throw folderErr;

      const loaded: StoredNote[] = ((noteRows as NoteRow[]) || []).map((item) => ({
        id: item.id,
        title: item.title || 'Note',
        content: item.body || '',
        category: 'Autre',
        agencyId: item.agency_id || 'all',
        folderId: item.folder_id,
        createdByUserId: item.user_id || '',
        createdByEmail: '',
        createdByName: item.user_id === currentUser.uid ? (userProfile?.displayName || currentUser.email || 'Vous') : 'Collaborateur',
        createdAt: item.created_at || new Date().toISOString(),
        updatedAt: item.updated_at || item.created_at || new Date().toISOString(),
      }));

      setNotes(loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setFolders(
        ((folderRows as NoteFolderRow[]) || []).map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parent_id,
          sortOrder: f.sort_order ?? 0,
        }))
      );
    } catch (err) {
      console.error('Erreur lecture notes :', err);
      setError('Impossible de charger les notes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const agencyNotes = useMemo(() => {
    if (activeAgency.id === 'all') return notes;
    return notes.filter((note) => note.agencyId === activeAgency.id);
  }, [notes, activeAgency.id]);

  const searchValue = search.trim().toLowerCase();
  const searching = searchValue.length > 0;

  const filteredNotes = useMemo(() => {
    if (!searching) return agencyNotes;
    return agencyNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(searchValue) ||
        note.content.toLowerCase().includes(searchValue) ||
        (note.contactName || '').toLowerCase().includes(searchValue) ||
        (note.createdByName || '').toLowerCase().includes(searchValue)
    );
  }, [agencyNotes, searchValue, searching]);

  // Notes affichées : soit le résultat de la recherche (tous dossiers
  // confondus), soit celles du dossier ouvert (ou "non classées" si aucun
  // dossier n'est ouvert).
  const displayedNotes = useMemo(() => {
    if (searching) return filteredNotes;
    return agencyNotes.filter((n) => n.folderId === currentFolderId);
  }, [searching, filteredNotes, agencyNotes, currentFolderId]);

  const currentFolder = folders.find((f) => f.id === currentFolderId) || null;
  const rootFolders = folders.filter((f) => f.parentId === null);
  // Ticket #115 : sous-dossiers du dossier actuellement ouvert (vue mobile en
  // tuiles) — vide à la racine ou dans "Non classées", qui ne sont pas de
  // vrais dossiers pouvant avoir des enfants.
  const subfoldersOfCurrent =
    currentFolderId && currentFolderId !== '__unfiled__'
      ? folders.filter((f) => f.parentId === currentFolderId)
      : [];
  const unfiledCount = agencyNotes.filter((n) => !n.folderId).length;

  // Ticket #115 : liste indentée de TOUS les dossiers (racine + imbriqués),
  // pour que "Déplacer une note" permette de viser un sous-dossier — avant,
  // seuls les dossiers racine étaient proposés, les sous-dossiers étaient
  // inatteignables depuis ce menu.
  const folderTree = useMemo(() => {
    const byParent = new Map<string | null, NoteFolder[]>();
    folders.forEach((f) => {
      const list = byParent.get(f.parentId) || [];
      list.push(f);
      byParent.set(f.parentId, list);
    });
    const out: { folder: NoteFolder; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      (byParent.get(parentId) || []).forEach((f) => {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  }, [folders]);

  // Signalé : "replie par défaut les dossiers" — variante de l'arborescence
  // ci-dessus pour la COLONNE BUREAU uniquement : un dossier ayant des
  // sous-dossiers ne les affiche que s'il est dans `expandedFolderIds`
  // (vide par défaut = tout replié). `folderTree` (non filtré, ci-dessus)
  // reste utilisé tel quel pour la modale "Déplacer une note", qui doit
  // toujours proposer toutes les destinations, repliées ou non.
  const desktopFolderTree = useMemo(() => {
    const byParent = new Map<string | null, NoteFolder[]>();
    folders.forEach((f) => {
      const list = byParent.get(f.parentId) || [];
      list.push(f);
      byParent.set(f.parentId, list);
    });
    const out: { folder: NoteFolder; depth: number; hasChildren: boolean }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      (byParent.get(parentId) || []).forEach((f) => {
        const hasChildren = byParent.has(f.id);
        out.push({ folder: f, depth, hasChildren });
        if (hasChildren && expandedFolderIds.has(f.id)) walk(f.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  }, [folders, expandedFolderIds]);

  // Vue bureau uniquement : la colonne "toutes les notes" ignore le filtre
  // par dossier de la navigation mobile — elle a son propre sélecteur.
  const [desktopFolderFilter, setDesktopFolderFilter] = useState<string | null>('__all__');
  const desktopNotes = useMemo(() => {
    if (searching) return filteredNotes;
    if (desktopFolderFilter === '__all__') return agencyNotes;
    if (desktopFolderFilter === '__unfiled__') return agencyNotes.filter((n) => !n.folderId);
    return agencyNotes.filter((n) => n.folderId === desktopFolderFilter);
  }, [searching, filteredNotes, agencyNotes, desktopFolderFilter]);

  useEffect(() => {
    if (!desktopNotes.find((n) => n.id === selectedNoteId)) {
      setSelectedNoteId(desktopNotes[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopNotes]);

  const selectedNote = desktopNotes.find((n) => n.id === selectedNoteId) || null;

  // Signalé : "je sélectionne un dossier, je crée la note et elle se met
  // dans Non classée" — la création utilisait toujours `currentFolderId`
  // (navigation mobile en tuiles), jamais `desktopFolderFilter` (sélecteur
  // de la colonne de gauche, vue bureau) : sur ordinateur, une note créée
  // partait donc systématiquement en Non classée, quel que soit le dossier
  // sélectionné. On priorise le dossier mobile ouvert s'il y en a un
  // (drill-down explicite), sinon le dossier bureau sélectionné.
  const activeCreateFolderId = useMemo(() => {
    if (currentFolderId && currentFolderId !== '__unfiled__') return currentFolderId;
    if (desktopFolderFilter && desktopFolderFilter !== '__all__' && desktopFolderFilter !== '__unfiled__') return desktopFolderFilter;
    return null;
  }, [currentFolderId, desktopFolderFilter]);
  const activeCreateFolder = folders.find((f) => f.id === activeCreateFolderId) || null;

  const resetForm = () => {
    setTitle('');
    setContent('');
    setCategory('Général');
    setSelectedContactId('');
    setEditingNote(null);
  };

  const openEdit = (note: StoredNote) => {
    setEditingNote(note);
    setTitle(note.title);
    setContent(note.content);
    setCategory(note.category || 'Général');
    setSelectedContactId(note.contactId || '');
    setShowAdd(true);
    setOpenMenuNoteId(null);
  };

  const handleSaveNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser) {
      setError('Utilisateur non authentifié.');
      return;
    }
    if (!title.trim()) {
      setError('Le titre est obligatoire.');
      return;
    }
    if (!content.trim()) {
      setError('Le contenu de la note est obligatoire.');
      return;
    }

    const matchedContact = contacts.find((c) => c.id === selectedContactId);
    let agencyId = activeAgency.id;
    if (activeAgency.id === 'all') {
      agencyId = matchedContact?.agencyId || '';
      if (!agencyId) {
        setError("Sélectionnez une structure ou liez la note à un client avant de l'enregistrer.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingNote) {
        const { error: err } = await supabase
          .from('notes')
          .update({ title: title.trim(), body: content.trim(), updated_at: new Date().toISOString() })
          .eq('id', editingNote.id);
        if (err) throw err;
        setSuccess('La note a été mise à jour.');
      } else {
        const { error: err } = await supabase.from('notes').insert({
          agency_id: agencyId,
          user_id: currentUser.uid,
          title: title.trim(),
          body: content.trim(),
          folder_id: activeCreateFolderId,
        });
        if (err) throw err;
        setSuccess('La note a été enregistrée.');
      }

      resetForm();
      setShowAdd(false);
      await loadAll();
    } catch (saveError) {
      console.error('Erreur enregistrement note :', saveError);
      setError("La note n'a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  };

  const canDeleteNote = (note: StoredNote) =>
    userProfile?.role === 'super_admin' || note.createdByUserId === currentUser?.uid;

  const handleDelete = async (note: StoredNote) => {
    if (!currentUser || !canDeleteNote(note)) {
      setError('Seul le créateur de la note ou le Super Admin peut la supprimer.');
      return;
    }
    if (!window.confirm(`Supprimer la note "${note.title}" ?`)) return;

    setDeletingId(note.id);
    setError(null);
    setSuccess(null);
    try {
      const { error: err } = await supabase.from('notes').delete().eq('id', note.id);
      if (err) throw err;
      setSuccess('La note a été supprimée.');
      await loadAll();
    } catch (deleteError) {
      console.error('Erreur suppression note :', deleteError);
      setError('Impossible de supprimer la note.');
    } finally {
      setDeletingId(null);
    }
  };

  const moveNoteToFolder = async (note: StoredNote, folderId: string | null) => {
    try {
      const { error: err } = await supabase.from('notes').update({ folder_id: folderId }).eq('id', note.id);
      if (err) throw err;
      setMovingNote(null);
      await loadAll();
    } catch (e) {
      setError((e as Error).message || 'Impossible de déplacer la note.');
    }
  };

  // Ticket #115 : `parent_id` était toujours forcé à `null` ici, quel que
  // soit le dossier ouvert au moment de la création — un "sous-dossier" créé
  // depuis l'intérieur d'un dossier se retrouvait donc toujours à la racine
  // au lieu d'être imbriqué. On utilise maintenant le dossier actuellement
  // ouvert comme parent ("Non classées" n'est pas un vrai dossier -> racine).
  const createFolder = async () => {
    if (!currentUser || !folderNameInput.trim()) return;
    const parentId = currentFolderId && currentFolderId !== '__unfiled__' ? currentFolderId : null;
    setSaving(true);
    try {
      const { error: err } = await supabase.from('note_folders').insert({
        user_id: currentUser.uid,
        agency_id: activeAgency.id !== 'all' ? activeAgency.id : null,
        parent_id: parentId,
        scope: 'personal',
        name: folderNameInput.trim(),
        sort_order: folders.length,
      });
      if (err) throw err;
      setFolderNameInput('');
      setShowFolderModal(null);
      await loadAll();
    } catch (e) {
      setError((e as Error).message || 'Impossible de créer le dossier.');
    } finally {
      setSaving(false);
    }
  };

  // Ticket #115 : drag and drop d'un dossier sur un autre pour l'y imbriquer
  // — avec garde-fou contre les cycles (un dossier déposé sur lui-même ou
  // sur l'un de ses propres descendants, ce qui casserait l'arborescence).
  const isDescendantOf = (candidateId: string, ancestorId: string): boolean => {
    let node = folders.find((f) => f.id === candidateId);
    while (node?.parentId) {
      if (node.parentId === ancestorId) return true;
      node = folders.find((f) => f.id === node!.parentId);
    }
    return false;
  };

  const moveFolderToFolder = async (folderId: string, targetFolderId: string) => {
    if (folderId === targetFolderId) return;
    if (isDescendantOf(targetFolderId, folderId)) {
      setError('Impossible de déplacer un dossier dans l’un de ses propres sous-dossiers.');
      return;
    }
    try {
      const { error: err } = await supabase.from('note_folders').update({ parent_id: targetFolderId }).eq('id', folderId);
      if (err) throw err;
      // Signalé (30/08/2026) : "quand on met un dossier dans un dossier, on
      // a un refresh de la page, je n'en veux pas" — `loadAll()` recharge
      // ET remplace tout (dossiers ET notes) depuis zéro, ce qui vide puis
      // repeuple la liste (flash visible, arborescence dépliée perdue).
      // Un seul dossier a changé de parent : mise à jour locale ciblée,
      // sans aucun aller-retour réseau supplémentaire.
      setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, parentId: targetFolderId } : f)));
    } catch (e) {
      setError((e as Error).message || 'Impossible de déplacer ce dossier.');
    }
  };

  const renameFolder = async (folder: NoteFolder) => {
    if (!folderNameInput.trim()) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.from('note_folders').update({ name: folderNameInput.trim() }).eq('id', folder.id);
      if (err) throw err;
      setFolderNameInput('');
      setShowFolderModal(null);
      await loadAll();
    } catch (e) {
      setError((e as Error).message || 'Impossible de renommer le dossier.');
    } finally {
      setSaving(false);
    }
  };

  const deleteFolder = async (folder: NoteFolder) => {
    const count = agencyNotes.filter((n) => n.folderId === folder.id).length;
    const subfolderCount = folders.filter((f) => f.parentId === folder.id).length;
    const parts = [count > 0 ? `${count} note(s) déplacée(s) dans "Non classées"` : null,
      subfolderCount > 0 ? `${subfolderCount} sous-dossier(s) remonté(s) d'un niveau` : null].filter(Boolean);
    const msg = parts.length > 0
      ? `Supprimer le dossier "${folder.name}" ? ${parts.join(', ')}.`
      : `Supprimer le dossier "${folder.name}" ?`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      await supabase.from('notes').update({ folder_id: null }).eq('folder_id', folder.id);
      // Ticket #115 : sans ça, supprimer un dossier laissait ses
      // sous-dossiers avec un `parent_id` pointant vers un dossier qui
      // n'existe plus — invisibles nulle part. On les remonte au parent du
      // dossier supprimé (ou à la racine s'il n'en avait pas).
      await supabase.from('note_folders').update({ parent_id: folder.parentId }).eq('parent_id', folder.id);
      const { error: err } = await supabase.from('note_folders').delete().eq('id', folder.id);
      if (err) throw err;
      if (currentFolderId === folder.id) setCurrentFolderId(folder.parentId);
      await loadAll();
    } catch (e) {
      setError((e as Error).message || 'Impossible de supprimer le dossier.');
    } finally {
      setSaving(false);
    }
  };

  const noteCountInFolder = (folderId: string) => agencyNotes.filter((n) => n.folderId === folderId).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      {/* HEADER */}
      {/* Signalé (30/08/2026, capture à l'appui) : "améliore le haut car on
          ne voit pas les écritures" — ce bandeau n'avait aucun fond propre,
          le texte blanc flottait directement sur la photo de fond de page
          (bgImage), illisible selon la photo. Fond opaque ajouté, comme les
          autres en-têtes de page de l'appli. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#0a1e20]/95 border border-white/10 rounded-2xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/30 text-[#F9C977] flex items-center justify-center font-bold shrink-0">
            <FileEdit className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            {currentFolderId && !searching ? (
              <button
                onClick={() => setCurrentFolderId(null)}
                className="flex items-center gap-1.5 text-sm font-bold text-white hover:text-[#F9C977] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {currentFolder?.name || 'Dossier'}
              </button>
            ) : (
              <h1 className="text-xl font-bold text-white">Bloc-Notes & Remarques</h1>
            )}
            <p className="text-xs text-gray-400">
              {searching ? `${filteredNotes.length} résultat(s)` : `${displayedNotes.length} note(s)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher une note ou un client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#07191b] border border-[#144447] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
            />
          </div>

          {!currentFolderId && !searching && (
            <button
              onClick={() => { setFolderNameInput(''); setShowFolderModal('new'); }}
              className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center gap-2 shrink-0"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Nouveau dossier</span>
            </button>
          )}

          <button
            onClick={() => { resetForm(); setError(null); setSuccess(null); setShowAdd(true); }}
            className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Nouvelle Note</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-emerald-300 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-3xl">
          <Loader2 className="w-8 h-8 animate-spin text-[#F9C977] mx-auto mb-3" />
          <span>Chargement des notes...</span>
        </div>
      ) : (
        <>
          {/* Vue bureau — dossiers / liste / contenu, façon Notes iPhone en
              paysage. Cachée sous lg, où la navigation mobile en tuiles
              (ci-dessous) reste inchangée. */}
          <div className="hidden lg:grid grid-cols-[220px_320px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[420px]">
            {/* Colonne dossiers */}
            <div className="bg-[#07191b] border border-[#144447] rounded-2xl p-2 overflow-y-auto custom-scrollbar space-y-1">
              <button
                onClick={() => setDesktopFolderFilter('__all__')}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  desktopFolderFilter === '__all__' ? 'bg-[#F7BC5F]/15 text-[#F9C977]' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2"><FileEdit className="w-3.5 h-3.5" /> Toutes les notes</span>
                <span className="text-[10px] text-slate-500">{agencyNotes.length}</span>
              </button>
              {/* Signalé : "replie par défaut les dossiers" — arborescence
                  repliable (desktopFolderTree), chevron pour déplier un
                  dossier ayant des sous-dossiers. Chaque ligne est aussi
                  une zone de dépose : glisser une note dessus la déplace
                  (même mécanisme que le bouton "Déplacer", en plus rapide). */}
              {desktopFolderTree.map(({ folder, depth, hasChildren }) => (
                <button
                  key={folder.id}
                  onClick={() => setDesktopFolderFilter(folder.id)}
                  onDragOver={(e) => { if (draggedNoteId || (draggedFolderId && draggedFolderId !== folder.id)) { e.preventDefault(); setDragOverFolderId(folder.id); } }}
                  onDragLeave={() => setDragOverFolderId((cur) => (cur === folder.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolderId(null);
                    if (draggedNoteId) {
                      const n = agencyNotes.find((x) => x.id === draggedNoteId);
                      if (n) void moveNoteToFolder(n, folder.id);
                      setDraggedNoteId(null);
                    } else if (draggedFolderId && draggedFolderId !== folder.id) {
                      void moveFolderToFolder(draggedFolderId, folder.id);
                      setDraggedFolderId(null);
                    }
                  }}
                  style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
                  className={`w-full text-left py-2.5 pr-3 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                    desktopFolderFilter === folder.id ? 'bg-[#F7BC5F]/15 text-[#F9C977]' : 'text-slate-300 hover:bg-white/5'
                  } ${dragOverFolderId === folder.id ? 'ring-2 ring-[#F7BC5F]/50' : ''}`}
                >
                  <span className="flex items-center gap-1 truncate">
                    {hasChildren ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleFolderExpanded(folder.id); }}
                        className="p-0.5 -ml-0.5 rounded hover:bg-white/10 shrink-0"
                      >
                        {expandedFolderIds.has(folder.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </span>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <Folder className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{folder.name}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">{noteCountInFolder(folder.id)}</span>
                </button>
              ))}
              <button
                onClick={() => setDesktopFolderFilter('__unfiled__')}
                onDragOver={(e) => { if (draggedNoteId) { e.preventDefault(); setDragOverFolderId('__unfiled__'); } }}
                onDragLeave={() => setDragOverFolderId((cur) => (cur === '__unfiled__' ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverFolderId(null);
                  if (draggedNoteId) {
                    const n = agencyNotes.find((x) => x.id === draggedNoteId);
                    if (n) void moveNoteToFolder(n, null);
                    setDraggedNoteId(null);
                  }
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                  desktopFolderFilter === '__unfiled__' ? 'bg-[#F7BC5F]/15 text-[#F9C977]' : 'text-slate-300 hover:bg-white/5'
                } ${dragOverFolderId === '__unfiled__' ? 'ring-2 ring-[#F7BC5F]/50' : ''}`}
              >
                <span className="flex items-center gap-2"><Folder className="w-3.5 h-3.5" /> Non classées</span>
                <span className="text-[10px] text-slate-500">{unfiledCount}</span>
              </button>
              <button
                onClick={() => { setFolderNameInput(''); setShowFolderModal('new'); }}
                className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-white hover:bg-white/5 flex items-center gap-2 mt-2 border-t border-white/5 pt-3"
              >
                <FolderPlus className="w-3.5 h-3.5" /> Nouveau dossier
              </button>
            </div>

            {/* Colonne liste des notes */}
            <div className="bg-[#07191b] border border-[#144447] rounded-2xl overflow-y-auto custom-scrollbar divide-y divide-[#144447]/60">
              {desktopNotes.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">Aucune note ici.</div>
              ) : (
                desktopNotes.map((note) => (
                  <button
                    key={note.id}
                    draggable
                    onDragStart={() => setDraggedNoteId(note.id)}
                    onDragEnd={() => setDraggedNoteId(null)}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full text-left p-3.5 transition-colors cursor-grab active:cursor-grabbing ${
                      selectedNoteId === note.id ? 'bg-[#F7BC5F]/10' : 'hover:bg-white/5'
                    } ${draggedNoteId === note.id ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className="font-bold text-white text-sm truncate">{note.title}</h4>
                      <span className="text-[10px] text-slate-500 shrink-0">{new Date(note.updatedAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                    {note.contactName && (
                      <p className="text-[10px] text-teal-400 font-medium mb-1 truncate">{note.contactName}</p>
                    )}
                    <p className="text-xs text-slate-400 line-clamp-2">{note.content}</p>
                  </button>
                ))
              )}
            </div>

            {/* Colonne contenu de la note sélectionnée */}
            <div className="bg-[#07191b] border border-[#144447] rounded-2xl p-6 overflow-y-auto custom-scrollbar">
              {!selectedNote ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
                  <FileEdit className="w-8 h-8 text-slate-600" />
                  <span className="text-xs">Sélectionnez une note pour l'afficher ici.</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold text-white">{selectedNote.title}</h2>
                      {selectedNote.contactName && (
                        <p className="text-xs text-teal-400 font-medium flex items-center gap-1.5 mt-1">
                          <User className="w-3.5 h-3.5" /> {selectedNote.contactName}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-500 mt-1">
                        Modifiée le {new Date(selectedNote.updatedAt).toLocaleString('fr-FR')} · Créée par {selectedNote.createdByName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => openEdit(selectedNote)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white"
                        title="Modifier"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setMovingNote(selectedNote)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white"
                        title="Déplacer"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                      </button>
                      {canDeleteNote(selectedNote) && (
                        <button
                          onClick={() => void handleDelete(selectedNote)}
                          disabled={deletingId === selectedNote.id}
                          className="p-2 rounded-lg bg-white/5 hover:bg-rose-500/10 text-slate-300 hover:text-rose-300 disabled:opacity-50"
                          title="Supprimer"
                        >
                          {deletingId === selectedNote.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">{selectedNote.content}</p>
                </div>
              )}
            </div>
          </div>

          <div className="lg:hidden space-y-6">
          {/* DOSSIERS — racine, hors recherche. Glisser un dossier sur un
              autre l'y imbrique (ticket #115). */}
          {!currentFolderId && !searching && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {rootFolders.map((folder) => (
                <div
                  key={folder.id}
                  draggable
                  onDragStart={() => setDraggedFolderId(folder.id)}
                  onDragEnd={() => { setDraggedFolderId(null); setDragOverFolderId(null); }}
                  onDragOver={(e) => { if (draggedFolderId && draggedFolderId !== folder.id) { e.preventDefault(); setDragOverFolderId(folder.id); } }}
                  onDragLeave={() => setDragOverFolderId((cur) => (cur === folder.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolderId(null);
                    if (draggedFolderId && draggedFolderId !== folder.id) void moveFolderToFolder(draggedFolderId, folder.id);
                    setDraggedFolderId(null);
                  }}
                  className={`group relative p-4 bg-[#07191b] border rounded-2xl hover:border-[#F7BC5F]/40 transition-all cursor-pointer ${
                    dragOverFolderId === folder.id ? 'border-[#F7BC5F] ring-2 ring-[#F7BC5F]/40 scale-[1.02]' : 'border-[#144447]'
                  } ${draggedFolderId === folder.id ? 'opacity-40' : ''}`}
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  <Folder className="w-6 h-6 text-[#F9C977] mb-2" />
                  <p className="text-xs font-bold text-white truncate">{folder.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {noteCountInFolder(folder.id)} note(s)
                    {folders.some((f) => f.parentId === folder.id) ? ` · ${folders.filter((f) => f.parentId === folder.id).length} sous-dossier(s)` : ''}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFolderNameInput(folder.name);
                      setShowFolderModal(folder);
                    }}
                    className="absolute top-2 right-2 p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              <div
                className="p-4 bg-[#07191b]/50 border border-dashed border-[#144447] rounded-2xl hover:border-[#F7BC5F]/40 transition-all cursor-pointer flex flex-col items-center justify-center text-center min-h-[92px]"
                onClick={() => setCurrentFolderId('__unfiled__' as any)}
              >
                <Folder className="w-6 h-6 text-slate-500 mb-2" />
                <p className="text-xs font-bold text-slate-400">Non classées</p>
                <p className="text-[10px] text-slate-600 mt-0.5">{unfiledCount} note(s)</p>
              </div>
            </div>
          )}

          {/* SOUS-DOSSIERS du dossier ouvert (ticket #115) — jusqu'ici
              invisibles une fois entré dans un dossier, même quand ils
              existaient déjà en base (`note_folders.parent_id`). */}
          {currentFolderId && currentFolderId !== '__unfiled__' && !searching && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {subfoldersOfCurrent.map((folder) => (
                <div
                  key={folder.id}
                  draggable
                  onDragStart={() => setDraggedFolderId(folder.id)}
                  onDragEnd={() => { setDraggedFolderId(null); setDragOverFolderId(null); }}
                  onDragOver={(e) => { if (draggedNoteId || (draggedFolderId && draggedFolderId !== folder.id)) { e.preventDefault(); setDragOverFolderId(folder.id); } }}
                  onDragLeave={() => setDragOverFolderId((cur) => (cur === folder.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolderId(null);
                    if (draggedNoteId) {
                      const n = agencyNotes.find((x) => x.id === draggedNoteId);
                      if (n) void moveNoteToFolder(n, folder.id);
                      setDraggedNoteId(null);
                    } else if (draggedFolderId && draggedFolderId !== folder.id) {
                      void moveFolderToFolder(draggedFolderId, folder.id);
                      setDraggedFolderId(null);
                    }
                  }}
                  className={`group relative p-4 bg-[#07191b] border rounded-2xl hover:border-[#F7BC5F]/40 transition-all cursor-pointer ${
                    dragOverFolderId === folder.id ? 'border-[#F7BC5F] ring-2 ring-[#F7BC5F]/40 scale-[1.02]' : 'border-[#144447]'
                  } ${draggedFolderId === folder.id ? 'opacity-40' : ''}`}
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  <Folder className="w-6 h-6 text-[#F9C977] mb-2" />
                  <p className="text-xs font-bold text-white truncate">{folder.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{noteCountInFolder(folder.id)} note(s)</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFolderNameInput(folder.name);
                      setShowFolderModal(folder);
                    }}
                    className="absolute top-2 right-2 p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              <div
                className="p-4 bg-[#07191b]/50 border border-dashed border-[#144447] rounded-2xl hover:border-[#F7BC5F]/40 transition-all cursor-pointer flex flex-col items-center justify-center text-center min-h-[92px]"
                onClick={() => { setFolderNameInput(''); setShowFolderModal('new'); }}
              >
                <FolderPlus className="w-6 h-6 text-slate-500 mb-2" />
                <p className="text-xs font-bold text-slate-400">Nouveau sous-dossier</p>
              </div>
            </div>
          )}

          {/* NOTES — dossier ouvert ("Non classées" utilise un id spécial), ou résultats de recherche */}
          {(currentFolderId || searching) && (
            (() => {
              const isUnfiled = currentFolderId === '__unfiled__';
              const notesToShow = searching ? filteredNotes : agencyNotes.filter((n) => (isUnfiled ? !n.folderId : n.folderId === currentFolderId));
              if (notesToShow.length === 0) {
                return (
                  <div className="p-12 text-center text-xs text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-3xl flex flex-col items-center justify-center gap-2">
                    <FileEdit className="w-8 h-8 text-slate-600" />
                    <span>Aucune note ici pour le moment.</span>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {notesToShow.map((note) => (
                    <div
                      key={note.id}
                      draggable
                      onDragStart={() => setDraggedNoteId(note.id)}
                      onDragEnd={() => setDraggedNoteId(null)}
                      className={`p-5 bg-[#07191b] border border-[#144447] rounded-2xl space-y-3 flex flex-col justify-between hover:border-[#226368] transition-all shadow-md relative cursor-grab active:cursor-grabbing ${
                        draggedNoteId === note.id ? 'opacity-40' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <span className="text-[10px] text-slate-400">{new Date(note.updatedAt).toLocaleString('fr-FR')}</span>
                          <div className="relative">
                            <button
                              onClick={() => setOpenMenuNoteId(openMenuNoteId === note.id ? null : note.id)}
                              className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>
                            {openMenuNoteId === note.id && (
                              <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-[#0b292b] border border-[#1c4448] rounded-xl shadow-2xl p-1.5 space-y-0.5">
                                <button
                                  onClick={() => openEdit(note)}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-white/5"
                                >
                                  <Pencil className="w-3.5 h-3.5" /> Modifier
                                </button>
                                <button
                                  onClick={() => { setMovingNote(note); setOpenMenuNoteId(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-white/5"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" /> Déplacer
                                </button>
                                {canDeleteNote(note) && (
                                  <button
                                    onClick={() => { setOpenMenuNoteId(null); void handleDelete(note); }}
                                    disabled={deletingId === note.id}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                                  >
                                    {deletingId === note.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                    Supprimer
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {note.contactName && (
                          <div className="flex items-center gap-1.5 text-xs text-teal-400 font-medium mb-1.5">
                            <User className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                            <span>{note.contactName}</span>
                          </div>
                        )}

                        <h3 className="font-bold text-white text-base mb-1">{note.title}</h3>
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line line-clamp-4">{note.content}</p>
                      </div>

                      <div className="pt-3 border-t border-[#144447]/60">
                        <span className="text-[9px] text-slate-500 truncate">Créée par {note.createdByName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
          </div>
        </>
      )}

      {/* MODALE CRÉATION / ÉDITION */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#07191b] border border-[#144447] rounded-2xl max-w-md w-full p-6 text-white shadow-2xl">
            <h3 className="text-lg font-bold mb-1 text-[#F7BC5F] flex items-center gap-2">
              <FileEdit className="w-5 h-5" />
              <span>{editingNote ? 'Modifier la note' : 'Rédiger une note'}</span>
            </h3>
            {/* Signalé : "je sélectionne un dossier, je crée la note et
                elle se met dans Non classée" — repère explicite de la
                destination réelle, pour que ce soit visible avant même
                d'enregistrer. */}
            {!editingNote && (
              <p className="text-[11px] text-slate-400 mb-4 flex items-center gap-1.5">
                <Folder className="w-3 h-3 shrink-0" />
                Sera enregistrée dans « {activeCreateFolder?.name || 'Non classées'} »
              </p>
            )}
            {editingNote && <div className="mb-4" />}

            <form onSubmit={handleSaveNote} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">Titre de la note</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Compte-rendu entretien téléphonique"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>

              {!editingNote && (
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-300">Client lié (optionnel)</label>
                  <select
                    value={selectedContactId}
                    onChange={(e) => setSelectedContactId(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  >
                    <option value="">-- Aucun client lié --</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">Contenu / Remarques</label>
                <textarea
                  rows={5}
                  required
                  placeholder="Saisissez vos remarques détaillées..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { resetForm(); setShowAdd(false); }}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-slate-950 bg-[#F7BC5F] hover:bg-[#d9ab38] rounded-xl shadow-lg cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {saving ? 'Enregistrement...' : editingNote ? 'Mettre à jour' : 'Enregistrer la note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE DOSSIER (créer / renommer / supprimer) */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#07191b] border border-[#144447] rounded-2xl max-w-sm w-full p-6 text-white shadow-2xl">
            <h3 className="text-base font-bold mb-4 text-[#F7BC5F]">
              {showFolderModal === 'new' ? 'Nouveau dossier' : 'Renommer le dossier'}
            </h3>
            <input
              type="text"
              autoFocus
              placeholder="Nom du dossier"
              value={folderNameInput}
              onChange={(e) => setFolderNameInput(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] mb-4"
            />
            <div className="flex justify-between items-center gap-3">
              {showFolderModal !== 'new' && (
                <button
                  onClick={() => { const f = showFolderModal as NoteFolder; setShowFolderModal(null); void deleteFolder(f); }}
                  className="text-xs font-semibold text-rose-300 hover:text-rose-200 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              )}
              <div className="flex justify-end gap-3 flex-1">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(null)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  onClick={() => (showFolderModal === 'new' ? void createFolder() : void renameFolder(showFolderModal as NoteFolder))}
                  disabled={saving || !folderNameInput.trim()}
                  className="px-5 py-2 text-xs font-bold text-slate-950 bg-[#F7BC5F] hover:bg-[#d9ab38] rounded-xl disabled:opacity-50"
                >
                  {showFolderModal === 'new' ? 'Créer' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALE DÉPLACER UNE NOTE */}
      {movingNote && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#07191b] border border-[#144447] rounded-2xl max-w-sm w-full p-6 text-white shadow-2xl">
            <h3 className="text-base font-bold mb-4 text-[#F7BC5F]">Déplacer "{movingNote.title}"</h3>
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              <button
                onClick={() => void moveNoteToFolder(movingNote, null)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${!movingNote.folderId ? 'bg-[#F7BC5F]/15 text-[#F7BC5F]' : 'text-slate-300 hover:bg-white/5'}`}
              >
                <Folder className="w-3.5 h-3.5" /> Non classées
              </button>
              {folderTree.map(({ folder, depth }) => (
                <button
                  key={folder.id}
                  onClick={() => void moveNoteToFolder(movingNote, folder.id)}
                  style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
                  className={`w-full text-left py-2.5 pr-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${movingNote.folderId === folder.id ? 'bg-[#F7BC5F]/15 text-[#F7BC5F]' : 'text-slate-300 hover:bg-white/5'}`}
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{folder.name}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <button onClick={() => setMovingNote(null)} className="px-4 py-2 text-xs text-slate-400 hover:text-white">Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotesView;
