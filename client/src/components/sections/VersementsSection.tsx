import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, todayLocal } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function VersementsSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [type, setType] = useState("Banque");
  const [beneficiaire, setBeneficiaire] = useState("");
  const [montant, setMontant] = useState("");
  const [notes, setNotes] = useState("");

  // KPI
  const verseBanque = useMemo(() => DB.versements.filter((v) => v.type === "Banque").reduce((s, v) => s + v.montant, 0), [DB]);
  const remisPersonne = useMemo(() => DB.versements.filter((v) => v.type !== "Banque").reduce((s, v) => s + v.montant, 0), [DB]);
  const totalVerse = useMemo(() => DB.versements.reduce((s, v) => s + v.montant, 0), [DB]);

  const handleSave = () => {
    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    if (!beneficiaire.trim()) { toast.error("Bénéficiaire requis"); return; }
    if (!montant || Number(montant) <= 0) { toast.error("Montant requis"); return; }
    const item = { id: uid(), date, type, beneficiaire: beneficiaire.trim(), montant: Number(montant), notes };
    let updated = { ...DB, versements: [...DB.versements, item] };
    const histEntry = createHistoryEntry("Versements", item.id, `${type} - ${beneficiaire}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("create", "Versement", `${type} - ${beneficiaire} - ${fmt(Number(montant))}`);
    toast.success("Versement enregistré"); setOpen(false);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? DB.versements.find((v) => v.id === deleteId) || null : null;

  const handleDelete = (id: string) => {
    const item = DB.versements.find((v) => v.id === id); if (!item) return;
    // Vérifier la clôture
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    setDeleteId(id);
  };

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    let updated = { ...DB, versements: DB.versements.filter((v) => v.id !== item.id), corbeille: [...DB.corbeille, { id: uid(), originalType: "versements", moduleName: "Versement", desc: `${item.type} - ${fmt(item.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    const histEntry = deleteHistoryEntry("Versements", item.id, `${item.type} - ${item.beneficiaire}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated); logActivity("delete", "Versement", `${item.type} - ${item.beneficiaire}`); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>🏦</span> Versements
        </h2>
        <Button onClick={() => { setDate(todayLocal()); setType("Banque"); setBeneficiaire(""); setMontant(""); setNotes(""); setOpen(true); }} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
          <Plus className="w-4 h-4 mr-2" /> Nouveau versement
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1"><span>🏦</span> Versé à la banque</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(verseBanque)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1"><span>👤</span> Remis à une personne</p>
            <p className="text-2xl font-bold text-red-600">{fmt(remisPersonne)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total versé</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(totalVerse)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des versements */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Type</TableHead>
                  <TableHead className="text-white font-semibold">Bénéficiaire</TableHead>
                  <TableHead className="text-white font-semibold">Montant</TableHead>
                  <TableHead className="text-white font-semibold">Motif</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DB.versements.length > 0 ? [...DB.versements].reverse().map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{fmtDate(v.date)}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.type === "Banque" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}>
                        {v.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{v.beneficiaire}</TableCell>
                    <TableCell className="font-bold">{fmt(v.montant)}</TableCell>
                    <TableCell className="text-sm text-gray-500">{v.notes || "-"}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(v.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-400 py-8">Aucun versement enregistré</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Nouveau versement */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau versement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Banque">Banque</SelectItem>
                  <SelectItem value="Personne">Remis à une personne</SelectItem>
                  <SelectItem value="Salaire">Salaire</SelectItem>
                  <SelectItem value="Commission">Commission</SelectItem>
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Bénéficiaire</Label><Input value={beneficiaire} onChange={(e) => setBeneficiaire(e.target.value)} placeholder="Nom du bénéficiaire..." /></div>
            <div><Label>Montant (F)</Label><Input type="number" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" /></div>
            <div><Label>Motif / Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motif du versement..." /></div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer ce versement ?"
        description={deleteTarget ? `${deleteTarget.type} - ${deleteTarget.beneficiaire} - ${fmt(deleteTarget.montant)}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
