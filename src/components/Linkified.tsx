import React from 'react';

// Texte libre (commentaire de fiche, notes) : les adresses web deviennent des
// liens soulignés, ouverts en un clic dans un nouvel onglet.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<>"]+)/g;
const EST_URL = /^(?:https?:\/\/|www\.)/;
// Ponctuation de fin de phrase qui n'appartient pas à l'adresse.
const PONCTUATION_FINALE = /[.,;:!?)\]»”’']+$/;

export const contientUrl = (texte: string): boolean => /(?:https?:\/\/|www\.)\S/.test(texte);

export const Linkified: React.FC<{ text: string }> = ({ text }) => {
  const morceaux = text.split(URL_REGEX);
  return (
    <>
      {morceaux.map((m, i) => {
        if (!EST_URL.test(m)) return <React.Fragment key={i}>{m}</React.Fragment>;
        const fin = m.match(PONCTUATION_FINALE)?.[0] ?? '';
        const url = fin ? m.slice(0, -fin.length) : m;
        const href = url.startsWith('www.') ? `https://${url}` : url;
        return (
          <React.Fragment key={i}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              style={{ color: '#F9C977', textDecoration: 'underline', textUnderlineOffset: 2 }}
              className="break-all hover:opacity-80"
            >
              {url}
            </a>
            {fin}
          </React.Fragment>
        );
      })}
    </>
  );
};
