import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const rawSupabaseUrl = process.env.SUPABASE_URL || 'https://rbzizzzvitxwnfygdpzo.supabase.co';
const SUPABASE_URL = rawSupabaseUrl.startsWith('http') ? rawSupabaseUrl : 'https://rbzizzzvitxwnfygdpzo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  '';

type SupabaseVerifiedUser = { id: string; email: string; displayName?: string | null };
type SupabaseProfile = { id: string; email?: string | null; full_name?: string | null; phone?: string | null; job_title?: string | null; avatar_url?: string | null; push_daily_reminders?: boolean | null; [key: string]: unknown };

type AppRole = 'super_admin' | 'admin' | 'commercial' | 'intern';

function getBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function verifySupabaseToken(token: string): Promise<SupabaseVerifiedUser> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.msg || result?.message || 'Session Supabase invalide.');
  if (!result?.id || !result?.email) throw new Error('Utilisateur Supabase introuvable.');
  return {
    id: result.id,
    email: String(result.email).trim().toLowerCase(),
    displayName: result.user_metadata?.full_name || result.user_metadata?.name || null,
  };
}

async function requireSupabaseUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error('Utilisateur non authentifié.');
  return verifySupabaseToken(token);
}

function serviceHeaders(extra?: Record<string, string>) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurée.');
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function supabaseRequest<T = any>(pathname: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  Object.entries(serviceHeaders()).forEach(([k, v]) => headers.set(k, v));
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) throw new Error(body?.message || body?.error || body?.hint || text || `Erreur Supabase HTTP ${response.status}`);
  return body as T;
}

async function authAdminRequest<T = any>(pathname: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  Object.entries(serviceHeaders({ 'Content-Type': 'application/json' })).forEach(([k, v]) => headers.set(k, v));
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/${pathname}`, { ...options, headers });
  const text = await response.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || body?.error || `Erreur Auth HTTP ${response.status}`);
  return body as T;
}

// Ticket "Inviter un stagiaire" (suivi) : "je crée l'invitation mais je ne
// reçois pas de mail, il faut que ça parte à chaque fois du mail de Sylvain."
// Appelle l'Edge Function send-system-email, qui envoie toujours depuis le
// Gmail de Sylvain (jeton déjà connecté, auto-renouvelé côté serveur —
// ticket #117), quel que soit l'admin qui déclenche l'invitation.
async function sendSystemEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-system-email`, {
      method: 'POST',
      headers: {
        // Authorization : satisfait la vérification JWT de la plateforme
        // Supabase (clé service_role = JWT valide). x-internal-secret : la
        // vraie autorisation vérifiée par la fonction (cf. son code).
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) {
      console.warn('[sendSystemEmail] échec:', body?.error || response.status);
      return { ok: false, error: body?.error || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('[sendSystemEmail] exception:', e.message);
    return { ok: false, error: e.message };
  }
}

async function findProfileByEmail(email: string): Promise<SupabaseProfile | null> {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  const q = new URLSearchParams({ email: `eq.${cleanEmail}`, select: '*', limit: '1' });
  const rows = await supabaseRequest<SupabaseProfile[]>(`profiles?${q}`).catch(() => []);
  if (rows && rows.length > 0) return rows[0];

  const q2 = new URLSearchParams({ email: `ilike.${cleanEmail}`, select: '*', limit: '1' });
  const rows2 = await supabaseRequest<SupabaseProfile[]>(`profiles?${q2}`).catch(() => []);
  return rows2?.[0] || null;
}

async function currentProfile(req: express.Request) {
  const supabaseUser = await requireSupabaseUser(req);
  let profile = await findProfileByEmail(supabaseUser.email);
  if (!profile) {
    const created = await supabaseRequest<SupabaseProfile[]>('profiles', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        id: supabaseUser.id,
        email: supabaseUser.email.toLowerCase(),
        full_name: supabaseUser.displayName || supabaseUser.email,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }).catch((err) => {
      console.warn('[currentProfile] Auto-creation profil Supabase échouée:', err);
      return null;
    });

    profile = created?.[0] || {
      id: supabaseUser.id,
      email: supabaseUser.email.toLowerCase(),
      full_name: supabaseUser.displayName || supabaseUser.email,
    };
  }
  if (profile && (profile as any).is_active === false) {
    throw new Error("Accès refusé : Votre compte est désactivé et l'accès au CRM vous a été retiré.");
  }
  return { supabaseUser, profile };
}

async function getRole(userId: string): Promise<AppRole> {
  const rows = await supabaseRequest<Array<{ role: AppRole }>>(`user_roles?user_id=eq.${userId}&select=role&limit=1`).catch(() => []);
  return rows?.[0]?.role || 'commercial';
}

async function requireAdmin(req: express.Request) {
  const data = await currentProfile(req);
  const SUPER_ADMIN_EMAIL = 's.grazia@conseilfinances.fr';
  if (data.supabaseUser.email.toLowerCase() === SUPER_ADMIN_EMAIL || data.profile.email?.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return { ...data, role: 'super_admin' as AppRole };
  }
  const role = await getRole(data.profile.id);
  if (role !== 'super_admin') throw new Error('Action réservée aux super administrateurs.');
  return { ...data, role };
}

function parseDataUrl(dataUrl: string, fallbackContentType = 'audio/webm') {
  const value = String(dataUrl || '').trim();
  if (!value) throw new Error('Fichier invalide.');

  if (value.startsWith('data:')) {
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0) throw new Error('Fichier invalide.');

    const metadata = value.slice(5, commaIndex);
    const payload = value.slice(commaIndex + 1);
    const contentType = (metadata.split(';')[0] || fallbackContentType).trim();
    const isBase64 = metadata.toLowerCase().split(';').includes('base64');

    const buffer = isBase64
      ? Buffer.from(payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');

    if (!buffer.length) throw new Error('Fichier invalide.');
    return { contentType: contentType || fallbackContentType, buffer };
  }

  const compact = value.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
    const buffer = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (!buffer.length) throw new Error('Fichier invalide.');
    return { contentType: fallbackContentType, buffer };
  }

  throw new Error('Fichier invalide.');
}

async function storageUpload(bucket: string, objectPath: string, buffer: Buffer, contentType: string) {
  const headers = serviceHeaders({ 'Content-Type': contentType, 'x-upsert': 'true' });
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers, body: buffer,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Erreur Storage ${response.status}`);
}

async function storageDelete(bucket: string, paths: string[]) {
  if (!paths.length) return;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: 'DELETE', headers: serviceHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths }),
  });
  if (!response.ok) throw new Error(await response.text());
}

function publicStorageUrl(bucket: string, objectPath: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

function storagePathFromPublicUrl(url: string | null | undefined, bucket: string) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  return idx >= 0 ? decodeURIComponent(url.slice(idx + marker.length)) : null;
}

const createContactTool: FunctionDeclaration = { name: 'create_contact', description: 'Créer un contact.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] } };
const createTaskTool: FunctionDeclaration = { name: 'create_task', description: 'Créer une tâche.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ['title'] } };
const createNoteTool: FunctionDeclaration = { name: 'create_note', description: 'Créer une note.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, content: { type: Type.STRING } }, required: ['title', 'content'] } };
const createAppointmentTool: FunctionDeclaration = { name: 'create_appointment', description: 'Créer un rendez-vous.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, date: { type: Type.STRING } }, required: ['title', 'date'] } };
const getDailySummaryTool: FunctionDeclaration = { name: 'get_daily_summary', description: 'Bilan de la journée.', parameters: { type: Type.OBJECT, properties: {} } };
const getUpcomingBriefTool: FunctionDeclaration = { name: 'get_upcoming_brief', description: 'Résumé des prochains éléments.', parameters: { type: Type.OBJECT, properties: {} } };

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', supabase: SUPABASE_SERVICE_ROLE_KEY ? 'configured' : 'missing', auth: 'supabase', time: new Date().toISOString() }));


  // Chat vocal: enregistre réellement le fichier dans le bucket privé chat-media
  // puis renvoie une URL signée longue durée à stocker dans le message Supabase.
  app.post('/api/chat/voice-upload', async (req, res) => {
    try {
      const supabaseUser = await requireSupabaseUser(req);
      const dataUrl = String(req.body?.dataUrl || '');
      if (!dataUrl) return res.status(400).json({ error: 'Aucun fichier audio reçu.' });

      const { contentType, buffer } = parseDataUrl(dataUrl);
      if (!contentType.startsWith('audio/')) {
        return res.status(400).json({ error: 'Le fichier reçu n’est pas un fichier audio.' });
      }
      if (buffer.length === 0) return res.status(400).json({ error: 'Le fichier audio est vide.' });
      if (buffer.length > 12 * 1024 * 1024) {
        return res.status(413).json({ error: 'Le message vocal est trop volumineux (12 Mo maximum).' });
      }

      const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
      const safeUid = supabaseUser.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const objectPath = `${safeUid}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await storageUpload('chat-media', objectPath, buffer, contentType);

      const signResponse = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/chat-media/${objectPath.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'POST',
          headers: serviceHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ expiresIn: 315360000 }),
        }
      );
      const signText = await signResponse.text();
      let signBody: any = null;
      try { signBody = signText ? JSON.parse(signText) : null; } catch { signBody = null; }
      if (!signResponse.ok) throw new Error(signBody?.message || signText || 'Impossible de créer le lien audio.');

      const signedPath = signBody?.signedURL || signBody?.signedUrl;
      if (!signedPath) throw new Error('Supabase n’a pas renvoyé de lien signé.');
      const audioUrl = signedPath.startsWith('http') ? signedPath : `${SUPABASE_URL}/storage/v1${signedPath}`;

      res.json({ success: true, audioUrl, objectPath, contentType, size: buffer.length });
    } catch (error: any) {
      console.error('[Chat voice upload]', error);
      res.status(500).json({ error: error?.message || 'Impossible d’envoyer le message vocal.' });
    }
  });



  // ==========================================================
  // CHAT — Supabase restauré
  //
  // Projets       -> chat_projects / chat_channels / messages.channel_id
  // Conversations -> conversations / conversation_members / messages.conversation_id
  // Partagés      -> onglet réservé, sans mélange avec les deux scénarios ci-dessus
  // ==========================================================

  app.get('/api/chat/bootstrap', async (req, res) => {
    try {
      const { supabaseUser, profile } = await currentProfile(req);

      const [
        fetchedProjects,
        fetchedChannels,
        projectMembers,
        conversations,
        conversationMembers,
        profiles,
        messages,
        receipts,
        reactions,
        agencyMemberships,
        dismissedItems,
      ] = await Promise.all([
        supabaseRequest<any[]>('chat_projects?select=*&order=position.asc,created_at.asc').catch((err) => { console.warn('[bootstrap chat_projects]', err?.message || err); return []; }),
        supabaseRequest<any[]>('chat_channels?select=*&order=position.asc,created_at.asc').catch((err) => { console.warn('[bootstrap chat_channels]', err?.message || err); return []; }),
        supabaseRequest<any[]>('chat_project_members?select=*').catch((err) => { console.warn('[bootstrap chat_project_members]', err?.message || err); return []; }),
        supabaseRequest<any[]>('conversations?select=*&order=updated_at.desc').catch((err) => { console.warn('[bootstrap conversations]', err?.message || err); return []; }),
        supabaseRequest<any[]>('conversation_members?select=*').catch((err) => { console.warn('[bootstrap conversation_members]', err?.message || err); return []; }),
        supabaseRequest<any[]>('profiles?select=*').catch((err) => { console.warn('[bootstrap profiles]', err?.message || err); return []; }),
        supabaseRequest<any[]>('messages?select=*&order=created_at.asc&limit=1500').catch((err) => { console.warn('[bootstrap messages]', err?.message || err); return []; }),
        supabaseRequest<any[]>('message_receipts?select=*').catch((err) => { console.warn('[bootstrap message_receipts]', err?.message || err); return []; }),
        supabaseRequest<any[]>('message_reactions?select=*').catch((err) => { console.warn('[bootstrap message_reactions]', err?.message || err); return []; }),
        supabaseRequest<any[]>('agency_members?select=user_id,agency_id').catch((err) => { console.warn('[bootstrap agency_members]', err?.message || err); return []; }),
        supabaseRequest<any[]>(
          `user_dismissed_items?user_id=eq.${encodeURIComponent(profile.id)}&item_type=eq.chat_message&select=item_id`
        ).catch(() => []),
      ]);

      let projects = fetchedProjects || [];
      let channels = fetchedChannels || [];

      // Configuration officielle des dossiers et canaux pour l'agence Immosphera
      const IMMOSPHERA_PROJECTS_SPEC = [
        {
          id: 'proj-immo-general',
          name: 'GENERAL',
          agency_id: 'immosphera',
          position: 1,
          channels: [
            { id: 'chan-immo-general', name: 'Immosphera Général', position: 1 },
            { id: 'chan-juridiques', name: 'Juridiques', position: 2 },
          ],
        },
        {
          id: 'proj-airbnb-eva',
          name: 'AIRBNB EVA',
          agency_id: 'immosphera',
          position: 2,
          channels: [
            { id: 'chan-dates-reservations', name: 'Dates de réservations', position: 1 },
          ],
        },
        {
          id: 'proj-passerelles',
          name: 'PASSERELLES',
          agency_id: 'immosphera',
          position: 3,
          channels: [
            { id: 'chan-nouveautes', name: 'Nouveautés', position: 1 },
          ],
        },
        {
          id: 'proj-posts-biens',
          name: 'POSTS BIENS',
          agency_id: 'immosphera',
          position: 4,
          channels: [
            { id: 'chan-postez-biens', name: 'Postez vos biens', position: 1 },
          ],
        },
        {
          id: 'proj-rencontre-equipe',
          name: 'RENCONTRE EQUIPE',
          agency_id: 'immosphera',
          position: 5,
          channels: [
            { id: 'chan-rencontres-equipes', name: 'Rencontres équipes', position: 1 },
            { id: 'chan-reunions-formations', name: 'Réunions / Formations - pour agent co', position: 2 },
          ],
        },
        {
          id: 'proj-crm',
          name: 'CRM',
          agency_id: 'immosphera',
          position: 6,
          channels: [
            { id: 'chan-videos', name: 'Vidéos', position: 1 },
          ],
        },
        {
          id: 'proj-reseaux-sociaux',
          name: 'RÉSEAUX SOCIAUX',
          agency_id: 'immosphera',
          position: 7,
          channels: [
            { id: 'chan-prompt-ai', name: 'Prompt AI pour les publications', position: 1 },
            { id: 'chan-coordinations-pub', name: 'Coordinations des publications', position: 2 },
          ],
        },
      ];

      // Auto-synchronisation des projets et canaux Immosphera dans Supabase
      const existingImmoProjIds = new Set(
        (projects || []).filter((p: any) => p.agency_id === 'immosphera').map((p: any) => p.id)
      );
      let needsRefetch = false;

      for (const pSpec of IMMOSPHERA_PROJECTS_SPEC) {
        if (!existingImmoProjIds.has(pSpec.id)) {
          needsRefetch = true;
          await supabaseRequest('chat_projects', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify({
              id: pSpec.id,
              name: pSpec.name,
              agency_id: pSpec.agency_id,
              position: pSpec.position,
              created_by: profile.id,
              created_at: new Date().toISOString(),
            }),
          }).catch(() => null);

          for (const chSpec of pSpec.channels) {
            await supabaseRequest('chat_channels', {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates' },
              body: JSON.stringify({
                id: chSpec.id,
                name: chSpec.name,
                project_id: pSpec.id,
                position: chSpec.position,
                created_by: profile.id,
                created_at: new Date().toISOString(),
              }),
            }).catch(() => null);
          }
        }
      }

      if (needsRefetch) {
        const [refetchedProjects, refetchedChannels] = await Promise.all([
          supabaseRequest<any[]>('chat_projects?select=*&order=position.asc,created_at.asc').catch(() => null),
          supabaseRequest<any[]>('chat_channels?select=*&order=position.asc,created_at.asc').catch(() => null),
        ]);
        if (refetchedProjects) projects = refetchedProjects;
        if (refetchedChannels) channels = refetchedChannels;
      }

      // Restreint Immosphera strictement aux 7 dossiers spécifiés
      const officialImmospheraProjectIds = new Set(IMMOSPHERA_PROJECTS_SPEC.map(p => p.id));
      projects = (projects || []).filter(
        (p: any) => p.agency_id !== 'immosphera' || officialImmospheraProjectIds.has(p.id)
      );

      const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));
      const displayName = (p: any) =>
        p?.full_name ||
        p?.display_name ||
        [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
        p?.email ||
        'Utilisateur';

      const uiUserId = (profileId: string) =>
        profileId === profile.id ? supabaseUser.id : profileId;

      const projectById = new Map((projects || []).map((p: any) => [p.id, p]));

      const projectMemberIds = new Map<string, string[]>();
      for (const row of projectMembers || []) {
        const list = projectMemberIds.get(row.project_id) || [];
        list.push(row.user_id);
        projectMemberIds.set(row.project_id, list);
      }

      const conversationMemberIds = new Map<string, string[]>();
      for (const row of conversationMembers || []) {
        const list = conversationMemberIds.get(row.conversation_id) || [];
        list.push(row.user_id);
        conversationMemberIds.set(row.conversation_id, list);
      }

      const agenciesByUser = new Map<string, string[]>();
      for (const membership of agencyMemberships || []) {
        const list = agenciesByUser.get(membership.user_id) || [];
        if (!list.includes(membership.agency_id)) list.push(membership.agency_id);
        agenciesByUser.set(membership.user_id, list);
      }

      const inferConversationAgency = (conversation: any, memberIds: string[]) => {
        if (conversation.agency_id) return conversation.agency_id;

        const memberships = memberIds
          .map((userId: string) => agenciesByUser.get(userId) || [])
          .filter((ids: string[]) => ids.length > 0);

        if (memberships.length) {
          const intersection = memberships.reduce(
            (common: string[], ids: string[]) => common.filter(id => ids.includes(id)),
            [...memberships[0]]
          );
          if (intersection.length === 1) return intersection[0];
        }

        const creatorAgencies = agenciesByUser.get(conversation.created_by) || [];
        if (creatorAgencies.length === 1) return creatorAgencies[0];

        return null;
      };

      const toMember = (profileId: string) => {
        const p = profileById.get(profileId) || {};
        const name = displayName(p);
        return {
          id: uiUserId(profileId),
          profileId,
          name,
          email: p.email || '',
          avatar: name.charAt(0).toUpperCase(),
          role: profileId === profile.id ? 'owner' : 'member',
          joinedAt: new Date().toISOString(),
        };
      };

      const groups: any[] = [];

      // 1. Dossiers Projets Parents
      for (const project of projects || []) {
        const memberIds = projectMemberIds.get(project.id) || [];
        groups.push({
          id: project.id,
          name: project.name,
          description: project.description || '',
          createdBy: displayName(profileById.get(project.created_by)),
          createdAt: project.created_at,
          agencyId: project.agency_id || undefined,
          sortOrder: Number(project.position || 0),
          members: memberIds.length ? memberIds.map(toMember) : (profiles || []).map((p: any) => toMember(p.id)),
          chatMode: 'projects',
          projectId: project.id,
          projectName: project.name,
          parentId: null,
        });
      }

      // 2. Canaux Projets (Sous-groupes rattachés)
      for (const channel of channels || []) {
        const project = projectById.get(channel.project_id);
        if (!project) continue; // Ignore orphan channels
        const memberIds = projectMemberIds.get(channel.project_id) || [];
        const formattedName = channel.name.startsWith('#') ? channel.name : `# ${channel.name}`;
        groups.push({
          id: channel.id,
          name: formattedName,
          description: channel.description || '',
          createdBy: displayName(profileById.get(channel.created_by)),
          createdAt: channel.created_at,
          agencyId: project?.agency_id || undefined,
          parentId: channel.project_id,
          sortOrder: Number(channel.position || 0),
          members: memberIds.length ? memberIds.map(toMember) : (profiles || []).map((p: any) => toMember(p.id)),
          chatMode: 'projects',
          projectId: channel.project_id,
          projectName: project?.name || 'Projet',
        });
      }

      // Conversations directes / groupes classiques.
      for (const conversation of conversations || []) {
        const memberIds = conversationMemberIds.get(conversation.id) || [];
        let title = conversation.title;

        if (!title && memberIds.length) {
          const otherNames = memberIds
            .filter((id: string) => id !== profile.id)
            .map((id: string) => displayName(profileById.get(id)));
          title = otherNames.join(', ') || 'Conversation';
        }

        const inferredAgencyId = inferConversationAgency(conversation, memberIds);

        // Reclasse réellement les anciennes conversations sans agence
        // uniquement lorsqu'une agence unique peut être déterminée sans ambiguïté.
        if (!conversation.agency_id && inferredAgencyId) {
          void supabaseRequest(
            `conversations?id=eq.${encodeURIComponent(conversation.id)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                agency_id: inferredAgencyId,
                updated_at: new Date().toISOString(),
              }),
            }
          ).catch(() => null);
        }

        groups.push({
          id: conversation.id,
          name: title || 'Conversation',
          description: String(conversation.type || 'Conversation'),
          createdBy: displayName(profileById.get(conversation.created_by)),
          createdAt: conversation.created_at,
          agencyId: inferredAgencyId || undefined,
          sortOrder: 0,
          members: memberIds.map(toMember),
          chatMode: 'conversations',
        });
      }

      const readsByMessage = new Map<string, any[]>();
      for (const row of receipts || []) {
        if (!row.read_at) continue;
        const p = profileById.get(row.user_id) || {};
        const list = readsByMessage.get(row.message_id) || [];
        list.push({
          userId: uiUserId(row.user_id),
          userName: displayName(p),
          readAt: row.read_at,
        });
        readsByMessage.set(row.message_id, list);
      }

      const reactionsByMessage = new Map<string, Map<string, any[]>>();
      for (const row of reactions || []) {
        const p = profileById.get(row.user_id) || {};
        const byEmoji = reactionsByMessage.get(row.message_id) || new Map<string, any[]>();
        const users = byEmoji.get(row.emoji) || [];
        users.push({ id: uiUserId(row.user_id), name: displayName(p) });
        byEmoji.set(row.emoji, users);
        reactionsByMessage.set(row.message_id, byEmoji);
      }

      const dismissedMessageIds = new Set(
        (dismissedItems || []).map((item: any) => String(item.item_id))
      );

      const formattedMessages = (messages || [])
        .filter((m: any) => !dismissedMessageIds.has(String(m.id)))
        .map((m: any) => {
        const sender = profileById.get(m.user_id) || {};
        const senderName = displayName(sender);
        const mime = String(m.attachment_mime || '');
        const attachmentUrl = m.attachment_url || undefined;

        const reactionList = Array.from(
          (reactionsByMessage.get(m.id) || new Map<string, any[]>()).entries()
        ).map(([emoji, users]) => ({ emoji, users }));

        return {
          id: m.id,
          sender: senderName,
          senderId: uiUserId(m.user_id),
          senderAvatar: senderName.charAt(0).toUpperCase(),
          message: m.body || (mime.startsWith('audio/') ? '🎤 Message vocal' : ''),
          timestamp: m.created_at && !isNaN(Date.parse(m.created_at))
            ? new Date(m.created_at).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          isMe: m.user_id === profile.id,
          channel: m.conversation_id || m.channel_id || '',
          reactions: reactionList,
          readBy: readsByMessage.get(m.id) || [],
          imageUrl: mime.startsWith('image/') ? attachmentUrl : undefined,
          videoUrl: mime.startsWith('video/') ? attachmentUrl : undefined,
          audioUrl: mime.startsWith('audio/') ? attachmentUrl : undefined,
          audioDuration:
            m.attachment_duration == null ? undefined : Number(m.attachment_duration),
          isEdited: !!m.edited_at,
          createdAt: m.created_at,
        };
      });

      const members = (profiles || []).map((p: any) => {
        const name = displayName(p);
        return {
          id: uiUserId(p.id),
          profileId: p.id,
          name,
          email: p.email || '',
          avatar: name.charAt(0).toUpperCase(),
          role: p.id === profile.id ? 'admin' : 'member',
          joinedAt: new Date().toISOString(),
        };
      });

      const specialGroup = {
        id: 'les 3 entités',
        name: 'les 3 entités',
        description: 'Groupe principal inter-agences — Tous les utilisateurs des 3 agences',
        createdBy: 'Système',
        createdAt: '2026-01-01T00:00:00.000Z',
        agencyId: 'all',
        isSpecialGroup: true,
        sortOrder: -999,
        members,
        chatMode: 'conversations',
      };

      const existingSpecialIdx = groups.findIndex(g => g.id === 'les 3 entités');
      if (existingSpecialIdx >= 0) {
        groups[existingSpecialIdx] = {
          ...groups[existingSpecialIdx],
          ...specialGroup,
          members,
        };
      } else {
        groups.unshift(specialGroup);
      }

      res.json({
        groups,
        messages: formattedMessages,
        members,
        counts: {
          projects: groups.filter(g => g.chatMode === 'projects').length,
          conversations: groups.filter(g => g.chatMode === 'conversations').length,
          shared: 0,
        },
      });
    } catch (error: any) {
      console.error('[Chat bootstrap Supabase]', error);
      res.status(500).json({
        error: error?.message || 'Impossible de charger le Chat Supabase.',
      });
    }
  });

  async function resolveChatTarget(targetId: string) {
    if (targetId === 'les 3 entités') {
      const specialRows = await supabaseRequest<any[]>(
        `conversations?id=eq.${encodeURIComponent(targetId)}&select=id&limit=1`
      );
      if (specialRows?.length) {
        return { type: 'conversation' as const, id: specialRows[0].id };
      }
      await supabaseRequest('conversations', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          id: 'les 3 entités',
          title: 'les 3 entités',
          type: 'group',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => null);
      return { type: 'conversation' as const, id: 'les 3 entités' };
    }

    const conversationRows = await supabaseRequest<any[]>(
      `conversations?id=eq.${encodeURIComponent(targetId)}&select=id&limit=1`
    );
    if (conversationRows?.length) {
      return { type: 'conversation' as const, id: conversationRows[0].id };
    }

    const channelRows = await supabaseRequest<any[]>(
      `chat_channels?id=eq.${encodeURIComponent(targetId)}&select=id,project_id&limit=1`
    );
    if (channelRows?.length) {
      return {
        type: 'channel' as const,
        id: channelRows[0].id,
        projectId: channelRows[0].project_id,
      };
    }

    const projectRows = await supabaseRequest<any[]>(
      `chat_projects?id=eq.${encodeURIComponent(targetId)}&select=id&limit=1`
    );
    if (projectRows?.length) {
      const pChannels = await supabaseRequest<any[]>(
        `chat_channels?project_id=eq.${encodeURIComponent(targetId)}&order=position.asc&limit=1`
      );
      if (pChannels?.length) {
        return {
          type: 'channel' as const,
          id: pChannels[0].id,
          projectId: targetId,
        };
      }
    }

    return null;
  }

  app.post('/api/chat/write', async (req, res) => {
    try {
      const { supabaseUser, profile } = await currentProfile(req);
      const { table, id, method, data = {} } = req.body || {};

      if (!['chat_messages', 'chat_groups'].includes(table)) {
        return res.status(400).json({ error: 'Table Chat invalide.' });
      }
      if (!['set', 'update', 'delete'].includes(method)) {
        return res.status(400).json({ error: 'Action Chat invalide.' });
      }

      if (table === 'chat_messages') {
        if (method === 'set') {
          const targetId = String(data.channel || '');
          if (!targetId) throw new Error('Sélectionnez une conversation ou un canal avant d’envoyer.');

          const target = await resolveChatTarget(targetId);
          if (!target) throw new Error('Conversation ou canal introuvable dans Supabase.');

          let attachmentUrl: string | null = null;
          let attachmentMime: string | null = null;

          if (data.audioUrl) {
            attachmentUrl = String(data.audioUrl);
            attachmentMime = String(data.audioMime || 'audio/webm');
          } else if (data.imageUrl) {
            attachmentUrl = String(data.imageUrl);
            attachmentMime = String(data.imageMime || 'image/jpeg');
          } else if (data.videoUrl) {
            attachmentUrl = String(data.videoUrl);
            attachmentMime = String(data.videoMime || 'video/mp4');
          }

          const payload: any = {
            conversation_id: target.type === 'conversation' ? target.id : null,
            channel_id: target.type === 'channel' ? target.id : null,
            user_id: profile.id,
            body: String(data.message || ''),
            attachment_url: attachmentUrl,
            attachment_mime: attachmentMime,
            attachment_duration:
              data.audioDuration == null ? null : Math.max(0, Math.round(Number(data.audioDuration))),
            created_at: data.createdAt || new Date().toISOString(),
          };

          let createdRows: any[] = [];
          try {
            // La colonne kind possède normalement une valeur par défaut dans le schéma restauré.
            createdRows = await supabaseRequest<any[]>('messages', {
              method: 'POST',
              headers: { Prefer: 'return=representation' },
              body: JSON.stringify(payload),
            });
          } catch (firstError: any) {
            // Sécurité pour un schéma où kind n'aurait pas de valeur par défaut.
            if (!String(firstError?.message || '').toLowerCase().includes('kind')) throw firstError;
            createdRows = await supabaseRequest<any[]>('messages', {
              method: 'POST',
              headers: { Prefer: 'return=representation' },
              body: JSON.stringify({
                ...payload,
                kind: attachmentMime?.startsWith('audio/')
                  ? 'audio'
                  : attachmentMime?.startsWith('image/')
                    ? 'image'
                    : attachmentMime?.startsWith('video/')
                      ? 'video'
                      : 'text',
              }),
            });
          }

          const created = createdRows?.[0];
          if (!created?.id) throw new Error('Supabase n’a pas renvoyé le message créé.');

          const now = new Date().toISOString();

          await supabaseRequest('message_receipts?on_conflict=message_id,user_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              message_id: created.id,
              user_id: profile.id,
              delivered_at: now,
              read_at: now,
            }),
          }).catch(() => null);

          if (target.type === 'conversation') {
            await supabaseRequest(
              `conversations?id=eq.${encodeURIComponent(target.id)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  updated_at: now,
                  last_message_at: now,
                }),
              }
            ).catch(() => null);
          } else {
            await supabaseRequest(
              `chat_channels?id=eq.${encodeURIComponent(target.id)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  updated_at: now,
                  last_message_at: now,
                }),
              }
            ).catch(() => null);
          }

          return res.json({ success: true, id: created.id });
        }

        const rows = await supabaseRequest<any[]>(
          `messages?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
        );
        const msg = rows?.[0];
        if (!msg) return res.status(404).json({ error: 'Message introuvable.' });

        if (method === 'delete') {
          let canDelete = msg.user_id === profile.id;

          if (!canDelete) {
            const roles = await supabaseRequest<any[]>(
              `user_roles?user_id=eq.${encodeURIComponent(profile.id)}&role=eq.super_admin&select=id&limit=1`
            ).catch(() => []);
            canDelete = roles.length > 0;
          }

          if (!canDelete) {
            return res.status(403).json({ error: 'Suppression non autorisée.' });
          }

          // Nettoyage des dépendances relationnelles avant suppression.
          await supabaseRequest(
            `message_reactions?message_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          ).catch(() => null);

          await supabaseRequest(
            `message_receipts?message_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          ).catch(() => null);

          await supabaseRequest(
            `user_dismissed_items?item_type=eq.chat_message&item_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          ).catch(() => null);

          await supabaseRequest(`messages?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE',
          });

          return res.json({ success: true });
        }

        // Accusé de lecture : une ligne relationnelle, jamais de mutation répétée du message.
        if (Array.isArray(data.readBy)) {
          const now = new Date().toISOString();
          await supabaseRequest('message_receipts?on_conflict=message_id,user_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              message_id: id,
              user_id: profile.id,
              delivered_at: now,
              read_at: now,
            }),
          });
        }

        // Suppression uniquement pour l'utilisateur courant.
        if (Array.isArray(data.deletedForMe) && data.deletedForMe.length) {
          await supabaseRequest('user_dismissed_items?on_conflict=user_id,item_type,item_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              user_id: profile.id,
              item_type: 'chat_message',
              item_id: id,
              dismissed_at: new Date().toISOString(),
            }),
          });
        }

        // Réactions de l'utilisateur courant.
        if (Array.isArray(data.reactions)) {
          const wanted = data.reactions
            .filter(
              (reaction: any) =>
                Array.isArray(reaction.users) &&
                reaction.users.some(
                  (user: any) =>
                    user.id === supabaseUser.id ||
                    user.id === profile.id
                )
            )
            .map((reaction: any) => String(reaction.emoji));

          await supabaseRequest(
            `message_reactions?message_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(profile.id)}`,
            { method: 'DELETE' }
          );

          if (wanted.length) {
            await supabaseRequest('message_reactions', {
              method: 'POST',
              body: JSON.stringify(
                wanted.map((emoji: string) => ({
                  message_id: id,
                  user_id: profile.id,
                  emoji,
                }))
              ),
            });
          }
        }

        const patch: any = {};
        if (data.message !== undefined) {
          patch.body = String(data.message);
          patch.edited_at = new Date().toISOString();
        }

        if (Object.keys(patch).length) {
          if (msg.user_id !== profile.id) {
            return res.status(403).json({ error: 'Modification non autorisée.' });
          }

          await supabaseRequest(`messages?id=eq.${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });
        }

        return res.json({ success: true });
      }

      // L'ancien composant appelle encore "chat_groups".
      // Pour éviter de casser l'interface, on crée ici une vraie conversation Supabase.
      if (method === 'set') {
        const payload: any = {
          title: String(data.name || 'Nouvelle conversation'),
          created_by: profile.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (
          data.agencyId &&
          /^[0-9a-f-]{36}$/i.test(String(data.agencyId))
        ) {
          payload.agency_id = data.agencyId;
        }

        let conversationRows: any[] = [];
        try {
          // Si type a un défaut, on le laisse faire.
          conversationRows = await supabaseRequest<any[]>('conversations', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(payload),
          });
        } catch (firstError: any) {
          if (!String(firstError?.message || '').toLowerCase().includes('type')) throw firstError;
          conversationRows = await supabaseRequest<any[]>('conversations', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ ...payload, type: 'group' }),
          });
        }

        const conversation = conversationRows?.[0];
        if (!conversation?.id) throw new Error('Conversation non créée.');

        const requestedMembers = Array.isArray(data.members) ? data.members : [];
        const emails = requestedMembers
          .map((member: any) => String(member.email || '').trim().toLowerCase())
          .filter(Boolean);
        const profileIds = requestedMembers
          .map((member: any) => String(member.profileId || member.id || '').trim())
          .filter((id: string) => id.length > 0 && id !== profile.id);

        let memberProfiles: any[] = [];
        const filterParts: string[] = [];
        if (emails.length) {
          const encodedEmails = emails.map((email: string) => `"${email.replace(/"/g, '')}"`).join(',');
          filterParts.push(`email=in.(${encodedEmails})`);
        }
        if (profileIds.length) {
          const encodedIds = profileIds.map((id: string) => `"${id.replace(/"/g, '')}"`).join(',');
          filterParts.push(`id=in.(${encodedIds})`);
        }

        if (filterParts.length) {
          memberProfiles = await supabaseRequest<any[]>(
            `profiles?or=(${filterParts.join(',')})&select=id,email`
          ).catch(() => []);
        }

        const ids = new Set<string>(memberProfiles.map((p: any) => p.id));
        profileIds.forEach((id: string) => {
          if (/^[0-9a-f-]{36}$/i.test(id)) ids.add(id);
        });
        ids.add(profile.id);

        await supabaseRequest('conversation_members', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(
            Array.from(ids).map(userId => ({
              conversation_id: conversation.id,
              user_id: userId,
              joined_at: new Date().toISOString(),
            }))
          ),
        });

        return res.json({ success: true, id: conversation.id });
      }

      const conversationRows = await supabaseRequest<any[]>(
        `conversations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
      ).catch(() => []);
      const conversation = conversationRows?.[0];

      if (conversation) {
        if (method === 'delete') {
          await supabaseRequest(
            `conversation_members?conversation_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          ).catch(() => null);

          await supabaseRequest(
            `conversations?id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          );

          return res.json({ success: true });
        }

        const patch: any = { updated_at: new Date().toISOString() };
        if (data.name !== undefined) patch.title = String(data.name || 'Conversation');

        await supabaseRequest(
          `conversations?id=eq.${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(patch),
          }
        );

        return res.json({ success: true });
      }

      // Check chat_projects table (Project Folders)
      const projectRows = await supabaseRequest<any[]>(
        `chat_projects?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
      ).catch(() => []);
      const project = projectRows?.[0];

      if (project) {
        if (method === 'delete') {
          await supabaseRequest(
            `chat_channels?project_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          ).catch(() => null);

          await supabaseRequest(
            `chat_projects?id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          );

          return res.json({ success: true });
        }

        const patch: any = {};
        if (data.name !== undefined) patch.name = String(data.name || 'Nouveau dossier');
        if (data.description !== undefined) patch.description = String(data.description);
        if (data.position !== undefined) patch.position = Number(data.position);

        if (Object.keys(patch).length > 0) {
          await supabaseRequest(
            `chat_projects?id=eq.${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              body: JSON.stringify(patch),
            }
          );
        }

        return res.json({ success: true });
      }

      // Check chat_channels table (Sub-channels)
      const channelRows = await supabaseRequest<any[]>(
        `chat_channels?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
      ).catch(() => []);
      const channel = channelRows?.[0];

      if (channel) {
        if (method === 'delete') {
          await supabaseRequest(
            `chat_channels?id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          );

          return res.json({ success: true });
        }

        const patch: any = {};
        if (data.name !== undefined) patch.name = String(data.name || 'Nouveau canal');
        if (data.description !== undefined) patch.description = String(data.description);
        if (data.position !== undefined) patch.position = Number(data.position);
        if (data.parentId !== undefined) patch.project_id = String(data.parentId);
        if (data.project_id !== undefined) patch.project_id = String(data.project_id);

        if (Object.keys(patch).length > 0) {
          await supabaseRequest(
            `chat_channels?id=eq.${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              body: JSON.stringify(patch),
            }
          );
        }

        return res.json({ success: true });
      }

      return res.status(404).json({
        error: 'Groupe ou canal introuvable.',
      });
    } catch (error: any) {
      console.error('[Chat write Supabase]', error);
      res.status(500).json({
        error: error?.message || 'Action Chat Supabase impossible.',
      });
    }
  });

  app.get('/api/settings/bootstrap', async (req, res) => {
    try {
      const { profile, supabaseUser } = await currentProfile(req);
      const isSuperAdmin = supabaseUser.email.toLowerCase() === 's.grazia@conseilfinances.fr' || profile.email?.toLowerCase() === 's.grazia@conseilfinances.fr';
      // Signalé (31/08/2026) : Natacha, rattachée à la seule agence Novavisio,
      // n'y voyait aucun contact. Cause : cette réponse n'a JAMAIS renvoyé
      // `agency_ids`, que le front lit pourtant pour choisir l'agence active
      // (AuthContext : `bootstrapBody.agency_ids ?? []`). Il recevait donc
      // toujours une liste vide, `primaryAgencyId` restait indéfini, et
      // l'agence active retombait sur AGENCIES[0] — Conseils Finances. Tous
      // les contacts d'une autre agence étaient alors filtrés côté client,
      // quelles que soient les règles d'accès en base. Invisible jusqu'ici
      // parce que les comptes existants sont soit super-admin (accès à tout),
      // soit rattachés justement à Conseils Finances.
      const [ui, templates, drives, role, memberOf] = await Promise.all([
        supabaseRequest<any[]>(`user_ui_settings?user_id=eq.${profile.id}&select=*&limit=1`).catch(() => []),
        supabaseRequest<any[]>(`user_event_templates?user_id=eq.${profile.id}&select=*&limit=1`).catch(() => []),
        supabaseRequest<any[]>('agency_drive_tokens?select=agency_id,google_email,updated_at').catch(() => []),
        getRole(profile.id).catch(() => (isSuperAdmin ? 'super_admin' : 'commercial') as AppRole),
        supabaseRequest<any[]>(`agency_members?user_id=eq.${profile.id}&select=agency_id`).catch(() => []),
      ]);
      const agencyIds: string[] = (memberOf || []).map((m: any) => m.agency_id).filter(Boolean);
      const activeRole = isSuperAdmin ? 'super_admin' : role;
      let users: any[] = [];
      if (activeRole === 'super_admin') {
        const [profiles, roles, memberships] = await Promise.all([
          supabaseRequest<any[]>('profiles?select=id,full_name,email,avatar_url,phone,job_title,is_active,is_validated').catch(() =>
            supabaseRequest<any[]>('profiles?select=id,full_name,email,avatar_url,phone,job_title').catch(() => [])
          ),
          supabaseRequest<any[]>('user_roles?select=user_id,role').catch(() => []),
          supabaseRequest<any[]>('agency_members?select=user_id,agency_id').catch(() => []),
        ]);
        users = (profiles || []).map(p => ({
          ...p,
          role: (roles || []).find(r => r.user_id === p.id)?.role || 'commercial',
          agency_ids: (memberships || []).filter(m => m.user_id === p.id).map(m => m.agency_id),
          is_active: p.is_active !== false,
          is_validated: p.is_validated === true,
        }));
      }

      // Ticket "Rôle Stagiaire" (phase 2) : `role` n'était jusqu'ici jamais
      // renvoyé au client — tout utilisateur non super-admin retombait donc
      // toujours sur le rôle générique "user" côté interface, quel que soit
      // son vrai rôle en base. En profite pour joindre la durée de stage
      // (expires_at déjà sur user_roles + intern_details) quand c'est un
      // stagiaire, pour l'accès temporaire.
      let internStartsAt: string | null = null;
      let internEndsAt: string | null = null;
      let internResponsableId: string | null = null;
      if (activeRole === 'intern') {
        const [roleRow, details] = await Promise.all([
          supabaseRequest<any[]>(`user_roles?user_id=eq.${profile.id}&role=eq.intern&select=expires_at&limit=1`).catch(() => []),
          supabaseRequest<any[]>(`intern_details?user_id=eq.${profile.id}&select=starts_at,responsable_id&limit=1`).catch(() => []),
        ]);
        internEndsAt = roleRow?.[0]?.expires_at ?? null;
        internStartsAt = details?.[0]?.starts_at ?? null;
        internResponsableId = details?.[0]?.responsable_id ?? null;
      }

      res.json({
        profile,
        ui: ui[0] || null,
        templates: templates[0] || null,
        drives,
        users,
        role: activeRole,
        // Un super-admin garde accès à toutes les agences, même s'il n'est
        // pas déclaré membre de chacune dans `agency_members`.
        agency_ids: activeRole === 'super_admin' && agencyIds.length === 0
          ? undefined
          : agencyIds,
        internStartsAt,
        internEndsAt,
        internResponsableId,
      });
    } catch (e: any) {
      console.error('[Bootstrap error]:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/settings/profile', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const phone = String(req.body?.phone || '').trim() || null;
      const jobTitle = String(req.body?.jobTitle || '').trim() || null;
      const fullName = req.body?.fullName !== undefined ? String(req.body.fullName).trim() : undefined;

      const payload: Record<string, any> = {
        phone,
        job_title: jobTitle,
        updated_at: new Date().toISOString(),
      };
      if (fullName) payload.full_name = fullName;

      const rows = await supabaseRequest<any[]>(`profiles?id=eq.${profile.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      }).catch(() => []);

      res.json({ success: true, profile: rows[0] || { ...profile, ...payload } });
    } catch (e: any) {
      console.error('[Profile patch error]:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/settings/avatar', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const parsed = parseDataUrl(req.body?.dataUrl);
      const ext = String(req.body?.extension || 'jpg').replace(/[^a-z0-9]/gi, '');
      const objectPath = `${profile.id}/avatar-${Date.now()}.${ext}`;
      await storageUpload('avatars', objectPath, parsed.buffer, req.body?.contentType || parsed.contentType);
      const oldPath = storagePathFromPublicUrl(profile.avatar_url as string | null, 'avatars');
      if (oldPath) await storageDelete('avatars', [oldPath]).catch(() => undefined);
      const publicUrl = publicStorageUrl('avatars', objectPath);
      await supabaseRequest(`profiles?id=eq.${profile.id}`, { method: 'PATCH', body: JSON.stringify({ avatar_url: publicUrl, updated_at: new Date().toISOString() }) });
      res.json({ success: true, publicUrl });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/settings/avatar', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const oldPath = storagePathFromPublicUrl(profile.avatar_url as string | null, 'avatars');
      if (oldPath) await storageDelete('avatars', [oldPath]);
      await supabaseRequest(`profiles?id=eq.${profile.id}`, { method: 'PATCH', body: JSON.stringify({ avatar_url: null, updated_at: new Date().toISOString() }) });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/settings/ui', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const existing = await supabaseRequest<any[]>(`user_ui_settings?user_id=eq.${profile.id}&select=user_id&limit=1`);
      const payload = { ...req.body, user_id: profile.id, updated_at: new Date().toISOString() };
      if (existing.length) {
        await supabaseRequest(`user_ui_settings?user_id=eq.${profile.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await supabaseRequest('user_ui_settings', { method: 'POST', body: JSON.stringify(payload) });
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/settings/signature-image', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const parsed = parseDataUrl(req.body?.dataUrl);
      const ext = String(req.body?.extension || 'png').replace(/[^a-z0-9]/gi, '');
      const objectPath = `${profile.id}/signature-${Date.now()}.${ext}`;
      await storageUpload('mail-signatures', objectPath, parsed.buffer, req.body?.contentType || parsed.contentType);
      const publicUrl = publicStorageUrl('mail-signatures', objectPath);
      res.json({ success: true, publicUrl });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/settings/templates', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const payload = { user_id: profile.id, task_titles: Array.isArray(req.body?.taskTitles) ? req.body.taskTitles : [], rdv_titles: Array.isArray(req.body?.rdvTitles) ? req.body.rdvTitles : [], updated_at: new Date().toISOString() };
      const existing = await supabaseRequest<any[]>(`user_event_templates?user_id=eq.${profile.id}&select=user_id&limit=1`);
      if (existing.length) await supabaseRequest(`user_event_templates?user_id=eq.${profile.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await supabaseRequest('user_event_templates', { method: 'POST', body: JSON.stringify(payload) });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/settings/daily-reminders', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      await supabaseRequest(`profiles?id=eq.${profile.id}`, { method: 'PATCH', body: JSON.stringify({ push_daily_reminders: req.body?.enabled !== false, updated_at: new Date().toISOString() }) });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/announcements', async (req, res) => {
    try {
      const { profile } = await requireAdmin(req);
      const message = String(req.body?.message || '').trim();
      const agencyIds = Array.isArray(req.body?.agencyIds) ? req.body.agencyIds : [];
      if (!message) throw new Error('Annonce vide.');
      const rows = await supabaseRequest<any[]>('announcements', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ message, is_active: true, created_by: profile.id }) });
      const announcement = rows[0];
      if (announcement && agencyIds.length) {
        await supabaseRequest('announcement_agencies', { method: 'POST', body: JSON.stringify(agencyIds.map((agency_id: string) => ({ announcement_id: announcement.id, agency_id }))) });
      }
      res.json({ success: true, announcement });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/users/:id/access', async (req, res) => {
    try {
      await requireAdmin(req);
      const userId = req.params.id;
      const role = (['super_admin', 'commercial', 'intern'].includes(req.body?.role) ? req.body.role : 'commercial') as AppRole;
      const agencyIds = Array.isArray(req.body?.agencyIds) ? req.body.agencyIds : [];

      // Ticket "Rôle Stagiaire" (phase 2) : c'est ici que se fait la
      // "prolongation depuis Équipe" — met à jour expires_at (fin de stage)
      // et intern_details (début, responsable) en même temps que le rôle.
      const internStartsAt: string | null = role === 'intern' && req.body?.internStartsAt ? String(req.body.internStartsAt) : null;
      const internEndsAt: string | null = role === 'intern' && req.body?.internEndsAt ? String(req.body.internEndsAt) : null;
      const internResponsableId: string | null = role === 'intern' && req.body?.internResponsableId ? String(req.body.internResponsableId) : null;

      await supabaseRequest(`user_roles?user_id=eq.${userId}`, { method: 'DELETE' });
      await supabaseRequest('user_roles', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, role, expires_at: internEndsAt ? new Date(internEndsAt).toISOString() : null }),
      });
      await supabaseRequest(`agency_members?user_id=eq.${userId}`, { method: 'DELETE' });
      if (agencyIds.length) await supabaseRequest('agency_members', { method: 'POST', body: JSON.stringify(agencyIds.map((agency_id: string) => ({ user_id: userId, agency_id }))) });

      if (role === 'intern') {
        await supabaseRequest(`intern_details?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
        await supabaseRequest('intern_details', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            starts_at: internStartsAt || new Date().toISOString().slice(0, 10),
            responsable_id: internResponsableId,
          }),
        }).catch(() => {});
      } else {
        await supabaseRequest(`intern_details?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
      }

      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/users', async (req, res) => {
    try {
      await requireAdmin(req);
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const fullName = String(req.body?.fullName || '').trim();
      const role = (['super_admin', 'commercial', 'intern'].includes(req.body?.role) ? req.body.role : 'commercial') as AppRole;
      const agencyIds = Array.isArray(req.body?.agencyIds) ? req.body.agencyIds : [];
      if (!email || !password) throw new Error('Email et mot de passe obligatoires.');

      let userId: string | null = null;
      let actionLink: string | null = null;

      // Signalé : un lien d'invitation généré pointait vers
      // novasphere.nova360.space (ancien alias, supprimé le 25/08 — plus
      // aucun déploiement ne le sert). La cause : on faisait confiance à
      // l'en-tête Origin/Referer du navigateur de l'admin au moment de la
      // création, qui peut pointer vers un onglet/raccourci PWA périmé. On
      // ne fait plus confiance qu'à une liste fermée de domaines connus —
      // tout le reste retombe sur le domaine de test actif.
      const CANONICAL_APP_ORIGIN = 'https://test.nova360.space';
      const ALLOWED_INVITE_ORIGINS = new Set(['https://test.nova360.space', 'https://app.nova360.space']);
      const requestOrigin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
      const publicOrigin = requestOrigin && ALLOWED_INVITE_ORIGINS.has(requestOrigin) ? requestOrigin : CANONICAL_APP_ORIGIN;

      // 1. Create or retrieve Supabase Auth User
      try {
        const authUser = await authAdminRequest<any>('users', {
          method: 'POST',
          body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
        });
        userId = authUser?.id || authUser?.user?.id;
      } catch (authErr: any) {
        console.warn('[Create User] Supabase Auth notice:', authErr.message);
      }

      // 2. Generate a magic/invite link so user can log in directly via link or Google
      try {
        const linkRes = await authAdminRequest<any>('generate_link', {
          method: 'POST',
          body: JSON.stringify({
            type: 'magiclink',
            email,
            options: { redirectTo: publicOrigin },
          }),
        });
        if (linkRes?.action_link) actionLink = linkRes.action_link;
        if (!userId && linkRes?.id) userId = linkRes.id;
      } catch (linkErr: any) {
        console.warn('[Create User] Generate link notice:', linkErr.message);
      }

      if (actionLink) {
        actionLink = actionLink
          .replace(/redirect_to=http%3A%2F%2Flocalhost%3A\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=http%3A%2F%2F127\.0\.0\.1%3A\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=http:\/\/localhost:\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=http:\/\/127\.0\.0\.1:\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          // Filet de sécurité : si Supabase Auth est retombé sur son "Site
          // URL" par défaut (ancien domaine novasphere.nova360.space) faute
          // de redirectTo reconnu, on le remplace quand même.
          .replace(/redirect_to=https?%3A%2F%2Fnovasphere\.nova360\.space[^&]*/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=https?:\/\/novasphere\.nova360\.space[^&]*/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`);
      }

      // 3. Fallback UUID if not created via auth
      if (!userId) {
        const existingProfiles = await supabaseRequest<any[]>(`profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`).catch(() => []);
        if (existingProfiles.length) userId = existingProfiles[0].id;
        else userId = crypto.randomUUID();
      }

      // 4. Update profiles table
      const existingProfile = await supabaseRequest<any[]>(`profiles?id=eq.${userId}&select=id&limit=1`).catch(() => []);
      if (existingProfile.length) {
        await supabaseRequest(`profiles?id=eq.${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ email, full_name: fullName || null, is_active: true, is_validated: false, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      } else {
        await supabaseRequest('profiles', {
          method: 'POST',
          body: JSON.stringify({ id: userId, email, full_name: fullName || null, is_active: true, is_validated: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }

      // 5. Update user roles and agency memberships
      // Ticket "Rôle Stagiaire" (phase 2) : `expires_at` (déjà présent sur
      // user_roles, jamais renseigné avant) porte la date de FIN de stage —
      // `intern_details` (starts_at/responsable_id) complète le reste.
      const internStartsAt: string | null = role === 'intern' && req.body?.internStartsAt ? String(req.body.internStartsAt) : null;
      const internEndsAt: string | null = role === 'intern' && req.body?.internEndsAt ? String(req.body.internEndsAt) : null;
      const internResponsableId: string | null = role === 'intern' && req.body?.internResponsableId ? String(req.body.internResponsableId) : null;

      await supabaseRequest(`user_roles?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
      await supabaseRequest('user_roles', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          role,
          expires_at: internEndsAt ? new Date(internEndsAt).toISOString() : null,
        }),
      }).catch(() => {});
      await supabaseRequest(`agency_members?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
      if (agencyIds.length) {
        await supabaseRequest('agency_members', {
          method: 'POST',
          body: JSON.stringify(agencyIds.map((agency_id: string) => ({ user_id: userId, agency_id }))),
        }).catch(() => {});
      }
      if (role === 'intern') {
        await supabaseRequest(`intern_details?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
        await supabaseRequest('intern_details', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            starts_at: internStartsAt || new Date().toISOString().slice(0, 10),
            responsable_id: internResponsableId,
          }),
        }).catch(() => {});
      }

      // 6. Envoi de l'e-mail d'invitation — signalé : rien n'était envoyé
      // jusqu'ici (le lien était juste copié dans le presse-papiers, à
      // charge pour l'admin de le transmettre). Part toujours du Gmail de
      // Sylvain, quel que soit l'admin à l'origine de l'invitation.
      let emailSent = false;
      let emailError: string | null = null;
      if (actionLink) {
        const roleLabel = role === 'intern' ? 'stagiaire' : role === 'super_admin' ? 'administrateur' : 'commercial';
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
            <h2 style="color:#0f172a;">Bienvenue sur Nova CRM${fullName ? ', ' + fullName : ''} !</h2>
            <p>Vous avez été invité${fullName ? '' : '(e)'} à rejoindre Nova CRM en tant que <strong>${roleLabel}</strong>.</p>
            <p>Cliquez sur le bouton ci-dessous pour activer votre compte et vous connecter :</p>
            <p style="text-align:center;margin:28px 0;">
              <a href="${actionLink}" style="background:#F7BC5F;color:#0f172a;font-weight:bold;padding:12px 28px;border-radius:10px;text-decoration:none;display:inline-block;">Accéder à Nova CRM</a>
            </p>
            <p style="font-size:12px;color:#64748b;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${actionLink}</p>
          </div>`;
        const result = await sendSystemEmail(email, 'Votre invitation Nova CRM', html);
        emailSent = result.ok;
        emailError = result.error || null;
      }

      res.json({
        success: true,
        id: userId,
        email,
        fullName,
        role,
        actionLink,
        emailSent,
        emailError,
        message: emailSent
          ? `L'utilisateur ${email} a été créé et un e-mail d'invitation lui a été envoyé.`
          : `L'utilisateur ${email} a été créé et associé aux agences. L'e-mail d'invitation n'a pas pu être envoyé automatiquement — le lien reste copié dans le presse-papiers.`,
      });
    } catch (e: any) {
      console.error('[Create user error]:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/users/:id/invite', async (req, res) => {
    try {
      await requireAdmin(req);
      const userId = req.params.id;
      const profiles = await supabaseRequest<any[]>(`profiles?id=eq.${userId}&select=id,email,full_name`).catch(() => []);
      if (!profiles || !profiles.length) throw new Error('Utilisateur non trouvé.');
      const user = profiles[0];
      const email = user.email;

      // Signalé : mêmes filets de sécurité de domaine que POST /api/admin/users
      // (cf. commentaire là-bas) — on ne fait plus confiance à Origin/Referer.
      const CANONICAL_APP_ORIGIN = 'https://test.nova360.space';
      const ALLOWED_INVITE_ORIGINS = new Set(['https://test.nova360.space', 'https://app.nova360.space']);
      const requestOrigin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
      const publicOrigin = requestOrigin && ALLOWED_INVITE_ORIGINS.has(requestOrigin) ? requestOrigin : CANONICAL_APP_ORIGIN;

      let emailSent = false;
      let emailError: string | null = null;
      let actionLink: string | null = null;

      // Generate a fresh magiclink / invitation link
      try {
        const linkRes = await authAdminRequest<any>('generate_link', {
          method: 'POST',
          body: JSON.stringify({
            type: 'magiclink',
            email,
            options: { redirectTo: publicOrigin },
          }),
        });
        if (linkRes?.action_link) actionLink = linkRes.action_link;
      } catch (linkErr: any) {
        console.warn('[Invite User] Generate link notice:', linkErr.message);
      }

      if (actionLink) {
        actionLink = actionLink
          .replace(/redirect_to=http%3A%2F%2Flocalhost%3A\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=http%3A%2F%2F127\.0\.0\.1%3A\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=http:\/\/localhost:\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=http:\/\/127\.0\.0\.1:\d+/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=https?%3A%2F%2Fnovasphere\.nova360\.space[^&]*/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`)
          .replace(/redirect_to=https?:\/\/novasphere\.nova360\.space[^&]*/gi, `redirect_to=${encodeURIComponent(publicOrigin)}`);
      } else {
        actionLink = `${publicOrigin}/?email=${encodeURIComponent(email)}`;
      }

      // Signalé : "je ne reçois pas de mail" — on envoie désormais un vrai
      // e-mail (toujours depuis le Gmail de Sylvain) au lieu de compter sur
      // l'e-mail d'invitation intégré de Supabase Auth (peu fiable / non
      // configuré ici).
      const result = await sendSystemEmail(
        email,
        'Votre invitation Nova CRM',
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
          <h2 style="color:#0f172a;">Bienvenue sur Nova CRM${user.full_name ? ', ' + user.full_name : ''} !</h2>
          <p>Voici votre lien pour accéder à Nova CRM :</p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${actionLink}" style="background:#F7BC5F;color:#0f172a;font-weight:bold;padding:12px 28px;border-radius:10px;text-decoration:none;display:inline-block;">Accéder à Nova CRM</a>
          </p>
          <p style="font-size:12px;color:#64748b;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${actionLink}</p>
        </div>`
      );
      emailSent = result.ok;
      emailError = result.error || null;

      // Update profile status if needed
      await supabaseRequest(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
      }).catch(() => {});

      res.json({ success: true, email, actionLink, emailSent, emailError });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/users/:id/status', async (req, res) => {
    try {
      await requireAdmin(req);
      const userId = req.params.id;
      const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : undefined;
      const isValidated = req.body?.isValidated !== undefined ? Boolean(req.body.isValidated) : undefined;

      const payload: Record<string, any> = { updated_at: new Date().toISOString() };
      if (isActive !== undefined) payload.is_active = isActive;
      if (isValidated !== undefined) payload.is_validated = isValidated;

      await supabaseRequest(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }).catch((err) => {
        console.warn('Update user status warning:', err?.message);
      });

      res.json({ success: true, isActive, isValidated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Ticket "Rôle Stagiaire" (phase 2) : "un administrateur doit pouvoir
  // prolonger la date de fin du stage" — action isolée (ne touche ni le
  // rôle ni les agences, contrairement à PUT /access), pour ne jamais
  // risquer d'effacer autre chose en ne renouvelant qu'une date.
  app.patch('/api/admin/users/:id/intern-access', async (req, res) => {
    try {
      await requireAdmin(req);
      const userId = req.params.id;
      const internEndsAt = req.body?.internEndsAt ? String(req.body.internEndsAt) : null;
      const internStartsAt = req.body?.internStartsAt ? String(req.body.internStartsAt) : undefined;
      const internResponsableId = req.body?.internResponsableId !== undefined ? (req.body.internResponsableId || null) : undefined;

      await supabaseRequest(`user_roles?user_id=eq.${userId}&role=eq.intern`, {
        method: 'PATCH',
        body: JSON.stringify({ expires_at: internEndsAt ? new Date(internEndsAt).toISOString() : null }),
      });

      const detailsPatch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (internStartsAt !== undefined) detailsPatch.starts_at = internStartsAt;
      if (internResponsableId !== undefined) detailsPatch.responsable_id = internResponsableId;
      if (Object.keys(detailsPatch).length > 1) {
        await supabaseRequest(`intern_details?user_id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify(detailsPatch) }).catch(() => {});
      }

      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/users/:id', async (req, res) => {
    try {
      await requireAdmin(req);
      const userId = req.params.id;
      // Mark as inactive in profiles to cut access immediately
      await supabaseRequest(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
      }).catch(() => {});
      // Remove agency memberships and roles
      await supabaseRequest(`user_roles?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
      await supabaseRequest(`agency_members?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
      // Attempt auth record removal
      try {
        await authAdminRequest(`users/${userId}`, { method: 'DELETE' });
      } catch (authErr: any) {
        console.warn('[Delete User Auth notice]:', authErr.message);
      }
      res.json({ success: true, message: "Accès au CRM coupé avec succès pour cet utilisateur." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/drive/:agencyId', async (req, res) => {
    try {
      await requireAdmin(req);
      await supabaseRequest(`agency_drive_tokens?agency_id=eq.${req.params.agencyId}`, { method: 'DELETE' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/settings/export', async (req, res) => {
    try {
      const { profile } = await currentProfile(req);
      const [roles, memberships, ui, templates] = await Promise.all([
        supabaseRequest<any[]>(`user_roles?user_id=eq.${profile.id}&select=*`),
        supabaseRequest<any[]>(`agency_members?user_id=eq.${profile.id}&select=*`),
        supabaseRequest<any[]>(`user_ui_settings?user_id=eq.${profile.id}&select=*`),
        supabaseRequest<any[]>(`user_event_templates?user_id=eq.${profile.id}&select=*`),
      ]);
      res.json({ generated_at: new Date().toISOString(), profile, roles, memberships, ui_settings: ui, event_templates: templates });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/ai/agent', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY non configurée.' });
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      const { prompt, messages = [], context = {} } = req.body;
      const contents = messages.map((m: any) => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
      if (prompt) contents.push({ role: 'user', parts: [{ text: prompt }] });
      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash', contents,
        config: { systemInstruction: `Tu es l'assistant IA NovaSphere. Réponds en français. Agence active: ${context.activeAgency?.name || 'Toutes'}.`, temperature: 0.4, tools: [{ functionDeclarations: [createContactTool, createTaskTool, createNoteTool, createAppointmentTool, getDailySummaryTool, getUpcomingBriefTool] }] },
      });
      res.json({ text: response.text || '', functionCalls: response.functionCalls || [] });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Erreur Gemini.' }); }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NovaSphere démarré sur le port ${PORT}`);
    console.log(`Supabase Service Role : ${SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MANQUANTE'}`);
    console.log('Auth : Supabase');
  });
}

startServer().catch(error => {
  console.error('Impossible de démarrer NovaSphere :', error);
  process.exit(1);
});
