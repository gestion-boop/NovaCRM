#!/usr/bin/env node
/**
 * Générateur des listes de surfaces du thème (mode nuit / mode jour).
 *
 * Pourquoi ce script existe
 * -------------------------
 * L'appli peint ses fonds/bordures avec des couleurs Tailwind ARBITRAIRES
 * (`bg-[#0a1e20]`, `border-[#144447]`...). Une couleur écrite en dur dans un
 * composant ne peut pas changer avec le thème : le mode jour reposait donc
 * sur une liste de sélecteurs `[class*="bg-[#hex"]` recopiée à la main dans
 * index.css. Chaque nouvel écran ajoutait une teinte de plus, oubliée dans la
 * liste, donc restée noire en mode jour — d'où le temps perdu à chasser les
 * cas un par un.
 *
 * Ce script relit TOUT le code source, retrouve ces couleurs, garde celles qui
 * sont réellement des fonds sombres (classement objectif : luminance + canal
 * max, voir isDarkSurface) et réécrit la liste dans src/index.css, entre les
 * marqueurs @generated. Les couleurs ne sont plus remplacées par une valeur
 * en dur mais par des JETONS (var(--nv-surface-1)...) définis une seule fois
 * par thème : une même liste sert donc au mode nuit ET au mode jour.
 *
 *   node scripts/theme-surfaces.mjs          → rapport (rien n'est écrit)
 *   node scripts/theme-surfaces.mjs --write  → régénère src/index.css
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CSS_FILE = join(SRC, 'index.css');
const START = '/* @generated:theme-surfaces:start — ne pas éditer à la main, voir scripts/theme-surfaces.mjs */';
const END = '/* @generated:theme-surfaces:end */';

/* Écrans immersifs volontairement sombres dans les DEUX thèmes (nébuleuse du
   mode vocal Nova) : jamais reversés au thème clair. */
const EXCLUDED = new Set(['0a0612']);

/* Le fond de page/voile (App.tsx <main> et les coquilles plein écran) a son
   propre jeton : c'est lui qui laisse transparaître le fond d'écran, il ne
   doit pas prendre la couleur pleine des cartes. */
const APP_SHELL = '071015';
/* Barre du haut + barre latérale + navigation mobile. */
const CHROME = '081318';
/* Teintes dont la valeur du MODE NUIT est une demande explicite déjà validée
   et ne doit pas être fondue dans la teinte de carte unique : elles ne sont
   remappées qu'en mode jour. #2b2b2b = le gris anthracite du bandeau
   « Objectif du mois » (Tableau de bord) et du panneau Priorités (Accueil). */
const DARK_KEEP = new Set(['2b2b2b']);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
};

const channels = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/**
 * Une couleur est un « fond sombre » (donc à reverser au thème) si elle est
 * à la fois peu lumineuse ET sans canal vif. Les deux conditions sont
 * nécessaires : la luminance seule confond le teal foncé #1c5054 (surface)
 * avec le bordeaux #8b1e3f (couleur de marque d'une tuile), qui ont la même
 * clarté perçue ; le canal max les sépare nettement (0x54 contre 0x8b).
 */
const isDarkSurface = (hex) =>
  !EXCLUDED.has(hex) && Math.max(...channels(hex)) <= 0x70 && luminance(hex) < 0.12;

const files = walk(SRC);
/** utilitaire -> Set de hex, en tenant compte des variantes (hover:, md:...) */
const found = { bg: new Set(), bgHover: new Set(), border: new Set(), divide: new Set(), ring: new Set() };
/* Fonds VIFS pleins (hex de marque + palette Tailwind saturée) : ils restent
   sombres/saturés dans les deux thèmes, donc le texte posé dessus doit rester
   clair même en mode jour. Sert à générer la liste des « conteneurs sur fond
   sombre » qui réinitialisent les jetons d'encre. */
const solid = new Set();
const rejected = new Map();
const SOLID_RE = /(?:^|[\s"'`{])(?:[a-z-]+:)*bg-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(500|600|700|800|900|950)(?![\/\d])/g;

const RE = /(?:^|[\s"'`{])((?:[a-z-]+:)*)(bg|border|divide|ring)-\[#([0-9a-fA-F]{6})\]/g;

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  let m;
  while ((m = SOLID_RE.exec(code))) solid.add(`bg-${m[1]}-${m[2]}`);
  while ((m = RE.exec(code))) {
    const [, variants, prop, rawHex] = m;
    const hex = rawHex.toLowerCase();
    if (!isDarkSurface(hex)) {
      if (!rejected.has(hex)) rejected.set(hex, `${prop} L=${luminance(hex).toFixed(3)} max=0x${Math.max(...channels(hex)).toString(16)}`);
      /* Un hex vif utilisé en FOND plein (pas en bordure, pas en teinte
         `/10`) est un conteneur coloré : le texte dessus reste clair. */
      if (prop === 'bg' && luminance(hex) < 0.36 && !m[0].includes(']/')) solid.add(`bg-[#${rawHex}]`);
      continue;
    }
    if (prop === 'bg') (variants.includes('hover:') ? found.bgHover : found.bg).add(hex);
    else if (prop === 'border') found.border.add(hex);
    else if (prop === 'divide') found.divide.add(hex);
    else found.ring.add(hex);
  }
}

const sorted = (set) => [...set].sort();
/* `[class*="bg-[#0a1e20"]` (sans le crochet fermant) capte d'un coup la
   classe nue ET toutes ses variantes : hover:, md:, et surtout les suffixes
   d'opacité `bg-[#0a1e20]/50`. */
/* Drapeau `i` : les composants écrivent indifféremment `bg-[#0E1A20]` ou
   `bg-[#0e1a20]`, et un sélecteur d'attribut est sensible à la casse par
   défaut — sans lui, la moitié des écrans passait à travers la liste. */
const sel = (prop, hex, suffix = '') => `[class*="${prop}-[#${hex}" i]${suffix}`;

const list = (hexes, prop, suffix = '', prefix = '') =>
  hexes.map((h) => `${prefix}${sel(prop, h, suffix)}`).join(',\n');

const bgAll = sorted(found.bg);
/* Uniquement les teintes réellement utilisées AVEC la variante `hover:` —
   sinon la règle de survol s'appliquerait aussi aux cartes statiques, qui
   changeraient de couleur au passage de la souris sans l'avoir demandé. */
const bgHoverAll = sorted(found.bgHover);
/* Fonds pouvant servir de PARENT dans la détection d'imbrication (une carte
   dans une carte = bloc surélevé). La coquille plein écran et le voile
   <main> en sont exclus : ils englobent toute l'appli, tout deviendrait
   « imbriqué ». */
const bgNestable = bgAll.filter((h) => h !== APP_SHELL);
/* Cartes qui ne portent PAS de couleur arbitraire mais une classe dédiée
   (voir index.css) : sans elles, les blocs imbriqués dans une carte du
   tableau de bord ou dans une colonne du pipeline restaient au niveau
   « carte » et se confondaient avec elle. */
const EXTRA_ANCESTORS = ['.dash-card', '.pipeline-column-bg'];
const cards = bgAll.filter((h) => h !== APP_SHELL && h !== CHROME && !DARK_KEEP.has(h));
const kept = bgAll.filter((h) => DARK_KEEP.has(h));

const solidList = [...solid].sort();

const block = `${START}
/* ── Fonds sombres écrits en dur dans les composants → jeton de surface ──
   ${bgAll.length} teintes recensées automatiquement dans src/ (voir
   scripts/theme-surfaces.mjs). Le sélecteur ne cite PAS la valeur finale :
   il pose un jeton, redéfini une seule fois par thème plus haut dans ce
   fichier. Une même liste sert donc au mode nuit et au mode jour. */
${list(cards, 'bg')} {
  background-color: var(--nv-surface-1) !important;
}
/* Barre du haut, barre latérale, navigation mobile. */
${list([CHROME], 'bg')} {
  background-color: var(--nv-surface-chrome) !important;
}
/* Coquilles plein écran = fond de page. */
${list([APP_SHELL], 'bg')} {
  background-color: var(--nv-surface-app) !important;
}
/* Teintes dont le rendu de nuit est voulu tel quel (voir DARK_KEEP dans le
   script) : seul le mode jour les reprend. */
${list(kept, 'bg', '', '.light-mode ')} {
  background-color: var(--nv-surface-1) !important;
}

/* Un bloc sombre DANS un autre bloc sombre est un élément surélevé (ligne
   de liste, champ de saisie, encart). Lui donner exactement la couleur de
   sa carte parente supprimait toute hiérarchie : il prend un jeton
   distinct. Réservé au mode jour — le mode nuit garde volontairement une
   teinte unique (demande validée « applique cette couleur partout »), son
   jeton --nv-surface-2 y vaut la même valeur que --nv-surface-1. */
.light-mode :is(
${list(bgNestable, 'bg')},
${EXTRA_ANCESTORS.join(',\n')}
) :is(
${list(bgAll, 'bg')}
) {
  background-color: var(--nv-surface-2) !important;
}

/* Survol. Les règles ci-dessus captent aussi les classes \`hover:bg-[#…]\`
   (le sélecteur teste la présence du texte dans l'attribut class, sans
   distinguer la variante) : le survol se retrouvait peint de la même
   couleur que le repos, donc sans effet visible nulle part dans l'appli.
   Rétabli ici, dans les deux thèmes. */
${list(bgHoverAll, 'hover:bg', ':hover')} {
  background-color: var(--nv-surface-1-hover) !important;
}

/* ── Bordures / séparateurs / liserés sombres ──
   Contrairement aux fonds, ils ne sont PAS unifiés en mode nuit (les
   nuances de bordure y sont voulues et lisibles) : ces règles sont donc
   réservées au mode jour, où ils vireraient au noir sur fond clair. */
${list(sorted(found.border), 'border', '', '.light-mode ')} {
  border-color: var(--nv-border-1) !important;
}

/* \`divide-*\` pose sa bordure sur les enfants, jamais sur le conteneur :
   les sélecteurs \`border-…\` ci-dessus ne peuvent pas l'atteindre. */
${list(sorted(found.divide), 'divide', ' > :not([hidden]) ~ :not([hidden])', '.light-mode ')} {
  border-color: var(--nv-border-2) !important;
}

/* Liserés (\`ring-*\`) sombres : ils détachent un avatar/badge de son fond,
   donc ils doivent prendre la couleur DU FOND, pas une couleur fixe. */
${list(sorted(found.ring), 'ring', '', '.light-mode ')} {
  --tw-ring-color: var(--nv-surface-1) !important;
}

/* ── Conteneurs à fond coloré plein ──
   Dégradés des tuiles « Mes espaces », pastilles de statut, badges de
   priorité : leur fond reste sombre et saturé dans les DEUX thèmes. Le
   texte posé dessus doit donc rester clair en mode jour aussi — au lieu de
   traiter chaque cas à part, ces conteneurs réinitialisent simplement les
   jetons d'encre pour tout leur contenu (voir --ink-* plus haut).
   \`[class~=…]\` (mot exact) et non \`[class*=…]\` : \`bg-emerald-500\` doit
   correspondre, mais surtout PAS \`bg-emerald-500/10\`, qui est une teinte
   pâle sur laquelle il faut au contraire du texte foncé. */
.light-mode :is([class*="bg-gradient-to-"],
${solidList.map((c) => `[class~="${c}"]`).join(',\n')}) {
  --ink-1: #ffffff;
  --ink-2: rgba(255, 255, 255, 0.82);
  --ink-3: rgba(255, 255, 255, 0.62);
  --ink-gold: #f9c977;
  --ink-red: #fca5a5;
  --ink-orange: #fdba74;
  --ink-amber: #fcd34d;
  --ink-yellow: #fde047;
  --ink-lime: #bef264;
  --ink-green: #86efac;
  --ink-emerald: #6ee7b7;
  --ink-teal: #5eead4;
  --ink-cyan: #67e8f9;
  --ink-sky: #7dd3fc;
  --ink-blue: #93c5fd;
  --ink-indigo: #a5b4fc;
  --ink-violet: #c4b5fd;
  --ink-purple: #d8b4fe;
  --ink-fuchsia: #f0abfc;
  --ink-pink: #f9a8d4;
  --ink-rose: #fda4af;
  /* Texte hérité (élément sans classe text-* propre) : blanc lui aussi. */
  color: var(--ink-1);
  --nv-wash: rgba(255, 255, 255, 0.12);
  --nv-hairline: rgba(255, 255, 255, 0.22);
  --nv-sunken: rgba(0, 0, 0, 0.25);
}
${END}`;

const css = readFileSync(CSS_FILE, 'utf8');
const i = css.indexOf(START);
const j = css.indexOf(END);

if (process.argv.includes('--write')) {
  if (i === -1 || j === -1) {
    console.error(`Marqueurs @generated absents de ${CSS_FILE} — ajoute-les avant de régénérer.`);
    process.exit(1);
  }
  writeFileSync(CSS_FILE, css.slice(0, i) + block + css.slice(j + END.length));
  console.log(`✓ src/index.css régénéré.`);
}

console.log(`Fichiers analysés : ${files.length}`);
console.log(`Fonds sombres     : ${bgAll.length} (dont ${cards.length} cartes, 1 chrome, 1 coquille)`);
console.log(`Survols (hover:)  : ${bgHoverAll.length}`);
console.log(`Bordures sombres  : ${found.border.size}`);
console.log(`Séparateurs       : ${found.divide.size}`);
console.log(`Liserés (ring)    : ${found.ring.size}`);
console.log(`Conteneurs colorés: ${solidList.length}`);
console.log(`Écartées (couleur de marque, non remappées) : ${rejected.size}`);
if (i !== -1 && j !== -1 && !process.argv.includes('--write')) {
  const current = css.slice(i, j + END.length);
  console.log(current === block ? '\n✓ src/index.css est à jour.' : "\n⚠ src/index.css est PÉRIMÉ — relancer avec --write.");
}
