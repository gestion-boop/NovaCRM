import React from 'react';
import { useAppUpdateStatus, applyUpdateOnNavigation, formatBuildDate, fetchServerVersion, setServerVersion } from '@/lib/updateStatus';
import { toast } from 'sonner';

interface UpdateStatusBadgeProps {
  className?: string;
  showDetails?: boolean;
  onlyWhenPending?: boolean;
}

/**
 * Badge d'état de mise à jour :
 * - VERT quand la dernière mise à jour est bien appliquée, avec date et heure de déploiement
 * - ORANGE quand une nouvelle mise à jour est prête / en attente d'application
 * - Si onlyWhenPending est activé : ne s'affiche que s'il y a une mise à jour en attente (masqué sinon)
 */
export const UpdateStatusBadge: React.FC<UpdateStatusBadgeProps> = ({
  className = '',
  showDetails = false,
  onlyWhenPending = false,
}) => {
  const { isUpdatePending, bootVersion } = useAppUpdateStatus();

  if (onlyWhenPending && !isUpdatePending) {
    return null;
  }

  const sha = typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__.sha !== 'inconnu'
    ? __BUILD_INFO__.sha
    : bootVersion?.slice(0, 7);
  const buildDateShort = formatBuildDate({ withYear: false });
  const buildDateFull = formatBuildDate({ withYear: true, withSha: true });

  const handleManualCheck = async () => {
    toast.loading('Vérification des mises à jour...', { id: 'manual-update-check' });
    try {
      const v = await fetchServerVersion();
      if (v) {
        setServerVersion(v);
        if (v.sha && sha && v.sha !== sha) {
          toast.success('Une nouvelle mise à jour est disponible !', { id: 'manual-update-check' });
        } else {
          toast.success(`Votre version est à jour (${buildDateShort || 'déployée'})`, { id: 'manual-update-check' });
        }
      } else {
        toast.success(`Votre version est à jour (${buildDateShort || 'déployée'})`, { id: 'manual-update-check' });
      }
    } catch {
      toast.dismiss('manual-update-check');
    }
  };

  if (isUpdatePending) {
    // Si une mise à jour est en attente, le voyant orange doit TOUJOURS être visible
    const pendingClass = className.replace(/\bhidden\b/g, '').trim();
    return (
      <button
        type="button"
        onClick={() => {
          if (!applyUpdateOnNavigation({})) {
            window.location.reload();
          }
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all duration-300 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 shadow-[0_0_14px_rgba(245,158,11,0.35)] select-none shrink-0 cursor-pointer ${pendingClass}`}
        title="Une nouvelle mise à jour a été déployée ! Cliquez ici pour l'appliquer immédiatement."
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span className="tracking-wide">Mise à jour disponible</span>
        <span className="text-[10px] text-amber-200/90 font-semibold underline underline-offset-2 ml-0.5">
          Appliquer
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleManualCheck}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all duration-300 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)] select-none shrink-0 cursor-pointer ${className}`}
      title={buildDateFull ? `Version déployée le ${buildDateFull}. Cliquez pour revérifier s'il y a une mise à jour.` : "Votre application est parfaitement à jour. Cliquez pour vérifier s'il y a une mise à jour."}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
      </span>
      <span className="tracking-wide">Mise à jour : OK</span>
      <span className="text-[10px] font-mono text-emerald-300/90 border-l border-emerald-500/30 pl-1.5 ml-0.5">
        {buildDateShort || 'À jour'}
      </span>
      {sha && showDetails && (
        <span className="text-[10px] font-mono text-emerald-400/70 border-l border-emerald-500/30 pl-1.5 ml-0.5">
          {sha}
        </span>
      )}
    </button>
  );
};

export default UpdateStatusBadge;
