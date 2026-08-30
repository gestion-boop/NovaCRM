import { forwardRef } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  CONSENT_STATUS_META,
  computeConsentStatus,
  consentPermissions,
  consentSignedAt,
  consentValidUntil,
  formatFr,
  isConsentExpired,
  type ConsentRecord,
} from '@/lib/consent';
import { cn } from '@/lib/utils';

interface Props {
  record: ConsentRecord;
  /** Nom du conseiller ayant réalisé le consentement. */
  senderName?: string | null;
  /** Numéro RSAC du conseiller (repli si absent du snapshot signé). */
  senderRsac?: string | null;
  /** Assurance RC Pro du conseiller (repli si absente du snapshot signé). */
  senderRcPro?: string | null;
}

/**
 * Version figée du consentement signé : identité, réponses, autorisations,
 * statut, signature, date de signature et date de fin de validité.
 * Porté depuis l'ancien CRM (ConnectSphere) — le contenu provient
 * exclusivement du snapshot enregistré à la signature.
 */
const ConsentDocument = forwardRef<HTMLDivElement, Props>(({ record, senderName, senderRsac, senderRcPro }, ref) => {
  const snap = record.snapshot ?? {};
  const c = (record.data?.consentement ?? {}) as any;
  const status = computeConsentStatus(record);
  const expired = isConsentExpired(record);
  const perms = consentPermissions(record);
  const signedAt = consentSignedAt(record);
  const validUntil = consentValidUntil(record);
  const meta = CONSENT_STATUS_META[status];
  const advisorName = senderName ?? snap.broker_name ?? '—';
  const advisorEmail = snap.broker_email ?? '';
  const advisorRole = snap.broker_role ?? 'Conseiller Immobilier';
  const advisorRsac = snap.broker_rsac ?? senderRsac ?? '';
  const advisorRcPro = snap.broker_rc_pro ?? senderRcPro ?? '';

  const identity = [
    ['Nom et Prénom', [c.civilite, c.nom_prenom || snap.lead_full_name].filter(Boolean).join(' ')],
    ['Téléphone', c.telephone || snap.lead_phone],
    ['E-Mail', c.email || snap.lead_email || record.sent_to_email],
  ] as const;

  return (
    <div ref={ref} className="space-y-5 bg-white text-slate-900 p-1">
      <div className="text-center space-y-1">
        <img src="/Logo Immosphera.png" alt="Logo agence ImmoSphera" className="h-14 w-auto mx-auto object-contain mb-2" />
        <h2 className="text-lg font-bold uppercase">Consentement au démarchage téléphonique</h2>
        <p className="text-sm font-semibold underline">Agence immobilière ImmoSphera</p>
      </div>

      {/* Case mise en avant : identité du conseiller qui a envoyé le document */}
      <div className="rounded-xl border-2 border-[#F7BC5F]/40 bg-[#F7BC5F]/5 p-4 text-sm sm:text-base text-center">
        Professionnel représenté par <span className="font-semibold">{advisorName}</span> EI, agent
        commercial{advisorRsac ? <>, RSAC n° {advisorRsac}</> : null}.
      </div>

      {/* Statut final, très visible */}
      <div
        className={cn('rounded-xl border-2 px-4 py-3 text-center font-black uppercase tracking-wide', meta.className)}
      >
        {meta.label}
      </div>
      {expired && (
        <p className="text-center text-sm font-semibold text-red-600">
          CONSENTEMENT EXPIRÉ — un nouveau consentement doit être réalisé.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {identity.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-medium text-slate-500">{label}</div>
            <div className="text-sm break-words">{value || '—'}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-bold mb-2">Services et consentement</h3>
        {c.refus_demarchage === true && (
          <p className="text-sm font-semibold text-red-600 mb-2">
            Le consommateur refuse d'être contacté(e) par téléphone à des fins de prospection commerciale.
          </p>
        )}
        {perms.map((p) => (
          <div key={p.key} className="flex items-start gap-3 py-2">
            {p.accepted ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            )}
            <div className="text-sm">
              <span className={p.accepted ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                {p.accepted ? 'Accepté' : 'Refusé'}
              </span>
              <span className="block text-slate-500">{p.label}</span>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-slate-500 mt-2">
          Retrait de l'accord possible à tout moment en contactant {advisorName}
          {advisorEmail ? ` à l'adresse : ${advisorEmail}` : '.'}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1 text-sm">
        <h3 className="text-sm font-bold mb-1">Signature</h3>
        <p>
          <span className="text-slate-500">Signé par : </span>
          <span className="font-semibold">{c.nom_prenom || snap.lead_full_name || '—'}</span>
        </p>
        <p>
          <span className="text-slate-500">Signé le : </span>
          <span className="font-semibold">{formatFr(signedAt)}</span>
        </p>
        <p>
          <span className="text-slate-500">Valable jusqu'au : </span>
          <span className={cn('font-semibold', expired && 'text-red-600')}>{formatFr(validUntil)}</span>
        </p>
        {c.date && (
          <p className="text-xs text-slate-500">
            Fait le {formatFr(new Date(c.date))}
            {c.ville ? ` à ${c.ville}` : ''}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-slate-200 text-xs text-slate-500 space-y-0.5">
        <div>
          Consentement réalisé par :{' '}
          <span className="font-medium text-slate-900">
            {advisorName} — {advisorRole} de l'agence immobilière ImmoSphera
          </span>
        </div>
        {advisorRsac && <div>RSAC : {advisorRsac}</div>}
        {advisorRcPro && <div>Assurance RC Pro : {advisorRcPro}</div>}
        {record.created_at && (
          <div>
            Envoyé le {new Date(record.created_at).toLocaleString('fr-FR')}
            {record.sent_to_email ? ` à ${record.sent_to_email}` : ''}
          </div>
        )}
        <div>Référence du document : {record.id}</div>
      </div>
    </div>
  );
});
ConsentDocument.displayName = 'ConsentDocument';

export default ConsentDocument;
