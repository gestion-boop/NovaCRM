import { createContext, useContext, useCallback, useEffect, useState, ReactNode } from "react";

type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
};

const SidebarCtx = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
});

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  // La sidebar doit toujours être visible au chargement sur tablette / ordinateur.
  // On ne relit plus localStorage, car une ancienne valeur "collapsed=true" pouvait
  // masquer définitivement la barre latérale gauche sur l'accueil.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      localStorage.removeItem("sidebar-collapsed-v1");
      localStorage.removeItem("sidebar-collapsed-v2");
      localStorage.removeItem("sidebar-collapsed");
    } catch {}
  }, []);

  useEffect(() => {
    const forceOpenOnDesktop = () => {
      if (window.innerWidth >= 640) {
        setCollapsed(false);
      }
    };

    forceOpenOnDesktop();
    window.addEventListener("resize", forceOpenOnDesktop);

    return () => window.removeEventListener("resize", forceOpenOnDesktop);
  }, []);

  const open = useCallback(() => {
    setCollapsed(false);
  }, []);

  const close = useCallback(() => {
    setCollapsed(true);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((value) => !value);
  }, []);

  return <SidebarCtx.Provider value={{ collapsed, toggle, open, close }}>{children}</SidebarCtx.Provider>;
};

export const useSidebarToggle = () => useContext(SidebarCtx);
