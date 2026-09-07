import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, getMoisCourant, moisLabel, premierMoisAvecDonnees } from "@/lib/helpers";
import { MonthSelector } from "@/components/MonthSelector";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import type { Employe } from "@/lib/types";

// Rubrique Employés : liste du personnel salarié, utilisée uniquement pour
// alimenter un menu déroulant fiable à la saisie d'une dépense "Salaires"
// (DepensesSection.tsx) — voir Employe dans types.ts. Ne remplace pas
// Commerciaux/Livreurs (des rôles métier suivis séparément, même s'ils sont
// aussi salariés) : un même employé peut apparaître ici ET dans ces
// rubriques sans lien automatique entre les deux.
export default function EmployesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [tel, setTel] = useState("");
  const [poste, setPoste] = useState("");
  const [salaireBase, setSalaireBase] = useState("");
  const [actif, setActif] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Mois consulté pour la colonne "Versé ce mois" — par défaut le mois en
  // cours, consultable pour n'importe quel mois passé (même principe que
  // CommerciauxSection.tsx).
  const [mois, setMois] = useState(getMoisCourant());
  const minMois = useMemo(
    () => premierMoisAvecDonnees(DB.depenses.filter((d) => d.categorie === "Salaires").map((d) => d.date)),
    [DB.depenses]
  );

  const employes = DB.employes || [];

  // Total versé ce mois par employé (catégorie "Salaires", liées par
  // employeId) — même logique de regroupement que le récap salaires de
  // DepensesSection.tsx, ici limitée au mois sélectionné.
  const verseParEmploye = useMemo(() => {
    const map = new Map<string, number>();
    DB.depenses.forEach((d) => {
      if (d.categorie === "Salaires" && d.employeId && (d.date || "").startsWith(mois)) {
        map.set(d.employeId, (map.get(d.employeId) || 0) + d.montant);
      }
    });
    return map;
  }, [DB.depenses, mois]);

  const handleOpen = (id?: string) => {
    if (id) {
      const e = employes.find((x) => x.id === id);
      if (!e) return;
      setEditId(id);
      setNom(e.nom);
      setTel(e.tel || "");
      setPoste(e.poste || "");
      setSalaireBase(e.salaireBase ? String(e.salaireBase) : "");
      setActif(e.actif !== false);
    } else {
      setEditId(null);
      setNom("");
      setTel("");
      setPoste("");
      setSalaireBase("");
      setActif(true);
    }
    setOpen(true);
  };

  const handleSave = () => {
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }

    const champs: Partial<Employe> = {
      nom: nom.trim(),
      tel: tel || undefined,
      poste: poste.trim() || undefined,
      salaireBase: salaireBase ? Number(salaireBase) : undefined,
      actif,
    };

    if (editId) {
      const oldItem = employes.find((e) => e.id === editId);
      const newItem = { ...oldItem, ...champs } as Employe;
      const updated0 = { ...DB, employes: employes.map((e) => (e.id === editId ? newItem : e)) };
      const histEntry = oldItem ? updateHistoryEntry("Employés", editId, nom.trim(), oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS) : null;
      const updated = histEntry ? addHistoryEntry(updated0, histEntry) : updated0;
      setDB(updated); saveDB(updated); logActivity("update", "Employé", nom); toast.success("Modifié");
    } else {
      const item: Employe = { id: uid(), nom: nom.trim(), tel: tel || undefined, poste: poste.trim() || undefined, salaireBase: salaireBase ? Number(salaireBase) : undefined, actif: true };
      let updated = { ...DB, employes: [...employes, item] };
      const histEntry = createHistoryEntry("Employés", item.id, item.nom, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated); logActivity("create", "Employé", nom); toast.success("Employé ajouté");
    }
    setOpen(false);
  };

  const deleteTarget = deleteId ? employes.find((e) => e.id === deleteId) || null : null;

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    // Les dépenses "Salaires" déjà liées à cet employé (employeId) ne sont
    // pas supprimées ni modifiées — elles resteront visibles dans le récap
    // salaires avec la mention "(employé supprimé)" à la place du nom actuel.
    const updated0 = { ...DB, employes: employes.filter((e) => e.id !== item.id), corbeille: [...DB.corbeille, { id: uid(), originalType: "employes", moduleName: "Employé", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    const histEntry = deleteHistoryEntry("Employés", item.id, item.nom, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    const updated = addHistoryEntry(updated0, histEntry);
    setDB(updated); saveDB(updated); logActivity("delete", "Employé", item.nom); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Employés</h2>
          <p className="text-sm text-gray-500">{employes.length} employé(s) — sert au menu déroulant des dépenses "Salaires"</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector value={mois} onChange={setMois} minMois={minMois} />
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouvel employé</Button>
        </div>
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>Tél</TableHead><TableHead>Poste</TableHead><TableHead className="text-right">Salaire de base</TableHead><TableHead className="text-right">Versé — {moisLabel(mois)}</TableHead><TableHead>Statut</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
        {employes.length > 0 ? employes.map((e) => (
          <TableRow key={e.id} className={e.actif === false ? "opacity-60" : ""}>
            <TableCell className="font-medium">{e.nom}</TableCell>
            <TableCell>{e.tel || "-"}</TableCell>
            <TableCell>{e.poste || "-"}</TableCell>
            <TableCell className="text-right">{e.salaireBase ? fmt(e.salaireBase) : "-"}</TableCell>
            <TableCell className="text-right font-bold text-red-600">{fmt(verseParEmploye.get(e.id) || 0)}</TableCell>
            <TableCell>{e.actif === false ? <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium">Inactif</span> : <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Actif</span>}</TableCell>
            <TableCell><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => handleOpen(e.id)}><Pencil className="w-3 h-3" /></Button><Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(e.id)}><Trash2 className="w-3 h-3" /></Button></div></TableCell>
          </TableRow>
        )) : <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">Aucun employé — ajoutez-en un pour pouvoir le sélectionner dans les dépenses "Salaires"</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editId ? "Modifier l'employé" : "Nouvel employé"}</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div><Label>Nom</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Awa Diop" /></div>
          <div><Label>Téléphone (9 chiffres)</Label><Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ""))} placeholder="771234567" />{tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}</div>
          <div><Label>Poste</Label><Input value={poste} onChange={(e) => setPoste(e.target.value)} placeholder="Ex: Ouvrier production" /></div>
          <div><Label>Salaire de base mensuel (F, informatif)</Label><Input type="number" value={salaireBase} onChange={(e) => setSalaireBase(e.target.value)} placeholder="Ex: 80000" /></div>
          <div className="flex items-center justify-between border rounded-md p-3">
            <div><Label className="mb-0">Actif</Label><p className="text-xs text-gray-500">Un employé inactif n'apparaît plus dans le menu déroulant des dépenses "Salaires".</p></div>
            <Switch checked={actif} onCheckedChange={setActif} />
          </div>
          <div className="flex gap-2 pt-2"><Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button><Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button></div>
        </div>
      </DialogContent></Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer cet employé ?"
        description={deleteTarget ? `${deleteTarget.nom}. Cette entrée sera déplacée vers la corbeille. Les dépenses "Salaires" déjà enregistrées pour lui resteront visibles dans le récap.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
