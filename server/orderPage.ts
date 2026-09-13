import {randomBytes} from 'node:crypto';
import type {RequestHandler} from 'express';

export const orderPage:RequestHandler=(_req,res)=>{
  const nonce=randomBytes(24).toString('base64');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Devis Odoo — MA2F</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#183044;font:16px system-ui;padding:24px}main{max-width:680px;margin:auto;background:white;border-radius:16px;padding:28px}h1{font-size:26px}p{line-height:1.5}label{display:block;margin-top:18px}input,select,button{width:100%;font:inherit;padding:12px;margin-top:8px;border:1px solid #8296a5;border-radius:8px}button{background:#1b4b6b;color:white;cursor:pointer}button:disabled{opacity:.5}a{color:#1b4b6b}input:focus,select:focus,button:focus,a:focus{outline:3px solid #79bde5;outline-offset:2px}[hidden]{display:none!important}#status{padding:14px;background:#eff5f8;border-radius:8px;white-space:pre-line}</style></head><body><main>
<a href="/">← Retour à MA2F</a><h1>Devis Odoo</h1><p>Créez un devis de packs de 30 sachets. Les taxes sont gérées en dehors d’Odoo. Un devis ne réserve pas de stock et ne déclenche ni livraison ni facture.</p>
<p id="access">Vérification de votre accès…</p><p><a id="login" href="/api/local-auth/login" target="_blank" rel="noopener">Se connecter à l’espace Odoo MA2F</a></p><button id="refresh" type="button">Vérifier mon accès</button>
<form id="form" hidden><label for="customer">Client Odoo</label><select id="customer" required></select><label for="packs">Nombre de packs</label><input id="packs" type="number" min="1" max="100000" step="1" required><label for="price">Prix par pack (FCFA)</label><input id="price" type="number" min="1" max="1000000" step="1" required><p id="total">Total : —</p><button id="submit">Créer le devis</button></form>
<p id="status" role="status" aria-live="polite">Aucun devis soumis dans cet espace.</p><button id="retry" hidden>Vérifier / réessayer le même devis</button><button id="next" hidden>Préparer un autre devis</button>
<script nonce="${nonce}">
const byId=id=>document.getElementById(id),form=byId('form'),status=byId('status');let actor=null,key=null,pending=null,busy=false,timer=null,ready=false,completed=false;
const money=n=>new Intl.NumberFormat('fr-FR').format(n)+' FCFA';
function controls(){for(const id of ['customer','packs','price','submit'])byId(id).disabled=busy||Boolean(pending)||!ready;byId('retry').hidden=!pending||completed;byId('retry').disabled=busy;byId('next').hidden=!completed;}
function persist(value){localStorage.setItem(key,JSON.stringify(value));pending=value;}
function problem(r){if(r.status===401||r.status===403){ready=false;byId('access').textContent='Connectez-vous avec le compte autorisé pour ce devis.';return 'Accès non autorisé. Votre demande est conservée.';}return r.status===409?'Cette référence existe avec un autre contenu. Une vérification par un administrateur est nécessaire.':'Service indisponible. Votre demande est conservée ; réessayez la même référence.';}
function show(s){
  if(s.requestId!==pending.requestId)throw Error('receipt');
  if(s.state==='completed'){
    const r=s.result;
    if(!r||r.requestId!==pending.requestId||r.customerId!==pending.customerId||r.packs!==pending.packs||r.unitPriceFCFA!==pending.unitPriceFCFA||r.totalFCFA!==pending.packs*pending.unitPriceFCFA||r.state!=='draft'||r.stockReserved!==false||r.invoicePosted!==false)throw Error('receipt');
    completed=true;status.textContent='Devis '+r.orderName+' créé dans Odoo.\\n'+r.packs+' packs — '+money(r.totalFCFA)+'\\nRéférence : '+pending.requestId;
  }else if(s.state==='needs_review'){status.textContent='Cette demande nécessite une vérification par un administrateur. Ne créez pas un second devis pour la remplacer.\\nRéférence : '+pending.requestId;}
  else{status.textContent='Demande enregistrée. En attente de confirmation par Odoo…\\nRéférence : '+pending.requestId;timer=setTimeout(()=>check(false),3000);}
}
async function check(retry){if(!pending||busy||!ready)return;clearTimeout(timer);busy=true;controls();try{
  const r=retry?await fetch('/api/odoo-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)}):await fetch('/api/odoo-orders/'+pending.requestId,{cache:'no-store'});
  if(!r.ok){status.textContent=r.status===404?'Demande non retrouvée. Utilisez « réessayer le même devis » pour la transmettre avec sa référence initiale.':problem(r);return;}show(await r.json());
}catch{status.textContent='Confirmation interrompue. La demande est conservée. Vérifiez ou réessayez la même référence.';}finally{busy=false;controls();}}
async function load(){clearTimeout(timer);ready=false;controls();try{
  const r=await fetch('/api/local-auth/profile',{cache:'no-store'});if(!r.ok){byId('access').textContent='Connectez-vous, puis cliquez sur « Vérifier mon accès ».';return;}
  const p=await r.json();if(!p.businessAccess){byId('access').textContent='Votre compte est connecté. Son accès aux devis doit être activé par un administrateur.';return;}
  const customers=await fetch('/api/odoo-orders/customers',{cache:'no-store'});if(!customers.ok){byId('access').textContent=problem(customers);return;}
  const list=await customers.json();byId('customer').replaceChildren();for(const c of list){const o=document.createElement('option');o.value=String(c.id);o.textContent=c.name+' — #'+c.id;byId('customer').append(o);}
  actor=p.user.id;key='ma2f-odoo-draft-v1:'+actor;const saved=localStorage.getItem(key);pending=saved?JSON.parse(saved):null;completed=false;
  byId('access').textContent='Connecté : '+p.user.email;form.hidden=false;ready=list.length>0;
  if(!ready)status.textContent='Aucun client Odoo disponible. Faites vérifier le rapprochement des clients.';
  if(pending){byId('customer').value=String(pending.customerId);byId('packs').value=pending.packs;byId('price').value=pending.unitPriceFCFA;await check(false);}
}catch{byId('access').textContent='Impossible de charger cet espace ou de conserver les demandes dans ce navigateur. Réessayez.';ready=false;}finally{controls();}}
form.addEventListener('input',()=>byId('total').textContent='Total : '+money(Number(byId('packs').value)*Number(byId('price').value)));
form.addEventListener('submit',async e=>{e.preventDefault();if(!ready||pending||busy)return;const customerId=Number(byId('customer').value),packs=Number(byId('packs').value),unitPriceFCFA=Number(byId('price').value);if(!Number.isSafeInteger(customerId)||customerId<1||!Number.isSafeInteger(packs)||packs<1||packs>100000||!Number.isSafeInteger(unitPriceFCFA)||unitPriceFCFA<1||unitPriceFCFA>1000000)return;try{persist({requestId:crypto.randomUUID(),customerId,packs,unitPriceFCFA});}catch{status.textContent='Enregistrement local impossible. Aucun devis transmis.';return;}await check(true);});
byId('refresh').addEventListener('click',load);byId('retry').addEventListener('click',()=>check(true));byId('next').addEventListener('click',()=>{if(!completed)return;try{localStorage.removeItem(key);}catch{return;}pending=null;completed=false;form.reset();status.textContent='Vous pouvez préparer un autre devis.';controls();});
load();
</script></main></body></html>`);
};
