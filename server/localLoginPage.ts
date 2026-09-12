import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';

export const localLoginPage: RequestHandler = (_req, res) => {
  const nonce = randomBytes(24).toString('base64');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion MA2F</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center;font:16px system-ui;background:#eef3f7;color:#183044}main{width:100%;max-width:440px;padding:32px;background:white;border-radius:16px}h1{font-size:24px}label{display:block;margin-top:18px}input,button{font:inherit;width:100%;padding:12px;margin-top:8px;border-radius:8px;border:1px solid #a5b2bd}button{background:#244c68;color:white;cursor:pointer}p{line-height:1.5}input:focus,button:focus{outline:3px solid #84bde4;outline-offset:2px}button:disabled{opacity:.6}</style></head><body><main>
<h1>Connexion MA2F</h1><p>Vérifiez votre nouveau compte MA2F.</p><form id="login"><label for="email">Adresse e-mail</label><input id="email" type="email" autocomplete="username" required><label for="password">Mot de passe</label><input id="password" type="password" autocomplete="current-password" required><button id="submit">Se connecter</button></form>
<p id="status" role="status" aria-live="polite"></p><button id="logout" hidden>Se déconnecter</button><p id="help">Pour définir ou réinitialiser votre mot de passe, demandez un lien privé à votre administrateur.</p>
<script nonce="${nonce}">
const form=document.getElementById('login'),status=document.getElementById('status'),button=document.getElementById('submit'),logout=document.getElementById('logout');
async function inspect(){const r=await fetch('/api/local-auth/profile',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return false;const p=await r.json();if(!p.authenticated)return false;form.reset();form.hidden=true;logout.hidden=false;status.textContent='Connexion vérifiée pour '+p.user.email+'. '+(p.businessAccess?'Votre accès métier est actif.':'Votre compte est prêt. La bascule de l’application est encore en préparation.');return true;}
form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;status.textContent='Vérification…';try{const r=await fetch('/api/local-auth/sign-in/email',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});if(r.ok){if(!await inspect())status.textContent='Connexion établie, mais la vérification de votre accès a échoué. Réessayez.';}else{status.textContent=r.status===429?'Trop de tentatives. Réessayez dans une minute.':r.status===503?'Service temporairement indisponible.':'Adresse e-mail ou mot de passe incorrect.';}}catch{status.textContent='Connexion interrompue. Réessayez.';}finally{button.disabled=false;}});
logout.addEventListener('click',async()=>{logout.disabled=true;try{const r=await fetch('/api/local-auth/sign-out',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok){form.hidden=false;logout.hidden=true;status.textContent='Vous êtes déconnecté.';}else status.textContent='Déconnexion non confirmée. Réessayez.';}catch{status.textContent='Déconnexion non confirmée. Réessayez.';}finally{logout.disabled=false;}});
inspect().catch(()=>{});
</script></main></body></html>`);
};
