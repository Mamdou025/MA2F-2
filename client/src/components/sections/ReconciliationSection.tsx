import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, todayLocal, toLocalDateStr } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Truck, CheckCircle2, AlertTriangle, XCircle, ClipboardCheck, ChevronDown, ChevronUp } from "lucide-react";
import type { MouvementStock } from "@/lib/stock";
import type { ReconciliationRecord } from "@/lib/types";

export default function ReconciliationSection() {
  const { DB, setDB, saveDB, currentUser, logActivity } = useApp();
  const [date, setDate] = useState(todayLocal());
  // Journée en cours (aujourd'hui) : une tournée du jour même n'est pas
  // forcément terminée, donc un écart non nul n'est pas une anomalie tant
  // que la journée n'est pas finie — on l'affiche de façon neutre plutôt
  // qu'en alerte rouge/orange, contrairement aux dates passées où un écart
  // reste un vrai signal (vol, erreur, vente non saisie).
  const isAujourdhui = date === todayLocal();
  const [selectedLivreur, setSelectedLivreur] = useState("");
  const [openReconcil, setOpenReconcil] = useState(false);
  // Détail dépliable "ventes tapées / restant" par livreur (voir livreurData
  // ci-dessous) : répond à "quelles ventes sont déjà enregistrées, et combien
  // de packs n'ont encore aucune trace" directement dans cette page, sans
  // avoir à aller regrouper/filtrer soi-même la rubrique Ventes.
  const [detailOuvert, setDetailOuvert] = useState<Record<string, boolean>>({});

  // Formulaire réconciliation
  const [formRetours, setFormRetours] = useState("");
  const [formCasse, setFormCasse] = useState("");
  const [formDonPolice, setFormDonPolice] = useState("");
  const [formEncaisse, setFormEncaisse] = useState("");
  const [formExplication, setFormExplication] = useState("");

  const mouvements: MouvementStock[] = (DB.mouvementsStock || []) as MouvementStock[];
  const reconciliations: ReconciliationRecord[] = DB.reconciliations || [];

  // Calculer les données de réconciliation pour chaque livreur à la date sélectionnée
  const livreurData = useMemo(() => {
    return DB.livreurs.map(livreur => {
      const mvtJour = mouvements.filter(m => m.date === date && m.livreurId === livreur.id);

      const chargements = mvtJour
        .filter(m => m.type === "chargement" && m.produit === "sachet_plein")
        .reduce((s, m) => s + m.quantite, 0);

      const ventesStock = mvtJour
        .filter(m => m.type === "vente" && m.produit === "sachet_plein")
        .reduce((s, m) => s + m.quantite, 0);

      const retours = mvtJour
        .filter(m => m.type === "retour_camion" && m.produit === "sachet_plein")
        .reduce((s, m) => s + m.quantite, 0);

      const casse = mvtJour
        .filter(m => m.type === "casse" && m.produit === "sachet_plein" && m.livreurId === livreur.id)
        .reduce((s, m) => s + m.quantite, 0);

      const donPolice = mvtJour
        .filter(m => m.type === "don_police" && m.produit === "sachet_plein" && m.livreurId === livreur.id)
        .reduce((s, m) => s + m.quantite, 0);

      // Ventes du jour pour ce livreur
      const ventesJour = DB.ventes.filter(v => v.date === date && v.livreur === livreur.nom);
      const packsVendus = ventesJour.reduce((s, v) => s + v.packs, 0);
      const encaissements = ventesJour.reduce((s, v) => s + (v.avance || (v.mode === "Payé" ? v.packs * v.prix : 0)), 0);
      const creditCree = ventesJour.reduce((s, v) => {
        const total = v.packs * v.prix;
        const avance = v.avance || (v.mode === "Payé" ? total : 0);
        return s + Math.max(0, total - avance);
      }, 0);

      const ecart = chargements - packsVendus - retours - casse - donPolice;

      // Vérifier si déjà réconcilié
      const existing = reconciliations.find(r => r.date === date && r.livreurId === livreur.id);

      return {
        livreur,
        chargements,
        packsVendus,
        retours,
        casse,
        donPolice,
        encaissements,
        creditCree,
        ecart,
        existing,
        hasActivity: chargements > 0 || packsVendus > 0,
        // Ventes individuelles du jour pour ce livreur — sert au détail
        // dépliable "ventes tapées / restant" (voir plus bas), pour ne pas
        // avoir à aller filtrer soi-même la rubrique Ventes par livreur/date.
        ventesJour,
      };
    }).filter(d => d.hasActivity);
  }, [DB, mouvements, reconciliations, date]);

  // ─── Retards de réconciliation (rendre la réconciliation quasi-obligatoire) ──
  // La réconciliation n'est techniquement pas bloquante, mais un livreur ayant
  // eu de l'activité (chargement/vente) et jamais réconcilié depuis plusieurs
  // jours est un signal de risque (vol, erreur) qui doit rester visible même
  // si l'utilisateur ne pense pas à changer la date sélectionnée.
  const RETARD_JOURS = 7;
  const retardsReconciliation = useMemo(() => {
    const results: { date: string; livreurId: string; livreurNom: string }[] = [];
    // i commence à 1 (hier), pas 0 (aujourd'hui) : une tournée du jour même
    // peut être encore en cours, donc son absence de réconciliation n'est
    // pas un "retard" tant que la journée n'est pas terminée (voir
    // isAujourdhui plus haut pour la même logique sur l'écart affiché).
    for (let i = 1; i <= RETARD_JOURS; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = toLocalDateStr(d);
      for (const livreur of DB.livreurs) {
        const mvtJour = mouvements.filter(m => m.date === ds && m.livreurId === livreur.id);
        const chargements = mvtJour
          .filter(m => m.type === "chargement" && m.produit === "sachet_plein")
          .reduce((s, m) => s + m.quantite, 0);
        const ventesJour = DB.ventes.filter(v => v.date === ds && v.livreur === livreur.nom);
        const packsVendus = ventesJour.reduce((s, v) => s + v.packs, 0);
        if (chargements <= 0 && packsVendus <= 0) continue;

        const existing = reconciliations.find(r => r.date === ds && r.livreurId === livreur.id);
        if (!existing) {
          results.push({ date: ds, livreurId: livreur.id, livreurNom: livreur.nom });
        }
      }
    }
    return results.sort((a, b) => a.date.localeCompare(b.date));
  }, [DB, mouvements, reconciliations]);

  const handleReconcilier = () => {
    const livreur = DB.livreurs.find(l => l.id === selectedLivreur);
    if (!livreur) return;

    const data = livreurData.find(d => d.livreur.id === selectedLivreur);
    if (!data) return;

    const retours = Number(formRetours) || 0;
    const casse = Number(formCasse) || 0;
    const donPolice = Number(formDonPolice) || 0;
    const encaisse = Number(formEncaisse) || 0;
    const ecart = data.chargements - data.packsVendus - retours - casse - donPolice;

    if (ecart !== 0 && !formExplication.trim()) {
      toast.error("Explication obligatoire pour un écart non nul");
      return;
    }

    const record: ReconciliationRecord = {
      id: uid(),
      date,
      livreurId: livreur.id,
      livreurNom: livreur.nom,
      stockDepart: data.chargements,
      ventesEffectuees: data.packsVendus,
      retours,
      casse,
      donPolice,
      encaissements: encaisse,
      creditCree: data.creditCree,
      ecart,
      ecartMontant: ecart * (DB.params.prixPack || 600),
      statut: ecart === 0 ? "ok" : "ecart",
      explication: formExplication || undefined,
      reconciliePar: currentUser?.nom || "",
      reconcilieLe: new Date().toISOString(),
    };

    const updated = { ...DB, reconciliations: [...DB.reconciliations, record] };
    setDB(updated); saveDB(updated);
    logActivity("create", "Réconciliation", `${livreur.nom} - ${date}: ${ecart === 0 ? "OK" : `Écart ${ecart} packs`}`);
    toast.success("Réconciliation enregistrée");
    setOpenReconcil(false);
    setFormRetours(""); setFormCasse(""); setFormDonPolice(""); setFormEncaisse(""); setFormExplication("");
  };

  const getStatutBadge = (statut: string) => {
    switch (statut) {
      case "ok": return <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" />OK</Badge>;
      case "ecart": return <Badge className="bg-orange-100 text-orange-800"><AlertTriangle className="w-3 h-3 mr-1" />Écart</Badge>;
      default: return <Badge className="bg-gray-100 text-gray-800"><XCircle className="w-3 h-3 mr-1" />Non réconcilié</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Réconciliation Livraisons</h2>
          <p className="text-sm text-gray-500">Vérifier: départ X, vend Y, retourne Z, encaisse montant</p>
        </div>
        <div className="flex items-center gap-3">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" />
        </div>
      </div>

      {/* Alerte : réconciliations en retard sur les 7 derniers jours */}
      {retardsReconciliation.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">
                {retardsReconciliation.length} réconciliation(s) en retard sur les {RETARD_JOURS} derniers jours
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {retardsReconciliation.map((r, i) => (
                  <button
                    key={`${r.date}_${r.livreurId}_${i}`}
                    onClick={() => setDate(r.date)}
                    className="text-xs px-2 py-1 rounded-full bg-white border border-red-200 text-red-800 hover:bg-red-100 transition-colors"
                  >
                    {r.livreurNom} — {fmtDate(r.date)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-red-700 mt-1.5">Cliquez sur un livreur pour ouvrir sa date et le réconcilier.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI du jour */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">Livreurs actifs</p>
            <p className="text-2xl font-bold">{livreurData.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">Total chargé</p>
            <p className="text-2xl font-bold">{livreurData.reduce((s, d) => s + d.chargements, 0)} packs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">Total vendu</p>
            <p className="text-2xl font-bold">{livreurData.reduce((s, d) => s + d.packsVendus, 0)} packs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500">Réconciliés</p>
            <p className="text-2xl font-bold">{livreurData.filter(d => d.existing).length}/{livreurData.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Liste des livreurs */}
      {livreurData.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            Aucune activité de livraison pour le {fmtDate(date)}. Enregistrez des chargements dans la section Stock.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {livreurData.map(data => (
            <Card key={data.livreur.id} className={`border-l-4 ${data.existing ? (data.existing.statut === "ok" ? "border-l-green-500" : "border-l-orange-500") : "border-l-gray-300"}`}>
              <CardContent className="pt-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Truck className="w-6 h-6 text-purple-600" />
                    <div>
                      <p className="font-semibold text-gray-900">{data.livreur.nom}</p>
                      <p className="text-xs text-gray-500">{data.livreur.tel || ""}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
                    <div>
                      <p className="text-xs text-gray-500">Chargé</p>
                      <p className="font-bold text-blue-700">{data.chargements}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Vendu</p>
                      <p className="font-bold text-green-700">{data.packsVendus}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Retour</p>
                      <p className="font-bold text-gray-700">{data.retours}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Casse</p>
                      <p className="font-bold text-orange-700">{data.casse}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Don police</p>
                      <p className="font-bold text-rose-700">{data.donPolice}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Écart</p>
                      <p className={`font-bold ${data.ecart === 0 ? "text-green-700" : isAujourdhui ? "text-gray-500" : "text-red-700"}`}>
                        {data.ecart}
                        {isAujourdhui && data.ecart !== 0 && <span className="block text-[10px] font-normal text-gray-400">en cours</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {data.existing ? (
                      getStatutBadge(data.existing.statut)
                    ) : (
                      <Button size="sm" onClick={() => { setSelectedLivreur(data.livreur.id); setOpenReconcil(true); }} className="gap-1 bg-[#1B4B6B]">
                        <ClipboardCheck className="w-4 h-4" /> Réconcilier
                      </Button>
                    )}
                  </div>
                </div>

                {/* Détail dépliable : quelles ventes sont déjà tapées dans
                    l'app pour ce livreur/cette date, et combien de packs
                    n'ont encore aucune trace (le solde de l'écart). Répond
                    directement à "quelles ventes tapées / quel restant" sans
                    devoir filtrer soi-même la rubrique Ventes. */}
                <div className="mt-3 pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setDetailOuvert(prev => ({ ...prev, [data.livreur.id]: !prev[data.livreur.id] }))}
                    className="text-xs font-medium text-[#1B4B6B] flex items-center gap-1 hover:underline"
                  >
                    {detailOuvert[data.livreur.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Voir le détail ({data.ventesJour.length} vente{data.ventesJour.length > 1 ? "s" : ""} tapée{data.ventesJour.length > 1 ? "s" : ""}, {data.ecart} pack{Math.abs(data.ecart) > 1 ? "s" : ""} restant{Math.abs(data.ecart) > 1 ? "s" : ""})
                  </button>

                  {detailOuvert[data.livreur.id] && (
                    <div className="mt-2 space-y-2">
                      {data.ventesJour.length > 0 ? (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">N° BL</TableHead>
                                <TableHead className="text-xs">Client</TableHead>
                                <TableHead className="text-xs text-right">Packs</TableHead>
                                <TableHead className="text-xs text-right">Montant</TableHead>
                                <TableHead className="text-xs">Paiement</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.ventesJour.map(v => (
                                <TableRow key={v.id}>
                                  <TableCell className="text-xs font-mono">{v.numero}</TableCell>
                                  <TableCell className="text-xs">{v.client}</TableCell>
                                  <TableCell className="text-xs text-right">{v.packs}</TableCell>
                                  <TableCell className="text-xs text-right">{fmt(v.packs * v.prix)}</TableCell>
                                  <TableCell className="text-xs">{v.mode}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Aucune vente tapée pour ce livreur à cette date.</p>
                      )}
                      {data.ecart !== 0 && (
                        isAujourdhui ? (
                          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">
                            {data.ecart} pack(s) pas encore vendu(s)/retourné(s) — normal tant que la tournée du jour n'est pas terminée.
                          </p>
                        ) : (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                            {data.ecart} pack(s) chargé(s) sans vente, retour, casse ni don police enregistré — vente pas encore saisie, ou à clarifier via "Réconcilier" ci-dessus.
                          </p>
                        )
                      )}
                    </div>
                  )}
                </div>

                {data.existing && (
                  <div className="mt-3 pt-3 border-t text-xs text-gray-500 flex flex-wrap gap-4">
                    <span>Encaissé: {fmt(data.existing.encaissements)}</span>
                    <span>Crédit: {fmt(data.existing.creditCree)}</span>
                    {data.existing.explication && <span>Note: {data.existing.explication}</span>}
                    <span>Par: {data.existing.reconciliePar}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Historique des réconciliations */}
      {reconciliations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historique des réconciliations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Livreur</th>
                    <th className="px-4 py-3 text-right">Chargé</th>
                    <th className="px-4 py-3 text-right">Vendu</th>
                    <th className="px-4 py-3 text-right">Retour</th>
                    <th className="px-4 py-3 text-right">Écart</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...reconciliations].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3">{r.livreurNom}</td>
                      <td className="px-4 py-3 text-right">{r.stockDepart}</td>
                      <td className="px-4 py-3 text-right">{r.ventesEffectuees}</td>
                      <td className="px-4 py-3 text-right">{r.retours}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.ecart}</td>
                      <td className="px-4 py-3 text-center">{getStatutBadge(r.statut)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog Réconciliation */}
      <Dialog open={openReconcil} onOpenChange={setOpenReconcil}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réconciliation — {DB.livreurs.find(l => l.id === selectedLivreur)?.nom}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {(() => {
              const data = livreurData.find(d => d.livreur.id === selectedLivreur);
              if (!data) return null;
              return (
                <>
                  <div className="bg-blue-50 p-3 rounded-lg text-sm">
                    <p><strong>Stock départ:</strong> {data.chargements} packs</p>
                    <p><strong>Ventes enregistrées:</strong> {data.packsVendus} packs</p>
                    <p><strong>Encaissements ventes:</strong> {fmt(data.encaissements)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Packs retournés</label>
                    <Input type="number" value={formRetours} onChange={e => setFormRetours(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Packs cassés / perdus</label>
                    <Input type="number" value={formCasse} onChange={e => setFormCasse(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Packs donnés à la police</label>
                    <Input type="number" value={formDonPolice} onChange={e => setFormDonPolice(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Montant encaissé (F)</label>
                    <Input type="number" value={formEncaisse} onChange={e => setFormEncaisse(e.target.value)} placeholder="0" />
                  </div>
                  {(() => {
                    const retours = Number(formRetours) || 0;
                    const casse = Number(formCasse) || 0;
                    const donPolice = Number(formDonPolice) || 0;
                    const ecart = data.chargements - data.packsVendus - retours - casse - donPolice;
                    return ecart !== 0 ? (
                      <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg">
                        <p className="text-sm font-medium text-orange-800">Écart détecté: {ecart} packs</p>
                        <div className="mt-2">
                          <label className="text-sm font-medium">Explication obligatoire</label>
                          <Input value={formExplication} onChange={e => setFormExplication(e.target.value)} placeholder="Raison de l'écart..." />
                        </div>
                      </div>
                    ) : (
                      <div className="bg-green-50 border border-green-200 p-3 rounded-lg">
                        <p className="text-sm font-medium text-green-800">Pas d'écart — réconciliation OK</p>
                      </div>
                    );
                  })()}
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReconcil(false)}>Annuler</Button>
            <Button onClick={handleReconcilier} className="bg-[#1B4B6B]">Valider la réconciliation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
