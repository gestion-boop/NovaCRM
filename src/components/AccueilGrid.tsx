import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bell, MessageSquare, Calendar, Mail, Users, Headphones, 
  GitFork, FileText, FileEdit, UserPlus, BarChart2, Zap, 
  Home as HomeIcon, Camera, Settings, Plus, GripVertical, 
  Palette, Folder, FolderPlus, ArrowLeft, Check, Trash2, Edit3, X, ChevronRight, LayoutGrid,
  Globe, ExternalLink, Bookmark, Target, Shield, Award, Sparkles, Image as ImageIcon,
  CheckSquare, MoreVertical
} from 'lucide-react';

interface AccueilGridProps {
  onNavigate: (navId: string) => void;
  unreadRemindersCount: number;
  unreadNotificationsCount: number;
  unreadMessagesCount: number;
  unreadMailCount?: number;
  openSupportTicketsCount?: number;
  onAskNovaAI?: (prompt: string) => void;
  onOpenNova?: () => void;
  novaOpen?: boolean;
}

export interface TileItemNode {
  id: string;
  title: string;
  iconName: string;
  gradient: string;
  badgeCount: number;
  navTarget: string;
  isFolder?: boolean;
  children?: TileItemNode[];
  externalUrl?: string;
  imageUrl?: string;
}

export const PRESET_GRADIENTS = [
  { name: 'Rubis Impérial', value: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]' },
  { name: 'Saphir Océan', value: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]' },
  { name: 'Émeraude Forest', value: 'from-[#059669] via-[#047857] to-[#064E3B]' },
  { name: 'Améthyste Royale', value: 'from-[#6B21A8] via-[#581C87] to-[#3B0764]' },
  { name: 'Ambre Doré', value: 'from-[#E5B842] via-[#C9992B] to-[#78540F]' },
  { name: 'Cuivre Sunset', value: 'from-[#EA580C] via-[#C2410C] to-[#7C2D12]' },
  { name: 'Obsidienne Pur', value: 'from-[#1E293B] via-[#0F172A] to-[#020617]' },
  { name: 'Quartz Rose', value: 'from-[#BE185D] via-[#9D174D] to-[#500724]' },
  { name: 'Cyan Lagon', value: 'from-[#0891B2] via-[#0E7490] to-[#164E63]' },
  { name: 'Vert Jade', value: 'from-[#047857] via-[#065F46] to-[#022C22]' },
  { name: 'Néon Cyber', value: 'from-[#4F46E5] via-[#3730A3] to-[#1E1B4B]' },
  { name: 'Bronze Élégant', value: 'from-[#B45309] via-[#78350F] to-[#451A03]' },
  /* 12 Nouvelles Couleurs Lumineuses avec effets 3D */
  { name: 'Or Lux 3D', value: 'from-[#FFE066] via-[#F5A623] to-[#D07000]' },
  { name: 'Plasma Magenta 3D', value: 'from-[#FF2A85] via-[#FF0075] to-[#800040]' },
  { name: 'Lagon Électrique 3D', value: 'from-[#00F0FF] via-[#00A8FF] to-[#0040DD]' },
  { name: 'Laser Vert 3D', value: 'from-[#ADFF2F] via-[#32CD32] to-[#008000]' },
  { name: 'Soleil Solaire 3D', value: 'from-[#FF9900] via-[#FF5500] to-[#B30000]' },
  { name: 'Aurore Boréale 3D', value: 'from-[#00FFC6] via-[#00B8D9] to-[#6A00FF]' },
  { name: 'Rose Diamant 3D', value: 'from-[#FF75C3] via-[#FFA647] to-[#FF2E63]' },
  { name: 'Bleu Cobalt 3D', value: 'from-[#38BDF8] via-[#2563EB] to-[#1E1B4B]' },
  { name: 'Topaze Lumineux 3D', value: 'from-[#FDE047] via-[#EAB308] to-[#854D0E]' },
  { name: 'Hyper Violet 3D', value: 'from-[#D8B4FE] via-[#A855F7] to-[#581C87]' },
  { name: 'Corail Vivant 3D', value: 'from-[#FF6B6B] via-[#FF4757] to-[#2ED573]' },
  { name: 'Perle Blanche 3D', value: 'from-[#FFFFFF] via-[#CBD5E1] to-[#475569]' },
];

const ICON_MAP: Record<string, React.ElementType> = {
  Bell, MessageSquare, Calendar, Mail, Users, Headphones,
  GitFork, FileText, FileEdit, UserPlus, BarChart2, Zap,
  HomeIcon, Camera, Settings, Folder, LayoutGrid, Globe, ExternalLink,
  Bookmark, Target, Shield, Award, Sparkles, CheckSquare, ImageIcon
};

const ICON_PICKER_OPTIONS = [
  { name: 'Calendar', icon: Calendar, label: 'Agenda' },
  { name: 'Users', icon: Users, label: 'Clients' },
  { name: 'Target', icon: Target, label: 'Objectif' },
  { name: 'Mail', icon: Mail, label: 'Mail' },
  { name: 'Folder', icon: Folder, label: 'Dossier' },
  { name: 'Settings', icon: Settings, label: 'Réglages' },
  { name: 'BarChart2', icon: BarChart2, label: 'Stats' },
  { name: 'FileText', icon: FileText, label: 'Doc' },
  { name: 'HomeIcon', icon: HomeIcon, label: 'Accueil' },
  { name: 'CheckSquare', icon: CheckSquare, label: 'Tâches' },
  { name: 'Globe', icon: Globe, label: 'Web' },
  { name: 'ExternalLink', icon: ExternalLink, label: 'Lien' },
  { name: 'MessageSquare', icon: MessageSquare, label: 'Chat' },
  { name: 'Bell', icon: Bell, label: 'Alerte' },
  { name: 'Camera', icon: Camera, label: 'Visite' },
  { name: 'Zap', icon: Zap, label: 'Flash' },
  { name: 'Sparkles', icon: Sparkles, label: 'IA' },
  { name: 'Bookmark', icon: Bookmark, label: 'Favori' },
  { name: 'Shield', icon: Shield, label: 'Sécurité' },
  { name: 'Award', icon: Award, label: 'Premium' },
];

const INITIAL_TILES: TileItemNode[] = [
  {
    id: 'notifications',
    title: 'Notifications',
    iconName: 'Bell',
    gradient: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]',
    badgeCount: 0,
    navTarget: 'notifications',
  },
  {
    id: 'folder-comm',
    title: 'Communication & Mails',
    iconName: 'Folder',
    gradient: 'from-[#0083B0] via-[#005C8A] to-[#0F172A]',
    badgeCount: 3,
    navTarget: '',
    isFolder: true,
    children: [
      {
        id: 'chat',
        title: 'Chat Équipe',
        iconName: 'MessageSquare',
        gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]',
        badgeCount: 2,
        navTarget: 'chat',
      },
      {
        id: 'mail',
        title: 'Messagerie Mail',
        iconName: 'Mail',
        gradient: 'from-[#1E3A8A] via-[#1E293B] to-[#0F172A]',
        badgeCount: 1,
        navTarget: 'mail',
      },
      {
        id: 'support',
        title: 'Support Clients',
        iconName: 'Headphones',
        gradient: 'from-[#334155] via-[#1E293B] to-[#0F172A]',
        badgeCount: 0,
        navTarget: 'support',
      }
    ]
  },
  {
    id: 'agenda',
    title: 'Agenda & RDV',
    iconName: 'Calendar',
    gradient: 'from-[#059669] via-[#047857] to-[#064E3B]',
    badgeCount: 0,
    navTarget: 'agenda',
  },
  {
    id: 'clients',
    title: 'Clients & Leads',
    iconName: 'Users',
    gradient: 'from-[#A8421E] via-[#7C2D12] to-[#451A03]',
    badgeCount: 0,
    navTarget: 'clients',
  },
  {
    id: 'folder-business',
    title: 'Stratégie & Ventes',
    iconName: 'Folder',
    gradient: 'from-[#6B21A8] via-[#3B0764] to-[#1E1B4B]',
    badgeCount: 5,
    navTarget: '',
    isFolder: true,
    children: [
      {
        id: 'pipeline',
        title: 'Pipelines Prêts',
        iconName: 'GitFork',
        gradient: 'from-[#1F2937] via-[#111827] to-[#030712]',
        badgeCount: 3,
        navTarget: 'pipeline',
      },
      {
        id: 'tableau-de-bord',
        title: 'Tableau de bord',
        iconName: 'BarChart2',
        gradient: 'from-[#0D9488] via-[#0F766E] to-[#042F2E]',
        badgeCount: 2,
        navTarget: 'tableau-de-bord',
      },
      {
        id: 'assistant-ia',
        title: 'Assistant NovaAI',
        iconName: 'Zap',
        gradient: 'from-[#EA580C] via-[#C2410C] to-[#7C2D12]',
        badgeCount: 0,
        navTarget: 'assistant-ia',
      }
    ]
  },
  {
    id: 'documents',
    title: 'Coffre Documents',
    iconName: 'FileText',
    gradient: 'from-[#B45309] via-[#78350F] to-[#451A03]',
    badgeCount: 0,
    navTarget: 'documents',
  },
  {
    id: 'notes',
    title: 'Bloc-notes',
    iconName: 'FileEdit',
    gradient: 'from-[#6B21A8] via-[#581C87] to-[#3B0764]',
    badgeCount: 0,
    navTarget: 'notes',
  },
  {
    id: 'equipe',
    title: 'Membres Équipe',
    iconName: 'UserPlus',
    gradient: 'from-[#1E1B4B] via-[#1E293B] to-[#0F172A]',
    badgeCount: 0,
    navTarget: 'equipe',
  },
  {
    id: 'lodgify',
    title: 'Lodgify Immo',
    iconName: 'HomeIcon',
    gradient: 'from-[#047857] via-[#065F46] to-[#022C22]',
    badgeCount: 0,
    navTarget: 'lodgify',
  },
  {
    id: 'reserver-camera',
    title: 'Réserver caméra',
    iconName: 'Camera',
    gradient: 'from-[#D97706] via-[#B45309] to-[#78350F]',
    badgeCount: 0,
    navTarget: 'reserver-camera',
  },
  {
    id: 'parametres',
    title: 'Paramètres Système',
    iconName: 'Settings',
    gradient: 'from-[#475569] via-[#334155] to-[#1E293B]',
    badgeCount: 0,
    navTarget: 'parametres',
  },
];

export const AccueilGrid: React.FC<AccueilGridProps> = ({
  onNavigate,
  unreadRemindersCount,
  unreadNotificationsCount,
  unreadMessagesCount,
  unreadMailCount = 0,
  openSupportTicketsCount = 0,
  onAskNovaAI,
  onOpenNova,
  novaOpen = false,
}) => {
  const [tiles, setTiles] = useState<TileItemNode[]>(() => {
    const saved = localStorage.getItem('novasphere_home_tiles_v3');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved tiles:', e);
      }
    }
    return INITIAL_TILES;
  });

  // Folder Stack state for navigation inside open folders/nested folders
  const [openFolderStack, setOpenFolderStack] = useState<TileItemNode[]>([]);
  const activeFolder = openFolderStack.length > 0 ? openFolderStack[openFolderStack.length - 1] : null;

  // Selected tile for palette or options
  const [paletteTileId, setPaletteTileId] = useState<string | null>(null);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'shortcut' | 'folder'>('shortcut');
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newImageUrl, setNewImageUrl] = useState<string | null>(null);
  const [newIconName, setNewIconName] = useState('HomeIcon');
  const [newNavTarget, setNewNavTarget] = useState('notes');
  const [newGradient, setNewGradient] = useState(PRESET_GRADIENTS[1].value);

  // Accessible Tile Context Menu (Mobile & Desktop)
  const [activeMenuTileId, setActiveMenuTileId] = useState<string | null>(null);

  // Universal Tile Rename Modal
  const [renamingTile, setRenamingTile] = useState<{ id: string; title: string } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  // Handle Image Upload for custom shortcut (PNG transparent, JPG, etc.)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Veuillez choisir un fichier image de moins de 5 Mo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setNewImageUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Open add modal reset
  const handleOpenAddModal = () => {
    setNewTitle('');
    setNewUrl('');
    setNewImageUrl(null);
    setNewIconName('HomeIcon');
    setNewGradient(PRESET_GRADIENTS[1].value);
    setAddMode('shortcut');
    setShowAddModal(true);
  };

  // Delete tile recursively
  const handleDeleteTile = (tileId: string) => {
    const deleteRecursive = (items: TileItemNode[]): TileItemNode[] => {
      return items
        .filter(item => item.id !== tileId)
        .map(item => item.children ? { ...item, children: deleteRecursive(item.children) } : item);
    };

    setTiles(deleteRecursive(tiles));
    if (activeFolder) {
      setOpenFolderStack(prev => prev.map(f => f.id === activeFolder.id ? {
        ...f,
        children: f.children?.filter(c => c.id !== tileId)
      } : f));
    }
  };

  // Drag State
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('novasphere_home_tiles_v3', JSON.stringify(tiles));
  }, [tiles]);

  // Handle Drag Start
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Handle Drag Over (with live reorder)
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault(); // allow drop
    if (draggedIndex === null || draggedIndex === index) return;

    const currentList = activeFolder ? activeFolder.children || [] : tiles;
    const targetItem = currentList[index];
    const sourceItem = currentList[draggedIndex];

    if (targetItem.isFolder && !sourceItem.isFolder) {
      // Hovering a folder -> intent to drop into it
      setDragOverIndex(index);
    } else {
      // Reorder array for visual "pass underneath" effect
      const updatedList = [...currentList];
      const [removed] = updatedList.splice(draggedIndex, 1);
      updatedList.splice(index, 0, removed);

      if (activeFolder) {
        updateActiveFolderChildren(updatedList);
      } else {
        setTiles(updatedList);
      }
      // Update draggedIndex to current index so the drag continues smoothly
      setDraggedIndex(index);
      setDragOverIndex(null);
    }
  };

  // Handle Drop for Reordering or Merging into Folders
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null) {
      setDragOverIndex(null);
      return;
    }

    if (dragOverIndex !== null && dragOverIndex === dropIndex) {
      const currentList = activeFolder ? activeFolder.children || [] : tiles;
      const sourceItem = currentList[draggedIndex];
      const targetItem = currentList[dropIndex];

      if (targetItem.isFolder && !sourceItem.isFolder) {
        // Merge source into target folder
        const updatedChildren = [...(targetItem.children || []), sourceItem];
        const updatedTarget = { ...targetItem, children: updatedChildren };

        if (activeFolder) {
          const newFolderChildren = activeFolder.children?.filter((_, i) => i !== draggedIndex) || [];
          const idx = newFolderChildren.findIndex(c => c.id === targetItem.id);
          if (idx !== -1) newFolderChildren[idx] = updatedTarget;
          updateActiveFolderChildren(newFolderChildren);
        } else {
          const newTiles = tiles.filter((_, i) => i !== draggedIndex);
          const idx = newTiles.findIndex(t => t.id === targetItem.id);
          if (idx !== -1) newTiles[idx] = updatedTarget;
          setTiles(newTiles);
        }
      }
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const updateActiveFolderChildren = (newChildren: TileItemNode[]) => {
    if (!activeFolder) return;
    const folderId = activeFolder.id;

    // Helper to recursively update folder in tiles tree
    const recursiveUpdate = (items: TileItemNode[]): TileItemNode[] => {
      return items.map(item => {
        if (item.id === folderId) {
          return { ...item, children: newChildren };
        }
        if (item.children) {
          return { ...item, children: recursiveUpdate(item.children) };
        }
        return item;
      });
    };

    setTiles(recursiveUpdate(tiles));
    setOpenFolderStack(prev => prev.map(f => f.id === folderId ? { ...f, children: newChildren } : f));
  };

  // Find tile by ID helper for palette modal
  const findTileById = (items: TileItemNode[], id: string): TileItemNode | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const found = findTileById(item.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Change tile color gradient
  const handleUpdateColor = (tileId: string, gradientValue: string) => {
    const updateGradientRecursive = (items: TileItemNode[]): TileItemNode[] => {
      return items.map(item => {
        if (item.id === tileId) {
          return { ...item, gradient: gradientValue };
        }
        if (item.children) {
          return { ...item, children: updateGradientRecursive(item.children) };
        }
        return item;
      });
    };

    setTiles(updateGradientRecursive(tiles));
    setPaletteTileId(null);
  };

  // Create new Shortcut or Folder
  const handleCreateNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    if (addMode === 'folder') {
      const newFolder: TileItemNode = {
        id: 'folder-' + Date.now(),
        title: newTitle.trim(),
        iconName: newIconName || 'Folder',
        gradient: newGradient,
        badgeCount: 0,
        navTarget: '',
        isFolder: true,
        children: []
      };

      if (activeFolder) {
        updateActiveFolderChildren([...(activeFolder.children || []), newFolder]);
      } else {
        setTiles([...tiles, newFolder]);
      }
    } else {
      const trimmedUrl = newUrl.trim();
      const newShortcut: TileItemNode = {
        id: 'custom-' + Date.now(),
        title: newTitle.trim(),
        iconName: newIconName || 'LayoutGrid',
        gradient: newGradient,
        badgeCount: 0,
        navTarget: trimmedUrl ? '' : newNavTarget,
        externalUrl: trimmedUrl || undefined,
        imageUrl: newImageUrl || undefined,
      };

      if (activeFolder) {
        updateActiveFolderChildren([...(activeFolder.children || []), newShortcut]);
      } else {
        setTiles([...tiles, newShortcut]);
      }
    }

    setNewTitle('');
    setNewUrl('');
    setNewImageUrl(null);
    setShowAddModal(false);
  };

  // Rename shortcut or folder
  const handleRenameFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = renamingTile?.id || renamingFolderId;
    if (!targetId || !renameTitle.trim()) return;

    const renameRecursive = (items: TileItemNode[]): TileItemNode[] => {
      return items.map(item => {
        if (item.id === targetId) {
          return { ...item, title: renameTitle.trim() };
        }
        if (item.children) {
          return { ...item, children: renameRecursive(item.children) };
        }
        return item;
      });
    };

    setTiles(renameRecursive(tiles));
    setOpenFolderStack(prev => prev.map(f => f.id === targetId ? { ...f, title: renameTitle.trim() } : f));
    setRenamingTile(null);
    setRenamingFolderId(null);
  };

  // Dissolve folder (extract contents back to parent)
  const handleDissolveFolder = (folderId: string) => {
    let folderToDissolve: TileItemNode | null = null;

    const findFolder = (items: TileItemNode[]): TileItemNode | null => {
      for (const item of items) {
        if (item.id === folderId) return item;
        if (item.children) {
          const found = findFolder(item.children);
          if (found) return found;
        }
      }
      return null;
    };

    folderToDissolve = findFolder(tiles);
    if (!folderToDissolve || !folderToDissolve.children) return;

    const dissolveRecursive = (items: TileItemNode[]): TileItemNode[] => {
      const result: TileItemNode[] = [];
      for (const item of items) {
        if (item.id === folderId) {
          result.push(...(item.children || []));
        } else if (item.children) {
          result.push({ ...item, children: dissolveRecursive(item.children) });
        } else {
          result.push(item);
        }
      }
      return result;
    };

    setTiles(dissolveRecursive(tiles));
    setOpenFolderStack(prev => prev.filter(f => f.id !== folderId));
  };

  // Reset to default layout
  const handleResetTiles = () => {
    if (window.confirm('Voulez-vous réinitialiser toutes les tuiles et dossiers par défaut ?')) {
      setTiles(INITIAL_TILES);
      setOpenFolderStack([]);
      localStorage.removeItem('novasphere_home_tiles_v3');
    }
  };

  const currentDisplayTiles = activeFolder ? (activeFolder.children || []) : tiles;

  const priorityItems = [
    {
      id: 'tableau-de-bord',
      label: 'Tableau de bord',
      nav: 'tableau-de-bord',
      icon: BarChart2,
      gradient: 'from-[#0D9488] via-[#0F766E] to-[#042F2E]',
      count: 0,
    },
    {
      id: 'rappels',
      label: 'Rappels & Alertes',
      nav: 'rappels',
      icon: Bell,
      gradient: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]',
      count: unreadNotificationsCount || 0,
    },
    {
      id: 'chat',
      label: 'Chat Équipe',
      nav: 'chat',
      icon: MessageSquare,
      gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]',
      count: unreadMessagesCount || 0,
    },
    {
      id: 'agenda',
      label: 'Agenda & RDV',
      nav: 'agenda',
      icon: Calendar,
      gradient: 'from-[#059669] via-[#047857] to-[#064E3B]',
      count: unreadRemindersCount || 0,
    },
    {
      id: 'mail',
      label: 'Mail',
      nav: 'mail',
      icon: Mail,
      gradient: 'from-[#1E3A8A] via-[#1E293B] to-[#0F172A]',
      count: unreadMailCount || 0,
    },
  ];

  const summaryText = useMemo(() => {
    if (unreadMailCount > 0) return `${unreadMailCount} mail${unreadMailCount > 1 ? 's' : ''} non lu${unreadMailCount > 1 ? 's' : ''}`;
    if (unreadMessagesCount > 0) return `${unreadMessagesCount} message${unreadMessagesCount > 1 ? 's' : ''} d'équipe non lu${unreadMessagesCount > 1 ? 's' : ''}`;
    if (unreadNotificationsCount > 0) return `${unreadNotificationsCount} alerte${unreadNotificationsCount > 1 ? 's' : ''} ou rappel${unreadNotificationsCount > 1 ? 's' : ''} en attente`;
    if (unreadRemindersCount > 0) return `${unreadRemindersCount} rendez-vous ou rappel${unreadRemindersCount > 1 ? 's' : ''} aujourd'hui`;
    return null;
  }, [unreadMailCount, unreadMessagesCount, unreadNotificationsCount, unreadRemindersCount]);

  return (
    <div 
      onClick={() => setActiveMenuTileId(null)}
      className="min-h-full bg-[#071015] p-4 sm:p-8 flex flex-col justify-between relative overflow-y-auto custom-scrollbar select-none"
    >
      {/* Dynamic Background Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-900/10 via-transparent to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto w-full z-10">
        {/* Priority Dock from Image 1 */}
        {!activeFolder && (
          <div className="max-w-7xl mx-auto w-full mb-6 z-10 relative overflow-hidden rounded-2xl bg-[#2b2b2b]/80 backdrop-blur-xl p-3 sm:p-4 border border-black/60 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="grid grid-cols-5 gap-1.5 sm:gap-4 items-center justify-items-center">
              {priorityItems.map((opt) => {
                const OptIcon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    onClick={() => onNavigate(opt.nav)}
                    className="flex flex-col items-center gap-1.5 transition-transform hover:scale-[1.03] active:scale-[0.98] w-full max-w-[120px] cursor-pointer"
                  >
                    <div className={`relative w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br ${opt.gradient} flex items-center justify-center shadow-md border border-white/15 transition-all`}>
                      <OptIcon className="w-5 h-5 sm:w-7 sm:h-7 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" />
                      {opt.count > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] sm:text-xs font-black min-w-5 h-5 sm:min-w-6 sm:h-6 px-1 rounded-full flex items-center justify-center ring-2 ring-[#0b1c1e] shadow-md animate-pulse">
                          {opt.count > 9 ? '9+' : opt.count}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] sm:text-xs font-semibold text-slate-200 text-center truncate w-full" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {summaryText && (
              <div 
                onClick={() => {
                  if (unreadMailCount > 0) onNavigate('mail');
                  else if (unreadMessagesCount > 0) onNavigate('chat');
                  else if (unreadNotificationsCount > 0) onNavigate('rappels');
                  else if (unreadRemindersCount > 0) onNavigate('agenda');
                }}
                className="mt-2 text-center text-xs sm:text-sm font-semibold text-slate-100 hover:text-[#F7BC5F] transition-colors cursor-pointer truncate"
              >
                {summaryText}
              </div>
            )}
          </div>
        )}

        {/* Folder Breadcrumb & Navigation if inside folder */}
        {activeFolder && (
          <div className="flex items-center justify-between mb-6 bg-white/[0.03] p-3.5 sm:p-4 rounded-2xl border border-white/10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOpenFolderStack([])}
                className="px-3 py-1.5 rounded-xl bg-amber-400 text-black hover:bg-amber-300 transition-colors flex items-center gap-1.5 text-xs font-bold shadow-md cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Accueil</span>
              </button>

              <div className="flex items-center gap-2">
                <Folder className="w-5 h-5 text-amber-400" />
                <h2 className="text-base sm:text-lg font-bold text-white">{activeFolder.title}</h2>
                <span className="text-xs text-gray-400 font-medium">({activeFolder.children?.length || 0} éléments)</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDissolveFolder(activeFolder.id)}
                className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Extraire le contenu vers l'accueil"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Dissoudre</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Grid View */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5 pb-16">
          {currentDisplayTiles.map((tile, index) => {
            const Icon = ICON_MAP[tile.iconName] || LayoutGrid;
            const count = 
              tile.id === 'rappels' ? (unreadRemindersCount || 0) :
              tile.id === 'chat' ? (unreadMessagesCount || 0) :
              tile.id === 'notifications' ? (unreadNotificationsCount || 0) :
              tile.badgeCount;
            const isDragTarget = dragOverIndex === index;

            return (
              <motion.div
                key={tile.id}
                layout
                draggable
                onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, index)}
                onDragOver={(e) => handleDragOver(e as unknown as React.DragEvent, index)}
                onDrop={(e) => handleDrop(e as unknown as React.DragEvent, index)}
                onClick={() => {
                  if (tile.isFolder) {
                    setOpenFolderStack([...openFolderStack, tile]);
                  } else if (tile.externalUrl) {
                    let url = tile.externalUrl.trim();
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                      url = 'https://' + url;
                    }
                    window.open(url, '_blank', 'noopener,noreferrer');
                  } else if (tile.navTarget) {
                    onNavigate(tile.navTarget);
                  }
                }}
                whileHover={{ scale: 1.025, y: -4 }}
                whileTap={{ scale: 0.98 }}
                className={`relative group h-40 sm:h-48 rounded-2xl sm:rounded-3xl bg-gradient-to-br ${tile.gradient} p-3 sm:p-5 flex flex-col items-center justify-between text-center cursor-pointer transition-all duration-200 border border-t-white/35 border-l-white/20 border-r-black/30 border-b-black/50 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.65),inset_0_1px_2px_rgba(255,255,255,0.35)] hover:shadow-[0_20px_35px_-10px_rgba(0,0,0,0.8),inset_0_1px_2px_rgba(255,255,255,0.45)] hover:border-white/50 select-none overflow-hidden ${
                  draggedIndex === index ? 'opacity-60 scale-105 z-50 ring-2 ring-white/50' : 
                  isDragTarget ? 'border-amber-400 ring-4 ring-amber-400/30 scale-105 z-40' : 'z-10'
                }`}
              >
                {/* 3D Glass Specular Reflection */}
                <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 via-white/5 to-transparent rounded-t-2xl sm:rounded-t-3xl pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent rounded-b-2xl sm:rounded-b-3xl pointer-events-none" />

                {/* Drag Handle top-left */}
                <div 
                  className="absolute top-2 left-2 sm:top-3 sm:left-3 p-1 rounded-lg text-white/50 hover:text-white cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-20"
                  title="Glisser pour réorganiser"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>

                {/* Accessible Options Button top-right (touch + desktop) */}
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-30">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuTileId(activeMenuTileId === tile.id ? null : tile.id);
                    }}
                    className="p-1.5 rounded-xl bg-black/40 hover:bg-black/70 text-white/80 hover:text-white border border-white/10 shadow-sm transition-all sm:opacity-0 group-hover:opacity-100 cursor-pointer"
                    title="Options du raccourci"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {/* Dropdown Menu */}
                  {activeMenuTileId === tile.id && (
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-full mt-1.5 w-44 rounded-2xl bg-[#091519] border border-white/15 p-1.5 shadow-2xl z-50 text-left backdrop-blur-xl animate-fade-in"
                    >
                      <button
                        onClick={() => {
                          setActiveMenuTileId(null);
                          setPaletteTileId(tile.id);
                        }}
                        className="w-full px-3 py-2 rounded-xl text-xs font-medium text-white hover:bg-white/10 flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <Palette className="w-3.5 h-3.5 text-amber-400" />
                        <span>Changer couleur</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveMenuTileId(null);
                          setRenamingTile({ id: tile.id, title: tile.title });
                          setRenameTitle(tile.title);
                        }}
                        className="w-full px-3 py-2 rounded-xl text-xs font-medium text-white hover:bg-white/10 flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Renommer</span>
                      </button>

                      <div className="h-px bg-white/10 my-1" />

                      <button
                        onClick={() => {
                          setActiveMenuTileId(null);
                          if (window.confirm(`Supprimer "${tile.title}" ?`)) {
                            handleDeleteTile(tile.id);
                          }
                        }}
                        className="w-full px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-500/20 flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Supprimer</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* iPhone Folder Rendering */}
                {tile.isFolder ? (
                  <div className="flex flex-col items-center justify-center flex-1 w-full px-1">
                    {/* Mini 2x2 Grid Preview */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-black/30 backdrop-blur-md border border-white/15 p-1.5 sm:p-2 grid grid-cols-2 gap-1 sm:gap-1.5 items-center justify-center mb-1.5 shadow-inner group-hover:scale-105 transition-transform overflow-hidden">
                      {(tile.children || []).slice(0, 4).map((subItem, i) => {
                        const SubIcon = ICON_MAP[subItem.iconName] || LayoutGrid;
                        return (
                          <div key={i} className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-white/10 flex items-center justify-center text-white p-0.5 overflow-hidden">
                            {subItem.imageUrl ? (
                              <img src={subItem.imageUrl} alt="" className="w-full h-full object-contain" />
                            ) : (
                              <SubIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                            )}
                          </div>
                        );
                      })}
                      {(!tile.children || tile.children.length === 0) && (
                        <div className="col-span-2 text-[9px] text-gray-400 italic">Vide</div>
                      )}
                    </div>

                    <h3 className="text-white font-bold text-xs sm:text-sm tracking-tight truncate max-w-[90%] drop-shadow">
                      {tile.title}
                    </h3>
                    <span className="text-[10px] text-gray-300 font-medium mt-1 bg-black/35 px-2 py-0.5 rounded-full border border-white/10">
                      {tile.children?.length || 0} dossier(s)
                    </span>
                  </div>
                ) : (
                  /* Regular Shortcut Tile Rendering */
                  <div className="flex flex-col items-center justify-center flex-1 w-full px-1">
                    {tile.imageUrl ? (
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-black/20 backdrop-blur-md border border-white/15 flex items-center justify-center mb-1.5 shadow-inner group-hover:scale-105 transition-all">
                        <img 
                          src={tile.imageUrl} 
                          alt={tile.title} 
                          className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow" 
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-black/20 backdrop-blur-md border border-white/15 flex items-center justify-center text-white mb-1.5 shadow-inner group-hover:scale-105 group-hover:bg-black/30 transition-all">
                        <Icon className="w-6 h-6 sm:w-7 sm:h-7 stroke-[1.75]" />
                      </div>
                    )}

                    <h3 className="text-white font-bold text-xs sm:text-sm tracking-tight drop-shadow truncate max-w-[90%] px-1">
                      {tile.title}
                    </h3>

                    <div className="mt-1 flex items-center justify-center">
                      {tile.externalUrl ? (
                        <span className="bg-amber-400/20 border border-amber-400/40 text-amber-300 font-bold text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm backdrop-blur-md">
                          <ExternalLink className="w-2.5 h-2.5" />
                          <span>Web</span>
                        </span>
                      ) : count > 0 ? (
                        <span className="bg-rose-500 text-white font-bold text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full shadow-md animate-pulse">
                          {count}
                        </span>
                      ) : (
                        <span className="text-[10px] text-white/70 bg-black/25 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10 font-medium">
                          Ouvrir
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}

          {/* Plus Button Tile to add Shortcut or Folder */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleOpenAddModal}
            className="h-40 sm:h-48 rounded-2xl sm:rounded-3xl border-2 border-dashed border-gray-700/80 bg-white/[0.02] hover:bg-white/[0.06] text-gray-400 hover:text-white flex flex-col items-center justify-center p-3 sm:p-5 cursor-pointer transition-all duration-200 group hover:border-amber-400"
          >
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-2 group-hover:bg-amber-400 group-hover:text-black transition-colors shadow-lg">
              <Plus className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
            </div>
            <span className="text-xs font-semibold text-gray-300 group-hover:text-white text-center">
              {activeFolder ? 'Ajouter dans ce dossier' : 'Nouveau raccourci'}
            </span>
          </motion.div>
        </div>
      </div>

      {/* Bouton Flottant Assistant Nova IA — Cercle Logo avec contour bleu */}
      {!novaOpen && (
        <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40">
          <button
            onClick={() => {
              if (onOpenNova) {
                onOpenNova();
              } else {
                onNavigate('assistant-ia');
              }
            }}
            className="group relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#0a1820]/95 hover:bg-[#0f2430] border-2 border-sky-400 hover:border-cyan-300 shadow-[0_8px_30px_rgba(0,0,0,0.6),0_0_25px_rgba(56,189,248,0.5)] hover:shadow-[0_8px_35px_rgba(56,189,248,0.8)] backdrop-blur-md flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 cursor-pointer"
            title="Ouvrir l'Assistant Nova IA"
            aria-label="Assistant Nova IA"
          >
            <div className="relative w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center overflow-hidden shrink-0">
              <img
                src="/nova-mascotte.png"
                alt="Nova"
                className="w-9 h-9 sm:w-11 sm:h-11 object-contain drop-shadow group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            {/* Indicateur de statut en ligne */}
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping absolute top-0.5 right-0.5" />
            <span className="w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a1820] absolute top-0.5 right-0.5 shadow" />
          </button>
        </div>
      )}

      {/* iPhone Folder Open Modal Animation Effect */}
      <AnimatePresence>
        {activeFolder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4 sm:p-8"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-[#0E1A20]/90 border border-white/20 rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl text-white relative overflow-hidden backdrop-blur-2xl"
            >
              {/* Top Navigation in Folder */}
              <div className="flex items-center justify-between pb-6 border-b border-white/10 mb-6">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setOpenFolderStack(openFolderStack.slice(0, -1))}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 text-xs font-semibold"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Retour</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <Folder className="w-6 h-6 text-[#E5B842]" />
                    <h2 className="text-xl font-bold text-white tracking-wide">{activeFolder.title}</h2>
                    <button
                      onClick={() => {
                        setRenamingFolderId(activeFolder.id);
                        setRenameTitle(activeFolder.title);
                      }}
                      className="p-1 text-gray-400 hover:text-white transition-colors"
                      title="Renommer le dossier"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleDissolveFolder(activeFolder.id)}
                    className="px-3 py-1.5 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs font-semibold border border-red-500/30 transition-colors flex items-center gap-1.5"
                    title="Extraire le contenu vers la grille principale"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Dissoudre</span>
                  </button>

                  <button
                    onClick={() => setOpenFolderStack([])}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Sub-Items Grid Inside iPhone Folder */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                {(activeFolder.children || []).map((subItem, index) => {
                  const SubIcon = ICON_MAP[subItem.iconName] || LayoutGrid;
                  const isSubDragTarget = dragOverIndex === index;

                  return (
                    <motion.div
                      key={subItem.id}
                      layout
                      draggable
                      onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, index)}
                      onDragOver={(e) => handleDragOver(e as unknown as React.DragEvent, index)}
                      onDrop={(e) => handleDrop(e as unknown as React.DragEvent, index)}
                      onClick={() => {
                        if (subItem.isFolder) {
                          setOpenFolderStack([...openFolderStack, subItem]);
                        } else if (subItem.externalUrl) {
                          let url = subItem.externalUrl.trim();
                          if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'https://' + url;
                          }
                          window.open(url, '_blank', 'noopener,noreferrer');
                        } else if (subItem.navTarget) {
                          setOpenFolderStack([]);
                          onNavigate(subItem.navTarget);
                        }
                      }}
                      className={`relative group h-36 rounded-2xl bg-gradient-to-br ${subItem.gradient} p-4 flex flex-col items-center justify-center text-center cursor-pointer shadow-[0_10px_24px_-4px_rgba(0,0,0,0.6),inset_0_1px_2px_rgba(255,255,255,0.4)] hover:scale-[1.03] transition-all border border-t-white/30 border-l-white/20 border-b-black/50 overflow-hidden ${
                        draggedIndex === index ? 'opacity-60 scale-105 z-50 ring-2 ring-white/50' :
                        isSubDragTarget ? 'border-[#E5B842] ring-4 ring-[#E5B842]/30 scale-105 z-40' : 'hover:border-white/40 z-10'
                      }`}
                    >
                      {/* 3D Glass Specular Reflection */}
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 via-white/10 to-transparent rounded-t-2xl pointer-events-none" />
                      {subItem.isFolder ? (
                        <div className="flex flex-col items-center">
                          <Folder className="w-8 h-8 text-[#E5B842] mb-2" />
                          <span className="text-white font-semibold text-xs">{subItem.title}</span>
                          <span className="text-[9px] text-gray-300">{subItem.children?.length || 0} élément(s)</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          {subItem.imageUrl ? (
                            <img src={subItem.imageUrl} alt={subItem.title} className="w-8 h-8 object-contain mb-2 drop-shadow-md z-10" />
                          ) : (
                            <SubIcon className="w-8 h-8 text-white mb-2 z-10" />
                          )}
                          <span className="text-white font-semibold text-xs z-10">{subItem.title}</span>
                          {subItem.externalUrl && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-300 font-medium mt-1 z-10 bg-black/40 px-2 py-0.5 rounded-full border border-white/10">
                              <ExternalLink className="w-2.5 h-2.5" /> Web
                            </span>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}

                {/* Add Item Inside Folder Tile */}
                <div
                  onClick={() => handleOpenAddModal()}
                  className="h-36 rounded-2xl border-2 border-dashed border-gray-600 bg-white/5 hover:bg-white/10 text-gray-300 flex flex-col items-center justify-center p-4 cursor-pointer transition-colors"
                >
                  <Plus className="w-6 h-6 text-[#E5B842] mb-1" />
                  <span className="text-xs font-semibold">Ajouter dans ce dossier</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Shortcut / Folder Modal */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setShowAddModal(false)}
        >
          <div 
            className="bg-[#05191c] border border-[#17464b] rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl text-white relative my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                  {addMode === 'folder' ? 'Nouveau dossier' : 'Nouveau raccourci'}
                </h2>
                <p className="text-xs sm:text-sm text-gray-300 mt-1">
                  {addMode === 'folder' 
                    ? 'Créez un dossier pour organiser vos raccourcis et tuiles.'
                    : 'Créez un raccourci personnalisé avec une icône, une image et une couleur.'}
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)} 
                className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="flex items-center gap-2 mb-5 bg-[#031113] p-1 rounded-2xl border border-[#143d41]">
              <button
                type="button"
                onClick={() => setAddMode('shortcut')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                  addMode === 'shortcut' 
                    ? 'bg-[#E5B842] text-black shadow-md' 
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                Raccourci App / Lien Web
              </button>
              <button
                type="button"
                onClick={() => setAddMode('folder')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                  addMode === 'folder' 
                    ? 'bg-[#E5B842] text-black shadow-md' 
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                Dossier iPhone
              </button>
            </div>

            <form onSubmit={handleCreateNewItem} className="space-y-4">
              {/* Nom */}
              <div>
                <label className="block text-xs font-bold text-gray-200 mb-1.5">
                  Nom
                </label>
                <input
                  type="text"
                  required
                  placeholder={addMode === 'folder' ? 'ex: Prêts, Prospection, Admin' : 'Nom du raccourci'}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-[#021316] border border-[#1b484d] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-[#E5B842] focus:ring-1 focus:ring-[#E5B842] transition-all placeholder:text-gray-500"
                />
              </div>

              {/* URL (Optionnel) */}
              {addMode === 'shortcut' && (
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1.5">
                    URL (optionnel)
                  </label>
                  <input
                    type="url"
                    placeholder="https://exemple.com"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-[#E5B842] focus:ring-1 focus:ring-[#E5B842] transition-all placeholder:text-gray-500"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Si renseignée, le clic ouvrira ce lien dans un nouvel onglet. Sinon, il naviguera vers l'application interne.
                  </p>
                </div>
              )}

              {/* Internal Destination fallback if no URL */}
              {addMode === 'shortcut' && !newUrl.trim() && (
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1.5">
                    Destination d'application interne
                  </label>
                  <select
                    value={newNavTarget}
                    onChange={(e) => setNewNavTarget(e.target.value)}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-[#E5B842] focus:ring-1 focus:ring-[#E5B842]"
                  >
                    <option value="clients">Clients & Leads</option>
                    <option value="pipeline">Pipelines Prêts</option>
                    <option value="agenda">Agenda & RDV</option>
                    <option value="notes">Bloc-notes</option>
                    <option value="documents">Coffre-fort Documents</option>
                    <option value="reserver-camera">Réserver Caméra</option>
                    <option value="lodgify">Lodgify Immo</option>
                    <option value="projets-internes">Projets internes</option>
                    <option value="chat">Chat Équipe</option>
                    <option value="mail">Messagerie Mail</option>
                  </select>
                </div>
              )}

              {/* Image personnalisée PNG/JPG/WebP */}
              {addMode === 'shortcut' && (
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1.5">
                    Image personnalisée PNG/JPG/WebP (optionnel)
                  </label>
                  <div className="flex items-center gap-3 bg-[#021316] border border-[#1b484d] rounded-xl p-2.5">
                    <label className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer border border-white/15 transition-colors shrink-0">
                      Choisir un fichier
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                    <span className="text-xs text-gray-400 truncate">
                      {newImageUrl ? "Image chargée" : "Aucun fichier choisi"}
                    </span>
                    {newImageUrl && (
                      <button
                        type="button"
                        onClick={() => setNewImageUrl(null)}
                        className="text-xs text-red-400 hover:text-red-300 ml-auto shrink-0 font-semibold cursor-pointer px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20"
                      >
                        Effacer
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5 italic">
                    Si une image est téléchargée, elle remplacera l'icône sélectionnée dans la tuile.
                  </p>

                  {newImageUrl && (
                    <div className="mt-2.5 flex items-center gap-3 p-2 bg-black/40 rounded-xl border border-white/10">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-900 to-black p-1 flex items-center justify-center border border-white/20 shadow-md">
                        <img src={newImageUrl} alt="Aperçu" className="w-10 h-10 object-contain drop-shadow-md" />
                      </div>
                      <span className="text-xs text-emerald-400 font-semibold">Image prête (fond transparent géré)</span>
                    </div>
                  )}
                </div>
              )}

              {/* Icône */}
              <div>
                <label className="block text-xs font-bold text-gray-200 mb-1.5">
                  Icône
                </label>
                <div className="grid grid-cols-5 sm:grid-cols-7 gap-2 max-h-36 overflow-y-auto custom-scrollbar p-2 bg-[#021316] rounded-xl border border-[#1b484d]">
                  {ICON_PICKER_OPTIONS.map((item) => {
                    const IconComp = item.icon;
                    const isSelected = newIconName === item.name;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => setNewIconName(item.name)}
                        className={`h-11 rounded-xl flex flex-col items-center justify-center p-1 transition-all cursor-pointer border ${
                          isSelected 
                            ? 'bg-[#E5B842]/20 border-[#E5B842] ring-2 ring-[#E5B842]/50 text-[#E5B842]' 
                            : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30 hover:text-white'
                        }`}
                        title={item.label}
                      >
                        <IconComp className="w-4 h-4 mb-0.5" />
                        <span className="text-[9px] truncate max-w-full font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Couleur */}
              <div>
                <label className="block text-xs font-bold text-gray-200 mb-1.5">
                  Couleur
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-2 bg-[#021316] rounded-xl border border-[#1b484d]">
                  {PRESET_GRADIENTS.map((p) => {
                    const isSelected = newGradient === p.value;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setNewGradient(p.value)}
                        className={`h-9 rounded-xl bg-gradient-to-br ${p.value} border relative overflow-hidden transition-all shadow-md cursor-pointer ${
                          isSelected ? 'ring-2 ring-[#E5B842] border-white scale-105 z-10' : 'border-white/20 hover:scale-105'
                        }`}
                        title={p.name}
                      >
                        <div className="absolute inset-x-0 top-0 h-1/2 bg-white/25 rounded-t-xl pointer-events-none" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10 mt-5">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-white/10 hover:bg-white/15 transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-black bg-[#E5B842] hover:bg-[#d9ab38] disabled:opacity-50 transition-colors shadow-lg cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Créer le raccourci</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Universal Rename Modal */}
      {(renamingTile || renamingFolderId) && (
        <div 
          className="fixed inset-0 bg-black/75 backdrop-blur-md z-[100] flex items-center justify-center p-4"
          onClick={() => { setRenamingTile(null); setRenamingFolderId(null); }}
        >
          <div 
            className="bg-[#0E1A20] border border-white/15 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-3 text-[#E5B842]">
              {renamingTile ? `Renommer "${renamingTile.title}"` : 'Renommer le dossier'}
            </h3>
            <form onSubmit={handleRenameFolder} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#E5B842]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setRenamingTile(null); setRenamingFolderId(null); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-black bg-[#E5B842] hover:bg-[#d4a838] transition-colors"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Standalone Top-Level 3D Color Palette Modal (z-[100]) */}
      {paletteTileId && (() => {
        const selectedTile = findTileById(tiles, paletteTileId);
        if (!selectedTile) return null;

        return (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
            onClick={() => setPaletteTileId(null)}
          >
            <div 
              className="bg-[#0b1c1e] border border-[#1a4a4e] rounded-3xl p-5 sm:p-6 shadow-2xl max-w-lg w-full text-white relative animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-white/10 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                    <Palette className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Thème de Couleur 3D</h3>
                    <p className="text-xs text-amber-400 font-semibold">{selectedTile.title}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setPaletteTileId(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white transition-colors cursor-pointer"
                  title="Fermer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Live Preview of Selected Tile */}
              <div className="mb-4 flex flex-col items-center justify-center">
                <p className="text-[11px] text-gray-400 mb-2 uppercase tracking-wider font-bold">Aperçu en direct</p>
                <div className={`w-48 h-24 sm:w-56 sm:h-28 rounded-2xl bg-gradient-to-br ${selectedTile.gradient} p-3 flex flex-col items-center justify-center text-center shadow-[0_12px_28px_-6px_rgba(0,0,0,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.45)] border border-t-white/30 border-l-white/20 border-b-black/50 relative overflow-hidden transition-all duration-300`}>
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
                  <span className="text-white font-extrabold text-sm sm:text-base drop-shadow-md z-10">{selectedTile.title}</span>
                  <span className="text-[10px] text-white/80 font-medium mt-1 z-10 bg-black/30 px-2 py-0.5 rounded-full border border-white/10">Effet Relief 3D</span>
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300">24 Nuances Lumineuses 3D</span>
                <span className="text-[10px] text-amber-400 font-mono">Cliquez pour appliquer</span>
              </div>

              {/* 24 Presets Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-60 overflow-y-auto custom-scrollbar p-2 bg-black/40 rounded-2xl border border-white/10">
                {PRESET_GRADIENTS.map((p) => {
                  const isSelected = selectedTile.gradient === p.value;
                  return (
                    <button
                      key={p.name}
                      onClick={() => handleUpdateColor(selectedTile.id, p.value)}
                      className={`group relative h-12 rounded-xl bg-gradient-to-br ${p.value} border transition-all duration-200 flex flex-col items-center justify-end p-1.5 cursor-pointer shadow-md hover:scale-[1.05] ${
                        isSelected ? 'ring-2 ring-amber-400 border-white scale-105 z-10' : 'border-white/20 hover:border-white'
                      }`}
                      title={p.name}
                    >
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-white/25 rounded-t-xl pointer-events-none" />
                      <span className="text-[10px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] truncate max-w-full z-10">
                        {p.name}
                      </span>
                      {isSelected && (
                        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-black" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setPaletteTileId(null)}
                  className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  Valider & Fermer
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default AccueilGrid;
