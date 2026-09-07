import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, Copy, CheckCircle2, Loader2 } from "lucide-react";
import { generateTOTPSecret, generateOTPAuthURL, verifyTOTP } from "@/lib/twoFactor";
import { toast } from "sonner";

interface TwoFactorSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  onComplete: (secret: string) => void;
}

export default function TwoFactorSetup({
  open,
  onOpenChange,
  userEmail,
  onComplete,
}: TwoFactorSetupProps) {
  const [secret, setSecret] = useState("");
  const [otpAuthURL, setOtpAuthURL] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [step, setStep] = useState<"setup" | "verify">("setup");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      const newSecret = generateTOTPSecret();
      setSecret(newSecret);
      setOtpAuthURL(generateOTPAuthURL(newSecret, userEmail));
      setStep("setup");
      setVerificationCode("");
    }
  }, [open, userEmail]);

  const handleCopySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success("Secret copié dans le presse-papier");
    setTimeout(() => setCopied(false), 3000);
  };

  const handleVerify = async () => {
    if (verificationCode.length !== 6) {
      toast.error("Le code doit contenir 6 chiffres");
      return;
    }

    setIsVerifying(true);
    try {
      const valid = await verifyTOTP(secret, verificationCode);
      if (valid) {
        onComplete(secret);
        onOpenChange(false);
        toast.success("Double authentification activée avec succès !");
      } else {
        toast.error("Code incorrect. Vérifiez votre application d'authentification.");
        setVerificationCode("");
      }
    } catch {
      toast.error("Erreur de vérification");
    } finally {
      setIsVerifying(false);
    }
  };

  // Générer le QR code via une API publique (Google Charts)
  const qrCodeURL = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpAuthURL)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
            Activer la double authentification
          </DialogTitle>
        </DialogHeader>

        {step === "setup" ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Scannez ce QR code avec votre application d'authentification
              (Google Authenticator, Authy, Microsoft Authenticator, etc.)
            </p>

            <div className="flex justify-center p-4 bg-white rounded-lg border">
              <img
                src={qrCodeURL}
                alt="QR Code 2FA"
                className="w-48 h-48"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                Si vous ne pouvez pas scanner le QR code, entrez ce secret manuellement :
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-gray-100 rounded text-xs font-mono break-all">
                  {secret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopySecret}
                >
                  {copied ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <Button
              className="w-full bg-[#1B4B6B] hover:bg-[#0d4a85]"
              onClick={() => setStep("verify")}
            >
              J'ai scanné le QR code → Vérifier
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Entrez le code à 6 chiffres affiché dans votre application pour confirmer l'activation.
            </p>

            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={verificationCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setVerificationCode(val);
              }}
              className="text-center text-2xl tracking-[0.5em] font-mono"
              autoComplete="one-time-code"
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep("setup")}
              >
                Retour
              </Button>
              <Button
                className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]"
                onClick={handleVerify}
                disabled={isVerifying || verificationCode.length !== 6}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Vérification...
                  </>
                ) : (
                  "Activer la 2FA"
                )}
              </Button>
            </div>
          </div>
        )}

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3">
            <p className="text-xs text-amber-800">
              <strong>Important :</strong> Conservez le secret en lieu sûr. Si vous perdez
              l'accès à votre application d'authentification, seul un administrateur pourra
              désactiver la 2FA sur votre compte.
            </p>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
