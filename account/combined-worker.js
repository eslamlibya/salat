// الصلاة — خادم موحّد: الإشعارات + الحسابات (Cloudflare Worker + D1)
// المتغيرات: VAPID_PUBLIC، VAPID_PRIVATE (سر)، ربط D1 باسم DB
// الحسابات: MAIL_FROM (نص)، BREVO_KEY (سر)
// الصلاة — خادم الإشعارات (Cloudflare Worker + D1)
// المتغيرات المطلوبة: VAPID_PUBLIC (نص)، VAPID_PRIVATE (سر)، ربط قاعدة D1 باسم DB
// اختياري: ALLOWED_ORIGIN (مثل https://eslamlibya.github.io)، SUBJECT (رابط موقعك)
const HOSTS=[/(^|\.)push\.apple\.com$/,/(^|\.)googleapis\.com$/,/(^|\.)push\.services\.mozilla\.com$/,/(^|\.)notify\.windows\.com$/];
const okEp=u=>{try{const x=new URL(u);return x.protocol==="https:"&&HOSTS.some(r=>r.test(x.hostname))}catch(e){return false}};
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64u=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");s+="=".repeat((4-s.length%4)%4);return Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
const te=new TextEncoder();
let KEY=null,READY=false;
async function key(env){if(KEY)return KEY;const p=unb64u(env.VAPID_PUBLIC);KEY=await crypto.subtle.importKey("jwk",{kty:"EC",crv:"P-256",x:b64u(p.slice(1,33)),y:b64u(p.slice(33,65)),d:env.VAPID_PRIVATE,ext:true},{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);return KEY}
async function jwt(env,aud){const h=b64u(te.encode(JSON.stringify({typ:"JWT",alg:"ES256"}))),p=b64u(te.encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+43200,sub:env.SUBJECT||"https://eslamlibya.github.io/salat"})));const s=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},await key(env),te.encode(h+"."+p));return h+"."+p+"."+b64u(s)}
async function push(env,ep){if(!env.VAPID_PUBLIC||!env.VAPID_PRIVATE)throw new Error("vapid-config");const aud=new URL(ep).origin;const r=await fetch(ep,{method:"POST",headers:{Authorization:"vapid t="+await jwt(env,aud)+", k="+env.VAPID_PUBLIC,TTL:"3600",Urgency:"high","Content-Length":"0"}});return r.status}
async function init(env){if(READY)return;await env.DB.prepare("CREATE TABLE IF NOT EXISTS sched(endpoint TEXT NOT NULL,t INTEGER NOT NULL)").run();await env.DB.prepare("CREATE INDEX IF NOT EXISTS ix_t ON sched(t)").run();READY=true}
const cors=(env,req)=>({"Access-Control-Allow-Origin":env.ALLOWED_ORIGIN||"https://eslamlibya.github.io","Access-Control-Allow-Methods":"POST,GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"});
const out=(env,req,o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors(env,req),"Content-Type":"application/json"}});
const PUSH={
async fetch(req,env){
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(env,req)});
 const u=new URL(req.url);
 if(req.method==="GET")return out(env,req,{ok:true,name:"salat-push"});
 if(req.method!=="POST")return out(env,req,{error:"method"},405);
 let b;try{const tx=await req.text();if(tx.length>20000)return out(env,req,{error:"big"},413);b=JSON.parse(tx)}catch(e){return out(env,req,{error:"json"},400)}
 if(!b||!okEp(b.endpoint))return out(env,req,{error:"endpoint"},400);
 await init(env);const db=env.DB;
 if(!await ACC.rl(env,"p:"+(req.headers.get("CF-Connecting-IP")||"x"),u.pathname==="/test"?10:60,36e5))return out(env,req,{error:"rate"},429);
 if(u.pathname==="/sub"){
  const now=Date.now(),ts=(Array.isArray(b.times)?b.times:[]).filter(t=>Number.isInteger(t)&&t>now-120000&&t<now+9*864e5).slice(0,200);
  await db.prepare("DELETE FROM sched WHERE endpoint=?").bind(b.endpoint).run();
  if(ts.length)await db.batch(ts.map(t=>db.prepare("INSERT INTO sched(endpoint,t) VALUES(?,?)").bind(b.endpoint,t)));
  return out(env,req,{ok:true,n:ts.length});
 }
 if(u.pathname==="/unsub"){await db.prepare("DELETE FROM sched WHERE endpoint=?").bind(b.endpoint).run();return out(env,req,{ok:true})}
 if(u.pathname==="/test"){try{const s=await push(env,b.endpoint);return out(env,req,{ok:s>=200&&s<300,status:s})}catch(e){return out(env,req,{error:"server-config"},500)}}
 return out(env,req,{error:"route"},404);
},
async scheduled(ev,env,ctx){ctx.waitUntil((async()=>{
 await init(env);const db=env.DB,now=Date.now();
 // نافذة 15 دقيقة، والصف لا يُحذف إلا بعد قبول الإرسال (إعادة محاولة تلقائية كل دقيقة)
 const r=await db.prepare("SELECT rowid AS id,endpoint FROM sched WHERE t<=?1 AND t>?2 ORDER BY t LIMIT 90").bind(now,now-15*60000).all();
 const rows=r.results||[];
 for(let i=0;i<rows.length;i+=10){await Promise.all(rows.slice(i,i+10).map(async x=>{
  try{let s=await push(env,x.endpoint);if(s>=500||s===429)s=await push(env,x.endpoint);
   if(s>=200&&s<300)await db.prepare("DELETE FROM sched WHERE rowid=?").bind(x.id).run();
   else if(s===404||s===410)await db.prepare("DELETE FROM sched WHERE endpoint=?").bind(x.endpoint).run();
  }catch(e){}}))}
 await db.prepare("DELETE FROM sched WHERE t<?").bind(now-15*60000).run();
 try{await db.prepare("CREATE TABLE IF NOT EXISTS bq(endpoint TEXT PRIMARY KEY)").run();const q=await db.prepare("SELECT endpoint FROM bq LIMIT 30").all();for(const x of(q.results||[])){try{const s=await push(env,x.endpoint);if(s===404||s===410)await db.prepare("DELETE FROM sched WHERE endpoint=?").bind(x.endpoint).run()}catch(e){}await db.prepare("DELETE FROM bq WHERE endpoint=?").bind(x.endpoint).run()}}catch(e){}
})())}
};
const ACC=(()=>{
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
 d.prepare("CREATE TABLE IF NOT EXISTS rl(k TEXT PRIMARY KEY,n INTEGER NOT NULL,w INTEGER NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS cfg(k TEXT PRIMARY KEY,v TEXT NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS bq(endpoint TEXT PRIMARY KEY)"),
 d.prepare("CREATE TABLE IF NOT EXISTS sched(endpoint TEXT NOT NULL,t INTEGER NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS subs(uid INTEGER PRIMARY KEY,plan TEXT NOT NULL,exp INTEGER NOT NULL,ut INTEGER NOT NULL,note TEXT)"),
 d.prepare("CREATE TABLE IF NOT EXISTS fin(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,kind TEXT NOT NULL,amt REAL NOT NULL,cur TEXT NOT NULL,cat TEXT,note TEXT,uid INTEGER)"),
 d.prepare("CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,a TEXT NOT NULL,d TEXT)"),
 d.prepare("CREATE TABLE IF NOT EXISTS sch(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,title TEXT,body TEXT,rep TEXT,done INTEGER NOT NULL DEFAULT 0)"),
 d.prepare("CREATE TABLE IF NOT EXISTS blk(uid INTEGER PRIMARY KEY)"),
 d.prepare("CREATE TABLE IF NOT EXISTS tk(id INTEGER PRIMARY KEY AUTOINCREMENT,th TEXT UNIQUE NOT NULL,uid INTEGER,nm TEXT,ct TEXT,app TEXT,st TEXT NOT NULL,cr INTEGER NOT NULL,ut INTEGER NOT NULL,au INTEGER NOT NULL DEFAULT 0)"),
 d.prepare("CREATE TABLE IF NOT EXISTS ta(mid INTEGER PRIMARY KEY,k TEXT NOT NULL,mime TEXT NOT NULL,d TEXT NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS inst(id TEXT PRIMARY KEY,kd TEXT NOT NULL,first INTEGER NOT NULL,last INTEGER NOT NULL,n INTEGER NOT NULL,ver INTEGER,cc TEXT)"),
 d.prepare("CREATE TABLE IF NOT EXISTS iloc(id TEXT PRIMARY KEY,cc TEXT,rg TEXT,ct TEXT,lat REAL,lon REAL,uid INTEGER)"),
 d.prepare("CREATE TABLE IF NOT EXISTS tn(mid INTEGER PRIMARY KEY,name TEXT NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS tm(id INTEGER PRIMARY KEY AUTOINCREMENT,tid INTEGER NOT NULL,who TEXT NOT NULL,body TEXT NOT NULL,t INTEGER NOT NULL)"),
 d.prepare("CREATE TABLE IF NOT EXISTS dev(uid INTEGER NOT NULL,did TEXT NOT NULL,nm TEXT NOT NULL,kd TEXT NOT NULL,j TEXT NOT NULL,ut INTEGER NOT NULL,cmd TEXT,PRIMARY KEY(uid,did))")]);READY=true}
const cors=env=>({"Access-Control-Allow-Origin":env.ALLOWED_ORIGIN||"https://eslamlibya.github.io","Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Vary":"Origin"});
const out=(env,o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors(env),"Content-Type":"application/json","Cache-Control":"no-store"}});
async function limit(env,k,max,win){const now=Date.now(),r=await env.DB.prepare("SELECT n,w FROM rl WHERE k=?").bind(k).first();
 if(!r||now-r.w>win){await env.DB.prepare("INSERT OR REPLACE INTO rl(k,n,w) VALUES(?,1,?)").bind(k,now).run();return true}
 if(r.n>=max)return false;await env.DB.prepare("UPDATE rl SET n=n+1 WHERE k=?").bind(k).run();return true}
async function mail(env,to,subject,html){if(!env.BREVO_KEY||!env.MAIL_FROM)throw new Error("mail-config");
 const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":env.BREVO_KEY,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({sender:{name:"الصلاة",email:env.MAIL_FROM},to:[{email:to}],subject,htmlContent:html})});
 if(!r.ok){let t="";try{t=(await r.text()).replace(/[^A-Za-z0-9 _:.,-]/g,"").slice(0,60)}catch(e){}throw new Error("mail-"+r.status+" "+t)}}
async function sendCode(env,u,kind){const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0"),now=Date.now();
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
async function newSess(env,uid){const t=rnd(32);await env.DB.prepare("INSERT INTO sess(th,uid,exp) VALUES(?,?,?)").bind(await sha(t),uid,Date.now()+30*864e5).run();return t}
async function auth(env,req){const h=req.headers.get("Authorization")||"";if(h.slice(0,7)!=="Bearer ")return null;
 const r=await env.DB.prepare("SELECT u.id,u.email,u.username,u.name,s.exp,(SELECT 1 FROM blk WHERE uid=u.id) bk FROM sess s JOIN users u ON u.id=s.uid WHERE s.th=?").bind(await sha(h.slice(7))).first();
 return r&&r.exp>Date.now()&&!r.bk?r:null}
const proOf=async(env,uid)=>{const r=await env.DB.prepare("SELECT plan,exp FROM subs WHERE uid=?").bind(uid).first();return r&&r.exp>Date.now()?{plan:r.plan,exp:r.exp}:null};
async function bcast(env,title,body){await env.DB.prepare("INSERT OR REPLACE INTO cfg(k,v) VALUES(?,?)").bind("bc",JSON.stringify({id:Date.now(),t:Date.now(),title:title||"Taz",body:body||"",url:""})).run();await env.DB.prepare("INSERT OR IGNORE INTO bq(endpoint) SELECT DISTINCT endpoint FROM sched").run()}
const pub=u=>({id:u.id,email:u.email,username:u.username,name:u.name});
const EM=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/,UN=/^[a-z0-9_]{3,20}$/;
return{rl:async(...a)=>{await init(a[0]);return limit(...a)},async tick(env){await init(env);const now=Date.now(),r=await env.DB.prepare("SELECT * FROM sch WHERE done=0 AND at<=? ORDER BY at LIMIT 5").bind(now).all();for(const x of(r.results||[])){if(now-x.at>6*36e5&&!x.rep){await env.DB.prepare("UPDATE sch SET done=1 WHERE id=?").bind(x.id).run();continue}await bcast(env,x.title,x.body);if(x.rep==="d"||x.rep==="w"){let n=x.at;const st=x.rep==="d"?864e5:6048e5;while(n<=now)n+=st;await env.DB.prepare("UPDATE sch SET at=? WHERE id=?").bind(n,x.id).run()}else await env.DB.prepare("UPDATE sch SET done=1 WHERE id=?").bind(x.id).run()}},async fetch(req,env){
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(env)});
 const u=new URL(req.url),p=u.pathname,ip=req.headers.get("CF-Connecting-IP")||"x";
 if(req.method==="GET"&&p==="/")return out(env,{ok:true,name:"salat-account"});
 try{await init(env);
 let b={};if(req.method==="POST"||req.method==="PUT"){const tx=await req.text();if(tx.length>(p==="/sup/send"?1100000:400000))return out(env,{error:"big"},413);try{b=JSON.parse(tx||"{}")}catch(e){return out(env,{error:"json"},400)}}

 if(p==="/cfg"&&req.method==="GET"){const rs=await env.DB.prepare("SELECT k,v FROM cfg").all(),c={};(rs.results||[]).forEach(x=>{try{c[x.k]=JSON.parse(x.v)}catch(e){}});return out(env,{ok:true,flags:c.flags||{},bc:c.bc||null,ver:c.ver||0,ct:c.content||{}})}
 if(p.indexOf("/admin/")===0){
  if(!env.ADMIN_KEY)return out(env,{error:"no-admin-key"},503);
  const ak=(req.headers.get("Authorization")||"").slice(7);
  const bl=await env.DB.prepare("SELECT n,w FROM rl WHERE k=?").bind("admf:"+ip).first();if(bl&&bl.n>=10&&Date.now()-bl.w<36e5)return out(env,{error:"rate"},429);
  if(!ak||!same(await sha(ak),await sha(env.ADMIN_KEY))){await limit(env,"admf:"+ip,10,36e5);return out(env,{error:"auth"},401)}
  const DB=env.DB,now=Date.now(),setc=(k,v)=>DB.prepare("INSERT OR REPLACE INTO cfg(k,v) VALUES(?,?)").bind(k,JSON.stringify(v)).run(),getc=async k=>{const x=await DB.prepare("SELECT v FROM cfg WHERE k=?").bind(k).first();try{return x?JSON.parse(x.v):null}catch(e){return null}};
  if(req.method!=="GET"){try{await DB.prepare("INSERT INTO log(t,a,d) VALUES(?,?,?)").bind(now,p,JSON.stringify(b).slice(0,200)).run();await DB.prepare("DELETE FROM log WHERE id<(SELECT MAX(id)-500 FROM log)").run()}catch(e){}}
  if(p==="/admin/stats"){const n=async q=>{const x=await DB.prepare(q).first();return x?x.n:0};
   const rec=await DB.prepare("SELECT username,name,verified,created FROM users ORDER BY created DESC LIMIT 8").all();
   return out(env,{ok:true,users:await n("SELECT COUNT(*) n FROM users"),verified:await n("SELECT COUNT(*) n FROM users WHERE verified=1"),withData:await n("SELECT COUNT(*) n FROM dat"),sessions:await n("SELECT COUNT(*) n FROM sess WHERE exp>"+now),devices:await n("SELECT COUNT(DISTINCT endpoint) n FROM sched"),queue:await n("SELECT COUNT(*) n FROM bq"),recent:rec.results||[],act24:await n("SELECT COUNT(DISTINCT uid) n FROM dev WHERE ut>"+(now-864e5)),act7:await n("SELECT COUNT(DISTINCT uid) n FROM dev WHERE ut>"+(now-6048e5)),new7:await n("SELECT COUNT(*) n FROM users WHERE created>"+(now-6048e5)),devTotal:await n("SELECT COUNT(*) n FROM dev"),playing:await n("SELECT COUNT(*) n FROM dev WHERE ut>"+(now-12e4)+" AND (j LIKE '%\"act\":\"listen\"%' OR j LIKE '%\"act\":\"read\"%' OR j LIKE '%\"act\":\"radio\"%')"),kinds:((await DB.prepare("SELECT kd,COUNT(*) n FROM dev WHERE ut>? GROUP BY kd").bind(now-6048e5).all()).results||[]),daily:((await DB.prepare("SELECT strftime('%m-%d',created/1000,'unixepoch') d,COUNT(*) n FROM users WHERE created>? GROUP BY d ORDER BY d").bind(now-12096e5).all()).results||[]),ver:await getc("ver")||0,bc:await getc("bc"),flags:await getc("flags")||{},top:await(async()=>{const m={};((await DB.prepare("SELECT j FROM dev WHERE ut>? LIMIT 500").bind(now-6048e5).all()).results||[]).forEach(x=>{try{const o=JSON.parse(x.j||"{}");if(o.act=="listen"&&o.t){const k=String(o.t).slice(0,40);m[k]=(m[k]||0)+1}}catch(e){}});return Object.keys(m).map(k=>({t:k,n:m[k]})).sort((a,b)=>b.n-a.n).slice(0,8)})(),subsN:await n("SELECT COUNT(*) n FROM subs WHERE exp>"+now),blocked:await n("SELECT COUNT(*) n FROM blk"),supOpen:await n("SELECT COUNT(*) n FROM tk WHERE au>0"),inst:{total:await n("SELECT COUNT(*) n FROM inst"),d1:await n("SELECT COUNT(*) n FROM inst WHERE last>"+(now-864e5)),d7:await n("SELECT COUNT(*) n FROM inst WHERE last>"+(now-6048e5)),d30:await n("SELECT COUNT(*) n FROM inst WHERE last>"+(now-2592e6)),new1:await n("SELECT COUNT(*) n FROM inst WHERE first>"+(now-864e5)),new7:await n("SELECT COUNT(*) n FROM inst WHERE first>"+(now-6048e5)),kinds:((await DB.prepare("SELECT kd,COUNT(*) n FROM inst WHERE last>? GROUP BY kd").bind(now-2592e6).all()).results||[]),cc:((await DB.prepare("SELECT cc,COUNT(*) n FROM inst WHERE last>? AND cc IS NOT NULL AND cc<>'' GROUP BY cc ORDER BY n DESC LIMIT 8").bind(now-2592e6).all()).results||[]),daily:((await DB.prepare("SELECT strftime('%m-%d',first/1000,'unixepoch') d,COUNT(*) n FROM inst WHERE first>? GROUP BY d ORDER BY d").bind(now-12096e5).all()).results||[]),reg:await n("SELECT COUNT(*) n FROM iloc l JOIN inst i ON i.id=l.id WHERE l.uid IS NOT NULL AND i.last>"+(now-2592e6)),anon:await n("SELECT COUNT(*) n FROM iloc l JOIN inst i ON i.id=l.id WHERE l.uid IS NULL AND i.last>"+(now-2592e6)),cities:((await DB.prepare("SELECT l.cc,l.ct,(l.uid IS NOT NULL) r,COUNT(*) n FROM iloc l JOIN inst i ON i.id=l.id WHERE i.last>? AND l.ct<>'' GROUP BY l.cc,l.ct,r ORDER BY n DESC LIMIT 60").bind(now-2592e6).all()).results||[]),dots:((await DB.prepare("SELECT l.lat la,l.lon lo,MIN(l.ct) ct,(l.uid IS NOT NULL) r,COUNT(*) n FROM iloc l JOIN inst i ON i.id=l.id WHERE i.last>? AND (l.lat<>0 OR l.lon<>0) GROUP BY l.lat,l.lon,r LIMIT 500").bind(now-2592e6).all()).results||[])}})}
  if(p==="/admin/users"){const q="%"+String(u.searchParams.get("q")||"").trim().toLowerCase().replace(/[%_]/g,"")+"%";
   const rs=await DB.prepare("SELECT u.id,u.email,u.username,u.name,u.verified,u.created,d.ut,length(d.j) sz,d.j,(SELECT COUNT(*) FROM dev WHERE uid=u.id) dc FROM users u LEFT JOIN dat d ON d.uid=u.id WHERE lower(u.email) LIKE ?1 OR lower(u.username) LIKE ?1 OR lower(u.name) LIKE ?1 ORDER BY u.created DESC LIMIT 100").bind(q).all();
   return out(env,{ok:true,users:(rs.results||[]).map(x=>{let o={};try{o=JSON.parse(x.j||"{}")}catch(e){}const tv=(o.tv&&o.tv.s)||{};return{id:x.id,email:x.email,username:x.username,name:x.name,verified:x.verified,created:x.created,ut:x.ut||0,dc:x.dc||0,size:x.sz||0,city:o.city,lang:o.lang,th:o.th,auto:o.auto,tvCity:tv.city}})})}
  if(p==="/admin/devices"){const rs=await DB.prepare("SELECT d.uid,d.did,d.nm,d.kd,d.j,d.ut,u.name un,u.username uu FROM dev d LEFT JOIN users u ON u.id=d.uid ORDER BY d.ut DESC LIMIT 300").all();
   return out(env,{ok:true,now,devs:(rs.results||[]).map(x=>{let o={};try{o=JSON.parse(x.j||"{}")}catch(e){}return{uid:x.uid,did:x.did,nm:x.nm,kd:x.kd,ut:x.ut,user:x.un||"",username:x.uu||"",act:o.act||"",title:o.t||"",pl:o.pl?1:0}})})}
  if(p==="/admin/device/delete"&&req.method==="POST"){await DB.prepare("DELETE FROM dev WHERE uid=? AND did=?").bind(+b.uid,String(b.did||"")).run();return out(env,{ok:true})}
  if(p==="/admin/device/cmd"&&req.method==="POST"){const c=String(b.c||"");if(!["pause","pp","nx","pv","vp","vm"].includes(c))return out(env,{error:"bad"},400);await DB.prepare("UPDATE dev SET cmd=? WHERE uid=? AND did=?").bind(JSON.stringify({a:"ctl",c:c,f:"admin",t:now}),+b.uid,String(b.did||"")).run();return out(env,{ok:true})}
  if(b.id!==undefined&&Number.isInteger(+b.id)){const id=+b.id;
   if(p==="/admin/user/delete"){await DB.batch(["users WHERE id","sess WHERE uid","dat WHERE uid","codes WHERE uid"].map(t=>DB.prepare("DELETE FROM "+t+"=?").bind(id)));return out(env,{ok:true})}
   if(p==="/admin/user/wipe"){await DB.prepare("DELETE FROM dat WHERE uid=?").bind(id).run();return out(env,{ok:true})}
   if(p==="/admin/user/devices-clear"){await DB.prepare("DELETE FROM dev WHERE uid=?").bind(id).run();return out(env,{ok:true})}
   if(p==="/admin/user/logout"){await DB.prepare("DELETE FROM sess WHERE uid=?").bind(id).run();return out(env,{ok:true})}
   if(p==="/admin/user/verify"){await DB.prepare("UPDATE users SET verified=1 WHERE id=?").bind(id).run();return out(env,{ok:true})}}
  if(p==="/admin/log"){const rs=await DB.prepare("SELECT t,a,d FROM log ORDER BY id DESC LIMIT 100").all();return out(env,{ok:true,rows:rs.results||[]})}
  if(p==="/admin/fin"&&req.method==="GET"){const f=await DB.prepare("SELECT f.id,f.t,f.kind,f.amt,f.cur,f.cat,f.note,f.uid,u.username FROM fin f LEFT JOIN users u ON u.id=f.uid ORDER BY f.t DESC LIMIT 1000").all(),s=await DB.prepare("SELECT s.uid,s.plan,s.exp,s.ut,s.note,u.name,u.username,u.email FROM subs s LEFT JOIN users u ON u.id=s.uid ORDER BY s.exp DESC LIMIT 500").all();return out(env,{ok:true,now,fin:f.results||[],subs:s.results||[]})}
  if(p==="/admin/fin/add"&&req.method==="POST"){const k=b.kind==="out"?"out":"in",a=Math.round((+b.amt||0)*100)/100;if(!(a>0)||a>1e7)return out(env,{error:"bad"},400);await DB.prepare("INSERT INTO fin(t,kind,amt,cur,cat,note,uid) VALUES(?,?,?,?,?,?,?)").bind(+b.t||now,k,a,String(b.cur||"USD").slice(0,4).toUpperCase(),String(b.cat||"").slice(0,30),String(b.note||"").slice(0,150),+b.uid||null).run();return out(env,{ok:true})}
  if(p==="/admin/fin/del"&&req.method==="POST"){await DB.prepare("DELETE FROM fin WHERE id=?").bind(+b.fid).run();return out(env,{ok:true})}
  if(p==="/admin/sub/grant"&&req.method==="POST"){const q=String(b.u||"").trim().toLowerCase(),r=await DB.prepare("SELECT id FROM users WHERE username=?1 OR email=?1").bind(q).first();if(!r)return out(env,{error:"nouser"},404);
   const days=b.plan==="y"?365:b.plan==="m"?30:Math.max(1,Math.min(3650,+b.days||0));if(!days)return out(env,{error:"bad"},400);const cur=await DB.prepare("SELECT exp FROM subs WHERE uid=?").bind(r.id).first(),base=cur&&cur.exp>now?cur.exp:now,exp=base+days*864e5;
   await DB.prepare("INSERT OR REPLACE INTO subs(uid,plan,exp,ut,note) VALUES(?,?,?,?,?)").bind(r.id,b.plan==="y"?"y":"m",exp,now,String(b.note||"").slice(0,100)).run();
   const a=Math.round((+b.amt||0)*100)/100;if(a>0)await DB.prepare("INSERT INTO fin(t,kind,amt,cur,cat,note,uid) VALUES(?,?,?,?,?,?,?)").bind(now,"in",a,String(b.cur||"USD").slice(0,4).toUpperCase(),"اشتراك",String(b.note||"").slice(0,150),r.id).run();
   return out(env,{ok:true,exp})}
  if(p==="/admin/sub/revoke"&&req.method==="POST"){await DB.prepare("DELETE FROM subs WHERE uid=?").bind(+b.uid).run();return out(env,{ok:true})}
  if(p==="/admin/sched"&&req.method==="GET"){const rs=await DB.prepare("SELECT id,at,title,body,rep,done FROM sch WHERE done=0 ORDER BY at LIMIT 100").all();return out(env,{ok:true,now,rows:rs.results||[]})}
  if(p==="/admin/sched/add"&&req.method==="POST"){const at=+b.at,t=String(b.title||"").slice(0,80).trim(),m=String(b.body||"").slice(0,300).trim();if(!(at>now-6e4)||(!t&&!m))return out(env,{error:"bad"},400);await DB.prepare("INSERT INTO sch(at,title,body,rep) VALUES(?,?,?,?)").bind(at,t,m,b.rep==="d"||b.rep==="w"?b.rep:"").run();return out(env,{ok:true})}
  if(p==="/admin/sched/del"&&req.method==="POST"){await DB.prepare("DELETE FROM sch WHERE id=?").bind(+b.sid).run();return out(env,{ok:true})}
  if(p==="/admin/user/block"&&req.method==="POST"){const id=+b.uid;if(!id)return out(env,{error:"bad"},400);if(b.on){await DB.batch([DB.prepare("INSERT OR IGNORE INTO blk(uid) VALUES(?)").bind(id),DB.prepare("DELETE FROM sess WHERE uid=?").bind(id)])}else await DB.prepare("DELETE FROM blk WHERE uid=?").bind(id).run();return out(env,{ok:true})}
  if(p==="/admin/user/msg"&&req.method==="POST"){const t=String(b.title||"").slice(0,80),m=String(b.body||"").slice(0,300);if(!t&&!m)return out(env,{error:"bad"},400);await DB.prepare("UPDATE dev SET cmd=? WHERE uid=?").bind(JSON.stringify({a:"msg",title:t,body:m,t:now}),+b.uid).run();return out(env,{ok:true})}
  if(p==="/admin/blocked"){const rs=await DB.prepare("SELECT b.uid,u.username,u.name FROM blk b LEFT JOIN users u ON u.id=b.uid").all();return out(env,{ok:true,rows:rs.results||[]})}
  if(p==="/admin/sup"&&req.method==="GET"){const rs=await DB.prepare("SELECT t.id,t.nm,t.ct,t.app,t.st,t.cr,t.ut,t.au,t.uid,(SELECT body FROM tm WHERE tid=t.id ORDER BY id DESC LIMIT 1) last,(SELECT username FROM users WHERE id=t.uid) un FROM tk t ORDER BY (t.au>0) DESC,t.ut DESC LIMIT 200").all();return out(env,{ok:true,rows:rs.results||[]})}
  if(p==="/admin/sup/thread"&&req.method==="GET"){const id=+u.searchParams.get("tid"),t=await DB.prepare("SELECT id,nm,ct,app,st,uid FROM tk WHERE id=?").bind(id).first();if(!t)return out(env,{error:"route"},404);const m=await DB.prepare("SELECT id mid,who,body,t,(SELECT k FROM ta WHERE mid=tm.id) ak,(SELECT name FROM tn WHERE mid=tm.id) fn FROM tm WHERE tid=? ORDER BY id").bind(id).all();await DB.prepare("UPDATE tk SET au=0 WHERE id=?").bind(id).run();return out(env,{ok:true,tk:t,msgs:m.results||[]})}
  if(p==="/admin/sup/reply"&&req.method==="POST"){const id=+b.tid,body=String(b.body||"").trim().slice(0,1000),t=await DB.prepare("SELECT id,uid FROM tk WHERE id=?").bind(id).first();if(!t||!body)return out(env,{error:"bad"},400);await DB.batch([DB.prepare("INSERT INTO tm(tid,who,body,t) VALUES(?,?,?,?)").bind(id,"a",body,now),DB.prepare("UPDATE tk SET au=0,st='answered',ut=? WHERE id=?").bind(now,id)]);if(t.uid)await DB.prepare("UPDATE dev SET cmd=? WHERE uid=?").bind(JSON.stringify({a:"msg",title:"رد من الدعم",body:body.slice(0,300),t:now}),t.uid).run();return out(env,{ok:true})}
  if(p==="/admin/sup/att"&&req.method==="GET"){const r=await DB.prepare("SELECT mime,d,(SELECT name FROM tn WHERE mid=ta.mid) fn FROM ta WHERE mid=?").bind(+u.searchParams.get("mid")).first();return r?out(env,{ok:true,mime:r.mime,d:r.d,fn:r.fn||""}):out(env,{error:"route"},404)}
  if(p==="/admin/sup/close"&&req.method==="POST"){await DB.prepare("UPDATE tk SET st=? WHERE id=?").bind(b.on?"closed":"open",+b.tid).run();return out(env,{ok:true})}
  if(p==="/admin/sup/del"&&req.method==="POST"){await DB.batch([DB.prepare("DELETE FROM ta WHERE mid IN (SELECT id FROM tm WHERE tid=?)").bind(+b.tid),DB.prepare("DELETE FROM tn WHERE mid IN (SELECT id FROM tm WHERE tid=?)").bind(+b.tid),DB.prepare("DELETE FROM tm WHERE tid=?").bind(+b.tid),DB.prepare("DELETE FROM tk WHERE id=?").bind(+b.tid)]);return out(env,{ok:true})}
  if(p==="/admin/reciters"&&req.method==="GET"){try{const r=await fetch("https://mp3quran.net/api/v3/reciters?language=ar");if(!r.ok)throw new Error("HTTP "+r.status);const d=await r.json();return out(env,{ok:true,reciters:(d.reciters||[]).map(x=>({id:x.id,name:x.name}))})}catch(e){return out(env,{error:"fetch "+String(e&&e.message||e).slice(0,80)},502)}}
  if(p==="/admin/radios"&&req.method==="GET"){try{const H=["https://de1.api.radio-browser.info","https://nl1.api.radio-browser.info","https://at1.api.radio-browser.info"],g=async q=>{for(const h of H){try{const r=await fetch(h+"/json/stations/"+q);if(r.ok)return await r.json()}catch(e){}}return[]};const a=await Promise.all([g("search?countrycode=LY&name=quran&hidebroken=true&order=votes&reverse=true&limit=15"),g("search?countrycode=LY&tag=quran&hidebroken=true&limit=15"),g("search?name=libya%20quran&hidebroken=true&limit=10"),g("search?tag=quran&hidebroken=true&order=votes&reverse=true&limit=30")]),seen={},l=[];a.forEach(x=>(Array.isArray(x)?x:[]).forEach(y=>{const u=String(y.url_resolved||y.url||"").replace(/^http:/,"https:");if(!/^https:/.test(u)||seen[u])return;seen[u]=1;l.push({t:String(y.name||"إذاعة").trim().slice(0,80),u,c:y.country||""})}));return out(env,{ok:true,radios:l})}catch(e){return out(env,{error:"radios"},502)}}
  if(p==="/admin/pdsearch"&&req.method==="GET"){try{const q=String(new URL(req.url).searchParams.get("q")||"").slice(0,100);if(!q)return out(env,{ok:true,items:[]});const r=await fetch("https://archive.org/advancedsearch.php?q="+encodeURIComponent("("+q+") AND mediatype:audio")+"&fl[]=identifier&fl[]=title&rows=40&sort[]="+encodeURIComponent("downloads desc")+"&output=json");const d=await r.json();return out(env,{ok:true,items:((d.response||{}).docs||[]).map(x=>({id:x.identifier,t:x.title||x.identifier}))})}catch(e){return out(env,{error:"search"},502)}}
  if(p==="/admin/content"&&req.method==="GET"){const r=await DB.prepare("SELECT v FROM cfg WHERE k='content'").first();let c={};try{c=JSON.parse((r&&r.v)||"{}")}catch(e){}return out(env,{ok:true,content:c})}
  if(p==="/admin/content"&&req.method==="PUT"){const c=b.content;if(!c||typeof c!=="object")return out(env,{error:"bad"},400);const T=(v,n)=>String(v==null?"":v).slice(0,n),H=v=>/^https:\/\/[^\s"'<>]+$/.test(String(v||""))?String(v).slice(0,400):"";
   const o={r:[],a:[],z:[],e:[],h:[],hd:[],hr:[],rn:{},pc:[],ph:[],ra:[],v:[],ad:H(c.ad),of:(Array.isArray(c.of)?c.of:[]).slice(0,5).map(x=>Math.max(-30,Math.min(30,Math.round(+x||0))))};(Array.isArray(c.hr)?c.hr:[]).slice(0,1500).forEach(k=>{k=+k;if(k>0&&k<900000)o.hr.push(k)});if(c.rn&&typeof c.rn=="object")Object.keys(c.rn).slice(0,400).forEach(k=>{const n=T(c.rn[k],80).trim();if(/^\d{1,6}$/.test(k)&&n)o.rn[k]=n});(Array.isArray(c.pc)?c.pc:[]).slice(0,30).forEach(x=>{const n=T(x.n,40).trim(),q=T(x.q,120).trim();if(n&&q)o.pc.push({n,q})});(Array.isArray(c.ph)?c.ph:[]).slice(0,800).forEach(k=>{k=T(k,300);if(/^[cir]\|/.test(k))o.ph.push(k)});(Array.isArray(c.ra)?c.ra:[]).slice(0,100).forEach(x=>{const u=H(x.u),t=T(x.t,80).trim();if(u&&t)o.ra.push({t,u,c:T(x.c,60).trim()})});(Array.isArray(c.hd)?c.hd:[]).slice(0,600).forEach(k=>{k=T(k,200);if(/^\d+\|/.test(k))o.hd.push(k)});(Array.isArray(c.h)?c.h:[]).slice(0,300).forEach(x=>{if(T(x.t,1500).trim())o.h.push({id:+x.id||0,t:T(x.t,1500).trim(),s:T(x.s,100).trim(),n:T(x.n,600).trim()})});(Array.isArray(c.v)?c.v:[]).slice(0,400).forEach(x=>{if(T(x.t,400).trim())o.v.push({t:T(x.t,400).trim(),s:T(x.s,80).trim()})});const D=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""))?String(v):"";(Array.isArray(c.e)?c.e:[]).slice(0,80).forEach(x=>{const k=T(x.c,2).toUpperCase();if(!/^[A-Z]{2}$/.test(k))return;const e={c:k,ram:D(x.ram),fit:D(x.fit),adha:D(x.adha),src:T(x.src,80).trim()};if(e.ram||e.fit||e.adha)o.e.push(e)});(Array.isArray(c.r)?c.r:[]).slice(0,100).forEach(x=>{const s=H(x.s);if(!s||!T(x.n,80).trim())return;o.r.push({id:+x.id||0,n:T(x.n,80).trim(),s:s,m:T(x.m,60).trim(),l:T(x.l,700).replace(/[^0-9,]/g,"")})});
   (Array.isArray(c.a)?c.a:[]).slice(0,200).forEach(x=>{const u=H(x.u);if(!u||!T(x.t,100).trim())return;o.a.push({id:+x.id||0,t:T(x.t,100).trim(),u:u,k:x.k==="p"?"p":"s",d:T(x.d,150).trim()})});
   (Array.isArray(c.z)?c.z:[]).slice(0,200).forEach(x=>{if(!T(x.t,100).trim())return;o.z.push({id:+x.id||0,c:Math.max(0,Math.min(8,+x.c||0)),t:T(x.t,100).trim(),x:T(x.x,1500).trim(),n:T(x.n,60).trim()})});
   if(JSON.stringify(o).length>90000)return out(env,{error:"bad"},400);await setc("content",o);return out(env,{ok:true,content:o})}
  if(p==="/admin/flags"&&req.method==="PUT"){const f=b.flags;if(!f||typeof f!=="object"||JSON.stringify(f).length>5000)return out(env,{error:"bad"},400);await setc("flags",f);return out(env,{ok:true})}
  if(p==="/admin/broadcast"&&req.method==="POST"){const t=String(b.title||"").slice(0,80).trim(),m=String(b.body||"").slice(0,300).trim();if(!t&&!m)return out(env,{error:"empty"},400);
   await setc("bc",{id:now,t:now,title:t||"Taz",body:m,url:String(b.url||"").slice(0,200)});
   const x=await DB.prepare("INSERT OR IGNORE INTO bq(endpoint) SELECT DISTINCT endpoint FROM sched").run();
   const c=await DB.prepare("SELECT COUNT(*) n FROM bq").first();return out(env,{ok:true,queued:c?c.n:0})}
  if(p==="/admin/update"&&req.method==="POST"){const v=now;await setc("ver",v);return out(env,{ok:true,ver:v})}
  return out(env,{error:"route"},404)}


 if(p==="/live"&&req.method==="GET"){const now=Date.now();if(globalThis.__lv&&now-globalThis.__lv.t<240000)return out(env,{ok:true,u:globalThis.__lv.u});try{const r=await fetch("https://aloula.faulio.com/api/v1.1/channels/7/player",{headers:{"Origin":"https://aloula.sba.sa","Referer":"https://aloula.sba.sa/","Accept":"application/json"}});const t=await r.text();const m=t.replace(/\\\//g,"/").match(/https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*/);if(!m)return out(env,{error:"nolink",st:r.status,len:t.length},502);globalThis.__lv={t:now,u:m[0]};return out(env,{ok:true,u:m[0]})}catch(e){return out(env,{error:"live"},502)}}
 if(p==="/ping"&&req.method==="POST"){
  if(!await limit(env,"pg:"+ip,120,36e5))return out(env,{ok:true});
  const id=String(b.id||""),kd=String(b.kd||""),v=Math.max(0,Math.min(99999,+b.v||0)),cc=String((req.cf&&req.cf.country)||"").slice(0,2).toUpperCase(),now=Date.now();
  if(!/^[a-z0-9]{8,32}$/.test(id)||!["phone","pc","tv","car"].includes(kd))return out(env,{ok:true});
  await env.DB.prepare("INSERT INTO inst(id,kd,first,last,n,ver,cc) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET last=excluded.last,n=n+1,kd=excluded.kd,ver=excluded.ver,cc=CASE WHEN excluded.cc<>'' THEN excluded.cc ELSE cc END").bind(id,kd,now,now,v,cc).run();
  try{const f=req.cf||{},me=await auth(env,req),la=Math.round((+f.latitude||0)*10)/10,lo=Math.round((+f.longitude||0)*10)/10;await env.DB.prepare("INSERT INTO iloc(id,cc,rg,ct,lat,lon,uid) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cc=excluded.cc,rg=excluded.rg,ct=excluded.ct,lat=excluded.lat,lon=excluded.lon,uid=COALESCE(excluded.uid,uid)").bind(id,cc,String(f.region||"").slice(0,40),String(f.city||"").slice(0,40),la,lo,me?me.id:null).run()}catch(e){}
  return out(env,{ok:true})}
 if(p==="/sup/send"&&req.method==="POST"){
  if(!await limit(env,"sp:"+ip,20,36e5))return out(env,{error:"rate"},429);
  const tok=String(b.tok||""),body=String(b.body||"").trim().slice(0,1000),at=b.att&&typeof b.att==="object"?b.att:null;let am="",ad="",ak="",an="";
  if(at){am=String(at.mime||"").split(";")[0].toLowerCase();ad=String(at.d||"");ak=at.k==="v"?"v":at.k==="f"?"f":"i";const okm=ak==="i"?["image/jpeg","image/png","image/webp"]:ak==="v"?["audio/webm","audio/mp4","audio/ogg","audio/mpeg","audio/aac","audio/x-m4a","audio/wav"]:["application/pdf","text/plain","text/csv","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];if(!okm.includes(am)||!ad||ad.length>(ak==="f"?960000:330000)||!/^[A-Za-z0-9+\/=]+$/.test(ad))return out(env,{error:"att"},400);an=String(at.name||"file").replace(/[^\w.\- \u0600-\u06FF]/g,"").slice(0,60)||"file"}
  if(tok.length<16||tok.length>64||(!body&&!at))return out(env,{error:"bad"},400);
  if(!await limit(env,"spt:"+tok,15,36e5))return out(env,{error:"rate"},429);
  const th=await sha(tok),now=Date.now(),me=await auth(env,req),uid=me?me.id:null,nm=String(b.nm||"").trim().slice(0,40),ct=String(b.ct||"").trim().slice(0,80),app=String(b.app||"").slice(0,10);
  let t=await env.DB.prepare("SELECT id FROM tk WHERE th=?").bind(th).first();
  if(!t){const r=await env.DB.prepare("INSERT INTO tk(th,uid,nm,ct,app,st,cr,ut,au) VALUES(?,?,?,?,?,'open',?,?,1)").bind(th,uid,nm||(me?me.name:""),ct||(me?me.email:""),app,now,now).run();t={id:r.meta.last_row_id}}
  else await env.DB.prepare("UPDATE tk SET st='open',ut=?,au=au+1,uid=COALESCE(?,uid),nm=CASE WHEN ?<>'' THEN ? ELSE nm END,ct=CASE WHEN ?<>'' THEN ? ELSE ct END,app=? WHERE id=?").bind(now,uid,nm,nm,ct,ct,app,t.id).run();
  const mr=await env.DB.prepare("INSERT INTO tm(tid,who,body,t) VALUES(?,?,?,?)").bind(t.id,"u",body,now).run();if(at){await env.DB.prepare("INSERT INTO ta(mid,k,mime,d) VALUES(?,?,?,?)").bind(mr.meta.last_row_id,ak,am,ad).run();if(ak==="f")await env.DB.prepare("INSERT INTO tn(mid,name) VALUES(?,?)").bind(mr.meta.last_row_id,an).run()}
  return out(env,{ok:true})}
 if(p==="/sup/get"&&req.method==="POST"){
  const tok=String(b.tok||"");if(tok.length<16||tok.length>64)return out(env,{error:"bad"},400);
  if(!await limit(env,"spg:"+ip,240,36e5))return out(env,{error:"rate"},429);
  const t=await env.DB.prepare("SELECT id,st FROM tk WHERE th=?").bind(await sha(tok)).first();if(!t)return out(env,{ok:true,msgs:[]});
  const m=await env.DB.prepare("SELECT id mid,who,body,t,(SELECT k FROM ta WHERE mid=tm.id) ak,(SELECT name FROM tn WHERE mid=tm.id) fn FROM tm WHERE tid=? ORDER BY id DESC LIMIT 50").bind(t.id).all();return out(env,{ok:true,st:t.st,msgs:(m.results||[]).reverse()})}
 if(p==="/sup/att"&&req.method==="POST"){const tok=String(b.tok||"");if(tok.length<16||tok.length>64)return out(env,{error:"bad"},400);if(!await limit(env,"spa:"+ip,120,36e5))return out(env,{error:"rate"},429);
  const r=await env.DB.prepare("SELECT a.mime,a.d,(SELECT name FROM tn WHERE mid=a.mid) fn FROM ta a JOIN tm m ON m.id=a.mid JOIN tk t ON t.id=m.tid WHERE a.mid=? AND t.th=?").bind(+b.mid,await sha(tok)).first();return r?out(env,{ok:true,mime:r.mime,d:r.d,fn:r.fn||""}):out(env,{error:"route"},404)}
 if(p==="/register"&&req.method==="POST"){
  if(!await limit(env,"reg:"+ip,10,36e5))return out(env,{error:"rate"},429);
  const name=String(b.name||"").trim(),un=String(b.username||"").trim().toLowerCase(),em=String(b.email||"").trim().toLowerCase(),pw=String(b.password||"");
  if(name.length<2||name.length>60)return out(env,{error:"name"},400);
  if(!UN.test(un))return out(env,{error:"username"},400);
  if(!EM.test(em)||em.length>120)return out(env,{error:"email"},400);
  if(pw.length<8||pw.length>100)return out(env,{error:"password"},400);
  const ex=await env.DB.prepare("SELECT id,verified,email,username FROM users WHERE email=? OR username=?").bind(em,un).first();
  if(ex&&ex.verified){if(ex.email!==em)return out(env,{error:"username_taken"},409);if(await limit(env,"note:"+em,1,36e5))await mail(env,em,"الصلاة — محاولة تسجيل","<div dir=\"rtl\"><p>حاول أحدهم التسجيل بهذا البريد وهو مسجّل لديك أصلاً. إن كنت أنت فاستخدم «نسيت كلمة المرور». وإلا فتجاهل الرسالة.</p></div>").catch(()=>{});return out(env,{ok:true,need:"verify",wait:false})}
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
  if(!await limit(env,"lgu:"+id+":"+ip,8,15*60000))return out(env,{error:"rate"},429);
  const r=await env.DB.prepare("SELECT * FROM users WHERE email=? OR username=?").bind(id,id).first();
  const salt=r?r.salt:rnd(16),h=await pbk(pw,salt);
  if(!r||!same(h,r.hash))return out(env,{error:"login"},401);
  if(await env.DB.prepare("SELECT 1 FROM blk WHERE uid=?").bind(r.id).first())return out(env,{error:"blocked"},403);
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
 if(p==="/me"&&req.method==="GET")return out(env,{ok:true,user:pub(me),pro:await proOf(env,me.id)});
 if(p==="/logout"&&req.method==="POST"){if(b.all){await env.DB.prepare("DELETE FROM sess WHERE uid=?").bind(me.id).run();return out(env,{ok:true})}await env.DB.prepare("DELETE FROM sess WHERE th=?").bind(await sha(req.headers.get("Authorization").slice(7))).run();return out(env,{ok:true})}
 if(p==="/data"&&req.method==="GET"){const r=await env.DB.prepare("SELECT j,ut FROM dat WHERE uid=?").bind(me.id).first();return out(env,{ok:true,j:r?r.j:null,ut:r?r.ut:0})}
 if(p==="/data"&&req.method==="PUT"){
  if(!await limit(env,"dt:"+me.id,120,36e5))return out(env,{error:"rate"},429);
  const j=typeof b.j==="string"?b.j:"",ut=Number.isFinite(b.ut)?Math.floor(b.ut):Date.now();
  if(!j||j.length>300000)return out(env,{error:"size"},413);try{JSON.parse(j)}catch(e){return out(env,{error:"json"},400)}
  const r=await env.DB.prepare("SELECT ut FROM dat WHERE uid=?").bind(me.id).first();
  if(r&&r.ut>ut)return out(env,{ok:false,newer:true,ut:r.ut},409);
  await env.DB.prepare("INSERT OR REPLACE INTO dat(uid,j,ut) VALUES(?,?,?)").bind(me.id,j,ut).run();return out(env,{ok:true,ut})}
 if(p==="/dev"&&req.method==="POST"){
  const did=String(b.did||"").slice(0,40),nm=String(b.nm||"").slice(0,40),kd=String(b.kd||"").slice(0,10),j=typeof b.j==="string"?b.j.slice(0,3000):"{}";
  if(!did)return out(env,{error:"did"},400);
  await env.DB.prepare("INSERT INTO dev(uid,did,nm,kd,j,ut) VALUES(?,?,?,?,?,?) ON CONFLICT(uid,did) DO UPDATE SET nm=excluded.nm,kd=excluded.kd,j=excluded.j,ut=excluded.ut").bind(me.id,did,nm,kd,j,Date.now()).run();
  return out(env,{ok:true})}
 if(p==="/dev"&&req.method==="GET"){
  const did=new URL(req.url).searchParams.get("did")||"",now=Date.now();
  const q=await env.DB.prepare("SELECT did,nm,kd,j,ut,cmd FROM dev WHERE uid=? AND ut>?").bind(me.id,now-864e5).all(),L=q.results||[],mine=L.find(x=>x.did===did);let cmd=null;
  if(mine&&mine.cmd){cmd=mine.cmd;await env.DB.prepare("UPDATE dev SET cmd=NULL WHERE uid=? AND did=?").bind(me.id,did).run()}
  return out(env,{ok:true,now,cmd,pro:await proOf(env,me.id),devs:L.filter(x=>x.did!==did).map(x=>({did:x.did,nm:x.nm,kd:x.kd,j:x.j,ut:x.ut}))})}
 if(p==="/dev/cmd"&&req.method==="POST"){
  if(!await limit(env,"dc:"+me.id,300,36e5))return out(env,{error:"rate"},429);
  const to=String(b.to||"").slice(0,40),c=typeof b.c==="string"?b.c.slice(0,3000):"";
  if(!to||!c)return out(env,{error:"bad"},400);
  const r=await env.DB.prepare("UPDATE dev SET cmd=? WHERE uid=? AND did=?").bind(c,me.id,to).run();return out(env,{ok:true})}
 if(p==="/delete"&&req.method==="POST"){
  const r=await env.DB.prepare("SELECT salt,hash FROM users WHERE id=?").bind(me.id).first();
  if(!r||!same(await pbk(String(b.password||""),r.salt),r.hash))return out(env,{error:"login"},401);
  await env.DB.batch(["users WHERE id","sess WHERE uid","dat WHERE uid","codes WHERE uid"].map(t=>env.DB.prepare("DELETE FROM "+t+"=?").bind(me.id)));return out(env,{ok:true})}
 return out(env,{error:"route"},404);
 }catch(e){return out(env,{error:String(e&&e.message).indexOf("mail")===0?"mail":"server",d:String(e&&e.message).slice(0,40)},500)}
}};
})();

const AR=["/cfg","/register","/resend","/verify","/login","/forgot","/reset","/me","/logout","/data","/delete","/dev","/dev/cmd","/sup/send","/sup/get","/sup/att","/ping","/live"];
export default{
 fetch(req,env,ctx){const p=new URL(req.url).pathname;return AR.includes(p)||p.indexOf("/admin/")===0?ACC.fetch(req,env):PUSH.fetch(req,env,ctx)},
 scheduled(ev,env,ctx){ctx.waitUntil(ACC.tick(env).catch(()=>{}));return PUSH.scheduled(ev,env,ctx)}
};
