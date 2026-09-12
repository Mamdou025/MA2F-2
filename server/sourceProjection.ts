/** Reproduce the current MA2F reader's sources without repairing business records. */
export const entitySources = {
  ventes: 'ventes', clients: 'clients', production: 'production', depenses: 'depenses',
  recouvrements: 'recouvrements', livraisons: 'livraisons', emballages: 'emballages',
  versements: 'versements', apports: 'apports', mouvementsStock: 'mouvements_stock',
  journal: 'journal', history: 'history', notifications: 'notifications',
  reconciliations: 'reconciliations', corbeille: 'corbeille', stockControles: 'stock_controles',
} as const;
export const metadataSources = ['commerciaux', 'livreurs', 'producteurs', 'avances', 'employes',
  'maintenance', 'vehicules', 'commandes', 'vehiculeOps', 'users', 'approvals', 'auditChain',
  'actionnaires', 'mouvementsActionnaires'] as const;

export function decodeSourceValue(value: any): any {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1) throw new Error('INVALID_SOURCE_VALUE');
  const [kind, data] = Object.entries(value)[0];
  switch (kind) {
    case 'nullValue': return null;
    case 'booleanValue': if (typeof data === 'boolean') return data; break;
    case 'stringValue': case 'timestampValue': if (typeof data === 'string') return data; break;
    case 'integerValue': {
      if (typeof data !== 'string' || !/^-?\d+$/.test(data)) break;
      const n = Number(data);
      if (!Number.isSafeInteger(n)) throw new Error('UNSAFE_SOURCE_INTEGER');
      return n;
    }
    case 'doubleValue': if (typeof data === 'number' && Number.isFinite(data)) return data; break;
    case 'arrayValue': {
      const values = (data as any)?.values ?? [];
      if (!Array.isArray(values)) break;
      return values.map(decodeSourceValue);
    }
    case 'mapValue': return decodeSourceFields((data as any)?.fields ?? {});
    // Retain the typed archive; unsupported application values require an explicit mapping.
  }
  throw new Error('UNSUPPORTED_SOURCE_VALUE_' + kind);
}
export function decodeSourceFields(fields: any): Record<string, any> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('INVALID_SOURCE_FIELDS');
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeSourceValue(value)]));
}

export function projectSourceSnapshot(source: any, archiveSha256: string) {
  if (source?.project !== 'ma2f-aquasachet' || !Array.isArray(source.documents) ||
      !Number.isFinite(Date.parse(source.readTime)) || !/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error('INVALID_SOURCE_SNAPSHOT');
  const prefix = 'projects/ma2f-aquasachet/databases/(default)/documents/';
  const documents = new Map<string, any>();
  for (const doc of source.documents) {
    if (typeof doc.name !== 'string' || !doc.name.startsWith(prefix)) throw new Error('WRONG_SOURCE_PROJECT');
    const path = doc.name.slice(prefix.length);
    if (!path || path.split('/').length % 2 || documents.has(path)) throw new Error('INVALID_SOURCE_PATH');
    documents.set(path, doc);
  }
  const state: Record<string, any> = {};
  const provenance: Record<string, any> = {};
  const used = new Set<string>();
  for (const [field, collection] of Object.entries(entitySources)) {
    const paths = Array.from(documents.keys()).filter(p => p.startsWith(collection + '/') && p.split('/').length === 2).sort();
    const legacyPath = collection + '/data';
    if (documents.has(legacyPath)) {
      const data = decodeSourceFields(documents.get(legacyPath).fields || {});
      if (!Array.isArray(data.items)) throw new Error('INVALID_LEGACY_ARRAY_' + collection);
      state[field] = data.items;
      used.add(legacyPath);
      provenance[field] = { mode: 'legacy-array', paths: [legacyPath], shadowedDocuments: paths.length - 1 };
    } else {
      state[field] = paths.map(path => {
        used.add(path);
        // Same precedence as AppContext: the stored id overrides the document id.
        return { id: path.split('/')[1], ...decodeSourceFields(documents.get(path).fields || {}) };
      });
      provenance[field] = { mode: 'entities', paths };
    }
  }
  const meta = documents.has('meta/data') ? decodeSourceFields(documents.get('meta/data').fields || {}) : {};
  if (documents.has('meta/data')) used.add('meta/data');
  for (const field of metadataSources) {
    const present = Object.hasOwn(meta, field);
    if (present && !Array.isArray(meta[field])) throw new Error('INVALID_META_ARRAY_' + field);
    state[field] = present ? meta[field] : [];
    provenance[field] = { mode: 'metadata', path: 'meta/data', fieldPresent: present };
  }
  const global = documents.has('params/global') ? decodeSourceFields(documents.get('params/global').fields || {}) : {};
  if (documents.has('params/global')) used.add('params/global');
  if (meta.params !== undefined && (!meta.params || typeof meta.params !== 'object' || Array.isArray(meta.params))) throw new Error('INVALID_META_PARAMS');
  const globalParams = Object.fromEntries(Object.entries(global).filter(([key]) => !key.startsWith('_')));
  state.params = { ...(meta.params || {}), ...globalParams };
  provenance.params = { mode: 'merged-params', priority: ['meta/data.params', 'params/global'],
    differingKeys: Object.keys(globalParams).filter(key => Object.hasOwn(meta.params || {}, key) && JSON.stringify(meta.params[key]) !== JSON.stringify(globalParams[key])) };
  const backups = Array.from(documents.keys()).filter(p => p.startsWith('backups/') && p.split('/').length === 2 && p !== 'backups/data').sort();
  state.backups = backups.map(path => { used.add(path); return { id: path.split('/')[1], ...decodeSourceFields(documents.get(path).fields || {}) }; });
  provenance.backups = { mode: 'entities', paths: backups };
  return { archiveSha256, readTime: source.readTime, state, provenance,
    archivedOnlyPaths: Array.from(documents.keys()).filter(path => !used.has(path)).sort(),
    operationalCutover: false as const };
}
