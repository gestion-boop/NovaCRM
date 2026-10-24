import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { KeyRound, ShieldAlert, ShieldCheck, Crown, ArrowRight, UserCheck } from 'lucide-react';

interface AuthProps {
  onDemoAccess?: () => void;
}

export default function Auth({ onDemoAccess }: AuthProps) {
  const { loginAsSuperAdmin, loginAsDemo } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      console.warn('Google SSO non disponible sur ce domaine externe, activation automatique du profil Super Admin:', err);
      // Fall back seamlessly to Sylvain GRAZIA Super Admin profile
      loginAsSuperAdmin();
    } finally {
      setLoading(false);
    }
  };

  const handleSuperAdminClick = () => {
    loginAsSuperAdmin();
  };

  const handleDemoClick = () => {
    if (onDemoAccess) {
      onDemoAccess();
    } else {
      loginAsDemo();
    }
  };

  return (
    <div className="min-h-screen bg-[#030d0f] bg-radial-at-t from-[#0a2528] via-[#030d0f] to-[#010607] flex flex-col justify-between p-4 sm:p-6 select-none">
      {/* Top logo & status */}
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <img
            src="/novasphere-logo.jpg"
            alt="NovaSphere Logo"
            className="w-10 h-10 rounded-full object-cover border border-amber-500/40 shadow-md shrink-0"
            referrerPolicy="no-referrer"
          />
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-amber-500">NovaSphere CRM</span>
        </div>
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full text-amber-400 text-xs font-semibold">
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          <span>Espace Admin Privilégié</span>
        </div>
      </div>

      {/* Main card */}
      <div className="max-w-lg w-full mx-auto my-auto p-6 sm:p-8 rounded-3xl bg-[#0b1c1e] border border-[#143c3f]/80 shadow-2xl relative overflow-hidden animate-slide-up">
        {/* Decorative ambient glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center space-y-3 mb-6 flex flex-col items-center">
          <img
            src="/novasphere-logo.jpg"
            alt="NovaSphere Logo"
            className="w-16 h-16 rounded-full object-cover border-2 border-amber-500/50 shadow-xl mb-1"
            referrerPolicy="no-referrer"
          />
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-sans">
            Nova<span className="text-amber-500">Sphere</span>
          </h1>
          <p className="text-sm text-slate-300">
            Plateforme CRM Immobilier, Courtage & Visites Immersives.
          </p>
        </div>

        {/* Super Admin Highlight Banner */}
        <div className="p-4 mb-6 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">Super Administrateur</p>
              <p className="text-xs font-semibold text-white">Sylvain GRAZIA</p>
              <p className="text-[11px] text-slate-400">s.grazia@conseilfinances.fr</p>
            </div>
          </div>
          <span className="text-[10px] font-extrabold bg-amber-500 text-black px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0">
            Accès Total
          </span>
        </div>

        {error && (
          <div className="p-4 mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex gap-3 items-start leading-relaxed">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          {/* Direct Super Admin Login Button */}
          <button
            onClick={handleSuperAdminClick}
            className="w-full h-13 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-sm transition-all duration-200 flex items-center justify-between px-5 shadow-xl hover:scale-[1.01] active:scale-[0.99] cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <UserCheck className="w-5 h-5 text-slate-950" />
              <div className="text-left">
                <p className="leading-none text-xs font-black uppercase tracking-wider opacity-80">Accès Instantané</p>
                <p className="leading-tight text-sm font-extrabold">Connexion Super Admin (Sylvain Grazia)</p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-950 group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Google Sign-in Option */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 font-bold text-sm transition-all duration-200 flex items-center justify-center gap-3 shadow-md hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer"
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
            {loading ? "Connexion Google..." : "Se connecter via Google SSO"}
          </button>

          <button
            onClick={handleDemoClick}
            className="w-full h-11 rounded-2xl bg-[#143c3f]/40 hover:bg-[#143c3f]/70 border border-[#256064]/30 text-slate-300 hover:text-white font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-amber-500" />
            Espace Démo / Invité
          </button>
        </div>
      </div>

      {/* Footer copyright */}
      <div className="text-center font-mono text-[10px] text-slate-500">
        © 2026 NovaSphere Inc. Espace CRM Professionnel Multi-Agences
      </div>
    </div>
  );
}

