"""Explicit, native Odoo preparation. Preview rolls back; apply posts no stock or sale."""
import configparser
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from start_production import settings

ROOT = Path(__file__).resolve().parent
SOURCE_SHA = 'f6a1f35312dd1550e9015800b8396ae16ca6efd3d28e223b197608ddb9c27fdb'


def main():
    if sys.argv[1:] not in [['preview'], ['apply']]:
        raise SystemExit('Explicit preview or apply required')
    mode = sys.argv[1]
    os.umask(0o077)
    config_values = settings(getpass.getpass('Odoo runtime connection: '))
    result_path = ROOT / '.local/business-masterdata-result.json'
    code = f'''
import json
from pathlib import Path
from odoo import Command
assert env.cr.dbname == 'ma2f_odoo'
company=env.ref('base.main_company')
assert company.id==1
assert env['res.company'].search_count([])==1
assert env['res.users'].search([('active','=',True),('share','=',False)]).ids == [6]
assert env.ref('ma2f_access.designated_admin').id==6
params=env['ir.config_parameter'].sudo()
assert params.get_param('database.is_neutralized')=='true'
assert params.get_param('ma2f.integration.business_enabled','false')=='false'
assert not env['account.move'].search_count([]), 'Existing accounting entries require review'
assert not env['sale.order'].search_count([]), 'Existing orders require review'
assert not env['stock.move'].search_count([]), 'Existing stock moves require review'
assert not env['mrp.production'].search_count([]), 'Existing production requires review'
currency=env.ref('base.XOF');currency.active=True
company.write({{'name':'MA2F','country_id':env.ref('base.sn').id,'currency_id':currency.id}})
warehouse=env['stock.warehouse'].search([('company_id','=',company.id)])
assert len(warehouse)==1, 'One reviewed warehouse required'
assert warehouse.lot_stock_id.usage=='internal'

def mark(name, record):
 existing=env.ref('ma2f_integration.'+name,raise_if_not_found=False)
 if existing:
  assert existing==record
 else:
  env['ir.model.data'].create({{'module':'ma2f_integration','name':name,'model':record._name,'res_id':record.id,'noupdate':True}})
 return record

def location(key,name):
 record=env.ref('ma2f_integration.'+key,raise_if_not_found=False)
 if not record:
  record=env['stock.location'].create({{'name':name,'usage':'internal','location_id':warehouse.lot_stock_id.id,'company_id':company.id}})
 assert record.company_id==company and record.usage=='internal' and record.location_id==warehouse.lot_stock_id
 return mark(key,record)

def product(key,code,name,uom):
 record=env.ref('ma2f_integration.'+key,raise_if_not_found=False)
 if not record:
  assert not env['product.product'].search_count([('default_code','=',code)])
  record=env['product.product'].create({{'name':name,'default_code':code,'type':'consu','is_storable':True,
   'uom_id':uom.id,'company_id':company.id,'tracking':'none'}})
 assert record.company_id==company and record.uom_id==uom and record.is_storable and record.tracking=='none'
 return mark(key,record)

film=product('film','MA2F-FILM-KG','Plastique sachets (kg)',env.ref('uom.product_uom_kgm'))
pack=product('finished_pack','MA2F-PACK-30','Pack de 30 sachets vendables',env.ref('uom.product_uom_unit'))
raw_location=location('raw_material_location','Matières premières')
finished_location=location('finished_location','Produits finis')
mark('company',company);mark('warehouse',warehouse)
bom=env.ref('ma2f_integration.pack_bom',raise_if_not_found=False)
if not bom:
 bom=env['mrp.bom'].create({{'code':'MA2F-PACK-30-ESTIMATE','product_tmpl_id':pack.product_tmpl_id.id,
  'product_id':pack.id,'product_qty':17,'product_uom_id':pack.uom_id.id,'company_id':company.id,'type':'normal',
  'consumption':'flexible','bom_line_ids':[Command.create({{'product_id':film.id,'product_qty':1,'product_uom_id':film.uom_id.id}})]}})
assert bom.product_id==pack and bom.company_id==company and bom.product_qty==17 and bom.product_uom_id==pack.uom_id
assert len(bom.bom_line_ids)==1 and bom.bom_line_ids.product_id==film and bom.bom_line_ids.product_qty==1
assert bom.type=='normal' and bom.consumption=='flexible' and not bom.operation_ids and not bom.byproduct_ids
mark('pack_bom',bom)
params.set_param('ma2f.integration.source_sha256',{SOURCE_SHA!r})
params.set_param('ma2f.integration.sachets_per_pack','30')
params.set_param('ma2f.integration.saleable_packs_per_kg_estimate','17')
params.set_param('ma2f.integration.business_enabled','false')
report={{'status':'validated','mode':{mode!r},'companyId':company.id,'currency':company.currency_id.name,
 'filmProductId':film.id,'packProductId':pack.id,'rawLocationId':raw_location.id,
 'finishedLocationId':finished_location.id,'bomId':bom.id,'packsPerKgEstimate':17,'sachetsPerPack':30,
 'businessWritesEnabled':False,'stockPosted':False,'salesPosted':False,'taxConfigurationVerified':False}}
assert report['currency']=='XOF'
if {mode!r}=='apply':env.cr.commit()
else:env.cr.rollback()
Path({str(result_path)!r}).write_text(json.dumps(report))
'''
    with tempfile.TemporaryDirectory(prefix='ma2f-masterdata-') as directory:
        config = configparser.ConfigParser(interpolation=None)
        config['options'] = {'db_host': config_values['host'], 'db_port': '5432', 'db_name': 'ma2f_odoo',
            'db_user': config_values['user'], 'db_password': config_values['password'], 'db_sslmode': 'verify-full',
            'list_db': 'False', 'http_enable': 'False', 'max_cron_threads': '0', 'data_dir': directory,
            'addons_path': str(ROOT / '.local/odoo-source/addons')}
        config_path = Path(directory) / 'odoo.conf'
        with config_path.open('w') as handle:
            config.write(handle)
        child = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'ODOO_')) and k != 'DATABASE_URL'}
        child['PGSSLROOTCERT'] = '/etc/ssl/certs/ca-certificates.crt'
        result_path.unlink(missing_ok=True)
        with (ROOT / '.local/business-masterdata.log').open('w') as log:
            result = subprocess.run([str(ROOT / '.local/venv/bin/python'), str(ROOT / '.local/odoo-source/odoo-bin'),
                'shell', '-c', str(config_path), '--no-http'], input=code, text=True,
                env=child, stdout=log, stderr=log, timeout=120)
        if result.returncode or not result_path.exists():
            raise SystemExit('Master data preparation failed; private log retained')
    print(result_path.read_text())


if __name__ == '__main__':
    main()
