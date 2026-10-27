import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";

// Écrit dist/version.json avec un identifiant unique à CE build, pour que le
// bandeau "mise à jour disponible" (UpdateBanner) puisse détecter un nouveau
// déploiement en comparant la version chargée par le client à celle servie
// par le serveur (fetchée périodiquement, cache-bustée).
function writeVersionFile() {
  return {
    name: "write-version-json",
    writeBundle() {
      const now = new Date();
      const version = `${BUILD_INFO.sha && BUILD_INFO.sha !== 'inconnu' ? BUILD_INFO.sha : 'v'}-${now.getTime()}`;
      const payload = JSON.stringify(
        {
          version,
          builtAt: now.toISOString(),
          ref: BUILD_INFO.ref,
          sha: BUILD_INFO.sha,
        },
        null,
        2
      );
      fs.writeFileSync(path.resolve(__dirname, "dist/version.json"), payload);
      try {
        fs.writeFileSync(path.resolve(__dirname, "public/version.json"), payload);
      } catch {
        /* ignore */
      }
    },
  };
}

// Identité du build, figée dans le paquet JavaScript lui-même (et non lue à
// l'exécution) : la ligne affichée dans le menu décrit donc le code RÉELLEMENT
// en train de tourner dans le navigateur, cache et service worker compris.
// C'est le seul moyen fiable de répondre à « est-ce que ma mise à jour est
// bien arrivée ? » sans avoir à deviner entre la branche, le déploiement et
// le cache. Sur Vercel, la branche et le commit viennent de l'environnement
// de build ; en local, de git.
const gitOrEnv = (envVar: string, command: string): string => {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

const BUILD_INFO = {
  ref: gitOrEnv("VERCEL_GIT_COMMIT_REF", "git rev-parse --abbrev-ref HEAD") || "local",
  sha: gitOrEnv("VERCEL_GIT_COMMIT_SHA", "git rev-parse HEAD").slice(0, 7) || "inconnu",
  at: new Date().toISOString(),
};

export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_INFO__: JSON.stringify(BUILD_INFO),
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    mode !== 'development' && writeVersionFile(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Découpage par bibliothèque (31/08/2026). Les écrans sont déjà
        // chargés à la demande (React.lazy dans App.tsx) ; il restait un
        // paquet d'entrée de 1,3 Mo mêlant le code de l'application et ses
        // dépendances. Les séparer a deux effets : le navigateur les
        // télécharge en parallèle, et surtout il les GARDE en cache d'un
        // déploiement à l'autre — seul le code applicatif, qui change, est
        // retéléchargé. C'est ce qui compte pour une équipe qui reçoit
        // plusieurs mises à jour par jour.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-dom') || /node_modules\/react\//.test(id)) return 'vendor-react';
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('date-fns')) return 'vendor-dates';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          return undefined;
        },
      },
    },
  },
}));
