# -*- coding: utf-8 -*-
import html, os, subprocess
ICI = os.path.dirname(os.path.abspath(__file__))
SOCIETES = [
    dict(nom='Conseils Finances', court='Conseils Finances', domaine='conseilfinances.fr', suffixe='CONSEIL_FINANCES', projet='Nova CRM – Conseils Finances', fichier='Guide Google interne - Conseils Finances.pdf'),
    dict(nom='Novavisio', court='Novavisio', domaine='novavisio.fr', suffixe='NOVAVISIO', projet='Nova CRM – Novavisio', fichier='Guide Google interne - Novavisio.pdf'),
    dict(nom='ImmoSphera', court='ImmoSphera', domaine='immosphera.fr', suffixe='IMMOSPHERA', projet='Nova CRM – ImmoSphera', fichier='Guide Google interne - ImmoSphera.pdf'),
]
e = html.escape
CSS = """
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: A4; margin: 16mm 15mm 18mm; }
body { margin: 0; font-family: 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif; color: #1c2430; font-size: 10.5pt; line-height: 1.5; }
.bandeau { background: #0d2a2e; color: #fff; border-bottom: 1.2mm solid #F7BC5F; padding: 6mm 7mm; border-radius: 3mm; margin-bottom: 6mm; }
.bandeau .sur { color: #F7BC5F; font-size: 8.5pt; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; }
.bandeau h1 { margin: 1.5mm 0 1mm; font-size: 19pt; }
.bandeau .sous { color: #cfe3e5; font-size: 10pt; }
h2 { font-size: 13pt; color: #0d2a2e; margin: 7mm 0 2.5mm; padding-bottom: 1mm; border-bottom: 0.4mm solid #F7BC5F; }
p { margin: 0 0 2.5mm; }
.etape { display: flex; gap: 4mm; margin: 0 0 3.5mm; page-break-inside: avoid; }
.etape .num { flex: none; width: 8mm; height: 8mm; border-radius: 50%; background: #F7BC5F; color: #07191b; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 10pt; }
.etape .corps { flex: 1; }
.etape .titre { font-weight: 700; margin-bottom: 0.8mm; }
.case { display: inline-block; width: 4.2mm; height: 4.2mm; border: 0.4mm solid #0d2a2e; border-radius: 1mm; vertical-align: -0.8mm; margin-right: 2mm; }
.valeurs { background: #f4f5f7; border-left: 1.4mm solid #F7BC5F; border-radius: 2mm; padding: 3mm 4mm; margin: 2mm 0 3mm; page-break-inside: avoid; }
.valeurs table { border-collapse: collapse; width: 100%; }
.valeurs td { padding: 1mm 2mm 1mm 0; vertical-align: top; font-size: 9.8pt; }
.valeurs td:first-child { color: #52636b; width: 44mm; }
code { font-family: 'Liberation Mono', 'DejaVu Sans Mono', monospace; font-size: 9.2pt; background: #e9eef0; padding: 0.3mm 1.2mm; border-radius: 1mm; }
.alerte { background: #fff6e3; border: 0.4mm solid #F7BC5F; border-radius: 2mm; padding: 2.5mm 4mm; margin: 2mm 0 3mm; page-break-inside: avoid; }
.ok { background: #e7f6ec; border: 0.4mm solid #1f8a4c; border-radius: 2mm; padding: 2.5mm 4mm; margin: 2mm 0; page-break-inside: avoid; }
ul { margin: 0 0 2.5mm; padding-left: 5mm; }
li { margin-bottom: 0.8mm; }
.pied { margin-top: 8mm; color: #6b7280; font-size: 8.5pt; border-top: 0.3mm solid #d8e0e3; padding-top: 2mm; }
"""

def etape(n, titre, corps):
    return f'<div class="etape"><div class="num">{n}</div><div class="corps"><div class="titre"><span class="case"></span>{titre}</div>{corps}</div></div>'

def guide(s):
    S = s['suffixe']; D = e(s['domaine']); N = e(s['nom']); P = e(s['projet'])
    etapes = []
    etapes.append(etape(1, "Se connecter à la console avec le bon compte",
        "<p>Ouvrez <code>console.cloud.google.com</code>, connecté avec le compte administrateur <code>@" + D + "</code>. Si un autre compte Google est ouvert dans le navigateur, utilisez une fenêtre de navigation privée.</p>"))
    etapes.append(etape(2, "Vérifier s'il existe déjà un projet Nova CRM",
        "<p>En haut, cliquez sur le sélecteur de projet (à côté du logo Google Cloud). S'il existe déjà un projet <b>Nova CRM</b> pour " + N + " <b>dans l'organisation " + D + "</b>, sélectionnez-le et passez à l'étape 4. Sinon, étape 3.</p>"))
    etapes.append(etape(3, "Créer le projet",
        "<p>Dans le sélecteur de projet, « Nouveau projet ». Nom : <code>" + P + "</code>. Champ <b>Organisation</b> : il doit afficher <code>" + D + "</code> (pas « Aucune organisation »). Créer, attendre quelques secondes, puis sélectionner ce projet.</p>"
        "<div class=\"alerte\">Si « Organisation » ne propose pas " + D + ", vous n'êtes pas connecté avec un compte administrateur de ce Workspace : revenez à l'étape 1.</div>"))
    etapes.append(etape(4, "Activer les trois API",
        "<p>Menu (trois traits en haut à gauche) → « API et services » → « Bibliothèque ». Recherchez et activez, une par une : <b>Gmail API</b>, <b>Google Drive API</b>, <b>Google Calendar API</b>.</p>"))
    etapes.append(etape(5, "Déclarer l'application en interne",
        "<p>Menu → « API et services » → « Écran de consentement OAuth » (selon la version de la console : « Google Auth Platform » → « Présentation » → « Commencer »).</p>"
        "<div class=\"valeurs\"><table>"
        "<tr><td>Nom de l'application</td><td><code>Nova CRM</code></td></tr>"
        "<tr><td>Adresse e-mail d'assistance</td><td>votre adresse <code>@" + D + "</code></td></tr>"
        "<tr><td>Audience / Type d'utilisateur</td><td><b>Interne</b> (c'est le point clé de tout le guide)</td></tr>"
        "<tr><td>Coordonnées du développeur</td><td>votre adresse <code>@" + D + "</code></td></tr>"
        "</table></div>"
        "<p>Validez. Facultatif mais propre, dans « Branding » : page d'accueil <code>https://app.nova360.space</code>, politique de confidentialité <code>https://app.nova360.space/confidentialite.html</code>, conditions <code>https://app.nova360.space/conditions.html</code>, domaine autorisé <code>nova360.space</code>.</p>"))
    etapes.append(etape(6, "Créer l'identifiant OAuth (le « client »)",
        "<p>Menu → « API et services » → « Identifiants » → « Créer des identifiants » → « ID client OAuth ».</p>"
        "<div class=\"valeurs\"><table>"
        "<tr><td>Type d'application</td><td><b>Application Web</b></td></tr>"
        "<tr><td>Nom</td><td><code>Nova CRM web</code></td></tr>"
        "<tr><td>Origines JavaScript autorisées</td><td><code>https://app.nova360.space</code><br><code>https://test.nova360.space</code></td></tr>"
        "<tr><td>URI de redirection autorisés</td><td><code>https://app.nova360.space/api/google/callback</code><br><code>https://test.nova360.space/api/google/callback</code><br><code>https://app.nova360.space/api/admin/drive/callback</code><br><code>https://test.nova360.space/api/admin/drive/callback</code></td></tr>"
        "</table></div>"
        "<p>Cliquez sur « Créer ». Google affiche un <b>ID client</b> (se termine par <code>.apps.googleusercontent.com</code>) et un <b>secret client</b>. Laissez cette fenêtre ouverte pour l'étape 7, ou téléchargez le fichier JSON.</p>"))
    etapes.append(etape(7, "Déposer les deux clés dans le CRM (jamais dans un e-mail ni dans le chat)",
        "<p>Deux endroits, exactement les mêmes noms dans les deux :</p>"
        "<div class=\"valeurs\"><table>"
        "<tr><td>Nom pour l'ID client</td><td><code>GOOGLE_OAUTH_CLIENT_ID_" + S + "</code></td></tr>"
        "<tr><td>Nom pour le secret</td><td><code>GOOGLE_OAUTH_CLIENT_SECRET_" + S + "</code></td></tr>"
        "</table></div>"
        "<ul><li><b>Supabase</b> : projet Nova CRM → « Edge Functions » → « Secrets » → « Add new secret », un secret par nom ci-dessus. Si un secret du même nom existe déjà, remplacez sa valeur par la nouvelle.</li>"
        "<li><b>Vercel</b> : projet Nova CRM → « Settings » → « Environment Variables » → « Add », les deux mêmes noms, cochés pour <b>Production</b> et <b>Preview</b>.</li></ul>"))
    etapes.append(etape(8, "Me prévenir",
        "<p>Écrivez simplement « fait pour " + N + " », avec le domaine e-mail si différent de <code>" + D + "</code>. Je branche le parcours « Connecter mon Google Workspace » dans le CRM et je le teste sur Test avant la prod.</p>"))
    corps = "".join(etapes)
    return ("<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>Guide Google interne — " + N + "</title><style>" + CSS + "</style></head><body>"
        "<div class=\"bandeau\"><div class=\"sur\">Nova CRM · Passage en application Google interne</div><h1>" + N + "</h1><div class=\"sous\">Guide pas à pas, à faire depuis le compte administrateur du Google Workspace de " + N + ". Environ 15 minutes.</div></div>"
        "<h2>Avant de commencer</h2>"
        "<div class=\"valeurs\"><table>"
        "<tr><td>Compte à utiliser</td><td>Un compte <b>administrateur</b> du Workspace de " + N + " (adresse en <code>@" + D + "</code>). Pas un autre Workspace : c'est ce compte qui décide dans quelle organisation le projet est créé.</td></tr>"
        "<tr><td>Domaine e-mail</td><td><code>" + D + "</code>. Si les collaborateurs de " + N + " ont un autre domaine, notez-le ici : ______________________</td></tr>"
        "<tr><td>Nom du projet</td><td><code>" + P + "</code></td></tr>"
        "<tr><td>Adresse de la console</td><td><code>https://console.cloud.google.com</code></td></tr>"
        "</table></div>"
        "<div class=\"alerte\"><b>À ne pas toucher :</b> le client Google déjà utilisé pour la connexion au CRM (celui réglé dans Supabase). Ce guide en crée un autre, propre à " + N + ", uniquement pour Gmail, Drive et Agenda.</div>"
        "<h2>Les étapes</h2>" + corps +
        "<h2>Si ça bloque</h2><ul>"
        "<li><b>« Interne » n'est pas proposé</b> : le projet n'est pas dans l'organisation " + D + " (étape 3), ou le compte n'est pas administrateur du Workspace.</li>"
        "<li><b>Au moment de la connexion d'un collaborateur, Google refuse l'application</b> : dans la console d'administration Workspace (<code>admin.google.com</code>) → Sécurité → Contrôle des accès et des données → Commandes des API → « Gérer l'accès aux applications tierces », autorisez l'application Nova CRM (par son ID client) comme « Approuvée ».</li>"
        "<li><b>Une collaboratrice a une adresse d'un autre domaine</b> : notez-la-moi, j'ajoute le domaine à la correspondance.</li></ul>"
        "<div class=\"ok\"><b>Résultat attendu :</b> les collaborateurs de " + N + " autorisent Gmail, Drive et Agenda sur un écran à leur nom de société, sans avertissement Google, une seule fois, et sans reconnexion hebdomadaire.</div>"
        "<div class=\"pied\">Nova CRM · Guide « application Google interne » · " + N + " · septembre 2026</div>"
        "</body></html>")

chrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
for s in SOCIETES:
    h = os.path.join(ICI, f"guide-{s['suffixe'].lower()}.html")
    open(h, 'w', encoding='utf-8').write(guide(s))
    pdf = os.path.join(ICI, s['fichier'])
    subprocess.run([chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={pdf}', 'file://' + h], check=True, capture_output=True)
    print(s['fichier'], os.path.getsize(pdf), 'octets')
