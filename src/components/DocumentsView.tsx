import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  CheckCircle2, ChevronLeft, Download, Eye, ExternalLink, File, FileText, Folder,
  Loader2, RefreshCw, Table, Trash2, Upload, Users, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useContacts } from '@/hooks/useContacts';
import {
  createGoogleSheetWithData, deleteDriveFile, getCachedAccessToken, requestWorkspaceAccessToken,
} from '@/lib/workspace';
import { uploadDocumentToDrive } from '@/lib/documentDrive';

interface StoredDocument {
  id: string;
  type: 'file' | 'google_sheet';
  name: string;
  size: string;
  mimeType?: string;
  url: string;
  downloadUrl?: string;
  driveFileId: string;
  driveFolderName?: string;
  rowCount?: number;
  agencyId: string;
  leadId: string | null;
  uploadedByUserId: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

// Table réelle `documents` — le code précédent lisait/écrivait une table
// `client_documents` qui n'existe pas côté Supabase (toujours 0 résultat,
// tous les inserts échouaient silencieusement). `documents` a en plus un
// vrai lien client (`lead_id`), utilisé ici pour classer les documents par
// dossier client.
interface DocumentRow {
  id: string;
  agency_id: string | null;
  lead_id: string | null;
  uploaded_by: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  created_at: string;
}

const SAMPLE_CLIENT_EXPORT_DATA = {
  headers: ['Nom du Client', 'Statut Prêt', 'Montant Mandat (€)', 'Banque Partenaire', 'Conseiller'],
  rows: [
    ['Jean Dupont', 'Accord de principe', '350 000', 'BNP Paribas', 'Sylvain Grazia'],
    ['Marie Curie', 'Dossier transmis', '520 000', 'Société Générale', 'Sophie Bertrand'],
    ['Pierre Loti', 'Offre émise', '280 000', 'LCL Bordeaux', 'Sylvain Grazia'],
    ['Claire Chazal', 'Visite programmée', '410 000', 'Crédit Agricole', 'Lucas Martin'],
  ],
};

function formatFileSize(bytes: number) {
  if (!bytes) return '0 Ko';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} Ko`;
  return `${(kb / 1024).toFixed(1)} Mo`;
}

export const DocumentsView: React.FC = () => {
  const { activeAgency, currentUser, userProfile } = useAuth();
  const { contacts } = useContacts();

  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Navigation "par client" : null = liste des dossiers clients, sinon id du client ouvert.
  const [currentLeadId, setCurrentLeadId] = useState<string | null>(null);
  const [pendingUploadLeadId, setPendingUploadLeadId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsAudio, setPreviewIsAudio] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = async () => {
    if (!currentUser) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: sbErr } = await supabase.from('documents').select('*').eq('is_folder', false);
      if (sbErr) throw sbErr;

      const loaded: StoredDocument[] = ((data as DocumentRow[]) || []).map((item) => {
        const isSheet = item.mime_type === 'application/vnd.google-apps.spreadsheet';
        return {
          id: item.id,
          type: isSheet ? 'google_sheet' : 'file',
          name: item.file_name || 'Document',
          agencyId: item.agency_id || 'all',
          leadId: item.lead_id,
          size: item.size_bytes ? formatFileSize(item.size_bytes) : 'N/A',
          mimeType: item.mime_type || 'application/octet-stream',
          uploadedByUserId: item.uploaded_by || '',
          uploadedByName: 'Collaborateur',
          createdAt: item.created_at || new Date().toISOString(),
          updatedAt: item.created_at || new Date().toISOString(),
          url: item.drive_web_view_link || '#',
          driveFileId: item.drive_file_id || '',
        };
      });

      setDocuments(loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (err) {
      console.error('Erreur chargement documents :', err);
      setError('Impossible de charger les documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const visibleDocuments = useMemo(() => {
    if (activeAgency.id === 'all') return documents;
    return documents.filter((d) => d.agencyId === activeAgency.id);
  }, [documents, activeAgency.id]);

  const googleSheets = visibleDocuments.filter((d) => d.type === 'google_sheet');
  const files = visibleDocuments.filter((d) => d.type === 'file');

  // Regroupement des fichiers par client (lead_id) — "dossiers" façon coffre.
  const clientIdsWithDocs = useMemo(
    () => Array.from(new Set(files.filter((f) => f.leadId).map((f) => f.leadId as string))),
    [files]
  );
  const unfiledFiles = files.filter((f) => !f.leadId);
  const contactName = (leadId: string) => contacts.find((c) => c.id === leadId)?.name || 'Client';
  const currentClientName = currentLeadId ? contactName(currentLeadId) : null;

  const getGoogleToken = async () => {
    let token = getCachedAccessToken();
    if (!token) token = await requestWorkspaceAccessToken();
    return token;
  };

  const handleCreateGoogleSheet = async () => {
    if (!currentUser) return;
    if (activeAgency.id === 'all') {
      setError("Sélectionnez une structure avant de créer un Google Sheet.");
      return;
    }

    setExporting(true);
    setStatusMessage(null);
    setError(null);

    try {
      const token = await getGoogleToken();
      const date = new Date().toISOString().split('T')[0];
      const title = `Export_CRM_NovaSphere_${activeAgency.name}_${date}`;
      const result = await createGoogleSheetWithData(token, title, SAMPLE_CLIENT_EXPORT_DATA.headers, SAMPLE_CLIENT_EXPORT_DATA.rows);
      const now = new Date().toISOString();

      const { error: insErr } = await supabase.from('documents').insert({
        agency_id: activeAgency.id,
        uploaded_by: currentUser.uid,
        file_name: title,
        mime_type: 'application/vnd.google-apps.spreadsheet',
        drive_web_view_link: result.spreadsheetUrl,
        drive_file_id: result.spreadsheetId,
        is_folder: false,
        created_at: now,
      });
      if (insErr) throw insErr;

      setStatusMessage('Google Sheet créé et enregistré dans Nova CRM.');
      await loadDocuments();
    } catch (exportError) {
      console.error(exportError);
      setError((exportError as Error).message || 'Erreur lors de la création du Google Sheet.');
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const targetLeadId = pendingUploadLeadId;
    event.target.value = '';
    setPendingUploadLeadId(null);

    if (!file || !currentUser) return;
    if (activeAgency.id === 'all') {
      setError("Sélectionnez une structure avant de déposer un document.");
      return;
    }

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('Le fichier dépasse la limite de 50 Mo.');
      return;
    }

    setUploading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const token = await getGoogleToken();
      const upload = await uploadDocumentToDrive(token, file, activeAgency.name, currentUser.email);
      const now = new Date().toISOString();

      const { error: insErr } = await supabase.from('documents').insert({
        agency_id: activeAgency.id,
        lead_id: targetLeadId,
        uploaded_by: currentUser.uid,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        drive_web_view_link: upload.fileUrl,
        drive_file_id: upload.fileId,
        is_folder: false,
        created_at: now,
      });
      if (insErr) throw insErr;

      setStatusMessage(`${file.name} a été déposé dans Google Drive et enregistré dans Nova CRM.`);
      await loadDocuments();
    } catch (uploadError) {
      console.error(uploadError);
      setError((uploadError as Error).message || "Erreur lors de l'envoi du document.");
    } finally {
      setUploading(false);
    }
  };

  const startUpload = (leadId: string | null) => {
    setPendingUploadLeadId(leadId);
    fileInputRef.current?.click();
  };

  const canDelete = (doc: StoredDocument) =>
    userProfile?.role === 'super_admin' || doc.uploadedByUserId === currentUser?.uid;

  const handleDelete = async (documentItem: StoredDocument) => {
    if (!currentUser || !canDelete(documentItem)) {
      setError("Seul le créateur du document ou le Super Admin peut le supprimer.");
      return;
    }
    if (!window.confirm(`Supprimer "${documentItem.name}" de Nova CRM et de Google Drive ?`)) return;

    setDeletingId(documentItem.id);
    setError(null);
    setStatusMessage(null);

    try {
      const token = await getGoogleToken();
      if (documentItem.driveFileId) {
        await deleteDriveFile(token, documentItem.driveFileId);
      }
      const { error: delErr } = await supabase.from('documents').delete().eq('id', documentItem.id);
      if (delErr) throw delErr;

      setStatusMessage('Document supprimé.');
      await loadDocuments();
    } catch (deleteError) {
      console.error(deleteError);
      setError("Impossible de supprimer complètement le document.");
    } finally {
      setDeletingId(null);
    }
  };

  const renderDocRow = (documentItem: StoredDocument) => (
    <div
      key={documentItem.id}
      // Signalé (mode jour) : "on ne voit rien" dans le Coffre Documents.
      // `bg-white/5` n'est pas une surface mais un voile translucide : au-
      // dessus de la photo de fond, le nom du fichier et sa taille étaient
      // écrits à même l'image. `.nv-panel` = vrai fond de carte (index.css).
      className="p-4 nv-panel border border-white/10 rounded-2xl flex items-center justify-between gap-4 hover:border-[#F7BC5F]/40 transition-all"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2.5 rounded-xl bg-[#F7BC5F]/20 text-[#F9C977] shrink-0">
          <File className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-white text-sm truncate">{documentItem.name}</h3>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400 mt-1">
            <span>{documentItem.size}</span>
            <span>Déposé par {documentItem.uploadedByName}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Ticket #18 (nouvelle base) : l'aperçu (icône œil) était réservé aux
            images et audios — la modale gère déjà tout document Google Drive
            via une iframe (/preview), donc on l'ouvre à tous les types. */}
        <button
          type="button"
          onClick={() => {
            setPreviewIsAudio(!!documentItem.mimeType?.startsWith('audio/'));
            setPreviewUrl(documentItem.url);
          }}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer"
          title="Aperçu"
        >
          <Eye className="w-4 h-4" />
        </button>
        <a
          href={documentItem.downloadUrl || documentItem.url}
          target="_blank" rel="noreferrer"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
          title="Ouvrir / télécharger"
        >
          <Download className="w-4 h-4" />
        </a>
        <a
          href={documentItem.url}
          target="_blank" rel="noreferrer"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
          title="Ouvrir dans Google Drive"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        {canDelete(documentItem) && (
          <button
            onClick={() => void handleDelete(documentItem)}
            disabled={deletingId === documentItem.id}
            className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
            title="Supprimer"
          >
            {deletingId === documentItem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      {/* HEADER — carte opaque dédiée (pas toute la page, voir RappelsView.tsx) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#050f11] rounded-2xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            {currentLeadId ? (
              <button
                onClick={() => setCurrentLeadId(null)}
                className="flex items-center gap-1.5 text-sm font-bold text-white hover:text-emerald-400 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {currentClientName}
              </button>
            ) : (
              <h1 className="text-xl font-bold text-white">Coffre Documents</h1>
            )}
            <p className="text-xs text-gray-400">Documents classés par client, plus Google Sheets et exports partagés.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateGoogleSheet}
            disabled={exporting || uploading}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-md disabled:opacity-50"
          >
            {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Table className="w-4 h-4" />}
            <span>Exporter vers Google Sheets</span>
          </button>

          <button
            onClick={() => startUpload(currentLeadId)}
            disabled={uploading || exporting}
            className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>{uploading ? 'Envoi...' : currentLeadId ? `Déposer pour ${currentClientName}` : 'Déposer un document'}</span>
          </button>

          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
        </div>
      </div>

      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" />{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-emerald-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center nv-panel border border-white/10 rounded-2xl text-gray-400">
          <Loader2 className="w-7 h-7 animate-spin mx-auto mb-3" />
          Chargement des documents...
        </div>
      ) : currentLeadId ? (
        // DOCUMENTS D'UN CLIENT
        <div className="space-y-3">
          {files.filter((f) => f.leadId === currentLeadId).length === 0 ? (
            <div className="p-8 rounded-2xl nv-panel border border-dashed border-white/10 text-center text-xs text-gray-500">
              Aucun document pour ce client pour le moment.
            </div>
          ) : (
            <div className="space-y-3">
              {files.filter((f) => f.leadId === currentLeadId).map(renderDocRow)}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* GOOGLE SHEETS */}
          <div className="space-y-3">
            {/* Demande explicite (30/08/2026) : "mets des fonds car on ne
                voit pas les textes" — ces libellés de section n'avaient
                aucun fond propre, la photo de la page passait à travers. */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0a1e20]/95 border border-white/10 w-fit">
              <Table className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Feuilles Google Sheets</h2>
            </div>
            {googleSheets.length === 0 ? (
              <div className="p-6 rounded-2xl nv-panel border border-dashed border-emerald-500/20 text-xs text-gray-500">
                Aucun Google Sheet enregistré pour cette structure.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {googleSheets.map((sheet) => (
                  <div key={sheet.id} className="p-4 nv-panel border border-emerald-500/20 rounded-2xl flex items-center justify-between gap-4 hover:border-emerald-500/40 transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0"><Table className="w-5 h-5" /></div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-white text-xs sm:text-sm truncate">{sheet.name}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400 mt-1">
                          <span className="text-emerald-400 font-medium">Google Sheets</span>
                          <span>• {new Date(sheet.createdAt).toLocaleDateString('fr-FR')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a href={sheet.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 border border-emerald-500/30">
                        Ouvrir <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      {canDelete(sheet) && (
                        <button onClick={() => void handleDelete(sheet)} disabled={deletingId === sheet.id} className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 disabled:opacity-50">
                          {deletingId === sheet.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DOSSIERS CLIENTS */}
          <div className="space-y-3 pt-4">
            {/* Demande explicite (30/08/2026) : "mets des fonds car on ne
                voit pas les textes" — ces libellés de section n'avaient
                aucun fond propre, la photo de la page passait à travers. */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0a1e20]/95 border border-white/10 w-fit">
              <Users className="w-4 h-4 text-[#F9C977]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Documents par client</h2>
            </div>
            {clientIdsWithDocs.length === 0 ? (
              <div className="p-6 rounded-2xl nv-panel border border-dashed border-white/10 text-xs text-gray-500">
                Aucun document déposé pour un client pour le moment.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {clientIdsWithDocs.map((leadId) => (
                  <div
                    key={leadId}
                    onClick={() => setCurrentLeadId(leadId)}
                    className="p-4 bg-[#07191b] border border-[#144447] rounded-2xl hover:border-[#F7BC5F]/40 transition-all cursor-pointer"
                  >
                    <Folder className="w-6 h-6 text-[#F9C977] mb-2" />
                    <p className="text-xs font-bold text-white truncate">{contactName(leadId)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{files.filter((f) => f.leadId === leadId).length} document(s)</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DOCUMENTS GÉNÉRAUX (non liés à un client) */}
          <div className="space-y-3 pt-4">
            {/* Demande explicite (30/08/2026) : "mets des fonds car on ne
                voit pas les textes" — ces libellés de section n'avaient
                aucun fond propre, la photo de la page passait à travers. */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0a1e20]/95 border border-white/10 w-fit">
              <File className="w-4 h-4 text-[#F9C977]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Documents généraux</h2>
            </div>
            {unfiledFiles.length === 0 ? (
              <div className="p-8 rounded-2xl nv-panel border border-dashed border-white/10 text-center text-xs text-gray-500">
                Aucun document déposé pour cette structure.
              </div>
            ) : (
              <div className="space-y-3">{unfiledFiles.map(renderDocRow)}</div>
            )}
          </div>
        </>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-6"
          onClick={() => setPreviewUrl(null)}
        >
          {/* Signalé : la croix était positionnée trop haut en haut à
              droite (trop proche du bord de l'écran) — redescendue. */}
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute right-6 text-white/70 hover:text-white p-2 rounded-lg hover:bg-white/10 z-10" style={{ top: 'calc(5rem + env(safe-area-inset-top, 0px))' }}
          >
            <X className="w-6 h-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl w-full max-h-[85vh] flex items-center justify-center">
            {previewIsAudio ? (
              <audio src={previewUrl} controls autoPlay className="w-full" />
            ) : previewUrl.includes('drive.google.com') ? (
              <iframe
                src={previewUrl.replace('/view', '/preview')}
                className="w-full h-[80vh] rounded-xl shadow-2xl border-0"
                allow="autoplay"
              />
            ) : (
              <img src={previewUrl} alt="Aperçu" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsView;
