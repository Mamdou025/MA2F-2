import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid } from "@/lib/helpers";
import { ROLE_SECTIONS } from "@/lib/helpers";
import { sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { cfSetUserClaims, cfCreateUserWithRole } from "@/lib/cloudFunctions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Plus, UserX, UserCheck, Pencil, Shield, Trash2, Lock, Eye, Search, History } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { AppUser } from "@/lib/types";

// Labels lisibles pour chaque section
const SECTION_LABELS: Record<string, string> = {
  dashboard: "Tableau de bord",
  production: "Production",
  ventes: "Ventes",
  commandes: "Commandes",
  clients: "Clients",
  commerciaux: "Commerciaux",
  livreurs: "Livreurs",
  employes: "Employés",
  depenses: "Dépenses",
  caisse: "Caisse",
  creances: "Créances",
  recouvrement: "Recouvrement",
  livraisons: "Réception rouleaux",
  maintenance: "Maintenance",
  versements: "Versements",
  apports: "Apports de fonds",
  actionnaires: "Actionnaires",
  analytique: "Coût de revient",
  vehicules: "Véhicules",
  corbeille: "Corbeille",
  rapport: "Rapport journalier",
  journal: "Journal",
  securite: "Sécurité",
  backups: "Sauvegardes",
  utilisateurs: "Utilisateurs",
  parametres: "Paramètres",
  cloture: "Clôture journalière",
  historique: "Historique modifications",
  stock: "Stock",
  reconciliation: "Réconciliation",
  suiviLogistique: "Suivi logistique",
  approbations: "Approbations",
  comptabilite: "Comptabilité SYSCOHADA",
  monitoring: "Monitoring & Alertes",
  strategie: "Stratégie & conseils",
};

// Catégories de sections pour une meilleure organisation
const SECTION_CATEGORIES = [
  { label: "Gestion principale", sections: ["dashboard", "production", "ventes", "commandes", "clients", "depenses", "caisse"] },
  { label: "Équipe", sections: ["commerciaux", "livreurs", "employes", "utilisateurs"] },
  { label: "Finances", sections: ["creances", "recouvrement", "versements", "apports", "actionnaires", "analytique"] },
  { label: "Logistique", sections: ["livraisons", "stock", "reconciliation", "suiviLogistique", "maintenance", "vehicules"] },
  { label: "Rapports & Admin", sections: ["rapport", "journal", "corbeille", "securite", "backups", "parametres", "cloture", "historique", "approbations", "comptabilite", "monitoring", "strategie"] },
];

// Toutes les sections disponibles
const ALL_SECTIONS = Object.keys(SECTION_LABELS);

// Rôles disponibles avec icônes
const ROLES = [
  { value: "admin", label: "Administrateur", description: "Accès complet à toutes les fonctionnalités", icon: "🔴", color: "bg-red-500" },
  { value: "caissier", label: "Caissier", description: "Gestion des ventes, caisse, dépenses, production", icon: "🔵", color: "bg-blue-500" },
  { value: "commercial", label: "Commercial", description: "Ventes, clients et rapport uniquement", icon: "🟣", color: "bg-purple-500" },
  { value: "lecteur", label: "Lecteur", description: "Consultation sans modification", icon: "⚪", color: "bg-gray-400" },
];

// Permissions détaillées par action
const PERMISSION_ACTIONS = [
  { key: "read", label: "Consulter", icon: Eye, description: "Voir les données" },
  { key: "create", label: "Créer", icon: Plus, description: "Ajouter des entrées" },
  { key: "edit", label: "Modifier", icon: Pencil, description: "Modifier les données" },
  { key: "delete", label: "Supprimer", icon: Trash2, description: "Supprimer des entrées" },
];

export default function UtilisateursSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["lecteur"]);
  const [tel, setTel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminAuth, setShowAdminAuth] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Gestion des permissions personnalisées
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [customSections, setCustomSections] = useState<string[]>([]);
  const [customPermissions, setCustomPermissions] = useState<Record<string, string[]>>({});

  const isAdmin = currentUser?.role === "admin" || currentUser?.roles?.includes("admin");

  // Stats
  const stats = useMemo(() => ({
    total: DB.users.length,
    actifs: DB.users.filter((u) => u.actif).length,
    admins: DB.users.filter((u) => u.role === "admin" || u.roles?.includes("admin")).length,
    caissiers: DB.users.filter((u) => u.role === "caissier" || u.roles?.includes("caissier")).length,
    commerciaux: DB.users.filter((u) => u.role === "commercial" || u.roles?.includes("commercial")).length,
    lecteurs: DB.users.filter((u) => u.role === "lecteur" || (u.roles?.length === 1 && u.roles[0] === "lecteur")).length,
  }), [DB.users]);

  // Filtrage des utilisateurs
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return DB.users;
    const q = searchQuery.toLowerCase();
    return DB.users.filter((u) =>
      u.nom.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      ((u as any).tel || "").includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  }, [DB.users, searchQuery]);

  // Historique des modifications de permissions
  const permissionHistory = useMemo(() => {
    return DB.journal
      ?.filter((j: any) => j.module === "Utilisateur" && (j.action === "update" || j.action === "create" || j.action === "delete"))
      .slice(-20)
      .reverse() || [];
  }, [DB.journal]);

  // Authentification admin pour actions sensibles — ré-authentification Firebase sécurisée
  const requireAdminAuth = (action: () => void) => {
    setPendingAction(() => action);
    setShowAdminAuth(true);
  };

  const confirmAdminAuth = async () => {
    if (!adminPassword.trim()) {
      toast.error("Veuillez saisir votre mot de passe");
      return;
    }
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        toast.error("Session expirée. Reconnectez-vous.");
        return;
      }
      // Ré-authentification via Firebase Auth (sécurisé)
      const credential = EmailAuthProvider.credential(user.email, adminPassword);
      await reauthenticateWithCredential(user, credential);
      // Succès : exécuter l'action
      if (pendingAction) pendingAction();
      setShowAdminAuth(false);
      setAdminPassword("");
      setPendingAction(null);
      toast.success("Identité confirmée");
    } catch (e: any) {
      if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        toast.error("Mot de passe incorrect");
      } else {
        toast.error("Erreur de ré-authentification: " + (e.message || "Réessayez"));
      }
    }
  };

  const handleOpenNew = () => {
    setEditId(null);
    setNom("");
    setEmail("");
    setSelectedRoles(["lecteur"]);
    setTel("");
    setOpen(true);
  };

  const handleOpenEdit = (user: AppUser) => {
    setEditId(user.id);
    setNom(user.nom);
    setEmail(user.email || "");
    setSelectedRoles(user.roles && user.roles.length > 0 ? [...user.roles] : [user.role]);
    setTel((user as any).tel || "");
    setOpen(true);
  };

  const handleOpenPermissions = (user: AppUser) => {
    setPermUserId(user.id);
    const userSections = (user as any).allowedSections || ROLE_SECTIONS[user.role] || [];
    setCustomSections([...userSections]);
    // Charger les permissions détaillées
    const userPerms = (user as any).permissions || {};
    setCustomPermissions({ ...userPerms });
    setPermOpen(true);
  };

  // Confirmation avant un changement de rôle sensible (surtout retrait des
  // droits admin) : handleSave valide et prépare tout, mais n'exécute pas
  // tant que l'utilisateur n'a pas confirmé si la modification est risquée.
  const [pendingRoleChangeConfirm, setPendingRoleChangeConfirm] = useState(false);

  const handleSave = async () => {
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (!email.trim()) { toast.error("Email requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }
    if (selectedRoles.length === 0) { toast.error("Sélectionnez au moins un rôle"); return; }

    // Retrait des droits admin à un utilisateur qui les avait : demander confirmation
    if (editId) {
      const oldUser = DB.users.find((u) => u.id === editId);
      const hadAdmin = oldUser && (oldUser.role === "admin" || oldUser.roles?.includes("admin"));
      const willHaveAdmin = selectedRoles.includes("admin");
      if (hadAdmin && !willHaveAdmin) {
        setPendingRoleChangeConfirm(true);
        return;
      }
    }
    executeSave();
  };

  const executeSave = async () => {
    setPendingRoleChangeConfirm(false);
    // Calculer le rôle principal (le plus élevé)
    const primaryRole = selectedRoles.includes("admin") ? "admin"
      : selectedRoles.includes("caissier") ? "caissier"
      : selectedRoles.includes("commercial") ? "commercial"
      : "lecteur";

    // Fusionner les sections de tous les rôles sélectionnés
    const mergedSections = Array.from(new Set(
      selectedRoles.flatMap((r) => ROLE_SECTIONS[r] || [])
    ));

    if (editId) {
      const updated = {
        ...DB,
        users: DB.users.map((u) =>
          u.id === editId
            ? { ...u, nom: nom.trim(), email, role: primaryRole, roles: [...selectedRoles], tel, allowedSections: mergedSections }
            : u
        ),
      };
      setDB(updated);
      saveDB(updated);
      // Mettre à jour les custom claims Firebase pour que le rôle soit effectif
      // sur les règles Firestore (canWrite() y lit request.auth.token.role, pas
      // la DB locale). On envoie le uid connu s'il existe, sinon l'email : la
      // Cloud Function résout alors le compte Firebase Auth par email — c'est
      // ce qui manquait pour la plupart des comptes créés avant ce correctif,
      // d'où les erreurs "Missing or insufficient permissions" lors des
      // sauvegardes malgré un rôle qui semblait correct dans l'app.
      const userRecord = DB.users.find((u) => u.id === editId);
      if (userRecord?.email) {
        const fbUid = (userRecord as any)?.uid || (userRecord as any)?.firebaseUid;
        cfSetUserClaims({
          ...(fbUid ? { uid: fbUid } : { email: userRecord.email }),
          role: primaryRole,
          roles: [...selectedRoles],
        })
          .then((res) => {
            if (res.success) {
              toast.success("Rôles synchronisés avec Firebase");
              // Mémoriser le uid résolu pour éviter une résolution par email
              // à chaque prochaine modification.
              if (res.data?.uid && !fbUid) {
                setDB((prev) => {
                  const withUid = {
                    ...prev,
                    users: prev.users.map((u) =>
                      u.id === editId ? { ...u, uid: res.data!.uid } : u
                    ),
                  };
                  saveDB(withUid);
                  return withUid;
                });
              }
            } else {
              console.warn("[Claims] Echec sync claims:", res.error);
              toast.error(`Rôle enregistré localement mais pas synchronisé côté Firebase : ${res.error}`);
            }
          })
          .catch((err) => console.warn("[Claims] Erreur:", err));
      }
      logActivity("update", "Utilisateur", `Modification: ${nom} (${selectedRoles.join(" + ")})`);
      toast.success("Utilisateur modifié avec succès");
    } else {
      if (DB.users.some((u) => u.email === email.trim())) {
        toast.error("Cet email est déjà utilisé");
        return;
      }

      const baseItem = {
        id: uid(),
        nom: nom.trim(),
        login: email.split("@")[0],
        email: email.trim(),
        roles: [...selectedRoles],
        role: primaryRole,
        actif: true,
        tel,
        allowedSections: mergedSections,
        permissions: {},
        createdAt: new Date().toISOString(),
        invitePending: true,
      };

      // Chemin normal : la Cloud Function crée le vrai compte Firebase Auth
      // ET pose le custom claim de rôle dans la même opération atomique.
      // C'est indispensable — sans ce claim, firestore.rules refuse toutes
      // les écritures de ce compte ("Missing or insufficient permissions")
      // même si l'app affiche le bon rôle localement.
      const cfResult = await cfCreateUserWithRole({
        email: email.trim(),
        displayName: nom.trim(),
        role: primaryRole,
        roles: [...selectedRoles],
        tel,
      });

      if (cfResult.success && cfResult.data?.uid) {
        const item = { ...baseItem, uid: cfResult.data.uid };
        const updated = { ...DB, users: [...DB.users, item] };
        setDB(updated);
        saveDB(updated);
        try {
          await sendPasswordResetEmail(auth, email.trim());
          logActivity("create", "Utilisateur", `${nom} (${selectedRoles.join(" + ")}) — Invitation envoyée à ${email}`);
          toast.success(`Utilisateur créé avec le rôle ${primaryRole}. Invitation envoyée à ${email}`);
        } catch (mailErr: any) {
          // Le compte + le rôle sont bien créés côté Firebase, seul l'envoi
          // de l'email d'invitation a échoué : pas bloquant, l'admin peut
          // renvoyer l'invitation depuis la liste des utilisateurs.
          logActivity("create", "Utilisateur", `${nom} (${selectedRoles.join(" + ")}) — Compte créé, email d'invitation à renvoyer`);
          toast.success(`Utilisateur créé avec le rôle ${primaryRole}. L'email d'invitation n'a pas pu être envoyé (${mailErr.message}) — utilisez "Réinitialiser le mot de passe" pour la renvoyer.`);
        }
      } else {
        // Cloud Functions injoignables (mode dégradé) : on garde l'app
        // utilisable en créant l'entrée localement, mais SANS compte
        // Firebase réel — cet utilisateur ne pourra ni se connecter, ni
        // écrire tant qu'un admin ne le recrée pas une fois les Cloud
        // Functions de nouveau disponibles.
        const updated = { ...DB, users: [...DB.users, baseItem] };
        setDB(updated);
        saveDB(updated);
        logActivity("create", "Utilisateur", `${nom} (${selectedRoles.join(" + ")}) — Créé localement (Cloud Functions indisponibles)`);
        toast.error(
          `Cloud Functions indisponibles : "${nom}" est enregistré localement mais n'a pas de compte Firebase valide. Il ne pourra pas se connecter avant qu'un administrateur le recrée une fois la connexion rétablie. (${cfResult.error || "raison inconnue"})`
        );
      }
    }
    setOpen(false);
  };

  const handleSavePermissions = () => {
    if (!permUserId) return;
    const updated = {
      ...DB,
      users: DB.users.map((u) =>
        u.id === permUserId
          ? { ...u, allowedSections: customSections, permissions: customPermissions }
          : u
      ),
    };
    setDB(updated);
    saveDB(updated);
    const user = DB.users.find((u) => u.id === permUserId);
    logActivity("update", "Utilisateur", `Permissions modifiées: ${user?.nom} (${customSections.length} sections)`);
    toast.success("Permissions mises à jour avec succès");
    setPermOpen(false);
  };

  const toggleSection = (section: string) => {
    setCustomSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
  };

  const togglePermission = (section: string, action: string) => {
    setCustomPermissions((prev) => {
      const sectionPerms = prev[section] || ["read", "create", "edit", "delete"];
      const newPerms = sectionPerms.includes(action)
        ? sectionPerms.filter((a) => a !== action)
        : [...sectionPerms, action];
      return { ...prev, [section]: newPerms };
    });
  };

  const selectAllSections = () => setCustomSections([...ALL_SECTIONS]);
  const deselectAllSections = () => setCustomSections(["dashboard"]);
  const selectCategorySections = (sections: string[]) => {
    setCustomSections((prev) => Array.from(new Set([...prev, ...sections])));
  };

  const applyRoleDefaults = () => {
    const user = DB.users.find((u) => u.id === permUserId);
    if (user) {
      const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
      const merged = Array.from(new Set(roles.flatMap((r) => ROLE_SECTIONS[r] || [])));
      setCustomSections(merged);
    }
  };

  const [toggleActifId, setToggleActifId] = useState<string | null>(null);
  const toggleActifTarget = toggleActifId ? DB.users.find((u) => u.id === toggleActifId) || null : null;

  const toggleActif = (id: string) => {
    const user = DB.users.find((u) => u.id === id);
    if (!user) return;

    // Protection : ne pas désactiver le dernier admin
    if (user.actif && (user.role === "admin" || user.roles?.includes("admin"))) {
      const activeAdmins = DB.users.filter((u) => u.actif && (u.role === "admin" || u.roles?.includes("admin")));
      if (activeAdmins.length <= 1) {
        toast.error("Impossible de désactiver le dernier administrateur actif");
        return;
      }
    }

    setToggleActifId(id);
  };

  const confirmToggleActif = () => {
    const id = toggleActifId; if (!id) return;
    const updated = { ...DB, users: DB.users.map((u) => u.id === id ? { ...u, actif: !u.actif } : u) };
    setDB(updated);
    saveDB(updated);
    const updatedUser = updated.users.find((u) => u.id === id);
    logActivity("update", "Utilisateur", `${updatedUser?.nom} - ${updatedUser?.actif ? "Activé" : "Désactivé"}`);
    toast.success(updatedUser?.actif ? "Utilisateur activé" : "Utilisateur désactivé");
    setToggleActifId(null);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const user = DB.users.find((u) => u.id === deleteId);
    if (!user) return;
    if ((user.role === "admin" || user.roles?.includes("admin")) && DB.users.filter((u) => (u.role === "admin" || u.roles?.includes("admin")) && u.actif).length <= 1) {
      toast.error("Impossible de supprimer le dernier administrateur actif");
      setDeleteId(null);
      return;
    }
    const updated = { ...DB, users: DB.users.filter((u) => u.id !== deleteId) };
    setDB(updated);
    saveDB(updated);
    logActivity("delete", "Utilisateur", `Suppression: ${user.nom}`);
    toast.success("Utilisateur supprimé");
    setDeleteId(null);
  };

  const getRoleBadgeColor = (r: string) => {
    switch (r) {
      case "admin": return "bg-red-100 text-red-800 hover:bg-red-100";
      case "caissier": return "bg-blue-100 text-blue-800 hover:bg-blue-100";
      case "commercial": return "bg-purple-100 text-purple-800 hover:bg-purple-100";
      case "lecteur": return "bg-gray-100 text-gray-800 hover:bg-gray-100";
      default: return "bg-gray-100 text-gray-800 hover:bg-gray-100";
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Lock className="w-16 h-16 mb-4 text-gray-300" />
        <h2 className="text-xl font-semibold mb-2">Accès restreint</h2>
        <p>Seul un administrateur peut gérer les utilisateurs et permissions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#1B4B6B]" /> Administration des utilisateurs
          </h2>
          <p className="text-sm text-gray-500">{stats.total} utilisateur(s) dont {stats.actifs} actif(s)</p>
        </div>
        <Button onClick={handleOpenNew} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
          <Plus className="w-4 h-4 mr-2" /> Nouvel utilisateur
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Administrateurs</p>
            <p className="text-2xl font-bold text-red-600">{stats.admins}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Caissiers</p>
            <p className="text-2xl font-bold text-blue-600">{stats.caissiers}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Commerciaux</p>
            <p className="text-2xl font-bold text-purple-600">{stats.commerciaux}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-gray-400">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Lecteurs</p>
            <p className="text-2xl font-bold text-gray-600">{stats.lecteurs}</p>
          </CardContent>
        </Card>
      </div>

      {/* Onglets principaux */}
      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="users">Utilisateurs</TabsTrigger>
          <TabsTrigger value="roles">Matrice des rôles</TabsTrigger>
          <TabsTrigger value="history">Historique</TabsTrigger>
        </TabsList>

        {/* Onglet Utilisateurs */}
        <TabsContent value="users" className="space-y-4">
          {/* Barre de recherche */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom, email ou téléphone..."
              className="pl-10"
            />
          </div>

          {/* Tableau des utilisateurs */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                      <TableHead className="text-white font-semibold">Utilisateur</TableHead>
                      <TableHead className="text-white font-semibold">Contact</TableHead>
                      <TableHead className="text-white font-semibold">Rôle(s)</TableHead>
                      <TableHead className="text-white font-semibold">Accès</TableHead>
                      <TableHead className="text-white font-semibold">Statut</TableHead>
                      <TableHead className="text-white font-semibold text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length > 0 ? filteredUsers.map((u) => {
                      const userSections = (u as any).allowedSections || ROLE_SECTIONS[u.role] || [];
                      return (
                        <TableRow key={u.id} className={!u.actif ? "opacity-50 bg-gray-50" : ""}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-gray-900">{u.nom}</p>
                              <p className="text-xs text-gray-500">{u.email || u.login}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm">{(u as any).tel ? `${((u as any).tel as string).slice(0,2)} ${((u as any).tel as string).slice(2,5)} ${((u as any).tel as string).slice(5)}` : "-"}</p>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {u.roles && u.roles.length > 0 ? u.roles.map((r) => (
                                <Badge key={r} className={`text-xs ${getRoleBadgeColor(r)}`}>{r}</Badge>
                              )) : (
                                <Badge className={`text-xs ${getRoleBadgeColor(u.role)}`}>{u.role}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#1B4B6B] rounded-full"
                                  style={{ width: `${(userSections.length / ALL_SECTIONS.length) * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{userSections.length}/{ALL_SECTIONS.length}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={u.actif}
                                onCheckedChange={() => toggleActif(u.id)}
                                aria-label={u.actif ? `Désactiver ${u.nom}` : `Activer ${u.nom}`}
                              />
                              <span className={`text-xs font-medium ${u.actif ? "text-green-600" : "text-red-600"}`}>
                                {u.actif ? "Actif" : "Inactif"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenEdit(u)}
                                title="Modifier"
                                aria-label={`Modifier ${u.nom}`}
                                className="h-8 w-8 p-0"
                              >
                                <Pencil className="w-3.5 h-3.5 text-blue-600" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenPermissions(u)}
                                title="Gérer les permissions"
                                aria-label={`Permissions ${u.nom}`}
                                className="h-8 w-8 p-0"
                              >
                                <Shield className="w-3.5 h-3.5 text-orange-600" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => requireAdminAuth(() => setDeleteId(u.id))}
                                title="Supprimer"
                                aria-label={`Supprimer ${u.nom}`}
                                className="h-8 w-8 p-0"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                          {searchQuery ? "Aucun résultat" : "Aucun utilisateur"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Onglet Matrice des rôles */}
        <TabsContent value="roles" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Matrice des permissions par rôle</h3>
              <p className="text-sm text-gray-500 mb-4">Vue d'ensemble des sections accessibles par défaut pour chaque rôle.</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-100">
                      <TableHead className="font-semibold min-w-[160px]">Section</TableHead>
                      {ROLES.map((r) => (
                        <TableHead key={r.value} className="font-semibold text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-lg">{r.icon}</span>
                            <span className="text-xs">{r.label}</span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SECTION_CATEGORIES.map((cat) => (
                      <>
                        <TableRow key={cat.label} className="bg-gray-50">
                          <TableCell colSpan={5} className="font-semibold text-sm text-[#1B4B6B] py-2">
                            {cat.label}
                          </TableCell>
                        </TableRow>
                        {cat.sections.map((section) => (
                          <TableRow key={section}>
                            <TableCell className="text-sm">{SECTION_LABELS[section]}</TableCell>
                            {ROLES.map((r) => (
                              <TableCell key={r.value} className="text-center">
                                {(ROLE_SECTIONS[r.value] || []).includes(section) ? (
                                  <span className="inline-block w-5 h-5 rounded-full bg-green-100 text-green-600 text-xs leading-5">✓</span>
                                ) : (
                                  <span className="inline-block w-5 h-5 rounded-full bg-red-50 text-red-300 text-xs leading-5">✗</span>
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Légende */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Description des rôles</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ROLES.map((r) => (
                  <div key={r.value} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border">
                    <div className={`w-3 h-3 rounded-full mt-1 ${r.color}`} />
                    <div>
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-gray-600">{r.description}</p>
                      <p className="text-xs text-gray-400 mt-1">{(ROLE_SECTIONS[r.value] || []).length} sections par défaut</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Onglet Historique */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-gray-500" />
                Historique des modifications
              </h3>
              {permissionHistory.length > 0 ? (
                <div className="space-y-2">
                  {permissionHistory.map((entry: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                      <div className={`w-2 h-2 rounded-full mt-2 ${
                        entry.action === "create" ? "bg-green-500" :
                        entry.action === "delete" ? "bg-red-500" : "bg-blue-500"
                      }`} />
                      <div className="flex-1">
                        <p className="text-sm text-gray-800">{entry.details}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-500">{entry.date} à {entry.heure}</span>
                          <span className="text-xs text-gray-400">par {entry.user}</span>
                        </div>
                      </div>
                      <Badge className={`text-xs ${
                        entry.action === "create" ? "bg-green-100 text-green-700" :
                        entry.action === "delete" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {entry.action === "create" ? "Création" : entry.action === "delete" ? "Suppression" : "Modification"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-400 py-8">Aucun historique de modification</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Créer/Modifier utilisateur */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editId ? <Pencil className="w-5 h-5 text-blue-600" /> : <Plus className="w-5 h-5 text-green-600" />}
              {editId ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <Label className="text-sm font-medium">Nom complet *</Label>
              <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Aziz Fall" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">Email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemple.com" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">Téléphone (9 chiffres)</Label>
              <Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ''))} placeholder="771234567" className="mt-1" />
              {tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}
            </div>
            <div>
              <Label className="text-sm font-medium">Rôle(s) — sélection multiple possible</Label>
              <div className="grid grid-cols-1 gap-2 mt-2">
                {ROLES.map((r) => (
                  <label
                    key={r.value}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${
                      selectedRoles.includes(r.value)
                        ? "bg-blue-50 border-blue-300 shadow-sm"
                        : "bg-white border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <Checkbox
                      checked={selectedRoles.includes(r.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedRoles((prev) => [...prev, r.value]);
                        } else {
                          if (selectedRoles.length > 1) {
                            setSelectedRoles((prev) => prev.filter((x) => x !== r.value));
                          }
                        }
                      }}
                    />
                    <div className={`w-3 h-3 rounded-full ${r.color}`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-gray-500">{r.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-xs text-blue-700 font-medium mb-1">Sections accessibles (cumul des rôles) :</p>
              <div className="flex flex-wrap gap-1">
                {Array.from(new Set(selectedRoles.flatMap((r) => ROLE_SECTIONS[r] || []))).map((s) => (
                  <Badge key={s} variant="outline" className="text-xs bg-white">{SECTION_LABELS[s] || s}</Badge>
                ))}
              </div>
              <p className="text-xs text-blue-600 mt-2">
                Personnalisable ensuite via le bouton 🛡️ dans les actions.
              </p>
            </div>
            {!editId && (
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                <p className="text-xs text-amber-700">
                  L'utilisateur devra créer son compte Firebase avec cet email pour pouvoir se connecter.
                </p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                {editId ? "Modifier" : "Créer l'utilisateur"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Permissions personnalisées */}
      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-orange-600" />
              Permissions — {DB.users.find((u) => u.id === permUserId)?.nom}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            {/* Actions rapides */}
            <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg border">
              <Button variant="outline" size="sm" onClick={selectAllSections} className="text-xs">
                Tout autoriser
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAllSections} className="text-xs">
                Minimum
              </Button>
              <Button variant="outline" size="sm" onClick={applyRoleDefaults} className="text-xs">
                Réinitialiser (défaut du rôle)
              </Button>
            </div>

            {/* Sections par catégorie */}
            <div className="space-y-4">
              {SECTION_CATEGORIES.map((cat) => (
                <div key={cat.label} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
                    <h4 className="text-sm font-semibold text-gray-700">{cat.label}</h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-blue-600 h-6"
                      onClick={() => selectCategorySections(cat.sections)}
                    >
                      Tout activer
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
                    {cat.sections.map((section) => (
                      <label
                        key={section}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-all ${
                          customSections.includes(section) ? "bg-green-50 border border-green-200" : "bg-white border border-gray-100 hover:bg-gray-50"
                        }`}
                      >
                        <Checkbox
                          checked={customSections.includes(section)}
                          onCheckedChange={() => toggleSection(section)}
                        />
                        <span className="text-sm">{SECTION_LABELS[section] || section}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Résumé */}
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-sm font-medium text-blue-800">
                {customSections.length}/{ALL_SECTIONS.length} sections autorisées
              </p>
              <div className="w-full h-2 bg-blue-200 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-[#1B4B6B] rounded-full transition-all"
                  style={{ width: `${(customSections.length / ALL_SECTIONS.length) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSavePermissions} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                Enregistrer les permissions
              </Button>
              <Button variant="outline" onClick={() => setPermOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog authentification admin */}
      <Dialog open={showAdminAuth} onOpenChange={setShowAdminAuth}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-red-600" />
              Confirmation administrateur
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-sm text-gray-600">
              Cette action nécessite une confirmation. Entrez le code administrateur pour continuer.
            </p>
            <div>
              <Label className="text-sm font-medium">Code administrateur</Label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Entrez le code"
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && confirmAdminAuth()}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={confirmAdminAuth} className="flex-1 bg-red-600 hover:bg-red-700">
                Confirmer
              </Button>
              <Button variant="outline" onClick={() => { setShowAdminAuth(false); setAdminPassword(""); setPendingAction(null); }}>
                Annuler
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation suppression */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Supprimer cet utilisateur ?"
        description="Cette action est irréversible. L'utilisateur ne pourra plus se connecter à l'application."
        confirmLabel="Supprimer définitivement"
        onConfirm={confirmDelete}
      />

      {/* Confirmation activation/désactivation */}
      <ConfirmDialog
        open={!!toggleActifId}
        onOpenChange={(o) => !o && setToggleActifId(null)}
        title={toggleActifTarget?.actif ? "Désactiver cet utilisateur ?" : "Activer cet utilisateur ?"}
        description={toggleActifTarget ? (toggleActifTarget.actif
          ? `${toggleActifTarget.nom} ne pourra plus se connecter à l'application tant qu'il ne sera pas réactivé.`
          : `${toggleActifTarget.nom} pourra à nouveau se connecter à l'application.`) : ""}
        confirmLabel={toggleActifTarget?.actif ? "Désactiver" : "Activer"}
        variant={toggleActifTarget?.actif ? "warning" : "default"}
        onConfirm={confirmToggleActif}
      />

      {/* Confirmation retrait des droits admin */}
      <ConfirmDialog
        open={pendingRoleChangeConfirm}
        onOpenChange={(o) => !o && setPendingRoleChangeConfirm(false)}
        title="Retirer les droits administrateur ?"
        description={`${nom} n'aura plus accès aux fonctions d'administration (utilisateurs, paramètres, sauvegardes...) après cette modification.`}
        confirmLabel="Confirmer le changement de rôle"
        variant="warning"
        onConfirm={executeSave}
      />
    </div>
  );
}
