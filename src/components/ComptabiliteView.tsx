import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Plus, Check, Pencil, CopyPlus, Trash2, Palette, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTreasuryLines } from '@/hooks/useTreasuryLines';
import { useTreasuryActuals, TreasuryActual } from '@/hooks/useTreasuryActuals';
import { useTreasuryMonthOverrides } from '@/hooks/useTreasuryMonthOverrides';
import { TreasuryLine } from '@/types';
import { formatCurrencyPrecis } from '@/lib/utils';

const MOIS_ONGLETS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
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

// Même logique que dernierJourDuMois (useTreasuryActuals.ts) : borne un jour
// souhaité au dernier jour réel du mois visé (ex. jourPrelevement 31 en
// février retombe sur le 28/29, jamais sur mars).
function dernierJourDuMoisIso(annee: number, moisUnIndexe: number): number {
  return new Date(annee, moisUnIndexe, 0).getDate();
}

// Calcule la date ISO d'une occurrence pour une année/mois donnés à partir
// d'un jour de prélèvement souhaité, clampé au dernier jour réel du mois.
function dateAvecJour(annee: number, moisUnIndexe: number, jourSouhaite: number): string {
  const jour = Math.min(jourSouhaite, dernierJourDuMoisIso(annee, moisUnIndexe));
  return `${annee}-${String(moisUnIndexe).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

interface FormLigne {
  label: string;
  category: string;
  kind: 'recurrent' | 'ponctuel';
  sens: 'recette' | 'depense';
  montant: string;
  month: string;
  endMonth: string;
  // Jour du prélèvement/virement réel (1-31), optionnel — voir le champ
  // `jourPrelevement` de TreasuryLine. Chaîne vide = pas fixé, la ligne
  // se matérialise alors au 1er du mois comme avant (6 septembre).
  jourPrelevement: string;
}

const formVide = (moisParDefaut: string): FormLigne => ({
  label: '', category: '', kind: 'recurrent', sens: 'depense', montant: '', month: moisParDefaut, endMonth: '', jourPrelevement: '',
});

interface FormActual {
  date: string;
  label: string;
  description: string;
  credit: string;
  debit: string;
  previsionnel: boolean;
}

const formActualVide = (dateParDefaut: string): FormActual => ({
  date: dateParDefaut, label: '', description: '', credit: '0', debit: '0', previsionnel: false,
});

// Palette de couleurs prédéfinies pour marquer une ligne du grand livre
// (catégorisation libre, ex. « à surveiller », « regroupement thématique »).
const PALETTE_COULEURS = [
  { nom: 'Ambre', valeur: '#F7BC5F' },
  { nom: 'Vert', valeur: '#22C55E' },
  { nom: 'Rouge', valeur: '#EF4444' },
  { nom: 'Bleu', valeur: '#3B82F6' },
  { nom: 'Violet', valeur: '#A855F7' },
  { nom: 'Rose', valeur: '#EC4899' },
];

export default function ComptabiliteView() {
  const { userProfile, currentUser, activeAgency } = useAuth();
  const { lines, creerLigne, modifierLigne, supprimerLigne } = useTreasuryLines(activeAgency.id);
  const {
    actuals,
    isLoading: actualsChargement,
    creerActual,
    modifierActual,
    supprimerActual,
    dupliquerJusquaDecembre,
  } = useTreasuryActuals(activeAgency.id);
  const { overrides, definirOverride, supprimerOverride } = useTreasuryMonthOverrides(activeAgency.id);

  // Double garde (menu ET contenu, même principe que CarteProspectionView.tsx) :
  // « que par les super admins, Mélanie et Sylvain, c'est tout ».
  const identite = `${userProfile?.displayName || currentUser?.displayName || ''} ${userProfile?.email || currentUser?.email || ''}`;
  const estDirectionCF = /grazia|melanie|gestion@immosphera\.fr/i.test(identite);
  const estConseilsFinances = /conseils?\s*finances?/i.test(activeAgency?.name || '');

  // Onglets ouverts par défaut sur le mois/année en cours (demandé le 6
  // septembre : « en fonction du mois, mets l'onglet qu'il faut »).
  const [anneeActive, setAnneeActive] = useState<'2026' | '2027'>(() => {
    const anneeCourante = String(new Date().getFullYear());
    return anneeCourante === '2027' ? '2027' : '2026';
  });
  const [moisActuelOnglet, setMoisActuelOnglet] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));

  // Corrections manuelles du solde de départ, par mois (agence active) :
  // « je veux pouvoir modifier chaque mois les soldes de départ pour
  // corriger si besoin ». Clé "année-mois", ex. "2026-03".
  const overridesParMois = useMemo(() => {
    const map = new Map<string, number>();
    overrides.forEach((o) => map.set(`${o.year}-${o.month}`, o.soldeOuverture));
    return map;
  }, [overrides]);

  // Solde bancaire cumulé (renommé depuis « solde théorique » — demande :
  // « il faut que tu additionnes les rentrées et tu soustrait les sorties
  // qui ont été checker et normalement je dois retomber sur le compte
  // actuel de la banque ») : on part de la toute première ligne du grand
  // livre (le report d'ouverture) et on accumule dans l'ordre chronologique
  // complet, tous mois ET toutes années confondus (le solde de clôture 2026
  // devient naturellement le solde d'ouverture 2027). Une correction
  // manuelle sur un mois réinitialise le solde cumulé à ce point précis dans
  // la passe unique : elle se propage donc naturellement à tous les mois
  // suivants, jusqu'à la prochaine correction éventuelle.
  //
  // Ce cumul doit toujours retomber sur le VRAI solde bancaire : on
  // n'ajoute donc un crédit que s'il est coché confirmé (`creditConfirme`)
  // et on ne soustrait un débit que s'il est coché confirmé
  // (`debitConfirme`) — peu importe que la ligne soit encore
  // `previsionnel: true` ou non (une ligne prévisionnelle est de toute façon
  // quasi toujours non confirmée, mais on teste directement les booléens de
  // confirmation, pas le flag `previsionnel`, pour rester correct dans tous
  // les cas). Une ligne avec un crédit/débit non confirmé apparaît toujours
  // dans sa cellule Crédit/Débit avec son bouton à cocher, mais ne bouge pas
  // ce cumul tant qu'elle n'est pas cochée.
  const actualsAvecSolde = useMemo(() => {
    let solde = 0;
    let dernierMoisCle: string | null = null;
    return actuals.map((a) => {
      const annee = a.date.slice(0, 4);
      const moisCle = `${annee}-${a.monthSheet}`;
      if (moisCle !== dernierMoisCle) {
        const override = overridesParMois.get(moisCle);
        if (override !== undefined) {
          solde = override;
        }
        dernierMoisCle = moisCle;
      }
      if (a.creditConfirme) solde += a.credit;
      if (a.debitConfirme) solde -= a.debit;
      return { ...a, soldeApres: solde };
    });
  }, [actuals, overridesParMois]);

  // Solde prévisionnel (6 septembre, re-précisé lors du passage au « solde
  // bancaire » confirmé ci-dessus) : cumul « optimiste » — on compte TOUT,
  // crédits et débits, confirmés ou non, prévisionnels ou non, comme si
  // chaque ligne se dénouait exactement telle que saisie. Cette colonne ne
  // change pas avec le passage du solde bancaire à un cumul confirmé
  // uniquement : elle continue de sommer chaque ligne sans condition — c'est
  // ce qui la distingue du « Solde bancaire » désormais gated sur
  // creditConfirme/debitConfirme.
  const soldePrevisionnelParId = useMemo(() => {
    let solde = 0;
    let dernierMoisCle: string | null = null;
    const map = new Map<string, number>();
    actuals.forEach((a) => {
      const annee = a.date.slice(0, 4);
      const moisCle = `${annee}-${a.monthSheet}`;
      if (moisCle !== dernierMoisCle) {
        const override = overridesParMois.get(moisCle);
        if (override !== undefined) solde = override;
        dernierMoisCle = moisCle;
      }
      solde += a.credit - a.debit;
      map.set(a.id, solde);
    });
    return map;
  }, [actuals, overridesParMois]);

  // Demandé le 6 septembre : « je ne veux plus avoir ce genre de choses qui
  // apparaissent, élimine ça [...] du moment que je vais rentrer des
  // éléments, ça sera intégré directement dans le tableau, je devrais
  // checker pour confirmer la validation du montant » — plus de panneau
  // séparé « en attente » : toute ligne du mois s'affiche directement ici,
  // qu'elle soit cochée ou non (le flag `previsionnel` n'est plus utilisé
  // pour filtrer l'affichage, seules `creditConfirme`/`debitConfirme`
  // pilotent le solde bancaire confirmé).
  const actualsDuMoisActif = useMemo(
    () => actualsAvecSolde.filter((a) => a.monthSheet === moisActuelOnglet && a.date.startsWith(anneeActive)),
    [actualsAvecSolde, moisActuelOnglet, anneeActive]
  );

  // Totaux du bas de tableau (6 septembre : « solde débit ensuite crédit et
  // ensuite prévisionnel ») — débit et crédit portent sur les lignes
  // confirmées du mois. Reprécisé le 6 septembre : « pour l'instant
  // concernant les prévisionnels c'est toutes les lignes qui ne sont pas
  // cochées, il faut que tu le mettes dedans » — le prévisionnel compte
  // désormais TOUTES les lignes du mois pas encore cochées (crédit ou
  // débit, qu'elles soient ou non marquées `previsionnel`), pas seulement
  // les lignes en attente de validation.
  const totalDebitMois = useMemo(() => actualsDuMoisActif.reduce((s, a) => s + a.debit, 0), [actualsDuMoisActif]);
  const totalCreditMois = useMemo(() => actualsDuMoisActif.reduce((s, a) => s + a.credit, 0), [actualsDuMoisActif]);
  const toutesLignesDuMoisActif = useMemo(
    () => actuals.filter((a) => a.monthSheet === moisActuelOnglet && a.date.startsWith(anneeActive)),
    [actuals, moisActuelOnglet, anneeActive]
  );
  const totalPrevisionnelMois = useMemo(
    () =>
      toutesLignesDuMoisActif.reduce((s, a) => {
        let net = 0;
        if (a.credit > 0 && !a.creditConfirme) net += a.credit;
        if (a.debit > 0 && !a.debitConfirme) net -= a.debit;
        return s + net;
      }, 0),
    [toutesLignesDuMoisActif]
  );

  const moisIsoActif = `${anneeActive}-${moisActuelOnglet}-01`;

  const lignesDuMoisActif = useMemo(
    () => lines.filter((l) =>
      l.kind === 'ponctuel' ? l.month === moisIsoActif : moisIsoActif >= l.month && (!l.endMonth || moisIsoActif <= l.endMonth)
    ),
    [lines, moisIsoActif]
  );

  // Matérialisation automatique des lignes récurrentes/ponctuelles dans le
  // grand livre daté (6 septembre : « il faut que tu comptabilises les
  // récurrences dans le tableau prévisionnel aussi [...] qu'on puisse les
  // checker »). Pour chaque ligne active du mois actif, si aucune occurrence
  // datée (treasury_actuals.source_line_id) n'existe déjà pour ce mois, on en
  // crée une en attente de validation (previsionnel: true), casée au 1er du
  // mois — l'utilisateur la valide (✓) une fois le prélèvement/virement
  // effectivement passé sur le compte, comme n'importe quelle autre ligne du
  // panneau « en attente ». On ne fait ça QUE pour le mois/année actuellement
  // ouvert (pas d'un coup pour tous les mois futurs), pour rester léger.
  //
  // Garde anti-doublon à deux niveaux :
  //  1. On vérifie d'abord dans `actuals` (déjà chargé, réactif) si une ligne
  //     avec ce `source_line_id` existe déjà pour ce mois/année — c'est le
  //     cas normal une fois la création précédente retombée par invalidation
  //     react-query.
  //  2. Un ref `Set` mémorise en plus, pour la session en cours, les clés
  //     `${ligne.id}-${année}-${mois}` déjà demandées à la création — ça
  //     couvre le cas d'un aller-retour réseau lent entre l'insertion et le
  //     rechargement (ou un double rendu en StrictMode) qui pourrait sinon
  //     déclencher une deuxième insertion avant que `actuals` n'ait eu le
  //     temps de refléter la première.
  // Limite connue et acceptée (pas à résoudre ici) : si l'utilisateur avait
  // déjà saisi à la main, avant cette fonctionnalité, une ligne pour le même
  // loyer/abonnement réel, elle peut apparaître en double avec l'occurrence
  // auto-matérialisée — la détection ne se fait que par `source_line_id`, pas
  // par rapprochement de libellé.
  const clesMaterialiseesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (actualsChargement) return; // évite d'agir sur un `actuals` encore incomplet
    lignesDuMoisActif.forEach((ligne) => {
      const cle = `${ligne.id}-${anneeActive}-${moisActuelOnglet}`;
      if (clesMaterialiseesRef.current.has(cle)) return;
      const dejaMaterialisee = actuals.some(
        (a) => a.sourceLineId === ligne.id && a.monthSheet === moisActuelOnglet && a.date.startsWith(anneeActive)
      );
      if (dejaMaterialisee) {
        clesMaterialiseesRef.current.add(cle);
        return;
      }
      clesMaterialiseesRef.current.add(cle);
      // Jour de prélèvement fixé sur la ligne (6 septembre : « ça se
      // prélève tous les 10 de chaque mois ») : on l'utilise à la place du
      // 1er du mois par défaut, clampé au dernier jour réel du mois.
      const dateMaterialisation = ligne.jourPrelevement
        ? dateAvecJour(Number(anneeActive), Number(moisActuelOnglet), ligne.jourPrelevement)
        : moisIsoActif;
      creerActual.mutate({
        date: dateMaterialisation,
        label: ligne.label,
        description: ligne.kind === 'recurrent' ? `Récurrent — ${ligne.category}` : `Ponctuel — ${ligne.category}`,
        credit: ligne.amount >= 0 ? ligne.amount : 0,
        debit: ligne.amount < 0 ? Math.abs(ligne.amount) : 0,
        // Plus de panneau « en attente » séparé (6 septembre) : la ligne
        // matérialisée apparaît directement dans le tableau, à cocher sur
        // place comme n'importe quelle autre.
        previsionnel: false,
        sourceLineId: ligne.id,
        silencieux: true,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignesDuMoisActif, actuals, actualsChargement, anneeActive, moisActuelOnglet, moisIsoActif]);

  const overrideMoisActif = overridesParMois.get(`${anneeActive}-${moisActuelOnglet}`);

  const soldeOuvertureMoisActif = useMemo(() => {
    if (overrideMoisActif !== undefined) return overrideMoisActif;
    const idxPremier = actualsAvecSolde.findIndex((a) => a.monthSheet === moisActuelOnglet && a.date.startsWith(anneeActive));
    if (idxPremier === -1) return 0;
    if (idxPremier === 0) return actualsAvecSolde[0].soldeApres - (actualsAvecSolde[0].credit - actualsAvecSolde[0].debit);
    return actualsAvecSolde[idxPremier - 1].soldeApres;
  }, [actualsAvecSolde, moisActuelOnglet, anneeActive, overrideMoisActif]);

  const soldeClotureMoisActif = actualsDuMoisActif.length > 0
    ? actualsDuMoisActif[actualsDuMoisActif.length - 1].soldeApres
    : soldeOuvertureMoisActif;

  // Reprécisé le 6 septembre : « la colonne du solde prévisionnel, ce n'est
  // pas la peine d'avoir des montants [...] on voudra bien le total tout en
  // bas en faisant la différence entre les recettes et les dépenses [...]
  // ce sera le solde prévisionnel fin de mois » — plus un cumul, mais un
  // simple net recettes − dépenses du mois affiché.
  const soldePrevisionnelFinDeMoisActif = totalCreditMois - totalDebitMois;

  // « Prévisionnel fin de mois » (demande : « dans le prévisionnel tu mettes
  // tout ce qui n'a pas été débité [...] tu le soustrais au solde du compte
  // bancaire ») : somme des DÉBITS pas encore confirmés du mois actif —
  // prévisionnels ou non, peu importe, seul compte `debitConfirme === false`
  // — c'est la réserve de trésorerie à garder de côté pour ces sorties pas
  // encore parties. On la retranche au solde bancaire confirmé de clôture du
  // mois pour obtenir une estimation prudente de fin de mois. Les crédits
  // non confirmés ne sont volontairement PAS ajoutés (formule dictée par
  // l'utilisateur, volontairement conservatrice sur les sorties uniquement).
  const previsionnelDebitsNonConfirmes = useMemo(
    () => actuals
      .filter((a) => a.monthSheet === moisActuelOnglet && a.date.startsWith(anneeActive) && !a.debitConfirme)
      .reduce((s, a) => s + a.debit, 0),
    [actuals, moisActuelOnglet, anneeActive]
  );

  const previsionnelFinDeMois = soldeClotureMoisActif - previsionnelDebitsNonConfirmes;

  const [formOuvert, setFormOuvert] = useState<string | null>(null); // null = fermé, 'nouveau' ou id d'une ligne éditée
  const [form, setForm] = useState<FormLigne>(() => formVide(moisIso(new Date())));

  // Formulaire distinct pour les lignes du grand livre réel (treasury_actuals) :
  // null = fermé, 'nouveau' ou id de la ligne éditée.
  const [ligneActualOuverte, setLigneActualOuverte] = useState<string | null>(null);
  const [formActual, setFormActual] = useState<FormActual>(() => formActualVide(`2026-01-01`));

  // Popover couleur / notes ouvert sur une ligne du grand livre (id de la
  // ligne, ou null si fermé). Un seul popover à la fois.
  const [couleurPickerOuvert, setCouleurPickerOuvert] = useState<string | null>(null);
  const [notePopoverOuvert, setNotePopoverOuvert] = useState<string | null>(null);
  const [valeurNoteEdition, setValeurNoteEdition] = useState('');
  // Case « Commentaire » séparée des notes (6 septembre) : on peut y taper
  // un petit calcul (additions/soustractions) et voir le résultat tout de
  // suite, sans quitter la ligne.
  const [commentPopoverOuvert, setCommentPopoverOuvert] = useState<string | null>(null);
  const [valeurCommentEdition, setValeurCommentEdition] = useState('');

  // Correction manuelle du solde de départ du mois actif.
  const [correctionOuvertureOuverte, setCorrectionOuvertureOuverte] = useState(false);
  const [valeurCorrectionOuverture, setValeurCorrectionOuverture] = useState('');

  // Demandé le 6 septembre : « je ne veux plus voir ces lignes
  // prévisionnelles tout en haut [...] le livre tout en bas, je veux que
  // par défaut, soit replié » — les deux panneaux restent disponibles au
  // clic mais démarrent repliés pour ne plus encombrer l'écran.
  const [ligneRecurrentesDepliees, setLigneRecurrentesDepliees] = useState(false);

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

  const ouvrirNouveau = () => { setForm(formVide(moisIsoActif)); setFormOuvert('nouveau'); };

  const ouvrirEdition = (ligne: TreasuryLine) => {
    setForm({
      label: ligne.label,
      category: ligne.category,
      kind: ligne.kind,
      sens: ligne.amount < 0 ? 'depense' : 'recette',
      montant: String(Math.abs(ligne.amount)),
      month: ligne.month,
      endMonth: ligne.endMonth || '',
      jourPrelevement: ligne.jourPrelevement ? String(ligne.jourPrelevement) : '',
    });
    setFormOuvert(ligne.id);
  };

  const supprimerLigneAvecConfirmation = (id: string) => {
    if (window.confirm('Supprimer définitivement cette ligne récurrente/ponctuelle ?')) {
      supprimerLigne.mutate(id);
    }
  };

  const soumettre = () => {
    const montantNombre = Number(form.montant.replace(',', '.'));
    if (!form.label.trim() || !form.category.trim() || !Number.isFinite(montantNombre) || montantNombre <= 0) return;
    const amount = form.sens === 'depense' ? -Math.abs(montantNombre) : Math.abs(montantNombre);
    const jourPrelevement = form.jourPrelevement ? Number(form.jourPrelevement) : null;
    const payload = {
      label: form.label.trim(),
      category: form.category.trim(),
      kind: form.kind,
      amount,
      month: form.month,
      endMonth: form.kind === 'recurrent' ? (form.endMonth || null) : null,
      jourPrelevement,
    };
    if (formOuvert === 'nouveau') {
      creerLigne.mutate(payload);
    } else if (formOuvert) {
      const ligneOriginale = lines.find((l) => l.id === formOuvert);
      modifierLigne.mutate({ id: formOuvert, ...payload });
      // Correction du jour de prélèvement (6 septembre : « je vais avoir
      // également la possibilité de changer les dates et de pouvoir
      // confirmer par la suite ») : si le jour change, on recale aussi les
      // occurrences déjà matérialisées mais pas encore cochées (ni crédit ni
      // débit confirmé) de cette ligne, tous mois confondus — jamais celles
      // déjà validées/cochées, ni celles d'une autre ligne récurrente.
      if (ligneOriginale && (ligneOriginale.jourPrelevement ?? null) !== jourPrelevement && jourPrelevement) {
        actuals
          .filter((a) => a.sourceLineId === formOuvert && !a.creditConfirme && !a.debitConfirme)
          .forEach((a) => {
            const annee = Number(a.date.slice(0, 4));
            const mois = Number(a.date.slice(5, 7));
            const dateCorrigee = dateAvecJour(annee, mois, jourPrelevement);
            if (dateCorrigee !== a.date.slice(0, 10)) {
              modifierActual.mutate({ id: a.id, date: dateCorrigee });
            }
          });
      }
    }
    setFormOuvert(null);
  };

  const ouvrirNouvelActual = () => {
    setFormActual(formActualVide(moisIsoActif));
    setLigneActualOuverte('nouveau');
  };

  const ouvrirModifierActual = (a: TreasuryActual) => {
    setFormActual({
      date: a.date.slice(0, 10),
      label: a.label,
      description: a.description,
      credit: String(a.credit || 0),
      debit: String(a.debit || 0),
      previsionnel: a.previsionnel,
    });
    setLigneActualOuverte(a.id);
  };

  // Plus de panneau « en attente » (6 septembre : « élimine ça [...] ça sera
  // intégré directement dans le tableau, je devrais checker pour confirmer
  // la validation du montant ») : toute ligne, avec ou sans date, va
  // directement dans le grand livre, cochable sur place. Sans date, on case
  // simplement la ligne au 1er du mois actif (modifiable ensuite).
  const soumettreActual = () => {
    const credit = Number(formActual.credit.replace(',', '.')) || 0;
    const debit = Number(formActual.debit.replace(',', '.')) || 0;
    if (!formActual.label.trim() || (credit <= 0 && debit <= 0)) return;
    const payload = {
      date: formActual.date || moisIsoActif,
      label: formActual.label.trim(),
      description: formActual.description.trim(),
      credit,
      debit,
      previsionnel: false,
    };
    if (ligneActualOuverte === 'nouveau') {
      creerActual.mutate(payload);
    } else if (ligneActualOuverte) {
      modifierActual.mutate({ id: ligneActualOuverte, ...payload });
    }
    setLigneActualOuverte(null);
  };

  // « Le choix entre les deux » (6 septembre) : sans date connue, une ligne
  // peut aussi bien devenir une ligne récurrente/ponctuelle du tableau
  // prévisionnel du bas plutôt qu'une ligne en attente du grand livre —
  // on reprend le libellé et le montant déjà saisis pour ne pas les
  // retaper dans l'autre formulaire.
  const basculerVersTableauPrevisionnel = () => {
    const credit = Number(formActual.credit.replace(',', '.')) || 0;
    const debit = Number(formActual.debit.replace(',', '.')) || 0;
    setLigneActualOuverte(null);
    setForm({
      label: formActual.label.trim(),
      category: '',
      kind: 'ponctuel',
      sens: credit > 0 ? 'recette' : 'depense',
      montant: String(credit > 0 ? credit : debit),
      month: moisIsoActif,
      endMonth: '',
    });
    setFormOuvert('nouveau');
  };

  const ouvrirNotePopover = (a: TreasuryActual) => {
    setValeurNoteEdition(a.notes || '');
    setNotePopoverOuvert(a.id);
    setCouleurPickerOuvert(null);
    setCommentPopoverOuvert(null);
  };

  const enregistrerNote = (id: string) => {
    modifierActual.mutate({ id, notes: valeurNoteEdition.trim() || null });
    setNotePopoverOuvert(null);
  };

  const ouvrirCommentPopover = (a: TreasuryActual) => {
    setValeurCommentEdition(a.comment || '');
    setCommentPopoverOuvert(a.id);
    setCouleurPickerOuvert(null);
    setNotePopoverOuvert(null);
  };

  const enregistrerComment = (id: string) => {
    modifierActual.mutate({ id, comment: valeurCommentEdition.trim() || null });
    setCommentPopoverOuvert(null);
  };

  // Petit calculateur (6 septembre : « je pourrais faire des formules car
  // parfois je suis sous à faire des additions soustractions ») : on
  // n'évalue JAMAIS le texte tel quel (pas de eval() sur de la saisie
  // libre) — seuls les chiffres, + - * / . , et parenthèses sont acceptés,
  // tout le reste renvoie « pas de résultat ». Le texte tapé reste stocké
  // tel quel dans le commentaire ; seul un aperçu du résultat est affiché.
  const resultatFormule = (texte: string): number | null => {
    const nettoye = texte.trim().replace(/,/g, '.');
    if (!nettoye || !/^[0-9+\-*/().\s]+$/.test(nettoye)) return null;
    if (!/[0-9]/.test(nettoye)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const resultat = Function(`"use strict"; return (${nettoye});`)();
      return typeof resultat === 'number' && Number.isFinite(resultat) ? resultat : null;
    } catch {
      return null;
    }
  };

  const supprimerActualAvecConfirmation = (id: string) => {
    if (window.confirm('Supprimer définitivement cette ligne du grand livre ?')) {
      supprimerActual.mutate(id);
    }
  };

  const overrideActifDetail = overrides.find((o) => o.year === Number(anneeActive) && o.month === moisActuelOnglet);

  const ouvrirCorrectionOuverture = () => {
    setValeurCorrectionOuverture(String(soldeOuvertureMoisActif));
    setCorrectionOuvertureOuverte(true);
  };

  const soumettreCorrectionOuverture = () => {
    const valeur = Number(valeurCorrectionOuverture.replace(',', '.'));
    if (!Number.isFinite(valeur)) return;
    definirOverride.mutate({ year: Number(anneeActive), month: moisActuelOnglet, soldeOuverture: valeur });
    setCorrectionOuvertureOuverte(false);
  };

  const reinitialiserCorrectionOuverture = () => {
    if (overrideActifDetail) supprimerOverride.mutate(overrideActifDetail.id);
    setCorrectionOuvertureOuverte(false);
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
          <button
            onClick={ouvrirNouvelActual}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-[#2a6a6f] text-slate-200 text-xs font-bold hover:bg-white/10"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter au grand livre
          </button>
        </div>
      </div>

      {/* Onglets année */}
      <div className="flex items-center gap-1.5">
        {(['2026', '2027'] as const).map((annee) => (
          <button
            key={annee}
            onClick={() => setAnneeActive(annee)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
              anneeActive === annee
                ? 'bg-[#F7BC5F] text-slate-950'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {annee}
          </button>
        ))}
      </div>

      {/* Solde bancaire — grand livre du mois actif */}
      <div className="rounded-2xl border-2 border-[#2a6a6f] bg-[#0a1e20]/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">
            Solde bancaire — Grand livre {moisActuelOnglet} · {NOMS_MOIS_COURT[moisActuelOnglet]}
          </h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="relative flex items-center gap-1.5 text-slate-400">
              {moisActuelOnglet === '01' ? 'Solde de départ : ' : 'Solde ouverture : '}
              <span className={`font-bold ${soldeOuvertureMoisActif >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrencyPrecis(soldeOuvertureMoisActif)}
              </span>
              {overrideActifDetail && (
                <span className="text-[10px] font-bold" style={{ color: '#F9C977' }}>(corrigé)</span>
              )}
              <button
                onClick={ouvrirCorrectionOuverture}
                title="Corriger le solde de départ de ce mois"
                className="text-slate-500 hover:text-[#F7BC5F]"
              >
                <Pencil className="w-3 h-3" />
              </button>
              {overrideActifDetail && (
                <button
                  onClick={reinitialiserCorrectionOuverture}
                  title="Revenir au calcul automatique"
                  className="text-[10px] text-slate-500 hover:text-[#F7BC5F] underline"
                >
                  ↺ Réinitialiser
                </button>
              )}
              {correctionOuvertureOuverte && (
                <div
                  className="absolute left-0 top-full mt-2 z-20 flex items-center gap-2 p-2 rounded-lg bg-[#0a1e20] border-2 border-[#2a6a6f] shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="number" step="0.01" autoFocus value={valeurCorrectionOuverture}
                    onChange={(e) => setValeurCorrectionOuverture(e.target.value)}
                    className="w-28 px-2 py-1 rounded bg-[#07191b] border border-[#144447]/60 text-white text-xs focus:outline-none focus:border-[#F7BC5F]/60"
                  />
                  <button
                    onClick={soumettreCorrectionOuverture}
                    disabled={definirOverride.isPending}
                    className="px-2 py-1 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-slate-950 text-[10px] font-bold whitespace-nowrap"
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={() => setCorrectionOuvertureOuverte(false)}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </span>
            <span className="text-slate-400">
              Solde clôture :{' '}
              <span className={`font-bold ${soldeClotureMoisActif >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrencyPrecis(soldeClotureMoisActif)}
              </span>
            </span>
            {/* Prévisionnel fin de mois (demande : « Prévisionnel fin de
                mois [...] = Solde bancaire − Prévisionnel [tout ce qui n'a
                pas été débité] ») : solde bancaire confirmé de clôture du
                mois, moins les débits pas encore confirmés — une estimation
                prudente de ce qui restera une fois toutes les sorties en
                attente réellement passées. */}
            <span className="flex items-center gap-1.5" title="Solde bancaire (clôture confirmée) − débits pas encore confirmés du mois">
              <span style={{ color: '#F9C977' }}>Prévisionnel fin de mois :</span>
              <span className={`font-bold ${previsionnelFinDeMois >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrencyPrecis(previsionnelFinDeMois)}
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
                {/* Liserés verticaux entre colonnes (6 septembre) : la
                    largeur de chaque colonne reste libre (pas de largeur
                    fixée en dur, elle suit ce qu'il y a dedans), seul un
                    trait vertical vient séparer les colonnes entre elles. */}
                <tr className="bg-[#0a1e20] text-[10px] uppercase tracking-widest text-slate-500 border-b-2 border-[#2a6a6f] divide-x divide-[#2a6a6f]/50">
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Date</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Libellé</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Description</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20]">Note</th>
                  <th className="text-left px-3 py-2 bg-[#0a1e20] text-sky-300/80">Commentaire</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Crédit</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]">Débit</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20] text-[#F7BC5F]/80">Solde prévisionnel</th>
                  <th className="text-right px-3 py-2 bg-[#0a1e20]" title="Cumul confirmé uniquement — retombe sur le vrai solde bancaire">Solde bancaire</th>
                  <th className="text-right px-2 py-2 bg-[#0a1e20]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a6a6f]/70">
                {/* Lignes alternées (6 septembre : « une plus foncée, une
                    plus claire ») pour repérer une ligne d'un coup d'œil sur
                    un grand livre qui peut compter beaucoup de mouvements —
                    une couleur choisie par l'utilisateur (a.color) prime
                    toujours sur cette alternance. */}
                {actualsDuMoisActif.map((a, idx) => (
                  <tr
                    key={a.id}
                    className={`group hover:bg-white/5 relative divide-x divide-[#2a6a6f]/25 ${!a.color && idx % 2 === 1 ? 'bg-white/[0.035]' : ''}`}
                    style={a.color ? { borderLeft: `5px solid ${a.color}`, backgroundColor: `${a.color}38` } : undefined}
                  >
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap text-xs">
                      {new Date(a.date).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-1.5 text-slate-200 text-xs">{a.label}</td>
                    <td className="px-3 py-1.5 text-slate-500 text-xs">{a.description}</td>
                    <td className="px-2 py-1 text-xs align-top">
                      {notePopoverOuvert === a.id ? (
                        <textarea
                          autoFocus
                          rows={2}
                          value={valeurNoteEdition}
                          onChange={(e) => setValeurNoteEdition(e.target.value)}
                          onBlur={() => enregistrerNote(a.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setNotePopoverOuvert(null);
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) enregistrerNote(a.id);
                          }}
                          placeholder="Note libre…"
                          className="w-full min-w-[140px] px-1.5 py-1 rounded border border-amber-400 bg-amber-300 text-slate-900 text-xs resize-y focus:outline-none"
                        />
                      ) : a.notes ? (
                        <div
                          onClick={() => ouvrirNotePopover(a)}
                          title="Cliquer pour modifier la note"
                          className="max-h-12 overflow-y-auto custom-scrollbar text-slate-900 italic leading-snug cursor-text hover:brightness-95 whitespace-pre-wrap px-1.5 py-1 rounded border border-amber-400 bg-amber-300"
                        >
                          {a.notes}
                        </div>
                      ) : (
                        <div
                          onClick={() => ouvrirNotePopover(a)}
                          title="Cliquer pour ajouter une note"
                          className="text-slate-600 hover:text-[#F9C977] italic text-[11px] cursor-text px-1.5 py-1"
                        >
                          + Ajouter une note
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-xs align-top">
                      {commentPopoverOuvert === a.id ? (
                        <div className="space-y-1 min-w-[140px]">
                          <textarea
                            autoFocus
                            rows={2}
                            value={valeurCommentEdition}
                            onChange={(e) => setValeurCommentEdition(e.target.value)}
                            onBlur={() => enregistrerComment(a.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setCommentPopoverOuvert(null);
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) enregistrerComment(a.id);
                            }}
                            placeholder="Commentaire ou calcul, ex : 150+200-30"
                            className="w-full px-1.5 py-1 rounded border border-sky-400 bg-[#0a1e20] text-white text-xs resize-y focus:outline-none"
                          />
                          {resultatFormule(valeurCommentEdition) !== null && (
                            <p className="text-[11px] text-sky-300 font-bold">
                              = {formatCurrencyPrecis(resultatFormule(valeurCommentEdition) as number)}
                            </p>
                          )}
                        </div>
                      ) : a.comment ? (
                        <div
                          onClick={() => ouvrirCommentPopover(a)}
                          title="Cliquer pour modifier le commentaire"
                          className="max-w-[160px] truncate text-sky-200 hover:text-sky-100 cursor-text px-1.5 py-1"
                        >
                          {a.comment}
                        </div>
                      ) : (
                        <div
                          onClick={() => ouvrirCommentPopover(a)}
                          title="Cliquer pour ajouter un commentaire (calculs +, -, *, / possibles)"
                          className="text-slate-600 hover:text-sky-300 italic text-[11px] cursor-text px-1.5 py-1"
                        >
                          + Commentaire
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`tabular-nums ${a.credit > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {a.credit > 0 ? formatCurrencyPrecis(a.credit) : '—'}
                        </span>
                        {a.credit > 0 && (
                          <button
                            onClick={() => modifierActual.mutate({ id: a.id, creditConfirme: !a.creditConfirme })}
                            title={a.creditConfirme ? 'Paiement confirmé' : 'Confirmer le paiement'}
                            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                              a.creditConfirme
                                ? 'bg-emerald-500 text-white'
                                : 'border border-slate-600 text-slate-600 hover:border-emerald-500 hover:text-emerald-400'
                            }`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`tabular-nums ${a.debit > 0 ? 'text-red-400' : 'text-slate-600'}`}>
                          {a.debit > 0 ? formatCurrencyPrecis(a.debit) : '—'}
                        </span>
                        {a.debit > 0 && (
                          <button
                            onClick={() => modifierActual.mutate({ id: a.id, debitConfirme: !a.debitConfirme })}
                            title={a.debitConfirme ? 'Paiement confirmé' : 'Confirmer le paiement'}
                            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                              a.debitConfirme
                                ? 'bg-emerald-500 text-white'
                                : 'border border-slate-600 text-slate-600 hover:border-emerald-500 hover:text-emerald-400'
                            }`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Demandé le 6 septembre : « la colonne du solde
                        prévisionnel, ce n'est pas la peine d'avoir des
                        montants [...] on voudra bien le total tout en bas »
                        — plus de cumul ligne par ligne, seul le total du
                        pied de tableau (recettes − dépenses) reste utile. */}
                    <td className="px-3 py-1.5 text-right text-xs text-slate-700">—</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums text-xs font-bold ${a.soldeApres >= 0 ? 'text-[#F9C977]' : 'text-red-400'}`}>
                      {formatCurrencyPrecis(a.soldeApres)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity relative">
                        <button
                          onClick={() => { setCouleurPickerOuvert(couleurPickerOuvert === a.id ? null : a.id); setNotePopoverOuvert(null); setCommentPopoverOuvert(null); }}
                          title="Couleur de la ligne"
                          className="text-slate-400 hover:text-[#F7BC5F]"
                        >
                          <Palette className="w-3.5 h-3.5" style={a.color ? { color: a.color } : undefined} />
                        </button>
                        {couleurPickerOuvert === a.id && (
                          <div
                            className="absolute right-0 top-full mt-1 z-30 flex items-center gap-1 p-1.5 rounded-lg bg-[#0a1e20] border-2 border-[#2a6a6f] shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {PALETTE_COULEURS.map((c) => (
                              <button
                                key={c.valeur}
                                title={c.nom}
                                onClick={() => { modifierActual.mutate({ id: a.id, color: c.valeur }); setCouleurPickerOuvert(null); }}
                                className="w-4 h-4 rounded-full border border-white/20"
                                style={{ backgroundColor: c.valeur }}
                              />
                            ))}
                            <button
                              title="Aucune couleur"
                              onClick={() => { modifierActual.mutate({ id: a.id, color: null }); setCouleurPickerOuvert(null); }}
                              className="w-4 h-4 rounded-full border border-slate-500 text-slate-400 text-[9px] flex items-center justify-center leading-none"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        <button
                          onClick={() => ouvrirModifierActual(a)}
                          title="Modifier"
                          className="text-slate-400 hover:text-[#F7BC5F]"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => dupliquerJusquaDecembre.mutate(a)}
                          title="Dupliquer jusqu'à décembre"
                          className="text-slate-400 hover:text-sky-400"
                        >
                          <CopyPlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => supprimerActualAvecConfirmation(a.id)}
                          title="Supprimer"
                          className="text-slate-400 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!actualsChargement && actualsDuMoisActif.length > 0 && (
                <tfoot>
                  {/* Demandé le 6 septembre : total de colonne pour Crédit/
                      Débit ; Solde bancaire reprend le solde de clôture
                      confirmé de la dernière ligne (c'est un cumul, pas une
                      somme). Reprécisé : la colonne Solde prévisionnel
                      n'affiche plus de montant ligne par ligne — seul son
                      total ici compte, en net recettes − dépenses du mois
                      (« solde prévisionnel fin de mois »). */}
                  <tr className="border-t-2 border-[#2a6a6f] bg-[#0a1e20] divide-x divide-[#2a6a6f]/50 text-xs font-bold">
                    <td className="px-3 py-2 text-slate-400 uppercase tracking-widest text-[10px]" colSpan={5}>Total du mois</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{formatCurrencyPrecis(totalCreditMois)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-400">{formatCurrencyPrecis(totalDebitMois)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${soldePrevisionnelFinDeMoisActif >= 0 ? 'text-[#F9C977]' : 'text-red-400'}`}
                      title="Solde prévisionnel fin de mois = total recettes − total dépenses du mois"
                    >
                      {soldePrevisionnelFinDeMoisActif >= 0 ? '+' : ''}{formatCurrencyPrecis(soldePrevisionnelFinDeMoisActif)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${soldeClotureMoisActif >= 0 ? 'text-[#F9C977]' : 'text-red-400'}`}
                      title="Solde de clôture confirmé du mois — identique à la dernière ligne du tableau"
                    >
                      {formatCurrencyPrecis(soldeClotureMoisActif)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Lignes récurrentes / ponctuelles (treasury_lines) actives sur le mois affiché — CRUD complet */}
      <div className="rounded-2xl border-2 border-[#2a6a6f] bg-[#0a1e20]/60 p-4 space-y-2">
        <button
          type="button"
          onClick={() => setLigneRecurrentesDepliees((v) => !v)}
          className="w-full flex items-center gap-1.5 text-xs font-bold text-white uppercase tracking-wide"
        >
          {ligneRecurrentesDepliees ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Lignes récurrentes / ponctuelles — {NOMS_MOIS_COURT[moisActuelOnglet]} {anneeActive}
          <span className="text-[10px] font-normal normal-case text-slate-500">({lignesDuMoisActif.length})</span>
        </button>
        {ligneRecurrentesDepliees && (
        <>
        <p className="text-[10px] text-slate-500 italic">
          Chaque ligne récurrente ou ponctuelle de ce mois est automatiquement ajoutée en attente
          de validation dans le grand livre ci-dessus — cochez-la (✓ Valider) une fois réellement
          passée sur le compte. Cette liste reste l'endroit pour modifier la règle elle-même
          (montant, catégorie, date de fin).
        </p>
        {lignesDuMoisActif.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">
            Aucune ligne récurrente ou ponctuelle sur ce mois.
          </p>
        ) : (
          <div className="divide-y divide-[#2a6a6f]/50">
            {lignesDuMoisActif.map((l) => (
              <div key={l.id} className="group flex items-center justify-between gap-2 py-1.5 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      l.kind === 'recurrent' ? 'bg-sky-500/20 text-sky-300' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {l.kind === 'recurrent' ? 'Récur.' : 'Ponct.'}
                  </span>
                  <span className="text-slate-200 truncate">{l.label}</span>
                  <span className="text-slate-500 truncate">· {l.category}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-bold tabular-nums ${l.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrencyPrecis(l.amount)}
                  </span>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => ouvrirEdition(l)} title="Modifier" className="text-slate-400 hover:text-[#F7BC5F]">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => supprimerLigneAvecConfirmation(l.id)} title="Supprimer" className="text-slate-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
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

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Jour du prélèvement (optionnel)</label>
              <input
                type="number" min={1} max={31} value={form.jourPrelevement}
                onChange={(e) => setForm((f) => ({ ...f, jourPrelevement: e.target.value }))}
                placeholder="ex : 10"
                className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
              />
              <p className="text-[10px] text-slate-500 mt-1">Laissé vide : la ligne se case au 1er du mois par défaut.</p>
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

      {/* Formulaire d'ajout / modification d'une ligne du grand livre réel (treasury_actuals) */}
      {ligneActualOuverte && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLigneActualOuverte(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-[#07191b] border-2 border-[#2a6a6f] shadow-2xl p-5 space-y-4">
            <h3 className="text-base font-bold text-white">
              {ligneActualOuverte === 'nouveau' ? 'Ajouter au grand livre' : 'Modifier la ligne'}
            </h3>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Date</label>
              <input
                type="date" value={formActual.date}
                onChange={(e) => setFormActual((f) => ({ ...f, date: e.target.value }))}
                autoFocus
                className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Laissez vide si vous ne connaissez pas encore la date : vous choisirez juste en
                dessous où ranger la ligne.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Libellé</label>
              <input
                type="text" value={formActual.label}
                onChange={(e) => setFormActual((f) => ({ ...f, label: e.target.value }))}
                placeholder="ex : Virement client, Prélèvement loyer…"
                className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
              <input
                type="text" value={formActual.description}
                onChange={(e) => setFormActual((f) => ({ ...f, description: e.target.value }))}
                placeholder="optionnel"
                className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Crédit (€)</label>
                <input
                  type="text" inputMode="decimal" value={formActual.credit}
                  onChange={(e) => setFormActual((f) => ({ ...f, credit: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Débit (€)</label>
                <input
                  type="text" inputMode="decimal" value={formActual.debit}
                  onChange={(e) => setFormActual((f) => ({ ...f, debit: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60"
                />
              </div>
            </div>

            {/* Sans date, deux destinations possibles (6 septembre : « on a
                le choix soit de les mettre dans le tableau prévisionnel,
                soit de l'intégrer dans le tableau du haut, il faut qu'on ait
                le choix pour les deux ») — avec une date, le comportement
                habituel (un seul bouton) reste inchangé. */}
            {ligneActualOuverte === 'nouveau' && !formActual.date ? (
              <div className="space-y-2 pt-2">
                <p className="text-[10px] text-slate-500">Pas de date : où ranger cette ligne ?</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={basculerVersTableauPrevisionnel}
                    disabled={!formActual.label.trim() || (Number(formActual.credit.replace(',', '.')) || 0) <= 0 && (Number(formActual.debit.replace(',', '.')) || 0) <= 0}
                    className="flex-1 px-3 py-2 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-300 text-xs font-bold hover:bg-sky-500/25 disabled:opacity-40"
                  >
                    🔁 Tableau prévisionnel (récurrent/ponctuel)
                  </button>
                  <button
                    onClick={soumettreActual}
                    disabled={creerActual.isPending || !formActual.label.trim() || (Number(formActual.credit.replace(',', '.')) || 0) <= 0 && (Number(formActual.debit.replace(',', '.')) || 0) <= 0}
                    className="flex-1 px-3 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-40 text-slate-950 text-xs font-bold"
                  >
                    📒 Ajouter au grand livre
                  </button>
                </div>
                <div className="flex justify-end pt-1">
                  <button onClick={() => setLigneActualOuverte(null)} className="px-4 py-1.5 text-xs text-slate-400 hover:text-white">
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setLigneActualOuverte(null)} className="px-4 py-2 text-xs text-slate-400 hover:text-white">
                  Annuler
                </button>
                <button
                  onClick={soumettreActual}
                  disabled={creerActual.isPending || modifierActual.isPending}
                  className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-slate-950 text-xs font-bold"
                >
                  {ligneActualOuverte === 'nouveau' ? 'Ajouter' : 'Enregistrer'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
