import { useApp } from "@/contexts/AppContext";
import { Button } from "@/components/ui/button";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import {
  fmt,
  fmtDate,
  cashAtSale,
  resteVente,
  bonusVente,
  commissionVente,
  todayLocal,
  toLocalDateStr,
  computeMonthlyBreakdown,
  computeSoldeCaisseActuel,
  computeStockRestant,
  computeStockMatierePremiere,
} from "@/lib/helpers";

function generateWorkbook(DB: any) {
  // Import dynamique de xlsx sera fait en amont
  const XLSX = (window as any).__XLSX__;

  // Table de correspondance nom client -> zone, pour enrichir VENTES sans
  // devoir croiser manuellement avec la feuille CLIENTS.
  const zoneParClient = new Map<string, string>();
  DB.clients.forEach((c: any) => zoneParClient.set(c.nom, c.zone || ""));

  // Feuille VENTES — détail complet de chaque vente, y compris la
  // commission générée et la localisation du client.
  const ventesData = DB.ventes.map((v: any) => ({
    "N° BL": v.numero,
    Date: v.date,
    Client: v.client,
    Zone: zoneParClient.get(v.client) || "",
    Commercial: v.commercial || "",
    Livreur: v.livreur || "",
    Packs: v.packs,
    "Prix/pack": v.prix,
    Montant: v.packs * v.prix,
    Bonus: bonusVente(v, DB),
    Statut: v.mode,
    "Mode paiement": v.modePaiement || "",
    "Avance (F)": v.avance || 0,
    "Payé": cashAtSale(v, DB),
    Reste: resteVente(v, DB),
    "Commission (F)": commissionVente(v, DB),
  }));

  // Feuille PRODUCTION
  const prodData = DB.production.map((p: any) => ({
    "N°": p.numero,
    Date: p.date,
    Packs: p.packs,
  }));

  // Feuille DEPENSES
  const depData = DB.depenses.map((d: any) => ({
    Date: d.date,
    Catégorie: d.categorie,
    Libellé: d.libelle,
    Fournisseur: d.fournisseur,
    Montant: d.montant,
  }));

  // Feuille CLIENTS — enrichie avec les cumuls de vente par client (pas
  // seulement les coordonnées), pour voir qui achète combien et qui doit
  // encore de l'argent, sans avoir à recouper avec la feuille VENTES.
  const clientsData = DB.clients.map((c: any) => {
    const ventesClient = DB.ventes.filter((v: any) => v.client === c.nom);
    const totalPacksAchetes = ventesClient.reduce((s: number, v: any) => s + (v.packs || 0), 0);
    const totalPaye = ventesClient.reduce((s: number, v: any) => s + cashAtSale(v, DB), 0);
    const soldeDu = ventesClient.reduce((s: number, v: any) => s + Math.max(0, resteVente(v, DB)), 0);
    return {
      Nom: c.nom,
      Type: c.type,
      Zone: c.zone,
      Téléphone: c.tel,
      "Prix/pack": c.prix,
      "Nb ventes": ventesClient.length,
      "Total packs achetés": totalPacksAchetes,
      "Total payé (F)": totalPaye,
      "Solde dû (F)": soldeDu,
    };
  });

  // Feuille RECOUVREMENTS
  const recData = DB.recouvrements.map((r: any) => ({
    Date: r.date,
    "N° BL": r.numeroBL || "-",
    Client: r.client,
    Montant: r.montant,
    Mode: r.mode,
    Notes: r.notes || "",
  }));

  // Feuille VERSEMENTS
  const versData = DB.versements.map((v: any) => ({
    Date: v.date,
    Type: v.type,
    Bénéficiaire: v.beneficiaire,
    Montant: v.montant,
    Motif: v.motif || "",
  }));

  // Feuille APPORTS DE FONDS
  const apportsData = (DB.apports || []).map((a: any) => ({
    Date: a.date,
    Type: a.type,
    Source: a.source,
    Montant: a.montant,
    Référence: a.reference || "",
    Notes: a.notes || "",
  }));

  // Feuille LIVRAISONS (matière première)
  const livrData = DB.livraisons.map((l: any) => ({
    "N° Lot": l.numero || "",
    Date: l.date,
    Fournisseur: l.fournisseur || "",
    "Kg": l.kg || 0,
    Prix: l.prix || 0,
  }));

  // Feuille EMBALLAGES
  const embData = DB.emballages.map((e: any) => ({
    "N° Lot": e.numeroLot || "",
    Date: e.date,
    "Nb Cartons": e.nombreCartons || 0,
    "Prix/carton": e.prixParCarton || 0,
    Total: e.total || 0,
  }));

  // Feuille MAINTENANCE
  const maintData = DB.maintenance.map((m: any) => ({
    Date: m.date,
    Type: m.type,
    Équipement: m.equipement,
    Description: m.description,
    Coût: m.cout,
    "Prochaine maintenance": m.prochaine || "",
  }));

  // Feuille VEHICULES
  const vehData = DB.vehicules.map((v: any) => ({
    Nom: v.nom || "",
    Chauffeur: v.chauffeur || "",
    Km: v.km || 0,
  }));

  // Feuille VEHICULE OPS
  const vehOpsData = DB.vehiculeOps.map((op: any) => ({
    Date: op.date || "",
    "Véhicule ID": op.vehiculeId || "",
    Type: op.type || "",
    Km: op.km || 0,
    Litres: op.litres || 0,
    Montant: op.montant || 0,
    Description: op.description || "",
  }));

  // Feuille COMMERCIAUX
  const commData = DB.commerciaux.map((c: any) => ({
    Nom: c.nom || "",
    Téléphone: c.tel || "",
    Objectif: c.objectif || "",
  }));

  // Feuille LIVREURS
  const livreurData = DB.livreurs.map((l: any) => ({
    Nom: l.nom || "",
    Téléphone: l.tel || "",
    Objectif: l.objectif || "",
  }));

  // Feuille SYNTHESE_MENSUELLE — une ligne par mois, mouvements uniquement
  // (production, ventes, bonus, caisse). Ne pas confondre avec un solde :
  // ce sont des flux qui repartent de zéro chaque mois, pas l'état cumulé
  // du stock ou de la caisse (voir CLAUDE.md "Balance vs flux").
  const syntheseMensuelleData = computeMonthlyBreakdown(DB).map((m) => ({
    Mois: m.moisLabel,
    "Production (packs)": m.production,
    "Packs vendus": m.packsVendus,
    "Bonus offerts": m.bonusOfferts,
    "Mouvement stock net": m.mouvementStockNet,
    "CA (F)": m.ca,
    "Encaissé (F)": m.encaisse,
    "Dépenses (F)": m.depenses,
    "Mouvement caisse net (F)": m.mouvementCaisseNet,
  }));

  // Feuille ETAT_ACTUEL — photo de l'état réel de l'entreprise à l'instant
  // de l'export : des BALANCES cumulées depuis le début (voir CLAUDE.md
  // "Balance vs flux"), pas des chiffres du mois. Calculs canoniques
  // partagés avec le Dashboard et CaisseSection (lib/helpers.ts), pour que
  // ces chiffres correspondent exactement à ce qui est affiché dans l'appli.
  const totalProduitGlobal = DB.production.reduce((s: number, p: any) => s + (p.packs || 0), 0);
  const totalVenduGlobal = DB.ventes.reduce((s: number, v: any) => s + (v.packs || 0), 0);
  const totalBonusGlobal = DB.ventes.reduce((s: number, v: any) => s + bonusVente(v, DB), 0);
  const creancesTotal = DB.ventes.reduce((s: number, v: any) => s + Math.max(0, resteVente(v, DB)), 0);
  const etatActuelData = [{
    "Date de génération": todayLocal(),
    "Solde de caisse actuel (F)": computeSoldeCaisseActuel(DB),
    "Stock produit fini restant (packs)": computeStockRestant(DB),
    "Stock matière première restant (kg)": Number(computeStockMatierePremiere(DB).toFixed(2)),
    "Total produit depuis le début (packs)": totalProduitGlobal,
    "Total vendu depuis le début (packs)": totalVenduGlobal,
    "Total bonus offerts depuis le début (packs)": totalBonusGlobal,
    "Créances clients totales (F)": creancesTotal,
    "Nombre de clients": DB.clients.length,
  }];

  // Feuille PARAMETRES
  const paramsData = [{
    "Taux commission (%)": DB.params.taux,
    "Solde ouverture": DB.params.soldeOuverture,
    "Prix rouleau": DB.params.prixRouleau,
    "Prix pack": DB.params.prixPack,
    "Prix carton emballage": DB.params.prixCarton,
    "Packs/carton": DB.params.packsParCarton,
    "Bonus seuil": DB.params.bonusSeuil,
  }];

  // Créer le workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(etatActuelData), "ETAT_ACTUEL");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(syntheseMensuelleData), "SYNTHESE_MENSUELLE");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventesData), "VENTES");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodData), "PRODUCTION");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(depData), "DEPENSES");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clientsData), "CLIENTS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recData), "RECOUVREMENTS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(versData), "VERSEMENTS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apportsData), "APPORTS_FONDS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(livrData), "LIVRAISONS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(embData), "EMBALLAGES");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(maintData), "MAINTENANCE");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehData), "VEHICULES");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehOpsData), "VEHICULE_OPS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(commData), "COMMERCIAUX");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(livreurData), "LIVREURS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paramsData), "PARAMETRES");

  return wb;
}

export function ExportExcelButton() {
  const { DB } = useApp();

  const handleExport = async () => {
    try {
      const XLSX = await import("xlsx");
      (window as any).__XLSX__ = XLSX;
      const wb = generateWorkbook(DB);
      const now = todayLocal();
      XLSX.writeFile(wb, `MA2F_Export_${now}.xlsx`);
      toast.success("Export Excel téléchargé");
    } catch (error) {
      console.error("Erreur export:", error);
      toast.error("Erreur lors de l'export");
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      className="bg-green-600 hover:bg-green-700 text-white border-green-600"
      aria-label="Exporter les données en Excel"
    >
      <Download className="w-4 h-4 mr-2" />
      Export Excel
    </Button>
  );
}

// Bouton de sauvegarde complète avec icône Save
export function SaveExcelButton() {
  const { DB } = useApp();

  const handleSave = async () => {
    try {
      const XLSX = await import("xlsx");
      (window as any).__XLSX__ = XLSX;
      const wb = generateWorkbook(DB);
      const now = new Date();
      const dateStr = toLocalDateStr(now);
      const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "h").slice(0, 5);
      XLSX.writeFile(wb, `MA2F_Sauvegarde_${dateStr}_${timeStr}.xlsx`);
      toast.success(`Sauvegarde complète téléchargée (${dateStr})`);
    } catch (error) {
      console.error("Erreur sauvegarde:", error);
      toast.error("Erreur lors de la sauvegarde");
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleSave}
      className="bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
      aria-label="Sauvegarde complète Excel"
    >
      <Save className="w-4 h-4 mr-2" />
      Sauvegarde Excel
    </Button>
  );
}
