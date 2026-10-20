import {
  getOrCreateDriveFolder,
  isGoogleAuthError,
  renewWorkspaceAccessToken,
} from '@/lib/workspace';

export interface DriveDocumentUploadResult {
  fileId: string;
  fileUrl: string;
  downloadUrl?: string;
  folderName: string;
}

/**
 * Téléverse un document dans :
 *
 * NovaSphere CRM / Documents / <Agence>
 *
 * La clé / le token Google n'est jamais persisté :
 * le token reste uniquement en mémoire via workspace.ts.
 */
export const uploadDocumentToDrive = async (
  token: string,
  file: File,
  agencyName: string,
  // Demande explicite (20 octobre) : « pas de partage, ça reste en interne,
  // juste l'œil pour prévisualiser » — l'aperçu intégré (ClientProfileView)
  // ne fonctionne que si le document est au moins partagé avec QUELQU'UN
  // d'autre que l'envoyeur ; un lien public (type "anyone") était exclu
  // explicitement. Avec l'adresse de l'envoyeur, le fichier est partagé
  // seulement avec son propre domaine Google Workspace (voir
  // partagerAvecLeDomaine plus bas) — jamais au-delà de l'entreprise.
  uploaderEmail?: string | null
): Promise<DriveDocumentUploadResult> => {
  try {
    return await envoyerVersDrive(token, file, agencyName, uploaderEmail);
  } catch (e) {
    // Jeton Google expiré (voir workspace.ts, isGoogleAuthError) : on en
    // demande un frais et on refait UNE tentative. Sans jeton plus frais,
    // l'utilisateur doit reconnecter Google — on le lui dit clairement, au
    // lieu du message technique de Google.
    if (!isGoogleAuthError(e)) throw e;
    const frais = await renewWorkspaceAccessToken(token);
    if (!frais) {
      const erreur = new Error(
        "Votre accès Google Drive a expiré. Reconnectez Google, puis déposez à nouveau le fichier."
      ) as Error & { code?: string };
      erreur.code = 'google-reconnect';
      throw erreur;
    }
    return envoyerVersDrive(frais, file, agencyName, uploaderEmail);
  }
};

// Partage le fichier avec tout le domaine Google Workspace de l'envoyeur
// (ex. @immosphera.fr), jamais plus large — un compte grand public (gmail.com,
// outlook.com...) n'a pas de domaine Workspace à restreindre : Google refuse
// alors la demande, ce qui est normal, pas une panne. Best-effort : le
// document reste utilisable (lien de secours côté fiche client) même si ce
// partage échoue, pour ne jamais bloquer l'envoi pour un simple confort
// d'aperçu.
const partagerAvecLeDomaine = async (token: string, fileId: string, uploaderEmail?: string | null): Promise<void> => {
  const domaine = uploaderEmail?.split('@')[1]?.trim().toLowerCase();
  if (!domaine) return;
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'domain', role: 'reader', domain: domaine }),
    });
  } catch {
    // Silencieux : voir le commentaire de la fonction.
  }
};

const envoyerVersDrive = async (
  token: string,
  file: File,
  agencyName: string,
  uploaderEmail?: string | null
): Promise<DriveDocumentUploadResult> => {
  const rootFolderId =
    await getOrCreateDriveFolder(
      token,
      'NovaSphere CRM'
    );

  const documentsFolderId =
    await getOrCreateDriveFolder(
      token,
      'Documents',
      rootFolderId
    );

  const agencyFolderId =
    await getOrCreateDriveFolder(
      token,
      agencyName,
      documentsFolderId
    );

  const metadata = {
    name: file.name,
    mimeType:
      file.type ||
      'application/octet-stream',
    parents: [
      agencyFolderId,
    ],
  };

  const form = new FormData();

  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify(
          metadata
        ),
      ],
      {
        type: 'application/json',
      }
    )
  );

  form.append(
    'file',
    file
  );

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${token}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    const error =
      await response
        .json()
        .catch(() => ({}));

    throw new Error(
      error.error?.message ||
        "Erreur lors de l'envoi du document vers Google Drive."
    );
  }

  const data =
    await response.json();

  await partagerAvecLeDomaine(token, data.id, uploaderEmail);

  return {
    fileId: data.id,

    fileUrl:
      data.webViewLink ||
      `https://drive.google.com/file/d/${data.id}/view`,

    downloadUrl:
      data.webContentLink,

    folderName:
      `NovaSphere CRM / Documents / ${agencyName}`,
  };
};