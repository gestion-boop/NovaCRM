# -*- coding: utf-8 -*-
"""Génère guide.html (A4 paysage, une page par étape de la visite guidée)
puis le PDF via Chromium. Les captures vont dans ./captures/etape-NN.(png|jpg)."""
import base64, glob, html, os, subprocess, sys

ICI = os.path.dirname(os.path.abspath(__file__))
CAPTURES = os.path.join(ICI, 'captures')

# Les 22 étapes, telles que définies dans src/App.tsx (PRODUCT_TOUR_STEPS).
ETAPES = [
    ('Bienvenue sur Nova CRM 👋', "Petit tour de 3 minutes. Cliquez sur « Suivant » pour avancer, ou fermez à tout moment — vous pourrez toujours le relancer depuis le Guide.", None, False),
    ('Le bouton Menu', "Tous les onglets de l'application se trouvent ici, dans un panneau qui coulisse depuis la gauche. On l'ouvre pour la suite de la visite.", "Bouton « Menu », en haut à gauche de l'écran.", False),
    ('Accueil', "Votre tableau de bord : raccourcis personnalisables (« Mes espaces »), agenda du jour et priorités en un coup d'œil.", "Panneau Menu → onglet Accueil.", False),
    ('Clients', "Tous vos contacts et leads. Chaque fiche centralise rendez-vous, notes, documents et e-mails échangés.", "Panneau Menu → onglet Clients.", False),
    ('Agenda', "Vos rendez-vous, synchronisés avec Google Agenda.", "Panneau Menu → onglet Agenda.", False),
    ('Chat', "Messagerie interne : conversations directes et canaux de projet avec vos collègues.", "Panneau Menu → onglet Chat.", False),
    ('Nova', "Votre assistant : créez des contacts, des tâches, des notes ou posez-lui une question, à la voix ou au texte.", "Panneau Menu → onglet Nova.", False),
    ('Paramètres', "Votre profil, vos préférences, et — si vous êtes administrateur — la gestion de l'équipe.", "Panneau Menu → onglet Paramètres.", False),
    ('Recherche rapide', "Retrouvez un client par son nom sans quitter votre écran.", "Barre de recherche, au centre de la barre du haut.", False),
    ('Mode jour / nuit', "Basculez l'interface entre thème sombre et clair.", "Icône soleil, à droite de la barre du haut.", False),
    ('Plein écran', "Masque les barres du navigateur pour plus de confort.", "Icône plein écran, à droite de la barre du haut.", False),
    ('Tutoriel', "Rouvre ce guide et son quiz à tout moment.", "Bouton « Tutoriel », à droite de la barre du haut.", False),
    ('Votre profil', "Accès direct à votre fiche personnelle dans les Paramètres.", "Votre photo, à droite de la barre du haut.", False),
    ('Paramètres', "Préférences, équipe, notifications, automatisations...", "Roue crantée, tout à droite de la barre du haut.", False),
    ('Notifications', "La clochette centralise tout : messages, rappels, réservations, annonces.", "Clochette, dans la barre du haut.", False),
    ('À vous de jouer', "Créez votre tout premier contact : cliquez sur ce bouton pour ouvrir le formulaire.", "Bouton doré « + Nouveau lead », en haut à droite.", True),
    ('Prénom', "Commencez par le prénom, ex : Jean-Pierre.", "Fenêtre « Nouveau lead » → champ Prénom.", False),
    ('Nom', "Puis le nom de famille — c'est le seul champ obligatoire.", "Fenêtre « Nouveau lead » → champ Nom.", False),
    ('Email', "Pour cet essai, vous pouvez mettre nova@crm.fr.", "Fenêtre « Nouveau lead » → champ Email.", False),
    ('Téléphone', "Et pour le téléphone, par exemple 0601020304.", "Fenêtre « Nouveau lead » → champ Téléphone.", False),
    ('Validez', "Cliquez ici pour enregistrer votre premier contact.", "Bouton de validation, en bas de la fenêtre « Nouveau lead ».", True),
    ('La fiche client', "Bravo ! Voici la fiche de votre nouveau contact : rendez-vous, notes, e-mails et documents, tout est centralisé ici. C'est tout pour la visite, bon travail !", "Fiche client → onglets Rendez-vous, Notes, Documents, E-mails…", False),
]
CHAPITRES = [
    ('Se repérer', 1, 8),
    ('La barre du haut', 9, 15),
    ('Votre premier contact', 16, 21),
    ('La fiche client', 22, 22),
]
def chapitre_de(n):
    for nom, a, b in CHAPITRES:
        if a <= n <= b: return nom
    return ''

def zoom(n):
    f = os.path.join(CAPTURES, f'loupe-{n:02d}.jpg')
    if not os.path.exists(f): return None
    with open(f, 'rb') as fh:
        return "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode('ascii')

def capture(n):
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        for f in glob.glob(os.path.join(CAPTURES, f'etape-{n:02d}.{ext}')) + glob.glob(os.path.join(CAPTURES, f'etape-{n}.{ext}')):
            with open(f, 'rb') as fh:
                mime = 'image/png' if ext == 'png' else ('image/webp' if ext == 'webp' else 'image/jpeg')
                return f"data:{mime};base64," + base64.b64encode(fh.read()).decode('ascii')
    return None

e = html.escape
CSS = """
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: 297mm 210mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif; color: #1c2430; }
.page { width: 297mm; height: 210mm; position: relative; overflow: hidden; background: #f4f5f7; page-break-after: always; break-after: page; }
.page.sombre { background: #07191b; color: #fff; }
.entete { height: 16mm; background: #0d2a2e; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 14mm; border-bottom: 1.2mm solid #F7BC5F; }
.entete .marque { font-weight: 700; font-size: 11pt; letter-spacing: .02em; }
.entete .marque span { color: #F7BC5F; }
.entete .chapitre { font-size: 9.5pt; color: #cfd8dc; text-transform: uppercase; letter-spacing: .12em; }
.corps { position: absolute; top: 16mm; left: 0; right: 0; bottom: 12mm; padding: 9mm 14mm 6mm; display: flex; gap: 8mm; align-items: flex-start; }
.cadre { width: 172mm; height: 107.5mm; border-radius: 4mm; background: #0b1416; box-shadow: 0 6px 22px rgba(0,0,0,.28); overflow: hidden; border: 0.6mm solid #1d3b40; display: flex; align-items: center; justify-content: center; flex: none; }
.cadre img { width: 100%; height: 100%; object-fit: contain; display: block; }
.cadre .attente { color: #6f8a8f; font-size: 10.5pt; text-align: center; padding: 10mm; line-height: 1.5; border: 0.5mm dashed #2c5a60; border-radius: 3mm; margin: 8mm; }
.colonne { flex: 1; display: flex; flex-direction: column; gap: 5mm; min-width: 0; }
.carte { background: #0b3437; border: 0.7mm solid #F7BC5F; border-radius: 4mm; padding: 6mm 7mm; color: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.25); }
.carte .num { color: #F7BC5F; font-weight: 700; font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; }
.carte h2 { margin: 2mm 0 3mm; font-size: 17pt; line-height: 1.15; }
.carte p { margin: 0; font-size: 11pt; line-height: 1.5; color: #e6eeef; }
.carte .points { margin-top: 4mm; display: flex; gap: 1.4mm; flex-wrap: wrap; }
.carte .points i { width: 1.8mm; height: 1.8mm; border-radius: 50%; background: #3c6266; display: block; }
.carte .points i.actif { background: #F7BC5F; }
.ou { background: #fff; border-left: 1.4mm solid #F7BC5F; border-radius: 2.5mm; padding: 4mm 5mm; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.ou .titre { font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; font-weight: 700; margin-bottom: 1.5mm; }
.ou .texte { font-size: 10.5pt; line-height: 1.45; color: #1c2430; }
.zoom { background: #fff; border-radius: 2.5mm; padding: 3mm 3mm 3mm; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.zoom .titre { font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; font-weight: 700; margin-bottom: 2mm; }
.zoom img { width: 100%; display: block; border-radius: 2mm; border: 0.5mm solid #F7BC5F; }
.interactif { display: inline-flex; align-items: center; gap: 2mm; background: #fff4d6; color: #7a4d00; border: 0.4mm solid #F7BC5F; border-radius: 99mm; padding: 1.6mm 3.5mm; font-size: 9pt; font-weight: 700; }
.pied { position: absolute; left: 14mm; right: 14mm; bottom: 4mm; height: 6mm; display: flex; align-items: center; justify-content: space-between; font-size: 8.5pt; color: #6b7280; }
.pied b { color: #0d2a2e; }
/* Couverture */
.couv { padding: 24mm 22mm; height: 100%; display: flex; flex-direction: column; justify-content: space-between; background: radial-gradient(120% 90% at 85% 10%, #134d52 0%, #0a2a2e 45%, #07191b 100%); }
.couv .sur { color: #F7BC5F; font-size: 11pt; letter-spacing: .22em; text-transform: uppercase; font-weight: 700; }
.couv h1 { font-size: 42pt; margin: 6mm 0 3mm; line-height: 1.05; }
.couv .sous { font-size: 16pt; color: #cfe3e5; }
.couv .bas { display: flex; justify-content: space-between; align-items: flex-end; color: #9fb7ba; font-size: 10pt; }
.couv .pastille { display: inline-block; background: #F7BC5F; color: #07191b; font-weight: 700; padding: 2.5mm 5mm; border-radius: 99mm; font-size: 10pt; }
/* Sommaire */
.som { padding: 12mm 18mm 0; }
.som h1 { font-size: 22pt; margin: 0 0 6mm; color: #0d2a2e; }
.som .grille { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm 12mm; }
.som .chap { background: #fff; border-radius: 3mm; padding: 4mm 5mm; box-shadow: 0 2px 8px rgba(0,0,0,.06); border-top: 1.2mm solid #F7BC5F; }
.som .chap h3 { margin: 0 0 2mm; font-size: 12pt; color: #0d2a2e; }
.som .chap ol { margin: 0; padding-left: 6mm; font-size: 9.6pt; line-height: 1.55; color: #374151; }
.som .chap li span { color: #9ca3af; }
"""

def page_etape(n, titre, texte, ou, interactif):
    img = capture(n)
    if img:
        visuel = f'<img src="{img}" alt="Capture de l\'étape {n}">'
    else:
        visuel = f'<div class="attente">Capture d\'écran de l\'étape {n}<br>à insérer</div>'
    points = ''.join(f'<i class="{"actif" if i == n else ""}"></i>' for i in range(1, 23))
    bloc_ou = f'<div class="ou"><div class="titre">Où le trouver</div><div class="texte">{e(ou)}</div></div>' if ou else ''
    z = zoom(n)
    bloc_zoom = f'<div class="zoom"><div class="titre">Zoom sur l\'élément</div><img src="{z}" alt="Zoom sur l\'élément de l\'étape {n}"></div>' if z else ''
    bloc_inter = '<div><span class="interactif">✋ Étape interactive : l\'application attend votre action</span></div>' if interactif else ''
    return f"""
<section class="page">
  <div class="entete"><div class="marque">Nova <span>CRM</span> · Guide de prise en main</div><div class="chapitre">{e(chapitre_de(n))}</div></div>
  <div class="corps">
    <div class="cadre">{visuel}</div>
    <div class="colonne">
      <div class="carte"><div class="num">Étape {n} / 22</div><h2>{e(titre)}</h2><p>{e(texte)}</p><div class="points">{points}</div></div>
      {bloc_ou}
      {bloc_zoom}
      {bloc_inter}
    </div>
  </div>
  <div class="pied"><span><b>ImmoSphera Académy</b> · Visite guidée de Nova CRM</span><span>Page {n + 2}</span></div>
</section>"""

def page_couverture():
    return """
<section class="page sombre"><div class="couv">
  <div><div class="sur">ImmoSphera Académy</div><h1>Nova CRM<br>Guide de prise en main</h1><div class="sous">La visite guidée, étape par étape, avec les écrans de l'application.</div></div>
  <div class="bas"><div><span class="pastille">22 étapes · 3 minutes dans l'application</span></div><div>Édition septembre 2026</div></div>
</div></section>"""

def page_sommaire():
    blocs = []
    for nom, a, b in CHAPITRES:
        items = ''.join(f'<li>{e(ETAPES[i-1][0])} <span>· p. {i + 2}</span></li>' for i in range(a, b + 1))
        blocs.append(f'<div class="chap"><h3>{e(nom)}</h3><ol start="{a}">{items}</ol></div>')
    return f"""
<section class="page"><div class="som"><h1>Sommaire</h1><div class="grille">{''.join(blocs)}</div></div>
  <div class="pied"><span><b>ImmoSphera Académy</b> · Visite guidée de Nova CRM</span><span>Page 2</span></div>
</section>"""

def construire():
    pages = [page_couverture(), page_sommaire()] + [page_etape(i + 1, *et) for i, et in enumerate(ETAPES)]
    doc = f'<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Nova CRM — Guide de prise en main</title><style>{CSS}</style></head><body>{"".join(pages)}</body></html>'
    with open(os.path.join(ICI, 'guide.html'), 'w', encoding='utf-8') as f: f.write(doc)
    # Aperçu d'une seule page (pour vérifier la mise en page en image)
    apercu = f'<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{page_etape(16, *ETAPES[15])}</body></html>'
    with open(os.path.join(ICI, 'apercu.html'), 'w', encoding='utf-8') as f: f.write(apercu)
    chrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    base = [chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=8000']
    subprocess.run(base + ['--no-pdf-header-footer', f'--print-to-pdf={os.path.join(ICI, "guide.pdf")}', 'file://' + os.path.join(ICI, 'guide.html')], check=True, capture_output=True)
    subprocess.run(base + ['--window-size=1123,794', '--force-device-scale-factor=1', f'--screenshot={os.path.join(ICI, "apercu.png")}', 'file://' + os.path.join(ICI, 'apercu.html')], check=True, capture_output=True)
    print('guide.pdf :', os.path.getsize(os.path.join(ICI, 'guide.pdf')), 'octets')

if __name__ == '__main__':
    construire()
