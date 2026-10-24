import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Hash,
  Video,
  RefreshCw,
  Bell,
  Users,
  ShieldCheck,
  UserPlus,
  Plus,
  FolderPlus,
  Smile,
  Pencil,
  Trash2,
  Eye,
  Check,
  CheckCheck,
  X,
  Info,
  ChevronRight,
  ChevronDown,
  Film,
  Image as ImageIcon,
  MoreVertical,
  Lock,
  CornerDownRight,
  History,
  Shield,
  Download,
  ExternalLink,
  GripVertical,
  Folder,
  FolderOpen,
  Mic,
  Square,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  Paperclip
} from 'lucide-react';
import { ChatMessage, ChatGroup, ChatGroupMember, ChatMessageReaction, ChatMessageReadBy } from '@/types';
import {
  createGoogleMeetSpace,
  getCachedAccessToken,
  requestWorkspaceAccessToken,
  uploadVideoToDriveFolder,
  deleteDriveFile
} from '@/lib/workspace';
import { getImportedStorage, saveImportedStorage } from '@/utils/importedDataManager';
import { useAuth } from '@/context/AuthContext';

// Current Logged-in User Profile
const CURRENT_USER = {
  id: 'tm-1',
  name: 'Sylvain Grazia',
  email: 's.grazia@conseilfinances.fr',
  avatar: 'S',
  role: 'admin' as const
};

// All Available Team Members in CRM
const ALL_TEAM_MEMBERS: ChatGroupMember[] = [
  { id: 'tm-1', name: 'Sylvain Grazia', email: 's.grazia@conseilfinances.fr', avatar: 'S', role: 'admin', joinedAt: '2026-01-01' },
  { id: 'tm-2', name: 'Frédéric', email: 'f.novavisio@novavisio.fr', avatar: 'F', role: 'member', joinedAt: '2026-01-01' },
  { id: 'tm-3', name: 'Sarah', email: 'sarah.immosphera@immosphera.fr', avatar: 'S', role: 'member', joinedAt: '2026-01-01' },
  { id: 'tm-4', name: 'Liam', email: 'liam.conseil@conseilsfinances.fr', avatar: 'L', role: 'member', joinedAt: '2026-01-01' },
  { id: 'tm-5', name: 'Anaïs', email: 'anais.negociation@immosphera.fr', avatar: 'A', role: 'member', joinedAt: '2026-01-01' },
  { id: 'tm-6', name: 'Mathieu', email: 'm.schnell@conseilsfinances.fr', avatar: 'M', role: 'member', joinedAt: '2026-01-01' },
];

// Emojis for quick reactions
const EMOJI_PALETTE = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🚀', '🔥', '👏', '💯', '💡'];

// Helper to check if a string contains ONLY emojis (and whitespace)
function isOnlyEmojis(str: string): boolean {
  if (!str) return false;
  const clean = str.replace(/\s+/g, '');
  if (!clean) return false;
  const emojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])+$/;
  return emojiRegex.test(clean);
}

// Default Groups Setup if storage is empty
const DEFAULT_GROUPS: ChatGroup[] = [
  {
    id: 'les 3 entités',
    name: 'les 3 entités',
    description: 'Groupe obligatoire - Tous les utilisateurs y sont inscrits automatiquement',
    createdBy: 'Sylvain Grazia',
    createdAt: '2026-01-01',
    isSpecialGroup: true,
    members: ALL_TEAM_MEMBERS,
    sortOrder: 0
  },
  {
    id: 'général',
    name: 'général',
    description: 'Canal général de discussion de l\'agence',
    createdBy: 'Sylvain Grazia',
    createdAt: '2026-01-01',
    members: ALL_TEAM_MEMBERS,
    sortOrder: 1
  },
  {
    id: 'dossiers-prêt',
    name: 'dossiers-prêt',
    description: 'Echanges sur les montages de prêt et dossiers banque',
    createdBy: 'Sylvain Grazia',
    createdAt: '2026-01-02',
    members: ALL_TEAM_MEMBERS,
    sortOrder: 2
  },
  {
    id: 'analyse-financiere',
    name: 'Analyse Financière',
    description: 'Sous-groupe dédié aux analyses d\'endettement et calculs de capacité',
    createdBy: 'Sylvain Grazia',
    createdAt: '2026-01-05',
    parentId: 'dossiers-prêt',
    inheritParentMembers: true,
    members: ALL_TEAM_MEMBERS,
    sortOrder: 0
  },
  {
    id: 'visites-immo',
    name: 'visites-immo',
    description: 'Organisation des visites immobilières et retours clients',
    createdBy: 'Frédéric',
    createdAt: '2026-01-03',
    members: [ALL_TEAM_MEMBERS[0], ALL_TEAM_MEMBERS[1], ALL_TEAM_MEMBERS[2]],
    sortOrder: 3
  },
  {
    id: 'tours-360',
    name: 'Tours Virtuels 360',
    description: 'Sous-groupe pour la création de visites virtuelles NovaVisio',
    createdBy: 'Frédéric',
    createdAt: '2026-01-06',
    parentId: 'visites-immo',
    inheritParentMembers: true,
    members: [ALL_TEAM_MEMBERS[0], ALL_TEAM_MEMBERS[1], ALL_TEAM_MEMBERS[2]],
    sortOrder: 0
  },
  {
    id: 'siège-conseils',
    name: 'siège-conseils',
    description: 'Échanges stratégiques Conseils Finances Siège',
    createdBy: 'Sylvain Grazia',
    createdAt: '2026-01-04',
    members: [ALL_TEAM_MEMBERS[0], ALL_TEAM_MEMBERS[3], ALL_TEAM_MEMBERS[5]],
    sortOrder: 4
  },
];

// Helper to format seconds as mm:ss
const formatTimer = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

// iOS / iMessage Styled Audio Message Bubble Component
const AudioMessageBubble: React.FC<{
  audioUrl: string;
  duration?: number;
  isMe: boolean;
}> = ({ audioUrl, duration = 0, isMe }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setAudioDuration(Math.round(audio.duration));
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.pause();
    };
  }, [audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((err) => {
        console.warn('Audio play failed:', err);
      });
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newRatio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = newRatio * audioDuration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const progressPercent = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;
  const bars = [30, 60, 90, 50, 80, 40, 100, 70, 45, 85, 60, 35, 75, 40, 20];

  return (
    <div className="flex items-center gap-2.5 py-0.5 select-none w-[170px] sm:w-[190px]">
      <button
        type="button"
        onClick={togglePlay}
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-xs transition-transform active:scale-90 ${
          isMe
            ? 'bg-black text-[#E5B842] hover:bg-neutral-800'
            : 'bg-[#E5B842] text-black hover:bg-[#d4a83b]'
        }`}
        title={isPlaying ? 'Pause' : 'Écouter le message vocal'}
      >
        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 space-y-1 cursor-pointer" onClick={handleSeek}>
        <div className="flex items-center gap-0.5 h-4 w-full">
          {bars.map((barHeight, idx) => {
            const barProgress = (idx / bars.length) * 100;
            const isFilled = barProgress <= progressPercent;

            return (
              <div
                key={idx}
                style={{ height: `${barHeight}%` }}
                className={`flex-1 rounded-full transition-colors duration-150 ${
                  isMe
                    ? isFilled ? 'bg-black' : 'bg-black/30'
                    : isFilled ? 'bg-[#E5B842]' : 'bg-white/20'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[9px] font-mono font-bold opacity-85 px-0.5">
          <span>{formatTimer(currentTime)}</span>
          <span>{formatTimer(audioDuration || 0)}</span>
        </div>
      </div>
    </div>
  );
};

export const ChatView: React.FC = () => {
  const { activeAgency } = useAuth();
  
  // Storage States
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>('les 3 entités');

  // Group Expand / Collapse State (Default: ALL COLLAPSED on initial load)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('crm_chat_expanded_groups_v1');
      if (saved) return JSON.parse(saved);
    } catch (err) {
      console.debug('No stored expanded groups:', err);
    }
    return {}; // Empty object => ALL main groups are collapsed by default
  });

  // Group Rename Inline State
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameInputValue, setRenameInputValue] = useState('');

  // Drag & Drop state
  const [draggedGroup, setDraggedGroup] = useState<ChatGroup | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // UI Controls
  const [inputMsg, setInputMsg] = useState('');
  const [creatingMeet, setCreatingMeet] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pushPermission, setPushPermission] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  // Modal States
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreateSubGroupOpen, setIsCreateSubGroupOpen] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  const [historyModalMsg, setHistoryModalMsg] = useState<ChatMessage | null>(null);
  const [readByModalMsg, setReadByModalMsg] = useState<ChatMessage | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [showEmojiPickerForMsg, setShowEmojiPickerForMsg] = useState<string | null>(null);
  const [deleteConfirmMsgId, setDeleteConfirmMsgId] = useState<string | null>(null);

  // Form States for New Groups
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupSelectedMembers, setNewGroupSelectedMembers] = useState<string[]>([CURRENT_USER.id]);

  // Form States for Sub-Groups
  const [subGroupParentId, setSubGroupParentId] = useState<string>('général');
  const [subGroupName, setSubGroupName] = useState('');
  const [subGroupDesc, setSubGroupDesc] = useState('');
  const [subGroupInherit, setSubGroupInherit] = useState(true);

  // References
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Media Attachment Menu State
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const mediaMenuRef = useRef<HTMLDivElement>(null);

  // Audio Recording States & Refs (iOS Mode Dictée)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState<number[]>([]);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [previewAudioDuration, setPreviewAudioDuration] = useState<number>(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState<boolean>(false);
  const [previewPlaybackTime, setPreviewPlaybackTime] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingAnimFrameRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Save expanded groups preference
  useEffect(() => {
    try {
      localStorage.setItem('crm_chat_expanded_groups_v1', JSON.stringify(expandedGroups));
    } catch (err) {
      console.debug('Failed to save expanded groups:', err);
    }
  }, [expandedGroups]);

  // Toggle Group Collapse/Expand
  const toggleGroupExpand = (groupId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Load Storage Data & Ensure "les 3 entités" exists
  const loadData = () => {
    const storage = getImportedStorage();
    
    let loadedGroups = storage.groups && storage.groups.length > 0 ? storage.groups : DEFAULT_GROUPS;
    
    // Ensure "les 3 entités" exists and contains all team members
    let specialGroup = loadedGroups.find(g => g.id === 'les 3 entités');
    if (!specialGroup) {
      specialGroup = {
        id: 'les 3 entités',
        name: 'les 3 entités',
        description: 'Groupe obligatoire - Tous les utilisateurs y sont inscrits automatiquement',
        createdBy: 'Sylvain Grazia',
        createdAt: '2026-01-01',
        isSpecialGroup: true,
        members: ALL_TEAM_MEMBERS,
        sortOrder: 0
      };
      loadedGroups = [specialGroup, ...loadedGroups];
    } else {
      specialGroup.members = ALL_TEAM_MEMBERS;
    }

    setGroups(loadedGroups);
    setMessages(storage.messages || []);
  };

  useEffect(() => {
    loadData();
    const handleStorageChange = () => loadData();
    window.addEventListener('crm_imported_data_changed', handleStorageChange);
    return () => window.removeEventListener('crm_imported_data_changed', handleStorageChange);
  }, [activeAgency.id]);

  // Scroll to bottom on new message or channel switch
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannel]);

  // Click outside to close media menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mediaMenuRef.current && !mediaMenuRef.current.contains(e.target as Node)) {
        setShowMediaMenu(false);
      }
    };
    if (showMediaMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMediaMenu]);

  // Push Notifications Enable
  const handleEnablePush = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      setPushPermission(perm);
    }
  };

  // Dispatch Notifications (Header Bell + Push)
  const dispatchNotifications = (channelName: string, senderName: string, text: string) => {
    // 1. In-App Header Notification Bell
    const notifItem = {
      id: 'chat-notif-' + Date.now(),
      title: `Nouveau message dans #${channelName}`,
      description: `${senderName}: ${text}`,
      time: 'À l\'instant',
      type: 'mail' as const,
      read: false,
      nav: 'chat',
    };
    window.dispatchEvent(new CustomEvent('crm_add_notification', { detail: notifItem }));

    // 2. Web Push Notification
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const pushNotif = new Notification(`NovaSphere - #${channelName}`, {
          body: `${senderName}: ${text}`,
          icon: '/novasphere-logo.jpg',
          tag: 'chat-msg-' + Date.now(),
        } as NotificationOptions);
        pushNotif.onclick = () => window.focus();
      } catch (_) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification(`NovaSphere - #${channelName}`, {
              body: `${senderName}: ${text}`,
              icon: '/novasphere-logo.jpg',
            });
          });
        }
      }
    }
  };

  // Current Active Group
  const currentGroup = groups.find(g => g.id === activeChannel) || groups[0] || DEFAULT_GROUPS[0];

  // Helper: check if logged user is admin or owner
  const isUserAdminOrGroupOwner = (grp?: ChatGroup) => {
    const targetGroup = grp || currentGroup;
    if (CURRENT_USER.role === 'admin') return true;
    const memberObj = targetGroup.members.find(m => m.id === CURRENT_USER.id || m.email === CURRENT_USER.email);
    return memberObj?.role === 'owner' || memberObj?.role === 'admin' || targetGroup.createdBy === CURRENT_USER.name;
  };

  // ----------------------------------------------------
  // UNREAD MESSAGE COUNTER CALCULATIONS
  // ----------------------------------------------------
  const getUnreadCountForChannel = (channelId: string): number => {
    return messages.filter(m => 
      m.channel === channelId && 
      !m.deletedForMe?.includes(CURRENT_USER.id) &&
      !m.readBy?.some(r => r.userId === CURRENT_USER.id)
    ).length;
  };

  const getUnreadCountForMainGroup = (mainGroupId: string): number => {
    const directUnread = getUnreadCountForChannel(mainGroupId);
    const subGroups = groups.filter(g => g.parentId === mainGroupId);
    const subUnread = subGroups.reduce((sum, sub) => sum + getUnreadCountForChannel(sub.id), 0);
    return directUnread + subUnread;
  };

  // ----------------------------------------------------
  // GROUP RENAMING LOGIC
  // ----------------------------------------------------
  const handleStartRename = (group: ChatGroup, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!isUserAdminOrGroupOwner(group)) return;
    setRenamingGroupId(group.id);
    setRenameInputValue(group.name);
  };

  const handleSaveRename = (groupId: string) => {
    if (!renameInputValue.trim()) return;
    const cleanName = renameInputValue.trim();

    const updatedGroups = groups.map(g => {
      if (g.id === groupId) {
        return { ...g, name: cleanName };
      }
      return g;
    });

    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });
    setRenamingGroupId(null);
    setRenameInputValue('');
  };

  // ----------------------------------------------------
  // DRAG AND DROP LOGIC (Groups & Sub-Groups)
  // ----------------------------------------------------
  const handleDragStart = (e: React.DragEvent, group: ChatGroup) => {
    e.stopPropagation();
    setDraggedGroup(group);
    e.dataTransfer.setData('text/plain', group.id);
  };

  const handleDragOver = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedGroup && draggedGroup.id !== targetGroupId) {
      setDragOverGroupId(targetGroupId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetGroup: ChatGroup) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(null);

    if (!draggedGroup || draggedGroup.id === targetGroup.id) return;

    // Case 1: Reordering two main groups
    if (!draggedGroup.parentId && !targetGroup.parentId) {
      const mainGroupsList = groups.filter(g => !g.parentId);
      const draggedIdx = mainGroupsList.findIndex(g => g.id === draggedGroup.id);
      const targetIdx = mainGroupsList.findIndex(g => g.id === targetGroup.id);

      if (draggedIdx >= 0 && targetIdx >= 0) {
        const reordered = [...mainGroupsList];
        const [moved] = reordered.splice(draggedIdx, 1);
        reordered.splice(targetIdx, 0, moved);

        const updatedMainWithOrders = reordered.map((g, idx) => ({ ...g, sortOrder: idx }));
        const subGroupsList = groups.filter(g => g.parentId);

        const newAllGroups = [...updatedMainWithOrders, ...subGroupsList];
        setGroups(newAllGroups);
        saveImportedStorage({ groups: newAllGroups });
      }
    }
    // Case 2: Dragging a sub-group onto another main group (move parent)
    else if (draggedGroup.parentId && !targetGroup.parentId) {
      const updatedGroups = groups.map(g => {
        if (g.id === draggedGroup.id) {
          return { ...g, parentId: targetGroup.id };
        }
        return g;
      });
      setGroups(updatedGroups);
      saveImportedStorage({ groups: updatedGroups });
    }
    // Case 3: Reordering sub-groups inside same parent or different parent
    else if (draggedGroup.parentId && targetGroup.parentId) {
      const updatedGroups = groups.map(g => {
        if (g.id === draggedGroup.id) {
          return { ...g, parentId: targetGroup.parentId };
        }
        return g;
      });
      setGroups(updatedGroups);
      saveImportedStorage({ groups: updatedGroups });
    }

    setDraggedGroup(null);
  };

  // ----------------------------------------------------
  // MESSAGES HANDLING & VOICE RECORDING
  // ----------------------------------------------------
  const handleStartRecording = async () => {
    try {
      audioChunksRef.current = [];
      setRecordingLevels([]);
      setRecordingTime(0);

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        }).catch((err) => {
          console.warn('Microphone permission denied or unavailable:', err);
          return null;
        });

        if (stream) {
          // Select best supported lightweight audio mime type
          let mimeType = 'audio/webm';
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
          } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            mimeType = 'audio/ogg';
          }

          const options = mimeType ? { mimeType } : undefined;
          const mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current = mediaRecorder;

          try {
            const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            source.connect(analyser);

            audioContextRef.current = audioCtx;
            analyserRef.current = analyser;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateLevels = () => {
              if (analyser) {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                const avg = sum / dataArray.length;
                const normalized = Math.min(100, Math.max(12, Math.round((avg / 128) * 100)));

                setRecordingLevels(prev => {
                  const next = [...prev, normalized];
                  return next.slice(-28);
                });
              }
              recordingAnimFrameRef.current = requestAnimationFrame(updateLevels);
            };
            recordingAnimFrameRef.current = requestAnimationFrame(updateLevels);
          } catch (e) {
            console.debug('Web Audio API visualization error:', e);
          }

          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunksRef.current.push(e.data);
            }
          };

          mediaRecorder.start(100);
          setIsRecording(true);

          recordingTimerRef.current = setInterval(() => {
            setRecordingTime(t => {
              const newTime = t + 1;
              if (newTime >= 240) {
                setTimeout(() => handleStopRecording(false), 0);
              }
              return newTime;
            });
          }, 1000);

          return;
        }
      }

      alert("Impossible d'accéder au microphone. Veuillez autoriser l'accès au micro dans votre navigateur.");

    } catch (err) {
      console.error('Recording start error:', err);
      alert("Erreur lors de l'accès au microphone.");
    }
  };

  const handleStopRecording = (cancel = false) => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recordingAnimFrameRef.current) {
      cancelAnimationFrame(recordingAnimFrameRef.current);
      recordingAnimFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (cancel) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      setIsRecording(false);
      setRecordingTime(0);
      setRecordingLevels([]);
      audioChunksRef.current = [];
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const finalDuration = recordingTime || 1;
      const mimeType = mediaRecorderRef.current.mimeType || 'audio/webm';
      
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          setPreviewAudioUrl(base64Audio);
          setPreviewAudioDuration(finalDuration);
        };
        reader.readAsDataURL(audioBlob);

        mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
      };
      mediaRecorderRef.current.stop();
    } else {
      setIsRecording(false);
      setRecordingTime(0);
      setRecordingLevels([]);
    }
  };

  const handleTogglePreviewPlay = () => {
    if (!previewAudioUrl) return;

    if (isPreviewPlaying && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPreviewPlaying(false);
    } else {
      const audio = previewAudioRef.current || new Audio(previewAudioUrl);
      previewAudioRef.current = audio;

      audio.ontimeupdate = () => setPreviewPlaybackTime(audio.currentTime);
      audio.onended = () => {
        setIsPreviewPlaying(false);
        setPreviewPlaybackTime(0);
      };

      audio.play().then(() => {
        setIsPreviewPlaying(true);
      }).catch(err => {
        console.error('Preview playback failed:', err);
      });
    }
  };

  const handleDiscardPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewAudioUrl(null);
    setPreviewAudioDuration(0);
    setIsPreviewPlaying(false);
    setPreviewPlaybackTime(0);
  };

  const handleSendPreviewVoice = () => {
    if (!previewAudioUrl) return;
    handleSendMessage(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      previewAudioUrl,
      previewAudioDuration
    );
    handleDiscardPreview();
  };

  const handleSendMessage = (
    e?: React.FormEvent,
    imageUrl?: string,
    videoUrl?: string,
    driveFileId?: string,
    driveFolderName?: string,
    audioUrl?: string,
    audioDuration?: number
  ) => {
    if (e) e.preventDefault();
    if (!inputMsg.trim() && !imageUrl && !videoUrl && !audioUrl) return;

    const senderName = CURRENT_USER.name;
    const messageText = inputMsg.trim();

    const nowIso = new Date().toISOString();
    const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let defaultMsgText = messageText;
    if (!defaultMsgText) {
      if (imageUrl) defaultMsgText = '📷 Image partagée';
      else if (videoUrl) defaultMsgText = '🎥 Vidéo partagée';
      else if (audioUrl) defaultMsgText = '🎤 Message vocal';
    }

    const newM: ChatMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      sender: senderName,
      senderId: CURRENT_USER.id,
      senderAvatar: CURRENT_USER.avatar,
      message: defaultMsgText,
      timestamp: formattedTime,
      isMe: true,
      channel: activeChannel,
      agencyId: activeAgency.id,
      reactions: [],
      readBy: [{ userId: CURRENT_USER.id, userName: CURRENT_USER.name, readAt: nowIso }],
      imageUrl,
      videoUrl,
      audioUrl,
      audioDuration,
      driveFileId,
      driveFolderName
    };

    const currentMsgs = getImportedStorage().messages;
    saveImportedStorage({ messages: [...currentMsgs, newM] });
    dispatchNotifications(currentGroup.name, senderName, newM.message);
    setInputMsg('');
  };

  // Image Upload
  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) handleSendMessage(undefined, dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Video Upload with Google Drive Integration
  const handleVideoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingMedia(true);
    const entityName = activeAgency.name || 'NovaSphere';
    const driveFolder = `Messages CRM / ${entityName}`;

    try {
      let token = getCachedAccessToken();
      if (!token) {
        token = await requestWorkspaceAccessToken().catch(() => null);
      }

      if (token) {
        const uploadRes = await uploadVideoToDriveFolder(token, file, entityName);
        handleSendMessage(
          undefined,
          undefined,
          uploadRes.fileUrl,
          uploadRes.fileId,
          uploadRes.folderName
        );
      } else {
        const localVideoUrl = URL.createObjectURL(file);
        handleSendMessage(
          undefined,
          undefined,
          localVideoUrl,
          `local-${Date.now()}`,
          driveFolder
        );
      }
    } catch (err) {
      console.error('Erreur upload vidéo Drive:', err);
      const localVideoUrl = URL.createObjectURL(file);
      handleSendMessage(
        undefined,
        undefined,
        localVideoUrl,
        `fallback-${Date.now()}`,
        driveFolder
      );
    } finally {
      setUploadingMedia(false);
      e.target.value = '';
    }
  };

  // Edit Message
  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditInput(msg.message);
  };

  const handleSaveEdit = (msgId: string) => {
    if (!editInput.trim()) return;

    const currentStorage = getImportedStorage();
    const updatedMessages = (currentStorage.messages || []).map(m => {
      if (m.id === msgId) {
        const history = m.editHistory || [];
        return {
          ...m,
          message: editInput.trim(),
          isEdited: true,
          editHistory: [
            ...history,
            { message: m.message, editedAt: new Date().toLocaleString() }
          ]
        };
      }
      return m;
    });

    saveImportedStorage({ messages: updatedMessages });
    setEditingMsgId(null);
    setEditInput('');
  };

  // Delete Message ("Supprimer pour tout le monde" vs "Supprimer pour moi")
  const handleDeleteMessageForEveryone = async (msg: ChatMessage) => {
    if (msg.driveFileId && !msg.driveFileId.startsWith('local') && !msg.driveFileId.startsWith('fallback')) {
      const token = getCachedAccessToken();
      if (token) {
        await deleteDriveFile(token, msg.driveFileId).catch(() => {});
      }
    }

    const currentStorage = getImportedStorage();
    const updatedMessages = (currentStorage.messages || []).map(m => {
      if (m.id === msg.id) {
        return {
          ...m,
          message: 'Ce message a été supprimé',
          isDeleted: true,
          imageUrl: undefined,
          videoUrl: undefined,
          driveFileId: undefined
        };
      }
      return m;
    });

    saveImportedStorage({ messages: updatedMessages });
    setDeleteConfirmMsgId(null);
  };

  const handleDeleteMessageForMe = (msgId: string) => {
    const currentStorage = getImportedStorage();
    const updatedMessages = (currentStorage.messages || []).map(m => {
      if (m.id === msgId) {
        const deletedForMe = m.deletedForMe || [];
        return {
          ...m,
          deletedForMe: [...deletedForMe, CURRENT_USER.id]
        };
      }
      return m;
    });

    saveImportedStorage({ messages: updatedMessages });
    setDeleteConfirmMsgId(null);
  };

  // Toggle Emoji Reaction
  const handleToggleReaction = (msgId: string, emoji: string) => {
    const currentStorage = getImportedStorage();
    const updatedMessages = (currentStorage.messages || []).map(m => {
      if (m.id === msgId) {
        const reactions = m.reactions || [];
        const existingIdx = reactions.findIndex(r => r.emoji === emoji);

        if (existingIdx >= 0) {
          const targetReaction = reactions[existingIdx];
          const hasUser = targetReaction.users.some(u => u.id === CURRENT_USER.id);

          if (hasUser) {
            targetReaction.users = targetReaction.users.filter(u => u.id !== CURRENT_USER.id);
          } else {
            targetReaction.users.push({ id: CURRENT_USER.id, name: CURRENT_USER.name });
          }

          if (targetReaction.users.length === 0) {
            reactions.splice(existingIdx, 1);
          }
        } else {
          reactions.push({
            emoji,
            users: [{ id: CURRENT_USER.id, name: CURRENT_USER.name }]
          });
        }

        return { ...m, reactions };
      }
      return m;
    });

    saveImportedStorage({ messages: updatedMessages });
    setShowEmojiPickerForMsg(null);
  };

  // Read Receipt Recording
  const markMessageAsRead = (msg: ChatMessage) => {
    const readBy = msg.readBy || [];
    if (!readBy.some(r => r.userId === CURRENT_USER.id)) {
      const currentStorage = getImportedStorage();
      const nowIso = new Date().toISOString();
      const updatedMessages = (currentStorage.messages || []).map(m => {
        if (m.id === msg.id) {
          return {
            ...m,
            readBy: [...(m.readBy || []), { userId: CURRENT_USER.id, userName: CURRENT_USER.name, readAt: nowIso }]
          };
        }
        return m;
      });
      saveImportedStorage({ messages: updatedMessages });
    }
  };

  // Google Meet Creation
  const handleCreateMeet = async () => {
    setCreatingMeet(true);
    const senderName = CURRENT_USER.name;
    try {
      let token = getCachedAccessToken();
      if (!token) {
        token = await requestWorkspaceAccessToken();
      }

      const space = await createGoogleMeetSpace(token);
      const meetText = `🎥 Réunion Google Meet démarrée ! Rejoindre ici: ${space.meetingUri}`;
      
      const newM: ChatMessage = {
        id: 'msg-' + Date.now(),
        sender: senderName,
        senderId: CURRENT_USER.id,
        senderAvatar: CURRENT_USER.avatar,
        message: meetText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
        channel: activeChannel,
        agencyId: activeAgency.id,
        readBy: [{ userId: CURRENT_USER.id, userName: CURRENT_USER.name, readAt: new Date().toISOString() }]
      };
      const curM = getImportedStorage().messages;
      saveImportedStorage({ messages: [...curM, newM] });
      dispatchNotifications(currentGroup.name, senderName, 'Réunion Google Meet créée');
    } catch (err: unknown) {
      console.error(err);
      const fallbackUri = `https://meet.google.com/nova-${Math.random().toString(36).substring(2, 7)}`;
      const fallbackText = `🎥 Réunion Google Meet créée ! Rejoindre ici: ${fallbackUri}`;
      
      const fallbackMessage: ChatMessage = {
        id: 'msg-' + Date.now(),
        sender: senderName,
        senderId: CURRENT_USER.id,
        senderAvatar: CURRENT_USER.avatar,
        message: fallbackText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
        channel: activeChannel,
        agencyId: activeAgency.id,
        readBy: [{ userId: CURRENT_USER.id, userName: CURRENT_USER.name, readAt: new Date().toISOString() }]
      };
      const curMF = getImportedStorage().messages;
      saveImportedStorage({ messages: [...curMF, fallbackMessage] });
      dispatchNotifications(currentGroup.name, senderName, 'Réunion Google Meet créée');
    } finally {
      setCreatingMeet(false);
    }
  };

  // Group Creation
  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    const selectedMembersObjects = ALL_TEAM_MEMBERS.filter(m => newGroupSelectedMembers.includes(m.id));
    const creatorObj = selectedMembersObjects.find(m => m.id === CURRENT_USER.id);
    if (creatorObj) creatorObj.role = 'owner';

    const newG: ChatGroup = {
      id: 'grp-' + Date.now(),
      name: newGroupName.trim().toLowerCase().replace(/\s+/g, '-'),
      description: newGroupDesc.trim() || 'Groupe de discussion CRM',
      createdBy: CURRENT_USER.name,
      createdAt: new Date().toISOString().split('T')[0],
      members: selectedMembersObjects.length > 0 ? selectedMembersObjects : ALL_TEAM_MEMBERS,
      agencyId: activeAgency.id,
      sortOrder: groups.length
    };

    const updatedGroups = [...groups, newG];
    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });

    setActiveChannel(newG.id);
    setIsCreateGroupOpen(false);
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupSelectedMembers([CURRENT_USER.id]);
  };

  // Sub-Group Creation
  const handleCreateSubGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subGroupName.trim()) return;

    const parentGroup = groups.find(g => g.id === subGroupParentId);
    let subMembers = ALL_TEAM_MEMBERS;
    if (parentGroup && subGroupInherit) {
      subMembers = parentGroup.members;
    }

    const newSubG: ChatGroup = {
      id: 'subgrp-' + Date.now(),
      name: subGroupName.trim(),
      description: subGroupDesc.trim() || `Sous-groupe rattaché à #${parentGroup?.name || subGroupParentId}`,
      createdBy: CURRENT_USER.name,
      createdAt: new Date().toISOString().split('T')[0],
      parentId: subGroupParentId,
      inheritParentMembers: subGroupInherit,
      members: subMembers,
      agencyId: activeAgency.id,
      sortOrder: 0
    };

    const updatedGroups = [...groups, newSubG];
    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });

    // Expand parent group so sub-group is visible
    setExpandedGroups(prev => ({ ...prev, [subGroupParentId]: true }));

    setActiveChannel(newSubG.id);
    setIsCreateSubGroupOpen(false);
    setSubGroupName('');
    setSubGroupDesc('');
  };

  // Member & Group Management
  const handleChangeMemberRole = (memberId: string, newRole: 'admin' | 'owner' | 'member') => {
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        const updatedMembers = g.members.map(m => m.id === memberId ? { ...m, role: newRole } : m);
        return { ...g, members: updatedMembers };
      }
      return g;
    });
    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });
  };

  const handleRemoveMemberFromGroup = (memberId: string) => {
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        const updatedMembers = g.members.filter(m => m.id !== memberId);
        return { ...g, members: updatedMembers };
      }
      return g;
    });
    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });
  };

  const handleAddMemberToGroup = (memberId: string) => {
    const targetMember = ALL_TEAM_MEMBERS.find(m => m.id === memberId);
    if (!targetMember) return;

    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        if (g.members.some(m => m.id === memberId)) return g;
        return { ...g, members: [...g.members, { ...targetMember, role: 'member' as const }] };
      }
      return g;
    });
    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });
  };

  const handleDeleteGroup = (groupId: string) => {
    const targetGrp = groups.find(g => g.id === groupId);
    if (targetGrp?.isSpecialGroup) return;

    const updatedGroups = groups.filter(g => g.id !== groupId && g.parentId !== groupId);
    setGroups(updatedGroups);
    saveImportedStorage({ groups: updatedGroups });

    setIsMembersModalOpen(false);
    setActiveChannel('les 3 entités');
  };

  // Group Hierarchy & Sorting
  const mainGroups = groups
    .filter(g => !g.parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const getSubGroupsForParent = (parentId: string) => {
    return groups
      .filter(g => g.parentId === parentId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 text-white">
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleImageSelected}
      />
      <input
        type="file"
        ref={videoInputRef}
        accept="video/*"
        className="hidden"
        onChange={handleVideoSelected}
      />

      {/* Top Bar Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white/5 border border-white/10 p-4 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E5B842]/20 border border-[#E5B842]/40 text-[#E5B842] flex items-center justify-center font-bold shadow-xs shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <span>ConnectSphere Chat</span>
            </h1>
            <p className="text-xs text-gray-400">Messagerie instantanée d'équipe & Stockage Vidéo Google Drive</p>
          </div>
        </div>

        {/* Action Controls & Push Notification Badge */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Push Status Button */}
          {pushPermission === 'granted' ? (
            <div className="h-8 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium text-[11px] px-2.5 rounded-lg flex items-center gap-1.5 shadow-xs">
              <Bell className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Push Actif</span>
            </div>
          ) : (
            <button
              onClick={handleEnablePush}
              className="h-8 bg-[#E5B842]/15 hover:bg-[#E5B842]/25 text-[#E5B842] border border-[#E5B842]/40 font-medium text-[11px] px-2.5 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95"
              title="Activer les notifications push sur PC et Mobile"
            >
              <Bell className="w-3.5 h-3.5 shrink-0" />
              <span>Notifications Push</span>
            </button>
          )}

          {/* New Group & Sub-Group Buttons */}
          <button
            onClick={() => setIsCreateSubGroupOpen(true)}
            className="h-8 bg-white/10 hover:bg-white/15 text-white border border-white/15 font-semibold text-xs px-2.5 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95"
            title="Créer un sous-groupe rattaché"
          >
            <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">+ Sous-groupe</span>
          </button>

          <button
            onClick={() => setIsCreateGroupOpen(true)}
            className="h-8 bg-[#E5B842] hover:bg-[#d4a83b] text-black font-bold text-xs px-3 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95"
            title="Créer un groupe principal"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Groupe</span>
          </button>

          {/* Google Meet Button */}
          <button
            onClick={handleCreateMeet}
            disabled={creatingMeet}
            className="h-8 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-3 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95"
          >
            {creatingMeet ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
            <span>Visio Meet</span>
          </button>
        </div>
      </div>

      {/* Main Chat Layout Container */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[680px] bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-lg">
        
        {/* Left Sidebar: Groups & Sub-Groups Drag-and-Drop & Collapsible Tree */}
        <div className="p-3 bg-black/20 border-r border-white/10 space-y-3 flex flex-col justify-between overflow-y-auto custom-scrollbar">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Groupes & Canaux</p>
              <span className="text-[10px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded font-mono">
                {groups.length}
              </span>
            </div>

            <div className="space-y-1.5">
              {mainGroups.map((group) => {
                const isSpecial = group.isSpecialGroup;
                const isSelected = activeChannel === group.id;
                const subGroups = getSubGroupsForParent(group.id);
                const isExpanded = !!expandedGroups[group.id]; // Default: false (collapsed)
                const unreadCount = getUnreadCountForMainGroup(group.id);
                const isRenamingThis = renamingGroupId === group.id;
                const isDragOver = dragOverGroupId === group.id;

                return (
                  <div
                    key={group.id}
                    draggable={!isSpecial}
                    onDragStart={(e) => handleDragStart(e, group)}
                    onDragOver={(e) => handleDragOver(e, group.id)}
                    onDrop={(e) => handleDrop(e, group)}
                    className={`space-y-1 rounded-xl transition-all ${
                      isDragOver ? 'ring-2 ring-amber-400 bg-amber-500/10' : ''
                    }`}
                  >
                    {/* Main Group Container */}
                    {isSpecial ? (
                      <div
                        onClick={() => setActiveChannel(group.id)}
                        className={`w-full cursor-pointer flex flex-col items-start p-2.5 rounded-xl text-xs transition-all shadow-xs ${
                          isSelected
                            ? 'bg-[#E5B842]/30 text-[#E5B842] border-2 border-[#E5B842] font-bold ring-2 ring-[#E5B842]/20'
                            : 'bg-[#E5B842]/20 text-[#E5B842] border border-[#E5B842]/40 hover:bg-[#E5B842]/30 font-semibold'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-0.5">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-[#E5B842] shrink-0" />
                            <span className="capitalize font-bold text-xs tracking-wide">{group.name}</span>
                          </div>
                          
                          {/* Unread Badge for Collapsed / Special Group */}
                          {unreadCount > 0 && (
                            <span className="w-5 h-5 bg-red-500 text-white font-extrabold text-[10px] rounded-full flex items-center justify-center animate-pulse shadow-md">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <p className="text-[9.5px] text-[#E5B842]/90 leading-tight text-left truncate w-full">
                          {group.description}
                        </p>
                      </div>
                    ) : (
                      <div
                        onClick={() => setActiveChannel(group.id)}
                        onDoubleClick={(e) => handleStartRename(group, e)}
                        className={`group/item w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-white/15 text-white border border-white/20 shadow-xs'
                            : 'text-gray-300 hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                          {/* Drag Grip Icon */}
                          <GripVertical className="w-3.5 h-3.5 text-gray-500 opacity-0 group-hover/item:opacity-100 cursor-grab shrink-0" />

                          {/* Collapse/Expand Toggle Chevron */}
                          {subGroups.length > 0 ? (
                            <button
                              onClick={(e) => toggleGroupExpand(group.id, e)}
                              className="p-0.5 hover:bg-white/10 rounded text-gray-400 hover:text-white shrink-0"
                              title={isExpanded ? 'Replier les sous-groupes' : 'Déplier les sous-groupes'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                              )}
                            </button>
                          ) : (
                            <Hash className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}

                          {/* Inline Group Name Editing */}
                          {isRenamingThis ? (
                            <input
                              type="text"
                              value={renameInputValue}
                              onChange={(e) => setRenameInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(group.id);
                                if (e.key === 'Escape') setRenamingGroupId(null);
                              }}
                              onBlur={() => handleSaveRename(group.id)}
                              autoFocus
                              className="bg-black/50 text-white text-xs px-1.5 py-0.5 rounded border border-amber-400 focus:outline-none w-full"
                            />
                          ) : (
                            <span className="truncate" title="Double-cliquer pour renommer">
                              {group.name}
                            </span>
                          )}
                        </div>

                        {/* Unread Counter Badge & Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Rename Quick Pencil Button */}
                          {isUserAdminOrGroupOwner(group) && !isRenamingThis && (
                            <button
                              onClick={(e) => handleStartRename(group, e)}
                              className="opacity-0 group-hover/item:opacity-100 p-1 text-gray-400 hover:text-amber-300 rounded"
                              title="Renommer le groupe"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}

                          {/* Red Unread Badge (Cumulative when collapsed) */}
                          {unreadCount > 0 && (
                            <span className="w-5 h-5 bg-red-500 text-white font-extrabold text-[10px] rounded-full flex items-center justify-center animate-pulse shadow-md">
                              {unreadCount}
                            </span>
                          )}

                          <span className="text-[9px] text-gray-400 bg-black/30 px-1.5 py-0.5 rounded-full font-mono">
                            {group.members.length}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Sub-Groups List (Shown ONLY if parent is EXPANDED) */}
                    {isExpanded && subGroups.length > 0 && (
                      <div className="pl-4 space-y-1 border-l border-amber-500/20 my-1 ml-3">
                        {subGroups.map((sub) => {
                          const isSubSelected = activeChannel === sub.id;
                          const subUnread = getUnreadCountForChannel(sub.id);
                          const isRenamingSub = renamingGroupId === sub.id;

                          return (
                            <div
                              key={sub.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, sub)}
                              onClick={() => setActiveChannel(sub.id)}
                              onDoubleClick={(e) => handleStartRename(sub, e)}
                              className={`group/sub flex items-center justify-between px-2 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors ${
                                isSubSelected
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold'
                                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                                <CornerDownRight className="w-3 h-3 text-amber-400/70 shrink-0" />
                                
                                {isRenamingSub ? (
                                  <input
                                    type="text"
                                    value={renameInputValue}
                                    onChange={(e) => setRenameInputValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveRename(sub.id);
                                      if (e.key === 'Escape') setRenamingGroupId(null);
                                    }}
                                    onBlur={() => handleSaveRename(sub.id)}
                                    autoFocus
                                    className="bg-black/50 text-white text-[11px] px-1 py-0.5 rounded border border-amber-400 focus:outline-none w-full"
                                  />
                                ) : (
                                  <span className="truncate" title="Double-cliquer pour renommer">
                                    {sub.name}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {isUserAdminOrGroupOwner(sub) && !isRenamingSub && (
                                  <button
                                    onClick={(e) => handleStartRename(sub, e)}
                                    className="opacity-0 group-hover/sub:opacity-100 p-0.5 text-gray-400 hover:text-amber-300"
                                    title="Renommer le sous-groupe"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                )}

                                {/* Individual Sub-Group Unread Badge */}
                                {subUnread > 0 && (
                                  <span className="w-4 h-4 bg-red-500 text-white font-extrabold text-[9px] rounded-full flex items-center justify-center shadow-md">
                                    {subUnread}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Main Chat Window */}
        <div className="md:col-span-3 flex flex-col justify-between p-4 bg-black/10 relative">
          
          {/* Active Channel Header Bar */}
          <div className="pb-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              {currentGroup.isSpecialGroup ? (
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#E5B842]/20 text-[#E5B842] border border-[#E5B842]/40 text-xs font-bold">
                  <Users className="w-4 h-4" />
                  <span>#{currentGroup.name}</span>
                </div>
              ) : currentGroup.parentId ? (
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold">
                  <CornerDownRight className="w-4 h-4 text-amber-400" />
                  <span>#{currentGroup.name}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white text-sm font-bold">
                  <Hash className="w-4 h-4 text-amber-400" />
                  <span>#{currentGroup.name}</span>
                </div>
              )}

              <p className="text-xs text-gray-400 hidden sm:block truncate max-w-md">
                {currentGroup.description}
              </p>
            </div>

            {/* Members & Settings Trigger */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMembersModalOpen(true)}
                className="h-7 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 flex items-center gap-1.5 transition-colors"
                title="Gérer les membres et rôles"
              >
                <Users className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold">{currentGroup.members.length} membres</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="space-y-4 overflow-y-auto pr-2 my-3 custom-scrollbar flex-1">
            {messages
              .filter(m => (m.channel === activeChannel || (!m.channel && activeChannel === 'les 3 entités')) && !m.deletedForMe?.includes(CURRENT_USER.id))
              .map((m) => {
                markMessageAsRead(m);
                const isAuthor = m.sender === CURRENT_USER.name || m.senderId === CURRENT_USER.id;
                const canEditDelete = isAuthor || CURRENT_USER.role === 'admin';
                const emojiOnly = isOnlyEmojis(m.message);
                const isPureAudio = !!m.audioUrl && (!m.message || m.message === '🎤 Message vocal' || m.message === 'Message vocal');

                return (
                  <div
                    key={m.id}
                    className={`group relative flex gap-3 max-w-xl ${m.isMe ? 'ml-auto flex-row-reverse' : ''}`}
                  >
                    {/* User Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                      m.isMe ? 'bg-[#E5B842] text-black shadow-xs' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    }`}>
                      {m.senderAvatar || m.sender.charAt(0)}
                    </div>

                    <div className={`space-y-1 ${m.isMe ? 'items-end text-right' : ''}`}>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 px-1">
                        <span className="font-semibold text-gray-300">{m.sender}</span>
                        <span>•</span>
                        <span>{m.timestamp}</span>

                        {/* Edited Indicator */}
                        {m.isEdited && (
                          <button
                            onClick={() => setHistoryModalMsg(m)}
                            className="text-amber-400 hover:underline text-[9.5px] flex items-center gap-0.5"
                            title="Voir l'historique d'édition"
                          >
                            <History className="w-2.5 h-2.5" />
                            <span>(modifié)</span>
                          </button>
                        )}
                      </div>

                      {/* Message Bubble Body (With Compact Sizing for Audio/Emoji) */}
                      <div className={`rounded-2xl relative ${
                        isPureAudio ? 'px-3 py-1.5' : 'p-3'
                      } ${
                        m.isDeleted
                          ? 'bg-red-500/10 text-red-300 italic border border-red-500/20 text-xs'
                          : m.isMe
                          ? 'bg-[#E5B842] text-black font-medium shadow-xs'
                          : 'bg-white/10 text-white border border-white/10'
                      }`}>
                        {/* Inline Text Content / Edit Mode */}
                        {editingMsgId === m.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editInput}
                              onChange={(e) => setEditInput(e.target.value)}
                              className="w-full bg-black/30 text-white text-xs p-2 rounded-lg border border-white/20 focus:outline-none"
                              rows={2}
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => setEditingMsgId(null)}
                                className="px-2 py-1 bg-gray-600 text-white rounded text-[10px]"
                              >
                                Annuler
                              </button>
                              <button
                                onClick={() => handleSaveEdit(m.id)}
                                className="px-2 py-1 bg-black text-[#E5B842] font-bold rounded text-[10px]"
                              >
                                Enregistrer
                              </button>
                            </div>
                          </div>
                        ) : emojiOnly ? (
                          /* Large Emoji Display (iMessage/WhatsApp Style) */
                          <p className="text-3xl md:text-4xl leading-tight select-none py-1">
                            {m.message}
                          </p>
                        ) : isPureAudio ? null : (
                          <p className="whitespace-pre-wrap text-xs leading-relaxed">{m.message}</p>
                        )}

                        {/* Attached Image with Lightbox Eye Icon */}
                        {m.imageUrl && !m.isDeleted && (
                          <div className="mt-2 relative rounded-xl overflow-hidden border border-black/20 group/img max-w-sm">
                            <img
                              src={m.imageUrl}
                              alt="Image partagée"
                              className="w-full max-h-60 object-cover cursor-pointer"
                              onClick={() => setLightboxImageUrl(m.imageUrl || null)}
                            />
                            <button
                              onClick={() => setLightboxImageUrl(m.imageUrl || null)}
                              className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center gap-2 text-white font-bold text-xs transition-opacity"
                            >
                              <Eye className="w-5 h-5 text-amber-400" />
                              <span>Aperçu (Lightbox)</span>
                            </button>
                          </div>
                        )}

                        {/* Attached Video with Google Drive Badge */}
                        {m.videoUrl && !m.isDeleted && (
                          <div className="mt-2 space-y-1.5">
                            <div className="p-2 bg-black/40 rounded-xl border border-white/15">
                              <video
                                src={m.videoUrl}
                                controls
                                className="w-full max-h-56 rounded-lg bg-black"
                              />
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-300 bg-amber-500/10 p-1.5 rounded-lg border border-amber-500/20">
                              <Film className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                              <span>Dossier Drive: <strong>{m.driveFolderName || `Messages CRM / ${activeAgency.name}`}</strong></span>
                            </div>
                          </div>
                        )}

                        {/* Attached Voice Note / Audio Message */}
                        {m.audioUrl && !m.isDeleted && (
                          <div className={isPureAudio ? '' : 'mt-2'}>
                            <AudioMessageBubble
                              audioUrl={m.audioUrl}
                              duration={m.audioDuration}
                              isMe={m.isMe}
                            />
                          </div>
                        )}

                        {/* Quick Reaction Bar & Action Buttons on Hover */}
                        {!m.isDeleted && (
                          <div className={`absolute top-0 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-[#1a212d] border border-white/20 rounded-xl p-1 shadow-md z-10 ${
                            m.isMe ? 'left-0 -translate-x-full mr-2' : 'right-0 translate-x-full ml-2'
                          }`}>
                            <button
                              onClick={() => setShowEmojiPickerForMsg(showEmojiPickerForMsg === m.id ? null : m.id)}
                              className="p-1 hover:bg-white/10 rounded-lg text-amber-400"
                              title="Réagir"
                            >
                              <Smile className="w-4 h-4" />
                            </button>

                            {isAuthor && (
                              <button
                                onClick={() => handleStartEdit(m)}
                                className="p-1 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white"
                                title="Éditer le message"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {canEditDelete && (
                              <button
                                onClick={() => setDeleteConfirmMsgId(m.id)}
                                className="p-1 hover:bg-red-500/20 rounded-lg text-red-400"
                                title="Supprimer le message"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}

                        {/* Emoji Picker Popover */}
                        {showEmojiPickerForMsg === m.id && (
                          <div className="absolute top-full left-0 mt-1 bg-[#121924] border border-white/20 p-2 rounded-xl flex gap-1 z-20 shadow-xl">
                            {EMOJI_PALETTE.map((e) => (
                              <button
                                key={e}
                                onClick={() => handleToggleReaction(m.id, e)}
                                className="hover:scale-125 text-base transition-transform p-1"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Displayed Emoji Reaction Chips (Enlarged Emoji Size) */}
                      {m.reactions && m.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.reactions.map((r) => {
                            const hasMyReaction = r.users.some(u => u.id === CURRENT_USER.id);
                            return (
                              <button
                                key={r.emoji}
                                onClick={() => handleToggleReaction(m.id, r.emoji)}
                                className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 transition-all ${
                                  hasMyReaction
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                                    : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                                }`}
                                title={r.users.map(u => u.name).join(', ')}
                              >
                                <span className="text-sm">{r.emoji}</span>
                                <span className="font-semibold text-[11px]">{r.users.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Read Receipts Checkmarks ("Vu par...") */}
                      {m.isMe && !m.isDeleted && (
                        <div className="flex items-center justify-end gap-1 text-[10px] text-gray-400 pt-0.5">
                          <button
                            onClick={() => setReadByModalMsg(m)}
                            className="flex items-center gap-1 hover:text-amber-300 transition-colors"
                            title="Voir les accusés de lecture"
                          >
                            <CheckCheck className={`w-3.5 h-3.5 ${
                              (m.readBy?.length || 0) > 1 ? 'text-amber-400' : 'text-gray-400'
                            }`} />
                            <span>Vu par {m.readBy?.length || 1}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Send Input Bar (Supports Normal, iOS Dictation Mode & Audio Preview) */}
          {isRecording ? (
            /* Mode Dictée iOS - Red Animated Recording Bar */
            <div className="pt-2 border-t border-white/10 flex items-center gap-2 bg-red-950/40 border-red-500/30 p-2 rounded-2xl">
              <div className="flex items-center gap-1.5 text-red-400 font-bold text-xs shrink-0 pl-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
                <span className="font-mono text-[11px]">Dictée {formatTimer(recordingTime)}</span>
              </div>

              {/* Live Waveform Visualization */}
              <div className="flex-1 flex items-center justify-center gap-0.5 h-7 overflow-hidden px-1">
                {(recordingLevels.length > 0
                  ? recordingLevels
                  : [30, 50, 80, 40, 60, 90, 45, 70, 35, 85, 65, 40, 95, 55, 75, 30]
                ).map((lvl, idx) => (
                  <div
                    key={idx}
                    style={{ height: `${lvl}%` }}
                    className="w-1 bg-red-500 rounded-full transition-all duration-75"
                  />
                ))}
              </div>

              {/* Cancel Recording */}
              <button
                type="button"
                onClick={() => handleStopRecording(true)}
                className="p-2 rounded-xl bg-white/10 hover:bg-red-500/30 text-gray-300 hover:text-red-300 transition-colors shrink-0"
                title="Annuler l'enregistrement"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>

              {/* Stop & Review Recording */}
              <button
                type="button"
                onClick={() => handleStopRecording(false)}
                className="bg-red-600 hover:bg-red-500 text-white px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-md transition-transform active:scale-95 shrink-0"
                title="Terminer et réécouter"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Terminer</span>
              </button>
            </div>
          ) : previewAudioUrl ? (
            /* Voice Note Preview State Before Sending */
            <div className="pt-2 border-t border-white/10 flex items-center gap-2 bg-amber-500/10 border-amber-500/30 p-2 rounded-2xl">
              <button
                type="button"
                onClick={handleDiscardPreview}
                className="p-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors shrink-0"
                title="Supprimer la note vocale"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleTogglePreviewPlay}
                className="w-8 h-8 rounded-full bg-[#E5B842] text-black flex items-center justify-center shrink-0 hover:bg-[#d4a83b] transition-transform active:scale-90"
                title={isPreviewPlaying ? 'Pause' : 'Réécouter'}
              >
                {isPreviewPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>

              <div className="flex-1 flex flex-col justify-center gap-1">
                <div className="flex items-center gap-0.5 h-5 w-full">
                  {[25, 40, 60, 30, 75, 90, 50, 80, 40, 65, 85, 35, 95, 75, 45, 60, 80, 30, 50, 70, 40, 20].map((h, i) => {
                    const barProgress = (i / 22) * (previewAudioDuration || 1);
                    const isFilled = barProgress <= previewPlaybackTime;
                    return (
                      <div
                        key={i}
                        style={{ height: `${h}%` }}
                        className={`flex-1 rounded-full ${isFilled ? 'bg-[#E5B842]' : 'bg-white/20'}`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] font-mono text-amber-300/90 px-0.5">
                  <span>Note vocale prête</span>
                  <span>{formatTimer(previewAudioDuration)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSendPreviewVoice}
                className="bg-[#E5B842] hover:bg-[#d4a83b] text-black px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-md transition-transform active:scale-95 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Envoyer</span>
              </button>
            </div>
          ) : (
            /* Normal Message Bar with Mic Trigger */
            <form onSubmit={(e) => handleSendMessage(e)} className="pt-2 border-t border-white/10 flex items-center gap-2">
              {/* Unified Media Attachment Button (Image & Video) */}
              <div className="relative" ref={mediaMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowMediaMenu(!showMediaMenu)}
                  disabled={uploadingMedia}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-amber-400 transition-colors flex items-center justify-center"
                  title="Joindre un média (Image ou Vidéo)"
                >
                  {uploadingMedia ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  ) : (
                    <Paperclip className="w-4 h-4 text-amber-400" />
                  )}
                </button>

                {/* Media Choice Menu */}
                {showMediaMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-52 bg-[#182332] border border-white/20 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMediaMenu(false);
                        imageInputRef.current?.click();
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/10 text-gray-200 hover:text-white transition-colors text-left font-medium"
                    >
                      <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Joindre une image</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMediaMenu(false);
                        videoInputRef.current?.click();
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/10 text-gray-200 hover:text-white transition-colors text-left font-medium"
                    >
                      <Film className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Vidéo (Google Drive)</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleStartRecording}
                className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-500/20 text-gray-300 hover:text-amber-400 transition-colors"
                title="Enregistrer un message vocal (Mode Dictée iOS)"
              >
                <Mic className="w-4 h-4 text-amber-400" />
              </button>

              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder={`Message dans #${currentGroup.name}...`}
                className="flex-1 bg-white/10 border border-white/10 text-white placeholder-gray-400 text-xs px-4 py-2.5 rounded-xl focus:outline-none focus:border-[#E5B842]/50"
              />

              <button
                type="submit"
                className="bg-[#E5B842] hover:bg-[#d9ab38] text-black p-2.5 rounded-xl font-bold flex items-center justify-center shadow-md transition-transform active:scale-95 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* MODAL 1: CREATE MAIN GROUP */}
      {isCreateGroupOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#101823] border border-white/15 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Hash className="w-5 h-5 text-[#E5B842]" />
                <span>Nouveau groupe principal</span>
              </h3>
              <button
                onClick={() => setIsCreateGroupOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Nom du groupe</label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="ex: pôle-crédit, projets-2026"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Description</label>
                <textarea
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Objet et rôle de ce groupe..."
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Inviter des membres</label>
                <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-black/30 rounded-xl border border-white/10 custom-scrollbar">
                  {ALL_TEAM_MEMBERS.map((m) => (
                    <label key={m.id} className="flex items-center justify-between text-xs p-1.5 hover:bg-white/5 rounded-lg cursor-pointer">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#E5B842]/20 text-[#E5B842] flex items-center justify-center font-bold text-[10px]">
                          {m.avatar}
                        </div>
                        <span>{m.name}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={newGroupSelectedMembers.includes(m.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewGroupSelectedMembers([...newGroupSelectedMembers, m.id]);
                          } else {
                            setNewGroupSelectedMembers(newGroupSelectedMembers.filter(id => id !== m.id));
                          }
                        }}
                        className="rounded accent-[#E5B842]"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateGroupOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-xs text-gray-300 rounded-xl font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#E5B842] hover:bg-[#d4a83b] text-xs text-black font-bold rounded-xl shadow-md"
                >
                  Créer le groupe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CREATE SUB-GROUP */}
      {isCreateSubGroupOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#101823] border border-white/15 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-amber-400" />
                <span>Nouveau sous-groupe (Sujet)</span>
              </h3>
              <button
                onClick={() => setIsCreateSubGroupOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubGroup} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Groupe parent rattaché</label>
                <select
                  value={subGroupParentId}
                  onChange={(e) => setSubGroupParentId(e.target.value)}
                  className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  {mainGroups.map((g) => (
                    <option key={g.id} value={g.id} className="bg-[#101823] text-white">
                      #{g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Nom du sous-groupe</label>
                <input
                  type="text"
                  required
                  value={subGroupName}
                  onChange={(e) => setSubGroupName(e.target.value)}
                  placeholder="ex: étude-marché, calcul-capacité"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Description</label>
                <textarea
                  value={subGroupDesc}
                  onChange={(e) => setSubGroupDesc(e.target.value)}
                  placeholder="Sujet spécifique traité..."
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={subGroupInherit}
                  onChange={(e) => setSubGroupInherit(e.target.checked)}
                  className="rounded accent-amber-400"
                />
                <span>Hériter automatiquement des membres du groupe parent</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateSubGroupOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-xs text-gray-300 rounded-xl font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-xs text-black font-bold rounded-xl shadow-md"
                >
                  Créer le sous-groupe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: MEMBERS & PERMISSIONS MANAGEMENT */}
      {isMembersModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#101823] border border-white/15 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-[#E5B842]" />
                  <span>Membres du canal #{currentGroup.name}</span>
                </h3>
                <p className="text-xs text-gray-400">Gestion des accès et rôles au sein du groupe</p>
              </div>
              <button
                onClick={() => setIsMembersModalOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Members List */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              {currentGroup.members.map((m) => {
                const canManageRoles = CURRENT_USER.role === 'admin' || isUserAdminOrGroupOwner();
                return (
                  <div key={m.id} className="flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#E5B842]/20 text-[#E5B842] flex items-center justify-center font-bold text-xs">
                        {m.avatar}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">{m.name}</p>
                        <p className="text-[10px] text-gray-400">{m.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {canManageRoles ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleChangeMemberRole(m.id, e.target.value as 'admin' | 'owner' | 'member')}
                          className="bg-black/40 text-xs text-amber-300 border border-white/10 rounded-lg px-2 py-1 focus:outline-none"
                        >
                          <option value="member" className="bg-[#101823]">Membre</option>
                          <option value="owner" className="bg-[#101823]">Gestionnaire</option>
                          <option value="admin" className="bg-[#101823]">Admin global</option>
                        </select>
                      ) : (
                        <span className="text-[10px] bg-white/10 text-amber-300 px-2 py-1 rounded-lg uppercase font-semibold">
                          {m.role}
                        </span>
                      )}

                      {!currentGroup.isSpecialGroup && canManageRoles && m.id !== CURRENT_USER.id && (
                        <button
                          onClick={() => handleRemoveMemberFromGroup(m.id)}
                          className="p-1 hover:bg-red-500/20 text-red-400 rounded-lg"
                          title="Exclure du groupe"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Member Dropdown */}
            {!currentGroup.isSpecialGroup && isUserAdminOrGroupOwner() && (
              <div className="pt-2 border-t border-white/10 space-y-2">
                <p className="text-xs font-semibold text-gray-300">Ajouter un collaborateur au groupe</p>
                <div className="flex gap-2">
                  <select
                    id="add-member-select"
                    className="flex-1 bg-white/10 border border-white/10 text-xs text-white rounded-xl px-3 py-2 focus:outline-none"
                  >
                    {ALL_TEAM_MEMBERS
                      .filter(tm => !currentGroup.members.some(m => m.id === tm.id))
                      .map(tm => (
                        <option key={tm.id} value={tm.id} className="bg-[#101823]">
                          {tm.name} ({tm.email})
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => {
                      const selectEl = document.getElementById('add-member-select') as HTMLSelectElement;
                      if (selectEl?.value) handleAddMemberToGroup(selectEl.value);
                    }}
                    className="px-3 py-2 bg-[#E5B842] hover:bg-[#d4a83b] text-black text-xs font-bold rounded-xl"
                  >
                    + Ajouter
                  </button>
                </div>
              </div>
            )}

            {/* Danger Zone: Delete Group */}
            {!currentGroup.isSpecialGroup && isUserAdminOrGroupOwner() && (
              <div className="pt-3 border-t border-red-500/20 flex justify-between items-center">
                <p className="text-[11px] text-red-400 font-medium">Zone sensible: supprimer ce groupe</p>
                <button
                  onClick={() => handleDeleteGroup(currentGroup.id)}
                  className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs font-bold rounded-xl"
                >
                  Supprimer le groupe
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 4: READ RECEIPTS ("Vu par...") */}
      {readByModalMsg && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#101823] border border-white/15 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCheck className="w-4 h-4 text-amber-400" />
                <span>Accusés de lecture (Vu par...)</span>
              </h3>
              <button
                onClick={() => setReadByModalMsg(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {readByModalMsg.readBy?.map((r, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs p-2 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2">
                    <CheckCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-semibold text-white">{r.userName}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {new Date(r.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: EDIT HISTORY POPUP */}
      {historyModalMsg && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#101823] border border-white/15 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                <span>Historique des modifications</span>
              </h3>
              <button
                onClick={() => setHistoryModalMsg(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar">
              {historyModalMsg.editHistory?.map((h, idx) => (
                <div key={idx} className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-1 text-xs">
                  <p className="text-gray-200">{h.message}</p>
                  <p className="text-[9.5px] text-amber-400 font-mono text-right">Modifié le {h.editedAt}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: DELETE MESSAGE CONFIRMATION */}
      {deleteConfirmMsgId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#101823] border border-white/15 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <Trash2 className="w-10 h-10 text-red-400 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Supprimer le message</h3>
              <p className="text-xs text-gray-300">Choisissez le mode de suppression pour ce message</p>
            </div>

            <div className="space-y-2 pt-2">
              {(() => {
                const targetMsg = messages.find(m => m.id === deleteConfirmMsgId);
                return (
                  <>
                    <button
                      onClick={() => targetMsg && handleDeleteMessageForEveryone(targetMsg)}
                      className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-md"
                    >
                      Supprimer pour TOUT LE MONDE
                    </button>
                    <button
                      onClick={() => handleDeleteMessageForMe(deleteConfirmMsgId)}
                      className="w-full py-2 bg-white/10 hover:bg-white/15 text-gray-200 font-semibold text-xs rounded-xl"
                    >
                      Supprimer UNIQUEMENT POUR MOI
                    </button>
                  </>
                );
              })()}
              <button
                onClick={() => setDeleteConfirmMsgId(null)}
                className="w-full py-1.5 text-xs text-gray-400 hover:text-white"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX 7: FULLSCREEN IMAGE LIGHTBOX OVERLAY */}
      {lightboxImageUrl && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setLightboxImageUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white hover:text-amber-400 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightboxImageUrl}
              alt="Aperçu grand format"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl border border-white/20 shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatView;
