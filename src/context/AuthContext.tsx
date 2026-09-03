import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import { Agency, AGENCIES } from '@/types';
import { supabase } from '@/lib/supabase';
import { adopterJetonDeSession, connectGoogleWorkspaceTokens } from '@/lib/workspace';

const SUPER_ADMIN_EMAIL = 's.grazia@conseilfinances.fr';
const REAL_AGENCY_IDS = AGENCIES.filter((agency) => agency.id !== 'all').map((agency) => agency.id);
const CACHE_KEY = 'novasphere_user_profile_cache';

type AppCurrentUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  getIdToken: () => Promise<string>;
};

export type NovaSphereRole = 'super_admin' | 'admin' | 'manager' | 'agent' | 'user' | 'intern' | 'client_guest';

export interface NovaSphereUserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  phone?: string;
  jobTitle?: string;
  role: NovaSphereRole;
  agencyIds: string[];
  primaryAgencyId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // Ticket "Rôle Stagiaire" (phase 2) : durée d'accès — `internEndsAt`
  // réutilise `user_roles.expires_at` (générique, déjà existant),
  // `internStartsAt`/`internResponsableId` viennent de `intern_details`.
  internStartsAt?: string | null;
  internEndsAt?: string | null;
  internResponsableId?: string | null;
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (5/16) : modules
  // additionnels ouverts par l'admin (Accueil + pipeline toujours inclus).
  internAllowedModules?: string[];
}

interface AuthContextType {
  currentUser: AppCurrentUser | null;
  userProfile: NovaSphereUserProfile | null;
  activeAgency: Agency;
  setActiveAgency: (agency: Agency) => void;
  authLoading: boolean;
  accessDenied: boolean;
  // Ticket "Rôle Stagiaire" (phase 2) : distinct de `accessDenied` (compte
  // désactivé) — ici le compte reste actif, seule la fenêtre de dates n'est
  // pas encore/plus ouverte. Message exact à afficher, ou null sinon.
  internGateMessage: string | null;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userProfile: null,
  activeAgency: AGENCIES[0],
  setActiveAgency: () => {},
  authLoading: true,
  accessDenied: false,
  internGateMessage: null,
  logout: async () => {},
});

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || '';
}

// Signalé : un utilisateur membre de plusieurs agences (ex. Mélanie,
// membre des 3) atterrissait systématiquement sur la première de la liste
// (Conseils Finances) au lieu de celle qui correspond à sa propre adresse
// e-mail (@immosphera.fr → Immosphera) — l'ordre venait simplement de
// l'ordre d'insertion en base, sans rapport avec l'agence réelle de
// l'utilisateur. On préfère désormais l'agence dont le domaine de
// l'adresse mail correspond, parmi celles dont il est membre.
function agencyIdMatchingEmailDomain(email: string | null | undefined, candidateIds: string[]): string | undefined {
  const domain = String(email ?? '').toLowerCase().split('@').pop() ?? '';
  if (!domain) return undefined;
  const nameMatch = (name: string) => domain === name || domain.endsWith(`.${name}`);
  const matched = AGENCIES.find((a) => {
    if (!candidateIds.includes(a.id)) return false;
    const n = a.name.toLowerCase().replace(/\s+/g, '');
    if (n.includes('immosphera') && (nameMatch('immosphera.fr') || domain.includes('immosphera'))) return true;
    if (n.includes('novavisio') && (nameMatch('novavisio.fr') || domain.includes('novavisio'))) return true;
    if ((n.includes('conseil') || n.includes('finance')) && (nameMatch('conseilfinances.fr') || domain.includes('conseilfinance'))) return true;
    return false;
  });
  return matched?.id;
}

function getAgencyById(agencyId: string | undefined): Agency | undefined {
  if (!agencyId) return undefined;
  return AGENCIES.find((agency) => agency.id === agencyId);
}

// Signalé : "quand on est dans une agence en tant qu'admin, il faut y
// rester tant qu'on ne change pas via le sélecteur" — l'agence active
// repartait pourtant sur l'agence "préférée" du profil à chaque
// resynchronisation en arrière-plan (retour d'onglet, jeton renouvelé...),
// écrasant silencieusement le choix manuel fait via le sélecteur. Le choix
// manuel est maintenant mémorisé ici et prioritaire sur l'agence préférée
// tant qu'il reste valide pour ce compte.
const ACTIVE_AGENCY_STORAGE_KEY = 'novasphere_active_agency_id';

function getStoredActiveAgencyId(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_AGENCY_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function storeActiveAgencyId(agencyId: string) {
  try {
    localStorage.setItem(ACTIVE_AGENCY_STORAGE_KEY, agencyId);
  } catch {
    // ignore
  }
}

// Résout l'agence à utiliser à la (re)connexion : le choix manuel
// mémorisé s'il est toujours valide pour ce compte (accessible ou super
// admin), sinon l'agence préférée du profil.
function resolveActiveAgency(preferredAgencyId: string | undefined, accessibleAgencyIds: string[] | 'all'): Agency | undefined {
  const storedId = getStoredActiveAgencyId();
  if (storedId) {
    const storedAgency = getAgencyById(storedId);
    const isAccessible = accessibleAgencyIds === 'all' || accessibleAgencyIds.includes(storedId);
    if (storedAgency && isAccessible) return storedAgency;
  }
  return getAgencyById(preferredAgencyId);
}

function saveProfileToLocalCache(profile: NovaSphereUserProfile) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

function getProfileFromLocalCache(uid: string): NovaSphereUserProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NovaSphereUserProfile;
    if (parsed && parsed.uid === uid) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function clearProfileLocalCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

function toAppUser(sessionUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null): AppCurrentUser | null {
  if (!sessionUser) return null;

  return {
    uid: sessionUser.id,
    email: sessionUser.email ?? null,
    displayName:
      typeof sessionUser.user_metadata?.full_name === 'string'
        ? sessionUser.user_metadata.full_name
        : typeof sessionUser.user_metadata?.name === 'string'
          ? sessionUser.user_metadata.name
          : sessionUser.email ?? null,
    photoURL:
      typeof sessionUser.user_metadata?.avatar_url === 'string'
        ? sessionUser.user_metadata.avatar_url
        : typeof sessionUser.user_metadata?.picture === 'string'
          ? sessionUser.user_metadata.picture
          : null,
    // Signalé (« Session invalide ou expirée » dans Paramètres, Annonces...) :
    // `getSession()` renvoyait tel quel le jeton en cache, y compris quand il
    // avait expiré — le rafraîchissement automatique de Supabase repose sur
    // un timer JS qui ne tourne pas forcément si l'onglet est resté en
    // arrière-plan longtemps ou l'ordinateur en veille. On vérifie donc
    // l'expiration ici et on force un `refreshSession()` si besoin, au lieu
    // de forcer l'utilisateur à se déconnecter/reconnecter pour réparer ça.
    getIdToken: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      let session = data.session;
      if (!session) throw new Error('Aucune session Supabase active.');

      const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
      const isExpiringSoon = expiresAt > 0 && expiresAt - Date.now() < 60_000;
      const isAlreadyExpired = expiresAt > 0 && expiresAt <= Date.now();

      if (isExpiringSoon) {
        // Ticket #45 : le rafraîchissement pouvait échouer pour une raison
        // purement transitoire (réseau, ou une course avec le rafraîchissement
        // automatique en arrière-plan de Supabase qui vient de faire tourner
        // le refresh token) — dans ce cas le jeton ACTUEL n'a pourtant pas
        // encore expiré (on est juste dans la marge de 60s de précaution) et
        // reste parfaitement valide pour cette requête. On ne fait donc
        // échouer l'action de l'utilisateur ("Session invalide ou expirée")
        // que si le jeton est réellement expiré ET le rafraîchissement a
        // échoué — sinon on retombe sur le jeton actuel, encore valable.
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshed.session) {
          console.warn('[AuthContext] Rafraîchissement de session échoué, retombe sur le jeton actuel :', refreshError);
          if (isAlreadyExpired) {
            throw new Error('Session invalide ou expirée. Merci de vous reconnecter.');
          }
        } else {
          session = refreshed.session;
        }
      }

      return session.access_token;
    },
  };
}

function buildSuperAdminProfile(user: AppCurrentUser): NovaSphereUserProfile {
  const now = new Date().toISOString();
  return {
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName: user.displayName?.trim() || 'Sylvain Grazia',
    photoURL: user.photoURL || null,
    role: 'super_admin',
    agencyIds: REAL_AGENCY_IDS,
    primaryAgencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    active: true,
    // Bug découvert en testant le ticket #241 : `createdAt` était fixé à
    // "maintenant" à CHAQUE connexion (au lieu de la vraie date de création
    // du compte), ce qui filtrait silencieusement TOUTES les annonces
    // (bandeau AnnouncementBanner) pour le compte super-admin, quelle que
    // soit leur ancienneté — la condition "n'affiche pas les annonces
    // antérieures à la création du compte" les excluait donc toutes. Une
    // date fixe très ancienne évite ce filtrage sans avoir à connaître la
    // vraie date de création ici (ce profil est construit en synchrone,
    // avant tout appel réseau).
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: now,
  };
}

function buildProfileFromSupabaseUser(user: AppCurrentUser, data?: Record<string, unknown> | null): NovaSphereUserProfile {
  const now = new Date().toISOString();
  const agencyIds = Array.isArray(data?.agencyIds)
    ? data.agencyIds.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    uid: user.uid,
    email: normalizeEmail(user.email),
    displayName:
      typeof data?.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim()
        : user.displayName?.trim() || normalizeEmail(user.email),
    photoURL: typeof data?.photoURL === 'string' ? data.photoURL : user.photoURL || null,
    role: data?.role === 'super_admin' || data?.role === 'admin' || data?.role === 'manager' || data?.role === 'agent' || data?.role === 'user' || data?.role === 'intern' || data?.role === 'client_guest' ? String(data.role) as NovaSphereRole : 'user',
    agencyIds,
    primaryAgencyId: typeof data?.primaryAgencyId === 'string' ? data.primaryAgencyId : agencyIds[0],
    active: data?.active === true,
    createdAt: typeof data?.createdAt === 'string' ? data.createdAt : now,
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : now,
    internStartsAt: typeof data?.internStartsAt === 'string' ? data.internStartsAt : null,
    internEndsAt: typeof data?.internEndsAt === 'string' ? data.internEndsAt : null,
    internResponsableId: typeof data?.internResponsableId === 'string' ? data.internResponsableId : null,
    internAllowedModules: Array.isArray(data?.internAllowedModules) ? data.internAllowedModules.filter((m: unknown) => typeof m === 'string') : [],
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppCurrentUser | null>(null);
  const [userProfile, setUserProfile] = useState<NovaSphereUserProfile | null>(null);
  const [activeAgency, setActiveAgency] = useState<Agency>(AGENCIES[0]);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [internGateMessage, setInternGateMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    // Bug (remonté par Mélanie) : `syncSession()` est ré-exécuté à chaque
    // `onAuthStateChange` — y compris un simple `TOKEN_REFRESHED` que
    // Supabase déclenche automatiquement au retour de focus sur l'onglet.
    // Comme il remettait systématiquement `authLoading` à true, et que
    // App.tsx affiche un plein écran "Chargement..." tant que c'est true,
    // toute l'app était démontée et remplacée par le spinner à chaque
    // retour d'onglet — perçu comme un rafraîchissement complet de la
    // page. On ne montre ce plein écran qu'au tout premier chargement (pas
    // encore de session connue) ; les resynchronisations en arrière-plan
    // (token rafraîchi alors qu'on est déjà connecté) mettent à jour le
    // profil silencieusement, sans jamais redémonter l'app.
    let hasLoadedOnce = false;

    const syncSession = async () => {
      const isFirstLoad = !hasLoadedOnce;
      hasLoadedOnce = true;
      if (isFirstLoad) setAuthLoading(true);
      setAccessDenied(false);
      setInternGateMessage(null);

      const { data: { session }, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.error('[AuthContext] Erreur session Supabase:', error);
        setCurrentUser(null);
        setUserProfile(null);
        setAuthLoading(false);
        return;
      }

      const sessionUser = session?.user ?? null;
      const appUser = toAppUser(sessionUser);

      if (!appUser || !session) {
        setCurrentUser(null);
        setUserProfile(null);
        setAuthLoading(false);
        return;
      }

      // Ticket #23 (nouvelle base) : `provider_token` (Google) n'était mis en
      // cache que par un appel explicite plus tard (souvent jamais fait tant
      // que rien ne le déclenchait) — l'agenda et les autres écrans liés à
      // Google Workspace repartaient donc vides à chaque rechargement. On le
      // récupère ici, dès que la session est valide, une fois pour toutes.
      // Depuis le 2 septembre, la connexion ne demande que l'identité : ce
      // jeton n'est adopté que s'il porte réellement Gmail/Drive/Agenda
      // (ancienne connexion complète, sociétés pas encore passées en
      // application interne) — voir adopterJetonDeSession.
      void adopterJetonDeSession(session);
      // Ticket #117 : capte le refresh_token Google (présent uniquement
      // juste après l'échange OAuth initial) et l'enregistre côté serveur
      // pour un renouvellement automatique indéfini — plus jamais besoin de
      // reconnexion manuelle après la première connexion.
      void connectGoogleWorkspaceTokens(session);

      const email = normalizeEmail(appUser.email);
      if (!email) {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setUserProfile(null);
        setAccessDenied(true);
        setAuthLoading(false);
        return;
      }

      const cachedLocal = getProfileFromLocalCache(appUser.uid);
      // Audit démarrage lent (30/08/2026, "5 secondes... jamais fluide" au
      // lancement mobile, même mis en cache) : ce profil en cache local
      // n'était utilisé qu'en REPLI, en cas d'échec réseau (catch plus
      // bas) — jamais pour débloquer l'affichage tout de suite. Concrètement,
      // à CHAQUE lancement, même avec ce même appareil/compte déjà connu,
      // le plein écran "Chargement de Nova CRM..." (App.tsx) restait affiché
      // le temps d'un aller-retour getSession() PUIS un second aller-retour
      // séquentiel vers /api/settings/bootstrap — sur réseau cellulaire, ça
      // s'additionne facilement à plusieurs secondes (voir aussi le
      // correctif de mise en cache des assets /assets/* dans vercel.json,
      // même audit). On affiche maintenant CE profil immédiatement
      // (stale-while-revalidate) et on débloque l'app tout de suite ; la
      // vérification réseau ci-dessous continue normalement en arrière-plan
      // et remplace silencieusement ce profil par la version à jour dès
      // qu'elle arrive (rôle, agences, désactivation... tout reste
      // revérifié, juste sans jamais bloquer l'affichage pour ça).
      if (cachedLocal && cachedLocal.active) {
        setCurrentUser(appUser);
        setUserProfile(cachedLocal);
        const resolvedAgency = resolveActiveAgency(cachedLocal.primaryAgencyId, cachedLocal.agencyIds ?? []);
        if (resolvedAgency) setActiveAgency(resolvedAgency);
        setAuthLoading(false);
      }
      try {
        if (email === SUPER_ADMIN_EMAIL) {
          const profile = buildSuperAdminProfile(appUser);
          saveProfileToLocalCache(profile);
          setCurrentUser(appUser);
          setUserProfile(profile);
          // Super admin : accès à toutes les agences, donc son dernier
          // choix manuel (sélecteur) reste toujours valide.
          const resolvedAgency = resolveActiveAgency(profile.primaryAgencyId, 'all');
          if (resolvedAgency) setActiveAgency(resolvedAgency);
          setAuthLoading(false);
          return;
        }

        // Résout profil + rôle + agences via /api/settings/bootstrap (clé
        // service_role côté serveur) plutôt qu'en interrogeant directement
        // Supabase depuis le client : évite toute dépendance aux policies
        // RLS de `user_roles`/`agency_members`, et surtout remplace
        // l'ancienne vérification contre la table `authorized_emails`, qui
        // n'existe plus du tout côté base (elle faisait échouer silencieu-
        // sement toute connexion sans profil déjà mis en cache localement —
        // exactement le symptôme "revient sans arrêt à l'écran de connexion
        // Google" observé en usage réel).
        const bootstrapRes = await fetch('/api/settings/bootstrap', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const bootstrapBody = await bootstrapRes.json().catch(() => ({}));
        if (!bootstrapRes.ok) {
          throw new Error(bootstrapBody?.error || `Erreur HTTP ${bootstrapRes.status}`);
        }

        const profileRow = bootstrapBody.profile;
        const profile = buildProfileFromSupabaseUser(appUser, {
          ...profileRow,
          agencyIds: bootstrapBody.agency_ids ?? [],
          displayName: profileRow?.full_name ?? appUser.displayName ?? email,
          photoURL: profileRow?.avatar_url ?? appUser.photoURL ?? null,
          role: bootstrapBody.role ?? 'user',
          primaryAgencyId:
            agencyIdMatchingEmailDomain(email, bootstrapBody.agency_ids ?? []) || bootstrapBody.agency_ids?.[0],
          active: profileRow?.is_active !== false,
          createdAt: profileRow?.created_at ?? new Date().toISOString(),
          updatedAt: profileRow?.updated_at ?? new Date().toISOString(),
          internStartsAt: bootstrapBody.internStartsAt ?? null,
          internEndsAt: bootstrapBody.internEndsAt ?? null,
          internResponsableId: bootstrapBody.internResponsableId ?? null,
          internAllowedModules: bootstrapBody.internAllowedModules ?? [],
        });

        // Ticket "Rôle Stagiaire" (phase 2) : accès temporaire — bloqué
        // avant la date de début et après la date de fin, avec les messages
        // exacts demandés. Le compte n'est jamais supprimé (juste refusé
        // temporairement), tout son historique reste intact en base.
        if (profile.role === 'intern') {
          const todayStr = new Date().toISOString().slice(0, 10);
          if (profile.internStartsAt && todayStr < profile.internStartsAt) {
            await supabase.auth.signOut();
            clearProfileLocalCache();
            setCurrentUser(null);
            setUserProfile(null);
            setAuthLoading(false);
            setInternGateMessage("Votre accès NovaSphere n'est pas encore actif.");
            return;
          }
          if (profile.internEndsAt && new Date(profile.internEndsAt).getTime() < Date.now()) {
            await supabase.auth.signOut();
            clearProfileLocalCache();
            setCurrentUser(null);
            setUserProfile(null);
            setAuthLoading(false);
            setInternGateMessage('Votre période d\'accès à NovaSphere est terminée. Contactez votre responsable si nécessaire.');
            return;
          }
        }

        if (!profile.active) {
          await supabase.auth.signOut();
          clearProfileLocalCache();
          setCurrentUser(null);
          setUserProfile(null);
          setAccessDenied(true);
          setAuthLoading(false);
          return;
        }

        saveProfileToLocalCache(profile);
        setCurrentUser(appUser);
        setUserProfile(profile);
        const resolvedAgency = resolveActiveAgency(profile.primaryAgencyId, profile.agencyIds ?? []);
        if (resolvedAgency) setActiveAgency(resolvedAgency);
        setAuthLoading(false);
      } catch (error: unknown) {
        console.error('[AuthContext] Erreur de vérification Supabase :', error);
        if (cachedLocal && cachedLocal.active) {
          setCurrentUser(appUser);
          setUserProfile(cachedLocal);
          const resolvedAgency = resolveActiveAgency(cachedLocal.primaryAgencyId, cachedLocal.agencyIds ?? []);
          if (resolvedAgency) setActiveAgency(resolvedAgency);
          setAuthLoading(false);
          return;
        }

        await supabase.auth.signOut().catch(() => {});
        clearProfileLocalCache();
        setCurrentUser(null);
        setUserProfile(null);
        setAccessDenied(true);
        setAuthLoading(false);
      }
    };

    void syncSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = toAppUser(session?.user ?? null);
      setCurrentUser(nextUser);
      if (!nextUser) {
        setUserProfile(null);
        setAuthLoading(false);
        return;
      }

      void syncSession();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      clearProfileLocalCache();
      setCurrentUser(null);
      setUserProfile(null);
      setAccessDenied(false);
    } catch (error) {
      console.error('Erreur lors de la déconnexion :', error);
    }
  };

  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (7/16) : la désactivation
  // d'un compte doit invalider ses sessions ACTIVES, pas seulement bloquer
  // une future reconnexion — un onglet déjà ouvert restait connecté jusqu'à
  // ce qu'il rafraîchisse lui-même son profil (JWT valable ~1h, aucune
  // vérification serveur entre-temps). Ce canal temps réel écoute le propre
  // profil de l'utilisateur : dès que `is_active` passe à false (admin ou
  // Nova), déconnexion forcée immédiate, quel que soit l'onglet déjà ouvert.
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel(`profile_active_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${currentUser.uid}` },
        (payload) => {
          const isActive = (payload.new as { is_active?: boolean } | null)?.is_active;
          if (isActive === false) {
            void supabase.auth.signOut().finally(() => {
              clearProfileLocalCache();
              setCurrentUser(null);
              setUserProfile(null);
              setAccessDenied(true);
            });
          }
        }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // Choix manuel via le sélecteur d'agence (Sidebar) : mémorisé pour rester
  // prioritaire sur l'agence "préférée" du profil lors des prochaines
  // resynchronisations en arrière-plan (voir resolveActiveAgency plus haut).
  const handleSetActiveAgency = (agency: Agency) => {
    setActiveAgency(agency);
    if (agency.id !== 'all') storeActiveAgencyId(agency.id);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        activeAgency,
        setActiveAgency: handleSetActiveAgency,
        authLoading,
        accessDenied,
        internGateMessage,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
