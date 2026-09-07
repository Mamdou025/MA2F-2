import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtNumber, fmtDate, getMoisCourant, moisLabel, commissionVente, premierMoisAvecDonnees } from "@/lib/helpers";
import { MonthSelector } from "@/components/MonthSelector";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function CommerciauxSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [tel, setTel] = useState("");
  const [objectif, setObjectif] = useState("");
  // Mois consulté pour "Vendu ce mois" / "Atteinte" — par défaut le mois en
  // cours, mais consultable pour n'importe quel mois passé via le sélecteur.
  const [mois, setMois] = useState(getMoisCourant());
  // Ne pas proposer de mois antérieurs à la première vente enregistrée (la
  // saisie a commencé en juillet 2026) — sinon le sélecteur donnerait accès
  // à des mois vides à 0, qu'on pourrait confondre avec une vraie absence
  // d'activité alors que ces mois ne sont simplement pas suivis dans l'app.
  const minMois = useMemo(() => premierMoisAvecDonnees(DB.ventes.map((v) => v.date)), [DB.ventes]);

  // Détail quotidien : quantité de packs vendus chaque jour par chaque
  // commercial, pour le mois sélectionné. Regroupe DB.ventes (champ
  // Vente.commercial) par date puis par commercial. Comme pour les livreurs,
  // on inclut aussi les noms de commerciaux trouvés dans les ventes mais
  // absents de la liste actuelle (ex: commercial supprimé depuis), pour ne
  // pas faire disparaître des packs déjà comptés dans le total du jour.
  const detailQuotidien = useMemo(() => {
    const ventesMois = DB.ventes.filter((v) => (v.date || "").startsWith(mois));
    const noms = new Set<string>(DB.commerciaux.map((c) => c.nom));
    ventesMois.forEach((v) => { if (v.commercial) noms.add(v.commercial); });
    const colonnes = Array.from(noms).sort((a, b) => a.localeCompare(b));
    const parDate = new Map<string, Map<string, number>>();
    for (const v of ventesMois) {
      if (!v.commercial) continue;
      if (!parDate.has(v.date)) parDate.set(v.date, new Map());
      const m = parDate.get(v.date)!;
      m.set(v.commercial, (m.get(v.commercial) || 0) + v.packs);
    }
    const dates = Array.from(parDate.keys()).sort((a, b) => b.localeCompare(a));
    const totauxColonnes = new Map<string, number>();
    colonnes.forEach((c) => totauxColonnes.set(c, 0));
    dates.forEach((d) => {
      const m = parDate.get(d)!;
      colonnes.forEach((c) => totauxColonnes.set(c, (totauxColonnes.get(c) || 0) + (m.get(c) || 0)));
    });
    return { colonnes, dates, parDate, totauxColonnes };
  }, [DB.ventes, mois, DB.commerciaux]);

  const handleOpen = (id?: string) => {
    if (id) { const c = DB.commerciaux.find((x) => x.id === id); if (!c) return; setEditId(id); setNom(c.nom); setTel(c.tel); setObjectif(String(c.objectif || "")); }
    else { setEditId(null); setNom(""); setTel(""); setObjectif(""); }
    setOpen(true);
  };

  const handleSave = () => {
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }
    // Vérifier les doublons : même nom (insensible à la casse) = doublon.
    // Comme pour les livreurs, les ventes rattachent un commercial par son NOM
    // (pas par un ID) : deux commerciaux de même nom se feraient mélanger leurs
    // ventes, leur commission et leurs statistiques. Le téléphone ne suffit pas
    // à les différencier ailleurs dans l'app, donc on interdit tout doublon de nom.
    const nomNorm = nom.trim().toLowerCase();
    const duplicate = DB.commerciaux.find((c) =>
      c.id !== editId &&
      c.nom.trim().toLowerCase() === nomNorm
    );
    if (duplicate) {
      toast.error("Un commercial avec ce nom existe déjà. Utilisez un nom distinct pour éviter toute confusion dans les ventes et les commissions.");
      return;
    }
    if (editId) {
      const oldItem = DB.commerciaux.find((c) => c.id === editId);
      const nomTrimmed = nom.trim();
      let updated = { ...DB, commerciaux: DB.commerciaux.map((c) => c.id === editId ? { ...c, nom: nomTrimmed, tel, objectif: Number(objectif) || 0 } : c) };
      // Cascade : si le nom change, mettre à jour les ventes existantes pour
      // ne pas perdre leur rattachement (statistiques, commission) à ce commercial.
      if (oldItem && oldItem.nom !== nomTrimmed) {
        updated = { ...updated, ventes: updated.ventes.map((v) => v.commercial === oldItem.nom ? { ...v, commercial: nomTrimmed } : v) };
      }
      setDB(updated); saveDB(updated); logActivity("update", "Commercial", nom); toast.success("Modifié");
    } else {
      const updated = { ...DB, commerciaux: [...DB.commerciaux, { id: uid(), nom: nom.trim(), tel, objectif: Number(objectif) || 0 }] };
      setDB(updated); saveDB(updated); logActivity("create", "Commercial", nom); toast.success("Commercial ajouté");
    }
    setOpen(false);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? DB.commerciaux.find((c) => c.id === deleteId) || null : null;

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    const updated = { ...DB, commerciaux: DB.commerciaux.filter((c) => c.id !== item.id), corbeille: [...DB.corbeille, { id: uid(), originalType: "commerciaux", moduleName: "Commercial", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    setDB(updated); saveDB(updated); logActivity("delete", "Commercial", item.nom); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-gray-900">Commerciaux</h2><p className="text-sm text-gray-500">{DB.commerciaux.length} commercial(aux)</p></div>
        <div className="flex items-center gap-2">
          <MonthSelector value={mois} onChange={setMois} minMois={minMois} />
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouveau</Button>
        </div>
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>Tél</TableHead><TableHead>Objectif / mois</TableHead><TableHead className="text-right">Vendu — {moisLabel(mois)}</TableHead><TableHead>Atteinte</TableHead><TableHead className="text-right">Commission — {moisLabel(mois)}</TableHead><TableHead className="text-right">Livrés (total)</TableHead><TableHead className="text-right">Encaissés (total)</TableHead><TableHead className="text-right">Commission (total)</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
        {DB.commerciaux.length > 0 ? DB.commerciaux.map((c) => {
          const ventesCommercial = DB.ventes.filter((v) => v.commercial === c.nom);
          const livres = ventesCommercial.reduce((s, v) => s + v.packs, 0);
          const ventesPayees = ventesCommercial.filter((v) => v.mode === "Payé");
          const encaisses = ventesPayees.reduce((s, v) => s + v.packs, 0);
          // Commission calculée sur TOUTES les ventes du commercial, payées ET
          // à crédit (décision explicite de l'utilisateur, 2026-09-05 — avant
          // ce changement, une vente à crédit ne générait jamais de commission,
          // même une fois intégralement recouvrée, car rien ne repasse
          // Vente.mode de "Crédit" à "Payé" après coup). Le taux reste celui
          // figé sur CHAQUE vente (voir tauxCommission dans types.ts) plutôt
          // que le taux actuel des Paramètres appliqué à tout l'historique —
          // sinon changer le taux aujourd'hui modifierait rétroactivement les
          // commissions déjà calculées pour des ventes passées.
          const comm = ventesCommercial.reduce((s, v) => s + commissionVente(v, DB), 0);
          const obj = Number(c.objectif) || 0;
          // Ventes de CE commercial sur le mois sélectionné (packs + commission,
          // payées et à crédit) — c'est le chiffre qui sert réellement à
          // calculer ce qu'on doit à ce commercial pour ce mois-là, contrairement
          // à "Commission (total)" qui cumule tout l'historique.
          const ventesCommercialMois = ventesCommercial.filter((v) => (v.date || "").startsWith(mois));
          const venduCeMois = ventesCommercialMois.reduce((s, v) => s + v.packs, 0);
          const commMois = ventesCommercialMois.reduce((s, v) => s + commissionVente(v, DB), 0);
          const pct = obj > 0 ? Math.round((venduCeMois / obj) * 100) : 0;
          return (
            <TableRow key={c.id}><TableCell className="font-medium">{c.nom}</TableCell><TableCell>{c.tel || "-"}</TableCell><TableCell>{obj > 0 ? `${obj} packs` : "-"}</TableCell><TableCell className="text-right">{fmtNumber(venduCeMois)}</TableCell><TableCell>{obj > 0 ? <div className="flex items-center gap-2"><Progress value={Math.min(pct, 100)} className="w-16 h-2" /><span className={`text-xs font-bold ${pct >= 100 ? "text-green-600" : pct >= 75 ? "text-blue-600" : "text-orange-600"}`}>{pct}%</span></div> : "-"}</TableCell><TableCell className="text-right text-green-600 font-bold">{fmt(commMois)}</TableCell><TableCell className="text-right text-gray-500">{livres}</TableCell><TableCell className="text-right text-gray-500">{encaisses}</TableCell><TableCell className="text-right text-gray-500">{fmt(comm)}</TableCell><TableCell><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => handleOpen(c.id)}><Pencil className="w-3 h-3" /></Button><Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(c.id)}><Trash2 className="w-3 h-3" /></Button></div></TableCell></TableRow>
          );
        }) : <TableRow><TableCell colSpan={10} className="text-center text-gray-400 py-8">Aucun commercial</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Packs vendus par jour et par commercial — {moisLabel(mois)}</h3>
            <p className="text-sm text-gray-500">Détail quotidien basé sur les ventes enregistrées pour chaque commercial.</p>
          </div>
          {detailQuotidien.dates.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                    <TableHead className="text-white font-semibold sticky left-0 bg-[#1B4B6B]">Date</TableHead>
                    {detailQuotidien.colonnes.map((nom) => (
                      <TableHead key={nom} className="text-white font-semibold text-right whitespace-nowrap">{nom}</TableHead>
                    ))}
                    <TableHead className="text-white font-semibold text-right">Total jour</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailQuotidien.dates.map((d) => {
                    const m = detailQuotidien.parDate.get(d)!;
                    const totalJour = detailQuotidien.colonnes.reduce((s, c) => s + (m.get(c) || 0), 0);
                    return (
                      <TableRow key={d}>
                        <TableCell className="font-medium whitespace-nowrap sticky left-0 bg-white">{fmtDate(d)}</TableCell>
                        {detailQuotidien.colonnes.map((nom) => {
                          const packs = m.get(nom) || 0;
                          return (
                            <TableCell key={nom} className="text-right">{packs > 0 ? packs : <span className="text-gray-300">-</span>}</TableCell>
                          );
                        })}
                        <TableCell className="text-right font-bold">{totalJour}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableCell className="font-semibold sticky left-0 bg-gray-50">Total — {moisLabel(mois)}</TableCell>
                    {detailQuotidien.colonnes.map((nom) => (
                      <TableCell key={nom} className="text-right font-semibold">{detailQuotidien.totauxColonnes.get(nom) || 0}</TableCell>
                    ))}
                    <TableCell className="text-right font-bold">
                      {Array.from(detailQuotidien.totauxColonnes.values()).reduce((s, v) => s + v, 0)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">Aucune vente enregistrée pour {moisLabel(mois)}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editId ? "Modifier" : "Nouveau commercial"}</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div><Label>Nom</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} /></div>
          <div><Label>Téléphone (9 chiffres)</Label><Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ''))} placeholder="771234567" />{tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}</div>
          <div><Label>Objectif mensuel (packs)</Label><Input type="number" value={objectif} onChange={(e) => setObjectif(e.target.value)} placeholder="Ex: 2000" /></div>
          <div className="flex gap-2 pt-2"><Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button><Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button></div>
        </div>
      </DialogContent></Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer ce commercial ?"
        description={deleteTarget ? `${deleteTarget.nom}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
