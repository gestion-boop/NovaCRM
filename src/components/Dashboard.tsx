import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { AGENCIES } from '@/types';
import { formatCurrency, formatCurrencyPrecis } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Users, Coins, Briefcase, CheckCircle2, ArrowRight, Building, Sparkles, Pencil, TrendingUp, TrendingDown, Target, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useContacts, matchesAgency } from '@/hooks/useContacts';
import { useDeals } from '@/hooks/useDeals';
import { useAssignableUsers } from '@/hooks/useAssignableUsers';
import { useTasks } from '@/hooks/useTasks';

// Recharts applique ces réglages en style INLINE sur l'info-bulle : aucune
// règle CSS de thème ne peut les atteindre. Elles restaient donc noires, avec
// du texte noir dessus, une fois l'appli passée en mode jour. Les variables
// CSS, elles, sont résolues normalement dans un style inline — l'info-bulle
// suit ainsi le thème comme le reste (voir --nv-chart-* dans index.css).
interface LigneCa {
  id: string;
  // Fiche du client (demandé le 5 septembre : « quand on clique sur les
  // noms, j'aimerais avoir l'accès à la fiche du client directement »).
  contactId: string;
  nom: string;
  mandat: string;
  montant: number;
  etape: string;
  archive: boolean;
  // Date d'archivage : c'est elle qui date réellement le chiffre d'affaires,
  // et donc le montant « facturé » du mois.
  archiveLe?: string;
  // Demandé le 6 septembre : « quand je clique dans les cases de chaque
  // courtier, un tableau avec commission et commission Banque par client ».
  advisorId?: string;
  commission: number;
  comBanque: number;
  // Demandé le 6 septembre : « commission de l'agence, ensuite commission
  // du courtier, banque agence, commission banque courtier — des chèques
  // sur les quatre lignes, pour être sûr de tout vérifier correctement ».
  // `montant` sert déjà de « commission de l'agence » ; comBanqueAgence est
  // son équivalent côté banque (comBanque reste la part du courtier).
  comBanqueAgence: number;
  // Cases à cocher du détail par courtier (6 septembre) : vert une fois
  // pointées, orange tant que non — une paire par ligne (agence / courtier).
  commissionValidee: boolean;
  comBanqueValidee: boolean;
  commissionAgenceValidee: boolean;
  comBanqueAgenceValidee: boolean;
  // Signature faite à l'archivage (leads.signed_at) — condition ultime pour
  // qu'un dossier archivé compte dans le CA (voir le calcul plus haut).
  signe: boolean;
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--nv-chart-tooltip-bg)',
  borderColor: 'var(--nv-chart-tooltip-border)',
  borderRadius: '12px',
  color: 'var(--ink-1)',
} as const;

// Camembert d'un objectif (réalisé / reste à faire), le même dessin que la
// case « Objectif de l'année » de l'agence — repris tel quel pour les
// objectifs par collaborateur (Conseils Finances, 5 septembre) sans dupliquer
// trente lignes à chaque case. Une part vide n'est pas dessinée : à zéro
// réalisé le cercle est tout gris, objectif atteint il est tout doré.
function CamembertObjectif({ realise, cible }: { realise: number; cible: number }) {
  const parts = [
    { name: 'Réalisé', value: realise },
    { name: 'Reste à faire', value: Math.max(0, cible - realise) },
  ].filter((part) => part.value > 0);
  const pourcent = cible > 0 ? Math.round((realise / cible) * 100) : 0;
  return (
    <div className="relative w-24 h-24 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={parts}
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={46}
            paddingAngle={parts.length > 1 ? 2 : 0}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            {parts.map((part) => (
              <Cell key={part.name} fill={part.name === 'Réalisé' ? '#F7BC5F' : '#3d3d3d'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value) || 0), String(name)]}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: '11px' }}
            itemStyle={{ color: 'var(--ink-1)' }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-sm font-semibold text-white">{pourcent} %</span>
      </div>
    </div>
  );
}

export default function Dashboard({
  onNavigate,
  onNavigateToStage,
  onOpenContact,
}: {
  onNavigate: (tab: string) => void;
  // Ticket #105 : clic sur une colonne du graphique -> pipeline, direct
  // sur l'étape correspondante (au lieu de rester à choisir soi-même).
  onNavigateToStage?: (stage: string) => void;
  // Fenêtre de détail du chiffre d'affaires : un clic sur le nom ouvre la
  // fiche du client (5 septembre).
  onOpenContact?: (contactId: string) => void;
}) {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const { contacts = [] } = useContacts();
  const { deals = [], allDeals = [] } = useDeals();
  const { tasks = [] } = useTasks();
  // 1. Calculate general statistics
  // (totalContacts est calculé plus bas, une fois voitChiffresAgence connu —
  // voir son commentaire)

  // "Dossiers actifs" (activeDeals) et "Volume financier" (totalDealValue)
  // sont calculés plus bas, une fois voitChiffresAgence connu — voir leurs
  // commentaires respectifs.

  // Position (ordre) réelle de chaque étape, par pipeline — nécessaire pour
  // déterminer ce qui se trouve "à partir de la colonne Accord banque".
  const { data: stagesWithPosition = [] } = useQuery({
    queryKey: ['pipeline-stages-positions'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, name, position');
      return (data as { id: string; pipeline_id: string; name: string; position: number }[]) || [];
    },
  });

  const completedTasks = tasks.filter(t => t.completed).length;
  const pendingTasks = tasks.length - completedTasks;

  // 2. Prepare chart data: Stages Distribution — reflète les colonnes (et
  // l'ordre) du pipeline PAR DÉFAUT de chaque agence concernée, avec les
  // vrais titres d'étapes configurés (au lieu d'une liste figée ou d'un
  // mélange de noms venant de plusieurs pipelines / du champ "température").
  const { data: pipelinesData = [] } = useQuery({
    queryKey: ['dashboard-pipelines'],
    queryFn: async () => {
      const { data } = await supabase.from('pipelines').select('id, name, agency_id, is_default');
      return (data as { id: string; name: string; agency_id: string; is_default: boolean }[]) || [];
    },
  });

  // Ticket #34 : « toute affaire deposee dans la colonne Facture du pipeline
  // Transaction B2 doit etre comptabilisee dans le chiffre d'affaires de
  // l'agence, visible des seuls super admins ». Le montant retenu est le hors
  // taxes : `estimated_value` (ici `amount`) porte deja la commission agence
  // en HT, rien a convertir. Une affaire sans HT ne compte pas, mais on la
  // compte a part pour pouvoir le dire.
  //
  // Le pipeline et l'etape sont crees dans l'application, pas dans le code :
  // on vise donc le NOM, pas un identifiant fige, et de façon tolerante —
  // « Transaction B2 » comme « Transactions B2 », « Facture » comme
  // « Facture » ou « Dossier facture ». Meme principe que « Accord banque »
  // juste au-dessus.
  const sansAccents = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  // Demandé le 2 septembre : « ce chiffre-là sera comptabilisé sur le
  // pipeline Novavisio principal, du moment qu'il sera à partir de envoi
  // facture / à régler ». Le pipeline suivi dépend donc de l'agence :
  // ImmoSphera compte sur « Transaction V2 », Novavisio sur son pipeline
  // principal, et seulement à partir des étapes de facturation.
  const estNovavisio = /novavisio/i.test(activeAgency?.name || '');
  // Demandé le 5 septembre : « la pipeline Conseils Finances sera la base des
  // remontées des chiffres ». Même mécanisme que Novavisio — le pipeline
  // principal (ou par défaut) de l'agence — au lieu de « Transaction V2 »,
  // qui n'existe que chez ImmoSphera : c'est pour ça que toutes les tuiles
  // restaient à zéro sur Conseils Finances.
  const estConseilsFinances = /conseils?\s*finances?/i.test(activeAgency?.name || '');
  // « Tout ce qui est CA à venir agence ou CA agence doit être vu que par
  // Sylvain Grazia et Mélanie, c'est tout » (5 septembre). Sur Conseils
  // Finances, la direction est donc reconnue à son nom ou à son adresse,
  // pas à son rôle : Mélanie n'est pas super admin, et un super admin d'une
  // autre société n'a pas à voir ces chiffres. Ailleurs, rien ne change :
  // le rôle super admin décide, comme avant.
  const identite = `${userProfile?.displayName || currentUser?.displayName || ''} ${userProfile?.email || currentUser?.email || ''}`;
  const estDirectionCF = /grazia|melanie|gestion@immosphera\.fr/i.test(identite);
  const voitChiffresAgence = estConseilsFinances ? estDirectionCF : isSuperAdmin;
  // Signalé le 7 octobre : « ne compte pas les clients qui n'appartiennent
  // pas à l'utilisateur [...] laetitia a 95 clients, alors qu'elle a moins
  // de contacts ». Cause : la tuile « Prospects & Clients » plus bas
  // affichait `contacts.length`, soit TOUTES les fiches de l'agence active
  // — pour tout le monde, agents compris — alors que chaque autre tuile de
  // ce même tableau de bord (CA, commissions...) restreint déjà un agent
  // simple à son propre périmètre via `voitChiffresAgence`. Même règle de
  // "mes clients" que l'écran Clients (créé par moi OU qui m'est assigné).
  const mesContacts = currentUser?.uid
    ? contacts.filter((c) => c.ownerUserId === currentUser.uid || c.assignedTo === currentUser.uid).length
    : 0;
  const totalContacts = voitChiffresAgence ? contacts.length : mesContacts;
  // « Toutes les sociétés » (id 'all') n'a pas de nom qui matche
  // /conseils?\s*finances?/i, donc les blocs réservés à la direction CF
  // (Sylvain/Mélanie) disparaissaient dès qu'on quittait l'agence Conseils
  // Finances seule pour la vue consolidée. Les chiffres sous-jacents restent
  // corrects sur « all » (calculés par agence puis sommés) : c'est
  // uniquement l'affichage de ces blocs qu'il faut garder visible ici.
  const estVueDirectionCF = estConseilsFinances || activeAgency?.id === 'all';
  const parPipelinePrincipal = estNovavisio || estConseilsFinances;
  // Le pipeline suivi, nommé dans les libellés des tuiles.
  const nomPipelineVise = estConseilsFinances
    ? 'pipeline Conseils Finances'
    : estNovavisio ? 'pipeline principal' : 'Transaction V2';
  const dansPipelineVise = parPipelinePrincipal ? `dans le ${nomPipelineVise}` : 'dans Transaction V2';

  const chiffreAffairesAgence = useMemo(() => {
    const pipelinesAgence = pipelinesData.filter((p) =>
      matchesAgency((p as { agency_id?: string }).agency_id || '', activeAgency.id)
    );
    // « C'est le pipeline Novavisio principal » : on le reconnaît d'abord à
    // son nom (« principal », « principale »), sinon à l'indicateur « par
    // défaut » de la base. Un nom explicite l'emporte : c'est celui que
    // l'utilisateur voit et désigne.
    const parLeNom = pipelinesAgence.filter((p) => sansAccents(p.name).includes('principal'));
    const principalNovavisio =
      parLeNom.length > 0
        ? parLeNom
        : pipelinesAgence.filter((p) => (p as { is_default?: boolean }).is_default);
    const pipelinesVises = new Set(
      (parPipelinePrincipal
        ? // Le « principal » = celui marqué par défaut ; si aucun ne l'est,
          // on prend tous ceux de l'agence plutôt que de ne rien compter.
          (principalNovavisio.length > 0 ? principalNovavisio : pipelinesAgence)
        : pipelinesData.filter((p) => {
            const nom = sansAccents(p.name);
            return nom.includes('transaction') && nom.includes('v2');
          })
      ).map((p) => p.id)
    );
    if (pipelinesVises.size === 0) {
      return {
        total: 0, comBanqueTotal: 0, comptees: 0, aVenir: 0, comptessAVenir: 0, sansMontant: 0,
        pipelineTrouve: false, dansLePipeline: 0, horsEtape: 0,
        repartitionAVenir: [] as { name: string; value: number }[],
        horsPipelineMontant: 0, horsPipelineNb: 0,
        lignes: [] as LigneCa[],
        // On montre les noms réellement trouvés : si la règle ne reconnaît
        // pas le pipeline, autant voir tout de suite comment il s'appelle
        // plutôt que de chercher à l'aveugle.
        nomsConnus: pipelinesData.map((p) => p.name).slice(0, 6),
        devis: 0, devisNb: 0, recurrence: 0, recurrenceNb: 0,
        parConseiller: new Map<string, number>(), commissionParConseiller: new Map<string, number>(),
        parConseillerAnnee: new Map<string, number>(), parConseillerAVenir: new Map<string, number>(),
        comBanqueParConseiller: new Map<string, number>(),
      };
    }

    // « Si on archive, on garde les montants dans le tableau de bord » : on
    // part donc de `allDeals`, qui contient les affaires archivees, au lieu
    // de `deals`, d'ou elles sont retirees pour le pipeline. Le filtre par
    // agence, lui, reste — chaque agence a son chiffre.
    // `matchesAgency` et non un `===` : la colonne agency_id porte encore,
    // sur beaucoup de fiches, un identifiant hérité (« immosphera »,
    // « agency-2 »...) au lieu de l'UUID. Toute l'application passe par cette
    // fonction ; ma comparaison brute écartait donc en silence les fiches
    // ImmoSphera les plus anciennes — c'est ce qui a fait disparaître les
    // 53 000 € signalés le 1er septembre.
    const perimetreAgence = allDeals.filter((d) => matchesAgency(d.agencyId, activeAgency.id));
    // « Le HT doit être en haut de la colonne, visible par Mélanie et Sylvain.
    // Le hors taxe des conseillers pourra être vu par seulement chaque
    // conseiller personnellement. » Le cercle « CA à venir » est visible par
    // tout le monde : un conseiller n'y voit donc que ses propres affaires.
    // (La tuile dorée, elle, n'est affichée qu'aux super admins.)
    const perimetre = voitChiffresAgence
      ? perimetreAgence
      : perimetreAgence.filter((d) => d.advisorId && d.advisorId === currentUser?.uid);

    // Le pipeline d'une affaire se lit d'abord sur SON ÉTAPE, et seulement
    // ensuite sur la colonne pipeline_id du dossier.
    //
    // Signalé le 1er septembre : « j'ai facturé toute la colonne, plus de
    // 53 000 €, et ça ne remonte pas ». Le Pipeline affiche une affaire sans
    // pipeline_id dans le pipeline OUVERT (Pipeline.tsx : `deal.pipelineId ||
    // activePipeline.id`) : à l'écran elle est bien dans « Facturé », mais en
    // base elle n'a aucun pipeline. Le calcul, lui, écartait tout dossier
    // sans pipeline_id — et perdait donc exactement ces dossiers-là.
    // L'étape, elle, sait toujours à quel pipeline elle appartient.
    const pipelineParEtape = new Map<string, string>();
    stagesWithPosition.forEach((s) => { pipelineParEtape.set(s.id, s.pipeline_id); });
    // Conseils Finances : le CA à venir de l'agence compte à partir de
    // l'étape Accord banque / Rendez-vous (règle d'origine du 5 septembre,
    // un temps avancée à Montage dossier, puis redemandée le 6 septembre
    // « il faut que cela soit comptabilisé du moment que le dossier passe à
    // l'étape Accord banque / Rendez-vous »). Position de cette étape dans
    // chaque pipeline, et position de chaque étape — même lecture que la
    // tuile Volume financier plus haut. Reconnue à son nom (« Accord
    // banque », « Rendez-vous »…), la première si plusieurs.
    const seuilDepart = new Map<string, number>();
    const positionEtape = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      positionEtape.set(`${s.pipeline_id}::${s.name}`, s.position);
      if (/accord\s*banque/i.test(s.name) || /rendez.?vous/i.test(s.name)) {
        const actuel = seuilDepart.get(s.pipeline_id);
        if (actuel === undefined || s.position < actuel) seuilDepart.set(s.pipeline_id, s.position);
      }
    });
    // ImmoSphera (agents immobiliers) : demandé le 7 octobre, « le chiffre
    // remonte dans le tableau du moment que les vendeurs signent le mandat ».
    // Même mécanisme que seuilDepart ci-dessus (Accord banque / Rendez-vous
    // pour Conseils Finances), mais sur l'étape "Mandat" du pipeline
    // Transaction V2 — qui n'a pas d'étape Accord banque, donc aucun seuil ne
    // s'appliquait jusqu'ici : un dossier comptait dès "Récolte docs", avant
    // même la signature du mandat.
    //
    // Précisé le même jour : deux seuils différents selon qui regarde (même
    // principe que `perimetre` plus bas, qui restreint déjà aux seules
    // affaires du conseiller quand il n'est pas en droit de voir celles de
    // l'agence). Vue personnelle de l'agent (perimetre = ses seules
    // affaires) : dès "Mandat", visibilité précoce sur son propre travail.
    // Vue agence/direction (perimetre = toute l'agence) : seulement à partir
    // de "Offre d'achat", pour un chiffre agrégé plus consolidé — « active-le
    // en agence quand l'offre est signée ».
    const seuilDepartMandat = new Map<string, number>();
    const seuilDepartOffre = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      if (/^mandat$/i.test(s.name.trim())) {
        const actuel = seuilDepartMandat.get(s.pipeline_id);
        if (actuel === undefined || s.position < actuel) seuilDepartMandat.set(s.pipeline_id, s.position);
      }
      if (/^offre\s*d.?achat$/i.test(s.name.trim())) {
        const actuel = seuilDepartOffre.get(s.pipeline_id);
        if (actuel === undefined || s.position < actuel) seuilDepartOffre.set(s.pipeline_id, s.position);
      }
    });

    // Demandé le 1er septembre : « mets le chiffre facturé, et tout ce qui
    // n'est pas encore facturé — donc archivé avec un prix confirmé — sera en
    // à venir ». Deux réalités comptables distinctes, deux chiffres :
    //   FACTURÉ  : la facture est émise (étape « Facturé »).
    //   À VENIR  : c'est gagné mais pas encore facturé — étape « À facturer »,
    //              ou dossier archivé avec un montant confirmé.
    // Les additionner donnerait un chiffre qui mélange le réalisé et le prévu.
    let total = 0;
    // Commission Banque totale de l'agence (leads.com_banque) — demandé le
    // 6 septembre pour s'ajouter au chiffre d'affaires de l'agence, comme
    // pour chaque courtier.
    let comBanqueTotal = 0;
    let aVenir = 0;
    let comptees = 0;
    let comptessAVenir = 0;
    let sansMontant = 0;
    let dansLePipeline = 0;
    let horsEtape = 0;
    // Répartition du « CA à venir » par colonne du pipeline, pour le cercle.
    const parEtapeAVenir = new Map<string, number>();
    // Diagnostic : un dossier archivé, avec un montant confirmé, mais qui
    // n'est rattaché à aucune étape de Transaction V2 (ni à ce pipeline)
    // ne peut pas entrer dans le chiffre d'affaires. Plutôt que de le perdre
    // en silence — ce qui a coûté plusieurs allers-retours — on l'affiche.
    let horsPipelineMontant = 0;
    let horsPipelineNb = 0;
    // « CA devis à venir » : saisi fiche par fiche, indépendamment du
    // pipeline — un devis peut partir avant que le dossier n'avance.
    let devis = 0;
    let devisNb = 0;
    // La récurrence se note à l'archivage, mais rien n'interdit de la saisir
    // avant : on la compte partout où elle est renseignée, archivée ou non,
    // et sans condition d'étape — ce n'est pas un chiffre de pipeline.
    let recurrence = 0;
    let recurrenceNb = 0;
    perimetreAgence.forEach((d) => {
      const montantRecurrence = Number(d.recurrence) || 0;
      if (montantRecurrence > 0) {
        recurrence += montantRecurrence;
        recurrenceNb += 1;
      }
      if (d.archivedAt) return;
      const montantDevis = Number(d.caDevisAVenir) || 0;
      if (montantDevis <= 0) return;
      devis += montantDevis;
      devisNb += 1;
    });
    // Chiffre d'affaires réalisé, conseiller par conseiller (tuile « CA de
    // Natacha », et base d'un éventuel classement plus tard).
    const parConseiller = new Map<string, number>();
    // « Il vaut mieux CA agence ET commission Natacha, car elle va avoir un
    // pourcentage » (2 septembre) : sa commission est un montant à elle,
    // saisi à l'archivage (advisor_commission_ttc), et non une part du
    // chiffre d'affaires de l'agence. Les deux ne se déduisent pas l'un de
    // l'autre — on les compte séparément.
    const commissionParConseiller = new Map<string, number>();
    // Commission Banque (leads.com_banque, saisie sur la fiche du client) :
    // demandée le 6 septembre pour s'ajouter, sur la case CA de chaque
    // courtier, à sa commission — même règle que commissionParConseiller
    // (comptée à l'archivage).
    const comBanqueParConseiller = new Map<string, number>();
    // Réalisé de l'année en cours, conseiller par conseiller : c'est ce qui
    // remplit l'objectif de l'année de chaque collaborateur (Conseils
    // Finances, 5 septembre). Daté par l'archivage, comme le réalisé de
    // l'agence plus bas.
    const anneeCourante = new Date().getFullYear();
    const parConseillerAnnee = new Map<string, number>();
    // « CA à venir » conseiller par conseiller — sur Conseils Finances, les
    // dossiers à partir d'Accord banque / Rendez-vous : « ceux qui
    // appartiennent aux courtiers, Sylvain compris, une case en haut du
    // tableau de bord ».
    const parConseillerAVenir = new Map<string, number>();
    // Demandé le 2 septembre : « quand je clique dans la colonne chiffre
    // d'affaires d'agence, je voudrais un tableau avec le nom et prénom des
    // clients, le numéro de mandat et le chiffre, et pouvoir modifier le
    // chiffre de chaque ligne ». On garde donc le détail de ce qui a été
    // compté, ligne à ligne.
    const lignes: LigneCa[] = [];
    perimetre.forEach((d) => {
      // Conseils Finances (5 septembre, capture « les montants ne
      // correspondent pas à la réalité des règles ») : `amount` retombe sur
      // le BUDGET quand la commission agence est vide — d'anciennes fiches
      // archivées sans honoraires comptaient donc leur budget (213 000 €
      // pour un crédit, 2 500 € un peu partout) comme chiffre d'affaires.
      // Ici, seuls des honoraires agence réellement saisis comptent.
      const montant = estConseilsFinances
        ? Number(d.commissionAgenceHt) || 0
        : Number(d.amount) || 0;
      // Demandé le 6 septembre : mêmes sources que commissionParConseiller /
      // comBanqueParConseiller plus bas, mais gardées par dossier pour le
      // tableau détaillé de chaque case CA par courtier.
      const commissionLigne = estConseilsFinances
        ? Number(d.honorairesCourtier) || 0
        : Number(d.advisorCommissionTtc) || 0;
      // Corrigé le 6 septembre : « il faut uniquement comptabiliser la
      // commission qu'on leur donne, plus la commission Banque qu'on leur
      // donne en fonction de leur pourcentage » — comBanque est ce que
      // perçoit l'AGENCE (utilisé pour le CA agence, comBanqueAgenceLigne
      // plus bas) ; comBanqueCourtier est la part du COURTIER (utilisée
      // pour sa case), un montant différent, pas le même divisé après coup.
      const comBanqueAgenceLigne = Number(d.comBanque) || 0;
      const comBanqueLigne = estConseilsFinances
        ? Number(d.comBanqueCourtier) || 0
        : Number(d.comBanque) || 0;
      const pipelineReel = (d.stageId && pipelineParEtape.get(d.stageId)) || d.pipelineId;
      const dansPipelineViseFlag = Boolean(pipelineReel && pipelinesVises.has(pipelineReel));
      // Demandé le 6 septembre : « du moment que c'est archivé, même si ce
      // n'est pas dans le pipeline de Conseils Finances, comptabilise-le ».
      // Un dossier ARCHIVÉ compte donc toujours sur Conseils Finances — le
      // filtre pipeline/étape ne s'applique plus qu'aux dossiers encore
      // vivants (CA à venir), où il garde tout son sens.
      const archiveHorsRegles = estConseilsFinances && Boolean(d.archivedAt);
      if (!archiveHorsRegles && !dansPipelineViseFlag) {
        if (d.archivedAt && montant > 0) { horsPipelineMontant += montant; horsPipelineNb += 1; }
        return;
      }
      // Novavisio : seules comptent les affaires arrivées à la facturation
      // (« Envoi facture », « À régler »...). Ailleurs, tout le pipeline
      // compte, comme avant.
      // « Le CA de l'agence se compte à partir de À facturer » : toute étape
      // de facturation compte donc — « À facturer », « Envoi facture »,
      // « À régler »... — et rien avant.
      if (estNovavisio && !d.archivedAt) {
        const etape = sansAccents(d.stage || '');
        if (!etape.includes('factur') && !etape.includes('regler')) return;
      }
      // Conseils Finances : un dossier vivant ne compte qu'à partir de
      // l'étape Accord banque / Rendez-vous (le CA à venir). Un dossier
      // archivé, lui, compte toujours (archiveHorsRegles ci-dessus).
      if (estConseilsFinances && !archiveHorsRegles) {
        const seuil = seuilDepart.get(pipelineReel);
        const position = positionEtape.get(`${pipelineReel}::${d.stage}`);
        if (seuil === undefined || position === undefined || position < seuil) return;
      }
      // ImmoSphera : un dossier vivant (pas encore archivé) ne compte en
      // "CA à venir" qu'à partir de "Mandat" (vue personnelle de l'agent) ou
      // "Offre d'achat" (vue agence/direction, perimetre = toute l'agence) —
      // voir le commentaire sur seuilDepartMandat/seuilDepartOffre plus haut.
      // Un dossier archivé et signé continue de compter en réalisé quelle
      // que soit l'étape (voir plus bas), comme pour les autres agences.
      if (!estNovavisio && !estConseilsFinances && !d.archivedAt && pipelineReel) {
        const seuilImmo = voitChiffresAgence
          ? seuilDepartOffre.get(pipelineReel)
          : seuilDepartMandat.get(pipelineReel);
        if (seuilImmo !== undefined) {
          const position = positionEtape.get(`${pipelineReel}::${d.stage}`);
          if (position === undefined || position < seuilImmo) return;
        }
      }
      dansLePipeline += 1;
      if (montant <= 0) {
        sansMontant += 1;
        lignes.push({
          id: d.id,
          contactId: d.contactId || d.id,
          nom: d.title,
          mandat: d.mandateNumber || '',
          montant: 0,
          etape: d.stage || '',
          archive: Boolean(d.archivedAt),
          advisorId: d.advisorId,
          commission: commissionLigne,
          comBanque: comBanqueLigne,
          comBanqueAgence: comBanqueAgenceLigne,
          signe: Boolean(d.signedAt),
          commissionValidee: Boolean(d.commissionValidee),
          comBanqueValidee: Boolean(d.comBanqueValidee),
          commissionAgenceValidee: Boolean(d.commissionAgenceValidee),
          comBanqueAgenceValidee: Boolean(d.comBanqueAgenceValidee),
        });
        return;
      }

      // « Quand c'est archivé et confirmé sur la somme, cela ira dans le
      // chiffre d'affaires de l'agence » : l'archivage est donc le seul
      // passage entre les deux. Tant que le dossier vit dans le pipeline,
      // avec sa commission agence en HT, il est en « CA à venir ».
      lignes.push({
        id: d.id,
        contactId: d.contactId || d.id,
        nom: d.title,
        mandat: d.mandateNumber || '',
        montant,
        etape: d.stage || '',
        archive: Boolean(d.archivedAt),
        archiveLe: d.archivedAt || undefined,
        advisorId: d.advisorId,
        commission: commissionLigne,
        comBanque: comBanqueLigne,
        comBanqueAgence: comBanqueAgenceLigne,
        signe: Boolean(d.signedAt),
        commissionValidee: Boolean(d.commissionValidee),
        comBanqueValidee: Boolean(d.comBanqueValidee),
        commissionAgenceValidee: Boolean(d.commissionAgenceValidee),
        comBanqueAgenceValidee: Boolean(d.comBanqueAgenceValidee),
      });
      // Demandé le 6 septembre : « le chiffre comptabilisé doit être
      // définitivement comptabilisé du moment que le dossier est archivé et
      // que nous avons cliqué sur oui, dossier a été signé. Si le dossier
      // n'est pas signé, c'est la condition ultime pour ne pas le
      // comptabiliser » — dans le CA de l'agence comme dans celui du
      // courtier. `signedAt` (leads.signed_at) n'est posé que sur « Oui,
      // signature faite » à l'archivage (voir handleArchive côté fiche
      // client) ; un dossier archivé sans signature ne compte donc nulle
      // part, ni en réalisé ni en « à venir » — il est clos, pas en cours.
      if (d.archivedAt && d.signedAt) {
        total += montant;
        comptees += 1;
        comBanqueTotal += comBanqueAgenceLigne;
        if (d.advisorId) {
          parConseiller.set(d.advisorId, (parConseiller.get(d.advisorId) || 0) + montant);
          if (new Date(d.archivedAt).getFullYear() === anneeCourante) {
            parConseillerAnnee.set(d.advisorId, (parConseillerAnnee.get(d.advisorId) || 0) + montant);
          }
          // Conseils Finances : « Commission des courtiers » vient du champ
          // Honoraires courtier de la fiche client (calculé automatiquement
          // par taux, modifiable), pas de la commission saisie à
          // l'archivage — celle-ci reste réservée à Novavisio (« Commission
          // Natacha »).
          const commission = estConseilsFinances
            ? Number(d.honorairesCourtier) || 0
            : Number(d.advisorCommissionTtc) || 0;
          if (commission > 0) {
            commissionParConseiller.set(
              d.advisorId,
              (commissionParConseiller.get(d.advisorId) || 0) + commission
            );
          }
          if (comBanqueLigne > 0) {
            comBanqueParConseiller.set(
              d.advisorId,
              (comBanqueParConseiller.get(d.advisorId) || 0) + comBanqueLigne
            );
          }
        }
      }
      else if (!d.archivedAt) {
        aVenir += montant;
        comptessAVenir += 1;
        const etape = d.stage || 'Sans étape';
        parEtapeAVenir.set(etape, (parEtapeAVenir.get(etape) || 0) + montant);
        if (d.advisorId) {
          parConseillerAVenir.set(d.advisorId, (parConseillerAVenir.get(d.advisorId) || 0) + montant);
        }
      }
    });
    const repartitionAVenir = Array.from(parEtapeAVenir.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return {
      total, comBanqueTotal, comptees, aVenir, comptessAVenir, sansMontant,
      pipelineTrouve: true, dansLePipeline, horsEtape, nomsConnus: [],
      repartitionAVenir, horsPipelineMontant, horsPipelineNb, devis, devisNb,
      recurrence, recurrenceNb, parConseiller, commissionParConseiller, parConseillerAnnee, parConseillerAVenir,
      comBanqueParConseiller,
      // Archivés d'abord — c'est ce qui est déjà compté — puis par montant.
      lignes: lignes.sort(
        (a, b) => Number(b.archive) - Number(a.archive) || b.montant - a.montant || a.nom.localeCompare(b.nom, 'fr')
      ),
    };
  }, [allDeals, activeAgency.id, pipelinesData, stagesWithPosition, voitChiffresAgence, currentUser?.uid, estNovavisio, estConseilsFinances, parPipelinePrincipal]);

  // Signalé le 7 octobre : « ils ne doivent voir que le chiffre de leur
  // productivité pas celui de l'agence ». "Dossiers actifs" n'était filtré
  // ni par agent : tout le monde y voyait le total agence. On garde
  // volontairement la même base que l'origine (`deals`, sans filtre de
  // seuil d'étape — "Dossiers actifs" doit rester le nombre BRUT de
  // dossiers non archivés, pas une version gated comme CA à venir) ; seul
  // un filtre par conseiller s'ajoute, même règle que `voitChiffresAgence`
  // partout ailleurs dans ce tableau de bord.
  const activeDeals = voitChiffresAgence
    ? deals.length
    : deals.filter((d) => d.advisorId === currentUser?.uid).length;
  // "Volume financier" : demandé aussi le 7 octobre, « remonte les chiffres
  // [...] du moment que les agents mettent leurs dossiers sur pipeline
  // transaction [V2] ». Cette tuile restait à 0 pour ImmoSphera (son
  // pipeline Transaction V2 n'a pas d'étape Accord banque, seul seuil
  // reconnu jusqu'ici) et n'était pas filtrée par agent. `chiffreAffairesAgence.aVenir`
  // résout déjà les deux : seuil Accord banque/Mandat/Offre d'achat/
  // facturation selon l'agence (voir plus haut), et `perimetre` restreint
  // déjà aux seules affaires du conseiller via voitChiffresAgence. On
  // réutilise donc ce calcul plutôt que d'en dupliquer un troisième
  // (l'ancien calcul séparé, limité à "Accord banque", est retiré).
  const totalDealValue = chiffreAffairesAgence.aVenir;

  // « Rajoute sur le tableau de bord une autre case avec CA de Natacha » —
  // repérée par son prénom dans la liste des collaborateurs de l'agence
  // plutôt que par un identifiant écrit en dur, qui deviendrait faux au
  // premier changement de compte.
  const collaborateurs = useAssignableUsers(activeAgency.id);
  // Mélanie fait partie de la direction (comme Sylvain, voir estDirectionCF
  // plus haut) mais n'est pas courtière : elle n'a pas à apparaître dans la
  // liste des objectifs par collaborateur, réservée à ceux qui portent des
  // dossiers.
  const collaborateursCourtiers = useMemo(
    () => collaborateurs.filter((u) => !/melanie/i.test(sansAccents(u.name || ''))),
    [collaborateurs]
  );
  const natacha = useMemo(
    () => collaborateurs.find((u) => /nata[sc]ha/i.test(u.name || '')),
    [collaborateurs]
  );
  const commissionNatacha = natacha
    ? chiffreAffairesAgence.commissionParConseiller.get(natacha.id) || 0
    : 0;
  // Corrigé le 6 septembre : la case « CA du collaborateur » (chaque
  // courtier sur son propre tableau de bord) n'additionne QUE ce qu'il
  // perçoit lui-même — sa commission personnelle + sa commission Banque —
  // jamais les honoraires de l'agence, qui ne lui reviennent pas.
  // `perimetre` restreint déjà tout le calcul à ses propres dossiers (voir
  // plus haut), donc ces deux Maps n'ont qu'une seule entrée ici — la sienne.
  const maCommissionPersonnelle = currentUser?.uid
    ? chiffreAffairesAgence.commissionParConseiller.get(currentUser.uid) || 0
    : 0;
  const maComBanquePersonnelle = currentUser?.uid
    ? chiffreAffairesAgence.comBanqueParConseiller.get(currentUser.uid) || 0
    : 0;

  // Demandé le 5 septembre (Conseils Finances), pour les super admins : « ceux
  // qui appartiennent aux courtiers, Sylvain Grazia compris : rajouter une
  // case en haut du tableau de bord, CA Sylvain, ou le nom du courtier ». Une
  // case par personne de l'agence : ses dossiers archivés et confirmés, plus
  // ses dossiers à partir d'Accord banque / Rendez-vous — la même règle que le
  // CA de l'agence. Une personne sans compte dans la liste mais qui porte des
  // dossiers apparaît quand même, plutôt que de perdre son chiffre.
  const caParCourtier = useMemo(() => {
    const ids = new Set<string>(collaborateurs.map((u) => u.id));
    chiffreAffairesAgence.parConseiller.forEach((_v, id) => ids.add(id));
    chiffreAffairesAgence.parConseillerAVenir.forEach((_v, id) => ids.add(id));
    return Array.from(ids)
      .map((id) => {
        const nom = collaborateurs.find((u) => u.id === id)?.name || 'Collaborateur sans compte';
        const archive = chiffreAffairesAgence.parConseiller.get(id) || 0;
        const aVenir = chiffreAffairesAgence.parConseillerAVenir.get(id) || 0;
        const commission = chiffreAffairesAgence.commissionParConseiller.get(id) || 0;
        const comBanque = chiffreAffairesAgence.comBanqueParConseiller.get(id) || 0;
        // Corrigé le 6 septembre : « il ne faut pas additionner le chiffre
        // d'affaires de l'agence, ça lui appartient — l'agence donne une
        // rétrocession au courtier, il ne reçoit pas ce montant-là ».
        // Le total du courtier n'est donc QUE ce qu'il perçoit lui-même :
        // sa commission personnelle + sa commission Banque. Les honoraires
        // (archive) restent affichés à titre d'information, à part, jamais
        // additionnés — c'est l'argent de l'agence, pas le sien.
        return {
          id, nom, prenom: nom.split(' ')[0], archive, aVenir,
          total: commission + comBanque,
          commission, comBanque,
        };
      })
      .sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr'));
  }, [collaborateurs, chiffreAffairesAgence]);

  // Demandé le 6 septembre : « dans le CA de l'agence, il faut que tu
  // additionnes le chiffre d'affaires réalisé par les courtiers, et non pas
  // l'encours » — le total de la case « Chiffre d'affaires de l'agence »
  // doit correspondre exactement à la somme des cases CA par courtier
  // (archivé + commission + commission Banque de chacun), pas à un calcul
  // séparé sur l'ensemble des dossiers de l'agence qui pourrait diverger
  // (ex. dossier archivé et signé mais sans courtier attribué).
  const caRealiseCourtiers = useMemo(
    () => caParCourtier.reduce((somme, c) => somme + c.total, 0),
    [caParCourtier]
  );
  const commissionRealiseeCourtiers = useMemo(
    () => caParCourtier.reduce((somme, c) => somme + c.commission, 0),
    [caParCourtier]
  );

  // Demandé le 6 septembre : seulement 5 cases nommées (Sylvain, Eric,
  // Coralia, Lucie, Karine), dans cet ordre, plutôt que toute la liste
  // triée par montant. On compare sur tous les mots du nom (pas juste le
  // premier) car « full_name » n'est pas toujours saisi « Prénom Nom » —
  // « Nom Prénom » ne doit pas faire disparaître la case de quelqu'un.
  const prenomsCourtiersVises = ['Sylvain', 'Eric', 'Coralia', 'Lucie', 'Karine'];
  const caCourtiersVises = useMemo(() => {
    return prenomsCourtiersVises
      .map((prenom) => {
        const trouve = caParCourtier.find((c) =>
          sansAccents(c.nom).split(/\s+/).includes(sansAccents(prenom))
        );
        // Le prénom affiché est celui visé, pas c.prenom (premier mot de
        // « full_name ») : si le nom est saisi « Nom Prénom », le premier
        // mot serait le nom de famille, pas « Sylvain ».
        return trouve ? { ...trouve, prenom } : undefined;
      })
      .filter((c): c is (typeof caParCourtier)[number] => Boolean(c));
  }, [caParCourtier]);

  // On ne considère que les agences réellement affichées (l'agence active,
  // ou toutes celles présentes dans les dossiers si "Toutes les agences" est
  // sélectionné) — sinon les pipelines par défaut d'autres sociétés (NovaVisio,
  // ImmoSphera...) viennent polluer les intitulés de colonnes affichés ici.
  const agencyIdsInScope = useMemo(() => {
    if (activeAgency.id !== 'all') return [activeAgency.id];
    return Array.from(new Set(deals.map((d) => d.agencyId)));
  }, [activeAgency.id, deals]);

  // Même règle que dans Pipeline.tsx : le pipeline par défaut est celui
  // choisi par l'utilisateur (bouton "Définir par défaut", stocké en
  // localStorage), sinon celui marqué is_default en base, sinon le premier.
  const defaultPipelineIdByAgency = useMemo(() => {
    const map = new Map<string, string>();
    agencyIdsInScope.forEach((agencyId) => {
      const agencyPipelines = pipelinesData.filter((p) => p.agency_id === agencyId);
      if (agencyPipelines.length === 0) return;
      const storedId = currentUser
        ? localStorage.getItem(`novasphere_default_pipeline_${currentUser.uid}_${agencyId}`)
        : null;
      const preferred =
        (storedId && agencyPipelines.find((p) => p.id === storedId)) ||
        agencyPipelines.find((p) => p.is_default) ||
        agencyPipelines[0];
      if (preferred) map.set(agencyId, preferred.id);
    });
    return map;
  }, [pipelinesData, currentUser, agencyIdsInScope]);

  const stageData = useMemo(() => {
    const defaultPipelineIds = new Set(defaultPipelineIdByAgency.values());

    const orderedStageDefs = stagesWithPosition
      .filter((s) => defaultPipelineIds.has(s.pipeline_id))
      .sort((a, b) => a.position - b.position);

    const amountByName = new Map<string, number>();
    orderedStageDefs.forEach((s) => {
      if (!amountByName.has(s.name)) amountByName.set(s.name, 0);
    });

    deals.forEach((d) => {
      // On ne compte que les dossiers réellement rattachés à une étape du
      // pipeline par défaut (les dossiers non assignés à une étape — repérés
      // seulement par leur "température" chaud/froid/tiède — ne sont pas de
      // vraies colonnes du pipeline et ne doivent pas y apparaître).
      if (!d.pipelineId || !defaultPipelineIds.has(d.pipelineId)) return;
      if (!amountByName.has(d.stage)) return;
      amountByName.set(d.stage, (amountByName.get(d.stage) || 0) + d.amount);
    });

    const seen = new Set<string>();
    const uniqueOrderedStages = orderedStageDefs.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });

    // Le graphique démarre à la colonne "Montage bancaire" (les étapes
    // amont type "Prise de contact" ne sont pas affichées ici) — le reste de
    // l'ordre du pipeline par défaut est conservé tel quel.
    const startIndex = uniqueOrderedStages.findIndex((s) => /montage\s*bancaire/i.test(s.name));
    const visibleStages = startIndex >= 0 ? uniqueOrderedStages.slice(startIndex) : uniqueOrderedStages;

    return visibleStages.map((s) => ({ name: s.name, value: amountByName.get(s.name) || 0 }));
  }, [deals, stagesWithPosition, defaultPipelineIdByAgency]);

  // 30/08/2026, "tout en bas c'est vert aussi, il faudrait tourner entre
  // gris, jaune noir et blanc" : l'ancienne palette (vert/orange/bleu/
  // indigo/rose) tranchait avec la charte gris anthracite/doré du reste de
  // l'appli — remplacée par un cycle gris / doré (#F7BC5F, même doré que
  // partout ailleurs) / anthracite ("noir") / gris très clair ("blanc",
  // légèrement décalé du blanc pur pour rester visible sur fond clair).
  const COLORS = ['#9aa1ab', '#F7BC5F', '#3d3d3d', '#e8e8e8'];

  const recentContacts = [...contacts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // ── Objectif du mois + montant facturé (demande explicite, 30/08/2026) ──
  // Table `monthly_goals` déjà présente en base (reprise de l'ancien CRM)
  // mais jamais reliée à aucune interface — remplace le badge "Objectif
  // trimestriel" figé (texte codé en dur à 78%, sans aucun lien avec de
  // vraies données) par un objectif MENSUEL réellement saisi et enregistré.
  const queryClient = useQueryClient();

  // Demandé le 2 septembre : « avec ça j'aurai une vue globale de ce qui a
  // été validé, pour pallier aux éventuelles erreurs ». Le détail du chiffre
  // d'affaires s'ouvre au clic sur la tuile, et chaque montant s'y corrige :
  // c'est la même colonne (leads.estimated_value) que partout ailleurs, donc
  // la correction se répercute immédiatement sur le Tableau de bord.
  // Demandé le 2 septembre : « sépare le tableau — le chiffre déjà réalisé
  // d'un côté, le CA à venir de l'autre, pour ne pas tout avoir en même temps
  // sur le même tableau ». Une seule fenêtre, deux contenus : la tuile dorée
  // ouvre le réalisé, le cercle ouvre l'à-venir.
  const [detailCa, setDetailCa] = useState<'realise' | 'avenir' | null>(null);
  // Demandé le 6 septembre : « quand je clique dans les cases de chaque
  // courtier, un tableau avec commission, commission Banque par client, et
  // quand je clique sur un client, j'accède à sa fiche ». Même principe que
  // detailCa, mais pour un seul courtier (son id).
  const [detailCourtierId, setDetailCourtierId] = useState<string | null>(null);
  // Demandé le 6 septembre : « tu feras la même chose dans le chiffre
  // d'affaires à venir, histoire qu'on ait les lignes qui se décomposent,
  // mais tu ne mettras pas les chèques [cases à cocher], ce n'est pas la
  // peine ». Même principe que detailCourtierId, sur les dossiers vivants.
  const [detailCourtierAvenirId, setDetailCourtierAvenirId] = useState<string | null>(null);
  // Demandé le 6 septembre : « une barre de recherche, et respecte l'ordre
  // des derniers clients archivés tout en haut » — sur le détail réalisé
  // d'un courtier.
  const [rechercheCourtier, setRechercheCourtier] = useState('');
  // Demandé le 6 septembre : « une vue courtier hors chiffres CA agence, pour
  // pas que quand je montre ce tableau en réunion, les courtiers voient les
  // chiffres de l'agence ». Un simple bouton, réservé à la direction CF, qui
  // masque les cases agence (CA de l'agence, CA à venir agence, Objectif de
  // l'année, cercle CA à venir) sans toucher aux cases CA par courtier —
  // celles-ci restent visibles, c'est le but de la réunion. Repart à false à
  // chaque rechargement : ce n'est pas une préférence à retenir.
  const [vueReunionSansAgence, setVueReunionSansAgence] = useState(false);
  const [montantsSaisis, setMontantsSaisis] = useState<Record<string, string>>({});
  const [ligneEnCours, setLigneEnCours] = useState<string | null>(null);

  const enregistrerMontantLigne = async (ligne: LigneCa) => {
    const brut = montantsSaisis[ligne.id];
    if (brut === undefined) return;
    const saisi = brut.trim().replace(',', '.');
    if (saisi === '') { setMontantsSaisis((v) => { const c = { ...v }; delete c[ligne.id]; return c; }); return; }
    const montant = Number(saisi);
    if (!Number.isFinite(montant) || montant < 0) {
      toast.error("Ce montant n'est pas un nombre valide.");
      return;
    }
    if (montant === ligne.montant) { setMontantsSaisis((v) => { const c = { ...v }; delete c[ligne.id]; return c; }); return; }
    setLigneEnCours(ligne.id);
    const { error } = await supabase
      .from('leads')
      .update({ estimated_value: montant } as any)
      .eq('id', ligne.id);
    setLigneEnCours(null);
    if (error) { toast.error(error.message); return; }
    setMontantsSaisis((v) => { const c = { ...v }; delete c[ligne.id]; return c; });
    queryClient.invalidateQueries({ queryKey: ['deals'] });
    queryClient.invalidateQueries({ queryKey: ['contacts_all'] });
    toast.success(`Montant mis à jour : ${formatCurrency(montant)}`);
  };

  // Demandé le 6 septembre : dans le détail par courtier, une case à cocher
  // « commission validée » et une « commission Banque validée » par client —
  // vert une fois pointées, orange tant que non, et la ligne entière passe au
  // vert seulement quand les deux sont cochées.
  // Demandé le 6 septembre : « je veux que les checks soient plus rapides à
  // enlever et à remettre » — la case change de couleur tout de suite (état
  // optimiste local), sans attendre l'aller-retour réseau ni le rechargement
  // complet des dossiers ; seul un échec réel la fait revenir en arrière.
  const [validationOverrides, setValidationOverrides] = useState<Record<string, boolean>>({});
  type ChampValidation =
    | 'commission_validee' | 'com_banque_validee'
    | 'commission_agence_validee' | 'com_banque_agence_validee';
  const CHAMP_VERS_CLE: Record<ChampValidation, keyof Pick<
    LigneCa, 'commissionValidee' | 'comBanqueValidee' | 'commissionAgenceValidee' | 'comBanqueAgenceValidee'
  >> = {
    commission_validee: 'commissionValidee',
    com_banque_validee: 'comBanqueValidee',
    commission_agence_validee: 'commissionAgenceValidee',
    com_banque_agence_validee: 'comBanqueAgenceValidee',
  };
  const estLigneValidee = (ligne: LigneCa, champ: ChampValidation) => {
    const cle = `${ligne.id}:${champ}`;
    return cle in validationOverrides ? validationOverrides[cle] : ligne[CHAMP_VERS_CLE[champ]];
  };
  const basculerValidation = async (
    ligne: LigneCa,
    champ: ChampValidation,
    valeur: boolean
  ) => {
    const cle = `${ligne.id}:${champ}`;
    setValidationOverrides((v) => ({ ...v, [cle]: valeur }));
    const { error } = await supabase
      .from('leads')
      .update({ [champ]: valeur } as any)
      .eq('id', ligne.id);
    if (error) {
      toast.error(error.message);
      setValidationOverrides((v) => ({ ...v, [cle]: !valeur }));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['deals'] });
  };
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const prevMonthDate = new Date(currentYear, now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.getMonth() + 1;
  const prevYear = prevMonthDate.getFullYear();
  // Un objectif est propre à UNE agence — pas de valeur unique cohérente
  // quand "Toutes les agences" est sélectionné.
  const goalAgencyId = activeAgency.id !== 'all' ? activeAgency.id : null;

  const { data: monthlyGoal } = useQuery({
    queryKey: ['monthly-goal', goalAgencyId, currentMonth, currentYear],
    enabled: !!goalAgencyId,
    queryFn: async () => {
      const { data } = await supabase
        .from('monthly_goals' as any)
        .select('id, target_amount')
        .eq('agency_id', goalAgencyId as string)
        .eq('month', currentMonth)
        .eq('year', currentYear)
        .maybeSingle();
      return data as { id: string; target_amount: number } | null;
    },
  });

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const saveGoal = async () => {
    const amount = parseFloat(goalInput.replace(/\s/g, '').replace(',', '.'));
    if (!goalAgencyId || Number.isNaN(amount) || amount < 0) return;
    setSavingGoal(true);
    try {
      await supabase.from('monthly_goals' as any).upsert(
        { agency_id: goalAgencyId, month: currentMonth, year: currentYear, target_amount: amount },
        { onConflict: 'agency_id,month,year' }
      );
      await queryClient.invalidateQueries({ queryKey: ['monthly-goal', goalAgencyId, currentMonth, currentYear] });
      setEditingGoal(false);
    } finally {
      setSavingGoal(false);
    }
  };

  // ── Objectif de l'année (demandé le 2 septembre, tableau de bord ImmoSphera) ──
  // « Tout en haut, le CA de l'agence, le CA à venir, et à droite une
  // troisième case : Objectif de l'année, avec un camembert en fonction du
  // CA de l'agence — la soustraction par rapport à l'objectif. »
  // Un objectif par agence et par année : table annual_goals (migration
  // 20260902220000), sur le modèle de monthly_goals. Lu ici, écrit par les
  // super admins depuis la case elle-même.
  const { data: objectifAnnee, error: erreurObjectifAnnee } = useQuery({
    queryKey: ['annual-goal', goalAgencyId, currentYear],
    enabled: !!goalAgencyId && voitChiffresAgence && !estNovavisio,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('annual_goals' as any)
        .select('id, target_amount')
        .eq('agency_id', goalAgencyId as string)
        .eq('year', currentYear)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string; target_amount: number } | null) ?? null;
    },
  });
  const [editionObjectifAnnee, setEditionObjectifAnnee] = useState(false);
  const [saisieObjectifAnnee, setSaisieObjectifAnnee] = useState('');
  const [enregistrementObjectifAnnee, setEnregistrementObjectifAnnee] = useState(false);

  const enregistrerObjectifAnnee = async () => {
    if (!goalAgencyId) return;
    const montant = parseFloat(saisieObjectifAnnee.replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(montant) || montant < 0) {
      toast.error("Ce montant n'est pas un nombre valide.");
      return;
    }
    setEnregistrementObjectifAnnee(true);
    try {
      const { error } = await supabase
        .from('annual_goals' as any)
        .upsert(
          { agency_id: goalAgencyId, year: currentYear, target_amount: montant, updated_at: new Date().toISOString() },
          { onConflict: 'agency_id,year' }
        );
      if (error) {
        toast.error(error.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['annual-goal', goalAgencyId, currentYear] });
      setEditionObjectifAnnee(false);
      toast.success(`Objectif ${currentYear} enregistré : ${formatCurrency(montant)}`);
    } finally {
      setEnregistrementObjectifAnnee(false);
    }
  };

  // ── Objectif de l'année PAR COLLABORATEUR (Conseils Finances, 5 septembre) ──
  // « Quand le dossier sera archivé, il remontera aussi dans la case objectif
  // de l'année des collaborateurs, tout en haut. » Un objectif par personne,
  // réglé individuellement par les super admins : table
  // collaborator_annual_goals (migration 20260905130000), sur le modèle de
  // annual_goals. Le collaborateur lit le sien (la base ne lui rend que
  // celui-là) ; les super admins lisent et règlent ceux de toute l'agence.
  const { data: objectifsCollaborateurs = [], error: erreurObjectifsCollab } = useQuery({
    queryKey: ['collaborator-annual-goals', goalAgencyId, currentYear],
    enabled: !!goalAgencyId && estConseilsFinances,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborator_annual_goals' as any)
        .select('id, user_id, target_amount')
        .eq('agency_id', goalAgencyId as string)
        .eq('year', currentYear);
      if (error) throw error;
      return (data as { id: string; user_id: string; target_amount: number }[] | null) ?? [];
    },
  });
  const objectifDe = (userId: string) =>
    Number(objectifsCollaborateurs.find((g) => g.user_id === userId)?.target_amount) || 0;
  const monObjectifAnnee = currentUser?.uid ? objectifDe(currentUser.uid) : 0;
  const [collabEnEdition, setCollabEnEdition] = useState<string | null>(null);
  const [saisieObjectifCollab, setSaisieObjectifCollab] = useState('');
  const [enregistrementObjectifCollab, setEnregistrementObjectifCollab] = useState(false);

  const enregistrerObjectifCollab = async (userId: string) => {
    if (!goalAgencyId) return;
    const montant = parseFloat(saisieObjectifCollab.replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(montant) || montant < 0) {
      toast.error("Ce montant n'est pas un nombre valide.");
      return;
    }
    setEnregistrementObjectifCollab(true);
    try {
      const { error } = await supabase
        .from('collaborator_annual_goals' as any)
        .upsert(
          { user_id: userId, agency_id: goalAgencyId, year: currentYear, target_amount: montant, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,agency_id,year' }
        );
      if (error) {
        toast.error(error.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['collaborator-annual-goals', goalAgencyId, currentYear] });
      setCollabEnEdition(null);
      toast.success(`Objectif ${currentYear} enregistré : ${formatCurrency(montant)}`);
    } finally {
      setEnregistrementObjectifCollab(false);
    }
  };

  // Le réalisé de l'année : les mêmes dossiers que la tuile Chiffre
  // d'affaires (archivés, montant confirmé), restreints à l'année en cours,
  // datés par leur archivage — comme la ligne « Facturé » du mois.
  const realiseAnnee = useMemo(
    () => chiffreAffairesAgence.lignes.reduce((somme, ligne) => {
      if (!ligne.archive || !ligne.archiveLe) return somme;
      return new Date(ligne.archiveLe).getFullYear() === currentYear ? somme + ligne.montant : somme;
    }, 0),
    [chiffreAffairesAgence, currentYear]
  );
  const cibleAnnee = objectifAnnee?.target_amount ?? 0;
  const resteAnnee = Math.max(0, cibleAnnee - realiseAnnee);
  const depassementAnnee = Math.max(0, realiseAnnee - cibleAnnee);
  const pourcentAnnee = cibleAnnee > 0 ? Math.round((realiseAnnee / cibleAnnee) * 100) : null;
  // Deux parts : ce qui est fait, ce qui reste. Une part vide n'est pas
  // dessinée (à zéro réalisé, le cercle est tout gris ; objectif atteint,
  // tout doré).
  const camembertAnnee = [
    { name: 'Réalisé', value: realiseAnnee },
    { name: 'Reste à faire', value: resteAnnee },
  ].filter((part) => part.value > 0);

  // « Facturé » du mois : le même chiffre que la tuile Chiffre d'affaires de
  // l'agence, restreint au mois.
  //
  // Cette ligne comptait auparavant les dossiers POSÉS sur une étape dont le
  // nom contient « signat », datés par leur dernière modification, et parmi
  // les seuls dossiers NON archivés. Trois approximations qui se cumulaient :
  // un dossier réellement facturé — donc archivé — en sortait, et la ligne
  // affichait « Facturé : 0 € » pendant que la tuile dorée, juste en dessous,
  // affichait plusieurs dizaines de milliers d'euros. Elle repart maintenant
  // des mêmes dossiers que la tuile, datés par leur archivage.
  const billedForMonth = (month: number, year: number) =>
    chiffreAffairesAgence.lignes.reduce((sum, ligne) => {
      if (!ligne.archive || !ligne.archiveLe) return sum;
      const dt = new Date(ligne.archiveLe);
      if (dt.getMonth() + 1 !== month || dt.getFullYear() !== year) return sum;
      return sum + ligne.montant;
    }, 0);

  const billedThisMonth = useMemo(
    () => billedForMonth(currentMonth, currentYear),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chiffreAffairesAgence, currentMonth, currentYear]
  );
  const billedPrevMonth = useMemo(
    () => billedForMonth(prevMonth, prevYear),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chiffreAffairesAgence, prevMonth, prevYear]
  );
  const billedDelta = billedThisMonth - billedPrevMonth;
  const goalPercent = monthlyGoal && monthlyGoal.target_amount > 0
    ? Math.round((billedThisMonth / monthlyGoal.target_amount) * 100)
    : null;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header section (30/08/2026, demande explicite : "supprime le
          panneau tableau de bord et centre les objectifs à la place, avec
          un fond gris classique") — le panneau titre "Tableau de bord"
          retiré, l'objectif du mois centré à sa place.
          Revu (30/08/2026, "mets ce gris que tu as dans le panneau des
          priorités accueil dans le tableau de bord") : bg-slate-700 (essai
          initial) remplacé par le même gris anthracite à 80% + liseré noir
          fin que le panneau Priorités de l'accueil (voir AccueilGrid.tsx),
          pour une teinte cohérente entre les deux écrans. */}
      <div className="flex justify-center">
        <div className="bg-[#2b2b2b]/80 border border-white/10 px-5 py-3 rounded-2xl flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          <Sparkles className="w-4 h-4 text-[#F7BC5F] shrink-0" />
          {editingGoal ? (
            <>
              <span className="text-slate-300">Objectif du mois :</span>
              <input
                type="number"
                min="0"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Montant en €"
                autoFocus
                className="w-28 px-2 py-1 rounded-lg bg-[#07191b] border border-[#1b4b4e] text-white text-xs focus:outline-none focus:border-[#F7BC5F]"
                onKeyDown={(e) => { if (e.key === 'Enter') void saveGoal(); if (e.key === 'Escape') setEditingGoal(false); }}
              />
              <button
                onClick={() => void saveGoal()}
                disabled={savingGoal}
                className="px-2.5 py-1 rounded-lg bg-[#F7BC5F] text-slate-950 font-bold disabled:opacity-60"
              >
                {savingGoal ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button onClick={() => setEditingGoal(false)} className="text-slate-400 hover:text-white">Annuler</button>
            </>
          ) : (
            <>
              <span className="text-slate-400">
                Objectif
                <b className="text-white font-semibold ml-1.5">{monthlyGoal ? formatCurrency(monthlyGoal.target_amount) : 'non défini'}</b>
              </span>
              <span className="hidden sm:block w-px h-4 bg-white/15" aria-hidden />
              <span className="text-slate-400">
                Facturé
                <b className="text-white font-semibold ml-1.5">{formatCurrency(billedThisMonth)}</b>
                {goalPercent !== null && <span className="text-slate-500"> ({goalPercent}%)</span>}
              </span>
              <span className="hidden sm:block w-px h-4 bg-white/15" aria-hidden />
              <span className={`flex items-center gap-1 font-semibold ${billedDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {billedDelta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {billedDelta >= 0 ? '+' : ''}{formatCurrency(billedDelta)} vs mois dernier
              </span>
              {goalAgencyId ? (
                <button
                  onClick={() => { setGoalInput(monthlyGoal ? String(monthlyGoal.target_amount) : ''); setEditingGoal(true); }}
                  className="flex items-center gap-1 text-slate-400 hover:text-white"
                  title="Définir l'objectif du mois"
                >
                  <Pencil className="w-3 h-3" /> Modifier
                </button>
              ) : (
                <span className="text-slate-500">(sélectionnez une agence pour définir un objectif)</span>
              )}
            </>
          )}
          {/* Demandé le 6 septembre : « je préfère mettre un œil ouvert pour
              tous, et qu'on s'en serve pour enlever les chiffres de l'agence,
              de façon que les courtiers ne se posent pas la question » —
              une icône discrète plutôt qu'un bouton texte qui trahirait ce
              qui est masqué. Réservée à la direction CF. */}
          {estDirectionCF && estConseilsFinances && (
            <button
              type="button"
              onClick={() => setVueReunionSansAgence((v) => !v)}
              title={vueReunionSansAgence ? 'Réafficher les chiffres de l\'agence' : 'Masquer les chiffres de l\'agence (vue réunion)'}
              className="text-slate-500 hover:text-white transition-colors"
            >
              {vueReunionSansAgence ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Demandé le 2 septembre : « mets les 4 tableaux de com en haut,
          alignés ». Les quatre chiffres d'argent — chiffre d'affaires de
          l'agence, commission du conseiller, devis signés à venir, récurrence
          — forment leur propre rangée, en tête du tableau de bord, sur quatre
          colonnes exactes pour qu'ils s'alignent. Ils étaient jusqu'ici noyés
          au milieu des compteurs (prospects, dossiers, tâches), qui suivent
          maintenant en dessous. Hors Novavisio, seul le chiffre d'affaires
          s'affiche : la rangée reste alignée à gauche. */}
      {/* « Aligne les premières écritures des tableaux » (2 septembre) : les
          quatre cartes centraient leur contenu verticalement. Celle du chiffre
          d'affaires ayant trois lignes de commentaire au lieu d'une, son titre
          remontait — les quatre intitulés ne commençaient pas à la même
          hauteur. Contenu calé en haut : les titres, puis les montants,
          s'alignent, quelle que soit la longueur du commentaire en dessous.
          La grille, elle, garde des cartes de même hauteur : les caler en haut
          les aurait rendues inégales, ce qui aurait été pire. */}
      {/* Conseils Finances (5 septembre) : trois cases pour un super admin
          (CA de l'agence, CA à venir, Objectif de l'année), puis une rangée
          « CA par courtier » ; trois cases aussi pour un collaborateur (les
          siennes). */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${estNovavisio ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {/* Ticket #34 — Chiffre d'affaires de l'agence, super admins seulement.
            Pipeline « Transaction V2 », montants HT (commission agence).
            Y entrent les dossiers ARCHIVÉS dont le montant a été confirmé au
            moment de l'archivage : « quand c'est archivé et confirmé sur la
            somme, cela ira dans le chiffre d'affaires de l'agence ». */}
        {voitChiffresAgence && !vueReunionSansAgence && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('realise')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('realise'); } }}
            title="Voir le détail des affaires comptabilisées, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Chiffre d'affaires de l'agence</span>
              {/* Demandé le 6 septembre : « le chiffre d'affaires de l'agence
                  doit être uniquement les chiffres qui ont été comptabilisés
                  du moment qu'on a archivé la fiche du client et que nous
                  avons mis signé, pas avant » — et « il faut que tu
                  additionnes le chiffre d'affaires réalisé par les
                  courtiers, et non pas l'encours ». Ce total est donc
                  exactement la somme des cases CA par courtier
                  (caRealiseCourtiers), jamais l'encours (CA à venir),
                  affiché à part (case dédiée, et en info ci-dessous). */}
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(
                  estConseilsFinances
                    ? caRealiseCourtiers
                    : chiffreAffairesAgence.total
                )}
              </div>
              {/* Une tuile qui affiche zéro sans dire pourquoi fait perdre une
                  soirée. Elle explique donc ce qu'elle a trouvé, et où ça
                  bloque : le pipeline, l'étape, ou le montant. */}
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {!chiffreAffairesAgence.pipelineTrouve ? (
                  <span className="text-amber-400/90">
                    {parPipelinePrincipal
                      ? "Aucun pipeline principal pour cette agence"
                      : 'Aucun pipeline dont le nom contient « transaction » et « v2 »'}
                    {chiffreAffairesAgence.nomsConnus.length > 0 && (
                      <span className="text-slate-500 font-normal block mt-0.5">
                        Trouvés : {chiffreAffairesAgence.nomsConnus.join(', ')}
                      </span>
                    )}
                  </span>
                ) : estConseilsFinances ? (
                  <>
                    {chiffreAffairesAgence.comptees} archivé{chiffreAffairesAgence.comptees > 1 ? 's' : ''} et signé{chiffreAffairesAgence.comptees > 1 ? 's' : ''} ({formatCurrency(chiffreAffairesAgence.total)})
                    {commissionRealiseeCourtiers > 0 && (
                      <>{' + '}commission des courtiers ({formatCurrency(commissionRealiseeCourtiers)})</>
                    )}
                    {chiffreAffairesAgence.comBanqueTotal > 0 && (
                      <>{' + '}commission Banque ({formatCurrencyPrecis(chiffreAffairesAgence.comBanqueTotal)})</>
                    )}
                    {chiffreAffairesAgence.aVenir > 0 && (
                      <span className="text-slate-500 font-normal block mt-0.5">
                        + {formatCurrency(chiffreAffairesAgence.aVenir)} en cours ({chiffreAffairesAgence.comptessAVenir} dossier{chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''}, non archivé, pas dans le total)
                      </span>
                    )}
                    <span className="text-slate-500 font-normal block mt-0.5">
                      Archivé et signé seulement, honoraires agence TTC saisis sur la fiche (pas de hors taxes sur Conseils Finances)
                      {chiffreAffairesAgence.sansMontant > 0 && ` · ${chiffreAffairesAgence.sansMontant} sans honoraires`}
                    </span>
                  </>
                ) : (
                  <>
                    {chiffreAffairesAgence.comptees} affaire{chiffreAffairesAgence.comptees > 1 ? 's' : ''} archivée{chiffreAffairesAgence.comptees > 1 ? 's' : ''} et confirmée{chiffreAffairesAgence.comptees > 1 ? 's' : ''}
                    {chiffreAffairesAgence.sansMontant > 0 && (
                      <span className="text-amber-400/90">
                        {' '}· {chiffreAffairesAgence.sansMontant} sans HT
                      </span>
                    )}
                    {/* La ligne ne s'affichait qu'à zéro. Signalé le 1er
                        septembre : « 6 500 €, 3 affaires — mais où sont tous
                        les dossiers que j'ai archivés ? ». Le compte rendu est
                        donc permanent : on voit d'un coup d'œil combien de
                        dossiers sont dans le pipeline, et pourquoi les autres
                        ne comptent pas. */}
                    <span className="text-slate-500 font-normal block mt-0.5">
                      {chiffreAffairesAgence.dansLePipeline === 0
                        ? 'Aucune affaire dans ce pipeline'
                        : `sur ${chiffreAffairesAgence.dansLePipeline} ${dansPipelineVise}`}
                      {chiffreAffairesAgence.sansMontant > 0 && ` · ${chiffreAffairesAgence.sansMontant} sans montant HT`}
                    </span>
                    {/* Dossier archivé, montant confirmé, mais rattaché à
                        aucune étape de Transaction V2 : il ne peut pas entrer
                        dans le chiffre d'affaires. On le dit, au lieu de le
                        perdre en silence. */}
                    {chiffreAffairesAgence.horsPipelineNb > 0 && (
                      <span className="text-amber-400/90 font-normal block mt-0.5">
                        {chiffreAffairesAgence.horsPipelineNb} archivée{chiffreAffairesAgence.horsPipelineNb > 1 ? 's' : ''} hors {nomPipelineVise} : {formatCurrency(chiffreAffairesAgence.horsPipelineMontant)}
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977]">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Demandé le 5 septembre (Conseils Finances) : « dans le tableau de
            bord, tu ne dois mettre que les chiffres des collaborateurs et pas
            de l'agence : tout en haut, CA du collaborateur — les dossiers que
            nous archiverons dans la pipeline Conseils Finances — et CA à
            venir, remonté dès que l'utilisateur met son dossier dans cette
            pipeline ». Un collaborateur ne voit que ses propres dossiers (voir
            `perimetre` plus haut) : ces tuiles reprennent donc les mêmes
            chiffres que celles des super admins, restreints à lui. */}
        {!estDirectionCF && estConseilsFinances && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">CA du collaborateur</span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(maCommissionPersonnelle + maComBanquePersonnelle)}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {!chiffreAffairesAgence.pipelineTrouve ? (
                  <span className="text-amber-400/90">Aucun pipeline principal pour cette agence</span>
                ) : (
                  <>
                    {formatCurrency(maCommissionPersonnelle)} commission + {formatCurrencyPrecis(maComBanquePersonnelle)} commission Banque
                    <span className="text-slate-500 font-normal block mt-0.5">
                      Sur {chiffreAffairesAgence.comptees} dossier{chiffreAffairesAgence.comptees > 1 ? 's' : ''} archivé{chiffreAffairesAgence.comptees > 1 ? 's' : ''} et signé{chiffreAffairesAgence.comptees > 1 ? 's' : ''} ({formatCurrency(chiffreAffairesAgence.total)} d'honoraires pour l'agence, pas pour vous)
                    </span>
                    <span className="text-slate-500 font-normal block mt-0.5">
                      {chiffreAffairesAgence.dansLePipeline === 0
                        ? `Aucun de vos dossiers ${dansPipelineVise}`
                        : `sur ${chiffreAffairesAgence.dansLePipeline} de vos dossiers ${dansPipelineVise}`}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977]">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        )}

        {!estDirectionCF && estConseilsFinances && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">CA à venir</span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(chiffreAffairesAgence.aVenir)}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {chiffreAffairesAgence.comptessAVenir === 0
                  ? "Aucun de vos dossiers à partir de l'étape Accord banque / Rendez-vous"
                  : `${chiffreAffairesAgence.comptessAVenir} de vos dossiers à partir de l'étape Accord banque / Rendez-vous, honoraires agence TTC`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300">
              <Coins className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* « Quand le dossier sera archivé, il remontera aussi dans la case
            objectif de l'année des collaborateurs, tout en haut. » L'objectif
            est réglé par un super admin (panneau plus bas) ; ici, le
            collaborateur voit le sien et où il en est. */}
        {!estDirectionCF && estConseilsFinances && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 flex items-start justify-between gap-4 group">
            <div className="space-y-1 min-w-0 flex-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Objectif de l'année {currentYear}</span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {monObjectifAnnee > 0 ? formatCurrency(monObjectifAnnee) : <span className="text-base font-bold text-slate-500">non défini</span>}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {erreurObjectifsCollab ? (
                  <span className="text-amber-400/90">Objectif indisponible : {(erreurObjectifsCollab as Error).message}</span>
                ) : monObjectifAnnee <= 0 ? (
                  "Votre objectif est réglé par un administrateur"
                ) : (
                  <>
                    Réalisé en {currentYear} : <b className="text-slate-300">{formatCurrency(realiseAnnee)}</b>
                    <span className="block mt-0.5">
                      {realiseAnnee > monObjectifAnnee
                        ? `Objectif dépassé de ${formatCurrency(realiseAnnee - monObjectifAnnee)}`
                        : `Reste à faire : ${formatCurrency(monObjectifAnnee - realiseAnnee)}`}
                    </span>
                  </>
                )}
              </span>
            </div>
            {monObjectifAnnee > 0 && !erreurObjectifsCollab ? (
              <CamembertObjectif realise={realiseAnnee} cible={monObjectifAnnee} />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977] shrink-0">
                <Target className="w-6 h-6" />
              </div>
            )}
          </div>
        )}

        {/* « CA à venir qui sera le CA à partir de Accord banque » : les
            dossiers du pipeline Conseils Finances arrivés à l'étape Accord
            banque / Rendez-vous ou au-delà (règle posée dans le calcul plus
            haut, la même que le cercle et la fenêtre de détail). Pour les
            super admins de Conseils Finances, la tuile ImmoSphera (tout ce
            qui est dans le pipeline) ne s'affiche donc pas. */}
        {estDirectionCF && estVueDirectionCF && !vueReunionSansAgence && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('avenir')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('avenir'); } }}
            title="Voir le détail des dossiers à venir, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">CA à venir agence</span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(chiffreAffairesAgence.aVenir)}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {chiffreAffairesAgence.comptessAVenir === 0
                  ? "Aucun dossier à partir de l'étape Accord banque / Rendez-vous"
                  : `${chiffreAffairesAgence.comptessAVenir} dossier${chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''} à partir de l'étape Accord banque / Rendez-vous, honoraires agence TTC — pas dans le chiffre d'affaires de l'agence tant que non archivé et signé`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300">
              <Coins className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Demandé le 2 septembre pour ImmoSphera : « tout en haut, le CA de
            l'agence, le CA à venir, et à droite une troisième case Objectif de
            l'année, avec un camembert ». Hors Novavisio, la rangée compte donc
            trois cases ; Novavisio garde ses quatre. Le CA à venir est le
            même chiffre que le cercle plus bas, sans sa répartition par
            colonne : ici, le total, à côté du réalisé.
            Ouverte aux agents (pas seulement super admin) le 7 octobre :
            « je veux que tu le mette en entrée pour l'utilisateur sur CA à
            venir ». `perimetre` (plus haut) restreint déjà les données à ses
            seules affaires quand il n'est pas en droit de voir celles de
            l'agence (voitChiffresAgence) — même mécanisme que la case
            individuelle de Conseils Finances. Seuls le libellé et le seuil
            (Mandat pour l'agent, Offre d'achat pour l'agence, voir
            seuilDepartMandat/seuilDepartOffre) changent selon qui regarde. */}
        {!estNovavisio && !estConseilsFinances && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('avenir')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('avenir'); } }}
            title="Voir le détail des affaires à venir, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                {voitChiffresAgence ? 'CA à venir agence' : 'CA à venir'}
              </span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(chiffreAffairesAgence.aVenir)}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {chiffreAffairesAgence.comptessAVenir === 0
                  ? (voitChiffresAgence
                      ? "Aucun dossier à partir de l'étape Offre d'achat"
                      : "Aucun de vos dossiers à partir de l'étape Mandat")
                  : (voitChiffresAgence
                      ? `${chiffreAffairesAgence.comptessAVenir} dossier${chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''} à partir de l'étape Offre d'achat, commission agence HT`
                      : `${chiffreAffairesAgence.comptessAVenir} de vos dossiers à partir de l'étape Mandat, commission agence HT`)}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300">
              <Coins className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Objectif de l'année : le montant se saisit dans la case (crayon),
            le camembert oppose le réalisé de l'année à ce qui reste — la
            soustraction demandée. Objectif atteint : cercle tout doré et
            dépassement affiché. */}
        {voitChiffresAgence && !estNovavisio && !vueReunionSansAgence && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between gap-4 group">
            <div className="space-y-1 min-w-0 flex-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Objectif de l'année {currentYear}</span>
              {editionObjectifAnnee ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    type="number"
                    min="0"
                    value={saisieObjectifAnnee}
                    onChange={(e) => setSaisieObjectifAnnee(e.target.value)}
                    placeholder="Montant en €"
                    autoFocus
                    className="w-32 px-2 py-1 rounded-lg bg-[#07191b] border border-[#1b4b4e] text-white text-xs focus:outline-none focus:border-[#F7BC5F]"
                    onKeyDown={(e) => { if (e.key === 'Enter') void enregistrerObjectifAnnee(); if (e.key === 'Escape') setEditionObjectifAnnee(false); }}
                  />
                  <button
                    onClick={() => void enregistrerObjectifAnnee()}
                    disabled={enregistrementObjectifAnnee}
                    className="px-2.5 py-1 rounded-lg bg-[#F7BC5F] text-slate-950 text-xs font-bold disabled:opacity-60"
                  >
                    {enregistrementObjectifAnnee ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  <button onClick={() => setEditionObjectifAnnee(false)} className="text-xs text-slate-400 hover:text-white">Annuler</button>
                </div>
              ) : (
                <div className="text-3xl font-semibold text-white tracking-tight tabular-nums flex items-center gap-2">
                  {cibleAnnee > 0 ? formatCurrency(cibleAnnee) : <span className="text-base font-bold text-slate-500">non défini</span>}
                  <button
                    onClick={() => { setSaisieObjectifAnnee(cibleAnnee > 0 ? String(cibleAnnee) : ''); setEditionObjectifAnnee(true); }}
                    className="text-slate-400 hover:text-white"
                    title="Définir l'objectif de l'année"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {erreurObjectifAnnee ? (
                  <span className="text-amber-400/90">Objectif indisponible : {(erreurObjectifAnnee as Error).message}</span>
                ) : cibleAnnee <= 0 ? (
                  "Saisissez l'objectif pour voir le camembert"
                ) : (
                  <>
                    Réalisé en {currentYear} : <b className="text-slate-300">{formatCurrency(realiseAnnee)}</b>
                    <span className="block mt-0.5">
                      {depassementAnnee > 0
                        ? `Objectif dépassé de ${formatCurrency(depassementAnnee)}`
                        : `Reste à faire : ${formatCurrency(resteAnnee)}`}
                    </span>
                  </>
                )}
              </span>
            </div>
            {cibleAnnee > 0 && !erreurObjectifAnnee ? (
              <div className="relative w-24 h-24 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={camembertAnnee}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={46}
                      paddingAngle={camembertAnnee.length > 1 ? 2 : 0}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {camembertAnnee.map((part) => (
                        <Cell key={part.name} fill={part.name === 'Réalisé' ? '#F7BC5F' : '#3d3d3d'} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value) || 0), String(name)]}
                      contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: '11px' }}
                      itemStyle={{ color: 'var(--ink-1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-sm font-semibold text-white">{pourcentAnnee} %</span>
                </div>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977] shrink-0">
                <Target className="w-6 h-6" />
              </div>
            )}
          </div>
        )}

        {/* Demandé le 2 septembre pour Novavisio : « rajoute sur le tableau de
            bord une autre case avec CA de Natacha, et une autre case avec CA
            devis à venir ». Deux tuiles de plus, seulement sur Novavisio :
            ailleurs, elles n'auraient aucun sens. */}
        {isSuperAdmin && estNovavisio && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                Commission {natacha?.name?.split(' ')[0] || 'Natacha'}
              </span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">{formatCurrency(commissionNatacha)}</div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {natacha
                  ? 'Sa commission, saisie à l\'archivage — distincte du CA agence'
                  : "Aucun collaborateur nommé Natacha dans cette agence"}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center text-sky-300">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        )}

        {isSuperAdmin && estNovavisio && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Devis signés à venir</span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(chiffreAffairesAgence.devis)}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {chiffreAffairesAgence.devisNb === 0
                  ? 'Aucun devis en attente — case « Devis signés à venir » de la fiche client'
                  : `${chiffreAffairesAgence.devisNb} devis en attente de facturation`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-300">
              <Briefcase className="w-6 h-6" />
            </div>
          </div>
        )}

        {isSuperAdmin && estNovavisio && (
          <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Récurrence</span>
              <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">
                {formatCurrency(chiffreAffairesAgence.recurrence)}
              </div>
              <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                {chiffreAffairesAgence.recurrenceNb === 0
                  ? 'Aucune récurrence notée — case « Récurrence » à l\'archivage'
                  : `${chiffreAffairesAgence.recurrenceNb} client${chiffreAffairesAgence.recurrenceNb > 1 ? 's' : ''} avec une récurrence`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        )}
      </div>

      {/* Conseils Finances (5 septembre), super admins : « ceux qui
          appartiennent aux courtiers, Sylvain Grazia compris : rajouter une
          case en haut du tableau de bord, CA Sylvain, ou le nom du courtier ».
          Une case par personne, même règle que le CA de l'agence (archivés +
          à partir de Montage dossier), la plus grosse en premier. */}
      {estDirectionCF && estVueDirectionCF && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-1">CA par courtier</h3>
          {caCourtiersVises.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">Aucun collaborateur rattaché à cette agence.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {caCourtiersVises.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setRechercheCourtier(''); setDetailCourtierId(c.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRechercheCourtier(''); setDetailCourtierId(c.id); } }}
                  title={`Voir le détail des dossiers de ${c.prenom}, client par client`}
                  className="dash-card p-5 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-start justify-between gap-3 group cursor-pointer">
                  <div className="space-y-1 min-w-0 flex-1">
                    <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium block truncate" title={c.nom}>CA {c.prenom}</span>
                    <div className="text-2xl font-semibold text-white tracking-tight tabular-nums">{formatCurrency(c.total)}</div>
                    <span className="text-[11px] text-slate-500 font-normal leading-snug block">
                      {c.total === 0
                        ? 'Aucun dossier archivé et signé'
                        : `${formatCurrency(c.archive)} archivé`}
                    </span>
                    {/* Le CA à venir (encore vivant, pas archivé) reste
                        informatif, à part du total ci-dessus qui ne compte
                        que de l'archivé et signé. */}
                    {c.aVenir > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDetailCourtierAvenirId(c.id); }}
                        title={`Voir le détail des dossiers en cours de ${c.prenom}, client par client`}
                        className="text-[11px] text-slate-500 hover:text-[#F9C977] font-normal block underline decoration-dotted underline-offset-2 text-left"
                      >
                        + {formatCurrency(c.aVenir)} en cours, hors total
                      </button>
                    )}
                    {/* Demandé le 6 septembre : la commission du courtier
                        (advisor_commission_ttc, tous ses dossiers archivés)
                        et, en dessous, la commission Banque (com_banque). */}
                    <div className="pt-2 mt-1 space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="text-slate-500">Courtiers</span>
                        <span className="text-slate-200 tabular-nums">{formatCurrency(c.commission)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="text-slate-500">Banque</span>
                        <span className="text-slate-200 tabular-nums">{formatCurrencyPrecis(c.comBanque)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center text-sky-300">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conseils Finances (5 septembre) : les objectifs de l'année, un par
          collaborateur, réglés ici par les super admins — chaque personne
          retrouve le sien tout en haut de son propre tableau de bord. Le
          réalisé est celui de l'année en cours, dossiers archivés et
          confirmés, attribués à la personne. */}
      {estDirectionCF && estVueDirectionCF && goalAgencyId && (
        <div className="dash-card p-6 rounded-2xl border border-white/10 space-y-4">
          <div>
            <h3 className="font-semibold text-sm text-white">Objectifs {currentYear}</h3>
            <p className="text-xs text-slate-400">
              Chaque collaborateur voit son objectif en tête de son tableau de bord ; le réalisé est celui de ses dossiers archivés cette année.
            </p>
          </div>
          {erreurObjectifsCollab && (
            <p className="text-xs text-amber-400/90">Objectifs indisponibles : {(erreurObjectifsCollab as Error).message}</p>
          )}
          {collaborateursCourtiers.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun collaborateur rattaché à cette agence.</p>
          ) : (
            <div className="divide-y divide-white/10">
              {collaborateursCourtiers.map((collab) => {
                const cible = objectifDe(collab.id);
                const realise = chiffreAffairesAgence.parConseillerAnnee.get(collab.id) || 0;
                const enEdition = collabEnEdition === collab.id;
                const avance = cible > 0 ? Math.min(100, Math.round((realise / cible) * 100)) : 0;
                return (
                  <div key={collab.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{collab.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Réalisé <b className="text-slate-300 font-medium">{formatCurrency(realise)}</b>
                        {cible > 0 && (
                          <span>
                            {' · '}
                            {realise > cible
                              ? `dépassé de ${formatCurrency(realise - cible)}`
                              : `reste ${formatCurrency(cible - realise)}`}
                          </span>
                        )}
                      </div>
                      {cible > 0 && (
                        <div className="mt-2 h-1.5 max-w-xs rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full bg-[#F7BC5F]" style={{ width: `${avance}%` }} />
                        </div>
                      )}
                    </div>
                    {enEdition ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={saisieObjectifCollab}
                          onChange={(e) => setSaisieObjectifCollab(e.target.value)}
                          placeholder="Montant en €"
                          autoFocus
                          className="w-32 px-2 py-1 rounded-lg bg-[#07191b] border border-[#1b4b4e] text-white text-xs focus:outline-none focus:border-[#F7BC5F]"
                          onKeyDown={(e) => { if (e.key === 'Enter') void enregistrerObjectifCollab(collab.id); if (e.key === 'Escape') setCollabEnEdition(null); }}
                        />
                        <button
                          onClick={() => void enregistrerObjectifCollab(collab.id)}
                          disabled={enregistrementObjectifCollab}
                          className="px-2.5 py-1 rounded-lg bg-[#F7BC5F] text-slate-950 text-xs font-bold disabled:opacity-60"
                        >
                          {enregistrementObjectifCollab ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        <button onClick={() => setCollabEnEdition(null)} className="text-xs text-slate-400 hover:text-white">Annuler</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-base font-semibold text-white tabular-nums">
                          {cible > 0 ? formatCurrency(cible) : <span className="text-sm font-bold text-slate-500">non défini</span>}
                        </span>
                        <button
                          onClick={() => { setSaisieObjectifCollab(cible > 0 ? String(cible) : ''); setCollabEnEdition(collab.id); }}
                          className="text-slate-400 hover:text-white"
                          title={`Définir l'objectif ${currentYear} de ${collab.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {cible > 0 && <CamembertObjectif realise={realise} cible={cible} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 - Prospects (Deep Teal theme) */}
        <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Prospects & Clients</span>
            <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">{totalContacts}</div>
            <button 
              onClick={() => onNavigate('clients')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Gérer les contacts <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-400">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2 - Dossiers Actifs (Deep Amber theme) */}
        <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Dossiers actifs</span>
            <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">{activeDeals}</div>
            <button 
              onClick={() => onNavigate('pipeline')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Voir le pipeline <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977]">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3 - Volume Financier (Deep Emerald theme) */}
        <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Volume financier</span>
            <div className="text-2xl font-semibold text-emerald-300 tracking-tight tabular-nums">{formatCurrency(totalDealValue)}</div>
            <span className="text-[11px] text-emerald-400/90 font-semibold tracking-wide block">Encours total sécurisé</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
            <Coins className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 4 - Tâches en Attente (Deep Slate-Indigo theme) */}
        <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Tâches en attente</span>
            <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">{pendingTasks}</div>
            <button 
              onClick={() => onNavigate('rappels')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Traiter les tâches <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Visualizer charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stages Chart */}
        <div className="dash-card lg:col-span-2 p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white">Répartition du Volume par Étape (€)</h3>
            <p className="text-xs text-slate-400">Total des opportunités financières valorisées dans le pipeline.</p>
          </div>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData}>
                <XAxis
                  dataKey="name"
                  stroke="var(--nv-chart-axis)"
                  tickLine={false}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                  tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                />
                <YAxis stroke="var(--nv-chart-axis)" tickLine={false} width={45} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip
                  formatter={(value: unknown) => [formatCurrency(Number(value) || 0), 'Volume']}
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--ink-2)' }}
                  itemStyle={{ color: 'var(--ink-1)' }}
                  cursor={{ fill: 'var(--nv-wash)' }}
                />
                <Bar
                  dataKey="value"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                  cursor={onNavigateToStage ? 'pointer' : undefined}
                  onClick={(entry: { name?: string }) => {
                    if (entry?.name && onNavigateToStage) {
                      onNavigateToStage(entry.name);
                    } else {
                      onNavigate('pipeline');
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Demandé le 1er septembre : « le cercle doit être CA à venir — tout
            ce qui est en HT commission agence doit être là, avant le à
            facturer ; quand c'est archivé et confirmé sur la somme, cela ira
            dans le chiffre d'affaires de l'agence ». Le cercle montre donc
            l'argent encore dans Transaction V2 (non archivé), réparti par
            colonne ; la tuile dorée, elle, montre le réalisé. Masqué en vue
            réunion (6 septembre) : c'est un chiffre agence. */}
        {!vueReunionSansAgence && (
        <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm text-white">CA à venir</h3>
            <p className="text-xs text-slate-400">
              {estConseilsFinances
                ? "Honoraires agence TTC des dossiers à partir de Accord banque / Rendez-vous, par colonne."
                : `Commission agence HT encore ${dansPipelineVise}, par colonne.`}
            </p>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('avenir')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('avenir'); } }}
            title="Voir le détail des affaires à venir, ligne par ligne"
            className="h-48 w-full flex items-center justify-center relative cursor-pointer"
          >
            {chiffreAffairesAgence.repartitionAVenir.length === 0 ? (
              <span className="text-xs text-slate-500 text-center px-4">
                Aucun montant HT en attente {dansPipelineVise}
              </span>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chiffreAffairesAgence.repartitionAVenir}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {chiffreAffairesAgence.repartitionAVenir.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(127,127,127,0.4)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: unknown) => [formatCurrency(Number(value) || 0), '']}
                    contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: '11px' }}
                    labelStyle={{ color: 'var(--ink-2)' }}
                    itemStyle={{ color: 'var(--ink-1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {chiffreAffairesAgence.repartitionAVenir.length > 0 && (
              <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">À venir</span>
                <span className="text-sm font-black text-white">{formatCurrency(chiffreAffairesAgence.aVenir)}</span>
                <span className="text-[10px] text-slate-500">
                  {chiffreAffairesAgence.comptessAVenir} affaire{chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-1 text-[11px]">
            {chiffreAffairesAgence.repartitionAVenir.map((entry, idx) => (
              <div key={entry.name} className="flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  <span>{entry.name}</span>
                </div>
                <span className="font-semibold text-white">{formatCurrency(entry.value)}</span>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Demandé le 2 septembre pour ImmoSphera : « tableau de bord, enlève
          tout en bas ». La rangée du bas — derniers prospects et panneau
          « Actualités immobilières » (texte figé, taux d'août 2026) — ne
          s'affiche plus que sur Novavisio. */}
      {estNovavisio && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Contacts List */}
        <div className="dash-card lg:col-span-2 p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors space-y-4">
          <div>
            <h3 className="font-bold text-sm text-white">Prospects Récemment Enregistrés</h3>
            <p className="text-xs text-slate-400">Derniers dossiers ajoutés pour attribution ou qualification.</p>
          </div>
          {recentContacts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#144447]/40 rounded-xl">
              Aucun prospect enregistré. Cliquez sur "Clients & Leads" pour ajouter votre premier dossier.
            </div>
          ) : (
            <div className="divide-y divide-[#144447]/30">
              {recentContacts.map(c => {
                const agency = AGENCIES.find(a => a.id === c.agencyId);
                return (
                  <div key={c.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-bold text-xs uppercase">
                        {c.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{c.name}</div>
                        <div className="text-[10px] text-slate-400">{c.email} • {c.phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-black/40 border border-[#144447]/60 text-[9px] font-semibold text-slate-300">
                        {agency?.name || 'Inconnue'}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${
                        c.status === 'Converti' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        c.status === 'Nouveau' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25' :
                        'bg-[#F7BC5F]/10 text-[#F9C977] border border-[#F7BC5F]/25'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="dash-card p-6 rounded-2xl border border-white/10 hover:border-[#F7BC5F]/40 transition-colors space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#F9C977] font-bold text-xs uppercase tracking-wider mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Actualités Immobilières</span>
            </div>
            <h3 className="font-extrabold text-base text-white">Taux d'Intérêt du Moment</h3>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">
              Les taux d'intérêt moyens sur 20 ans se stabilisent à <strong>3.65%</strong> en ce mois d'août 2026. Profitez-en pour relancer vos prospects "Proposition" et revoir leurs capacités de financement.
            </p>
          </div>

          <div className="pt-4 border-t border-[#144447]/40 text-xs text-slate-300 space-y-2">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-[#F7BC5F]" />
              <span>Capacité moyenne : 240,000 €</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#F7BC5F]" />
              <span>Délai d'accord : 14 jours ouvrés</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Demandé le 2 septembre : « quand je clique dans la colonne chiffre
          d'affaires d'agence, je voudrais un tableau avec le nom et prénom
          des clients, s'il faut le numéro de mandat, et le chiffre — et que
          je puisse modifier le chiffre de chaque ligne, ce qui aura
          l'incidence en positif ou négatif sur le tableau de bord ». Le
          montant modifié ici est écrit dans la même colonne que partout
          ailleurs (leads.estimated_value) : le total se recalcule aussitôt. */}
      {detailCa && (() => {
        const realise = detailCa === 'realise';
        // Conseils Finances : le CA de l'agence additionne archivés et
        // dossiers à partir d'Accord banque — la fenêtre du réalisé montre
        // donc les deux, comme la tuile.
        const lignesVisibles = chiffreAffairesAgence.lignes.filter((l) =>
          realise ? (l.archive || estConseilsFinances) : !l.archive
        );
        const totalVisible = lignesVisibles.reduce((somme, l) => somme + l.montant, 0);
        // Demandé le 6 septembre : « quand on clique sur le CA de l'agence,
        // je voudrais voir les chiffres détaillés avec les commissions
        // Banque perçues par l'agence — chiffre d'affaires courtage et
        // chiffre d'affaires agence commission Banque ». comBanqueAgence
        // (pas comBanque, qui est déjà la part du courtier) est ce que
        // l'agence perçoit elle-même de la banque, par dossier.
        const totalBanqueVisible = lignesVisibles.reduce((somme, l) => somme + l.comBanqueAgence, 0);
        return (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDetailCa(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-[#07191b] border border-[#1b4e52] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 p-5 border-b border-[#144447]/60">
              <div>
                <h3 className="text-base font-bold text-white">
                  {realise ? "Chiffre d'affaires réalisé" : 'CA à venir'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {nomPipelineVise} · {lignesVisibles.length} dossier{lignesVisibles.length > 1 ? 's' : ''} ·{' '}
                  {formatCurrency(totalVisible)} courtage
                  {estConseilsFinances && totalBanqueVisible > 0 && (
                    <> + {formatCurrencyPrecis(totalBanqueVisible)} commission Banque</>
                  )}
                  {realise ? ' comptabilisés' : ' en attente de facturation'}
                </p>
              </div>
              <button
                onClick={() => setDetailCa(null)}
                className="text-slate-500 hover:text-white text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-3 px-5 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-[#144447]/40">
              <span className="flex-1">Client</span>
              <span className="w-28 hidden sm:block">Mandat</span>
              <span className="w-32 text-right">Courtage</span>
              {estConseilsFinances && <span className="w-28 text-right hidden sm:block">Comm. Banque</span>}
            </div>

            <div className="overflow-y-auto custom-scrollbar divide-y divide-[#144447]/40">
              {lignesVisibles.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  {realise
                    ? 'Aucun dossier archivé avec un montant confirmé pour le moment.'
                    : `Aucun dossier en attente ${dansPipelineVise}.`}
                </p>
              ) : (
                lignesVisibles.map((ligne) => (
                  <div key={ligne.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="flex-1 min-w-0">
                      {/* Le nom ouvre la fiche du client (5 septembre) ; la
                          fenêtre se referme pour laisser la place. */}
                      {onOpenContact ? (
                        <button
                          type="button"
                          onClick={() => { setDetailCa(null); onOpenContact(ligne.contactId); }}
                          title="Ouvrir la fiche du client"
                          className="block max-w-full text-left text-sm text-white font-semibold truncate hover:text-[#F9C977] hover:underline"
                        >
                          {ligne.nom}
                        </button>
                      ) : (
                        <div className="text-sm text-white font-semibold truncate">{ligne.nom}</div>
                      )}
                      <div className="text-[11px] text-slate-500 truncate">
                        {ligne.etape || 'Sans étape'}
                        {ligne.mandat && <span className="sm:hidden"> · Mandat {ligne.mandat}</span>}
                      </div>
                    </div>
                    <span className="w-28 hidden sm:block text-xs text-slate-400 truncate">
                      {ligne.mandat || '—'}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={montantsSaisis[ligne.id] ?? (ligne.montant ? String(ligne.montant) : '')}
                      onChange={(e) => setMontantsSaisis((v) => ({ ...v, [ligne.id]: e.target.value }))}
                      onBlur={() => void enregistrerMontantLigne(ligne)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      disabled={ligneEnCours === ligne.id}
                      placeholder="0"
                      className={`w-32 px-2 py-1.5 rounded-lg bg-[#0a1e20] border text-right text-sm tabular-nums focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-50 ${
                        montantsSaisis[ligne.id] !== undefined
                          ? 'border-[#F7BC5F]/60 text-[#F9C977]'
                          : 'border-[#144447]/60 text-white'
                      }`}
                    />
                    {estConseilsFinances && (
                      <span className="w-28 text-right text-sm text-slate-300 tabular-nums hidden sm:block">
                        {formatCurrencyPrecis(ligne.comBanqueAgence)}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            <p className="px-5 py-3 text-[11px] text-slate-500 border-t border-[#144447]/60 leading-relaxed">
              Le montant se corrige directement dans la ligne : il est enregistré en quittant le
              champ (ou avec la touche Entrée), et le chiffre se met à jour aussitôt.
              {realise
                ? " Ces dossiers sont archivés, montant confirmé : ils comptent dans le chiffre d'affaires de l'agence."
                : " Ces dossiers sont encore dans le pipeline : ils basculeront dans le chiffre d'affaires une fois archivés et le montant confirmé."}
            </p>
          </div>
        </div>
        );
      })()}

      {/* Demandé le 6 septembre : « quand je clique dans les cases de chaque
          courtier, un tableau avec les montants commission, commission
          Banque par client, et quand je clique sur un client, j'accède
          directement à sa fiche ». Mêmes lignes que le détail du CA de
          l'agence (chiffreAffairesAgence.lignes), filtrées sur ce courtier
          et sur exactement ce qui compte dans sa case : archivé et signé. */}
      {detailCourtierId && (() => {
        const courtier = caParCourtier.find((c) => c.id === detailCourtierId);
        const rechercheNormalisee = sansAccents(rechercheCourtier.trim());
        const lignesCourtier = chiffreAffairesAgence.lignes
          .filter((l) => l.advisorId === detailCourtierId && l.archive && l.signe)
          .filter((l) => !rechercheNormalisee || sansAccents(l.nom).includes(rechercheNormalisee))
          // Les derniers archivés tout en haut ; les rares lignes sans date
          // d'archivage (anciennes fiches) restent en bas.
          .sort((a, b) => {
            if (!a.archiveLe && !b.archiveLe) return 0;
            if (!a.archiveLe) return 1;
            if (!b.archiveLe) return -1;
            return new Date(b.archiveLe).getTime() - new Date(a.archiveLe).getTime();
          });
        // Demandé le 6 septembre : « commission de l'agence, commission du
        // courtier, banque agence, banque courtier — des chèques sur les
        // quatre lignes, pour être sûr de tout vérifier correctement ».
        // Quatre cases bien visibles, en haut du tableau, avec ce qui a
        // déjà été « comptabilisé validé » sur chacune, en vert.
        const commissionAgenceValideeTotal = lignesCourtier
          .filter((l) => estLigneValidee(l, 'commission_agence_validee'))
          .reduce((s, l) => s + l.montant, 0);
        const commissionValideeTotal = lignesCourtier
          .filter((l) => estLigneValidee(l, 'commission_validee'))
          .reduce((s, l) => s + l.commission, 0);
        const comBanqueAgenceValideeTotal = lignesCourtier
          .filter((l) => estLigneValidee(l, 'com_banque_agence_validee'))
          .reduce((s, l) => s + l.comBanqueAgence, 0);
        const comBanqueValideeTotal = lignesCourtier
          .filter((l) => estLigneValidee(l, 'com_banque_validee'))
          .reduce((s, l) => s + l.comBanque, 0);
        return (
          <div
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setDetailCourtierId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl max-h-[85vh] flex flex-col rounded-2xl bg-[#07191b] border border-[#1b4e52] shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 p-5 border-b border-[#144447]/60">
                <div>
                  <h3 className="text-base font-bold text-white">
                    CA {courtier?.prenom || ''} — détail par client
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {lignesCourtier.length} dossier{lignesCourtier.length > 1 ? 's' : ''} archivé{lignesCourtier.length > 1 ? 's' : ''} et signé{lignesCourtier.length > 1 ? 's' : ''} · {formatCurrency(courtier?.total || 0)}
                  </p>
                </div>
                <button
                  onClick={() => setDetailCourtierId(null)}
                  className="text-slate-500 hover:text-white text-xl leading-none px-1"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 border-b border-[#144447]/60">
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">Commission agence validée</span>
                  <span className="text-lg font-black text-emerald-300 tracking-tight">{formatCurrency(commissionAgenceValideeTotal)}</span>
                </div>
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">Commission courtier validée</span>
                  <span className="text-lg font-black text-emerald-300 tracking-tight">{formatCurrency(commissionValideeTotal)}</span>
                </div>
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">Com. Banque agence validée</span>
                  <span className="text-lg font-black text-emerald-300 tracking-tight">{formatCurrencyPrecis(comBanqueAgenceValideeTotal)}</span>
                </div>
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">Com. Banque courtier validée</span>
                  <span className="text-lg font-black text-emerald-300 tracking-tight">{formatCurrencyPrecis(comBanqueValideeTotal)}</span>
                </div>
              </div>

              <div className="px-5 pt-3">
                <input
                  type="search"
                  value={rechercheCourtier}
                  onChange={(e) => setRechercheCourtier(e.target.value)}
                  placeholder="Rechercher un client…"
                  className="w-full px-3.5 py-2 rounded-lg bg-[#0a1e20] border border-[#144447]/60 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]/60"
                />
              </div>

              <div className="flex items-center gap-3 px-5 pt-2 pb-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-[#144447]/40">
                <span className="flex-1">Client (derniers archivés en premier)</span>
                <span className="w-28 text-right">Comm. agence</span>
                <span className="w-28 text-right">Comm. courtier</span>
                <span className="w-32 text-right">Banque agence</span>
                <span className="w-32 text-right">Banque courtier</span>
              </div>

              <div className="overflow-y-auto custom-scrollbar divide-y divide-[#144447]/40">
                {lignesCourtier.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">
                    {rechercheNormalisee
                      ? 'Aucun client ne correspond à cette recherche.'
                      : 'Aucun dossier archivé et signé pour ce courtier pour le moment.'}
                  </p>
                ) : (
                  lignesCourtier.map((ligne) => {
                    // Demandé le 6 septembre : quatre cases à cocher par
                    // client — commission agence, commission courtier,
                    // banque agence, banque courtier. Chaque montant est
                    // vert coché, orange sinon ; la ligne entière ne passe
                    // au vert que si les quatre sont cochées.
                    const commissionAgenceValidee = estLigneValidee(ligne, 'commission_agence_validee');
                    const commissionValidee = estLigneValidee(ligne, 'commission_validee');
                    const comBanqueAgenceValidee = estLigneValidee(ligne, 'com_banque_agence_validee');
                    const comBanqueValidee = estLigneValidee(ligne, 'com_banque_validee');
                    const toutValide = commissionAgenceValidee && commissionValidee && comBanqueAgenceValidee && comBanqueValidee;
                    const Cellule = ({
                      largeur, montant, valide, champ, precis,
                    }: {
                      largeur: string; montant: number; valide: boolean; champ: ChampValidation; precis?: boolean;
                    }) => (
                      <label
                        onClick={(e) => e.stopPropagation()}
                        className={`${largeur} flex items-center justify-end gap-2 cursor-pointer select-none`}
                      >
                        <span className={`text-sm tabular-nums ${valide ? 'text-emerald-300' : 'text-amber-400'}`}>
                          {precis ? formatCurrencyPrecis(montant) : formatCurrency(montant)}
                        </span>
                        <input
                          type="checkbox"
                          checked={valide}
                          onChange={(e) => void basculerValidation(ligne, champ, e.target.checked)}
                          className="w-5 h-5 shrink-0 rounded accent-emerald-500 cursor-pointer"
                        />
                      </label>
                    );
                    return (
                      <div
                        key={ligne.id}
                        className={`flex items-center gap-3 px-5 py-2.5 border-l-2 ${
                          toutValide
                            ? 'bg-emerald-500/10 border-l-emerald-500'
                            : 'bg-amber-500/5 border-l-amber-500/70'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          {onOpenContact ? (
                            <button
                              type="button"
                              onClick={() => { setDetailCourtierId(null); onOpenContact(ligne.contactId); }}
                              title="Ouvrir la fiche du client"
                              className="block max-w-full text-left text-sm text-white font-semibold truncate hover:text-[#F9C977] hover:underline"
                            >
                              {ligne.nom}
                            </button>
                          ) : (
                            <div className="text-sm text-white font-semibold truncate">{ligne.nom}</div>
                          )}
                        </div>
                        <Cellule largeur="w-28" montant={ligne.montant} valide={commissionAgenceValidee} champ="commission_agence_validee" />
                        <Cellule largeur="w-28" montant={ligne.commission} valide={commissionValidee} champ="commission_validee" />
                        <Cellule largeur="w-32" montant={ligne.comBanqueAgence} valide={comBanqueAgenceValidee} champ="com_banque_agence_validee" precis />
                        <Cellule largeur="w-32" montant={ligne.comBanque} valide={comBanqueValidee} champ="com_banque_validee" precis />
                      </div>
                    );
                  })
                )}
              </div>

              <p className="px-5 py-3 text-[11px] text-slate-500 border-t border-[#144447]/60 leading-relaxed">
                Cliquez sur un client pour ouvrir sa fiche directement. Cochez chacune des quatre
                cases une fois reçue : la ligne passe au vert quand les quatre le sont, orange tant
                qu'il en manque une.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Demandé le 6 septembre : « tu feras la même chose dans le chiffre
          d'affaires à venir, histoire qu'on ait les lignes qui se
          décomposent, mais tu ne mettras pas les chèques, ce n'est pas la
          peine ». Même tableau que le détail réalisé d'un courtier, sur ses
          dossiers encore vivants (pas archivés), sans cases à cocher —
          rien à valider tant que ce n'est pas facturé. */}
      {detailCourtierAvenirId && (() => {
        const courtier = caParCourtier.find((c) => c.id === detailCourtierAvenirId);
        const lignesCourtier = chiffreAffairesAgence.lignes.filter(
          (l) => l.advisorId === detailCourtierAvenirId && !l.archive
        );
        return (
          <div
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setDetailCourtierAvenirId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-[#07191b] border border-[#1b4e52] shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 p-5 border-b border-[#144447]/60">
                <div>
                  <h3 className="text-base font-bold text-white">
                    CA {courtier?.prenom || ''} — en cours, détail par client
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {lignesCourtier.length} dossier{lignesCourtier.length > 1 ? 's' : ''} en cours · {formatCurrency(courtier?.aVenir || 0)}
                  </p>
                </div>
                <button
                  onClick={() => setDetailCourtierAvenirId(null)}
                  className="text-slate-500 hover:text-white text-xl leading-none px-1"
                >
                  ×
                </button>
              </div>

              {/* Demandé le 6 septembre : « pour tout ce qui est à venir, tu
                  peux faire aussi comme l'autre colonne, histoire de
                  dispatcher un peu les montants » — même répartition à 4
                  colonnes (agence / courtier) que le détail réalisé, mais
                  sans case à cocher : rien n'est encore dû tant que ce n'est
                  pas archivé et signé. */}
              <div className="flex items-center gap-3 px-5 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-[#144447]/40">
                <span className="flex-1">Client</span>
                <span className="w-24 text-right">Comm. agence</span>
                <span className="w-24 text-right">Comm. courtier</span>
                <span className="w-28 text-right">Banque agence</span>
                <span className="w-28 text-right">Banque courtier</span>
              </div>

              <div className="overflow-y-auto custom-scrollbar divide-y divide-[#144447]/40">
                {lignesCourtier.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">
                    Aucun dossier en cours pour ce courtier pour le moment.
                  </p>
                ) : (
                  lignesCourtier.map((ligne) => (
                    <div key={ligne.id} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="flex-1 min-w-0">
                        {onOpenContact ? (
                          <button
                            type="button"
                            onClick={() => { setDetailCourtierAvenirId(null); onOpenContact(ligne.contactId); }}
                            title="Ouvrir la fiche du client"
                            className="block max-w-full text-left text-sm text-white font-semibold truncate hover:text-[#F9C977] hover:underline"
                          >
                            {ligne.nom}
                          </button>
                        ) : (
                          <div className="text-sm text-white font-semibold truncate">{ligne.nom}</div>
                        )}
                        <div className="text-[11px] text-slate-500 truncate">{ligne.etape || 'Sans étape'}</div>
                      </div>
                      <span className="w-24 text-right text-sm text-white tabular-nums">
                        {formatCurrency(ligne.montant)}
                      </span>
                      <span className="w-24 text-right text-sm text-slate-300 tabular-nums">
                        {formatCurrency(ligne.commission)}
                      </span>
                      <span className="w-28 text-right text-sm text-slate-300 tabular-nums">
                        {formatCurrencyPrecis(ligne.comBanqueAgence)}
                      </span>
                      <span className="w-28 text-right text-sm text-slate-300 tabular-nums">
                        {formatCurrencyPrecis(ligne.comBanque)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <p className="px-5 py-3 text-[11px] text-slate-500 border-t border-[#144447]/60 leading-relaxed">
                Cliquez sur un client pour ouvrir sa fiche directement. Ces dossiers ne sont pas
                encore archivés et signés : rien à valider ici pour le moment.
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
