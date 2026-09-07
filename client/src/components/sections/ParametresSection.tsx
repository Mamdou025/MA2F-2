import { useState, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { MigrationPanel } from "@/components/MigrationPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Settings, DollarSign, Package, Wallet, Gift, ShieldCheck, ShieldOff, UserCheck, AlertTriangle, Lock, Unlock, ClipboardCheck } from "lucide-react";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import { is2FARequired, ROLES_2FA_REQUIRED } from "@/lib/twoFactor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CATEGORIES_DEPENSES as DEPENSE_CATEGORIES } from "@/lib/helpers";

export default function ParametresSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [taux, setTaux] = useState(String(DB.params.taux || 25));
  const [tauxSachetsParKg, setTauxSachetsParKg] = useState(String(DB.params.tauxSachetsParKg || 17));
  const [objectifProductionMensuel, setObjectifProductionMensuel] = useState(DB.params.objectifProductionMensuel ? String(DB.params.objectifProductionMensuel) : "");
  const [solde, setSolde] = useState(String(DB.params.soldeOuverture || 297023));
  const [prixKg, setPrixKg] = useState(String(DB.params.prixRouleau || 3650));
  const [prixPack, setPrixPack] = useState(String(DB.params.prixPack || 600));
  const [prixCarton, setPrixCarton] = useState(String(DB.params.prixCarton || 3000));
  const [packsParCarton, setPacksParCarton] = useState(String(DB.params.packsParCarton || 1000));
  const [bonusSeuil, setBonusSeuil] = useState(String(DB.params.bonusSeuil || 10));
  // Budget par catégorie de dépense + seuil d'approbation des dépenses
  // (Etude-Depenses-AquaSachet.docx §4.2) — un champ texte par catégorie
  // (vide = pas de budget suivi pour cette catégorie), comme les autres
  // paramètres numériques optionnels de cette page.
  const budgetsInitiaux = (): Record<string, string> => {
    const b = DB.params.budgetsDepenses || {};
    const init: Record<string, string> = {};
    DEPENSE_CATEGORIES.forEach((c) => { init[c] = b[c] ? String(b[c]) : ""; });
    return init;
  };
  const [budgetsDepenses, setBudgetsDepenses] = useState<Record<string, string>>(budgetsInitiaux);
  const [seuilApprobationDepense, setSeuilApprobationDepense] = useState(DB.params.seuilApprobationDepense ? String(DB.params.seuilApprobationDepense) : "");
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [setup2FAForUser, setSetup2FAForUser] = useState("");

  // Le solde d'ouverture est verrouillé par défaut à chaque ouverture de la
  // page : c'est une constante posée une seule fois, presque jamais censée
  // être retouchée. Le verrou force un geste explicite avant de pouvoir la
  // modifier, pour éviter qu'elle ne soit changée par erreur en même temps
  // qu'un autre réglage (c'est exactement ce qui l'a mise à 0 par le passé).
  const [soldeLocked, setSoldeLocked] = useState(true);

  // Confirmation avant d'appliquer un changement de prix global (rouleau,
  // pack, carton) — ces valeurs impactent tous les calculs futurs dès
  // l'enregistrement (coût de revient, ventes, réceptions...).
  const [pendingPriceChange, setPendingPriceChange] = useState<{ label: string; from: string; to: string }[] | null>(null);

  // Resynchronise les champs locaux avec les données Firestore à chaque
  // changement de DB.params (arrivée tardive du snapshot, modification par
  // un autre poste, etc.). Sans cela, un champ initialisé avant la fin du
  // chargement pouvait rester bloqué sur sa valeur de montage (ex: "0") et
  // écraser silencieusement la vraie valeur au prochain "Enregistrer" —
  // c'est ce qui a mis le solde d'ouverture à 0 le 2026-08-0x.
  useEffect(() => {
    setTaux(String(DB.params.taux || 25));
    setTauxSachetsParKg(String(DB.params.tauxSachetsParKg || 17));
    setObjectifProductionMensuel(DB.params.objectifProductionMensuel ? String(DB.params.objectifProductionMensuel) : "");
    setSolde(String(DB.params.soldeOuverture ?? 297023));
    setPrixKg(String(DB.params.prixRouleau || 3650));
    setPrixPack(String(DB.params.prixPack || 600));
    setPrixCarton(String(DB.params.prixCarton || 3000));
    setPacksParCarton(String(DB.params.packsParCarton || 1000));
    setBonusSeuil(String(DB.params.bonusSeuil || 10));
    setBudgetsDepenses(budgetsInitiaux());
    setSeuilApprobationDepense(DB.params.seuilApprobationDepense ? String(DB.params.seuilApprobationDepense) : "");
    setSoldeLocked(true);
  }, [DB.params]);

  const handleSave = () => {
    // Validation : empêcher les valeurs invalides
    const numTaux = Number(taux);
    const numTauxSachetsParKg = Number(tauxSachetsParKg);
    const numSolde = Number(solde);
    const numPrixKg = Number(prixKg);
    const numPrixPack = Number(prixPack);
    const numPrixCarton = Number(prixCarton);
    const numPacksParCarton = Number(packsParCarton);
    const numBonusSeuil = Number(bonusSeuil);

    if (isNaN(numTaux) || numTaux < 0) { toast.error("Taux commission invalide"); return; }
    if (isNaN(numTauxSachetsParKg) || numTauxSachetsParKg <= 0) { toast.error("Rendement (packs/kg) invalide"); return; }
    if (isNaN(numSolde)) { toast.error("Solde d'ouverture invalide"); return; }
    if (isNaN(numPrixKg) || numPrixKg <= 0) { toast.error("Prix du kg plastique invalide"); return; }
    if (isNaN(numPrixPack) || numPrixPack <= 0) { toast.error("Prix par pack invalide"); return; }
    if (isNaN(numPrixCarton) || numPrixCarton <= 0) { toast.error("Prix du carton invalide"); return; }
    if (isNaN(numPacksParCarton) || numPacksParCarton <= 0) { toast.error("Packs par carton invalide"); return; }
    if (isNaN(numBonusSeuil) || numBonusSeuil <= 0) { toast.error("Seuil bonus invalide"); return; }
    const numObjectifProduction = objectifProductionMensuel.trim() ? Number(objectifProductionMensuel) : 0;
    if (objectifProductionMensuel.trim() && (isNaN(numObjectifProduction) || numObjectifProduction < 0)) { toast.error("Objectif de production invalide"); return; }

    // Budget par catégorie de dépense (vide = pas de budget suivi pour cette catégorie)
    for (const cat of DEPENSE_CATEGORIES) {
      const v = budgetsDepenses[cat];
      if (v && v.trim() && (isNaN(Number(v)) || Number(v) < 0)) { toast.error(`Budget "${cat}" invalide`); return; }
    }
    if (seuilApprobationDepense.trim() && (isNaN(Number(seuilApprobationDepense)) || Number(seuilApprobationDepense) < 0)) { toast.error("Seuil d'approbation des dépenses invalide"); return; }

    // Si un des prix globaux, le taux de commission ou le solde d'ouverture
    // change, demander confirmation avant d'appliquer — ce sont des champs
    // qui impactent rétroactivement toute la caisse et l'historique de
    // commissions dès l'enregistrement.
    const changes: { label: string; from: string; to: string }[] = [];
    if (numTaux !== (DB.params.taux || 25)) changes.push({ label: "Taux commission (F/pack)", from: String(DB.params.taux || 25), to: String(numTaux) });
    if (numSolde !== (DB.params.soldeOuverture ?? 297023)) changes.push({ label: "Solde d'ouverture", from: String(DB.params.soldeOuverture ?? 297023), to: String(numSolde) });
    if (numPrixKg !== (DB.params.prixRouleau || 3650)) changes.push({ label: "Prix du kg plastique", from: String(DB.params.prixRouleau || 3650), to: String(numPrixKg) });
    if (numPrixPack !== (DB.params.prixPack || 600)) changes.push({ label: "Prix par pack", from: String(DB.params.prixPack || 600), to: String(numPrixPack) });
    if (numPrixCarton !== (DB.params.prixCarton || 3000)) changes.push({ label: "Prix du carton", from: String(DB.params.prixCarton || 3000), to: String(numPrixCarton) });

    if (changes.length > 0) {
      setPendingPriceChange(changes);
      return;
    }
    executeSave();
  };

  const executeSave = () => {
    setPendingPriceChange(null);
    const numTaux = Number(taux);
    const numTauxSachetsParKg = Number(tauxSachetsParKg);
    const numSolde = Number(solde);
    const numPrixKg = Number(prixKg);
    const numPrixPack = Number(prixPack);
    const numPrixCarton = Number(prixCarton);
    const numPacksParCarton = Number(packsParCarton);
    const numBonusSeuil = Number(bonusSeuil);
    const numObjectifProduction = objectifProductionMensuel.trim() ? Number(objectifProductionMensuel) : 0;

    const numBudgetsDepenses: Record<string, number> = {};
    for (const cat of DEPENSE_CATEGORIES) {
      const v = budgetsDepenses[cat];
      if (v && v.trim()) numBudgetsDepenses[cat] = Number(v);
    }
    const numSeuilApprobationDepense = seuilApprobationDepense.trim() ? Number(seuilApprobationDepense) : undefined;

    // Détail des champs modifiés, pour traçabilité dans le journal
    // (avant/après) — indispensable pour un champ comme soldeOuverture
    // dont une modification silencieuse peut fausser toute la caisse.
    const fieldDiffs: string[] = [];
    const compare = (label: string, before: number | undefined, after: number) => {
      const b = before ?? 0;
      if (b !== after) fieldDiffs.push(`${label} : ${b} → ${after}`);
    };
    compare("Taux commission", DB.params.taux, numTaux);
    compare("Rendement packs/kg", DB.params.tauxSachetsParKg, numTauxSachetsParKg);
    compare("Solde ouverture", DB.params.soldeOuverture, numSolde);
    compare("Prix rouleau", DB.params.prixRouleau, numPrixKg);
    compare("Prix pack", DB.params.prixPack, numPrixPack);
    compare("Prix carton", DB.params.prixCarton, numPrixCarton);
    compare("Packs/carton", DB.params.packsParCarton, numPacksParCarton);
    compare("Seuil bonus", DB.params.bonusSeuil, numBonusSeuil);
    compare("Objectif production", DB.params.objectifProductionMensuel, numObjectifProduction);
    if (JSON.stringify(DB.params.budgetsDepenses || {}) !== JSON.stringify(numBudgetsDepenses)) {
      fieldDiffs.push("Budgets par catégorie de dépenses modifiés");
    }
    compare("Seuil approbation dépense", DB.params.seuilApprobationDepense, numSeuilApprobationDepense || 0);

    const updated = {
      ...DB,
      params: {
        ...DB.params,
        taux: numTaux,
        tauxSachetsParKg: numTauxSachetsParKg,
        soldeOuverture: numSolde,
        prixRouleau: numPrixKg,
        prixPack: numPrixPack,
        prixCarton: numPrixCarton,
        packsParCarton: numPacksParCarton,
        bonusSeuil: numBonusSeuil,
        objectifProductionMensuel: numObjectifProduction || undefined,
        budgetsDepenses: Object.keys(numBudgetsDepenses).length > 0 ? numBudgetsDepenses : undefined,
        seuilApprobationDepense: numSeuilApprobationDepense,
      },
    };
    setDB(updated);
    saveDB(updated);
    logActivity(
      "update",
      "Paramètres",
      fieldDiffs.length > 0 ? `Paramètres modifiés — ${fieldDiffs.join(" · ")}` : "Enregistrement des paramètres (aucun changement de valeur)"
    );
    setSoldeLocked(true); // reverrouille systématiquement après enregistrement
    toast.success("Paramètres enregistrés avec succès");
  };

  const handleActivate2FA = (email: string) => {
    setSetup2FAForUser(email);
    setShow2FASetup(true);
  };

  const handleComplete2FA = (secret: string) => {
    const updatedUsers = DB.users.map((u) => {
      if ((u.email || "").toLowerCase() === setup2FAForUser.toLowerCase()) {
        return { ...u, totpSecret: secret };
      }
      return u;
    });
    const updated = { ...DB, users: updatedUsers };
    setDB(updated);
    saveDB(updated);
    logActivity("update", "Sécurité 2FA", `2FA activée pour ${setup2FAForUser}`);
    toast.success(`Double authentification activée pour ${setup2FAForUser}`);
  };

  const handleDisable2FA = (email: string) => {
    const updatedUsers = DB.users.map((u) => {
      if ((u.email || "").toLowerCase() === email.toLowerCase()) {
        const { totpSecret, ...rest } = u as any;
        return rest;
      }
      return u;
    });
    const updated = { ...DB, users: updatedUsers };
    setDB(updated);
    saveDB(updated);
    logActivity("update", "Sécurité 2FA", `2FA désactivée pour ${email}`);
    toast.success(`Double authentification désactivée pour ${email}`);
  };

  // Utilisateurs concernés par la 2FA (admin et caissier)
  const usersFor2FA = DB.users.filter((u) => {
    const role = u.role || (u.roles && u.roles[0]) || "lecteur";
    return is2FARequired(role) && u.actif !== false;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Paramètres</h2>
        <p className="text-sm text-gray-500 mt-1">Configuration générale de l'application</p>
      </div>

      {/* Commission */}
      <Card className="border-l-4 border-l-[#1B4B6B]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#1B4B6B]" />
            Commission commerciaux
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <Label className="font-medium">Taux commission (F/pack)</Label>
              <Input
                type="number"
                value={taux}
                onChange={(e) => setTaux(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Commission versée au commercial par pack vendu en mode "Payé".
                Pas de commission si aucun commercial n'est mentionné sur la vente.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Prix matière première */}
      <Card className="border-l-4 border-l-orange-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-500" />
            Matière première (Plastique)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <Label className="font-medium">Prix du kg plastique</Label>
              <Input
                type="number"
                value={prixKg}
                onChange={(e) => setPrixKg(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Prix d'achat d'un kilogramme de rouleau plastique. Utilisé pour le calcul du coût de revient.
              </p>
            </div>
            <div>
              <Label className="font-medium">Rendement (packs par kg)</Label>
              <Input
                type="number"
                value={tauxSachetsParKg}
                onChange={(e) => setTauxSachetsParKg(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Nombre de sachets/packs produits à partir d'un kilogramme de rouleau plastique. Utilisé pour calculer le stock de matière première et la consommation en production.
              </p>
            </div>
            <div>
              <Label className="font-medium">Objectif de production mensuel (packs)</Label>
              <Input
                type="number"
                value={objectifProductionMensuel}
                onChange={(e) => setObjectifProductionMensuel(e.target.value)}
                className="mt-1"
                placeholder="Ex: 30000 (laisser vide = pas d'objectif)"
              />
              <p className="text-xs text-gray-400 mt-1">
                Objectif global de packs à produire chaque mois (usine + producteurs manuels). Affiché dans la rubrique Production. Laisser vide pour désactiver.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Prix de vente par pack */}
      <Card className="border-l-4 border-l-cyan-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-cyan-500" />
            Prix de vente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <Label className="font-medium">Prix par pack</Label>
              <Input
                type="number"
                value={prixPack}
                onChange={(e) => setPrixPack(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Prix de vente par défaut d'un pack de sachets d'eau. Utilisé comme valeur par défaut lors de l'enregistrement des ventes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Carton emballage */}
      <Card className="border-l-4 border-l-amber-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-500" />
            Carton emballage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <Label className="font-medium">Prix du carton (FCFA)</Label>
              <Input
                type="number"
                value={prixCarton}
                onChange={(e) => setPrixCarton(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Prix d'achat d'un carton d'emballage.
              </p>
            </div>
            <div>
              <Label className="font-medium">Packs par carton</Label>
              <Input
                type="number"
                value={packsParCarton}
                onChange={(e) => setPacksParCarton(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Nombre de packs contenus dans un carton. Utilisé pour le calcul du coût de revient.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Caisse */}
      <Card className="border-l-4 border-l-green-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-5 h-5 text-green-500" />
            Caisse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between">
                <Label className="font-medium">Solde d'ouverture</Label>
                {soldeLocked ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs text-gray-500 border-gray-300"
                    onClick={() => setSoldeLocked(false)}
                  >
                    <Lock className="w-3 h-3 mr-1" />
                    Verrouillé — déverrouiller
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
                    onClick={() => {
                      setSoldeLocked(true);
                      setSolde(String(DB.params.soldeOuverture ?? 297023));
                    }}
                  >
                    <Unlock className="w-3 h-3 mr-1" />
                    Déverrouillé — reverrouiller
                  </Button>
                )}
              </div>
              <Input
                type="number"
                value={solde}
                onChange={(e) => setSolde(e.target.value)}
                disabled={soldeLocked}
                className={`mt-1 ${soldeLocked ? "bg-gray-50 text-gray-500 cursor-not-allowed" : ""}`}
              />
              <p className="text-xs text-gray-400 mt-1">
                Constante historique posée une seule fois, au tout début du suivi de la caisse dans l'appli —
                pas une valeur mensuelle. Elle s'additionne à <strong>tout</strong> l'historique (voir "Solde de
                caisse actuel" dans Caisse), jamais à un mois ou une semaine en particulier. La modifier revient
                à corriger le point de départ de toute la comptabilité de caisse, pas le solde du mois en cours —
                verrouillée par défaut pour éviter tout changement accidentel.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bonus */}
      <Card className="border-l-4 border-l-purple-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="w-5 h-5 text-purple-500" />
            Bonus clients
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <Label className="font-medium">Seuil bonus (packs)</Label>
              <Input
                type="number"
                value={bonusSeuil}
                onChange={(e) => setBonusSeuil(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                1 pack offert tous les X packs achetés. Ex: seuil 10 = 1 bonus pour 10 packs.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pilotage budgétaire des dépenses (Etude-Depenses-AquaSachet.docx §4.2) */}
      <Card className="border-l-4 border-l-red-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-red-500" />
            Pilotage budgétaire des dépenses
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="font-medium">Budget mensuel par catégorie (F CFA)</Label>
            <p className="text-xs text-gray-400 mt-1 mb-3">
              Laissez vide les catégories sans budget suivi. Une alerte visuelle apparaît dans Dépenses dès que
              le total du mois en cours d'une catégorie dépasse son budget.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {DEPENSE_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <Label className="text-sm text-gray-600">{cat}</Label>
                  <Input
                    type="number"
                    value={budgetsDepenses[cat] || ""}
                    onChange={(e) => setBudgetsDepenses((prev) => ({ ...prev, [cat]: e.target.value }))}
                    placeholder="Aucun budget"
                    className="mt-1"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="pt-4 border-t">
            <Label className="font-medium">Seuil d'approbation des dépenses (F CFA)</Label>
            <Input
              type="number"
              value={seuilApprobationDepense}
              onChange={(e) => setSeuilApprobationDepense(e.target.value)}
              placeholder="Ex: 300000 (laisser vide = désactivé)"
              className="mt-1"
            />
            <p className="text-xs text-gray-400 mt-1">
              Au-delà de ce montant, une nouvelle dépense saisie par un caissier ou un commercial part en demande
              d'approbation (rubrique Approbations) au lieu d'être enregistrée immédiatement — même circuit de
              double contrôle que pour les ventes à crédit et versements. Ne s'applique pas aux dépenses créées
              par un admin. Laisser vide pour désactiver.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Double Authentification (2FA) */}
      <Card className="border-l-4 border-l-amber-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            Double authentification (2FA)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-amber-50 p-3 rounded-lg">
            <p className="text-sm text-amber-800">
              La 2FA est <strong>obligatoire</strong> pour les rôles : {ROLES_2FA_REQUIRED.join(", ")}.
              Une fois activée, un code à 6 chiffres sera demandé à chaque connexion.
            </p>
          </div>

          {usersFor2FA.length === 0 ? (
            <p className="text-sm text-gray-500">
              Aucun utilisateur avec un rôle nécessitant la 2FA.
            </p>
          ) : (
            <div className="space-y-3">
              {usersFor2FA.map((user) => {
                const has2FA = !!(user as any).totpSecret;
                return (
                  <div
                    key={user.id || user.email}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <UserCheck className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="font-medium text-sm">{user.nom || user.email}</p>
                        <p className="text-xs text-gray-500">
                          {user.email} — {user.role || "admin"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {has2FA ? (
                        <>
                          <Badge className="bg-green-100 text-green-700 border-green-200">
                            2FA Active
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => handleDisable2FA(user.email || "")}
                          >
                            <ShieldOff className="w-4 h-4 mr-1" />
                            Désactiver
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge variant="outline" className="text-gray-500">
                            2FA Inactive
                          </Badge>
                          <Button
                            size="sm"
                            className="bg-amber-500 hover:bg-amber-600"
                            onClick={() => handleActivate2FA(user.email || "")}
                          >
                            <ShieldCheck className="w-4 h-4 mr-1" />
                            Activer
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Activer pour soi-même */}
          {currentUser && is2FARequired(currentUser.role) && (
            <div className="pt-3 border-t">
              <Button
                variant="outline"
                onClick={() => handleActivate2FA(currentUser.email)}
                className="w-full"
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                Configurer ma propre 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bouton enregistrer */}
      <div className="flex justify-end">
        <Button onClick={handleSave} className="bg-[#1B4B6B] hover:bg-[#0d4a85] px-8">
          <Settings className="w-4 h-4 mr-2" />
          Enregistrer les paramètres
        </Button>
      </div>

      {/* Purge des données */}
      {currentUser?.role === "admin" && (
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Zone dangereuse — Purge des données
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-red-50 p-3 rounded-lg">
              <p className="text-sm text-red-800">
                <strong>Attention :</strong> Cette action supprime définitivement toutes les données
                (ventes, dépenses, production, recouvrements, livraisons, journal, etc.)
                sauf la <strong>liste des clients</strong>, les <strong>utilisateurs</strong> et les <strong>paramètres</strong>.
                Cette action est irréversible.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50"
              onClick={() => {
                const confirmation = window.prompt(
                  'Tapez "PURGER" pour confirmer la suppression de toutes les données (sauf clients, utilisateurs et paramètres) :'
                );
                if (confirmation !== "PURGER") {
                  toast.error("Purge annulée — vous devez taper exactement PURGER");
                  return;
                }
                const updated = {
                  ...DB,
                  production: [],
                  ventes: [],
                  // clients conservés
                  commerciaux: DB.commerciaux,
                  livreurs: DB.livreurs,
                  producteurs: DB.producteurs,
                  depenses: [],
                  livraisons: [],
                  recouvrements: [],
                  avances: [],
                  maintenance: [],
                  versements: [],
                  apports: [],
                  corbeille: [],
                  vehicules: DB.vehicules,
                  vehiculeOps: [],
                  backups: [],
                  journal: [],
                  history: [],
                  mouvementsStock: [],
                  reconciliations: [],
                  approvals: [],
                  auditChain: [],
                  // users et params conservés
                };
                setDB(updated);
                saveDB(updated);
                logActivity("delete", "Paramètres", "Purge complète des données (clients conservés)");
                toast.success("Toutes les données ont été purgées. Clients, utilisateurs et paramètres conservés.");
              }}
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Purger toutes les données
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Migration Architecture Phase 2 */}
      {currentUser?.role === "admin" && (
        <MigrationPanel />
      )}

      {/* Dialog de configuration 2FA */}
      <TwoFactorSetup
        open={show2FASetup}
        onOpenChange={setShow2FASetup}
        userEmail={setup2FAForUser}
        onComplete={handleComplete2FA}
      />

      {/* Confirmation changement de prix globaux */}
      <ConfirmDialog
        open={!!pendingPriceChange}
        onOpenChange={(o) => !o && setPendingPriceChange(null)}
        title="Confirmer ce changement de paramètre ?"
        description={pendingPriceChange ? `${pendingPriceChange.map(c => `${c.label} : ${c.from} → ${c.to}`).join(" · ")}. Ce changement s'appliquera immédiatement (calculs futurs, et pour le solde d'ouverture/taux commission, potentiellement à l'historique de caisse ou de commissions).` : ""}
        confirmLabel="Confirmer"
        variant="warning"
        onConfirm={executeSave}
      />
    </div>
  );
}
