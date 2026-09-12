import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSourceSnapshot, decodeSourceValue } from '../server/sourceProjection.ts';
const doc = (path, fields) => ({ name: 'projects/ma2f-aquasachet/databases/(default)/documents/' + path, fields });
const source = documents => ({ project: 'ma2f-aquasachet', readTime: '2026-09-09T22:26:33Z', documents });
const sha = 'a'.repeat(64);

test('explicitly empty orders never restore archived root orders; archive input is unchanged', () => {
  const input = source([doc('meta/data', { commandes: { arrayValue: {} } }),
    doc('commandes/old', { id: { stringValue: 'old' } })]);
  const original = structuredClone(input);
  const result = projectSourceSnapshot(input, sha);
  assert.deepEqual(result.state.commandes, []);
  assert.equal(result.provenance.commandes.fieldPresent, true);
  assert.deepEqual(result.archivedOnlyPaths, ['commandes/old']);
  assert.deepEqual(input, original);
  const missing = projectSourceSnapshot(source(input.documents.slice(1)), sha);
  assert.deepEqual(missing.state.commandes, []);
  assert.equal(missing.provenance.commandes.fieldPresent, false);
});

test('legacy arrays, stored ids and params follow the current reader without rewriting anomalies', () => {
  const result = projectSourceSnapshot(source([
    doc('clients/data', { items: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'legacy' } } } }] } } }),
    doc('clients/shadow', { id: { stringValue: 'shadow' } }),
    doc('ventes/document-id', { id: { stringValue: 'stored-id' }, packs: { integerValue: '-2' } }),
    doc('meta/data', { params: { mapValue: { fields: { tauxSachetsParKg: { integerValue: '17' }, custom: { booleanValue: true } } } } }),
    doc('params/global', { tauxSachetsParKg: { integerValue: '17' }, soldeOuverture: { integerValue: '297023' }, _updatedBy: { stringValue: 'source' } }),
  ]), sha);
  assert.deepEqual(result.state.clients, [{ id: 'legacy' }]);
  assert.deepEqual(result.state.ventes, [{ id: 'stored-id', packs: -2 }]);
  assert.deepEqual(result.state.params, { tauxSachetsParKg: 17, custom: true, soldeOuverture: 297023 });
  assert.deepEqual(result.archivedOnlyPaths, ['clients/shadow']);
  assert.equal(result.operationalCutover, false);
});

test('invalid or lossy mappings are rejected, rather than normalized silently', () => {
  assert.throws(() => decodeSourceValue({ integerValue: '9007199254740993' }), /UNSAFE/);
  assert.throws(() => decodeSourceValue({ referenceValue: 'private/ref' }), /UNSUPPORTED/);
  assert.throws(() => projectSourceSnapshot(source([doc('meta/data', { commandes: { stringValue: 'bad' } })]), sha), /INVALID_META_ARRAY/);
  assert.throws(() => projectSourceSnapshot(source([doc('clients/a', {}), doc('clients/a', {})]), sha), /INVALID_SOURCE_PATH/);
  assert.throws(() => projectSourceSnapshot(source([doc('clients/data', {})]), sha), /INVALID_LEGACY_ARRAY/);
});
