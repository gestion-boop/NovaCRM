import React, { useEffect, useRef, useState } from 'react';
import { Link2Off, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { hydrateAccessTokenFromSession, isGoogleWorkspaceConnected, reconnectGoogleWorkspace, traiterRetourConnexionGoogle } from '@/lib/workspace';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SNOOZE_MS = 30 * 60 * 1000; // 30 minutes ("Plus tard")

/**
 * Ticket #117 : "je dois très souvent me reconnecter avec Google" — le
 * jeton Google (Gmail/Drive/Agenda) expire ~1h après connexion, et Supabase
 * ne le renouvelle jamais tout seul (il faudrait le "Client Secret" Google,
 * que seul Supabase détient, jamais exposé à cette appli). Sans ce bandeau,
 * la coupure ne se découvrait qu'en pleine action (envoi d'un mail, synchro
 * agenda...), avec un message d'erreur sec au milieu d'autre chose. Ici, on
 * la détecte en amont et on propose la reconnexion en un clic, avant que ça
 * casse quoi que ce soit.
 */
export default function GoogleWorkspaceStatus() {
  const { currentUser } = useAuth();
  const [visible, setVisible] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const snoozedUntilRef = useRef<number>(0);

  useEffect(() => {
    if (!currentUser) {
      setVisible(false);
      return;
    }

    let cancelled = false;

    // Retour de l'écran d'autorisation Google de la société : on le dit, et
    // on ne rouvre pas le bandeau dans la foulée.
    const retour = traiterRetourConnexionGoogle();
    if (retour?.statut === 'connecte') {
      toast.success('Google Workspace connecté : Gmail, Drive et Agenda sont prêts.');
      setVisible(false);
      snoozedUntilRef.current = Date.now() + 60 * 1000;
    } else if (retour?.statut === 'erreur') {
      toast.error(`Connexion Google : ${retour.message}`, { duration: 12000 });
    }

    const check = async () => {
      if (Date.now() < snoozedUntilRef.current) return;
      // Essaie d'abord de réhydrater depuis la session déjà persistée
      // (silencieux, pas de redirection) avant de conclure à une coupure.
      await hydrateAccessTokenFromSession();
      const connected = await isGoogleWorkspaceConnected();
      if (!cancelled) setVisible(!connected);
    };

    // Premier contrôle différé de quelques secondes (laisse le temps à la
    // session Supabase de finir de se charger au démarrage de l'app).
    const initialTimer = setTimeout(check, 4000);
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentUser]);

  const handleLater = () => {
    setVisible(false);
    snoozedUntilRef.current = Date.now() + SNOOZE_MS;
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await reconnectGoogleWorkspace();
      // signInWithOAuth redirige la page — si on arrive quand même ici,
      // c'est qu'il y a eu une erreur avant la redirection.
    } catch {
      setReconnecting(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[200] max-w-sm w-[calc(100vw-3rem)] sm:w-96 animate-fade-in">
      <div className="bg-[#07191b] border border-orange-500/40 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400 shrink-0">
          <Link2Off className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Connexion Google à renouveler</p>
          <p className="text-xs text-slate-400 mt-0.5">
            L'accès à Gmail, Drive et l'agenda a expiré. Reconnectez-vous pour continuer à les utiliser.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="px-3 py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reconnecting ? 'animate-spin' : ''}`} />
              {reconnecting ? 'Reconnexion...' : 'Reconnecter Google'}
            </button>
            <button
              onClick={handleLater}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 font-semibold text-xs"
            >
              Plus tard
            </button>
          </div>
        </div>
        <button onClick={handleLater} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0" title="Fermer">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
