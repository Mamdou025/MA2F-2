import { ClerkProvider, Show, SignIn, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole, ShieldX } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const verificationPath = `${basePath}/clerk-verification`;
const signInPath = `${basePath}/clerk-sign-in`;
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: verificationPath,
    logoImageUrl: `${window.location.origin}${basePath}/ma2f-clerk-logo.svg`,
  },
  variables: {
    colorPrimary: "#1b4b6b",
    colorForeground: "#1f2937",
    colorMutedForeground: "#64748b",
    colorDanger: "#b91c1c",
    colorBackground: "#ffffff",
    colorInput: "#f8fafc",
    colorInputForeground: "#1f2937",
    colorNeutral: "#cbd5e1",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden border border-slate-200 shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-900",
    headerSubtitle: "text-slate-600",
    socialButtonsBlockButtonText: "text-slate-800",
    formFieldLabel: "text-slate-800",
    footerActionLink: "text-[#1b4b6b] font-semibold",
    footerActionText: "text-slate-600",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-[#1b4b6b]",
    formFieldSuccessText: "text-emerald-700",
    alertText: "text-red-800",
    logoBox: "h-14",
    logoImage: "max-h-12",
    socialButtonsBlockButton: "border-slate-300",
    formButtonPrimary: "bg-[#1b4b6b] hover:bg-[#143a53]",
    formFieldInput: "border-slate-300 bg-slate-50 text-slate-900",
    footerAction: "bg-slate-50",
    dividerLine: "bg-slate-200",
    alert: "bg-red-50 border-red-200",
    otpCodeFieldInput: "border-slate-300",
    formFieldRow: "text-slate-900",
    main: "gap-5",
  },
};

function VerificationStatus() {
  const { signOut } = useClerk();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-center gap-3">
          <img src={`${basePath}/ma2f-clerk-logo.svg`} alt="MA2F" className="h-14" />
        </div>

        <Show when="signed-out">
          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <LockKeyhole className="mb-4 h-10 w-10 text-[#1b4b6b]" />
            <h1 className="text-2xl font-bold text-slate-900">
              Vérification Clerk MA2F
            </h1>
            <p className="mt-3 text-slate-600">
              Cette page séparée vérifie uniquement la nouvelle authentification.
              La connexion métier MA2F actuelle reste gérée par Firebase.
            </p>
            <a
              href={signInPath}
              className="mt-6 inline-flex rounded-lg bg-[#1b4b6b] px-5 py-3 font-semibold text-white hover:bg-[#143a53]"
            >
              Tester la connexion Clerk
            </a>
            <a href={basePath || "/"} className="ml-4 text-sm text-slate-600 underline">
              Retour à MA2F
            </a>
          </section>
        </Show>

        <Show when="signed-in">
          <ServerVerifiedStatus signOut={signOut} />
        </Show>
      </div>
    </main>
  );
}

type VerificationResponse =
  | {
      authenticated: true;
      mapped?: boolean;
      profile?: { id: string; nom: string; role: string; roles: string[] };
      businessAccess: false;
      roles: [];
      directOdooAccess: false;
    }
  | {
      authenticated: false;
      error: string;
    };

function ServerVerifiedStatus({
  signOut,
}: {
  signOut: ReturnType<typeof useClerk>["signOut"];
}) {
  const [result, setResult] = useState<VerificationResponse | null>(null);

  useEffect(() => {
    let active = true;

    fetch(`${basePath}/api/clerk-verification`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json()) as VerificationResponse;
        if (!response.ok) throw new Error("La vérification serveur a échoué.");
        return body;
      })
      .then((body) => {
        if (active) setResult(body);
      })
      .catch(() => {
        if (active) {
          setResult({ authenticated: false, error: "Unauthorized" });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (!result) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Loader2 className="mb-4 h-10 w-10 animate-spin text-[#1b4b6b]" />
        <h1 className="text-xl font-bold text-slate-900">
          Vérification serveur en cours
        </h1>
      </section>
    );
  }

  const verified =
    result.authenticated &&
    result.businessAccess === false &&
    result.roles.length === 0 &&
    result.directOdooAccess === false;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      {verified ? (
        <CheckCircle2 className="mb-4 h-10 w-10 text-emerald-600" />
      ) : (
        <ShieldX className="mb-4 h-10 w-10 text-red-700" />
      )}
      <h1 className="text-2xl font-bold text-slate-900">
        {verified
          ? "Authentification Clerk vérifiée par le serveur"
          : "Authentification Clerk non vérifiée"}
      </h1>
      <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <ShieldX className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          {result.authenticated && result.mapped && result.profile
            ? "Profil MA2F reconnu : " + result.profile.nom + " — rôles conservés : " + result.profile.roles.join(", ") + ". Accès métier en attente de bascule."
            : "Aucun profil MA2F actif et vérifié n’est reconnu pour cette session."}
          {" Aucun accès aux données métier ni accès direct à Odoo n’est activé."}
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: verificationPath })}
          className="rounded-lg border border-slate-300 px-5 py-3 font-semibold text-slate-800 hover:bg-slate-50"
        >
          Se déconnecter de Clerk
        </button>
        <a
          href={basePath || "/"}
          className="rounded-lg bg-[#1b4b6b] px-5 py-3 font-semibold text-white hover:bg-[#143a53]"
        >
          Retour à la connexion Firebase
        </a>
      </div>
    </section>
  );
}

function ClerkSignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <SignIn
        routing="path"
        path={signInPath}
        forceRedirectUrl={verificationPath}
        fallbackRedirectUrl={verificationPath}
      />
    </main>
  );
}

export default function ClerkVerificationApp() {
  const isSignInRoute = window.location.pathname.startsWith(signInPath);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={signInPath}
      localization={{
        signIn: {
          start: {
            title: "Vérification de connexion",
            subtitle: "Connectez-vous au nouvel espace d’identité MA2F",
          },
        },
      }}
    >
      {isSignInRoute ? <ClerkSignInPage /> : <VerificationStatus />}
    </ClerkProvider>
  );
}