// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from 'lucide-react';
import { FormulaireReservationMateriel } from './FormulaireReservationMateriel';

const base = {
  moisLabel: 'Octobre 2026',
  moisCle: '2026-10',
  sensMois: 1 as const,
  onMoisPrecedent: vi.fn(),
  onMoisSuivant: vi.fn(),
  onAujourdhui: vi.fn(),
  jours: [
    { cle: 'vide-0', jour: null, selectionne: false, passe: false, niveau: null },
    { cle: 'j-6', jour: 6, selectionne: true, passe: false, niveau: 'disponible' as const },
    { cle: 'j-5', jour: 5, selectionne: false, passe: true, niveau: 'indisponible' as const },
  ],
  onChoisirJour: vi.fn(),
  dateChoisie: 'mardi 6 octobre 2026',
  ongletHoraire: 'debut' as const,
  onOngletHoraire: vi.fn(),
  debut: '10:00',
  fin: '11:00',
  creneauxDebut: [
    { debut: '10:00', occupe: false, actif: true },
    { debut: '10:30', occupe: true, actif: false },
  ],
  creneauxFin: [
    { debut: '11:00', occupe: false, actif: true },
    { debut: '11:30', occupe: false, actif: false },
  ],
  plage: '10:00 – 11:00',
  onChoisirDebut: vi.fn(),
  onChoisirFin: vi.fn(),
  reservationsDuJour: [],
  materiels: [
    { id: 'Caméra DJI', label: 'Caméra DJI', detail: 'Visites immersives', tint: 'from-slate-100 to-violet-50', Icon: Camera, selectionne: true },
  ],
  onBasculerMateriel: vi.fn(),
  lieu: '',
  onLieu: vi.fn(),
  projet: '',
  onProjet: vi.fn(),
  mandat: '',
  onMandat: vi.fn(),
  note: '',
  onNote: vi.fn(),
  onAnnuler: vi.fn(),
  onConfirmer: vi.fn(),
  confirmationLabel: 'Confirmer la réservation',
  confirmationDesactivee: false,
  resumes: ['6 octobre', '10:00 – 11:00', 'Caméra DJI', ''] as [string, string, string, string],
};

afterEach(() => cleanup());

describe('formulaire de réservation matériel', () => {
  it('affiche les quatre étapes et confirme', () => {
    const onConfirmer = vi.fn();
    render(
      <FormulaireReservationMateriel
        {...base}
        mobile={false}
        etape={1}
        onEtape={vi.fn()}
        onConfirmer={onConfirmer}
      />,
    );
    expect(screen.getByText('Choisir une date')).toBeTruthy();
    expect(screen.getByText('Choisir un créneau')).toBeTruthy();
    expect(screen.getByText('Matériel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmer la réservation' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(base.onChoisirJour).toHaveBeenCalledWith(6);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la réservation' }));
    expect(onConfirmer).toHaveBeenCalled();
  });

  it('sur mobile, ouvre le créneau au toucher de l’étape', () => {
    const onEtape = vi.fn();
    const { rerender } = render(
      <FormulaireReservationMateriel {...base} mobile etape={1} onEtape={onEtape} />,
    );
    expect(screen.queryByText('10:00')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Choisir un créneau/ }));
    expect(onEtape).toHaveBeenCalledWith(2);
    rerender(<FormulaireReservationMateriel {...base} mobile etape={2} onEtape={onEtape} />);
    expect(screen.getByRole('tab', { name: 'Début' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10:00' })).toBeTruthy();
  });

  it('passe de l’heure de début à l’heure de fin', () => {
    const onChoisirDebut = vi.fn();
    const onChoisirFin = vi.fn();
    const onOngletHoraire = vi.fn();
    const { rerender } = render(
      <FormulaireReservationMateriel
        {...base}
        mobile={false}
        etape={2}
        onEtape={vi.fn()}
        onChoisirDebut={onChoisirDebut}
        onChoisirFin={onChoisirFin}
        onOngletHoraire={onOngletHoraire}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '10:00' }));
    expect(onChoisirDebut).toHaveBeenCalledWith('10:00');
    fireEvent.click(screen.getByRole('tab', { name: 'Fin' }));
    expect(onOngletHoraire).toHaveBeenCalledWith('fin');
    rerender(
      <FormulaireReservationMateriel
        {...base}
        mobile={false}
        etape={2}
        onEtape={vi.fn()}
        ongletHoraire="fin"
        onChoisirDebut={onChoisirDebut}
        onChoisirFin={onChoisirFin}
        onOngletHoraire={onOngletHoraire}
      />,
    );
    expect(screen.getByText('Choisissez l’heure de fin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '11:30' }));
    expect(onChoisirFin).toHaveBeenCalledWith('11:30');
    expect(screen.queryByRole('button', { name: '10:00' })).toBeNull();
  });
});
