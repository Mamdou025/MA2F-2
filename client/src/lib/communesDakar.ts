export interface CommuneDakar {
  commune: string;
  departement: "Dakar" | "Guédiawaye" | "Pikine" | "Keur Massar" | "Rufisque";
  arrondissement: string;
}

// Maillage complet de la région de Dakar (5 départements, 15 arrondissements/communes
// de rattachement, 53 communes) — source : ANSD, Recensement Général de la Population
// et de l'Habitat (RGPH), données 2023. https://www.ansd.sn/donnees-recensements
export const COMMUNES_DAKAR: CommuneDakar[] = [
  // Département de Dakar — Arrondissement Dakar-Plateau
  { commune: "Plateau", departement: "Dakar", arrondissement: "Dakar-Plateau" },
  { commune: "Médina", departement: "Dakar", arrondissement: "Dakar-Plateau" },
  { commune: "Fann-Point E-Amitié", departement: "Dakar", arrondissement: "Dakar-Plateau" },
  { commune: "Gueule Tapée-Fass-Colobane", departement: "Dakar", arrondissement: "Dakar-Plateau" },
  { commune: "Gorée", departement: "Dakar", arrondissement: "Dakar-Plateau" },
  // Département de Dakar — Arrondissement Grand-Dakar
  { commune: "Grand Dakar", departement: "Dakar", arrondissement: "Grand-Dakar" },
  { commune: "Biscuiterie", departement: "Dakar", arrondissement: "Grand-Dakar" },
  { commune: "Dieuppeul-Derklé", departement: "Dakar", arrondissement: "Grand-Dakar" },
  { commune: "HLM", departement: "Dakar", arrondissement: "Grand-Dakar" },
  { commune: "Hann Bel-Air", departement: "Dakar", arrondissement: "Grand-Dakar" },
  { commune: "Sicap-Liberté", departement: "Dakar", arrondissement: "Grand-Dakar" },
  // Département de Dakar — Arrondissement Almadies
  { commune: "Ngor", departement: "Dakar", arrondissement: "Almadies" },
  { commune: "Ouakam", departement: "Dakar", arrondissement: "Almadies" },
  { commune: "Yoff", departement: "Dakar", arrondissement: "Almadies" },
  { commune: "Mermoz-Sacré-Cœur", departement: "Dakar", arrondissement: "Almadies" },
  // Département de Dakar — Arrondissement Parcelles Assainies
  { commune: "Grand Yoff", departement: "Dakar", arrondissement: "Parcelles Assainies" },
  { commune: "Patte d'Oie", departement: "Dakar", arrondissement: "Parcelles Assainies" },
  { commune: "Parcelles Assainies", departement: "Dakar", arrondissement: "Parcelles Assainies" },
  { commune: "Camberène", departement: "Dakar", arrondissement: "Parcelles Assainies" },

  // Département de Pikine — Arrondissement Pikine Dagoudane
  { commune: "Pikine Ouest", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  { commune: "Pikine Est", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  { commune: "Pikine Sud", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  { commune: "Dalifort", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  { commune: "Djidah Thiaroye Kaw", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  { commune: "Guinaw Rail Nord", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  { commune: "Guinaw Rail Sud", departement: "Pikine", arrondissement: "Pikine Dagoudane" },
  // Département de Pikine — Arrondissement Thiaroye
  { commune: "Thiaroye-sur-Mer", departement: "Pikine", arrondissement: "Thiaroye" },
  { commune: "Diack Sao", departement: "Pikine", arrondissement: "Thiaroye" },
  { commune: "Diamaguène Sicap Mbao", departement: "Pikine", arrondissement: "Thiaroye" },
  { commune: "Thiaroye-Gare", departement: "Pikine", arrondissement: "Thiaroye" },
  { commune: "Mbao", departement: "Pikine", arrondissement: "Thiaroye" },

  // Département de Guédiawaye — Arrondissement Sam Notaire
  { commune: "Golf Sud", departement: "Guédiawaye", arrondissement: "Sam Notaire" },
  { commune: "Sam Notaire", departement: "Guédiawaye", arrondissement: "Sam Notaire" },
  // Département de Guédiawaye — Arrondissement Wakhinane Nimzatt
  { commune: "Ndiarème Limamoulaye", departement: "Guédiawaye", arrondissement: "Wakhinane Nimzatt" },
  { commune: "Wakhinane Nimzatt", departement: "Guédiawaye", arrondissement: "Wakhinane Nimzatt" },
  { commune: "Médina Gounass", departement: "Guédiawaye", arrondissement: "Wakhinane Nimzatt" },

  // Département de Keur Massar — Arrondissement Yeumbeul Nord
  { commune: "Yeumbeul Nord", departement: "Keur Massar", arrondissement: "Yeumbeul Nord" },
  { commune: "Yeumbeul Sud", departement: "Keur Massar", arrondissement: "Yeumbeul Nord" },
  // Département de Keur Massar — Arrondissement Malika
  { commune: "Malika", departement: "Keur Massar", arrondissement: "Malika" },
  { commune: "Keur Massar Nord", departement: "Keur Massar", arrondissement: "Malika" },
  // Département de Keur Massar — Arrondissement Jaxaay
  { commune: "Jaxaay-Parcelles", departement: "Keur Massar", arrondissement: "Jaxaay" },
  { commune: "Keur Massar Sud", departement: "Keur Massar", arrondissement: "Jaxaay" },

  // Département de Rufisque — Arrondissement Rufisque Est
  { commune: "Rufisque Nord", departement: "Rufisque", arrondissement: "Rufisque Est" },
  { commune: "Rufisque Est", departement: "Rufisque", arrondissement: "Rufisque Est" },
  { commune: "Rufisque Ouest", departement: "Rufisque", arrondissement: "Rufisque Est" },
  // Département de Rufisque — communes de rattachement direct
  { commune: "Bargny", departement: "Rufisque", arrondissement: "Bargny (commune)" },
  { commune: "Sendou", departement: "Rufisque", arrondissement: "Sendou (commune)" },
  // Département de Rufisque — Arrondissement Diamniadio
  { commune: "Yène", departement: "Rufisque", arrondissement: "Diamniadio" },
  { commune: "Diamniadio", departement: "Rufisque", arrondissement: "Diamniadio" },
  { commune: "Sébikotane", departement: "Rufisque", arrondissement: "Diamniadio" },
  // Département de Rufisque — Arrondissement Sangalkam
  { commune: "Bambylor", departement: "Rufisque", arrondissement: "Sangalkam" },
  { commune: "Tivaouane Peulh-Niaga", departement: "Rufisque", arrondissement: "Sangalkam" },
  { commune: "Sangalkam", departement: "Rufisque", arrondissement: "Sangalkam" },
];

export const NOMS_COMMUNES_DAKAR: string[] = COMMUNES_DAKAR
  .map((c) => c.commune)
  .sort((a, b) => a.localeCompare(b, "fr"));

// Normalise une chaîne pour la comparaison : MAJUSCULES, accents retirés (é/è/ê/ô/œ...),
// apostrophes typographiques ramenées à l'apostrophe droite, espaces multiples réduits.
// Sert à la fois pour les noms de communes officielles (ex: "Médina" vs "MEDINA" saisi
// sans accent) et pour les alias de quartiers ci-dessous.
export function normalizeZoneKey(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/Œ/g, "OE") // ligature non décomposée par normalize() (ex: Sacré-Cœur)
    .replace(/Æ/g, "AE")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents (é, è, ê, ô, ç...)
    .replace(/[’‘]/g, "'")
    .replace(/[^A-Z0-9' -]/g, " ") // parenthèses, virgules... -> espace
    .replace(/\s+/g, " ")
    .trim();
}

// Alias de quartiers → commune officielle. Les clients existants ont une "zone" en
// texte libre (voir Client.zone) et la plupart sont des noms de quartiers informels
// (ex: "Ouest Foire", "Unité26") plutôt que le nom exact d'une des 53 communes ANSD
// ci-dessus. Cette table couvre les quartiers les plus fréquents dans les données
// réelles (voir "Ventes par zone" dans ClientsSection) pour que le rattachement à un
// arrondissement fonctionne aussi pour eux. Clés déjà normalisées (voir
// normalizeZoneKey) : MAJUSCULES sans accents, espaces simples. Seuls les quartiers
// dont le rattachement est raisonnablement fiable sont inclus ; les cas ambigus ou
// non confirmés (ex: "Sipress", "Le Clerc", "Keur Massar" seul, "JVC", "Niankourabe")
// sont volontairement omis plutôt que de risquer une info fausse — mieux vaut aucun
// badge qu'un badge erroné.
const ALIAS_QUARTIERS_DAKAR_RAW: Record<string, string> = {
  "OUEST FOIRE": "Yoff",
  "OUST FOIRE": "Yoff",
  "OUEST FOIRE BCAO": "Yoff",
  "NORD FOIRE": "Yoff",
  "SUD FOIRE": "Yoff",
  "LIBERTE 6": "Sicap-Liberté",
  "LIBERTE6": "Sicap-Liberté",
  "LIBERTE 5": "Sicap-Liberté",
  "PORT": "Plateau",
  "CITE DAMELE": "Patte d'Oie",
  "CITE DAMEL": "Patte d'Oie",
  "PATTE DOIE BULDERS": "Patte d'Oie",
  "PATTE D'OIE BUILDERS": "Patte d'Oie",
  "PETIT MBAO": "Mbao",
  "SICAP MBAO": "Diamaguène Sicap Mbao",
  "ANCIENNE BRIOCHE PATTE D'OIE": "Patte d'Oie",
  "YARAKH": "Hann Bel-Air",
  "MALIKA PLAGE": "Malika",
  "HANN": "Hann Bel-Air",
  "HANN BEL AIR": "Hann Bel-Air",
  "MARISTE": "Hann Bel-Air",
  "MARISTES": "Hann Bel-Air",
  "HANN MARISTES": "Hann Bel-Air",
  "SACRE COEUR": "Mermoz-Sacré-Cœur",
  "SACRE-COEUR": "Mermoz-Sacré-Cœur",
  "FASS": "Gueule Tapée-Fass-Colobane",
  "COLOBANE": "Gueule Tapée-Fass-Colobane",
  "MARCHE GUELE TAPE": "Gueule Tapée-Fass-Colobane",
  "MARCHE GUEULE TAPEE": "Gueule Tapée-Fass-Colobane",
  "NIARI TALI": "Biscuiterie",
  "NIARY TALLY": "Biscuiterie",
  "SICAP FOIRE": "Grand Yoff",
  "ARAFAT": "Grand Yoff",
  "ZONE DE CAPTAGE": "Grand Yoff",
  "GRAND MEDINE": "Patte d'Oie",
  "GRAND MDINE": "Patte d'Oie",
  "CASTORE": "Sicap-Liberté",
  "CASTORS": "Sicap-Liberté",
  "DALIFORT": "Dalifort",
  "DIALIFORT": "Dalifort",
  "DALI FORT": "Dalifort",
  "PARCELLES": "Parcelles Assainies",
  "PARCELLE": "Parcelles Assainies",
  "TALI BOU BESS": "Parcelles Assainies",
};
// Unités numérotées de Parcelles Assainies (ex: "Unité26", "PA Unité 15") — la commune
// est littéralement découpée en ~26 "unités" numérotées, forme très fréquente dans les
// zones saisies par les commerciaux.
for (let i = 1; i <= 26; i++) {
  ALIAS_QUARTIERS_DAKAR_RAW[`UNITE ${i}`] = "Parcelles Assainies";
  ALIAS_QUARTIERS_DAKAR_RAW[`UNITE${i}`] = "Parcelles Assainies";
  ALIAS_QUARTIERS_DAKAR_RAW[`PA UNITE ${i}`] = "Parcelles Assainies";
  ALIAS_QUARTIERS_DAKAR_RAW[`PA UNITE${i}`] = "Parcelles Assainies";
}

export const ALIAS_QUARTIERS_DAKAR: Record<string, string> = Object.fromEntries(
  Object.entries(ALIAS_QUARTIERS_DAKAR_RAW).map(([k, v]) => [normalizeZoneKey(k), v])
);

// Index des communes par clé normalisée, pour un rattachement insensible aux accents/casse.
const COMMUNES_BY_KEY: Map<string, CommuneDakar> = new Map(
  COMMUNES_DAKAR.map((c) => [normalizeZoneKey(c.commune), c])
);

// Retrouve l'arrondissement (et le département) ANSD correspondant à une "zone" client en
// texte libre : d'abord une correspondance exacte (accents/casse ignorés) avec une des 53
// communes officielles, puis repli sur le dictionnaire de quartiers courants ci-dessus.
// Retourne null si rien ne correspond (saisie trop libre, quartier non répertorié...).
export function getArrondissement(zone: string | undefined | null): { arrondissement: string; departement: string } | null {
  if (!zone || !zone.trim()) return null;
  const key = normalizeZoneKey(zone);
  const direct = COMMUNES_BY_KEY.get(key);
  if (direct) return { arrondissement: direct.arrondissement, departement: direct.departement };
  const communeAlias = ALIAS_QUARTIERS_DAKAR[key];
  if (!communeAlias) return null;
  const viaAlias = COMMUNES_BY_KEY.get(normalizeZoneKey(communeAlias));
  return viaAlias ? { arrondissement: viaAlias.arrondissement, departement: viaAlias.departement } : null;
}

// Quartiers connus (issus des ~66 zones réellement saisies par les commerciaux, voir
// "Ventes par zone" dans ClientsSection), pour affichage dans le sélecteur "Zone" en plus
// des 53 communes officielles — un commercial reconnaît "Arafat" plus facilement que
// "Grand Yoff". `commune` est renseigné quand le rattachement est fiable (voir
// ALIAS_QUARTIERS_DAKAR ci-dessus) ; `null` pour les cas non confirmés, listés quand même
// à la demande pour rester visibles/sélectionnables, mais sans badge d'arrondissement.
export const QUARTIERS_DAKAR: { quartier: string; commune: string | null }[] = [
  { quartier: "Ouest Foire", commune: "Yoff" },
  { quartier: "Nord Foire", commune: "Yoff" },
  { quartier: "Sud Foire", commune: "Yoff" },
  { quartier: "Sicap Foire", commune: "Grand Yoff" },
  { quartier: "Arafat", commune: "Grand Yoff" },
  { quartier: "Zone de Captage", commune: "Grand Yoff" },
  { quartier: "Liberté 5", commune: "Sicap-Liberté" },
  { quartier: "Liberté 6", commune: "Sicap-Liberté" },
  { quartier: "Castors", commune: "Sicap-Liberté" },
  { quartier: "Cité Damel", commune: "Patte d'Oie" },
  { quartier: "Patte d'Oie Builders", commune: "Patte d'Oie" },
  { quartier: "Ancienne Brioche (Patte d'Oie)", commune: "Patte d'Oie" },
  { quartier: "Grand Médine", commune: "Patte d'Oie" },
  { quartier: "Petit Mbao", commune: "Mbao" },
  { quartier: "Sicap Mbao", commune: "Diamaguène Sicap Mbao" },
  { quartier: "Yarakh", commune: "Hann Bel-Air" },
  { quartier: "Hann Maristes", commune: "Hann Bel-Air" },
  { quartier: "Malika Plage", commune: "Malika" },
  { quartier: "Sacré-Cœur", commune: "Mermoz-Sacré-Cœur" },
  { quartier: "Fass", commune: "Gueule Tapée-Fass-Colobane" },
  { quartier: "Colobane", commune: "Gueule Tapée-Fass-Colobane" },
  { quartier: "Marché Gueule Tapée", commune: "Gueule Tapée-Fass-Colobane" },
  { quartier: "Niari Tali", commune: "Biscuiterie" },
  { quartier: "Port", commune: "Plateau" },
  { quartier: "Unité 1", commune: "Parcelles Assainies" },
  { quartier: "Unité 10", commune: "Parcelles Assainies" },
  { quartier: "Unité 13", commune: "Parcelles Assainies" },
  { quartier: "Unité 21", commune: "Parcelles Assainies" },
  { quartier: "Unité 26", commune: "Parcelles Assainies" },
  { quartier: "Tali Bou Bess", commune: "Parcelles Assainies" },
  // Quartiers repérés dans les données clients mais sans rattachement à une commune
  // confirmé par recherche — affichés quand même pour rester sélectionnables.
  { quartier: "Sipress", commune: null },
  { quartier: "Le Clerc", commune: null },
  { quartier: "Lonase Foire", commune: null },
  { quartier: "Marché Guélewar", commune: null },
  { quartier: "Ben Tally", commune: null },
  { quartier: "Diamalaye", commune: null },
  { quartier: "Touba Séras", commune: null },
  { quartier: "Fass de l'Orme", commune: null },
  { quartier: "Foire", commune: null },
  { quartier: "Niankourabe", commune: null },
  { quartier: "JVC (Rond-point, Sacré-Cœur)", commune: null },
  { quartier: "Fadia", commune: null },
];

// Liste combinée communes officielles + quartiers, pour le sélecteur "Zone" du formulaire
// client (plus complète que NOMS_COMMUNES_DAKAR seul).
export const NOMS_ZONES_DAKAR: string[] = Array.from(
  new Set([...NOMS_COMMUNES_DAKAR, ...QUARTIERS_DAKAR.map((q) => q.quartier)])
).sort((a, b) => a.localeCompare(b, "fr"));
