import React, { useMemo, useState } from 'react';
import { Calculator, Plus, Trash2, TrendingUp, TrendingDown, Pencil } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTreasuryLines } from '@/hooks/useTreasuryLines';
import { useTreasuryActuals } from '@/hooks/useTreasuryActuals';
import { TreasuryLine } from '@/types';
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
function ajouterMois(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}
function libelleMois(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

// Un récurrent compte sur `mois` si mois >= début et (pas de fin, ou mois <= fin).
function ligneActiveSur(ligne: TreasuryLine, moisCible: string): boolean {
  if (ligne.kind === 'ponctuel') return ligne.month === moisCible;
  if (moisCible < ligne.month) return false;
  if (ligne.endMonth && moisCible > ligne.endMonth) return false;
  return true;
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
  const { lines, isLoading, creerLigne, modifierLigne, supprimerLigne } = useTreasuryLines(activeAgency.id);
  const { actuals, isLoading: actualsChargement } = useTreasuryActuals(activeAgency.id);

  // Double garde (menu ET contenu, même principe que CarteProspectionView.tsx) :
  // « que par les super admins, Mélanie et Sylvain, c'est tout ».
  const identite = `${userProfile?.displayName || currentUser?.displayName || ''} ${userProfile?.email || currentUser?.email || ''}`;
  const estDirectionCF = /grazia|melanie|gestion@immosphera\.fr/i.test(identite);
  const estConseilsFinances = /conseils?\s*finances?/i.test(activeAgency?.name || '');

  const [debutFenetre] = useState(() => new Date(2026, 0, 1));
  const mois = useMemo(() => Array.from({ length: 12 }, (_, i) => ajouterMois(debutFenetre, i)), [debutFenetre]);
  const moisIsoListe = useMemo(() => mois.map(moisIso), [mois]);

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

  const lignesParCategorie = useMemo(() => {
    const map = new Map<string, TreasuryLine[]>();
    lines.forEach((l) => {
      const arr = map.get(l.category) || [];
      arr.push(l);
      map.set(l.category, arr);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [lines]);

  // Total par mois, toutes lignes confondues (positif = recette, négatif = dépense).
  const totalParMois = useMemo(
    () => moisIsoListe.map((m) => lines.reduce((s, l) => s + (ligneActiveSur(l, m) ? l.amount : 0), 0)),
    [lines, moisIsoListe]
  );
  const recettesParMois = useMemo(
    () => moisIsoListe.map((m) => lines.reduce((s, l) => s + (ligneActiveSur(l, m) && l.amount > 0 ? l.amount : 0), 0)),
    [lines, moisIsoListe]
  );
  const depensesParMois = useMemo(
    () => moisIsoListe.map((m) => lines.reduce((s, l) => s + (ligneActiveSur(l, m) && l.amount < 0 ? l.amount : 0), 0)),
    [lines, moisIsoListe]
  );
  // Cumul depuis le premier mois affiché — pas le solde bancaire réel, voir
  // la note en bas de page.
  const cumulParMois = useMemo(() => {
    let c = 0;
    return totalParMois.map((t) => { c += t; return c; });
  }, [totalParMois]);

  if (!estDirectionCF || !estConseilsFinances) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Cette page est réservée à la direction de Conseils Finances.
      </div>
    );
  }

  const ouvrirNouveau = () => { setForm(formVide(moisIsoListe[0])); setFormOuvert('nouveau'); };
  const ouvrirEdition = (l: TreasuryLine) => {
    setForm({
      label: l.label, category: l.category, kind: l.kind,
      sens: l.amount >= 0 ? 'recette' : 'depense',
      montant: String(Math.abs(l.amount)), month: l.month, endMonth: l.endMonth || '',
    });
    setFormOuvert(l.id);
  };

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
    <div className="space-y-6 bg-[#07191b] border border-[#1b4e52] rounded-2xl p-4 sm:p-6">
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
      <div className="rounded-2xl border border-[#144447]/60 bg-[#0a1e20]/60 p-4 space-y-3">
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
          <div className="overflow-y-auto overflow-x-auto custom-scrollbar rounded-xl border border-[#144447]/50 max-h-[70vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0a1e20] text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Date</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Libellé</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Description</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Crédit</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Débit</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Solde théorique</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#144447]/30">
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

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : (
        <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-[#144447]/60">
          <table className="w-full text-sm border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-[#0a1e20] text-[10px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-2 sticky left-0 bg-[#0a1e20] z-10 min-w-[220px]">Catégorie / ligne</th>
                <th className="text-center px-2 py-2 w-16">Type</th>
                {mois.map((m, i) => (
                  <th key={i} className="text-right px-3 py-2 min-w-[90px]">{libelleMois(m)}</th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#144447]/40">
              {lignesParCategorie.length === 0 ? (
                <tr>
                  <td colSpan={mois.length + 3} className="p-8 text-center text-sm text-slate-500">
                    Aucune ligne pour le moment. Ajoutez vos charges et recettes récurrentes ou ponctuelles.
                  </td>
                </tr>
              ) : (
                lignesParCategorie.map(([categorie, lignesCat]) => (
                  <React.Fragment key={categorie}>
                    <tr className="bg-[#0a1e20]/60">
                      <td className="px-4 py-1.5 font-bold text-[#F9C977] text-xs uppercase tracking-wide sticky left-0 bg-[#0a1e20]/60" colSpan={2}>
                        {categorie}
                      </td>
                      {moisIsoListe.map((m, i) => {
                        const total = lignesCat.reduce((s, l) => s + (ligneActiveSur(l, m) ? l.amount : 0), 0);
                        return (
                          <td key={i} className={`text-right px-3 py-1.5 text-xs font-bold ${total > 0 ? 'text-emerald-400' : total < 0 ? 'text-red-400' : 'text-slate-600'}`}>
                            {total !== 0 ? formatCurrencyPrecis(total) : '—'}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                    {lignesCat.map((ligne) => (
                      <tr key={ligne.id} className="hover:bg-white/5 group">
                        <td className="px-4 py-2 pl-6 text-slate-200 sticky left-0 bg-[#07191b] group-hover:bg-[#0a1e20]">
                          <button onClick={() => ouvrirEdition(ligne)} className="text-left hover:text-[#F9C977] hover:underline flex items-center gap-1.5">
                            {ligne.amount >= 0 ? <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" /> : <TrendingDown className="w-3 h-3 text-red-400 shrink-0" />}
                            {ligne.label}
                          </button>
                        </td>
                        <td className="text-center px-2 py-2">
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${ligne.kind === 'recurrent' ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {ligne.kind === 'recurrent' ? 'Récur.' : 'Ponct.'}
                          </span>
                        </td>
                        {moisIsoListe.map((m, i) => (
                          <td key={i} className={`text-right px-3 py-2 tabular-nums ${ligne.amount > 0 ? 'text-emerald-300' : 'text-slate-300'}`}>
                            {ligneActiveSur(ligne, m) ? formatCurrencyPrecis(ligne.amount) : ''}
                          </td>
                        ))}
                        <td className="px-1">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                            <button onClick={() => ouvrirEdition(ligne)} className="p-1 text-slate-400 hover:text-white" title="Modifier">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { if (confirm(`Supprimer « ${ligne.label} » ?`)) supprimerLigne.mutate(ligne.id); }}
                              className="p-1 text-slate-400 hover:text-red-400"
                              title="Supprimer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#144447] bg-[#0a1e20]">
                <td className="px-4 py-2 text-xs font-bold text-emerald-400 sticky left-0 bg-[#0a1e20]" colSpan={2}>Total recettes</td>
                {recettesParMois.map((v, i) => (
                  <td key={i} className="text-right px-3 py-2 text-xs font-bold text-emerald-400 tabular-nums">{formatCurrencyPrecis(v)}</td>
                ))}
                <td />
              </tr>
              <tr className="bg-[#0a1e20]">
                <td className="px-4 py-2 text-xs font-bold text-red-400 sticky left-0 bg-[#0a1e20]" colSpan={2}>Total dépenses</td>
                {depensesParMois.map((v, i) => (
                  <td key={i} className="text-right px-3 py-2 text-xs font-bold text-red-400 tabular-nums">{formatCurrencyPrecis(v)}</td>
                ))}
                <td />
              </tr>
              <tr className="bg-[#0a1e20] border-t border-[#144447]/60">
                <td className="px-4 py-2 text-xs font-bold text-white sticky left-0 bg-[#0a1e20]" colSpan={2}>Solde du mois</td>
                {totalParMois.map((v, i) => (
                  <td key={i} className={`text-right px-3 py-2 text-xs font-bold tabular-nums ${v >= 0 ? 'text-[#F9C977]' : 'text-red-400'}`}>{formatCurrencyPrecis(v)}</td>
                ))}
                <td />
              </tr>
              <tr className="bg-[#0a1e20]/80">
                <td className="px-4 py-2 text-[11px] text-slate-500 sticky left-0 bg-[#0a1e20]/80" colSpan={2}>Cumul (depuis le début de cette vue)</td>
                {cumulParMois.map((v, i) => (
                  <td key={i} className={`text-right px-3 py-2 text-[11px] tabular-nums ${v >= 0 ? 'text-slate-400' : 'text-red-400/80'}`}>{formatCurrencyPrecis(v)}</td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Le cumul ci-dessus part de zéro au premier mois affiché : ce n'est pas le solde réel du compte bancaire,
        seulement l'effet net des lignes de ce prévisionnel sur la période visible. Une ligne récurrente se répète
        chaque mois entre son mois de départ et, si elle en a une, sa date de fin ; une ligne ponctuelle ne compte
        que sur son propre mois.
      </p>

      {/* Onglets mois du grand livre réel, en bas de la vue */}
      <div className="sticky bottom-0 flex flex-wrap gap-1.5 justify-center pt-3 border-t border-[#144447]/60 bg-[#07191b]">
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
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-[#07191b] border border-[#1b4e52] shadow-2xl p-5 space-y-4">
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
