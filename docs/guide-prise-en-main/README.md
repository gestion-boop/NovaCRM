# Guide de prise en main (PDF pour l'Académy)

Le PDF « Nova CRM – Guide de prise en main » suit les 22 étapes de la visite
guidée (src/App.tsx, PRODUCT_TOUR_STEPS) avec une capture par étape.

- `captures/etape-NN.jpg` : les captures fournies le 2 septembre (compte
  ImmoSphera), une par étape.
- `loupes.py` : repère l'élément entouré d'or dans chaque capture et en
  extrait un zoom (`loupes.py captures captures`).
- `genere_guide.py` : assemble le PDF (Chromium en mode headless) ; pour
  refaire le guide après une évolution de l'interface, remplacer les
  captures concernées puis relancer `loupes.py` et `genere_guide.py`.
