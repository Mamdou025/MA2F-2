"""Opt-in startup policy for a designated admin and read-only technical account."""
import re


def check_accounts(cursor, configured_id=None, configured_admin_id=None):
    for value in (configured_id, configured_admin_id):
        if value is not None and (not re.fullmatch(r'[1-9][0-9]*', value) or int(value) <= 2):
            raise ValueError('Invalid account configuration')
    if configured_id is not None and configured_id == configured_admin_id:
        raise ValueError('Administrator and integration identities must be separate')
    # Include the technical identity even when it uses the restricted portal base role.
    cursor.execute("SELECT id,login FROM res_users WHERE active AND (NOT share OR login='ma2f.integration') ORDER BY id")
    users = cursor.fetchall()
    if not users:
        return  # Default locked mode, also supports publishing before activation.
    if configured_admin_id is not None:
        admin_id = int(configured_admin_id)
        admins = [row for row in users if row[0] == admin_id]
        if admins:
            if admins != [(admin_id, 'fallmamadou151@gmail.com')]:
                raise ValueError('Unexpected administrator login')
            cursor.execute("SELECT res_id FROM ir_model_data WHERE module='ma2f_access' AND name='designated_admin' AND model='res.users'")
            if cursor.fetchone() != (admin_id,):
                raise ValueError('Administrator provenance missing')
            cursor.execute("""SELECT EXISTS (
              SELECT 1 FROM res_groups_users_rel r JOIN ir_model_data d ON d.res_id=r.gid
              WHERE r.uid=%s AND d.model='res.groups' AND d.module='base' AND d.name='group_system')""", (admin_id,))
            if cursor.fetchone() != (True,):
                raise ValueError('Designated administrator permissions missing')
            users = [row for row in users if row[0] != admin_id]
            if not users:
                return
    if (configured_id is None or int(configured_id) <= 2
            or users != [(int(configured_id), 'ma2f.integration')]):
        raise ValueError('Unexpected active internal account')
    uid = int(configured_id)
    cursor.execute("SELECT res_id FROM ir_model_data WHERE module='ma2f_integration' AND name='reader_user' AND model='res.users'")
    if cursor.fetchone() != (uid,):
        raise ValueError('Technical account provenance missing')
    cursor.execute("""SELECT EXISTS (
      SELECT 1 FROM res_groups_users_rel r JOIN ir_model_data d ON d.res_id=r.gid
      WHERE r.uid=%s AND d.model='res.groups' AND d.module='base'
      AND d.name IN ('group_system','group_erp_manager'))""", (uid,))
    if cursor.fetchone() != (False,):
        raise ValueError('Technical account must not administer Odoo')
    cursor.execute("""SELECT EXISTS (
      SELECT 1 FROM ir_model_access a JOIN ir_model m ON m.id=a.model_id
      WHERE a.active AND (m.model LIKE 'stock.%%' OR m.model LIKE 'mrp.%%')
      AND (a.perm_write OR a.perm_create OR a.perm_unlink)
      AND (a.group_id IS NULL OR a.group_id IN
        (SELECT gid FROM res_groups_users_rel WHERE uid=%s)))""", (uid,))
    if cursor.fetchone() != (False,):
        raise ValueError('Technical account must have read-only stock and production access')
