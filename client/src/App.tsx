import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppProvider, useApp } from "./contexts/AppContext";
import LoginPage from "./pages/LoginPage";
import SectionPage from "./pages/SectionPage";
import AppSidebar from "./components/AppSidebar";
import { ExportExcelButton, SaveExcelButton } from "./components/ExportExcel";
import { GlobalSearch } from "./components/GlobalSearch";
import NotificationBell from "./components/NotificationBell";
import TwoFactorChallenge from "./components/TwoFactorChallenge";
import { Loader2 } from "lucide-react";
import { is2FARequired } from "@/lib/twoFactor";
import { auth } from "@/lib/firebase";
import { signOut as firebaseSignOut } from "firebase/auth";

function AppContent() {
  const { currentUser, DB, firebaseReady } = useApp();
  const [twoFAVerified, setTwoFAVerified] = useState(false);
  const [twoFARequired, setTwoFARequired] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");

  // Vérifier si la 2FA est requise pour cet utilisateur
  useEffect(() => {
    if (currentUser) {
      const role = currentUser.role || currentUser.roles[0];
      const userRecord = DB.users.find(
        (u) => (u.email || "").toLowerCase() === currentUser.email.toLowerCase()
      );
      const has2FASecret = !!(userRecord as any)?.totpSecret;
      const requires2FA = is2FARequired(role) && has2FASecret;

      if (requires2FA) {
        setTwoFARequired(true);
        setTotpSecret((userRecord as any).totpSecret);
        setTwoFAVerified(false);
      } else {
        setTwoFARequired(false);
        setTwoFAVerified(true);
      }
    } else {
      setTwoFARequired(false);
      setTwoFAVerified(false);
    }
  }, [currentUser, DB.users]);

  if (!firebaseReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="mt-3 text-sm text-muted-foreground">Connexion à Firebase...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage />;
  }

  // Si la 2FA est requise et pas encore vérifiée
  if (twoFARequired && !twoFAVerified) {
    return (
      <TwoFactorChallenge
        userEmail={currentUser.email}
        totpSecret={totpSecret}
        onSuccess={() => setTwoFAVerified(true)}
        onCancel={() => {
          firebaseSignOut(auth);
          setTwoFAVerified(false);
          setTwoFARequired(false);
        }}
      />
    );
  }

  // Export Excel (bouton vert, ExportExcelButton) et Sauvegarde Excel (bouton
  // bleu, SaveExcelButton) : accès étendu 2026-08-18 puis 2026-08-19 à
  // caissier et commercial en plus de l'admin — un utilisateur qui tient la
  // caisse ou le rôle commercial doit pouvoir exporter/sauvegarder ses
  // propres données sans passer par la section Sauvegardes (réservée admin,
  // voir AppSidebar.tsx `adminOnly`). Lecteur (rôle lecture seule) en reste
  // exclu par cohérence avec Importer CSV (voir ClientsSection.tsx) — même
  // liste de rôles partout où ces actions apparaissent.
  const canExportExcel = currentUser.roles.some((r) => ["admin", "caissier", "commercial"].includes(r));

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className="lg:ml-64 min-h-screen flex flex-col">
        {/* Barre supérieure fixe : recherche globale + exports */}
        <header style={{ top: "var(--odoo-status-height, 0px)" }} className="sticky z-30 bg-card/95 backdrop-blur-sm border-b border-border">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3 pt-16 lg:pt-3">
            <GlobalSearch />
            <div className="flex gap-2 items-center">
              {canExportExcel && <ExportExcelButton />}
              {canExportExcel && <SaveExcelButton />}
              <NotificationBell />
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <SectionPage />
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <AppProvider>
            <Toaster />
            <AppContent />
          </AppProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
