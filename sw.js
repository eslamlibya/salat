var V="salat-v14";
self.addEventListener("install",function(e){self.skipWaiting()});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.filter(function(x){return x!=V&&x!="salat-sched"}).map(function(x){return caches.delete(x)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener("fetch",function(e){var u=new URL(e.request.url);if(e.request.method!="GET"||u.origin!=location.origin||u.pathname.indexOf("/video/")>=0)return;e.respondWith(fetch(e.request,{cache:"no-cache"}).then(function(r){if(r.ok){var c=r.clone();caches.open(V).then(function(x){x.put(e.request,c)})}return r}).catch(function(){return caches.match(e.request).then(function(m){return m||caches.match("./")})}))});
self.addEventListener("push",function(e){e.waitUntil((async function(){var list=[];try{var c=await caches.open("salat-sched"),r=await c.match("sched.json");if(r)list=await r.json()}catch(x){}
 var now=Date.now(),best=null,bd=1e15;list.forEach(function(x){var d=Math.abs(now-x.t);if(now>=x.t-4*60000&&now<=x.t+12*60000&&d<bd){bd=d;best=x}});
 await self.registration.showNotification(best?best.title:"حان وقت الصلاة",{body:best?best.body:"الصلاة",tag:"salat-"+(best?best.t:Math.floor(now/60000)),data:{u:"./"}})})())});
self.addEventListener("notificationclick",function(e){e.notification.close();e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(function(l){for(var i=0;i<l.length;i++){if("focus"in l[i])return l[i].focus()}return clients.openWindow("./")}))});
