import { createClient } from '@supabase/supabase-js';

const rawUrl =
  (import.meta.env && (import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL)) ||
  'https://rbzizzzvitxwnfygdpzo.supabase.co';

export const SUPABASE_URL = rawUrl.startsWith('http')
  ? rawUrl
  : 'https://rbzizzzvitxwnfygdpzo.supabase.co';

// SÉCURITÉ — CRITIQUE : ce fichier est bundlé et servi au navigateur de
// TOUT visiteur. Une clé service_role (qui contourne intégralement le RLS)
// ne doit JAMAIS y apparaître, même comme fallback "jamais utilisé en
// pratique" — sa simple PRÉSENCE en texte dans le bundle JS public suffit à
// la rendre récupérable par n'importe qui (confirmé : elle a été retrouvée
// ainsi, bien que jamais réellement utilisée à l'exécution — la clé
// publique/anon était toujours correctement résolue en premier). Seule une
// clé anon/publishable (protégée par le RLS, conçue pour être publique) a
// sa place ici.
export const SUPABASE_KEY =
  (import.meta.env && (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)) ||
  'sb_publishable_r52O9kfqIgezyFI8mQZuPQ_xi0Nq8g8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
