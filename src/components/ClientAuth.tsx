import React, { useEffect, useState } from 'react';
import { ShieldAlert, Mail, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// Écran de connexion dédié à l'Espace Client — totalement séparé de
// Auth.tsx (celui des collaborateurs, jamais touché ici) pour ne prendre
// aucun risque de régression sur la connexion de l'équipe. Affiché par
// App.tsx quand la page est /espace-client et qu'aucune session n'est
// active (voir isClientPortalPath).
//
// Sécurité du mot de passe : jamais choisi ni connu par un admin — le
// client le crée lui-même, une fois connecté au moins une fois via le lien
// magique de son e-mail d'invitation (voir ClientGuestShell, section
// "Sécuriser mon accès"). Ici, la connexion par mot de passe n'est donc
// qu'une option pour un client qui en a DÉJÀ créé un ; sinon, le lien par
// e-mail (déjà en place, aucun mot de passe nécessaire) reste toujours
// disponible, jamais bloquant.
export default function ClientAuth() {
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  // Demande explicite : "NovaCRM Espace Client" comme identité propre à cet
  // écran, distincte de "Nova CRM" (App.tsx, réservé à l'interface équipe) —
  // celui-ci est monté comme enfant d'App, dont un autre effet a été
  // adapté pour ne jamais réécrire le titre sur /espace-client.
  useEffect(() => {
    document.title = 'NovaCRM Espace Client';
  }, []);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/espace-client` },
      });
      if (signInError) throw signInError;
    } catch (err: any) {
      setError(err?.message || 'Échec de la connexion avec Google.');
      setLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      // La session est prise en charge automatiquement par AuthContext —
      // rien d'autre à faire ici, App.tsx bascule seul vers ClientGuestShell.
    } catch (err: any) {
      setError(
        err?.message?.includes('Invalid login credentials')
          ? "E-mail ou mot de passe incorrect — ou vous n'avez pas encore créé de mot de passe (utilisez le lien par e-mail ci-dessous)."
          : err?.message || 'Échec de la connexion.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRequestLink = async () => {
    if (!email.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/clients/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-login-link', email: email.trim().toLowerCase() }),
      });
    } catch {
      // Message générique quoi qu'il arrive — voir handleRequestLoginLink côté serveur.
    } finally {
      setLinkSent(true);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030d0f] bg-radial-at-t from-[#0a2528] via-[#030d0f] to-[#010607] flex flex-col justify-center p-4 sm:p-6 select-none">
      <div className="max-w-md w-full mx-auto my-auto p-6 sm:p-8 rounded-3xl bg-[#0b1c1e] border border-[#143c3f]/80 shadow-2xl relative overflow-hidden animate-slide-up">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#F7BC5F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center space-y-3 mb-8 flex flex-col items-center">
          <img src="/nova-mascotte.png" alt="Nova CRM" className="w-16 h-16 object-contain mb-1" referrerPolicy="no-referrer" />
          <h1 className="text-2xl font-extrabold tracking-tight text-white font-sans">
            Nova<span className="text-[#F7BC5F]">CRM</span>
          </h1>
          <span className="text-xs font-bold text-[#061719] bg-[#F7BC5F] px-3 py-1 rounded-full">Espace Client</span>
          <p className="text-sm text-slate-300 pt-1">Retrouvez votre conseiller et vos documents en toute sécurité.</p>
        </div>

        {error && (
          <div className="p-3.5 mb-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5 leading-relaxed">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full h-12 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm transition-all duration-200 flex items-center justify-center gap-3 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.69c-.29 1.5-.1.3-1.14 2.21l3.3 2.56c1.93-1.78 3.04-4.4 3.04-7.62z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.3-2.56c-.92.62-2.1 1-3.63 1-3.14 0-5.8-2.12-6.75-4.97H1.02v2.54C3.01 20.35 7.18 24 12 24z" />
            <path fill="#FBBC05" d="M5.25 14.56a7.22 7.22 0 0 1 0-4.62V7.4H1.02a11.95 11.95 0 0 0 0 9.2l4.23-2.04z" />
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.6 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.18 0 3.01 3.65 1.02 8.02l4.23 3.33c.95-2.85 3.61-4.97 6.75-4.97z" />
          </svg>
          Se connecter avec Google
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[11px] text-slate-500">ou avec e-mail</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <div className="flex gap-1.5 mb-4 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => { setMode('password'); setError(null); setLinkSent(false); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${mode === 'password' ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-400'}`}
          >
            Mot de passe
          </button>
          <button
            onClick={() => { setMode('link'); setError(null); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${mode === 'link' ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-400'}`}
          >
            Lien par e-mail
          </button>
        </div>

        <div className="space-y-2.5">
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Votre adresse e-mail"
              className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
            />
          </div>

          {mode === 'password' ? (
            <>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handlePasswordLogin(); }}
                  placeholder="Mot de passe"
                  className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              <button
                onClick={() => void handlePasswordLogin()}
                disabled={!email.trim() || !password || loading}
                className="w-full h-12 rounded-2xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Se connecter
              </button>
              <p className="text-center text-[11px] text-slate-500">
                Pas encore de mot de passe ? Utilisez "Lien par e-mail" ci-dessus.
              </p>
            </>
          ) : linkSent ? (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-start gap-2.5 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Si cette adresse est associée à un espace client, un lien de connexion vient de lui être envoyé — pensez à vérifier vos spams.</span>
            </div>
          ) : (
            <button
              onClick={() => void handleRequestLink()}
              disabled={!email.trim() || loading}
              className="w-full h-12 rounded-2xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Recevoir un lien de connexion
            </button>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          L'accès à cet espace est réservé aux clients invités par leur conseiller.
        </p>
      </div>

      <div className="text-center font-mono text-[10px] text-slate-500 mt-3">
        © 2026 Nova CRM — Espace Client
      </div>
    </div>
  );
}
