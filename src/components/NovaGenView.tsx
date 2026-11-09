import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

// NovaGen (visites virtuelles et pubs) affiché dans le CRM. Réservé à la société
// Novavisio, pour Sylvain (super admin) et Josian Fernandez — même règle que la tuile.
export const NOVAGEN_URL = 'https://novagen-olive.vercel.app/';
const UIDS_AUTORISES = new Set(['2294be9f-d5ef-4afb-add4-e766cd826d79']);

const NovaGenView: React.FC = () => {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const autorise =
    /novavisio/i.test(activeAgency?.name ?? '') &&
    (userProfile?.role === 'super_admin' || (!!currentUser?.uid && UIDS_AUTORISES.has(currentUser.uid)));

  if (!autorise) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        NovaGen est réservé à la société Novavisio.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-[calc(100dvh-13rem)] min-h-[480px] px-3 sm:px-5 pb-3">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <h2 className="text-base font-bold text-white">NovaGen</h2>
        <a
          href={NOVAGEN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
          title="Si la page reste vide, ouvrez NovaGen dans un onglet"
        >
          <ExternalLink className="w-3.5 h-3.5 text-[#F7BC5F]" /> Ouvrir dans un onglet
        </a>
      </div>
      <iframe
        title="NovaGen"
        src={NOVAGEN_URL}
        allow="clipboard-read; clipboard-write; autoplay; fullscreen; microphone"
        className="flex-1 w-full rounded-xl border border-white/10 bg-white"
      />
    </div>
  );
};

export default NovaGenView;
