import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';

export const localAccountPage: RequestHandler = (_req, res) => {
  const nonce = randomBytes(24).toString('base64');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mot de passe MA2F</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{font:16px system-ui;background:#eef3f7;color:#183044;margin:0;padding:24px;min-height:100vh;display:grid;place-items:center}main{background:white;border-radius:16px;padding:32px;max-width:440px;width:100%;box-shadow:0 6px 24px #18304418}h1{font-size:24px}p{line-height:1.5}label{display:block;margin:20px 0 6px}input,button{font:inherit;width:100%;padding:12px;border-radius:8px;border:1px solid #a5b2bd}button{margin-top:24px;background:#244c68;color:white;cursor:pointer}button:disabled{opacity:.6}input:focus,button:focus{outline:3px solid #84bde4;outline-offset:2px}#status{min-height:24px}.note{color:#52697a;font-size:14px}</style></head>
<body><main><h1>Votre mot de passe MA2F</h1><p>Choisissez votre mot de passe personnel. Ce lien est valable 15 minutes et ne peut être utilisé qu’une fois.</p>
<form id="setup"><label for="password">Nouveau mot de passe</label><input id="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required aria-describedby="hint"><p id="hint" class="note">Entre 12 et 128 caractères. Vous pouvez utiliser une longue phrase.</p><label for="confirmation">Confirmer le mot de passe</label><input id="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button id="submit" type="submit">Enregistrer le mot de passe</button></form><p id="status" role="status" aria-live="polite"></p></main>
<script nonce="${nonce}">
const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);
const form=document.getElementById('setup'),status=document.getElementById('status'),button=document.getElementById('submit');
if(!token){form.hidden=true;status.textContent='Demandez un nouveau lien personnel à votre administrateur.';}
form.addEventListener('submit',async event=>{event.preventDefault();const password=document.getElementById('password'),confirmation=document.getElementById('confirmation');
if(password.value!==confirmation.value){status.textContent='Les deux mots de passe doivent être identiques.';confirmation.focus();return;}
button.disabled=true;status.textContent='Enregistrement…';
try{const response=await fetch('/api/local-auth/reset-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,newPassword:password.value})});
if(response.ok){form.reset();form.hidden=true;status.textContent='Votre mot de passe est enregistré. Votre administrateur vous indiquera quand utiliser la nouvelle connexion MA2F.';}
else{status.textContent=response.status===429?'Trop de tentatives. Réessayez dans une minute.':response.status===503?'Le service est temporairement indisponible. Réessayez plus tard.':'Ce lien est invalide ou expiré, ou le mot de passe ne respecte pas les règles. Demandez un nouveau lien si nécessaire.';}
}catch{status.textContent='Connexion interrompue. Réessayez. Si le lien a déjà été utilisé, demandez-en un nouveau.';}finally{button.disabled=false;}});
</script></body></html>`);
};
