import React, { useState } from 'react';
import { ShieldAlert, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string; details?: string } | null>(null);

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          // Portées Google Workspace demandées dès la connexion (Drive, Gmail, Agenda) —
          // un seul système d'authentification : Supabase.
          scopes: [
            'https://www.googleapis.com/auth/drive.file',
            // gmail.modify (et non gmail.readonly, insuffisant) : nécessaire
            // pour marquer lu/non lu, déplacer vers spam/corbeille — ces
            // actions échouaient silencieusement ("insufficient
            // authentication scopes") avec la seule portée readonly.
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.send',
            // Lecture seule de la signature Gmail de l'utilisateur (Paramètres
            // > Voir tous les paramètres > Signature côté Gmail), pour la
            // reprendre automatiquement dans les messages rédigés depuis
            // l'app — chaque utilisateur garde SA propre signature.
            'https://www.googleapis.com/auth/gmail.settings.basic',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
          ].join(' '),
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (signInError) {
        throw signInError;
      }
    } catch (err: unknown) {
      console.error('Erreur connexion Google via Supabase :', err);

      const supabaseError = err as { code?: string; message?: string; name?: string; status?: number };
      const code = supabaseError?.code || supabaseError?.name || 'auth/unknown';
      const rawMessage = supabaseError?.message || String(err);

      if (rawMessage.includes('popup') || code === 'AuthApiError' || code === 'auth/popup-blocked') {
        setError({
          code,
          message: 'Le navigateur a bloqué la fenêtre de connexion Google.',
          details: 'Veuillez autoriser les pop-ups ou ouvrir cette page dans un nouvel onglet pour continuer.',
        });
      } else if (code === 'AuthApiError' || rawMessage.toLowerCase().includes('domain')) {
        setError({
          code,
          message: 'Domaine non autorisé dans Supabase Auth.',
          details: `Le domaine actuel (${currentHost}) doit être ajouté dans Supabase Dashboard > Authentication > URL Configuration > Site URL et Redirect URLs.`,
        });
      } else {
        setError({
          code,
          message: 'Échec de la connexion avec Google.',
          details: `${code}: ${rawMessage}`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOpenNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#030d0f] bg-radial-at-t from-[#0a2528] via-[#030d0f] to-[#010607] flex flex-col justify-center p-4 sm:p-6 select-none">
      <div className="max-w-xl w-full mx-auto my-auto p-6 sm:p-8 rounded-3xl bg-[#0b1c1e] border border-[#143c3f]/80 shadow-2xl relative overflow-hidden animate-slide-up">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#F7BC5F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center space-y-3 mb-8 flex flex-col items-center">
          <img
            src="/nova-mascotte.png"
            alt="Nova CRM"
            className="w-20 h-20 object-contain mb-1"
            referrerPolicy="no-referrer"
          />

          <h1 className="text-3xl font-extrabold tracking-tight text-white font-sans">
            Nova<span className="text-[#F7BC5F]">CRM</span>
          </h1>

          <p className="text-sm text-slate-300">
            Plateforme CRM Conseils Finances, ImmoSphera, NovaVisio
          </p>

          {/* Publication Google (vérification OAuth) : la page d'accueil doit
              dire ce que fait l'application et à quoi servent les accès
              Google demandés, et renvoyer vers la politique de
              confidentialité (voir public/confidentialite.html). */}
          <p className="text-xs text-slate-400">
            Outil interne de gestion de la relation client : prospects, dossiers, rendez-vous, documents et
            messagerie. Avec votre accord, il utilise votre Gmail, votre Google Drive et votre Google Agenda
            pour envoyer vos e-mails, ranger vos documents et afficher vos rendez-vous.
          </p>

          <p className="text-xs text-slate-400">
            Connectez-vous avec votre compte Google professionnel.
          </p>
        </div>

        {error && (
          <div className="p-4 mb-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs space-y-3 leading-relaxed">
            <div className="flex gap-2.5 items-start font-bold text-rose-300">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error.message}</span>
            </div>
            {error.details && (
              <p className="text-slate-300 text-[11px] pl-6 border-l border-rose-500/30">
                {error.details}
              </p>
            )}
            <div className="pt-2 pl-6 flex flex-wrap gap-2">
              <button
                onClick={handleOpenNewTab}
                className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ouvrir en Plein Écran (Nouvel Onglet)
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full h-12 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm transition-all duration-200 flex items-center justify-center gap-3 shadow-xl hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.69c-.29 1.5-.1.3-1.14 2.21l3.3 2.56c1.93-1.78 3.04-4.4 3.04-7.62z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.3-2.56c-.92.62-2.1 1-3.63 1-3.14 0-5.8-2.12-6.75-4.97H1.02v2.54C3.01 20.35 7.18 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.25 14.56a7.22 7.22 0 0 1 0-4.62V7.4H1.02a11.95 11.95 0 0 0 0 9.2l4.23-2.04z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.18 0 3.01 3.65 1.02 8.02l4.23 3.33c.95-2.85 3.61-4.97 6.75-4.97z"
              />
            </svg>

            {loading ? 'Connexion Google...' : 'Se connecter avec Google'}
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          L'accès à Nova CRM est réservé aux utilisateurs autorisés.
        </p>
        <p className="text-center text-[11px] text-slate-500 mt-2">
          <a href="/confidentialite.html" className="underline hover:text-slate-300">Politique de confidentialité</a>
          {' · '}
          <a href="/conditions.html" className="underline hover:text-slate-300">Conditions d'utilisation</a>
        </p>
      </div>

      <div className="text-center font-mono text-[10px] text-slate-500">
        © 2026 Nova CRM — Professionnel Multi-Agences
      </div>
    </div>
  );
}
