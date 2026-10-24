import React, { useState } from 'react';
import { Database, Upload, Check, FileText, Sparkles, X, MessageSquare, CheckSquare, StickyNote, Users, TrendingUp, Building2 } from 'lucide-react';
import { parseSqlInsertDump, ParsedSqlData } from '../utils/sqlParser';
import { saveImportedStorage } from '../utils/importedDataManager';
import { AGENCIES } from '../types';

interface SqlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SqlImportModal({ isOpen, onClose }: SqlImportModalProps) {
  const [sqlContent, setSqlContent] = useState('');
  const [targetAgencyId, setTargetAgencyId] = useState<string>('auto');
  const [parsedData, setParsedData] = useState<ParsedSqlData | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  if (!isOpen) return null;

  const handleParse = (text: string, agencyId: string = targetAgencyId) => {
    setSqlContent(text);
    setImportSuccess(false);
    if (!text.trim()) {
      setParsedData(null);
      return;
    }
    try {
      const res = parseSqlInsertDump(text, agencyId);
      setParsedData(res);
    } catch (err) {
      console.error("SQL parsing error:", err);
    }
  };

  const handleAgencyChange = (agencyId: string) => {
    setTargetAgencyId(agencyId);
    if (sqlContent.trim()) {
      handleParse(sqlContent, agencyId);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        handleParse(text);
      };
      reader.readAsText(file);
    }
  };

  const handleExecuteImport = async () => {
    if (!parsedData) return;
    const totalItems = parsedData.contacts.length + parsedData.deals.length + parsedData.tasks.length + parsedData.notes.length + parsedData.messages.length;
    if (totalItems === 0) return;

    setIsImporting(true);

    try {
      saveImportedStorage({
        contacts: parsedData.contacts,
        deals: parsedData.deals,
        tasks: parsedData.tasks,
        notes: parsedData.notes,
        messages: parsedData.messages,
      });

      setImportSuccess(true);
    } catch (err) {
      console.error("Error during import:", err);
    } finally {
      setIsImporting(false);
    }
  };

  const totalParsed = parsedData ? (parsedData.contacts.length + parsedData.deals.length + parsedData.tasks.length + parsedData.notes.length + parsedData.messages.length) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#0b171f] border border-[#1e2f3d] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-[#1e2f3d] flex items-center justify-between bg-[#0e1d28]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#E5B842]/10 border border-[#E5B842]/30 flex items-center justify-center text-[#E5B842]">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Importateur de Données Lovable / Supabase (SQL)
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#E5B842]/20 text-[#E5B842] border border-[#E5B842]/30 font-normal">
                  PostgreSQL
                </span>
              </h3>
              <p className="text-xs text-gray-400">
                Intégrez instantanément vos clients, messages, notes, tâches et opportunités issus de Lovable.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 custom-scrollbar">
          {importSuccess && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-3 animate-in zoom-in-95 duration-200">
              <Check className="w-5 h-5 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-sm">Données intégrées avec succès dans votre CRM !</p>
                <p className="text-xs opacity-90 mt-0.5">
                  {parsedData?.contacts.length || 0} client(s), {parsedData?.deals.length || 0} opportunité(s), {parsedData?.tasks.length || 0} tâche(s), {parsedData?.notes.length || 0} note(s) et {parsedData?.messages.length || 0} message(s) sont désormais visibles.
                </p>
              </div>
            </div>
          )}

          {/* Target Company Selector */}
          <div className="bg-[#071015] border border-[#1e2f3d] rounded-xl p-3.5 space-y-2">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-[#E5B842]" />
              Société / Agence de destination des données
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleAgencyChange('auto')}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left flex flex-col ${
                  targetAgencyId === 'auto'
                    ? 'bg-[#E5B842]/20 border-[#E5B842] text-[#E5B842] font-bold'
                    : 'bg-[#0f212e] border-[#1e2f3d] text-gray-400 hover:text-white'
                }`}
              >
                <span>Automatique</span>
                <span className="text-[10px] opacity-75 font-normal">Détecter dans SQL</span>
              </button>
              {AGENCIES.filter(a => a.id !== 'all').map((agency) => (
                <button
                  type="button"
                  key={agency.id}
                  onClick={() => handleAgencyChange(agency.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left flex flex-col ${
                    targetAgencyId === agency.id
                      ? 'bg-[#E5B842]/20 border-[#E5B842] text-[#E5B842] font-bold'
                      : 'bg-[#0f212e] border-[#1e2f3d] text-gray-400 hover:text-white'
                  }`}
                >
                  <span className="truncate">{agency.name}</span>
                  <span className="text-[10px] opacity-75 font-normal">{agency.city}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Text Area Input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#E5B842]" />
                Script SQL / Dump Lovable
              </label>
              <label className="text-xs text-[#E5B842] hover:underline cursor-pointer flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                Charger un fichier (.sql, .txt)
                <input
                  type="file"
                  accept=".sql,.txt,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            </div>
            <textarea
              value={sqlContent}
              onChange={(e) => handleParse(e.target.value)}
              placeholder="Collez ici votre dump SQL Lovable (INSERT INTO leads..., INSERT INTO notes..., INSERT INTO tasks..., INSERT INTO messages...)"
              className="w-full h-44 bg-[#071015] border border-[#1e2f3d] rounded-xl p-3.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-[#E5B842] focus:ring-1 focus:ring-[#E5B842] transition-colors resize-none custom-scrollbar"
            />
          </div>

          {/* Parsed Stats Banner */}
          {parsedData && (
            <div className="bg-[#071015] border border-[#1e2f3d] rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="p-2.5 rounded-lg bg-[#0f212e] border border-[#1e2f3d]/60 flex flex-col">
                <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-medium uppercase tracking-wider mb-1">
                  <Users className="w-3 h-3 text-[#E5B842]" />
                  Clients
                </div>
                <p className="text-lg font-bold text-[#E5B842]">{parsedData.contacts.length}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0f212e] border border-[#1e2f3d]/60 flex flex-col">
                <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-medium uppercase tracking-wider mb-1">
                  <TrendingUp className="w-3 h-3 text-blue-400" />
                  Affaires
                </div>
                <p className="text-lg font-bold text-blue-400">{parsedData.deals.length}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0f212e] border border-[#1e2f3d]/60 flex flex-col">
                <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-medium uppercase tracking-wider mb-1">
                  <CheckSquare className="w-3 h-3 text-emerald-400" />
                  Tâches
                </div>
                <p className="text-lg font-bold text-emerald-400">{parsedData.tasks.length}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0f212e] border border-[#1e2f3d]/60 flex flex-col">
                <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-medium uppercase tracking-wider mb-1">
                  <StickyNote className="w-3 h-3 text-amber-400" />
                  Notes
                </div>
                <p className="text-lg font-bold text-amber-400">{parsedData.notes.length}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0f212e] border border-[#1e2f3d]/60 flex flex-col">
                <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-medium uppercase tracking-wider mb-1">
                  <MessageSquare className="w-3 h-3 text-purple-400" />
                  Messages
                </div>
                <p className="text-lg font-bold text-purple-400">{parsedData.messages.length}</p>
              </div>
            </div>
          )}

          {/* Instructions note */}
          <div className="p-3.5 rounded-xl bg-blue-500/5 border border-blue-500/20 text-blue-300/80 text-xs flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              Vous pouvez coller n&apos;importe quel extrait de votre base Lovable ou Supabase. Les clients, opportunités, tâches, notes et messages seront enregistrés de manière permanente et instantanée dans votre CRM.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1e2f3d] bg-[#0e1d28] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            Fermer
          </button>
          <button
            onClick={handleExecuteImport}
            disabled={!parsedData || totalParsed === 0 || isImporting}
            className={`px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              !parsedData || totalParsed === 0 || isImporting
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-[#E5B842] text-gray-900 hover:bg-[#f0c44d] shadow-lg shadow-[#E5B842]/20 active:scale-95'
            }`}
          >
            {isImporting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                Intégration en cours...
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                Intégrer toutes les données ({totalParsed})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
