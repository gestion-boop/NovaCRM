-- Signalé en revue (25 octobre, chasse aux bugs) : les policies de
-- 20260914160000 ciblaient melanie@immosphera.fr. Ce n'est PAS l'adresse du
-- compte de Mélanie (gestion@immosphera.fr, UID 15bcec53-de3e-40b8-8b7e-
-- bb6874836f29, voir src/lib/pipelinesAcces.ts et src/data/teamMembers.ts) —
-- seulement son adresse de contact publique sur le site (advisors.ts).
-- Conséquence pratique : Mélanie ne pouvait pas gérer les secteurs, contrai-
-- rement à la demande du 14 septembre. Conséquence de sécurité : la policy
-- accordait l'écriture/suppression de tous les secteurs à N'IMPORTE QUELLE
-- session Supabase dont l'e-mail serait exactement melanie@immosphera.fr,
-- sans aucun contrôle de rôle ni d'agence. Basculé sur son UID stable.
ALTER POLICY "melanie et super admins write secteurs" ON public.immosphera_secteurs
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role) OR auth.uid() = '15bcec53-de3e-40b8-8b7e-bb6874836f29'::uuid);

ALTER POLICY "melanie et super admins update secteurs" ON public.immosphera_secteurs
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR auth.uid() = '15bcec53-de3e-40b8-8b7e-bb6874836f29'::uuid)
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role) OR auth.uid() = '15bcec53-de3e-40b8-8b7e-bb6874836f29'::uuid);

ALTER POLICY "melanie et super admins delete secteurs" ON public.immosphera_secteurs
  USING (has_role(auth.uid(), 'super_admin'::app_role) OR auth.uid() = '15bcec53-de3e-40b8-8b7e-bb6874836f29'::uuid);
