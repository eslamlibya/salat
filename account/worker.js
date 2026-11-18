// الصلاة — خادم الحسابات (Cloudflare Worker + D1)
// الربط المطلوب: قاعدة D1 باسم DB
// الأسرار (Secrets): BREVO_KEY  — مفتاح خدمة إرسال البريد
// المتغيرات (Variables): MAIL_FROM (بريد مرسِل موثَّق في Brevo)، ALLOWED_ORIGIN (اختياري)
const te=new TextEncoder();
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64u=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");s+="=".repeat((4-s.length%4)%4);return Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
const rnd=n=>b64u(crypto.getRandomValues(new Uint8Array(n)));
const same=(a,b)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
async function sha(s){return b64u(await crypto.subtle.digest("SHA-256",te.encode(s)))}
async function pbk(pw,salt){const k=await crypto.subtle.importKey("raw",te.encode(pw),"PBKDF2",false,["deriveBits"]);return b64u(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:unb64u(salt),iterations:100000},k,256))}
let READY=false;
async function init(env){if(READY)return;const d=env.DB;
 await d.batch([
 d.prepare("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS codes(uid INTEGER NOT NULL,kind TEXT NOT NULL,ch TEXT NOT NULL,exp INTEGER NOT NULL,tries INTEGER NOT NULL DEFAULT 0,sent INTEGER NOT NULL,PRIMARY KEY(uid,kind))"),
 d.prepare("CREATE TABLE IF NOT EXISTS sess(th TEXT PRIMARY KEY,uid INTEGER NOT NULL,exp INTEGER NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS dat(uid INTEGER PRIMARY KEY,j TEXT NOT NULL,ut INTEGER NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS rl(k TEXT PRIMARY KEY,n INTEGER NOT NULL,w INTEGER NOT NULL)")]);READY=true}
const cors=env=>({"Access-Control-Allow-Origin":env.ALLOWED_ORIGIN||"https://eslamlibya.github.io","Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Vary":"Origin"});
const out=(env,o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors(env),"Content-Type":"application/json","Cache-Control":"no-store"}});
async function limit(env,k,max,win){const now=Date.now(),r=await env.DB.prepare("SELECT n,w FROM rl WHERE k=?").bind(k).first();
 if(!r||now-r.w>win){await env.DB.prepare("INSERT OR REPLACE INTO rl(k,n,w) VALUES(?,1,?)").bind(k,now).run();return true}
 if(r.n>=max)return false;await env.DB.prepare("UPDATE rl SET n=n+1 WHERE k=?").bind(k).run();return true}
async function mail(env,to,subject,html){if(!env.BREVO_KEY||!env.MAIL_FROM)throw new Error("mail-config");
 const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":env.BREVO_KEY,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({sender:{name:"الصلاة",email:env.MAIL_FROM},to:[{email:to}],subject,htmlContent:html})});
 if(!r.ok)throw new Error("mail-"+r.status)}
async function sendCode(env,u,kind){const code=String(Math.floor(Math.random()*1e6)).padStart(6,"0"),now=Date.now();
 const old=await env.DB.prepare("SELECT sent FROM codes WHERE uid=? AND kind=?").bind(u.id,kind).first();
 if(old&&now-old.sent<60000)return"wait";
 await env.DB.prepare("INSERT OR REPLACE INTO codes(uid,kind,ch,exp,tries,sent) VALUES(?,?,?,?,0,?)").bind(u.id,kind,await sha(u.id+":"+kind+":"+code),now+15*60000,now).run();
 const t=kind==="v"?"تأكيد البريد الإلكتروني":"إعادة تعيين كلمة المرور";
 await mail(env,u.email,"الصلاة — "+t,'<div dir="rtl" style="font-family:sans-serif;font-size:16px"><p>مرحبًا '+esc(u.name)+'،</p><p>رمز '+t+':</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px">'+code+'</p><p>ينتهي الرمز بعد 15 دقيقة. إن لم تطلبه فتجاهل هذه الرسالة.</p></div>');return"ok"}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function chkCode(env,uid,kind,code){const r=await env.DB.prepare("SELECT ch,exp,tries FROM codes WHERE uid=? AND kind=?").bind(uid,kind).first();
 if(!r||r.exp<Date.now()||r.tries>=5)return false;
 await env.DB.prepare("UPDATE codes SET tries=tries+1 WHERE uid=? AND kind=?").bind(uid,kind).run();
 if(!same(r.ch,await sha(uid+":"+kind+":"+String(code).trim())))return false;
 await env.DB.prepare("DELETE FROM codes WHERE uid=? AND kind=?").bind(uid,kind).run();return true}
async function newSess(env,uid){const t=rnd(32);await env.DB.prepare("INSERT INTO sess(th,uid,exp) VALUES(?,?,?)").bind(await sha(t),uid,Date.now()+60*864e5).run();return t}
async function auth(env,req){const h=req.headers.get("Authorization")||"";if(h.slice(0,7)!=="Bearer ")return null;
 const r=await env.DB.prepare("SELECT u.id,u.email,u.username,u.name,s.exp FROM sess s JOIN users u ON u.id=s.uid WHERE s.th=?").bind(await sha(h.slice(7))).first();
 return r&&r.exp>Date.now()?r:null}
const pub=u=>({id:u.id,email:u.email,username:u.username,name:u.name});
const EM=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/,UN=/^[a-z0-9_]{3,20}$/;
export default{async fetch(req,env){
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(env)});
 const u=new URL(req.url),p=u.pathname,ip=req.headers.get("CF-Connecting-IP")||"x";
 if(req.method==="GET"&&p==="/")return out(env,{ok:true,name:"salat-account"});
 try{await init(env);
 let b={};if(req.method==="POST"||req.method==="PUT"){const tx=await req.text();if(tx.length>400000)return out(env,{error:"big"},413);try{b=JSON.parse(tx||"{}")}catch(e){return out(env,{error:"json"},400)}}
 if(p==="/register"&&req.method==="POST"){
  if(!await limit(env,"reg:"+ip,10,36e5))return out(env,{error:"rate"},429);
  const name=String(b.name||"").trim(),un=String(b.username||"").trim().toLowerCase(),em=String(b.email||"").trim().toLowerCase(),pw=String(b.password||"");
  if(name.length<2||name.length>60)return out(env,{error:"name"},400);
  if(!UN.test(un))return out(env,{error:"username"},400);
  if(!EM.test(em)||em.length>120)return out(env,{error:"email"},400);
  if(pw.length<8||pw.length>100)return out(env,{error:"password"},400);
  const ex=await env.DB.prepare("SELECT id,verified,email,username FROM users WHERE email=? OR username=?").bind(em,un).first();
  if(ex&&ex.verified)return out(env,{error:ex.email===em?"email_taken":"username_taken"},409);
  const salt=rnd(16),hash=await pbk(pw,salt);let uid;
  if(ex){if(ex.email!==em||ex.username!==un)return out(env,{error:"username_taken"},409);await env.DB.prepare("UPDATE users SET name=?,salt=?,hash=? WHERE id=?").bind(name,salt,hash,ex.id).run();uid=ex.id}
  else{const r=await env.DB.prepare("INSERT INTO users(email,username,name,salt,hash,verified,created) VALUES(?,?,?,?,?,0,?)").bind(em,un,name,salt,hash,Date.now()).run();uid=r.meta.last_row_id}
  const s=await sendCode(env,{id:uid,email:em,name},"v");return out(env,{ok:true,need:"verify",wait:s==="wait"})}
 if(p==="/resend"&&req.method==="POST"){
  if(!await limit(env,"rs:"+ip,10,36e5))return out(env,{error:"rate"},429);
  const em=String(b.email||"").trim().toLowerCase(),r=await env.DB.prepare("SELECT id,email,name,verified FROM users WHERE email=?").bind(em).first();
  if(r&&!r.verified)await sendCode(env,r,"v");return out(env,{ok:true})}
 if(p==="/verify"&&req.method==="POST"){
  if(!await limit(env,"vf:"+ip,30,36e5))return out(env,{error:"rate"},429);
  const em=String(b.email||"").trim().toLowerCase(),r=await env.DB.prepare("SELECT id,email,username,name FROM users WHERE email=?").bind(em).first();
  if(!r||!await chkCode(env,r.id,"v",b.code))return out(env,{error:"code"},400);
  await env.DB.prepare("UPDATE users SET verified=1 WHERE id=?").bind(r.id).run();return out(env,{ok:true,token:await newSess(env,r.id),user:pub(r)})}
 if(p==="/login"&&req.method==="POST"){
  if(!await limit(env,"lg:"+ip,20,36e5))return out(env,{error:"rate"},429);
  const id=String(b.id||"").trim().toLowerCase(),pw=String(b.password||"");
  if(!id||!pw||pw.length>100)return out(env,{error:"login"},400);
  if(!await limit(env,"lgu:"+id,8,15*60000))return out(env,{error:"rate"},429);
  const r=await env.DB.prepare("SELECT * FROM users WHERE email=? OR username=?").bind(id,id).first();
  const salt=r?r.salt:rnd(16),h=await pbk(pw,salt);
  if(!r||!same(h,r.hash))return out(env,{error:"login"},401);
  if(!r.verified){await sendCode(env,r,"v");return out(env,{error:"unverified",email:r.email},403)}
  return out(env,{ok:true,token:await newSess(env,r.id),user:pub(r)})}
 if(p==="/forgot"&&req.method==="POST"){
  if(!await limit(env,"fg:"+ip,10,36e5))return out(env,{error:"rate"},429);
  const em=String(b.email||"").trim().toLowerCase(),r=await env.DB.prepare("SELECT id,email,name FROM users WHERE email=? AND verified=1").bind(em).first();
  if(r)await sendCode(env,r,"r");return out(env,{ok:true})}
 if(p==="/reset"&&req.method==="POST"){
  if(!await limit(env,"rt:"+ip,20,36e5))return out(env,{error:"rate"},429);
  const em=String(b.email||"").trim().toLowerCase(),pw=String(b.password||""),r=await env.DB.prepare("SELECT id FROM users WHERE email=? AND verified=1").bind(em).first();
  if(pw.length<8||pw.length>100)return out(env,{error:"password"},400);
  if(!r||!await chkCode(env,r.id,"r",b.code))return out(env,{error:"code"},400);
  const salt=rnd(16);await env.DB.batch([env.DB.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").bind(salt,await pbk(pw,salt),r.id),env.DB.prepare("DELETE FROM sess WHERE uid=?").bind(r.id)]);return out(env,{ok:true})}
 const me=await auth(env,req);
 if(!me)return out(env,{error:"auth"},401);
 if(p==="/me"&&req.method==="GET")return out(env,{ok:true,user:pub(me)});
 if(p==="/logout"&&req.method==="POST"){await env.DB.prepare("DELETE FROM sess WHERE th=?").bind(await sha(req.headers.get("Authorization").slice(7))).run();return out(env,{ok:true})}
 if(p==="/data"&&req.method==="GET"){const r=await env.DB.prepare("SELECT j,ut FROM dat WHERE uid=?").bind(me.id).first();return out(env,{ok:true,j:r?r.j:null,ut:r?r.ut:0})}
 if(p==="/data"&&req.method==="PUT"){
  if(!await limit(env,"dt:"+me.id,120,36e5))return out(env,{error:"rate"},429);
  const j=typeof b.j==="string"?b.j:"",ut=Number.isFinite(b.ut)?Math.floor(b.ut):Date.now();
  if(!j||j.length>300000)return out(env,{error:"size"},413);try{JSON.parse(j)}catch(e){return out(env,{error:"json"},400)}
  const r=await env.DB.prepare("SELECT ut FROM dat WHERE uid=?").bind(me.id).first();
  if(r&&r.ut>ut)return out(env,{ok:false,newer:true,ut:r.ut},409);
  await env.DB.prepare("INSERT OR REPLACE INTO dat(uid,j,ut) VALUES(?,?,?)").bind(me.id,j,ut).run();return out(env,{ok:true,ut})}
 if(p==="/delete"&&req.method==="POST"){
  const r=await env.DB.prepare("SELECT salt,hash FROM users WHERE id=?").bind(me.id).first();
  if(!r||!same(await pbk(String(b.password||""),r.salt),r.hash))return out(env,{error:"login"},401);
  await env.DB.batch(["users WHERE id","sess WHERE uid","dat WHERE uid","codes WHERE uid"].map(t=>env.DB.prepare("DELETE FROM "+t+"=?").bind(me.id)));return out(env,{ok:true})}
 return out(env,{error:"route"},404);
 }catch(e){return out(env,{error:String(e&&e.message).indexOf("mail")===0?"mail":"server"},500)}
}};
