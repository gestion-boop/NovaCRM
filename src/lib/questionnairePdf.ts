// Réponses d'un questionnaire confidentiel (crédit) : mise en forme lisible
// (sections / libellés français, dans l'ordre du formulaire) et export PDF.
// Les réponses sont stockées en JSON (jsonb : l'ordre des clés n'est pas
// celui du formulaire), d'où la description explicite des champs ci-dessous.

type Champ = [cle: string, libelle: string];

interface SectionSpec {
  id: string;
  titre: string;
  /** Champs propres à chaque personne (emprunteur / co-emprunteur). */
  personne?: Champ[];
  /** Champs communs, ou champs à la racine du JSON si `racine`. */
  commun?: Champ[];
  racine?: boolean;
}

const SPEC: SectionSpec[] = [
  {
    id: 'identite', titre: 'Identité',
    personne: [['nom', 'Nom'], ['nomNaissance', 'Nom de naissance'], ['prenom', 'Prénom'], ['telephone', 'Téléphone'], ['adresse', 'Adresse'], ['email', 'E-mail']],
    commun: [['origineContact', 'Origine du contact'], ['autresCommentaires', 'Autres commentaires']],
  },
  {
    id: 'etatCivil', titre: 'État civil',
    personne: [['dateNaissance', 'Date de naissance'], ['lieuNaissance', 'Lieu de naissance'], ['departement', 'Département'], ['logement', 'Logement'], ['depuisLe', 'Depuis le'], ['loyerCredit', 'Loyer / crédit actuel (€)'], ['situationFamiliale', 'Situation familiale'], ['enfantsCharge', 'Enfants à charge'], ['enfantsAutreUnion', "Enfants d'une autre union"]],
    commun: [['regimeMariage', 'Régime / contrat de mariage']],
  },
  {
    id: 'situationPro', titre: 'Situation professionnelle',
    personne: [['profession', 'Profession'], ['depuisLe', 'Depuis le'], ['employeur', 'Employeur'], ['adresseEmployeur', 'Adresse employeur'], ['contrat', 'Contrat'], ['revenuMensuelNet', 'Revenu mensuel net (€)'], ['revenuAnnuel', 'Revenu annuel (€)'], ['pensionAlimentaire', 'Pension alimentaire (€)'], ['autresRevenus', 'Autres revenus'], ['primes', 'Primes & avantages'], ['comiteEntreprise', "Comité d'entreprise"], ['rfrN1', 'RFR N-1 (€)'], ['rfrN2', 'RFR N-2 (€)'], ['commentaires', 'Commentaires']],
  },
  {
    id: 'patrimoine', titre: 'Patrimoine',
    personne: [['livretA', 'Livret A (€)'], ['celPel', 'CEL / PEL (€)'], ['ldd', 'LDD (€)'], ['assuranceVie', 'Assurance vie (€)'], ['partsSociales', 'Parts sociales (€)'], ['autres', 'Autres (€)']],
    commun: [['biensImmobiliers', 'Biens immobiliers']],
  },
  {
    id: 'prets', titre: 'Prêts en cours', racine: true,
    commun: [['pretsEnCours', 'Prêts en cours'], ['commentairesPrets', 'Commentaires']],
  },
  {
    id: 'recueilBesoins', titre: 'Recueil des besoins',
    commun: [['banqueActuelleEmprunteur', 'Banque(s) actuelle(s) emprunteur'], ['depuis', 'Depuis'], ['banqueCoEmprunteur', 'Banque(s) co-emprunteur'], ['depuisCo', 'Depuis (co-emprunteur)'], ['banquesNonSouhaitees', 'Banque(s) non souhaitée(s)'], ['negociationsEnCours', 'Négociations en cours'], ['mensualiteSouhaitee', 'Mensualité souhaitée (€)'], ['mensualiteMaxi', 'Mensualité maxi (€)'], ['dureeSouhaitee', 'Durée souhaitée (ans)'], ['dureeMaxi', 'Durée maxi (ans)'], ['taux', 'Taux'], ['remboursement', 'Remboursement']],
  },
  {
    id: 'assurances', titre: 'Assurances',
    personne: [['quotite', 'Quotité'], ['fumeur', 'Fumeur'], ['taille', 'Taille (cm)'], ['poids', 'Poids (kg)'], ['problemesSante', 'Problèmes de santé']],
  },
  {
    id: 'engagement', titre: 'Engagement',
    commun: [['certifie', 'Informations certifiées sincères et véritables'], ['nomSignataire', 'Nom du signataire'], ['date', 'Date']],
  },
];

const PERSONNES: Array<[string, string]> = [['emprunteur', 'Emprunteur'], ['coEmprunteur', 'Co-emprunteur']];

export interface LigneQuestionnaire { libelle: string; valeur: string }
export interface GroupeQuestionnaire { sousTitre: string | null; lignes: LigneQuestionnaire[] }
export interface SectionQuestionnaire { titre: string; groupes: GroupeQuestionnaire[] }

const formaterValeur = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (Array.isArray(v)) return v.map(formaterValeur).filter(Boolean).join(', ');
  if (typeof v === 'object') return '';
  const texte = String(v).trim();
  const iso = texte.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : texte;
};

const lignes = (source: any, champs: Champ[]): LigneQuestionnaire[] =>
  champs
    .map(([cle, libelle]) => ({ libelle, valeur: formaterValeur(source?.[cle]) }))
    .filter((l) => l.valeur !== '');

/** Réponses → sections lisibles, dans l'ordre du formulaire ; champs vides omis. */
export const sectionsQuestionnaire = (reponses: any): SectionQuestionnaire[] => {
  if (!reponses || typeof reponses !== 'object') return [];
  const sections: SectionQuestionnaire[] = [];
  for (const spec of SPEC) {
    const groupes: GroupeQuestionnaire[] = [];
    if (spec.personne) {
      for (const [cle, nom] of PERSONNES) {
        const l = lignes(reponses?.[spec.id]?.[cle], spec.personne);
        if (l.length) groupes.push({ sousTitre: nom, lignes: l });
      }
    }
    if (spec.commun) {
      const l = lignes(spec.racine ? reponses : reponses?.[spec.id], spec.commun);
      if (l.length) groupes.push({ sousTitre: spec.personne ? 'Général' : null, lignes: l });
    }
    if (groupes.length) sections.push({ titre: spec.titre, groupes });
  }
  return sections;
};

// Les polices standard de jsPDF ne couvrent pas tous les signes typographiques.
const pourPdf = (t: string): string =>
  t
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u202F\u00A0]/g, ' ')
    .replace(/\u2026/g, '...');

export const telechargerQuestionnairePdf = async (opts: {
  reponses: any;
  nomClient?: string | null;
  email?: string | null;
  recuLe?: string | null;
}): Promise<void> => {
  const { default: JsPDF } = await import('jspdf');
  const pdf = new JsPDF('p', 'mm', 'a4');
  const largeur = pdf.internal.pageSize.getWidth();
  const hauteur = pdf.internal.pageSize.getHeight();
  const marge = 16;
  const colLibelle = 62;
  const largeurValeur = largeur - marge * 2 - colLibelle;
  let y = 0;
  let page = 1;

  const pied = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(140, 150, 150);
    pdf.text('Document confidentiel', marge, hauteur - 8);
    pdf.text(`Page ${page}`, largeur - marge, hauteur - 8, { align: 'right' });
  };
  const nouvellePage = () => {
    pied();
    pdf.addPage();
    page += 1;
    y = marge + 4;
  };
  const place = (besoin: number) => {
    if (y + besoin > hauteur - 16) nouvellePage();
  };

  // En-tête
  pdf.setFillColor(7, 25, 27);
  pdf.rect(0, 0, largeur, 34, 'F');
  pdf.setFillColor(247, 188, 95);
  pdf.rect(0, 34, largeur, 1.2, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('Questionnaire confidentiel', marge, 16);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(249, 201, 119);
  const sousTitre = [opts.nomClient, opts.email].filter(Boolean).join('  ·  ');
  if (sousTitre) pdf.text(pourPdf(sousTitre), marge, 24);
  pdf.setTextColor(200, 215, 215);
  if (opts.recuLe) pdf.text(pourPdf(`Reçu le ${opts.recuLe}`), marge, 30);
  y = 46;

  const sections = sectionsQuestionnaire(opts.reponses);
  if (!sections.length) {
    pdf.setTextColor(60, 60, 60);
    pdf.setFontSize(11);
    pdf.text('Aucune réponse renseignée.', marge, y);
  }

  for (const section of sections) {
    place(16);
    pdf.setFillColor(20, 60, 63);
    pdf.roundedRect(marge, y, largeur - marge * 2, 8, 1.5, 1.5, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(pourPdf(section.titre), marge + 3, y + 5.5);
    y += 13;

    for (const groupe of section.groupes) {
      if (groupe.sousTitre) {
        place(10);
        pdf.setTextColor(176, 120, 30);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9.5);
        pdf.text(pourPdf(groupe.sousTitre), marge, y);
        y += 5;
      }
      for (const ligne of groupe.lignes) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9.5);
        const valeurs: string[] = pdf.splitTextToSize(pourPdf(ligne.valeur), largeurValeur);
        const libelles: string[] = pdf.splitTextToSize(pourPdf(ligne.libelle), colLibelle - 4);
        const nb = Math.max(valeurs.length, libelles.length);
        place(nb * 4.6 + 2);
        pdf.setTextColor(110, 120, 120);
        pdf.text(libelles, marge, y);
        pdf.setTextColor(25, 35, 35);
        pdf.text(valeurs, marge + colLibelle, y);
        y += nb * 4.6 + 1.6;
        pdf.setDrawColor(228, 232, 232);
        pdf.line(marge, y - 1.8, largeur - marge, y - 1.8);
      }
      y += 3;
    }
    y += 3;
  }
  pied();

  const nomFichier = (opts.nomClient || 'client').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  pdf.save(`questionnaire-confidentiel-${nomFichier || 'client'}.pdf`);
};
