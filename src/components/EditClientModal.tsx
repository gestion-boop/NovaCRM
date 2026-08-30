import React, { useEffect, useState } from 'react';
import { X, Save, Pencil } from 'lucide-react';
import { Contact, AGENCIES } from '@/types';
import { supabase } from '@/lib/supabase';
import { htDepuisTtc } from '@/lib/utils';
import { useAssignableUsers } from '@/hooks/useAssignableUsers';

interface Props {
  client: Contact;
  onClose: () => void;
  onSave: (updates: Partial<Contact>) => Promise<void>;
}

/**
 * Modification d'une fiche client.
 *
 * Demandé : « une fois le client créé, je veux pouvoir tout modifier comme si
 * je l'inscrivais à nouveau. » Cette fenêtre ne reprenait que 8 des 16 champs
 * du formulaire de création — structure, type de client, type de contact,
 * pipeline, honoraires, agent lié et deuxième personne n'étaient modifiables
 * nulle part, ou seulement en passant par d'autres écrans. Elle couvre
 * désormais exactement le même périmètre que la création.
 */
export default function EditClientModal({ client, onClose, onSave }: Props) {
  const [name, setName] = useState(client.name || '');
  const [email, setEmail] = useState(client.email || '');
  const [phone, setPhone] = useState(client.phone || '');
  const [agencyId, setAgencyId] = useState(client.agencyId || '');
  const [clientType, setClientType] = useState(client.clientType || 'Acheteur');
  const [contactType, setContactType] = useState(client.contactType || 'Particulier');
  const [pipeline, setPipeline] = useState(client.pipeline || '');
  // Valeurs de l'enum Postgres `lead_temperature` (froid/tiede/chaud), comme
  // à la création : un libellé descriptif y était rejeté par la base sans
  // aucun message (ticket #119).
  const [statutLead, setStatutLead] = useState(() => {
    const raw = (client.statutLead || client.status || 'froid').toLowerCase();
    if (raw.startsWith('chaud')) return 'chaud';
    if (raw.startsWith('ti')) return 'tiede';
    return 'froid';
  });
  const [budgetMax, setBudgetMax] = useState(client.budgetMax ? String(client.budgetMax) : '');
  // Demandé pour ImmoSphera : « au lieu de honoraires, mets commission agence
  // et commission conseiller immobilier ». Les montants déjà saisis dans
  // Honoraires sont ceux de l'agence, et déjà HT — ils ne sont pas convertis.
  const [honoraires, setHonoraires] = useState(client.honoraires ? String(client.honoraires) : '');
  const [advisorCommission, setAdvisorCommission] = useState(
    client.advisorCommissionTtc ? String(client.advisorCommissionTtc) : ''
  );
  const [mandateNumber, setMandateNumber] = useState(client.mandateNumber || '');
  const [secteur, setSecteur] = useState(client.secteur || '');
  const [typeBien, setTypeBien] = useState(client.typeBien || client.projectType || '');
  const [assignedTo, setAssignedTo] = useState(client.assignedTo || '');
  const [coBorrower, setCoBorrower] = useState(client.coBorrower || '');
  const [comments, setComments] = useState(client.comments || '');
  const [saving, setSaving] = useState(false);
  // Signalé : « je ne peux pas l'enregistrer ». L'enregistrement échouait
  // sans rien afficher — `onSave` rejetait, le `finally` remettait juste le
  // bouton actif, et l'utilisateur n'avait aucun moyen de savoir ce que la
  // base reprochait. Même classe de bug que les valeurs silencieusement
  // remplacées par null ailleurs dans cet écran : ce qui échoue doit se voir.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Collaborateurs réellement inscrits, restreints à la structure choisie —
  // la liste suit donc le champ « Structure » ci-dessous.
  const assignableUsers = useAssignableUsers(agencyId);

  // Pipelines de la structure choisie. Les valeurs sont les identifiants
  // réels : `pipeline_id` passe par un filtre UUID côté enregistrement, un
  // nom y serait silencieusement remplacé par null.
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('pipelines').select('id, name, agency_id').order('name');
      if (cancelled) return;
      const rows = (data || [])
        .filter((p: { agency_id: string }) => !agencyId || p.agency_id === agencyId)
        .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }));
      setPipelines(rows);
      setPipeline((current) => (current && !rows.some((p) => p.id === current) ? '' : current));
    })().catch(() => { if (!cancelled) setPipelines([]); });
    return () => { cancelled = true; };
  }, [agencyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        agencyId,
        clientType,
        contactType,
        pipeline,
        statutLead,
        budgetMax: budgetMax === '' ? undefined : Number(budgetMax),
        honoraires: honoraires === '' ? undefined : Number(honoraires),
        advisorCommissionTtc: advisorCommission === '' ? undefined : Number(advisorCommission),
        mandateNumber,
        secteur: secteur.trim(),
        typeBien: typeBien.trim(),
        assignedTo,
        coBorrower: coBorrower.trim(),
        comments: comments.trim(),
      });
      onClose();
    } catch (error) {
      const message = (error as { message?: string })?.message || String(error);
      console.error('Enregistrement de la fiche client refusé :', error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]';
  const label = 'block text-xs font-bold text-slate-300 mb-1';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-2xl w-full p-6 text-white shadow-2xl relative animate-scale-up max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
              <Pencil className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Modifier la fiche</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto custom-scrollbar pr-1">
          <div>
            <label className={label}>Nom complet</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Téléphone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Structure / Agence</label>
              <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)} className={field}>
                {AGENCIES.filter((a) => a.id !== 'all').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Utilisateur / agent lié</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={field}>
                <option value="">— Non attribué —</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Type</label>
              <select value={clientType} onChange={(e) => setClientType(e.target.value)} className={field}>
                <option value="Acheteur">Acheteur</option>
                <option value="Vendeur">Vendeur</option>
                <option value="Locataire">Locataire</option>
                <option value="Investisseur">Investisseur</option>
              </select>
            </div>
            <div>
              <label className={label}>Type de contact</label>
              <select value={contactType} onChange={(e) => setContactType(e.target.value)} className={field}>
                <option value="Particulier">Particulier</option>
                <option value="Professionnel">Professionnel</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Pipeline</label>
              <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className={field}>
                <option value="">Aucun (libre)</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Statut</label>
              <select value={statutLead} onChange={(e) => setStatutLead(e.target.value)} className={field}>
                <option value="froid">🔵 Froid - Peu intéressé</option>
                <option value="tiede">🟠 Tiède - Intérêt modéré</option>
                <option value="chaud">🔴 Chaud - Très intéressé</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Budget max (€)</label>
              <input type="number" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Numéro de mandat</label>
              <input value={mandateNumber} onChange={(e) => setMandateNumber(e.target.value)} className={field} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Commission agence (€ HT)</label>
              <input type="number" value={honoraires} onChange={(e) => setHonoraires(e.target.value)} className={field} />
              <p className="mt-1 text-[10px] text-slate-500">Chiffre d'affaires de l'agence. C'est ce montant qui alimente les statistiques.</p>
            </div>
            <div>
              <label className={label}>Commission conseiller immobilier (€ TTC)</label>
              <input type="number" value={advisorCommission} onChange={(e) => setAdvisorCommission(e.target.value)} className={field} />
              <p className="mt-1 text-[10px] text-slate-500">
                {advisorCommission !== '' && !Number.isNaN(Number(advisorCommission))
                  ? `Soit ${htDepuisTtc(Number(advisorCommission)).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} € HT`
                  : 'Saisir le montant TTC ; le HT est calculé automatiquement.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Secteur</label>
              <input value={secteur} onChange={(e) => setSecteur(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Type de bien / projet</label>
              <input value={typeBien} onChange={(e) => setTypeBien(e.target.value)} className={field} />
            </div>
          </div>

          <div>
            <label className={label}>Deuxième personne (conjoint, co-contact)</label>
            <input
              value={coBorrower}
              onChange={(e) => setCoBorrower(e.target.value)}
              placeholder="Nom, téléphone, e-mail…"
              className={`${field} placeholder-slate-500`}
            />
          </div>

          <div>
            <label className={label}>Commentaires</label>
            <textarea rows={4} value={comments} onChange={(e) => setComments(e.target.value)} className={`${field} resize-y`} />
          </div>

          {saveError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-xs text-rose-200">
              <b className="block mb-1">Enregistrement refusé</b>
              {saveError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-slate-300 hover:text-white text-xs font-bold">
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
