"""Single transactional pilot command; no remote commits or generic model writes."""

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools.float_utils import float_compare

from ..production_contract import (InvalidCommand, command_fingerprint, validate_production,
                                   validate_pack_production, pack_fingerprint, production_quantities)


class PilotGate(models.Model):
    _name = "ma2f.pilot.gate"
    _description = "MA2F pilot transaction serialization"

    company_id = fields.Many2one("res.company", required=True, ondelete="restrict")
    revision = fields.Integer(default=0, required=True)
    _company_unique = models.Constraint("UNIQUE(company_id)", "One pilot gate per company")


class ProductionCommand(models.Model):
    _name = "ma2f.pilot.operation"
    _description = "MA2F validated pilot production operations"
    _rec_name = "request_id"

    request_id = fields.Char(required=True, readonly=True, index=True, copy=False)
    company_id = fields.Many2one("res.company", required=True, readonly=True, ondelete="restrict")
    integration_user_id = fields.Many2one("res.users", required=True, readonly=True, ondelete="restrict")
    actor = fields.Char(required=True, readonly=True)
    fingerprint = fields.Char(required=True, readonly=True)
    production_id = fields.Many2one("mrp.production", readonly=True, ondelete="restrict")
    scrap_id = fields.Many2one("stock.scrap", readonly=True, ondelete="restrict")
    result = fields.Json(readonly=True)
    _request_unique = models.Constraint("UNIQUE(company_id, request_id)", "MA2F_REQUEST_CONFLICT")

    @api.model
    def record_production(self, command):
        return self._record_production(command, packs=False)

    @api.model
    def record_pack_production(self, command):
        return self._record_production(command, packs=True)

    def _record_production(self, command, packs):
        # A public RPC method must enforce authorization itself, even with read-only ledger ACLs.
        if not self.env.user.has_group("ma2f_pilot_commands.group_pilot_writer"):
            raise AccessError("MA2F_FORBIDDEN")
        params = self.env["ir.config_parameter"].sudo()
        if (self.env.cr.dbname != "ma2f_pilot"
                or params.get_param("ma2f.pilot_only") != "true"
                or params.get_param("ma2f.pilot_company_id") != str(self.env.company.id)):
            raise AccessError("MA2F_PILOT_ONLY")
        if params.get_param("ma2f.pilot_writes_enabled") != "true":
            raise AccessError("MA2F_WRITES_DISABLED")
        try:
            data = validate_pack_production(command) if packs else validate_production(command)
        except InvalidCommand as exc:
            raise ValidationError("MA2F_INVALID_COMMAND") from exc

        # A row UPDATE, not just an advisory lock: under REPEATABLE READ a competing
        # snapshot must serialize/retry before it can inspect the operation ledger.
        # Odoo's RPC transaction runner retries serialization failures. Direct shell
        # callers must roll back/retry the entire transaction themselves.
        self.env.cr.execute(
            "UPDATE ma2f_pilot_gate SET revision = revision + 1 WHERE company_id = %s RETURNING id",
            [self.env.company.id],
        )
        if not self.env.cr.fetchone():
            raise UserError("MA2F_NOT_CONFIGURED")
        fingerprint = pack_fingerprint(data) if packs else command_fingerprint(data)
        ledger = self.sudo()
        existing = ledger.search([("company_id", "=", self.env.company.id),
                                  ("request_id", "=", data["request_id"])], limit=1)
        if existing:
            if existing.integration_user_id.id != self.env.uid:
                raise AccessError("MA2F_FORBIDDEN")
            if existing.fingerprint != fingerprint:
                raise UserError("MA2F_REQUEST_CONFLICT")
            if not existing.result:
                raise UserError("MA2F_INCOMPLETE_OPERATION")
            return dict(existing.result, replayed=True)

        # This addon deliberately supports only the untracked fictional fixture.
        # Explicit XML IDs are stored by bootstrap; user input cannot choose products/locations.
        film = self.env.ref("ma2f_pilot_commands.fixture_film", raise_if_not_found=False)
        sachet = self.env.ref("ma2f_pilot_commands.fixture_sachet", raise_if_not_found=False)
        bom = self.env.ref("ma2f_pilot_commands.fixture_bom", raise_if_not_found=False)
        location = self.env.ref("ma2f_pilot_commands.fixture_stock", raise_if_not_found=False)
        if not all([film, sachet, bom, location]):
            raise UserError("MA2F_NOT_CONFIGURED")
        if (any(record.company_id != self.env.company for record in [film, sachet, bom, location])
                or film.tracking != "none" or sachet.tracking != "none"
                or location.usage != "internal" or bom.type != "normal"
                or bom.product_id != sachet or bom.consumption != "flexible" or len(bom.bom_line_ids) != 1
                or bom.bom_line_ids.product_id != film or bom.operation_ids or bom.byproduct_ids
                or film.uom_id != self.env.ref("uom.product_uom_kgm")
                or sachet.uom_id != self.env.ref("uom.product_uom_unit")):
            raise UserError("MA2F_UNSUPPORTED_CONFIGURATION")

        kg = float(data["consumed_kg"])
        quantities = production_quantities(data['saleable_packs'], data['rejected_sachets']) if packs else None
        gross_units = quantities['gross_sachets'] if packs else data['produced_units']
        available = self.env["stock.quant"]._get_available_quantity(film, location)
        if float_compare(available, kg, precision_rounding=film.uom_id.rounding) < 0:
            raise UserError("MA2F_INSUFFICIENT_STOCK")

        # All changes inside a savepoint as well as the RPC transaction: even an
        # internal caller catching UserError must not leave a half-completed MO.
        with self.env.cr.savepoint():
            operation = ledger.create({
                "request_id": data["request_id"], "company_id": self.env.company.id,
                "integration_user_id": self.env.uid, "actor": "pilot:operator",
                "fingerprint": fingerprint,
            })
            production = self.env["mrp.production"].create({
                "product_id": sachet.id, "product_qty": gross_units,
                "product_uom_id": sachet.uom_id.id, "bom_id": bom.id,
                "location_src_id": location.id, "location_dest_id": location.id,
                "company_id": self.env.company.id, "origin": "MA2F " + data["request_id"],
            })
            production.action_confirm()
            raw = production.move_raw_ids
            if len(raw) != 1 or raw.product_id != film:
                raise UserError("MA2F_UNSUPPORTED_CONFIGURATION")
            raw._do_unreserve()
            raw.product_uom_qty = film.uom_id._compute_quantity(kg, raw.product_uom)
            raw._action_assign()
            if raw.state != "assigned":
                raise UserError("MA2F_INSUFFICIENT_STOCK")
            production.qty_producing = gross_units
            raw.quantity = raw.product_uom_qty
            raw.picked = True
            # Native MRP computes finished quantities from qty_producing at closure.
            # Pre-picking finished moves would count them in qty_produced too early.
            production.with_context(skip_backorder=True).button_mark_done()
            if production.state != "done":
                raise UserError("MA2F_VALIDATION_REQUIRED")
            scrap = self.env['stock.scrap']
            if packs and quantities['rejected_sachets']:
                scrap = scrap.create({'product_id': sachet.id, 'scrap_qty': quantities['rejected_sachets'],
                    'product_uom_id': sachet.uom_id.id, 'location_id': location.id,
                    'company_id': self.env.company.id, 'production_id': production.id,
                    'origin': 'MA2F ' + data['request_id']})
                scrap.action_validate()
                if scrap.state != 'done':
                    raise UserError('MA2F_VALIDATION_REQUIRED')
            result = {
                "request_id": data["request_id"], "state": "done",
                "production_id": production.id, "production_name": production.name,
                "produced_units": quantities['saleable_sachets'] if packs else gross_units,
                "consumed_kg": data["consumed_kg"],
                "actor": "pilot:operator", "replayed": False,
            }
            if packs:
                result.update(quantities, sachets_per_pack=30, scrap_id=scrap.id or None)
            operation.write({"production_id": production.id, "scrap_id": scrap.id, "result": result})
            return result

    @api.model
    def get_pack_stock(self):
        if not self.env.user.has_group('ma2f_pilot_access.group_pilot_reader'):
            raise AccessError('MA2F_FORBIDDEN')
        params = self.env['ir.config_parameter'].sudo()
        if (self.env.cr.dbname != 'ma2f_pilot' or params.get_param('ma2f.pilot_only') != 'true'
                or params.get_param('ma2f.pilot_company_id') != str(self.env.company.id)):
            raise AccessError('MA2F_PILOT_ONLY')
        stock = self.env.ref('ma2f_pilot_commands.fixture_stock')
        film = self.env.ref('ma2f_pilot_commands.fixture_film')
        sachet = self.env.ref('ma2f_pilot_commands.fixture_sachet')
        if (any(record.company_id != self.env.company for record in [stock, film, sachet])
                or stock.usage != 'internal'
                or film.uom_id != self.env.ref('uom.product_uom_kgm')
                or sachet.uom_id != self.env.ref('uom.product_uom_unit')):
            raise UserError('MA2F_UNSUPPORTED_CONFIGURATION')
        def totals(product):
            # Aggregate in PostgreSQL: no page limit that could silently truncate stock.
            rows = self.env['stock.quant']._read_group([
                ('product_id', '=', product.id), ('location_id', '=', stock.id),
                ('company_id', '=', self.env.company.id)], [], ['quantity:sum', 'reserved_quantity:sum'])
            on_hand, reserved = rows[0]
            return {'on_hand': on_hand, 'reserved': reserved, 'available': on_hand - reserved}
        finished = totals(sachet)
        available = finished['available']
        if not float(available).is_integer():
            raise UserError('MA2F_UNSUPPORTED_CONFIGURATION')
        return {'scope': 'factory', 'location_id': stock.id, 'location_name': stock.complete_name, 'sachets_per_pack': 30,
                'sachets': finished, 'film_kg': totals(film),
                'available_whole_packs': max(0, int(available)) // 30,
                'available_loose_sachets': max(0, int(available)) % 30}
