import React from 'react';
import { useAppUpdateStatus } from '@/lib/updateStatus';

interface UpdateStatusBadgeProps {
  className?: string;
  showDetails?: boolean;
}

/**
 * Badge d'état de mise à jour tout en haut :
 * - VERT quand la dernière mise à jour est bien appliquée
 * - ORANGE quand une nouvelle mise à jour est prête / en attente d'application
 */
export const UpdateStatusBadge: React.FC<UpdateStatusBadgeProps> = ({ className = '', showDetails = false }) => {
  const { isUpdatePending, bootVersion } = useAppUpdateStatus();

  const sha = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.sha : bootVersion?.slice(0, 7);

  if (isUpdatePending) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all duration-300 bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)] select-none shrink-0 ${className}`}
        title="Une mise à jour a été déployée. Elle s'appliquera automatiquement dès que vous changerez d'onglet ou de fenêtre."
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span className="tracking-wide">Mise à jour : En attente</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all duration-300 bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)] select-none shrink-0 ${className}`}
      title="Votre application tourne sur la dernière version déployée."
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
      </span>
      <span className="tracking-wide">Mise à jour : Appliquée</span>
      {sha && showDetails && (
        <span className="text-[10px] font-mono text-emerald-400/70 border-l border-emerald-500/30 pl-1.5 ml-0.5">
          {sha}
        </span>
      )}
    </div>
  );
};

export default UpdateStatusBadge;
