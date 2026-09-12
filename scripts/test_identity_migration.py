import copy
import unittest
from identity_migration import reconcile, unique_object


def fixture():
    return {"version": 1,
            "users": [{"id": "business-1", "nom": "Compte fictif", "login": "test",
                       "email": "test@example.invalid", "role": "lecteur", "roles": ["lecteur"], "actif": True}],
            "identities": [{"uid": "firebase-9", "email": "test@example.invalid", "disabled": False,
                            "claims": {"role": "lecteur", "roles": ["lecteur"]}, "mfaEnrolled": False}],
            "links": [{"appUserId": "business-1", "firebaseUid": "firebase-9", "reviewed": True}]}


class MigrationTests(unittest.TestCase):
    def codes(self, source):
        return {i["code"] for i in reconcile(source)["issues"]}

    def test_distinct_ids_preserved_without_activation(self):
        source = fixture()
        before = copy.deepcopy(source)
        result = reconcile(source)
        self.assertEqual(result["status"], "reconciled")
        self.assertFalse(result["readyForCutover"])
        account = result["accounts"][0]
        self.assertEqual(account["profile"], source["users"][0])
        self.assertEqual(account["firebaseUid"], "firebase-9")
        self.assertFalse(account["activationAllowed"])
        self.assertFalse(account["directOdooAccess"])
        self.assertIsNone(account["targetIdentity"])
        self.assertEqual(source, before)

    def test_matching_email_never_links_automatically(self):
        source = fixture(); source["links"] = []
        self.assertIn("EXPLICIT_LINK_REQUIRED", self.codes(source))

    def test_empty_sections_preserved_and_blocked(self):
        source = fixture(); source["users"][0]["allowedSections"] = []
        result = reconcile(source)
        self.assertEqual(result["accounts"][0]["profile"]["allowedSections"], [])
        self.assertIn("EMPTY_SECTIONS_SEMANTICS_REVIEW", self.codes(source))
        self.assertNotIn("allowedSections", reconcile(fixture())["accounts"][0]["profile"])

    def test_disabled_accounts_stay_disabled(self):
        source = fixture(); source["users"][0]["actif"] = False
        source["identities"][0]["disabled"] = True
        self.assertEqual(reconcile(source)["status"], "reconciled")
        self.assertFalse(reconcile(source)["accounts"][0]["profile"]["actif"])

    def test_disabled_state_disagreement_blocks(self):
        source = fixture(); source["identities"][0]["disabled"] = True
        self.assertIn("ACTIVE_STATE_MISMATCH", self.codes(source))

    def test_claim_mismatch_blocks_privilege_increase(self):
        source = fixture(); source["users"][0].update(role="admin", roles=["admin"])
        self.assertIn("CLAIMS_ROLE_MISMATCH", self.codes(source))
        self.assertTrue(reconcile(source)["accounts"][0]["requiresMfa"])

    def test_action_restrictions_preserved_and_reviewed(self):
        source = fixture(); source["users"][0]["permissions"] = {"ventes": []}
        result = reconcile(source)
        self.assertEqual(result["accounts"][0]["profile"]["permissions"], {"ventes": []})
        self.assertIn("ACTION_ENFORCEMENT_REVIEW", self.codes(source))

    def test_unreviewed_link_blocks(self):
        source = fixture(); source["links"][0]["reviewed"] = False
        self.assertIn("LINK_REVIEW_REQUIRED", self.codes(source))

    def test_duplicate_user_blocks(self):
        source = fixture(); source["users"].append(copy.deepcopy(source["users"][0]))
        self.assertIn("USER_DUPLICATE_ID", self.codes(source))

    def test_unknown_and_secret_fields_not_silently_copied(self):
        source = fixture(); source["users"][0]["password"] = "not-a-real-password"
        result = reconcile(source)
        self.assertIn("UNSUPPORTED_USER_FIELDS", self.codes(source))
        self.assertNotIn("password", result["accounts"][0]["profile"])

    def test_malformed_roles_block_without_crash(self):
        for roles in (None, [], [{"admin": True}], ["unknown"]):
            source = fixture(); source["users"][0]["roles"] = roles
            self.assertIn("INVALID_ROLE_SET", self.codes(source))

    def test_duplicate_json_fields_rejected(self):
        with self.assertRaises(ValueError):
            unique_object([("role", "lecteur"), ("role", "admin")])

    def test_malformed_contact_blocks_without_crash(self):
        source = fixture(); source["users"][0]["email"] = {"invalid": True}
        self.assertIn("INVALID_CONTACT_FIELD", self.codes(source))

    def test_empty_export_is_not_reconciled(self):
        self.assertIn("EMPTY_USER_EXPORT", self.codes({"version": 1, "users": [], "identities": [], "links": []}))

    def test_unlinked_identity_blocks(self):
        source = fixture(); source["identities"].append({**source["identities"][0], "uid": "orphan"})
        self.assertIn("UNLINKED_IDENTITIES", self.codes(source))

    def test_mfa_enrollment_never_dropped(self):
        source = fixture(); source["identities"][0]["mfaEnrolled"] = True
        self.assertTrue(reconcile(source)["accounts"][0]["requiresMfa"])


if __name__ == "__main__":
    unittest.main()
