import React, { useEffect, useState } from 'react';
import { ShieldCheck, Send, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AGENCIES } from '@/types';

// ── Petit utilitaire pour lire/écrire des chemins imbriqués sans dépendance ──
function getPath(obj: any, path: string) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}
function setPath(obj: any, path: string, value: any) {
  const keys = path.split('.');
  const next = { ...obj };
  let cursor: any = next;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      cursor[key] = value;
    } else {
      cursor[key] = { ...(cursor[key] || {}) };
      cursor = cursor[key];
    }
  });
  return next;
}

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
};

interface Props {
  token: string;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-white mb-1.5">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-white mb-1.5">{label}</label>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] resize-y"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-white mb-1.5">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-[#F7BC5F]" />
      {label}
    </label>
  );
}

function RadioGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      {label && <label className="block text-sm font-semibold text-white mb-1.5">{label}</label>}
      <div className="flex flex-wrap gap-4">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-sm text-slate-200 cursor-pointer">
            <input
              type="radio"
              checked={value === o}
              onChange={() => onChange(o)}
              className="w-4 h-4 accent-[#F7BC5F]"
            />
            {o}
          </label>
        ))}
      </div>
    </div>
  );
}

const CONTRAT_OPTIONS = ['CDD', 'CDI', 'Fonctionnaire', 'Profession libérale', 'Indépendant', 'Pro BTP', 'Cadre'];
const PRIMES_OPTIONS = ['13ème mois', '14ème mois', 'Participation', 'Intéressement', 'Primes', 'OPEX/OPIN'];
const LOGEMENT_OPTIONS = ['Propriétaire', 'Locataire', 'Hébergé', 'Logé par employeur'];
const SITUATION_FAM_OPTIONS = ['Célibataire', 'Marié(e)', 'Pacsé(e)', 'Concubinage', 'Divorcé(e)', 'Veuf(ve)'];
const REGIME_OPTIONS = ['Communauté légale', 'Séparation de biens', 'Communauté universelle', 'Participation aux acquêts'];
const TAUX_OPTIONS = ['Fixe', 'Variable', 'Mixte'];
const REMBOURSEMENT_OPTIONS = ['Amortissable', 'In fine', 'Différé'];
const OUI_NON = ['Oui', 'Non'];

function emptyAnswers() {
  return {
    identite: {
      emprunteur: { nom: '', nomNaissance: '', prenom: '', telephone: '', adresse: '', email: '' },
      coEmprunteur: { nom: '', nomNaissance: '', prenom: '', telephone: '', adresse: '', email: '' },
      origineContact: '',
      autresCommentaires: '',
    },
    etatCivil: {
      emprunteur: { dateNaissance: '', lieuNaissance: '', departement: '', logement: '', depuisLe: '', loyerCredit: '', situationFamiliale: '', enfantsCharge: '', enfantsAutreUnion: '' },
      coEmprunteur: { dateNaissance: '', lieuNaissance: '', departement: '', logement: '', depuisLe: '', loyerCredit: '', situationFamiliale: '', enfantsCharge: '', enfantsAutreUnion: '' },
      regimeMariage: '',
    },
    situationPro: {
      emprunteur: { profession: '', depuisLe: '', employeur: '', adresseEmployeur: '', contrat: '', revenuMensuelNet: '', revenuAnnuel: '', pensionAlimentaire: '', autresRevenus: '', primes: [] as string[], comiteEntreprise: '', rfrN1: '', rfrN2: '', commentaires: '' },
      coEmprunteur: { profession: '', depuisLe: '', employeur: '', adresseEmployeur: '', contrat: '', revenuMensuelNet: '', revenuAnnuel: '', pensionAlimentaire: '', autresRevenus: '', primes: [] as string[], comiteEntreprise: '', rfrN1: '', rfrN2: '', commentaires: '' },
    },
    patrimoine: {
      emprunteur: { livretA: '', celPel: '', ldd: '', assuranceVie: '', partsSociales: '', autres: '' },
      coEmprunteur: { livretA: '', celPel: '', ldd: '', assuranceVie: '', partsSociales: '', autres: '' },
      biensImmobiliers: '',
    },
    pretsEnCours: '',
    commentairesPrets: '',
    recueilBesoins: {
      banqueActuelleEmprunteur: '', depuis: '', banqueCoEmprunteur: '', depuisCo: '',
      banquesNonSouhaitees: '', negociationsEnCours: '', mensualiteSouhaitee: '', mensualiteMaxi: '',
      dureeSouhaitee: '', dureeMaxi: '', taux: '', remboursement: '',
    },
    assurances: {
      emprunteur: { quotite: '', fumeur: '', taille: '', poids: '', problemesSante: '' },
      coEmprunteur: { quotite: '', fumeur: '', taille: '', poids: '', problemesSante: '' },
    },
    engagement: { certifie: false, nomSignataire: '', date: '' },
  };
}

export default function PublicQuestionnaire({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [meta, setMeta] = useState<{ sentToEmail: string; agencyId: string | null; sentBy: string; leadId: string; leadName: string | null } | null>(null);
  const [answers, setAnswers] = useState<any>(emptyAnswers());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_questionnaire_by_token', { p_token: token });
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
        }
      } catch (e) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const set = (path: string, value: any) => setAnswers((prev: any) => setPath(prev, path, value));
  const togglePrime = (path: string, prime: string) => {
    setAnswers((prev: any) => {
      const current: string[] = getPath(prev, path) || [];
      const next = current.includes(prime) ? current.filter((p) => p !== prime) : [...current, prime];
      return setPath(prev, path, next);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answers.engagement.certifie) {
      setError('Merci de certifier sincères et véritables les informations communiquées.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('submit_questionnaire', {
        p_token: token,
        p_answers: answers,
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error("Ce lien n'est plus valide.");
      setSubmitted(true);
      if (meta) {
        supabase
          .rpc('create_notification', {
            _user_id: meta.sentBy,
            _type: 'questionnaire_completed',
            _title: '📋 Questionnaire rempli',
            _message: `${meta.leadName || 'Un client'} a rempli son questionnaire confidentiel.`,
            _entity_type: 'lead',
            _entity_id: meta.leadId,
            _agency_id: meta.agencyId,
            _metadata: {},
          })
          .then(() => {}, () => {});
      }
    } catch (e: any) {
      setError(e?.message || "Impossible d'envoyer le questionnaire. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  const agencyName = AGENCIES.find((a) => a.id === meta?.agencyId)?.name || 'Nova CRM';

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
          <p className="text-sm text-slate-400">Ce questionnaire a déjà été rempli ou le lien n'est plus valide. Contactez votre conseiller pour recevoir un nouveau lien.</p>
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
          <p className="text-sm text-slate-400">Votre questionnaire a bien été transmis à votre conseiller. Vous pouvez fermer cette page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#051416] text-white py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-3">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5" /> Confidentiel & sécurisé
          </span>
          <h1 className="text-3xl font-extrabold">Questionnaire confidentiel</h1>
          <p className="text-sm text-slate-400">{agencyName} · adressé à {meta?.sentToEmail ? maskEmail(meta.sentToEmail) : ''}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Identité */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Identité</h2>
            {(['emprunteur', 'coEmprunteur'] as const).map((who) => (
              <div key={who} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-5 space-y-4">
                <h3 className="text-[#F9C977] font-bold text-sm">{who === 'emprunteur' ? 'Emprunteur' : 'Co-emprunteur (le cas échéant)'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Nom" value={getPath(answers, `identite.${who}.nom`)} onChange={(v) => set(`identite.${who}.nom`, v)} />
                  <Field label="Nom de naissance" value={getPath(answers, `identite.${who}.nomNaissance`)} onChange={(v) => set(`identite.${who}.nomNaissance`, v)} />
                  <Field label="Prénom" value={getPath(answers, `identite.${who}.prenom`)} onChange={(v) => set(`identite.${who}.prenom`, v)} />
                  <Field label="Téléphone" value={getPath(answers, `identite.${who}.telephone`)} onChange={(v) => set(`identite.${who}.telephone`, v)} />
                </div>
                <TextArea label="Adresse" value={getPath(answers, `identite.${who}.adresse`)} onChange={(v) => set(`identite.${who}.adresse`, v)} />
                <Field label="E-mail" type="email" value={getPath(answers, `identite.${who}.email`)} onChange={(v) => set(`identite.${who}.email`, v)} />
              </div>
            ))}
            <Field label="Origine du contact" value={answers.identite.origineContact} onChange={(v) => set('identite.origineContact', v)} />
            <TextArea label="Autres commentaires" value={answers.identite.autresCommentaires} onChange={(v) => set('identite.autresCommentaires', v)} />
          </section>

          {/* État civil */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">État civil</h2>
            {(['emprunteur', 'coEmprunteur'] as const).map((who) => (
              <div key={who} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-5 space-y-4">
                <h3 className="text-[#F9C977] font-bold text-sm">{who === 'emprunteur' ? 'Emprunteur' : 'Co-emprunteur'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Date de naissance" type="date" value={getPath(answers, `etatCivil.${who}.dateNaissance`)} onChange={(v) => set(`etatCivil.${who}.dateNaissance`, v)} />
                  <Field label="Lieu de naissance" value={getPath(answers, `etatCivil.${who}.lieuNaissance`)} onChange={(v) => set(`etatCivil.${who}.lieuNaissance`, v)} />
                  <Field label="Département" value={getPath(answers, `etatCivil.${who}.departement`)} onChange={(v) => set(`etatCivil.${who}.departement`, v)} />
                  <Select label="Logement" value={getPath(answers, `etatCivil.${who}.logement`)} onChange={(v) => set(`etatCivil.${who}.logement`, v)} options={LOGEMENT_OPTIONS} />
                  <Field label="Depuis le" type="date" value={getPath(answers, `etatCivil.${who}.depuisLe`)} onChange={(v) => set(`etatCivil.${who}.depuisLe`, v)} />
                  <Field label="Loyer / Crédit actuel (€)" value={getPath(answers, `etatCivil.${who}.loyerCredit`)} onChange={(v) => set(`etatCivil.${who}.loyerCredit`, v)} />
                  <Select label="Situation familiale" value={getPath(answers, `etatCivil.${who}.situationFamiliale`)} onChange={(v) => set(`etatCivil.${who}.situationFamiliale`, v)} options={SITUATION_FAM_OPTIONS} />
                  <Field label="Enfants à charge (nb / âges)" value={getPath(answers, `etatCivil.${who}.enfantsCharge`)} onChange={(v) => set(`etatCivil.${who}.enfantsCharge`, v)} />
                </div>
                <Field label="Enfants d'une autre union" value={getPath(answers, `etatCivil.${who}.enfantsAutreUnion`)} onChange={(v) => set(`etatCivil.${who}.enfantsAutreUnion`, v)} />
              </div>
            ))}
            <Select label="Régime / contrat de mariage" value={answers.etatCivil.regimeMariage} onChange={(v) => set('etatCivil.regimeMariage', v)} options={REGIME_OPTIONS} />
          </section>

          {/* Situation professionnelle */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Situation professionnelle</h2>
            {(['emprunteur', 'coEmprunteur'] as const).map((who) => (
              <div key={who} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-5 space-y-4">
                <h3 className="text-[#F9C977] font-bold text-sm">{who === 'emprunteur' ? 'Emprunteur' : 'Co-emprunteur'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Profession" value={getPath(answers, `situationPro.${who}.profession`)} onChange={(v) => set(`situationPro.${who}.profession`, v)} />
                  <Field label="Depuis le" type="date" value={getPath(answers, `situationPro.${who}.depuisLe`)} onChange={(v) => set(`situationPro.${who}.depuisLe`, v)} />
                  <Field label="Employeur" value={getPath(answers, `situationPro.${who}.employeur`)} onChange={(v) => set(`situationPro.${who}.employeur`, v)} />
                  <Field label="Adresse employeur" value={getPath(answers, `situationPro.${who}.adresseEmployeur`)} onChange={(v) => set(`situationPro.${who}.adresseEmployeur`, v)} />
                </div>
                <RadioGroup label="Contrat" value={getPath(answers, `situationPro.${who}.contrat`)} onChange={(v) => set(`situationPro.${who}.contrat`, v)} options={CONTRAT_OPTIONS} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Revenu mensuel net (€)" value={getPath(answers, `situationPro.${who}.revenuMensuelNet`)} onChange={(v) => set(`situationPro.${who}.revenuMensuelNet`, v)} />
                  <Field label="Revenu annuel (€)" value={getPath(answers, `situationPro.${who}.revenuAnnuel`)} onChange={(v) => set(`situationPro.${who}.revenuAnnuel`, v)} />
                  <Field label="Pension alimentaire (€)" value={getPath(answers, `situationPro.${who}.pensionAlimentaire`)} onChange={(v) => set(`situationPro.${who}.pensionAlimentaire`, v)} />
                  <Field label="Autres revenus" value={getPath(answers, `situationPro.${who}.autresRevenus`)} onChange={(v) => set(`situationPro.${who}.autresRevenus`, v)} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white mb-1.5">Primes & avantages</label>
                  <div className="flex flex-wrap gap-4">
                    {PRIMES_OPTIONS.map((p) => (
                      <CheckboxRow
                        key={p}
                        label={p}
                        checked={(getPath(answers, `situationPro.${who}.primes`) || []).includes(p)}
                        onChange={() => togglePrime(`situationPro.${who}.primes`, p)}
                      />
                    ))}
                  </div>
                </div>
                <Field label="Comité d'entreprise" value={getPath(answers, `situationPro.${who}.comiteEntreprise`)} onChange={(v) => set(`situationPro.${who}.comiteEntreprise`, v)} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="RFR N-1 (€)" value={getPath(answers, `situationPro.${who}.rfrN1`)} onChange={(v) => set(`situationPro.${who}.rfrN1`, v)} />
                  <Field label="RFR N-2 (€)" value={getPath(answers, `situationPro.${who}.rfrN2`)} onChange={(v) => set(`situationPro.${who}.rfrN2`, v)} />
                </div>
                <TextArea label="Commentaires" value={getPath(answers, `situationPro.${who}.commentaires`)} onChange={(v) => set(`situationPro.${who}.commentaires`, v)} />
              </div>
            ))}
          </section>

          {/* Patrimoine */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Patrimoine</h2>
            <p className="text-xs text-slate-400">Indiquez les montants approximatifs (Livret A, CEL/PEL, LDD, Assurance vie, parts sociales, autres).</p>
            {(['emprunteur', 'coEmprunteur'] as const).map((who) => (
              <div key={who} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-5 space-y-4">
                <h3 className="text-[#F9C977] font-bold text-sm">{who === 'emprunteur' ? 'Emprunteur' : 'Co-emprunteur'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Livret A (€)" value={getPath(answers, `patrimoine.${who}.livretA`)} onChange={(v) => set(`patrimoine.${who}.livretA`, v)} />
                  <Field label="CEL/PEL (€)" value={getPath(answers, `patrimoine.${who}.celPel`)} onChange={(v) => set(`patrimoine.${who}.celPel`, v)} />
                  <Field label="LDD (€)" value={getPath(answers, `patrimoine.${who}.ldd`)} onChange={(v) => set(`patrimoine.${who}.ldd`, v)} />
                  <Field label="Assurance vie (€)" value={getPath(answers, `patrimoine.${who}.assuranceVie`)} onChange={(v) => set(`patrimoine.${who}.assuranceVie`, v)} />
                  <Field label="Parts sociales (€)" value={getPath(answers, `patrimoine.${who}.partsSociales`)} onChange={(v) => set(`patrimoine.${who}.partsSociales`, v)} />
                  <Field label="Autres (€)" value={getPath(answers, `patrimoine.${who}.autres`)} onChange={(v) => set(`patrimoine.${who}.autres`, v)} />
                </div>
              </div>
            ))}
            <TextArea label="Biens immobiliers (description, valeur, loyer)" value={answers.patrimoine.biensImmobiliers} onChange={(v) => set('patrimoine.biensImmobiliers', v)} />
          </section>

          {/* Prêts en cours */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Prêts en cours</h2>
            <TextArea label="Prêts en cours (Établissement, objet, montant, durée, taux, mensualité, CRD...)" value={answers.pretsEnCours} onChange={(v) => set('pretsEnCours', v)} />
            <TextArea label="Commentaires" value={answers.commentairesPrets} onChange={(v) => set('commentairesPrets', v)} />
          </section>

          {/* Recueil des besoins */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Recueil des besoins</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Banque(s) actuelle(s) emprunteur" value={answers.recueilBesoins.banqueActuelleEmprunteur} onChange={(v) => set('recueilBesoins.banqueActuelleEmprunteur', v)} />
              <Field label="Depuis" value={answers.recueilBesoins.depuis} onChange={(v) => set('recueilBesoins.depuis', v)} />
              <Field label="Banque(s) co-emprunteur" value={answers.recueilBesoins.banqueCoEmprunteur} onChange={(v) => set('recueilBesoins.banqueCoEmprunteur', v)} />
              <Field label="Depuis" value={answers.recueilBesoins.depuisCo} onChange={(v) => set('recueilBesoins.depuisCo', v)} />
            </div>
            <Field label="Banque(s) non souhaitée(s)" value={answers.recueilBesoins.banquesNonSouhaitees} onChange={(v) => set('recueilBesoins.banquesNonSouhaitees', v)} />
            <Field label="Négociations en cours" value={answers.recueilBesoins.negociationsEnCours} onChange={(v) => set('recueilBesoins.negociationsEnCours', v)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Mensualité souhaitée (€)" value={answers.recueilBesoins.mensualiteSouhaitee} onChange={(v) => set('recueilBesoins.mensualiteSouhaitee', v)} />
              <Field label="Mensualité maxi (€)" value={answers.recueilBesoins.mensualiteMaxi} onChange={(v) => set('recueilBesoins.mensualiteMaxi', v)} />
              <Field label="Durée souhaitée (ans)" value={answers.recueilBesoins.dureeSouhaitee} onChange={(v) => set('recueilBesoins.dureeSouhaitee', v)} />
              <Field label="Durée maxi (ans)" value={answers.recueilBesoins.dureeMaxi} onChange={(v) => set('recueilBesoins.dureeMaxi', v)} />
              <Select label="Taux" value={answers.recueilBesoins.taux} onChange={(v) => set('recueilBesoins.taux', v)} options={TAUX_OPTIONS} />
              <Select label="Remboursement" value={answers.recueilBesoins.remboursement} onChange={(v) => set('recueilBesoins.remboursement', v)} options={REMBOURSEMENT_OPTIONS} />
            </div>
          </section>

          {/* Assurances */}
          <section className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Assurances</h2>
            {(['emprunteur', 'coEmprunteur'] as const).map((who) => (
              <div key={who} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-5 space-y-4">
                <h3 className="text-[#F9C977] font-bold text-sm">{who === 'emprunteur' ? 'Emprunteur' : 'Co-emprunteur'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select label="Quotité" value={getPath(answers, `assurances.${who}.quotite`)} onChange={(v) => set(`assurances.${who}.quotite`, v)} options={['25%', '50%', '75%', '100%']} />
                  <Select label="Fumeur" value={getPath(answers, `assurances.${who}.fumeur`)} onChange={(v) => set(`assurances.${who}.fumeur`, v)} options={OUI_NON} />
                  <Field label="Taille (cm)" value={getPath(answers, `assurances.${who}.taille`)} onChange={(v) => set(`assurances.${who}.taille`, v)} />
                  <Field label="Poids (kg)" value={getPath(answers, `assurances.${who}.poids`)} onChange={(v) => set(`assurances.${who}.poids`, v)} />
                </div>
                <TextArea label="Problèmes de santé" value={getPath(answers, `assurances.${who}.problemesSante`)} onChange={(v) => set(`assurances.${who}.problemesSante`, v)} />
              </div>
            ))}
          </section>

          {/* Engagement */}
          <section className="bg-[#07191b] border border-[#F7BC5F]/30 rounded-2xl p-6 space-y-4">
            <p className="text-xs text-slate-400">
              Un crédit vous engage et doit être remboursé. Vérifiez vos capacités de remboursement avant de vous engager.
              Conformément à la loi Informatique et Libertés, vous disposez d'un droit d'accès, de rectification et d'opposition sur vos données personnelles.
            </p>
            <CheckboxRow
              label="Je certifie sincères et véritables les informations communiquées."
              checked={answers.engagement.certifie}
              onChange={(v) => set('engagement.certifie', v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nom du signataire" value={answers.engagement.nomSignataire} onChange={(v) => set('engagement.nomSignataire', v)} />
              <Field label="Date" type="date" value={answers.engagement.date} onChange={(v) => set('engagement.date', v)} />
            </div>
          </section>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm">{error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-slate-950 font-bold flex items-center gap-2 shadow-lg"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Envoyer mon questionnaire
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
