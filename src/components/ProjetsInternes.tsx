import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase } from '@/lib/supabase';

import {
  CheckCircle2,
  Clock,
  FolderKanban,
  GripVertical,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Pencil,
  Pin,
  Plus,
  Trash2,
  User,
} from 'lucide-react';

import {
  InternalProject,
} from '@/types';

import {
  NovaSphereUserProfile,
  useAuth,
} from '@/context/AuthContext';

import { InternalProjectBoard } from './InternalProjectBoard';
import KanbanBoardsView from './KanbanBoardsView';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface ProjetsInternesProps {
  agencyId: string;
  // Signalé (8 septembre) : cliquer sur la notification d'un message posté
  // sur une carte de projet interne n'amenait qu'à la liste des projets, pas
  // à la carte elle-même — l'utilisateur devait retrouver le bon projet puis
  // la bonne carte à la main. Même principe que `initialHighlightMessageId`
  // côté Chat : la notification transmet l'id de la tâche, on retrouve son
  // projet et on l'ouvre directement dessus.
  initialOpenTaskId?: string | null;
  onOpenTaskConsumed?: () => void;
  // Signalé (16 septembre, Novavisio/Diane) : « en cliquant sur la
  // notification cela ne nous emmène pas à son message » — même principe
  // que ci-dessus, mais pour le message précis à l'intérieur de la carte
  // (voir InternalProjectBoard.tsx).
  initialHighlightMessageId?: string | null;
  onHighlightMessageConsumed?: () => void;
}

interface StoredInternalProject
  // `deadline` et `assignedMember` viennent du modèle d'origine et ne sont
  // pas portés par la table task_boards : déclarés optionnels ici plutôt
  // qu'obligatoires et jamais renseignés.
  extends Omit<InternalProject, 'deadline' | 'assignedMember'> {
  deadline?: string;
  assignedMember?: string;
  assignedUserId?: string;

  createdByUserId: string;
  // Jamais renseignés par le chargement depuis la base : optionnels plutôt
  // qu'obligatoires et toujours absents.
  createdByEmail?: string;
  createdByName?: string;

  createdAt: string;
  updatedAt: string;
  sortOrder: number;
}

// Demande explicite : ce statut (À faire/En cours/À vérifier/Terminé)
// existe déjà au niveau du tableau de tâches propre à chaque projet
// (InternalProjectBoard.tsx, COLUMNS) — ici, il ne sert plus qu'à colorer
// un badge sur la carte (voir affichage alphabétique grille/liste
// ci-dessous), plus à grouper des colonnes.
const STATUS_ACCENT: Record<InternalProject['status'], string> = {
  'À faire': '#38BDF8',
  'En cours': '#F7BC5F',
  'À vérifier': '#A78BFA',
  'Terminé': '#34D399',
};

// `task_boards.status` (colonne dédiée, migration 20260826200000) stocke des
// valeurs stables en base (jamais l'accent/l'espace du libellé affiché).
const DB_STATUS_TO_LABEL: Record<string, InternalProject['status']> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  a_verifier: 'À vérifier',
  termine: 'Terminé',
};

export const ProjetsInternes: React.FC<
  ProjetsInternesProps
> = ({
  agencyId,
  initialOpenTaskId,
  onOpenTaskConsumed,
  initialHighlightMessageId,
  onHighlightMessageConsumed,
}) => {
  const {
    currentUser,
    userProfile,
    activeAgency,
  } = useAuth();

  const [
    projects,
    setProjects,
  ] = useState<
    StoredInternalProject[]
  >([]);

  const [
    users,
    setUsers,
  ] = useState<
    NovaSphereUserProfile[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    deletingId,
    setDeletingId,
  ] = useState<string | null>(
    null
  );

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    success,
    setSuccess,
  ] = useState<string | null>(
    null
  );

  const [
    showAddModal,
    setShowAddModal,
  ] = useState(false);

  // Demande urgente : deux onglets — "Projet" (tableau à colonnes déjà en
  // place) et "Liste" — corrigé sur demande explicite : "Liste" est un
  // tableau kanban totalement INDÉPENDANT de "Projet" (interface et
  // colonnes différentes, aucun bouton pour faire passer un élément de
  // l'un vers l'autre).
  const [pageTab, setPageTab] = useState<'projet' | 'liste' | 'tableaux'>('projet');
  const TODO_STATUS_OPTIONS = ['a_faire', 'en_cours', 'fait'] as const;
  const TODO_STATUS_LABEL: Record<(typeof TODO_STATUS_OPTIONS)[number], string> = {
    a_faire: 'À faire',
    en_cours: 'En cours',
    fait: 'Fait',
  };
  const TODO_STATUS_ACCENT: Record<(typeof TODO_STATUS_OPTIONS)[number], string> = {
    a_faire: '#94A3B8',
    en_cours: '#FB7185',
    fait: '#4ADE80',
  };
  const [todoItems, setTodoItems] = useState<{ id: string; text: string; status: (typeof TODO_STATUS_OPTIONS)[number]; sortOrder: number }[]>([]);
  const [todoLoading, setTodoLoading] = useState(true);
  const [newTodoText, setNewTodoText] = useState('');
  const todoInputRef = useRef<HTMLInputElement>(null);

  // Projets internes (phase 1) : tableau kanban des tâches d'un projet
  // ouvert — la liste des projets elle-même (ci-dessus) reste inchangée.
  const [openBoard, setOpenBoard] = useState<StoredInternalProject | null>(null);
  // Tâche à ouvrir directement une fois son projet trouvé (voir
  // `initialOpenTaskId` ci-dessus) — transmise à InternalProjectBoard qui
  // se charge d'ouvrir sa fiche détail dès que ses tâches sont chargées.
  const [taskToOpen, setTaskToOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!initialOpenTaskId || projects.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('internal_project_tasks')
        .select('board_id')
        .eq('id', initialOpenTaskId)
        .maybeSingle();
      if (cancelled) return;
      const boardId = (data as { board_id?: string } | null)?.board_id;
      const projet = boardId ? projects.find((p) => p.id === boardId) : undefined;
      if (projet) {
        setOpenBoard(projet);
        setTaskToOpen(initialOpenTaskId);
        setPageTab('projet');
      }
      onOpenTaskConsumed?.();
    })();
    return () => { cancelled = true; };
  }, [initialOpenTaskId, projects]);

  // Demande explicite : le statut À faire/En cours/À vérifier/Terminé
  // existe déjà au niveau de chaque CARTE de projet (via son tableau
  // interne, InternalProjectBoard) — plus besoin de le dupliquer en 4
  // colonnes ici. La liste des projets s'affiche donc à plat, triée par
  // ordre alphabétique, avec un choix grille/liste (même mécanisme que
  // "Tableaux", voir KanbanBoardsView.tsx).
  const [projectsViewMode, setProjectsViewMode] = useState<'grid' | 'list'>(() => {
    try { return (localStorage.getItem('projetsInternesViewMode') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; }
  });
  const setProjectsView = (mode: 'grid' | 'list') => {
    setProjectsViewMode(mode);
    try { localStorage.setItem('projetsInternesViewMode', mode); } catch { /* ignore */ }
  };

  const [
    title,
    setTitle,
  ] = useState('');

  const [
    description,
    setDescription,
  ] = useState('');

  const [
    deadline,
    setDeadline,
  ] = useState('');

  const [
    assignedUserId,
    setAssignedUserId,
  ] = useState('');

  /*
   * =====================================================
   * PROJETS SUPABASE TEMPS RÉEL
   * =====================================================
   */
  useEffect(() => {
    if (!currentUser) {
      setProjects([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    loadProjects(isMounted ? () => isMounted : undefined);

    return () => {
      isMounted = false;
    };
  }, [currentUser?.uid]);

  // Ticket "Projets internes" (suivi) : extrait hors du useEffect pour
  // pouvoir être rappelé après une création/suppression — avant, seul le
  // premier chargement (ou un rechargement complet de la page) rafraîchissait
  // la liste, donc un projet fraîchement créé n'apparaissait jamais tant
  // qu'on n'avait pas rechargé toute l'appli.
  const loadProjects = async (stillMounted?: () => boolean) => {
    try {
      const { data, error: sbError } = await supabase.from('task_boards').select('*');
      if (sbError) throw sbError;

      // Signalé : "la barre de progression n'est pas la même sur les
      // projets [carte, sans ouvrir] et [une fois dans] le projet" — le %
      // affiché sur la carte venait uniquement du statut MANUEL du projet
      // (`task_boards.status`, choisi une fois par son créateur), jamais des
      // vraies tâches du tableau kanban (`internal_project_tasks`) —
      // complètement déconnecté depuis que ces tâches existent (récupération
      // du backup). On calcule maintenant le % réel : tâches "Terminé" /
      // total des tâches de CE projet. Un projet sans aucune tâche garde
      // l'ancien calcul par statut manuel (sinon toujours bloqué à 0%).
      const { data: taskRows } = await supabase.from('internal_project_tasks').select('board_id, status');
      const progressByBoard: Record<string, { total: number; done: number }> = {};
      (taskRows || []).forEach((t: any) => {
        const bucket = (progressByBoard[t.board_id] ||= { total: 0, done: 0 });
        bucket.total += 1;
        if (t.status === 'termine') bucket.done += 1;
      });

      const rows: StoredInternalProject[] = (data || []).map((item: any) => {
        const taskProgress = progressByBoard[item.id];
        const fallbackProgress = item.status === 'termine' ? 100 : item.status === 'a_verifier' ? 75 : item.status === 'en_cours' ? 50 : 0;
        return {
        id: item.id,
        title: item.name,
        description: '',
        status: DB_STATUS_TO_LABEL[item.status as string] || 'À faire',
        progress: taskProgress && taskProgress.total > 0 ? Math.round((taskProgress.done / taskProgress.total) * 100) : fallbackProgress,
        // Signalé : "je ne peux pas l'affilier à un Stagiaire" — le
        // "Responsable" choisi à la création est maintenant réellement
        // enregistré (assigned_user_id) ; secours sur created_by pour les
        // projets créés avant ce correctif.
        assignedUserId: item.assigned_user_id || item.created_by || '',
        agencyId: item.agency_id || '',
        createdAt: item.created_at || new Date().toISOString(),
        updatedAt: item.updated_at || new Date().toISOString(),
        createdByUserId: item.created_by || '',
        sortOrder: typeof item.sort_order === 'number' ? item.sort_order : 0,
        };
      });

      if (!stillMounted || stillMounted()) {
        // Demande urgente : ordre vertical persistant à l'intérieur d'une
        // colonne (sort_order), plus seulement la date de mise à jour.
        setProjects(rows.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt)));
      }
    } catch (snapshotError) {
      console.error('Erreur lecture projets internes :', snapshotError);
      if (!stillMounted || stillMounted()) setError("Impossible de charger les projets internes.");
    } finally {
      if (!stillMounted || stillMounted()) setLoading(false);
    }
  };

  /*
   * =====================================================
   * UTILISATEURS ACTIFS
   * =====================================================
   */
  useEffect(() => {
    if (!currentUser) {
      setUsers([]);
      return;
    }

    let isMounted = true;
    const loadUsers = async () => {
      try {
        // Signalé : "je ne peux pas l'affilier à un Stagiaire" — role et
        // agencyIds étaient codés en dur ('commercial' / []) au lieu d'être
        // lus en base, ce qui faisait que le filtre par agence
        // (usersForAgency) excluait TOUT LE MONDE sauf en scope "all" —
        // personne n'apparaissait jamais dans "Responsable", stagiaire ou pas.
        const [{ data }, { data: roles }, { data: memberships }] = await Promise.all([
          supabase.from('profiles').select('*'),
          supabase.from('user_roles').select('user_id, role'),
          supabase.from('agency_members').select('user_id, agency_id'),
        ]);
        const rows = (data || [])
          .map((u: any) => ({
            uid: u.id,
            email: u.email || '',
            displayName: u.full_name || u.email || 'Membre',
            photoURL: u.avatar_url || null,
            role: (roles || []).find((r: any) => r.user_id === u.id)?.role || 'commercial',
            agencyIds: (memberships || []).filter((m: any) => m.user_id === u.id).map((m: any) => m.agency_id),
            active: u.is_active !== false,
            jobTitle: u.job_title || null,
          } as NovaSphereUserProfile))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

        if (isMounted) setUsers(rows);
      } catch (err) {
        console.error('Erreur chargement équipe projets :', err);
      }
    };

    loadUsers();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.uid]);

  // Demandé le 2 septembre : « pour épingler, c'est peut-être plus approprié,
  // de façon que les sujets les plus importants soient tout en haut ».
  // L'épingle est personnelle (chacun a ses priorités) et n'existe pas en
  // base : elle est mémorisée par navigateur, pour ce compte. Elle ne change
  // rien à l'ordre des autres projets — les épinglés passent devant, le reste
  // garde exactement l'ordre alphabétique actuel.
  const CLE_EPINGLES = `nova_projets_epingles_${currentUser?.uid || 'anon'}`;
  const [epingles, setEpingles] = useState<string[]>([]);
  useEffect(() => {
    try {
      const brut = localStorage.getItem(CLE_EPINGLES);
      setEpingles(brut ? (JSON.parse(brut) as string[]) : []);
    } catch {
      setEpingles([]);
    }
  }, [CLE_EPINGLES]);

  const basculerEpingle = (projectId: string) => {
    setEpingles((prev) => {
      const suivant = prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [projectId, ...prev];
      try { localStorage.setItem(CLE_EPINGLES, JSON.stringify(suivant)); } catch { /* stockage indisponible */ }
      return suivant;
    });
  };

  const visibleProjects =
    useMemo(() => {
      const effectiveAgencyId =
        agencyId ||
        activeAgency.id;

      const filtered =
        effectiveAgencyId === 'all'
          ? projects
          : projects.filter(
              (project) =>
                project.agencyId ===
                effectiveAgencyId
            );

      // Demande explicite : affichage par ordre alphabétique (la liste
      // n'est plus groupée par statut/colonnes, donc `sortOrder`, qui ne
      // servait qu'à mémoriser la position dans une colonne kanban, n'a
      // plus lieu d'ordonner cet affichage).
      // Les projets épinglés passent devant, sans rien changer à l'ordre
      // des autres.
      return [...filtered].sort(
        (a, b) =>
          Number(epingles.includes(b.id)) - Number(epingles.includes(a.id)) ||
          a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
      );
    }, [
      epingles,
      projects,
      agencyId,
      activeAgency.id,
    ]);

  const usersForAgency =
    useMemo(() => {
      const effectiveAgencyId =
        agencyId ||
        activeAgency.id;

      if (
        effectiveAgencyId ===
        'all'
      ) {
        return users;
      }

      return users.filter(
        (user) =>
          user.role ===
            'super_admin' ||
          user.agencyIds.includes(
            effectiveAgencyId
          )
      );
    }, [
      users,
      agencyId,
      activeAgency.id,
    ]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDeadline('');
    setAssignedUserId('');
  };

  const handleCreate =
    async (
      event: React.FormEvent
    ) => {
      event.preventDefault();

      if (!currentUser) {
        setError(
          'Utilisateur non authentifié.'
        );
        return;
      }

      if (!title.trim()) {
        setError(
          'Le titre du projet est obligatoire.'
        );
        return;
      }

      const effectiveAgencyId =
        agencyId ||
        activeAgency.id;

      if (
        effectiveAgencyId ===
        'all'
      ) {
        setError(
          "Sélectionnez une structure avant de créer un projet."
        );
        return;
      }

      const selectedUser =
        users.find(
          (user) =>
            user.uid ===
            assignedUserId
        );

      const now =
        new Date().toISOString();

      const defaultDeadline =
        new Date(
          Date.now() +
            14 *
              86400000
        )
          .toISOString()
          .split('T')[0];

      const projectId =
        `project-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      const project: StoredInternalProject =
        {
          id:
            projectId,

          title:
            title.trim(),

          description:
            description.trim(),

          status:
            'À faire',

          agencyId:
            effectiveAgencyId,

          deadline:
            deadline ||
            defaultDeadline,

          assignedMember:
            selectedUser
              ?.displayName ||
            userProfile
              ?.displayName ||
            currentUser
              .displayName ||
            currentUser.email ||
            'Non affecté',

          assignedUserId:
            selectedUser?.uid ||
            currentUser.uid,

          progress:
            0,

          sortOrder:
            0,

          createdByUserId:
            currentUser.uid,

          createdByEmail:
            currentUser.email
              ?.trim()
              .toLowerCase() ||
            '',

          createdByName:
            userProfile
              ?.displayName ||
            currentUser
              .displayName ||
            currentUser.email ||
            'Utilisateur Nova CRM',

          createdAt:
            now,

          updatedAt:
            now,
        };

      setSaving(true);
      setError(null);
      setSuccess(null);

      try {
        const { error: sbErr } = await supabase.from('task_boards').insert({
          agency_id: effectiveAgencyId,
          name: title.trim(),
          created_by: currentUser?.uid,
          // Signalé : "je ne peux pas l'affilier à un Stagiaire" — le
          // "Responsable" choisi dans le formulaire n'était jusqu'ici jamais
          // enregistré (seul created_by = créateur du projet l'était).
          assigned_user_id: selectedUser?.uid || currentUser?.uid,
          created_at: now,
          updated_at: now,
        });

        if (sbErr) throw sbErr;

        resetForm();
        setShowAddModal(false);

        setSuccess(
          'Le projet interne a été créé.'
        );

        await loadProjects();
      } catch (
        saveError
      ) {
        console.error(
          'Erreur création projet interne :',
          saveError
        );

        setError(
          "Le projet n'a pas pu être enregistré."
        );
      } finally {
        setSaving(false);
      }
    };

  // Onglet "Liste" — tableau kanban indépendant (3 colonnes propres, aucun
  // lien avec task_boards/"Projet").
  const effectiveAgencyIdForTodo = (agencyId && agencyId !== 'all') ? agencyId : activeAgency.id;

  const loadTodoItems = async () => {
    const { data } = await supabase
      .from('internal_todo_items' as any)
      .select('*')
      .eq('agency_id', effectiveAgencyIdForTodo)
      .order('sort_order', { ascending: true });
    setTodoItems(((data as any[]) || []).map((r) => ({ id: r.id, text: r.text, status: r.status, sortOrder: r.sort_order })));
  };

  useEffect(() => {
    if (!currentUser || pageTab !== 'liste') return;
    let cancelled = false;
    setTodoLoading(true);
    (async () => {
      await loadTodoItems();
      if (!cancelled) setTodoLoading(false);
    })();
    const channel = supabase
      .channel(`internal_todo_items:${effectiveAgencyIdForTodo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_todo_items', filter: `agency_id=eq.${effectiveAgencyIdForTodo}` }, () => {
        void loadTodoItems();
      })
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, pageTab, effectiveAgencyIdForTodo]);

  async function addTodoItem() {
    if (!newTodoText.trim() || !currentUser) return;
    const text = newTodoText.trim();
    setNewTodoText('');
    const { error: insErr } = await supabase.from('internal_todo_items' as any).insert({
      agency_id: effectiveAgencyIdForTodo, user_id: currentUser.uid, text, status: 'a_faire',
      sort_order: todoItems.filter((t) => t.status === 'a_faire').length,
    });
    if (insErr) setError("Impossible d'ajouter l'élément.");
  }

  async function deleteTodoItem(id: string) {
    setTodoItems((prev) => prev.filter((t) => t.id !== id));
    await supabase.from('internal_todo_items' as any).delete().eq('id', id);
  }

  // Glisser-déposer horizontal (changer de colonne) ET vertical (réordonner
  // dans la même colonne) — même principe que "Projet", mais totalement
  // indépendant (autre table, aucune interaction avec task_boards).
  // Demandé : en vue liste, pouvoir ranger les dossiers dans l'ordre voulu
  // par glisser-déposer. L'ordre est déjà stocké en base (`task_boards.
  // sort_order`, lu au chargement) — il n'était simplement modifiable
  // nulle part. Les rangs sont réattribués sur les dossiers VISIBLES
  // (la liste est filtrée par agence) ; ceux des autres agences gardent
  // le leur, le tri restant départagé par la date de mise à jour.
  function handleProjectsDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.index === source.index) return;

    const orderedIds = visibleProjects.map((p) => p.id);
    orderedIds.splice(source.index, 1);
    orderedIds.splice(destination.index, 0, draggableId);

    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    setProjects((prev) =>
      [...prev]
        .map((p) => (rank.has(p.id) ? { ...p, sortOrder: rank.get(p.id) as number } : p))
        .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt))
    );

    void Promise.all(
      orderedIds.map((id, index) => supabase.from('task_boards').update({ sort_order: index }).eq('id', id))
    ).catch((err) => {
      console.error('Erreur réorganisation des dossiers :', err);
      setError("Impossible d'enregistrer le nouvel ordre des dossiers.");
    });
  }

  function handleTodoDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId as (typeof TODO_STATUS_OPTIONS)[number];
    const destIds = todoItems.filter((t) => t.status === newStatus && t.id !== draggableId).map((t) => t.id);
    destIds.splice(destination.index, 0, draggableId);

    setTodoItems((prev) => prev.map((t) => {
      const idx = destIds.indexOf(t.id);
      if (idx === -1) return t;
      return t.id === draggableId ? { ...t, status: newStatus, sortOrder: idx } : { ...t, sortOrder: idx };
    }));

    void Promise.all(
      destIds.map((id, idx) =>
        supabase.from('internal_todo_items' as any).update({
          sort_order: idx,
          ...(id === draggableId ? { status: newStatus, updated_at: new Date().toISOString() } : {}),
        }).eq('id', id)
      )
    ).catch((err) => {
      console.error('Erreur réorganisation liste :', err);
      setError("Impossible d'enregistrer le nouvel ordre de la liste.");
      void loadTodoItems();
    });
  }

  const canDelete = (
    project: StoredInternalProject
  ) =>
    userProfile?.role ===
      'super_admin' ||
    project.createdByUserId ===
      currentUser?.uid;

  // Demande explicite : "je veux qu'on puisse modifier le nom des projets
  // internes" — même règle de permission que la suppression (créateur du
  // projet ou Super Admin), simple renommage de `task_boards.name` sans
  // toucher au reste du projet.
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startRenameProject = (project: StoredInternalProject) => {
    setRenamingProjectId(project.id);
    setRenameValue(project.title);
  };

  const cancelRenameProject = () => {
    setRenamingProjectId(null);
    setRenameValue('');
  };

  const saveRenameProject = async (project: StoredInternalProject) => {
    const nextTitle = renameValue.trim();
    if (!nextTitle || nextTitle === project.title) {
      cancelRenameProject();
      return;
    }
    setRenamingProjectId(null);
    // Mise à jour optimiste — évite d'attendre le round-trip serveur pour
    // voir le nouveau nom, comme le reste de cette vue (création/suppression).
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, title: nextTitle } : p)));
    try {
      const { error: renameError } = await supabase.from('task_boards').update({ name: nextTitle }).eq('id', project.id);
      if (renameError) throw renameError;
    } catch (err) {
      console.error('Erreur renommage projet :', err);
      setError("Impossible de renommer le projet.");
      await loadProjects();
    }
  };

  const handleDelete =
    async (
      project: StoredInternalProject
    ) => {
      if (
        !canDelete(
          project
        )
      ) {
        setError(
          "Seul le créateur du projet ou le Super Admin peut le supprimer."
        );
        return;
      }

      const confirmed =
        window.confirm(
          `Supprimer le projet "${project.title}" ?`
        );

      if (!confirmed) {
        return;
      }

      setDeletingId(
        project.id
      );
      setError(null);
      setSuccess(null);

      try {
        await supabase.from('task_boards').delete().eq('id', project.id);

        setSuccess(
          'Le projet a été supprimé.'
        );

        await loadProjects();
      } catch (
        deleteError
      ) {
        console.error(
          'Erreur suppression projet :',
          deleteError
        );

        setError(
          "Impossible de supprimer le projet."
        );
      } finally {
        setDeletingId(
          null
        );
      }
    };

  if (openBoard) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-white">
        <InternalProjectBoard
          scope={{ type: 'board', boardId: openBoard.id }}
          boardTitle={openBoard.title}
          agencyId={openBoard.agencyId}
          users={users}
          initialOpenTaskId={taskToOpen}
          onOpenTaskConsumed={() => setTaskToOpen(null)}
          initialHighlightMessageId={initialHighlightMessageId}
          onHighlightMessageConsumed={onHighlightMessageConsumed}
          onBack={() => setOpenBoard(null)}
          onRenamed={(title) => {
            // Le titre renommé depuis l'intérieur du projet doit se refléter
            // aussitôt dans la liste, sans rechargement.
            setOpenBoard((b) => (b ? { ...b, title } : b));
            setProjects((prev) => prev.map((p) => (p.id === openBoard.id ? { ...p, title } : p)));
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      {/* Header — carte opaque dédiée (pas toute la page, voir RappelsView.tsx) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#050f11] rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/30 text-[#F7BC5F] flex items-center justify-center font-bold">
            <FolderKanban className="w-5 h-5" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-white">
              Projets internes & Initiatives
            </h1>

            <p className="text-xs text-gray-400">
              Suivi partagé des objectifs stratégiques d'agence
            </p>
          </div>
        </div>

        {/* Affiché sur les deux onglets depuis le 31/08/2026 : c'est le seul
            moyen de créer un projet, le masquer sur l'onglet Liste n'apportait
            rien et obligeait à revenir en arrière pour le retrouver. */}
        {pageTab !== 'tableaux' && (
          <button
            onClick={() => {
              setError(null);
              setSuccess(null);
              setPageTab('projet');
              setShowAddModal(true);
            }}
            className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>+ Projet</span>
          </button>
        )}
        {pageTab === 'liste' && (
          <button
            onClick={() => todoInputRef.current?.focus()}
            className="bg-[#94A3B8] hover:bg-[#B0BEC9] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>+ Élément</span>
          </button>
        )}
      </div>

      {/* Onglets Projet / Liste */}
      <div className="flex items-center gap-2 bg-[#0b1719] border border-white/20 rounded-xl p-1 w-fit">
        <button
          onClick={() => setPageTab('projet')}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${pageTab === 'projet' ? 'bg-[#F7BC5F] text-slate-950' : 'text-gray-400 hover:text-white'}`}
        >
          Projet
        </button>
        <button
          onClick={() => setPageTab('liste')}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${pageTab === 'liste' ? 'bg-[#F7BC5F] text-slate-950' : 'text-gray-400 hover:text-white'}`}
        >
          To do liste
        </button>
        {/* Onglet "Tableaux" retiré (demande explicite) — le contenu associé
            (pageTab==='tableaux', KanbanBoardsView) reste dans le code mais
            n'est plus jamais atteignable, faute de bouton pour y aller. */}
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs">
          {success}
        </div>
      )}

      {pageTab === 'projet' && (loading ? (
        <div className="p-12 flex flex-col items-center justify-center gap-3 text-gray-400 bg-white/5 border border-white/10 rounded-2xl">
          <Loader2 className="w-7 h-7 animate-spin text-[#F7BC5F]" />

          <span className="text-xs">
            Chargement des projets...
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 bg-[#0b1719] border border-white/20 rounded-xl px-4 py-2.5">
            <p className="text-xs text-gray-400 flex-1">
              Chaque projet a son propre tableau de tâches (À faire / En cours / À vérifier / Terminé) — ouvrez-le pour suivre son avancement en détail.
            </p>
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => setProjectsView('grid')}
                title="Vue en grille"
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${projectsViewMode === 'grid' ? 'bg-[#F7BC5F] text-slate-950' : 'text-gray-400 hover:text-white'}`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setProjectsView('list')}
                title="Vue en liste"
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${projectsViewMode === 'list' ? 'bg-[#F7BC5F] text-slate-950' : 'text-gray-400 hover:text-white'}`}
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {visibleProjects.length === 0 ? (
            /* Signalé (31/08/2026) : impossible de créer un nouveau projet
               indépendant dans une agence. Le bouton « + Projet » existait,
               mais uniquement en haut de page — et cet écran vide n'offrait
               aucune issue.
               Le cas est devenu courant depuis le cloisonnement des projets
               internes posé le même jour : on ne voit plus que les projets
               auxquels on est invité, donc beaucoup d'agences affichent
               désormais cette page vide. Elle devait proposer la sortie. */
            <div className="p-12 text-center text-gray-500 bg-white/5 border border-dashed border-white/10 rounded-2xl">
              <FolderKanban className="w-9 h-9 mx-auto mb-3 text-gray-600" />
              <p className="text-sm">
                Aucun projet interne pour cette structure.
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Créez-en un pour commencer à suivre vos objectifs d'agence.
              </p>
              <button
                onClick={() => { setError(null); setSuccess(null); setShowAddModal(true); }}
                className="mt-5 bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-sm px-5 py-2.5 rounded-xl inline-flex items-center gap-2 shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>Créer un projet</span>
              </button>
            </div>
          ) : projectsViewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleProjects.map((project) => {
                const accent = STATUS_ACCENT[project.status];
                return (
                  <div
                    key={project.id}
                    // Demande explicite : même opacité (bleu canard plein)
                    // que les colonnes du pipeline et du tableau de projet.
                    className="p-4 bg-[#0a1e20] border-y border-r rounded-xl space-y-3 relative hover:border-[#F7BC5F]/40 border-l-4 transition-colors"
                    style={{ borderLeftColor: accent, borderTopColor: 'rgba(255,255,255,0.1)', borderRightColor: 'rgba(255,255,255,0.1)', borderBottomColor: 'rgba(255,255,255,0.1)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {renamingProjectId === project.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => void saveRenameProject(project)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRenameProject(project);
                            if (e.key === 'Escape') cancelRenameProject();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 bg-white/5 border border-[#F7BC5F]/50 rounded-lg px-2 py-1 text-sm font-bold text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      ) : (
                        <h3 className="font-bold text-white text-sm leading-snug flex items-center gap-1.5 min-w-0 group/title">
                          <span className="truncate">{project.title}</span>
                          {canDelete(project) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); startRenameProject(project); }}
                              className="shrink-0 opacity-0 group-hover/title:opacity-100 text-gray-400 hover:text-[#F7BC5F] transition-opacity"
                              title="Renommer le projet"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </h3>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {project.status === 'Terminé' && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); basculerEpingle(project.id); }}
                          className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                            epingles.includes(project.id)
                              ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/40 text-[#F7BC5F]'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:text-[#F7BC5F] hover:bg-[#F7BC5F]/10'
                          }`}
                          title={epingles.includes(project.id) ? 'Retirer du haut de la liste' : 'Épingler en haut de la liste'}
                        >
                          <Pin className={`w-3.5 h-3.5 ${epingles.includes(project.id) ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
                      {project.status}
                    </span>

                    {project.deadline && (
                      <div className="flex items-center gap-1 text-[11px] text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{project.deadline}</span>
                      </div>
                    )}

                    {project.description && (
                      <p className="text-xs text-gray-300 whitespace-pre-line">{project.description}</p>
                    )}

                    <div>
                      <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
                        <span>Progression</span>
                        <span>{project.progress}%</span>
                      </div>
                      <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            project.progress === 100 ? 'bg-emerald-500' : 'bg-[#F7BC5F]'
                          }`}
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => setOpenBoard(project)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-[#F7BC5F]/15 border border-white/10 hover:border-[#F7BC5F]/40 text-xs font-bold text-gray-200 hover:text-[#F9C977] transition-colors"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" /> Ouvrir le tableau
                    </button>

                    <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400 min-w-0">
                        <User className="w-3.5 h-3.5 text-[#F7BC5F] shrink-0" />
                        <span className="text-gray-300 truncate">{project.assignedMember}</span>
                      </div>

                      {canDelete(project) && (
                        <button
                          onClick={() => void handleDelete(project)}
                          disabled={deletingId === project.id}
                          className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center disabled:opacity-50 shrink-0"
                          title="Supprimer le projet"
                        >
                          {deletingId === project.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <DragDropContext onDragEnd={handleProjectsDragEnd}>
              <Droppable droppableId="projets-internes-liste">
                {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="divide-y divide-white/10 bg-[#0a1e20] border border-white/10 rounded-2xl overflow-hidden"
            >
              {visibleProjects.map((project, projectIndex) => {
                const accent = STATUS_ACCENT[project.status];
                return (
                  <Draggable draggableId={project.id} index={projectIndex} key={project.id}>
                    {(dragProvided, dragSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors group border-l-4 ${dragSnapshot.isDragging ? 'shadow-2xl ring-1 ring-[#F7BC5F]/50' : 'hover:bg-white/5'}`}
                    style={{ borderLeftColor: accent, ...dragProvided.draggableProps.style }}
                  >
                    <span
                      {...dragProvided.dragHandleProps}
                      title="Glisser pour changer l'ordre"
                      className="shrink-0 -ml-1.5 p-1 rounded-md text-gray-500 hover:text-[#F7BC5F] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <GripVertical className="w-4 h-4" />
                    </span>
                    {renamingProjectId === project.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void saveRenameProject(project)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveRenameProject(project);
                          if (e.key === 'Escape') cancelRenameProject();
                        }}
                        className="flex-1 min-w-0 bg-white/5 border border-[#F7BC5F]/50 rounded-lg px-2 py-1.5 text-sm font-bold text-white focus:outline-none focus:border-[#F7BC5F]"
                      />
                    ) : (
                      <button onClick={() => setOpenBoard(project)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-bold text-white text-sm truncate">{project.title}</p>
                            {project.status === 'Terminé' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
                            <span className="font-bold uppercase tracking-wider" style={{ color: accent }}>{project.status}</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" />{project.assignedMember}</span>
                            {project.deadline && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{project.deadline}</span>}
                            <span>{project.progress}%</span>
                          </div>
                        </div>
                      </button>
                    )}
                    {/* Épingle : visible en permanence quand le projet est
                        épinglé, au survol sinon — comme les deux boutons
                        suivants. */}
                    <button
                      onClick={() => basculerEpingle(project.id)}
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all shrink-0 ${
                        epingles.includes(project.id)
                          ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/40 text-[#F7BC5F]'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-[#F7BC5F] hover:bg-[#F7BC5F]/10 opacity-0 group-hover:opacity-100'
                      }`}
                      title={epingles.includes(project.id) ? 'Retirer du haut de la liste' : 'Épingler en haut de la liste'}
                    >
                      <Pin className={`w-3.5 h-3.5 ${epingles.includes(project.id) ? 'fill-current' : ''}`} />
                    </button>
                    {canDelete(project) && renamingProjectId !== project.id && (
                      <button
                        onClick={() => startRenameProject(project)}
                        className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-[#F7BC5F] hover:bg-[#F7BC5F]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Renommer le projet"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete(project) && (
                      <button
                        onClick={() => void handleDelete(project)}
                        disabled={deletingId === project.id}
                        className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 shrink-0"
                        title="Supprimer le projet"
                      >
                        {deletingId === project.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                    )}
                  </Draggable>
                );
              })}
              {dropProvided.placeholder}
            </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>
      ))}

      {pageTab === 'liste' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">Tableau indépendant de "Projet" — aucun lien entre les deux.</p>
          <div className="flex items-center gap-2 max-w-xl">
            <input
              ref={todoInputRef}
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addTodoItem(); }}
              placeholder="Ajouter un élément..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#94A3B8]"
            />
            <button
              onClick={() => void addTodoItem()}
              disabled={!newTodoText.trim()}
              className="w-10 h-10 shrink-0 rounded-xl bg-[#94A3B8] hover:bg-[#B0BEC9] text-slate-950 flex items-center justify-center disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {todoLoading ? (
            <div className="p-8 flex items-center justify-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin text-[#94A3B8]" />
            </div>
          ) : (
            <DragDropContext onDragEnd={handleTodoDragEnd}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                {TODO_STATUS_OPTIONS.map((status) => {
                  const accent = TODO_STATUS_ACCENT[status];
                  const columnItems = todoItems.filter((t) => t.status === status);
                  return (
                    <Droppable droppableId={status} key={status}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="rounded-2xl border p-3 space-y-2 min-h-[120px] transition-colors bg-[#0a1e20]"
                          style={{ borderColor: snapshot.isDraggingOver ? accent : 'rgba(255,255,255,0.1)' }}
                        >
                          <div className="flex items-center justify-between px-1">
                            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: accent }}>
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
                              {TODO_STATUS_LABEL[status]}
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">{columnItems.length}</span>
                          </div>

                          {columnItems.length === 0 && (
                            <div className="p-4 text-center text-gray-600 text-[11px] border border-dashed border-white/10 rounded-xl">
                              Vide
                            </div>
                          )}

                          {columnItems.map((item, index) => (
                            <Draggable draggableId={item.id} index={index} key={item.id}>
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  className={`flex items-center gap-2 bg-[#0b1719] border-y border-r rounded-lg pl-3 pr-2 py-2.5 border-l-4 ${dragSnapshot.isDragging ? 'shadow-2xl' : ''}`}
                                  style={{
                                    ...dragProvided.draggableProps.style,
                                    borderLeftColor: accent,
                                    borderTopColor: 'rgba(255,255,255,0.1)',
                                    borderRightColor: 'rgba(255,255,255,0.1)',
                                    borderBottomColor: 'rgba(255,255,255,0.1)',
                                  }}
                                >
                                  <span className={`flex-1 text-sm min-w-0 break-words ${status === 'fait' ? 'line-through text-gray-500' : 'text-white'}`}>
                                    {item.text}
                                  </span>
                                  <button
                                    onClick={() => void deleteTodoItem(item.id)}
                                    className="shrink-0 w-6 h-6 rounded-md bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  );
                })}
              </div>
            </DragDropContext>
          )}
        </div>
      )}

      {pageTab === 'tableaux' && (
        <KanbanBoardsView agencyId={effectiveAgencyIdForTodo} />
      )}

      {/* Modal création */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white">
            <h3 className="text-lg font-bold mb-4 text-[#F7BC5F]">
              Créer un projet interne
            </h3>

            <form
              onSubmit={
                handleCreate
              }
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Titre du projet
                </label>

                <input
                  type="text"
                  required
                  placeholder="ex: Campagne Partenaires Notaires"
                  value={title}
                  onChange={(
                    event
                  ) =>
                    setTitle(
                      event.target
                        .value
                    )
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Description
                </label>

                <textarea
                  rows={3}
                  placeholder="Objectif et étapes clés..."
                  value={
                    description
                  }
                  onChange={(
                    event
                  ) =>
                    setDescription(
                      event.target
                        .value
                    )
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Échéance
                </label>

                <input
                  type="date"
                  value={
                    deadline
                  }
                  onChange={(
                    event
                  ) =>
                    setDeadline(
                      event.target
                        .value
                    )
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Responsable
                </label>

                <select
                  value={
                    assignedUserId
                  }
                  onChange={(
                    event
                  ) =>
                    setAssignedUserId(
                      event.target
                        .value
                    )
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                >
                  <option
                    value=""
                    className="bg-[#0E1A20]"
                  >
                    Moi-même
                  </option>

                  {usersForAgency.map(
                    (user) => (
                      <option
                        key={
                          user.uid
                        }
                        value={
                          user.uid
                        }
                        className="bg-[#0E1A20]"
                      >
                        {
                          user.displayName
                        }
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    resetForm();
                    setShowAddModal(
                      false
                    );
                  }}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white disabled:opacity-50"
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold text-black bg-[#F7BC5F] rounded-xl disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}

                  {saving
                    ? 'Création...'
                    : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjetsInternes;
