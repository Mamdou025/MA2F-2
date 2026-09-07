import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import {
  getMoisCourant,
  moisLabel,
  premierMoisAvecDonnees,
  packsVenteMois,
  packsLivreurMois,
  palierAtteint,
  primeMontant,
  getPaliersCommercial,
  getPaliersLivreur,
  fmt,
  fmtNumber,
} from "@/lib/helpers";
import type { PalierPrime } from "@/lib/types";
import { MonthSelector } from "@/components/MonthSelector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Trophy, Trash2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

// Rubrique "Objectifs & primes" : classement des commerciaux et livreurs sur
// le mois consulté, palier de prime atteint (grille configurable ci-dessous
// par un admin) et prime estimée. Voir "Plan de motivation — Livreurs &
// Commerciaux" (document remis à l'utilisateur, août 2026) pour le
// raisonnement métier derrière cette grille.
//
// Limite connue : la ponctualité et le taux de casse recommandés dans le plan
// ne sont pas trackés aujourd'hui dans le modèle de données (pas de créneau
// horaire ni d'incident par livraison) — les paliers livreurs se basent donc
// uniquement sur le volume livré vs objectif, comme le fait déjà
// LivreursSection.tsx pour l'indicateur "Atteinte". Si ces métriques sont
// ajoutées un jour à Vente/Livraison, cette grille pourra être étendue.

interface Row {
  id: string;
  nom: string;
  objectif: number;
  realise: number;
  pct: number;
  palier: PalierPrime | null;
  prime: number;
}

function buildRows(
  personnes: { id: string; nom: string; objectif?: number }[],
  realiseFn: (nom: string) => number,
  paliers: PalierPrime[]
): Row[] {
  return personnes
    .map((p) => {
      const objectif = Number(p.objectif) || 0;
      const realise = realiseFn(p.nom);
      const pct = objectif > 0 ? Math.round((realise / objectif) * 100) : 0;
      const palier = objectif > 0 ? palierAtteint(pct, paliers) : null;
      const prime = objectif > 0 ? primeMontant(pct, paliers) : 0;
      return { id: p.id, nom: p.nom, objectif, realise, pct, palier, prime };
    })
    .sort((a, b) => b.pct - a.pct);
}

function palierBadge(palier: PalierPrime | null) {
  if (!palier) return <Badge variant="outline" className="text-gray-400">Aucun palier</Badge>;
  return (
    <Badge className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
      {palier.label} ({palier.seuilPct}%+)
    </Badge>
  );
}

function RankTable({ title, rows, unite }: { title: string; rows: Row[]; unite: string }) {
  const totalPrimes = rows.reduce((s, r) => s + r.prime, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{title}</span>
          <span className="text-sm font-normal text-gray-500">Primes estimées ce mois : <span className="font-bold text-green-600">{fmt(totalPrimes)}</span></span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead className="text-right">Objectif</TableHead>
                <TableHead className="text-right">Réalisé</TableHead>
                <TableHead>Atteinte</TableHead>
                <TableHead>Palier</TableHead>
                <TableHead className="text-right">Prime estimée</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length > 0 ? rows.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell className="text-gray-400">
                    {idx === 0 && r.pct > 0 ? <Trophy className="w-4 h-4 text-amber-500" /> : idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{r.nom}</TableCell>
                  <TableCell className="text-right">{r.objectif > 0 ? `${fmtNumber(r.objectif)} ${unite}` : "-"}</TableCell>
                  <TableCell className="text-right">{fmtNumber(r.realise)} {unite}</TableCell>
                  <TableCell>
                    {r.objectif > 0 ? (
                      <div className="flex items-center gap-2">
                        <Progress value={Math.min(r.pct, 100)} className="w-16 h-2" />
                        <span className={`text-xs font-bold ${r.pct >= 100 ? "text-green-600" : r.pct >= 80 ? "text-blue-600" : "text-orange-600"}`}>{r.pct}%</span>
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell>{r.objectif > 0 ? palierBadge(r.palier) : "-"}</TableCell>
                  <TableCell className="text-right font-bold text-green-600">{r.prime > 0 ? fmt(r.prime) : "-"}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">Aucune donnée</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function PaliersEditor({ title, paliers, onChange }: { title: string; paliers: PalierPrime[]; onChange: (p: PalierPrime[]) => void }) {
  const update = (idx: number, field: keyof PalierPrime, value: string) => {
    const next = paliers.map((p, i) => i === idx ? { ...p, [field]: field === "label" ? value : Number(value) || 0 } : p);
    onChange(next);
  };
  const remove = (idx: number) => onChange(paliers.filter((_, i) => i !== idx));
  const add = () => onChange([...paliers, { label: `Palier ${paliers.length + 1}`, seuilPct: 100, montant: 0 }]);

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {paliers.map((p, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input className="w-32" value={p.label} onChange={(e) => update(idx, "label", e.target.value)} placeholder="Label" />
          <div className="flex items-center gap-1">
            <Input type="number" className="w-20" value={p.seuilPct} onChange={(e) => update(idx, "seuilPct", e.target.value)} />
            <span className="text-xs text-gray-400">% obj.</span>
          </div>
          <div className="flex items-center gap-1">
            <Input type="number" className="w-28" value={p.montant} onChange={(e) => update(idx, "montant", e.target.value)} />
            <span className="text-xs text-gray-400">F CFA</span>
          </div>
          <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => remove(idx)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}><Plus className="w-3 h-3 mr-1" /> Ajouter un palier</Button>
    </div>
  );
}

export default function ObjectifsSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [mois, setMois] = useState(getMoisCourant());
  const minMois = useMemo(() => premierMoisAvecDonnees(DB.ventes.map((v) => v.date)), [DB.ventes]);

  const paliersCommercial = getPaliersCommercial(DB);
  const paliersLivreur = getPaliersLivreur(DB);

  const [editCommercial, setEditCommercial] = useState<PalierPrime[] | null>(null);
  const [editLivreur, setEditLivreur] = useState<PalierPrime[] | null>(null);
  const isAdmin = currentUser?.role === "admin";

  const rowsCommerciaux = useMemo(
    () => buildRows(DB.commerciaux, (nom) => packsVenteMois(DB, nom, mois), paliersCommercial),
    [DB, mois, paliersCommercial]
  );
  const rowsLivreurs = useMemo(
    () => buildRows(DB.livreurs, (nom) => packsLivreurMois(DB, nom, mois), paliersLivreur),
    [DB, mois, paliersLivreur]
  );

  const totalPrimesMois = rowsCommerciaux.reduce((s, r) => s + r.prime, 0) + rowsLivreurs.reduce((s, r) => s + r.prime, 0);

  const startEdit = () => {
    setEditCommercial(paliersCommercial.map((p) => ({ ...p })));
    setEditLivreur(paliersLivreur.map((p) => ({ ...p })));
  };

  const saveGrilles = () => {
    if (!editCommercial || !editLivreur) return;
    const updated = { ...DB, params: { ...DB.params, primesPaliers: { commercial: editCommercial, livreur: editLivreur } } };
    setDB(updated);
    saveDB(updated);
    logActivity("update", "Objectifs", "Grille de primes");
    toast.success("Grille de primes enregistrée");
    setEditCommercial(null);
    setEditLivreur(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" /> Objectifs & primes
          </h2>
          <p className="text-sm text-gray-500">Classement et primes estimées — {moisLabel(mois)}</p>
        </div>
        <MonthSelector value={mois} onChange={setMois} minMois={minMois} />
      </div>

      <Card className="bg-gradient-to-r from-[#1B4B6B] to-[#0d4a85] text-white">
        <CardContent className="py-4 flex items-center justify-between">
          <span className="text-sm opacity-90">Total primes estimées — {moisLabel(mois)}</span>
          <span className="text-2xl font-bold">{fmt(totalPrimesMois)}</span>
        </CardContent>
      </Card>

      <RankTable title="Commerciaux" rows={rowsCommerciaux} unite="packs" />
      <RankTable title="Livreurs" rows={rowsLivreurs} unite="packs" />

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grille de primes (paramétrage admin)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-gray-400">
              Un seul palier compte par personne (le plus haut atteint) — les primes ne se cumulent pas entre paliers.
              Le % est calculé sur l'objectif mensuel (packs) défini dans Commerciaux / Livreurs.
            </p>
            {editCommercial === null ? (
              <Button variant="outline" onClick={startEdit}>Modifier la grille</Button>
            ) : (
              <div className="space-y-6">
                <PaliersEditor title="Commerciaux" paliers={editCommercial} onChange={setEditCommercial} />
                <PaliersEditor title="Livreurs" paliers={editLivreur || []} onChange={setEditLivreur} />
                <div className="flex gap-2">
                  <Button onClick={saveGrilles} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Save className="w-4 h-4 mr-2" /> Enregistrer</Button>
                  <Button variant="outline" onClick={() => { setEditCommercial(null); setEditLivreur(null); }}>Annuler</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
