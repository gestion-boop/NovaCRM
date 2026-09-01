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
      const version = now.toISOString().replace(/[-:]/g, "").slice(0, 13); // ex: 20260820T0735
      fs.writeFileSync(
        path.resolve(__dirname, "dist/version.json"),
        JSON.stringify({ version, builtAt: now.toISOString(), ref: BUILD_INFO.ref, sha: BUILD_INFO.sha }, null, 2)
      );
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
}));
