import { useState, useMemo, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, todayLocal, addYears, daysBetween } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { checkCloture } from "@/lib/cloture";

export default function MaintenanceSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [type, setType] = useState("Préventive");
  const [equipement, setEquipement] = useState("");
  const [description, setDescription] = useState("");
  const [cout, setCout] = useState("");
  const [prochaine, setProchaine] = useState("");
  const [showImpact, setShowImpact] = useState(false);
  const [arret, setArret] = useState(false);
  const [dureeArretHeures, setDureeArretHeures] = useState("");
  const [packsPerdusEstimes, setPacksPerdusEstimes] = useState("");

  // Une membrane a une durée de vie standard d'1 an : dès que l'équipement
  // saisi contient "membrane", la prochaine échéance est recalculée
  // automatiquement (date de l'intervention + 1 an). L'admin peut toujours
  // l'ajuster ensuite si besoin — ce n'est qu'un pré-remplissage.
  const isMembrane = (nomEquipement: string) => /membrane/i.test(nomEquipement);
  useEffect(() => {
    if (isMembrane(equipement)) {
      setProchaine(addYears(date, 1));
    }
  }, [equipement, date]);

  // Échéance "effective" affichée pour une intervention : le champ prochaine
  // saisi s'il existe, sinon — pour une membrane uniquement — date + 1 an
  // calculée à la volée. Permet aux entrées membrane créées avant
  // l'auto-remplissage (ou jamais éditées) d'afficher quand même la bonne
  // échéance, sans avoir à les modifier une par une.
  const echeanceEffective = (m: (typeof DB.maintenance)[number]) =>
    m.prochaine || (isMembrane(m.equipement) ? addYears(m.date, 1) : "");

  // KPI
  const coutTotal = useMemo(() => DB.maintenance.reduce((s, m) => s + m.cout, 0), [DB]);
  const prochaineEcheance = useMemo(() => {
    const futures = DB.maintenance
      .map((m) => echeanceEffective(m))
      .filter((d) => d && new Date(d) >= new Date())
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return futures.length > 0 ? fmtDate(futures[0]) : "-";
  }, [DB]);
  const packsPerdusTotal = useMemo(() => DB.maintenance.reduce((s, m) => s + (m.packsPerdusEstimes || 0), 0), [DB]);

  // Pour chaque équipement "membrane" (regroupé par nom), seule la dernière
  // intervention en date fait foi pour l'échéance — dès qu'une nouvelle
  // membrane est posée, elle prend le relais et l'alerte sur l'ancienne
  // échéance disparaît naturellement.
  const dernieresEcheancesMembrane = useMemo(() => {
    const parEquipement = new Map<string, (typeof DB.maintenance)[number]>();
    for (const m of DB.maintenance) {
      if (!isMembrane(m.equipement)) continue;
      const key = m.equipement.trim().toLowerCase();
      const courant = parEquipement.get(key);
      if (!courant || m.date > courant.date) parEquipement.set(key, m);
    }
    return new Set(Array.from(parEquipement.values()).map((m) => m.id));
  }, [DB]);

  const membraneBadge = (m: (typeof DB.maintenance)[number]) => {
    const echeance = echeanceEffective(m);
    if (!isMembrane(m.equipement) || !echeance || !dernieresEcheancesMembrane.has(m.id)) return null;
    const jours = daysBetween(todayLocal(), echeance);
    if (jours > 10) return null;
    return jours < 0 ? (
      <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
        <AlertTriangle className="w-3 h-3" /> En retard de {Math.abs(jours)} j
      </span>
    ) : (
      <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3 h-3" /> Dans {jours} j
      </span>
    );
  };

  const handleOpen = (id?: string) => {
    if (id) {
      const m = DB.maintenance.find((x) => x.id === id);
      if (!m) return;
      setEditId(id);
      setDate(m.date); setType(m.type); setEquipement(m.equipement); setDescription(m.description);
      setCout(m.cout ? String(m.cout) : ""); setProchaine(m.prochaine || "");
      setArret(!!m.arret); setDureeArretHeures(m.dureeArretHeures ? String(m.dureeArretHeures) : "");
      setPacksPerdusEstimes(m.packsPerdusEstimes ? String(m.packsPerdusEstimes) : "");
      setShowImpact(!!m.arret);
    } else {
      setEditId(null);
      setDate(todayLocal()); setType("Préventive"); setEquipement(""); setDescription(""); setCout("");
      setProchaine(""); setArret(false); setDureeArretHeures(""); setPacksPerdusEstimes(""); setShowImpact(false);
    }
    setOpen(true);
  };

  const handleSave = () => {
    if (!equipement.trim()) { toast.error("Équipement requis"); return; }
    const montant = Number(cout) || 0;
    const item = {
      id: editId || uid(), date, type, equipement: equipement.trim(), description, cout: montant, prochaine,
      arret: arret || undefined,
      dureeArretHeures: arret && dureeArretHeures ? Number(dureeArretHeures) : undefined,
      packsPerdusEstimes: arret && packsPerdusEstimes ? Number(packsPerdusEstimes) : undefined,
    };
    if (editId) {
      // Modification : on ne touche pas aux dépenses déjà générées (aucun
      // lien explicite ne les rattache à cette intervention pour les
      // resynchroniser sans risque de doublon ou de perte de données) —
      // seule l'intervention elle-même est mise à jour.
      const updated = { ...DB, maintenance: DB.maintenance.map((m) => m.id === editId ? item : m) };
      setDB(updated); saveDB(updated);
      logActivity("update", "Maintenance", `${type} - ${equipement}`);
      toast.success("Intervention modifiée");
    } else {
      // Créer automatiquement une dépense correspondante si le coût > 0, et
      // garder son id sur l'intervention (depenseId) pour pouvoir la
      // supprimer en cascade si l'intervention est supprimée plus tard.
      const depense = montant > 0 ? {
        id: uid(),
        date,
        categorie: "Maintenance machine",
        libelle: `${type} - ${equipement.trim()}${description ? " - " + description : ""}`,
        fournisseur: equipement.trim(),
        montant,
      } : null;
      const itemAvecDepense = depense ? { ...item, depenseId: depense.id } : item;
      const updated = {
        ...DB,
        maintenance: [...DB.maintenance, itemAvecDepense],
        ...(depense ? { depenses: [...DB.depenses, depense] } : {}),
      };
      setDB(updated); saveDB(updated);
      logActivity("create", "Maintenance", `${type} - ${equipement}`);
      toast.success(montant > 0 ? "Maintenance enregistrée et ajoutée aux dépenses" : "Maintenance enregistrée");
    }
    setOpen(false);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? DB.maintenance.find((m) => m.id === deleteId) || null : null;

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    // Même garde-fou que DepensesSection : on ne supprime rien (ni
    // l'intervention, ni la dépense liée) sur une journée déjà clôturée,
    // sauf pour un admin.
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); setDeleteId(null); return; }

    const depenseLiee = item.depenseId ? DB.depenses.find((d) => d.id === item.depenseId) : undefined;
    let updated = {
      ...DB,
      maintenance: DB.maintenance.filter((m) => m.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "maintenance", moduleName: "Maintenance", desc: `${item.type} - ${item.equipement}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }],
    };
    // Supprime en cascade la dépense créée automatiquement avec cette
    // intervention (uniquement si le lien depenseId existe — absent sur les
    // interventions créées avant l'ajout de ce champ).
    if (depenseLiee) {
      updated = {
        ...updated,
        depenses: updated.depenses.filter((d) => d.id !== depenseLiee.id),
        corbeille: [...updated.corbeille, { id: uid(), originalType: "depenses", moduleName: "Dépense", desc: `${depenseLiee.libelle} - ${fmt(depenseLiee.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: depenseLiee }],
      };
    }
    setDB(updated); saveDB(updated);
    logActivity("delete", "Maintenance", item.equipement + (depenseLiee ? " (+ dépense associée)" : ""));
    toast.success(depenseLiee ? "Intervention et dépense associée mises à la corbeille" : "Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>🔧</span> Maintenance machine
        </h2>
        <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
          <Plus className="w-4 h-4 mr-2" /> Nouvelle intervention
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Interventions</p>
            <p className="text-2xl font-bold text-gray-900">{DB.maintenance.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Coût total</p>
            <p className="text-2xl font-bold text-red-600">{fmt(coutTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Prochaine échéance</p>
            <p className="text-2xl font-bold text-red-600">{prochaineEcheance}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Packs perdus (pannes)</p>
            <p className="text-2xl font-bold text-orange-600">{packsPerdusTotal > 0 ? packsPerdusTotal : "-"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des interventions */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Type d'action</TableHead>
                  <TableHead className="text-white font-semibold">Équipement</TableHead>
                  <TableHead className="text-white font-semibold">Description</TableHead>
                  <TableHead className="text-white font-semibold">Coût</TableHead>
                  <TableHead className="text-white font-semibold">Prochaine échéance</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DB.maintenance.length > 0 ? [...DB.maintenance].reverse().map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{fmtDate(m.date)}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.type === "Préventive" ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"}`}>
                        {m.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {m.equipement}
                      {m.arret && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title={`${m.dureeArretHeures ? m.dureeArretHeures + "h d'arrêt" : ""}${m.packsPerdusEstimes ? ` — ${m.packsPerdusEstimes} packs perdus` : ""}`}>
                          <AlertTriangle className="w-3 h-3" /> Arrêt
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{m.description || "-"}</TableCell>
                    <TableCell className="font-bold">{fmt(m.cout)}</TableCell>
                    <TableCell>
                      {echeanceEffective(m) ? fmtDate(echeanceEffective(m)) : "-"}
                      {!m.prochaine && isMembrane(m.equipement) && (
                        <span className="text-xs text-gray-400 ml-1">(calculée)</span>
                      )}
                      {membraneBadge(m)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => handleOpen(m.id)} aria-label={`Modifier ${m.equipement}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(m.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-400 py-8">Aucune intervention enregistrée</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Nouvelle intervention / Modifier */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier l'intervention" : "Nouvelle intervention"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label>Type d'action</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Préventive">Préventive</SelectItem>
                  <SelectItem value="Corrective">Corrective</SelectItem>
                  <SelectItem value="Nettoyage">Nettoyage</SelectItem>
                  <SelectItem value="Remplacement">Remplacement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Équipement</Label><Input value={equipement} onChange={(e) => setEquipement(e.target.value)} placeholder="Ex: Machine de soudure, Pompe..." /></div>
            <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Détails de l'intervention..." /></div>
            <div><Label>Coût (F)</Label><Input type="number" value={cout} onChange={(e) => setCout(e.target.value)} placeholder="0" /></div>
            <div>
              <Label>Prochaine échéance</Label>
              <Input type="date" value={prochaine} onChange={(e) => setProchaine(e.target.value)} />
              {isMembrane(equipement) && (
                <p className="text-xs text-gray-500 mt-1">
                  Membrane détectée : échéance pré-remplie à 1 an. Une alerte sera envoyée 10 jours avant, jusqu'au remplacement.
                </p>
              )}
            </div>

            <button type="button" onClick={() => setShowImpact(!showImpact)} className="flex items-center gap-1 text-sm text-[#1B4B6B] font-medium">
              {showImpact ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Impact sur la production (optionnel)
            </button>
            {showImpact && (
              <div className="space-y-4 p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="arret-machine" checked={arret} onChange={(e) => setArret(e.target.checked)} className="w-4 h-4" />
                  <Label htmlFor="arret-machine" className="cursor-pointer">Cette intervention a provoqué un arrêt de production</Label>
                </div>
                {arret && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Durée d'arrêt (heures)</Label><Input type="number" value={dureeArretHeures} onChange={(e) => setDureeArretHeures(e.target.value)} placeholder="Optionnel" /></div>
                    <div><Label>Packs perdus estimés</Label><Input type="number" value={packsPerdusEstimes} onChange={(e) => setPacksPerdusEstimes(e.target.value)} placeholder="Optionnel" /></div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">{editId ? "Modifier" : "Enregistrer"}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer cette intervention ?"
        description={deleteTarget ? `${deleteTarget.type} - ${deleteTarget.equipement}. Cette entrée${deleteTarget.depenseId && DB.depenses.some((d) => d.id === deleteTarget.depenseId) ? " et la dépense associée seront déplacées" : " sera déplacée"} vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
