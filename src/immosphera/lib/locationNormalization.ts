export interface LocationRecord {
  raw: string;
  postalCode: string;
  city: string;
  cityKey: string;
  canonicalKey: string;
  canonicalLabel: string;
  searchable: string;
}

type CanonicalTown = {
  city: string;
  postalCode: string;
  aliases?: string[];
};

const CANONICAL_TOWNS: CanonicalTown[] = [
  { city: "Argeliers", postalCode: "11120" },
  { city: "Armissan", postalCode: "11110" },
  { city: "Bages", postalCode: "11100" },
  { city: "Béziers", postalCode: "34500" },
  { city: "Bize-Minervois", postalCode: "11120", aliases: ["Bize Minervois"] },
  { city: "Capendu", postalCode: "11700" },
  { city: "Coursan", postalCode: "11110" },
  { city: "Cruzy", postalCode: "34310" },
  { city: "Fleury-d'Aude", postalCode: "11560", aliases: ["Fleury d Aude", "Fleury"] },
  { city: "Ginestas", postalCode: "11120" },
  { city: "Gruissan", postalCode: "11430" },
  { city: "Homps", postalCode: "11200" },
  { city: "La Palme", postalCode: "11480" },
  { city: "La Redorte", postalCode: "11700" },
  { city: "Le Barcarès", postalCode: "66420", aliases: ["Le Barcares", "Barcares"] },
  { city: "Leucate", postalCode: "11370" },
  { city: "Lézignan-Corbières", postalCode: "11200", aliases: ["Lezignan", "Lezignan Corbieres"] },
  { city: "Marcorignan", postalCode: "11120" },
  { city: "Murviel-lès-Béziers", postalCode: "34490", aliases: ["Murviel les Beziers"] },
  { city: "Narbonne", postalCode: "11100" },
  { city: "Narbonne-Plage", postalCode: "11100", aliases: ["Narbonne Plage"] },
  { city: "Ornaisons", postalCode: "11200" },
  { city: "Ouveillan", postalCode: "11590" },
  { city: "Portel-des-Corbières", postalCode: "11490", aliases: ["Portel des Corbieres"] },
  { city: "Portiragnes-Plage", postalCode: "34420", aliases: ["Portiragnes plage", "Portiragnes"] },
  { city: "Pouzols-Minervois", postalCode: "11120", aliases: ["Pouzols Minervois"] },
  { city: "Prat-de-Cest", postalCode: "11100", aliases: ["Prat de Cest"] },
  { city: "Quarante", postalCode: "34310" },
  { city: "Roquefort-des-Corbières", postalCode: "11540", aliases: ["Roquefort des Corbieres"] },
  { city: "Saint-Marcel-sur-Aude", postalCode: "11120", aliases: ["Saint Marcel", "Saint Marcel sur Aude"] },
  { city: "Sainte-Valière", postalCode: "11120", aliases: ["Sainte Valiere"] },
  { city: "Sauvian", postalCode: "34410" },
  { city: "Ventenac-en-Minervois", postalCode: "11120", aliases: ["Ventenac", "Ventenac en Minervois"] },
];

const POSTAL_CODE_PATTERN = /\b(\d{5})\b/;
const SIX_DIGIT_POSTAL_PATTERN = /\b(\d{6})\b/;
const LOWERCASE_WORDS = new Set([
  "a",
  "au",
  "aux",
  "d",
  "de",
  "des",
  "du",
  "en",
  "la",
  "le",
  "les",
  "l",
  "sur",
  "sous",
]);

export function normalizeLocationText(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const townByAlias = new Map<string, CanonicalTown>();
for (const town of CANONICAL_TOWNS) {
  for (const alias of [town.city, ...(town.aliases || [])]) {
    townByAlias.set(normalizeLocationText(alias), town);
  }
}

function extractPostalCode(value: string): string {
  const normal = value.match(POSTAL_CODE_PATTERN)?.[1];
  if (normal) return normal;

  // Corrige les saisies courantes comme 111100 -> 11110.
  const sixDigits = value.match(SIX_DIGIT_POSTAL_PATTERN)?.[1];
  return sixDigits?.endsWith("0") ? sixDigits.slice(0, 5) : "";
}

function extractCity(value: string): string {
  return (value || "")
    .replace(SIX_DIGIT_POSTAL_PATTERN, " ")
    .replace(POSTAL_CODE_PATTERN, " ")
    .replace(/^\s*[-–—,:;]+|[-–—,:;]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatUnknownCity(value: string): string {
  const clean = normalizeLocationText(value);
  if (!clean) return "";

  return clean
    .split(" ")
    .map((word, index) => {
      if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("fr") + word.slice(1);
    })
    .join(" ");
}

function findCanonicalTown(cityValue: string, postalCode = ""): CanonicalTown | null {
  const cityKey = normalizeLocationText(cityValue);
  if (!cityKey) return null;

  const exact = townByAlias.get(cityKey);
  if (exact && (!postalCode || exact.postalCode === postalCode)) return exact;

  // Autorise uniquement les variantes explicites et non les rapprochements trop larges.
  for (const [alias, town] of townByAlias.entries()) {
    if (postalCode && town.postalCode !== postalCode) continue;
    if (cityKey === alias || cityKey.startsWith(`${alias} `) || alias.startsWith(`${cityKey} `)) return town;
  }

  return exact || null;
}

function chooseMostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

export function createLocationIndex(rawLocations: Array<string | null | undefined>) {
  const parsed = rawLocations
    .map((rawValue) => {
      const raw = (rawValue || "").trim();
      if (!raw) return null;

      const extractedPostalCode = extractPostalCode(raw);
      const cityRaw = extractCity(raw);
      const knownTown = findCanonicalTown(cityRaw, extractedPostalCode);
      const city = knownTown?.city || formatUnknownCity(cityRaw);
      const postalCode = knownTown?.postalCode || extractedPostalCode;
      const cityKey = normalizeLocationText(city);

      if (!cityKey) return null;
      return { raw, cityRaw, city, cityKey, postalCode };
    })
    .filter((item): item is { raw: string; cityRaw: string; city: string; cityKey: string; postalCode: string } =>
      Boolean(item),
    );

  // Déduit le code postal des villes inconnues à partir des autres biens ayant la même ville.
  const postalsByCity = new Map<string, string[]>();
  for (const item of parsed) {
    if (!item.postalCode) continue;
    const list = postalsByCity.get(item.cityKey) || [];
    list.push(item.postalCode);
    postalsByCity.set(item.cityKey, list);
  }

  const records: LocationRecord[] = parsed.map((item) => {
    const postalCode = item.postalCode || chooseMostFrequent(postalsByCity.get(item.cityKey) || []);
    const knownTown = findCanonicalTown(item.city, postalCode);
    const city = knownTown?.city || item.city;
    const resolvedPostalCode = knownTown?.postalCode || postalCode;
    const canonicalCityKey = normalizeLocationText(city);
    const canonicalKey = `${resolvedPostalCode}|${canonicalCityKey}`;
    const canonicalLabel = resolvedPostalCode ? `${city} (${resolvedPostalCode})` : city;
    const searchable = normalizeLocationText(`${item.raw} ${city} ${resolvedPostalCode} ${canonicalLabel}`);

    return {
      raw: item.raw,
      postalCode: resolvedPostalCode,
      city,
      cityKey: canonicalCityKey,
      canonicalKey,
      canonicalLabel,
      searchable,
    };
  });

  const recordByRaw = new Map<string, LocationRecord>();
  for (const record of records) recordByRaw.set(normalizeLocationText(record.raw), record);

  const optionMap = new Map<string, string>();
  for (const record of records) {
    if (!optionMap.has(record.canonicalKey)) optionMap.set(record.canonicalKey, record.canonicalLabel);
  }

  const options = [...optionMap.values()].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

  const resolve = (rawValue: string | null | undefined): LocationRecord | null => {
    const raw = (rawValue || "").trim();
    if (!raw) return null;

    const direct = recordByRaw.get(normalizeLocationText(raw));
    if (direct) return direct;

    const extractedPostalCode = extractPostalCode(raw);
    const cityRaw = extractCity(raw);
    const knownTown = findCanonicalTown(cityRaw, extractedPostalCode);
    const city = knownTown?.city || formatUnknownCity(cityRaw);
    const cityKey = normalizeLocationText(city);
    const postalCode =
      knownTown?.postalCode || extractedPostalCode || chooseMostFrequent(postalsByCity.get(cityKey) || []);
    const canonicalLabel = postalCode ? `${city} (${postalCode})` : city;

    return {
      raw,
      postalCode,
      city,
      cityKey,
      canonicalKey: `${postalCode}|${cityKey}`,
      canonicalLabel,
      searchable: normalizeLocationText(`${raw} ${city} ${postalCode} ${canonicalLabel}`),
    };
  };

  const matches = (propertyLocation: string | null | undefined, query: string): boolean => {
    const property = resolve(propertyLocation);
    const requested = resolve(query);
    const normalizedQuery = normalizeLocationText(query);
    if (!property || !normalizedQuery) return false;

    const queryPostal = extractPostalCode(query) || requested?.postalCode || "";
    const queryCityText = normalizeLocationText(extractCity(query));

    // Une recherche uniquement par code postal retourne toutes les communes de ce code.
    if (queryPostal && !queryCityText) return property.postalCode === queryPostal;

    if (queryPostal && property.postalCode !== queryPostal) return false;
    if (requested && requested.cityKey && property.cityKey === requested.cityKey) return true;

    return normalizedQuery
      .split(" ")
      .filter(Boolean)
      .every((token) => property.searchable.includes(token));
  };

  return { options, records, resolve, matches };
}
