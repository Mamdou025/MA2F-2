import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, todayLocal } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Pencil, Handshake, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import type { Actionnaire, MouvementActionnaire, TypeMouvementActionnaire } from "@/lib/types";

// Rubrique Actionnaires (added 2026-09-06) : registre des actionnaires/
// associés + suivi des mouvements financiers avec chacun (déblocage de
// fonds vers l'entreprise, dividende versé par l'entreprise). Volontairement
// un registre SÉPARÉ, sans effet sur le solde de caisse — Apports/
// Versements/Dépenses restent les seules rubriques qui alimentent
// computeSoldeCaisseActuel (helpers.ts) ; choix explicite de l'utilisateur
// pour ne pas toucher ce calcul déjà sensible (voir CLAUDE.md, section
// "Balance vs flux"). Réservée aux admins : ROLE_SECTIONS (helpers.ts),
// ADMIN_ONLY_META_FIELDS (AppContext.tsx) et firestore.rules (match
// /meta/{docId}) traitent "actionnaires"/"mouvementsActionnaires" comme
// "users"/"params" — données d'actionnariat/dividendes sensibles.
export default function ActionnairesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();

  const actionnaires = DB.actionnaires || [];
  const mouvements = DB.mouvementsActionnaires || [];

  // ─── Dialog Actionnaire (CRUD) ──────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [tel, setTel] = useState("");
  const [pourcentageParts, setPourcentageParts] = useState("");
  const [notesActionnaire, setNotesActionnaire] = useState("");
  const [actif, setActif] = useState(true);

  const handleOpen = (id?: string) => {
    if (id) {
      const a = actionnaires.find((x) => x.id === id);
      if (!a) return;
      setEditId(id);
      setNom(a.nom);
      setTel(a.tel || "");
      setPourcentageParts(a.pourcentageParts !== undefined ? String(a.pourcentageParts) : "");
      setNotesActionnaire(a.notes || "");
      setActif(a.actif !== false);
    } else {
      setEditId(null);
      setNom("");
      setTel("");
      setPourcentageParts("");
      setNotesActionnaire("");
      setActif(true);
    }
    setOpen(true);
  };

  const handleSave = () => {
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }
    if (pourcentageParts && (Number(pourcentageParts) < 0 || Number(pourcentageParts) > 100)) { toast.error("Le pourcentage de parts doit être entre 0 et 100"); return; }

    const champs: Partial<Actionnaire> = {
      nom: nom.trim(),
      tel: tel || undefined,
      pourcentageParts: pourcentageParts ? Number(pourcentageParts) : undefined,
      notes: notesActionnaire.trim() || undefined,
      actif,
    };

    if (editId) {
      const oldItem = actionnaires.find((a) => a.id === editId);
      const newItem = { ...oldItem, ...champs } as Actionnaire;
      const updated0 = { ...DB, actionnaires: actionnaires.map((a) => (a.id === editId ? newItem : a)) };
      const histEntry = oldItem ? updateHistoryEntry("Actionnaires", editId, nom.trim(), oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS) : null;
      const updated = histEntry ? addHistoryEntry(updated0, histEntry) : updated0;
      setDB(updated); saveDB(updated); logActivity("update", "Actionnaire", nom); toast.success("Modifié");
    } else {
      const item: Actionnaire = { id: uid(), nom: nom.trim(), tel: tel || undefined, pourcentageParts: pourcentageParts ? Number(pourcentageParts) : undefined, notes: notesActionnaire.trim() || undefined, actif: true };
      let updated = { ...DB, actionnaires: [...actionnaires, item] };
      const histEntry = createHistoryEntry("Actionnaires", item.id, item.nom, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated); logActivity("create", "Actionnaire", nom); toast.success("Actionnaire ajouté");
    }
    setOpen(false);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? actionnaires.find((a) => a.id === deleteId) || null : null;
  const mouvementsLies = deleteTarget ? mouvements.filter((m) => m.actionnaireId === deleteTarget.id).length : 0;

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    // Les mouvements déjà enregistrés pour cet actionnaire ne sont pas
    // supprimés ni modifiés — ils resteront visibles avec la mention
    // "(supprimé)" à la place du nom (même principe que EmployesSection).
    const updated0 = {
      ...DB,
      actionnaires: actionnaires.filter((a) => a.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "actionnaires", moduleName: "Actionnaire", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }],
    };
    const histEntry = deleteHistoryEntry("Actionnaires", item.id, item.nom, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    const updated = addHistoryEntry(updated0, histEntry);
    setDB(updated); saveDB(updated); logActivity("delete", "Actionnaire", item.nom); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  // ─── Dialog Mouvement (Déblocage / Dividende) ───────────────────────────
  const [openMvt, setOpenMvt] = useState(false);
  const [mvtDate, setMvtDate] = useState(todayLocal());
  const [mvtActionnaireId, setMvtActionnaireId] = useState("");
  const [mvtType, setMvtType] = useState<TypeMouvementActionnaire>("Déblocage");
  const [mvtMontant, setMvtMontant] = useState("");
  const [mvtReference, setMvtReference] = useState("");
  const [mvtNotes, setMvtNotes] = useState("");

  const actionnairesActifs = useMemo(() => actionnaires.filter((a) => a.actif !== false), [actionnaires]);

  const handleOpenMvt = (type: TypeMouvementActionnaire = "Déblocage") => {
    setMvtDate(todayLocal());
    setMvtActionnaireId(actionnairesActifs[0]?.id || "");
    setMvtType(type);
    setMvtMontant("");
    setMvtReference("");
    setMvtNotes("");
    setOpenMvt(true);
  };

  const handleSaveMvt = () => {
    if (!mvtActionnaireId) { toast.error("Sélectionnez un actionnaire"); return; }
    if (!mvtMontant || Number(mvtMontant) <= 0) { toast.error("Montant requis"); return; }
    const actionnaire = actionnaires.find((a) => a.id === mvtActionnaireId);
    const item: MouvementActionnaire = { id: uid(), date: mvtDate, actionnaireId: mvtActionnaireId, type: mvtType, montant: Number(mvtMontant), reference: mvtReference.trim() || undefined, notes: mvtNotes.trim() || undefined };
    let updated = { ...DB, mouvementsActionnaires: [...mouvements, item] };
    const desc = `${mvtType} - ${actionnaire?.nom || "?"} - ${fmt(item.montant)}`;
    const histEntry = createHistoryEntry("Actionnaires", item.id, desc, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("create", "Mouvement actionnaire", desc);
    toast.success(mvtType === "Déblocage" ? "Déblocage enregistré" : "Dividende enregistré");
    setOpenMvt(false);
  };

  const [deleteMvtId, setDeleteMvtId] = useState<string | null>(null);
  const deleteMvtTarget = deleteMvtId ? mouvements.find((m) => m.id === deleteMvtId) || null : null;

  const confirmDeleteMvt = () => {
    const item = deleteMvtTarget; if (!item) return;
    const actionnaire = actionnaires.find((a) => a.id === item.actionnaireId);
    const desc = `${item.type} - ${actionnaire?.nom || "?"} - ${fmt(item.montant)}`;
    const updated0 = {
      ...DB,
      mouvementsActionnaires: mouvements.filter((m) => m.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "mouvementsActionnaires", moduleName: "Mouvement actionnaire", desc, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }],
    };
    const histEntry = deleteHistoryEntry("Actionnaires", item.id, desc, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    const updated = addHistoryEntry(updated0, histEntry);
    setDB(updated); saveDB(updated); logActivity("delete", "Mouvement actionnaire", desc); toast.success("Mis à la corbeille");
    setDeleteMvtId(null);
  };

  // ─── Totaux ──────────────────────────────────────────────────────────────
  const totalDebloque = useMemo(() => mouvements.filter((m) => m.type === "Déblocage").reduce((s, m) => s + m.montant, 0), [mouvements]);
  const totalDividendes = useMemo(() => mouvements.filter((m) => m.type === "Dividende").reduce((s, m) => s + m.montant, 0), [mouvements]);
  const soldeNet = totalDebloque - totalDividendes;

  const parActionnaire = useMemo(() => {
    const map = new Map<string, { debloque: number; dividendes: number }>();
    mouvements.forEach((m) => {
      const cur = map.get(m.actionnaireId) || { debloque: 0, dividendes: 0 };
      if (m.type === "Déblocage") cur.debloque += m.montant; else cur.dividendes += m.montant;
      map.set(m.actionnaireId, cur);
    });
    return map;
  }, [mouvements]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Handshake className="w-6 h-6" /> Actionnaires
          </h2>
          <p className="text-sm text-gray-500">{actionnaires.length} actionnaire(s)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => handleOpenMvt("Déblocage")}><ArrowDownCircle className="w-4 h-4 mr-2 text-green-600" /> Nouveau déblocage</Button>
          <Button variant="outline" onClick={() => handleOpenMvt("Dividende")}><ArrowUpCircle className="w-4 h-4 mr-2 text-amber-600" /> Nouveau dividende</Button>
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouvel actionnaire</Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 -mt-4">
        Suivi séparé de l'argent débloqué par les actionnaires (entrée) et des dividendes qui leur sont versés (sortie). N'affecte pas le solde de caisse affiché dans Caisse/Tableau de bord.
      </p>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">💰 Total débloqué par les actionnaires</p>
            <p className="text-2xl font-bold text-green-600">{fmt(totalDebloque)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">🎁 Total dividendes versés</p>
            <p className="text-2xl font-bold text-amber-600">{fmt(totalDividendes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Solde net (débloqué − dividendes)</p>
            <p className={`text-2xl font-bold ${soldeNet >= 0 ? "text-gray-900" : "text-red-600"}`}>{fmt(soldeNet)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des actionnaires */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Nom</TableHead>
                  <TableHead className="text-white font-semibold">Tél</TableHead>
                  <TableHead className="text-white font-semibold">Parts</TableHead>
                  <TableHead className="text-white font-semibold text-right">Débloqué</TableHead>
                  <TableHead className="text-white font-semibold text-right">Dividendes reçus</TableHead>
                  <TableHead className="text-white font-semibold text-right">Solde net</TableHead>
                  <TableHead className="text-white font-semibold">Statut</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionnaires.length > 0 ? actionnaires.map((a) => {
                  const totaux = parActionnaire.get(a.id) || { debloque: 0, dividendes: 0 };
                  return (
                    <TableRow key={a.id} className={a.actif === false ? "opacity-60" : ""}>
                      <TableCell className="font-medium">{a.nom}</TableCell>
                      <TableCell>{a.tel || "-"}</TableCell>
                      <TableCell>{a.pourcentageParts !== undefined ? `${a.pourcentageParts}%` : "-"}</TableCell>
                      <TableCell className="text-right text-green-700 font-medium">{fmt(totaux.debloque)}</TableCell>
                      <TableCell className="text-right text-amber-700 font-medium">{fmt(totaux.dividendes)}</TableCell>
                      <TableCell className="text-right font-bold">{fmt(totaux.debloque - totaux.dividendes)}</TableCell>
                      <TableCell>{a.actif === false ? <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium">Inactif</span> : <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Actif</span>}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => handleOpen(a.id)}><Pencil className="w-3 h-3" /></Button>
                          <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(a.id)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow><TableCell colSpan={8} className="text-center text-gray-400 py-8">Aucun actionnaire enregistré</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tableau des mouvements */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-100 hover:bg-gray-100">
                  <TableHead>Date</TableHead>
                  <TableHead>Actionnaire</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Référence</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mouvements.length > 0 ? [...mouvements].reverse().map((m) => {
                  const a = actionnaires.find((x) => x.id === m.actionnaireId);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{fmtDate(m.date)}</TableCell>
                      <TableCell className="font-medium">{a?.nom || "(supprimé)"}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.type === "Déblocage" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                          {m.type}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right font-bold ${m.type === "Déblocage" ? "text-green-700" : "text-amber-700"}`}>{fmt(m.montant)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{m.reference || "-"}</TableCell>
                      <TableCell className="text-sm text-gray-500">{m.notes || "-"}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteMvtId(m.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">Aucun mouvement enregistré</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Actionnaire */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Modifier l'actionnaire" : "Nouvel actionnaire"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Nom</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Aziz Fall" /></div>
            <div><Label>Téléphone (9 chiffres)</Label><Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ""))} placeholder="771234567" />{tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}</div>
            <div><Label>Pourcentage de parts (%, informatif)</Label><Input type="number" min="0" max="100" value={pourcentageParts} onChange={(e) => setPourcentageParts(e.target.value)} placeholder="Ex: 50" /></div>
            <div><Label>Notes</Label><Textarea value={notesActionnaire} onChange={(e) => setNotesActionnaire(e.target.value)} placeholder="Notes complémentaires..." /></div>
            <div className="flex items-center justify-between border rounded-md p-3">
              <div><Label className="mb-0">Actif</Label><p className="text-xs text-gray-500">Un actionnaire inactif n'apparaît plus dans le menu déroulant des nouveaux mouvements.</p></div>
              <Switch checked={actif} onCheckedChange={setActif} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Mouvement */}
      <Dialog open={openMvt} onOpenChange={setOpenMvt}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouveau mouvement actionnaire</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Date</Label><Input type="date" value={mvtDate} onChange={(e) => setMvtDate(e.target.value)} /></div>
            <div>
              <Label>Actionnaire</Label>
              <Select value={mvtActionnaireId} onValueChange={setMvtActionnaireId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un actionnaire" /></SelectTrigger>
                <SelectContent>
                  {actionnairesActifs.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {actionnairesActifs.length === 0 && <p className="text-xs text-red-500 mt-1">Ajoutez d'abord un actionnaire.</p>}
            </div>
            <div>
              <Label>Type</Label>
              <Select value={mvtType} onValueChange={(v) => setMvtType(v as TypeMouvementActionnaire)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Déblocage">Déblocage (argent reçu de l'actionnaire)</SelectItem>
                  <SelectItem value="Dividende">Dividende (argent versé à l'actionnaire)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Montant (F)</Label><Input type="number" value={mvtMontant} onChange={(e) => setMvtMontant(e.target.value)} placeholder="0" /></div>
            <div><Label>Référence</Label><Input value={mvtReference} onChange={(e) => setMvtReference(e.target.value)} placeholder="Ex: Virement n°..." /></div>
            <div><Label>Notes</Label><Textarea value={mvtNotes} onChange={(e) => setMvtNotes(e.target.value)} placeholder="Notes complémentaires..." /></div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveMvt} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpenMvt(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer cet actionnaire ?"
        description={deleteTarget ? `${deleteTarget.nom}. Cette entrée sera déplacée vers la corbeille.${mouvementsLies > 0 ? ` ${mouvementsLies} mouvement(s) déjà enregistré(s) pour lui resteront visibles avec la mention "(supprimé)".` : ""}` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={!!deleteMvtId}
        onOpenChange={(o) => !o && setDeleteMvtId(null)}
        title="Supprimer ce mouvement ?"
        description={deleteMvtTarget ? `${deleteMvtTarget.type} - ${fmt(deleteMvtTarget.montant)}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDeleteMvt}
      />
    </div>
  );
}
