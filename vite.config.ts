import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
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
        JSON.stringify({ version, builtAt: now.toISOString() }, null, 2)
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
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
