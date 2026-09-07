import { useState, useMemo, useCallback, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, resteVente, getMoisCourant, todayLocal } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Banknote, Trash2, Pencil, Smartphone, Copy, MessageCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { Pagination } from "@/components/Pagination";
import TableFilters from "@/components/TableFilters";
import { useTableFilters } from "@/hooks/useTableFilters";
import type { Recouvrement, MobileMoneyIntent } from "@/lib/types";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { db, onSnapshot, collection } from "@/lib/firebase";
import { cfCreateWaveCheckoutSession } from "@/lib/cloudFunctions";

export default function RecouvrementSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [venteId, setVenteId] = useState("");
  const [clientName, setClientName] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("Espèces");
  const [notes, setNotes] = useState("");

  const isAdmin = currentUser?.role === "admin";

  const ventesCredit = useMemo(() => DB.ventes.filter((v) => resteVente(v, DB) > 0), [DB]);

  // ─── Paiement mobile money (Wave) ───────────────────────────────────────
  // Écoute directe de la collection mobileMoneyIntents plutôt que de passer
  // par AppContext (déjà volumineux) — ce statut n'est utile que dans cette
  // section. Le recouvrement RÉEL, lui, n'apparaît dans DB.recouvrements
  // qu'une fois le webhook Wave confirmé côté serveur (voir waveWebhook) :
  // il est donc synchronisé automatiquement via le listener déjà existant
  // dans AppContext, sans code supplémentaire ici.
  const [waveIntents, setWaveIntents] = useState<MobileMoneyIntent[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "mobileMoneyIntents"), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MobileMoneyIntent & { _createdAt?: any }));
      setWaveIntents(items as MobileMoneyIntent[]);
    });
    return () => unsub();
  }, []);
  const waveIntentsEnAttente = useMemo(
    () => (waveIntents as any[]).filter((i) => i.statut === "en_attente").sort((a, b) => (b._createdAt?.seconds || 0) - (a._createdAt?.seconds || 0)),
    [waveIntents]
  );

  const [openWave, setOpenWave] = useState(false);
  const [waveVenteId, setWaveVenteId] = useState("");
  const [waveClientName, setWaveClientName] = useState("");
  const [waveMontant, setWaveMontant] = useState("");
  const [waveLoading, setWaveLoading] = useState(false);
  const [waveResultUrl, setWaveResultUrl] = useState<string | null>(null);

  const handleOpenWave = () => {
    setWaveVenteId(""); setWaveClientName(""); setWaveMontant(""); setWaveResultUrl(null);
    setOpenWave(true);
  };

  const handleWaveVenteChange = (id: string) => {
    setWaveVenteId(id);
    const vente = DB.ventes.find((v) => v.id === id);
    if (vente) {
      setWaveMontant(String(resteVente(vente, DB)));
      setWaveClientName(vente.client);
    }
  };

  const handleGenerateWaveLink = async () => {
    if (!waveClientName.trim()) { toast.error("Indiquez le nom du client"); return; }
    const montantNum = Number(waveMontant);
    if (!montantNum || montantNum <= 0) { toast.error("Montant invalide"); return; }
    setWaveLoading(true);
    // Vente.client est le NOM du client (les ventes sont rattachées par nom,
    // pas par id, comme partout ailleurs dans l'app) — clientId reste
    // optionnel côté Cloud Function et n'est pas renseigné ici.
    const result = await cfCreateWaveCheckoutSession({
      venteId: waveVenteId || undefined,
      clientNom: waveClientName.trim(),
      montant: montantNum,
    });
    setWaveLoading(false);
    if (result.success && result.data) {
      setWaveResultUrl(result.data.checkoutUrl);
      toast.success("Lien de paiement Wave généré");
    } else {
      toast.error(result.fallback ? "Paiement mobile money indisponible pour le moment (Cloud Functions injoignables)." : (result.error || "Erreur lors de la génération du lien"));
    }
  };

  const copyWaveLink = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Lien copié"),
      () => toast.error("Impossible de copier le lien")
    );
  };

  const shareWaveLinkWhatsapp = (url: string, client: string, montantF: string) => {
    const text = `Bonjour ${client}, voici votre lien de paiement Wave pour ${montantF} chez MA2F AquaSachet : ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  // KPI
  const moisCourant = getMoisCourant();
  const encaisseMois = useMemo(() => {
    return DB.recouvrements
      .filter((r) => r.date && r.date.startsWith(moisCourant))
      .reduce((s, r) => s + r.montant, 0);
  }, [DB, moisCourant]);

  const totalCumule = useMemo(() => {
    return DB.recouvrements.reduce((s, r) => s + r.montant, 0);
  }, [DB]);

  // Données triées
  const sortedRecouvrements = useMemo(() =>
    [...DB.recouvrements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [DB.recouvrements]
  );

  // Catégories pour le filtre (mode de paiement)
  const modeCategories = useMemo(() => [
    { value: "Espèces", label: "Espèces" },
    { value: "Wave", label: "Wave" },
    { value: "Orange Money", label: "Orange Money" },
    { value: "Mobile Money", label: "Mobile Money" },
    { value: "Chèque", label: "Chèque" },
    { value: "Virement", label: "Virement" },
  ], []);

  // Filtres avancés
  const getDate = useCallback((r: Recouvrement) => r.date, []);
  const getCategory = useCallback((r: Recouvrement) => r.mode, []);
  const getSearchText = useCallback((r: Recouvrement) => `${r.numeroBL || ""} ${r.client} ${r.notes || ""}`, []);

  const { filters, setFilters, filteredData, totalCount, resultCount } = useTableFilters({
    data: sortedRecouvrements,
    getDate,
    getCategory,
    getSearchText,
  });

  const pagination = usePagination(filteredData, { pageSize: 20 });

  // Total filtré
  const totalFiltre = filteredData.reduce((s, r) => s + r.montant, 0);

  const handleOpenEncaissement = () => {
    setEditId(null);
    setVenteId("");
    setClientName("");
    setDate(todayLocal());
    setMontant("");
    setMode("Espèces");
    setNotes("");
    setOpen(true);
  };

  const handleEdit = (r: Recouvrement) => {
    setEditId(r.id);
    setVenteId(r.venteId || "");
    setClientName(r.client);
    setDate(r.date);
    setMontant(String(r.montant));
    setMode(r.mode);
    setNotes(r.notes || "");
    setOpen(true);
  };

  const [deleteTarget, setDeleteTarget] = useState<Recouvrement | null>(null);

  const handleDelete = (r: Recouvrement) => {
    const clotureMsg = checkCloture(r.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    setDeleteTarget(r);
  };

  const confirmDelete = async () => {
    const r = deleteTarget;
    if (!r) return;
    let updated = {
      ...DB,
      recouvrements: DB.recouvrements.filter((rec) => rec.id !== r.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "recouvrements", moduleName: "Recouvrement", desc: `${r.numeroBL || "Sans BL"} - ${r.client} - ${fmt(r.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: r }],
    };
    const histEntry = createHistoryEntry("Recouvrements", r.id, `Suppression: ${r.client} - ${fmt(r.montant)}`, r as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); await saveDB(updated);
    logActivity("delete", "Recouvrement", `${r.numeroBL || "Sans BL"} - ${r.client} - ${fmt(r.montant)}`);
    toast.success("Encaissement supprimé");
    setDeleteTarget(null);
  };

  const handleVenteChange = (id: string) => {
    setVenteId(id);
    const vente = DB.ventes.find((v) => v.id === id);
    if (vente) {
      const reste = resteVente(vente, DB);
      setMontant(String(reste));
      setClientName(vente.client);
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);

    const montantNum = Number(montant);

    // Validation de base
    if (!clientName.trim()) { toast.error("Indiquez le nom du client"); setSaving(false); return; }
    if (!montantNum || montantNum <= 0) { toast.error("Montant invalide"); setSaving(false); return; }
    if (!date) { toast.error("Indiquez la date"); setSaving(false); return; }

    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); setSaving(false); return; }

    // Si une vente est sélectionnée, vérifier le reste dû
    let numeroBL = "";
    if (venteId) {
      const vente = DB.ventes.find((v) => v.id === venteId);
      if (vente) {
        numeroBL = vente.numero;
        const reste = resteVente(vente, DB);
        if (montantNum > reste) {
          toast.error(`Le montant dépasse le reste dû (${fmt(reste)})`);
          setSaving(false);
          return;
        }
      }
    }

    const item: Recouvrement = {
      id: editId || uid(),
      venteId: venteId || "",
      numeroBL: numeroBL || "",
      client: clientName.trim(),
      date,
      montant: montantNum,
      mode,
      notes,
    };

    let updated: typeof DB;
    if (editId) {
      updated = { ...DB, recouvrements: DB.recouvrements.map((r) => r.id === editId ? item : r) };
    } else {
      updated = { ...DB, recouvrements: [...DB.recouvrements, item] };
    }
    // Historique
    const histEntry = createHistoryEntry("Recouvrements", item.id, `${numeroBL || "Sans BL"} - ${item.client}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); await saveDB(updated);

    if (editId) {
      logActivity("update", "Recouvrement", `Modifi\u00e9: ${item.client} - ${fmt(montantNum)}`);
      toast.success("Encaissement modifi\u00e9");
    } else if (venteId) {
      const vente = DB.ventes.find((v) => v.id === venteId);
      if (vente) {
        const reste = resteVente(vente, DB);
        const nouveauReste = reste - montantNum;
        if (nouveauReste <= 0) {
          logActivity("create", "Recouvrement", `SOLD\u00c9: ${numeroBL} - ${item.client} - ${fmt(montantNum)}`);
          toast.success(`Cr\u00e9ance sold\u00e9e ! ${numeroBL} - ${item.client}`);
        } else {
          logActivity("create", "Recouvrement", `Encaissement: ${numeroBL} - ${item.client} - ${fmt(montantNum)} (reste: ${fmt(nouveauReste)})`);
          toast.success(`Encaissement enregistr\u00e9. Reste d\u00fb: ${fmt(nouveauReste)}`);
        }
      }
    } else {
      logActivity("create", "Recouvrement", `Encaissement libre: ${item.client} - ${fmt(montantNum)}`);
      toast.success(`Encaissement enregistr\u00e9 pour ${item.client}`);
    }

    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>💰</span> Recouvrement
        </h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleOpenWave} variant="outline" className="border-[#1B4B6B] text-[#1B4B6B] hover:bg-blue-50">
            <Smartphone className="w-4 h-4 mr-2" /> Lien de paiement Wave
          </Button>
          <Button onClick={handleOpenEncaissement} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
            <Plus className="w-4 h-4 mr-2" /> Encaissement
          </Button>
        </div>
      </div>

      {/* Paiements Wave en attente */}
      {waveIntentsEnAttente.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-amber-800">
              <Clock className="w-4 h-4" /> {waveIntentsEnAttente.length} lien(s) de paiement Wave en attente
            </h3>
            <div className="space-y-2">
              {waveIntentsEnAttente.map((intent: any) => (
                <div key={intent.id} className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 rounded-lg p-2.5 text-sm">
                  <div>
                    <span className="font-medium">{intent.client}</span>
                    <span className="text-gray-500"> — {fmt(intent.montant)}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {intent.waveCheckoutUrl && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyWaveLink(intent.waveCheckoutUrl)}>
                          <Copy className="w-3 h-3 mr-1" /> Copier
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => shareWaveLinkWhatsapp(intent.waveCheckoutUrl, intent.client, fmt(intent.montant))}>
                          <MessageCircle className="w-3 h-3 mr-1" /> WhatsApp
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Encaissé ce mois</p>
            <p className="text-2xl font-bold text-green-600">{fmt(encaisseMois)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Nb encaissements</p>
            <p className="text-2xl font-bold text-gray-900">{DB.recouvrements.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total cumulé</p>
            <p className="text-2xl font-bold text-green-600">{fmt(totalCumule)}</p>
            {(filters.dateFrom || filters.dateTo || filters.category || filters.search) && (
              <p className="text-xs text-gray-500 mt-1">Filtré : <span className="font-bold text-green-600">{fmt(totalFiltre)}</span></p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filtres avancés */}
      <TableFilters
        config={{
          dateRange: true,
          search: true,
          searchPlaceholder: "Rechercher par N° BL, client...",
          categories: modeCategories,
          categoryLabel: "Mode paiement",
        }}
        values={filters}
        onChange={setFilters}
        resultCount={resultCount}
        totalCount={totalCount}
      />

      {/* Tableau des encaissements */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">N° BL</TableHead>
                  <TableHead className="text-white font-semibold">Client</TableHead>
                  <TableHead className="text-white font-semibold">Montant</TableHead>
                  <TableHead className="text-white font-semibold">Mode</TableHead>
                  <TableHead className="text-white font-semibold">Notes</TableHead>
                  {isAdmin && <TableHead className="text-white font-semibold">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.paginatedItems.length > 0 ? pagination.paginatedItems.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell className="font-mono">{r.numeroBL || "-"}</TableCell>
                    <TableCell className="font-medium">{r.client}</TableCell>
                    <TableCell className="font-bold text-green-600">{fmt(r.montant)}</TableCell>
                    <TableCell>{r.mode}</TableCell>
                    <TableCell className="text-sm text-gray-500">{r.notes || "-"}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(r)} className="h-7 w-7 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(r)} className="h-7 w-7 p-0 text-red-600 hover:text-red-800 hover:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-gray-400 py-8">
                      {filters.search || filters.dateFrom || filters.dateTo || filters.category ? "Aucun résultat avec ces filtres" : "Aucun encaissement"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      {/* Dialog Encaissement */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-green-600" />
              {editId ? "Modifier l'encaissement" : "Nouvel encaissement"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <Label>Client</Label>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nom du client"
              />
            </div>
            <div>
              <Label>Lier à un BL (optionnel)</Label>
              <Select value={venteId} onValueChange={handleVenteChange}>
                <SelectTrigger><SelectValue placeholder="Aucun BL — encaissement libre" /></SelectTrigger>
                <SelectContent>
                  {ventesCredit.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.numero} - {v.client} (reste: {fmt(resteVente(v, DB))})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {venteId && (() => {
              const vente = DB.ventes.find((v) => v.id === venteId);
              if (!vente) return null;
              const reste = resteVente(vente, DB);
              return (
                <div className="bg-gray-50 p-3 rounded-lg border space-y-1">
                  <p className="text-sm"><span className="font-medium">Client:</span> {vente.client}</p>
                  <p className="text-sm"><span className="font-medium">Reste dû:</span> <span className="text-red-600 font-bold">{fmt(reste)}</span></p>
                  {Number(montant) >= reste && Number(montant) > 0 && (
                    <p className="text-xs text-emerald-600 font-medium mt-2">✓ Cette créance sera marquée comme SOLDÉE</p>
                  )}
                </div>
              );
            })()}
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Montant encaissé (F)</Label>
              <Input type="number" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Mode de paiement</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Espèces", "Wave", "Orange Money", "Mobile Money", "Chèque", "Virement"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optionnel)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Commentaire..." />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                <Banknote className="w-4 h-4 mr-2" />
                {saving ? "Enregistrement..." : editId ? "Modifier" : "Enregistrer"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Lien de paiement Wave */}
      <Dialog open={openWave} onOpenChange={setOpenWave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-[#1B4B6B]" />
              Lien de paiement Wave
            </DialogTitle>
          </DialogHeader>
          {!waveResultUrl ? (
            <div className="space-y-4 pt-4">
              <div>
                <Label>Lier à un BL (optionnel)</Label>
                <Select value={waveVenteId} onValueChange={handleWaveVenteChange}>
                  <SelectTrigger><SelectValue placeholder="Aucun BL — encaissement libre" /></SelectTrigger>
                  <SelectContent>
                    {ventesCredit.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.numero} - {v.client} (reste: {fmt(resteVente(v, DB))})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Client</Label>
                <Input value={waveClientName} onChange={(e) => setWaveClientName(e.target.value)} placeholder="Nom du client" />
              </div>
              <div>
                <Label>Montant à demander (F)</Label>
                <Input type="number" value={waveMontant} onChange={(e) => setWaveMontant(e.target.value)} placeholder="0" />
              </div>
              <p className="text-xs text-gray-400">
                Le lien envoie le client vers l'app Wave pour payer. Le recouvrement n'apparaît dans les encaissements qu'une fois le paiement réellement confirmé par Wave — générer le lien seul ne crée rien.
              </p>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleGenerateWaveLink} disabled={waveLoading} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                  {waveLoading ? "Génération..." : "Générer le lien"}
                </Button>
                <Button variant="outline" onClick={() => setOpenWave(false)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800 font-medium mb-1">Lien généré avec succès</p>
                <p className="text-xs text-gray-600 break-all">{waveResultUrl}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => copyWaveLink(waveResultUrl)}>
                  <Copy className="w-4 h-4 mr-2" /> Copier le lien
                </Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => shareWaveLinkWhatsapp(waveResultUrl, waveClientName, fmt(Number(waveMontant)))}>
                  <MessageCircle className="w-4 h-4 mr-2" /> Envoyer via WhatsApp
                </Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setOpenWave(false)}>Fermer</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer cet encaissement ?"
        description={deleteTarget ? `${deleteTarget.numeroBL || "Sans BL"} - ${deleteTarget.client} - ${fmt(deleteTarget.montant)}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
