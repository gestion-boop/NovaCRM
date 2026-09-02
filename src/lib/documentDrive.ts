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
  agencyName: string
): Promise<DriveDocumentUploadResult> => {
  try {
    return await envoyerVersDrive(token, file, agencyName);
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
    return envoyerVersDrive(frais, file, agencyName);
  }
};

const envoyerVersDrive = async (
  token: string,
  file: File,
  agencyName: string
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