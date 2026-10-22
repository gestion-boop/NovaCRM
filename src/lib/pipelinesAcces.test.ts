import { describe, expect, it } from 'vitest';
import {
  IMMOSPHERA_AGENCY_ID,
  MELANIE_UID,
  SARAH_UID,
  SYLVAIN_UID,
  TRANSACTIONS_PIPELINE_ID,
  estCommunitySarah,
  estMelanieOuSylvain,
  estPipelineTransactions,
  peutGererColonnes,
  peutRenommerPipeline,
  peutSupprimerPipeline,
  pipelineVisiblePour,
} from './pipelinesAcces';

const CF = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e';
const CHRISTOPHE = '41d1f830-1605-4fc4-9362-a38c87b94574';
const AUTRE_ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const transactions = {
  id: TRANSACTIONS_PIPELINE_ID,
  name: 'Pipelines Transactions',
  agencyId: IMMOSPHERA_AGENCY_ID,
  ownerId: null as string | null,
};

describe('accès aux pipelines', () => {
  it('reconnaît Pipelines Transactions d’Immosphera, pas un homonyme ailleurs', () => {
    expect(estPipelineTransactions(transactions)).toBe(true);
    expect(
      estPipelineTransactions({
        id: 'autre',
        name: 'Pipeline Transactions V2',
        agencyId: IMMOSPHERA_AGENCY_ID,
      })
    ).toBe(true);
    expect(
      estPipelineTransactions({
        id: 'perso',
        name: 'Pipeline Transactions',
        agencyId: CF,
      })
    ).toBe(false);
    expect(estPipelineTransactions({ id: 'b2', name: 'Transaction B2', agencyId: IMMOSPHERA_AGENCY_ID })).toBe(false);
  });

  it('ne montre Transactions qu’aux gens d’Immosphera, pas à Sarah', () => {
    expect(pipelineVisiblePour(transactions, { uid: CHRISTOPHE, email: 'christophe.hirsch@immosphera.fr' })).toBe(true);
    expect(pipelineVisiblePour(transactions, { uid: MELANIE_UID, email: 'gestion@immosphera.fr' })).toBe(true);
    expect(pipelineVisiblePour(transactions, { uid: SYLVAIN_UID })).toBe(true);
    expect(pipelineVisiblePour(transactions, { uid: SARAH_UID, email: 'combressarah725@gmail.com' })).toBe(false);
    expect(pipelineVisiblePour(transactions, { email: 'combressarah725@gmail.com' })).toBe(false);
    expect(estCommunitySarah({ uid: CHRISTOPHE, email: 'sarah.autre@example.com' })).toBe(false);
  });

  it('ne montre un pipeline personnel qu’à son créateur', () => {
    const perso = { id: 'perso', name: 'Mes ventes', agencyId: IMMOSPHERA_AGENCY_ID, ownerId: CHRISTOPHE };
    expect(pipelineVisiblePour(perso, { uid: CHRISTOPHE })).toBe(true);
    expect(pipelineVisiblePour(perso, { uid: MELANIE_UID })).toBe(false);
    expect(pipelineVisiblePour(perso, { uid: SYLVAIN_UID })).toBe(false);
    expect(pipelineVisiblePour(perso, { uid: AUTRE_ADMIN })).toBe(false);
    const homonyme = { id: 'cf-tx', name: 'Pipeline Transactions', agencyId: CF, ownerId: CHRISTOPHE };
    expect(pipelineVisiblePour(homonyme, { uid: CHRISTOPHE })).toBe(true);
    expect(pipelineVisiblePour(homonyme, { uid: MELANIE_UID })).toBe(false);
    expect(pipelineVisiblePour({ id: 'partage', name: 'Principal', agencyId: CF, ownerId: null }, { uid: CHRISTOPHE })).toBe(
      true
    );
    expect(
      pipelineVisiblePour(
        { id: 'officiel', name: 'Pipeline Conseils Finances', agencyId: CF, ownerId: 'quelquun', officiel: true },
        { uid: SYLVAIN_UID }
      )
    ).toBe(true);
  });

  it('réserve la structure de Transactions à Mélanie et Sylvain, et interdit sa suppression', () => {
    const melanie = { uid: MELANIE_UID, email: 'gestion@immosphera.fr' };
    const sylvain = { uid: SYLVAIN_UID, email: 's.grazia@conseilfinances.fr' };
    const sarah = { uid: SARAH_UID, email: 'combressarah725@gmail.com' };
    const autre = { uid: AUTRE_ADMIN, email: 'admin@example.com' };
    expect(estMelanieOuSylvain(melanie)).toBe(true);
    expect(estMelanieOuSylvain({ email: 's.grazia@conseilfinances.fr' })).toBe(true);
    expect(estMelanieOuSylvain({ email: 'autre.grazia@example.com' })).toBe(false);

    expect(peutRenommerPipeline(transactions, melanie, false)).toBe(true);
    expect(peutGererColonnes(transactions, sylvain, true)).toBe(true);
    expect(peutRenommerPipeline(transactions, autre, true)).toBe(false);
    expect(peutGererColonnes(transactions, autre, true)).toBe(false);
    expect(peutGererColonnes(transactions, { uid: CHRISTOPHE }, false)).toBe(false);
    expect(peutSupprimerPipeline(transactions, melanie, false)).toBe(false);
    expect(peutSupprimerPipeline(transactions, sylvain, true)).toBe(false);
    expect(peutSupprimerPipeline(transactions, sarah, false)).toBe(false);
  });

  it('laisse chacun renommer et supprimer son pipeline, et les colonnes aux super admins', () => {
    const perso = {
      id: 'perso',
      name: 'Mes ventes',
      agencyId: CF,
      ownerId: CHRISTOPHE,
      officiel: false,
      verrouille: false,
    };
    const christophe = { uid: CHRISTOPHE };
    expect(peutRenommerPipeline(perso, christophe, false)).toBe(true);
    expect(peutSupprimerPipeline(perso, christophe, false)).toBe(true);
    expect(peutGererColonnes(perso, christophe, false)).toBe(false);
    expect(peutGererColonnes(perso, christophe, true)).toBe(true);
    expect(peutSupprimerPipeline({ ...perso, verrouille: true }, christophe, false)).toBe(false);
    expect(peutSupprimerPipeline({ ...perso, verrouille: true }, { uid: AUTRE_ADMIN }, true)).toBe(true);
    expect(peutRenommerPipeline(perso, { uid: MELANIE_UID }, false)).toBe(false);
  });
});
