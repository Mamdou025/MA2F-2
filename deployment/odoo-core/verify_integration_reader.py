"""Read-only live verification for the prepared service identity; performs no writes."""
import json
from pathlib import Path
import urllib.request
import urllib.error

ORIGIN = 'https://ma2f-odoo-mamdou025.replit.app'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    private = json.loads(Path('/tmp/ma2f-odoo-reader-key.json').read_text())
    assert private['userId'] == 11 and private['companyId'] == 1
    opener = urllib.request.build_opener(NoRedirect)
    def rpc(model, method, payload, denied=False):
        request = urllib.request.Request(ORIGIN+'/json/2/'+model+'/'+method,
            data=json.dumps(payload).encode(), method='POST', headers={
                'Authorization': 'Bearer '+private['key'], 'X-Odoo-Database': 'ma2f_odoo',
                'Content-Type': 'application/json', 'Accept': 'application/json'})
        try:
            with opener.open(request, timeout=20) as response:
                raw = response.read(65537)
                assert len(raw) <= 65536
                assert not denied, 'Unexpected write access for '+model
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if denied and error.code == 403:
                return None
            raise RuntimeError('Odoo verification failed: '+model+'/'+method+' HTTP '+str(error.code)) from None
    context = {'allowed_company_ids': [1]}
    company = rpc('res.company','search_read',{'domain':[['id','=',1]],'fields':['id','name'],'limit':1,'context':context})
    assert company == [{'id':1,'name':'MA2F'}]
    products = rpc('product.product','search_read',{'domain':[['id','in',[3,4]]],'fields':['id','name'],'limit':2,'context':context})
    assert {p['id'] for p in products} == {3,4}
    locations = rpc('stock.location','search_read',{'domain':[['id','in',[17,18]]],'fields':['id','company_id'],'limit':2,'context':context})
    assert {p['id'] for p in locations} == {17,18}
    assert all(p['company_id'][0] == 1 for p in locations)
    for model in ['stock.quant','stock.move','stock.move.line','stock.reference','mrp.production','product.product']:
        for operation in ['create','write','unlink']:
            rpc(model,'check_access',{'ids':[],'operation':operation,'context':context},denied=True)
    print(json.dumps({'companyVerified':True,'productsVerified':True,'locationsVerified':True,
        'writeAccessChecksDenied':18,'businessWritesPerformed':0}))

if __name__ == '__main__':
    main()
