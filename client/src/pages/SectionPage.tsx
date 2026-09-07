import { lazy, Suspense } from "react";
import { useApp } from "@/contexts/AppContext";
import Dashboard from "./Dashboard";
import { Loader2 } from "lucide-react";

// Code-splitting : chargement à la demande des modules
const ProductionSection = lazy(() => import("@/components/sections/ProductionSection"));
const VentesSection = lazy(() => import("@/components/sections/VentesSection"));
const CommandesSection = lazy(() => import("@/components/sections/CommandesSection"));
const ClientsSection = lazy(() => import("@/components/sections/ClientsSection"));
const CommerciauxSection = lazy(() => import("@/components/sections/CommerciauxSection"));
const LivreursSection = lazy(() => import("@/components/sections/LivreursSection"));
const ProducteursSection = lazy(() => import("@/components/sections/ProducteursSection"));
const EmployesSection = lazy(() => import("@/components/sections/EmployesSection"));
const ActionnairesSection = lazy(() => import("@/components/sections/ActionnairesSection"));
const ObjectifsSection = lazy(() => import("@/components/sections/ObjectifsSection"));
const DepensesSection = lazy(() => import("@/components/sections/DepensesSection"));
const CaisseSection = lazy(() => import("@/components/sections/CaisseSection"));
const CreancesSection = lazy(() => import("@/components/sections/CreancesSection"));
const RecouvrementSection = lazy(() => import("@/components/sections/RecouvrementSection"));
const LivraisonsSection = lazy(() => import("@/components/sections/LivraisonsSection"));
const MaintenanceSection = lazy(() => import("@/components/sections/MaintenanceSection"));
const VersementsSection = lazy(() => import("@/components/sections/VersementsSection"));
const ApportsSection = lazy(() => import("@/components/sections/ApportsSection"));
const AnalytiqueSection = lazy(() => import("@/components/sections/AnalytiqueSection"));
const VehiculesSection = lazy(() => import("@/components/sections/VehiculesSection"));
const CorbeilleSection = lazy(() => import("@/components/sections/CorbeilleSection"));
const RapportSection = lazy(() => import("@/components/sections/RapportSection"));
const JournalSection = lazy(() => import("@/components/sections/JournalSection"));
const SecuriteSection = lazy(() => import("@/components/sections/SecuriteSection"));
const BackupsSection = lazy(() => import("@/components/sections/BackupsSection"));
const UtilisateursSection = lazy(() => import("@/components/sections/UtilisateursSection"));
const ParametresSection = lazy(() => import("@/components/sections/ParametresSection"));
const ClotureSection = lazy(() => import("@/components/sections/ClotureSection"));
const HistoriqueSection = lazy(() => import("@/components/sections/HistoriqueSection"));
const StockSection = lazy(() => import("@/components/sections/StockSection"));
const ReconciliationSection = lazy(() => import("@/components/sections/ReconciliationSection"));
const SuiviLogistiqueSection = lazy(() => import("@/components/sections/SuiviLogistiqueSection"));
const ApprobationsSection = lazy(() => import("@/components/sections/ApprobationsSection"));
const ComptabiliteSection = lazy(() => import("@/components/sections/ComptabiliteSection"));
const MonitoringSection = lazy(() => import("@/components/sections/MonitoringSection"));
const StrategieSection = lazy(() => import("@/components/sections/StrategieSection"));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-[#1B4B6B]" />
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <span className="text-2xl">🔒</span>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Accès refusé</h2>
      <p className="text-gray-500 max-w-md">
        Vous n'avez pas les permissions nécessaires pour accéder à cette section.
        Contactez votre administrateur si vous pensez qu'il s'agit d'une erreur.
      </p>
    </div>
  );
}

export default function SectionPage() {
  const { currentSection, allowedSections } = useApp();

  // Garde de route : vérifier que l'utilisateur a accès à la section
  if (currentSection !== "dashboard" && !allowedSections.includes(currentSection)) {
    return <AccessDenied />;
  }

  const renderSection = () => {
    switch (currentSection) {
      case "dashboard":
        return <Dashboard />;
      case "production":
        return <ProductionSection />;
      case "ventes":
        return <VentesSection />;
      case "commandes":
        return <CommandesSection />;
      case "clients":
        return <ClientsSection />;
      case "commerciaux":
        return <CommerciauxSection />;
      case "livreurs":
        return <LivreursSection />;
      case "producteurs":
        return <ProducteursSection />;
      case "employes":
        return <EmployesSection />;
      case "actionnaires":
        return <ActionnairesSection />;
      case "objectifs":
        return <ObjectifsSection />;
      case "depenses":
        return <DepensesSection />;
      case "caisse":
        return <CaisseSection />;
      case "creances":
        return <CreancesSection />;
      case "recouvrement":
        return <RecouvrementSection />;
      case "livraisons":
        return <LivraisonsSection />;
      case "maintenance":
        return <MaintenanceSection />;
      case "versements":
        return <VersementsSection />;
      case "apports":
        return <ApportsSection />;
      case "analytique":
        return <AnalytiqueSection />;
      case "vehicules":
        return <VehiculesSection />;
      case "corbeille":
        return <CorbeilleSection />;
      case "rapport":
        return <RapportSection />;
      case "journal":
        return <JournalSection />;
      case "securite":
        return <SecuriteSection />;
      case "backups":
        return <BackupsSection />;
      case "utilisateurs":
        return <UtilisateursSection />;
      case "parametres":
        return <ParametresSection />;
      case "cloture":
        return <ClotureSection />;
      case "historique":
        return <HistoriqueSection />;
      case "stock":
        return <StockSection />;
      case "reconciliation":
        return <ReconciliationSection />;
      case "suiviLogistique":
        return <SuiviLogistiqueSection />;
      case "approbations":
        return <ApprobationsSection />;
      case "comptabilite":
        return <ComptabiliteSection />;
      case "monitoring":
        return <MonitoringSection />;
      case "strategie":
        return <StrategieSection />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Suspense fallback={<LoadingFallback />}>
      {renderSection()}
    </Suspense>
  );
}
