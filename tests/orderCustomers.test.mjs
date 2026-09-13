import test from 'node:test';
import assert from 'node:assert/strict';
import {orderCustomers} from '../server/orderCustomers.ts';
const env={MA2F_ODOO_ORDERS_ENABLED:'true',ODOO_COMMAND_API_KEY:'fictional',ODOO_DATABASE:'ma2f_odoo',ODOO_COMPANY_ID:'1',ODOO_BASE_URL:'https://odoo.example.invalid'};
test('customer selector fixes RPC and rejects unsafe or oversized upstream results',async()=>{
  const fetcher=async(url,options)=>{assert.equal(url,'https://odoo.example.invalid/json/2/ma2f.core.operation/order_customers');assert.deepEqual(JSON.parse(options.body),{context:{allowed_company_ids:[1]}});assert.equal(options.redirect,'error');return Response.json([{id:7,name:'Fictional customer',phone:'not forwarded'}]);};
  assert.deepEqual(await orderCustomers(env,fetcher)(),[{id:7,name:'Fictional customer'}]);
  for(const value of [{},[{id:0,name:'bad'}],[{id:7,name:'A'},{id:7,name:'B'}],Array.from({length:2001},(_,i)=>({id:i+1,name:'A'}))])await assert.rejects(orderCustomers(env,async()=>Response.json(value))());
  await assert.rejects(orderCustomers(env,async()=>new Response('x'.repeat(512001)))());
  for(const patch of [{ODOO_DATABASE:'other'},{ODOO_COMPANY_ID:'2'},{ODOO_COMMAND_API_KEY:''},{MA2F_ODOO_ORDERS_ENABLED:'false'}])await assert.rejects(orderCustomers({...env,...patch},fetcher)());
});
