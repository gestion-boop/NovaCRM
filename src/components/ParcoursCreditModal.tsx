import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight, ClipboardCheck, AlertTriangle, Star, CheckCircle2, Target, Landmark } from 'lucide-react';

interface Slide {
  title: string;
  subtitle: string;
  render: () => React.ReactNode;
}

const Box = ({ children, tone = 'gold' }: { children: React.ReactNode; tone?: 'gold' | 'green' }) => (
  <div className={`rounded-2xl border p-5 ${tone === 'green' ? 'border-emerald-500/50' : 'border-[#F7BC5F]/50'}`}>
    {children}
  </div>
);

const Callout = ({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-[#F7BC5F]/50 px-5 py-4">
    <Icon className="w-6 h-6 text-[#F9C977] shrink-0" />
    <p className="text-sm text-slate-100">{children}</p>
  </div>
);

const SLIDES: Slide[] = [
  {
    title: 'Parcours client en banque',
    subtitle: 'Formation simple pour les agents immobiliers',
    render: () => (
      <div className="space-y-6">
        <p className="text-slate-300 text-sm">
          Objectif : comprendre les grandes étapes sans entrer dans toute la mécanique bancaire.
        </p>
        <div className="rounded-2xl border border-[#F7BC5F]/50 px-6 py-5 text-center">
          <p className="text-[#F9C977] font-bold text-sm flex flex-wrap items-center justify-center gap-2">
            Simulation <ChevronRight className="w-4 h-4" /> Dossier <ChevronRight className="w-4 h-4" /> Caution / Hypothèque
            <ChevronRight className="w-4 h-4" /> Assurance <ChevronRight className="w-4 h-4" /> Offres <ChevronRight className="w-4 h-4" /> Fonds
          </p>
        </div>
      </div>
    ),
  },
  {
    title: '1. Banque, simulation, dossier',
    subtitle: 'Le client démarre son parcours bancaire',
    render: () => (
      <div className="space-y-4">
        {[
          'Le client se rend à la banque',
          'La banque réalise une simulation de financement',
          'Le client dépose son dossier complet',
        ].map((step, i) => (
          <div key={step} className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-full bg-[#F7BC5F] text-slate-950 font-bold flex items-center justify-center shrink-0">{i + 1}</div>
            <p className="text-white font-semibold text-sm">{step}</p>
          </div>
        ))}
        <Callout icon={ClipboardCheck}>
          <span className="font-bold text-[#F9C977]">Pour l'agent immobilier : </span>
          vérifier que le dossier est bien lancé et que la simulation est cohérente.
        </Callout>
      </div>
    ),
  },
  {
    title: '2. Étude de la caution',
    subtitle: "L'organisme de garantie analyse le dossier",
    render: () => (
      <div className="space-y-5">
        <p className="text-white font-semibold text-sm">Après le dépôt du dossier, la banque l'envoie à la caution.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Box tone="green">
            <p className="text-emerald-400 font-bold text-sm mb-1">Si la caution accepte</p>
            <p className="text-slate-300 text-sm">Le dossier continue.</p>
          </Box>
          <Box>
            <p className="text-[#F9C977] font-bold text-sm mb-1">Si la caution refuse</p>
            <p className="text-slate-300 text-sm">Une hypothèque peut être envisagée.</p>
          </Box>
        </div>
        <Callout icon={Star}>
          <span className="font-bold text-[#F9C977]">Point clé : </span>
          un refus de caution ne signifie pas forcément la fin du financement.
        </Callout>
      </div>
    ),
  },
  {
    title: '3. Assurance puis offres de prêt',
    subtitle: 'Les dernières étapes avant réception des offres',
    render: () => (
      <div className="space-y-4">
        {[
          { t: 'Assurance de crédit', d: "Le client réalise les démarches d'assurance emprunteur." },
          { t: 'Validation du dossier', d: "La banque finalise le dossier avec l'assurance." },
          { t: 'Édition des offres', d: 'Le dossier part en édition des offres de prêt.' },
        ].map((row, i) => (
          <div key={row.t} className="rounded-2xl border border-[#F7BC5F]/50 p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg border-2 border-[#F7BC5F] text-[#F9C977] font-bold flex items-center justify-center shrink-0">{i + 1}</div>
            <div>
              <p className="text-[#F9C977] font-bold text-sm">{row.t}</p>
              <p className="text-slate-300 text-xs mt-0.5">{row.d}</p>
            </div>
          </div>
        ))}
        <Callout icon={CheckCircle2}>
          <span className="font-bold text-[#F9C977]">Message simple : </span>
          sans assurance finalisée, les offres de prêt ne sortent pas.
        </Callout>
      </div>
    ),
  },
  {
    title: '4. Réception des offres : les délais',
    subtitle: 'Le point le plus important à expliquer aux clients',
    render: () => (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Box>
            <p className="text-3xl font-extrabold text-[#F9C977]">11 jours</p>
            <p className="text-white font-bold text-sm mt-1">Délai de réflexion</p>
            <p className="text-slate-400 text-xs mt-1">Il démarre seulement quand les clients accusent réception des offres.</p>
          </Box>
          <Box>
            <p className="text-3xl font-extrabold text-[#F9C977]">+ 2 jours</p>
            <p className="text-white font-bold text-sm mt-1">Mise à disposition</p>
            <p className="text-slate-400 text-xs mt-1">Les fonds peuvent ensuite être demandés et disponibles selon la banque.</p>
          </Box>
        </div>
        <Callout icon={ClipboardCheck}>
          <span className="font-bold text-[#F9C977]">À retenir : </span>
          11 jours + 2 jours après accusé de réception des offres.
        </Callout>
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/50 px-5 py-4">
          <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
          <p className="text-sm text-slate-100">
            <span className="font-bold text-rose-400">Vigilance apport : </span>
            identifier où se trouve l'argent et le délai de déblocage éventuel.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: 'Le parcours en 6 étapes',
    subtitle: 'La logique à retenir pour suivre un dossier client',
    render: () => (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {[
            { n: 1, t: 'Banque', d: 'Rendez-vous + simulation' },
            { n: 2, t: 'Dossier', d: 'Dépôt du dossier' },
            { n: 3, t: 'Caution', d: 'Accord ou refus' },
            { n: 4, t: 'Assurance', d: 'Assurance emprunteur' },
            { n: 5, t: 'Offres', d: 'Édition des offres' },
            { n: 6, t: 'Fonds', d: 'Disponibilité des fonds' },
          ].map((s) => (
            <div key={s.n} className="text-center space-y-2">
              <div className="w-10 h-10 mx-auto rounded-full border-2 border-[#F7BC5F] text-[#F9C977] font-bold flex items-center justify-center">{s.n}</div>
              <p className="text-[#F9C977] font-bold text-xs">{s.t}</p>
              <p className="text-slate-400 text-[11px]">{s.d}</p>
            </div>
          ))}
        </div>
        <Callout icon={Target}>
          <span className="font-bold text-[#F9C977]">Une vision simple : </span>
          le dossier avance étape par étape, avec des délais à anticiper.
        </Callout>
      </div>
    ),
  },
];

export default function ParcoursCreditModal({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#07191b] border border-[#1b4e52] rounded-3xl max-w-2xl w-full p-8 text-white shadow-2xl relative animate-scale-up max-h-[88vh] flex flex-col"
      >
        <div className="flex items-start justify-between mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white">{slide.title}</h2>
              <p className="text-xs text-slate-400">{slide.subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">{slide.render()}</div>

        <div className="flex items-center justify-between pt-6 mt-2 border-t border-[#144447]/60 shrink-0">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="p-2.5 rounded-xl bg-[#0a1e20] border border-[#144447]/60 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={`w-2 h-2 rounded-full transition-all ${i === index ? 'bg-[#F7BC5F] w-5' : 'bg-[#144447]'}`}
              />
            ))}
          </div>
          <button
            onClick={() => setIndex((i) => Math.min(SLIDES.length - 1, i + 1))}
            disabled={index === SLIDES.length - 1}
            className="p-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
