import L from "leaflet";

// Pin "goutte" façon Google Maps, partagé par la carte Secteurs (contacts)
// et la carte Biens (propriétés) — demande explicite : « c'est peut-être
// plus joli d'ailleurs [...] propose-moi une solution [...] pour faciliter
// les choses avec les deux cartes que nous avons ». Pur CSS (carré tourné
// à -45° avec un coin arrondi à 0), pas de SVG externe.
interface TeardropOptions {
  size?: number;
  selected?: boolean;
  extraHtml?: string; // badge additionnel positionné en absolu (statut, score...)
}

export function createTeardropIcon(color: string, opts: TeardropOptions = {}): L.DivIcon {
  const size = opts.size ?? (opts.selected ? 34 : 28);
  const dot = Math.round(size * 0.38);
  return L.divIcon({
    className: "map-pin-teardrop",
    html: `
      <span style="position:relative;display:block;width:${size}px;height:${size}px">
        <span style="position:absolute;inset:0;transform:rotate(-45deg);transform-origin:center;border-radius:50% 50% 50% 0;background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></span>
        <span style="position:absolute;top:${size * 0.28}px;left:${size * 0.28}px;width:${dot}px;height:${dot}px;border-radius:50%;background:white"></span>
        ${opts.extraHtml || ""}
      </span>
    `,
    iconSize: [size, size],
    // La pointe de la goutte retombe en bas-centre du carré tourné.
    iconAnchor: [size / 2, size],
  });
}

// Contenu de tooltip au survol — adresse en évidence, un libellé (nom du
// client, titre du bien...) en petit au-dessus. Demande explicite : « qu'on
// survole avec la souris [...] il y a automatiquement l'adresse ».
export function adresseTooltipHtml(adresse: string, libelle?: string): string {
  return `
    <div style="max-width:220px">
      ${libelle ? `<p style="font-weight:700;font-size:11px;margin:0 0 2px">${libelle}</p>` : ""}
      <p style="font-size:11px;color:#666;margin:0">${adresse}</p>
    </div>
  `;
}
