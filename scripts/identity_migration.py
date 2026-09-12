"""Offline account reconciliation. Never creates users, changes roles or sends email."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

ROLES = {"admin", "caissier", "commercial", "lecteur"}
ACTIONS = {"read", "create", "edit", "delete"}
FIELDS = {"id", "nom", "login", "email", "tel", "role", "roles", "actif",
          "allowedSections", "permissions"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON property")
        result[key] = value
    return result


def read_json(path):
    data = Path(path).read_bytes()
    if len(data) > 20_000_000:
        raise ValueError("Input exceeds 20 MB")
    return json.loads(data, object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON")))


def reconcile(source):
    """Input is an explicit sanitized export contract, not an inferred email match."""
    if not isinstance(source, dict) or set(source) != {"version", "users", "identities", "links"}:
        raise ValueError("Expected version, users, identities and links")
    if type(source["version"]) is not int or source["version"] != 1:
        raise ValueError("Unsupported version")
    for key in ("users", "identities", "links"):
        if not isinstance(source[key], list) or len(source[key]) > 10000:
            raise ValueError("Expected bounded lists")

    issues = []

    def issue(code, index=None):
        # No names, emails, passwords or secret material in the issue summary.
        issues.append({"code": code, "row": index})

    def index_rows(rows, key, kind):
        result = {}
        for i, row in enumerate(rows):
            if not isinstance(row, dict) or not isinstance(row.get(key), str) or not row[key].strip():
                issue(kind + "_INVALID_ID", i)
                continue
            if row[key] in result:
                issue(kind + "_DUPLICATE_ID", i)
            result[row[key]] = row
        return result

    users = index_rows(source["users"], "id", "USER")
    identities = index_rows(source["identities"], "uid", "IDENTITY")
    links = index_rows(source["links"], "appUserId", "LINK")
    used = set()
    accounts = []
    for i, user in enumerate(source["users"]):
        if not isinstance(user, dict):
            continue
        if set(user) - FIELDS:
            issue("UNSUPPORTED_USER_FIELDS", i)
        if any(not isinstance(user.get(k), str) or not user[k].strip() for k in ("id", "nom", "login")):
            issue("INVALID_PROFILE", i)
        for k in ("email", "tel"):
            if k in user and not isinstance(user[k], str):
                issue("INVALID_CONTACT_FIELD", i)
        if type(user.get("actif")) is not bool:
            issue("INVALID_ACTIVE_STATE", i)
        role = user.get("role")
        roles = user.get("roles")
        if not isinstance(role, str) or role not in ROLES:
            issue("UNKNOWN_PRIMARY_ROLE", i)
        valid_roles = (isinstance(roles, list) and bool(roles)
                       and all(isinstance(r, str) and r in ROLES for r in roles))
        if not valid_roles or role not in roles or len(set(roles)) != len(roles):
            issue("INVALID_ROLE_SET", i)
        sections = user.get("allowedSections")
        if "allowedSections" in user:
            if not isinstance(sections, list) or not all(isinstance(s, str) and s for s in sections):
                issue("INVALID_SECTIONS", i)
            elif not sections:
                issue("EMPTY_SECTIONS_SEMANTICS_REVIEW", i)
        if "permissions" in user:
            permissions = user["permissions"]
            if (not isinstance(permissions, dict)
                    or any(not isinstance(v, list) or not all(isinstance(a, str) and a in ACTIONS for a in v)
                           for v in permissions.values())):
                issue("INVALID_ACTION_PERMISSIONS", i)
            elif permissions:
                issue("ACTION_ENFORCEMENT_REVIEW", i)
        user_id = user.get("id")
        link = links.get(user_id) if isinstance(user_id, str) else None
        if not link:
            issue("EXPLICIT_LINK_REQUIRED", i)
            continue
        if set(link) != {"appUserId", "firebaseUid", "reviewed"} or link.get("reviewed") is not True:
            issue("LINK_REVIEW_REQUIRED", i)
        uid = link.get("firebaseUid")
        if not isinstance(uid, str) or uid not in identities:
            issue("IDENTITY_NOT_FOUND", i)
            continue
        if uid in used:
            issue("IDENTITY_LINKED_TWICE", i)
        used.add(uid)
        identity = identities[uid]
        if set(identity) != {"uid", "email", "disabled", "claims", "mfaEnrolled"}:
            issue("INVALID_IDENTITY_FIELDS", i)
        if type(identity.get("disabled")) is not bool or type(identity.get("mfaEnrolled")) is not bool:
            issue("INVALID_IDENTITY_STATE", i)
        if not isinstance(identity.get("email"), str):
            issue("INVALID_IDENTITY_EMAIL", i)
        elif not isinstance(user.get("email"), str) or user["email"].strip().casefold() != identity["email"].strip().casefold():
            issue("EMAIL_MISMATCH", i)
        claims = identity.get("claims")
        if not isinstance(claims, dict) or set(claims) - {"role", "roles"}:
            issue("UNSUPPORTED_CLAIMS", i)
        else:
            claim_roles = claims.get("roles", [claims.get("role")])
            if (not valid_roles or not isinstance(claim_roles, list)
                    or not all(isinstance(r, str) for r in claim_roles)
                    or claims.get("role") != role or set(claim_roles) != set(roles)):
                issue("CLAIMS_ROLE_MISMATCH", i)
        if type(user.get("actif")) is bool and type(identity.get("disabled")) is bool:
            if user["actif"] == identity["disabled"]:
                issue("ACTIVE_STATE_MISMATCH", i)
        # Only recognized business fields are emitted. Unknown fields block the plan.
        profile = {k: deepcopy(v) for k, v in user.items() if k in FIELDS}
        accounts.append({"profile": profile, "firebaseUid": uid,
                         "targetIdentity": None, "activationAllowed": False,
                         "directOdooAccess": False,
                         "requiresMfa": identity.get("mfaEnrolled") is True
                         or (valid_roles and bool(set(roles) & {"admin", "caissier"}))})
    if not source["users"]:
        issue("EMPTY_USER_EXPORT")
    if set(links) - set(users):
        issue("LINK_WITHOUT_USER")
    if set(identities) - used:
        issue("UNLINKED_IDENTITIES")
    # Duplicate emails must be reviewed even with explicit, distinct identity links.
    emails = [(u.get("email") or "").strip().casefold() for u in users.values()
              if isinstance(u.get("email"), str) and u["email"].strip()]
    if len(set(emails)) != len(emails):
        issue("DUPLICATE_EMAIL")
    digest = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {"version": 1, "sourceSha256": digest, "mode": "dry-run",
            "status": "blocked" if issues else "reconciled",
            "readyForCutover": False, "accounts": accounts, "issues": issues,
            "summary": {"users": len(source["users"]), "linked": len(accounts),
                        "issues": len(issues), "mfaRequired": sum(a["requiresMfa"] for a in accounts)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = reconcile(read_json(args.source))
        # Exclusive creation avoids silently replacing a reviewed report.
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": result["status"], **result["summary"]}))
        return 2 if result["issues"] else 0
    except (ValueError, TypeError, OSError, RecursionError):
        print('{"status":"invalid_input_or_output"}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
