import React, { useState } from 'react';

/* Ligne d'identité du build, affichée en bas du menu.

   Elle répond à une seule question, celle qui nous a fait tourner en rond :
   « la version que je regarde, c'est laquelle ? » Branche, commit et heure
   sont figés DANS le paquet JavaScript au moment du build (vite.config.ts,
   define) — cette ligne décrit donc le code réellement en train de tourner,
   et pas ce que le serveur propose. Si le téléphone sert encore un ancien
   paquet depuis son cache, c'est l'ancien numéro qui s'affiche : le doute
   est levé sans avoir à comparer quoi que ce soit. */
export const BuildStamp: React.FC = () => {
  const [copie, setCopie] = useState(false);

  const info = typeof __BUILD_INFO__ !== 'undefined'
    ? __BUILD_INFO__
    : { ref: 'dev', sha: 'dev', at: '' };

  const quand = info.at
    ? new Date(info.at).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '';

  const texte = `${info.ref} · ${info.sha}${quand ? ` · ${quand}` : ''}`;

  return (
    <button
      onClick={() => {
        // Pour pouvoir recopier la ligne dans un message sans la retaper.
        navigator.clipboard?.writeText(texte).then(
          () => {
            setCopie(true);
            window.setTimeout(() => setCopie(false), 1500);
          },
          () => undefined
        );
      }}
      title="Version installée — appuyer pour copier"
      className="w-full px-4 py-2 text-[10px] font-mono text-slate-500 text-center truncate active:text-slate-300"
    >
      {copie ? 'Version copiée' : texte}
    </button>
  );
};

export default BuildStamp;
