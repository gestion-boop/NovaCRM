import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileX, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '@/lib/supabase';
import ConsentDocument from './ConsentDocument';
import ConsentStatusBadge from './ConsentStatusBadge';
import { consentSignedAt, formatFr, type ConsentRecord } from '@/lib/consent';

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  leadId: string;
  leadName?: string | null;
  /** N'afficher qu'un consentement précis (sinon tout l'historique). */
  consentId?: string | null;
}

export function useLeadConsents(leadId: string, enabled = true) {
  return useQuery({
    queryKey: ['consent-forms-full', leadId],
    enabled: enabled && !!leadId,
    queryFn: async () => {
      // NB : la table réelle n'a ni `signed_at`, `valid_until`,
      // `consent_status`, ni `snapshot` (contrairement au schéma de
      // l'ancien CRM) — src/lib/consent.ts calcule déjà tout à partir de
      // `submitted_at` + `data.consentement` quand ces champs sont absents.
      const { data, error } = await supabase
        .from('confidential_questionnaires' as any)
        .select('id, sent_to_email, created_at, created_by, submitted_at, data')
        .eq('lead_id', leadId)
        .eq('kind', 'consent')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ConsentRecord[];
    },
  });
}

export function useConsentSenders(ids: string[]) {
  return useQuery({
    queryKey: ['consent-sender-profiles', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, rsac_number, rc_pro_insurance')
        .in('id', ids);
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((p: any) => [
          p.id,
          {
            name: p.full_name || p.email || 'Utilisateur inconnu',
            rsac: p.rsac_number || null,
            rcPro: p.rc_pro_insurance || null,
          },
        ])
      ) as Record<string, { name: string; rsac: string | null; rcPro: string | null }>;
    },
  });
}

export async function downloadConsentPdf(node: HTMLElement, fileName: string) {
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgHeight = (canvas.height * pageWidth) / canvas.width;
  let heightLeft = imgHeight;
  let position = 0;
  pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight);
    heightLeft -= pageHeight;
  }
  pdf.save(fileName);
}

/**
 * Consultation en lecture seule d'un ou plusieurs consentements signés.
 * Porté depuis l'ancien CRM (ConnectSphere), adapté au style maison
 * NovaSphere (pas de shadcn Dialog — panneau plein écran cohérent avec le
 * reste de l'app) et à notre client Supabase.
 */
export default function ConsentViewDialog({ open, onOpenChange, leadId, leadName, consentId }: Props) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: all = [], isLoading } = useLeadConsents(leadId, open);
  const signed = all.filter((r) => r.submitted_at);
  const items = consentId ? signed.filter((r) => r.id === consentId) : signed;
  const senderIds = Array.from(new Set(items.map((r) => r.created_by).filter(Boolean))) as string[];
  const { data: senders = {} } = useConsentSenders(senderIds);

  if (!open) return null;

  const handleDownload = async (record: ConsentRecord) => {
    const node = refs.current[record.id];
    if (!node) return;
    setDownloading(record.id);
    setDownloadError(null);
    try {
      const name = (leadName ?? 'client').replace(/\s+/g, '_');
      const dateStr = formatFr(consentSignedAt(record)).replace(/\//g, '-');
      await downloadConsentPdf(node, `consentement_${name}_${dateStr}.pdf`);
    } catch (e: any) {
      setDownloadError(e?.message || 'Échec du téléchargement.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => onOpenChange(false)}>
      <div
        className="w-full sm:max-w-3xl bg-[#0a1e20] border border-[#144447]/60 sm:rounded-3xl rounded-t-3xl p-6 max-h-[92vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#F7BC5F]" />
            Questionnaire de consentement {leadName ? `— ${leadName}` : ''}
          </h2>
          <button onClick={() => onOpenChange(false)} className="p-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="flex items-center gap-2 text-xs text-slate-400 mb-4">
          <Lock className="w-3.5 h-3.5" />
          Document signé, non modifiable. Pour changer les autorisations, envoyez un nouveau consentement.
        </p>

        {downloadError && <p className="text-xs text-rose-400 mb-3">{downloadError}</p>}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-[#144447]/60 bg-[#07191b] p-10 text-center space-y-3">
            <FileX className="w-10 h-10 text-slate-500 mx-auto" />
            <h3 className="text-base font-semibold text-white">Aucun consentement signé</h3>
            <p className="text-sm text-slate-400">
              Le client n'a pas encore complété ni signé son consentement.
            </p>
            <div className="flex justify-center pt-1">
              <ConsentStatusBadge status="pending" />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {items.map((record) => (
              <article key={record.id} className="rounded-2xl border border-[#144447]/60 bg-[#07191b] p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <ConsentStatusBadge record={record} size="md" />
                  <button
                    onClick={() => handleDownload(record)}
                    disabled={downloading === record.id}
                    className="px-3 py-1.5 rounded-xl border border-[#144447]/60 bg-black/20 text-xs font-bold text-slate-200 flex items-center gap-2 hover:bg-black/30 disabled:opacity-50"
                  >
                    {downloading === record.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Télécharger le PDF
                  </button>
                </div>
                <div
                  ref={(el) => {
                    refs.current[record.id] = el;
                  }}
                  className="rounded-xl overflow-hidden"
                >
                  <ConsentDocument
                    record={record}
                    senderName={record.created_by ? senders[record.created_by]?.name : null}
                    senderRsac={record.created_by ? senders[record.created_by]?.rsac : null}
                    senderRcPro={record.created_by ? senders[record.created_by]?.rcPro : null}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
