import { supabase } from './supabase';
import { toast } from 'sonner';

// In-memory token storage (Do NOT persist in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const getCachedAccessToken = (): string | null => {
  return cachedAccessToken;
};

/**
 * Récupère le jeton d'accès Google Workspace (Drive/Gmail/Agenda) depuis la
 * session Supabase — un seul système d'authentification, pas de popup séparée.
 *
 * Ce jeton provient du `provider_token` renvoyé par Google lors de la
 * connexion (voir Auth.tsx, options.scopes). Supabase ne le rafraîchit pas
 * automatiquement ; s'il est absent ou expiré, l'utilisateur doit se
 * reconnecter (redemande le consentement Google, capte un nouveau jeton).
 */
/**
 * Ticket #23 (nouvelle base) : `cachedAccessToken` n'existe qu'en mémoire —
 * remis à zéro à chaque rechargement de page. Or Supabase, lui, conserve la
 * session (donc le `provider_token` Google) de façon persistante. Sans cet
 * appel au montage, l'agenda repartait vide à chaque chargement tant qu'on
 * n'avait pas cliqué manuellement sur "Synchroniser" — ce qui ressemblait à
 * une synchronisation cassée. On relit ici la session déjà persistée pour
 * réhydrater le jeton en mémoire, sans redemander de consentement Google.
 */
// Depuis le 2 septembre, la connexion au CRM ne demande que l'identité :
// le `provider_token` de la session Supabase ne porte plus Gmail, Drive ni
// Agenda — sauf pour une société pas encore passée en application interne,
// qui repasse par l'ancienne connexion complète (repli de
// reconnectGoogleWorkspace). On ne le prend donc pour un accès Workspace
// qu'après avoir vérifié ses portées auprès de Google ; sinon les appels
// Gmail échoueraient en silence (« insufficient authentication scopes »).
const portagesConnus = new Map<string, boolean>();
export const jetonPorteWorkspace = async (token: string): Promise<boolean> => {
  const connu = portagesConnus.get(token);
  if (connu !== undefined) return connu;
  let porte = false;
  try {
    const reponse = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`);
    const infos = (await reponse.json().catch(() => ({}))) as { scope?: string };
    const portees = String(infos?.scope || '');
    porte = reponse.ok && /gmail|drive|calendar/.test(portees);
  } catch {
    porte = false;
  }
  portagesConnus.set(token, porte);
  return porte;
};

/** Le jeton Google d'une session Supabase, seulement s'il porte les accès Workspace. */
const jetonWorkspaceDeSession = async (session: { provider_token?: string | null } | null | undefined): Promise<string | null> => {
  const token = session?.provider_token;
  if (!token) return null;
  return (await jetonPorteWorkspace(token)) ? token : null;
};

// Appelé par AuthContext dès que la session est valide : adopte le jeton de
// la session s'il porte les accès Workspace (ancienne connexion complète).
export const adopterJetonDeSession = async (session: { provider_token?: string | null } | null | undefined): Promise<void> => {
  const token = await jetonWorkspaceDeSession(session);
  if (token) cachedAccessToken = token;
};

export const hydrateAccessTokenFromSession = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  // Priorité au jeton géré par le serveur (application interne de la
  // société, renouvelé indéfiniment) ; le jeton de session ne sert que s'il
  // porte réellement les accès Workspace.
  const serverToken = await requestServerManagedAccessToken();
  if (serverToken) {
    cachedAccessToken = serverToken;
    return serverToken;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const token = await jetonWorkspaceDeSession(data.session);
    if (token) {
      cachedAccessToken = token;
      return token;
    }
  } catch {
    /* pas de session exploitable — on laisse l'utilisateur se reconnecter */
  }
  return null;
};

// Ticket #117 : enregistre le `refresh_token` Google côté serveur (edge
// function `google-token`, action "connect") dès qu'il est disponible —
// UNIQUEMENT présent dans l'objet session juste après l'échange OAuth
// initial (jamais après un simple rechargement ou un refresh de session
// Supabase). Appel silencieux, best-effort : ne bloque jamais la connexion
// si ça échoue, l'ancien mécanisme (provider_token direct) reste le filet
// de sécurité. Une fois enregistré, le jeton se renouvelle tout seul côté
// serveur indéfiniment — plus besoin de reconnexion manuelle.
export const connectGoogleWorkspaceTokens = async (session: {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
  user?: { email?: string | null } | null;
}): Promise<void> => {
  if (!session.provider_refresh_token) return;
  try {
    await supabase.functions.invoke('google-token', {
      body: {
        action: 'connect',
        refreshToken: session.provider_refresh_token,
        accessToken: session.provider_token || '',
        expiresIn: 3600,
        email: session.user?.email || null,
      },
    });
  } catch (err) {
    console.warn('[workspace] Échec enregistrement du jeton Google côté serveur :', err);
  }
};

// Ticket #117 : jeton toujours valide via l'edge function `google-token`
// (renouvellement serveur automatique) — `null` si jamais connecté côté
// serveur (utilisateur pas encore passé par `connectGoogleWorkspaceTokens`,
// ex. connexion faite avant la mise en place de ce mécanisme).
const requestServerManagedAccessToken = async (): Promise<string | null> => {
  try {
    const { data, error } = await supabase.functions.invoke('google-token', {
      body: { action: 'token' },
    });
    if (error) return null;
    return (data as { accessToken?: string })?.accessToken || null;
  } catch {
    return null;
  }
};

// Signalé le 2 septembre (Académy) : « Request had invalid authentication
// credentials. Expected OAuth 2 access token… » au dépôt d'un PDF, alors que
// le même dépôt marchait une demi-heure plus tôt. Le jeton Google vit une
// heure ; passé ce délai, `cachedAccessToken` — qui n'est jamais invalidé —
// continuait d'être servi tel quel à chaque appel Drive, et Google le
// refusait. Deux fonctions pour en sortir : reconnaître ce refus, et
// repartir chercher un jeton frais (renouvellement serveur, sinon session).
export const isGoogleAuthError = (e: unknown): boolean => {
  const message = String((e as { message?: unknown } | null)?.message ?? e ?? '');
  return /invalid authentication credentials|invalid credentials|unauthenticated|\b401\b/i.test(message);
};

export const renewWorkspaceAccessToken = async (stale?: string | null): Promise<string | null> => {
  cachedAccessToken = null;
  try {
    const token = await requestWorkspaceAccessToken();
    if (stale && token === stale) {
      // Rien de plus frais que le jeton refusé : on ne le garde pas en
      // cache, pour que la prochaine tentative repasse par la source.
      cachedAccessToken = null;
      return null;
    }
    return token;
  } catch {
    return null;
  }
};

export const requestWorkspaceAccessToken = async (): Promise<string> => {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  // Ticket #117 : priorité au jeton géré par le serveur — se renouvelle
  // tout seul indéfiniment, jamais besoin de reconnexion manuelle une fois
  // le compte connecté une première fois via `connectGoogleWorkspaceTokens`.
  const serverToken = await requestServerManagedAccessToken();
  if (serverToken) {
    cachedAccessToken = serverToken;
    return serverToken;
  }

  // Filet de sécurité : compte jamais encore relié côté serveur (ex. avant
  // la mise en place de ce mécanisme, ou juste après le tout premier
  // login) — retombe sur le `provider_token` direct de la session Supabase,
  // et tente de l'enregistrer côté serveur pour la prochaine fois.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const providerToken = await jetonWorkspaceDeSession(data.session);
  if (!providerToken) {
    throw new Error(
      "Accès Google Workspace non disponible. Reconnectez votre compte Google pour l'activer."
    );
  }

  if (data.session) void connectGoogleWorkspaceTokens(data.session);

  cachedAccessToken = providerToken;
  return providerToken;
};

// Ticket #108/#117 : Supabase ne renvoie le `provider_token` Google que
// juste après l'échange OAuth initial — passé ~1h (durée de vie du jeton
// Google) ou dès que Supabase rafraîchit sa propre session en arrière-plan
// (ce qui arrive automatiquement, sans rapport avec une action de
// l'utilisateur), `getSession()` ne le renvoie plus jamais. Sans le
// "Client Secret" Google (détenu par Supabase, jamais exposé à cette appli),
// impossible de le renouveler silencieusement en tâche de fond — repasser
// par un nouvel échange OAuth Google est la seule option côté client.
// Redirige la page courante (redirectTo = l'URL actuelle) pour revenir
// exactement là où l'utilisateur en était une fois reconnecté.
// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (13/16) : `drive.file`
// (déjà présent) ne donne accès qu'aux fichiers que CETTE appli a
// elle-même créés/ouverts — insuffisant pour rechercher les documents
// EXISTANTS du compte connecté, but même de la recherche Drive via Nova.
// `drive.readonly` (lecture seule, jamais d'écriture) est nécessaire pour
// ça. Un compte déjà connecté AVANT ce changement devra se reconnecter
// (bandeau "Reconnecter Google Workspace") pour obtenir ce nouveau scope —
// Google ne l'ajoute jamais silencieusement à un jeton déjà émis.
const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

// Retour de l'écran d'autorisation Google de la société (api/google/callback) :
// `?google=connecte` ou `?google_erreur=...` sur l'adresse de l'application.
// Consommé une seule fois — l'adresse est nettoyée aussitôt.
export const traiterRetourConnexionGoogle = (): { statut: 'connecte' } | { statut: 'erreur'; message: string } | null => {
  try {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get('google');
    const erreur = url.searchParams.get('google_erreur');
    if (!ok && !erreur) return null;
    url.searchParams.delete('google');
    url.searchParams.delete('google_erreur');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    if (ok === 'connecte') {
      // Le prochain appel repart chercher le jeton fraîchement enregistré
      // côté serveur, au lieu de resservir un éventuel jeton périmé.
      cachedAccessToken = null;
      return { statut: 'connecte' };
    }
    return { statut: 'erreur', message: erreur || 'Connexion Google refusée.' };
  } catch {
    return null;
  }
};

export const reconnectGoogleWorkspace = async (): Promise<void> => {
  // Décidé le 2 septembre : trois Workspace distincts, trois applications
  // Google « internes ». On demande d'abord au serveur l'adresse
  // d'autorisation de la société de l'utilisateur (api/google/connect) ; si
  // sa société n'a pas encore ses clés, on retombe sur la connexion
  // historique ci-dessous, inchangée.
  try {
    const { data } = await supabase.auth.getSession();
    const jeton = data.session?.access_token;
    if (jeton) {
      const reponse = await fetch('/api/google/connect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jeton}` },
      });
      const corps = (await reponse.json().catch(() => ({}))) as {
        url?: string; configured?: boolean; societe?: string | null; raison?: string; error?: string; clientId?: string;
      };
      if (reponse.ok && corps?.url) {
        window.location.href = corps.url;
        return;
      }
      // On se rabat sur l'ancienne connexion, mais on dit pourquoi : sans
      // ce message, un dépôt de clés incomplet est invisible (vécu le
      // 2 septembre avec ImmoSphera).
      const raison = !reponse.ok
        ? `réponse ${reponse.status}${corps?.error ? ` : ${corps.error}` : ''}`
        : corps?.raison === 'cles_absentes'
          ? `clés Google absentes dans cet environnement pour ${corps.societe || 'votre société'}`
          : corps?.raison === 'client_inconnu'
            ? `Google ne connaît pas l'identifiant client configuré pour ${corps.societe || 'votre société'} (${corps.clientId || '?'}) : la valeur dans Vercel ne correspond pas à la console Google`
            : corps?.raison === 'societe_inconnue'
              ? 'société non reconnue pour ce compte'
              : 'raison inconnue';
      console.warn('[workspace] connexion interne indisponible, repli sur la connexion historique :', raison);
      toast.warning(`Connexion Google par société indisponible (${raison}). Ancienne connexion utilisée.`, { duration: 12000 });
    }
  } catch (e) {
    console.warn('[workspace] connexion interne indisponible, repli sur la connexion historique :', e);
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href,
      // Mêmes portées qu'à la connexion initiale (Auth.tsx) — sinon un
      // jeton renouvelé mais amputé de gmail.send romprait l'envoi
      // silencieusement de la même façon.
      scopes: WORKSPACE_SCOPES,
      queryParams: {
        access_type: 'offline',
        // Ticket #117 : `prompt: 'consent'` forçait Google à réafficher
        // l'écran complet de consentement ("Continuer en tant que...",
        // liste des autorisations à valider une par une) à CHAQUE
        // reconnexion, même la 50e fois pour la même personne — sans ce
        // forçage, Google saute directement à un aller-retour quasi
        // invisible dès que les autorisations ont déjà été accordées une
        // fois, ce qui retire l'essentiel de la friction ressentie.
      },
    },
  });
  if (error) throw error;
};

// Ticket #117 : vérifie si l'accès Google est toujours utilisable, sans
// déclencher de reconnexion — sert à afficher un avertissement discret
// avant que l'utilisateur ne tombe dessus en pleine action (envoi d'un
// email, synchro agenda...). Vérifie d'abord le renouvellement automatique
// côté serveur (qui reste valide indéfiniment une fois relié) avant de
// retomber sur la session Supabase directe.
export const isGoogleWorkspaceConnected = async (): Promise<boolean> => {
  if (cachedAccessToken) return true;
  const serverToken = await requestServerManagedAccessToken();
  if (serverToken) {
    cachedAccessToken = serverToken;
    return true;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const token = await jetonWorkspaceDeSession(data.session);
    if (token) cachedAccessToken = token;
    return !!token;
  } catch {
    return false;
  }
};

// ==========================================
// GOOGLE CALENDAR API
// ==========================================

export interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  hangoutLink?: string;
  htmlLink?: string;
  conferenceData?: unknown;
  attendees?: { email: string; responseStatus?: string }[];
  // 'opaque' = Occupé (bloque le créneau), 'transparent' = Disponible.
  transparency?: 'opaque' | 'transparent';
}

// Construit les champs start/end communs à la création et à la mise à
// jour — gère à la fois les horaires précis (dateTime) et les événements
// "Toute la journée" / sur plusieurs jours (date seule, format AAAA-MM-JJ,
// bornes exclusives côté Google donc +1 jour sur la date de fin).
const buildTimeRange = (event: {
  startISO: string;
  endISO: string;
  allDay?: boolean;
}) => {
  if (event.allDay) {
    const endExclusive = new Date(event.endISO);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return {
      start: { date: event.startISO.slice(0, 10) },
      end: { date: endExclusive.toISOString().slice(0, 10) },
    };
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    start: { dateTime: event.startISO, timeZone },
    end: { dateTime: event.endISO, timeZone },
  };
};

const parseAttendees = (raw?: string): { email: string }[] | undefined => {
  if (!raw || !raw.trim()) return undefined;
  const emails = raw
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));
  return emails.length ? emails.map((email) => ({ email })) : undefined;
};

export const fetchGoogleCalendarEvents = async (token: string): Promise<GoogleCalendarEvent[]> => {
  const timeMin = new Date().toISOString();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=25`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors du chargement des événements Google Calendar');
  }

  const data = await res.json();
  return data.items || [];
};

export const createGoogleCalendarEvent = async (
  token: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startISO: string;
    endISO: string;
    addMeetLink?: boolean;
    allDay?: boolean;
    attendees?: string;
    busy?: boolean;
  }
): Promise<GoogleCalendarEvent> => {
  const body: Record<string, unknown> = {
    summary: event.summary,
    description: event.description,
    location: event.location,
    ...buildTimeRange(event),
    transparency: event.busy === false ? 'transparent' : 'opaque',
  };
  const attendees = parseAttendees(event.attendees);
  if (attendees) body.attendees = attendees;

  if (event.addMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: {
          type: 'hangoutsMeet',
        },
      },
    };
  }

  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events${
    event.addMeetLink ? '?conferenceDataVersion=1' : ''
  }`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la création de l\'événement Google Calendar');
  }

  return await res.json();
};

export const updateGoogleCalendarEvent = async (
  token: string,
  eventId: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    startISO: string;
    endISO: string;
    allDay?: boolean;
    attendees?: string;
    busy?: boolean;
  }
): Promise<GoogleCalendarEvent> => {
  const body: Record<string, unknown> = {
    summary: event.summary,
    description: event.description,
    location: event.location,
    ...buildTimeRange(event),
    transparency: event.busy === false ? 'transparent' : 'opaque',
  };
  const attendees = parseAttendees(event.attendees);
  if (attendees) body.attendees = attendees;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Erreur lors de la mise à jour de l'événement Google Calendar");
  }

  return await res.json();
};

export const deleteGoogleCalendarEvent = async (token: string, eventId: string): Promise<void> => {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la suppression de l\'événement');
  }
};


// ==========================================
// GOOGLE MEET API
// ==========================================

export interface GoogleMeetSpace {
  name: string; // "spaces/AAA..."
  meetingUri: string;
  meetingCode: string;
}

export const createGoogleMeetSpace = async (token: string): Promise<GoogleMeetSpace> => {
  const res = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la création de la réunion Google Meet');
  }

  const data = await res.json();
  return {
    name: data.name,
    meetingUri: data.meetingUri || `https://meet.google.com/${data.meetingCode || ''}`,
    meetingCode: data.meetingCode || '',
  };
};


// ==========================================
// GOOGLE SHEETS API
// ==========================================

export interface SpreadsheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

export const createGoogleSheetWithData = async (
  token: string,
  title: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<SpreadsheetExportResult> => {
  // 1. Create Spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la création du Google Sheet');
  }

  const sheetObj = await createRes.json();
  const spreadsheetId = sheetObj.spreadsheetId;
  const spreadsheetUrl = sheetObj.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // 2. Insert values (headers + rows)
  const range = 'Sheet1!A1';
  const values = [headers, ...rows];

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values,
      }),
    }
  );

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de l\'écriture des données dans Google Sheets');
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
  };
};

export const fetchGoogleSheetValues = async (
  token: string,
  spreadsheetId: string,
  range: string = 'Sheet1!A1:Z100'
): Promise<(string | number)[][]> => {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la lecture du Google Sheet');
  }

  const data = await res.json();
  return data.values || [];
};

// ==========================================
// GOOGLE DRIVE API - VIDEO UPLOADS & FOLDERS
// ==========================================

export interface DriveVideoUploadResult {
  fileId: string;
  fileUrl: string;
  folderName: string;
}

// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (13/16) : "Recherche de
// documents Google Drive via Nova... en respectant strictement les
// permissions Google déjà existantes du compte connecté". Exécutée côté
// CLIENT (jamais côté serveur) avec le token OAuth déjà en cache du
// navigateur (getCachedAccessToken) — c'est précisément ce qui garantit le
// respect des permissions : l'API Drive ne renvoie jamais un fichier que ce
// compte ne peut pas déjà voir, sans qu'aucune logique de permission ne
// soit à réimplémenter ici.
export interface GoogleDriveFileResult {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  modifiedTime?: string;
  ownerName?: string;
}

// Ticket "recherche par type de fichier" : "document"/"spreadsheet"/
// "presentation" ne doivent pas se limiter aux formats natifs Google Docs/
// Sheets/Slides — un cabinet reçoit surtout de vrais fichiers Word/Excel/
// PowerPoint (.docx/.xlsx/.pptx, voire l'ancien .doc/.xls/.ppt) déposés tels
// quels dans Drive, jamais convertis. Chaque catégorie couvre donc les deux
// familles de formats.
const DRIVE_MIME_MAP: Record<string, string[]> = {
  document: [
    'application/vnd.google-apps.document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ],
  spreadsheet: [
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
  presentation: [
    'application/vnd.google-apps.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
  ],
  pdf: ['application/pdf'],
  folder: ['application/vnd.google-apps.folder'],
};

export const searchGoogleDriveFiles = async (
  token: string,
  opts: { query?: string; mimeType?: string; recent?: boolean }
): Promise<GoogleDriveFileResult[]> => {
  const clauses: string[] = ['trashed = false'];
  if (opts.query && opts.query.trim()) {
    // Signalé : Nova ne retrouve pas un document dont le nom exact ne
    // correspond pas mot pour mot à la formulation de l'utilisateur (ex.
    // "Cni Sylvain GRAZIA.pdf" introuvable si Nova cherche autre chose que
    // la sous-chaîne exacte). Un seul `name contains 'phrase entière'`
    // exige que TOUTE la phrase apparaisse telle quelle et dans le bon
    // ordre — trop fragile. On découpe donc la requête en mots et on les
    // combine en OR : n'importe quel mot du nom du fichier suffit à le
    // faire remonter, comme une vraie recherche par mots-clés.
    const words = opts.query
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
      .filter(Boolean)
      .slice(0, 6);
    if (words.length) {
      clauses.push(`(${words.map((w) => `name contains '${w}'`).join(' or ')})`);
    }
  }
  if (opts.mimeType === 'image') {
    clauses.push(`mimeType contains 'image/'`);
  } else if (opts.mimeType && opts.mimeType !== 'any' && DRIVE_MIME_MAP[opts.mimeType]) {
    const mimeVariants = DRIVE_MIME_MAP[opts.mimeType];
    clauses.push(`(${mimeVariants.map((m) => `mimeType = '${m}'`).join(' or ')})`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,mimeType,webViewLink,iconLink,modifiedTime,owners(displayName))',
    pageSize: '15',
    orderBy: opts.recent ? 'modifiedTime desc' : 'name',
    // Sans ces deux paramètres, l'API Drive ignore silencieusement tout
    // fichier situé dans un Drive PARTAGÉ (team drive) — seul "Mon Drive"
    // est couvert par défaut. Élargit la recherche sans changer le
    // comportement pour les fichiers déjà couverts.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la recherche Google Drive.');
  }
  const body = await res.json();
  return ((body.files || []) as any[]).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    webViewLink: f.webViewLink,
    iconLink: f.iconLink,
    modifiedTime: f.modifiedTime,
    ownerName: f.owners?.[0]?.displayName,
  }));
};

/**
 * Ensures "Messages CRM / <EntityName>" folder structure exists in Google Drive.
 */
export const getOrCreateDriveFolder = async (token: string, folderName: string, parentId?: string): Promise<string> => {
  const query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false ${
    parentId ? `and '${parentId}' in parents` : ''
  }`;

  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (listRes.ok) {
    const listData = await listRes.json();
    if (listData.files && listData.files.length > 0) {
      return listData.files[0].id;
    }
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erreur création dossier Drive '${folderName}'`);
  }

  const folderObj = await createRes.json();
  return folderObj.id;
};

/**
 * Uploads video to Google Drive under "Messages CRM / <EntityName>" folder.
 */
export const uploadVideoToDriveFolder = async (
  token: string,
  file: File,
  entityName: string
): Promise<DriveVideoUploadResult> => {
  const parentFolderName = 'Messages CRM';
  const entityFolderName = `Messages CRM / ${entityName}`;

  // 1. Get or create parent folder "Messages CRM"
  let rootFolderId = '';
  try {
    rootFolderId = await getOrCreateDriveFolder(token, parentFolderName);
  } catch (_) {
    // Continue even if root folder creation fails
  }

  // 2. Get or create entity folder
  let targetFolderId = '';
  try {
    targetFolderId = await getOrCreateDriveFolder(token, entityName, rootFolderId || undefined);
  } catch (_) {
    // Continue
  }

  // 3. Upload video file via multipart upload
  const metadata = {
    name: file.name,
    mimeType: file.type || 'video/mp4',
    parents: targetFolderId ? [targetFolderId] : rootFolderId ? [rootFolderId] : [],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors du téléversement de la vidéo sur Google Drive');
  }

  const uploadData = await uploadRes.json();
  return {
    fileId: uploadData.id,
    fileUrl: uploadData.webViewLink || `https://drive.google.com/file/d/${uploadData.id}/preview`,
    folderName: entityFolderName,
  };
};

// Ticket #250 : bouton "Utiliser dans le CRM" sur une image générée par
// Nova — dépose le fichier dans le Drive du compte connecté (dossier dédié
// "Nova - Images générées"), même mécanisme d'upload que
// uploadVideoToDriveFolder ci-dessus, généralisé à un Blob quelconque.
export const uploadImageToDriveFolder = async (
  token: string,
  blob: Blob,
  fileName: string
): Promise<DriveVideoUploadResult> => {
  const folderName = 'Nova - Images générées';
  let folderId = '';
  try {
    folderId = await getOrCreateDriveFolder(token, folderName);
  } catch (_) {
    // Continue même si la création du dossier échoue — l'upload se fera
    // simplement à la racine du Drive plutôt que d'échouer entièrement.
  }

  const metadata = {
    name: fileName,
    mimeType: blob.type || 'image/png',
    parents: folderId ? [folderId] : [],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error?.message || "Erreur lors du téléversement de l'image sur Google Drive");
  }

  const uploadData = await uploadRes.json();
  return {
    fileId: uploadData.id,
    fileUrl: uploadData.webViewLink || `https://drive.google.com/file/d/${uploadData.id}/preview`,
    folderName,
  };
};

/**
 * Deletes a file from Google Drive when a video message is deleted.
 */
export const deleteDriveFile = async (token: string, fileId: string): Promise<void> => {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    console.warn('Erreur suppression Drive file:', err);
  }
};



// ==========================================
// GMAIL API
// ==========================================

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;

  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;

  bodyText: string;
  bodyHtml: string;

  isRead: boolean;

  // Ticket #47 : en-tête RFC822 Message-Id (distinct de `id`, l'identifiant
  // interne Gmail) — nécessaire pour répondre dans le même fil (In-Reply-To
  // / References), sans quoi Gmail crée un nouveau fil à chaque réponse.
  messageIdHeader: string | undefined;
}

interface GmailApiHeader {
  name: string;
  value: string;
}

interface GmailApiPayload {
  mimeType?: string;
  body?: {
    data?: string;
  };
  headers?: GmailApiHeader[];
  parts?: GmailApiPayload[];
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailApiPayload;
}

function decodeBase64UrlUtf8(value: string): string {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const padded =
    normalized +
    '='.repeat(
      (4 - (normalized.length % 4)) % 4
    );

  const binary = atob(padded);

  const bytes = Uint8Array.from(
    binary,
    (char) => char.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

function encodeUtf8Base64Url(value: string): string {
  const bytes =
    new TextEncoder().encode(value);

  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// Signalé (16 septembre) : « le client reçoit ça sur son mail :
// Consentement au dÃƒÂ©marchage... » — un en-tête email (Subject) doit
// rester en ASCII (RFC 5322) ; les accents envoyés bruts, tels quels dans
// l'en-tête, sont réinterprétés avec un autre charset par certains relais
// ou clients de messagerie, d'où ce charabia (double encodage visible :
// "Ã©" à la place de "é"). Encodage standard RFC 2047 (=?UTF-8?B?...?=)
// pour tout sujet contenant un caractère non-ASCII — le corps du message
// n'est pas concerné (il n'est pas un en-tête, son charset UTF-8 est
// déjà déclaré correctement dans Content-Type ci-dessous).
function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function getHeader(
  headers: GmailApiHeader[] | undefined,
  name: string
): string {
  return (
    headers?.find(
      (header) =>
        header.name.toLowerCase() ===
        name.toLowerCase()
    )?.value || ''
  );
}

function extractEmailAddress(
  value: string
): {
  name: string;
  email: string;
} {
  const match =
    value.match(
      /^(?:"?([^"]*)"?\s*)?<([^>]+)>$/
    );

  if (match) {
    return {
      name:
        match[1]?.trim() ||
        match[2].trim(),
      email:
        match[2].trim(),
    };
  }

  return {
    name:
      value.trim(),
    email:
      value.trim(),
  };
}

function extractBodies(
  payload: GmailApiPayload | undefined
): {
  text: string;
  html: string;
} {
  if (!payload) {
    return {
      text: '',
      html: '',
    };
  }

  let text = '';
  let html = '';

  if (
    payload.mimeType === 'text/plain' &&
    payload.body?.data
  ) {
    text =
      decodeBase64UrlUtf8(
        payload.body.data
      );
  }

  if (
    payload.mimeType === 'text/html' &&
    payload.body?.data
  ) {
    html =
      decodeBase64UrlUtf8(
        payload.body.data
      );
  }

  for (const part of payload.parts || []) {
    const extracted =
      extractBodies(part);

    if (!text && extracted.text) {
      text = extracted.text;
    }

    if (!html && extracted.html) {
      html = extracted.html;
    }
  }

  return {
    text,
    html,
  };
}

/**
 * Nombre réel de mails non lus (via le label système UNREAD de Gmail).
 * Un seul appel léger — pas besoin de lister/décoder les messages.
 */
export const fetchGmailUnreadCount = async (token: string): Promise<number> => {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels/UNREAD', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors du comptage des mails non lus.');
  }

  const data = await res.json();
  // Gmail affiche son propre badge de non-lus par CONVERSATION (thread), pas
  // par message individuel — un fil de 3 messages non lus ne compte que pour
  // 1 dans l'interface Gmail. `threadsUnread` reproduit exactement ce
  // comportement ; `messagesUnread` gonflait artificiellement le chiffre dès
  // qu'un fil avait plusieurs messages non lus.
  return typeof data.threadsUnread === 'number' ? data.threadsUnread : 0;
};

/**
 * Signature Gmail (HTML) réellement configurée par l'utilisateur dans ses
 * propres paramètres Gmail (Voir tous les paramètres > Général > Signature).
 * Chaque utilisateur garde ainsi SA signature — l'app ne la remplace jamais
 * par une signature commune/personnalisée.
 *
 * Nécessite la portée OAuth `gmail.settings.basic` (ajoutée à la connexion
 * Google) : si un utilisateur ne l'a pas encore (session ouverte avant cet
 * ajout), l'appel échoue silencieusement et l'on renvoie une chaîne vide —
 * la rédaction d'un message ne doit jamais être bloquée pour cette raison.
 * L'utilisateur récupère l'accès à sa signature après une reconnexion Google.
 */
export const fetchGmailSignature = async (token: string): Promise<string> => {
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return '';

    const data = await res.json();
    const aliases: { sendAsEmail: string; isPrimary?: boolean; isDefault?: boolean; signature?: string }[] =
      data.sendAs || [];

    const primary = aliases.find((a) => a.isPrimary) || aliases.find((a) => a.isDefault) || aliases[0];
    return primary?.signature || '';
  } catch {
    return '';
  }
};

export const fetchGmailMessages = async (
  token: string,
  options?: {
    maxResults?: number;
    query?: string;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  }
): Promise<GmailMessageSummary[]> => {
  const maxResults = Math.min(Math.max(options?.maxResults || 30, 1), 100);

  const params = new URLSearchParams({
    maxResults: String(maxResults),
  });

  if (options?.query?.trim()) {
    params.set('q', options.query.trim());
  }

  if (options?.labelIds && options.labelIds.length > 0) {
    options.labelIds.forEach(labelId => params.append('labelIds', labelId));
  }

  if (options?.includeSpamTrash) {
    params.set('includeSpamTrash', 'true');
  }

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!listRes.ok) {
    const err = await listRes.json().catch(() => ({}));
    throw new Error(
      err.error?.message || 'Erreur lors du chargement de Gmail.'
    );
  }

  const listData = await listRes.json();

  const refs: {
    id: string;
    threadId: string;
  }[] = listData.messages || [];

  const messages = await Promise.all(
    refs.map(async (ref) => {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const message = (await response.json()) as GmailApiMessage;
      const headers = message.payload?.headers;
      const fromRaw = getHeader(headers, 'From');
      const from = extractEmailAddress(fromRaw);
      const bodies = extractBodies(message.payload);

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds || [],
        snippet: message.snippet || '',
        from: from.email,
        fromName: from.name,
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject') || '(Sans objet)',
        date: getHeader(headers, 'Date'),
        bodyText: bodies.text || message.snippet || '',
        bodyHtml: bodies.html,
        isRead: !(message.labelIds || []).includes('UNREAD'),
        messageIdHeader: getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id') || undefined,
      } satisfies GmailMessageSummary;
    })
  );

  return messages.filter((m): m is GmailMessageSummary => m !== null);
};

/**
 * Demande explicite : "des utilisateurs ont créé des dossiers [dans Gmail],
 * il faut synchroniser" — jusqu'ici, Mail (MailView.tsx) n'affichait que les
 * 7 dossiers système fixes (Réception, Non lus, Spam...), jamais les
 * libellés personnalisés que chacun a pu créer directement dans Gmail.
 * Comme ces libellés viennent en direct de l'API Gmail (jamais stockés
 * localement), ils sont automatiquement identiques sur tous les appareils —
 * aucune synchronisation locale à gérer en plus.
 */
export interface GmailUserLabel {
  id: string;
  name: string;
}

export const fetchGmailUserLabels = async (token: string): Promise<GmailUserLabel[]> => {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors du chargement des dossiers Gmail.');
  }
  const data = await res.json();
  const labels: { id: string; name: string; type?: string; labelListVisibility?: string }[] = data.labels || [];
  return labels
    .filter((l) => l.type === 'user' && l.labelListVisibility !== 'labelHide')
    .map((l) => ({ id: l.id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
};

export const modifyGmailMessageLabels = async (
  token: string,
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): Promise<void> => {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la modification du message.');
  }
};

export const trashGmailMessage = async (
  token: string,
  messageId: string
): Promise<void> => {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors du déplacement dans la corbeille.');
  }
};

export const untrashGmailMessage = async (
  token: string,
  messageId: string
): Promise<void> => {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/untrash`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la restauration du message.');
  }
};

export const deleteGmailMessagePermanently = async (
  token: string,
  messageId: string
): Promise<void> => {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Erreur lors de la suppression définitive.');
  }
};

export const sendGmailMessage = async (
  token: string,
  message: {
    to: string;
    subject: string;
    body: string;
    // Corps HTML optionnel (signature avec mise en forme/photos configurée
    // dans Paramètres > Mail) — quand fourni, prime sur `body` et le message
    // est envoyé en `text/html` au lieu de texte brut.
    bodyHtml?: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<{
  id: string;
  threadId: string;
}> => {
  // Ticket #108 (suivi) : un `From:` explicite avait été essayé pour forcer
  // l'expéditeur — retiré, ça cassait l'envoi (Gmail rejette le message
  // entier si le `From` ne correspond pas exactement à un alias "send-as"
  // autorisé sur le compte). L'API Gmail envoie de toute façon déjà
  // nécessairement depuis le compte authentifié ("users/me") : pas besoin
  // de le forcer, et plus sûr de laisser Gmail le déduire lui-même.
  const useHtml = Boolean(message.bodyHtml?.trim());

  const headers = [
    `To: ${message.to}`,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    useHtml ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (
    message.inReplyTo
  ) {
    headers.push(
      `In-Reply-To: ${message.inReplyTo}`
    );
  }

  if (
    message.references
  ) {
    headers.push(
      `References: ${message.references}`
    );
  }

  const mime =
    `${headers.join('\r\n')}\r\n\r\n${useHtml ? message.bodyHtml : message.body}`;

  const body: {
    raw: string;
    threadId?: string;
  } = {
    raw:
      encodeUtf8Base64Url(
        mime
      ),
  };

  if (
    message.threadId
  ) {
    body.threadId =
      message.threadId;
  }

  const response =
    await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${token}`,
          'Content-Type':
            'application/json',
        },
        body:
          JSON.stringify(
            body
          ),
      }
    );

  if (!response.ok) {
    const err =
      await response
        .json()
        .catch(
          () => ({})
        );

    throw new Error(
      err.error?.message ||
        'Erreur lors de l’envoi du message Gmail.'
    );
  }

  return await response.json();
};