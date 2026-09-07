import { useState, useEffect, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt } from "@/lib/helpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import type { Notification } from "@/lib/types";

interface RappelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Contexte optionnel pré-rempli (ex: relance de créance depuis
  // CreancesSection.tsx) — le dialog reste utilisable sans, pour un rappel
  // libre vers un caissier/commercial.
  clientNom?: string;
  montant?: number;
}

// Rappel interne (+ option WhatsApp) vers un ou plusieurs caissiers/
// commerciaux — ex: "ce client doit beaucoup d'argent, peux-tu le relancer".
// Réservé aux admins côté UI (bouton qui ouvre ce dialog) ET côté serveur
// (firestore.rules match /notifications/{docId}, allow create: if isAdmin()).
// Voir types.ts Notification pour le détail du modèle de données.
export default function RappelDialog({ open, onOpenChange, clientNom, montant }: RappelDialogProps) {
  const { DB, setDB, saveDB, currentUser, logActivity } = useApp();
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  const destinatairesPossibles = useMemo(() => {
    return (DB.users || [])
      .filter((u) => u.actif !== false && !!u.email)
      .filter((u) => (u.roles || [u.role]).some((r) => r === "caissier" || r === "commercial"))
      .sort((a, b) => a.nom.localeCompare(b.nom));
  }, [DB.users]);

  useEffect(() => {
    if (open) {
      setSelectedEmails(new Set());
      setMessage(
        clientNom
          ? `Rappel : le client ${clientNom} doit ${montant ? fmt(montant) : "un montant en attente"}. Merci de faire le suivi.`
          : ""
      );
    }
  }, [open, clientNom, montant]);

  const toggleDestinataire = (email: string) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleEnvoyer = () => {
    if (selectedEmails.size === 0) { toast.error("Sélectionnez au moins un destinataire"); return; }
    if (!message.trim()) { toast.error("Le message est vide"); return; }
    const nowISO = new Date().toISOString();
    const nouvelles: Notification[] = destinatairesPossibles
      .filter((u) => selectedEmails.has(u.email!))
      .map((u) => ({
        id: uid(),
        destinataireEmail: u.email!,
        destinataireNom: u.nom,
        destinataireRole: (u.roles && u.roles[0]) || u.role || "",
        expediteurNom: currentUser?.nom || "Admin",
        expediteurEmail: currentUser?.email || "",
        message: message.trim(),
        clientNom,
        montant,
        date: nowISO,
        lu: false,
      }));

    const updated = { ...DB, notifications: [...DB.notifications, ...nouvelles] };
    setDB(updated);
    saveDB(updated);
    logActivity(
      "create",
      "Notifications",
      `Rappel envoyé à ${nouvelles.map((n) => n.destinataireNom).join(", ")}${clientNom ? ` — client ${clientNom}` : ""}`
    );
    toast.success(`Rappel envoyé à ${nouvelles.length} destinataire${nouvelles.length > 1 ? "s" : ""}`);
    onOpenChange(false);
  };

  // Contrairement à shareWaveLinkWhatsapp (RecouvrementSection.tsx) et
  // handleShareWhatsapp (ClientsSection.tsx), aucun numéro n'est visé
  // directement dans le lien : les numéros stockés (AppUser.tel) ne sont pas
  // garantis au format international requis par wa.me (ex: "221771234567"),
  // donc on ouvre le sélecteur de contact natif de WhatsApp — même choix que
  // ces deux fonctions existantes.
  const handleWhatsapp = () => {
    if (!message.trim()) { toast.error("Le message est vide"); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(message.trim())}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-[#1B4B6B]" />
            Envoyer un rappel
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Destinataire(s)</Label>
            {destinatairesPossibles.length === 0 ? (
              <p className="text-sm text-gray-400 mt-1">Aucun caissier/commercial actif trouvé (voir rubrique Utilisateurs).</p>
            ) : (
              <div className="mt-1.5 space-y-1.5 max-h-40 overflow-y-auto border rounded-md p-2">
                {destinatairesPossibles.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={selectedEmails.has(u.email!)} onCheckedChange={() => toggleDestinataire(u.email!)} />
                    <span>{u.nom}</span>
                    <span className="text-xs text-gray-400 capitalize">({(u.roles || [u.role]).join(", ")})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Message</Label>
            <Textarea className="mt-1.5" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Votre message..." />
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button onClick={handleEnvoyer} className="flex-1 bg-[#1B4B6B] hover:bg-[#153a53]">
              <Send className="w-4 h-4 mr-2" /> Envoyer (notification dans l'app)
            </Button>
            <Button variant="outline" onClick={handleWhatsapp} className="text-green-700 border-green-300 hover:bg-green-50">
              <MessageCircle className="w-4 h-4 mr-2" /> WhatsApp
            </Button>
          </div>
          <p className="text-xs text-gray-400">
            La notification dans l'app arrive directement dans la cloche des destinataires cochés ci-dessus. Le bouton WhatsApp ouvre votre application pour choisir vous-même le contact.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
