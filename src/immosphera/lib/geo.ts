const CACHE_KEY = "immosphera360-geocode-cache-v2";

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
 * Point-dans-polygone (ray casting) — utilisé pour déterminer dans quel
 * secteur (src/immosphera/pages/Secteurs.tsx) tombe l'adresse d'un contact,
 * une fois géocodée. Pas besoin de PostGIS pour ce volume : le calcul se
 * fait entièrement côté client sur les polygones déjà chargés.
 */
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
