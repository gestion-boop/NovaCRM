import React from 'react';
import { Contact } from '@/types';

/**
 * Champs communs à la création (NouveauLeadModal) et à la modification
 * (EditClientModal) d'une fiche client.
 *
 * Demandé le 3 septembre : « quand on modifie un client on n'a pas les mêmes
 * infos que si on crée le client ; je veux dans toutes les agences avoir les
 * mêmes infos pour rectifier si besoin. » La société (SIRET, fonction, code
 * postal, ville) et le conjoint (prénom, nom, e-mail, téléphone) n'existaient
 * qu'à la création, et la modification n'offrait qu'une ligne de texte
 * libre. Les deux formulaires partagent désormais ces blocs.
 */

export const formatPrenom = (text: string) => {
  if (!text) return '';
  return text.toLowerCase().replace(/(^|[\s-])([a-zàáâäãåçèéêëìíîïñòóôöõøùúûüýÿ])/g, (_m, sep, c) => sep + c.toUpperCase());
};

export const formatNom = (text: string) => (text ? text.toUpperCase() : '');

// ---------------------------------------------------------------- Société

export interface Societe {
  name: string;
  siret: string;
  role: string;
  address: string;
  zip: string;
  city: string;
}

export const SOCIETE_VIDE: Societe = { name: '', siret: '', role: '', address: '', zip: '', city: '' };

export function societeDepuisContact(c: Partial<Contact>): Societe {
  return {
    name: c.companyName || '',
    siret: c.companySiret || '',
    role: c.companyRole || '',
    address: c.companyAddress || '',
    zip: c.companyZip || '',
    city: c.companyCity || '',
  };
}

export function societeRenseignee(s: Societe): boolean {
  return Object.values(s).some((v) => v.trim().length > 0);
}

/** Champs `Contact` correspondants (valeurs vidées → chaîne vide, pas undefined,
 *  pour qu'une suppression soit bien enregistrée à la modification). */
export function societeVersContact(s: Societe): Pick<Contact, 'companyName' | 'companySiret' | 'companyRole' | 'companyAddress' | 'companyZip' | 'companyCity'> {
  return {
    companyName: s.name.trim(),
    companySiret: s.siret.trim(),
    companyRole: s.role.trim(),
    companyAddress: s.address.trim(),
    companyZip: s.zip.trim(),
    companyCity: s.city.trim(),
  };
}

interface ChampsSocieteProps {
  valeur: Societe;
  onChange: (s: Societe) => void;
  /** Classes d'un champ de saisie (chaque formulaire garde son habillage). */
  field: string;
  label: string;
}

export function ChampsSociete({ valeur, onChange, field, label }: ChampsSocieteProps) {
  const maj = (cle: keyof Societe) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...valeur, [cle]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={label}>Identité / raison sociale</label>
          <input type="text" placeholder="Nom de la société" value={valeur.name} onChange={maj('name')} className={field} />
        </div>
        <div>
          <label className={label}>SIRET</label>
          <input type="text" placeholder="123 456 789 00012" value={valeur.siret} onChange={maj('siret')} className={`${field} font-mono`} />
        </div>
        <div>
          <label className={label}>Fonction / poste</label>
          <input type="text" placeholder="ex: Gérant" value={valeur.role} onChange={maj('role')} className={field} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-6">
          <label className={label}>Adresse (rue, n°)</label>
          <input type="text" placeholder="12 rue de la République" value={valeur.address} onChange={maj('address')} className={field} />
        </div>
        <div className="sm:col-span-3">
          <label className={label}>Code postal</label>
          <input type="text" inputMode="numeric" placeholder="11100" value={valeur.zip} onChange={maj('zip')} className={`${field} font-mono`} />
        </div>
        <div className="sm:col-span-3">
          <label className={label}>Ville</label>
          <input type="text" placeholder="Narbonne" value={valeur.city} onChange={maj('city')} className={field} />
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        L'adresse (rue, code postal, ville) sert à placer la fiche sur la carte de prospection.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Conjoint

export interface Conjoint {
  prenom: string;
  nom: string;
  email: string;
  tel: string;
}

export const CONJOINT_VIDE: Conjoint = { prenom: '', nom: '', email: '', tel: '' };

export function conjointRenseigne(c: Conjoint): boolean {
  return Object.values(c).some((v) => v.trim().length > 0);
}

/** Format historique de `leads.secondary_contact` : « Prénom NOM (tél) [e-mail] ». */
export function conjointVersTexte(c: Conjoint): string {
  let texte = `${formatPrenom(c.prenom.trim())} ${formatNom(c.nom.trim())}`.trim();
  if (c.tel.trim()) texte += ` (${c.tel.trim()})`;
  if (c.email.trim()) texte += ` [${c.email.trim()}]`;
  return texte.trim();
}

/** Relit le format ci-dessus ; un texte libre atypique reste dans « Prénom ». */
export function conjointDepuisTexte(texte: string | undefined | null): Conjoint {
  if (!texte || !texte.trim()) return { ...CONJOINT_VIDE };
  let reste = texte.trim();
  let email = '';
  let tel = '';
  const mEmail = reste.match(/\[([^\]]*)\]/);
  if (mEmail) { email = mEmail[1].trim(); reste = reste.replace(mEmail[0], ' '); }
  const mTel = reste.match(/\(([^)]*)\)/);
  if (mTel) { tel = mTel[1].trim(); reste = reste.replace(mTel[0], ' '); }
  const mots = reste.trim().split(/\s+/).filter(Boolean);
  // À la création, le nom est écrit en MAJUSCULES et le prénom capitalisé :
  // les mots entièrement en majuscules forment donc le nom.
  const estMaj = (m: string) => m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase();
  const nom = mots.filter(estMaj).join(' ');
  const prenom = mots.filter((m) => !estMaj(m)).join(' ');
  return { prenom, nom, email, tel };
}

interface ChampsConjointProps {
  valeur: Conjoint;
  onChange: (c: Conjoint) => void;
  field: string;
  label: string;
}

export function ChampsConjoint({ valeur, onChange, field, label }: ChampsConjointProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div>
        <label className={label}>Prénom conjoint</label>
        <input
          type="text"
          placeholder="ex: Marie"
          value={valeur.prenom}
          onChange={(e) => onChange({ ...valeur, prenom: formatPrenom(e.target.value) })}
          className={field}
        />
      </div>
      <div>
        <label className={label}>Nom conjoint</label>
        <input
          type="text"
          placeholder="ex: DUPONT"
          value={valeur.nom}
          onChange={(e) => onChange({ ...valeur, nom: formatNom(e.target.value) })}
          className={`${field} font-bold uppercase`}
        />
      </div>
      <div>
        <label className={label}>E-mail conjoint</label>
        <input type="email" placeholder="conjoint@exemple.fr" value={valeur.email} onChange={(e) => onChange({ ...valeur, email: e.target.value })} className={field} />
      </div>
      <div>
        <label className={label}>Téléphone conjoint</label>
        <input type="tel" placeholder="06 00 00 00 00" value={valeur.tel} onChange={(e) => onChange({ ...valeur, tel: e.target.value })} className={`${field} font-mono`} />
      </div>
    </div>
  );
}
