import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from './context/AuthContext'
import { rechargerSiChunkPerime } from '@/lib/chunkPerime'
import { installerStockageSecours } from '@/lib/stockageSecours'

installerStockageSecours();

const queryClient = new QueryClient();

// Fichier d'écran périmé après un déploiement (voir lib/chunkPerime.ts).
window.addEventListener('vite:preloadError', (e) => {
  if (rechargerSiChunkPerime()) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)

// Register Service Worker for PWA and Web App Badging
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('NovaSphere SW registered with scope: ', registration.scope);
      })
      .catch(err => {
        console.error('NovaSphere SW registration failed: ', err);
      });
  });
}
