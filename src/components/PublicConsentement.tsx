import React, { useEffect, useState } from 'react';
import { ShieldCheck, CheckCircle2, Loader2, AlertTriangle, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AGENCIES } from '@/types';
import { CONSENT_PERMISSIONS } from '@/lib/consent';

interface Props {
  token: string;
}

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
};

/**
 * Page publique de signature du consentement au démarchage téléphonique
 * (agence Immosphera). Écrit/lit dans `confidential_questionnaires`
 * (kind='consent') via ses propres RPC (get_consent_by_token /
 * submit_consent) — PAS get_questionnaire_by_token / submit_questionnaire,
 * qui malgré leur nom générique sont câblées sur `credit_questionnaires`
 * (table différente) : les réutiliser ici rendait tout lien "invalide"
 * systématiquement (signalé le 16 septembre).
 */
export default function PublicConsentement({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [meta, setMeta] = useState<{ sentToEmail: string; agencyId: string | null; sentBy: string; leadId: string; leadName: string | null } | null>(null);
  const [nomPrenom, setNomPrenom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [refus, setRefus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_consent_by_token', { p_token: token });
        if (rpcError) throw rpcError;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setNotFound(true);
        } else {
          setMeta({
            sentToEmail: row.sent_to_email,
            agencyId: row.agency_id,
            sentBy: row.sent_by,
            leadId: row.lead_id,
            leadName: row.lead_name,
          });
          setEmail(row.sent_to_email || '');
          if (row.lead_name) setNomPrenom(row.lead_name);
        }
      } catch (e) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const toggle = (key: string) => setAccepted((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomPrenom.trim()) {
      setError('Merci de renseigner votre nom et prénom pour signer ce document.');
      return;
    }
    if (!refus && !Object.values(accepted).some(Boolean)) {
      setError("Merci de cocher au moins une autorisation, ou d'indiquer votre refus ci-dessous.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const consentement: Record<string, unknown> = {
        nom_prenom: nomPrenom.trim(),
        telephone: telephone.trim(),
        email: email.trim(),
        date: new Date().toISOString().slice(0, 10),
      };
      if (refus) {
        consentement.refus_demarchage = true;
      } else {
        CONSENT_PERMISSIONS.forEach((p) => {
          consentement[p.key] = accepted[p.key] === true;
        });
      }

      const { data, error: rpcError } = await supabase.rpc('submit_consent', {
        p_token: token,
        p_answers: { consentement },
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error("Ce lien n'est plus valide.");
      setSubmitted(true);
      if (meta) {
        // Demande explicite (16 septembre) : « quand le consentement a été
        // signé, mets à jour sur la fiche du contact » — la notification ne
        // menait nulle part (`_metadata: {}` → lien par défaut "/") ;
        // cliquer dessus amène maintenant directement sur la fiche, qui se
        // recharge à l'ouverture et affiche donc l'état à jour. Voir aussi
        // ClientProfileView.tsx (abonnement temps réel) pour le cas où la
        // fiche est déjà ouverte au moment de la signature.
        supabase
          .rpc('create_notification', {
            _user_id: meta.sentBy,
            _type: 'consent_completed',
            _title: '✅ Consentement signé',
            _message: `${meta.leadName || 'Un client'} a signé son consentement au démarchage téléphonique.`,
            _entity_type: 'lead',
            _entity_id: meta.leadId,
            _agency_id: meta.agencyId,
            _metadata: { url: `/clients/${meta.leadId}` },
          })
          .then(() => {}, () => {});
      }
    } catch (e: any) {
      setError(e?.message || "Impossible d'envoyer le consentement. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  const agencyName = AGENCIES.find((a) => a.id === meta?.agencyId)?.name || 'Immosphera';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#051416] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#F7BC5F] animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#051416] flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-[#0a1e20] border border-[#144447]/60 rounded-2xl p-8">
          <AlertTriangle className="w-10 h-10 text-[#F7BC5F] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Lien invalide ou déjà utilisé</h1>
          <p className="text-sm text-slate-400">Ce consentement a déjà été signé ou le lien n'est plus valide. Contactez votre conseiller pour recevoir un nouveau lien.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#051416] flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-[#0a1e20] border border-emerald-500/30 rounded-2xl p-8">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Merci !</h1>
          <p className="text-sm text-slate-400">Votre consentement a bien été transmis à votre conseiller. Vous pouvez fermer cette page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#051416] text-white py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-3">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5" /> Confidentiel & sécurisé
          </span>
          <h1 className="text-3xl font-extrabold">Consentement au démarchage téléphonique</h1>
          <p className="text-sm text-slate-400">
            Agence {agencyName} · adressé à {meta?.sentToEmail ? maskEmail(meta.sentToEmail) : ''}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Vos coordonnées</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-1.5">Nom et prénom</label>
                <input
                  value={nomPrenom}
                  onChange={(e) => setNomPrenom(e.target.value)}
                  className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-white mb-1.5">Téléphone</label>
                <input
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-white mb-1.5">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
            </div>
          </section>

          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-white">Autorisations</h2>
            <p className="text-xs text-slate-400">
              Cochez les services pour lesquels vous acceptez d'être contacté(e). Le consentement est valable un an.
            </p>
            <div className="space-y-2.5 pt-1">
              {CONSENT_PERMISSIONS.map((p) => (
                <label key={p.key} className="flex items-start gap-3 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={accepted[p.key] === true}
                    onChange={() => toggle(p.key)}
                    disabled={refus}
                    className="w-4 h-4 mt-0.5 accent-[#F7BC5F] shrink-0"
                  />
                  <span className={refus ? 'opacity-40' : ''}>{p.label}</span>
                </label>
              ))}
            </div>

            <div className="pt-3 border-t border-[#144447]/60">
              <label className="flex items-start gap-3 text-sm text-rose-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={refus}
                  onChange={(e) => setRefus(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-rose-500 shrink-0"
                />
                <span>Je refuse d'être contacté(e) par téléphone à des fins de prospection commerciale.</span>
              </label>
            </div>
          </section>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-6 py-3.5 rounded-xl bg-[#F7BC5F] hover:bg-[#e5ab4c] text-slate-950 font-black flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            Signer et envoyer
          </button>
        </form>
      </div>
    </div>
  );
}
