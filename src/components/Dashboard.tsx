import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { AGENCIES } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Users, Coins, Briefcase, CheckCircle2, ArrowRight, Building, Sparkles, Pencil, TrendingUp, TrendingDown, Target } from 'lucide-react';
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
        <span className="text-sm font-black text-white">{pourcent} %</span>
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
  const totalContacts = contacts.length;

  // "Dossiers actifs" porte sur TOUTES les opportunités actuellement
  // visibles dans le Pipeline pour cette agence — sans filtre sur un nom
  // d'étape ("Perdu", "Dossier facture"...), car ces noms sont
  // personnalisables par agence/pipeline et ne correspondent déjà plus aux
  // étapes réellement configurées. Ainsi, ce chiffre correspond toujours
  // exactement à ce que montre le Pipeline, quelle que soit la façon dont
  // les étapes ont été renommées.
  const activeDeals = deals.length;

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

  // "Volume financier" = somme des opportunités arrivées à l'étape "Accord
  // banque" (ou équivalent, ex. "Accord banque / Rendez-vous") ou au-delà,
  // dans l'ordre réel des étapes de LEUR pipeline (chaque pipeline peut
  // avoir un ordre/nommage différent). Les opportunités dont le pipeline ne
  // comporte aucune étape "Accord banque" ne sont pas comptabilisées ici :
  // cet indicateur est spécifique au processus de financement.
  // Demandé le 5 septembre (Conseils Finances) : la tuile « CA à venir » des
  // super admins est « le CA à partir de Accord banque » — exactement ce
  // chiffre. On garde aussi le nombre de dossiers, pour le dire sous le
  // montant.
  const accordBanque = useMemo(() => {
    const accordBanquePositionByPipeline = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      if (/accord\s*banque/i.test(s.name)) {
        const current = accordBanquePositionByPipeline.get(s.pipeline_id);
        if (current === undefined || s.position < current) {
          accordBanquePositionByPipeline.set(s.pipeline_id, s.position);
        }
      }
    });

    const positionByPipelineAndStage = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      positionByPipelineAndStage.set(`${s.pipeline_id}::${s.name}`, s.position);
    });

    return deals.reduce((acc, d) => {
      if (!d.pipelineId) return acc;
      const threshold = accordBanquePositionByPipeline.get(d.pipelineId);
      if (threshold === undefined) return acc; // pipeline sans étape "Accord banque"
      const dealPosition = positionByPipelineAndStage.get(`${d.pipelineId}::${d.stage}`);
      if (dealPosition === undefined || dealPosition < threshold) return acc;
      return { total: acc.total + d.amount, nb: acc.nb + 1 };
    }, { total: 0, nb: 0 });
  }, [deals, stagesWithPosition]);
  const totalDealValue = accordBanque.total;

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
        total: 0, comptees: 0, aVenir: 0, comptessAVenir: 0, sansMontant: 0,
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
    // Conseils Finances (5 septembre) : « le CA à venir devrait être à
    // partir de Montage dossier » (d'abord demandé à partir d'Accord banque /
    // Rendez-vous, puis avancé à cette étape). Position de cette étape dans
    // chaque pipeline, et position de chaque étape — même lecture que la
    // tuile Volume financier plus haut. Reconnue à son nom (« Montage
    // dossier », « Montage bancaire »…), la première si plusieurs.
    const seuilDepart = new Map<string, number>();
    const positionEtape = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      positionEtape.set(`${s.pipeline_id}::${s.name}`, s.position);
      if (/montage/i.test(s.name)) {
        const actuel = seuilDepart.get(s.pipeline_id);
        if (actuel === undefined || s.position < actuel) seuilDepart.set(s.pipeline_id, s.position);
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
    // dossiers à partir de Montage dossier : « ceux qui appartiennent aux
    // courtiers, Sylvain compris, une case en haut du tableau de bord ».
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
      const pipelineReel = (d.stageId && pipelineParEtape.get(d.stageId)) || d.pipelineId;
      if (!pipelineReel || !pipelinesVises.has(pipelineReel)) {
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
      // Conseils Finances : un dossier ne compte qu'à partir de l'étape
      // Montage dossier — vivant (CA à venir) comme archivé (réalisé). Les
      // anciennes fiches archivées sans étape (l'écran affichait leur
      // température, « chaud ») ne comptent donc nulle part.
      if (estConseilsFinances) {
        const seuil = seuilDepart.get(pipelineReel);
        const position = positionEtape.get(`${pipelineReel}::${d.stage}`);
        if (seuil === undefined || position === undefined || position < seuil) return;
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
      });
      if (d.archivedAt) {
        total += montant;
        comptees += 1;
        if (d.advisorId) {
          parConseiller.set(d.advisorId, (parConseiller.get(d.advisorId) || 0) + montant);
          if (new Date(d.archivedAt).getFullYear() === anneeCourante) {
            parConseillerAnnee.set(d.advisorId, (parConseillerAnnee.get(d.advisorId) || 0) + montant);
          }
          const commission = Number(d.advisorCommissionTtc) || 0;
          if (commission > 0) {
            commissionParConseiller.set(
              d.advisorId,
              (commissionParConseiller.get(d.advisorId) || 0) + commission
            );
          }
          const comBanque = Number(d.comBanque) || 0;
          if (comBanque > 0) {
            comBanqueParConseiller.set(
              d.advisorId,
              (comBanqueParConseiller.get(d.advisorId) || 0) + comBanque
            );
          }
        }
      }
      else {
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
      total, comptees, aVenir, comptessAVenir, sansMontant,
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

  // Demandé le 5 septembre (Conseils Finances), pour les super admins : « ceux
  // qui appartiennent aux courtiers, Sylvain Grazia compris : rajouter une
  // case en haut du tableau de bord, CA Sylvain, ou le nom du courtier ». Une
  // case par personne de l'agence : ses dossiers archivés et confirmés, plus
  // ses dossiers à partir de Montage dossier — la même règle que le
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
        return {
          id, nom, prenom: nom.split(' ')[0], archive, aVenir, total: archive + aVenir,
          commission, comBanque,
        };
      })
      .sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr'));
  }, [collaborateurs, chiffreAffairesAgence]);

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
        <div className="bg-[#2b2b2b]/80 border border-black/60 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-[#F9C977]">
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
              <span>
                Objectif du mois : <b>{monthlyGoal ? formatCurrency(monthlyGoal.target_amount) : 'non défini'}</b>
                {' · '}Facturé : <b>{formatCurrency(billedThisMonth)}</b>
                {goalPercent !== null && ` (${goalPercent}%)`}
              </span>
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
        {voitChiffresAgence && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('realise')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('realise'); } }}
            title="Voir le détail des affaires comptabilisées, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/30 hover:border-[#F7BC5F]/50 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-start justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">Chiffre d'affaires de l'agence</span>
              {/* Conseils Finances (5 septembre) : « CA à venir, à partir des
                  dossiers mis dans Accord banque / Rendez-vous, à prendre en
                  compte dans le CA agence ». Le chiffre additionne donc les
                  dossiers archivés et ceux arrivés à cette étape ; ailleurs,
                  les archivés seulement, comme avant. */}
              <div className="text-2xl font-black text-[#F9C977] tracking-tight">
                {formatCurrency(estConseilsFinances ? chiffreAffairesAgence.total + chiffreAffairesAgence.aVenir : chiffreAffairesAgence.total)}
              </div>
              {/* Une tuile qui affiche zéro sans dire pourquoi fait perdre une
                  soirée. Elle explique donc ce qu'elle a trouvé, et où ça
                  bloque : le pipeline, l'étape, ou le montant. */}
              <span className="text-[11px] text-slate-400 font-semibold tracking-wide block">
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
                    {chiffreAffairesAgence.comptessAVenir} en cours ({formatCurrency(chiffreAffairesAgence.aVenir)})
                    {' + '}{chiffreAffairesAgence.comptees} archivé{chiffreAffairesAgence.comptees > 1 ? 's' : ''} ({formatCurrency(chiffreAffairesAgence.total)})
                    <span className="text-slate-500 font-normal block mt-0.5">
                      À partir de l'étape Montage dossier, honoraires agence TTC saisis sur la fiche (pas de hors taxes sur Conseils Finances)
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
            <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977] group-hover:scale-105 transition-transform">
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
          <div className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/30 shadow-lg flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">CA du collaborateur</span>
              <div className="text-2xl font-black text-[#F9C977] tracking-tight">
                {formatCurrency(chiffreAffairesAgence.total)}
              </div>
              <span className="text-[11px] text-slate-400 font-semibold tracking-wide block">
                {!chiffreAffairesAgence.pipelineTrouve ? (
                  <span className="text-amber-400/90">Aucun pipeline principal pour cette agence</span>
                ) : (
                  <>
                    {chiffreAffairesAgence.comptees} dossier{chiffreAffairesAgence.comptees > 1 ? 's' : ''} archivé{chiffreAffairesAgence.comptees > 1 ? 's' : ''} et confirmé{chiffreAffairesAgence.comptees > 1 ? 's' : ''}, honoraires agence TTC
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
          <div className="dash-card p-6 rounded-2xl border border-teal-500/25 shadow-lg flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">CA à venir</span>
              <div className="text-2xl font-black text-white tracking-tight">
                {formatCurrency(chiffreAffairesAgence.aVenir)}
              </div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                {chiffreAffairesAgence.comptessAVenir === 0
                  ? "Aucun de vos dossiers à partir de l'étape Montage dossier"
                  : `${chiffreAffairesAgence.comptessAVenir} de vos dossiers à partir de l'étape Montage dossier, honoraires agence TTC`}
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
          <div className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/30 shadow-lg flex items-start justify-between gap-4 group">
            <div className="space-y-1 min-w-0 flex-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">Objectif de l'année {currentYear}</span>
              <div className="text-2xl font-black text-[#F9C977] tracking-tight">
                {monObjectifAnnee > 0 ? formatCurrency(monObjectifAnnee) : <span className="text-base font-bold text-slate-500">non défini</span>}
              </div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
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
        {estDirectionCF && estVueDirectionCF && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('avenir')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('avenir'); } }}
            title="Voir le détail des dossiers à venir, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-teal-500/25 hover:border-teal-500/40 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-start justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">CA à venir agence</span>
              <div className="text-2xl font-black text-white tracking-tight">
                {formatCurrency(chiffreAffairesAgence.aVenir)}
              </div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                {chiffreAffairesAgence.comptessAVenir === 0
                  ? "Aucun dossier à partir de l'étape Montage dossier"
                  : `${chiffreAffairesAgence.comptessAVenir} dossier${chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''} à partir de l'étape Montage dossier, honoraires agence TTC — compris dans le CA de l'agence`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300 group-hover:scale-105 transition-transform">
              <Coins className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Demandé le 2 septembre pour ImmoSphera : « tout en haut, le CA de
            l'agence, le CA à venir, et à droite une troisième case Objectif de
            l'année, avec un camembert ». Hors Novavisio, la rangée compte donc
            trois cases ; Novavisio garde ses quatre. Le CA à venir est le
            même chiffre que le cercle plus bas, sans sa répartition par
            colonne : ici, le total, à côté du réalisé. */}
        {isSuperAdmin && !estNovavisio && !estConseilsFinances && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('avenir')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('avenir'); } }}
            title="Voir le détail des affaires à venir, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-teal-500/25 hover:border-teal-500/40 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-start justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">CA à venir</span>
              <div className="text-2xl font-black text-white tracking-tight">
                {formatCurrency(chiffreAffairesAgence.aVenir)}
              </div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                {chiffreAffairesAgence.comptessAVenir === 0
                  ? 'Aucun montant HT en attente dans Transaction V2'
                  : `${chiffreAffairesAgence.comptessAVenir} affaire${chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''} encore dans Transaction V2, commission agence HT`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300 group-hover:scale-105 transition-transform">
              <Coins className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Objectif de l'année : le montant se saisit dans la case (crayon),
            le camembert oppose le réalisé de l'année à ce qui reste — la
            soustraction demandée. Objectif atteint : cercle tout doré et
            dépassement affiché. */}
        {voitChiffresAgence && !estNovavisio && (
          <div className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/30 hover:border-[#F7BC5F]/50 shadow-lg transition-all duration-300 flex items-start justify-between gap-4 group">
            <div className="space-y-1 min-w-0 flex-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">Objectif de l'année {currentYear}</span>
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
                <div className="text-2xl font-black text-[#F9C977] tracking-tight flex items-center gap-2">
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
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
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
                  <span className="text-sm font-black text-white">{pourcentAnnee} %</span>
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
          <div className="dash-card p-6 rounded-2xl border border-sky-500/25 hover:border-sky-500/40 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">
                Commission {natacha?.name?.split(' ')[0] || 'Natacha'}
              </span>
              <div className="text-2xl font-black text-sky-300 tracking-tight">{formatCurrency(commissionNatacha)}</div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                {natacha
                  ? 'Sa commission, saisie à l\'archivage — distincte du CA agence'
                  : "Aucun collaborateur nommé Natacha dans cette agence"}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center text-sky-300 group-hover:scale-105 transition-transform">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        )}

        {isSuperAdmin && estNovavisio && (
          <div className="dash-card p-6 rounded-2xl border border-violet-500/25 hover:border-violet-500/40 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">Devis signés à venir</span>
              <div className="text-2xl font-black text-violet-300 tracking-tight">
                {formatCurrency(chiffreAffairesAgence.devis)}
              </div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                {chiffreAffairesAgence.devisNb === 0
                  ? 'Aucun devis en attente — case « Devis signés à venir » de la fiche client'
                  : `${chiffreAffairesAgence.devisNb} devis en attente de facturation`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-300 group-hover:scale-105 transition-transform">
              <Briefcase className="w-6 h-6" />
            </div>
          </div>
        )}

        {isSuperAdmin && estNovavisio && (
          <div className="dash-card p-6 rounded-2xl border border-teal-500/25 hover:border-teal-500/40 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-start justify-between group">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">Récurrence</span>
              <div className="text-2xl font-black text-teal-300 tracking-tight">
                {formatCurrency(chiffreAffairesAgence.recurrence)}
              </div>
              <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                {chiffreAffairesAgence.recurrenceNb === 0
                  ? 'Aucune récurrence notée — case « Récurrence » à l\'archivage'
                  : `${chiffreAffairesAgence.recurrenceNb} client${chiffreAffairesAgence.recurrenceNb > 1 ? 's' : ''} avec une récurrence`}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-300 group-hover:scale-105 transition-transform">
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
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">CA par courtier</h3>
          {caCourtiersVises.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">Aucun collaborateur rattaché à cette agence.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {caCourtiersVises.map((c) => (
                <div key={c.id} className="dash-card p-5 rounded-2xl border border-sky-500/25 hover:border-sky-500/40 shadow-lg transition-all duration-300 flex items-start justify-between gap-3 group">
                  <div className="space-y-1 min-w-0">
                    <span className="text-xs text-slate-400 font-medium tracking-wide block truncate" title={c.nom}>CA {c.prenom}</span>
                    <div className="text-xl font-black text-sky-300 tracking-tight">{formatCurrency(c.total)}</div>
                    <span className="text-[11px] text-slate-500 font-semibold tracking-wide block">
                      {c.total === 0
                        ? 'Aucun dossier à partir de Montage dossier'
                        : `${formatCurrency(c.aVenir)} en cours + ${formatCurrency(c.archive)} archivé, à partir de Montage dossier`}
                    </span>
                    {/* Demandé le 6 septembre : la commission du courtier
                        (advisor_commission_ttc, tous ses dossiers archivés)
                        et, en dessous, la commission Banque (com_banque). */}
                    <div className="pt-1 mt-1 border-t border-white/5 space-y-0.5">
                      <span className="text-[11px] text-slate-400 font-semibold tracking-wide block">
                        Commission des courtiers : <span className="text-slate-200">{formatCurrency(c.commission)}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 font-semibold tracking-wide block">
                        Commission Banque : <span className="text-slate-200">{formatCurrency(c.comBanque)}</span>
                      </span>
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
        <div className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/30 shadow-lg space-y-4">
          <div>
            <h3 className="font-bold text-sm text-white">Objectifs de l'année {currentYear} — par collaborateur</h3>
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
            <div className="divide-y divide-[#144447]/40">
              {collaborateursCourtiers.map((collab) => {
                const cible = objectifDe(collab.id);
                const realise = chiffreAffairesAgence.parConseillerAnnee.get(collab.id) || 0;
                const enEdition = collabEnEdition === collab.id;
                return (
                  <div key={collab.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{collab.name}</div>
                      <div className="text-[11px] text-slate-500">
                        Réalisé en {currentYear} : <b className="text-slate-300">{formatCurrency(realise)}</b>
                        {cible > 0 && (
                          <span>
                            {' · '}
                            {realise > cible
                              ? `objectif dépassé de ${formatCurrency(realise - cible)}`
                              : `reste à faire : ${formatCurrency(cible - realise)}`}
                          </span>
                        )}
                      </div>
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
                        <span className="text-base font-black text-[#F9C977] tabular-nums">
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
        <div className="dash-card p-6 rounded-2xl border border-teal-500/25 hover:border-teal-500/40 shadow-lg hover:shadow-teal-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Prospects & Clients</span>
            <div className="text-3xl font-black text-white tracking-tight">{totalContacts}</div>
            <button 
              onClick={() => onNavigate('clients')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Gérer les contacts <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2 - Dossiers Actifs (Deep Amber theme) */}
        <div className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/25 hover:border-[#F7BC5F]/40 shadow-lg hover:shadow-[#F7BC5F]/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Dossiers actifs</span>
            <div className="text-3xl font-black text-white tracking-tight">{activeDeals}</div>
            <button 
              onClick={() => onNavigate('pipeline')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Voir le pipeline <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977] group-hover:scale-105 transition-transform">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3 - Volume Financier (Deep Emerald theme) */}
        <div className="dash-card p-6 rounded-2xl border border-emerald-500/25 hover:border-emerald-500/40 shadow-lg hover:shadow-emerald-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Volume financier</span>
            <div className="text-2xl font-black text-emerald-400 tracking-tight">{formatCurrency(totalDealValue)}</div>
            <span className="text-[11px] text-emerald-400/90 font-semibold tracking-wide block">Encours total sécurisé</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
            <Coins className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 4 - Tâches en Attente (Deep Slate-Indigo theme) */}
        <div className="dash-card p-6 rounded-2xl border border-indigo-500/25 hover:border-indigo-500/40 shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Tâches en attente</span>
            <div className="text-3xl font-black text-white tracking-tight">{pendingTasks}</div>
            <button 
              onClick={() => onNavigate('rappels')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Traiter les tâches <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Visualizer charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stages Chart */}
        <div className="dash-card lg:col-span-2 p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 flex flex-col justify-between">
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
            colonne ; la tuile dorée, elle, montre le réalisé. */}
        <div className="dash-card p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm text-white">CA à venir</h3>
            <p className="text-xs text-slate-400">
              {estConseilsFinances
                ? "Honoraires agence TTC des dossiers à partir de Montage dossier, par colonne."
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
      </div>

      {/* Demandé le 2 septembre pour ImmoSphera : « tableau de bord, enlève
          tout en bas ». La rangée du bas — derniers prospects et panneau
          « Actualités immobilières » (texte figé, taux d'août 2026) — ne
          s'affiche plus que sur Novavisio. */}
      {estNovavisio && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Contacts List */}
        <div className="dash-card lg:col-span-2 p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 space-y-4">
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
        <div className="dash-card p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 space-y-4 flex flex-col justify-between">
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
                  {formatCurrency(totalVisible)}
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
              <span className="w-32 text-right">Montant</span>
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
    </div>
  );
}
