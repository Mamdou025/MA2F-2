import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  type ApprovalRequest,
  canApprove,
  approveRequest,
  rejectRequest,
  expireOldRequests,
  getActionLabel,
  getApprovalStats,
  createApprovalRequest,
  getRequestableActionsForRole,
  DEFAULT_APPROVAL_CONFIG,
} from "@/lib/approvalWorkflow";
import { executeApprovedRequest } from "@/lib/approvalExecution";
import { uid } from "@/lib/helpers";

export default function ApprobationsSection() {
  const { DB, setDB, saveDB, currentUser, logActivity } = useApp();
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [motifRejet, setMotifRejet] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected" | "expired">("all");

  const isApprobateur = !!currentUser && DEFAULT_APPROVAL_CONFIG.rolesApprobateurs.includes(currentUser.role);

  // Formulaire "Nouvelle demande"
  const [showNewRequestDialog, setShowNewRequestDialog] = useState(false);
  const [newActionKey, setNewActionKey] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newMontant, setNewMontant] = useState("");
  const [newTargetId, setNewTargetId] = useState("");
  const [newProduit, setNewProduit] = useState<"sachet_plein" | "rouleau_plastique">("sachet_plein");
  const [newSens, setNewSens] = useState<"entree" | "sortie">("sortie");
  const [newQuantite, setNewQuantite] = useState("");
  const [newPropMontant, setNewPropMontant] = useState("");
  const [newPropMode, setNewPropMode] = useState("");
  const [newPropNotes, setNewPropNotes] = useState("");

  const actionsDemandables = useMemo(
    () => (currentUser ? getRequestableActionsForRole(currentUser.role) : []),
    [currentUser]
  );

  const selectedActionDef = useMemo(
    () => actionsDemandables.find((a) => a.key === newActionKey),
    [actionsDemandables, newActionKey]
  );

  // Expirer les anciennes demandes
  const allRequests = useMemo(() => {
    return expireOldRequests((DB.approvals || []) as ApprovalRequest[]);
  }, [DB.approvals]);

  // Un non-approbateur ne voit que ses propres demandes ; l'admin voit tout.
  const requests = useMemo(() => {
    if (isApprobateur || !currentUser) return allRequests;
    return allRequests.filter((r) => r.initiateur.userId === currentUser.uid);
  }, [allRequests, isApprobateur, currentUser]);

  const stats = useMemo(() => getApprovalStats(requests), [requests]);

  const filteredRequests = useMemo(() => {
    if (filter === "all") return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const pendingForMe = useMemo(() => {
    if (!currentUser) return [];
    return allRequests.filter((r) =>
      canApprove(r, currentUser.uid, currentUser.role, DEFAULT_APPROVAL_CONFIG)
    );
  }, [allRequests, currentUser]);

  const resetNewRequestForm = () => {
    setNewActionKey("");
    setNewDescription("");
    setNewMontant("");
    setNewTargetId("");
    setNewProduit("sachet_plein");
    setNewSens("sortie");
    setNewQuantite("");
    setNewPropMontant("");
    setNewPropMode("");
    setNewPropNotes("");
  };

  // Options de cible selon le type d'action choisi — permet à l'admin
  // d'exécuter l'action sur un enregistrement précis à l'approbation.
  const targetOptions = useMemo(() => {
    if (selectedActionDef?.cible === "vente") {
      return DB.ventes.map((v) => ({ id: v.id, label: `${v.numero} - ${v.client} (${v.packs} packs)` }));
    }
    if (selectedActionDef?.cible === "client") {
      return DB.clients.map((c) => ({ id: c.id, label: c.nom }));
    }
    if (selectedActionDef?.cible === "recouvrement" || selectedActionDef?.cible === "recouvrement_modif") {
      return DB.recouvrements.map((r) => ({
        id: r.id,
        label: `${r.numeroBL || "Sans BL"} - ${r.client} - ${r.montant.toLocaleString("fr-FR")} F (${r.date})`,
      }));
    }
    return [];
  }, [selectedActionDef, DB.ventes, DB.clients, DB.recouvrements]);

  const handleCreateRequest = () => {
    if (!currentUser) return;
    if (!newActionKey) {
      toast.error("Choisissez le type de demande");
      return;
    }
    if (!newDescription.trim()) {
      toast.error("Décrivez votre demande (motif obligatoire)");
      return;
    }
    const needsTarget =
      selectedActionDef?.cible === "vente" ||
      selectedActionDef?.cible === "client" ||
      selectedActionDef?.cible === "recouvrement" ||
      selectedActionDef?.cible === "recouvrement_modif";
    if (needsTarget && !newTargetId) {
      toast.error("Sélectionnez l'enregistrement concerné");
      return;
    }
    if (selectedActionDef?.cible === "ajustement_stock" && (!newQuantite || Number(newQuantite) <= 0)) {
      toast.error("Indiquez une quantité valide");
      return;
    }
    if (selectedActionDef?.cible === "recouvrement_modif" && !newPropMontant && !newPropMode && !newPropNotes.trim()) {
      toast.error("Proposez au moins un changement (montant, mode ou notes)");
      return;
    }

    let details: Record<string, any> = {};
    if (selectedActionDef?.cible === "vente" || selectedActionDef?.cible === "client" || selectedActionDef?.cible === "recouvrement") {
      const target = targetOptions.find((t) => t.id === newTargetId);
      details = { targetId: newTargetId, targetLabel: target?.label };
    } else if (selectedActionDef?.cible === "recouvrement_modif") {
      const target = targetOptions.find((t) => t.id === newTargetId);
      details = {
        targetId: newTargetId,
        targetLabel: target?.label,
        ...(newPropMontant ? { montant: Number(newPropMontant) } : {}),
        ...(newPropMode ? { mode: newPropMode } : {}),
        ...(newPropNotes.trim() ? { notes: newPropNotes.trim() } : {}),
      };
    } else if (selectedActionDef?.cible === "ajustement_stock") {
      details = { produit: newProduit, sens: newSens, quantite: Number(newQuantite) };
    }

    const request = createApprovalRequest({
      action: newActionKey,
      module: selectedActionDef?.section || "approbations",
      description: newDescription.trim(),
      details,
      montant: newMontant ? Number(newMontant) : undefined,
      initiateur: {
        userId: currentUser.uid,
        email: currentUser.email,
        role: currentUser.role,
        nom: currentUser.nom,
      },
    });
    request.id = `apr_${uid()}`;
    const newApprovals = [...(DB.approvals || []), request];
    const newDB = { ...DB, approvals: newApprovals };
    setDB(newDB);
    saveDB(newDB);
    logActivity("demande", "Approbations", `Nouvelle demande: ${getActionLabel(newActionKey)} — ${newDescription.trim()}`);
    toast.success("Demande envoyée à l'admin");
    setShowNewRequestDialog(false);
    resetNewRequestForm();
  };

  const handleApprove = (request: ApprovalRequest) => {
    if (!currentUser) return;

    // Exécute réellement l'action (si le type d'action le prévoit) avant de
    // marquer la demande comme approuvée. Si ça échoue (cible disparue,
    // clôture verrouillée...), on n'approuve pas et on informe l'admin.
    const { db: executedDB, error } = executeApprovedRequest(request, DB, currentUser.nom);
    if (error) {
      toast.error(`Exécution impossible : ${error}`);
      return;
    }

    const updated = approveRequest(request, {
      userId: currentUser.uid,
      email: currentUser.email,
      role: currentUser.role,
      nom: currentUser.nom,
    });
    const newApprovals = (executedDB.approvals || requests).map((r: ApprovalRequest) =>
      r.id === request.id ? updated : r
    );
    const newDB = { ...executedDB, approvals: newApprovals };
    setDB(newDB);
    saveDB(newDB);
    logActivity("approbation", "Approbations", `Approuvé: ${getActionLabel(request.action)} — ${request.description}`);
    toast.success("Demande approuvée et exécutée");
    setSelectedRequest(null);
  };

  const handleReject = () => {
    if (!currentUser || !selectedRequest || !motifRejet.trim()) {
      toast.error("Le motif de rejet est obligatoire");
      return;
    }
    const updated = rejectRequest(
      selectedRequest,
      {
        userId: currentUser.uid,
        email: currentUser.email,
        role: currentUser.role,
        nom: currentUser.nom,
      },
      motifRejet
    );
    const newApprovals = requests.map((r) => (r.id === selectedRequest.id ? updated : r));
    const newDB = { ...DB, approvals: newApprovals };
    setDB(newDB);
    saveDB(newDB);
    logActivity("rejet", "Approbations", `Rejeté: ${getActionLabel(selectedRequest.action)} — Motif: ${motifRejet}`);
    toast.success("Demande rejetée");
    setShowRejectDialog(false);
    setSelectedRequest(null);
    setMotifRejet("");
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge className="bg-amber-100 text-amber-800">En attente</Badge>;
      case "approved": return <Badge className="bg-green-100 text-green-800">Approuvée</Badge>;
      case "rejected": return <Badge className="bg-red-100 text-red-800">Rejetée</Badge>;
      case "expired": return <Badge className="bg-gray-100 text-gray-600">Expirée</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{isApprobateur ? "Approbations" : "Mes demandes"}</h2>
        <div className="flex items-center gap-2">
          {pendingForMe.length > 0 && (
            <Badge className="bg-red-500 text-white text-sm px-3 py-1">
              {pendingForMe.length} en attente de votre validation
            </Badge>
          )}
          {actionsDemandables.length > 0 && (
            <Button size="sm" onClick={() => setShowNewRequestDialog(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nouvelle demande
            </Button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilter("all")}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-gray-500">Total</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow border-amber-200" onClick={() => setFilter("pending")}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
            <p className="text-xs text-gray-500">En attente</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow border-green-200" onClick={() => setFilter("approved")}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
            <p className="text-xs text-gray-500">Approuvées</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow border-red-200" onClick={() => setFilter("rejected")}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
            <p className="text-xs text-gray-500">Rejetées</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow border-gray-200" onClick={() => setFilter("expired")}>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-500">{stats.expired}</p>
            <p className="text-xs text-gray-500">Expirées</p>
          </CardContent>
        </Card>
      </div>

      {/* Liste des demandes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {filter === "all" ? "Toutes les demandes" : `Demandes ${filter === "pending" ? "en attente" : filter === "approved" ? "approuvées" : filter === "rejected" ? "rejetées" : "expirées"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredRequests.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Aucune demande d'approbation</p>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map((req) => (
                <div
                  key={req.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {statusBadge(req.status)}
                        <span className="font-medium text-sm">{getActionLabel(req.action)}</span>
                      </div>
                      <p className="text-sm text-gray-700">{req.description}</p>
                      {req.details?.targetLabel && (
                        <p className="text-xs text-gray-600 mt-0.5">Cible : {req.details.targetLabel}</p>
                      )}
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>Par: {req.initiateur.nom}</span>
                        <span>Le: {new Date(req.createdAt).toLocaleString("fr-FR")}</span>
                        {req.montant && <span>Montant: {req.montant.toLocaleString("fr-FR")} F</span>}
                      </div>
                      {req.approbateur && (
                        <p className="text-xs text-gray-500 mt-1">
                          {req.status === "approved" ? "Approuvé" : "Rejeté"} par {req.approbateur.nom} le{" "}
                          {new Date(req.resolvedAt || "").toLocaleString("fr-FR")}
                        </p>
                      )}
                      {req.motifRejet && (
                        <p className="text-xs text-red-600 mt-1">Motif: {req.motifRejet}</p>
                      )}
                    </div>
                    {currentUser && canApprove(req, currentUser.uid, currentUser.role, DEFAULT_APPROVAL_CONFIG) && (
                      <div className="flex gap-2 ml-4">
                        <Button size="sm" onClick={() => handleApprove(req)} className="bg-green-600 hover:bg-green-700">
                          Approuver
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-600 hover:bg-red-50"
                          onClick={() => { setSelectedRequest(req); setShowRejectDialog(true); }}
                        >
                          Rejeter
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration — visible uniquement des approbateurs (admin) */}
      {isApprobateur && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuration des seuils</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">Seuil vente à crédit</p>
                <p className="text-gray-600">{DEFAULT_APPROVAL_CONFIG.seuilVenteCredit.toLocaleString("fr-FR")} F</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">Seuil versement</p>
                <p className="text-gray-600">{DEFAULT_APPROVAL_CONFIG.seuilVersement.toLocaleString("fr-FR")} F</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">Seuil dépense</p>
                <p className="text-gray-600">
                  {DB.params.seuilApprobationDepense
                    ? `${DB.params.seuilApprobationDepense.toLocaleString("fr-FR")} F`
                    : "Non configuré (désactivé) — réglable dans Paramètres"}
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">Délai d'expiration</p>
                <p className="text-gray-600">{DEFAULT_APPROVAL_CONFIG.delaiExpiration} heures</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">Rôles approbateurs</p>
                <p className="text-gray-600">{DEFAULT_APPROVAL_CONFIG.rolesApprobateurs.join(", ")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog "Nouvelle demande" */}
      <Dialog open={showNewRequestDialog} onOpenChange={(open) => { setShowNewRequestDialog(open); if (!open) resetNewRequestForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle demande</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type de demande</Label>
              <Select value={newActionKey} onValueChange={setNewActionKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une action" />
                </SelectTrigger>
                <SelectContent>
                  {actionsDemandables.map((a) => (
                    <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(selectedActionDef?.cible === "vente" ||
              selectedActionDef?.cible === "client" ||
              selectedActionDef?.cible === "recouvrement" ||
              selectedActionDef?.cible === "recouvrement_modif") && (
              <div className="space-y-1.5">
                <Label>
                  {selectedActionDef.cible === "vente" && "Vente concernée"}
                  {selectedActionDef.cible === "client" && "Client concerné"}
                  {(selectedActionDef.cible === "recouvrement" || selectedActionDef.cible === "recouvrement_modif") && "Encaissement concerné"}
                </Label>
                <Select value={newTargetId} onValueChange={setNewTargetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {targetOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedActionDef?.cible === "recouvrement_modif" && (
              <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Laissez vide les champs que vous ne souhaitez pas changer.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Nouveau montant</Label>
                    <Input
                      type="number"
                      placeholder="Inchangé"
                      value={newPropMontant}
                      onChange={(e) => setNewPropMontant(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nouveau mode</Label>
                    <Select value={newPropMode} onValueChange={setNewPropMode}>
                      <SelectTrigger><SelectValue placeholder="Inchangé" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Espèces">Espèces</SelectItem>
                        <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                        <SelectItem value="Virement">Virement</SelectItem>
                        <SelectItem value="Chèque">Chèque</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Nouvelles notes</Label>
                  <Input
                    placeholder="Inchangé"
                    value={newPropNotes}
                    onChange={(e) => setNewPropNotes(e.target.value)}
                  />
                </div>
              </div>
            )}

            {selectedActionDef?.cible === "ajustement_stock" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Produit</Label>
                  <Select value={newProduit} onValueChange={(v) => setNewProduit(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sachet_plein">Sachet plein</SelectItem>
                      <SelectItem value="rouleau_plastique">Rouleau plastique</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Sens</Label>
                  <Select value={newSens} onValueChange={(v) => setNewSens(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entree">Entrée (+)</SelectItem>
                      <SelectItem value="sortie">Sortie (-)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Quantité</Label>
                  <Input
                    type="number"
                    placeholder="Ex: 50"
                    value={newQuantite}
                    onChange={(e) => setNewQuantite(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Motif / détails (obligatoire)</Label>
              <Textarea
                placeholder="Expliquez ce que vous demandez et pourquoi"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
              />
            </div>

            {newActionKey && !selectedActionDef?.cible && (
              <p className="text-xs text-gray-500">
                Cette demande ne déclenche pas d'action automatique : si l'admin l'approuve, il devra encore appliquer le changement lui-même ailleurs dans l'app.
              </p>
            )}

            {selectedActionDef?.executable &&
              selectedActionDef.cible !== "ajustement_stock" &&
              selectedActionDef.cible !== "recouvrement_modif" && (
              <div className="space-y-1.5">
                <Label>Montant concerné (optionnel)</Label>
                <Input
                  type="number"
                  placeholder="Ex: 25000"
                  value={newMontant}
                  onChange={(e) => setNewMontant(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewRequestDialog(false)}>Annuler</Button>
            <Button onClick={handleCreateRequest}>Envoyer la demande</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de rejet */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter la demande</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Vous êtes sur le point de rejeter : <strong>{selectedRequest && getActionLabel(selectedRequest.action)}</strong>
            </p>
            <Textarea
              placeholder="Motif du rejet (obligatoire)"
              value={motifRejet}
              onChange={(e) => setMotifRejet(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Annuler</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={handleReject}>Confirmer le rejet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
