export interface CommuneDakar {
  commune: string;
  departement: "Dakar" | "Guédiawaye" | "Pikine" | "Keur Massar" | "Rufisque";
}

export const COMMUNES_DAKAR: CommuneDakar[] = [
  { commune: "Plateau", departement: "Dakar" },
  { commune: "Médina", departement: "Dakar" },
  { commune: "Fann-Point E-Amitié", departement: "Dakar" },
  { commune: "Gueule Tapée-Fass-Colobane", departement: "Dakar" },
  { commune: "Gorée", departement: "Dakar" },
  { commune: "Grand Dakar", departement: "Dakar" },
  { commune: "Biscuiterie", departement: "Dakar" },
  { commune: "Dieuppeul-Derklé", departement: "Dakar" },
  { commune: "HLM", departement: "Dakar" },
  { commune: "Hann Bel-Air", departement: "Dakar" },
  { commune: "Sicap-Liberté", departement: "Dakar" },
  { commune: "Grand Yoff", departement: "Dakar" },
  { commune: "Patte d'Oie", departement: "Dakar" },
  { commune: "Parcelles Assainies", departement: "Dakar" },
  { commune: "Camberène", departement: "Dakar" },
  { commune: "Ngor", departement: "Dakar" },
  { commune: "Ouakam", departement: "Dakar" },
  { commune: "Yoff", departement: "Dakar" },
  { commune: "Mermoz-Sacré-Cœur", departement: "Dakar" },
  { commune: "Golf Sud", departement: "Guédiawaye" },
  { commune: "Médina Gounass", departement: "Guédiawaye" },
  { commune: "Ndiarème Limamoulaye", departement: "Guédiawaye" },
  { commune: "Sam Notaire", departement: "Guédiawaye" },
  { commune: "Wakhinane Nimzatt", departement: "Guédiawaye" },
  { commune: "Dalifort", departement: "Pikine" },
  { commune: "Djidah Thiaroye Kaw", departement: "Pikine" },
  { commune: "Guinaw Rail Nord", departement: "Pikine" },
  { commune: "Guinaw Rail Sud", departement: "Pikine" },
  { commune: "Pikine Est", departement: "Pikine" },
  { commune: "Pikine Nord", departement: "Pikine" },
  { commune: "Pikine Ouest", departement: "Pikine" },
  { commune: "Diamaguène Sicap Mbao", departement: "Pikine" },
  { commune: "Thiaroye-Gare", departement: "Pikine" },
  { commune: "Thiaroye-sur-Mer", departement: "Pikine" },
  { commune: "Keur Massar Nord", departement: "Keur Massar" },
  { commune: "Keur Massar Sud", departement: "Keur Massar" },
  { commune: "Malika", departement: "Keur Massar" },
  { commune: "Yeumbeul Nord", departement: "Keur Massar" },
  { commune: "Yeumbeul Sud", departement: "Keur Massar" },
  { commune: "Jaxaay-Parcelles", departement: "Keur Massar" },
  { commune: "Rufisque Est", departement: "Rufisque" },
  { commune: "Rufisque Nord", departement: "Rufisque" },
  { commune: "Rufisque Ouest", departement: "Rufisque" },
  { commune: "Bargny", departement: "Rufisque" },
  { commune: "Sébikotane", departement: "Rufisque" },
  { commune: "Diamniadio", departement: "Rufisque" },
  { commune: "Sangalkam", departement: "Rufisque" },
  { commune: "Sendou", departement: "Rufisque" },
  { commune: "Tivaouane Peulh-Niaga", departement: "Rufisque" },
];

export const NOMS_COMMUNES_DAKAR: string[] = COMMUNES_DAKAR
  .map((c) => c.commune)
  .sort((a, b) => a.localeCompare(b, "fr"));
  