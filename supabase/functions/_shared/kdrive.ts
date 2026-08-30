/**
 * Helpers d'accès à l'API kDrive (Infomaniak).
 * Doc : https://developer.infomaniak.com/docs/api/get/2/drive/%7Bdrive_id%7D
 *
 * Tous les appels utilisent un token API personnel (scope `drive`) stocké
 * en secret `KDRIVE_TOKEN`. L'ID du Drive (numérique) est dans `KDRIVE_ID`.
 */

const API_BASE = "https://api.infomaniak.com";

function extractNumericId(
  raw: string | number | null | undefined,
  label: string,
  kind: "drive" | "file",
  fallback?: string,
): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    if (fallback) return fallback;
    throw new Error(`${label} manquant côté serveur`);
  }
  if (/^\d+$/.test(value)) return value;

  const queryKeys = kind === "drive"
    ? ["drive_id", "driveId", "drive"]
    : ["file_id", "fileId", "folder_id", "folderId", "directory_id", "directoryId"];
  const pathKeys = kind === "drive"
    ? ["drive", "drives", "kdrive"]
    : ["file", "files", "folder", "folders", "directory", "directories"];

  try {
    const url = new URL(value);
    for (const key of queryKeys) {
      const candidate = url.searchParams.get(key);
      if (candidate && /^\d+$/.test(candidate)) return candidate;
    }
    const parts = url.pathname.split("/").map(decodeURIComponent).filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      if (pathKeys.includes(parts[i].toLowerCase()) && /^\d+$/.test(parts[i + 1])) {
        return parts[i + 1];
      }
    }
    const numericParts = parts.filter((part) => /^\d+$/.test(part));
    if (numericParts.length === 1) return numericParts[0];
  } catch {
    const keyPattern = kind === "drive"
      ? /(?:drive[_-]?id|drive)\D+(\d+)/i
      : /(?:file[_-]?id|folder[_-]?id|directory[_-]?id|file|folder|directory)\D+(\d+)/i;
    const keyed = value.match(keyPattern)?.[1];
    if (keyed) return keyed;
    const numericParts = value.match(/\d+/g) ?? [];
    if (numericParts.length === 1) return numericParts[0];
  }

  throw new Error(`${label} invalide : utilisez l'identifiant numérique kDrive, pas une URL complète ni un nom.`);
}

function getCreds(): { token: string; driveId: string } {
  const token = Deno.env.get("KDRIVE_TOKEN");
  const driveId = extractNumericId(Deno.env.get("KDRIVE_ID"), "KDRIVE_ID", "drive");
  if (!token) throw new Error("KDRIVE_TOKEN manquant côté serveur");
  return { token, driveId };
}

function authHeaders(): Record<string, string> {
  const { token } = getCreds();
  return { Authorization: `Bearer ${token}` };
}

async function jsonOrThrow(res: Response, label: string): Promise<any> {
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const reason =
      parsed?.error?.description ||
      parsed?.error?.code ||
      parsed?.message ||
      text ||
      res.statusText;
    const hint = parsed?.error?.code === "method_not_found"
      ? " Vérifiez que KDRIVE_ID est bien l'identifiant numérique du drive kDrive."
      : "";
    throw new Error(`kDrive ${label} échoué (${res.status}): ${reason}${hint}`);
  }
  return parsed;
}

export interface KdriveFile {
  id: number;
  name: string;
  type?: string;
  parent_id?: number | null;
}

/**
 * Crée un dossier sous `parentId`. `parentId = 1` représente la racine du Drive
 * dans l'API kDrive (mais on accepte aussi 0/null/undefined comme racine).
 * Si un dossier homonyme existe déjà, on le retourne (idempotent).
 */
export async function kdriveCreateDirectory(
  parentId: string | number | null | undefined,
  name: string,
): Promise<KdriveFile> {
  const { driveId } = getCreds();
  const parent = extractNumericId(parentId, "Dossier parent kDrive", "file", "1");
  const res = await fetch(
    `${API_BASE}/3/drive/${encodeURIComponent(driveId)}/files/${encodeURIComponent(parent)}/directory`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  // 409 : déjà existant -> retrouver l'enfant homonyme
  if (res.status === 409) {
    const existing = await kdriveFindChildByName(parent, name);
    if (existing) return existing;
  }
  const body = await jsonOrThrow(res, "create directory");
  return body?.data as KdriveFile;
}

export async function kdriveFindChildByName(
  parentId: string | number,
  name: string,
): Promise<KdriveFile | null> {
  const { driveId } = getCreds();
  const parent = extractNumericId(parentId, "Dossier parent kDrive", "file", "1");
  const url = `${API_BASE}/3/drive/${encodeURIComponent(driveId)}/files/${encodeURIComponent(parent)}/files?per_page=200`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const items: any[] = body?.data ?? [];
  return items.find((f) => f?.name === name) ?? null;
}

/**
 * Upload un fichier dans `directoryId`. Retourne l'objet fichier kDrive
 * (incluant id et url web). Utilise l'endpoint v3 streaming raw bytes.
 */
export async function kdriveUpload(
  directoryId: string | number,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<KdriveFile & { url?: string }> {
  const { driveId } = getCreds();
  const directory = extractNumericId(directoryId, "Dossier kDrive", "file", "1");
  const params = new URLSearchParams({
    directory_id: directory,
    file_name: fileName,
    total_size: String(bytes.byteLength),
    conflict: "rename",
  });
  const res = await fetch(
    `${API_BASE}/3/drive/${encodeURIComponent(driveId)}/upload?${params.toString()}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": mimeType || "application/octet-stream",
      },
      body: bytes,
    },
  );
  const body = await jsonOrThrow(res, "upload");
  return body?.data as KdriveFile & { url?: string };
}

/**
 * Crée (ou récupère) un lien public en lecture pour un fichier/dossier.
 * Retourne l'URL partageable.
 */
export async function kdriveEnsureShareLink(
  fileId: string | number,
): Promise<string | null> {
  const { driveId } = getCreds();
  const file = extractNumericId(fileId, "Fichier kDrive", "file");
  // Tente la création
  const res = await fetch(
    `${API_BASE}/3/drive/${encodeURIComponent(driveId)}/files/${encodeURIComponent(file)}/link`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ permission: "public", right: "read" }),
    },
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    return body?.data?.url ?? null;
  }
  // Existe déjà ? on récupère
  const get = await fetch(
    `${API_BASE}/3/drive/${encodeURIComponent(driveId)}/files/${encodeURIComponent(file)}/link`,
    { headers: authHeaders() },
  );
  if (get.ok) {
    const body = await get.json().catch(() => null);
    return body?.data?.url ?? null;
  }
  return null;
}

export async function kdriveDelete(fileId: string | number): Promise<void> {
  const { driveId } = getCreds();
  const file = extractNumericId(fileId, "Fichier kDrive", "file");
  const res = await fetch(
    `${API_BASE}/3/drive/${encodeURIComponent(driveId)}/files/${encodeURIComponent(file)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`kDrive delete échoué (${res.status}): ${text}`);
  }
}

/**
 * Indique si une agence est configurée pour utiliser kDrive.
 */
export async function isAgencyKdrive(
  admin: { from: (t: string) => any },
  agencyId: string,
): Promise<{ enabled: boolean; rootFolderId: string | null }> {
  const { data } = await admin
    .from("agencies")
    .select("storage_provider, drive_folder_id")
    .eq("id", agencyId)
    .maybeSingle();
  return {
    enabled: data?.storage_provider === "kdrive",
    rootFolderId: data?.drive_folder_id ?? null,
  };
}