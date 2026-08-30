export const DRIVE_RECONNECT_REQUIRED_MESSAGE =
  "Drive doit être reconnecté pour autoriser l'accès au dossier racine de l'agence";

export const DRIVE_RECONNECT_REQUIRED_BODY = {
  ok: false,
  code: "DRIVE_RECONNECT_REQUIRED",
  needsReconnect: true,
  message: DRIVE_RECONNECT_REQUIRED_MESSAGE,
};

export function hasRequiredDriveScope(scope: string | null | undefined): boolean {
  const scopes = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return scopes.has("https://www.googleapis.com/auth/drive");
}