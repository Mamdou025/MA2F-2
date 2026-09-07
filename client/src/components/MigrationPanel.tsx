/**
 * MigrationPanel — Panneau de migration vers l'architecture Phase 2
 * 
 * Permet à l'administrateur de migrer les données de l'ancien format
 * (document unique avec arrays) vers le nouveau format (1 document = 1 entité).
 */

import { useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { migrateFromLegacy } from "@/lib/firestoreService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function MigrationPanel() {
  const { DB, currentUser } = useApp();
  const [isMigrating, setIsMigrating] = useState(false);
  const [result, setResult] = useState<{
    migrated: string[];
    skipped: string[];
    errors: string[];
  } | null>(null);

  const handleMigrate = async () => {
    if (!currentUser || currentUser.role !== "admin") {
      toast.error("Seul un administrateur peut lancer la migration");
      return;
    }

    const confirmed = window.confirm(
      "Voulez-vous migrer vers la nouvelle architecture ?\n\n" +
      "Cette opération :\n" +
      "• Convertit chaque entité en document Firestore individuel\n" +
      "• Active les transactions atomiques\n" +
      "• Active le verrouillage optimiste\n\n" +
      "Chaque entrée est recopiée dans son propre document (rien n'est perdu), " +
      "puis l'ancien document groupé est supprimé pour éviter toute confusion.\n" +
      "La migration est idempotente (peut être relancée sans risque)."
    );

    if (!confirmed) return;

    setIsMigrating(true);
    try {
      const migrationResult = await migrateFromLegacy(
        DB as any,
        currentUser.nom
      );
      setResult(migrationResult);

      if (migrationResult.errors.length === 0) {
        toast.success(
          `Migration réussie ! ${migrationResult.migrated.length} collections migrées.`
        );
      } else {
        toast.error(
          `Migration partielle : ${migrationResult.errors.length} erreur(s)`
        );
      }
    } catch (e: any) {
      toast.error(`Erreur migration : ${e.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardHeader>
        <CardTitle className="text-amber-800 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Migration Architecture Phase 2
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-amber-700 space-y-2">
          <p>
            <strong>Objectif :</strong> Migrer de l'ancien format (1 document = toutes les données)
            vers le nouveau format professionnel (1 document = 1 entité).
          </p>
          <p><strong>Avantages :</strong></p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li>Transactions atomiques (tout ou rien)</li>
            <li>Verrouillage optimiste (détection des conflits)</li>
            <li>Pas de limite 1 Mo par collection</li>
            <li>Pagination native Firestore</li>
            <li>Timestamps serveur non manipulables</li>
          </ul>
        </div>

        <Button
          onClick={handleMigrate}
          disabled={isMigrating}
          className="w-full bg-amber-600 hover:bg-amber-700"
        >
          {isMigrating ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Migration en cours...
            </span>
          ) : (
            "Lancer la migration"
          )}
        </Button>

        {result && (
          <div className="mt-4 space-y-2 text-sm">
            {result.migrated.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded p-2">
                <p className="font-medium text-green-800">Migrées ({result.migrated.length}) :</p>
                <ul className="text-green-700 ml-2">
                  {result.migrated.map((m, i) => (
                    <li key={i}>✓ {m}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded p-2">
                <p className="font-medium text-gray-700">Ignorées ({result.skipped.length}) :</p>
                <ul className="text-gray-600 ml-2">
                  {result.skipped.map((s, i) => (
                    <li key={i}>— {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-2">
                <p className="font-medium text-red-800">Erreurs ({result.errors.length}) :</p>
                <ul className="text-red-700 ml-2">
                  {result.errors.map((e, i) => (
                    <li key={i}>✗ {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
