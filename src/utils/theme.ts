function hexToRgb(hex: string): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return '229, 184, 66';
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r}, ${g}, ${b}`;
}

function getLuminanceForeground(hex: string): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return '#061719';
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 165 ? '#061719' : '#ffffff';
}

export function updateCssAccentVars(color: string) {
  if (!color) return;
  const root = document.documentElement;
  root.style.setProperty('--primary', color);
  root.style.setProperty('--accent-color', color);
  root.style.setProperty('--accent-color-rgb', hexToRgb(color));
  root.style.setProperty('--accent-text-color', getLuminanceForeground(color));
}

// Couleur du calendrier (Agenda) — indépendante de la couleur d'accent
// générale de l'interface, pour pouvoir distinguer l'agenda visuellement
// du reste du CRM si on le souhaite.
export function updateCssCalendarAccentVars(color: string) {
  if (!color) return;
  const root = document.documentElement;
  root.style.setProperty('--calendar-accent-color', color);
  root.style.setProperty('--calendar-accent-color-rgb', hexToRgb(color));
  root.style.setProperty('--calendar-accent-text-color', getLuminanceForeground(color));
}
