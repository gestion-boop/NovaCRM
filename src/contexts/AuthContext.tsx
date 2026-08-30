// Shim de compatibilité : le module ImmoSphera 360 (importé depuis ConnectSphere
// CRM) attend un hook `useAuth()` à ce chemin, avec une forme différente de
// celle utilisée nativement par cette application (@/context/AuthContext,
// singulier). On adapte ici l'un vers l'autre plutôt que de réécrire tout le
// module ImmoSphera.
import { useAuth as useNovaSphereAuth } from '@/context/AuthContext';
import { AGENCIES } from '@/types';

export function useAuth() {
  const { currentUser, userProfile, activeAgency, authLoading } = useNovaSphereAuth();

  const user = currentUser
    ? {
        id: currentUser.uid,
        email: currentUser.email,
        user_metadata: {
          full_name: currentUser.displayName,
          avatar_url: currentUser.photoURL,
        },
      }
    : null;

  const isSuperAdmin = userProfile?.role === 'super_admin';

  // `activeAgency` de cette app est déjà { id, name, ... } — on l'expose tel
  // quel ; `useImmoAuth` (module ImmoSphera) sait s'en contenter en absence
  // de `agencies` (liste complète), via un repli sur [activeAgency].
  const resolvedAgency = activeAgency && activeAgency.id !== 'all' ? activeAgency : AGENCIES[0];

  return {
    user,
    agencies: undefined,
    activeAgency: resolvedAgency,
    isSuperAdmin,
    // Pas de notion de "stagiaire" dans cette app : tout membre ayant accès
    // au module (agence ImmoSphera ou super admin) peut gérer les biens.
    isIntern: false,
    loading: authLoading,
  };
}
