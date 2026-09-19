import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePushNotifications } from '@/hooks/use-push-notifications';

// Demandé (19/09/2026) : « quand les personnes n'ont pas les notifications
// activées, peut-on leur mettre un pop-up leur indiquant de bien les
// activer » — la mécanique d'activation existait déjà (bouton "Activer les
// alertes" dans Rappels & Alertes / Paramètres, voir usePushNotifications),
// mais rien n'y renvoyait ceux qui ne l'avaient jamais trouvé. Ce pop-up
// réutilise le même hook, ne réinvente aucune logique de notification.
//
// Une fois par connexion (rechargement de page), pas plus : fermé, il ne
// revient pas tant que la session dure, pour ne pas harceler quelqu'un qui a
// délibérément décliné.
export const EnablePushPrompt = () => {
  const { currentUser } = useAuth();
  const { supported, permission, subscribed, busy, checking, subscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [currentUser?.uid]);

  if (!currentUser || !supported || checking || dismissed) return null;
  // `denied` : l'utilisateur a déjà explicitement refusé au niveau du
  // navigateur — un pop-up applicatif ne peut plus rien redemander (seul un
  // réglage manuel du navigateur/téléphone le peut), l'afficher quand même
  // ne ferait que pointer vers un bouton qui échouera à nouveau.
  if (permission !== 'default' || subscribed) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Activer les notifications"
    >
      <div className="relative bg-[#0E1A20] border border-white/10 rounded-2xl max-w-sm w-full p-6 text-white shadow-xl">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 text-slate-400 hover:text-white p-1"
          aria-label="Fermer"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 flex items-center justify-center mb-4">
          <Bell className="w-6 h-6 text-[#F7BC5F]" />
        </div>
        <h2 className="text-base font-bold mb-1.5">Activez les notifications</h2>
        <p className="text-sm text-slate-400 mb-5">
          Sans elles, vous ne serez pas prévenu(e) des nouveaux messages ou tâches en dehors de l'application. Ça ne prend qu'un instant.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:bg-white/5"
          >
            Plus tard
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await subscribe();
              if (ok) setDismissed(true);
            }}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-40 text-slate-950"
          >
            {busy ? 'Activation…' : 'Activer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnablePushPrompt;
