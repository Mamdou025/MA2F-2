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
import { Plus, Trash2, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// Rubrique Apports de fonds : entrées d'argent hors ventes/recouvrements
// (appel de fonds répondu par MA2F, apport associé, subvention...).
// Contrairement à Versements (toujours une sortie de caisse), un apport
// est toujours une ENTRÉE et vient augmenter le solde de caisse.
export default function ApportsSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [type, setType] = useState("Appel de fonds");
  const [source, setSource] = useState("MA2F");
  const [montant, setMontant] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const apports = (DB as any).apports || [];

  // KPI
  const totalApports = useMemo(() => apports.reduce((s: number, a: any) => s + a.montant, 0), [apports]);
  const totalAppelsFonds = useMemo(() => apports.filter((a: any) => a.type === "Appel de fonds").reduce((s: number, a: any) => s + a.montant, 0), [apports]);
  const totalAutres = totalApports - totalAppelsFonds;

  const handleSave = () => {
    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    if (!source.trim()) { toast.error("Source requise"); return; }
    if (!montant || Number(montant) <= 0) { toast.error("Montant requis"); return; }
    const item = { id: uid(), date, type, source: source.trim(), montant: Number(montant), reference: reference.trim(), notes };
    let updated = { ...DB, apports: [...apports, item] };
    const histEntry = createHistoryEntry("Apports de fonds", item.id, `${type} - ${source}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("create", "Apport de fonds", `${type} - ${source} - ${fmt(Number(montant))}`);
    toast.success("Apport enregistré — ajouté aux entrées de caisse"); setOpen(false);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? apports.find((a: any) => a.id === deleteId) || null : null;

  const handleDelete = (id: string) => {
    const item = apports.find((a: any) => a.id === id); if (!item) return;
    // Vérifier la clôture
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    setDeleteId(id);
  };

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    let updated = {
      ...DB,
      apports: apports.filter((a: any) => a.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "apports", moduleName: "Apport de fonds", desc: `${item.type} - ${fmt(item.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }],
    };
    const histEntry = deleteHistoryEntry("Apports de fonds", item.id, `${item.type} - ${item.source}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated); logActivity("delete", "Apport de fonds", `${item.type} - ${item.source}`); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <PiggyBank className="w-6 h-6" /> Apports de fonds
        </h2>
        <Button onClick={() => { setDate(todayLocal()); setType("Appel de fonds"); setSource("MA2F"); setMontant(""); setReference(""); setNotes(""); setOpen(true); }} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
          <Plus className="w-4 h-4 mr-2" /> Nouvel apport
        </Button>
      </div>

      <p className="text-sm text-gray-500 -mt-4">
        Argent reçu hors ventes et recouvrements (appel de fonds répondu par MA2F, apport associé, subvention...). Ces montants sont ajoutés aux entrées de caisse.
      </p>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1">📞 Appels de fonds</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(totalAppelsFonds)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1">🤝 Autres apports</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(totalAutres)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total reçu</p>
            <p className="text-2xl font-bold text-green-600">{fmt(totalApports)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des apports */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Type</TableHead>
                  <TableHead className="text-white font-semibold">Source</TableHead>
                  <TableHead className="text-white font-semibold">Montant</TableHead>
                  <TableHead className="text-white font-semibold">Référence</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apports.length > 0 ? [...apports].reverse().map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>{fmtDate(a.date)}</TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                        {a.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{a.source}</TableCell>
                    <TableCell className="font-bold text-green-700">{fmt(a.montant)}</TableCell>
                    <TableCell className="text-sm text-gray-500">{a.reference || "-"}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-400 py-8">Aucun apport enregistré</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Nouvel apport */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvel apport de fonds</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Appel de fonds">Appel de fonds</SelectItem>
                  <SelectItem value="Apport associé">Apport associé</SelectItem>
                  <SelectItem value="Subvention">Subvention</SelectItem>
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Source</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Ex: MA2F, associé, banque..." /></div>
            <div><Label>Montant (F)</Label><Input type="number" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" /></div>
            <div><Label>Référence</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: Appel de fonds n°3..." /></div>
            <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes complémentaires..." /></div>
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
        title="Supprimer cet apport ?"
        description={deleteTarget ? `${deleteTarget.type} - ${deleteTarget.source} - ${fmt(deleteTarget.montant)}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
