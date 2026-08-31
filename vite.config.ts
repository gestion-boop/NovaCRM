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
