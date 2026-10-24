import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase';

// In-memory token storage (Do NOT persist in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const getCachedAccessToken = (): string | null => {
  return cachedAccessToken;
};

/**
 * Trigger Google Sign-In popup with Workspace scopes to get or renew the access token.
 */
export const requestWorkspaceAccessToken = async (): Promise<string> => {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/calendar');
  provider.addScope('https://www.googleapis.com/auth/calendar.events');
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/meetings.space.created');
  
  provider.setCustomParameters({ prompt: 'consent' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  
  if (!credential?.accessToken) {
    throw new Error('Impossible d\'obtenir le jeton d\'accès Google Workspace.');
  }

  cachedAccessToken = credential.accessToken;
  return cachedAccessToken;
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
}

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
  }
): Promise<GoogleCalendarEvent> => {
  const body: Record<string, unknown> = {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: {
      dateTime: event.startISO,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: event.endISO,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

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

