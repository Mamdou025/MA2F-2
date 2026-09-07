import { useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const { login, resetPassword, isLoading, loginError, firebaseReady } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Entrez votre email et votre mot de passe");
      return;
    }
    try {
      await login(email, password);
    } catch {
      // Error handled in context
    }
  };

  const handleReset = async () => {
    if (!email) {
      toast.error("Entrez d'abord votre email");
      return;
    }
    try {
      await resetPassword(email);
      toast.success(`Email de réinitialisation envoyé à ${email}`);
    } catch {
      toast.error("Impossible d'envoyer l'email. Vérifiez l'adresse.");
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #1B4B6B 0%, #0a3d6e 100%)",
      }}
    >
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 25%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(255,255,255,0.05) 0%, transparent 50%)",
          }}
        />
      </div>

      <Card className="w-full max-w-md relative z-10 border-0 shadow-2xl">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#1B4B6B] to-[#2D7A9E] flex items-center justify-center shadow-lg">
              <img
                src="/manus-storage/ma2f-logo_ef99502d.png"
                alt="MA2F"
                className="w-14 h-14 object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">MA2F</h1>
            <p className="text-gray-500 mt-1 text-sm">Gestion AquaSachet</p>
            <div className="mt-2 text-xs">
              {firebaseReady ? (
                <span className="text-green-600 font-medium">Connecté</span>
              ) : (
                <span className="text-amber-600 font-medium flex items-center justify-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Connexion à Firebase...
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="vous@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                placeholder="Votre mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {loginError && (
              <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                {loginError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-[#1B4B6B] hover:bg-[#0d4a85]"
              disabled={isLoading || !firebaseReady}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connexion...
                </>
              ) : (
                "Se connecter"
              )}
            </Button>

            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-blue-600 hover:text-blue-800 w-full text-center mt-2 underline"
            >
              Mot de passe oublié ?
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
