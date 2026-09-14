// v6 : re-invalide le cache — les codes postaux testés pendant que la clé
// Google était encore mal configurée (restriction referer incompatible
// avec l'API Geocoding, puis API non activée) avaient mis en cache le
// mauvais résultat de repli, jamais réessayé depuis puisque la clé de
// cache existait déjà (« même pour le code c'est mis à côté »).
const CACHE_KEY = "immosphera360-geocode-cache-v6";

export interface GeoPoint {
  lat: number;
  lng: number;
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getCache(): Record<string, GeoPoint> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, GeoPoint>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Le stockage local peut être indisponible en navigation privée.
  }
}

function isValidFrancePoint(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= 41 &&
    point.lat <= 51.5 &&
    point.lng >= -5.5 &&
    point.lng <= 10
  );
}

/**
 * Géocode une adresse ou une commune française.
 * Le code postal est prioritaire lorsqu'il est présent dans la saisie.
 *
 * Bug trouvé en test réel (ajout de bien bloqué avec "Impossible de
 * localiser ce bien" à chaque fois, sans exception) : l'edge function
 * Supabase "immosphera-geocode" appelée ici n'existe pas/plus sur ce
 * projet (404 confirmé), donc TOUT géocodage échouait silencieusement et
 * bloquait la création de n'importe quel nouveau bien. Remplacée par un
 * appel direct à l'API Adresse du gouvernement français (api-adresse.data.gouv.fr) :
 * gratuite, sans clé, CORS ouvert, et référence pour les adresses FR.
 */
export async function geocodeCity(value: string, forceRefresh = false, codePostalAttendu?: string | null): Promise<GeoPoint | null> {
  const query = value.trim();
  if (!query) return null;

  const cache = getCache();
  // Le code postal attendu fait partie de la clé de cache : sans ça, une
  // adresse mal orthographiée mise en cache une première fois avec un
  // mauvais résultat (voir bug ci-dessous) resterait fausse pour toujours,
  // même une fois la recherche corrigée côté API.
  const key = normalizeKey(query) + (codePostalAttendu ? `|cp:${codePostalAttendu.trim()}` : '');
  if (!forceRefresh && cache[key]) return cache[key];

  try {
    // Bug constaté (6 septembre, Sylvain : « le client est dans le nord,
    // l'adresse est dans le sud ») : DS Menuiserie, adresse « 66 avenue
    // d'espagne, 11100, Narbonne », s'est retrouvé géocodé du côté de
    // Saumur (~500 km plus au nord) — la recherche plein texte de l'API
    // Adresse a matché une rue similaire ailleurs en France sans qu'on ait
    // de garde-fou. On restreint donc la recherche au code postal attendu
    // quand on le connaît (paramètre `postcode` de l'API), ce qui élimine
    // ce type de faux positif à la source.
    const params = new URLSearchParams({ q: query, limit: '1' });
    if (codePostalAttendu?.trim()) params.set('postcode', codePostalAttendu.trim());
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${params.toString()}`);
    if (!res.ok) return null;
    const json = await res.json();
    const feature = json?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;

    const point: GeoPoint = { lat: coords[1], lng: coords[0] };
    if (!isValidFrancePoint(point)) return null;

    cache[key] = point;
    setCache(cache);
    return point;
  } catch {
    return null;
  }
}

/** Alias plus explicite pour les formulaires de biens. */
export const geocodeAddress = geocodeCity;

/**
 * Appel générique à l'API Google Geocoding — clé fournie par le client,
 * VITE_GOOGLE_MAPS_API_KEY (correctement configurée côté Vercel le 14
 * septembre, après une première tentative où le nom et la valeur avaient
 * été inversés dans le formulaire), jamais commitée (voir .env.example).
 * `params` porte soit `address` (nom de ville), soit `components=postal_code:...`
 * (code postal), voir les deux wrappers ci-dessous.
 */
async function geocodeGoogle(params: URLSearchParams): Promise<(GeoPoint & { postcode: string | null }) | null> {
  const cleGoogle = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!cleGoogle) return null;
  try {
    params.set("key", cleGoogle);
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.status !== "OK") return null;
    const resultat = json?.results?.[0];
    const location = resultat?.geometry?.location;
    if (typeof location?.lat !== "number" || typeof location?.lng !== "number") return null;
    const point: GeoPoint = { lat: location.lat, lng: location.lng };
    if (!isValidFrancePoint(point)) return null;
    const postcode: string | null =
      resultat?.address_components?.find((c: any) => c.types?.includes("postal_code"))?.long_name ?? null;
    return { ...point, postcode };
  } catch {
    return null;
  }
}

/**
 * Géocode un code postal via l'API Google Geocoding (components=postal_code)
 * — nettement plus fiable en pratique que les APIs françaises gratuites pour
 * ce cas précis (voir geocodePostalCode ci-dessous).
 */
async function geocodePostalCodeGoogle(codePostal: string): Promise<GeoPoint | null> {
  const resultat = await geocodeGoogle(new URLSearchParams({ components: `postal_code:${codePostal}|country:FR` }));
  return resultat ? { lat: resultat.lat, lng: resultat.lng } : null;
}

/**
 * Géocode un nom de ville via l'API Google Geocoding — même raison que
 * geocodePostalCodeGoogle : bug constaté (14 septembre) où « Narbonne »
 * tapé en toutes lettres tombait au même endroit erroné qu'un code postal
 * (le géocodage des noms de ville n'était pas encore branché sur Google,
 * seulement celui des codes postaux). Renvoie aussi le code postal résolu,
 * nécessaire à departementAutorise.
 */
async function geocodeVilleGoogle(nomVille: string): Promise<(GeoPoint & { postcode: string | null }) | null> {
  return geocodeGoogle(new URLSearchParams({ address: nomVille, components: "country:FR" }));
}

/**
 * Géocode un code postal en un point de repère fiable — utilisé pour tracer
 * le secteur d'un conseiller (src/immosphera/pages/Secteurs.tsx) sous forme
 * de cercles colorés, faute de vraies limites de code postal disponibles.
 *
 * Deux essais précédents ratés avec des APIs françaises gratuites (14
 * septembre, captures à l'appui) :
 * 1. Interroger l'API Adresse (recherche plein texte, faite pour des
 *    adresses) avec le code postal NU comme requête ("q=11100") — sans rien
 *    de concret à matcher, elle renvoyait le résultat texte le plus proche,
 *    pas la commune (cercle tombé près de l'aérodrome de Narbonne).
 * 2. Utiliser le "centre" officiel (geo.api.gouv.fr) de la ou des commune(s)
 *    portant ce code postal, PUIS regéocoder son nom en mode "municipality"
 *    — toujours tombé au même endroit erroné (« toujours aussi mauvais »).
 *
 * Google Geocoding (voir geocodePostalCodeGoogle) est essayé EN PREMIER
 * quand une clé est configurée — nettement plus fiable en pratique pour ce
 * cas précis. Sans clé (ou si Google échoue), on retombe sur la chaîne
 * geo.api.gouv.fr + API Adresse plutôt que de ne rien afficher du tout.
 */
export async function geocodePostalCode(codePostal: string, forceRefresh = false): Promise<GeoPoint | null> {
  const code = codePostal.trim();
  if (!/^\d{5}$/.test(code)) return null;

  const cache = getCache();
  const key = `cp:${code}`;
  if (!forceRefresh && cache[key]) return cache[key];

  const viaGoogle = await geocodePostalCodeGoogle(code);
  if (viaGoogle) {
    cache[key] = viaGoogle;
    setCache(cache);
    return viaGoogle;
  }

  try {
    const params = new URLSearchParams({ codePostal: code, fields: "nom,population", format: "json" });
    const res = await fetch(`https://geo.api.gouv.fr/communes?${params.toString()}`);
    if (!res.ok) return null;
    const communes = await res.json();
    if (!Array.isArray(communes) || communes.length === 0) return null;

    // Plusieurs communes (ou hameaux rattachés) peuvent partager un même
    // code postal : on prend la plus peuplée, celle à laquelle le code
    // postal fait référence en pratique.
    const principale = [...communes].sort((a: any, b: any) => (b?.population ?? 0) - (a?.population ?? 0))[0];
    if (!principale?.nom) return null;

    const paramsAdresse = new URLSearchParams({ q: principale.nom, type: "municipality", postcode: code, limit: "1" });
    const resAdresse = await fetch(`https://api-adresse.data.gouv.fr/search/?${paramsAdresse.toString()}`);
    if (!resAdresse.ok) return null;
    const jsonAdresse = await resAdresse.json();
    const coords = jsonAdresse?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;

    const point: GeoPoint = { lat: coords[1], lng: coords[0] };
    if (!isValidFrancePoint(point)) return null;

    cache[key] = point;
    setCache(cache);
    return point;
  } catch {
    return null;
  }
}

/**
 * Point-dans-polygone (ray casting) — utilisé pour déterminer dans quel
 * secteur (src/immosphera/pages/Secteurs.tsx) tombe l'adresse d'un contact,
 * une fois géocodée. Pas besoin de PostGIS pour ce volume : le calcul se
 * fait entièrement côté client sur les polygones déjà chargés.
 */
/**
 * Géocode une adresse ET renvoie son code postal (pas seulement les
 * coordonnées comme geocodeAddress) — utilisé pour rattacher un contact
 * (Secteurs.tsx) au secteur du conseiller dont le code postal correspond.
 */
export async function geocodeAdresseAvecCodePostal(
  adresse: string
): Promise<(GeoPoint & { postcode: string | null; city: string | null }) | null> {
  const query = adresse.trim();
  if (!query) return null;
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${new URLSearchParams({ q: query, limit: "1" })}`);
    if (!res.ok) return null;
    const json = await res.json();
    const feature = json?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;
    const point = { lat: coords[1], lng: coords[0] };
    if (!isValidFrancePoint(point)) return null;
    return { ...point, postcode: feature?.properties?.postcode ?? null, city: feature?.properties?.city ?? null };
  } catch {
    return null;
  }
}

/**
 * Une entrée de secteur (Secteurs.tsx) peut être un code postal OU un nom de
 * ville — demande explicite : « mettre le code postal, également par ville,
 * si parfois on n'a pas le code postal en connaissance ». Un code postal
 * (5 chiffres) est géocodé par geocodePostalCode ; sinon l'entrée est
 * traitée comme un nom de ville (geocodeCity, déjà utilisé pour les Biens).
 *
 * Renvoie aussi le code postal résolu (même pour une entrée "ville") : sert
 * à vérifier le département (voir departementAutorise ci-dessous).
 */
export async function geocodeEntreeSecteur(entree: string): Promise<{ point: GeoPoint; postcode: string | null } | null> {
  const valeur = entree.trim();
  if (!valeur) return null;
  if (/^\d{5}$/.test(valeur)) {
    const point = await geocodePostalCode(valeur);
    return point ? { point, postcode: valeur } : null;
  }
  // Google d'abord (voir geocodePostalCode plus haut pour l'historique du
  // bug), l'ancienne API Adresse seulement si Google échoue ou n'est pas
  // configuré.
  const viaGoogle = await geocodeVilleGoogle(valeur);
  if (viaGoogle) return { point: { lat: viaGoogle.lat, lng: viaGoogle.lng }, postcode: viaGoogle.postcode };
  const resultat = await geocodeAdresseAvecCodePostal(valeur);
  return resultat ? { point: { lat: resultat.lat, lng: resultat.lng }, postcode: resultat.postcode } : null;
}

// Demande explicite (14 septembre) : « fais-moi plutôt pour l'instant la
// carte de l'Aude, l'Hérault et les Pyrénées-Orientales [...] si jamais tu
// la codes autre part c'est une erreur de ta part » — les secteurs sont
// volontairement limités à ces 3 départements pour l'instant.
export const DEPARTEMENTS_SECTEUR_AUTORISES = ["11", "34", "66"] as const;
export const DEPARTEMENTS_SECTEUR_LABEL = "Aude (11), Hérault (34) et Pyrénées-Orientales (66)";

export function departementAutorise(codePostal: string | null): boolean {
  if (!codePostal || !/^\d{5}$/.test(codePostal)) return false;
  return (DEPARTEMENTS_SECTEUR_AUTORISES as readonly string[]).includes(codePostal.slice(0, 2));
}

export interface SuggestionCommune {
  nom: string;
  codePostal: string;
}

export interface SuggestionCommuneProche extends SuggestionCommune {
  distanceKm: number;
}

/**
 * Recherche de communes par nom (autocomplete) — demande explicite (14
 * septembre) : « un fichier déroulant, on peut cliquer plusieurs villes »,
 * en réaction aux erreurs répétées de géocodage sur du texte libre. En
 * choisissant une commune dans une liste de résultats RÉELS (plutôt que de
 * taper un nom à la main), il n'y a plus ni faute de frappe ni homonyme
 * ambigu possible — seule l'exactitude du POINT affiché sur la carte reste
 * gérée par Google Geocoding (voir geocodePostalCode), pas cette recherche.
 * Restreinte aux 3 départements autorisés (voir DEPARTEMENTS_SECTEUR_AUTORISES).
 */
export async function rechercherCommunes(recherche: string): Promise<SuggestionCommune[]> {
  const q = recherche.trim();
  if (q.length < 2) return [];
  try {
    const params = new URLSearchParams({
      nom: q,
      boost: "population",
      limit: "12",
      fields: "nom,codesPostaux,codeDepartement",
    });
    const res = await fetch(`https://geo.api.gouv.fr/communes?${params.toString()}`);
    if (!res.ok) return [];
    const communes = await res.json();
    if (!Array.isArray(communes)) return [];
    const suggestions: SuggestionCommune[] = [];
    for (const c of communes) {
      if (!(DEPARTEMENTS_SECTEUR_AUTORISES as readonly string[]).includes(c?.codeDepartement)) continue;
      for (const cp of c?.codesPostaux ?? []) {
        suggestions.push({ nom: c.nom, codePostal: cp });
      }
    }
    return suggestions.slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * Villages/communes autour d'un point donné — demande explicite (14
 * septembre) : « pour le code postal ça ne met que Lézignan, alors qu'il y
 * a beaucoup de villages autour ». rechercherCommunes ne répond qu'à une
 * recherche par NOM (donc une seule commune à la fois) ; celle-ci
 * interroge geo.api.gouv.fr par proximité géographique (lat/lon) pour
 * lister les communes voisines, à ajouter en un clic plutôt que de devoir
 * les chercher une par une par leur nom. Triées par distance, restreintes
 * aux 3 départements autorisés, le point de départ lui-même exclu.
 */
export async function communesProches(centre: GeoPoint, nomExclu?: string): Promise<SuggestionCommuneProche[]> {
  try {
    const params = new URLSearchParams({
      lat: String(centre.lat),
      lon: String(centre.lng),
      fields: "nom,codesPostaux,codeDepartement,centre",
      limit: "20",
    });
    const res = await fetch(`https://geo.api.gouv.fr/communes?${params.toString()}`);
    if (!res.ok) return [];
    const communes = await res.json();
    if (!Array.isArray(communes)) return [];
    const suggestions: SuggestionCommuneProche[] = [];
    for (const c of communes) {
      if (!(DEPARTEMENTS_SECTEUR_AUTORISES as readonly string[]).includes(c?.codeDepartement)) continue;
      if (nomExclu && c?.nom === nomExclu) continue;
      const coords = c?.centre?.coordinates;
      const distanceKmValeur = Array.isArray(coords) && coords.length === 2 ? distanceKm(centre, { lat: coords[1], lng: coords[0] }) : Infinity;
      for (const cp of c?.codesPostaux ?? []) {
        suggestions.push({ nom: c.nom, codePostal: cp, distanceKm: distanceKmValeur });
      }
    }
    return suggestions.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 15);
  } catch {
    return [];
  }
}

function normaliserVille(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Une entrée de secteur (code postal ou ville) correspond-elle à l'adresse
 * géocodée d'un contact ? Compare le code postal exact, ou le nom de ville
 * (insensible aux accents/casse) selon la forme de l'entrée.
 */
export function entreeSecteurCorrespond(
  entree: string,
  adresse: { postcode: string | null; city: string | null }
): boolean {
  const valeur = entree.trim();
  if (/^\d{5}$/.test(valeur)) return valeur === adresse.postcode;
  return !!adresse.city && normaliserVille(valeur) === normaliserVille(adresse.city);
}

export function pointDansPolygone(point: GeoPoint, polygone: GeoPoint[]): boolean {
  let dedans = false;
  for (let i = 0, j = polygone.length - 1; i < polygone.length; j = i++) {
    const pi = polygone[i];
    const pj = polygone[j];
    const intersecte =
      pi.lat > point.lat !== pj.lat > point.lat &&
      point.lng < ((pj.lng - pi.lng) * (point.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng;
    if (intersecte) dedans = !dedans;
  }
  return dedans;
}

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  if (!a || !b) return Infinity;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
