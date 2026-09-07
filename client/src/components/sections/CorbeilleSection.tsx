import { useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { fmtDate } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function CorbeilleSection() {
  const { DB, setDB, saveDB, logActivity } = useApp();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? DB.corbeille.find((c) => c.id === deleteId) || null : null;
  const [openEmptyConfirm, setOpenEmptyConfirm] = useState(false);

  const handleRestore = (id: string) => {
    const item = DB.corbeille.find((c) => c.id === id); if (!item) return;
    const key = item.originalType as keyof typeof DB;
    if (!Array.isArray(DB[key])) return;
    const updated = {
      ...DB,
      [key]: [...(DB[key] as any[]), item.data],
      // Restaurer aussi les mouvements de stock liés (production, réception matière première...)
      mouvementsStock: item.relatedMouvements && item.relatedMouvements.length > 0
        ? [...(DB.mouvementsStock || []), ...item.relatedMouvements]
        : DB.mouvementsStock,
      corbeille: DB.corbeille.filter((c) => c.id !== id),
    };
    setDB(updated); saveDB(updated);
    logActivity("restore", "Corbeille", `Restauration: ${item.desc}`);
    toast.success("Élément restauré");
  };

  const confirmDeletePermanent = () => {
    const item = deleteTarget; if (!item) return;
    const updated = { ...DB, corbeille: DB.corbeille.filter((c) => c.id !== item.id) };
    setDB(updated); saveDB(updated);
    logActivity("delete", "Corbeille", `Suppression définitive: ${item.desc}`);
    toast.success("Supprimé définitivement");
    setDeleteId(null);
  };

  const confirmEmptyTrash = () => {
    const updated = { ...DB, corbeille: [] };
    setDB(updated); saveDB(updated);
    logActivity("delete", "Corbeille", "Vidage complet");
    toast.success("Corbeille vidée");
    setOpenEmptyConfirm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-gray-900">Corbeille</h2><p className="text-sm text-gray-500">{DB.corbeille.length} élément(s)</p></div>
        {DB.corbeille.length > 0 && <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setOpenEmptyConfirm(true)}><Trash2 className="w-4 h-4 mr-2" /> Vider la corbeille</Button>}
      </div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Module</TableHead><TableHead>Description</TableHead><TableHead>Supprimé le</TableHead><TableHead>Par</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
        {DB.corbeille.length > 0 ? [...DB.corbeille].reverse().map((c) => (
          <TableRow key={c.id}><TableCell><span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">{c.moduleName}</span></TableCell><TableCell className="font-medium">{c.desc}</TableCell><TableCell>{fmtDate(c.deletedAt)}</TableCell><TableCell className="text-sm">{c.deletedBy}</TableCell><TableCell><div className="flex gap-1"><Button variant="outline" size="sm" className="text-green-600 hover:bg-green-50" onClick={() => handleRestore(c.id)}><RotateCcw className="w-3 h-3" /></Button><Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(c.id)}><Trash2 className="w-3 h-3" /></Button></div></TableCell></TableRow>
        )) : <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-8">Corbeille vide</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer définitivement ?"
        description={deleteTarget ? `${deleteTarget.moduleName} - ${deleteTarget.desc}. Cette action est IRRÉVERSIBLE : impossible à restaurer ensuite.` : ""}
        confirmLabel="Supprimer définitivement"
        onConfirm={confirmDeletePermanent}
      />

      <ConfirmDialog
        open={openEmptyConfirm}
        onOpenChange={setOpenEmptyConfirm}
        title="Vider toute la corbeille ?"
        description={`${DB.corbeille.length} élément(s) seront supprimés DÉFINITIVEMENT et de façon IRRÉVERSIBLE. Aucune restauration ne sera possible ensuite.`}
        confirmLabel="Vider définitivement"
        onConfirm={confirmEmptyTrash}
      />
    </div>
  );
}
