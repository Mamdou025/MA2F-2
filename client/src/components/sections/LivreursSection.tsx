import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmtDate, getMoisCourant, moisLabel, premierMoisAvecDonnees, todayLocal } from "@/lib/helpers";
import { MonthSelector } from "@/components/MonthSelector";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, Truck } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Livreur } from "@/lib/types";

export default function LivreursSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [tel, setTel] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [objectif, setObjectif] = useState("");
  const [vehiculeId, setVehiculeId] = useState<string>("none");
  // Capacité (packs) du camion de ce livreur — optionnelle, utilisée par le
  // dispatching automatique des commandes (voir CommandesSection.tsx) pour
  // ne pas surcharger un camion. Laisser vide = pas de limite.
  const [capacitePacks, setCapacitePacks] = useState("");

  const [mois, setMois] = useState(getMoisCourant());
  const livreurs: Livreur[] = (DB as { livreurs?: Livreur[] }).livreurs || [];
  // Comme pour Commerciaux : pas de mois vides antérieurs à la première vente.
  const minMois = useMemo(() => premierMoisAvecDonnees(DB.ventes.map((v) => v.date)), [DB.ventes]);

  // Détail quotidien : quantité de packs livrés chaque jour par chaque livreur,
  // pour le mois sélectionné. Regroupe DB.ventes (seule source de vérité des
  // livraisons de packs, via le champ Vente.livreur) par date puis par livreur.
  // On inclut aussi les noms de livreurs trouvés dans les ventes mais absents
  // de la liste des livreurs actifs (ex: livreur supprimé depuis), pour ne pas
  // faire disparaître des packs déjà comptés dans le total du jour.
  //
  // packs + bonus, pas juste packs : creerMouvementVente() (VentesSection.tsx)
  // déduit le camion du livreur pour packs+bonus (les packs offerts sortent
  // physiquement du camion comme les packs vendus). Sommer seulement "packs"
  // ici faisait paraître ce tableau incohérent avec le solde des camions dans
  // Gestion du Stock (ex: un camion à -222 alors que ce tableau n'affichait
  // que 202 packs pour son livreur, les 20 packs bonus manquants) — voir aussi
  // le garde-fou identique dans CommerciauxSection (packs vendus, sans bonus,
  // car ce n'est PAS la même question : combien de packs sont sortis d'un
  // camion vs. combien un commercial a-t-il vendu).
  const detailQuotidien = useMemo(() => {
    const ventesMois = DB.ventes.filter((v) => (v.date || "").startsWith(mois));
    const noms = new Set<string>(livreurs.map((l) => l.nom));
    ventesMois.forEach((v) => { if (v.livreur) noms.add(v.livreur); });
    const colonnes = Array.from(noms).sort((a, b) => a.localeCompare(b));
    const parDate = new Map<string, Map<string, number>>();
    for (const v of ventesMois) {
      if (!v.livreur) continue;
      if (!parDate.has(v.date)) parDate.set(v.date, new Map());
      const m = parDate.get(v.date)!;
      m.set(v.livreur, (m.get(v.livreur) || 0) + v.packs + (v.bonus || 0));
    }
    const dates = Array.from(parDate.keys()).sort((a, b) => b.localeCompare(a));
    const totauxColonnes = new Map<string, number>();
    colonnes.forEach((c) => totauxColonnes.set(c, 0));
    dates.forEach((d) => {
      const m = parDate.get(d)!;
      colonnes.forEach((c) => totauxColonnes.set(c, (totauxColonnes.get(c) || 0) + (m.get(c) || 0)));
    });
    return { colonnes, dates, parDate, totauxColonnes };
  }, [DB.ventes, mois, livreurs]);

  const handleOpen = (id?: string) => {
    if (id) {
      const c = livreurs.find((x) => x.id === id);
      if (!c) return;
      setEditId(id); setNom(c.nom); setTel(c.tel); setDate(c.date || ""); setObjectif(String(c.objectif || "")); setVehiculeId(c.vehiculeId || "none"); setCapacitePacks(c.capacitePacks ? String(c.capacitePacks) : "");
    } else {
      setEditId(null); setNom(""); setTel(""); setDate(todayLocal()); setObjectif(""); setVehiculeId("none"); setCapacitePacks("");
    }
    setOpen(true);
  };

  const handleSave = () => {
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }
    // Vérifier les doublons : même nom (insensible à la casse) = doublon.
    // Important : les ventes, les mouvements de stock et la réconciliation
    // identifient un livreur par son NOM (pas par un ID), donc deux livreurs
    // portant le même nom se feraient mélanger leurs livraisons, leur stock
    // camion et leurs statistiques. Le téléphone ne suffit pas à les
    // différencier dans le reste de l'application, on interdit donc tout
    // doublon de nom, même avec des téléphones différents.
    const nomNorm = nom.trim().toLowerCase();
    const duplicate = livreurs.find((c) =>
      c.id !== editId &&
      c.nom.trim().toLowerCase() === nomNorm
    );
    if (duplicate) {
      toast.error("Un livreur avec ce nom existe déjà. Utilisez un nom distinct (ex: ajoutez un prénom ou une initiale) pour éviter toute confusion dans les ventes et le stock.");
      return;
    }
    const vehiculeIdVal = vehiculeId === "none" ? undefined : vehiculeId;
    // Un camion déjà utilisé dans des ventes aujourd'hui ne doit pas changer de
    // chauffeur en cours de journée : creerMouvementVente() (VentesSection.tsx)
    // fige la source du mouvement de stock sur livreur.vehiculeId AU MOMENT de
    // la vente, donc réassigner le camion (dans un sens ou dans l'autre) après
    // coup ne corrige rien rétroactivement et sème la confusion sur "qui a
    // vendu depuis quel camion aujourd'hui" — exactement le type de mélange à
    // l'origine des soldes camions négatifs déjà rencontrés.
    const ventesAujourdhui = DB.ventes.filter((v) => v.date === todayLocal());
    if (vehiculeIdVal) {
      const autreLivreurMemeCamion = livreurs.find((l) => l.id !== editId && l.vehiculeId === vehiculeIdVal);
      if (autreLivreurMemeCamion && ventesAujourdhui.some((v) => v.livreur === autreLivreurMemeCamion.nom)) {
        toast.error(`Ce camion est déjà utilisé aujourd'hui par ${autreLivreurMemeCamion.nom} (ventes déjà enregistrées). Impossible de le réassigner avant la fin de la journée.`);
        return;
      }
    }
    if (editId) {
      const oldItemCheck = livreurs.find((c) => c.id === editId);
      if (oldItemCheck?.vehiculeId && oldItemCheck.vehiculeId !== vehiculeIdVal && ventesAujourdhui.some((v) => v.livreur === oldItemCheck.nom)) {
        toast.error(`${oldItemCheck.nom} a déjà des ventes aujourd'hui sur son camion actuel. Impossible de changer son camion assigné avant la fin de la journée.`);
        return;
      }
    }
    const capacitePacksVal = capacitePacks && Number(capacitePacks) > 0 ? Number(capacitePacks) : undefined;
    if (editId) {
      const oldItem = livreurs.find((c) => c.id === editId);
      const nomTrimmed = nom.trim();
      let updated = { ...DB, livreurs: livreurs.map((c) => c.id === editId ? { ...c, nom: nomTrimmed, tel, date, objectif: Number(objectif) || 0, vehiculeId: vehiculeIdVal, capacitePacks: capacitePacksVal } : c) };
      // Le nom du livreur est utilisé comme référence dans les ventes (DB.ventes.livreur).
      // Si le nom change, mettre à jour les ventes existantes pour ne pas perdre
      // leur rattachement (statistiques, réconciliation) à ce livreur.
      if (oldItem && oldItem.nom !== nomTrimmed) {
        updated = { ...updated, ventes: updated.ventes.map((v) => v.livreur === oldItem.nom ? { ...v, livreur: nomTrimmed } : v) };
      }
      setDB(updated); saveDB(updated); logActivity("update", "Livreur", nom); toast.success("Modifié");
    } else {
      const updated = { ...DB, livreurs: [...livreurs, { id: uid(), nom: nom.trim(), tel, date, objectif: Number(objectif) || 0, vehiculeId: vehiculeIdVal, capacitePacks: capacitePacksVal }] };
      setDB(updated); saveDB(updated); logActivity("create", "Livreur", nom); toast.success("Livreur ajouté");
    }
    setOpen(false);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const item = livreurs.find((c) => c.id === deleteId);
    if (!item) return;
    const updated = { ...DB, livreurs: livreurs.filter((c) => c.id !== deleteId), corbeille: [...DB.corbeille, { id: uid(), originalType: "livreurs", moduleName: "Livreur", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    setDB(updated); saveDB(updated); logActivity("delete", "Livreur", item.nom); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>🚗</span> Livreurs
          </h2>
          <p className="text-sm text-gray-500">{livreurs.length} livreur(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector value={mois} onChange={setMois} minMois={minMois} />
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouveau</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Nom</TableHead>
                  <TableHead className="text-white font-semibold">Tél</TableHead>
                  <TableHead className="text-white font-semibold">Camion</TableHead>
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold text-right">Obj/mois</TableHead>
                  <TableHead className="text-white font-semibold text-right">Livré — {moisLabel(mois)}</TableHead>
                  <TableHead className="text-white font-semibold">Atteinte</TableHead>
                  <TableHead className="text-white font-semibold text-right">Total livrés (tous mois)</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {livreurs.length > 0 ? livreurs.map((c) => {
                  const totalLivres = DB.ventes.filter((v) => v.livreur === c.nom).reduce((s, v) => s + v.packs, 0);
                  const obj = Number(c.objectif) || 0;
                  const livreCeMois = DB.ventes.filter((v) => v.livreur === c.nom && (v.date || "").startsWith(mois)).reduce((s, v) => s + v.packs, 0);
                  const pct = obj > 0 ? Math.round((livreCeMois / obj) * 100) : 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.nom}</TableCell>
                      <TableCell>{c.tel || "-"}</TableCell>
                      <TableCell>
                        {c.vehiculeId ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Truck className="w-3 h-3 text-purple-600" />
                            {DB.vehicules.find((v) => v.id === c.vehiculeId)?.nom || "Camion inconnu"}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600">Non assigné</span>
                        )}
                      </TableCell>
                      <TableCell>{c.date ? fmtDate(c.date) : "-"}</TableCell>
                      <TableCell className="text-right">{obj > 0 ? `${obj} packs` : "-"}</TableCell>
                      <TableCell className="text-right font-bold">{livreCeMois}</TableCell>
                      <TableCell>
                        {obj > 0 ? (
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(pct, 100)} className="w-16 h-2" />
                            <span className={`text-xs font-bold ${pct >= 100 ? "text-green-600" : ""}`}>{pct}%</span>
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-right">{totalLivres}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => handleOpen(c.id)} aria-label={`Modifier ${c.nom}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(c.id)} aria-label={`Supprimer ${c.nom}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-gray-400 py-8">Aucun livreur</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Packs livrés par jour et par livreur — {moisLabel(mois)}</h3>
            <p className="text-sm text-gray-500">Détail quotidien basé sur les ventes enregistrées pour chaque livreur.</p>
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
            <p className="text-center text-gray-400 py-8">Aucune livraison enregistrée pour {moisLabel(mois)}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier" : "Nouveau livreur"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Nom</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} /></div>
            <div><Label>Téléphone (9 chiffres)</Label><Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ''))} placeholder="771234567" />{tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}</div>
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label>Objectif mensuel (packs/mois)</Label><Input type="number" value={objectif} onChange={(e) => setObjectif(e.target.value)} placeholder="Ex: 1000" /></div>
            <div>
              <Label>Camion conduit</Label>
              <Select value={vehiculeId} onValueChange={setVehiculeId}>
                <SelectTrigger><SelectValue placeholder="Aucun camion" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun camion assigné</SelectItem>
                  {DB.vehicules.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">
                Détermine de quel camion le stock est déduit quand ce livreur effectue une vente. Sans camion assigné, les ventes de ce livreur sont déduites du stock usine.
              </p>
            </div>
            <div>
              <Label>Capacité du camion (packs, optionnel)</Label>
              <Input type="number" value={capacitePacks} onChange={(e) => setCapacitePacks(e.target.value)} placeholder="Ex: 300" />
              <p className="text-xs text-gray-400 mt-1">Utilisée uniquement par le dispatching automatique des commandes (Commandes → Dispatching) pour ne pas surcharger ce camion. Laisser vide = pas de limite.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Supprimer ce livreur ?"
        description="Le livreur sera déplacé dans la corbeille. Vous pourrez le restaurer ultérieurement si nécessaire."
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
