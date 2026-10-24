import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Agency, AGENCIES } from '@/types';

export interface CustomAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isSuperAdmin?: boolean;
}

interface AuthContextType {
  currentUser: User | CustomAuthUser | null;
  activeAgency: Agency;
  setActiveAgency: (agency: Agency) => void;
  authLoading: boolean;
  loginAsSuperAdmin: () => void;
  loginAsDemo: () => void;
  logout: () => void;
}

const SUPER_ADMIN_USER: CustomAuthUser = {
  uid: 'superadmin-sylvain-grazia',
  email: 's.grazia@conseilfinances.fr',
  displayName: 'Sylvain Grazia',
  photoURL: undefined,
  isSuperAdmin: true,
};

const DEMO_USER: CustomAuthUser = {
  uid: 'demo-user-novasphere',
  email: 's.grazia@conseilfinances.fr',
  displayName: 'Sylvain Grazia (Super Admin Démo)',
  photoURL: undefined,
  isSuperAdmin: true,
};

export const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  activeAgency: AGENCIES[0],
  setActiveAgency: () => {},
  authLoading: true,
  loginAsSuperAdmin: () => {},
  loginAsDemo: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | CustomAuthUser | null>(() => {
    // Check if explicitly logged out
    const isLoggedOut = localStorage.getItem('novasphere_logged_out') === 'true';
    if (isLoggedOut) return null;

    // Check saved custom user
    const savedCustomUser = localStorage.getItem('novasphere_custom_user');
    if (savedCustomUser) {
      try {
        return JSON.parse(savedCustomUser);
      } catch (e) {
        console.error("Failed to parse saved custom user:", e);
      }
    }

    // Default to Sylvain GRAZIA Super Admin
    return SUPER_ADMIN_USER;
  });

  const [activeAgency, setActiveAgency] = useState<Agency>(AGENCIES[0]);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        localStorage.removeItem('novasphere_custom_user');
        localStorage.removeItem('novasphere_logged_out');
      } else {
        const isLoggedOut = localStorage.getItem('novasphere_logged_out') === 'true';
        if (isLoggedOut) {
          setCurrentUser(null);
        } else {
          const custom = localStorage.getItem('novasphere_custom_user');
          if (custom) {
            try {
              setCurrentUser(JSON.parse(custom));
            } catch (e) {
              console.error(e);
              setCurrentUser(SUPER_ADMIN_USER);
            }
          } else {
            setCurrentUser(SUPER_ADMIN_USER);
          }
        }
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginAsSuperAdmin = () => {
    setCurrentUser(SUPER_ADMIN_USER);
    localStorage.setItem('novasphere_custom_user', JSON.stringify(SUPER_ADMIN_USER));
    localStorage.removeItem('novasphere_logged_out');
  };

  const loginAsDemo = () => {
    setCurrentUser(DEMO_USER);
    localStorage.setItem('novasphere_custom_user', JSON.stringify(DEMO_USER));
    localStorage.removeItem('novasphere_logged_out');
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem('novasphere_custom_user');
    localStorage.setItem('novasphere_logged_out', 'true');
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        activeAgency,
        setActiveAgency,
        authLoading,
        loginAsSuperAdmin,
        loginAsDemo,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

