import type { GeoPoint } from "@/immosphera/lib/geo";

// Demande explicite : « un bouton pour les commodités. En cherchant une
// ville [...] et en cliquant dessus commodité, on aurait toutes les
// pharmacies écoles, commerces ». Overpass (données OpenStreetMap) : pas de
// clé nécessaire, contrairement à Google Places.

export type TypeCommodite = "pharmacie" | "ecole" | "commerce";

export interface Commodite {
  id: string;
  type: TypeCommodite;
  nom: string;
  point: GeoPoint;
}

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const RAYON_M = 1500;
// Un commerce par tag OSM générique attirerait aussi les commerces de gros,
// garages, etc. — on se limite aux catégories du quotidien citées par la
// demande (boulangerie, supérette, etc.) pour rester lisible sur la carte.
const TAGS_COMMERCE = ["supermarket", "convenience", "bakery", "butcher", "greengrocer"];

function construireRequete(centre: GeoPoint): string {
  const filtreCommerces = TAGS_COMMERCE.map((t) => `node["shop"="${t}"](around:${RAYON_M},${centre.lat},${centre.lng});`).join("\n");
  return `
    [out:json][timeout:25];
    (
      node["amenity"="pharmacy"](around:${RAYON_M},${centre.lat},${centre.lng});
      node["amenity"="school"](around:${RAYON_M},${centre.lat},${centre.lng});
      ${filtreCommerces}
    );
    out center 90;
  `;
}

function typeDepuisTags(tags: Record<string, string>): TypeCommodite | null {
  if (tags.amenity === "pharmacy") return "pharmacie";
  if (tags.amenity === "school") return "ecole";
  if (tags.shop) return "commerce";
  return null;
}

const LABELS_TYPE: Record<TypeCommodite, string> = { pharmacie: "Pharmacie", ecole: "École", commerce: "Commerce" };

export async function rechercherCommodites(centre: GeoPoint): Promise<Commodite[]> {
  const requete = construireRequete(centre);
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", body: `data=${encodeURIComponent(requete)}` });
      if (!res.ok) continue;
      const json = await res.json();
      const elements: any[] = Array.isArray(json?.elements) ? json.elements : [];
      return elements
        .map((el) => {
          const type = typeDepuisTags(el.tags || {});
          if (!type) return null;
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (typeof lat !== "number" || typeof lon !== "number") return null;
          const nom = el.tags?.name || LABELS_TYPE[type];
          return { id: `${el.type}/${el.id}`, type, nom, point: { lat, lng: lon } } as Commodite;
        })
        .filter((c): c is Commodite => c !== null);
    } catch {
      // essaie le miroir suivant
      continue;
    }
  }
  return [];
}
