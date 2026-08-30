// Photos réelles déjà hébergées dans /public/team (cette application).
const melaniePhotoUrl = "/team/melanie_grazia.png";
const christophePhotoUrl = "/team/christophe_hirsch.png";
const paulinePhotoUrl = "/team/pauline_segura.png";
const laetitiaPhotoUrl = "/team/laetitia_pioche.png";
const karinePhotoUrl = "/team/karine_brebion.png";
const isabellePhotoUrl = "/team/isabelle_gensonnie.png";
const clemencePhotoUrl = "/team/clemence_grandguillaume.png";

export interface Advisor {
  id: string;
  name: string;
  role: string;
  photo: string;
  email: string;
  phone: string;
  cardUrl: string;
}

export const advisors: Advisor[] = [
  {
    id: "melanie",
    name: "Mélanie Grazia",
    role: "Gérante d'Agence",
    photo: melaniePhotoUrl,
    email: "melanie@immosphera.fr",
    phone: "",
    cardUrl: "",
  },
  {
    id: "christophe",
    name: "Christophe Hirsch",
    role: "Conseiller Immobilier",
    photo: christophePhotoUrl,
    email: "christophe.hirch@immosphera.fr",
    phone: "+33 6 13 91 22 66",
    cardUrl: "",
  },
  {
    id: "pauline",
    name: "Pauline Casanova",
    role: "Conseillère Immobilier",
    photo: paulinePhotoUrl,
    email: "pauline.casanova@immosphera.fr",
    phone: "+33 7 62 34 10 78",
    cardUrl: "https://cartedevisite.pro/pauline-casanova",
  },
  {
    id: "laetitia",
    name: "Laetitia Pioche",
    role: "Conseillère Immobilier",
    photo: laetitiaPhotoUrl,
    email: "laetitia.pioche@immosphera.fr",
    phone: "+33 7 88 37 73 92",
    cardUrl: "https://cartedevisite.pro/laetitiapioche/",
  },
  {
    id: "karine",
    name: "Karine Brebion",
    role: "Conseillère Immobilier",
    photo: karinePhotoUrl,
    email: "karine.brebion@immosphera.fr",
    phone: "+33 6 24 63 26 46",
    cardUrl: "https://cartedevisite.pro/karine-brebion/",
  },
  {
    id: "isabelle",
    name: "Isabelle Gensonnie",
    role: "Conseillère Immobilier",
    photo: isabellePhotoUrl,
    email: "isabelle.gensonnie@immosphera.fr",
    phone: "+33 6 07 19 46 09",
    cardUrl: "https://isabellegensonnie.immosphera360.fr/",
  },
  {
    id: "clemence",
    name: "Clémence Grandguillaume",
    role: "Conseillère Immobilier",
    photo: clemencePhotoUrl,
    email: "Clemence.grandguillaume@immosphera.fr",
    phone: "+33 7 86 04 82 93",
    cardUrl: "https://cartedevisite.pro/clemencegrandguillaume",
  },
];

export function getAdvisorById(id: string): Advisor | undefined {
  return advisors.find((a) => a.id === id);
}

export function getAdvisorByName(name: string): Advisor | undefined {
  return advisors.find((a) => a.name === name);
}
