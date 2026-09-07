import { useState, useMemo, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { fmt, getMoisCourant } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface CoutRevient {
  sachet: number;
  eau: number;
  energie: number;
  salaires: number;
  maintenance: number;
  autres: number;
  production: number;
}

const POSTES = [
  { key: "sachet", label: "Sachet / emballage", icon: "📦" },
  { key: "eau", label: "Eau", icon: "💧" },
  { key: "energie", label: "Énergie", icon: "⚡" },
  { key: "salaires", label: "Salaires", icon: "👤" },
  { key: "maintenance", label: "Maintenance", icon: "🔧" },
  { key: "autres", label: "Autres charges", icon: "➕" },
] as const;

export default function AnalytiqueSection() {
  const { DB, setDB, saveDB, logActivity } = useApp();
  const mois = getMoisCourant();

  // Pré-remplir maintenance depuis les données du mois
  const maintenanceMois = useMemo(() =>
    DB.maintenance.filter((m) => (m.date || "").startsWith(mois)).reduce((s, m) => s + (m.cout || 0), 0),
    [DB, mois]
  );

  // Pré-remplir production depuis les données du mois
  const productionMois = useMemo(() =>
    DB.production.filter((p) => (p.date || "").startsWith(mois)).reduce((s, p) => s + p.packs, 0),
    [DB, mois]
  );

  // Coût "sachet/emballage" calculé automatiquement à partir des paramètres
  // (prix du rouleau plastique, rendement packs/kg, prix carton, packs/carton)
  // et de la production du mois, au lieu d'une saisie manuelle.
  const coutMatierePerPack = (DB.params.prixRouleau || 3650) / (DB.params.tauxSachetsParKg || 17);
  const coutCartonPerPack = (DB.params.prixCarton || 3000) / (DB.params.packsParCarton || 1000);
  const sachetPerPack = coutMatierePerPack + coutCartonPerPack;
  const sachetAutoMois = useMemo(() => sachetPerPack * productionMois,
    [sachetPerPack, productionMois]
  );

  // Charger les coûts sauvegardés ou initialiser
  const savedCouts = (DB as any).coutRevient as CoutRevient | undefined;

  const [couts, setCouts] = useState<CoutRevient>({
    sachet: savedCouts?.sachet || sachetAutoMois,
    eau: savedCouts?.eau || 0,
    energie: savedCouts?.energie || 0,
    salaires: savedCouts?.salaires || 0,
    maintenance: savedCouts?.maintenance || maintenanceMois,
    autres: savedCouts?.autres || 0,
    production: savedCouts?.production || productionMois,
  });

  // Mettre à jour les valeurs pré-remplies quand les données changent
  useEffect(() => {
    if (!savedCouts) {
      setCouts((prev) => ({
        ...prev,
        sachet: sachetAutoMois,
        maintenance: maintenanceMois,
        production: productionMois,
      }));
    }
  }, [sachetAutoMois, maintenanceMois, productionMois, savedCouts]);

  const totalCouts = couts.sachet + couts.eau + couts.energie + couts.salaires + couts.maintenance + couts.autres;
  const coutParPack = couts.production > 0 ? totalCouts / couts.production : 0;

  // Prix de vente moyen du mois
  const ventesMois = useMemo(() =>
    DB.ventes.filter((v) => (v.date || "").startsWith(mois)),
    [DB, mois]
  );
  const prixVenteMoyen = ventesMois.length > 0
    ? ventesMois.reduce((s, v) => s + v.prix, 0) / ventesMois.length
    : 0;

  const marge = prixVenteMoyen > 0 ? prixVenteMoyen - coutParPack : 0;
  const margePct = prixVenteMoyen > 0 ? ((marge / prixVenteMoyen) * 100).toFixed(1) : "-";

  const handleChange = (key: string, value: string) => {
    setCouts((prev) => ({ ...prev, [key]: Number(value) || 0 }));
  };

  const handleSave = () => {
    const updated = { ...DB, coutRevient: couts };
    setDB(updated);
    saveDB(updated);
    logActivity("update", "Coût de revient", `Coût/pack: ${fmt(coutParPack)}`);
    toast.success("Coûts enregistrés");
  };

  const handleReset = () => {
    setCouts({
      sachet: sachetAutoMois,
      eau: 0,
      energie: 0,
      salaires: 0,
      maintenance: maintenanceMois,
      autres: 0,
      production: productionMois,
    });
    toast.info("Formulaire réinitialisé");
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <span>📊</span> Comptabilité analytique — Coût de revient par pack
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Formulaire des coûts */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Coûts mensuels par poste (FCFA)</h3>
            <div className="space-y-4">
              {POSTES.map((poste) => (
                <div key={poste.key}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <span>{poste.icon}</span> {poste.label}
                    </span>
                    <Input
                      type="number"
                      className="w-40 text-right"
                      value={couts[poste.key as keyof CoutRevient] || ""}
                      onChange={(e) => handleChange(poste.key, e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  {poste.key === "sachet" && (
                    <p className="text-xs text-gray-400 mt-1">
                      💡 Calculé auto depuis les Paramètres : {fmt(coutMatierePerPack)}/pack matière (rouleau) + {fmt(coutCartonPerPack)}/pack carton, × {productionMois} packs produits ce mois. Modifiable.
                    </p>
                  )}
                </div>
              ))}

              <div className="border-t pt-4 mt-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <span>📊</span> Production du mois (packs)
                  </span>
                  <Input
                    type="number"
                    className="w-40 text-right"
                    value={couts.production || ""}
                    onChange={(e) => handleChange("production", e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                  <span className="mr-2">💾</span> Enregistrer
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <span className="mr-2">↺</span> Réinitialiser
                </Button>
              </div>

              <p className="text-xs text-gray-400 mt-2">
                💡 « Sachet/emballage », « Maintenance » et la production sont pré-remplis automatiquement depuis vos Paramètres et vos données du mois. Vous pouvez toujours les corriger.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* KPI et tableau */}
        <div className="space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-2 border-red-200">
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Coût de revient / pack</p>
                <p className="text-2xl font-bold text-red-600">{fmt(coutParPack)}</p>
              </CardContent>
            </Card>
            <Card className="border-2 border-green-200">
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">Marge / pack</p>
                <p className={`text-2xl font-bold ${marge >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {prixVenteMoyen > 0 ? `${fmt(marge)} (${margePct}%)` : "-"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Prix de vente moyen */}
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Prix de vente moyen / pack (calculé sur vos ventes du mois)</p>
              <p className="text-xl font-bold text-[#1B4B6B]">
                {ventesMois.length > 0 ? fmt(prixVenteMoyen) : <span className="text-red-500">Pas de vente ce mois</span>}
              </p>
            </CardContent>
          </Card>

          {/* Tableau de répartition */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-lg font-bold text-gray-900 mb-3">Répartition du coût</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                      <TableHead className="text-white font-semibold">Poste</TableHead>
                      <TableHead className="text-white font-semibold text-right">Coût mensuel</TableHead>
                      <TableHead className="text-white font-semibold text-right">Coût / pack</TableHead>
                      <TableHead className="text-white font-semibold text-right">Part</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {POSTES.map((poste) => {
                      const val = couts[poste.key as keyof CoutRevient];
                      const perPack = couts.production > 0 ? val / couts.production : 0;
                      const part = totalCouts > 0 ? ((val / totalCouts) * 100).toFixed(0) : "0";
                      return (
                        <TableRow key={poste.key}>
                          <TableCell className="font-medium flex items-center gap-2">
                            <span>{poste.icon}</span> {poste.label.split(" / ")[0]}
                          </TableCell>
                          <TableCell className="text-right">{fmt(val)}</TableCell>
                          <TableCell className="text-right">{fmt(perPack)}</TableCell>
                          <TableCell className="text-right">{part}%</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>TOTAL</TableCell>
                      <TableCell className="text-right">{fmt(totalCouts)}</TableCell>
                      <TableCell className="text-right">{fmt(coutParPack)}</TableCell>
                      <TableCell className="text-right">100%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
