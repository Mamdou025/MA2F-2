import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { VehiculeOp } from "@/lib/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function VehiculesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();

  // Dialog pour ajouter/modifier un camion
  const [openCamion, setOpenCamion] = useState(false);
  const [editCamionId, setEditCamionId] = useState<string | null>(null);
  const [camionNom, setCamionNom] = useState("");
  const [camionKm, setCamionKm] = useState("");
  // Identifiant du boîtier GPS physique (IMEI ou "device id" plateforme) —
  // voir Vehicule.traceurId dans types.ts et recevoirPositionVehicule dans
  // cloud-functions/src/index.ts. Optionnel : sans ce champ, ce camion ne
  // remonte simplement aucune position sur la carte de Suivi logistique.
  const [camionTraceurId, setCamionTraceurId] = useState("");

  // Il n'existait auparavant aucun moyen de modifier un camion déjà créé (seul
  // "Supprimer" était disponible) : impossible de corriger un nom, un
  // kilométrage, ou surtout le champ "Chauffeur" une fois le camion enregistré.
  // handleOpenCamion() préremplit le formulaire quand un id est fourni, sinon
  // ouvre un formulaire vide pour une création.
  const handleOpenCamion = (id?: string) => {
    if (id) {
      const v = DB.vehicules.find((x) => x.id === id);
      if (!v) return;
      setEditCamionId(id);
      setCamionNom(v.nom);
      setCamionKm(String(v.km || ""));
      setCamionTraceurId(v.traceurId || "");
    } else {
      setEditCamionId(null);
      setCamionNom("");
      setCamionKm("");
      setCamionTraceurId("");
    }
    setOpenCamion(true);
  };

  // Dialog pour ajouter une opération
  const [openOp, setOpenOp] = useState(false);
  const [opDate, setOpDate] = useState(new Date().toISOString().slice(0, 10));
  const [opCamion, setOpCamion] = useState("");
  const [opType, setOpType] = useState("Carburant");
  const [opKm, setOpKm] = useState("");
  const [opLitres, setOpLitres] = useState("");
  const [opMontant, setOpMontant] = useState("");
  const [opDesc, setOpDesc] = useState("");

  // KPI
  const nbCamions = DB.vehicules.length;
  const totalCarburant = useMemo(() =>
    DB.vehiculeOps.filter((o) => o.type === "Carburant").reduce((s, o) => s + o.montant, 0),
    [DB.vehiculeOps]
  );
  const totalMaintenance = useMemo(() =>
    DB.vehiculeOps.filter((o) => o.type === "Maintenance").reduce((s, o) => s + o.montant, 0),
    [DB.vehiculeOps]
  );

  // Données par camion
  const camionStats = useMemo(() => {
    return DB.vehicules.map((v) => {
      const ops = DB.vehiculeOps.filter((o) => o.vehiculeId === v.id);
      const carburant = ops.filter((o) => o.type === "Carburant").reduce((s, o) => s + o.montant, 0);
      const litres = ops.filter((o) => o.type === "Carburant").reduce((s, o) => s + o.litres, 0);
      const maint = ops.filter((o) => o.type === "Maintenance").reduce((s, o) => s + o.montant, 0);
      const lastKm = ops.length > 0 ? Math.max(...ops.map((o) => o.km || 0), v.km) : v.km;
      // Le champ v.chauffeur (texte libre saisi ici même) n'a aucun effet sur le
      // reste de l'app et pouvait diverger du lien réel — c'est ce qui causait
      // l'affichage "Non assigné" en Stock alors qu'un livreur conduisait bel et
      // bien ce camion. On affiche donc désormais uniquement le nom du livreur
      // dont Livreur.vehiculeId pointe vers ce camion (voir Livreurs → "Camion
      // conduit"), seule source de vérité pour cette assignation.
      const chauffeurAssigne = DB.livreurs.find((l) => l.vehiculeId === v.id)?.nom || null;
      return { ...v, carburant, litres, maint, lastKm, chauffeurAssigne };
    });
  }, [DB]);

  const handleSaveCamion = () => {
    if (!camionNom.trim()) { toast.error("Nom du camion requis"); return; }
    // Vérifier les doublons : même nom de camion (insensible à la casse) = doublon
    // (on exclut le camion en cours d'édition de cette vérification, sinon on ne
    // pourrait jamais réenregistrer un camion sans changer son nom)
    const camionNomNorm = camionNom.trim().toLowerCase();
    const duplicateCamion = DB.vehicules.find((v) =>
      v.id !== editCamionId && v.nom.trim().toLowerCase() === camionNomNorm
    );
    if (duplicateCamion) {
      toast.error("Un camion avec ce nom existe déjà");
      return;
    }
    // Même contrôle de doublon pour le traceur GPS : deux camions avec le
    // même traceurId feraient que le webhook (recevoirPositionVehicule)
    // écrase indéfiniment la position de l'un avec celle de l'autre (il
    // résout par traceurId → premier Vehicule trouvé), sans qu'aucune erreur
    // ne le signale ailleurs.
    const traceurIdTrim = camionTraceurId.trim();
    if (traceurIdTrim) {
      const duplicateTraceur = DB.vehicules.find(
        (v) => v.id !== editCamionId && (v.traceurId || "").trim() === traceurIdTrim
      );
      if (duplicateTraceur) {
        toast.error(`Ce traceur GPS est déjà associé au camion "${duplicateTraceur.nom}"`);
        return;
      }
    }
    if (editCamionId) {
      const updated = {
        ...DB,
        vehicules: DB.vehicules.map((v) =>
          v.id === editCamionId
            ? { ...v, nom: camionNom.trim(), km: Number(camionKm) || 0, traceurId: traceurIdTrim || undefined }
            : v
        ),
      };
      setDB(updated); saveDB(updated);
      logActivity("update", "Véhicule", camionNom);
      toast.success("Camion modifié");
    } else {
      const item = { id: uid(), nom: camionNom.trim(), km: Number(camionKm) || 0, traceurId: traceurIdTrim || undefined };
      const updated = { ...DB, vehicules: [...DB.vehicules, item] };
      setDB(updated); saveDB(updated);
      logActivity("create", "Véhicule", camionNom);
      toast.success("Camion ajouté");
    }
    setOpenCamion(false);
  };

  const [deleteCamionId, setDeleteCamionId] = useState<string | null>(null);
  const deleteCamionTarget = deleteCamionId ? DB.vehicules.find((v) => v.id === deleteCamionId) || null : null;

  const confirmDeleteCamion = () => {
    const item = deleteCamionTarget; if (!item) return;
    const updated = {
      ...DB,
      vehicules: DB.vehicules.filter((v) => v.id !== item.id),
      vehiculeOps: DB.vehiculeOps.filter((o) => o.vehiculeId !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "vehicules", moduleName: "Véhicule", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }]
    };
    setDB(updated); saveDB(updated);
    logActivity("delete", "Véhicule", item.nom);
    toast.success("Mis à la corbeille");
    setDeleteCamionId(null);
  };

  const handleSaveOp = () => {
    if (!opCamion) { toast.error("Sélectionnez un camion"); return; }
    if (!opMontant) { toast.error("Montant requis"); return; }
    const item: VehiculeOp = {
      id: uid(),
      vehiculeId: opCamion,
      date: opDate,
      type: opType,
      km: Number(opKm) || 0,
      litres: Number(opLitres) || 0,
      montant: Number(opMontant) || 0,
      description: opDesc.trim(),
    };
    const camionName = DB.vehicules.find((v) => v.id === opCamion)?.nom || "";
    // Créer automatiquement une dépense correspondante
    const depense = {
      id: uid(),
      date: opDate,
      categorie: opType === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule",
      libelle: `${opType} - ${camionName}${opDesc.trim() ? " - " + opDesc.trim() : ""}`,
      fournisseur: camionName,
      montant: Number(opMontant) || 0,
    };
    const updated = {
      ...DB,
      vehiculeOps: [...DB.vehiculeOps, item],
      depenses: [...DB.depenses, depense],
    };
    setDB(updated); saveDB(updated);
    logActivity("create", "Opération véhicule", `${opType} - ${camionName} - ${fmt(item.montant)}`);
    toast.success("Opération enregistrée et ajoutée aux dépenses");
    setOpenOp(false);
  };

  const [deleteOpId, setDeleteOpId] = useState<string | null>(null);
  const deleteOpTarget = deleteOpId ? DB.vehiculeOps.find((o) => o.id === deleteOpId) || null : null;

  const confirmDeleteOp = () => {
    const item = deleteOpTarget; if (!item) return;
    const updated = {
      ...DB,
      vehiculeOps: DB.vehiculeOps.filter((o) => o.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "vehiculeOps", moduleName: "Opération véhicule", desc: `${item.type} - ${fmt(item.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }]
    };
    setDB(updated); saveDB(updated);
    logActivity("delete", "Opération véhicule", `${item.type} - ${fmt(item.montant)}`);
    toast.success("Mis à la corbeille");
    setDeleteOpId(null);
  };

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1">🚛 Camions</p>
            <p className="text-2xl font-bold text-gray-900">{nbCamions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1">⛽ Carburant (total)</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(totalCarburant)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1">🔧 Maintenance camion (total)</p>
            <p className="text-2xl font-bold text-red-600">{fmt(totalMaintenance)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau Camions & chauffeurs */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">Camions & chauffeurs</h3>
            <Button
              size="sm"
              onClick={() => handleOpenCamion()}
              className="bg-[#1B4B6B] hover:bg-[#0d4a85]"
            >
              <Plus className="w-4 h-4 mr-1" /> Ajouter camion
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Camion</TableHead>
                  <TableHead className="text-white font-semibold">Chauffeur</TableHead>
                  <TableHead className="text-white font-semibold text-right">Km actuel</TableHead>
                  <TableHead className="text-white font-semibold text-right">Carburant</TableHead>
                  <TableHead className="text-white font-semibold text-right">Litres</TableHead>
                  <TableHead className="text-white font-semibold text-right">Maintenance</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {camionStats.length > 0 ? camionStats.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.nom}</TableCell>
                    <TableCell>{v.chauffeurAssigne || "Non assigné"}</TableCell>
                    <TableCell className="text-right">{v.lastKm.toLocaleString()} km</TableCell>
                    <TableCell className="text-right">{fmt(v.carburant)}</TableCell>
                    <TableCell className="text-right">{v.litres} L</TableCell>
                    <TableCell className="text-right">{fmt(v.maint)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => handleOpenCamion(v.id)} aria-label={`Modifier ${v.nom}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteCamionId(v.id)} aria-label={`Supprimer ${v.nom}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-400 py-8">Aucun camion enregistré</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tableau Opérations */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">Opérations (carburant & maintenance)</h3>
            <Button
              size="sm"
              onClick={() => {
                setOpDate(new Date().toISOString().slice(0, 10));
                setOpCamion(DB.vehicules.length > 0 ? DB.vehicules[0].id : "");
                setOpType("Carburant");
                setOpKm(""); setOpLitres(""); setOpMontant(""); setOpDesc("");
                setOpenOp(true);
              }}
              className="bg-[#1B4B6B] hover:bg-[#0d4a85]"
            >
              <Plus className="w-4 h-4 mr-1" /> Nouvelle opération
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Camion</TableHead>
                  <TableHead className="text-white font-semibold">Type</TableHead>
                  <TableHead className="text-white font-semibold text-right">Km</TableHead>
                  <TableHead className="text-white font-semibold text-right">Litres</TableHead>
                  <TableHead className="text-white font-semibold text-right">Montant</TableHead>
                  <TableHead className="text-white font-semibold">Description</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DB.vehiculeOps.length > 0 ? [...DB.vehiculeOps].sort((a, b) => b.date.localeCompare(a.date)).map((op) => {
                  const camion = DB.vehicules.find((v) => v.id === op.vehiculeId);
                  return (
                    <TableRow key={op.id}>
                      <TableCell>{fmtDate(op.date)}</TableCell>
                      <TableCell className="font-medium">{camion?.nom || "-"}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${op.type === "Carburant" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                          {op.type}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{op.km > 0 ? `${op.km.toLocaleString()} km` : "-"}</TableCell>
                      <TableCell className="text-right">{op.litres > 0 ? `${op.litres} L` : "-"}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(op.montant)}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{op.description || "-"}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteOpId(op.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-400 py-8">Aucune opération</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Ajouter camion */}
      <Dialog open={openCamion} onOpenChange={setOpenCamion}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editCamionId ? "Modifier le camion" : "Ajouter un camion"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Nom / Immatriculation</Label><Input value={camionNom} onChange={(e) => setCamionNom(e.target.value)} placeholder="Ex: Camion 1 - AB-123-CD" /></div>
            <div>
              <Label>Chauffeur</Label>
              <p className="text-sm text-gray-700 border rounded-md px-3 py-2 bg-gray-50">
                {editCamionId ? (DB.livreurs.find((l) => l.vehiculeId === editCamionId)?.nom || "Non assigné") : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Se configure dans Livreurs → Modifier → "Camion conduit" (pas ici, pour rester la seule source de vérité).
              </p>
            </div>
            <div><Label>Kilométrage actuel</Label><Input type="number" value={camionKm} onChange={(e) => setCamionKm(e.target.value)} placeholder="0" /></div>
            <div>
              <Label>Traceur GPS (IMEI / id boîtier)</Label>
              <Input value={camionTraceurId} onChange={(e) => setCamionTraceurId(e.target.value)} placeholder="Ex: 868123456789012" />
              <p className="text-xs text-gray-400 mt-1">
                Identifiant du boîtier GPS physique posé dans ce camion, une fois installé — sert à recevoir sa position en direct sur la carte de Suivi logistique. Laisser vide si aucun boîtier n'est encore installé.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveCamion} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpenCamion(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Nouvelle opération */}
      <Dialog open={openOp} onOpenChange={setOpenOp}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouvelle opération</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Date</Label><Input type="date" value={opDate} onChange={(e) => setOpDate(e.target.value)} /></div>
            <div>
              <Label>Camion</Label>
              <Select value={opCamion} onValueChange={setOpCamion}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un camion" /></SelectTrigger>
                <SelectContent>
                  {DB.vehicules.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={opType} onValueChange={setOpType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Carburant">Carburant</SelectItem>
                  <SelectItem value="Maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Km compteur</Label><Input type="number" value={opKm} onChange={(e) => setOpKm(e.target.value)} placeholder="0" /></div>
            {opType === "Carburant" && (
              <div><Label>Litres</Label><Input type="number" value={opLitres} onChange={(e) => setOpLitres(e.target.value)} placeholder="0" /></div>
            )}
            <div><Label>Montant (FCFA)</Label><Input type="number" value={opMontant} onChange={(e) => setOpMontant(e.target.value)} placeholder="0" /></div>
            <div><Label>Description</Label><Input value={opDesc} onChange={(e) => setOpDesc(e.target.value)} placeholder="Description de l'opération" /></div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveOp} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpenOp(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteCamionId}
        onOpenChange={(o) => !o && setDeleteCamionId(null)}
        title="Supprimer ce camion ?"
        description={deleteCamionTarget ? `${deleteCamionTarget.nom}. Ses opérations liées seront aussi déplacées vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDeleteCamion}
      />

      <ConfirmDialog
        open={!!deleteOpId}
        onOpenChange={(o) => !o && setDeleteOpId(null)}
        title="Supprimer cette opération ?"
        description={deleteOpTarget ? `${deleteOpTarget.type} - ${fmt(deleteOpTarget.montant)}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDeleteOp}
      />
    </div>
  );
}
