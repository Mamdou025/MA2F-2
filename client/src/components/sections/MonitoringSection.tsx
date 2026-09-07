import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Shield, Package, DollarSign, Activity, CheckCircle, XCircle, Clock, Wifi, WifiOff, RefreshCw, Settings, Wrench } from "lucide-react";
import { toast } from "sonner";
import { analyzeForAlerts, DEFAULT_MONITORING_CONFIG, getPerformanceMetrics, checkRateLimit } from "@/lib/monitoring";
import type { Alert, MonitoringConfig } from "@/lib/monitoring";
import { runAllTests } from "@/lib/tests-calculs";
import { getSyncState, getSyncStats } from "@/lib/offlineSync";

export default function MonitoringSection() {
  const { DB } = useApp();
  const [tab, setTab] = useState("alertes");
  const [config, setConfig] = useState<MonitoringConfig>(DEFAULT_MONITORING_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());

  // Analyser les alertes
  const alerts = useMemo(() => analyzeForAlerts(DB, config), [DB, config]);
  const activeAlerts = alerts.filter((a) => !acknowledgedAlerts.has(a.id));
  const criticalCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const warningCount = activeAlerts.filter((a) => a.severity === "warning").length;

  // Tests d'intégrité
  const testResults = useMemo(() => runAllTests(DB), [DB]);
  const passCount = testResults.filter((t) => t.status === "pass").length;
  const failCount = testResults.filter((t) => t.status === "fail").length;

  // Métriques performance
  const perfMetrics = getPerformanceMetrics(5);

  // Sync state
  const syncState = getSyncState();
  const syncStats = getSyncStats();

  const acknowledgeAlert = (alertId: string) => {
    setAcknowledgedAlerts((prev) => { const next = new Set(Array.from(prev)); next.add(alertId); return next; });
    toast.success("Alerte acquittée");
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-100 text-red-800 border-red-200";
      case "warning": return "bg-amber-100 text-amber-800 border-amber-200";
      default: return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical": return <XCircle className="w-5 h-5 text-red-600" />;
      case "warning": return <AlertTriangle className="w-5 h-5 text-amber-600" />;
      default: return <Activity className="w-5 h-5 text-blue-600" />;
    }
  };

  const categoryIcon = (category: string) => {
    switch (category) {
      case "security": return <Shield className="w-4 h-4" />;
      case "finance": return <DollarSign className="w-4 h-4" />;
      case "stock": return <Package className="w-4 h-4" />;
      case "maintenance": return <Wrench className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* En-tête avec KPI */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Monitoring & Alertes</h2>
          <p className="text-sm text-gray-500 mt-1">Surveillance en temps réel de l'application</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowConfig(true)}>
          <Settings className="w-4 h-4 mr-2" /> Configuration
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className={criticalCount > 0 ? "border-red-300 bg-red-50" : ""}>
          <CardContent className="p-4 text-center">
            <XCircle className={`w-6 h-6 mx-auto mb-1 ${criticalCount > 0 ? "text-red-600" : "text-gray-400"}`} />
            <div className="text-2xl font-bold">{criticalCount}</div>
            <div className="text-xs text-gray-500">Critiques</div>
          </CardContent>
        </Card>
        <Card className={warningCount > 0 ? "border-amber-300 bg-amber-50" : ""}>
          <CardContent className="p-4 text-center">
            <AlertTriangle className={`w-6 h-6 mx-auto mb-1 ${warningCount > 0 ? "text-amber-600" : "text-gray-400"}`} />
            <div className="text-2xl font-bold">{warningCount}</div>
            <div className="text-xs text-gray-500">Avertissements</div>
          </CardContent>
        </Card>
        <Card className={failCount > 0 ? "border-red-300 bg-red-50" : ""}>
          <CardContent className="p-4 text-center">
            <Activity className={`w-6 h-6 mx-auto mb-1 ${failCount > 0 ? "text-red-600" : "text-green-600"}`} />
            <div className="text-2xl font-bold">{passCount}/{testResults.length}</div>
            <div className="text-xs text-gray-500">Tests OK</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            {syncState.status === "online" ? (
              <Wifi className="w-6 h-6 mx-auto mb-1 text-green-600" />
            ) : (
              <WifiOff className="w-6 h-6 mx-auto mb-1 text-red-600" />
            )}
            <div className="text-2xl font-bold">{syncStats.pendingCount}</div>
            <div className="text-xs text-gray-500">En attente sync</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="w-6 h-6 mx-auto mb-1 text-blue-600" />
            <div className="text-2xl font-bold">{perfMetrics.avgDuration.toFixed(0)}ms</div>
            <div className="text-xs text-gray-500">Latence moy.</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="alertes">
            Alertes {activeAlerts.length > 0 && <Badge variant="destructive" className="ml-1 text-xs">{activeAlerts.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="perf">Performance</TabsTrigger>
        </TabsList>

        {/* Alertes */}
        <TabsContent value="alertes" className="space-y-3 mt-4">
          {activeAlerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
                <p className="text-lg font-medium text-gray-700">Aucune alerte active</p>
                <p className="text-sm text-gray-500 mt-1">Tous les indicateurs sont normaux</p>
              </CardContent>
            </Card>
          ) : (
            activeAlerts.map((alert) => (
              <Card key={alert.id} className={`border ${severityColor(alert.severity)}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {severityIcon(alert.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {categoryIcon(alert.category)}
                        <span className="font-semibold text-sm">{alert.title}</span>
                        <Badge variant="outline" className="text-xs">{alert.category}</Badge>
                      </div>
                      <p className="text-sm text-gray-700">{alert.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{new Date(alert.timestamp).toLocaleString("fr-FR")}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => acknowledgeAlert(alert.id)}>
                      Acquitter
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Tests d'intégrité */}
        <TabsContent value="tests" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Statut</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Test</TableHead>
                    <TableHead>Attendu</TableHead>
                    <TableHead>Actuel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testResults.map((test) => (
                    <TableRow key={test.id}>
                      <TableCell>
                        {test.status === "pass" && <Badge className="bg-green-100 text-green-800">OK</Badge>}
                        {test.status === "fail" && <Badge className="bg-red-100 text-red-800">ÉCHEC</Badge>}
                        {test.status === "warning" && <Badge className="bg-amber-100 text-amber-800">ATTENTION</Badge>}
                      </TableCell>
                      <TableCell className="font-medium">{test.category}</TableCell>
                      <TableCell>{test.name}</TableCell>
                      <TableCell className="text-xs text-gray-500">{test.expected}</TableCell>
                      <TableCell className="text-xs font-mono">{test.actual}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Synchronisation */}
        <TabsContent value="sync" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {syncState.status === "online" ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5 text-red-600" />}
                  <span className="font-semibold">Connectivité</span>
                </div>
                <Badge className={syncState.status === "online" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                  {syncState.status === "online" ? "En ligne" : "Hors ligne"}
                </Badge>
                {syncState.lastSyncAt && (
                  <p className="text-xs text-gray-500 mt-2">
                    Dernière sync: {new Date(syncState.lastSyncAt).toLocaleString("fr-FR")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <RefreshCw className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold">File d'attente</span>
                </div>
                <div className="text-2xl font-bold">{syncStats.pendingCount}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {syncStats.byType.create} créations, {syncStats.byType.update} mises à jour, {syncStats.byType.delete} suppressions
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-5 h-5 text-red-600" />
                  <span className="font-semibold">Échecs</span>
                </div>
                <div className="text-2xl font-bold">{syncStats.failedCount}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Opérations ayant échoué après {5} tentatives
                </div>
              </CardContent>
            </Card>
          </div>

          {syncStats.pendingCount > 0 && (
            <Card>
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2">Opérations en attente par collection</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(syncStats.byCollection).map(([col, count]) => (
                    <Badge key={col} variant="outline">{col}: {count}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Performance */}
        <TabsContent value="perf" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{perfMetrics.avgDuration.toFixed(0)}ms</div>
                <div className="text-xs text-gray-500">Latence moyenne</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{perfMetrics.maxDuration.toFixed(0)}ms</div>
                <div className="text-xs text-gray-500">Latence max</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{perfMetrics.errorRate.toFixed(1)}%</div>
                <div className="text-xs text-gray-500">Taux d'erreur</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{perfMetrics.totalOps}</div>
                <div className="text-xs text-gray-500">Opérations (5 min)</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold mb-2">Rate Limiting</h4>
              <p className="text-sm text-gray-600">
                Maximum {config.maxOperationsParMinute} opérations par minute par utilisateur.
                Les opérations excédentaires seront mises en file d'attente.
              </p>
              <div className="mt-3">
                <Badge className="bg-green-100 text-green-800">
                  Actif — {config.maxOperationsParMinute} ops/min
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Configuration */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configuration du monitoring</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-gray-700">Seuils financiers</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Écart caisse max (F)</Label>
                  <Input
                    type="number"
                    value={config.seuilEcartCaisse}
                    onChange={(e) => setConfig({ ...config, seuilEcartCaisse: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Vente anormale (F)</Label>
                  <Input
                    type="number"
                    value={config.seuilVenteAnormale}
                    onChange={(e) => setConfig({ ...config, seuilVenteAnormale: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-gray-700">Seuils stock</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Stock PF minimum (packs)</Label>
                  <Input
                    type="number"
                    value={config.seuilStockBas}
                    onChange={(e) => setConfig({ ...config, seuilStockBas: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Stock MP minimum (kg)</Label>
                  <Input
                    type="number"
                    value={config.seuilStockMPBas}
                    onChange={(e) => setConfig({ ...config, seuilStockMPBas: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Écart contrôle physique toléré (packs)</Label>
                  <Input
                    type="number"
                    value={config.seuilEcartStockPacks}
                    onChange={(e) => setConfig({ ...config, seuilEcartStockPacks: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Écart contrôle physique toléré (kg MP)</Label>
                  <Input
                    type="number"
                    value={config.seuilEcartStockKg}
                    onChange={(e) => setConfig({ ...config, seuilEcartStockKg: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-gray-700">Maintenance</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Alerte membrane (jours avant échéance)</Label>
                  <Input
                    type="number"
                    value={config.seuilJoursAvantEcheanceMembrane}
                    onChange={(e) => setConfig({ ...config, seuilJoursAvantEcheanceMembrane: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-gray-700">Sécurité</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Max tentatives connexion</Label>
                  <Input
                    type="number"
                    value={config.maxTentativesConnexion}
                    onChange={(e) => setConfig({ ...config, maxTentativesConnexion: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Rate limit (ops/min)</Label>
                  <Input
                    type="number"
                    value={config.maxOperationsParMinute}
                    onChange={(e) => setConfig({ ...config, maxOperationsParMinute: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowConfig(false)}>Fermer</Button>
            <Button onClick={() => { setShowConfig(false); toast.success("Configuration mise à jour"); }}>
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
