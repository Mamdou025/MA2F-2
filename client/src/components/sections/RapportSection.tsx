import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { fmt, fmtDate, cashAtSale, resteVente, bonusVente, getMoisCourant, todayLocal } from "@/lib/helpers";
import type { MouvementStock } from "@/lib/stock";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

function formatDateLong(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T12:00:00");
  const jours = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const moisNoms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  return `${jours[d.getDay()]} ${d.getDate()} ${moisNoms[d.getMonth()]} ${d.getFullYear()}`;
}

export default function RapportSection() {
  const { DB, currentUser } = useApp();
  const [dateRapport, setDateRapport] = useState(todayLocal());

  const ventesJour = useMemo(() => DB.ventes.filter((v) => v.date === dateRapport), [DB, dateRapport]);
  const depJour = useMemo(() => DB.depenses.filter((d) => d.date === dateRapport), [DB, dateRapport]);
  const recJour = useMemo(() => DB.recouvrements.filter((r) => r.date === dateRapport), [DB, dateRapport]);
  const prodJour = useMemo(() => DB.production.filter((p) => p.date === dateRapport), [DB, dateRapport]);

  const prodTotal = prodJour.reduce((s, p) => s + p.packs, 0);
  const venteCash = ventesJour.reduce((s, v) => s + cashAtSale(v, DB), 0);
  const venteCredit = ventesJour.filter((v) => v.mode === "Crédit").reduce((s, v) => s + Math.max(0, resteVente(v, DB)), 0);
  const caTotal = ventesJour.reduce((s, v) => s + v.packs * v.prix, 0);
  const encaisseJour = ventesJour.reduce((s, v) => s + cashAtSale(v, DB), 0) + recJour.reduce((s, r) => s + r.montant, 0);
  const depTotal = depJour.reduce((s, d) => s + d.montant, 0);
  const soldeJour = encaisseJour - depTotal;
  const recouvreTot = recJour.reduce((s, r) => s + r.montant, 0);
  const nbPacksVendus = ventesJour.reduce((s, v) => s + v.packs, 0);
  const bonusJourTotal = ventesJour.reduce((s, v) => s + bonusVente(v, DB), 0);
  // Packs remis en don à la police (mouvements de stock type "don_police",
  // même source que la colonne "Don police" de la Réconciliation livraison),
  // tous livreurs confondus pour le jour du rapport.
  const mouvementsStock: MouvementStock[] = (DB.mouvementsStock || []) as MouvementStock[];
  const donPoliceJourTotal = mouvementsStock
    .filter((m) => m.date === dateRapport && m.type === "don_police" && m.produit === "sachet_plein")
    .reduce((s, m) => s + m.quantite, 0);

  // Stock après production (simplifié)
  const totalProdCumul = DB.production.filter((p) => p.date <= dateRapport).reduce((s, p) => s + p.packs, 0);
  const totalVenduCumul = DB.ventes.filter((v) => v.date <= dateRapport).reduce((s, v) => s + v.packs, 0);
  const stockApresProd = totalProdCumul - totalVenduCumul;

  // Copier pour WhatsApp
  const handleCopyWhatsApp = () => {
    let txt = `🏭 *MA2F*\n`;
    txt += `Rapport journalier d'activité\n`;
    txt += `*${formatDateLong(dateRapport)}*\n`;
    txt += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    txt += `📊 *Production :* ${prodTotal} packs\n`;
    txt += `💰 *Encaissé :* ${fmt(encaisseJour)}\n`;
    txt += `💸 *Dépenses :* ${fmt(depTotal)} (${depJour.length} lignes)\n`;
    txt += `📈 *Solde du jour :* ${fmt(soldeJour)}\n\n`;

    if (ventesJour.length > 0) {
      txt += `💰 *Ventes du jour :*\n`;
      ventesJour.forEach((v) => {
        txt += `  • ${v.numero} - ${v.client} : ${v.packs} packs × ${fmt(v.prix).replace(" F", "")} = ${fmt(v.packs * v.prix)} (${v.mode})\n`;
      });
      txt += `\n`;
    }

    txt += `📊 *Synthèse du jour :*\n`;
    txt += `  Production : ${prodTotal} packs\n`;
    txt += `  Stock après prod : ${stockApresProd} packs\n`;
    txt += `  CA total : ${fmt(caTotal)}\n`;
    txt += `  Nb packs vendu : ${nbPacksVendus}\n`;
    txt += `  Bonus offert : ${bonusJourTotal} packs\n`;
    txt += `  Don police : ${donPoliceJourTotal} packs\n`;
    txt += `  Vente cash : ${fmt(venteCash)}\n`;
    txt += `  Vente crédit : ${fmt(venteCredit)}\n`;
    txt += `  Recouvré : ${fmt(recouvreTot)}\n`;
    txt += `  Dépenses : ${fmt(depTotal)}\n\n`;
    txt += `💰 *Argent net dans la caisse :* ${fmt(soldeJour)}\n\n`;
    txt += `━━━━━━━━━━━━━━━━━━━━\n`;
    txt += `MA2F • ${currentUser?.nom || "Admin"}`;

    navigator.clipboard.writeText(txt).then(() => {
      toast.success("Rapport copié pour WhatsApp !");
    }).catch(() => {
      toast.error("Erreur lors de la copie");
    });
  };

  // Imprimer
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* En-tête avec date et boutons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>📊</span> Rapport journalier
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Date :</Label>
            <Input type="date" value={dateRapport} onChange={(e) => setDateRapport(e.target.value)} className="w-auto" />
          </div>
          <Button onClick={handleCopyWhatsApp} className="bg-green-600 hover:bg-green-700 text-white">
            <span className="mr-2">📋</span> Copier pour WhatsApp
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <span className="mr-2">🖨️</span> Imprimer
          </Button>
        </div>
      </div>

      {/* Rapport imprimable */}
      <div className="bg-white border rounded-lg p-6 print:border-none print:p-0">
        {/* En-tête du rapport */}
        <div className="text-center mb-6">
          <p className="text-3xl font-bold text-gray-900 flex items-center justify-center gap-2">
            <span>🏭</span> MA2F
          </p>
          <p className="text-gray-500 mt-1">Rapport journalier d'activité</p>
          <p className="text-lg font-bold text-gray-900 mt-2">{formatDateLong(dateRapport)}</p>
          <div className="w-full h-1 bg-[#1B4B6B] mt-4 rounded"></div>
        </div>

        {/* 4 KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="border-2 border-blue-200 bg-blue-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">🏭 Production</p>
              <p className="text-2xl font-bold text-blue-700">{prodTotal}</p>
              <p className="text-xs text-gray-400">packs</p>
            </CardContent>
          </Card>
          <Card className="border-2 border-green-200 bg-green-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">💰 Encaissé</p>
              <p className="text-2xl font-bold text-green-700">{fmt(encaisseJour)}</p>
              <p className="text-xs text-gray-400">vente cash + recouvrement</p>
            </CardContent>
          </Card>
          <Card className="border-2 border-red-200 bg-red-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">💸 Dépenses</p>
              <p className="text-2xl font-bold text-red-600">{fmt(depTotal)}</p>
              <p className="text-xs text-gray-400">{depJour.length} lignes</p>
            </CardContent>
          </Card>
          <Card className="border-2 border-purple-200 bg-purple-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">📈 Solde du jour</p>
              <p className={`text-2xl font-bold ${soldeJour >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(soldeJour)}</p>
              <p className="text-xs text-gray-400">Encaissé - Dépenses</p>
            </CardContent>
          </Card>
        </div>

        {/* Ventes du jour */}
        <div className="mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span>💰</span> Ventes du jour
          </h3>
          {ventesJour.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                    <TableHead className="text-white font-semibold">N° BL</TableHead>
                    <TableHead className="text-white font-semibold">Client</TableHead>
                    <TableHead className="text-white font-semibold text-right">Packs</TableHead>
                    <TableHead className="text-white font-semibold text-right">Montant</TableHead>
                    <TableHead className="text-white font-semibold">Mode</TableHead>
                    <TableHead className="text-white font-semibold text-right">Payé</TableHead>
                    <TableHead className="text-white font-semibold text-right">Reste</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ventesJour.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-sm">{v.numero}</TableCell>
                      <TableCell className="font-medium">{v.client}</TableCell>
                      <TableCell className="text-right">{v.packs}</TableCell>
                      <TableCell className="text-right">{fmt(v.packs * v.prix)}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.mode === "Payé" ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}`}>
                          {v.mode}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">{fmt(cashAtSale(v, DB))}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">{fmt(resteVente(v, DB))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-gray-400 italic">Aucune vente ce jour</p>
          )}
        </div>

        {/* Synthèse du jour */}
        <Card className="border-2 border-blue-100 bg-blue-50/20 mb-6">
          <CardContent className="p-5">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📊</span> Synthèse du jour
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <span className="text-sm text-gray-500">Production : </span>
                <span className="font-bold">{prodTotal} packs</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Stock après prod : </span>
                <span className="font-bold">{stockApresProd} packs</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">CA total : </span>
                <span className="font-bold">{fmt(caTotal)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Nb packs vendu : </span>
                <span className="font-bold">{nbPacksVendus}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Bonus offert : </span>
                <span className="font-bold text-orange-600">{bonusJourTotal} packs</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Don police : </span>
                <span className="font-bold text-rose-600">{donPoliceJourTotal} packs</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-sm text-gray-500">Vente cash : </span>
                <span className="font-bold text-green-600">{fmt(venteCash)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Vente crédit : </span>
                <span className="font-bold text-red-600">{fmt(venteCredit)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Recouvré : </span>
                <span className="font-bold text-green-600">{fmt(recouvreTot)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Dépenses : </span>
                <span className="font-bold text-red-600">{fmt(depTotal)}</span>
              </div>
            </div>

            <div className="border-t border-blue-200 mt-4 pt-4 text-center">
              <p className="text-sm text-gray-500 flex items-center justify-center gap-1">💰 Argent net dans la caisse aujourd'hui</p>
              <p className={`text-3xl font-bold mt-1 ${soldeJour >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(soldeJour)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Pied de page */}
        <div className="flex justify-between items-center text-xs text-gray-400 border-t pt-3">
          <span>Rapport généré le {new Date().toLocaleDateString("fr-FR")} {new Date().toLocaleTimeString("fr-FR")}</span>
          <span>MA2F • {currentUser?.nom || "Admin"}</span>
        </div>
      </div>
    </div>
  );
}
