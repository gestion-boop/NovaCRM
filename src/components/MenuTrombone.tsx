import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Image as ImageIcon, Video as VideoIcon, FileText } from 'lucide-react';

// Un seul bouton « trombone » pour toutes les pièces jointes d'un composeur
// de messages (photo, document PDF, vidéo) : gagne la place des trois icônes
// séparées. Le menu s'ouvre au-dessus du bouton.
interface Props {
  onPhoto: () => void;
  /** Absent : l'entrée « Document » n'est pas proposée. */
  onDocument?: () => void;
  onVideo: () => void;
  disabled?: boolean;
  /** Visible aussi sur téléphone (par défaut : à partir de la largeur « sm »). */
  toutesLargeurs?: boolean;
  /** Grand bouton rond (fiche client). */
  grand?: boolean;
}

export const MenuTrombone: React.FC<Props> = ({ onPhoto, onDocument, onVideo, disabled, toutesLargeurs, grand }) => {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent | TouchEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('touchstart', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('touchstart', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  const choisir = (action: () => void) => () => { setOuvert(false); action(); };
  const item = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-white/10 text-left';

  return (
    <div className={`relative shrink-0 ${toutesLargeurs ? '' : 'hidden sm:block'}`} ref={racine}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        title="Joindre une photo, un document ou une vidéo"
        className={`${grand ? 'w-10 h-10 rounded-full' : 'w-8 h-8 rounded-xl'} flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40 ${ouvert ? 'bg-white/10 text-white' : ''}`}
      >
        <Paperclip className={grand ? 'w-5 h-5' : 'w-4 h-4'} />
      </button>
      {ouvert && (
        <div
          role="menu"
          className="absolute bottom-full left-0 sm:left-auto sm:right-0 mb-2 z-50 min-w-[190px] p-1.5 rounded-xl bg-[#0b1719] border border-white/15 shadow-2xl"
        >
          <button type="button" role="menuitem" onClick={choisir(onPhoto)} className={item}>
            <ImageIcon className="w-4 h-4 text-[#F7BC5F]" /> Photo
          </button>
          {onDocument && (
            <button type="button" role="menuitem" onClick={choisir(onDocument)} className={item}>
              <FileText className="w-4 h-4 text-[#F7BC5F]" /> Document (PDF)
            </button>
          )}
          <button type="button" role="menuitem" onClick={choisir(onVideo)} className={item}>
            <VideoIcon className="w-4 h-4 text-sky-400" /> Vidéo (150 Mo max)
          </button>
        </div>
      )}
    </div>
  );
};

export default MenuTrombone;
