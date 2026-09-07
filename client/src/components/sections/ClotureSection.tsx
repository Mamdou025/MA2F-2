/**
 * Section Clôture Journalière — MA2F AquaSachet
 * 
 * Permet à l'admin de clôturer une journée (verrouillage des modifications),
 * voir l'historique des clôtures, et annuler une clôture si nécessaire.
 */
import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Lock, Unlock, Calendar, TrendingUp, TrendingDown, CheckCircle, AlertTriangle } from "lucide-react";
import { createCloture, annulerCloture, getAllClotures, isDateCloturee } from "@/lib/cloture";
import { fmt, fmtDate, todayLocal } from "@/lib/helpers";
import { cfCloturerCaisse, checkCloudFunctionsAvailability } from "@/lib/cloudFunctions";

export default function ClotureSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showAnnulerDialog, setShowAnnulerDialog] = useState(false);
  const [annulerDate, setAnnulerDate] = useState("");
  const [annulerMotif, setAnnulerMotif] = useState("");
  const [montantCompte, setMontantCompte] = useState("");
  const [explicationEcart, setExplicationEcart] = useState("");

  const isAdmin = currentUser?.roles?.includes("admin") || currentUser?.role === "admin";
  const clotures = useMemo(() => getAllClotures(DB), [DB]);
  const dateEstCloturee = useMemo(() => isDateCloturee(selectedDate, DB), [selectedDate, DB]);

  // Calculer les stats du jour sélectionné
  const statsJour = useMemo(() => {
    const ventesJour = DB.ventes.filter((v) => v.date === selectedDate);
    const depensesJour = DB.depenses.filter((d) => d.date === selectedDate);
    const productionJour = DB.production.filter((p) => p.date === selectedDate);
    const recouvrementsJour = DB.recouvrements.filter((r) => r.date === selectedDate);
    const versementsJour = DB.versements.filter((v) => v.date === selectedDate);
    const apportsJour = ((DB as any).apports || []).filter((a: any) => a.date === selectedDate);
    const maintenanceJour = DB.maintenance.filter((m) => m.date === selectedDate);
    const vehiculeOpsJour = DB.vehiculeOps.filter((op) => op.date === selectedDate);

    const entreesVentes = ventesJour
      .filter((v) => v.mode === "Payé")
      .reduce((s, v) => s + v.packs * v.prix, 0);
    const entreesAvances = ventesJour
      .filter((v) => v.mode === "Crédit" && v.avance)
      .reduce((s, v) => s + (v.avance || 0), 0);
    const entreesRecouvrements = recouvrementsJour.reduce((s, r) => s + r.montant, 0);
    const entreesApports = apportsJour.reduce((s: number, a: any) => s + a.montant, 0);
    const totalEntrees = entreesVentes + entreesAvances + entreesRecouvrements + entreesApports;

    const sortiesDepenses = depensesJour.reduce((s, d) => s + d.montant, 0);
    const sortiesVersements = versementsJour.reduce((s, v) => s + v.montant, 0);
    const sortiesMaintenance = maintenanceJour.reduce((s, m) => s + m.cout, 0);
    const sortiesVehicules = vehiculeOpsJour.reduce((s, op) => s + op.montant, 0);
    const totalSorties = sortiesDepenses + sortiesVersements + sortiesMaintenance + sortiesVehicules;

    return {
      ventes: ventesJour.length,
      production: productionJour.reduce((s, p) => s + p.packs, 0),
      totalEntrees,
      totalSorties,
      solde: totalEntrees - totalSorties,
    };
  }, [selectedDate, DB]);

  const handleCloture = () => {
    if (!isAdmin) {
      toast.error("Seul l'administrateur peut clôturer une journée.");
      return;
    }
    if (dateEstCloturee) {
      toast.error("Cette journée est déjà clôturée.");
      return;
    }
    setShowConfirmDialog(true);
  };

  const [saving, setSaving] = useState(false);

  const confirmCloture = async () => {
    if (saving) return;
    setSaving(true);

    // Tenter la clôture serveur (Cloud Functions)
    const cfAvailable = await checkCloudFunctionsAvailability();
    if (cfAvailable) {
      const cfResult = await cfCloturerCaisse({
        date: selectedDate,
        montantCompte: Number(montantCompte) || 0,
        explicationEcart: explicationEcart || undefined,
      });
      if (!cfResult.success) {
        toast.error(cfResult.error || "Clôture serveur échouée");
        setSaving(false);
        return;
      }
      toast.info("Clôture validée par le serveur");
    }

    // Enregistrement local
    const { newDB, cloture } = createCloture(selectedDate, DB, currentUser?.nom || "Admin");
    // Amélioration: argent attendu vs compté
    const compte = Number(montantCompte) || 0;
    const ecart = compte - cloture.soldeJour;
    cloture.montantAttendu = cloture.soldeJour;
    cloture.montantCompte = compte;
    cloture.ecartCaisse = ecart;
    cloture.explicationEcart = explicationEcart || undefined;
    cloture.verrouille = true;
    // Mettre à jour la clôture dans newDB
    const finalDB = {
      ...newDB,
      params: {
        ...newDB.params,
        clotures: (newDB.params.clotures || []).map(c => c.date === selectedDate ? cloture : c),
      },
    };
    setDB(finalDB);
    saveDB(finalDB);
    const ecartMsg = ecart !== 0 ? ` | Écart: ${fmt(ecart)}` : " | Pas d'écart";
    logActivity("cloture", "Clôture", `Clôture du ${fmtDate(selectedDate)} — Attendu: ${fmt(cloture.soldeJour)} | Compté: ${fmt(compte)}${ecartMsg}`);
    toast.success(`Journée du ${fmtDate(selectedDate)} clôturée avec succès.`);
    setShowConfirmDialog(false);
    setMontantCompte(""); setExplicationEcart("");
    setSaving(false);
  };

  const handleAnnuler = (date: string) => {
    setAnnulerDate(date);
    setAnnulerMotif("");
    setShowAnnulerDialog(true);
  };

  const confirmAnnuler = () => {
    if (!annulerMotif.trim()) {
      toast.error("Le motif d'annulation est obligatoire.");
      return;
    }
    const newDB = annulerCloture(annulerDate, DB);
    setDB(newDB);
    saveDB(newDB);
    logActivity("annulation_cloture", "Clôture", `Annulation clôture du ${fmtDate(annulerDate)} — Motif: ${annulerMotif}`);
    toast.success(`Clôture du ${fmtDate(annulerDate)} annulée.`);
    setShowAnnulerDialog(false);
  };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1B4B6B]">Clôture Journalière</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Verrouillez les journées pour empêcher toute modification non autorisée
          </p>
        </div>
      </div>

      {/* Sélection de date et action */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Clôturer une journée
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Date à clôturer</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={todayLocal()}
              />
            </div>
            <div>
              {dateEstCloturee ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 px-4 py-2">
                  <Lock className="h-4 w-4 mr-1" />
                  Journée clôturée
                </Badge>
              ) : (
                <Button onClick={handleCloture} disabled={!isAdmin} className="bg-[#1B4B6B] hover:bg-[#134a84]">
                  <Lock className="h-4 w-4 mr-2" />
                  Clôturer cette journée
                </Button>
              )}
            </div>
          </div>

          {/* Résumé du jour */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-4 border-t">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-muted-foreground">Ventes</p>
              <p className="text-lg font-bold">{statsJour.ventes}</p>
            </div>
            <div className="text-center p-3 bg-purple-50 rounded-lg">
              <p className="text-xs text-muted-foreground">Production</p>
              <p className="text-lg font-bold">{statsJour.production} packs</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <TrendingUp className="h-3 w-3" /> Entrées
              </p>
              <p className="text-lg font-bold text-green-700">{fmt(statsJour.totalEntrees)}</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <TrendingDown className="h-3 w-3" /> Sorties
              </p>
              <p className="text-lg font-bold text-red-700">{fmt(statsJour.totalSorties)}</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <p className="text-xs text-muted-foreground">Solde jour</p>
              <p className={`text-lg font-bold ${statsJour.solde >= 0 ? "text-green-700" : "text-red-700"}`}>
                {fmt(statsJour.solde)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Historique des clôtures */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Historique des clôtures ({clotures.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clotures.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Aucune journée clôturée pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-[#1B4B6B]/5">
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Clôturée par</th>
                    <th className="text-right p-3 font-medium">Entrées</th>
                    <th className="text-right p-3 font-medium">Sorties</th>
                    <th className="text-right p-3 font-medium">Attendu</th>
                    <th className="text-right p-3 font-medium">Compté</th>
                    <th className="text-right p-3 font-medium">Écart</th>
                    <th className="text-center p-3 font-medium">Statut</th>
                    {isAdmin && <th className="text-center p-3 font-medium">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {clotures.map((c) => (
                    <tr key={c.date} className="border-b hover:bg-muted/50">
                      <td className="p-3 font-medium">{fmtDate(c.date)}</td>
                      <td className="p-3">{c.clotureePar}</td>
                      <td className="p-3 text-right text-green-700">{fmt(c.totalEntrees)}</td>
                      <td className="p-3 text-right text-red-700">{fmt(c.totalSorties)}</td>
                      <td className="p-3 text-right font-medium">{fmt(c.montantAttendu ?? c.soldeJour)}</td>
                      <td className="p-3 text-right font-medium">{c.montantCompte != null ? fmt(c.montantCompte) : "—"}</td>
                      <td className={`p-3 text-right font-medium ${(c.ecartCaisse || 0) === 0 ? "text-green-700" : "text-red-700"}`}>
                        {c.ecartCaisse != null ? fmt(c.ecartCaisse) : "—"}
                      </td>
                      <td className="p-3 text-center">
                        {c.verrouille ? (
                          <Badge className={`text-xs ${(c.ecartCaisse || 0) === 0 ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}`}>
                            {(c.ecartCaisse || 0) === 0 ? "✓ OK" : "⚠ Écart"}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Ancien</Badge>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="p-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAnnuler(c.date)}
                            className="text-orange-600 hover:text-orange-800"
                          >
                            <Unlock className="h-4 w-4 mr-1" />
                            Annuler
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Avertissement */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800">Règles de clôture</p>
              <ul className="text-sm text-amber-700 mt-2 space-y-1 list-disc list-inside">
                <li>Après clôture, aucun utilisateur (sauf admin) ne peut modifier les données de la journée</li>
                <li>L'administrateur peut modifier une journée clôturée mais doit fournir un motif obligatoire</li>
                <li>L'annulation d'une clôture nécessite un motif et est tracée dans le journal</li>
                <li>Les clôtures sont irréversibles pour les utilisateurs non-admin</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de confirmation de clôture */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la clôture</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p>
              Vous allez clôturer la journée du <strong>{fmtDate(selectedDate)}</strong>.
            </p>
            <div className="bg-muted p-3 rounded-lg space-y-1 text-sm">
              <p>Entrées : <strong className="text-green-700">{fmt(statsJour.totalEntrees)}</strong></p>
              <p>Sorties : <strong className="text-red-700">{fmt(statsJour.totalSorties)}</strong></p>
              <p>Solde attendu : <strong className="text-blue-700">{fmt(statsJour.solde)}</strong></p>
              <p>Ventes : <strong>{statsJour.ventes}</strong></p>
              <p>Production : <strong>{statsJour.production} packs</strong></p>
            </div>
            <div className="border-t pt-4 space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Montant réellement compté en caisse (F) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  value={montantCompte}
                  onChange={(e) => setMontantCompte(e.target.value)}
                  placeholder="Saisir le montant physique en caisse..."
                />
              </div>
              {montantCompte && Number(montantCompte) !== statsJour.solde && (
                <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg space-y-2">
                  <p className="text-sm font-medium text-orange-800">
                    Écart détecté : {fmt(Number(montantCompte) - statsJour.solde)}
                  </p>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Explication de l'écart</label>
                    <Input
                      value={explicationEcart}
                      onChange={(e) => setExplicationEcart(e.target.value)}
                      placeholder="Raison de l'écart..."
                    />
                  </div>
                </div>
              )}
              {montantCompte && Number(montantCompte) === statsJour.solde && (
                <div className="bg-green-50 border border-green-200 p-3 rounded-lg">
                  <p className="text-sm font-medium text-green-800">Caisse équilibrée — pas d'écart</p>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Après clôture, les données de cette journée seront <strong>verrouillées</strong> et ne pourront plus être modifiées.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Annuler
            </Button>
            <Button onClick={confirmCloture} className="bg-[#1B4B6B] hover:bg-[#134a84]">
              <Lock className="h-4 w-4 mr-2" />
              Confirmer la clôture
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog d'annulation de clôture */}
      <Dialog open={showAnnulerDialog} onOpenChange={setShowAnnulerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler la clôture</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p>
              Vous allez annuler la clôture du <strong>{fmtDate(annulerDate)}</strong>.
            </p>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Motif d'annulation <span className="text-red-500">*</span>
              </label>
              <Input
                value={annulerMotif}
                onChange={(e) => setAnnulerMotif(e.target.value)}
                placeholder="Expliquez pourquoi vous annulez cette clôture..."
              />
            </div>
            <p className="text-sm text-amber-600">
              Cette action sera tracée dans le journal d'activité.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnnulerDialog(false)}>
              Annuler
            </Button>
            <Button onClick={confirmAnnuler} variant="destructive">
              <Unlock className="h-4 w-4 mr-2" />
              Confirmer l'annulation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
