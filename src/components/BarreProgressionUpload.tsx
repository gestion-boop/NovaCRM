import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Barre de progression de l'envoi d'une vidéo (alimentée par
// uploadVideoToDriveFolder via l'évènement novasphere:upload-progress).
export const BarreProgressionUpload: React.FC = () => {
  const [etat, setEtat] = useState<{ pct: number; nom?: string } | null>(null);
  useEffect(() => {
    const ecouter = (e: Event) => {
      const d = (e as CustomEvent<{ actif: boolean; pct?: number; nom?: string }>).detail;
      setEtat(d?.actif ? { pct: d.pct ?? 0, nom: d.nom } : null);
    };
    window.addEventListener('novasphere:upload-progress', ecouter);
    return () => window.removeEventListener('novasphere:upload-progress', ecouter);
  }, []);
  if (!etat) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-28 z-[150] w-[min(92vw,420px)] rounded-2xl bg-[#0b1c1e]/95 backdrop-blur-xl border border-[#F7BC5F]/50 shadow-[0_14px_30px_-6px_rgba(0,0,0,0.9)] px-4 py-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2 mb-2">
        <Loader2 className="w-4 h-4 text-[#F7BC5F] animate-spin shrink-0" />
        <p className="text-xs font-bold text-white truncate flex-1">Envoi de la vidéo{etat.nom ? ` · ${etat.nom}` : ''}</p>
        <span className="text-xs font-black text-[#F7BC5F] tabular-nums">{etat.pct} %</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] transition-all duration-200" style={{ width: `${etat.pct}%` }} />
      </div>
    </div>
  );
};

export default BarreProgressionUpload;
