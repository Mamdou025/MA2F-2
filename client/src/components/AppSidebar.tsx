import { OdooConnectionButton } from "./OdooConnectionStatus";
import { useApp } from "@/contexts/AppContext";
import type { Section } from "@/lib/types";
import { MA2FMark } from "@/components/MA2FMark";
import {
  LayoutDashboard,
  Factory,
  DollarSign,
  Users,
  UserCircle,
  Receipt,
  Landmark,
  BookOpen,
  Banknote,
  Truck,
  Wrench,
  Building2,
  Calculator,
  Trash2,
  FileText,
  ScrollText,
  Shield,
  HardDrive,
  Settings,
  LogOut,
  Menu,
  X,
  Cloud,
  CloudOff,
  Loader2,
  AlertCircle,
  Lock,
  History,
  Package,
  ClipboardCheck,
  PiggyBank,
  RefreshCw,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  Trophy,
  PhoneCall,
  Gauge,
  IdCard,
  Handshake,
} from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import OfflineIndicator from "@/components/OfflineIndicator";
import { useTheme } from "@/contexts/ThemeContext";

interface NavItem {
  id: Section;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Tableau de bord", icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
  { id: "production", label: "Production", icon: <Factory className="w-[18px] h-[18px]" /> },
  { id: "ventes", label: "Ventes", icon: <DollarSign className="w-[18px] h-[18px]" /> },
  { id: "commandes", label: "Commandes", icon: <PhoneCall className="w-[18px] h-[18px]" /> },
  { id: "clients", label: "Clients", icon: <Users className="w-[18px] h-[18px]" /> },
  { id: "commerciaux", label: "Commerciaux", icon: <UserCircle className="w-[18px] h-[18px]" /> },
  { id: "livreurs", label: "Livreurs", icon: <Truck className="w-[18px] h-[18px]" /> },
  { id: "producteurs", label: "Producteurs", icon: <Factory className="w-[18px] h-[18px]" /> },
  { id: "employes", label: "Employés", icon: <IdCard className="w-[18px] h-[18px]" /> },
  { id: "objectifs", label: "Objectifs & primes", icon: <Trophy className="w-[18px] h-[18px]" /> },
  { id: "depenses", label: "Dépenses", icon: <Receipt className="w-[18px] h-[18px]" /> },
  { id: "caisse", label: "Caisse", icon: <Landmark className="w-[18px] h-[18px]" /> },
  { id: "creances", label: "Créances", icon: <BookOpen className="w-[18px] h-[18px]" /> },
  { id: "recouvrement", label: "Recouvrement", icon: <Banknote className="w-[18px] h-[18px]" /> },
  { id: "livraisons", label: "Réception rouleaux", icon: <Truck className="w-[18px] h-[18px]" /> },
  { id: "stock", label: "Stock", icon: <Package className="w-[18px] h-[18px]" /> },
  { id: "reconciliation", label: "Réconciliation", icon: <ClipboardCheck className="w-[18px] h-[18px]" /> },
  { id: "suiviLogistique", label: "Suivi logistique", icon: <Gauge className="w-[18px] h-[18px]" /> },
  { id: "maintenance", label: "Maintenance", icon: <Wrench className="w-[18px] h-[18px]" /> },
  { id: "versements", label: "Versements", icon: <Building2 className="w-[18px] h-[18px]" /> },
  { id: "apports", label: "Apports de fonds", icon: <PiggyBank className="w-[18px] h-[18px]" /> },
  { id: "actionnaires", label: "Actionnaires", icon: <Handshake className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "analytique", label: "Coût de revient", icon: <Calculator className="w-[18px] h-[18px]" /> },
  { id: "vehicules", label: "Véhicules", icon: <Truck className="w-[18px] h-[18px]" /> },
  { id: "corbeille", label: "Corbeille", icon: <Trash2 className="w-[18px] h-[18px]" /> },
  { id: "rapport", label: "Rapport", icon: <FileText className="w-[18px] h-[18px]" /> },
  { id: "strategie", label: "Stratégie & conseils", icon: <Lightbulb className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "journal", label: "Journal", icon: <ScrollText className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "parametres", label: "Paramètres", icon: <Settings className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "cloture", label: "Clôture", icon: <Lock className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "historique", label: "Historique modifs", icon: <History className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "approbations", label: "Approbations", icon: <ClipboardCheck className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "comptabilite", label: "Comptabilité", icon: <Calculator className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "monitoring", label: "Monitoring", icon: <AlertCircle className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "securite", label: "Sécurité", icon: <Shield className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "backups", label: "Sauvegardes", icon: <HardDrive className="w-[18px] h-[18px]" />, adminOnly: true },
  { id: "utilisateurs", label: "Utilisateurs", icon: <Settings className="w-[18px] h-[18px]" />, adminOnly: true },
];

// Mêmes groupes que SECTION_CATEGORIES dans UtilisateursSection.tsx, pour rester cohérent.
interface NavGroup {
  label: string;
  sections: Section[];
  collapsible?: boolean;
}

const navGroups: NavGroup[] = [
  { label: "Gestion principale", sections: ["dashboard", "production", "ventes", "commandes", "clients", "depenses", "caisse"] },
  { label: "Équipe", sections: ["commerciaux", "livreurs", "producteurs", "employes", "objectifs", "utilisateurs"] },
  { label: "Finances", sections: ["creances", "recouvrement", "versements", "apports", "actionnaires", "analytique"] },
  { label: "Logistique", sections: ["livraisons", "stock", "reconciliation", "suiviLogistique", "maintenance", "vehicules"] },
  {
    label: "Rapports & Admin",
    sections: [
      "rapport",
      "journal",
      "corbeille",
      "securite",
      "backups",
      "parametres",
      "cloture",
      "historique",
      "approbations",
      "comptabilite",
      "monitoring",
      "strategie",
    ],
    collapsible: true,
  },
];

function NavButton({
  item,
  active,
  onClick,
  buttonRef,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className={`group relative w-full flex items-center gap-3 pl-3 pr-3 py-2 rounded-md text-[13px] font-medium transition-colors duration-150 ${
        active
          ? "bg-sidebar-accent text-white"
          : "text-sidebar-foreground/80 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r bg-[#4a90bf]" />
      )}
      <span className={active ? "text-[#7fb8db]" : "text-sidebar-foreground/50 group-hover:text-[#7fb8db]"}>
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export default function AppSidebar() {
  const { currentUser, currentSection, setCurrentSection, logout, allowedSections, syncStatus, lastSyncTime, syncNow } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const firstNavItemRef = useRef<HTMLButtonElement>(null);
  const previousMobileOpen = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["Rapports & Admin"]));

  useEffect(() => {
    const desktopMedia = window.matchMedia("(min-width: 1024px)");
    const updateDesktopState = (event: MediaQueryListEvent) =>
      setIsDesktop(event.matches);

    setIsDesktop(desktopMedia.matches);
    desktopMedia.addEventListener("change", updateDesktopState);
    return () => desktopMedia.removeEventListener("change", updateDesktopState);
  }, []);

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  const itemsById = new Map(navItems.map((item) => [item.id, item]));
  const groupedSectionIds = new Set(navGroups.flatMap((g) => g.sections));
  const ungroupedItems = navItems.filter((item) => !groupedSectionIds.has(item.id));

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.sections
        .map((id) => itemsById.get(id))
        .filter((item): item is NavItem => !!item && allowedSections.includes(item.id)),
    }))
    .filter((group) => group.items.length > 0);

  const visibleUngroupedItems = ungroupedItems.filter((item) => allowedSections.includes(item.id));

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleNav = (section: Section) => {
    setCurrentSection(section);
    setMobileOpen(false);
  };

  const toggleMobileNavigation = () => {
    setMobileOpen((open) => !open);
  };

  const handleMobileToggleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMobileNavigation();
  };

  useEffect(() => {
    if (mobileOpen === previousMobileOpen.current) return;

    if (mobileOpen) {
      firstNavItemRef.current?.focus();
    } else {
      mobileToggleRef.current?.focus();
    }
    previousMobileOpen.current = mobileOpen;
  }, [mobileOpen]);

  const firstVisibleItemId =
    visibleGroups[0]?.items[0]?.id ?? visibleUngroupedItems[0]?.id;
  const mobileSidebarHidden = !isDesktop && !mobileOpen;

  return (
    <>
      {!mobileOpen && (
        <div
          className="lg:hidden fixed left-4 z-50 max-w-[calc(100vw-2rem)] rounded-lg border border-sidebar-border bg-sidebar px-1 pb-1.5 shadow-lg"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        >
          <OdooConnectionButton />
        </div>
      )}
      {/* Mobile toggle */}
      <button
        ref={mobileToggleRef}
        onClick={toggleMobileNavigation}
        onKeyDown={handleMobileToggleKeyDown}
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={mobileOpen}
        aria-controls="app-sidebar"
        style={{ top: "calc(var(--odoo-status-height, 0px) + 1rem)" }}
        className={`lg:hidden fixed z-50 bg-sidebar text-white shadow-lg rounded-lg p-2 border border-sidebar-border transition-[left] duration-200 ${
          mobileOpen ? "left-[13rem]" : "left-4"
        }`}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay on mobile */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        aria-hidden={mobileSidebarHidden}
        inert={mobileSidebarHidden}
        style={{ top: "var(--odoo-status-height, 0px)", height: "calc(100% - var(--odoo-status-height, 0px))" }}
        className={`fixed left-0 w-64 bg-sidebar border-r border-sidebar-border z-40 flex flex-col transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#2d6488] to-[#4a90bf] flex items-center justify-center shadow-sm ring-1 ring-white/10">
              <MA2FMark className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-white tracking-tight leading-tight">MA2F</h1>
              <p className="text-[11px] text-sidebar-foreground/60 leading-tight">AquaSachet</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {visibleUngroupedItems.length > 0 && (
            <div className="space-y-0.5 mb-3">
              {visibleUngroupedItems.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={currentSection === item.id}
                  onClick={() => handleNav(item.id)}
                    buttonRef={item.id === firstVisibleItemId ? firstNavItemRef : undefined}
                />
              ))}
            </div>
          )}

          {visibleGroups.map((group) => {
            const isCollapsed = !!group.collapsible && collapsedGroups.has(group.label);
            return (
              <div key={group.label} className="mb-3">
                {group.collapsible ? (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider hover:text-sidebar-foreground/70 transition-colors"
                  >
                    <span>{group.label}</span>
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                ) : (
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                    {group.label}
                  </div>
                )}
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <NavButton
                        key={item.id}
                        item={item}
                        active={currentSection === item.id}
                        onClick={() => handleNav(item.id)}
                        buttonRef={item.id === firstVisibleItemId ? firstNavItemRef : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sync status */}
        <div className="px-2.5 py-2 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.04]">
            {syncStatus === "synced" && <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            {syncStatus === "syncing" && <Loader2 className="w-3.5 h-3.5 text-[#7fb8db] animate-spin shrink-0" />}
            {syncStatus === "error" && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
            {syncStatus === "disconnected" && <CloudOff className="w-3.5 h-3.5 text-sidebar-foreground/40 shrink-0" />}
            <span className="text-[11px] text-sidebar-foreground/60 flex-1 truncate">
              {syncStatus === "synced" && `Sync ${lastSyncTime}`}
              {syncStatus === "syncing" && "Synchronisation..."}
              {syncStatus === "error" && "Erreur sync"}
              {syncStatus === "disconnected" && "Hors ligne"}
            </span>
            <button
              onClick={handleSyncNow}
              disabled={syncing || syncStatus === "syncing"}
              title="Synchroniser maintenant"
              className="shrink-0 p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sidebar-foreground/50 ${syncing || syncStatus === "syncing" ? "animate-spin" : ""}`} />
            </button>
          </div>
          <OdooConnectionButton />
        </div>

        {/* Dark mode toggle */}
        {toggleTheme && (
          <div className="px-2.5 py-1.5">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium text-sidebar-foreground/70 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
              <span className="flex-1 text-left">{theme === "dark" ? "Mode clair" : "Mode sombre"}</span>
            </button>
          </div>
        )}

        {/* Offline indicator */}
        <div className="px-2.5 py-1">
          <OfflineIndicator />
        </div>

        {/* User info & logout */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-1 py-2 mb-1.5">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center ring-1 ring-white/10">
              <UserCircle className="w-[18px] h-[18px] text-[#7fb8db]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-white truncate">
                {currentUser?.nom}
              </p>
              <p className="text-[11px] text-sidebar-foreground/50 truncate capitalize">
                {currentUser?.roles.join(", ")}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 bg-transparent text-sidebar-foreground/70 border-white/10 hover:bg-white/[0.06] hover:text-white"
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </Button>
        </div>
      </aside>
    </>
  );
}
