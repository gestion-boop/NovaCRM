import React, { useState } from 'react';
import { FileText, Upload, Download, Trash2, File, Table, Plus, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react';
import { DocItem } from '@/types';
import {
  createGoogleSheetWithData,
  getCachedAccessToken,
  requestWorkspaceAccessToken,
} from '@/lib/workspace';

interface GoogleSheetDoc {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  rowCount: number;
}

const INITIAL_DOCS: DocItem[] = [];

const SAMPLE_CLIENT_EXPORT_DATA = {
  headers: ['Nom du Client', 'Statut Prêt', 'Montant Mandat (€)', 'Banque Partenaire', 'Conseiller'],
  rows: [
    ['Jean Dupont', 'Accord de principe', '350 000', 'BNP Paribas', 'Sylvain Grazia'],
    ['Marie Curie', 'Dossier transmis', '520 000', 'Société Générale', 'Sophie Bertrand'],
    ['Pierre Loti', 'Offre émise', '280 000', 'LCL Bordeaux', 'Sylvain Grazia'],
    ['Claire Chazal', 'Visite programmée', '410 000', 'Crédit Agricole', 'Lucas Martin'],
  ],
};

export const DocumentsView: React.FC = () => {
  const [docs, setDocs] = useState<DocItem[]>(INITIAL_DOCS);
  const [googleSheets, setGoogleSheets] = useState<GoogleSheetDoc[]>([
    {
      id: 'gs-1',
      title: 'Suivi_Dossiers_Courtage_Consolidé_2026',
      url: 'https://docs.google.com/spreadsheets',
      createdAt: '2026-08-05',
      rowCount: 12,
    },
  ]);
  const [exporting, setExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleCreateGoogleSheet = async () => {
    setExporting(true);
    setStatusMessage(null);
    try {
      let token = getCachedAccessToken();
      if (!token) {
        token = await requestWorkspaceAccessToken();
      }

      const title = `Export_CRM_Novasphere_${new Date().toISOString().split('T')[0]}`;
      const result = await createGoogleSheetWithData(
        token,
        title,
        SAMPLE_CLIENT_EXPORT_DATA.headers,
        SAMPLE_CLIENT_EXPORT_DATA.rows
      );

      const newSheet: GoogleSheetDoc = {
        id: result.spreadsheetId,
        title,
        url: result.spreadsheetUrl,
        createdAt: new Date().toLocaleDateString('fr-FR'),
        rowCount: SAMPLE_CLIENT_EXPORT_DATA.rows.length + 1,
      };

      setGoogleSheets([newSheet, ...googleSheets]);
      setStatusMessage(`Feuille Google Sheets créée avec succès ! [Voir le document](${result.spreadsheetUrl})`);
    } catch (err: unknown) {
      console.error(err);
      setStatusMessage((err as Error).message || 'Erreur lors de la création du fichier Google Sheets');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Documents & Google Sheets</h1>
            <p className="text-xs text-gray-400">Gestion des contrats, tableurs Google Sheets partagés et coffre-fort</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateGoogleSheet}
            disabled={exporting}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-md"
          >
            {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Table className="w-4 h-4" />}
            <span>Exporter vers Google Sheets</span>
          </button>

          <button className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2">
            <Upload className="w-4 h-4" />
            <span>Déposer un document</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-emerald-400 hover:text-white font-bold">✕</button>
        </div>
      )}

      {/* Google Sheets Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Table className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Feuilles de Calcul Google Sheets Partagées</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {googleSheets.map((gs) => (
            <div key={gs.id} className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl flex items-center justify-between gap-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-xs sm:text-sm">{gs.title}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-1">
                    <span className="text-emerald-400 font-medium">Google Sheets</span>
                    <span>• {gs.rowCount} lignes</span>
                    <span>• Créé le {gs.createdAt}</span>
                  </div>
                </div>
              </div>

              <a
                href={gs.url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 border border-emerald-500/30 shrink-0"
              >
                <span>Ouvrir</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Local Documents Vault Section */}
      <div className="space-y-3 pt-4">
        <div className="flex items-center gap-2 px-1">
          <File className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Fichiers & Modèles de Contrats</h2>
        </div>

        <div className="space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between gap-4 hover:border-white/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
                  <File className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">{doc.name}</h3>
                  <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1">
                    <span className="text-[#E5B842] bg-[#E5B842]/10 px-2 py-0.5 rounded font-medium">{doc.category}</span>
                    <span>Taille: {doc.size}</span>
                    <span>Mis à jour le {doc.updatedAt} par {doc.uploadedBy}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors" title="Télécharger">
                  <Download className="w-4 h-4" />
                </button>
                <button className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Supprimer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
export default DocumentsView;

