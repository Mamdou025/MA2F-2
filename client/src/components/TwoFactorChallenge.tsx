import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { verifyTOTP } from "@/lib/twoFactor";
import { toast } from "sonner";

interface TwoFactorChallengeProps {
  userEmail: string;
  totpSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function TwoFactorChallenge({
  userEmail,
  totpSecret,
  onSuccess,
  onCancel,
}: TwoFactorChallengeProps) {
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Le code doit contenir 6 chiffres");
      return;
    }

    setIsVerifying(true);
    try {
      const valid = await verifyTOTP(totpSecret, code);
      if (valid) {
        toast.success("Vérification réussie");
        onSuccess();
      } else {
        setAttempts((prev) => prev + 1);
        if (attempts >= 4) {
          toast.error("Trop de tentatives. Veuillez vous reconnecter.");
          onCancel();
        } else {
          toast.error(`Code incorrect. ${4 - attempts} tentatives restantes.`);
          setCode("");
          inputRef.current?.focus();
        }
      }
    } catch {
      toast.error("Erreur de vérification");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #1B4B6B 0%, #0a3d6e 100%)",
      }}
    >
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
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              Vérification en deux étapes
            </h2>
            <p className="text-gray-500 mt-2 text-sm">
              Entrez le code à 6 chiffres de votre application d'authentification
            </p>
            <p className="text-gray-400 text-xs mt-1">{userEmail}</p>
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-gray-400" />
              <Input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(val);
                }}
                className="text-center text-2xl tracking-[0.5em] font-mono"
                autoComplete="one-time-code"
              />
            </div>

            {attempts > 0 && (
              <p className="text-xs text-red-500 text-center">
                {5 - attempts} tentatives restantes avant verrouillage
              </p>
            )}

            <Button
              type="submit"
              className="w-full bg-[#1B4B6B] hover:bg-[#0d4a85]"
              disabled={isVerifying || code.length !== 6}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Vérification...
                </>
              ) : (
                "Vérifier"
              )}
            </Button>

            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-gray-500 hover:text-gray-700 w-full text-center mt-2"
            >
              Annuler et se déconnecter
            </button>
          </form>

          <div className="mt-6 p-3 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-700">
              <strong>Aide :</strong> Ouvrez votre application d'authentification
              (Google Authenticator, Authy, etc.) et entrez le code affiché pour
              MA2F-AquaSachet.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
