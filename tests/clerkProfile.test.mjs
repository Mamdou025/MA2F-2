import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClerkProfile } from '../server/clerkProfile.ts';

function fixture() {
  return {
    id: 'user_test', externalId: 'firebase:ma2f-aquasachet:firebase_test',
    banned: false, locked: false, primaryEmailAddressId: 'email_test',
    emailAddresses: [{ id: 'email_test', emailAddress: 'test@example.invalid', verification: { status: 'verified' } }],
    privateMetadata: { ma2fMigration: {
      version: 1, project: 'ma2f-aquasachet', firebaseUid: 'firebase_test', sourceSha256: 'a'.repeat(64),
      activationAllowed: false, directOdooAccess: false,
      profile: { id: 'business_test', nom: 'Test', login: 'test', email: 'test@example.invalid', actif: true,
        role: 'caissier', roles: ['caissier', 'commercial'], allowedSections: ['caisse', 'ventes'], permissions: {} },
    } },
  };
}

test('mapped profile preserves sections without activating business access', () => {
  const r = resolveClerkProfile('user_test', fixture());
  assert.equal(r.mapped, true);
  assert.deepEqual(r.profile.allowedSections, ['caisse', 'ventes']);
  assert.equal(r.businessAccess, false);
  assert.deepEqual(r.roles, []);
  assert.equal(r.directOdooAccess, false);
});

for (const [name, change] of [
  ['different session user', u => u.id = 'user_other'],
  ['banned account', u => u.banned = true],
  ['locked account', u => u.locked = true],
  ['wrong external identity', u => u.externalId = 'firebase:other'],
  ['unmapped user', u => u.privateMetadata = {}],
  ['disabled historical profile', u => u.privateMetadata.ma2fMigration.profile.actif = false],
  ['unverified email', u => u.emailAddresses[0].verification.status = 'unverified'],
  ['different primary email', u => u.primaryEmailAddressId = 'other'],
  ['unknown role', u => u.privateMetadata.ma2fMigration.profile.roles = ['superuser']],
  ['empty custom section list', u => u.privateMetadata.ma2fMigration.profile.allowedSections = []],
  ['unreviewed actions', u => u.privateMetadata.ma2fMigration.profile.permissions = { caisse: ['delete'] }],
  ['activation flag cannot bypass migration gate', u => u.privateMetadata.ma2fMigration.activationAllowed = true],
]) test(name, () => {
  const u = fixture(); change(u);
  const r = resolveClerkProfile('user_test', u);
  assert.equal(r.mapped, false);
  assert.equal(r.businessAccess, false);
  assert.equal(r.directOdooAccess, false);
  assert.equal(r.profile, undefined);
});

test('public/client metadata cannot supply an identity mapping', () => {
  const u = fixture();
  u.publicMetadata = u.privateMetadata;
  u.unsafeMetadata = u.privateMetadata;
  u.privateMetadata = {};
  assert.equal(resolveClerkProfile('user_test', u).mapped, false);
});
