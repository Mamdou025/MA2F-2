import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, resteVente, todayLocal } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Banknote, AlertTriangle, Search, ListFilter, BellRing } from "lucide-react";
import { toast } from "sonner";
import RappelDialog from "@/components/RappelDialog";

export default function CreancesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const isAdmin = (currentUser?.roles || [currentUser?.role]).includes("admin");
  const [open, setOpen] = useState(false);
  // Dialog de rappel (voir RappelDialog.tsx) — relance un caissier/commercial
  // sur la créance d'un client précis, admin uniquement (bouton "Rappeler"
  // dans la vue "Vue agrégée par client" ci-dessous).
  const [rappelOpen, setRappelOpen] = useState(false);
  const [rappelClient, setRappelClient] = useState<{ nom: string; montant: number } | null>(null);

  const handleOuvrirRappel = (nom: string, montant: number) => {
    setRappelClient({ nom, montant });
    setRappelOpen(true);
  };
  const [selectedVenteId, setSelectedVenteId] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("Espèces");
  const [notes, setNotes] = useState("");
  const [searchClient, setSearchClient] = useState("");
  // "Plus de deux factures" = au moins 3 factures impayées pour le client.
  const [multiFacturesOnly, setMultiFacturesOnly] = useState(false);

  // Toutes les ventes avec un reste dû > 0
  const creances = useMemo(() => {
    return DB.ventes.filter((v) => resteVente(v, DB) > 0).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [DB]);

  const total = creances.reduce((s, v) => s + resteVente(v, DB), 0);
  const nbFactures = creances.length;
  const risque30 = creances
    .filter((v) => Math.floor((Date.now() - new Date(v.date).getTime()) / 86400000) > 30)
    .reduce((s, v) => s + resteVente(v, DB), 0);

  // Vue agrégée par client
  const parClient = useMemo(() => {
    const map: Record<string, { client: string; nbFactures: number; totalDu: number; plusVieux: string; jours: number }> = {};
    creances.forEach((v) => {
      const reste = resteVente(v, DB);
      const jours = Math.floor((Date.now() - new Date(v.date).getTime()) / 86400000);
      if (!map[v.client]) {
        map[v.client] = { client: v.client, nbFactures: 0, totalDu: 0, plusVieux: v.date, jours };
      }
      map[v.client].nbFactures++;
      map[v.client].totalDu += reste;
      if (new Date(v.date) < new Date(map[v.client].plusVieux)) {
        map[v.client].plusVieux = v.date;
        map[v.client].jours = jours;
      }
    });
    return Object.values(map).sort((a, b) => b.totalDu - a.totalDu);
  }, [creances, DB]);

  // Recherche par nom + filtre "clients avec 2 factures impayées ou plus".
  const parClientFiltered = useMemo(() => {
    const q = searchClient.trim().toLowerCase();
    return parClient.filter((c) =>
      (!q || c.client.toLowerCase().includes(q)) &&
      (!multiFacturesOnly || c.nbFactures >= 2)
    );
  }, [parClient, searchClient, multiFacturesOnly]);

  const nbClientsMultiFactures = useMemo(() => parClient.filter((c) => c.nbFactures >= 2).length, [parClient]);

  // Ouvrir le dialog d'encaissement pour une vente spécifique
  const handleEncaisser = (venteId: string) => {
    const vente = DB.ventes.find((v) => v.id === venteId);
    if (!vente) return;
    const reste = resteVente(vente, DB);
    setSelectedVenteId(venteId);
    setDate(todayLocal());
    setMontant(String(reste));
    setMode("Espèces");
    setNotes("");
    setOpen(true);
  };

  // Sauvegarder l'encaissement (recouvrement)
  const handleSave = () => {
    if (!selectedVenteId) { toast.error("Aucune vente sélectionnée"); return; }
    if (!montant || Number(montant) <= 0) { toast.error("Montant requis"); return; }
    
    const vente = DB.ventes.find((v) => v.id === selectedVenteId);
    if (!vente) return;
    
    const reste = resteVente(vente, DB);
    const montantNum = Number(montant);
    
    if (montantNum > reste) {
      toast.error(`Le montant ne peut pas dépasser le reste dû (${fmt(reste)})`);
      return;
    }

    const item = {
      id: uid(),
      venteId: selectedVenteId,
      numeroBL: vente.numero,
      client: vente.client,
      date,
      montant: montantNum,
      mode,
      notes,
    };

    const updated = { ...DB, recouvrements: [...DB.recouvrements, item] };
    setDB(updated);
    saveDB(updated);

    // Vérifier si la créance est soldée
    const nouveauReste = reste - montantNum;
    if (nouveauReste <= 0) {
      logActivity("create", "Recouvrement", `SOLDÉ: ${vente.numero} - ${vente.client} - ${fmt(montantNum)}`);
      toast.success(`Créance soldée ! ${vente.numero} - ${vente.client}`);
    } else {
      logActivity("create", "Recouvrement", `Acompte: ${vente.numero} - ${vente.client} - ${fmt(montantNum)} (reste: ${fmt(nouveauReste)})`);
      toast.success(`Encaissement enregistré. Reste dû: ${fmt(nouveauReste)}`);
    }

    setOpen(false);
  };

  const getStatut = (jours: number) => {
    if (jours > 30) return <Badge className="bg-red-100 text-red-800 hover:bg-red-100"><AlertTriangle className="w-3 h-3 mr-1" />Risque</Badge>;
    if (jours > 7) return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Attention</Badge>;
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">OK</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* En-tête KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total créances</p>
            <p className="text-2xl font-bold text-red-600">{fmt(total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Nb factures</p>
            <p className="text-2xl font-bold text-gray-900">{nbFactures}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Risque &gt; 30 jours</p>
            <p className="text-2xl font-bold text-red-600">{fmt(risque30)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Clients avec 2+ factures</p>
            <p className="text-2xl font-bold text-orange-600">{nbClientsMultiFactures}</p>
          </CardContent>
        </Card>
      </div>

      {/* Vue agrégée par client */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>👥</span> Vue agrégée par client
        </h3>

        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Rechercher un client..." value={searchClient} onChange={(e) => setSearchClient(e.target.value)} className="pl-9" />
          </div>
          <Button
            variant={multiFacturesOnly ? "default" : "outline"}
            className={multiFacturesOnly ? "bg-orange-500 hover:bg-orange-600" : ""}
            onClick={() => setMultiFacturesOnly((v) => !v)}
          >
            <ListFilter className="w-4 h-4 mr-2" />
            2 factures impayées ou plus {multiFacturesOnly ? `(${parClientFiltered.length})` : ""}
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                    <TableHead className="text-white font-semibold">Client</TableHead>
                    <TableHead className="text-white font-semibold">Nb factures</TableHead>
                    <TableHead className="text-white font-semibold">Total dû</TableHead>
                    <TableHead className="text-white font-semibold">Plus vieux</TableHead>
                    <TableHead className="text-white font-semibold">Jours</TableHead>
                    <TableHead className="text-white font-semibold">Statut</TableHead>
                    {isAdmin && <TableHead className="text-white font-semibold">Rappel</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parClientFiltered.length > 0 ? parClientFiltered.map((c) => (
                    <TableRow key={c.client}>
                      <TableCell className="font-medium">{c.client}</TableCell>
                      <TableCell className={c.nbFactures >= 2 ? "font-bold text-orange-600" : ""}>{c.nbFactures}</TableCell>
                      <TableCell className="font-bold text-red-600">{fmt(c.totalDu)}</TableCell>
                      <TableCell>{fmtDate(c.plusVieux)}</TableCell>
                      <TableCell>{c.jours} j</TableCell>
                      <TableCell>{getStatut(c.jours)}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[#1B4B6B] border-[#1B4B6B]/30 hover:bg-[#1B4B6B]/5"
                            onClick={() => handleOuvrirRappel(c.client, c.totalDu)}
                            title="Rappeler un caissier/commercial pour cette créance"
                          >
                            <BellRing className="w-3.5 h-3.5 mr-1" /> Rappeler
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-gray-400 py-8">
                        {parClient.length === 0 ? "Aucune créance en cours" : "Aucun client ne correspond à la recherche/au filtre"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Détail par BL */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>📋</span> Détail par BL
        </h3>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                    <TableHead className="text-white font-semibold">N° BL</TableHead>
                    <TableHead className="text-white font-semibold">Date</TableHead>
                    <TableHead className="text-white font-semibold">Client</TableHead>
                    <TableHead className="text-white font-semibold">Commercial</TableHead>
                    <TableHead className="text-white font-semibold">Montant</TableHead>
                    <TableHead className="text-white font-semibold">Jours</TableHead>
                    <TableHead className="text-white font-semibold">Statut</TableHead>
                    <TableHead className="text-white font-semibold">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creances.length > 0 ? creances.map((v) => {
                    const reste = resteVente(v, DB);
                    const jours = Math.floor((Date.now() - new Date(v.date).getTime()) / 86400000);
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-sm">{v.numero}</TableCell>
                        <TableCell>{fmtDate(v.date)}</TableCell>
                        <TableCell className="font-medium">{v.client}</TableCell>
                        <TableCell>{v.commercial}</TableCell>
                        <TableCell className="font-bold text-red-600">{fmt(reste)}</TableCell>
                        <TableCell>{jours} j</TableCell>
                        <TableCell>{getStatut(jours)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            onClick={() => handleEncaisser(v.id)}
                          >
                            <Banknote className="w-4 h-4 mr-1" />
                            Encaisser
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-gray-400 py-8">Aucune créance en cours</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialog Encaisser */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-emerald-600" />
              Encaisser une créance
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            {selectedVenteId && (() => {
              const vente = DB.ventes.find((v) => v.id === selectedVenteId);
              if (!vente) return null;
              const reste = resteVente(vente, DB);
              return (
                <div className="bg-gray-50 p-3 rounded-lg border space-y-1">
                  <p className="text-sm"><span className="font-medium">BL:</span> {vente.numero}</p>
                  <p className="text-sm"><span className="font-medium">Client:</span> {vente.client}</p>
                  <p className="text-sm"><span className="font-medium">Reste dû:</span> <span className="text-red-600 font-bold">{fmt(reste)}</span></p>
                  {Number(montant) >= reste && Number(montant) > 0 && (
                    <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
                      ✓ Cette créance sera marquée comme SOLDÉE
                    </p>
                  )}
                </div>
              );
            })()}
            <div>
              <Label>Date d'encaissement</Label>
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
              <Button onClick={handleSave} className="flex-1 bg-emerald-500 hover:bg-emerald-600">
                <Banknote className="w-4 h-4 mr-2" />
                Confirmer l'encaissement
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Rappeler (admin uniquement) */}
      <RappelDialog
        open={rappelOpen}
        onOpenChange={setRappelOpen}
        clientNom={rappelClient?.nom}
        montant={rappelClient?.montant}
      />
    </div>
  );
}
