# Repère, dans une capture de la visite guidée, l'élément entouré d'or (la cible)
# et en extrait un zoom. La carte de l'étape (fond bleu-vert) est exclue.
import os, sys
from collections import deque
from PIL import Image, ImageFilter

def composantes(img_l):
    w, h = img_l.size; px = img_l.load()
    vu = bytearray(w * h); comps = []
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if px[x, y] and not vu[i]:
                vu[i] = 1; q = deque([(x, y)]); x0 = x1 = x; y0 = y1 = y; n = 0
                while q:
                    cx, cy = q.popleft(); n += 1
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h:
                            j = ny * w + nx
                            if px[nx, ny] and not vu[j]: vu[j] = 1; q.append((nx, ny))
                comps.append((x0, y0, x1, y1, n))
    return comps

def masque(petit, test):
    w, h = petit.size; src = petit.load()
    m = Image.new('L', (w, h), 0); dst = m.load()
    for y in range(h):
        for x in range(w):
            if test(src[x, y]): dst[x, y] = 255
    return m

def est_dore(p):
    r, g, b = p[:3]
    return r > 205 and 150 < g < 225 and b < 150 and r - b > 90

def est_carte(p):
    r, g, b = p[:3]
    return 8 <= r <= 35 and 38 <= g <= 72 and 42 <= b <= 78 and g - r > 20

def cible(chemin):
    im = Image.open(chemin).convert('RGB'); W, H = im.size
    petit = im.resize((W // 2, H // 2), Image.BILINEAR)
    dore = masque(petit, est_dore).filter(ImageFilter.MaxFilter(3))
    carte_m = masque(petit, est_carte)
    cartes = [c for c in composantes(carte_m) if (c[2]-c[0]) > 100 and (c[3]-c[1]) > 50]
    carte = max(cartes, key=lambda c: c[4]) if cartes else None
    comps = [(x0*2, y0*2, x1*2, y1*2, n) for (x0, y0, x1, y1, n) in composantes(dore)]
    if carte: carte = (carte[0]*2, carte[1]*2, carte[2]*2, carte[3]*2)
    def dans_carte(c):
        if not carte: return False
        return c[0] >= carte[0]-10 and c[1] >= carte[1]-10 and c[2] <= carte[2]+10 and c[3] <= carte[3]+10
    cand = [c for c in comps if (c[2]-c[0]) >= 30 and (c[3]-c[1]) >= 16 and (c[3]-c[1]) < 140 and not dans_carte(c)]
    if not cand: return im, carte, None
    return im, carte, max(cand, key=lambda c: (c[2]-c[0]) * (c[3]-c[1]))

def loupe(chemin, sortie, ratio=2.4, marge=40):
    im, carte, c = cible(chemin)
    if not c: return None, carte
    W, H = im.size; x0, y0, x1, y1, _ = c
    cx0, cy0, cx1, cy1 = max(0, x0-marge), max(0, y0-marge), min(W, x1+marge), min(H, y1+marge)
    lw, lh = cx1-cx0, cy1-cy0
    if lw / lh < ratio:
        nl = int(lh * ratio); d = (nl - lw) // 2
        cx0 = max(0, cx0 - d); cx1 = min(W, cx0 + nl); cx0 = max(0, cx1 - nl)
    else:
        nh = int(lw / ratio); d = (nh - lh) // 2
        cy0 = max(0, cy0 - d); cy1 = min(H, cy0 + nh); cy0 = max(0, cy1 - nh)
    crop = im.crop((cx0, cy0, cx1, cy1))
    if crop.size[0] < 900:
        f = 900 / crop.size[0]
        crop = crop.resize((int(crop.size[0]*f), int(crop.size[1]*f)), Image.LANCZOS)
    crop.save(sortie, quality=90)
    return (x0, y0, x1, y1), carte

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    for f in os.listdir(dst):
        if f.startswith('loupe-'): os.remove(os.path.join(dst, f))
    for n in range(2, 24):
        etape = n - 1
        boite, carte = loupe(f'{src}/capture-{n:02d}.jpg', f'{dst}/loupe-{etape:02d}.jpg')
        print(f'étape {etape:>2} | carte {carte} | cible {boite}')
