import { useMemo, useState } from 'react';
import { Calculator, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTreasuryLines } from '@/hooks/useTreasuryLines';
import { useTreasuryActuals } from '@/hooks/useTreasuryActuals';
import { formatCurrencyPrecis } from '@/lib/utils';

const MOIS_ONGLETS = ['01', '02', '03', '04', '05', '06', '07', '08', '09'];
const NOMS_MOIS_COURT: Record<string, string> = {
  '01': 'Janv.', '02': 'Févr.', '03': 'Mars', '04': 'Avr.', '05': 'Mai',
  '06': 'Juin', '07': 'Juil.', '08': 'Août', '09': 'Sept.', '10': 'Oct.', '11': 'Nov.', '12': 'Déc.',
};

// Onglet Comptabilité (6 septembre, Conseils Finances) : « un onglet
// comptabilité avec les 12 mois, comme un prévisionnel de trésorerie, et ce
// qui est prélevé tous les mois, en récurrence ou ponctuel [...] classer par
// catégorie [...] un vrai logiciel de comptabilité pour piloter ce qui va
// rentrer aussi et avoir une vue sur le long terme ».
//
// Chaque ligne (treasury_lines) est un poste récurrent (loyer, assurance,
// abonnement, commission mensuelle...) ou ponctuel, positif pour une
// recette, négatif pour une dépense. La grille projette les récurrents sur
// chaque mois de la fenêtre affichée ; on avance par blocs de 12 mois pour
// voir loin, pas seulement l'année en cours.

const CATEGORIES_SUGGEREES = [
  'Loyer', 'Télécom', 'Abonnements logiciels', 'Prestataires', 'Assurances',
  'Emprunts', 'Frais bancaires', 'Impôts et taxes', 'Énergie', 'Frais divers',
  'Commissions', 'Autres recettes',
];

function moisIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

interface FormLigne {
  label: string;
  category: string;
  kind: 'recurrent' | 'ponctuel';
  sens: 'recette' | 'depense';
  montant: string;
  month: string;
  endMonth: string;
}

const formVide = (moisParDefaut: string): FormLigne => ({
  label: '', category: '', kind: 'recurrent', sens: 'depense', montant: '', month: moisParDefaut, endMonth: '',
});

export default function ComptabiliteView() {
  const { userProfile, currentUser, activeAgency } = useAuth();
  const { lines, creerLigne, modifierLigne } = useTreasuryLines(activeAgency.id);
  const { actuals, isLoading: actualsChargement } = useTreasuryActuals(activeAgency.id);

  // Double garde (menu ET contenu, même principe que CarteProspectionView.tsx) :
  // « que par les super admins, Mélanie et Sylvain, c'est tout ».
  const identite = `${userProfile?.displayName || currentUser?.displayName || ''} ${userProfile?.email || currentUser?.email || ''}`;
  const estDirectionCF = /grazia|melanie|gestion@immosphera\.fr/i.test(identite);
  const estConseilsFinances = /conseils?\s*finances?/i.test(activeAgency?.name || '');

  const [moisActuelOnglet, setMoisActuelOnglet] = useState('01');

  // Solde bancaire théorique cumulé : on part de la toute première ligne du
  // grand livre (le report d'ouverture) et on accumule crédit - débit dans
  // l'ordre chronologique complet, tous mois confondus.
  const actualsAvecSolde = useMemo(() => {
    let solde = 0;
    return actuals.map((a) => {
      solde += a.credit - a.debit;
      return { ...a, soldeApres: solde };
    });
  }, [actuals]);

  const actualsDuMoisActif = useMemo(
    () => actualsAvecSolde.filter((a) => a.monthSheet === moisActuelOnglet),
    [actualsAvecSolde, moisActuelOnglet]
  );

  const soldeOuvertureMoisActif = useMemo(() => {
    const idxPremier = actualsAvecSolde.findIndex((a) => a.monthSheet === moisActuelOnglet);
    if (idxPremier === -1) return 0;
    if (idxPremier === 0) return actualsAvecSolde[0].soldeApres - (actualsAvecSolde[0].credit - actualsAvecSolde[0].debit);
    return actualsAvecSolde[idxPremier - 1].soldeApres;
  }, [actualsAvecSolde, moisActuelOnglet]);

  const soldeClotureMoisActif = actualsDuMoisActif.length > 0
    ? actualsDuMoisActif[actualsDuMoisActif.length - 1].soldeApres
    : soldeOuvertureMoisActif;

  const [formOuvert, setFormOuvert] = useState<string | null>(null); // null = fermé, 'nouveau' ou id d'une ligne éditée
  const [form, setForm] = useState<FormLigne>(() => formVide(moisIso(new Date())));

  const categories = useMemo(() => {
    const set = new Set<string>(CATEGORIES_SUGGEREES);
    lines.forEach((l) => set.add(l.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [lines]);

  if (!estDirectionCF || !estConseilsFinances) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Cette page est réservée à la direction de Conseils Finances.
      </div>
    );
  }

  const ouvrirNouveau = () => { setForm(formVide(`2026-${moisActuelOnglet}-01`)); setFormOuvert('nouveau'); };

  const soumettre = () => {
    const montantNombre = Number(form.montant.replace(',', '.'));
    if (!form.label.trim() || !form.category.trim() || !Number.isFinite(montantNombre) || montantNombre <= 0) return;
    const amount = form.sens === 'depense' ? -Math.abs(montantNombre) : Math.abs(montantNombre);
    const payload = {
      label: form.label.trim(),
      category: form.category.trim(),
      kind: form.kind,
      amount,
      month: form.month,
      endMonth: form.kind === 'recurrent' ? (form.endMonth || null) : null,
    };
    if (formOuvert === 'nouveau') {
      creerLigne.mutate(payload);
    } else if (formOuvert) {
      modifierLigne.mutate({ id: formOuvert, ...payload });
    }
    setFormOuvert(null);
  };

  return (
    <div className="space-y-6 bg-[#07191b] border-2 border-[#2a6a6f] rounded-2xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-[#F7BC5F]" />
          <h2 className="text-lg font-bold text-white">Comptabilité — prévisionnel de trésorerie</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={ouvrirNouveau}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F7BC5F] text-slate-950 text-xs font-bold hover:bg-[#F9C977]"
          >
            <Plus className="w-3.5 h-3.5" /> Nouvelle ligne
          </button>
        </div>
      </div>

      {/* Solde bancaire théorique — grand livre du mois actif */}
      <div className="rounded-2xl border-2 border-[#2a6a6f] bg-[#0a1e20]/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">
            Solde bancaire théorique — Grand livre {moisActuelOnglet} · {NOMS_MOIS_COURT[moisActuelOnglet]}
          </h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-400">
              {moisActuelOnglet === '01' ? 'Solde de départ : ' : 'Solde ouverture : '}
              <span className={`font-bold ${soldeOuvertureMoisActif >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrencyPrecis(soldeOuvertureMoisActif)}
              </span>
            </span>
            <span className="text-slate-400">
              Solde clôture :{' '}
              <span className={`font-bold ${soldeClotureMoisActif >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrencyPrecis(soldeClotureMoisActif)}
              </span>
            </span>
          </div>
        </div>

        {actualsChargement ? (
          <p className="text-sm text-slate-500">Chargement…</p>
        ) : actualsDuMoisActif.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-4 text-center">
            Aucune donnée réelle importée pour ce mois.
          </p>
        ) : (
          <div className="overflow-y-auto overflow-x-auto custom-scrollbar rounded-xl border-2 border-[#2a6a6f] max-h-[70vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0a1e20] text-[10px] uppercase tracking-widest text-slate-500 border-b-2 border-[#2a6a6f]">
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Date</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Libellé</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Description</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Crédit</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Débit</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Solde théorique</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a6a6f]/70">
                {actualsDuMoisActif.map((a) => (
                  <tr key={a.id} className="hover:bg-white/5">
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap text-xs">
                      {new Date(a.date).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-1.5 text-slate-200 text-xs">{a.label}</td>
                    <td className="px-3 py-1.5 text-slate-500 text-xs">{a.description}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${a.credit > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {a.credit > 0 ? formatCurrencyPrecis(a.credit) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${a.debit > 0 ? 'text-red-400' : 'text-slate-600'}`}>
                      {a.debit > 0 ? formatCurrencyPrecis(a.debit) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums text-xs font-bold ${a.soldeApres >= 0 ? 'text-[#F9C977]' : 'text-red-400'}`}>
                      {formatCurrencyPrecis(a.soldeApres)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Onglets mois du grand livre réel, en bas de la vue — un seul
          tableau à la fois, trié par date croissante (demande du 6
          septembre : « uniquement un seul tableau [...] classé par date
          croissante [...] pas tout en haut tous les onglets de tous les
          mois »). Les lignes récurrentes/ponctuelles ajoutées à la main
          restent modifiables via « Nouvelle ligne », mais ne sont plus
          affichées en grille 12 mois. */}
      <div className="sticky bottom-0 flex flex-wrap gap-1.5 justify-center pt-3 border-t-2 border-[#2a6a6f] bg-[#07191b]">
        {MOIS_ONGLETS.map((m) => (
          <button
            key={m}
            onClick={() => setMoisActuelOnglet(m)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              moisActuelOnglet === m
                ? 'bg-[#F7BC5F] text-slate-950'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {m} · {NOMS_MOIS_COURT[m]}
          </button>
        ))}
      </div>

      {/* Formulaire d'ajout / modification */}
      {formOuvert && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setFormOuvert(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-[#07191b] border-2 border-[#2a6a6f] shadow-2xl p-5 space-y-4">
            <h3 className="text-base font-bold text-white">
              {formOuvert === 'nouveau' ? 'Nouvelle ligne' : 'Modifier la ligne'}
            </h3>

            <div className="flex gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, sens: 'depense' }))}
                className={`flex-1 py-2 rounded-lg text-xs font-bold ${form.sens === 'depense' ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-white/5 text-slate-400 border border-transparent'}`}
              >
                Dépense
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, sens: 'recette' }))}
                className={`flex-1 py-2 rounded-lg text-xs font-bold ${form.sens === 'recette' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-white/5 text-slate-400 border border-transparent'}`}
              >
                Recette
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Libellé</label>
              <input
                type="text" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="ex : Loyer, Assurance RC Pro…" autoFocus
                className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Catégorie</label>
              <input
                type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                list="categories-comptabilite" placeholder="ex : Loyer, Assurances…"
                className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
              />
              <datalist id="categories-comptabilite">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, kind: 'recurrent' }))}
                className={`flex-1 py-2 rounded-lg text-xs font-bold ${form.kind === 'recurrent' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-white/5 text-slate-400 border border-transparent'}`}
              >
                Récurrent (tous les mois)
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, kind: 'ponctuel' }))}
                className={`flex-1 py-2 rounded-lg text-xs font-bold ${form.kind === 'ponctuel' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/5 text-slate-400 border border-transparent'}`}
              >
                Ponctuel (une fois)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Montant (€)</label>
                <input
                  type="text" inputMode="decimal" value={form.montant}
                  onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  {form.kind === 'recurrent' ? 'À partir de' : 'Mois'}
                </label>
                <input
                  type="month" value={form.month.slice(0, 7)}
                  onChange={(e) => setForm((f) => ({ ...f, month: `${e.target.value}-01` }))}
                  className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
                />
              </div>
            </div>

            {form.kind === 'recurrent' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Jusqu'à (optionnel)</label>
                <input
                  type="month" value={form.endMonth ? form.endMonth.slice(0, 7) : ''}
                  onChange={(e) => setForm((f) => ({ ...f, endMonth: e.target.value ? `${e.target.value}-01` : '' }))}
                  className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
                />
                <p className="text-[10px] text-slate-500 mt-1">Laissé vide : la ligne se répète indéfiniment.</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setFormOuvert(null)} className="px-4 py-2 text-xs text-slate-400 hover:text-white">
                Annuler
              </button>
              <button
                onClick={soumettre}
                disabled={creerLigne.isPending || modifierLigne.isPending}
                className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-slate-950 text-xs font-bold"
              >
                {formOuvert === 'nouveau' ? 'Ajouter' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
