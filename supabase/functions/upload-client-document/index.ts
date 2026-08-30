import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getValidUserGoogleToken } from "../_shared/user-google-token.ts";

// Ticket "Clients invités" (10/13) : un client invité envoie un document
// depuis son mobile (pièce d'identité, justificatif...). Il n'a PAS de
// compte Google Workspace connecté (contrairement à un conseiller) — le
// fichier part donc TOUJOURS via le compte Google de Sylvain, déjà connecté
// et auto-renouvelé (même mécanisme que send-system-email, ticket #117),
// dans le même arbo Drive que les documents ajoutés par l'équipe :
// NovaSphere CRM / Documents / <Agence> — pas de nouveau système de
// stockage à gérer, pas de nouvelle organisation de dossiers à maintenir.
//
// Appelée uniquement par /api/clients/guest.ts (action "upload-document"),
// qui a déjà vérifié que l'appelant est bien le client invité propriétaire
// de la fiche (client_guest_access). Authentifiée en interne avec le même
// secret partagé que send-system-email — jamais exposée directement au
// navigateur.
const SYLVAIN_USER_ID = "4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getOrCreateDriveFolder(token: string, folderName: string, parentId?: string): Promise<string> {
  const query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false ${
    parentId ? `and '${parentId}' in parents` : ""
  }`;
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (listRes.ok) {
    const listData = await listRes.json();
    if (listData.files && listData.files.length > 0) return listData.files[0].id;
  }
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createRes.ok) throw new Error(`Impossible de créer le dossier Drive "${folderName}".`);
  const created = await createRes.json();
  return created.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTIONS_SECRET")!;

    const providedSecret = req.headers.get("x-internal-secret") || "";
    if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
      return json({ error: "forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const leadId: string = String(body.leadId || "").trim();
    const userId: string = String(body.userId || "").trim();
    const fileName: string = String(body.fileName || "").trim();
    const mimeType: string = String(body.mimeType || "application/octet-stream");
    const fileBase64: string = String(body.fileBase64 || "");
    const category: string = String(body.category || "").trim();
    const requestId: string = String(body.requestId || "").trim();
    if (!leadId || !userId || !fileName || !fileBase64) {
      return json({ error: "leadId, userId, fileName et fileBase64 sont requis." }, 400);
    }
    // ~7MB de base64 ≈ 5MB de fichier réel — garde-fou avant l'upload Drive
    // (la limite réelle de taille de requête est déjà appliquée en amont,
    // côté Vercel, mais on protège aussi cette fonction si elle est rappelée
    // autrement un jour).
    if (fileBase64.length > 7_000_000) {
      return json({ error: "Fichier trop volumineux (5 Mo maximum)." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Re-vérifie l'appartenance (défense en profondeur — l'appelant l'a déjà
    // fait, mais cette fonction ne doit jamais faire confiance aveuglément).
    const { data: access } = await admin
      .from("client_guest_access")
      .select("status")
      .eq("lead_id", leadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!access || !["active", "envoyee"].includes((access as any).status)) {
      return json({ error: "Accès non autorisé à cette fiche." }, 403);
    }

    const { data: lead } = await admin
      .from("leads")
      .select("agency_id, assigned_to, full_name, first_name, last_name")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return json({ error: "Fiche introuvable." }, 404);

    const { data: agency } = await admin.from("agencies").select("name").eq("id", (lead as any).agency_id).maybeSingle();
    const agencyName = (agency as any)?.name || "Nova CRM";

    const tokenInfo = await getValidUserGoogleToken(admin, SYLVAIN_USER_ID);
    if (!tokenInfo) return json({ error: "Compte Google de Sylvain non connecté ou jeton invalide." }, 200);

    const rootFolderId = await getOrCreateDriveFolder(tokenInfo.token, "NovaSphere CRM");
    const documentsFolderId = await getOrCreateDriveFolder(tokenInfo.token, "Documents", rootFolderId);
    const agencyFolderId = await getOrCreateDriveFolder(tokenInfo.token, agencyName, documentsFolderId);

    const finalName = category ? `${category} — ${fileName}` : fileName;
    const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));

    const metadata = { name: finalName, mimeType, parents: [agencyFolderId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([bytes], { type: mimeType }), finalName);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      { method: "POST", headers: { Authorization: `Bearer ${tokenInfo.token}` }, body: form },
    );
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("upload-client-document Drive error:", errText);
      return json({ error: "Échec de l'envoi vers Drive." }, 200);
    }
    const uploadData = await uploadRes.json();

    const now = new Date().toISOString();
    const { data: docRow, error: docErr } = await admin.from("documents").insert({
      agency_id: (lead as any).agency_id,
      lead_id: leadId,
      uploaded_by: userId,
      file_name: finalName,
      mime_type: mimeType,
      size_bytes: bytes.length,
      drive_file_id: uploadData.id,
      drive_web_view_link: uploadData.webViewLink || `https://drive.google.com/file/d/${uploadData.id}/preview`,
      is_folder: false,
      is_shared: false,
      created_at: now,
    }).select("id").single();
    if (docErr || !docRow) {
      console.error("upload-client-document insert error:", docErr);
      return json({ error: "Document envoyé sur Drive mais non enregistré sur la fiche." }, 200);
    }

    // Si ce document répond à une demande du conseiller, la fait passer à
    // "reçu" (jamais fait directement par le client — cf. policy dédiée).
    if (requestId) {
      const { data: reqRow } = await admin
        .from("document_requests")
        .select("id")
        .eq("id", requestId)
        .eq("lead_id", leadId)
        .in("status", ["demande", "consulte"])
        .maybeSingle();
      if (reqRow) {
        await admin
          .from("document_requests")
          .update({ status: "recu", document_id: (docRow as any).id, updated_at: now })
          .eq("id", requestId);
      }
    }

    // Prévient le conseiller assigné (best-effort).
    if ((lead as any).assigned_to) {
      const clientName = (lead as any).full_name || `${(lead as any).first_name || ""} ${(lead as any).last_name || ""}`.trim() || "un client";
      await admin.from("notifications").insert({
        user_id: (lead as any).assigned_to,
        type: "client_document",
        title: `📎 Document de ${clientName}`,
        body: category ? `${category} — ${fileName}` : fileName,
        link: `/clients/${leadId}`,
        entity_type: "lead",
        entity_id: leadId,
        is_read: false,
        agency_id: (lead as any).agency_id,
        created_at: now,
      }).then(({ error }) => { if (error) console.warn("upload-client-document notify error:", error); });
    }

    return json({ ok: true, fileUrl: uploadData.webViewLink, fileId: uploadData.id });
  } catch (err) {
    console.error("upload-client-document error:", err);
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return json({ error: msg }, 500);
  }
});
