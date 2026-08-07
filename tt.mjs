const BASE='http://157.245.35.226';
const r=await fetch(BASE+'/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@wewe.org',password:'Password1!'})});
const cookie=(r.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
const tt=await (await fetch(BASE+'/v1/admin/transaction-types',{headers:{cookie}})).json();
console.log('transaction types that run the approval engine:');
for(const t of (Array.isArray(tt)?tt:[])) console.log(`  ${String(t.code).padEnd(16)} prefix=${t.refPrefix}  stages=${(t.stages||t.config?.stages||[]).map(s=>s.role).join(' > ')}`);
