import { supabase } from '@/lib/supabase';
import { geocodeCity } from '@/immosphera/lib/geo';

// Constat du 3 septembre (Sylvain : « cette adresse n'y est pas… je pense que
// l'antécédent n'a pas été pris ») : la fiche client appelait une edge
// function Supabase « geocode-lead » qui n'existe pas dans ce projet. Aucune
// adresse saisie n'a donc jamais reçu de coordonnées, et la carte de
// prospection ne montrait que d'anciens points. On géocode maintenant
// directement depuis le CRM, avec l'API Adresse du gouvernement (gratuite,
// sans clé), déjà utilisée par ImmoSphera360, et on écrit les coordonnées
// dans la fiche.

export interface AdresseFiche {
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
}

export function adresseComplete(company: unknown): string | null {
  if (!company || typeof company !== 'object') return null;
  const c = company as Record<string, unknown>;
  const parts = [c.address, c.postal_code, c.city].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  return parts.length ? parts.join(', ') : null;
}

/** Géocode l'adresse d'une fiche et enregistre latitude/longitude. */
export async function geolocaliserFiche(leadId: string, company: unknown): Promise<{ lat: number; lng: number } | null> {
  const adresse = adresseComplete(company);
  if (!adresse) return null;
  // Adresse complète d'abord ; si l'API ne la connaît pas (numéro absent,
  // faute de frappe), on retombe sur code postal + ville pour placer au
  // moins le point dans la bonne commune.
  const c = (company ?? {}) as AdresseFiche;
  // Code postal attendu passé à l'API Adresse (paramètre `postcode`) : sans
  // lui, une adresse mal formée peut matcher une rue au même nom ailleurs
  // en France, à des centaines de kilomètres (voir geocodeCity).
  let point = await geocodeCity(adresse, false, c.postal_code);
  if (!point) {
    const repli = [c.postal_code, c.city].filter((v) => typeof v === 'string' && v.trim()).join(' ');
    if (repli) point = await geocodeCity(repli, false, c.postal_code);
  }
  if (!point) return null;
  const { error } = await supabase
    .from('leads')
    .update({ latitude: point.lat, longitude: point.lng, geocoded_at: new Date().toISOString() } as never)
    .eq('id', leadId);
  if (error) {
    console.warn('[geolocalisation] écriture refusée pour', leadId, error.message);
    return null;
  }
  return point;
}

/** Une fiche a une adresse mais pas encore de coordonnées. */
export function ficheALocaliser(row: { latitude?: number | null; longitude?: number | null; company?: unknown }): boolean {
  return (row.latitude == null || row.longitude == null) && !!adresseComplete(row.company);
}
