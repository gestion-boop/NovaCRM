import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type DrivePermission = {
  id?: string;
  type?: string;
  role?: string;
  emailAddress?: string;
  deleted?: boolean;
};

type DriveApiError = {
  error?: {
    errors?: Array<{ reason?: string; message?: string }>;
    message?: string;
  };
};

export type DrivePermissionSyncResult = {
  granted: number;
  revoked: number;
  skipped: number;
  warnings: string[];
};

export async function getLeadParticipantEmails(
  admin: SupabaseClient,
  leadId: string,
): Promise<string[]> {
  const participantIds = new Set<string>();

  const { data: lead } = await admin
    .from("leads")
    .select("created_by, assigned_to")
    .eq("id", leadId)
    .maybeSingle();

  if (lead?.created_by) participantIds.add(lead.created_by as string);
  if (lead?.assigned_to) participantIds.add(lead.assigned_to as string);

  const { data: shares } = await admin
    .from("client_shares")
    .select("shared_with, shared_by")
    .eq("lead_id", leadId);

  for (const s of shares ?? []) {
    if (s.shared_with) participantIds.add(String(s.shared_with));
    if (s.shared_by) participantIds.add(String(s.shared_by));
  }

  return await loadProfileEmails(admin, [...participantIds]);
}

export async function getLeadGuestEmails(
  admin: SupabaseClient,
  leadId: string,
): Promise<string[]> {
  const { data: shares } = await admin
    .from("client_shares")
    .select("shared_with")
    .eq("lead_id", leadId);

  const ids = [...new Set((shares ?? []).map((s: any) => String(s.shared_with)).filter(Boolean))];
  return await loadProfileEmails(admin, ids);
}

export async function getUserEmailById(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  const email = normalizeEmail(profile?.email ?? null);
  return email;
}

async function loadProfileEmails(
  admin: SupabaseClient,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("email")
    .in("id", userIds);

  const emails = new Set<string>();
  for (const p of profiles ?? []) {
    const email = normalizeEmail((p as any).email ?? null);
    if (email) emails.add(email);
  }
  return [...emails];
}

export async function grantDriveReaderPermissions(
  accessToken: string,
  fileId: string,
  emails: string[],
): Promise<DrivePermissionSyncResult> {
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean) as string[])];
  if (normalized.length === 0) {
    return { granted: 0, revoked: 0, skipped: 0, warnings: [] };
  }

  const result: DrivePermissionSyncResult = { granted: 0, revoked: 0, skipped: 0, warnings: [] };

  const perms = await listDrivePermissions(accessToken, fileId, result.warnings);
  const existingByEmail = new Map<string, DrivePermission>();
  for (const p of perms) {
    const email = normalizeEmail(p.emailAddress ?? null);
    if (email) existingByEmail.set(email, p);
  }

  for (const email of normalized) {
    if (existingByEmail.has(email)) {
      result.skipped += 1;
      continue;
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "user",
          role: "reader",
          emailAddress: email,
        }),
      },
    );

    if (res.ok) {
      result.granted += 1;
      continue;
    }

    const err = (await safeJson(res)) as DriveApiError;
    const reason = err.error?.errors?.[0]?.reason ?? "unknown";
    if (reason === "alreadyExists") {
      result.skipped += 1;
      continue;
    }
    result.warnings.push(`grant ${email}: ${err.error?.message ?? res.statusText}`);
  }

  return result;
}

export async function revokeDriveReaderPermissions(
  accessToken: string,
  fileId: string,
  emails: string[],
): Promise<DrivePermissionSyncResult> {
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean) as string[])];
  if (normalized.length === 0) {
    return { granted: 0, revoked: 0, skipped: 0, warnings: [] };
  }

  const result: DrivePermissionSyncResult = { granted: 0, revoked: 0, skipped: 0, warnings: [] };
  const perms = await listDrivePermissions(accessToken, fileId, result.warnings);

  for (const p of perms) {
    const email = normalizeEmail(p.emailAddress ?? null);
    if (!email || !normalized.includes(email)) continue;
    if (!p.id) {
      result.warnings.push(`revoke ${email}: permission id manquant`);
      continue;
    }
    if (p.role === "owner") {
      result.skipped += 1;
      continue;
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(p.id)}?supportsAllDrives=true`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (res.ok || res.status === 404) {
      result.revoked += 1;
      continue;
    }

    const err = (await safeJson(res)) as DriveApiError;
    const reason = err.error?.errors?.[0]?.reason ?? "unknown";
    if (reason === "cannotModifyInheritedTeamDrivePermission") {
      result.skipped += 1;
      continue;
    }
    result.warnings.push(`revoke ${email}: ${err.error?.message ?? res.statusText}`);
  }

  return result;
}

async function listDrivePermissions(
  accessToken: string,
  fileId: string,
  warnings: string[],
): Promise<DrivePermission[]> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role,emailAddress,deleted)&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!res.ok) {
    const err = (await safeJson(res)) as DriveApiError;
    warnings.push(`list permissions: ${err.error?.message ?? res.statusText}`);
    return [];
  }

  const data = (await safeJson(res)) as { permissions?: DrivePermission[] };
  return data.permissions ?? [];
}

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
