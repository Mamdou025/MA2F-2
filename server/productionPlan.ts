/** Trusted-server preparation only. Does not create an Odoo or Firebase movement. */
export type ProductionSettings = { sourceSha256: string; packsPerKg: string };

export function prepareProduction(body: unknown, settings: ProductionSettings) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_production");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "netPacks,requestId" ||
      typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
      !Number.isSafeInteger(input.netPacks) || Number(input.netPacks) <= 0 ||
      !Number.isSafeInteger(Number(input.netPacks) * 30)) throw new Error("invalid_production");
  if (!/^[0-9a-f]{64}$/.test(settings.sourceSha256) ||
      !/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/.test(settings.packsPerKg)) throw new Error("unverified_production_settings");
  const [whole, fraction = ""] = settings.packsPerKg.split(".");
  const scale = BigInt("1" + "0".repeat(fraction.length));
  const rate = BigInt(whole) * scale + BigInt(fraction || "0");
  if (rate === BigInt(0)) throw new Error("unverified_production_settings");
  // Retain the exact source fraction. Odoo's configured kg rounding must be
  // checked separately; this is not a measured amount or a rounded stock move.
  const numerator = BigInt(Number(input.netPacks)) * scale;
  return {
    requestId: input.requestId.toLowerCase(), netPacks: Number(input.netPacks),
    saleableSachets: Number(input.netPacks) * 30,
    consumption: { method: "estimated_from_source_yield" as const,
      packsPerKg: settings.packsPerKg, sourceSha256: settings.sourceSha256,
      kgNumerator: numerator.toString(), kgDenominator: rate.toString() },
    businessWritesEnabled: false as const,
  };
}
