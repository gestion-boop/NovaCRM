-- Lien Vendeur ↔ Acquéreur (ImmoSphera, Transactions V2), demandé le 7
-- septembre : « rattacher la fiche client acquéreur à la fiche client
-- vendeur et pouvoir naviguer entre les deux, pour éviter qu'il y ait trop
-- de cases contact dans la pipeline ». Colonne nullable, à part de
-- `master_contact_id` (déjà utilisée ailleurs pour faire porter l'identité
-- affichée d'une case du pipeline par une AUTRE fiche — la réutiliser ici
-- mélangerait les deux fiches à l'affichage). Facultatif : l'agent choisit
-- de lier ou non.
alter table public.leads
  add column if not exists linked_lead_id uuid references public.leads(id) on delete set null;

create index if not exists idx_leads_linked_lead_id on public.leads(linked_lead_id);
