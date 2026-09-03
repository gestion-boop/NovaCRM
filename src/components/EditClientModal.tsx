import React from 'react';
import { createPortal } from 'react-dom';
import { Contact } from '@/types';
import { NouveauLeadModal } from '@/components/NouveauLeadModal';

interface Props {
  client: Contact;
  onClose: () => void;
  onSave: (updates: Partial<Contact>) => Promise<void>;
}

/**
 * Modification d'une fiche client.
 *
 * Demandé le 3 septembre : « quand je clique dans une fiche client et que je
 * fais Modifier, je ne retombe pas sur les mêmes informations que quand je
 * crée une fiche ; il faut que ce soit la même chose pour toutes les
 * agences. » Cette fenêtre n'a donc plus de formulaire à elle : elle ouvre
 * celui de la création (NouveauLeadModal), pré-rempli avec la fiche. Mêmes
 * champs, même ordre, mêmes règles par agence, à la création comme à la
 * modification.
 */
export default function EditClientModal({ client, onClose, onSave }: Props) {
  // Portail vers <body> : la fiche client vit dans la zone principale, qui a
  // sa propre pile d'affichage — sur téléphone, la barre du bas passerait
  // sinon par-dessus les boutons du formulaire (même correctif que l'agenda).
  return createPortal(
    <NouveauLeadModal
      isOpen
      onClose={onClose}
      selectedAgencyId={client.agencyId}
      initial={client}
      onSubmit={async (contact) => {
        // Le libellé `status` est dérivé de `statutLead` par la mise à jour
        // elle-même ; on ne le renvoie pas pour ne pas écrire deux fois.
        const { status, ...updates } = contact;
        void status;
        await onSave(updates);
      }}
    />,
    document.body,
  );
}
