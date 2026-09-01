import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface AssignableUser {
  id: string;
  name: string;
}

/**
 * Collaborateurs auxquels on peut réellement attribuer un contact.
 *
 * Les listes d'attribution étaient alimentées par `src/data/teamMembers.ts`,
 * un fichier figé dans le code : sur ses 16 personnes, 11 n'avaient aucun
 * compte et 2 existaient sous un autre identifiant. Comme `leads.assigned_to`
 * référence `profiles`, choisir l'une d'elles faisait échouer l'enregistrement
 * avec « violates foreign key constraint "leads_assigned_to_fkey" », sans que
 * rien n'indique lesquelles étaient valides.
 *
 * La liste vient donc de la base, qui fait foi : un nom proposé ici est
 * toujours enregistrable. Elle se met à jour d'elle-même à mesure que des
 * collaborateurs sont activés depuis Équipe.
 *
 * @param agencyId Restreint aux membres de cette agence quand le rattachement
 * est renseigné dans `agency_members`. `'all'`, `undefined` ou une agence sans
 * aucun membre déclaré renvoient tout le monde — mieux vaut proposer trop que
 * bloquer l'attribution.
 */
export function useAssignableUsers(agencyId?: string): AssignableUser[] {
  const [users, setUsers] = useState<AssignableUser[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: profiles }, { data: members }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email'),
        supabase.from('agency_members').select('user_id, agency_id'),
      ]);
      if (cancelled) return;

      const scoped = !agencyId || agencyId === 'all'
        ? null
        : new Set((members || [])
            .filter((m: { agency_id: string }) => m.agency_id === agencyId)
            .map((m: { user_id: string }) => m.user_id));

      const rows = (profiles || [])
        .filter((p: { id: string }) => !scoped || scoped.size === 0 || scoped.has(p.id))
        .map((p: { id: string; full_name: string | null; email: string | null }) => ({
          id: p.id,
          name: p.full_name || p.email || 'Membre',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      setUsers(rows);
    })().catch((error) => {
      console.error('Impossible de charger les collaborateurs attribuables :', error);
      if (!cancelled) setUsers([]);
    });
    return () => { cancelled = true; };
  }, [agencyId]);

  return users;
}
