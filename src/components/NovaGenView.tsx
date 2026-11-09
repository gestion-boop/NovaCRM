import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

// NovaGen (visites virtuelles et pubs) affiché dans le CRM. Réservé à la société
// Novavisio, pour Sylvain (super admin) et Josian Fernandez — même règle que la tuile.
export const NOVAGEN_URL = 'https://novagen-olive.vercel.app/';
const UIDS_AUTORISES = new Set(['2294be9f-d5ef-4afb-add4-e766cd826d79']);

interface Props {
  /** Fermer le plein écran et revenir à l'écran précédent. */
  onClose?: () => void;
}

const NovaGenView: React.FC<Props> = ({ onClose }) => {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const autorise =
    /novavisio/i.test(activeAgency?.name ?? '') &&
    (userProfile?.role === 'super_admin' || (!!currentUser?.uid && UIDS_AUTORISES.has(currentUser.uid)));

  useEffect(() => {
    if (!autorise || !onClose) return;
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [autorise, onClose]);

  if (!autorise) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        NovaGen est réservé à la société Novavisio.
      </div>
    );
  }

  // Plein écran : couche fixe portée directement dans <body> (un ancêtre animé
  // casserait un `fixed` imbriqué), qui couvre toute la hauteur de l'écran.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-[#0B1F33]"
      style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 shrink-0 border-b border-white/10">
        <h2 className="text-base font-bold text-white">NovaGen</h2>
        <div className="flex items-center gap-2">
          <a
            href={NOVAGEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
            title="Si la page reste vide, ouvrez NovaGen dans un onglet"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#F7BC5F]" /> Ouvrir dans un onglet
          </a>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer NovaGen"
              title="Fermer (Échap)"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-[#F7BC5F] text-white hover:text-slate-950 border border-white/15 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
      <iframe
        title="NovaGen"
        src={NOVAGEN_URL}
        allow="clipboard-read; clipboard-write; autoplay; fullscreen; microphone"
        className="flex-1 min-h-0 w-full border-0 bg-white"
      />
    </div>,
    document.body
  );
};

export default NovaGenView;
