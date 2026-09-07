import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toLocalDateStr, todayLocal } from "@/lib/helpers";
import {
  genererRapportComptable,
  exporterCSV,
  exporterBalanceCSV,
  PLAN_COMPTABLE,
  type RapportComptable,
} from "@/lib/exportComptable";
import {
  validateAuditChain,
  type AuditEntry,
  type ChainValidationResult,
} from "@/lib/auditChain";

export default function ComptabiliteSection() {
  const { DB } = useApp();
  const [dateDebut, setDateDebut] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return toLocalDateStr(d);
  });
  const [dateFin, setDateFin] = useState(() => todayLocal());
  const [rapport, setRapport] = useState<RapportComptable | null>(null);
  const [chainResult, setChainResult] = useState<ChainValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleGenerer = () => {
    const r = genererRapportComptable(DB, dateDebut, dateFin);
    setRapport(r);
    toast.success(`${r.ecritures.length} écritures générées`);
  };

  const handleExportCSV = () => {
    if (!rapport) return;
    const csv = exporterCSV(rapport.ecritures);
    downloadFile(csv, `ecritures_${dateDebut}_${dateFin}.csv`, "text/csv");
    toast.success("Export CSV téléchargé");
  };

  const handleExportBalance = () => {
    if (!rapport) return;
    const csv = exporterBalanceCSV(rapport.balance);
    downloadFile(csv, `balance_${dateDebut}_${dateFin}.csv`, "text/csv");
    toast.success("Balance CSV téléchargée");
  };

  const handleValidateChain = async () => {
    setIsValidating(true);
    try {
      const entries = (DB.auditChain || []) as AuditEntry[];
      const result = await validateAuditChain(entries);
      setChainResult(result);
      if (result.valid) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (e) {
      toast.error("Erreur lors de la validation");
    } finally {
      setIsValidating(false);
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob(["\ufeff" + content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Comptabilité SYSCOHADA</h2>
        <Badge className="bg-blue-100 text-blue-800">Plan Comptable OHADA</Badge>
      </div>

      <Tabs defaultValue="ecritures" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ecritures">Écritures</TabsTrigger>
          <TabsTrigger value="balance">Balance</TabsTrigger>
          <TabsTrigger value="grandlivre">Grand Livre</TabsTrigger>
          <TabsTrigger value="integrite">Intégrité</TabsTrigger>
        </TabsList>

        {/* Onglet Écritures */}
        <TabsContent value="ecritures" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Générer les écritures comptables</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="text-sm font-medium text-gray-700">Date début</label>
                  <input
                    type="date"
                    value={dateDebut}
                    onChange={(e) => setDateDebut(e.target.value)}
                    className="block mt-1 border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Date fin</label>
                  <input
                    type="date"
                    value={dateFin}
                    onChange={(e) => setDateFin(e.target.value)}
                    className="block mt-1 border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <Button onClick={handleGenerer} className="bg-blue-600 hover:bg-blue-700">
                  Générer
                </Button>
                {rapport && (
                  <Button variant="outline" onClick={handleExportCSV}>
                    Exporter CSV
                  </Button>
                )}
              </div>

              {rapport && (
                <>
                  {/* Résumé */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
                    <div className="p-3 bg-blue-50 rounded-lg text-center">
                      <p className="text-xl font-bold text-blue-700">{rapport.ecritures.length}</p>
                      <p className="text-xs text-gray-600">Écritures</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg text-center">
                      <p className="text-xl font-bold text-green-700">{rapport.totaux.totalDebit.toLocaleString("fr-FR")} F</p>
                      <p className="text-xs text-gray-600">Total Débit</p>
                    </div>
                    <div className="p-3 bg-orange-50 rounded-lg text-center">
                      <p className="text-xl font-bold text-orange-700">{rapport.totaux.totalCredit.toLocaleString("fr-FR")} F</p>
                      <p className="text-xs text-gray-600">Total Crédit</p>
                    </div>
                    <div className={`p-3 rounded-lg text-center ${rapport.totaux.resultat >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                      <p className={`text-xl font-bold ${rapport.totaux.resultat >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {rapport.totaux.resultat.toLocaleString("fr-FR")} F
                      </p>
                      <p className="text-xs text-gray-600">Résultat</p>
                    </div>
                  </div>

                  {/* Tableau des écritures */}
                  <div className="overflow-x-auto mt-4">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="text-left p-2 border">Date</th>
                          <th className="text-left p-2 border">Journal</th>
                          <th className="text-left p-2 border">Pièce</th>
                          <th className="text-left p-2 border">Libellé</th>
                          <th className="text-center p-2 border">Débit</th>
                          <th className="text-center p-2 border">Crédit</th>
                          <th className="text-right p-2 border">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rapport.ecritures.slice(0, 100).map((e, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="p-2 border text-xs">{e.date}</td>
                            <td className="p-2 border">
                              <Badge variant="outline" className="text-xs">
                                {e.journal}
                              </Badge>
                            </td>
                            <td className="p-2 border text-xs font-mono">{e.piece}</td>
                            <td className="p-2 border text-xs">{e.libelle}</td>
                            <td className="p-2 border text-center text-xs font-mono">{e.compteDebit}</td>
                            <td className="p-2 border text-center text-xs font-mono">{e.compteCredit}</td>
                            <td className="p-2 border text-right text-xs font-medium">{e.montant.toLocaleString("fr-FR")} F</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rapport.ecritures.length > 100 && (
                      <p className="text-xs text-gray-500 mt-2 text-center">
                        Affichage limité à 100 lignes. Exportez en CSV pour voir toutes les {rapport.ecritures.length} écritures.
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Onglet Balance */}
        <TabsContent value="balance" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Balance Générale</CardTitle>
              {rapport && (
                <Button variant="outline" size="sm" onClick={handleExportBalance}>
                  Exporter CSV
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!rapport ? (
                <p className="text-gray-500 text-center py-8">Générez d'abord les écritures dans l'onglet "Écritures"</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left p-2 border">Compte</th>
                        <th className="text-left p-2 border">Libellé</th>
                        <th className="text-right p-2 border">Total Débit</th>
                        <th className="text-right p-2 border">Total Crédit</th>
                        <th className="text-right p-2 border">Solde Débiteur</th>
                        <th className="text-right p-2 border">Solde Créditeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rapport.balance.map((l, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="p-2 border font-mono text-xs font-medium">{l.compte}</td>
                          <td className="p-2 border text-xs">{l.libelle}</td>
                          <td className="p-2 border text-right text-xs">{l.totalDebit > 0 ? l.totalDebit.toLocaleString("fr-FR") : ""}</td>
                          <td className="p-2 border text-right text-xs">{l.totalCredit > 0 ? l.totalCredit.toLocaleString("fr-FR") : ""}</td>
                          <td className="p-2 border text-right text-xs font-medium text-blue-700">{l.soldeDebiteur > 0 ? l.soldeDebiteur.toLocaleString("fr-FR") : ""}</td>
                          <td className="p-2 border text-right text-xs font-medium text-red-700">{l.soldeCrediteur > 0 ? l.soldeCrediteur.toLocaleString("fr-FR") : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-200 font-bold">
                        <td className="p-2 border" colSpan={2}>TOTAUX</td>
                        <td className="p-2 border text-right text-xs">{rapport.totaux.totalDebit.toLocaleString("fr-FR")}</td>
                        <td className="p-2 border text-right text-xs">{rapport.totaux.totalCredit.toLocaleString("fr-FR")}</td>
                        <td className="p-2 border text-right text-xs text-blue-700">
                          {rapport.balance.reduce((s, l) => s + l.soldeDebiteur, 0).toLocaleString("fr-FR")}
                        </td>
                        <td className="p-2 border text-right text-xs text-red-700">
                          {rapport.balance.reduce((s, l) => s + l.soldeCrediteur, 0).toLocaleString("fr-FR")}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Onglet Grand Livre */}
        <TabsContent value="grandlivre" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Grand Livre</CardTitle>
            </CardHeader>
            <CardContent>
              {!rapport ? (
                <p className="text-gray-500 text-center py-8">Générez d'abord les écritures dans l'onglet "Écritures"</p>
              ) : (
                <div className="space-y-6">
                  {Object.entries(rapport.grandLivre)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([compte, lignes]) => (
                      <div key={compte} className="border rounded-lg overflow-hidden">
                        <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                          <span className="font-mono font-bold text-sm">{compte}</span>
                          <span className="text-sm text-gray-600">
                            {(PLAN_COMPTABLE as any)[compte]?.label || `Compte ${compte}`}
                          </span>
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="text-left p-2">Date</th>
                              <th className="text-left p-2">Pièce</th>
                              <th className="text-left p-2">Libellé</th>
                              <th className="text-right p-2">Débit</th>
                              <th className="text-right p-2">Crédit</th>
                              <th className="text-right p-2">Solde</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lignes.map((l, i) => (
                              <tr key={i} className="border-t hover:bg-gray-50">
                                <td className="p-2">{l.date}</td>
                                <td className="p-2 font-mono">{l.piece}</td>
                                <td className="p-2">{l.libelle.slice(0, 50)}</td>
                                <td className="p-2 text-right">{l.debit > 0 ? l.debit.toLocaleString("fr-FR") : ""}</td>
                                <td className="p-2 text-right">{l.credit > 0 ? l.credit.toLocaleString("fr-FR") : ""}</td>
                                <td className={`p-2 text-right font-medium ${l.solde >= 0 ? "text-blue-700" : "text-red-700"}`}>
                                  {l.solde.toLocaleString("fr-FR")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Onglet Intégrité */}
        <TabsContent value="integrite" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vérification d'intégrité de la chaîne d'audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Chaque entrée d'audit est liée à la précédente par un hash SHA-256. Si une entrée est modifiée ou supprimée,
                la chaîne est rompue et l'intégrité est compromise.
              </p>

              <div className="flex items-center gap-4">
                <Button onClick={handleValidateChain} disabled={isValidating} className="bg-indigo-600 hover:bg-indigo-700">
                  {isValidating ? "Vérification..." : "Vérifier l'intégrité"}
                </Button>
                <span className="text-sm text-gray-500">
                  {(DB.auditChain || []).length} entrées dans la chaîne
                </span>
              </div>

              {chainResult && (
                <div className={`p-4 rounded-lg border-2 ${chainResult.valid ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-2xl ${chainResult.valid ? "text-green-600" : "text-red-600"}`}>
                      {chainResult.valid ? "✓" : "✗"}
                    </span>
                    <span className={`font-bold ${chainResult.valid ? "text-green-800" : "text-red-800"}`}>
                      {chainResult.valid ? "CHAÎNE INTÈGRE" : "CHAÎNE COMPROMISE"}
                    </span>
                  </div>
                  <p className="text-sm">{chainResult.message}</p>
                  {chainResult.brokenEntry && (
                    <div className="mt-3 p-3 bg-white rounded border">
                      <p className="text-xs font-medium text-red-700">Détails de la rupture :</p>
                      <p className="text-xs">Position: #{chainResult.brokenAt}</p>
                      <p className="text-xs">Action: {chainResult.brokenEntry.action}</p>
                      <p className="text-xs">Module: {chainResult.brokenEntry.module}</p>
                      <p className="text-xs">Utilisateur: {chainResult.brokenEntry.userEmail}</p>
                      <p className="text-xs">Date: {new Date(chainResult.brokenEntry.timestamp).toLocaleString("fr-FR")}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Explication du système */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Comment fonctionne la chaîne d'audit ?</h4>
                <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
                  <li>Chaque action critique génère une entrée signée numériquement</li>
                  <li>Le hash de chaque entrée inclut le hash de l'entrée précédente (chaînage)</li>
                  <li>Si une entrée est modifiée, tous les hash suivants deviennent invalides</li>
                  <li>La suppression d'une entrée rompt la chaîne de manière détectable</li>
                  <li>Ce mécanisme garantit l'immuabilité de la piste d'audit</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
