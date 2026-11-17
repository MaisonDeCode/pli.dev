"use strict";(()=>{var df=Object.defineProperty;var Ll=t=>{throw TypeError(t)};var ff=(t,e,n)=>e in t?df(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var se=(t,e,n)=>ff(t,typeof e!="symbol"?e+"":e,n),Li=(t,e,n)=>e.has(t)||Ll("Cannot "+n);var m=(t,e,n)=>(Li(t,e,"read from private field"),n?n.call(t):e.get(t)),D=(t,e,n)=>e.has(t)?Ll("Cannot add the same private member more than once"):e instanceof WeakSet?e.add(t):e.set(t,n),x=(t,e,n,r)=>(Li(t,e,"write to private field"),r?r.call(t,n):e.set(t,n),n),k=(t,e,n)=>(Li(t,e,"access private method"),n);var et=(t,e,n,r)=>({set _(o){x(t,e,o,n)},get _(){return m(t,e,r)}});function Pr(t){let e=[];for(let n=0;n<t.length;n++){let r=t.charCodeAt(n);if(r>=55296&&r<56320&&n+1<t.length){let o=t.charCodeAt(n+1);o>=56320&&o<57344&&(r=65536+(r-55296<<10)+(o-56320),n++)}r>=55296&&r<57344&&(r=65533),r<128?e.push(r):r<2048?e.push(192|r>>6,128|r&63):r<65536?e.push(224|r>>12,128|r>>6&63,128|r&63):e.push(240|r>>18,128|r>>12&63,128|r>>6&63,128|r&63)}return Uint8Array.from(e)}function Co(t){let e="",n=[];for(let r=0;r<t.length;){let o=t[r++],s;o<128?s=o:o>=194&&o<224&&r<t.length?s=(o&31)<<6|t[r++]&63:o>=224&&o<240&&r+1<t.length?s=(o&15)<<12|(t[r++]&63)<<6|t[r++]&63:o>=240&&o<245&&r+2<t.length?s=(o&7)<<18|(t[r++]&63)<<12|(t[r++]&63)<<6|t[r++]&63:s=65533,s>=65536?(s-=65536,n.push(55296+(s>>10),56320+(s&1023))):n.push(s),n.length>4096&&(e+=String.fromCharCode(...n),n=[])}return e+String.fromCharCode(...n)}var Rs=globalThis;typeof Rs.TextEncoder>"u"&&(Rs.TextEncoder=class{constructor(){se(this,"encoding","utf-8")}encode(e=""){return Pr(String(e))}});typeof Rs.TextDecoder>"u"&&(Rs.TextDecoder=class{constructor(e="utf-8"){this.encoding=e}decode(e){if(e===void 0)return"";let n=e instanceof Uint8Array?e:ArrayBuffer.isView(e)?new Uint8Array(e.buffer,e.byteOffset,e.byteLength):new Uint8Array(e),r=Co(n);return r.charCodeAt(0)===65279?r.slice(1):r}});var pf=new Set(["divider","page_break","section_break","image","toc","table"]);function F(t){return!pf.has(t.type)}function Te(t){return F(t)&&t.type!=="code_block"}var mf=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);function T(t=""){return t+mf()}var Po="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",hf=new Map([...Po].map((t,e)=>[t,e]));function Hn(t){let e=[];for(let n=0;n<t.length;n+=3){let r=t[n],o=t[n+1],s=t[n+2],i=r<<16|(o??0)<<8|(s??0);e.push(Po[i>>18&63]+Po[i>>12&63]+(o===void 0?"=":Po[i>>6&63])+(s===void 0?"=":Po[i&63]))}return e.join("")}function mn(t){let e=t.replace(/\s+/g,""),n=e.replace(/=+$/,"");if(e.length-n.length>2||e.length%4!==0&&e.length!==n.length||n.length%4===1)return null;let r=new Uint8Array(Math.floor(n.length*3/4)),o=0,s=0,i=0;for(let a of n){let l=hf.get(a);if(l===void 0)return null;s=s<<6|l,o+=6,o>=8&&(o-=8,r[i++]=s>>o&255)}return r}var S=class extends Error{constructor(n,r,o){super(r,o);se(this,"code");this.name="PliError",this.code=n}};var Rt,Mo,pt,Dt,Br,tt,Ui,ji,Bo,Oo=class{constructor(e,n){D(this,tt);D(this,Rt);D(this,Mo);D(this,pt,[]);D(this,Dt,[]);D(this,Br,new Set);x(this,Rt,e),x(this,Mo,n)}get state(){return m(this,Rt)}get canUndo(){return m(this,pt).length>0}get canRedo(){return m(this,Dt).length>0}transact(e,n={}){if(e.length===0)return;let r=n.origin??"local",{state:o,inverse:s}=k(this,tt,ji).call(this,e);if(x(this,Rt,o),r==="local"&&n.history!==!1){let i=n.merge?m(this,pt)[m(this,pt).length-1]:void 0;i?(i.ops=[...s,...i.ops],i.other=n.after):m(this,pt).push({ops:s,restore:n.before,other:n.after}),x(this,Dt,[])}k(this,tt,Bo).call(this,{state:o,ops:e,origin:r,meta:n.after})}reset(e){x(this,Rt,e),x(this,pt,[]),x(this,Dt,[]),k(this,tt,Bo).call(this,{state:e,ops:[],origin:"remote",reset:!0})}rebaseHistory(e,n){if(e.length===0)return;let r=(s,i)=>s===void 0||!n.mapMeta?s:n.mapMeta(s,i),o=s=>{let i=e,a=[];for(let l=s.length-1;l>=0;l--){let u=s[l],[c,d]=n.transform(u.ops,i);u.restore=r(u.restore,d),u.other=r(u.other,i),u.ops=c,i=d,c.length>0&&a.push(u)}return a.reverse()};x(this,pt,o(m(this,pt))),x(this,Dt,o(m(this,Dt)))}undo(){let e=m(this,pt).pop();if(!e)return!1;let n=k(this,tt,Ui).call(this,e.ops);if(!n)return!1;let{state:r,inverse:o}=n;return x(this,Rt,r),m(this,Dt).push({ops:o,restore:e.other,other:e.restore}),k(this,tt,Bo).call(this,{state:r,ops:e.ops,origin:"undo",meta:e.restore}),!0}redo(){let e=m(this,Dt).pop();if(!e)return!1;let n=k(this,tt,Ui).call(this,e.ops);if(!n)return!1;let{state:r,inverse:o}=n;return x(this,Rt,r),m(this,pt).push({ops:o,restore:e.other,other:e.restore}),k(this,tt,Bo).call(this,{state:r,ops:e.ops,origin:"redo",meta:e.restore}),!0}subscribe(e){return m(this,Br).add(e),()=>m(this,Br).delete(e)}};Rt=new WeakMap,Mo=new WeakMap,pt=new WeakMap,Dt=new WeakMap,Br=new WeakMap,tt=new WeakSet,Ui=function(e){try{return k(this,tt,ji).call(this,e)}catch{return null}},ji=function(e){let n=m(this,Rt),r=[];for(let o of e){let s=m(this,Mo).apply(n,o);n=s.state,r.unshift(s.inverse)}return{state:n,inverse:r}},Bo=function(e){for(let n of m(this,Br))n(e)};var gf={aborted:!1,addEventListener(){},removeEventListener(){}};function Es(){let t=new Set,e={aborted:!1,addEventListener(n,r){t.add(r)},removeEventListener(n,r){t.delete(r)}};return{signal:e,abort(){if(!e.aborted){e.aborted=!0;for(let n of[...t])n()}}}}var Ao=()=>new S("cancelled","The upload was cancelled."),zi=class{constructor(e,n){this.bytes=e;this.type=n;se(this,"size");this.size=e.length}arrayBuffer(){return Promise.resolve(this.bytes.slice().buffer)}},yf=/^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is;function bf(t){let e=yf.exec(t);if(!e||!/;base64$/i.test(e[2]))return null;let n=mn(e[3]);return n?{type:e[1]||"application/octet-stream",bytes:n}:null}var kf=t=>/^(https?:|data:|blob:)/i.test(t);function wf(t,e){let n=t.toLowerCase();return e.some(r=>{let o=r.toLowerCase();return o.endsWith("/*")?n.startsWith(o.slice(0,-1)):n===o})}function Ds(t){return t instanceof Error?t.message:String(t)}var nt,Or,Mr,Kn,hn,Wn,qn,Tr,Ul,jl,Ar=class{constructor(e,n={}){D(this,Tr);D(this,nt);D(this,Or);D(this,Mr);D(this,Kn);D(this,hn,new Map);D(this,Wn,0);D(this,qn,[]);x(this,nt,e),x(this,Or,n),x(this,Mr,n.resolveCacheMs??5*6e4),x(this,Kn,n.now??Date.now)}get canRead(){return!!m(this,nt).read}get canDelete(){return!!m(this,nt).delete}check(e,n=e.type){let{maxBytes:r,allowedTypes:o}=m(this,Or);if(o&&!wf(n,o))throw new S("invalid_operation",`Files of type "${n||"unknown"}" aren't allowed here. Allowed: ${o.join(", ")}.`);if(r!==void 0&&e.size>r)throw new S("invalid_operation",`The file is ${e.size} bytes; the limit is ${r}.`)}async upload(e,n={}){let r=n.signal??gf,o=n.type??e.type,s=n.name??e.name??"file";this.check(e,o),await k(this,Tr,Ul).call(this,r);try{if(r.aborted)throw Ao();let i=0,a=p=>{Number.isFinite(p)&&(i=Math.max(i,Math.min(1,Math.max(0,p))),n.onProgress?.(i))},l;try{l=await m(this,nt).upload(e,{name:s,type:o,signal:r,onProgress:a})}catch(p){throw r.aborted?Ao():p instanceof S?p:new S("storage",`Upload failed: ${Ds(p)}`,{cause:p})}if(r.aborted)throw Ao();if(!l||typeof l.ref!="string"||l.ref==="")throw new S("storage","The storage adapter didn't return a reference for the uploaded file.");a(1);let u=p=>typeof p=="number"&&Number.isFinite(p)&&p>0?p:void 0,c=typeof l.url=="string"&&l.url!==""?l.url:void 0,d=u(l.width),f=u(l.height);return{ref:l.ref,...c&&{url:c},...d&&{width:d},...f&&{height:f}}}finally{k(this,Tr,jl).call(this)}}resolve(e){let n=m(this,nt).resolve;if(!n)return kf(e)?Promise.resolve(e):Promise.reject(new S("storage",`Can't show "${e}": the storage adapter has no resolve() to turn it into an address.`));if(/^(data|blob):/i.test(e))return Promise.resolve(e);let r=m(this,hn).get(e);if(r&&m(this,Mr)>0&&m(this,Kn).call(this)-r.at<m(this,Mr))return r.value;let o=Promise.resolve().then(()=>n.call(m(this,nt),e)).then(s=>{if(typeof s!="string"||s==="")throw new S("storage",`resolve() returned no address for "${e}".`);return s}).catch(s=>{throw m(this,hn).delete(e),s instanceof S?s:new S("storage",`Couldn't resolve "${e}": ${Ds(s)}`,{cause:s})});return m(this,hn).set(e,{at:m(this,Kn).call(this),value:o}),o}prime(e,n){m(this,hn).set(e,{at:m(this,Kn).call(this),value:Promise.resolve(n)})}async read(e){let n=bf(e);if(n)return new zi(n.bytes,n.type);if(/^data:/i.test(e))throw new S("storage","That data URI isn't base64, so it can't be read.");let r=m(this,nt).read;if(!r)throw new S("storage",`Can't read "${e}": the storage adapter has no read(). Add it to export documents with stored files.`);try{let o=await r.call(m(this,nt),e);if(!o||typeof o.arrayBuffer!="function")throw new Error("read() didn't return a file");return o}catch(o){throw o instanceof S?o:new S("storage",`Couldn't read "${e}": ${Ds(o)}`,{cause:o})}}async delete(e){let n=m(this,nt).delete;if(!(!n||/^(data|blob):/i.test(e))){m(this,hn).delete(e);try{await n.call(m(this,nt),e)}catch(r){throw r instanceof S?r:new S("storage",`Couldn't delete "${e}": ${Ds(r)}`,{cause:r})}}}};nt=new WeakMap,Or=new WeakMap,Mr=new WeakMap,Kn=new WeakMap,hn=new WeakMap,Wn=new WeakMap,qn=new WeakMap,Tr=new WeakSet,Ul=function(e){return e.aborted?Promise.reject(Ao()):m(this,Wn)<(m(this,Or).maxConcurrent??3)?(et(this,Wn)._++,Promise.resolve()):new Promise((n,r)=>{let o=()=>{e.removeEventListener("abort",s),et(this,Wn)._++,n()},s=()=>{let i=m(this,qn).indexOf(o);i>=0&&m(this,qn).splice(i,1),r(Ao())};m(this,qn).push(o),e.addEventListener("abort",s,{once:!0})})},jl=function(){et(this,Wn)._--,m(this,qn).shift()?.()};var zl=["#d9480f","#1c7ed6","#2f9e44","#9c36b5","#c2255c","#0c8599","#e67700","#5f3dc4"];function Hi(t){let e=0;for(let n=0;n<t.length;n++)e=e*31+t.charCodeAt(n)>>>0;return zl[e%zl.length]}function Sf(t){return typeof t.id=="string"&&typeof t.name=="string"}var rt,Vt,Rr,Xn,Dr,Er,Et,To,Gi,_r=class{constructor(e=null){D(this,Et);D(this,rt);D(this,Vt,new Map);D(this,Rr,new Set);D(this,Xn,new Set);D(this,Dr,!1);D(this,Er,new Set);x(this,rt,e===null?{current:null}:Sf(e)?{current:e}:e),m(this,rt).current&&m(this,Vt).set(m(this,rt).current.id,m(this,rt).current)}get current(){let e=m(this,rt).current;return e?k(this,Et,To).call(this,e):null}get role(){return m(this,rt).role??"editor"}get(e){let n=m(this,Vt).get(e);return n?k(this,Et,To).call(this,n):(this.prefetch([e]),k(this,Et,To).call(this,{id:e,name:e}))}prefetch(e){if(m(this,rt).lookup){for(let n of e)!m(this,Vt).has(n)&&!m(this,Rr).has(n)&&m(this,Xn).add(n);m(this,Xn).size===0||m(this,Dr)||(x(this,Dr,!0),Promise.resolve().then(()=>{x(this,Dr,!1);let n=[...m(this,Xn)];m(this,Xn).clear();for(let r of n)m(this,Rr).add(r);Promise.resolve(m(this,rt).lookup(n)).then(r=>{for(let o of r)m(this,Vt).set(o.id,o);k(this,Et,Gi).call(this)}).catch(()=>{for(let r of n)m(this,Rr).delete(r)})}))}}add(e){let n=!1;for(let r of e){let o=m(this,Vt).get(r.id);(!o||o.name!==r.name||o.avatar!==r.avatar||o.color!==r.color)&&(m(this,Vt).set(r.id,r),n=!0)}n&&k(this,Et,Gi).call(this)}async search(e){let n=await m(this,rt).search?.(e)??[];return this.add(n),n.map(r=>k(this,Et,To).call(this,r))}get canSearch(){return!!m(this,rt).search}subscribe(e){return m(this,Er).add(e),()=>m(this,Er).delete(e)}};rt=new WeakMap,Vt=new WeakMap,Rr=new WeakMap,Xn=new WeakMap,Dr=new WeakMap,Er=new WeakMap,Et=new WeakSet,To=function(e){return e.color?e:{...e,color:Hi(e.id)}},Gi=function(){for(let e of m(this,Er))e()};function bn(t,e){let n=(r,o)=>t.map(s=>s.id===r?o(s):s);switch(e.type){case"thread.create":return t.some(r=>r.id===e.thread.id)?n(e.thread.id,()=>e.thread):[...t,e.thread];case"thread.delete":return t.filter(r=>r.id!==e.threadId);case"thread.resolve":return n(e.threadId,r=>({...r,resolved:{by:e.by,at:e.at}}));case"thread.reopen":return n(e.threadId,({resolved:r,...o})=>o);case"comment.add":return n(e.threadId,r=>r.comments.some(o=>o.id===e.comment.id)?r:{...r,comments:[...r.comments,e.comment]});case"comment.edit":return n(e.threadId,r=>({...r,comments:r.comments.map(o=>o.id===e.commentId?Ki({...o,body:e.body,editedAt:e.at},e.mentions):o)}));case"comment.delete":return n(e.threadId,r=>({...r,comments:r.comments.filter(o=>o.id!==e.commentId)}))}}function Ki(t,e){let{mentions:n,...r}=t;return e&&e.length>0?{...r,mentions:[...e]}:r}function Ro(t){return t.type==="thread.create"?t.thread.id:t.threadId}var _t,Vn,qe,ot,Jn,Do,Zn,Yn,yn,Qn,Fr,Eo,er,te,Wi,gn,Jt,Nr,_s,tr=class{constructor(e){D(this,te);se(this,"file");se(this,"users");D(this,_t);D(this,Vn);D(this,qe);D(this,ot,[]);D(this,Jn);D(this,Do,Promise.resolve());D(this,Zn,new Set);D(this,Yn,new Set);D(this,yn,new Set);D(this,Qn,"ready");D(this,Fr,null);D(this,Eo);D(this,er);x(this,Vn,e),this.file=e.file,this.users=e.users,x(this,_t,e.store??null),x(this,qe,e.initial??[]),x(this,Jn,m(this,qe)),x(this,er,m(this,_t)?k(this,te,Wi).call(this):Promise.resolve()),x(this,Fr,m(this,_t)?.subscribe?.(this.file,n=>this.receive(n))??null),x(this,Eo,this.users.subscribe(()=>k(this,te,_s).call(this)))}get threads(){return m(this,Jn)}get status(){return m(this,Qn)}get ready(){return m(this,er)}thread(e){return m(this,Jn).find(n=>n.id===e)}subscribe(e){return m(this,Zn).add(e),()=>m(this,Zn).delete(e)}onChange(e){return m(this,yn).add(e),()=>m(this,yn).delete(e)}onOutgoing(e){return m(this,Yn).add(e),()=>m(this,Yn).delete(e)}can(e,n,r){let o=this.users.current;if(!o)return!1;let s={user:{id:o.id,role:this.users.role},thread:n,comment:r},i=m(this,Vn).permissions?.(e,s);if(i!==void 0)return i;let a=this.users.role;if(a==="viewer")return!1;if(a==="editor")return!0;switch(e){case"comment":case"reply":case"resolve":return!0;case"edit":case"delete":return r?.author===o.id;case"deleteThread":return n?.comments.every(l=>l.author===o.id)??!1}}createThread(e,n,r=T("th_"),o){let s=k(this,te,gn).call(this,"comment"),i=Date.now(),a={id:r,comments:[Ki({id:T("cm_"),author:s,body:e,createdAt:i},o)],createdAt:i};return n!==void 0&&(a.anchor=n),k(this,te,Jt).call(this,{type:"thread.create",thread:a}),a}reply(e,n,r){let o=k(this,te,gn).call(this,"reply",e),s=Ki({id:T("cm_"),author:o,body:n,createdAt:Date.now()},r);return k(this,te,Jt).call(this,{type:"comment.add",threadId:e,comment:s}),s}editComment(e,n,r,o){k(this,te,gn).call(this,"edit",e,n);let s={type:"comment.edit",threadId:e,commentId:n,body:r,at:Date.now()};o&&o.length>0&&(s.mentions=[...o]),k(this,te,Jt).call(this,s)}deleteComment(e,n){k(this,te,gn).call(this,"delete",e,n);let r=this.thread(e);r&&r.comments.length<=1?k(this,te,Jt).call(this,{type:"thread.delete",threadId:e}):k(this,te,Jt).call(this,{type:"comment.delete",threadId:e,commentId:n})}deleteThread(e){k(this,te,gn).call(this,"deleteThread",e),k(this,te,Jt).call(this,{type:"thread.delete",threadId:e})}resolve(e){let n=k(this,te,gn).call(this,"resolve",e);k(this,te,Jt).call(this,{type:"thread.resolve",threadId:e,by:n,at:Date.now()})}reopen(e){k(this,te,gn).call(this,"resolve",e),k(this,te,Jt).call(this,{type:"thread.reopen",threadId:e})}receive(e){x(this,qe,bn(m(this,qe),e)),k(this,te,Nr).call(this);for(let n of m(this,yn))n(e,"remote")}dispose(){var e;(e=m(this,Fr))==null||e.call(this),x(this,Fr,null),m(this,Eo).call(this),m(this,Zn).clear(),m(this,yn).clear()}reload(){return m(this,_t)?(x(this,er,k(this,te,Wi).call(this)),m(this,er)):Promise.resolve()}};_t=new WeakMap,Vn=new WeakMap,qe=new WeakMap,ot=new WeakMap,Jn=new WeakMap,Do=new WeakMap,Zn=new WeakMap,Yn=new WeakMap,yn=new WeakMap,Qn=new WeakMap,Fr=new WeakMap,Eo=new WeakMap,er=new WeakMap,te=new WeakSet,Wi=async function(){x(this,Qn,"loading"),k(this,te,_s).call(this);try{let e=await m(this,_t).load(this.file),n=new Set(e.map(r=>r.id));x(this,qe,[...e,...m(this,qe).filter(r=>!n.has(r.id)&&m(this,ot).some(o=>o.type==="thread.create"&&o.thread.id===r.id))]),x(this,Qn,"ready")}catch(e){x(this,Qn,"error"),m(this,Vn).onError?.(new S("storage","Couldn't load comments",{cause:e}),{type:"thread.delete",threadId:""})}k(this,te,Nr).call(this)},gn=function(e,n,r){let o=this.users.current;if(!o)throw new S("invalid_operation","Sign in to comment: no current user was given");let s=n?this.thread(n):void 0;if(n&&!s)throw new S("not_found",`No thread "${n}"`);let i=r?s?.comments.find(a=>a.id===r):void 0;if(r&&!i)throw new S("not_found",`No comment "${r}"`);if(!this.can(e,s,i))throw new S("invalid_operation",`Not allowed to ${e}`);return o.id},Jt=function(e){m(this,ot).push(e),k(this,te,Nr).call(this);for(let r of m(this,yn))r(e,"local");if(!m(this,_t)){x(this,ot,m(this,ot).filter(r=>r!==e)),x(this,qe,bn(m(this,qe),e));for(let r of m(this,Yn))r(e);return}let n=Ro(e);x(this,Do,m(this,Do).then(async()=>{if(m(this,ot).includes(e))try{await m(this,_t).save(this.file,e),x(this,ot,m(this,ot).filter(r=>r!==e)),x(this,qe,bn(m(this,qe),e)),k(this,te,Nr).call(this);for(let r of m(this,Yn))r(e)}catch(r){x(this,ot,m(this,ot).filter(o=>Ro(o)!==n)),k(this,te,Nr).call(this),m(this,Vn).onError?.(new S("storage","Couldn't save the comment",{cause:r}),e)}}))},Nr=function(){x(this,Jn,m(this,ot).reduce((e,n)=>bn(e,n),m(this,qe))),k(this,te,_s).call(this)},_s=function(){for(let e of m(this,Zn))e()};var mt,vt,$o,ht,Ir,Lr,nr,Io,Lo,Ur,jr,oe,qi,$r,_o,Gl,Hl,No,Fo,zr=class{constructor(e){D(this,oe);se(this,"client",T("c_"));D(this,mt);D(this,vt,new Map);D(this,$o,{});D(this,ht,"idle");D(this,Ir,new Set);D(this,Lr,new Map);D(this,nr,null);D(this,Io,null);D(this,Lo,null);D(this,Ur,[]);D(this,jr,0);x(this,mt,e),e.comments&&this.attachComments(e.comments)}attachComments(e){var n;(n=m(this,Lo))==null||n.call(this),x(this,Io,e),x(this,Lo,e?.onOutgoing(r=>m(this,ht)==="connected"&&k(this,oe,$r).call(this,{type:"comment",change:r}))??null)}get status(){return m(this,ht)}get peers(){return m(this,Ur)}async connect(){if(m(this,ht)!=="idle")return;x(this,ht,"connecting"),k(this,oe,Fo).call(this);let e=++et(this,jr)._,{transport:n,room:r}=m(this,mt);if(await n.connect(r,s=>k(this,oe,Gl).call(this,s)),e!==m(this,jr))return;x(this,ht,"connected"),k(this,oe,$r).call(this,{type:"hello"}),k(this,oe,_o).call(this);let o=m(this,mt).heartbeat??1e4;x(this,nr,setInterval(()=>{k(this,oe,_o).call(this),k(this,oe,Hl).call(this)},o)),k(this,oe,Fo).call(this)}disconnect(){m(this,ht)!=="idle"&&(et(this,jr)._++,m(this,ht)==="connected"&&k(this,oe,$r).call(this,{type:"presence",user:k(this,oe,qi).call(this)??{id:"",name:""},state:null}),m(this,nr)&&clearInterval(m(this,nr)),x(this,nr,null),m(this,mt).transport.disconnect(),m(this,vt).clear(),x(this,Ur,[]),x(this,ht,"idle"),k(this,oe,Fo).call(this))}setPresence(e){x(this,$o,e),m(this,ht)==="connected"&&k(this,oe,_o).call(this)}mapPresence(e){let n=!1;for(let r of m(this,vt).values()){let o=e(r.state);o!==r.state&&(r.state=o,n=!0)}n&&k(this,oe,No).call(this)}sendCustom(e,n){k(this,oe,$r).call(this,{type:"custom",kind:e,data:n})}onCustom(e,n){let r=m(this,Lr).get(e)??new Set;return m(this,Lr).set(e,r),r.add(n),()=>r.delete(n)}subscribe(e){return m(this,Ir).add(e),()=>m(this,Ir).delete(e)}};mt=new WeakMap,vt=new WeakMap,$o=new WeakMap,ht=new WeakMap,Ir=new WeakMap,Lr=new WeakMap,nr=new WeakMap,Io=new WeakMap,Lo=new WeakMap,Ur=new WeakMap,jr=new WeakMap,oe=new WeakSet,qi=function(){return m(this,mt).users.current},$r=function(e){m(this,mt).transport.send({v:1,client:this.client,message:e})},_o=function(){let e=k(this,oe,qi).call(this);e&&k(this,oe,$r).call(this,{type:"presence",user:e,state:m(this,$o)})},Gl=function(e){let n=e;if(!n||n.v!==1||typeof n.client!="string"||!n.message||n.client===this.client)return;let{client:r,message:o}=n;switch(o.type){case"hello":k(this,oe,_o).call(this);break;case"presence":o.state===null?m(this,vt).delete(r)&&k(this,oe,No).call(this):o.user?.id&&(m(this,mt).users.add([o.user]),m(this,vt).set(r,{client:r,user:o.user,state:o.state,seen:Date.now()}),k(this,oe,No).call(this));break;case"comment":m(this,Io)?.receive(o.change);break;case"custom":{let s=m(this,vt).get(r)??null;for(let i of m(this,Lr).get(o.kind)??[])i(o.data,s);break}}},Hl=function(){let e=m(this,mt).timeout??(m(this,mt).heartbeat??1e4)*3,n=Date.now(),r=!1;for(let[o,s]of m(this,vt))n-s.seen>e&&(m(this,vt).delete(o),r=!0);r&&k(this,oe,No).call(this)},No=function(){x(this,Ur,[...m(this,vt).values()]),k(this,oe,Fo).call(this)},Fo=function(){for(let e of m(this,Ir))e()};var Gr="sync",Ns="server";function Kl(t){return(e,n,r)=>{let[o,s]=t(e,r),[i,a]=t(n,s);return{inflight:o,pending:i,incoming:a}}}function Fs(t={}){let e=new Map,n=s=>JSON.parse(JSON.stringify(s)),r=s=>{let i=e.get(s);return i||e.set(s,i={snapshot:null,log:[]}),i},o=s=>s.log[s.log.length-1]?.version??s.snapshot?.version??0;return{head:s=>o(r(s)),async load(s){let i=r(s).snapshot;return i?n(i):null},async entries(s,i){let a=r(s),l=a.log[0]?.version;return l!==void 0&&l>i+1||l===void 0&&(a.snapshot?.version??0)>i?null:n(a.log.filter(u=>u.version>i))},async append(s,i){let a=r(s);return o(a)!==i.version-1?!1:(a.log.push(n(i)),!0)},async save(s,i){let a=r(s);a.snapshot=n(i),t.keepEntries!==void 0&&(a.log=a.log.filter(l=>l.version>i.version-t.keepEntries))}}}var Xi=t=>typeof t=="object"&&t!==null;function $s(t){let{store:e,model:n}=t,r=t.snapshotEvery??100,o=t.maxCatchUp??500,s=new Map,i=new Map,a=(f,p)=>p.reduce((h,g)=>g.ops.reduce((y,b)=>n.apply(y,b),h),f);async function l(f){let p=await e.load(f);if(!p){if(!t.create)throw new S("not_found",`No document for room "${f}"`);p={state:await t.create(f),version:0},await e.save(f,p)}let h=await e.entries(f,p.version)??[];return{state:a(p.state,h),version:h[h.length-1]?.version??p.version}}async function u(f){let p=s.get(f);if(!p){let g=await l(f);return s.set(f,g),g}let h=await e.entries(f,p.version);if(h===null){let g=await l(f);return s.set(f,g),g}if(h.length===0)return p;try{let g={state:a(p.state,h),version:h[h.length-1].version};return s.set(f,g),g}catch{let g=await l(f);return s.set(f,g),g}}let c=f=>({v:1,client:Ns,message:{type:"custom",kind:Gr,data:f}});async function d(f,p,h,g){let y=O=>g(c(O)),b=O=>y({type:"resync",to:p,reason:O});if(t.authorize&&!await t.authorize({room:f,client:p,message:h}))return b("not allowed");if(h.type==="join"){let O=await u(f),_=h.have,M=typeof _=="number"&&_>=0&&_<=O.version?await e.entries(f,_):null;M===null||M.length>o?y({type:"snapshot",to:p,version:O.version,state:O.state}):y({type:"caught_up",to:p,version:O.version,entries:M});return}if(h.type==="hash"){let O=await u(f);O.version===h.version&&n.hash(O.state)!==h.hash&&b("your document differs from the server's");return}let w=h.base;for(let O=0;O<8;O++){let _=await u(f);if(!Number.isInteger(w)||w<0||w>_.version)return b("unknown version");let M=await e.entries(f,w);if(M===null)return b("too far behind");if(w+M.length!==_.version)continue;let R=M.find(N=>N.client===p&&N.batch===h.batch);if(R)return y({type:"entry",...R});let[A]=n.transform(h.ops,M.flatMap(N=>N.ops)),$=_.state,P=[],B=!1;for(let N of A)try{$=n.apply($,N),P.push(N)}catch(L){if(L instanceof S&&L.code==="not_found")B=!0;else throw L}let v={version:_.version+1,client:p,batch:h.batch,ops:P,...B?{dropped:!0}:{}};if(await e.append(f,v)){s.set(f,{state:$,version:v.version}),y({type:"entry",...v}),v.version%r===0&&await e.save(f,{state:$,version:v.version});return}}b("too busy")}return{receive(f,p,h){let g=p;if(!Xi(g)||g.v!==1||typeof g.client!="string"||g.client===Ns)return Promise.resolve();let y=g.message;if(!Xi(y)||y.type!=="custom"||y.kind!==Gr||!Xi(y.data))return Promise.resolve();let b=y.data;if(!(b.type==="join"&&(b.have===null||Number.isInteger(b.have))||b.type==="ops"&&typeof b.batch=="string"&&Array.isArray(b.ops)&&typeof b.base=="number"||b.type==="hash"&&typeof b.hash=="string"&&typeof b.version=="number"))return Promise.resolve();let O=g.client,M=(i.get(f)??Promise.resolve()).then(()=>d(f,O,b,h).catch(R=>{t.onError?.(R,f),s.delete(f),h(c({type:"resync",to:O,reason:"error"}))}));return i.set(f,M),M}}}var Ue,Zt,kn,zo,Re,Xe,Ft,rr,gt,ve,st,wn,Hr,Go,or,sr,G,Uo,jo,Is,Wl,Vi,ql,Ji,Zi,Nt,Yi,Sn=class{constructor(e){D(this,G);D(this,Ue);D(this,Zt);D(this,kn);D(this,zo);D(this,Re);D(this,Xe,!1);D(this,Ft,!1);D(this,rr,!1);D(this,gt,!0);D(this,ve,null);D(this,st,[]);D(this,wn,"connecting");D(this,Hr,new Set);D(this,Go,[]);D(this,or,null);D(this,sr,null);x(this,Ue,e),x(this,Zt,e.session),x(this,kn,e.model),x(this,zo,e.model.rebase??Kl(e.model.transform)),x(this,Re,e.version??null)}get room(){return m(this,Ue).room}get lastResync(){return m(this,sr)}get version(){return m(this,Re)}get status(){return m(this,wn)}get unsynced(){return(m(this,ve)?.ops.length??0)+m(this,st).length}subscribe(e){return m(this,Hr).add(e),()=>m(this,Hr).delete(e)}start(){if(m(this,rr))return;x(this,rr,!0);let{room:e}=m(this,Ue);m(this,Go).push(m(this,Zt).subscribe(r=>{r.origin!=="remote"&&(k(this,G,Zi).call(this,r.ops),m(this,st).push(...r.ops),k(this,G,Nt).call(this),k(this,G,Is).call(this))}),e.onCustom(Gr,r=>k(this,G,ql).call(this,r)),e.subscribe(()=>{e.status==="connected"&&!m(this,Xe)&&m(this,gt)?k(this,G,jo).call(this):e.status==="idle"&&k(this,G,Vi).call(this)}));let n=m(this,Ue).verifyEvery??3e4;n>0&&x(this,or,setInterval(()=>k(this,G,Wl).call(this),n)),e.status==="connected"&&m(this,gt)&&k(this,G,jo).call(this),k(this,G,Nt).call(this)}stop(){for(let e of m(this,Go).splice(0))e();m(this,or)&&clearInterval(m(this,or)),x(this,or,null),x(this,rr,!1),x(this,Xe,!1),x(this,Ft,!1)}setOnline(e){e!==m(this,gt)&&(x(this,gt,e),e?Promise.resolve().then(()=>{m(this,gt)&&m(this,rr)&&m(this,Ue).room.status==="connected"&&k(this,G,jo).call(this)}):k(this,G,Vi).call(this),k(this,G,Nt).call(this))}resync(e="asked to"){let n=this.unsynced;x(this,ve,null),x(this,st,[]),x(this,Re,null),x(this,Xe,!1),x(this,Ft,!1),x(this,wn,"resyncing"),x(this,sr,{reason:e,lost:n,at:Date.now()}),k(this,G,Yi).call(this),m(this,Ue).onResync?.({reason:e,lost:n}),m(this,gt)&&m(this,Ue).room.status==="connected"&&k(this,G,jo).call(this)}};Ue=new WeakMap,Zt=new WeakMap,kn=new WeakMap,zo=new WeakMap,Re=new WeakMap,Xe=new WeakMap,Ft=new WeakMap,rr=new WeakMap,gt=new WeakMap,ve=new WeakMap,st=new WeakMap,wn=new WeakMap,Hr=new WeakMap,Go=new WeakMap,or=new WeakMap,sr=new WeakMap,G=new WeakSet,Uo=function(e){m(this,Ue).room.sendCustom(Gr,e)},jo=function(){m(this,Ft)||(x(this,Xe,!1),x(this,Ft,!0),k(this,G,Uo).call(this,{type:"join",have:m(this,Re)}),k(this,G,Nt).call(this))},Is=function(){!m(this,Xe)||!m(this,gt)||m(this,ve)||m(this,st).length===0||m(this,Re)===null||(x(this,ve,{batch:T("bt_"),ops:m(this,st)}),x(this,st,[]),k(this,G,Uo).call(this,{type:"ops",batch:m(this,ve).batch,base:m(this,Re),ops:m(this,ve).ops}))},Wl=function(){!m(this,Xe)||!m(this,gt)||m(this,ve)||m(this,st).length>0||m(this,Re)===null||k(this,G,Uo).call(this,{type:"hash",version:m(this,Re),hash:m(this,kn).hash(m(this,Zt).state)})},Vi=function(){x(this,Xe,!1),x(this,Ft,!1),k(this,G,Nt).call(this)},ql=function(e){if(!(!e||typeof e!="object")&&!("to"in e&&e.to!==m(this,Ue).room.client))switch(e.type){case"snapshot":{let n=this.unsynced;x(this,Re,e.version),x(this,ve,null),x(this,st,[]),m(this,Zt).reset(e.state),x(this,Xe,!0),x(this,Ft,!1),k(this,G,Nt).call(this),n>0&&m(this,wn)!=="resyncing"&&(x(this,sr,{reason:"joined with changes the server doesn't have",lost:n,at:Date.now()}),m(this,Ue).onResync?.({reason:m(this,sr).reason,lost:n}));break}case"caught_up":{x(this,Xe,!0),x(this,Ft,!1);for(let n of e.entries)k(this,G,Ji).call(this,n);m(this,Xe)&&m(this,ve)&&m(this,Re)!==null&&k(this,G,Uo).call(this,{type:"ops",batch:m(this,ve).batch,base:m(this,Re),ops:m(this,ve).ops}),k(this,G,Nt).call(this),k(this,G,Is).call(this);break}case"entry":k(this,G,Ji).call(this,e);break;case"resync":this.resync(e.reason);break}},Ji=function(e){if(m(this,Re)===null||e.version<=m(this,Re))return;if(e.version!==m(this,Re)+1)return this.resync("missed an update");if(m(this,ve)&&e.client===m(this,Ue).room.client&&e.batch===m(this,ve).batch){if(x(this,ve,null),x(this,Re,e.version),e.dropped)return this.resync("the server left out part of a change");k(this,G,Nt).call(this),k(this,G,Is).call(this);return}let n=m(this,zo).call(this,m(this,ve)?.ops??[],m(this,st),e.ops);try{n.incoming.length>0&&(m(this,Zt).transact(n.incoming,{origin:"remote"}),m(this,Zt).rebaseHistory(n.incoming,{transform:m(this,kn).transform,mapMeta:m(this,kn).mapMeta}),k(this,G,Zi).call(this,n.incoming))}catch{return this.resync("couldn't apply an update")}m(this,ve)&&x(this,ve,{batch:m(this,ve).batch,ops:n.inflight}),x(this,st,n.pending),x(this,Re,e.version),k(this,G,Nt).call(this)},Zi=function(e){let n=m(this,kn).mapPresence;n&&e.length>0&&m(this,Ue).room.mapPresence(r=>n(r,e))},Nt=function(){let e=!m(this,gt)||m(this,Ue).room.status==="idle"?"offline":m(this,Xe)?this.unsynced>0?"saving":"synced":m(this,wn)==="resyncing"?"resyncing":"connecting";x(this,wn,e),k(this,G,Yi).call(this)},Yi=function(){for(let e of m(this,Hr))e()};var xf=256,vf=5e6,Cf={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};function Xl(t){return t.includes("&")?t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,(e,n)=>{if(n[0]==="#"){let r=n[1]==="x"||n[1]==="X"?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return Number.isFinite(r)&&r>0&&r<=1114111&&!(r>=55296&&r<=57343)?String.fromCodePoint(r):""}return Cf[n]??e}):t}var Qi=t=>t.slice(t.indexOf(":")+1);function ea(t){let e=t.charCodeAt(0)===65279?1:0,n=i=>{throw new S("invalid_document",`Not valid XML: ${i} (at ${e})`)},r=null,o=[],s=0;for(;e<t.length;){let i=t.indexOf("<",e),a=i<0?t.length:i;if(a>e){let l=t.slice(e,a),u=o[o.length-1];u?u.children.push(Xl(l)):l.trim()!==""&&n("text outside the root element"),e=a}if(i<0)break;if(t.startsWith("<!--",e)){let l=t.indexOf("-->",e+4);l<0&&n("unclosed comment"),e=l+3}else if(t.startsWith("<![CDATA[",e)){let l=t.indexOf("]]>",e+9);l<0&&n("unclosed CDATA"),o[o.length-1]?.children.push(t.slice(e+9,l)),e=l+3}else if(t.startsWith("<?",e)){let l=t.indexOf("?>",e+2);l<0&&n("unclosed declaration"),e=l+2}else if(t.startsWith("<!",e)){let l=0,u=e+2;for(;u<t.length;u++){let c=t[u];if(c==="[")l++;else if(c==="]")l--;else if(c===">"&&l<=0)break}u>=t.length&&n("unclosed declaration"),e=u+1}else if(t.startsWith("</",e)){let l=t.indexOf(">",e+2);l<0&&n("unclosed end tag");let u=Qi(t.slice(e+2,l).trim()),c=o.pop();(!c||c.name!==u)&&n(`unexpected </${u}>`),e=l+1}else{let l=e+1,u=l;for(;l<t.length&&!/[\s/>]/.test(t[l]);)l++;let c={name:Qi(t.slice(u,l)),attrs:{},children:[]};for(c.name===""&&n("a tag with no name");;){for(;l<t.length&&/\s/.test(t[l]);)l++;let p=t[l];if(p===void 0&&n("unclosed tag"),p===">"||p==="/")break;let h=l;for(;l<t.length&&!/[\s=/>]/.test(t[l]);)l++;let g=t.slice(h,l);for(;l<t.length&&/\s/.test(t[l]);)l++;for(t[l]!=="="&&n(`attribute "${g}" has no value`),l++;l<t.length&&/\s/.test(t[l]);)l++;let y=t[l];y!=='"'&&y!=="'"&&n(`attribute "${g}" isn't quoted`);let b=t.indexOf(y,l+1);b<0&&n("unclosed attribute value"),c.attrs[g]=Xl(t.slice(l+1,b)),l=b+1}let d=t[l]==="/";d&&l++,t[l]!==">"&&n("a tag that doesn't end"),e=l+1,++s>vf&&n("too many elements");let f=o[o.length-1];f?f.children.push(c):r?n("more than one root element"):r=c,d||(o.push(c),o.length>xf&&n("elements nested too deeply"))}}return o.length>0&&n(`<${o[o.length-1].name}> was never closed`),r||n("no root element"),r}function ze(t){return t?t.children.filter(e=>typeof e!="string"):[]}function I(t,e){return t?.children.find(n=>typeof n!="string"&&n.name===e)}function Ne(t,e){return t?t.children.filter(n=>typeof n!="string"&&n.name===e):[]}function C(t,e,n){if(!t)return;let r=n?`${n}:${e}`:void 0;if(r&&r in t.attrs)return t.attrs[r];if(!n){if(`w:${e}`in t.attrs)return t.attrs[`w:${e}`];if(e in t.attrs)return t.attrs[e]}for(let[o,s]of Object.entries(t.attrs))if(Qi(o)===e&&(!n||o.startsWith(`${n}:`)))return s}function Yt(t){return t?t.children.map(e=>typeof e=="string"?e:Yt(e)).join(""):""}function Kr(t){return Array.isArray(t)?`[${t.map(Kr).join(",")}]`:t&&typeof t=="object"?`{${Object.entries(t).filter(([,n])=>n!==void 0).sort(([n],[r])=>n<r?-1:n>r?1:0).map(([n,r])=>`${JSON.stringify(n)}:${Kr(r)}`).join(",")}}`:JSON.stringify(t)??"null"}function ta(t){let e=2166136261;for(let n=0;n<t.length;n++)e^=t.charCodeAt(n),e=Math.imul(e,16777619)>>>0;return`${e.toString(36)}.${t.length.toString(36)}`}function na(t){return ta(Kr(t))}function Pf(t,e){let n=()=>t.setOnline(!1),r=()=>t.setOnline(!0);return e.on("disconnect",n),e.on("connect",r),()=>{e.off?.("disconnect",n),e.off?.("connect",r)}}function Vl(t,e,n){let r="core"in t?t.core:t,{room:o,comments:s}=n,i=new Sn({session:r,room:o,model:e,version:n.version,verifyEvery:n.verifyEvery,onResync:n.onResync}),a=[];s&&o.attachComments(s),n.socket&&a.push(Pf(i,n.socket)),i.start();let l=o.status==="idle";l&&Promise.resolve(o.connect()).catch(()=>{});let u=new Promise(d=>{if(i.version!==null)return d();let f=i.subscribe(()=>{i.version!==null&&(f(),d())});a.push(f)}),c=!1;return{sync:i,ready:u,stop(){if(!c){c=!0,i.stop();for(let d of a.splice(0))d();s&&o.attachComments(null),l&&o.disconnect()}}}}var Wr,$t,xn,ir=class{constructor(e,n={}){D(this,Wr);D(this,$t);D(this,xn,!1);x(this,Wr,e),x(this,$t,n)}get running(){return m(this,xn)}run(e){if(m(this,xn))throw new S("invalid_operation","A script is already running");let n=new Set(m(this,$t).grants??["read","write"]),r=m(this,$t).maxOps??1e4,o=m(this,$t).maxMs??5e3,s=m(this,$t).now??Date.now,i=s(),a=m(this,Wr),l=0,u=d=>{if(!n.has(d))throw new S("invalid_operation",`Scripts are not allowed to ${d} here`)},c={get state(){return u("read"),a.state},get applied(){return l},can:d=>n.has(d),apply:(d,f={})=>{if(u("write"),d.length!==0){if(s()-i>o)throw new S("invalid_operation",`The script ran for longer than ${o} ms`);if(l+d.length>r)throw new S("invalid_operation",`The script tried to apply more than ${r} operations`);for(let p of d)if(m(this,$t).allow&&!m(this,$t).allow(p))throw new S("invalid_operation","The script tried to make a change it is not allowed to");a.transact(d,{...f,...l>0?{merge:!0}:{}}),l+=d.length}}};x(this,xn,!0);try{return e(c)}catch(d){throw l>0&&a.undo(),d}finally{x(this,xn,!1)}}onEdit(e,n={}){return m(this,Wr).subscribe(r=>{m(this,xn)||r.origin==="remote"&&n.remote===!1||e(r)})}};Wr=new WeakMap,$t=new WeakMap,xn=new WeakMap;function ra(t){let{core:e,model:n,kind:r}=t,o={kind:r,core:e,model:n,get state(){return e.state},get canUndo(){return e.canUndo},get canRedo(){return e.canRedo},transact:(s,i)=>(t.transact??((a,l)=>e.transact(a,l)))(s,i),undo:()=>t.undo?t.undo():e.undo(),redo:()=>t.redo?t.redo():e.redo(),subscribe:s=>e.subscribe(s),serialize:()=>Kr(e.state),hash:()=>n.hash(e.state),get supportsComments(){return!!t.comments},get comments(){return t.comments?.get()??null},enableComments(s){if(!t.comments)throw new S("unsupported",`The ${r} editor doesn't have comments yet`);return t.comments.get()??t.comments.enable(s)},attachSync(s,i={}){return Vl(e,n,{comments:o.comments,...i,room:s})},script:s=>new ir(o,s)};return o}function oa(t){let e=()=>[...t.threads()].sort((n,r)=>n.createdAt-r.createdAt);return{load:()=>e(),save(n,r){let o=Ro(r);t.write(o,bn(e(),r).find(s=>s.id===o)??null)}}}function sa(t,e,n){return e.subscribe(r=>{(r.reset||(r.origin==="undo"||r.origin==="redo")&&r.ops.some(n))&&t.reload()})}var Bf=[["Arial","sans-serif","47",!0,["Arimo","Liberation Sans","Helvetica","Helvetica Neue"],["ArialMT","Arial MT"]],["Arial Black","sans-serif","9",!1,["Arial","Archivo Black","Helvetica"]],["Arial Narrow","sans-serif","47",!0,["Arimo","Liberation Sans Narrow","Roboto Condensed","Arial"]],["Aptos","sans-serif","3467",!0,["Segoe UI","Calibri","Carlito","Arial"]],["Aptos Display","sans-serif","4",!1,["Aptos","Segoe UI","Calibri","Arial"]],["Book Antiqua","serif","47",!0,["Palatino Linotype","Palatino","Tinos","Georgia"]],["Bookman Old Style","serif","47",!0,["Bookman","Georgia","Tinos"]],["Calibri","sans-serif","347",!0,["Carlito","Segoe UI","Open Sans","Arial"]],["Calibri Light","sans-serif","3",!0,["Carlito","Calibri","Segoe UI","Arial"]],["Cambria","serif","47",!0,["Caladea","Georgia","Times New Roman"]],["Candara","sans-serif","47",!0,["Calibri","Carlito","Segoe UI","Arial"]],["Century Gothic","sans-serif","47",!0,["Questrial","Poppins","Avenir","Arial"]],["Comic Sans MS","handwriting","47",!0,["Comic Neue","Chalkboard SE","Comic Sans"]],["Consolas","monospace","47",!0,["Inconsolata","Menlo","Courier New"]],["Constantia","serif","47",!0,["Georgia","Gelasio","Times New Roman"]],["Corbel","sans-serif","47",!0,["Calibri","Carlito","Segoe UI","Arial"]],["Courier","monospace","47",!0,["Courier New","Cousine"]],["Courier New","monospace","47",!0,["Cousine","Liberation Mono","Courier"]],["Franklin Gothic Medium","sans-serif","5",!0,["Libre Franklin","Arial"]],["Garamond","serif","47",!0,["EB Garamond","Cormorant Garamond","Georgia","Times New Roman"]],["Georgia","serif","47",!0,["Gelasio","Times New Roman"]],["Gill Sans MT","sans-serif","47",!0,["Gill Sans","Lato","Arial"]],["Helvetica","sans-serif","47",!0,["Arial","Arimo","Liberation Sans"]],["Helvetica Neue","sans-serif","1234567",!0,["Helvetica","Arial","Arimo"]],["Impact","display","5",!1,["Anton","Haettenschweiler","Arial Black"]],["Lucida Console","monospace","4",!1,["Courier New","Cousine","Monaco"]],["Lucida Sans Unicode","sans-serif","4",!1,["Lucida Grande","Arial","Arimo"]],["Menlo","monospace","47",!0,["Monaco","Consolas","Courier New"]],["Monaco","monospace","4",!1,["Menlo","Consolas","Courier New"]],["Palatino Linotype","serif","47",!0,["Palatino","Book Antiqua","Tinos","Georgia"],["Palatino"]],["Rockwell","serif","47",!0,["Roboto Slab","Zilla Slab","Georgia"]],["Brush Script MT","handwriting","4",!0,["Dancing Script","Pacifico","Comic Sans MS"]],["Segoe Print","handwriting","47",!1,["Caveat","Comic Neue","Comic Sans MS"]],["Segoe Script","handwriting","47",!1,["Dancing Script","Pacifico","Comic Sans MS"]],["Segoe UI","sans-serif","3467",!0,["Selawik","Open Sans","Helvetica Neue","Arial"]],["Tahoma","sans-serif","47",!1,["Noto Sans","DejaVu Sans","Verdana","Arial"]],["Times New Roman","serif","47",!0,["Tinos","Liberation Serif","Times"],["Times","TimesNewRomanPSMT"]],["Trebuchet MS","sans-serif","47",!0,["Fira Sans","Lucida Grande","Arial"]],["Verdana","sans-serif","47",!0,["DejaVu Sans","Geneva","Arial"]]],Of=t=>[...t].map(e=>Number(e)*100),Jl=Bf.map(([t,e,n,r,o,s])=>({family:t,category:e,origin:"system",weights:Of(n),italic:r,subsets:[],fallbacks:o,...s?{aliases:s}:{},office:t})),Zl={arialmt:"Arial","arial mt":"Arial","arial-boldmt":"Arial",times:"Times New Roman",timesnewromanpsmt:"Times New Roman","times new roman ps":"Times New Roman","courier new ps":"Courier New",couriernewpsmt:"Courier New","helvetica neue light":"Helvetica Neue","segoe ui light":"Segoe UI","segoe ui semibold":"Segoe UI","calibri (body)":"Calibri","calibri (headings)":"Calibri Light","cambria (headings)":"Cambria","cambria (body)":"Cambria","system-ui":"Segoe UI","-apple-system":"Helvetica Neue","sans-serif":"Arial",serif:"Times New Roman",monospace:"Courier New"};var Yl="cyrillic|cyrillic-ext|greek|greek-ext|latin|latin-ext|vietnamese|hebrew|armenian|bengali|canadian-aboriginal|devanagari|ethiopic|georgian|gujarati|gurmukhi|khmer|lao|malayalam|oriya|sinhala|tamil|telugu|thai|japanese|arabic|korean|chinese-traditional|chinese-simplified|cherokee|nushu|syriac|tifinagh|adlam|old-permic|gothic|old-italic|runic|chinese-hongkong|kayah-li|myanmar|kannada|meetei-mayek|ol-chiki|mayan-numerals|lisu|tibetan|warang-citi|khojki|cypriot|mongolian|samaritan|thaana|tagalog|kirat-rai|sora-sompeng|buhid|new-tai-lue|beria-erfe|yi|nabataean|javanese|phoenician|bhaiksuki|osmanya|old-persian|tai-viet|brahmi|tangsa|chakma|linear-a|anatolian-hieroglyphs|pahawh-hmong|dives-akuru|coptic|hanunoo|tangut|shavian|wancho|egyptian-hieroglyphs|tai-le|nag-mundari|balinese|vithkuqi|batak|cypro-minoan|multani|marchen|syloti-nagri|ahom|nko|sunuwar|limbu|kaithi|carian|takri|glagolitic|old-north-arabian|old-turkic|gunjala-gondi|dogra|toto|yezidi|cuneiform|elbasan|nandinagari|indic-siyaq-numbers|osage|old-hungarian|sundanese|medefaidrin|avestan|duployan|nyiakeng-puachue-hmong|lepcha|lydian|grantha|siddham|inscriptional-pahlavi|meroitic|meroitic-cursive|meroitic-hieroglyphs|bamum|makasar|todhri|imperial-aramaic|ottoman-siyaq-numbers|mahajani|newa|vai|tai-tham|inscriptional-parthian|kana-extended|cham|ugaritic|mende-kikakui|buginese|tagbanwa|linear-b|deseret|sharada|old-south-arabian|zanabazar-square|kharoshthi|palmyrene|mro|znamenny|khitan-small-script|miao|saurashtra|bassa-vah|old-uyghur|caucasian-albanian|phags-pa|kawi|signwriting|masaram-gondi|old-sogdian|hanifi-rohingya|rejang|hatran|sogdian|tamil-supplement|khudawadi|psalter-pahlavi|soyombo|ogham|chorasmian|lycian|tirhuta|elymaic|modi|pau-cin-hau|mandaic|manichaean";var Ql=`Roboto;s;123456789;i;0,1,2,3,4,5,6
Open Sans;s;345678;i;0,1,2,3,7,4,5,6
Google Sans;s;4567;i;8,9,10,0,1,11,12,13,2,3,14,15,7,16,17,4,5,18,19,20,21,22,23,6
Inter;s;123456789;i;0,1,2,3,4,5,6
Montserrat;s;123456789;i;0,1,4,5,6
Poppins;s;123456789;i;11,4,5
Lato;s;13479;i;4,5
Noto Sans JP;s;123456789;;0,24,4,5,6
Arimo;s;4567;i;0,1,2,3,7,4,5,6
Roboto Condensed;s;123456789;i;0,1,2,3,4,5,6
Roboto Mono;m;1234567;i;0,1,2,4,5,6
Oswald;s;234567;;0,1,4,5,6
Noto Sans;s;123456789;i;0,1,11,2,3,4,5,6
DM Sans;s;123456789;i;4,5
Playfair Display;r;456789;i;0,4,5,6
Nunito;s;23456789;i;0,1,4,5,6
Raleway;s;123456789;i;0,1,4,5,6
Nunito Sans;s;23456789;i;0,1,4,5,6
Roboto Slab;r;123456789;;0,1,2,3,4,5,6
Manrope;s;2345678;;0,1,2,4,5,6
Rubik;s;3456789;i;25,0,1,7,4,5
Outfit;s;123456789;;4,5
Plus Jakarta Sans;s;2345678;i;1,4,5,6
Merriweather;r;3456789;i;0,1,4,5,6
Ubuntu;s;3457;i;0,1,2,3,4,5
Kanit;s;123456789;i;4,5,23,6
Figtree;s;3456789;i;4,5
Noto Sans KR;s;123456789;;0,26,4,5,6
Lora;r;4567;i;0,1,4,5,6
Archivo Black;s;4;;4,5
Bebas Neue;s;4;;4,5
JetBrains Mono;m;12345678;i;0,1,2,4,5,6
Work Sans;s;123456789;i;4,5,6
Archivo;s;123456789;i;4,5,6
Prompt;s;123456789;i;4,5,23,6
Barlow;s;123456789;i;4,5,6
Noto Sans TC;s;123456789;;27,0,4,5,6
Black Ops One;d;4;;1,4,5,6
Mulish;s;23456789;i;0,1,4,5,6
Saira;s;123456789;i;4,5,6
IBM Plex Sans;s;1234567;i;0,1,2,4,5,6
Jost;s;123456789;i;0,4,5
PT Sans;s;47;i;0,1,4,5
Share Tech;s;4;;4
Quicksand;s;34567;;4,5,6
Bricolage Grotesque;s;2345678;;4,5,6
Smooch Sans;s;123456789;;4,5,6
Space Grotesk;s;34567;;4,5,6
Cormorant Garamond;r;34567;i;0,1,4,5,6
Source Code Pro;m;23456789;i;0,1,2,3,4,5,6
Source Sans 3;s;23456789;i;0,1,2,3,4,5,6
Karla;s;2345678;i;4,5
Barlow Condensed;s;123456789;i;4,5,6
Fira Sans;s;123456789;i;0,1,2,3,4,5,6
IBM Plex Mono;m;1234567;i;0,1,4,5,6
Instrument Serif;r;4;i;4,5
Noto Serif;r;123456789;i;0,1,2,3,4,5,6
Libre Baskerville;r;4567;i;4,5
Titillium Web;s;234679;i;4,5
Fraunces;r;123456789;i;4,5,6
Anton;s;4;;4,5,6
Inter Tight;s;123456789;i;0,1,2,3,4,5,6
Heebo;s;123456789;;7,4,5
PT Serif;r;47;i;0,1,4,5
Noto Sans SC;s;123456789;;28,0,4,5,6
Inconsolata;m;23456789;;4,5,6
Noto Serif JP;r;23456789;;0,24,4,5,6
Changa One;d;4;i;4
EB Garamond;r;45678;i;0,1,2,3,4,5,6
Libre Franklin;s;123456789;i;0,1,4,5,6
Dancing Script;h;4567;;4,5,6
Cairo;s;23456789;;25,4,5
Alfa Slab One;d;4;;4,5,6
Public Sans;s;123456789;i;4,5,6
Google Sans Flex;s;123456789;;10,29,4,5,30,31,32,6
Sora;s;12345678;;4,5
Josefin Sans;s;1234567;i;4,5,6
Geist;s;123456789;i;0,1,4,5,6
Assistant;s;2345678;;7,4,5
Fjalla One;s;4;;1,4,5,6
Hind Siliguri;s;34567;;9,4,5
Lobster Two;d;47;i;4
Mukta;s;2345678;;11,4,5
Schibsted Grotesk;s;456789;i;4,5
Orbitron;s;456789;;4
Urbanist;s;123456789;i;4,5
Caveat;h;4567;;0,1,4,5
Newsreader;r;2345678;i;4,5,6
Baloo 2;d;45678;;11,4,5,6
Fredoka;s;34567;;7,4,5
Source Serif 4;r;23456789;i;0,1,2,4,5,6
Instrument Sans;s;4567;i;4,5
M PLUS Rounded 1c;s;1345789;;0,1,2,3,7,24,4,5,6
Lexend;s;123456789;;4,5,6
Nanum Gothic;s;478;;26,4
Bitter;r;123456789;i;0,1,4,5,6
Cabin;s;4567;i;4,5,6
Cinzel;r;456789;;4,5
DM Serif Display;r;4;i;4,5
Rajdhani;s;34567;;11,4,5
Dosis;s;2345678;;4,5,6
Noto Sans Khmer;s;123456789;;16,4,5
Red Hat Display;s;3456789;i;4,5
Roboto Flex;s;4;;0,1,2,4,5,6
Zeyada;h;4;;4,5
Merriweather Sans;s;345678;i;1,4,5,6
Noto Sans Telugu;s;123456789;;4,5,22
Exo 2;s;123456789;i;0,1,4,5,6
Tajawal;s;2345789;;25,4
Ramabhadra;s;4;;4,22
Geist Mono;m;123456789;i;0,1,4,5,6
Anek Telugu;s;12345678;;4,5,22
Slabo 27px;r;4;;4,5
Pacifico;h;4;;0,1,4,5,6
Oxygen;s;347;;4,5
Barlow Semi Condensed;s;123456789;i;4,5,6
Bodoni Moda;r;456789;i;4,5
Hanken Grotesk;s;123456789;i;1,4,5,6
Hind;s;34567;;11,4,5
Faustina;r;345678;i;4,5,6
Epilogue;s;123456789;i;4,5,6
Noto Sans Arabic;s;123456789;;25,4,5
Crimson Text;r;467;i;4,5,6
Arvo;r;47;i;4
Teko;s;34567;;11,4,5
Chakra Petch;s;34567;i;4,5,23,6
Roboto Serif;r;123456789;i;0,1,4,5,6
Overpass;s;123456789;i;0,1,4,5,6
DM Mono;m;345;i;4,5
Lobster;d;4;;0,1,4,5,6
Bungee;d;4;;4,5,6
Noto Sans Thai;s;123456789;;4,5,23
Shantell Sans;d;345678;i;0,1,4,5,6
Zen Kaku Gothic New;s;34579;;0,24,4,5
PT Sans Narrow;s;47;;0,1,4,5
M PLUS 1p;s;1345789;;0,1,2,3,7,24,4,5,6
Comfortaa;d;34567;;0,1,2,4,5,6
Space Mono;m;47;i;4,5,6
Asap;s;123456789;i;4,5,6
Quantico;s;47;i;4
Lilita One;d;4;;4,5
Be Vietnam Pro;s;123456789;i;4,5,6
Abel;s;4;;4
Saira Condensed;s;123456789;;4,5,6
Questrial;s;4;;4,5,6
Shadows Into Light;h;4;;4,5
Unbounded;s;23456789;;0,1,4,5,6
Onest;s;123456789;;0,1,4,5,6
Maven Pro;s;456789;;4,5,6
Domine;r;4567;;4,5
Zilla Slab;r;34567;i;4,5
Almarai;s;3478;;25,4
Marcellus;r;4;;4,5
IBM Plex Sans Arabic;s;1234567;;25,1,4,5
Archivo Narrow;s;4567;i;4,5,6
Albert Sans;s;123456789;i;4,5
Cormorant;r;34567;i;0,1,4,5,6
Spectral;r;2345678;i;0,1,4,5,6
Geologica;s;123456789;;0,1,2,4,5,6
ABeeZee;s;4;i;4,5
Abril Fatface;d;4;;4,5
Great Vibes;h;4;;0,1,3,4,5,6
League Spartan;s;123456789;;4,5,6
Lexend Deca;s;123456789;;4,5,6
Syne;s;45678;;2,4,5
Play;s;47;;0,1,2,4,5,6
Frank Ruhl Libre;r;3456789;;7,4,5
Exo;s;123456789;i;4,5,6
Gravitas One;d;4;;4
Noto Serif SC;r;23456789;;28,0,4,5,6
Permanent Marker;h;4;;4
Nanum Myeongjo;r;478;;26,4
IBM Plex Serif;r;1234567;i;0,1,4,5,6
Zen Maru Gothic;s;34579;;0,2,24,4,5
Noto Serif TC;r;23456789;;27,0,4,5,6
Varela Round;s;4;;7,4,5,6
Satisfy;h;4;;4
Noto Serif KR;r;23456789;;0,26,4,5,6
Amiri;r;47;i;25,4,5
Noto Sans Tamil;s;123456789;;4,5,21
Fira Sans Condensed;s;123456789;i;0,1,2,3,4,5,6
Kalam;h;347;;11,4,5
Atkinson Hyperlegible;s;47;i;4,5
Yellowtail;h;4;;4,5
Crimson Pro;r;23456789;i;4,5,6
Sofia Sans;s;123456789;i;0,1,2,4,5
Chivo;s;123456789;i;4,5,6
Indie Flower;h;4;;4,5
News Cycle;s;47;;0,1,2,3,4,5,6
Noto Kufi Arabic;s;123456789;;25,4,5
Noto Naskh Arabic;r;4567;;25,4,5
Noto Sans Devanagari;s;123456789;;11,4,5
Literata;r;23456789;i;0,1,2,3,4,5,6
Hammersmith One;s;4;;4,5
Alegreya Sans;s;1345789;i;0,1,2,3,4,5,6
Vollkorn;r;456789;i;0,1,2,4,5,6
Nanum Gothic Coding;h;47;;26,4
Luckiest Guy;d;4;;4,5
Patrick Hand;h;4;;4,5,6
Catamaran;s;123456789;;4,5,21
LINE Seed JP;s;1478;;0,3,24,4,5
Press Start 2P;d;4;;0,1,2,4,5
Shippori Mincho;r;45678;;24,4,5
Courier Prime;m;47;i;4,5
Sarabun;s;12345678;i;4,5,23,6
Playfair;r;3456789;i;0,1,4,5,6
DM Serif Text;r;4;i;4,5
Baskervville;r;4567;i;4,5
Hind Madurai;s;34567;;4,5,21
Righteous;d;4;;4,5
Comic Neue;h;347;i;4
Readex Pro;s;234567;;25,4,5,6
Tenor Sans;s;4;;0,4,5
Prata;r;4;;0,1,4,6
Google Sans Code;m;345678;i;33,10,29,4,5,34,31,6
Special Elite;d;4;;4,5
Lexend Giga;s;123456789;;4,5,6
Cardo;r;47;i;35,2,3,7,4,5,36,37
Red Hat Text;s;34567;i;4,5
Alata;s;4;;4,5,6
Rowdies;d;347;;4,5,6
Montserrat Alternates;s;123456789;i;0,1,4,5,6
Rethink Sans;s;45678;i;4,5
Noto Sans Display;s;123456789;i;0,1,2,3,4,5,6
Golos Text;s;456789;;0,1,4,5
Alegreya;r;456789;i;0,1,2,3,4,5,6
Russo One;s;4;;0,4,5
Gothic A1;s;123456789;;0,1,2,3,26,4,5,6
League Gothic;s;4;;4,5,6
Noto Nastaliq Urdu;r;4567;;25,4,5
Acme;s;4;;4
Bree Serif;r;4;;4,5
Tinos;r;47;i;0,1,2,3,7,4,5,6
Amatic SC;h;47;;0,7,4,5,6
Libre Caslon Text;r;47;i;4,5
Viga;s;4;;4,5
Patua One;d;4;;4
Signika;s;34567;;4,5,6
Share Tech Mono;m;4;;4
Bangers;d;4;;4,5,6
Oleo Script;d;47;;4,5
Khand;s;34567;;11,4,5
Aleo;r;123456789;i;4,5,6
Crete Round;r;4;i;4,5
Yanone Kaffeesatz;s;234567;;0,1,4,5,6
Sanchez;r;4;i;4,5
Antonio;s;1234567;;4,5
Londrina Solid;d;1349;;4
Fira Code;m;34567;;0,1,2,3,4,5
Changa;s;2345678;;25,4,5
Vazirmatn;s;123456789;;25,4,5
Noticia Text;r;47;i;4,5,6
Allura;h;4;;4,5,6
Cantarell;s;47;i;4,5
IBM Plex Sans Condensed;s;1234567;i;1,4,5,6
Oxanium;d;2345678;;4,5
Titan One;d;4;;4,5
BIZ UDPGothic;s;47;;0,3,24,4,5
Alexandria;s;123456789;;25,4,5,6
Kumbh Sans;s;123456789;;4,5
Passion One;d;479;;4,5
Kaushan Script;h;4;;4,5
Encode Sans;s;123456789;;4,5,6
Biryani;s;2346789;;11,4,5
Courgette;h;4;;4,5
Old Standard TT;r;47;i;0,1,4,5,6
Zen Old Mincho;r;45679;;0,2,24,4,5
Chelsea Market;d;4;;4,5
Sawarabi Mincho;r;4;;24,4,5
Antic Slab;r;4;;4
Noto Sans Mono;s;123456789;;0,1,2,3,4,5,6
Gruppo;s;4;;4,5
Libre Barcode 39;d;4;;4
Francois One;s;4;;4,5,6
Philosopher;s;47;i;0,1,4,5,6
Rubik Mono One;s;4;;0,4,5
Noto Sans Bengali;s;123456789;;9,4,5
Pinyon Script;h;4;;4,5,6
Commissioner;s;123456789;;0,1,2,4,5,6
Cinzel Decorative;d;479;;4,5
Sacramento;h;4;;4,5
Saira Extra Condensed;s;123456789;;4,5,6
VT323;m;4;;4,5,6
Paytone One;s;4;;4,5,6
Krub;s;234567;i;4,5,23,6
Yantramanav;s;134579;;11,4,5
Gabarito;d;456789;;4,5
Audiowide;d;4;;4,5
Sen;s;45678;;4,5
Dela Gothic One;d;4;;0,2,24,4,5,6
Gilda Display;r;4;;4,5
Fugaz One;d;4;;4
Radio Canada;s;34567;i;10,4,5,6
STIX Two Text;r;4567;i;0,1,2,4,5,6
Martel;r;2346789;;11,4,5
Encode Sans Condensed;s;123456789;;4,5,6
Josefin Slab;r;1234567;i;4
Playball;d;4;;4,5,6
Noto Sans Hebrew;s;123456789;;1,3,7,4,5
Funnel Sans;s;345678;i;4,5
Sawarabi Gothic;s;4;;0,24,4,5,6
Advent Pro;s;123456789;i;0,1,2,4,5
Delius;h;4;;4
IBM Plex Sans Thai;s;1234567;;1,4,5,23
Volkhov;r;47;i;4
Rammetto One;d;4;;4,5
Rokkitt;r;123456789;i;4,5,6
Didact Gothic;s;4;;0,1,2,3,4,5
Kosugi Maru;s;4;;0,24,4,5
Unna;r;47;i;4,5
Noto Sans HK;s;123456789;;38,0,4,5,6
Forum;d;4;;0,1,4,5
Amaranth;s;47;i;4
Quattrocento;r;47;;4,5
Creepster;d;4;;4
Ubuntu Condensed;s;4;;0,1,2,3,4,5
Playfair Display SC;r;479;i;0,4,5,6
Actor;s;4;;4
Neuton;r;23478;i;4,5
PT Sans Caption;s;47;;0,1,4,5
El Messiri;s;4567;;25,0,4,5
M PLUS 1;s;123456789;;24,4,5,6
Andada Pro;r;45678;i;4,5,6
Angkor;d;4;;16,4
Bai Jamjuree;s;234567;i;4,5,23,6
Tangerine;h;47;;4
Quattrocento Sans;s;47;i;4,5
Istok Web;s;47;i;0,1,4,5
Sofia Sans Condensed;s;123456789;i;0,1,2,4,5
Poiret One;d;4;;0,4,5
Abhaya Libre;r;45678;;4,5,20
Alex Brush;h;4;;4,5,6
Gloria Hallelujah;h;4;;4,5
PT Mono;m;4;;0,1,4,5
Host Grotesk;s;345678;i;4,5
Architects Daughter;h;4;;4,5
Concert One;d;4;;4,5
Yeseva One;d;4;;0,1,4,5,6
Homemade Apple;h;4;;4
Asap Condensed;s;23456789;i;4,5,6
Lalezar;s;4;;25,4,5,6
Cormorant Infant;r;34567;i;0,1,4,5,6
Signika Negative;s;34567;;4,5,6
Noto Serif Display;r;123456789;i;0,1,2,3,4,5,6
Ubuntu Mono;m;47;i;0,1,2,3,4,5
Noto Sans Malayalam;s;123456789;;4,5,18
Gelasio;r;4567;i;4,5,6
Staatliches;d;4;;4,5
Racing Sans One;d;4;;4,5
Libre Bodoni;r;4567;i;4,5,6
Bowlby One SC;d;4;;4,5
Nanum Pen Script;h;4;;26,4
Jua;s;4;;26,4
Fira Sans Extra Condensed;s;123456789;i;0,1,2,3,4,5,6
Averia Serif Libre;d;347;i;4
Tiro Devanagari Hindi;r;4;i;11,4,5
Lusitana;r;47;;4
Radio Canada Big;s;4567;i;4,5
Arsenal;s;47;i;0,1,4,5,6
GFS Didot;r;4;;2,3,4,6
Michroma;s;4;;4,5
Black Han Sans;s;4;;26,4
Shippori Mincho B1;r;45678;;24,4,5
Mitr;s;234567;;4,5,23,6
Vidaloka;r;4;;4
Goldman;d;47;;4,5,6
Cookie;h;4;;4
Sorts Mill Goudy;r;4;i;4,5
Tektur;d;456789;;0,1,2,4,5,6
Reenie Beanie;h;4;;4
Pathway Gothic One;s;4;;4,5
Merienda;h;3456789;;4,5,6
Parisienne;h;4;;4,5
Pragati Narrow;s;47;;11,4,5
Belleza;s;4;;4,5
Afacad;s;4567;i;1,4,5,6
Petrona;r;123456789;i;4,5,6
Besley;r;456789;i;4,5
Mrs Saint Delafield;h;4;;4,5
Unica One;d;4;;4,5,6
Monda;s;4567;;4,5,6
Rock Salt;h;4;;4
Saira Semi Condensed;s;123456789;;4,5,6
Alice;r;4;;0,1,4,5
Georama;s;123456789;i;4,5,6
Italiana;s;4;;4
Amita;h;47;;11,4,5
Anek Bangla;s;12345678;;9,4,5
Sofia Sans Extra Condensed;s;123456789;i;0,1,2,4,5
Carlito;s;47;i;0,1,2,3,4,5,6
Noto Serif Bengali;r;123456789;;9,4,5
Caveat Brush;h;4;;4,5
Reem Kufi;s;4567;;25,4,5,6
Calistoga;d;4;;4,5,6
Alumni Sans;s;123456789;i;0,1,4,5,6
Pixelify Sans;d;4567;;0,4,5
Mona Sans;s;23456789;i;4,5,6
Familjen Grotesk;s;4567;i;4,5,6
Secular One;s;4;;7,4,5
Lemonada;d;34567;;25,4,5,6
Atkinson Hyperlegible Next;s;2345678;i;4,5
Rye;d;4;;4,5
Varela;s;4;;4,5
Italianno;h;4;;4,5,6
Cutive Mono;m;4;;4,5
Mate;r;4;i;4,5
Anek Latin;s;12345678;;4,5,6
Anonymous Pro;m;47;i;0,2,4,5
Arapey;r;4;i;4
Blinker;s;12346789;;4,5
Annie Use Your Telescope;h;4;;4,5
Marck Script;h;4;;0,4,5
Zen Kaku Gothic Antique;s;34579;;0,24,4,5
Kaisei Decol;r;457;;0,24,4,5
Suez One;r;4;;7,4,5
Proza Libre;s;45678;i;4,5
Carter One;d;4;;4
Berkshire Swash;h;4;;4,5
Cousine;m;47;i;0,1,2,3,7,4,5,6
Gloock;r;4;;1,4,5
Jura;s;34567;;0,1,2,3,39,4,5,6
Bowlby One;d;4;;4
Noto Sans Georgian;s;123456789;;1,13,3,4,5
Sriracha;h;4;;4,5,23,6
Balsamiq Sans;d;47;i;0,1,4,5
Caprasimo;d;4;;4,5
Dongle;s;347;;26,4,5,6
Khula;s;34678;;11,4,5
Monoton;d;4;;4,5
Murecho;s;123456789;;0,1,2,24,4,5
Reddit Sans;s;23456789;i;4,5,6
Eczar;r;45678;;11,2,3,4,5
Ultra;r;4;;4,5
Nothing You Could Do;h;4;;4
Handlee;h;4;;4
MuseoModerno;d;123456789;i;4,5,6
IBM Plex Sans JP;s;1234567;;0,24,4,5
Silkscreen;d;47;;4,5
Chewy;d;4;;4
Noto Sans Symbols;s;123456789;;4,5
Wix Madefor Display;s;45678;;0,1,4,5,6
Mada;s;23456789;;25,4,5
Hind Guntur;s;34567;;4,5,22
Baloo Bhai 2;d;45678;;14,4,5,6
Mr Dafoe;h;4;;4,5
Noto Sans Sinhala;s;123456789;;4,5,20
Squada One;d;4;;4
Bad Script;h;4;;0,1,4,5,6
Julius Sans One;s;4;;4,5
Pirata One;d;4;;4,5
Syncopate;s;47;;4,5
Fira Mono;m;457;;0,1,2,3,4,5
Chango;d;4;;4,5
Funnel Display;d;345678;;4,5
M PLUS 2;s;123456789;;24,4,5,6
IBM Plex Sans KR;s;1234567;;26,4,5
Belanosima;s;467;;4,5
Mukta Malar;s;2345678;;4,5,21
Neucha;h;4;;0,4
Damion;h;4;;4,5
Alegreya Sans SC;s;1345789;i;0,1,2,3,4,5,6
Darker Grotesque;s;3456789;;4,5,6
Grandstander;d;123456789;i;4,5,6
Gantari;s;123456789;i;4,5
Gochi Hand;h;4;;4
Shrikhand;d;4;;14,4,5
Eater;d;4;;4,5
Wix Madefor Text;s;45678;i;0,1,4,5,6
Do Hyeon;s;4;;26,4
Charm;h;47;;4,5,23,6
Palanquin;s;1234567;;11,4,5
Oooh Baby;h;4;;4,5,6
Hachi Maru Pop;h;4;;0,24,4,5
Libre Caslon Display;r;4;;4,5
Cuprum;s;4567;i;0,1,4,5,6
Potta One;d;4;;24,4,5,6
Jersey 25;d;4;;4,5
Akshar;s;34567;;11,4,5
Aboreto;d;4;;4,5
Big Shoulders;d;123456789;;4,5,6
Coda;d;48;;4,5
Andika;s;47;i;0,1,4,5,6
Fahkwang;s;234567;i;4,5,23,6
Ovo;r;4;;4
Ms Madi;h;4;;4,5,6
Taviraj;r;123456789;i;4,5,23,6
Adamina;r;4;;4
Azeret Mono;m;123456789;i;4,5
Economica;s;47;i;4,5
Six Caps;s;4;;4,5
Tomorrow;s;123456789;i;4,5
Itim;h;4;;4,5,23,6
Young Serif;r;4;;4,5
Pridi;r;234567;;4,5,23,6
Leckerli One;h;4;;4
Sofia;h;4;;4
Basic;s;4;;4,5
Knewave;d;4;;4,5
Pangolin;h;4;;0,1,4,5,6
Bevan;r;4;i;4,5,6
Limelight;d;4;;4,5
Gudea;s;47;i;4,5
Geo;s;4;i;4
Martian Mono;m;12345678;;0,1,4,5
IM Fell English;r;4;i;4
Baloo Da 2;d;45678;;9,4,5,6
Aclonica;s;4;;4,5
Noto Sans Gujarati;s;123456789;;14,4,5
BenchNine;s;347;;4,5
Ma Shan Zheng;h;4;;28,4
Spline Sans;s;34567;;4,5
ZCOOL XiaoWei;s;4;;28,4
Kreon;r;34567;;4,5
Martel Sans;s;2346789;;11,4,5
Ruda;s;456789;;0,4,5,6
Fustat;s;2345678;;25,4,5
Spline Sans Mono;m;34567;i;4,5
Sansita;s;4789;i;4,5
Parkinsans;s;345678;;4,5
Lateef;r;2345678;;25,4,5
Niramit;s;234567;i;4,5,23,6
Just Another Hand;h;4;;4,5
Gowun Batang;r;47;;26,4,5,6
Hind Vadodara;s;34567;;14,4,5
Kiwi Maru;r;345;;0,24,4,5
Yuji Mai;r;4;;0,24,4,5
Ropa Sans;s;4;i;4,5
Yatra One;d;4;;11,4,5
Charis SIL;r;47;i;0,1,4,5,6
Marcellus SC;r;4;;4,5
Krona One;s;4;;4,5
Cabin Condensed;s;4567;;4,5,6
Overpass Mono;m;34567;;0,1,4,5,6
Covered By Your Grace;h;4;;4,5
Glory;s;12345678;i;4,5,6
UnifrakturMaguntia;d;4;;4
Trirong;r;123456789;i;4,5,23,6
Cal Sans;s;4;;4,5,6
Tiro Bangla;r;4;i;9,4,5
Anuphan;s;1234567;;4,5,23,6
Pontano Sans;s;34567;;4,5
Noto Sans Myanmar;s;123456789;;4,5,40
Lexend Zetta;s;123456789;;4,5,6
Spinnaker;s;4;;4,5
Baloo Bhaijaan 2;d;45678;;25,4,5,6
Noto Sans Gurmukhi;s;123456789;;15,4,5
K2D;s;12345678;i;4,5,23,6
Mandali;s;4;;4,22
Cedarville Cursive;h;4;;4
DotGothic16;s;4;;0,24,4,5
Special Gothic Expanded One;s;4;;4,5
Rozha One;r;4;;11,4,5
Days One;s;4;;0,4
Rampart One;d;4;;0,24,4,5
BIZ UDGothic;s;47;;0,3,24,4,5
Tilt Warp;d;4;;4,5,6
Rufina;r;47;;4,5
Noto Sans Kannada;s;123456789;;41,4,5
Chivo Mono;m;123456789;i;4,5,6
Cantata One;r;4;;4,5
Karma;r;34567;;11,4,5
Science Gothic;s;123456789;;0,1,4,5,6
Vina Sans;d;4;;4,5,6
Boogaloo;d;4;;4
Electrolize;s;4;;4
Red Hat Mono;m;34567;i;4,5
Zalando Sans Expanded;s;23456789;i;4,5,6
Shadows Into Light Two;h;4;;4,5
Klee One;h;46;;0,3,24,4,5
Petit Formal Script;h;4;;4,5
Fredericka the Great;d;4;;4,5
Poller One;d;4;;4
Castoro;r;4;i;4,5
Mochiy Pop One;s;4;;24,4
Barriecito;d;4;;4,5,6
Cormorant SC;r;34567;;0,1,4,5,6
Bellefair;r;4;;7,4,5
Stardos Stencil;d;47;;4
ZCOOL KuaiLe;s;4;;28,4
Sofia Sans Semi Condensed;s;123456789;i;0,1,2,4,5
Playpen Sans;h;12345678;;0,1,2,4,5,6
Cabin Sketch;d;47;;4
Sintony;s;47;;4,5
Graduate;r;4;;4
Yrsa;r;34567;i;4,5,6
Afacad Flux;s;123456789;;4,5,6
Lexend Exa;s;123456789;;4,5,6
Sarala;s;47;;11,4,5
Caladea;r;47;i;4,5
Aldrich;s;4;;4
Livvic;s;12345679;i;4,5,6
La Belle Aurore;h;4;;4,5
Bentham;r;4;;4,5
Palanquin Dark;s;4567;;11,4,5
Fondamento;h;4;i;4,5
Inria Serif;r;347;i;4,5
Niconne;h;4;;4,5
Caudex;r;47;i;2,3,4,5,37,6
Oranienbaum;r;4;;0,1,4,5
Brygada 1918;r;4567;i;0,1,2,4,5,6
Chonburi;d;4;;4,5,23,6
Ubuntu Sans;s;12345678;i;0,1,2,3,4,5
Hepta Slab;r;123456789;;4,5,6
Gowun Dodum;s;4;;26,4,5,6
Special Gothic Condensed One;s;4;;4,5
Fragment Mono;m;4;i;1,4,5
Pattaya;s;4;;0,4,5,23,6
Manjari;s;147;;4,5,18
TikTok Sans;s;3456789;;0,1,2,4,5,6
Arbutus Slab;r;4;;4,5
Pathway Extreme;s;123456789;i;4,5,6
IM Fell English SC;r;4;;4
Mali;h;234567;i;4,5,23,6
Averia Libre;d;347;i;4
Kameron;r;4567;;4,5
Alef;s;47;;7,4
Glegoo;r;47;;11,4,5
Noto Sans Meetei Mayek;s;123456789;;4,5,42
Style Script;h;4;;4,5,6
Noto Sans Oriya;s;123456789;;4,5,19
Bona Nova SC;r;47;i;0,1,2,7,4,5,6
Sedgwick Ave Display;h;4;;4,5,6
Share;s;47;i;4,5
Anybody;d;123456789;i;4,5,6
Lexend Peta;s;123456789;;4,5,6
Zalando Sans;s;23456789;i;4,5,6
Telex;s;4;;4,5
Armata;s;4;;4,5
PT Serif Caption;r;4;i;0,1,4,5
Hahmlet;r;123456789;;26,4,5,6
Kosugi;s;4;;0,24,4,5
Herr Von Muellerhoff;h;4;;4,5
ADLaM Display;d;4;;33,4,5
Halant;r;34567;;11,4,5
Aref Ruqaa;r;47;;25,4,5
Athiti;s;234567;;4,5,23,6
Antic Didone;r;4;;4
Radley;r;4;i;4,5
Trocchi;r;4;;4,5
Judson;r;47;i;4,5,6
Rakkas;d;4;;25,4,5
Ysabeau Office;s;123456789;i;0,1,2,4,5,6
Sigmar One;d;4;;4,5,6
Lustria;r;4;;4
MedievalSharp;d;4;;4,5
Ibarra Real Nova;r;4567;i;4,5
BIZ UDPMincho;r;47;;0,3,24,4,5
Noto Serif Devanagari;r;123456789;;11,4,5
AR One Sans;s;4567;;4,5,6
Flow Circular;d;4;;0,1,4,5,6
Sometype Mono;m;4567;i;4,5
Nanum Brush Script;h;4;;26,4
Anton SC;s;4;;4,5,6
Allison;h;4;;4,5,6
Grand Hotel;h;4;;4,5
Allerta Stencil;s;4;;4
Marmelad;s;4;;0,1,4,5,6
Mouse Memoirs;s;4;;4,5
Comic Relief;d;47;;0,2,4,5
Cormorant Upright;r;34567;;4,5,6
Hina Mincho;r;4;;0,24,4,5,6
Metrophobic;s;4;;4,5,6
Alegreya SC;r;45789;i;0,1,2,3,4,5,6
Enriqueta;r;4567;;4,5
Fjord One;r;4;;4
Reddit Sans Condensed;s;23456789;;4,5,6
Norican;h;4;;4,5
Libre Barcode 128;d;4;;4
B612 Mono;m;47;i;4
Grenze Gotisch;d;123456789;;4,5,6
Kantumruy Pro;s;1234567;i;16,4,5
Rosario;s;34567;i;4,5,6
Corben;d;47;;4,5
Candal;s;4;;4
Yusei Magic;s;4;;24,4,5
IBM Plex Sans Hebrew;s;1234567;;1,7,4,5
Bayon;s;4;;16,4
Sniglet;d;48;;4,5
Monomaniac One;s;4;;24,4,5
Average Sans;s;4;;4,5
Inria Sans;s;347;i;4,5
Mozilla Headline;s;234567;;4,5
Yuji Syuku;r;4;;0,24,4,5
Hedvig Letters Serif;r;4;;4,5
Zen Dots;d;4;;4,5
Podkova;r;45678;;0,1,4,5,6
Seaweed Script;d;4;;4,5
Yesteryear;h;4;;4,5
Noto Sans Ol Chiki;s;4567;;4,5,43
Irish Grover;d;4;;4
Doto;s;123456789;;4,5
Anaheim;s;45678;;4,5,6
DynaPuff;d;4567;;1,4,5
Libertinus Serif;r;467;i;0,1,2,3,7,4,5,6
Faster One;d;4;;4,5
Turret Road;d;234578;;4,5
Mountains of Christmas;d;47;;4
Alatsi;s;4;;1,4,5,6
Chiron GoRound TC;s;23456789;;27,0,1,4,5,6
RocknRoll One;s;4;;24,4,5
Montagu Slab;r;1234567;;4,5,6
Arizonia;h;4;;4,5,6
Koulen;d;4;;16,4
National Park;s;2345678;;4,5,6
Monsieur La Doulaise;h;4;;4,5
BBH Bogle;s;4;;4
Libre Barcode 39 Text;d;4;;4
STIX Two Math;r;4;;4
Kodchasan;s;234567;i;4,5,23,6
Baloo Thambi 2;d;45678;;4,5,21,6
REM;s;123456789;i;4,5,6
Qwitcher Grypen;h;47;;4,5,6
Gaegu;h;347;;26,4
Libertinus Math;d;4;;4
Corinthia;h;47;;4,5,6
Nobile;s;457;i;0,4,5
B612;s;47;i;4
Goudy Bookletter 1911;r;4;;4
KoHo;s;234567;i;4,5,23,6
Amiko;s;467;;11,4,5
Bungee Shade;d;4;;4,5,6
Overlock;d;479;i;4,5
BioRhyme;r;2345678;;4,5
Rubik Doodle Shadow;d;4;;0,1,7,4,5
Ledger;r;4;;0,4,5
Markazi Text;r;4567;;25,4,5,6
Noto Serif Thai;r;123456789;;4,5,23
Noto Sans Armenian;s;123456789;;8,4,5
Piazzolla;r;123456789;i;0,1,2,3,4,5,6
Coiny;d;4;;4,5,21,6
Special Gothic;s;4567;;4,5
Meddon;h;4;;4,5
Tilt Neon;d;4;;4,5,6
Scheherazade New;r;4567;;25,4,5
Anek Devanagari;s;12345678;;11,4,5
Noto Sans Ethiopic;s;123456789;;12,4,5
ZCOOL QingKe HuangYou;s;4;;28,4
Rancho;h;4;;4
Coming Soon;h;4;;4
Bubblegum Sans;d;4;;4,5
Cormorant Unicase;r;34567;;0,1,4,5,6
Oxygen Mono;m;4;;4,5
Zen Antique;r;4;;0,2,24,4,5
Recursive;s;3456789;;1,4,5,6
Hi Melody;h;4;;26,4
Spectral SC;r;2345678;i;0,1,4,5,6
Zen Kurenaido;s;4;;0,2,24,4,5
Red Rose;d;34567;;4,5,6
Shippori Antique B1;s;4;;24,4,5
Beth Ellen;h;4;;4
Marvel;s;47;i;4
Bungee Inline;d;4;;4,5,6
Hurricane;h;4;;4,5,6
Schoolbell;h;4;;4
Akatab;s;456789;;4,5,32
Momo Trust Display;s;4;;4,5,6
Zalando Sans SemiExpanded;s;23456789;i;4,5,6
Nixie One;d;4;;4
Rouge Script;h;4;;4
Metamorphous;d;4;;4,5
Rubik Dirt;d;4;;0,1,7,4,5
Sansita Swashed;d;3456789;;4,5,6
Rubik Spray Paint;d;4;;0,1,7,4,5
Love Ya Like A Sister;d;4;;4,5
Allerta;s;4;;4
Magra;s;47;;4,5
Fanwood Text;r;4;i;4,5
Birthstone;h;4;;4,5,6
Ephesis;h;4;;4,5,6
Cherry Bomb One;d;4;;24,4,5,6
Kaisei Opti;r;457;;0,24,4,5
Poetsen One;d;4;;4,5
Kadwa;r;47;;11,4
Rochester;h;4;;4
Asul;r;47;;4
Voltaire;s;4;;4,5,6
Calligraffitti;h;4;;4
Noto Sans Thai Looped;s;123456789;;4,5,23
Meow Script;h;4;;4,5,6
Syne Mono;m;4;;4,5
Skranji;d;47;;4,5
Platypi;r;345678;i;4,5,6
Average;r;4;;4,5
Major Mono Display;m;4;;4,5,6
Aguafina Script;h;4;;4,5
Laila;r;34567;;11,4,5
Wallpoet;d;4;;4
Shippori Antique;s;4;;24,4,5
Carrois Gothic;s;4;;4
Original Surfer;d;4;;4,5
Gabriela;r;4;;0,1,4,5
Kristi;h;4;;4
Croissant One;d;4;;4,5
Inclusive Sans;s;34567;i;4,5,6
Copse;r;4;;4
Poltawski Nowy;r;4567;i;4,5,6
Asta Sans;s;345678;;26,4
Encode Sans Expanded;s;123456789;;4,5,6
Gotu;s;4;;11,4,5,6
Boldonse;d;4;;4,5
Vujahday Script;h;4;;4,5,6
Tienne;r;479;;4
Mukta Vaani;s;2345678;;14,4,5
Sunflower;s;357;;26,4
Abyssinica SIL;r;4;;12,4,5
Jersey 10;d;4;;4,5
Scada;s;47;i;0,1,4,5
Noto Serif Georgian;r;123456789;;13,4,5
Numans;s;4;;4
Anta;s;4;;4,5
Finlandica Text;s;123456789;i;0,1,4,5,6
Waiting for the Sunrise;h;4;;4,5
MonteCarlo;h;4;;4,5,6
Inknut Antiqua;r;3456789;;11,4,5
Mukta Mahee;s;2345678;;15,4,5
Bitcount Single;d;123456789;;4,5
Noto Sans Symbols 2;s;4;;4,5,44
Frijole;d;4;;4
Zain;s;234789;i;25,4
Almendra;r;47;i;4,5
Dawning of a New Day;h;4;;4
Megrim;d;4;;4,5
Arima;d;1234567;;2,3,4,5,18,21,6
Carattere;h;4;;4,5,6
Della Respira;r;4;;4
Battambang;d;13479;;16,4
Alike;r;4;;4,5
Square Peg;h;4;;4,5,6
Cambay;s;47;i;11,4,5
Atkinson Hyperlegible Mono;s;2345678;i;4,5
Quando;r;4;;4,5
Quintessential;h;4;;4,5
David Libre;r;457;;7,4,5,6
Mansalva;h;4;;2,4,5,6
Ruwudu;r;4567;;25,4,5
Capriola;s;4;;4,5
Atma;d;34567;;9,4,5
Moon Dance;h;4;;4,5,6
Hanuman;r;123456789;;16,4
Freeman;d;4;;4,5,6
LXGW WenKai TC;h;347;;27,0,1,2,3,4,5,45,6
Xanh Mono;m;4;i;4,5,6
Gayathri;s;147;;4,18
Baloo Tamma 2;d;45678;;41,4,5,6
Miriam Libre;s;4567;;7,4,5
Jockey One;s;4;;4,5
Agbalumo;d;4;;1,12,4,5,6
Train One;d;4;;0,24,4,5
Noto Serif Tibetan;r;123456789;;4,5,46
Lekton;m;47;i;4,5
IM Fell DW Pica;r;4;i;4
Finger Paint;d;4;;4
Mozilla Text;s;234567;;4,5
Balthazar;r;4;;4
Coustard;r;49;;4,5
Mr De Haviland;h;4;;4,5
Freehand;d;4;;16,4
Uncial Antiqua;d;4;;4,5
Tenali Ramakrishna;s;4;;4,22
Over the Rainbow;h;4;;4,5
Encode Sans Semi Condensed;s;123456789;;4,5,6
Bellota Text;d;347;i;0,4,5,6
Stick No Bills;s;2345678;;4,5,20
Sedgwick Ave;h;4;;4,5,6
Amarante;d;4;;4,5
Lily Script One;d;4;;4,5
Cutive;r;4;;4,5
Noto Sans Lao;s;123456789;;17,4,5
Metal Mania;d;4;;4,5
Gulzar;r;4;;25,4,5
Teachers;s;45678;i;3,4,5
Contrail One;d;4;;4
Jaldi;s;47;;11,4,5
Reggae One;d;4;;0,24,4,5
Buenard;r;4567;;4,5
Yomogi;h;4;;0,24,4,5,6
Aladin;d;4;;4,5
Protest Strike;d;4;;4,5,6
Sekuya;d;4;;4,5
New Rocker;d;4;;4,5
Happy Monkey;d;4;;4,5
Phudu;d;3456789;;1,4,5,6
Esteban;r;4;;4,5
UnifrakturCook;d;7;;4
Sulphur Point;s;347;;4,5
Kurale;r;4;;0,1,11,4,5
Aoboshi One;r;4;;24,4,5
Rasa;r;34567;i;14,4,5,6
Lacquer;d;4;;4
Bagel Fat One;d;4;;26,4,5
Sarina;d;4;;4,5
Prosto One;d;4;;0,4,5
Ruslan Display;d;4;;0,4,5
Oleo Script Swash Caps;d;47;;4,5
Song Myung;r;4;;26,4
Farro;s;3457;;4,5
Codystar;d;34;;4,5
Protest Revolution;d;4;;4,5,6
Bona Nova;r;47;i;0,1,2,7,4,5,6
Zen Antique Soft;r;4;;0,2,24,4,5
Padauk;s;47;;4,5,40
Vast Shadow;r;4;;4
Hedvig Letters Sans;s;4;;4,5
Maitree;r;234567;;4,5,23,6
Vend Sans;s;34567;i;4,5
Qwigley;h;4;;4,5,6
Inder;s;4;;4,5
Nova Square;d;4;;4,5
Bakbak One;d;4;;11,4,5
Trade Winds;d;4;;4
Fauna One;r;4;;4,5
Karantina;d;347;;7,4,5
Supermercado One;d;4;;4,5
Kalnia;r;1234567;;4,5
Nova Mono;m;4;;2,4,5
Modak;d;4;;11,4,5
Oregano;d;4;i;4,5
Momo Signature;s;4;;4,5,6
Rambla;s;47;i;4,5
Pompiere;d;4;;4
Vollkorn SC;r;4679;;0,1,4,5,6
Whisper;h;4;;4,5,6
Alan Sans;s;3456789;;25,4,5
Gurajada;s;4;;4,22
Sour Gummy;s;123456789;i;4,5
Elms Sans;s;123456789;i;4,5,6
Euphoria Script;h;4;;4,5
Alkalami;r;4;;25,4,5
Vesper Libre;r;4579;;11,4,5
Gamja Flower;h;4;;26,4
Germania One;d;4;;4
Just Me Again Down Here;h;4;;4,5
Fuzzy Bubbles;h;47;;4,5,6
Kufam;s;456789;i;25,4,5,6
Scope One;r;4;;4,5
Galada;d;4;;9,4
Mallanna;s;4;;4,22
Mohave;s;34567;i;4,5
Jomhuria;d;4;;25,4,5
Expletus Sans;d;4567;i;4,5
Fresca;s;4;;4,5
Anek Malayalam;s;12345678;;4,5,18
Bilbo Swash Caps;h;4;;4,5
Noto Serif HK;r;23456789;;38,0,4,5,6
Patrick Hand SC;h;4;;4,5,6
Alike Angular;r;4;;4,5
Atomic Age;d;4;;4,5
Vibur;h;4;;4
Sarpanch;s;456789;;11,4,5
Noto Sans Warang Citi;s;4;;4,5,47
Kelly Slab;d;4;;0,4,5
Allan;d;47;;4,5
Kode Mono;m;4567;;4,5
Grenze;r;123456789;i;4,5,6
Stick;s;4;;0,24,4,5
Elsie;d;49;;4,5
Imprima;s;4;;4,5
Gluten;d;123456789;;4,5,6
Averia Sans Libre;d;347;i;4
Borel;h;4;;4,5,6
Ysabeau SC;s;123456789;;0,1,2,4,5,6
Rosarivo;r;4;i;4,5
Baloo Chettan 2;d;45678;;4,5,18,6
Stack Sans Headline;s;234567;;4,5
Libre Barcode 39 Extended Text;d;4;;4
Road Rage;d;4;;4,5,6
Antic;s;4;;4
Caesar Dressing;d;4;;4
Kdam Thmor Pro;s;4;;16,4,5
Amiri Quran;r;4;;25,4
Noto Sans Math;s;4;;4
Montez;h;4;;4,5
Nokora;s;123456789;;16,4
Orelega One;d;4;;0,1,4,5
Mochiy Pop P One;s;4;;24,4
Federo;s;4;;4
Medula One;d;4;;4
Imperial Script;h;4;;4,5,6
Poly;r;4;i;4,5
Kaisei Tokumin;r;4578;;0,24,4,5
Qahiri;s;4;;25,4
Sue Ellen Francisco;h;4;;4
Gentium Book Plus;r;47;i;0,1,2,3,4,5,6
Meie Script;h;4;;4,5
Suranna;r;4;;4,22
Darumadrop One;d;4;;24,4,5
Noto Serif Hebrew;r;123456789;;7,4,5
Rubik Bubbles;d;4;;0,1,7,4,5
Kranky;d;4;;4
Rubik Glitch;d;4;;0,1,7,4,5
Gasoek One;s;4;;26,4,5
Kulim Park;s;23467;i;4,5
Delicious Handrawn;h;4;;4,5
Life Savers;d;478;;4,5
Encode Sans Semi Expanded;s;123456789;;4,5,6
Slackey;d;4;;4
Give You Glory;h;4;;4,5
Bellota;d;347;i;0,4,5,6
IBM Plex Sans Thai Looped;s;1234567;;1,4,5,23
Dynalight;d;4;;4,5
Madimi One;s;4;;4,5
Luxurious Script;h;4;;4,5,6
McLaren;d;4;;4,5
TASA Orbiter;s;45678;;4,5
Cambo;r;4;;4,5
Puritan;s;47;i;4
Alkatra;d;4567;;9,11,4,5,19
Solway;r;34578;;4
Reddit Mono;m;23456789;;4,5,6
Brawler;r;47;;4
Charmonman;h;47;;4,5,23,6
WindSong;h;45;;4,5,6
Fasthand;d;4;;16,4
Noto Serif Khojki;r;4567;;48,4,5
Cherry Cream Soda;d;4;;4
Birthstone Bounce;h;45;;4,5,6
Sancreek;d;4;;4,5
Huninn;s;4;;27,0,4,5,6
Arya;s;47;;11,4,5
Noto Serif Tamil;r;123456789;i;4,5,21
Walter Turncoat;h;4;;4
Julee;h;4;;4,5
Salsa;d;4;;4
Varta;s;34567;;4,5,6
Anek Tamil;s;12345678;;4,5,21
Crafty Girls;h;4;;4
Stack Sans Text;s;234567;;4,5
Thasadith;s;47;i;4,5,23,6
M PLUS 1 Code;m;1234567;;24,4,5,6
Viaoda Libre;d;4;;0,1,4,5,6
Story Script;s;4;;4,5,6
SUSE;s;123456789;i;4,5,6
Peralta;r;4;;4,5
Fuggles;h;4;;4,5,6
Ballet;h;4;;4,5,6
Amethysta;r;4;;4
Ribeye;d;4;;4,5
Mirza;r;4567;;25,4,5
Protest Riot;d;4;;4,5,6
Macondo;d;4;;4
Doppio One;s;4;;4,5
Imbue;r;123456789;;4,5,6
Nosifer;d;4;;4,5
Cactus Classical Serif;r;4;;27,0,4,5,6
Sumana;r;47;;11,4,5
Playwrite US Trad;h;1234;;4
Waterfall;h;4;;4,5,6
Long Cang;h;4;;28,4
League Script;h;4;;4
Molengo;s;4;;4,5
Mako;s;4;;4,5
Unkempt;d;47;;4
Mina;s;47;;9,4,5
Baloo Paaji 2;d;45678;;15,4,5,6
Kavoon;d;4;;4,5
NTR;s;4;;4,22
Bonheur Royale;h;4;;4,5,6
Koh Santepheap;r;13479;;16,4
Fontdiner Swanky;d;4;;4
Kablammo;d;4;;0,1,4,5,6
Cherry Swash;d;47;;4,5
Port Lligat Sans;s;4;;4
Redressed;h;4;;4,5
Iceberg;d;4;;4
Lemon;d;4;;4,5
Nata Sans;s;123456789;;0,1,4,5,6
Duru Sans;s;4;;4,5
Slabo 13px;r;4;;4,5
Ancizar Serif;r;3456789;i;2,4,5
Faculty Glyphic;s;4;;4,5
Moul;d;4;;16,4
Noto Serif Telugu;r;123456789;;4,5,22
Artifika;r;4;;4
Timmana;s;4;;4,22
Lavishly Yours;h;4;;4,5,6
Mooli;s;4;;4,5
Baloo Bhaina 2;d;45678;;4,5,19,6
Edu TAS Beginner;h;4567;;4
Dokdo;d;4;;26,4
Ranchers;d;4;;4,5
Truculenta;s;123456789;;4,5,6
Montserrat Underline;s;123456789;i;0,1,4,5,6
BhuTuka Expanded One;r;4;;15,4,5
Goblin One;d;4;;4
Asimovian;s;4;;4,5,6
IM Fell Double Pica;r;4;i;4
Bigshot One;d;4;;4
Asar;r;4;;11,4,5
East Sea Dokdo;h;4;;26,4
Prociono;r;4;;4
Spicy Rice;d;4;;4,5
Bokor;d;4;;16,4
Almendra SC;r;4;;4
Agdasima;s;47;;4,5
Convergence;s;4;;4,5
Homenaje;s;4;;4
Macondo Swash Caps;d;4;;4
Zhi Mang Xing;h;4;;28,4
Shojumaru;d;4;;4,5
Genos;s;123456789;i;29,4,5,6
Chau Philomene One;s;4;i;4,5
Emilys Candy;d;4;;4,5
Eagle Lake;h;4;;4,5
Wendy One;s;4;;4,5
Gemunu Libre;s;2345678;;4,5,20
Denk One;s;4;;1,4,5,6
Baumans;d;4;;4
Baskervville SC;r;4567;;4,5
Wire One;s;4;;4
Henny Penny;d;4;;4
Freckle Face;d;4;;4,5
Montaga;r;4;;4
Holtwood One SC;r;4;;4,5
Federant;d;4;;4
Clicker Script;h;4;;4,5
Dangrek;d;4;;16,4
Iceland;d;4;;4
Miniver;d;4;;4
Ceviche One;d;4;;4,5
Jolly Lodger;d;4;;4,5
Noto Music;s;4;;4,5
BIZ UDMincho;r;47;;0,3,24,4,5
Raleway Dots;d;4;;4,5
Rationale;s;4;;4
Tiny5;s;4;;0,1,2,4,5
Chicle;d;4;;4,5
Habibi;r;4;;4,5
Marhey;d;34567;;25,4,5
Noto Serif Kannada;r;123456789;;41,4,5
Comme;s;123456789;;4,5
Sail;d;4;;4,5
Short Stack;h;4;;4
IM Fell Great Primer;r;4;i;4
Gafata;s;4;;4,5
Stalemate;h;4;;4,5
Licorice;h;4;;4,5,6
Baloo Tammudu 2;d;45678;;4,5,22,6
Stoke;r;34;;4,5
Delius Swash Caps;h;4;;4
Ruthie;h;4;;4,5,6
Noto Serif Malayalam;r;123456789;;4,5,18
Poor Story;d;4;;26,4
Nabla;d;4;;1,4,5,6
Notable;s;4;;4
Kapakana;h;34;;24,4,5
Anek Gujarati;s;12345678;;14,4,5
Chocolate Classical Sans;s;4;;27,0,4,5,6
Jomolhari;r;4;;4,46
Cairo Play;s;23456789;;25,4,5
Honk;d;4;;4,5,6
Trispace;s;12345678;;4,5,6
Orienta;s;4;;4,5
Victor Mono;m;1234567;i;0,1,2,4,5,6
Maiden Orange;r;4;;4,5
Bungee Spice;d;4;;4,5,6
Yuji Boku;r;4;;0,24,4,5
Overlock SC;d;4;;4,5
Strait;s;4;;4,5
Sevillana;d;4;;4,5
Geom;s;3456789;i;2,4,5
Nova Round;d;4;;4,5
Gugi;d;4;;26,4
Liter;s;4;;0,4,5
Headland One;r;4;;4,5
Pliant;s;123456789;i;0,1,2,3,4,5
Harmattan;s;4567;;25,4,5
Kavivanar;h;4;;4,5,21
Mea Culpa;h;4;;4,5,6
Handjet;d;123456789;;25,8,0,1,2,7,4,5,6
Anek Kannada;s;12345678;;41,4,5
Climate Crisis;d;4;;0,1,4,5
Sura;r;47;;11,4,5
Sono;s;2345678;;4,5,6
Libre Barcode 128 Text;d;4;;4
Delius Unicase;h;47;;4
Content;d;47;;16
Rubik Wet Paint;d;4;;0,1,7,4,5
Carme;s;4;;4
Badeen Display;d;4;;25,4,5
Libertinus Sans;s;47;i;0,1,2,3,4,5,6
Voces;s;4;;4,5
Tiro Devanagari Sanskrit;r;4;i;11,4,5
Edu NSW ACT Cursive;h;4567;;4,5
Mynerve;h;4;;2,4,5,6
Noto Sans Cypriot;s;4;;49,4,5
Beau Rivage;h;4;;4,5,6
Sunshiney;h;4;;4
The Girl Next Door;h;4;;4,5
Dorsa;s;4;;4
Zilla Slab Highlight;r;47;;4,5
Stylish;s;4;;26,4
Lovers Quarrel;h;4;;4,5,6
Manuale;r;345678;i;4,5,6
IM Fell French Canon;r;4;i;4
Engagement;h;4;;4,5
Pavanam;s;4;;4,5,21
Modern Antiqua;d;4;;4,5
Devonshire;h;4;;4,5
Grape Nuts;h;4;;4,5,6
Playpen Sans Arabic;h;12345678;;25,4,5
Loved by the King;h;4;;4,5
Comforter;h;4;;0,4,5,6
Englebert;s;4;;4,5
Akaya Kanadaka;d;4;;41,4,5
Smooch;h;4;;4,5,6
Akronim;d;4;;4,5
Shanti;s;4;;4,5
IBM Plex Sans Devanagari;s;1234567;;1,11,4,5
Sansation;s;347;i;0,2,4,5
Zen Tokyo Zoo;d;4;;4,5
Mate SC;r;4;;4,5
Belgrano;r;4;;4
Moderustic;s;345678;;0,1,2,4,5
Redacted;d;4;;4,5
Mystery Quest;d;4;;4,5
Yeon Sung;d;4;;26,4
Rubik Moonrocks;d;4;;0,1,7,4,5
Momo Trust Sans;s;2345678;;4,5,6
Rum Raisin;s;4;;4,5
Manufacturing Consent;d;4;;4,5
Londrina Outline;d;4;;4
Jaro;s;4;;4,5,6
Akt;s;123456789;;0,1,2,3,4,5,6
Ysabeau;s;123456789;i;0,1,2,4,5,6
Passions Conflict;h;4;;4,5,6
Bodoni Moda SC;r;456789;i;4,5
Girassol;d;4;;4,5
Gwendolyn;h;47;;4,5,6
Swanky and Moo Moo;h;4;;4,5
Festive;h;4;;4,5,6
Crushed;d;4;;4,5
Khmer;s;4;;16
Gupter;r;457;;4
Playwrite IN;h;1234;;4
Joan;r;4;;4,5
Hubot Sans;s;23456789;i;4,5,6
Nova Flat;d;4;;4,5
Suwannaphum;r;13479;;16,4
The Nautigal;h;47;;4,5,6
Braah One;s;4;;15,4,5,6
Bilbo;h;4;;4,5,6
Single Day;d;4;;26,4
Griffy;d;4;;4,5
SN Pro;s;23456789;i;0,1,4,5,6
Iosevka Charon;m;3457;i;8,0,1,2,3,4,5,6
Siemreap;s;4;;16
Cantora One;s;4;;4,5
Katibeh;d;4;;25,4,5
IM Fell DW Pica SC;r;4;;4
Jacquard 12;d;4;;4,5
Fenix;r;4;;4,5
Erica One;d;4;;4,5
Monofett;m;4;;4,5
Flamenco;d;34;;4
BBH Hegarty;s;4;;4
Akaya Telivigala;d;4;;4,5,22
Unlock;d;4;;4,5
Noto Sans Mongolian;s;4;;4,5,50
Liu Jian Mao Cao;h;4;;28,4
Barrio;d;4;;4,5
Lugrasimo;h;4;;4,5
Playwrite CU;h;1234;;4
Noto Serif Khmer;r;123456789;;16,4,5
Noto Serif Gujarati;r;123456789;;14,4,5
Noto Sans Samaritan;s;4;;4,5,51
Nova Slim;d;4;;4,5
Smokum;d;4;;4,5
Risque;d;4;;4,5
Tauri;s;4;;4,5
Galindo;d;4;;4,5
Winky Sans;s;3456789;i;4,5
Noto Sans Thaana;s;123456789;;4,5,52
Noto Serif Armenian;r;123456789;;8,4,5
Margarine;d;4;;4,5
Nerko One;h;4;;4,5
Sirin Stencil;d;4;;4
Playwrite IS;h;1234;;4
Stint Ultra Condensed;r;4;;4,5
Tourney;d;123456789;i;4,5,6
Chiron Hei HK;s;23456789;i;27,0,1,2,3,4,5,6
Yaldevi;s;234567;;4,5,20
Iansui;h;4;;27,4,5
Autour One;d;4;;4,5
Monomakh;d;4;;0,1,4,5
Edu SA Beginner;h;4567;;4
Lexend Mega;s;123456789;;4,5,6
Cute Font;d;4;;26,4
Jersey 15;d;4;;4,5
Playwrite NO;h;1234;;4
Beiruti;s;23456789;;25,4,5,6
Playwrite AU NSW;h;1234;;4
Paprika;d;4;;4,5
Milonga;d;4;;4,5
Sree Krushnadevaraya;r;4;;4,22
Chiron Sung HK;r;23456789;i;38,0,1,2,4,5,6
Port Lligat Slab;r;4;;4
SUSE Mono;s;12345678;i;4,5,6
Luxurious Roman;d;4;;4,5,6
Noto Sans Tagalog;s;4;;4,5,53
Playwrite VN;h;1234;;4
Anek Odia;s;12345678;;4,5,19
Carrois Gothic SC;s;4;;4
Playwrite DE Grund;h;1234;;4
Wittgenstein;r;456789;i;4,5
Ramaraja;r;4;;4,22
Gentium Plus;r;47;i;0,1,2,3,4,5,6
Junge;r;4;;4
Linden Hill;r;4;i;4,5
Solitreo;h;4;;7,4,5
Kaisei HarunoUmi;r;457;;0,24,4,5
Jacques Francois Shadow;d;4;;4
Castoro Titling;d;4;;4,5
BBH Bartle;s;4;;4
Nova Oval;d;4;;4,5
Chela One;d;4;;4,5
Playwrite VN Guides;h;4;;4
Asset;d;4;;1,4,5
Simonetta;d;49;i;4,5
Stack Sans Notch;s;234567;;4,5
Kite One;s;4;;4,5
Jacques Francois;r;4;;4
Fascinate;d;4;;4,5
Geostar Fill;d;4;;4
Miltonian;d;4;;4
Rubik Scribble;d;4;;0,1,7,4,5
Ojuju;s;2345678;;4,5,6
Kanchenjunga;s;4567;;54,4
Cagliostro;s;4;;4
Dekko;h;4;;11,4,5
Edu AU VIC WA NT Hand;h;4567;;4,5
Inika;r;47;;4,5
Bruno Ace SC;d;4;;4,5
Noto Sans Canadian Aboriginal;s;123456789;;10,4,5
Island Moments;h;4;;4,5,6
Mogra;d;4;;14,4,5
Noto Sans Sora Sompeng;s;4567;;4,5,55
Tillana;d;45678;;11,4,5
Shalimar;h;4;;4,5,6
Text Me One;s;4;;4,5
IM Fell Double Pica SC;r;4;;4
Spirax;d;4;;4
Bruno Ace;d;4;;4,5
Water Brush;h;4;;4,5,6
Srisakdi;d;47;;4,5,23,6
Arsenal SC;s;47;i;0,1,4,5,6
Ysabeau Infant;s;123456789;i;0,1,2,4,5,6
Inspiration;h;4;;4,5,6
Tiro Devanagari Marathi;r;4;i;11,4,5
Tac One;s;4;;4,5,6
Big Shoulders Stencil;d;123456789;;4,5,6
Glass Antiqua;d;4;;4,5
Encode Sans SC;s;123456789;;4,5,6
Tiro Gurmukhi;r;4;i;15,4,5
Offside;d;4;;4,5
WDXL Lubrifont JP N;s;4;;0,24,4,5
Romanesco;h;4;;4,5
Meera Inimai;s;4;;4,21
Sonsie One;d;4;;4,5
Dhurjati;s;4;;4,22
Chilanka;h;4;;4,5,18
Noto Sans Buhid;s;4;;56,4,5
Kenia;d;4;;4
IM Fell French Canon SC;r;4;;4
Sigmar;d;4;;4,5,6
Almendra Display;d;4;;4,5
Odibee Sans;d;4;;4
Libre Barcode EAN13 Text;d;4;;4
Trykker;r;4;;4,5
Noto Serif Gurmukhi;r;123456789;;15,4,5
Konkhmer Sleokchher;d;4;;16,4,5
Lexend Tera;s;123456789;;4,5,6
Fleur De Leah;h;4;;4,5,6
Stint Ultra Expanded;r;4;;4,5
Reem Kufi Fun;s;4567;;25,4,5,6
Underdog;d;4;;0,4,5
Dai Banna SIL;r;34567;i;4,5,57
IM Fell Great Primer SC;r;4;;4
Butcherman;d;4;;4,5
Seymour One;s;4;;0,4,5
Averia Gruesa Libre;d;4;;4,5
Marko One;r;4;;4
Kotta One;r;4;;4,5
Diplomata;d;4;;4,5
Geist Pixel;d;4;;4,5
Odor Mean Chey;r;4;;16,4
Princess Sofia;h;4;;4,5
Jim Nightshade;h;4;;4,5
Comforter Brush;h;4;;0,4,5,6
Idiqlat;r;234;;4,31
Epunda Sans;s;3456789;i;4,5
Smythe;d;4;;4
Noto Sans Gothic;s;4;;35,4,5
Donegal One;r;4;;4,5
New Amsterdam;s;4;;4,5
Arbutus;r;4;;4,5
Fascinate Inline;d;4;;4,5
Piedra;d;4;;4,5
Elsie Swash Caps;d;49;;4,5
Ancizar Sans;s;123456789;i;2,4,5
Intel One Mono;m;34567;i;4,5,6
Texturina;r;123456789;i;4,5,6
Noto Serif Sinhala;r;123456789;;4,5,20
Gideon Roman;d;4;;4,5,6
Sedan SC;r;4;;4,5
Playwrite US Modern;h;1234;;4
Rubik Storm;d;4;;0,1,7,4,5
Ravi Prakash;d;4;;4,22
Bitcount Grid Double;d;123456789;;4,5
Ewert;d;4;;4,5
Gorditas;d;47;;4
Alumni Sans Pinstripe;s;4;i;0,1,4,5,6
Sofadi One;d;4;;4
New Tegomin;r;4;;24,4,5
Cascadia Code;s;234567;i;25,0,1,2,7,4,5,6
Sixtyfour;m;4;;4,5
Benne;r;4;;41,4,5
Noto Sans Runic;s;4;;4,5,37
Joti One;d;4;;4,5
Ruluko;s;4;;4,5
Bungee Outline;d;4;;4,5,6
Emblema One;d;4;;4,5
Neonderthaw;h;4;;4,5,6
Orbit;s;4;;26,4,5
Astloch;d;47;;4
Farsan;d;4;;14,4,5,6
Chathura;s;13478;;4,22
Fruktur;d;4;i;1,4,5,6
Playwrite BE VLG;h;1234;;4
Bubbler One;s;4;;4,5
Playwrite PL;h;1234;;4
Tilt Prism;d;4;;4,5,6
Jersey 20;d;4;;4,5
Rubik Burned;d;4;;0,1,7,4,5
LXGW WenKai Mono TC;m;347;;27,0,1,2,3,4,5,45,6
Praise;h;4;;4,5,6
Kedebideri;s;456789;;58,4
Gveret Levin;h;4;;7,4
Nuosu SIL;s;4;;4,5,59
Lakki Reddy;h;4;;4,22
Galdeano;s;4;;4
Miranda Sans;s;4567;i;4,5
Miltonian Tattoo;d;4;;4
Metal;d;4;;16,4
Grey Qo;h;4;;4,5,6
Noto Sans Nabataean;s;4;;4,5,60
Condiment;h;4;;4,5
Libre Barcode 39 Extended;d;4;;4
Noto Sans Javanese;s;4567;;61,4,5
Playwrite AU QLD;h;1234;;4
Love Light;h;4;;4,5,6
Bahiana;d;4;;4,5
Buda;d;3;;4
Preahvihear;s;4;;16,4
Nova Script;d;4;;4,5
Tuffy;s;47;i;0,1,2,3,4,5,62
Caramel;h;4;;4,5,6
Nova Cut;d;4;;4,5
Noto Sans Bhaiksuki;s;4;;63,4,5
Noto Sans Osmanya;s;4;;4,5,64
Londrina Shadow;d;4;;4
Jacquard 24;d;4;;4,5
Noto Serif Ethiopic;r;123456789;;12,4,5
Noto Sans Old Persian;s;4;;4,5,65
Felipa;h;4;;4,5
Tiro Telugu;r;4;i;4,5,22
Chenla;d;4;;16
Noto Sans Tai Viet;s;4;;4,5,66
Noto Rashi Hebrew;r;123456789;;3,7,4,5
Londrina Sketch;d;4;;4
Wellfleet;r;4;;4,5
Keania One;d;4;;4,5
Noto Sans Adlam;s;4567;;33,4,5
Ole;h;4;;4,5,6
Diphylleia;r;4;;26,4,5
Sahitya;r;47;;11,4
My Soul;h;4;;4,5,6
Aref Ruqaa Ink;r;47;;25,4,5
Mrs Sheppards;h;4;;4,5
Bacasime Antique;r;4;;4,5
Anek Gurmukhi;s;12345678;;15,4,5
GFS Neohellenic;s;47;i;2,3,4,6
Noto Sans Lao Looped;s;123456789;;17,4,5
Ribeye Marrow;d;4;;4,5
Twinkle Star;h;4;;4,5,6
Purple Purse;d;4;;4,5
Hubballi;s;4;;41,4,5
Gidugu;s;4;;4,5,22
Reem Kufi Ink;s;4;;25,4,5,6
Updock;h;4;;4,5,6
Vampiro One;d;4;;4,5
Babylonica;h;4;;4,5,6
Rubik Distressed;d;4;;0,1,7,4,5
Exile;d;4;;4,5
Sixtyfour Convergence;m;4;;4,5
Diplomata SC;d;4;;4,5
Playpen Sans Hebrew;h;12345678;;7,4,5
Micro 5;d;4;;4,5
Bitcount Prop Single;d;123456789;;4,5
Kumar One;d;4;;14,4,5
Alumni Sans Inline One;d;4;i;4,5,6
Uchen;r;4;;4,46
Plaster;d;4;;4,5
WDXL Lubrifont SC;s;4;;28,0,4,5
Edu NSW ACT Foundation;h;4567;;4
Noto Sans Brahmi;s;4;;67,4,5
Noto Sans Tangsa;s;4567;;4,5,68
Oi;d;4;;25,0,1,2,4,5,21,6
Blaka;d;4;;25,4,5
Bungee Hairline;d;4;;4,5,6
Tulpen One;d;4;;4
TASA Explorer;s;45678;;4,5
Snippet;s;4;;4
Playwrite HU;h;1234;;4
Send Flowers;h;4;;4,5,6
Playwrite IE;h;1234;;4
Ranga;d;47;;11,4,5
Cascadia Mono;s;234567;i;25,0,1,2,7,4,5,6
Bigelow Rules;d;4;;4,5
Rubik Iso;d;4;;0,1,7,4,5
Rhodium Libre;r;4;;11,4,5
Alumni Sans Collegiate One;s;4;i;0,4,5,6
Noto Sans Cherokee;s;123456789;;29,4,5
Jacquarda Bastarda 9;d;4;;4,5
Bitcount Grid Single;d;123456789;;4,5
Foldit;d;123456789;;4,5,6
Lancelot;d;4;;4,5
Kolker Brush;h;4;;4,5,6
Estedad;s;123456789;;25,4,5,6
Miss Fajardose;h;4;;4,5
Kings;h;4;;4,5,6
Grechen Fuemen;h;4;;4,5,6
Kirang Haerang;d;4;;26,4
Oldenburg;d;4;;4,5
Noto Sans Chakma;s;4;;69,4,5
Bonbon;h;4;;4
Shizuru;d;4;;24,4
Stalinist One;d;4;;0,4,5
Ubuntu Sans Mono;m;4567;i;0,1,2,3,4,5
Iosevka Charon Mono;m;3457;i;8,0,1,2,3,4,5,6
Dr Sugiyama;h;4;;4,5
Edu VIC WA NT Beginner;h;4567;;4
Molle;h;4;i;4,5
Tiro Kannada;r;4;i;41,4,5
Rubik Microbe;d;4;;0,1,7,4,5
Passero One;d;4;;4,5
Noto Sans Linear A;s;4;;4,5,70
Sedan;r;4;i;4,5
Tsukimi Rounded;s;34567;;24,4,5
Playwrite FR Moderne;h;1234;;4
Playwrite CA;h;1234;;4
Gidole;s;4;;0,2,4,5,6
Labrada;r;123456789;i;4,5,6
Mr Bedfort;h;4;;4,5
Peddana;r;4;;4,22
Bungee Tint;d;4;;4,5,6
Estonia;h;4;;4,5,6
Amarna;s;1234567;i;4,5
Valley Sans;s;123456789;i;4,5
BioRhyme Expanded;r;23478;;4,5
Triodion;d;4;;0,1,4
Langar;d;4;;15,4,5
Syne Tactile;d;4;;4,5
Flavors;d;4;;4,5
Noto Sans Anatolian Hieroglyphs;s;4;;71,4,5
Rubik Glitch Pop;d;4;;0,1,7,4,5
Playwrite AU SA;h;1234;;4
UoqMunThenKhung;r;4;;27,0,4
Are You Serious;h;4;;4,5,6
Lunasima;s;47;;0,1,2,3,7,4,5,6
Black And White Picture;d;4;;26,4
Noto Sans Syriac;s;123456789;;4,5,31
Cossette Titre;s;47;;4,5
Cossette Texte;s;47;;4,5
Cherish;h;4;;4,5,6
Redaction 50;r;47;i;4
Noto Sans Pahawh Hmong;s;4;;4,5,72
Playwrite MX Guides;h;4;;4
Rubik Vinyl;d;4;;0,1,7,4,5
Noto Serif Dives Akuru;r;4;;73,4,5
Alyamama;r;3456789;;25,2,4,5
Hanalei Fill;d;4;;4,5
Matemasie;s;4;;4,5
Zen Loop;d;4;i;4,5
Revalia;d;4;;4,5
M PLUS U;s;123456789;;24,4,5,6
Redacted Script;d;347;;4,5
Trochut;d;47;i;4
Noto Sans Coptic;s;4;;74,4,5
Slackside One;h;4;;24,4,5
Noto Serif Lao;r;123456789;;17,4,5
Alumni Sans SC;s;123456789;i;0,1,4,5,6
Clarity City;s;123456789;i;4,5
Rubik Gemstones;d;4;;0,1,7,4,5
Noto Sans Hanunoo;s;4;;75,4,5
Noto Serif Tangut;r;4;;4,5,76
Aubrey;d;4;;4
Noto Sans Shavian;s;4;;4,5,77
Noto Sans Wancho;s;4;;4,5,78
Edu AU VIC WA NT Guides;h;4567;;4,5
Noto Sans Egyptian Hieroglyphs;s;4;;79,4,5
Edu AU VIC WA NT Dots;h;4567;;4,5
Rubik Marker Hatch;d;4;;0,1,7,4,5
Tapestry;h;4;;4,5,6
Rubik Beastly;d;4;;0,1,7,4,5
Noto Serif Myanmar;r;123456789;;40
Playwrite RO;h;1234;;4
Explora;h;4;;29,4,5,6
Noto Sans Tai Le;s;4;;4,5,80
Bitcount;d;123456789;;4,5
Playwrite NL;h;1234;;4
Yarndings 20 Charted;d;4;;4
Workbench;m;4;;4
Moulpali;s;4;;16,4
Cause;h;123456789;;4,5
Tai Heritage Pro;r;47;;4,5,66,6
Splash;h;4;;4,5,6
Snowburst One;d;4;;4,5
Tiro Tamil;r;4;i;4,5,21
LXGW Marker Gothic;s;4;;27,0,1,2,4,5,6
Isometra;r;4;;4,5
Noto Sans Nag Mundari;s;4567;;4,5,81
Menbere;s;1234567;;12,4,5,6
Butterfly Kids;h;4;;4,5
Playwrite AT;h;1234;i;4
Playwrite DK Uloopet;h;1234;;4
Noto Serif Balinese;r;4;;82,4,5
Ponomar;d;4;;0,1,4
Redaction;r;47;i;4
Noto Sans Yi;s;4;;4,5,59
Playwrite ES;h;1234;;4
Vibes;d;4;;25,4
Suravaram;r;4;;4,22
Noto Sans Vithkuqi;s;4567;;4,5,83
Playwrite GB S;h;1234;i;4
Protest Guerrilla;d;4;;4,5,6
WDXL Lubrifont TC;s;4;;27,0,4,5
Winky Rough;s;3456789;i;4,5
Petemoss;h;4;;4,5,6
Libre Caslon Condensed;r;4567;i;4,5
Ruge Boogie;h;4;;4,5,6
Moo Lah Lah;d;4;;4,5,6
Libertinus Mono;m;4;;4,5
Playwrite AU SA Guides;h;4;;4
Lumanosimo;h;4;;4,5
Rubik 80s Fade;d;4;;0,1,7,4,5
Redaction 35;r;47;i;4
Rubik Puddles;d;4;;0,1,7,4,5
Lilex;m;1234567;i;0,1,2,4,5,6
Playwrite HR;h;1234;;4
Noto Sans Batak;s;4;;84,4,5
Epunda Slab;r;3456789;i;4,5
Geostar;d;4;;4
Noto Sans Cypro Minoan;s;4;;85,4,5
Parastoo;r;4567;;25,4,5,6
Annapurna SIL;r;47;;11,4,5
Noto Sans Multani;s;4;;4,5,86
Flow Block;d;4;;0,1,4,5,6
Gajraj One;d;4;;11,4,5
Playwrite ZA;h;1234;;4
Noto Sans Marchen;s;4;;4,5,87
Noto Sans Syloti Nagri;s;4;;4,5,88
Noto Serif Ahom;r;4;;89,4,5
Noto Sans NKo;s;4;;4,5,90
Sassy Frass;h;4;;4,5,6
Combo;d;4;;4,5
Bpmf Huninn;s;4;;27,4,5
Noto Sans Sunuwar;s;4;;4,5,91
Taprom;d;4;;16,4
Libertinus Serif Display;d;4;;0,1,2,3,4,5,6
Namdhinggo;r;45678;;4,5,92
Noto Sans Old Permic;s;4;;1,4,5,34
Noto Sans Kaithi;s;4;;93,4,5
Coral Pixels;d;4;;4,5
Noto Sans Carian;s;4;;94,4,5
Noto Sans Takri;s;4;;4,5,95
Playwrite AR;h;1234;;4
Noto Sans Old Italic;s;4;;4,5,36
Noto Sans Glagolitic;s;4;;1,96,4,5
Noto Sans Old North Arabian;s;4;;4,5,97
Playwrite DK Loopet;h;1234;;4
Redaction 10;r;47;i;4
Geomini;s;2345678;;4,5
Edu SA Hand;h;4567;;4,5
Rock 3D;d;4;;24,4
Kalnia Glaze;d;1234567;;4,5
Karla Tamil Inclined;s;47;;21
Datatype;m;123456789;;4,5
Rubik Pixels;d;4;;0,1,7,4,5
Noto Sans Tifinagh;s;4;;4,5,32
Redaction 70;r;47;i;4
Noto Sans Old Turkic;s;4;;4,5,98
Tagesschrift;d;4;;4,5
Noto Serif Vithkuqi;r;4567;;4,5,83
Narnoor;s;45678;;99,4,5
Linefont;d;123456789;;4
Rubik Broken Fax;d;4;;0,1,7,4,5
Kumar One Outline;d;4;;14,4,5
Playwrite DE SAS;h;1234;;4
Moirai One;d;4;;26,4,5
Redaction 20;r;47;i;4
Grandiflora One;r;4;;26,4,5
Playpen Sans Thai;h;12345678;;4,5,23
Savate;s;23456789;i;4,5
Noto Serif Dogra;r;4;;100,4,5
Playwrite IT Trad;h;1234;;4
Agu Display;d;4;;4,5,6
Playwrite IT Moderna;h;1234;;4
M PLUS Code Latin;s;1234567;;4,5,6
Playwrite TZ Guides;h;4;;4
Scoutie Sans;s;2345678;i;4,5,6
Phetsarath;s;47;;17
Sirivennela;s;4;;4,22
Playwrite MX;h;1234;;4
Bahianita;d;4;;4,5,6
Noto Serif Toto;r;4567;;4,5,101
Redaction 100;r;47;i;4
Palette Mosaic;d;4;;24,4
Noto Serif Oriya;r;4567;;4,5,19
Noto Serif Yezidi;r;4567;;4,5,102
Noto Sans Cuneiform;s;4;;103,4,5
Danfo;r;4;;4,5,6
Ga Maamli;d;4;;4,5,6
Asap Sharp;s;123456789;i;4,5,6
Bpmf Zihi Kai Std;s;4;;27,4,5
Noto Sans Elbasan;s;4;;104,4,5
Noto Sans Nandinagari;s;4;;4,5,105
Ingrid Darling;h;4;;4,5,6
Lisu Bosa;r;23456789;i;4,5,45
Jaini Purva;d;4;;11,4,5
Playwrite GB J;h;1234;i;4
Flow Rounded;d;4;;0,1,4,5,6
Hibur Mono;m;4;;12,4,5
Playwrite PT;h;1234;;4
Finlandica Headline;s;123456789;i;0,1,4,5,6
Noto Sans Indic Siyaq Numbers;s;4;;106,4,5
Playwrite AU TAS;h;1234;;4
Playpen Sans Deva;h;12345678;;11,4,5
Playwrite NZ Basic;h;1234;;4
Tirra;s;456789;;4,5,32
Puppies Play;h;4;;4,5,6
Rubik Maps;d;4;;0,1,7,4,5
Pochaevsk;d;4;;0,1,4
Karla Tamil Upright;s;47;;21
Noto Sans Osage;s;4;;4,5,107
Chokokutai;d;4;;24,4,5,6
Noto Sans Adlam Unjoined;s;4567;;33,4,5
Noto Sans Old Hungarian;s;4;;4,5,108
Rubik Maze;d;4;;0,1,7,4,5
Playwrite NG Modern;h;1234;;4
Big Shoulders Inline;d;123456789;;4,5,6
Noto Sans Balinese;s;4567;;82,4,5
Noto Sans Limbu;s;4;;4,5,92
Bytesized;s;4;;4,5
Maname;r;4;;4,5,20,6
Playwrite HR Lijeva;h;1234;;4
Hind Mysuru;s;34567;;41,4,5
Noto Traditional Nushu;s;34567;;4,5,30
Edu QLD Beginner;h;4567;;4
Allkin;d;4;;4
Ponnala;d;4;;4,22
Shafarik;d;4;;0,1,96,4,5
Bpmf Iansui;h;4;;27,4,5
Noto Sans Sundanese;s;4567;;4,5,109
Rubik Lines;d;4;;0,1,7,4,5
Noto Sans Medefaidrin;s;4567;;4,5,110
Noto Sans Avestan;s;4;;111,4,5
Noto Sans Duployan;s;47;;112,4,5
Noto Serif NP Hmong;r;4567;;4,113
Noto Sans Phoenician;s;4;;4,5,62
Mingzat;s;4;;4,5,114
Noto Sans Lydian;s;4;;4,5,115
Noto Sans Lisu;s;4567;;4,5,45
Rubik Doodle Triangles;d;4;;0,1,7,4,5
Noto Sans Grantha;s;4;;116,4,5
Alien Block;d;4;;4,5
Playwrite AR Guides;h;4;;4
Playwrite NZ;h;1234;;4
Playwrite CZ;h;1234;;4
Noto Sans Siddham;s;4;;4,5,117
Jaini;d;4;;11,4,5
Noto Sans Inscriptional Pahlavi;s;4;;118,4,5
Noto Sans Meroitic;s;4;;4,5,119,120,121
Playwrite FR Trad;h;1234;;4
Playwrite IS Guides;h;4;;4
Hanalei;d;4;;4,5
Noto Sans Bamum;s;4567;;122,4,5
Edu AU VIC WA NT Pre;h;4567;;4,5
Montenegrin Gothic One;r;4;;4,5
Saira Stencil;d;123456789;i;4,5,6
Noto Serif Makasar;r;4;;4,5,123
Noto Sans Syriac Eastern;s;123456789;;4,5,31
Playwrite BE WAL;h;1234;;4
Noto Serif Todhri;r;4;;4,5,124
Yuji Hentaigana Akari;h;4;;24,4,5
Edu NSW ACT Hand Pre;h;4567;;4,5
Noto Sans Imperial Aramaic;s;4;;125,4,5
Playwrite AU VIC;h;1234;;4
Edu QLD Hand;h;4567;;4,5,6
Noto Sans Khojki;s;4;;48,4,5
Yarndings 12;d;4;;4
Kay Pho Du;r;4567;;39,4,5
Edu AU VIC WA NT Arrows;h;4567;;4,5
Noto Serif Ottoman Siyaq;r;4;;4,5,126
Noto Sans Mahajani;s;4;;4,5,127
Noto Sans Newa;s;4;;4,5,128
Sankofa Display;s;4;;4,5,6
Bitcount Prop Double;d;123456789;;4,5
Blaka Hollow;d;4;;25,4,5
Noto Sans Vai;s;4;;4,5,129
Noto Sans Tai Tham;s;4567;;4,5,130
Noto Sans Inscriptional Parthian;s;4;;131,4,5
Blaka Ink;d;4;;25,4,5
Playwrite US Trad Guides;h;4;;4
Libertinus Keyboard;d;4;;4,5
Noto Serif Grantha;r;4;;116,4,5
Wavefont;d;123456789;;4
Noto Serif Hentaigana;r;23456789;;132,4,5
Strichpunkt Sans;s;456789;;4,5
Noto Sans Cham;s;123456789;;133,4,5
Warnes;d;4;;4,5
Yuyu Short;h;4;;4,5
Micro 5 Charted;d;4;;4,5
BJCree;r;4567;;10,4
Noto Sans Ugaritic;s;4;;4,5,134
Playwrite CO;h;1234;;4
Noto Sans Mende Kikakui;s;4;;4,5,135
Noto Sans Buginese;s;4;;136,4,5
Yuyu;h;4;;4,5
Bitcount Grid Double Ink;d;123456789;;4,5
Playwrite ES Deco;h;1234;;4
Playwrite SK;h;1234;;4
Noto Sans Tagbanwa;s;4;;4,5,137
Caacupe One;d;4;;4,5
Playwrite CO Guides;h;4;;4
Noto Sans Linear B;s;4;;4,5,138
Kripa;s;123456789;;11,4,5,6
Noto Sans Mayan Numerals;s;4;;4,5,44
Noto Sans NKo Unjoined;s;4567;;4,5,90
Noto Sans Deseret;s;4;;139,4,5
Noto Sans Sharada;s;4;;4,5,140
Playwrite DE LA;h;1234;;4
Noto Sans Old South Arabian;s;4;;4,5,141
Jacquard 12 Charted;d;4;;4,5
Bitcount Single Ink;d;123456789;;4,5
Padyakke Expanded One;r;4;;41,4,5
Playwrite TZ;h;1234;;4
Noto Sans Zanabazar Square;s;4;;4,5,142
Bitcount Ink;d;123456789;;4,5
Playwrite PE;h;1234;;4
Noto Sans Kharoshthi;s;4;;143,4,5
Noto Sans Palmyrene;s;4;;4,5,144
Bitcount Prop Double Ink;d;123456789;;4,5
Edu VIC WA NT Hand;h;4567;;4,5
Noto Sans Mro;s;4;;4,5,145
Noto Sans Syriac Western;s;123456789;;4,5,31
Jacquard 24 Charted;d;4;;4,5
Bitcount Grid Single Ink;d;123456789;;4,5
Noto Znamenny Musical Notation;s;4;;4,5,146
Playwrite BR;h;1234;;4
Playwrite CL;h;1234;;4
Noto Serif Khitan Small Script;r;4;;147,4,5
Noto Sans Miao;s;4;;4,5,148
Playwrite IE Guides;h;4;;4
Jersey 15 Charted;d;4;;4,5
Noto Sans Lepcha;s;4;;4,5,114
Noto Sans Saurashtra;s;4;;4,5,149
Noto Sans Bassa Vah;s;4567;;150,4,5
Playwrite AU VIC Guides;h;4;;4
Noto Serif Old Uyghur;r;4;;4,5,151
Noto Sans Caucasian Albanian;s;4;;152,4,5
Bitcount Prop Single Ink;d;123456789;;4,5
Matangi;s;3456789;;11,4,5
Noto Sans New Tai Lue;s;4567;;4,5,57
Noto Sans PhagsPa;s;4;;4,5,153
Yuji Hentaigana Akebono;h;4;;24,4,5
Noto Sans Kawi;s;4567;;154,4,5
Betania Patmos;h;4;;4,5
Jersey 25 Charted;d;4;;4,5
Noto Sans SignWriting;s;4;;4,5,155
Noto Sans Masaram Gondi;s;4;;4,5,156
Jersey 10 Charted;d;4;;4,5
Noto Sans Old Sogdian;s;4;;4,5,157
Noto Sans Kayah Li;s;4567;;39,4,5
Playwrite DE VA;h;1234;;4
Noto Sans Hanifi Rohingya;s;4567;;158,4,5
Noto Sans Rejang;s;4;;4,5,159
Noto Sans Hatran;s;4;;160,4,5
Jacquarda Bastarda 9 Charted;d;4;;4,5
Noto Sans Sogdian;s;4;;4,5,161
Noto Sans Tamil Supplement;s;4;;4,5,162
Playwrite ID;h;1234;;4
Noto Sans Khudawadi;s;4;;163,4,5
Yarndings 12 Charted;d;4;;4
Noto Sans Psalter Pahlavi;s;4;;4,5,164
Noto Sans Soyombo;s;4;;4,5,165
Noto Sans Ogham;s;4;;4,5,166
Noto Sans Chorasmian;s;4;;167,4,5
Noto Sans Lycian;s;4;;168
Noto Sans Tirhuta;s;4;;4,5,169
Jersey 20 Charted;d;4;;4,5
Edu VIC WA NT Hand Pre;h;4567;;4,5
Playwrite BE WAL Guides;h;4;;4
Noto Sans Elymaic;s;4;;170,4,5
Noto Sans Modi;s;4;;4,5,171
Noto Sans Pau Cin Hau;s;4;;4,5,172
Betania Patmos In;h;4;;4,5
Noto Sans Mandaic;s;4;;4,5,173
Betania Patmos In GDL;h;4;;4,5
Playwrite GB J Guides;h;4;i;4
Noto Sans Gunjala Gondi;s;4567;;99,4,5
Playwrite PL Guides;h;4;;4
Yarndings 20;d;4;;4
Betania Patmos GDL;h;4;;4,5
Playwrite PT Guides;h;4;;4
Noto Sans Manichaean;s;4;;4,5,174
Noto Sans Nushu;s;4;;4,5,30
Playwrite PE Guides;h;4;;4
Playwrite NZ Guides;h;4;;4
Playwrite DE Grund Guides;h;4;;4
Playwrite CA Guides;h;4;;4
Playwrite DE VA Guides;h;4;;4
Playwrite CU Guides;h;4;;4
Playwrite NZ Basic Guides;h;4;;4
Ramsina;r;4;;4,31
Playwrite BR Guides;h;4;;4
Playwrite IN Guides;h;4;;4
Playwrite DK Uloopet Guides;h;4;;4
Playwrite DE LA Guides;h;4;;4
Playwrite FR Moderne Guides;h;4;;4
Playwrite GB S Guides;h;4;i;4
Playwrite ES Deco Guides;h;4;;4
Playwrite IT Trad Guides;h;4;;4
Playwrite FR Trad Guides;h;4;;4
Playwrite IT Moderna Guides;h;4;;4
Playwrite US Modern Guides;h;4;;4
Playwrite RO Guides;h;4;;4
Playwrite AU TAS Guides;h;4;;4
Playwrite AU QLD Guides;h;4;;4
Playwrite DE SAS Guides;h;4;;4
Playwrite ID Guides;h;4;;4
Playwrite CL Guides;h;4;;4
Playwrite AT Guides;h;4;i;4
Playwrite HR Lijeva Guides;h;4;;4
Playwrite ZA Guides;h;4;;4
Playwrite NG Modern Guides;h;4;;4
Playwrite BE VLG Guides;h;4;;4
Playwrite AU NSW Guides;h;4;;4
Playwrite DK Loopet Guides;h;4;;4
Playwrite HU Guides;h;4;;4
Playwrite ES Guides;h;4;;4
Playwrite NL Guides;h;4;;4
Playwrite SK Guides;h;4;;4
Playwrite CZ Guides;h;4;;4
Playwrite NO Guides;h;4;;4
Playwrite HR Guides;h;4;;4
42dot Sans;s;345678;;26,4
Adwaita Mono;m;47;i;4
Adwaita Sans;s;123456789;i;4
Aileron;s;134678;i;4
Apfel Grotezk;s;47;;4
Argentum Sans;s;123456789;i;4
Arima Madurai;d;12345789;;4,5,21,6
Bagnard;r;4;;4
Bagnard Sans;s;4;;4
BBH Sans Bartle;s;4;;4
BBH Sans Bogle;s;4;;4
BBH Sans Hegarty;s;4;;4
Big Shoulders Display;d;123456789;;4,5,6
Big Shoulders Inline Display;d;123456789;;4,5,6
Big Shoulders Inline Text;d;123456789;;4,5,6
Big Shoulders Stencil Display;d;123456789;;4,5,6
Big Shoulders Stencil Text;d;123456789;;4,5,6
Big Shoulders Text;d;123456789;;4,5,6
BJ Cree;r;4567;;10,4
Blackout Midnight;d;4;;4
Blackout Sunrise;d;4;;4
Blackout Two AM;d;4;;4
Bluu Next;s;7;i;4
Bravura;s;4;;4
Bravura Text;s;4;;4
Briem Hand;h;123456789;;1,3,4,5,6
Chunk Five;r;8;;4
Clear Sans;s;13457;i;4
Coda Caption;s;8;;4,5
Comic Mono;m;47;;4
Commit Mono;m;234567;i;4
Cooper Hewitt;s;12345678;i;4
DejaVu Math;d;4;;4
DejaVu Mono;m;47;i;4
DejaVu Sans;s;47;i;4
DejaVu Serif;r;47;i;4
DSEG Weather;d;4;;4
DSEG14 Classic;d;347;i;4
DSEG14 Classic Mini;d;347;i;4
DSEG14 Modern;d;347;i;4
DSEG14 Modern Mini;d;347;i;4
DSEG7 Classic;d;347;i;4
DSEG7 Classic Mini;d;347;i;4
DSEG7 Modern;d;347;i;4
DSEG7 Modern Mini;d;347;i;4
DSEG7 SEGG CHAN;d;4;;4
DSEG7 SEGG CHAN Mini;d;4;;4
Finlandica;s;4567;i;0,1,4,5
FiraGO;s;123456789;i;4
Fredoka One;d;4;;4
Fusion Kai G;h;4;;4
Fusion Kai J;h;4;;4
Fusion Kai T;h;4;;4
Fusion Pixel 10px Monospaced JP;s;4;;4
Fusion Pixel 10px Monospaced KR;s;4;;4
Fusion Pixel 10px Monospaced SC;s;4;;4
Fusion Pixel 10px Monospaced TC;s;4;;4
Fusion Pixel 10px Proportional JP;s;4;;4
Fusion Pixel 10px Proportional KR;s;4;;4
Fusion Pixel 10px Proportional SC;s;4;;4
Fusion Pixel 10px Proportional TC;s;4;;4
Fusion Pixel 12px Monospaced JP;s;4;;4
Fusion Pixel 12px Monospaced KR;s;4;;4
Fusion Pixel 12px Monospaced SC;s;4;;4
Fusion Pixel 12px Monospaced TC;s;4;;4
Fusion Pixel 12px Proportional JP;s;4;;4
Fusion Pixel 12px Proportional KR;s;4;;4
Fusion Pixel 12px Proportional SC;s;4;;4
Fusion Pixel 12px Proportional TC;s;4;;4
Fusion Pixel 8px Monospaced JP;s;4;;4
Fusion Pixel 8px Monospaced KR;s;4;;4
Fusion Pixel 8px Monospaced SC;s;4;;4
Fusion Pixel 8px Monospaced TC;s;4;;4
Fusion Pixel 8px Proportional JP;s;4;;4
Fusion Pixel 8px Proportional KR;s;4;;4
Fusion Pixel 8px Proportional SC;s;4;;4
Fusion Pixel 8px Proportional TC;s;4;;4
Geist Sans;s;123456789;;4
Genjyuu Gothic;s;1234579;;4
Gentium Book Basic;r;47;i;4,5
Hauora Sans;s;2345678;;4
iA Writer Duo;m;47;i;4
iA Writer Mono;m;47;i;4
iA Writer Quattro;s;47;i;4
Iosevka;m;123456789;i;4
Iosevka Aile;m;123456789;i;4
Iosevka Curly;m;123456789;i;4
Iosevka Curly Slab;m;123456789;i;4
Iosevka Etoile;m;123456789;i;4
Junction;s;347;;4
Kantumruy;s;347;;16
Karmilla;s;47;;4
League Mono;m;12345678;;4
Lextrall;s;123456789;;4
LXGW WenKai;s;357;;4
Maple Mono;m;12345678;i;4
Material Symbols;m;1234567;;4
Merienda One;h;4;;4
Metropolis;s;123456789;i;4
Monaspace Argon;m;2345678;i;4
Monaspace Krypton;m;2345678;i;4
Monaspace Neon;m;2345678;i;4
Monaspace Radon;h;2345678;i;4
Monaspace Xenon;r;2345678;i;4
Mononoki;m;47;i;4
Montserrat Subrayada;s;47;;4
Nebula Sans;s;345679;i;4
Norwester;s;4;;4
Noto Mono;m;4;;4
Noto Sans Phags Pa;s;4;;153
Open Runde;s;4567;;4
Open Sauce One;s;3456789;i;4
Open Sauce Sans;s;3456789;i;4
Open Sauce Two;s;3456789;i;4
OpenDyslexic;s;47;i;4
Ostrich Sans;s;3479;;4
Peace Sans;s;4;;4
Pitagon Sans;s;456789;;4
Pitagon Sans Mono;m;12345678;i;4
Pitagon Sans Text;s;2345678;i;4
Pitagon Serif;r;123456789;i;4
Pretendard;s;123456789;;4
Pushster;d;4;;4,5
Rubik One;s;4;;4
Saira Stencil One;d;4;;4,5,6
Source Sans Pro;s;234679;i;0,1,2,3,4,5,6
Source Serif Pro;r;234679;i;0,1,2,4,5,6
Syne Italic;s;4;i;4
Uncut Sans;s;34567;i;4
Unifont;s;4;;4
UnifontEX;m;4;;4
WIN95FA;s;4;;4
YakuHanJP;d;1234579;;4
YakuHanJPs;d;1234579;;4
YakuHanMP;d;1234579;;4
YakuHanMPs;d;1234579;;4
YakuHanRP;d;1345789;;4
YakuHanRPs;d;1345789;;4`;var Mf={s:"sans-serif",r:"serif",d:"display",m:"monospace",h:"handwriting"};var ia;function ec(){if(ia)return ia;let t=Yl.split("|"),e=[],n=Ql.split(`
`);for(let r=0;r<n.length;r++){let[o,s,i,a,l,u]=n[r].split(";");e.push({family:o,category:Mf[s]??"sans-serif",origin:"google",weights:[...i].map(c=>Number(c)*100),italic:a.includes("i"),subsets:l===""?[]:l.split(",").map(c=>t[Number(c)]),id:u??o.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),rank:r,fallbacks:[]})}return ia=e,e}var tc;function qr(t){return t.trim().replace(/^["']|["']$/g,"").replace(/\s+/g," ").toLowerCase()}function Af(){let t=new Map;for(let e of ec())t.set(qr(e.family),e);for(let e of Jl){t.set(qr(e.family),e);for(let n of e.aliases??[])t.set(qr(n),e)}for(let[e,n]of Object.entries(Zl)){let r=t.get(qr(n));r&&!t.has(e)&&t.set(e,r)}return t}var Tf=new Map;function It(t){tc??(tc=Af());let e=qr(t);return Tf.get(e)??tc.get(e)}function aa(t){return(t.split(",")[0]??"").trim().replace(/^["']|["']$/g,"")}var Rf={"sans-serif":"sans-serif",serif:"serif",monospace:"monospace",display:"sans-serif",handwriting:"cursive"},Df=t=>/^[A-Za-z][A-Za-z0-9-]*$/.test(t)&&!/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(t)?t:`"${t.replace(/["\\]/g,"")}"`;function Ls(t){let e=t.toLowerCase();return/mono|courier|consolas|menlo|monaco|code|typewriter|terminal/.test(e)?"monospace":/script|hand|brush|marker|cursive|calligraph/.test(e)?"handwriting":/times|georgia|garamond|palatino|cambria|book|minion|charter|baskerville|didot|bodoni|serif/.test(e)&&!/sans/.test(e)?"serif":"sans-serif"}function nc(t){return It(t)?.category??Ls(t)}function la(t,e=[],n){let r=n??It(t),o=[aa(t)||t,...r?.fallbacks??[],...e];return[...[...new Set(o.filter(Boolean))].map(Df),Rf[r?.category??Ls(t)]].join(", ")}function ca(t){switch(nc(t)){case"serif":return{docxFamily:"roman",docxPitch:"variable",xlsxFamily:1,pptxPitchFamily:18};case"monospace":return{docxFamily:"modern",docxPitch:"fixed",xlsxFamily:3,pptxPitchFamily:49};case"handwriting":return{docxFamily:"script",docxPitch:"variable",xlsxFamily:4,pptxPitchFamily:66};case"display":return{docxFamily:"decorative",docxPitch:"variable",xlsxFamily:5,pptxPitchFamily:82};default:return{docxFamily:"swiss",docxPitch:"variable",xlsxFamily:2,pptxPitchFamily:34}}}var Ef={roboto:"Arial","open sans":"Segoe UI",lato:"Calibri",montserrat:"Century Gothic",poppins:"Century Gothic",inter:"Segoe UI","source sans 3":"Calibri","source sans pro":"Calibri","noto sans":"Segoe UI",raleway:"Century Gothic",nunito:"Calibri","nunito sans":"Calibri","work sans":"Arial","fira sans":"Trebuchet MS",ubuntu:"Trebuchet MS","pt sans":"Calibri","dm sans":"Arial",mulish:"Calibri",rubik:"Arial",karla:"Arial",barlow:"Arial",quicksand:"Century Gothic","josefin sans":"Century Gothic",oswald:"Impact","bebas neue":"Impact",anton:"Impact","archivo black":"Arial Black",lora:"Georgia",merriweather:"Georgia","playfair display":"Georgia","pt serif":"Georgia","crimson text":"Garamond","eb garamond":"Garamond","cormorant garamond":"Garamond","libre baskerville":"Georgia","noto serif":"Georgia","source serif 4":"Georgia","roboto slab":"Rockwell","zilla slab":"Rockwell",bitter:"Rockwell",arvo:"Rockwell","roboto mono":"Consolas","source code pro":"Consolas","fira code":"Consolas","jetbrains mono":"Consolas",inconsolata:"Consolas","ibm plex mono":"Consolas","space mono":"Courier New","courier prime":"Courier New","dancing script":"Segoe Script",pacifico:"Segoe Script",caveat:"Segoe Print",lobster:"Segoe Script","comic neue":"Comic Sans MS",carlito:"Calibri",caladea:"Cambria",arimo:"Arial",tinos:"Times New Roman",cousine:"Courier New",gelasio:"Georgia"};function Us(t){let e=It(t);if(e?.origin==="system")return e.family;let n=Ef[(e?.family??t).toLowerCase()];if(n)return n;switch(e?.category??Ls(t)){case"serif":return"Times New Roman";case"monospace":return"Courier New";case"handwriting":return"Comic Sans MS";default:return"Arial"}}function H(t){let e="";for(let n of t)e+=n.text;return e}function W(t){let e=0;for(let n of t)e+=n.text.length;return e}function js(t,e){let n=t?Object.keys(t):[],r=e?Object.keys(e):[];return n.length!==r.length?!1:n.every(o=>{let s=t[o],i=e?.[o];return Array.isArray(s)&&Array.isArray(i)?s.length===i.length&&s.every((a,l)=>a===i[l]):s&&i&&typeof s=="object"&&typeof i=="object"?JSON.stringify(s)===JSON.stringify(i):s===i})}function Lt(t,e){let n=0;for(let r of t){let o=n+r.text.length;if(e>=n&&e<o)return r.marks;n=o}}function zs(t,e,n,r){return n<=e?!1:le(t,e,n).every(o=>o.marks?.[r]===!0)}function ce(t){let e=[];for(let n of t){if(n.text==="")continue;let r=n.marks&&Object.keys(n.marks).length>0?n.marks:void 0,o=e[e.length-1];o&&js(o.marks,r)?o.text+=n.text:e.push(r?{text:n.text,marks:{...r}}:{text:n.text})}return e}function ar(t,e,n){let r=W(t);if(!Number.isInteger(e)||!Number.isInteger(n)||e<0||n<e||n>r)throw new S("out_of_range",`Range ${e}-${n} is outside text of length ${r}`)}function le(t,e,n){ar(t,e,n);let r=[],o=0;for(let s of t){let i=o,a=o+s.text.length;o=a;let l=Math.max(e,i),u=Math.min(n,a);l<u&&r.push({text:s.text.slice(l-i,u-i),marks:s.marks})}return ce(r)}function rc(t,e,n){return ar(t,e,e),ce([...le(t,0,e),...n,...le(t,e,W(t))])}function oc(t,e,n){return ar(t,e,n),ce([...le(t,0,e),...le(t,n,W(t))])}function Ho(t,e){let n={...t};for(let[r,o]of Object.entries(e))o===null||o===!1||o===void 0?delete n[r]:n[r]=o;return n}function sc(t,e,n,r){ar(t,e,n);let o=W(t),s=le(t,e,n).map(i=>({text:i.text,marks:Ho(i.marks,r)}));return ce([...le(t,0,e),...s,...le(t,n,o)])}function ic(t){if(!t||!t.comment)return t;let{comment:e,...n}=t;return Object.keys(n).length>0?n:void 0}function Ko(t,e,n){let r=[];for(let o of le(t,e,n)){let s=ic(o.marks),i=r[r.length-1];i&&js(i.marks,s)?i.length+=o.text.length:r.push(s?{length:o.text.length,marks:s}:{length:o.text.length})}return r}function ac(t,e,n,r){ar(t,e,n);let o=r.reduce((h,g)=>h+g.length,0);if(o!==n-e)throw new S("invalid_operation",`Mark segments cover ${o} characters, not ${n-e}`);let s=le(t,e,n),i=H(s),a=h=>h.reduce((g,y)=>[...g,(g[g.length-1]??0)+y],[]),l=a(r.map(h=>h.length)),u=a(s.map(h=>h.text.length)),c=[],d=0,f=0,p=0;for(;d<o;){for(;l[f]<=d;)f++;for(;u[p]<=d;)p++;let h=Math.min(l[f],u[p]),g={...ic(r[f].marks),...s[p].marks?.comment?{comment:s[p].marks.comment}:{}};c.push({text:i.slice(d,h),marks:Object.keys(g).length>0?g:void 0}),d=h}return ce([...le(t,0,e),...c,...le(t,n,W(t))])}function at(t){let e=t.reduce((o,s)=>o+Math.max(0,s),0);if(e<=0)return t.map(()=>1/t.length);let n=t.map(o=>Math.max(0,o)/e),r=n.slice(0,-1).reduce((o,s)=>o+s,0);return n[n.length-1]=1-r,n}function yt(t){return t.rowSpan??1}function it(t){return t.colSpan??1}function Xr(t){let e=t.rows.length,n=t.columns.length,r=Array.from({length:e},()=>Array.from({length:n},()=>{}));return t.rows.forEach((o,s)=>o.cells.forEach((i,a)=>{if(!i.covered)for(let l=s;l<Math.min(e,s+yt(i));l++)for(let u=a;u<Math.min(n,a+it(i));u++)r[l][u]||(r[l][u]={row:s,col:a})})),r.map((o,s)=>o.map((i,a)=>i??{row:s,col:a}))}function Vr(t,e,n){let r=Xr(t)[e][n];return{cell:t.rows[r.row].cells[r.col],row:r.row,col:r.col}}function Qt(t,e,n){return{row1:e,row2:e+yt(t)-1,col1:n,col2:n+it(t)-1}}function lc(t,e){let n=Xr(t),{row1:r,row2:o,col1:s,col2:i}=e;for(let a=!0;a;){a=!1;for(let l=r;l<=o;l++)for(let u=s;u<=i;u++){let c=n[l][u],d=Qt(t.rows[c.row].cells[c.col],c.row,c.col);d.row1<r&&(r=d.row1,a=!0),d.row2>o&&(o=d.row2,a=!0),d.col1<s&&(s=d.col1,a=!0),d.col2>i&&(i=d.col2,a=!0)}}return{row1:r,row2:o,col1:s,col2:i}}function lr(t,e){let n=[];for(let r=e.row1;r<=e.row2;r++)for(let o=e.col1;o<=e.col2;o++){let s=t.rows[r].cells[o];s.covered||n.push({cell:s,row:r,col:o})}return n}var cc=()=>({id:T("b_"),type:"paragraph",runs:[]});function uc(){return{id:T("c_"),blocks:[cc()]}}function dc(){return{id:T("c_"),blocks:[],covered:!0}}function vn(t,e){let n={...t,...e};for(let r of Object.keys(n))n[r]===void 0&&delete n[r];return n}var Jr=t=>({rows:t.rows.map(e=>({...e,cells:e.cells.slice()}))});function Gs(t,e){let{rows:n}=Jr(t),r=Xr(t),o=[];for(let s=0;s<t.columns.length;s++){let i=e>0&&e<t.rows.length?r[e][s]:null;if(i&&i.row<e){if(o.push(dc()),s===i.col){let a=n[i.row];a.cells[i.col]=vn(a.cells[i.col],{rowSpan:yt(a.cells[i.col])+1})}}else o.push(uc())}return n.splice(e,0,{id:T("r_"),cells:o}),{...t,rows:n}}function Hs(t,e){let{rows:n}=Jr(t),r=Xr(t);t.rows.forEach((i,a)=>{let l=e>0&&e<t.columns.length?r[a][e]:null,u=n[a].cells;l&&l.col<e?(u.splice(e,0,dc()),a===l.row&&(u[l.col]=vn(u[l.col],{colSpan:it(u[l.col])+1}))):u.splice(e,0,uc())});let o=1/(t.columns.length+1),s=at([...t.columns.slice(0,e).map(i=>i*(1-o)),o,...t.columns.slice(e).map(i=>i*(1-o))]);return{...t,rows:n,columns:s}}function fc(t,e,n){let{rows:r}=Jr(t);return t.rows.forEach((o,s)=>{o.cells.forEach((i,a)=>{if(i.covered)return;let l=s+yt(i)-1;if(s>=e&&s<=n&&l>n){let u=r[n+1].cells,c=l-n;u[a]=vn(i,{rowSpan:c>1?c:void 0,covered:void 0})}else if(s<e&&l>=e){let u=Math.min(l,n)-e+1,c=yt(i)-u;r[s].cells[a]=vn(i,{rowSpan:c>1?c:void 0})}})}),{...t,rows:r.filter((o,s)=>s<e||s>n)}}function pc(t,e,n){let{rows:r}=Jr(t);return t.rows.forEach((o,s)=>{o.cells.forEach((i,a)=>{if(i.covered)return;let l=a+it(i)-1;if(a>=e&&a<=n&&l>n){let u=l-n;r[s].cells[n+1]=vn(i,{colSpan:u>1?u:void 0,covered:void 0})}else if(a<e&&l>=e){let u=Math.min(l,n)-e+1,c=it(i)-u;r[s].cells[a]=vn(i,{colSpan:c>1?c:void 0})}})}),{...t,rows:r.map(o=>({...o,cells:o.cells.filter((s,i)=>i<e||i>n)})),columns:at(t.columns.filter((o,s)=>s<e||s>n))}}var zf=t=>t.blocks.every(e=>("runs"in e?e.runs.length===0:!1)&&e.type!=="image"&&e.type!=="divider");function mc(t,e){if(e.row1===e.row2&&e.col1===e.col2)return null;let{rows:n}=Jr(t),r=lr(t,e),o=r[0],s=[];for(let{cell:a}of r)zf(a)||s.push(...a.blocks);let i=s.length>0?s:o.cell.blocks;n[o.row].cells[o.col]=vn(o.cell,{blocks:i,rowSpan:e.row2>e.row1?e.row2-e.row1+1:void 0,colSpan:e.col2>e.col1?e.col2-e.col1+1:void 0});for(let a=e.row1;a<=e.row2;a++)for(let l=e.col1;l<=e.col2;l++){if(a===e.row1&&l===e.col1)continue;let u=n[a].cells[l];n[a].cells[l]={id:u.id,blocks:[],covered:!0}}return{...t,rows:n}}function hc(t,e,n){let r=t.rows[e]?.cells[n];if(!r||r.covered||yt(r)===1&&it(r)===1)return null;let{rows:o}=Jr(t),s=Qt(r,e,n);for(let i=s.row1;i<=s.row2;i++)for(let a=s.col1;a<=s.col2;a++)i===e&&a===n||(o[i].cells[a]={id:o[i].cells[a].id,blocks:[cc()]});return o[e].cells[n]=vn(r,{rowSpan:void 0,colSpan:void 0}),{...t,rows:o}}function Cn(t){let e=t.rows.length,n=t.columns.length,r=Array.from({length:e},()=>Array.from({length:n},()=>null));for(let o=0;o<e;o++){let s=t.rows[o];if(s.cells.length!==n)return`rows[${o}] has ${s.cells.length} cells, expected ${n}`;for(let i=0;i<n;i++){let a=s.cells[i];if(a.covered){if(a.blocks.length>0)return`rows[${o}].cells[${i}] is covered but has content`;if(a.rowSpan||a.colSpan)return`rows[${o}].cells[${i}] is covered but has a span`;continue}if(a.blocks.length===0)return`rows[${o}].cells[${i}] needs at least one block`;let l=yt(a),u=it(a);if(o+l>e||i+u>n)return`rows[${o}].cells[${i}] spans outside the table`;for(let c=o;c<o+l;c++)for(let d=i;d<i+u;d++){if(r[c][d])return`rows[${c}].cells[${d}] is covered twice`;if(r[c][d]=a.id,(c!==o||d!==i)&&!t.rows[c].cells[d].covered)return`rows[${c}].cells[${d}] is under a merged cell but not marked covered`}}}for(let o=0;o<e;o++)for(let s=0;s<n;s++)if(!r[o][s]&&t.rows[o].cells[s].covered)return`rows[${o}].cells[${s}] is covered by nothing`;return null}function Pn(t){let e=[];for(let n of t)if(e.push(n),n.type==="table")for(let r of n.rows)for(let o of r.cells)e.push(...o.blocks);return e}function J(t,e){for(let n=0;n<t.blocks.length;n++){let r=t.blocks[n];if(r.id===e)return{block:r,list:t.blocks,index:n,topIndex:n,cell:null};if(r.type==="table")for(let o=0;o<r.rows.length;o++){let s=r.rows[o].cells;for(let i=0;i<s.length;i++){let a=s[i],l=a.blocks.findIndex(u=>u.id===e);if(l>=0)return{block:a.blocks[l],list:a.blocks,index:l,topIndex:n,cell:{table:r,row:o,col:i,cell:a}}}}}return null}function Wo(t,e){for(let n=0;n<t.blocks.length;n++){let r=t.blocks[n];if(r.type==="table")for(let o=0;o<r.rows.length;o++){let s=r.rows[o].cells.findIndex(i=>i.id===e);if(s>=0)return{table:r,row:o,col:s,cell:r.rows[o].cells[s],topIndex:n}}}return null}function Zr(t,e,n){let r=t.findIndex(o=>o.id===e);if(r>=0)return n(t.slice(),r);for(let o=0;o<t.length;o++){let s=t[o];if(s.type==="table")for(let i=0;i<s.rows.length;i++){let a=s.rows[i];for(let l=0;l<a.cells.length;l++){let u=a.cells[l],c=u.blocks.findIndex(g=>g.id===e);if(c<0)continue;let d=n(u.blocks.slice(),c),f=s.rows.slice(),p=a.cells.slice();p[l]={...u,blocks:d},f[i]={...a,cells:p};let h=t.slice();return h[o]={...s,rows:f},h}}}return null}function gc(t,e,n){for(let r=0;r<t.length;r++){let o=t[r];if(o.type==="table")for(let s=0;s<o.rows.length;s++){let i=o.rows[s],a=i.cells.findIndex(d=>d.id===e);if(a<0)continue;let l=o.rows.slice(),u=i.cells.slice();u[a]={...i.cells[a],blocks:n(i.cells[a].blocks.slice())},l[s]={...i,cells:u};let c=t.slice();return c[r]={...o,rows:l},c}}return null}function ie(t,e=new Set){for(let n of t)if(e.add(n.id),n.type==="table")for(let r of n.rows){e.add(r.id);for(let o of r.cells)e.add(o.id),ie(o.blocks,e)}return e}function U(t,e){return{anchor:{block:t,offset:e},focus:{block:t,offset:e}}}function ge(t){return t.anchor.block===t.focus.block&&t.anchor.offset===t.focus.offset}function Ct(t){return F(t)?W(t.runs):0}var yc=new WeakMap;function Ve(t){let e=yc.get(t.blocks);if(!e){let n=Pn(t.blocks);e={list:n,index:new Map(n.map((r,o)=>[r.id,o]))},yc.set(t.blocks,e)}return e}function Bn(t,e){let n=Ve(t).index.get(e);if(n===void 0)throw new S("not_found",`No block with id "${e}"`);return n}function Gf(t,e,n){return e.block===n.block?e.offset-n.offset:Bn(t,e.block)-Bn(t,n.block)}function cr(t,e){return Gf(t,e.anchor,e.focus)<=0?{start:e.anchor,end:e.focus}:{start:e.focus,end:e.anchor}}function bt(t,e){let n=J(t,e.anchor.block),r=J(t,e.focus.block);if(!n?.cell||!r?.cell||n.cell.table.id!==r.cell.table.id||n.cell.cell.id===r.cell.cell.id)return null;let o=Qt(n.cell.cell,n.cell.row,n.cell.col),s=Qt(r.cell.cell,r.cell.row,r.cell.col),i=lc(n.cell.table,{row1:Math.min(o.row1,s.row1),row2:Math.max(o.row2,s.row2),col1:Math.min(o.col1,s.col1),col2:Math.max(o.col2,s.col2)});return{table:n.cell.table,topIndex:n.topIndex,...i}}function ua(t){return lr(t.table,t)}function Je(t,e,n={}){let r=n.raw?null:bt(t,e);if(r)return ua(r).flatMap(({cell:c})=>c.blocks.map(d=>({block:d,from:0,to:Ct(d)})));let{start:o,end:s}=cr(t,e),{list:i}=Ve(t),a=Bn(t,o.block),l=Bn(t,s.block);!n.raw&&l>a&&s.offset===0&&l--;let u=[];for(let c=a;c<=l;c++){let d=i[c],f=Ct(d);u.push({block:d,from:c===a&&d.id===o.block?o.offset:0,to:c===l&&d.id===s.block?s.offset:f})}return u}function Ge(t,e){return Je(t,e).map(n=>n.block)}function kc(t){let e=Ve(t).list.filter(o=>o.type!=="table"),n=e[0],r=e[e.length-1];return!n||!r?null:{anchor:{block:n.id,offset:0},focus:{block:r.id,offset:Ct(r)}}}function bc(t,e){let n=J(t,e.block);if(!n)return null;let r=Math.min(Math.max(Math.trunc(e.offset)||0,0),Ct(n.block));return{block:n.block.id,offset:r}}function Ks(t,e){let n=Ve(t).list.find(s=>s.type!=="table");if(!n)return null;let r=e&&bc(t,e.anchor),o=e&&bc(t,e.focus);return r&&o?{anchor:r,focus:o}:U(n.id,0)}function qo(t,e,n){let r=i=>{let a=i;for(let l of e)if(l.type==="insert_text"&&l.block===a.block&&l.offset<a.offset)a={block:a.block,offset:a.offset+l.runs.reduce((u,c)=>u+c.text.length,0)};else if(l.type==="delete_text"&&l.block===a.block){let u=a.offset<=l.from?a.offset:a.offset>=l.to?a.offset-(l.to-l.from):l.from;u!==a.offset&&(a={block:a.block,offset:u})}else l.type==="delete_block"&&n&&(l.id===a.block||l.within?.includes(a.block))&&(a=Hf(n,l)??a);if(n&&!J(n,a.block)&&a.block.endsWith("~empty")){let u=Wo(n,a.block.slice(0,-6))?.cell.blocks[0];u&&(a={block:u.id,offset:0})}return a},o=r(t.anchor),s=r(t.focus);return o===t.anchor&&s===t.focus?t:{anchor:o,focus:s}}function Hf(t,e){if(typeof e.after=="string"){let r=J(t,e.after)?.block;if(r){if(r.type!=="table")return{block:r.id,offset:Ct(r)};let o=r.rows.at(-1)?.cells.at(-1)?.blocks.at(-1);if(o)return{block:o.id,offset:Ct(o)}}}let n=e.cell!==void 0?Wo(t,e.cell)?.cell.blocks[0]:Ve(t).list.find(r=>r.type!=="table");return n?{block:n.id,offset:0}:null}var Kf=200,Wf=(t,e)=>t?.includes(e)?[...t]:[...t??[],e].sort();function da(t,e,n,r){let o=[],s=0;for(let i of t){let a=s+i.text.length,l=Math.max(e,s),u=Math.min(n,a);l>=u?o.push(i):(l>s&&o.push({...i,text:i.text.slice(0,l-s)}),o.push({text:i.text.slice(l-s,u-s),marks:{...i.marks,comment:Wf(i.marks?.comment,r)}}),u<a&&o.push({...i,text:i.text.slice(u-s)})),s=a}return ce(o)}function fa(t,e,n=0,r=1/0){if(!t.some(i=>i.marks?.comment?.includes(e)))return t;let o=[],s=0;for(let i of t){let a=s+i.text.length,l=Math.max(n,s),u=Math.min(r,a);if(l>=u||!i.marks?.comment?.includes(e))o.push(i);else{let{comment:c,...d}=i.marks,f=c.filter(p=>p!==e);l>s&&o.push({...i,text:i.text.slice(0,l-s)}),o.push({text:i.text.slice(l-s,u-s),marks:f.length>0?{...d,comment:f}:d}),u<a&&o.push({...i,text:i.text.slice(u-s)})}s=a}return ce(o)}function pa(t,e=new Set){let n=r=>{if(F(r))for(let o of r.runs)for(let s of o.marks?.comment??[])e.add(s);else if(r.type==="table")for(let o of r.rows)for(let s of o.cells)s.blocks.forEach(n)};return t.forEach(n),e}function On(t,e){let n=[];for(let r of Ve(t).list){if(!F(r))continue;let o=0,s=null;for(let i of r.runs){let a=o+i.text.length;i.marks?.comment?.includes(e)?s?s.to=a:s={block:r.id,from:o,to:a}:s&&(n.push(s),s=null),o=a}s&&n.push(s)}return n}function ma(t,e){if(!e)return[];let n=new Set,r=ge(e);for(let{block:o,from:s,to:i}of Je(t,e)){if(!F(o))continue;let a=0;for(let l of o.runs){let u=a+l.text.length;if(r?s>a&&s<=u:s<u&&i>a)for(let d of l.marks?.comment??[])n.add(d);a=u}}return[...n]}function ha(t,e){let n=Je(t,e).find(o=>F(o.block)&&o.to>o.from);if(!n)return null;let r=H(n.block.runs).slice(n.from,n.to);return{block:n.block.id,from:n.from,to:n.to,quote:r.slice(0,Kf)}}function wc(t,e,n){let r=[];for(let{block:o,from:s,to:i}of Je(t,e))!F(o)||i<=s||r.push({type:"comment_text",block:o.id,from:s,to:i,id:n,on:!0});return r}function Sc(t,e){return On(t,e).map(({block:n,from:r,to:o})=>({type:"comment_text",block:n,from:r,to:o,id:e,on:!1}))}function ga(t,e){let n=e.anchor;if(!n||n.quote==="")return[];let r=Ve(t).list.find(i=>i.id===n.block);if(!r||!F(r))return[];let o=H(r.runs),s=n.from;return o.slice(s,s+n.quote.length)!==n.quote&&(s=o.indexOf(n.quote),s<0)?[]:[{type:"comment_text",block:r.id,from:s,to:s+n.quote.length,id:e.id,on:!0}]}function ya(t){let e=r=>ce(r.map(o=>{if(!o.marks?.comment)return o;let{comment:s,...i}=o.marks;return{text:o.text,marks:i}})),n=r=>{if(F(r)&&W(r.runs)>0){let o=r.runs;return o.some(s=>s.marks?.comment)?{...r,runs:e(o)}:r}return r.type==="table"?{...r,rows:r.rows.map(o=>({...o,cells:o.cells.map(s=>({...s,blocks:s.blocks.map(n)}))}))}:r};return t.map(n)}function ba(t){return oa({threads:()=>Object.values(t.state.comments??{}),write:(e,n)=>t.write([{type:"set_thread",id:e,thread:n}])})}function Xo(t,e){let n=J(t,e);if(!n)throw new S("not_found",`No block with id "${e}"`);return n}function Yr(t,e){let{block:n}=Xo(t,e);if(!F(n))throw new S("invalid_operation",`Block "${e}" (${n.type}) has no text`);return n}function Qr(t,e){let n=Zr(t.blocks,e.id,(r,o)=>(r[o]=e,r));return{...t,blocks:n}}function qf(t){let e=t.list[t.index-1];return e?{after:e.id}:t.cell?{after:null,cell:t.cell.cell.id}:{after:null}}var Mn={apply(t,e){switch(e.type){case"insert_block":{let n=ie([e.block]),r=ie(t.blocks);for(let a of n)if(r.has(a))throw new S("invalid_operation",`Block id "${a}" already exists`);let o,s=a=>a.length===1&&a[0].id.endsWith("~empty")&&F(a[0])&&W(a[0].runs)===0;if(e.after!==null)Xo(t,e.after),o=Zr(t.blocks,e.after,(a,l)=>(s(a)?a.splice(0,1,e.block):a.splice(l+1,0,e.block),a));else if(e.cell!==void 0){if(!Wo(t,e.cell))throw new S("not_found",`No table cell with id "${e.cell}"`);o=gc(t.blocks,e.cell,a=>(s(a)?a.splice(0,1,e.block):a.unshift(e.block),a))}else o=[e.block,...t.blocks];let i=[...ie([e.block])].filter(a=>a!==e.block.id);return{state:{...t,blocks:o},inverse:{type:"delete_block",id:e.block.id,after:e.after,...e.cell!==void 0&&{cell:e.cell},...i.length>0&&{within:i}}}}case"delete_block":{let n=Xo(t,e.id),r=!!n.cell&&n.list.length===1,o=Zr(t.blocks,e.id,(s,i)=>(r?s[i]={id:`${n.cell.cell.id}~empty`,type:"paragraph",runs:[]}:s.splice(i,1),s));return{state:{...t,blocks:o},inverse:{type:"insert_block",block:n.block,...qf(n)}}}case"replace_block":{let n=Xo(t,e.id);if(e.block.id!==e.id)throw new S("invalid_operation","replace_block must keep the block id");let r=Zr(t.blocks,e.id,(o,s)=>(o[s]=e.block,o));return{state:{...t,blocks:r},inverse:{type:"replace_block",id:e.id,block:n.block}}}case"update_block":{let r=Xo(t,e.id).block,o={...r},s={};for(let[l,u]of Object.entries(e.patch)){if(l==="id"||l==="runs")throw new S("invalid_operation",`update_block can't change "${l}"`);s[l]=r[l]===void 0?null:r[l],u==null?delete o[l]:o[l]=u}let i=Zr(t.blocks,e.id,(l,u)=>(l[u]=o,l)),a=Array.isArray(e.patch.rows)?[...ie([o])].filter(l=>l!==e.id):[];return{state:{...t,blocks:i},inverse:{type:"update_block",id:e.id,patch:s,...a.length>0?{within:a}:{}}}}case"insert_text":{let n=Yr(t,e.block),r=rc(n.runs,e.offset,e.runs);return{state:Qr(t,{...n,runs:r}),inverse:{type:"delete_text",block:e.block,from:e.offset,to:e.offset+e.runs.reduce((o,s)=>o+s.text.length,0)}}}case"delete_text":{let n=Yr(t,e.block),r=le(n.runs,e.from,e.to),o=oc(n.runs,e.from,e.to);return{state:Qr(t,{...n,runs:o}),inverse:{type:"insert_text",block:e.block,offset:e.from,runs:r}}}case"format_text":{let n=Yr(t,e.block),r=sc(n.runs,e.from,e.to,e.patch);return{state:Qr(t,{...n,runs:r}),inverse:{type:"restore_marks",block:e.block,from:e.from,to:e.to,segments:Ko(n.runs,e.from,e.to)}}}case"restore_marks":{let n=Yr(t,e.block),r=ac(n.runs,e.from,e.to,e.segments);return{state:Qr(t,{...n,runs:r}),inverse:{type:"restore_marks",block:e.block,from:e.from,to:e.to,segments:Ko(n.runs,e.from,e.to)}}}case"set_runs":{let n=Yr(t,e.block);return{state:Qr(t,{...n,runs:ce(e.runs)}),inverse:{type:"set_runs",block:e.block,runs:n.runs}}}case"set_title":return{state:{...t,title:e.title},inverse:{type:"set_title",title:t.title}};case"set_page":{let{page:n,...r}=t;return{state:e.page?{...r,page:e.page}:r,inverse:{type:"set_page",page:n??null}}}case"set_footnote":{let n=t.footnotes?.[e.id]??null,{[e.id]:r,...o}=t.footnotes??{},s=e.blocks?{...o,[e.id]:e.blocks}:o,{footnotes:i,...a}=t;return{state:Object.keys(s).length>0?{...a,footnotes:s}:a,inverse:{type:"set_footnote",id:e.id,blocks:n}}}case"comment_text":{let n=Yr(t,e.block);ar(n.runs,e.from,e.to);let r=e.on?da(n.runs,e.from,e.to,e.id):fa(n.runs,e.id,e.from,e.to);return{state:Qr(t,{...n,runs:r}),inverse:{...e,on:!e.on}}}case"set_thread":{let n=t.comments?.[e.id]??null,{[e.id]:r,...o}=t.comments??{},s=e.thread?{...o,[e.id]:e.thread}:o,{comments:i,...a}=t;return{state:Object.keys(s).length>0?{...a,comments:s}:a,inverse:{type:"set_thread",id:e.id,thread:n}}}case"set_style":{let n=t.styles?.[e.id]??null,{[e.id]:r,...o}=t.styles??{},s=e.style?{...o,[e.id]:e.style}:o,{styles:i,...a}=t;return{state:Object.keys(s).length>0?{...a,styles:s}:a,inverse:{type:"set_style",id:e.id,style:n}}}case"set_region":{let n=t[e.region]??null,{[e.region]:r,...o}=t;return{state:e.blocks?{...o,[e.region]:e.blocks}:o,inverse:{type:"set_region",region:e.region,blocks:n}}}}}};function An(t,e){let n=t;for(let r of e)n=Mn.apply(n,r).state;return n}function Be(t,e){let n=J(t,e);if(!n)throw new S("not_found",`No block with id "${e}"`);return n}function en(t,e){return Be(t,e).block}function lt(t=T("b_")){return{id:t,type:"paragraph",runs:[]}}function ur(t){if(t.type!=="table")return{block:t.id,offset:0};let e=t.rows[0]?.cells[0]?.blocks[0];return e?{block:e.id,offset:0}:null}function Ws(t){if(t.type!=="table")return{block:t.id,offset:Ct(t)};let e=t.rows[t.rows.length-1]?.cells,n=e?.[e.length-1]?.blocks.at(-1);return n?{block:n.id,offset:Ct(n)}:null}function Vo(t,e,n){let r=e.slice(),o=new Set;for(let d of r)d.type==="delete_block"&&o.add(d.id);let s=t.blocks.filter(d=>d.type==="table"&&o.has(d.id)),i=new Set;for(let d of s)ie([d],i);let a=new Set;for(let d of t.blocks)if(!(d.type!=="table"||o.has(d.id)))for(let f of d.rows)for(let p of f.cells){if(p.covered||!p.blocks.every(y=>o.has(y.id)))continue;let h=p.blocks[p.blocks.length-1],g=r.findIndex(y=>y.type==="delete_block"&&y.id===h.id);g>=0&&r.splice(g,1),r.push({type:"replace_block",id:h.id,block:lt(h.id)}),o.delete(h.id),a.add(h.id)}let l=n,u=d=>o.has(d)||i.has(d);if(t.blocks.filter(d=>o.has(d.id)).length>=t.blocks.length){let d=lt();return r.push({type:"insert_block",block:d,after:null}),{ops:r,selection:U(d.id,0)}}if(u(l.anchor.block)||u(l.focus.block)){let{list:d,index:f}=Ve(t),p=f.get(l.focus.block)??0,h=y=>y.type!=="table"&&!u(y.id),g=d.slice(p).find(h)??[...d.slice(0,p)].reverse().find(h);l=g?U(g.id,0):l}return{ops:r,selection:l}}var qs=["bold","italic","underline","strike","superscript","subscript","color","highlight","fontFamily","fontSize"],Xf=16;function eo(t,e){if(e===void 0)return null;let n=t.styles,r=n?.[e];if(!n||!r)return null;let o=[],s=new Set;for(let a=e;a!==void 0&&o.length<Xf;){let l=n[a];if(!l||s.has(a)||l.kind!==r.kind)break;s.add(a),o.push(l),a=l.basedOn}let i={marks:{}};for(let a of o.reverse())i.marks={...i.marks,...a.marks},a.align&&(i.align=a.align),a.format&&(i.format={...i.format,...a.format});return i}function ka(t){return Te(t)?t.style:void 0}function Xs(t,e,n){if(!t.styles)return e??{};let r=eo(t,n),o=eo(t,e?.style);return!r&&!o?e??{}:{...r?.marks,...o?.marks,...e}}function Ut(t,e){if(!t.styles||!Te(e)||!e.style)return e;let n=eo(t,e.style);if(!n||!n.align&&!n.format)return e;let r=e,o=n.format||r.format?{...n.format,...r.format}:void 0,s=r.align??n.align;return{...e,...s&&{align:s},...o&&{format:o}}}function xc(t,e){let n=e.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,"")||"style",r=n;for(let o=2;t.styles?.[r];o++)r=`${n}-${o}`;return r}function Vs(t){let e=new Set,n=r=>{for(let o of r)if(o.type==="table"&&o.rows.forEach(s=>s.cells.forEach(i=>n(i.blocks))),"runs"in o){"style"in o&&o.style&&e.add(o.style);for(let s of o.runs)s.marks?.style&&e.add(s.marks.style)}};return n(t),e}function Vf(){return{id:T("c_"),blocks:[lt()]}}function Jf(t){return{id:T("r_"),cells:Array.from({length:t},Vf)}}function wa(t,e,n={}){let r=Math.max(1,Math.floor(t)),o=Math.max(1,Math.floor(e));return{id:T("b_"),type:"table",rows:Array.from({length:r},()=>Jf(o)),columns:at(Array.from({length:o},()=>1)),...n.headerRow&&{headerRow:!0},...n.borders&&{borders:n.borders}}}function kt(t,e){let n=bt(t,e);if(n){let{row1:o,row2:s,col1:i,col2:a}=n;return{table:n.table,row:o,col:i,rect:{row1:o,row2:s,col1:i,col2:a}}}let r=Be(t,e.focus.block);if(r.cell){let{table:o,row:s,col:i,cell:a}=r.cell;return{table:o,row:s,col:i,rect:Qt(a,s,i)}}if(r.block.type==="table"){let o=r.block;return{table:o,row:null,col:null,rect:{row1:0,row2:o.rows.length-1,col1:0,col2:o.columns.length-1}}}return null}function to(t,e,n){return{ops:[{type:"replace_block",id:t.id,block:e}],selection:U(n.block,n.offset)}}function dr(t,e,n){let r=Math.min(Math.max(e,0),t.rows.length-1),o=Math.min(Math.max(n,0),t.columns.length-1);return{block:Vr(t,r,o).cell.blocks[0].id,offset:0}}function Sa(t,e){return(n,r)=>{let o=kt(n,r);if(!o)return null;let{table:s,rect:i}=o,a=t==="above"?o.row===null?0:i.row1:o.row===null?s.rows.length:i.row2+1,l=Gs(s,a);return to(s,l,dr(l,a,e??o.col??0))}}function vc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let{table:o,rect:s}=r,i=t==="left"?r.col===null?0:s.col1:r.col===null?o.columns.length:s.col2+1,a=Hs(o,i);return to(o,a,dr(a,r.row??0,i))}}function Cc(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let{table:r,rect:o}=n;if(o.row1===0&&o.row2===r.rows.length-1)return Js()(t,e);let s=fc(r,o.row1,o.row2);return to(r,s,dr(s,o.row1,n.col??0))}}function Pc(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let{table:r,rect:o}=n;if(o.col1===0&&o.col2===r.columns.length-1)return Js()(t,e);let s=pc(r,o.col1,o.col2);return to(r,s,dr(s,n.row??0,o.col1))}}function Js(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let{table:r}=n,o=t.blocks.findIndex(l=>l.id===r.id),s=t.blocks[o-1],i=t.blocks[o+1],a=s&&Ws(s)||i&&ur(i)||null;return Vo(t,[{type:"delete_block",id:r.id}],a?U(a.block,a.offset):U(r.id,0))}}function Bc(){return(t,e)=>{let n=bt(t,e);if(!n)return null;let r=mc(n.table,n);return r?to(n.table,r,dr(r,n.row1,n.col1)):null}}function Oc(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let r=null;for(let{row:o,col:s}of lr(n.table,n.rect))r=hc(r??n.table,o,s)??r;return r?to(n.table,r,dr(r,n.rect.row1,n.rect.col1)):null}}function Mc(t){return(e,n)=>{let r=kt(e,n);if(!r||!!r.table.headerRow===t)return null;let{headerRow:o,...s}=r.table,i=t?{...s,headerRow:!0}:s;return{ops:[{type:"replace_block",id:r.table.id,block:i}],selection:n}}}function Ac(t){return(e,n)=>{let r=kt(e,n);if(!r||(r.table.borders??"all")===t)return null;let{borders:o,...s}=r.table,i=t==="all"?s:{...s,borders:t};return{ops:[{type:"replace_block",id:r.table.id,block:i}],selection:n}}}function Tc(t,e,n){let r=t.rows.map((o,s)=>({...o,cells:o.cells.map((i,a)=>s>=e.row1&&s<=e.row2&&a>=e.col1&&a<=e.col2&&!i.covered?n(i):i)}));return{...t,rows:r}}function Rc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let o=Tc(r.table,r.rect,s=>{let{shade:i,...a}=s;return t?{...a,shade:t}:a});return{ops:[{type:"replace_block",id:r.table.id,block:o}],selection:n}}}function Dc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let o=Tc(r.table,r.rect,s=>{let{vAlign:i,...a}=s;return t==="top"?a:{...a,vAlign:t}});return{ops:[{type:"replace_block",id:r.table.id,block:o}],selection:n}}}function Ec(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let o=t===null?null:Math.min(2e3,Math.max(6,t)),s=r.table.rows.map((i,a)=>{if(a<r.rect.row1||a>r.rect.row2)return i;let{height:l,...u}=i;return o===null?u:{...u,height:o}});return{ops:[{type:"replace_block",id:r.table.id,block:{...r.table,rows:s}}],selection:n}}}function _c(t){return(e,n)=>{let r=kt(e,n);if(!r||t.length!==r.table.columns.length)return null;let o=at(t);return{ops:[{type:"replace_block",id:r.table.id,block:{...r.table,columns:o}}],selection:n}}}function Nc(t,e,n){let r=Be(t,e.focus.block);if(!r.cell)return null;let{table:o,row:s,col:i}=r.cell,a=o.columns.length,l=o.rows.length*a;for(let u=s*a+i+n;u>=0&&u<l;u+=n){let c=Math.floor(u/a),d=u%a;if(!o.rows[c].cells[d].covered)return{to:dr(o,c,d)}}return n>0?{appendRow:!0}:null}var Tn="\u200B",Jo=t=>t.marks?.footnote;function Ze(t){let e=new Set,n=r=>{if(F(r))for(let o of r.runs){let s=Jo(o);s!==void 0&&e.add(s)}else if(r.type==="table")for(let o of r.rows)for(let s of o.cells)s.blocks.forEach(n)};return t.forEach(n),[...e]}function Zf(t){return new Map(Ze(t.blocks).map((e,n)=>[e,n+1]))}function Fc(t){if(!t.footnotes)return t;let e=new Set(Ze(t.blocks)),n=Object.keys(t.footnotes).filter(s=>e.has(s));if(n.length===Object.keys(t.footnotes).length)return t;let{footnotes:r,...o}=t;return n.length>0?{...o,footnotes:Object.fromEntries(n.map(s=>[s,t.footnotes[s]]))}:o}function $c(t){let e=[];for(let n of t)n.type==="heading"||n.type==="title"||n.type==="subtitle"?e.push({id:n.id,type:"paragraph",runs:n.runs.filter(r=>!Jo(r)),...n.align&&{align:n.align}}):F(n)&&e.push({...n,runs:n.runs.filter(r=>!Jo(r))});return e.length>0?e:[{id:T("b_"),type:"paragraph",runs:[]}]}function Ic(t){return t.type==="paragraph"||t.type==="quote"||t.type==="list_item"||t.type==="code_block"}function Lc(t,e){let n=new Map,r=a=>{let l=Jo(a);return l===void 0?a:(n.has(l)||n.set(l,T("fn_")),{...a,marks:{...a.marks,footnote:n.get(l)}})},o=a=>F(a)?{...a,runs:a.runs.map(r)}:a.type==="table"?{...a,rows:a.rows.map(l=>({...l,cells:l.cells.map(u=>({...u,blocks:u.blocks.map(o)}))}))}:a,s=t.map(o),i={};for(let[a,l]of n){let u=e?.[a];i[l]=(u??[{id:T("b_"),type:"paragraph",runs:[]}]).map(c=>({...c,id:T("b_")}))}return{blocks:s,notes:i}}var xa="\0self";function Zs(t){let e=Zf(t);if(e.size===0)return t;let n=o=>{let s=Jo(o);return s!==void 0&&e.has(s)?{...o,text:String(e.get(s))}:o},r=o=>F(o)?{...o,runs:o.runs.map(n)}:o.type==="table"?{...o,rows:o.rows.map(s=>({...s,cells:s.cells.map(i=>({...i,blocks:i.blocks.map(r)}))}))}:o;return{...t,blocks:t.blocks.map(r)}}var Rn={letter:{width:8.5,height:11,label:"Letter (8.5 \xD7 11 in)"},a4:{width:8.27,height:11.69,label:"A4 (210 \xD7 297 mm)"},legal:{width:8.5,height:14,label:"Legal (8.5 \xD7 14 in)"},a5:{width:5.83,height:8.27,label:"A5 (148 \xD7 210 mm)"}},va={size:"letter",orientation:"portrait",margins:{top:1,right:1,bottom:1,left:1}},Ca=96;function jt(t){return t.page??va}function fr(t){let{width:e,height:n}=Rn[t.size];return t.orientation==="landscape"?{width:n,height:e}:{width:e,height:n}}var Uc=36,Yf=4;function pr(t){return{count:Math.min(Yf,Math.max(1,Math.round(t?.count??1))),gap:t?.gap??Uc,rule:!!t?.rule}}function Pt(t){let e=[],n={from:0,to:t.blocks.length,columns:pr(t.page?.columns)};return t.blocks.forEach((r,o)=>{r.type==="section_break"&&(n.to=o,e.push(n),n={from:o+1,to:t.blocks.length,columns:pr(r.columns),start:r})}),e.push(n),e}function Pa(t,e){let n=Pt(t);for(let r=n.length-1;r>=0;r--){let o=n[r],s=o.start?o.from-1:0;if(e>=s)return o}return n[0]}function jc(t,e){let n=Pt(t);for(let r=n.length-1;r>=0;r--)if(e>=(n[r].start?n[r].from-1:0))return r;return 0}function no(t,e){return Pa(t,e).columns}function Zo(t){if(!(t.count<2))return{count:t.count,...t.gap!==Uc&&{gap:t.gap},...t.rule&&{rule:!0}}}function Ba(t,e,n){return n===0?!!t.page?.differentFirstPage:!!e[n]?.start?.differentFirstPage}function zt(t,e,n){let r=jt(t),o={size:r.size,orientation:r.orientation,margins:r.margins};for(let s=1;s<=Math.min(n,e.length-1);s++){let i=e[s].start?.page;i&&(o={size:i.size??o.size,orientation:i.orientation??o.orientation,margins:i.margins??o.margins})}return o}function Yo(t,e){return t.size===e.size&&t.orientation===e.orientation&&["top","right","bottom","left"].every(n=>t.margins[n]===e.margins[n])}function zc(t,e,n){return n===0?!1:e[n].start?.kind==="next_page"||!Yo(zt(t,e,n),zt(t,e,n-1))}function Oa(t,e,n={}){return{id:T("b_"),type:"image",src:t,...e,...n}}function Qo(t="continuous",e){return{id:T("b_"),type:"section_break",kind:t,...e&&e.count>1&&{columns:e}}}function Ma(){return{id:T("b_"),type:"page_break"}}function Aa(){return{id:T("b_"),type:"divider"}}function Ys(t,e=[]){return{id:T("doc_"),type:"document",title:t,blocks:e}}var Dn=["decimal","lower-alpha","upper-alpha","lower-roman","upper-roman"],tn=["disc","circle","square"];var Qf={disc:"\u2022",circle:"\u25E6",square:"\u25AA"};function He(t,e){let n=e%3;return t==="bullet"?tn[n]:["decimal","lower-alpha","lower-roman"][n]}function En(t){let e=t.list==="bullet"?tn:Dn;return t.marker&&e.includes(t.marker)?t.marker:He(t.list,t.depth)}function Gc(t){let e="";for(let n=t;n>0;n=Math.floor((n-1)/26))e=String.fromCharCode(97+(n-1)%26)+e;return e}function Hc(t){let e=[[1e3,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]],n="";for(let[r,o]of e)for(;t>=r;)n+=o,t-=r;return n}function Wc(t,e){if(t<1)return String(t);switch(e){case"lower-alpha":return Gc(t);case"upper-alpha":return Gc(t).toUpperCase();case"lower-roman":return Hc(t);case"upper-roman":return Hc(t).toUpperCase();default:return String(t)}}function ro(t){let e=[];return t.map(n=>{if(n.type!=="list_item"){e.length=0;return}if(e.length=n.depth+1,n.list==="bullet"){e[n.depth]=0;return}return e[n.depth]=n.start??(e[n.depth]??0)+1})}function es(t){let e=ro(t);return t.map((n,r)=>{if(n.type!=="list_item")return;let o=En(n);if(n.list==="bullet")return{text:Qf[o],marker:o};let s=e[r];return{text:`${Wc(s,o)}.`,marker:o,number:s}})}function Ta(t,e){let n=t[e];if(!n||n.type!=="list_item")return[];let r=s=>!!s&&s.type==="list_item"&&s.depth===n.depth&&s.list===n.list,o=[e];for(let s=e-1;s>=0;s--){let i=t[s];if(i.type!=="list_item"||i.depth<n.depth)break;if(i.depth===n.depth){if(!r(i))break;o.unshift(s)}}for(let s=e+1;s<t.length;s++){let i=t[s];if(i.type!=="list_item"||i.depth<n.depth)break;if(i.depth===n.depth){if(!r(i))break;o.push(s)}}return o}var Kc={i:1,v:5,x:10,l:50,c:100,d:500,m:1e3};function ep(t){let e=0;for(let n=0;n<t.length;n++){let r=Kc[t[n]];e+=r<(Kc[t[n+1]??""]??0)?-r:r}return e}function Qs(t){let e=/^[\(\[]?([^.)\]]+)[.)\]]/.exec(t)?.[1];if(!e)return null;if(/^\d+$/.test(e))return{marker:"decimal",number:Number(e)};let n=e===e.toLowerCase();if(/^[ivxlcdm]+$/i.test(e)&&(e.length>1||/^[ivx]$/i.test(e)))return{marker:n?"lower-roman":"upper-roman",number:ep(e.toLowerCase())};if(/^[a-z]+$/i.test(e)){let o=[...e.toLowerCase()].reduce((s,i)=>s*26+i.charCodeAt(0)-96,0);return{marker:n?"lower-alpha":"upper-alpha",number:o}}return null}function ts(t){if(/^[o○◦]$/.test(t))return"circle";if(/^[§▪■\uf0a7]$/.test(t))return"square"}var Xc=/(^#|#|%23)(heading(=|%3D)|h\.|_toc|__refheading|bookmark(=|%3D)|toc|_ref|id\.)/i,tp=/^\s*(table of )?contents\s*$/i,np=/^[\s .·•…_\-–—\d]*$/;function qc(t){if(t.type!=="paragraph"&&t.type!=="list_item")return!1;let e=t.runs.filter(o=>o.marks?.link&&Xc.test(Vc(o.marks.link)));if(e.length===0||e.map(o=>o.text).join("").trim()==="")return!1;let r=t.runs.filter(o=>!e.includes(o)).map(o=>o.text).join("");return np.test(r)}function Vc(t){try{return decodeURIComponent(t)}catch{return t}}function Jc(t){return rp(op(t))}function rp(t){let e=n=>n.map(r=>{let o=r.marks?.link;if(!o||!(o.startsWith("#")||Xc.test(Vc(o))))return r;let{link:s,...i}=r.marks;return Object.keys(i).length>0?{...r,marks:i}:{text:r.text}});return t.map(n=>n.type==="table"||!("runs"in n)||!n.runs.some(r=>r.marks?.link)?n:{...n,runs:ce(e(n.runs))})}function op(t){let e=[];for(let n=0;n<t.length;n++){let r=t[n];if(!qc(r)){e.push(r);continue}let o=n;for(;o+1<t.length&&qc(t[o+1]);)o++;let s=t.slice(n,o+1),i=e[e.length-1],a=!!i&&(i.type==="paragraph"||i.type==="heading")&&tp.test(H(i.runs));if(s.length<2&&!a){e.push(r);continue}let l=new Set(s.map(d=>("format"in d?d.format?.indentLeft??0:0)+("depth"in d?d.depth*36:0))),u=Math.min(6,Math.max(1,l.size)),c="";a&&(c=H(i.runs).trim(),e.pop()),e.push({id:T("b_"),type:"toc",levels:u,title:c}),n=o}return e}function ei(t){let e={},n=0,r="",o=0,s=i=>{let a=t.slice(o,i),l=a.indexOf(":");if(l>0){let u=a.slice(0,l).trim().toLowerCase(),c=a.slice(l+1).replace(/!important/gi,"").trim();u&&c&&(e[u]=c)}o=i+1};for(let i=0;i<t.length;i++){let a=t[i];r?a===r&&t[i-1]!=="\\"&&(r=""):a==='"'||a==="'"?r=a:a==="("?n++:a===")"?n=Math.max(0,n-1):a===";"&&n===0&&s(i)}return s(t.length),e}function Yc(t){let e=[],n=t.replace(/\/\*[\s\S]*?\*\//g,"").replace(/<!--|-->/g,""),r=/([^{}]+)\{([^{}]*)\}/g;for(let o=r.exec(n);o;o=r.exec(n)){let s=o[1].trim();if(s.startsWith("@"))continue;let i=ei(o[2]);for(let a of s.split(",")){let l=a.trim(),u=/^([a-zA-Z][a-zA-Z0-9]*)?((?:\.[\w-]+)*)(#[\w-]+)?$/.exec(l);if(!u||!l)continue;let c=u[2]?u[2].split(".").filter(Boolean):[];e.push({selector:{tag:u[1]?.toLowerCase(),classes:c,id:u[3]?.slice(1)},specificity:(u[3]?100:0)+c.length*10+(u[1]?1:0),declarations:i})}}return e}function Qc(t,e,n,r){let{selector:o}=t;return o.tag&&o.tag!==e||o.id&&o.id!==r?!1:o.classes.every(s=>n.includes(s))}var Zc={black:"#000000",white:"#ffffff",red:"#ff0000",green:"#008000",blue:"#0000ff",yellow:"#ffff00",orange:"#ffa500",purple:"#800080",gray:"#808080",grey:"#808080",silver:"#c0c0c0",maroon:"#800000",navy:"#000080",teal:"#008080",olive:"#808000",lime:"#00ff00",aqua:"#00ffff",cyan:"#00ffff",fuchsia:"#ff00ff",magenta:"#ff00ff",brown:"#a52a2a",pink:"#ffc0cb",gold:"#ffd700",coral:"#ff7f50",crimson:"#dc143c",indigo:"#4b0082",violet:"#ee82ee",turquoise:"#40e0d0",tan:"#d2b48c"},Ra=t=>Math.max(0,Math.min(255,Math.round(t))).toString(16).padStart(2,"0");function oo(t){if(!t)return null;let e=t.trim().toLowerCase();if(e in Zc)return Zc[e];let n=/^#([0-9a-f]{3})$/.exec(e);if(n)return`#${[...n[1]].map(r=>r+r).join("")}`;if(n=/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(e),n)return`#${n[1]}`;if(n=/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(e),n){let r=s=>s.endsWith("%")?parseFloat(s)/100*255:parseFloat(s);return(n[4]===void 0?1:n[4].endsWith("%")?parseFloat(n[4])/100:parseFloat(n[4]))===0?null:`#${Ra(r(n[1]))}${Ra(r(n[2]))}${Ra(r(n[3]))}`}return null}var sp={pt:1,px:.75,in:72,cm:28.3465,mm:2.83465,pc:12,q:.7087};function so(t){if(!t)return null;let e=/^([\d.]+)\s*(pt|px|in|cm|mm|pc|q)$/.exec(t.trim().toLowerCase());if(!e)return null;let n=parseFloat(e[1])*sp[e[2]];return Number.isFinite(n)?n:null}var ip={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",ensp:"\u2002",emsp:"\u2003",thinsp:"\u2009",copy:"\xA9",reg:"\xAE",trade:"\u2122",hellip:"\u2026",mdash:"\u2014",ndash:"\u2013",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",sbquo:"\u201A",bdquo:"\u201E",laquo:"\xAB",raquo:"\xBB",bull:"\u2022",middot:"\xB7",deg:"\xB0",plusmn:"\xB1",times:"\xD7",divide:"\xF7",frac12:"\xBD",frac14:"\xBC",frac34:"\xBE",euro:"\u20AC",pound:"\xA3",yen:"\xA5",cent:"\xA2",sect:"\xA7",para:"\xB6",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193",harr:"\u2194",le:"\u2264",ge:"\u2265",ne:"\u2260",asymp:"\u2248",infin:"\u221E",check:"\u2713",eacute:"\xE9",egrave:"\xE8",agrave:"\xE0",aacute:"\xE1",uuml:"\xFC",ouml:"\xF6",auml:"\xE4",ntilde:"\xF1",ccedil:"\xE7",szlig:"\xDF",iexcl:"\xA1",iquest:"\xBF"};function io(t){return t.includes("&")?t.replace(/&(?:#(\d{1,10})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,8}));?/g,(e,n,r,o)=>{if(n!==void 0||r!==void 0){let i=n!==void 0?Number(n):parseInt(r,16);return i>1114111||i>=55296&&i<=57343||i<32&&i!==9&&i!==10&&i!==13||i===0?"\uFFFD":String.fromCodePoint(i)}let s=ip[o];return s===void 0?e:e.endsWith(";")||["amp","lt","gt","quot","nbsp","copy","reg"].includes(o)?s:e}):t}var ap=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]),lp=new Set(["script","style","textarea","title","xmp"]),tu=new Set(["address","article","aside","blockquote","details","dialog","div","dl","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","hr","main","menu","nav","ol","p","pre","section","table","ul"]),cp=tu,up=256,eu=4e5;function dp(t){let e={},n=/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;for(let r=n.exec(t);r;r=n.exec(t)){let o=r[1].toLowerCase();o in e||(e[o]=io(r[2]??r[3]??r[4]??""))}return e}function nu(t){let e={kind:"el",tag:"#root",attrs:{},children:[]},n=[e],r=0,o=0,s=t.length,i=()=>n[n.length-1],a=d=>{if(d===""||r>eu)return;let f=i(),p=f.children[f.children.length-1];p?.kind==="text"?p.text+=d:f.children.push({kind:"text",text:d}),r++},l=d=>{for(let f=n.length-1;f>0;f--)if(n[f].tag===d){n.length=f;return}},u=(d,f)=>{for(let p=n.length-1;p>0;p--){if(n[p].tag===d)return!0;if(f.includes(n[p].tag))return!1}return!1},c=d=>{if(cp.has(d)&&u("p",["div","td","th","li","blockquote","table","body"])&&l("p"),d==="li"&&u("li",["ul","ol"])&&l("li"),(d==="td"||d==="th")&&(u("td",["tr","table"])||u("th",["tr","table"]))&&l(u("td",["tr","table"])?"td":"th"),d==="tr"&&((u("td",["table"])||u("th",["table"]))&&l(u("td",["tr","table"])?"td":"th"),u("tr",["table"])&&l("tr")),["thead","tbody","tfoot"].includes(d)){for(let f of["thead","tbody","tfoot"])u(f,["table"])&&l(f);u("tr",["table"])&&l("tr")}(d==="dt"||d==="dd")&&(u("dt",["dl"])||u("dd",["dl"]))&&l(u("dd",["dl"])?"dd":"dt")};for(;o<s;){let d=t.indexOf("<",o);if(d<0){a(io(t.slice(o)));break}if(d>o&&a(io(t.slice(o,d))),o=d,t.startsWith("<!--",o)){let A=t.indexOf("-->",o+4);o=A<0?s:A+3;continue}if(t[o+1]==="!"||t[o+1]==="?"){let A=t.indexOf(">",o+2);o=A<0?s:A+1;continue}let f=t[o+1]==="/",p=o+(f?2:1),h=/^[a-zA-Z][^\s/>]*/.exec(t.slice(p,p+64));if(!h){a("<"),o++;continue}let g=h[0].toLowerCase(),y=t.indexOf(">",p+h[0].length);if(y<0){a(io(t.slice(o)));break}if(f){l(g),o=y+1;continue}let b=y,w=p+h[0].length,O="";for(let A=w;A<s;A++){let $=t[A];if(O)$===O&&(O="");else if($==='"'||$==="'")O=$;else if($===">"){b=A;break}}let _=t.slice(w,b),M=_.trimEnd().endsWith("/");o=b+1,c(g);let R={kind:"el",tag:g,attrs:dp(_),children:[]};if(!(r++>eu)){if(i().children.push(R),lp.has(g)){let A=t.toLowerCase().indexOf(`</${g}`,o),$=A<0?t.slice(o):t.slice(o,A);$&&R.children.push({kind:"text",text:g==="textarea"||g==="title"?io($):$});let P=A<0?-1:t.indexOf(">",A);o=P<0?s:P+1;continue}ap.has(g)||M||n.length<up&&n.push(R)}}return e}function ru(t){return tu.has(t)}function ns(t){return t.kind==="text"?t.text:t.tag==="br"?`
`:t.children.map(ns).join("")}var ou=2e4,fp=500,su=40,pp=40,uu=new Set(["head","script","style","title","meta","link","noscript","template","iframe","object","embed","svg","canvas","video","audio","select","button","input","textarea","map","math","base","datalist","dialog"]),mp={1:20,2:16,3:14,4:12,5:11,6:11},hp=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-sans-serif","ui-serif","ui-monospace","ui-rounded","inherit","initial","unset","-apple-system","blinkmacsystemfont","emoji","math","fangsong"]),gp=[0,7.5,10,12,13.5,18,24,36],yp=t=>{let e=t?.trim();return e&&(/^(https?:|mailto:|tel:)/i.test(e)||/^#.+/.test(e))&&e.length<=2048?e:void 0},bp=t=>{let e=t?.trim();if(e){if(/^https?:\/\//i.test(e)&&e.length<=4096)return e;if(/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(e)&&e.length<=8e6)return e.replace(/\s+/g,"")}};function os(t){let e=n=>{let r=parseInt(t.slice(1+n*2,3+n*2),16)/255;return r<=.03928?r/12.92:((r+.055)/1.055)**2.4};return .2126*e(0)+.7152*e(1)+.0722*e(2)}function du(t){let e=oo(t["background-color"]);if(e)return e;let n=t.background?.trim().split(/\s+(?![^()]*\))/)[0];return n?oo(n):null}function kp(t){if(!t)return;let e=t.trim().toLowerCase();if(e==="bold"||e==="bolder")return!0;if(e==="normal"||e==="lighter")return!1;let n=parseInt(e,10);return Number.isFinite(n)?n>=600:void 0}function fu(t){let e=t?.trim().toLowerCase();if(e==="center"||e==="right"||e==="justify")return e}function Ea(t){if(t)for(let e of t.replace(/!\s*important/gi,"").split(",")){let n=e.trim().replace(/^["']|["']$/g,"").replace(/[^\p{L}\p{N} _-]/gu,"").replace(/\s+/g," ").trim();if(n&&!hp.has(n.toLowerCase())){let r=It(n);return(r&&r.family.toLowerCase()===n.toLowerCase()?r.family:n).slice(0,64)}}}function wp(t){let e=t&&/(?:^|\s)(?:\d*\.?\d+(?:px|pt|em|rem|%|ex|ch|cm|mm|in|pc|vw|vh)|(?:xx?-)?(?:small|large)|xxx-large|medium|smaller|larger)(?:\/\S+)?\s+(.+)$/i.exec(t.trim());return e?Ea(e[1]):void 0}var Sp=(t,e)=>"hidden"in e.attrs||t.display?.trim().toLowerCase()==="none"||t.visibility?.trim().toLowerCase()==="hidden"||t["mso-hide"]?.trim().toLowerCase()==="all",ss=class{constructor(e,n,r=!1,o=!1){this.rules=e;this.options=n;this.inCell=r;this.inline=o;se(this,"blocks",[]);se(this,"unsized",[]);se(this,"buffer",null);se(this,"kinds",[{type:"paragraph"}]);se(this,"lists",[]);se(this,"marker",null);se(this,"floats",[]);se(this,"anchored",[])}declarations(e){let n=(e.attrs.class??"").split(/\s+/).filter(Boolean),r=this.rules.filter(s=>Qc(s,e.tag,n,e.attrs.id)).sort((s,i)=>s.specificity-i.specificity),o={};for(let s of r)Object.assign(o,s.declarations);return e.attrs.style&&Object.assign(o,ei(e.attrs.style)),o}styleFor(e,n,r){let o={...n.marks},s=n.link,i=n.align,a=n.white;switch(e.tag){case"b":case"strong":o.bold=!0;break;case"i":case"em":case"cite":case"dfn":case"var":o.italic=!0;break;case"u":case"ins":o.underline=!0;break;case"s":case"strike":case"del":o.strike=!0;break;case"code":case"kbd":case"samp":case"tt":o.code=!0;break;case"sup":o.superscript=!0,o.subscript=null;break;case"sub":o.subscript=!0,o.superscript=null;break;case"mark":o.highlight="#ffff00";break;case"a":s=yp(e.attrs.href)??s;break;case"center":i="center";break;case"font":{let _=Ea(e.attrs.face);_&&(o.fontFamily=_);let M=oo(e.attrs.color);M&&(o.color=M);let R=gp[Number(e.attrs.size)];R&&(o.fontSize=R);break}}let l=kp(r["font-weight"]);l!==void 0&&(o.bold=l?!0:null);let u=r["font-style"]?.trim().toLowerCase();u&&(o.italic=u==="italic"||u==="oblique"?!0:u==="normal"?null:o.italic);let c=(r["text-decoration-line"]??r["text-decoration"]??"").toLowerCase();c&&e.tag!=="a"&&(o.underline=c.includes("underline")?!0:c.includes("none")?null:o.underline,o.strike=c.includes("line-through")?!0:c.includes("none")?null:o.strike);let d=oo(r.color);d?o.color=os(d)>.75||d==="#000000"?null:d:r.color&&/^(inherit|initial|unset|windowtext|currentcolor)$/i.test(r.color.trim())&&(o.color=null);let f=du(r);f&&(o.highlight=os(f)>.9||os(f)<.1?null:f);let p=Ea(r["font-family"])??wp(r.font);p&&(o.fontFamily=p);let h=so(r["font-size"]);h&&h>0&&h<=400&&(o.fontSize=Math.round(h*2)/2);let g=r["vertical-align"]?.trim().toLowerCase();g==="super"?(o.superscript=!0,o.subscript=null):g==="sub"?(o.subscript=!0,o.superscript=null):g==="baseline"&&(o.superscript=null,o.subscript=null);let y=r["text-align"]??e.attrs.align;y&&(i=fu(y)??(/^(left|start)$/i.test(y.trim())?void 0:i));let b=r["white-space"]?.trim().toLowerCase();e.tag==="pre"||b==="pre"||b==="pre-wrap"||b==="break-spaces"?a="pre":b==="pre-line"?a="pre-line":(b==="normal"||b==="nowrap")&&(a="normal");let w=so(r["margin-left"]??r["padding-left"]),O=w&&w>0&&w<=720&&!/^(blockquote|li|ul|ol|td|th)$/.test(e.tag)?(n.indent??0)+w:n.indent;return{marks:o,white:a,align:i,link:s,indent:O}}marksFor(e,n){let r={};for(let[o,s]of Object.entries(e.marks))s==null||s===!1||(r[o]=s);return e.link&&(r.link=e.link),r.fontSize===this.options.defaultFontSize&&delete r.fontSize,n!==null&&(delete r.bold,r.fontSize===mp[n]&&delete r.fontSize),r.fontFamily&&r.fontFamily.toLowerCase()===this.options.defaultFontFamily.toLowerCase()&&delete r.fontFamily,Object.keys(r).length>0?r:void 0}get kind(){return this.kinds[this.kinds.length-1]}add(e){this.blocks.length<ou&&this.blocks.push(e)}addText(e,n){let r=e.replace(/\r\n?/g,`
`);n.white==="normal"?r=r.replace(/[ \t\n\f]+/g," "):n.white==="pre-line"&&(r=r.replace(/[ \t\f]+/g," "));let o=this.buffer;if(n.white!=="pre"&&!this.inline&&r.startsWith(" ")&&(!o||o.endsInSpace||o.runs.length===0)&&(r=r.slice(1)),r==="")return;let s=o??this.open(n),i=s.kind.type==="heading"?s.kind.level:null;s.runs.push({text:r.replace(/ /g," "),marks:this.marksFor(n,i)}),s.endsInSpace=n.white!=="pre"&&r.endsWith(" ")}open(e){return this.buffer={kind:this.kind,align:e.align,indent:e.indent,runs:[],endsInSpace:!this.inline},this.buffer}flush(e=!1){let n=this.buffer;this.buffer=null;for(let o of this.anchored.splice(0))this.add(o);if(!n&&!e)return!1;let r=n?ce(this.inline?n.runs:xp(n.runs)):[];return r.length===0&&!e?!1:(this.add(au(n?.kind??this.kind,r,n?.align,n?.indent)),!0)}block(e,n,r){this.flush();let o=this.blocks.length;this.buffer=null,n(),this.flush(),r&&this.blocks.length===o&&this.add(au(this.kind,[],e.align,e.indent))}walk(e,n){if(!(this.blocks.length>=ou)&&e!==this.marker){if(e.kind==="text"){this.addText(e.text,n);return}this.element(e,n)}}children(e,n,r){r&&(this.marker=r);for(let o of e.children)o!==r&&this.walk(o,n)}breakAround(e,n){let r=i=>!!i&&/^(always|page|left|right|recto|verso)$/.test(i.trim().toLowerCase()),o=(n["mso-break-type"]??"").trim().toLowerCase()==="section-break",s=r(n["page-break-before"])||r(n["break-before"])||/\bpage-?break\b/i.test(e.attrs.class??"");return{before:o?"section_break":s?"page_break":null,after:r(n["page-break-after"])||r(n["break-after"])?"page_break":null,kind:s?"next_page":"continuous"}}addBreak_(e,n){if(this.inCell)return;this.flush();let r=this.blocks[this.blocks.length-1];!r||r.type==="page_break"||r.type==="section_break"||this.add(e==="page_break"?{id:T("b_"),type:"page_break"}:{id:T("b_"),type:"section_break",kind:n})}element(e,n){if(uu.has(e.tag))return;let r=this.declarations(e),o=this.breakAround(e,r);o.before&&this.addBreak_(o.before,o.kind);let s=r.float==="left"||r.float==="right"?r.float:(e.attrs.align==="left"||e.attrs.align==="right")&&e.tag==="img"?e.attrs.align:null;this.floats.push(s),this.elementInner(e,n,r,(e.tag==="hr"||e.tag==="br")&&(o.before!==null||o.after!==null)),this.floats.pop(),o.after&&this.addBreak_(o.after,"next_page")}elementInner(e,n,r,o){if(o||Sp(r,e))return;let s=this.styleFor(e,n,r);switch(e.tag){case"br":this.addBreak(s);return;case"hr":this.flush(),this.add({id:T("b_"),type:"divider"});return;case"img":this.image(e,r);return;case"table":this.flush(),this.table(e,s);return;case"pre":this.flush(),this.code(e);return;case"h1":case"h2":case"h3":case"h4":case"h5":case"h6":{this.kinds.push({type:"heading",level:Number(e.tag[1])}),this.block(s,()=>this.children(e,s),!0),this.kinds.pop();return}case"blockquote":this.kinds.push({type:"quote"}),this.block(s,()=>this.children(e,s),!1),this.kinds.pop();return;case"ul":case"ol":{this.flush();let i=e.tag==="ol"?"ordered":"bullet",a=Number.parseInt(e.attrs.start??"",10);this.lists.push({list:i,...Da(i,r["list-style-type"]??r["list-style"],e.attrs.type)&&{marker:Da(i,r["list-style-type"]??r["list-style"],e.attrs.type)},start:Number.isInteger(a)&&a>=0&&a<=99999?a:1,first:!0}),this.children(e,s),this.flush(),this.lists.pop();return}case"li":{let i=this.lists[this.lists.length-1],a=Number.parseInt(e.attrs.value??"",10),l=Da(i?.list??"bullet",r["list-style-type"]??r["list-style"],void 0),u=i?.list==="ordered"?Number.isInteger(a)&&a>=0&&a<=99999?a:i.first?i.start:void 0:void 0;i&&(i.first=!1);let c=l??i?.marker;this.kinds.push({type:"list_item",list:i?.list??"bullet",depth:Math.max(0,this.lists.length-1),...c&&{marker:c},...u!==void 0&&{start:u}}),this.block(s,()=>this.children(e,s),!0),this.kinds.pop();return}case"p":{let i=this.wordList(e,r);if(i){this.kinds.push({type:"list_item",list:i.list,depth:i.depth,...i.style&&{marker:i.style},...i.start!==void 0&&{start:i.start}}),this.block(s,()=>this.children(e,s,i.marker),!0),this.kinds.pop();return}let a=/(?:^|\s)Mso(Title|Subtitle|Quote|IntenseQuote)(?:\s|$)/.exec(e.attrs.class??"")?.[1];if(a){this.kinds.push({type:a==="Title"?"title":a==="Subtitle"?"subtitle":"quote"}),this.block(s,()=>this.children(e,s),!0),this.kinds.pop();return}this.block(s,()=>this.children(e,s),!0);return}case"div":case"section":case"article":case"header":case"footer":case"main":case"aside":case"nav":case"figure":case"figcaption":case"form":case"fieldset":case"address":case"details":case"summary":case"center":case"dl":case"dt":case"dd":case"caption":case"hgroup":case"menu":{let i=this.wordList(e,r);if(i){this.kinds.push({type:"list_item",list:i.list,depth:i.depth,...i.style&&{marker:i.style},...i.start!==void 0&&{start:i.start}}),this.block(s,()=>this.children(e,s,i.marker),!0),this.kinds.pop();return}this.block(s,()=>this.children(e,s),!1);return}default:this.children(e,s)}}addBreak(e){let n=this.buffer??this.open(e);n.runs.push({text:`
`,marks:void 0}),n.endsInSpace=!0}wordList(e,n){let r=n["mso-list"];if(!r||/^\s*(none|ignore)/i.test(r))return null;let o=/level(\d+)/i.exec(r)?.[1];if(!o)return null;let s=d=>{for(let f of d.children){if(f.kind!=="el")continue;if(/ignore/i.test(ei(f.attrs.style??"")["mso-list"]??""))return f;let p=s(f);if(p)return p}},i=s(e),a=i?ns(i).replace(/[\s ]+/g,""):"",l=/^[\(\[]?(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)\]]/.test(a),u=Math.min(8,Math.max(0,Number(o)-1));if(!l)return{depth:u,list:"bullet",marker:i,...ts(a)&&{style:ts(a)}};let c=Qs(a);return{depth:u,list:"ordered",marker:i,...c&&{style:c.marker,start:c.number}}}code(e){let n=ns(e).replace(/\r\n?/g,`
`).replace(/^\n/,"").replace(/\n+$/,"");if(n=n.replace(/ /g," "),n.trim()==="")return;let r=e.children.find(s=>s.kind==="el"&&s.tag==="code"),o=/(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(`${e.attrs.class??""} ${r?.attrs.class??""}`)?.[1];this.add({id:T("b_"),type:"code_block",runs:[{text:n}],...o&&{language:o.slice(0,24)}})}image(e,n){let r=bp(e.attrs.src);if(!r)return;let o=c=>{if(!c)return null;let d=/^[\d.]+$/.test(c.trim()),f=so(d?`${c.trim()}${e.attrs["v:shapes"]!==void 0?"pt":"px"}`:c);return f&&f>0?Math.round(f*4/3):null},s=o(n.width??e.attrs.width),i=o(n.height??e.attrs.height),a=s!==null&&i!==null,l={id:T("b_"),type:"image",src:r,width:Math.min(4e3,s??300),height:Math.min(4e3,i??200),...e.attrs.alt&&{alt:e.attrs.alt.slice(0,500)}},u=[...this.floats].reverse().find(c=>c!==null);u&&(l.wrap=u),!(this.inCell&&l.type!=="image")&&(l.wrap&&this.buffer&&this.buffer.runs.length>0?this.anchored.push(l):(this.flush(),this.add(l)),a||this.unsized.push(l.id))}table(e,n){let r=Cp(e,this.rules,this.options,this.declarations(e));if(r){if(this.inCell){for(let o of r.rows){let s=o.cells.filter(i=>!i.covered).map(i=>i.blocks.map(a=>"runs"in a?a.runs.map(l=>l.text).join(""):"").join(" ")).join("  ");s.trim()&&this.add({id:T("b_"),type:"paragraph",runs:[{text:s}],...n.align&&{align:n.align}})}return}this.add(r)}}};function xp(t){let e=t.slice();for(;e.length>0;){let n=e[e.length-1],r=n.text.replace(/[ \n]+$/,"");if(r==="")e.pop();else{e[e.length-1]={...n,text:r};break}}return e}function Da(t,e,n){let r=(e??"").toLowerCase().split(/\s+/).find(s=>s in iu),o=r?iu[r]:n?vp[n]:void 0;return o&&(t==="bullet"?tn:Dn).includes(o)?o:void 0}var iu={decimal:"decimal","lower-alpha":"lower-alpha","lower-latin":"lower-alpha","upper-alpha":"upper-alpha","upper-latin":"upper-alpha","lower-roman":"lower-roman","upper-roman":"upper-roman",disc:"disc",circle:"circle",square:"square"},vp={1:"decimal",a:"lower-alpha",A:"upper-alpha",i:"lower-roman",I:"upper-roman"};function ti(t){let e=[];return t.map(n=>{if(n.type==="table")return e.length=0,{...n,rows:n.rows.map(o=>({...o,cells:o.cells.map(s=>({...s,blocks:ti(s.blocks)}))}))};if(n.type!=="list_item")return e.length=0,n;if(e.length=n.depth+1,n.list==="bullet")return e[n.depth]=0,n;let r=(e[n.depth]??0)+1;if(e[n.depth]=n.start??r,n.start===r){let{start:o,...s}=n;return s}return n})}function au(t,e,n,r){let s={id:T("b_"),runs:e,...n&&{align:n},...r&&t.type!=="list_item"&&{format:{indentLeft:Math.round(r*100)/100}}};switch(t.type){case"heading":return{...s,type:"heading",level:t.level};case"quote":return{...s,type:"quote"};case"title":return{...s,type:"title"};case"subtitle":return{...s,type:"subtitle"};case"list_item":{let i=t.marker&&t.marker!==He(t.list,t.depth)?t.marker:void 0;return{...s,type:"list_item",list:t.list,depth:t.depth,...i&&{marker:i},...t.start!==void 0&&t.list==="ordered"&&{start:t.start}}}default:return{...s,type:"paragraph"}}}var lu=()=>({id:T("b_"),type:"paragraph",runs:[]});function cu(t){if(!t)return null;let e=t.trim().toLowerCase(),n=/^([\d.]+)%$/.exec(e);if(n)return{amount:parseFloat(n[1]),percent:!0};let r=so(/^[\d.]+$/.test(e)?`${e}px`:e);return r?{amount:r*4/3,percent:!1}:null}function rs(t,e,n,r=[]){for(let o of t.children)o.kind==="el"&&(e.has(o.tag)?r.push(o):n.has(o.tag)||rs(o,e,n,r));return r}function Cp(t,e,n,r){let o=new ss(e,n,!0),s=v=>o.declarations(v),i=rs(t,new Set(["tr"]),new Set(["table"])).filter(v=>!("hidden"in v.attrs)&&s(v).display?.trim()!=="none"),a=Math.min(i.length,fp);if(a===0)return null;let l=Array.from({length:a},()=>[]),u=[],c=0;if(i.slice(0,a).forEach((v,N)=>{let L=0;for(let q of rs(v,new Set(["td","th"]),new Set(["table","tr"]))){for(;l[N][L];)L++;if(L>=su)break;let Z=Y=>Math.max(1,Math.min(pp,parseInt(q.attrs[Y]??"1",10)||1)),X=Math.min(Z("rowspan"),a-N),V=Math.min(Z("colspan"),su-L);for(let Y=N;Y<N+X;Y++)for(let de=L;de<L+V;de++)l[Y][de]=!0;u.push({el:q,row:N,col:L,rowSpan:X,colSpan:V}),c=Math.max(c,L+V),L+=V}}),u.length===0||c===0)return null;let d=Array.from({length:a},()=>Array.from({length:c},()=>null)),f={value:!1};for(let v of u){let N=s(v.el),L=new ss(e,n,!0),q={marks:{},white:"normal",align:fu(N["text-align"]??v.el.attrs.align)},Z=L.styleFor(v.el,q,N);for(let we of v.el.children)L.walk(we,Z);L.flush();let X=L.blocks.filter(we=>we.type!=="table"&&we.type!=="toc"&&we.type!=="page_break");for(;X.length>1&&X[X.length-1].type==="paragraph"&&X[X.length-1].runs.length===0;)X.pop();let V={id:T("c_"),blocks:X.length>0?X:[lu()]},Y=du(N)??oo(v.el.attrs.bgcolor);Y&&os(Y)<.97&&os(Y)>.05&&(V.shade=Y);let de=(N["vertical-align"]??v.el.attrs.valign??"").trim().toLowerCase();de==="middle"||de==="center"?V.vAlign="middle":de==="bottom"&&(V.vAlign="bottom"),v.rowSpan>1&&(V.rowSpan=v.rowSpan),v.colSpan>1&&(V.colSpan=v.colSpan);for(let we of Object.keys(N))we.startsWith("border")&&!/^(none|0|0px|hidden)$/i.test(N[we].trim().split(/\s+/)[0]??"")&&(f.value=!0);d[v.row][v.col]=V;for(let we=v.row;we<v.row+v.rowSpan;we++)for(let Pe=v.col;Pe<v.col+v.colSpan;Pe++)(we!==v.row||Pe!==v.col)&&(d[we][Pe]={id:T("c_"),blocks:[],covered:!0})}let p=d.map((v,N)=>{let L=s(i[N]),q={id:T("r_"),cells:v.map(X=>X??{id:T("c_"),blocks:[lu()]})},Z=so(L.height??(i[N].attrs.height?`${i[N].attrs.height}px`:void 0));return Z&&Z>=6&&Z<=2e3&&(q.height=Math.round(Z*2)/2),q}),h=rs(t,new Set(["col"]),new Set(["table"])),g=Array.from({length:c},()=>null),y=0;for(let v of h){let N=Math.max(1,parseInt(v.attrs.span??"1",10)||1),L=cu(s(v).width??v.attrs.width);for(let q=0;q<N&&y<c;q++)g[y++]=L}if(!g.some(v=>v!==null))for(let v of u)v.row===0&&v.colSpan===1&&(g[v.col]=cu(s(v.el).width??v.el.attrs.width));let b=g.some(v=>v?.percent),w=g.filter(v=>!!v&&v.percent===b),O=w.length>0?w.reduce((v,N)=>v+N.amount,0)/w.length:1,_=at(g.map(v=>v&&v.percent===b&&v.amount>0?v.amount:O)),M=u.filter(v=>v.row===0),R=rs(t,new Set(["thead"]),new Set(["table"])).length>0,A=M.length>0&&(M.every(v=>v.el.tag==="th")||R&&a>1),$=(r["border-style"]??r.border??"").trim().toLowerCase(),P=!f.value&&(t.attrs.border==="0"||/^(none|0|hidden)/.test($)||t.attrs.border===void 0&&!$),B={id:T("b_"),type:"table",rows:p,columns:_,...A&&{headerRow:!0},...P&&t.attrs.border==="0"&&{borders:"none"}};return Cn(B)?null:B}function pu(t,e={}){let n={defaultFontSize:e.defaultFontSize??11,defaultFontFamily:e.defaultFontFamily??"Arial"},r=nu(t),o=[],s=f=>{for(let p of f.children)p.kind==="el"&&(p.tag==="style"?o.push(ns(p)):s(p))};s(r);let i=Yc(o.join(`
`)),a=f=>f.children.some(p=>p.kind==="el"&&!uu.has(p.tag)&&(ru(p.tag)||p.tag==="li"||p.tag==="img"||a(p))),l=new ss(i,n,!1,!a(r)),u={marks:{},white:"normal"};for(let f of r.children)l.walk(f,u);l.flush();let c=ti(Jc(l.blocks.slice())),d=f=>f.type==="paragraph"&&f.runs.every(p=>p.text.trim()==="");for(;c.length>0&&d(c[0]);)c.shift();for(;c.length>0&&d(c[c.length-1]);)c.pop();return{blocks:c,unsizedImages:l.unsized.filter(f=>c.some(p=>p.id===f))}}var Pp=8e6,Bp=2e4,Op=64,Mp="\u20AC\x81\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\x8D\u017D\x8F\x90\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\x9D\u017E\u0178",Ap=new Set(["fonttbl","colortbl","stylesheet","info","pict","header","footer","headerl","headerr","footerl","footerr","listtable","listoverridetable","expandedcolortbl","rsidtbl","generator","themedata","colorschememapping","latentstyles","datastore","xmlnstbl","fldinst","private","object","falt","panose"]);function mu(t){if(t.length>Pp||!/^\s*\{\\rtf/.test(t))return[];let e=new Map,n=[],r=[],o={bold:!1,italic:!1,underline:!1,strike:!1,superscript:!1,subscript:!1,skip:!1,uc:1},s=[],i={list:!1,depth:0},a=[],l="",u=0,c=null,d=0,f=-1,p={r:-1,g:-1,b:-1},h="",g=0,y=()=>{let R={};o.bold&&(R.bold=!0),o.italic&&(R.italic=!0),o.underline&&(R.underline=!0),o.strike&&(R.strike=!0),o.superscript&&(R.superscript=!0),o.subscript&&(R.subscript=!0),o.size!==void 0&&o.size!==22&&o.size>0&&(R.fontSize=o.size/2);let A=o.color!==void 0&&o.color>0?n[o.color]:void 0;A&&A!=="#000000"&&(R.color=A);let $=o.font!==void 0?e.get(o.font):void 0;return $&&(R.fontFamily=$),Object.keys(R).length>0?R:void 0},b=R=>{if(R===""||o.skip)return;if(u>0){l+=R;return}let A=y();a.push(A?{text:R,marks:A}:{text:R})},w=()=>{if(r.length>=Bp)return;let R=ce(a);a=[];let A=l.replace(/[\s\u00a0]+/g,"");l="";let $={id:T("b_"),runs:R,...i.align&&{align:i.align}};if(i.list&&A!==""){let B=Qs(A),v=Math.min(8,i.depth),N=B?B.marker:ts(A);r.push({...$,type:"list_item",list:B?"ordered":"bullet",depth:v,...N&&N!==He(B?"ordered":"bullet",v)&&{marker:N},...B&&{start:B.number}});return}let P=i.indent&&i.indent>0?Math.round(i.indent/20*100)/100:void 0;r.push({...$,type:"paragraph",...P&&{format:{indentLeft:P}}})},O=(R,A)=>{if(c==="fonts"||c==="colors"){c==="fonts"&&R==="f"&&A!==void 0&&(f=A),c==="colors"&&(R==="red"&&(p.r=A??0),R==="green"&&(p.g=A??0),R==="blue"&&(p.b=A??0));return}switch(R){case"b":o.bold=A!==0;break;case"i":o.italic=A!==0;break;case"ul":case"uld":case"uldb":case"ulth":case"ulw":o.underline=A!==0;break;case"ulnone":o.underline=!1;break;case"strike":case"striked":o.strike=A!==0;break;case"super":o.superscript=!0,o.subscript=!1;break;case"sub":o.subscript=!0,o.superscript=!1;break;case"nosupersub":o.superscript=!1,o.subscript=!1;break;case"fs":A!==void 0&&(o.size=A);break;case"cf":A!==void 0&&(o.color=A);break;case"f":A!==void 0&&(o.font=A);break;case"uc":o.uc=A??1;break;case"plain":o={...o,bold:!1,italic:!1,underline:!1,strike:!1,superscript:!1,subscript:!1,size:void 0,color:void 0,font:void 0};break;case"pard":i={list:!1,depth:0};break;case"qc":i.align="center";break;case"qr":i.align="right";break;case"qj":i.align="justify";break;case"ql":i.align=void 0;break;case"ls":i.list=!0;break;case"ilvl":i.depth=A??0;break;case"li":i.indent=A;break;case"par":w();break;case"line":b(`
`);break;case"tab":b("	");break;case"emspace":case"enspace":case"~":b("\xA0");break;case"endash":b("\u2013");break;case"emdash":b("\u2014");break;case"lquote":b("\u2018");break;case"rquote":b("\u2019");break;case"ldblquote":b("\u201C");break;case"rdblquote":b("\u201D");break;case"bullet":b("\u2022");break;case"listtext":u=s.length;break;default:break}},_=t.length,M=0;for(;M<_;){let R=t[M];if(R==="{"){if(s.length>=Op)return r;s.push({...o}),M++;let P=/^\\\*?\\?([a-z]+)/i.exec(t.slice(M,M+40));if(t[M]==="\\"&&t[M+1]==="*")o.skip=!0;else if(P&&Ap.has(P[1].toLowerCase())){let B=P[1].toLowerCase();B==="fonttbl"?(c="fonts",d=s.length,f=-1,h=""):B==="colortbl"?(c="colors",d=s.length,p={r:-1,g:-1,b:-1}):o.skip=!0}continue}if(R==="}"){let P=s.length;if(u===P&&(u=0),c&&P===d&&(c==="fonts"&&f>=0&&h.trim()!==""&&e.set(f,h.trim()),c=null),o=s.pop()??o,M++,s.length===0&&P===1)break;continue}if(R==="\\"){let P=t[M+1]??"";if(P==="'"){let L=parseInt(t.slice(M+2,M+4),16);if(M+=4,g>0){g--;continue}if(Number.isNaN(L))continue;let q=L>=128&&L<=159?Mp[L-128]:String.fromCharCode(L);c==="fonts"?h+=q:b(q);continue}if(P===`
`||P==="\r"){M+=2,P==="\r"&&t[M]===`
`&&M++,!o.skip&&c===null&&w();continue}if(/[\\{}]/.test(P)){if(M+=2,g>0){g--;continue}c==="fonts"?h+=P:b(P);continue}if(P==="~"||P==="-"||P==="_"){M+=2,b(P==="~"?"\xA0":P==="_"?"\u2011":"");continue}let B=/^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(t.slice(M,M+40));if(!B){M++;continue}M+=B[0].length;let v=B[1],N=B[2]!==void 0?Number(B[2]):void 0;if(v==="u"&&N!==void 0){let L=N<0?N+65536:N;c==="fonts"?h+=String.fromCharCode(L):b(String.fromCharCode(L)),g=o.uc;continue}O(v,N);continue}if(R===`
`||R==="\r"){M++;continue}let A=M;for(;A<_&&!`\\{}\r
`.includes(t[A]);)A++;let $=t.slice(M,A);for(M=A;g>0&&$.length>0;)$=$.slice(1),g--;if(c==="fonts"){let P=$.indexOf(";");h+=P>=0?$.slice(0,P):$,P>=0&&f>=0&&h.trim()!==""&&(e.set(f,h.trim()),h="")}else if(c==="colors")for(let P of $)P===";"&&(p.r>=0?n.push(`#${[p.r,p.g,p.b].map(B=>Math.max(0,Math.min(255,B)).toString(16).padStart(2,"0")).join("")}`):n.push(""),p={r:-1,g:-1,b:-1});else b($)}return(a.length>0||l!=="")&&w(),ti(Rp(r))}function Tp(t){let e=It(t);if(e)return e.family;let r=t.split("-")[0].replace(/([a-z])([A-Z])/g,"$1 $2");return It(r)?.family??r}function Rp(t){let e=t.map(n=>"runs"in n?{...n,runs:n.runs.map(r=>r.marks?.fontFamily?{...r,marks:{...r.marks,fontFamily:Tp(r.marks.fontFamily)}}:r)}:n);for(;e.length>1;){let n=e[e.length-1];if(n.type==="paragraph"&&n.runs.length===0)e.pop();else break}return e}var ao=["header","footer","headerFirst","footerFirst","headerEven","footerEven"];function hu(t){return t.endsWith("First")?"first":t.endsWith("Even")?"even":"default"}function is(t,e){return e==="first"?`${t}First`:e==="even"?`${t}Even`:t}function gu(t,e){return[is(e,"default"),...t?.differentFirstPage?[is(e,"first")]:[],...t?.differentOddEven?[is(e,"even")]:[]]}var Na="pli.doc",Fa=1;function E(t,e){throw new S("invalid_document",`${t}: ${e}`)}function me(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function ue(t,e,n){for(let r of Object.keys(e))n.includes(r)||E(t,`unknown field "${r}"`)}function ae(t,e,{nonEmpty:n=!1}={}){return(typeof e!="string"||n&&e==="")&&E(t,n?"expected a non-empty string":"expected a string"),e}function Oe(t,e,n,r){return(typeof e!="number"||!Number.isFinite(e)||e<n||e>r)&&E(t,`expected a number from ${n} to ${r}`),e}var ku=["bold","italic","underline","strike","code","superscript","subscript"],Dp=["link","color","highlight","fontFamily"],yu=["left","center","right","justify"],bu=["page","pages"];function ni(t,e){Array.isArray(e)||E(t,"expected an array of runs"),e.forEach((n,r)=>{let o=`${t}[${r}]`;if(me(n)||E(o,"expected a run object"),ue(o,n,["text","marks"]),ae(`${o}.text`,n.text),n.marks!==void 0){me(n.marks)||E(`${o}.marks`,"expected an object");for(let[s,i]of Object.entries(n.marks)){let a=`${o}.marks.${s}`;ku.includes(s)?typeof i!="boolean"&&E(a,"expected a boolean"):Dp.includes(s)?ae(a,i):s==="fontSize"?Oe(a,i,1,400):s==="field"?bu.includes(i)||E(a,`expected one of ${bu.join(", ")}`):s==="style"?ae(a,i,{nonEmpty:!0}):s==="suggest"?(me(i)||E(a,"expected an object"),ue(a,i,["id","kind","by","at"]),ae(`${a}.id`,i.id,{nonEmpty:!0}),i.kind!=="insert"&&i.kind!=="delete"&&E(`${a}.kind`,'expected "insert" or "delete"'),ae(`${a}.by`,i.by,{nonEmpty:!0}),Oe(`${a}.at`,i.at,0,Number.MAX_SAFE_INTEGER)):s==="footnote"?ae(a,i,{nonEmpty:!0}):s==="comment"?((!Array.isArray(i)||i.length===0)&&E(a,"expected a list of thread ids"),i.forEach((l,u)=>ae(`${a}[${u}]`,l,{nonEmpty:!0}))):E(`${o}.marks`,`unknown mark "${s}"`)}}})}var Ep=["bold","italic","underline","strike","superscript","subscript","color","highlight","fontFamily","fontSize"];function _p(t,e){me(e)||E(t,"expected an object");for(let[n,r]of Object.entries(e)){let o=`${t}.${n}`;if(n===""&&E(t,"a style needs an id"),me(r)||E(o,"expected a style object"),ue(o,r,["name","kind","basedOn","marks","align","format"]),ae(`${o}.name`,r.name,{nonEmpty:!0}),r.kind!=="paragraph"&&r.kind!=="character"&&E(`${o}.kind`,'expected "paragraph" or "character"'),r.basedOn!==void 0){let s=ae(`${o}.basedOn`,r.basedOn,{nonEmpty:!0}),i=e[s];(!me(i)||i.kind!==r.kind)&&E(`${o}.basedOn`,`"${s}" isn't a ${String(r.kind)} style of this document`)}if(r.marks!==void 0){me(r.marks)||E(`${o}.marks`,"expected an object");let s=r.marks;for(let[i,a]of Object.entries(s)){let l=`${o}.marks.${i}`;Ep.includes(i)||E(`${o}.marks`,`a style can't set "${i}"`),ku.includes(i)?typeof a!="boolean"&&E(l,"expected a boolean"):i==="fontSize"?Oe(l,a,1,400):ae(l,a)}}r.kind==="character"&&(r.align!==void 0||r.format!==void 0)&&E(o,"a character style can't set alignment or spacing"),as(o,r.align),ri(o,r.format)}for(let n of Object.keys(e)){let r=new Set;for(let o=n;o!==void 0;o=e[o].basedOn)r.has(o)&&E(`${t}.${n}.basedOn`,"styles can't be based on each other in a circle"),r.add(o)}}function as(t,e){e!==void 0&&!yu.includes(e)&&E(`${t}.align`,`expected one of ${yu.join(", ")}`)}function ri(t,e){if(e!==void 0){me(e)||E(`${t}.format`,"expected an object"),ue(`${t}.format`,e,["lineHeight","spaceBefore","spaceAfter","indentLeft","indentRight","indentFirst"]);for(let[n,r]of Object.entries(e)){let o=`${t}.format.${n}`;n==="lineHeight"?Oe(o,r,.5,10):n==="indentFirst"?Oe(o,r,-1e3,1e3):Oe(o,r,0,1e3)}}}var _a=["id","type","runs","align","format","style"],Np=new Set(["paragraph","title","subtitle","quote","heading","list_item","code_block","image","divider"]);function $a(t,e,n){let r=ae(t,n,{nonEmpty:!0});return e.has(r)&&E(t,`duplicate id "${r}"`),e.add(r),r}function Fp(t,e,n){ue(t,e,["id","type","rows","columns","headerRow","borders"]),e.headerRow!==void 0&&typeof e.headerRow!="boolean"&&E(`${t}.headerRow`,"expected a boolean"),e.borders!==void 0&&!["all","horizontal","none"].includes(e.borders)&&E(`${t}.borders`,'expected "all", "horizontal" or "none"'),(!Array.isArray(e.columns)||e.columns.length===0)&&E(`${t}.columns`,"expected a non-empty array");let r=e.columns,o=0;r.forEach((i,a)=>o+=Oe(`${t}.columns[${a}]`,i,1e-4,1)),Math.abs(o-1)>1e-6&&E(`${t}.columns`,"column widths must add up to 1"),(!Array.isArray(e.rows)||e.rows.length===0)&&E(`${t}.rows`,"expected at least one row"),e.rows.forEach((i,a)=>{let l=`${t}.rows[${a}]`;me(i)||E(l,"expected a row object"),ue(l,i,["id","cells","height"]),$a(`${l}.id`,n,i.id),i.height!==void 0&&Oe(`${l}.height`,i.height,1,5e3),(!Array.isArray(i.cells)||i.cells.length!==r.length)&&E(`${l}.cells`,`expected ${r.length} cells, one per column`),i.cells.forEach((u,c)=>{let d=`${l}.cells[${c}]`;me(u)||E(d,"expected a cell object"),ue(d,u,["id","blocks","shade","colSpan","rowSpan","vAlign","covered"]),$a(`${d}.id`,n,u.id),u.shade!==void 0&&ae(`${d}.shade`,u.shade);for(let f of["colSpan","rowSpan"])u[f]!==void 0&&(!Number.isInteger(u[f])||u[f]<2)&&E(`${d}.${f}`,"expected a whole number of 2 or more");u.vAlign!==void 0&&!["top","middle","bottom"].includes(u.vAlign)&&E(`${d}.vAlign`,'expected "top", "middle" or "bottom"'),u.covered!==void 0&&u.covered!==!0&&E(`${d}.covered`,"expected true"),Array.isArray(u.blocks)||E(`${d}.blocks`,"expected an array"),u.covered!==!0&&u.blocks.length===0&&E(`${d}.blocks`,"a cell needs at least one block"),ls(`${d}.blocks`,u.blocks,n,!0)})});let s=Cn(e);s&&E(`${t}`,s)}function ls(t,e,n,r=!1){Array.isArray(e)||E(t,"expected an array"),e.forEach((o,s)=>{let i=`${t}[${s}]`;switch(me(o)||E(i,"expected a block object"),$a(`${i}.id`,n,o.id),r&&!Np.has(o.type)&&E(`${i}.type`,`${JSON.stringify(o.type)} can't go inside a table cell`),o.type){case"paragraph":case"title":case"subtitle":case"quote":ue(i,o,_a),as(i,o.align),ri(i,o.format),ni(`${i}.runs`,o.runs);break;case"heading":ue(i,o,[..._a,"level"]),[1,2,3,4,5,6].includes(o.level)||E(`${i}.level`,"expected 1 to 6"),as(i,o.align),ri(i,o.format),ni(`${i}.runs`,o.runs);break;case"list_item":if(ue(i,o,[..._a,"list","depth","marker","start"]),o.list!=="bullet"&&o.list!=="ordered"&&E(`${i}.list`,'expected "bullet" or "ordered"'),(!Number.isInteger(o.depth)||o.depth<0)&&E(`${i}.depth`,"expected a non-negative integer"),o.marker!==void 0){let a=o.list==="bullet"?tn:Dn;a.includes(o.marker)||E(`${i}.marker`,`expected one of ${a.join(", ")}`)}o.start!==void 0&&(o.list!=="ordered"&&E(`${i}.start`,"only a numbered item has a start"),(!Number.isInteger(o.start)||o.start<0||o.start>99999)&&E(`${i}.start`,`expected a whole number from 0 to ${99999}`)),as(i,o.align),ri(i,o.format),ni(`${i}.runs`,o.runs);break;case"code_block":ue(i,o,["id","type","language","runs"]),o.language!==void 0&&ae(`${i}.language`,o.language),ni(`${i}.runs`,o.runs);break;case"divider":case"page_break":ue(i,o,["id","type"]);break;case"section_break":ue(i,o,["id","type","kind","columns","page","differentFirstPage","regions"]),o.kind!=="next_page"&&o.kind!=="continuous"&&E(`${i}.kind`,'expected "next_page" or "continuous"'),wu(`${i}.columns`,o.columns),$p(`${i}.page`,o.page),o.differentFirstPage!==void 0&&typeof o.differentFirstPage!="boolean"&&E(`${i}.differentFirstPage`,"expected true or false"),Ip(`${i}.regions`,o.regions);break;case"image":if(ue(i,o,["id","type","src","alt","width","height","align","wrap","crop"]),ae(`${i}.src`,o.src,{nonEmpty:!0}),o.alt!==void 0&&ae(`${i}.alt`,o.alt),Oe(`${i}.width`,o.width,1,2e4),Oe(`${i}.height`,o.height,1,2e4),as(i,o.align),o.wrap!==void 0&&o.wrap!=="left"&&o.wrap!=="right"&&E(`${i}.wrap`,'expected "left" or "right"'),o.crop!==void 0){(typeof o.crop!="object"||o.crop===null||Array.isArray(o.crop))&&E(`${i}.crop`,"expected an object");let a=o.crop;ue(`${i}.crop`,a,["top","right","bottom","left"]);for(let l of["top","right","bottom","left"])Oe(`${i}.crop.${l}`,a[l],0,.9);(a.left+a.right>.95||a.top+a.bottom>.95)&&E(`${i}.crop`,"too much is cut away")}break;case"toc":ue(i,o,["id","type","levels","title"]),[1,2,3,4,5,6].includes(o.levels)||E(`${i}.levels`,"expected 1 to 6"),o.title!==void 0&&ae(`${i}.title`,o.title);break;case"table":Fp(i,o,n);break;default:E(`${i}.type`,`unknown block type ${JSON.stringify(o.type)}`)}})}function $p(t,e){if(e!==void 0&&(me(e)||E(t,"expected an object"),ue(t,e,["size","orientation","margins"]),e.size!==void 0&&!(ae(`${t}.size`,e.size)in Rn)&&E(`${t}.size`,`expected one of ${Object.keys(Rn).join(", ")}`),e.orientation!==void 0&&e.orientation!=="portrait"&&e.orientation!=="landscape"&&E(`${t}.orientation`,'expected "portrait" or "landscape"'),e.margins!==void 0)){let n=e.margins;me(n)||E(`${t}.margins`,"expected an object"),ue(`${t}.margins`,n,["top","right","bottom","left"]);for(let r of["top","right","bottom","left"])Oe(`${t}.margins.${r}`,n[r],0,5)}}function Ip(t,e){if(e!==void 0){me(e)||E(t,"expected an object"),ue(t,e,ao);for(let[n,r]of Object.entries(e))ls(`${t}.${n}`,r,new Set),r.some(o=>o.type==="section_break")&&E(`${t}.${n}`,"a header or footer can't hold a section break")}}function wu(t,e){e!==void 0&&(me(e)||E(t,"expected an object"),ue(t,e,["count","gap","rule"]),(!Number.isInteger(e.count)||e.count<1||e.count>4)&&E(`${t}.count`,"expected a whole number from 1 to 4"),e.gap!==void 0&&Oe(`${t}.gap`,e.gap,0,200),e.rule!==void 0&&typeof e.rule!="boolean"&&E(`${t}.rule`,"expected true or false"))}function Lp(t,e){me(e)||E(t,"expected an object"),ue(t,e,["size","orientation","margins","columns","differentFirstPage","differentOddEven"]),wu(`${t}.columns`,e.columns);for(let r of["differentFirstPage","differentOddEven"])e[r]!==void 0&&typeof e[r]!="boolean"&&E(`${t}.${r}`,"expected true or false");ae(`${t}.size`,e.size)in Rn||E(`${t}.size`,`expected one of ${Object.keys(Rn).join(", ")}`),e.orientation!=="portrait"&&e.orientation!=="landscape"&&E(`${t}.orientation`,'expected "portrait" or "landscape"');let n=e.margins;me(n)||E(`${t}.margins`,"expected an object"),ue(`${t}.margins`,n,["top","right","bottom","left"]);for(let r of["top","right","bottom","left"])Oe(`${t}.margins.${r}`,n[r],0,5)}function Up(t,e,n){if(me(n)||E(t,"expected a thread object"),ue(t,n,["id","anchor","comments","resolved","createdAt"]),ae(`${t}.id`,n.id,{nonEmpty:!0})!==e&&E(`${t}.id`,"must match its key"),Oe(`${t}.createdAt`,n.createdAt,0,Number.MAX_SAFE_INTEGER),Array.isArray(n.comments)||E(`${t}.comments`,"expected an array"),n.comments.forEach((r,o)=>{let s=`${t}.comments[${o}]`;me(r)||E(s,"expected a comment object"),ue(s,r,["id","author","body","createdAt","editedAt","mentions"]),ae(`${s}.id`,r.id,{nonEmpty:!0}),ae(`${s}.author`,r.author,{nonEmpty:!0}),ae(`${s}.body`,r.body),Oe(`${s}.createdAt`,r.createdAt,0,Number.MAX_SAFE_INTEGER),r.editedAt!==void 0&&Oe(`${s}.editedAt`,r.editedAt,0,Number.MAX_SAFE_INTEGER),r.mentions!==void 0&&(Array.isArray(r.mentions)||E(`${s}.mentions`,"expected an array"),r.mentions.forEach((i,a)=>ae(`${s}.mentions[${a}]`,i,{nonEmpty:!0})))}),n.resolved!==void 0&&(me(n.resolved)||E(`${t}.resolved`,"expected an object"),ue(`${t}.resolved`,n.resolved,["by","at"]),ae(`${t}.resolved.by`,n.resolved.by,{nonEmpty:!0}),Oe(`${t}.resolved.at`,n.resolved.at,0,Number.MAX_SAFE_INTEGER)),n.anchor!==void 0){let r=n.anchor;me(r)||E(`${t}.anchor`,"expected an object"),ue(`${t}.anchor`,r,["block","from","to","quote"]),ae(`${t}.anchor.block`,r.block),Oe(`${t}.anchor.from`,r.from,0,Number.MAX_SAFE_INTEGER),Oe(`${t}.anchor.to`,r.to,0,Number.MAX_SAFE_INTEGER),ae(`${t}.anchor.quote`,r.quote)}}function oi(t){if(me(t)||E("doc","expected an object"),ue("doc",t,["id","type","title","blocks","page","footnotes","comments","styles",...ao]),t.type!=="document"&&E("doc.type",'expected "document"'),ae("doc.id",t.id,{nonEmpty:!0}),ae("doc.title",t.title),ls("doc.blocks",t.blocks,new Set),t.page!==void 0&&Lp("doc.page",t.page),t.footnotes!==void 0){me(t.footnotes)||E("doc.footnotes","expected an object");for(let[n,r]of Object.entries(t.footnotes)){n===""&&E("doc.footnotes","a note needs an id"),ls(`doc.footnotes.${n}`,r,new Set);for(let o of r)Ic(o)||E(`doc.footnotes.${n}`,`a footnote can't hold a ${o.type}`);r.length===0&&E(`doc.footnotes.${n}`,"a note needs at least one block")}}if(t.styles!==void 0&&_p("doc.styles",t.styles),t.comments!==void 0){me(t.comments)||E("doc.comments","expected an object");for(let[n,r]of Object.entries(t.comments))Up(`doc.comments.${n}`,n,r)}let e=t.footnotes??{};for(let n of Ze(t.blocks))n in e||E("doc.blocks",`a footnote reference points at "${n}", which has no note`);for(let n of ao)t[n]!==void 0&&(ls(`doc.${n}`,t[n],new Set),t[n].some(r=>r.type==="section_break")&&E(`doc.${n}`,"a header or footer can't hold a section break"));return t}function cs(t){return JSON.stringify({format:Na,version:Fa,doc:Fc(t)})}function mr(t){let e;try{e=JSON.parse(t)}catch{throw new S("invalid_document","Not valid JSON")}if(!me(e)||e.format!==Na)throw new S("invalid_document",`Not a Pli document (expected format "${Na}")`);if(e.version!==Fa)throw new S("unsupported",`Document version ${String(e.version)} isn't supported by this release (supports ${Fa})`);return oi(e.doc)}var Ia=500,Su=40,jp=32e6,zp=4e6;function Gp(t){return{...t,id:T("c_"),blocks:t.blocks.map(e=>({...e,id:T("b_")}))}}function Hp(t){return t.type!=="table"?{...t,id:T("b_")}:{...t,id:T("b_"),rows:t.rows.map(e=>({...e,id:T("r_"),cells:e.cells.map(Gp)}))}}function xu(t){return t.map(Hp)}function Kp(t,e){let n=ie(t.blocks);return[...ie(e)].some(o=>n.has(o))?xu(e):e.slice()}function Wp(t){if(t.length===0||t.length>jp)return null;try{let{blocks:e,footnotes:n,styles:r}=mr(t);return e.length>0?{blocks:e,...n&&{footnotes:n},...r&&{styles:r}}:null}catch{return null}}function qp(t){if(!t.includes("	")||t.length>zp)return null;let e=[],n=[],r="",o=!1;for(let a=0;a<t.length;a++){let l=t[a];if(o?l!=='"'?r+=l:t[a+1]==='"'?(r+='"',a++):o=!1:l==='"'&&r===""?o=!0:l==="	"?(n.push(r),r=""):l===`
`||l==="\r"?(l==="\r"&&t[a+1]===`
`&&a++,n.push(r),e.push(n),n=[],r=""):r+=l,e.length>Ia)return null}(r!==""||n.length>0)&&(n.push(r),e.push(n));let s=e[0]?.length??0;if(e.length<2||e.length>Ia||s<2||s>Su||e.some(a=>a.length!==s))return null;let i=a=>({id:T("c_"),blocks:a.replace(/\r\n?/g,`
`).split(`
`).map(l=>({id:T("b_"),type:"paragraph",runs:l===""?[]:[{text:l}]}))});return{id:T("b_"),type:"table",rows:e.map(a=>({id:T("r_"),cells:a.map(i)})),columns:at(Array.from({length:s},()=>1))}}function vu(t,e){let n=t.html&&t.html.trim()!==""?pu(t.html,e):null;if(t.plain){let r=t.text??(n?n.blocks.map(o=>F(o)?H(o.runs):"").join(`
`):"");return r===""?null:{source:"text",text:r}}if(t.fragment){let r=typeof t.fragment=="string"?Wp(t.fragment):t.fragment.length>0?{blocks:t.fragment.slice(),footnotes:t.footnotes,styles:t.styles}:null;if(r)return{source:"fragment",blocks:r.blocks,unsizedImages:[],...r.footnotes&&{footnotes:r.footnotes},...r.styles&&{styles:r.styles}}}if(n&&n.blocks.length>0)return{source:"html",blocks:n.blocks,unsizedImages:n.unsizedImages};if(t.rtf){let r=mu(t.rtf);if(r.some(o=>F(o)&&H(o.runs)!==""))return{source:"html",blocks:r,unsizedImages:[]}}if(t.text){let r=qp(t.text);return r?{source:"table",blocks:[r],unsizedImages:[]}:{source:"text",text:t.text}}return null}function Xp(t){return t.rows.map(e=>{let n=[];return e.cells.filter(r=>!r.covered).forEach((r,o)=>{o>0&&n.push({text:"	"}),r.blocks.forEach((s,i)=>{i>0&&n.push({text:" "}),F(s)&&n.push(...s.runs)})}),{id:T("b_"),type:"paragraph",runs:ce(n)}})}function Vp(t){return t.flatMap(e=>e.type==="table"?Xp(e):e.type==="toc"||e.type==="page_break"||e.type==="section_break"?[]:[e])}function Jp(t){let e=t.list[t.index-1];return e?{after:e.id}:t.cell?{after:null,cell:t.cell.cell.id}:{after:null}}function Zp(t,e,n){let r=e.block.id;for(let a of n)t.push({type:"insert_block",block:a,after:r}),r=a.id;let o=n[n.length-1];if(F(o))return{ops:t,selection:U(o.id,W(o.runs))};let s=e.list[e.index+1];if(s&&F(s))return{ops:t,selection:U(s.id,0)};let i=lt();return t.push({type:"insert_block",block:i,after:r}),{ops:t,selection:U(i.id,0)}}function Yp(t,e,n){let r=Nn(t,e),o=[...r.ops],s=Be(r.doc,r.at.block),i=Kp(t,n);if(s.cell&&(i=Vp(i)),i.length===0)return o.length>0?{ops:o,selection:U(r.at.block,r.at.offset)}:null;let a=s.block;if(!F(a))return Zp(o,s,i);let l=W(a.runs),u=Math.min(r.at.offset,l),c=i[0];if(i.length===1&&F(c))return l===0&&a.type==="paragraph"&&c.type!=="paragraph"&&c.runs.length>0?(o.push({type:"replace_block",id:a.id,block:{...c,id:a.id}}),{ops:o,selection:U(a.id,W(c.runs))}):c.runs.length===0?o.length>0?{ops:o,selection:U(a.id,u)}:null:(o.push({type:"insert_text",block:a.id,offset:u,runs:c.runs}),{ops:o,selection:U(a.id,u+W(c.runs))});let d=le(a.runs,u,l),f=i;u>0&&(u<l&&o.push({type:"delete_text",block:a.id,from:u,to:l}),F(c)&&(c.runs.length>0&&o.push({type:"insert_text",block:a.id,offset:u,runs:c.runs}),f=i.slice(1)));let p=f.slice(),h=p[p.length-1],g,y=!1;if(F(h))g={block:h.id,offset:W(h.runs)},p[p.length-1]={...h,runs:ce([...h.runs,...d])},y=u===0;else if(u>0){let w=s.list[s.index+1];if(d.length===0&&w&&F(w))g={block:w.id,offset:0};else{let O=d.length>0?{...a,id:T("b_"),runs:d}:lt();p.push(O),g={block:O.id,offset:0}}}else g={block:a.id,offset:0};let b=u>0?{after:a.id}:Jp(s);for(let w of p)o.push({type:"insert_block",block:w,after:b.after,..."cell"in b&&b.cell!==void 0&&{cell:b.cell}}),b={after:w.id};return y&&o.push({type:"delete_block",id:a.id}),{ops:o,selection:U(g.block,g.offset)}}function Qp(t,e,n){let r=bt(t,e),o,s,i;if(r)o=r.table,s=r.row1,i=r.col1;else{if(e.anchor.block!==e.focus.block||e.anchor.offset!==e.focus.offset)return null;let b=J(t,e.focus.block);if(!b?.cell)return null;({table:o,row:s,col:i}=b.cell)}let a=n.rows.length,l=n.columns.length;if(s+a>Ia||i+l>Su)return null;for(let b=s;b<Math.min(o.rows.length,s+a);b++)for(let w=i;w<Math.min(o.columns.length,i+l);w++){let O=o.rows[b].cells[w];if(O.covered||O.rowSpan||O.colSpan)return null}let u=o;for(;u.rows.length<s+a;)u=Gs(u,u.rows.length);for(;u.columns.length<i+l;)u=Hs(u,u.columns.length);let c=xu([n])[0],d=u.rows.map((b,w)=>w<s||w>=s+a?b:{...b,cells:b.cells.map((O,_)=>_>=i&&_<i+l?c.rows[w-s].cells[_-i]:O)}),f={...u,rows:d};if(Cn(f))return null;let p={type:"replace_block",id:o.id,block:f},h=Vr(f,s,i).cell.blocks[0],g=Vr(f,s+a-1,i+l-1),y=g.cell.blocks;if(g.cell.id===Vr(f,s,i).cell.id){let b=y[y.length-1];return{ops:[p],selection:U(b.id,F(b)?W(b.runs):0)}}return{ops:[p],selection:{anchor:{block:h.id,offset:0},focus:{block:y[0].id,offset:0}}}}function Cu(t,e,n){return(r,o)=>{if(t.length===0)return null;let s=Ze(t).length>0,i=us(ya(t)),a=s?Lc(i,e):null,l=a?.blocks??i,u=Object.entries(a?.notes??{}).map(([d,f])=>({type:"set_footnote",id:d,blocks:f}));if(n){let d=new Set;for(let f of Vs(l))for(let p=f;p!==void 0&&n[p]&&!d.has(p);p=n[p].basedOn)d.add(p);for(let f of d)r.styles?.[f]||u.push({type:"set_style",id:f,style:n[f]})}let c=null;return l.length===1&&l[0].type==="table"&&(c=Qp(r,o,l[0])),c??(c=Yp(r,o,l)),c&&u.length>0?{...c,ops:[...u,...c.ops]}:c}}var em=8;function tm(t,e){let n=e.table,r=n.rows.map((s,i)=>({...s,cells:s.cells.map((a,l)=>{if(a.covered||i<e.row1||i>e.row2||l<e.col1||l>e.col2)return a;let u=a.blocks[0],c=Te(u)?{...lt(u.id),...u.align&&{align:u.align},...u.format&&{format:u.format}}:lt(u.id);return{...a,blocks:[c]}})})),o=ua(e)[0].cell.blocks[0];return{ops:[{type:"replace_block",id:n.id,block:{...n,rows:r}}],selection:U(o.id,0)}}function Bu(t,e){let n=bt(t,e);if(n)return tm(t,n);let r=cr(t,e),{start:o}=r,{end:s}=r;if(s.offset===0&&o.block!==s.block&&en(t,s.block).type==="table"){let{list:h}=Ve(t),g=h[Bn(t,s.block)-1];g&&Bn(t,g.id)>=Bn(t,o.block)&&(s={block:g.id,offset:Ct(g)},e={anchor:o,focus:s})}let i=[];if(o.block===s.block){let h=en(t,o.block);return F(h)&&s.offset>o.offset&&i.push({type:"delete_text",block:h.id,from:o.offset,to:s.offset}),{ops:i,selection:U(h.id,o.offset)}}let a=Je(t,e,{raw:!0}),l=a[0].block,u=a[a.length-1].block,c=Be(t,o.block),d=Be(t,s.block),f=c.list===d.list&&F(l)&&F(u),p=new Set;for(let{block:h}of a)h.type==="table"&&c.cell?.table.id!==h.id&&d.cell?.table.id!==h.id&&p.add(h.id);for(let{block:h,from:g,to:y}of a){if(h.type==="table"){p.has(h.id)&&i.push({type:"delete_block",id:h.id});continue}let b=Be(t,h.id).cell;if(!(b&&p.has(b.table.id)))if(!F(h))i.push({type:"delete_block",id:h.id});else if(h.id===l.id){let w=W(h.runs);w>g&&i.push({type:"delete_text",block:h.id,from:g,to:w})}else h.id===u.id?!f&&y>0&&i.push({type:"delete_text",block:h.id,from:0,to:y}):i.push({type:"delete_block",id:h.id})}if(f&&F(l)&&F(u)){let h=le(u.runs,s.offset,W(u.runs));i.push({type:"delete_block",id:u.id}),h.length>0&&i.push({type:"insert_text",block:l.id,offset:o.offset,runs:h})}return Vo(t,i,U(o.block,o.offset))}function Nn(t,e){let{start:n}=cr(t,e);if(ge(e))return{ops:[],doc:t,at:n};let r=Bu(t,e);return{ops:r.ops,doc:An(t,r.ops),at:r.selection.focus}}function Fn(t,e){if(e===0){let o=Lt(t.runs,0);if(!o)return;let{link:s,field:i,footnote:a,...l}=o;return Object.keys(l).length>0?l:void 0}let n=Lt(t.runs,e-1);if(!n)return;let r={...n};return delete r.field,delete r.footnote,r.link&&Lt(t.runs,e)?.link!==r.link&&delete r.link,Object.keys(r).length>0?r:void 0}function nm(t,e){let n=t.charCodeAt(e-1),r=e>=2?t.charCodeAt(e-2):0;return n>=56320&&n<=57343&&r>=55296&&r<=56319?2:1}function rm(t,e){let n=t.charCodeAt(e),r=t.charCodeAt(e+1);return n>=55296&&n<=56319&&r>=56320&&r<=57343?2:1}function lo(){return(t,e)=>ge(e)?null:Bu(t,e)}function co(t,e){return(n,r)=>{if(t==="")return lo()(n,r);let o=Nn(n,r),s=en(o.doc,o.at.block);if(!F(s))return null;let i=e??Fn(s,o.at.offset),a=i?{text:t,marks:i}:{text:t};return{ops:[...o.ops,{type:"insert_text",block:s.id,offset:o.at.offset,runs:[a]}],selection:U(s.id,o.at.offset+t.length)}}}function ii(){return(t,e)=>{let n=Nn(t,e),r=en(n.doc,n.at.block),o=n.ops;if(!F(r)){let c={id:T("b_"),type:"paragraph",runs:[]};return{ops:[...o,{type:"insert_block",block:c,after:r.id}],selection:U(c.id,0)}}let s=W(r.runs),i=n.at.offset;if(r.type==="code_block")return{ops:[...o,{type:"insert_text",block:r.id,offset:i,runs:[{text:`
`}]}],selection:U(r.id,i+1)};if(s===0&&r.type==="list_item"){let c=r.depth>0?{...r,depth:r.depth-1}:{id:r.id,type:"paragraph",runs:[]};return{ops:[...o,{type:"replace_block",id:r.id,block:c}],selection:U(r.id,0)}}if(s===0&&r.type==="quote")return{ops:[...o,{type:"replace_block",id:r.id,block:{id:r.id,type:"paragraph",runs:[]}}],selection:U(r.id,0)};let a=le(r.runs,i,s),l=T("b_"),u;switch(r.type){case"heading":case"title":case"subtitle":u=i===s?{id:l,type:"paragraph",runs:a,...r.align&&{align:r.align}}:{...r,id:l,runs:a};break;case"list_item":{let{start:c,...d}=r;u={...d,id:l,runs:a};break}case"paragraph":u={...r,id:l,runs:a};break;case"quote":u={...r,id:l,runs:a};break}return i<s&&o.push({type:"delete_text",block:r.id,from:i,to:s}),o.push({type:"insert_block",block:u,after:r.id}),{ops:o,selection:U(l,0)}}}function Ou(t,e){let n=[];return e.runs.length>0&&n.push({type:"insert_text",block:t.id,offset:W(t.runs),runs:e.runs}),n.push({type:"delete_block",id:e.id}),n}function om(t,e){let{block:n}=e;if(e.cell&&e.list.length===1)return{ops:[{type:"replace_block",id:n.id,block:lt(n.id)}],selection:U(n.id,0)};let r=e.list[e.index-1],o=e.list[e.index+1],s=r?Ws(r):o?ur(o):null;return Vo(t,[{type:"delete_block",id:n.id}],s?U(s.block,s.offset):U(n.id,0))}function uo(){return(t,e)=>{if(!ge(e))return lo()(t,e);let n=e.focus,r=Be(t,n.block),o=r.block,s=r.list[r.index-1];if(!F(o))return om(t,r);if(n.offset>0){let i=nm(H(o.runs),n.offset);return{ops:[{type:"delete_text",block:o.id,from:n.offset-i,to:n.offset}],selection:U(o.id,n.offset-i)}}if(o.type==="list_item"){let i=o.depth>0?{...o,depth:o.depth-1}:{id:o.id,type:"paragraph",runs:o.runs};return{ops:[{type:"replace_block",id:o.id,block:i}],selection:U(o.id,0)}}if(o.type!=="paragraph"){let i={id:o.id,type:"paragraph",runs:o.runs};return{ops:[{type:"replace_block",id:o.id,block:i}],selection:U(o.id,0)}}return!s||s.type==="table"?null:F(s)?{ops:Ou(s,o),selection:U(s.id,W(s.runs))}:{ops:[{type:"delete_block",id:s.id}],selection:U(o.id,0)}}}function ds(){return(t,e)=>{if(!ge(e))return lo()(t,e);let n=e.focus,r=Be(t,n.block),o=r.block,s=r.list[r.index+1];if(!F(o))return uo()(t,e);let i=W(o.runs);if(n.offset<i){let a=rm(H(o.runs),n.offset);return{ops:[{type:"delete_text",block:o.id,from:n.offset,to:n.offset+a}],selection:U(o.id,n.offset)}}if(s?.type==="table"&&i===0&&o.type==="paragraph"){let a=ur(s);return a?{ops:[{type:"delete_block",id:o.id}],selection:U(a.block,a.offset)}:null}return!s||s.type==="table"?null:F(s)?{ops:Ou(o,s),selection:U(o.id,n.offset)}:{ops:[{type:"delete_block",id:s.id}],selection:U(o.id,n.offset)}}}function hr(t,e){let n=[];for(let{block:r,from:o,to:s}of Je(t,e))F(r)&&r.type!=="code_block"&&s>o&&n.push({block:r,from:o,to:s});return n}function fs(t){return(e,n)=>{let r=hr(e,n);return r.length===0?null:{ops:r.map(o=>({type:"format_text",block:o.block.id,from:o.from,to:o.to,patch:t})),selection:n}}}var sm={superscript:"subscript",subscript:"superscript"};function Ua(t,e){let n={[t]:e?!0:null},r=sm[t];return e&&r&&(n[r]=null),n}function Mu(t){return(e,n)=>{let r=hr(e,n);if(r.length===0)return null;let o=r.every(s=>zs(s.block.runs,s.from,s.to,t));return fs(Ua(t,!o))(e,n)}}function Au(t,e){return t.type!==e.type?!1:t.type==="heading"&&e.type==="heading"?t.level===e.level:t.type==="list_item"&&e.type==="list_item"?t.list===e.list:!0}function im(t,e){let n=t.id,r=Te(t)?{...t.align&&{align:t.align},...t.format&&{format:t.format},...e.type==="list_item"&&t.style&&{style:t.style}}:{};switch(e.type){case"paragraph":return{id:n,type:"paragraph",runs:t.runs,...r};case"title":return{id:n,type:"title",runs:t.runs,...r};case"subtitle":return{id:n,type:"subtitle",runs:t.runs,...r};case"heading":return{id:n,type:"heading",level:e.level,runs:t.runs,...r};case"quote":return{id:n,type:"quote",runs:t.runs,...r};case"code_block":{let o=H(t.runs);return{id:n,type:"code_block",runs:o===""?[]:[{text:o}],...e.language&&{language:e.language}}}case"list_item":{let o=t.type==="list_item"&&t.list===e.list;return{id:n,type:"list_item",list:e.list,depth:t.type==="list_item"?t.depth:0,...o&&t.type==="list_item"&&t.marker&&{marker:t.marker},...o&&t.type==="list_item"&&t.start!==void 0&&{start:t.start},runs:t.runs,...r}}}}function Tu(t,e){return Ge(t,e).filter(F)}function si(t){return(e,n)=>{let r=Tu(e,n).filter(o=>!Au(o,t)||t.type!=="list_item"&&Te(o)&&o.style).map(o=>({type:"replace_block",id:o.id,block:im(o,t)}));return r.length>0?{ops:r,selection:n}:null}}function Ru(t){return(e,n)=>{let r=Tu(e,n);return r.length>0&&r.every(o=>Au(o,t))?si({type:"paragraph"})(e,n):si(t)(e,n)}}var Du=36,am=720;function ai(){return(t,e)=>{let n=Je(t,e)[0];if(!n)return null;let r=Be(t,n.block.id),o=r.list[r.index-1],s=o?.type==="list_item"?o.depth:-1,i=[];for(let a of Ge(t,e)){if(a.type!=="list_item"){s=-1;let u=Nu(a,Du);u&&i.push({type:"replace_block",id:a.id,block:u});continue}let l=Math.min(a.depth+1,s+1,em);l>a.depth&&i.push({type:"replace_block",id:a.id,block:{...a,depth:l}}),s=Math.max(l,a.depth)}return i.length>0?{ops:i,selection:e}:null}}function li(){return(t,e)=>{let n=[];for(let r of Ge(t,e)){if(r.type!=="list_item"){let s=Nu(r,-Du);s&&n.push({type:"replace_block",id:r.id,block:s});continue}let o=r.depth>0?{...r,depth:r.depth-1}:{id:r.id,type:"paragraph",runs:r.runs,...r.align&&{align:r.align},...r.format&&{format:r.format}};n.push({type:"replace_block",id:r.id,block:o})}return n.length>0?{ops:n,selection:e}:null}}function Eu(t,e){let n=[];for(let r of Ge(t,e)){if(r.type!=="list_item")continue;let o=Be(t,r.id);n.push({item:r,list:o.list,index:o.index})}return n}function _u(t){return(e,n)=>{let r=[],o=new Set;for(let{item:s,list:i,index:a}of Eu(e,n))if(!(t&&!(s.list==="bullet"?tn:Dn).includes(t)))for(let l of Ta(i,a)){let u=i[l];if(o.has(u.id))continue;o.add(u.id);let c=t&&t!==He(u.list,u.depth)?t:void 0;if(u.marker===c)continue;let{marker:d,...f}=u;r.push({type:"replace_block",id:u.id,block:c?{...f,marker:c}:f})}return r.length>0?{ops:r,selection:n}:null}}function ja(t){return(e,n)=>{if(t!==null&&(!Number.isInteger(t)||t<0||t>99999))return null;let r=Eu(e,n).filter(({item:s})=>s.list==="ordered"),o=[];for(let{item:s,list:i,index:a}of t===null?r:r.slice(0,1)){if(s.start===(t??void 0))continue;let l=Ta(i,a)[0]===a,{start:u,...c}=s,d=t!==null&&!(t===1&&l);!d&&s.start===void 0||o.push({type:"replace_block",id:s.id,block:d?{...c,start:t}:c})}return o.length>0?{ops:o,selection:n}:null}}function Nu(t,e){if(!Te(t)||t.type==="title"||t.type==="subtitle")return null;let n=t.format?.indentLeft??0,r=Math.min(am,Math.max(0,n+e));if(r===n)return null;let{indentLeft:o,...s}=t.format??{},i=r===0?s:{...s,indentLeft:r},{format:a,...l}=t;return Object.keys(i).length>0?{...l,format:i}:l}function Fu(t){return(e,n)=>{let r=[];for(let o of Ge(e,n)){if(!Te(o)&&o.type!=="image"||(o.align??"left")===t)continue;let{align:s,...i}=o;r.push({type:"replace_block",id:o.id,block:t==="left"?i:{...i,align:t}})}return r.length>0?{ops:r,selection:n}:null}}function za(t){return(e,n)=>{let r=[];for(let o of Ge(e,n)){if(!Te(o))continue;let s={...o.format};for(let[u,c]of Object.entries(t))c==null?delete s[u]:s[u]=c;let{format:i,...a}=o;JSON.stringify(s)!==JSON.stringify(o.format??{})&&r.push({type:"replace_block",id:o.id,block:Object.keys(s).length>0?{...a,format:s}:a})}return r.length>0?{ops:r,selection:n}:null}}var lm={bold:null,italic:null,underline:null,strike:null,code:null,superscript:null,subscript:null,color:null,highlight:null,fontFamily:null,fontSize:null,style:null};function $u(){return(t,e)=>{let n=[];for(let r of hr(t,e))n.push({type:"format_text",block:r.block.id,from:r.from,to:r.to,patch:lm});for(let r of Ge(t,e))!Te(r)||!r.align&&!r.format&&!r.style||n.push({type:"update_block",id:r.id,patch:{align:null,format:null,style:null}});return n.length>0?{ops:n,selection:e}:null}}function ps(t,e={}){return(n,r)=>{let o=Nn(n,r),s=Be(o.doc,o.at.block),i=s.block;if(s.cell&&t.type!=="image"&&t.type!=="divider")return null;let a=[...o.ops],l=o.doc,u,c,d=F(i)&&i.type==="paragraph"&&W(i.runs)===0&&(e.replaceEmpty??(!!s.cell&&t.type==="image")),f=e.trailingParagraph??!(d&&s.cell);if(!F(i))u=i.id;else{let b=W(i.runs),w=o.at.offset;if(w===0){let O=s.list[s.index-1];u=O?O.id:null,!O&&s.cell&&(c=s.cell.cell.id)}else if(w>=b)u=i.id;else{let O=ii()(l,U(i.id,w));a.push(...O.ops),l=An(l,O.ops),u=i.id}}let p={type:"insert_block",block:t,after:u,...c!==void 0&&{cell:c}};if(a.push(p),l=An(l,[p]),d){let b={type:"delete_block",id:i.id};a.push(b),l=An(l,[b])}let h=Be(l,t.id),g=h.list[h.index+1];if(g&&F(g))return{ops:a,selection:U(g.id,0)};if(!f)return{ops:a,selection:U(t.id,0)};let y=lt();return a.push({type:"insert_block",block:y,after:t.id}),{ops:a,selection:U(y.id,0)}}}function Iu(t,e,n){return(r,o)=>{let s=wa(t,e,n),i=ps(s)(r,o);if(!i)return null;let a=ur(s);return a?{ops:i.ops,selection:U(a.block,0)}:i}}function Lu(t){return(e,n)=>{let r=wa(1,t,{borders:"none"}),o=t===2?["left","right"]:["left","center","right"];r.rows[0].cells.forEach((a,l)=>{let u=a.blocks[0];u.type==="paragraph"&&o[l]!=="left"&&(u.align=o[l])});let s=ps(r,{replaceEmpty:!0,trailingParagraph:!1})(e,n);if(!s)return null;let i=ur(r);return i?{ops:s.ops,selection:U(i.block,0)}:s}}function Uu(t,e){return(n,r)=>{let o=Nn(n,r),s=en(o.doc,o.at.block);if(!F(s)||s.type==="code_block")return null;let i=e&&e.length>0?e:[lt()],a={text:Tn,marks:{footnote:t}};return{ops:[...o.ops,{type:"insert_text",block:s.id,offset:o.at.offset,runs:[a]},{type:"set_footnote",id:t,blocks:i}],selection:U(s.id,o.at.offset+1)}}}function ju(t){return(e,n)=>{let r=Zo(no(e,Be(e,n.focus.block).topIndex));return ps(Qo(t,r))(e,n)}}function zu(t){return(e,n)=>{let r=t&&t.count>1?Zo(pr(t)):void 0,o=(y,b)=>JSON.stringify(y??null)===JSON.stringify(b??null),s=y=>{let{columns:b,...w}=y;return r?{...w,columns:r}:w},i=()=>{let y=jt(e);if(o(y.columns,r))return null;let{columns:b,...w}=y;return{type:"set_page",page:r?{...w,columns:r}:w}},a=Je(e,n).map(y=>Be(e,y.block.id).topIndex),l=Math.min(...a),u=Math.max(...a);for(;l<u&&e.blocks[l].type==="section_break";)l++;for(;u>l&&e.blocks[u].type==="section_break";)u--;if(ge(n)||l===u&&e.blocks[l].type==="section_break"){let y=Pa(e,l);if(y.start)return o(y.start.columns,r)?null:{ops:[{type:"replace_block",id:y.start.id,block:s(y.start)}],selection:n};let b=i();return b?{ops:[b],selection:n}:null}let c=[],d=Zo(no(e,u)),f=e.blocks[u],p=e.blocks[u+1];p&&p.type!=="section_break"&&!o(d,r)&&c.push({type:"insert_block",block:Qo("continuous",d),after:f.id});for(let y=l+1;y<=u;y++){let b=e.blocks[y];b.type==="section_break"&&!o(b.columns,r)&&c.push({type:"replace_block",id:b.id,block:s(b)})}let h=e.blocks[l],g=e.blocks[l-1];if(h.type==="section_break")o(h.columns,r)||c.push({type:"replace_block",id:h.id,block:s(h)});else if(g?.type==="section_break")o(g.columns,r)||c.push({type:"replace_block",id:g.id,block:s(g)});else if(l===0){let y=i();y&&c.push(y)}else o(Zo(no(e,l)),r)||c.push({type:"insert_block",block:Qo("continuous",r),after:g.id});return c.length>0?{ops:c,selection:n}:null}}function Gu(t){return(e,n)=>{let r=Nn(e,n),o=en(r.doc,r.at.block);if(!F(o))return null;let{link:s,...i}=Fn(o,r.at.offset)??{},a={text:"1",marks:{...i,field:t}};return{ops:[...r.ops,{type:"insert_text",block:o.id,offset:r.at.offset,runs:[a]}],selection:U(o.id,r.at.offset+1)}}}function Hu(t,e){return(n,r)=>ge(r)?t?co(e||t,{link:t})(n,r):null:fs({link:t})(n,r)}function Ku(t){return(e,n)=>{if(t==="")return lo()(e,n);let r=t.replace(/\r\n?/g,`
`).split(`
`),o=Nn(e,n),s=[...o.ops],i=o.doc,a=o.at,l=u=>{let c=u(i,U(a.block,a.offset));c&&(s.push(...c.ops),i=An(i,c.ops),a=c.selection.focus)};return r.forEach((u,c)=>{c>0&&l(ii()),u!==""&&l(co(u))}),{ops:s,selection:U(a.block,a.offset)}}}function Wu(t){return(e,n)=>{if(t!==null&&e.styles?.[t]?.kind!=="paragraph")return null;let r=[];for(let o of Ge(e,n)){if(!Te(o)||(o.style??null)===t&&(t===null||!o.align&&!o.format))continue;let i={style:t};t!==null&&Object.assign(i,{align:null,format:null}),r.push({type:"update_block",id:o.id,patch:i})}return r.length>0?{ops:r,selection:n}:null}}function qu(t){return(e,n)=>t!==null&&e.styles?.[t]?.kind!=="character"?null:fs({style:t})(e,n)}function La(t,e,n){let r={},o=le(t,e,n).filter(s=>s.text!=="");if(o.length===0)return r;for(let s of qs){let i=o[0].marks?.[s];i!==void 0&&o.every(a=>a.marks?.[s]===i)&&(r[s]=i)}return r}function Pu(t,e){let n={...t,...e};for(let r of Object.keys(n))n[r]===!1&&delete n[r];return Object.keys(n).length>0?n:void 0}function Ga(t){return(e,n)=>{let r=[];if(t.kind==="paragraph"){let o=Ge(e,n).filter(Te),s=o[0];if(!s)return null;let i=La(s.runs,0,W(s.runs)),a=eo(e,s.style),l=Ut(e,s),u=Pu(a?.marks,i),c={name:t.name,kind:"paragraph",...t.basedOn&&{basedOn:t.basedOn},...u&&{marks:u},...l.align&&{align:l.align},...l.format&&{format:l.format}};r.push({type:"set_style",id:t.id,style:c});for(let d of o){r.push({type:"update_block",id:d.id,patch:{style:t.id,align:null,format:null}});let f=W(d.runs),p=Object.keys(La(d.runs,0,f)).filter(h=>h in i);p.length>0&&f>0&&r.push({type:"format_text",block:d.id,from:0,to:f,patch:Object.fromEntries(p.map(h=>[h,null]))})}}else{let o=hr(e,n);if(o.length===0)return null;let s=o.map(f=>La(f.block.runs,f.from,f.to)),i=Object.fromEntries(Object.entries(s[0]).filter(([f,p])=>s.every(h=>h[f]===p))),a=new Set(o.flatMap(f=>le(f.block.runs,f.from,f.to).map(p=>p.marks?.style))),l=a.size===1?eo(e,[...a][0])?.marks:void 0,u=Pu(l,i),c={name:t.name,kind:"character",...t.basedOn&&{basedOn:t.basedOn},...u&&{marks:u}};r.push({type:"set_style",id:t.id,style:c});let d=Object.fromEntries(Object.keys(i).map(f=>[f,null]));for(let f of o)r.push({type:"format_text",block:f.block.id,from:f.from,to:f.to,patch:{...d,style:t.id}})}return{ops:r,selection:n}}}function Xu(t){return(e,n)=>{let r=e.styles?.[t];if(!r)return null;let o=[];for(let[i,a]of Object.entries(e.styles??{})){if(a.basedOn!==t)continue;let{basedOn:l,...u}=a;o.push({type:"set_style",id:i,style:r.basedOn?{...u,basedOn:r.basedOn}:u})}let s=i=>{for(let a of i){if(a.type==="table"&&a.rows.forEach(u=>u.cells.forEach(c=>s(c.blocks))),!("runs"in a))continue;Te(a)&&a.style===t&&o.push({type:"update_block",id:a.id,patch:{style:null}});let l=0;for(let u of a.runs){let c=u.text.length;u.marks?.style===t&&c>0&&o.push({type:"format_text",block:a.id,from:l,to:l+c,patch:{style:null}}),l+=c}}};return s(e.blocks),o.push({type:"set_style",id:t,style:null}),{ops:o,selection:n}}}function Zu(t){return Ve(t).list.filter(e=>F(e)&&e.type!=="code_block"&&!e.id.endsWith("~empty"))}function ui(t){let e=new Map;for(let n of Zu(t)){let r=0;for(let o of n.runs){let s=o.marks?.suggest;if(s){let i=e.get(s.id);i?i.text=(i.text+o.text).slice(0,200):e.set(s.id,{...s,text:o.text.slice(0,200),block:n.id,from:r})}r+=o.text.length}}return[...e.values()]}function cm(t,e){let n=[];for(let r of Zu(t)){let o=0,s=null;for(let i of r.runs){let a=o+i.text.length,l=i.marks?.suggest;l&&e(l)?s&&s.suggest.id===l.id&&s.to===o?s.to=a:n.push(s={block:r.id,from:o,to:a,suggest:l}):s=null,o=a}}return n}function Yu(t,e,n=()=>!0){let o=cm(t,typeof n=="string"?a=>a.id===n:n);o.sort((a,l)=>a.block===l.block?l.from-a.from:0);let s=new Map;for(let a of o)s.set(a.block,[...s.get(a.block)??[],a]);let i=[];for(let a of s.values())for(let l of a){let u=e==="accept"?l.suggest.kind==="delete":l.suggest.kind==="insert";i.push(u?{type:"delete_text",block:l.block,from:l.from,to:l.to}:{type:"format_text",block:l.block,from:l.from,to:l.to,patch:{suggest:null}})}return i}function us(t){let e=n=>n.map(r=>{if(!r.marks?.suggest)return r;let{suggest:o,...s}=r.marks;return Object.keys(s).length>0?{...r,marks:s}:{text:r.text}});return t.map(n=>n.type==="table"?{...n,rows:n.rows.map(r=>({...r,cells:r.cells.map(o=>({...o,blocks:us(o.blocks)}))}))}:"runs"in n&&n.runs.some(r=>r.marks?.suggest)?{...n,runs:e(n.runs)}:n)}var ms=t=>t?.suggest;function ci(t,e,n,r){let{end:o}=cr(t,e),s=r??{id:n.newId(),kind:"delete",by:n.by,at:n.at},i=[],a=[],l=0;for(let{block:u,from:c,to:d}of Je(t,e,{raw:!0})){if(!F(u)||d<=c)continue;if(u.type==="code_block"){a.push({type:"delete_text",block:u.id,from:c,to:d}),u.id===o.block&&(l+=d-c);continue}let f=c,p=[];for(let h of le(u.runs,c,d)){let g=f+h.text.length,y=ms(h.marks);if(y?.kind!=="delete")if(y?.kind==="insert"&&y.by===n.by)p.push([f,g]);else{let b=i[i.length-1];b&&b.type==="format_text"&&b.block===u.id&&b.to===f?b.to=g:i.push({type:"format_text",block:u.id,from:f,to:g,patch:{suggest:s}})}f=g}for(let[h,g]of p.reverse())a.push({type:"delete_text",block:u.id,from:h,to:g}),u.id===o.block&&(l+=g-h)}return i.length===0&&a.length===0?null:{ops:[...i,...a],end:{block:o.block,offset:o.offset-l}}}function Ha(t,e,n){return(r,o)=>{if(t==="")return hs("selection",e)(r,o);let s=[],i=r,a=cr(r,o).end;if(!ge(o)){let p=ci(r,o,e);p&&(s=p.ops,i=An(r,s),a=p.end)}let l=en(i,a.block);if(!F(l))return null;if(l.type==="code_block")return co(t,n)(r,o);let u=a.offset>0?ms(Lt(l.runs,a.offset-1)):void 0,c=u?.kind==="insert"&&u.by===e.by?u:void 0,d={...n??Fn(l,a.offset)};delete d.suggest;let f=c??{id:e.newId(),kind:"insert",by:e.by,at:e.at};return{ops:[...s,{type:"insert_text",block:l.id,offset:a.offset,runs:[{text:t,marks:{...d,suggest:f}}]}],selection:U(l.id,a.offset+t.length)}}}var Ju=(t,e)=>ms(Lt(t.runs,e))?.kind==="delete";function hs(t,e){return(n,r)=>{if(!ge(r)){let g=ci(n,r,e);return g?{ops:g.ops,selection:U(g.end.block,g.end.offset)}:null}if(t==="selection")return null;let o=r.focus,s=Be(n,o.block).block;if(!F(s)||s.type==="code_block")return t==="backspace"?uo()(n,r):ds()(n,r);let i=H(s.runs),a=W(s.runs);if(t==="backspace"){let g=o.offset;for(;g>0&&Ju(s,g-1);)g--;if(g===0)return o.offset>0?{ops:[],selection:U(s.id,0)}:uo()(n,r);let y=i.charCodeAt(g-1),b=g>=2?i.charCodeAt(g-2):0,w=y>=56320&&y<=57343&&b>=55296&&b<=56319?2:1,O={anchor:{block:s.id,offset:g-w},focus:{block:s.id,offset:g}},_=g<a?ms(Lt(s.runs,g)):void 0;return{ops:ci(n,O,e,_?.kind==="delete"&&_.by===e.by?_:void 0)?.ops??[],selection:U(s.id,g-w)}}let l=o.offset;for(;l<a&&Ju(s,l);)l++;if(l>=a)return o.offset<a?{ops:[],selection:U(s.id,a)}:ds()(n,r);let u=i.charCodeAt(l),c=i.charCodeAt(l+1),d=u>=55296&&u<=56319&&c>=56320&&c<=57343?2:1,f={anchor:{block:s.id,offset:l},focus:{block:s.id,offset:l+d}},p=l>0?ms(Lt(s.runs,l-1)):void 0,h=ci(n,f,e,p?.kind==="delete"&&p.by===e.by?p:void 0);return{ops:h?.ops??[],selection:U(s.id,h?.end.offset??l+d)}}}var di=(t,e)=>JSON.stringify(t)===JSON.stringify(e);function Qu(t){let e=[];for(let n of t){let r=e[e.length-1];r&&di(r[1],n.marks?.comment)?r[0]+=n.text.length:e.push([n.text.length,n.marks?.comment])}return e}function um(t,e,n){let r=J(t,e);if(!r)throw new S("not_found",`No block with id "${e}"`);if(n.id!==e)throw new S("invalid_operation","replace_block must keep the block id");let o=r.block,s=[];if(F(o)&&F(n)){let u=ce(o.runs),c=ce(n.runs);if(!di(u,c)){let d=f=>f.map(p=>p.text).join("");if(d(u)===d(c)){if(!di(Qu(u),Qu(c)))return[{type:"replace_block",id:e,block:n}];s.push({type:"restore_marks",block:e,from:0,to:W(c),segments:Ko(c,0,W(c))})}else W(u)>0&&s.push({type:"delete_text",block:e,from:0,to:W(u)}),W(c)>0&&s.push({type:"insert_text",block:e,offset:0,runs:c})}}else if(F(o)!==F(n))return[{type:"replace_block",id:e,block:n}];let i={},a=o,l=n;for(let u of new Set([...Object.keys(a),...Object.keys(l)]))u==="id"||u==="runs"||di(a[u],l[u])||(i[u]=l[u]===void 0?null:l[u]);return Object.keys(i).length>0&&s.push(td(t,{type:"update_block",id:e,patch:i})),s}function ed(t,e){let n=s=>s.type==="replace_block"||s.type==="delete_block"&&s.after===void 0||s.type==="update_block"&&Array.isArray(s.patch.rows)&&s.within===void 0;if(!e.some(n))return e;let r=[],o=t;for(let s of e){let i=s.type==="replace_block"?um(o,s.id,s.block):s.type==="delete_block"&&s.after===void 0?[dm(o,s)]:s.type==="update_block"?[td(o,s)]:[s];for(let a of i)o=Mn.apply(o,a).state;r.push(...i)}return r}function dm(t,e){let n=J(t,e.id);if(!n)return e;let r=n.list[n.index-1],o=[...ie([n.block])].filter(s=>s!==e.id);return{type:"delete_block",id:e.id,after:r?r.id:null,...!r&&n.cell?{cell:n.cell.cell.id}:{},...o.length>0?{within:o}:{}}}function td(t,e){if(!Array.isArray(e.patch.rows)||e.within!==void 0)return e;let n=J(t,e.id);if(!n)return e;let r=[...ie([n.block])].filter(o=>o!==e.id);return r.length>0?{...e,within:r}:e}function fm(t){switch(t.type){case"insert_text":case"delete_text":case"format_text":case"restore_marks":case"comment_text":case"set_runs":return t.block;case"update_block":case"replace_block":return t.id;default:return null}}function pm(t,e){switch(t.type){case"insert_text":case"delete_text":case"format_text":case"restore_marks":case"comment_text":case"set_runs":return{...t,block:e};case"update_block":return{...t,id:e};case"replace_block":return{...t,id:e,block:{...t.block,id:e}};default:return t}}function nd(t,e){let n=new Map,r=[];for(let o of e){let s=fm(o);if(s!==null&&!n.has(s)&&s.endsWith("~empty")){let i=J(t,s);if(i?.cell&&i.list.length===1&&F(i.block)&&W(i.block.runs)===0){let a=T("b_");n.set(s,a),r.push({type:"insert_block",block:{id:a,type:"paragraph",runs:[]},after:null,cell:i.cell.cell.id})}}r.push(s!==null&&n.has(s)?pm(o,n.get(s)):o)}return{ops:r,renames:n}}function mm(t,e){let n=gm(t,e);if(n)return n;if(t.type==="insert_text"||t.type==="delete_text"||fo(t))return(e.type==="insert_text"||e.type==="delete_text"||fo(e))&&cd(t)===cd(e)?bm(t,e):[[t],[e]];if(t.type==="insert_block"&&e.type==="insert_block"&&t.block.id===e.block.id){let o=[...ie([e.block])].filter(i=>i!==e.block.id);return[[{type:"delete_block",id:e.block.id,after:e.after,...e.cell!==void 0?{cell:e.cell}:{},...o.length>0?{within:o}:{}},t],[]]}if(t.type==="insert_block"&&e.type==="insert_block"){if(t.after===e.after&&(t.after!==null||t.cell===e.cell)){let{cell:s,...i}=t;return[[{...i,after:e.block.id}],[e]]}return[[t],[e]]}if(t.type==="update_block"&&e.type==="update_block"&&t.id===e.id){let o=Object.fromEntries(Object.entries(e.patch).filter(([i])=>!(i in t.patch))),s=Object.keys(o).length>0?[{...e,patch:o}]:[];return[["rows"in t.patch&&"rows"in e.patch?Wa(t,e):t].flat(),s]}return t.type==="delete_block"&&e.type==="delete_block"&&t.id!==e.id?[[t.after===e.id?sd(t,e):t],[e.after===t.id?sd(e,t):e]]:t.type==="delete_block"&&e.type==="insert_block"&&rd(e,t)?[[od(t,e.block.id)],[e]]:t.type==="insert_block"&&e.type==="delete_block"&&rd(t,e)?[[t],[od(e,t.block.id)]]:ym(t,e)?[[t],[]]:[[t],[e]]}function $n(t,e){if(t.length===0||e.length===0)return[[...t],[...e]];if(t.length===1&&e.length===1)return mm(t[0],e[0]);if(t.length>1){let[u,...c]=t,[d,f]=$n([u],e),p=qa(u,d,c,f),[h,g]=$n(p.kept,f);return[[...d,...h],Ka(g,p.dropped)]}let[n,...r]=e,[o,s]=$n(t,[n]),i=qa(n,s,r,o),[a,l]=$n(o,i.kept);return[Ka(a,i.dropped),[...s,...l]]}function Ka(t,e){return e.length===0?t:t.map(n=>{let r=Xa(n);if(!r||n.type!=="delete_block"&&n.type!=="update_block")return n;let o=new Set(n.within??[]),s=i=>i===r.self||r.covered.has(i)||o.has(i);for(let i of e)if(Ja(i).some(s))for(let a of fi(i))o.add(a);return o.size===(n.within?.length??0)?n:{...n,within:[...o]}})}function rd(t,e){return e.after===void 0?!1:t.after===e.after&&(t.after!==null||t.cell===e.cell)}function od(t,e){let{cell:n,...r}=t;return{...r,after:e}}function sd(t,e){let{cell:n,...r}=t,o=e.after??null;return o===null&&e.cell!==void 0?{...r,after:null,cell:e.cell}:{...r,after:o}}function Wa(t,e){let n=hm(e);return n.size===0?t:t.type==="delete_block"||t.type==="update_block"&&Array.isArray(t.patch.rows)?{...t,within:[...new Set([...t.within??[],...n])]}:t}function md(t,e,n){let[r,o]=$n(t,n),s=qa(t,r,[...e],o),[i,a]=$n(s.kept,o);return{inflight:r,pending:i,incoming:Ka(a,s.dropped)}}function id(t){if(t.type==="insert_block"||t.type==="replace_block")return ie([t.block]);if(t.type==="update_block"&&Array.isArray(t.patch.rows)){let e=ie([{id:t.id,type:"table",rows:t.patch.rows,columns:[]}]);return e.delete(t.id),e}return new Set}function hm(t){let e=fi(t);if(t.type==="update_block"||t.type==="delete_block")for(let n of t.within??[])e.add(n);return e}function fi(t){switch(t.type){case"insert_block":return ie([t.block]);case"replace_block":return ie([t.block]);case"update_block":{if(!Array.isArray(t.patch.rows))return new Set;let e=ie([{id:t.id,type:"table",rows:t.patch.rows,columns:[]}]);e.delete(t.id);for(let n of t.within??[])e.delete(n);return e}default:return new Set}}function qa(t,e,n,r=[]){let o=new Set;for(let a of Array.isArray(t)?t:[t])for(let l of fi(a))o.add(l);if(o.size===0)return{kept:n,lost:o,dropped:[]};for(let a of[...e,...r])for(let l of id(a))o.delete(l);if(o.size===0)return{kept:n,lost:o,dropped:[]};let s=[],i=[];for(let a of n)if(Ja(a).some(l=>o.has(l))){i.push(a);for(let l of fi(a))o.add(l)}else{s.push(a);for(let l of id(a))o.delete(l)}return{kept:s,lost:o,dropped:i}}function Xa(t){switch(t.type){case"delete_block":return{rank:3,self:t.id,covered:new Set(t.within??[])};case"replace_block":{let e=ie([t.block]);return e.delete(t.id),{rank:2,self:t.id,covered:e}}case"set_runs":return{rank:2,self:t.block,covered:new Set};case"update_block":if(Array.isArray(t.patch.rows)){let e=ie([{id:t.id,type:"table",rows:t.patch.rows,columns:[]}]);e.delete(t.id);for(let n of t.within??[])e.add(n);return{rank:1,self:null,covered:e}}return null;default:return null}}function Ja(t){switch(t.type){case"insert_text":case"delete_text":case"format_text":case"restore_marks":case"comment_text":case"set_runs":return[t.block];case"update_block":case"replace_block":case"delete_block":return[t.id];case"insert_block":return[t.after,t.cell].filter(e=>typeof e=="string");default:return[]}}function ad(t,e){return e.type==="insert_block"?typeof e.after=="string"&&e.after!==t.self&&t.covered.has(e.after)||e.cell!==void 0&&t.covered.has(e.cell):Ja(e).some(n=>n===t.self||t.covered.has(n))}function gm(t,e){let n=Xa(t),r=Xa(e),o=!!r&&ad(r,t),s=!!n&&ad(n,e);return o&&s&&(n.rank>r.rank?o=!1:r.rank>n.rank?s=!1:n.rank!==3&&(o=!1)),o||s?[o?[]:[s?Wa(t,e):t],s?[]:[o?Wa(e,t):e]]:t.type==="insert_block"&&e.type==="delete_block"&&t.after===e.id?[[ld(t,e)],[e]]:e.type==="insert_block"&&t.type==="delete_block"&&e.after===t.id?[[t],[ld(e,t)]]:null}function ld(t,e){let{cell:n,...r}=t,o=e.after??null;return o===null&&e.cell!==void 0?{...r,after:null,cell:e.cell}:{...r,after:o}}function ym(t,e){if(t.type!==e.type)return!1;switch(t.type){case"set_title":case"set_page":return!0;case"set_region":return t.region===e.region;case"set_footnote":case"set_thread":case"set_style":return t.id===e.id;default:return!1}}function fo(t){return t.type==="format_text"||t.type==="restore_marks"||t.type==="comment_text"}function cd(t){return"block"in t&&typeof t.block=="string"?t.block:null}var pi=t=>t.runs.reduce((e,n)=>e+n.text.length,0),mo=(t,e,n)=>t<=e?t:t>=n?t-(n-e):e;function bm(t,e){if(t.type==="insert_text"&&e.type==="insert_text"){let n=e.offset<=t.offset?t.offset+pi(e):t.offset,r=t.offset<e.offset?e.offset+pi(t):e.offset;return[[{...t,offset:n}],[{...e,offset:r}]]}return t.type==="insert_text"&&e.type==="delete_text"?[[{...t,offset:mo(t.offset,e.from,e.to)}],ud(e,t)]:t.type==="delete_text"&&e.type==="insert_text"?[ud(t,e),[{...e,offset:mo(e.offset,t.from,t.to)}]]:t.type==="delete_text"&&e.type==="delete_text"?[dd(t,e),dd(e,t)]:fo(t)&&e.type==="insert_text"?[fd(t,e),[e]]:t.type==="insert_text"&&fo(e)?[[t],fd(e,t)]:fo(t)&&e.type==="delete_text"?[pd(t,e),[e]]:t.type==="delete_text"&&fo(e)?[[t],pd(e,t)]:[[t],km(e,t)]}function ud(t,e){let n=pi(e);return e.offset<=t.from?[{...t,from:t.from+n,to:t.to+n}]:e.offset>=t.to?[t]:[{...t,from:e.offset+n,to:t.to+n},{...t,from:t.from,to:e.offset}]}function dd(t,e){let n=mo(t.from,e.from,e.to),r=mo(t.to,e.from,e.to);return r>n?[{...t,from:n,to:r}]:[]}function po(t,e,n,r=0){return t.type==="restore_marks"?{...t,from:e+r,to:n+r,segments:Va(t.segments,e-t.from,n-t.from)}:{...t,from:e+r,to:n+r}}function Va(t,e,n){let r=[],o=0;for(let s of t){let i=Math.max(e,o),a=Math.min(n,o+s.length);i<a&&r.push(s.marks?{length:a-i,marks:s.marks}:{length:a-i}),o+=s.length}return r}function fd(t,e){let n=pi(e);return e.offset<=t.from?[po(t,t.from,t.to,n)]:e.offset>=t.to?[t]:[po(t,t.from,e.offset),po(t,e.offset,t.to,n)]}function pd(t,e){let n=mo(t.from,e.from,e.to),r=mo(t.to,e.from,e.to);if(r<=n)return[];if(t.type!=="restore_marks")return[{...t,from:n,to:r}];let o=Math.max(t.from,e.from)-t.from,s=Math.min(t.to,e.to)-t.from,i=s>o?[...Va(t.segments,0,o),...Va(t.segments,s,t.to-t.from)]:t.segments;return[{...t,from:n,to:r,segments:i}]}function km(t,e){let n=Math.max(e.from,t.from),r=Math.min(e.to,t.to);if(n>=r)return[t];let o=[];t.from<n&&o.push(po(t,t.from,n));let s=wm(t,e,n,r);return s&&o.push(s),r<t.to&&o.push(po(t,r,t.to)),o}function wm(t,e,n,r){let o=po(t,n,r);if(t.type==="comment_text"||e.type==="comment_text")return t.type==="comment_text"&&e.type==="comment_text"&&t.id===e.id&&t.on!==e.on?null:o;if(e.type==="restore_marks")return null;if(e.type==="format_text"&&t.type==="format_text"){let s=Object.fromEntries(Object.entries(t.patch).filter(([i])=>!(i in e.patch)));return Object.keys(s).length>0?{...o,patch:s}:null}if(e.type==="format_text"&&t.type==="restore_marks"){let s=o.segments.map(i=>{let a=Ho(i.marks,e.patch);return a&&Object.keys(a).length>0?{length:i.length,marks:a}:{length:i.length}});return{...o,segments:Sm(s)}}return o}function Sm(t){let e=[];for(let n of t){let r=e[e.length-1];r&&js(r.marks,n.marks)?r.length+=n.length:e.push({...n})}return e}var hd=t=>na(t),gs={apply:(t,e)=>Mn.apply(t,e).state,transform:$n,rebase:md,mapMeta:(t,e)=>t&&qo(t,e),mapPresence:(t,e)=>{let n=t.selection;if(!n)return t;let r=qo(n,e);return r===n?t:{...t,selection:r}},hash:hd};function Za(t){return ra({kind:"document",core:t,model:gs,comments:{get:()=>t.comments,enable:e=>t.enableComments({...e,store:e.store??"document"})}})}var xm=1e3;function yd(t="Untitled"){return{id:T("doc_"),type:"document",title:t,blocks:[]}}var ye,rn,ct,on,Ln,go,gr,Ye,sn,yo,Bt,bo,z,nn,In,ho,ys,Ya,Qa,el,tl,mi,hi,bs,bd,ks=class extends Oo{constructor(n=yd(),r={}){super(n,Mn);D(this,z);D(this,ye);D(this,rn,null);D(this,ct,null);D(this,on,0);D(this,Ln,null);D(this,go,new Set);D(this,gr);D(this,Ye,new Map);D(this,sn,null);D(this,yo,!1);D(this,Bt,null);D(this,bo,!1);x(this,gr,r.storage??null),r.comments&&k(this,z,Ya).call(this,r.comments),x(this,Bt,r.suggestions?.users??null),x(this,ye,Ks(n,null)),this.subscribe(o=>{et(this,on)._++;let s=o.origin==="remote"&&o.meta===void 0&&m(this,ye)?qo(m(this,ye),o.ops,o.state):m(this,ye),i=Ks(o.state,o.meta!==void 0?o.meta:s);k(this,z,hi).call(this,i)})}get selection(){return m(this,ye)}get pendingMarks(){return m(this,ct)}get revision(){return m(this,on)}get comments(){return m(this,sn)}get storage(){return m(this,gr)}setStorage(n){x(this,gr,n),k(this,z,nn).call(this)}uploadState(n){return m(this,Ye).get(n)?.state}get pendingUploads(){let n=0;for(let r of m(this,Ye).values())r.state.status==="uploading"&&n++;return n}async whenUploadsSettle(){for(;;){let n=[...m(this,Ye).values()].filter(r=>r.state.status==="uploading");if(n.length===0)return;await Promise.all(n.map(r=>r.done))}}uploadImage(n,r,o={}){let s=m(this,gr);if(!s)throw new S("unsupported","This document has no storage client to upload to.");let i=m(this,Ye).get(n);if(i?.state.status==="uploading")return i.done;let a=Es(),l=this.state,u={file:r,options:o,handle:a,state:{status:"uploading",progress:0},done:Promise.resolve({status:"gone",merged:!1})};m(this,Ye).set(n,u),k(this,z,nn).call(this);let c=0;return u.done=(async()=>{try{let d=await s.upload(r,{...o,signal:a.signal,onProgress:h=>{h-c<.05&&h<1||(c=h,u.state={status:"uploading",progress:h},k(this,z,nn).call(this))}});if(d.url&&s.prime(d.ref,d.url),m(this,Ye).delete(n),J(this.state,n)?.block?.type!=="image")return k(this,z,nn).call(this),{status:"gone",merged:!1};let p=this.state===l;return this.updateBlock(n,{src:d.ref},{merge:p}),k(this,z,nn).call(this),{status:"stored",merged:p}}catch(d){let f=d instanceof S?d:new S("storage",`Upload failed: ${d instanceof Error?d.message:String(d)}`,{cause:d});return J(this.state,n)?.block.type==="image"?u.state={status:"failed",error:f}:m(this,Ye).delete(n),k(this,z,nn).call(this),{status:"failed",merged:!1,error:f}}})(),u.done}retryUpload(n){let r=m(this,Ye).get(n);return!r||r.state.status!=="failed"?null:this.uploadImage(n,r.file,r.options)}cancelUpload(n){m(this,Ye).get(n)?.handle.abort()}dismissUpload(n){m(this,Ye).get(n)?.state.status==="failed"&&(m(this,Ye).delete(n),k(this,z,nn).call(this))}select(n){k(this,z,hi).call(this,Ks(this.state,n))}selectAll(){k(this,z,hi).call(this,kc(this.state))}onSelectionChange(n){return m(this,go).add(n),()=>m(this,go).delete(n)}exec(n){return k(this,z,In).call(this,n)}transact(n,r){x(this,Ln,null);let o=r?.origin==="remote"?{ops:n,renames:new Map}:nd(this.state,n);if(o.renames.size>0&&r?.after){let s=i=>({block:o.renames.get(i.block)??i.block,offset:i.offset});r={...r,after:{anchor:s(r.after.anchor),focus:s(r.after.focus)}}}super.transact(ed(this.state,o.ops),r)}undo(){return x(this,Ln,null),super.undo()}redo(){return x(this,Ln,null),super.redo()}get suggestionsEnabled(){return!!m(this,Bt)}get suggestionUsers(){return m(this,Bt)}get canSuggest(){return!!m(this,Bt)?.current&&m(this,Bt).role!=="viewer"}get suggesting(){return m(this,bo)&&this.canSuggest}setSuggesting(n){return n&&!this.canSuggest?!1:(m(this,bo)===n||(x(this,bo,n),x(this,ct,null),k(this,z,nn).call(this)),!0)}get suggestions(){return ui(this.state)}canResolveSuggestion(n,r){let o=m(this,Bt)?.current;if(!o)return!1;let s=m(this,Bt).role;return s==="editor"?!0:s==="commenter"&&r==="reject"&&n.by===o.id}acceptSuggestion(n){return k(this,z,ys).call(this,"accept",n)}rejectSuggestion(n){return k(this,z,ys).call(this,"reject",n)}acceptAllSuggestions(){return k(this,z,ys).call(this,"accept")}rejectAllSuggestions(){return k(this,z,ys).call(this,"reject")}typeText(n,r){if(this.suggesting){let s=k(this,z,In).call(this,Ha(n,k(this,z,ho).call(this),r??m(this,ct)??void 0),n===`
`?void 0:"insert");return x(this,ct,null),s}let o=k(this,z,In).call(this,co(n,r??m(this,ct)??void 0),n===`
`?void 0:"insert");return x(this,ct,null),o}pastePlainText(n){return this.suggesting?this.exec(Ha(n.replace(/\r\n?/g,`
`),k(this,z,ho).call(this))):this.exec(Ku(n))}paste(n,r){let o=vu(n,r);if(!o)return{applied:!1,unsizedImages:[]};if(o.source==="text")return{applied:this.pastePlainText(o.text),unsizedImages:[]};if(this.suggesting)return{applied:this.pastePlainText(us(o.blocks).map(i=>"runs"in i?H(i.runs):"").join(`
`)),unsizedImages:[]};let s=this.exec(Cu(o.blocks,o.footnotes,o.styles));return{applied:s,unsizedImages:s?o.unsizedImages:[]}}splitBlock(){return this.exec(ii())}backspace(){return this.suggesting?k(this,z,In).call(this,hs("backspace",k(this,z,ho).call(this)),"backspace"):k(this,z,In).call(this,uo(),"backspace")}deleteForward(){return this.suggesting?k(this,z,In).call(this,hs("delete",k(this,z,ho).call(this)),"delete"):k(this,z,In).call(this,ds(),"delete")}deleteSelection(){return this.suggesting?this.exec(hs("selection",k(this,z,ho).call(this))):this.exec(lo())}toggleMark(n){let r=m(this,ye);return r?ge(r)?k(this,z,mi).call(this,Ua(n,!k(this,z,tl).call(this)[n])):this.exec(Mu(n)):!1}setMarks(n){let r=m(this,ye);return r&&ge(r)?k(this,z,mi).call(this,n):this.exec(fs(n))}clearFormatting(){return this.exec($u())}setImageWrap(n){let r=m(this,ye),o=r?J(this.state,r.focus.block)?.block:void 0;if(!o||o.type!=="image")return!1;if((o.wrap??null)===n)return!0;let{wrap:s,...i}=o;return this.transact([{type:"replace_block",id:o.id,block:n?{...i,wrap:n}:i}]),!0}setImageCrop(n,r={}){let o=m(this,ye),s=o?J(this.state,o.focus.block)?.block:void 0;return!s||s.type!=="image"?!1:this.cropImage(s.id,n,r)}cropImage(n,r,o={}){let s=J(this.state,n)?.block;if(!s||s.type!=="image")return!1;let i=r&&(r.top>0||r.right>0||r.bottom>0||r.left>0)?r:null,{crop:a,...l}=s,{width:u,height:c}=s;if(o.rescale){let d=a??{top:0,right:0,bottom:0,left:0},f=i??{top:0,right:0,bottom:0,left:0},p=s.width/(1-d.left-d.right),h=s.height/(1-d.top-d.bottom);u=Math.max(Math.round(p*(1-f.left-f.right)),1),c=Math.max(Math.round(h*(1-f.top-f.bottom)),1)}return this.transact([{type:"replace_block",id:n,block:{...l,width:u,height:c,...i&&{crop:i}}}],o.merge?{merge:!0}:void 0),!0}get croppingImage(){return m(this,rn)}setCropping(n){let r=m(this,ye),o=r?J(this.state,r.focus.block)?.block:void 0;if(n&&(!o||o.type!=="image"))return!1;let s=n?o.id:null;return s===m(this,rn)||(x(this,rn,s),et(this,on)._++,k(this,z,bs).call(this)),!0}get styles(){return this.state.styles??{}}applyParagraphStyle(n){return this.exec(Wu(n))}applyCharacterStyle(n){let r=m(this,ye);return n!==null&&this.state.styles?.[n]?.kind!=="character"?!1:r&&ge(r)?k(this,z,mi).call(this,{style:n}):this.exec(qu(n))}createStyle(n,r){let o=xc(this.state,n);return this.exec(Ga({id:o,name:n.trim()||"Style",kind:r}))?o:null}updateStyleFromSelection(n){let r=this.state.styles?.[n];return r?this.exec(Ga({id:n,name:r.name,kind:r.kind,...r.basedOn&&{basedOn:r.basedOn}})):!1}setStyle(n,r){this.transact([{type:"set_style",id:n,style:r}])}changeStyle(n,r){let o=this.state.styles?.[n];return o?(this.transact([{type:"set_style",id:n,style:{...o,...r}}]),!0):!1}deleteStyle(n){return this.exec(Xu(n))}setParagraphFormat(n,r={}){if(!r.merge)return this.exec(za(n));let o=m(this,ye),s=o&&za(n)(this.state,o);return s?(this.transact(s.ops,{before:o,after:s.selection,merge:!0}),!0):!1}setLink(n,r){return this.exec(Hu(n,r))}insertBlockAtCaret(n){return this.exec(ps(n))}insertField(n){return this.exec(Gu(n))}insertTable(n,r,o){return this.exec(Iu(n,r,o))}addRow(n){return this.exec(Sa(n))}addColumn(n){return this.exec(vc(n))}deleteRow(){return this.exec(Cc())}deleteColumn(){return this.exec(Pc())}deleteTable(){return this.exec(Js())}mergeCells(){return this.exec(Bc())}splitCells(){return this.exec(Oc())}setRowHeight(n){return this.exec(Ec(n))}setCellVerticalAlign(n){return this.exec(Dc(n))}setHeaderRow(n){return this.exec(Mc(n))}setTableBorders(n){return this.exec(Ac(n))}setCellShade(n){return this.exec(Rc(n))}setColumnWidths(n){return this.exec(_c(n))}moveToCell(n){let r=m(this,ye);if(!r)return!1;let o=Nc(this.state,r,n);return o?"appendRow"in o?this.exec(Sa("below",0)):(this.select(U(o.to.block,o.to.offset)),!0):!1}setBlockType(n){return this.exec(si(n))}toggleBlockType(n){return this.exec(Ru(n))}indent(){return this.exec(ai())}outdent(){return this.exec(li())}setListMarker(n){return this.exec(_u(n))}setListStart(n){return this.exec(ja(n))}continueNumbering(){return this.exec(ja(null))}setAlign(n){return this.exec(Fu(n))}insertBlock(n,r=k(this,z,bd).call(this)){this.transact([{type:"insert_block",block:n,after:r}])}deleteBlock(n){let r=J(this.state,n);if(r?.cell&&r.list.length===1)throw new S("invalid_operation","A table cell must keep at least one block");this.transact([{type:"delete_block",id:n}])}insertText(n,r,o,s){let i=s?{text:o,marks:s}:{text:o};this.transact([{type:"insert_text",block:n,offset:r,runs:[i]}])}appendText(n,r,o){let s=J(this.state,n)?.block,i=s&&"runs"in s?W(s.runs):0;this.insertText(n,i,r,o)}deleteText(n,r,o){this.transact([{type:"delete_text",block:n,from:r,to:o}])}format(n,r,o,s){this.transact([{type:"format_text",block:n,from:r,to:o,patch:s}])}setTitle(n){this.transact([{type:"set_title",title:n}])}setPage(n,r={}){this.transact([{type:"set_page",page:n}],r.merge?{merge:!0}:void 0)}insertSectionBreak(n){return this.exec(ju(n))}setColumns(n){return this.exec(zu(n))}replaceDocument(n){let r=this.state,o=ie(r.blocks);for(let l of ie(n.blocks))if(o.has(l))throw new S("invalid_operation",`Block id "${l}" is already in the document`);let s=[];n.title!==r.title&&s.push({type:"set_title",title:n.title}),JSON.stringify(n.page??null)!==JSON.stringify(r.page??null)&&s.push({type:"set_page",page:n.page??null});let i=r.blocks[r.blocks.length-1]?.id??null;for(let l of n.blocks)s.push({type:"insert_block",block:l,after:i}),i=l.id;for(let l of r.blocks)s.push({type:"delete_block",id:l.id});for(let l of ao)(r[l]!==void 0||n[l]!==void 0)&&s.push({type:"set_region",region:l,blocks:n[l]??null});for(let l of Object.keys(r.footnotes??{}))n.footnotes?.[l]||s.push({type:"set_footnote",id:l,blocks:null});for(let[l,u]of Object.entries(n.footnotes??{}))s.push({type:"set_footnote",id:l,blocks:u});for(let l of Object.keys(r.styles??{}))n.styles?.[l]||s.push({type:"set_style",id:l,style:null});for(let[l,u]of Object.entries(n.styles??{}))s.push({type:"set_style",id:l,style:u});if(m(this,yo)){for(let l of Object.keys(r.comments??{}))n.comments?.[l]||s.push({type:"set_thread",id:l,thread:null});for(let[l,u]of Object.entries(n.comments??{}))s.push({type:"set_thread",id:l,thread:u})}let a=n.blocks.find(F);this.transact(s,{before:this.selection,after:a?U(a.id,0):null}),m(this,yo)&&m(this,sn)?.reload()}setRegion(n,r){this.transact([{type:"set_region",region:n,blocks:r}])}comment(n,r=this.selection,o){let s=m(this,sn);if(!s)throw new S("unsupported","Comments aren't turned on: pass `comments` when making the session");if(!r||ge(r))return null;let i=ha(this.state,r);if(!i)return null;let a=T("th_"),l=wc(this.state,r,a),u=s.createThread(n,i,a,o);return this.transact(l,{before:r,after:r}),u}enableComments(n){return m(this,sn)||k(this,z,Ya).call(this,n),m(this,sn)}setFootnote(n,r){this.transact([{type:"set_footnote",id:n,blocks:r}])}insertFootnote(n){let r=T("fn_");return this.exec(Uu(r,n))?r:null}setSectionRegion(n,r,o){if(n===0)return this.setRegion(r,o&&o.length>0?o:null);let s=Pt(this.state)[n]?.start;if(!s)throw new S("not_found",`No section ${n}`);let{[r]:i,...a}=s.regions??{},l=o?{...a,[r]:o}:a,{regions:u,...c}=s;this.transact([{type:"replace_block",id:s.id,block:Object.keys(l).length>0?{...c,regions:l}:c}])}setPageShape(n,r="document",o={}){let s=this.state,i=Pt(s),a=jt(s),l=[];if(r==="document"){l.push({type:"set_page",page:{...a,size:n.size,orientation:n.orientation,margins:n.margins}});for(let u of i)if(u.start?.page){let{page:c,...d}=u.start;l.push({type:"replace_block",id:u.start.id,block:d})}}else{let u=i[r];if(!u)throw new S("not_found",`No section ${r}`);let c=zt(s,i,r);if(Yo(c,n))return;r===0?l.push({type:"set_page",page:{...a,size:n.size,orientation:n.orientation,margins:n.margins}}):l.push({type:"replace_block",id:u.start.id,block:{...u.start,page:{size:n.size,orientation:n.orientation,margins:n.margins}}});let d=i[r+1]?.start;d&&!d.page&&l.push({type:"replace_block",id:d.id,block:{...d,page:{size:c.size,orientation:c.orientation,margins:c.margins}}})}l.length>0&&this.transact(l,o.merge?{merge:!0}:void 0)}setSectionFirstPage(n,r){if(n===0)return this.setRegionOptions({differentFirstPage:r});let o=Pt(this.state)[n]?.start;if(!o)throw new S("not_found",`No section ${n}`);if(!!o.differentFirstPage===r)return;let{differentFirstPage:s,...i}=o;this.transact([{type:"replace_block",id:o.id,block:r?{...i,differentFirstPage:!0}:i}])}setRegionOptions(n){let r=this.state.page??va,o={...r};for(let s of["differentFirstPage","differentOddEven"]){let i=n[s];i!==void 0&&(i?o[s]=!0:delete o[s])}JSON.stringify(o)!==JSON.stringify(r)&&this.setPage(o)}insertColumns(n){return this.exec(Lu(n))}updateBlock(n,r,o={}){let s=J(this.state,n)?.block;if(!s)throw new S("not_found",`No block with id "${n}"`);this.transact([{type:"replace_block",id:n,block:{...s,...r}}],o.merge?{merge:!0}:void 0)}};ye=new WeakMap,rn=new WeakMap,ct=new WeakMap,on=new WeakMap,Ln=new WeakMap,go=new WeakMap,gr=new WeakMap,Ye=new WeakMap,sn=new WeakMap,yo=new WeakMap,Bt=new WeakMap,bo=new WeakMap,z=new WeakSet,nn=function(){et(this,on)._++,k(this,z,bs).call(this)},In=function(n,r){let o=m(this,ye);if(!o)return!1;let s=n(this.state,o);if(!s)return!1;let i=Date.now(),a=m(this,Ln),l=!!r&&!!a&&a.kind===r&&i-a.at<xm&&ge(o)&&gd(a.after,o);return this.transact(s.ops,{before:o,after:s.selection,merge:l}),x(this,Ln,r?{kind:r,at:i,after:s.selection}:null),!0},ho=function(){return{by:m(this,Bt).current.id,at:Date.now(),newId:()=>T("sg_")}},ys=function(n,r){let o=new Map(this.suggestions.map(i=>[i.id,this.canResolveSuggestion(i,n)])),s=Yu(this.state,n,i=>(r===void 0||i.id===r)&&!!o.get(i.id));return s.length===0?!1:(this.transact(s,{before:m(this,ye),after:m(this,ye)}),!0)},Ya=function(n){let r=this,o=n.store===void 0||n.store==="document",s=ba({get state(){return r.state},write:l=>r.transact(l,{origin:"remote"})}),i=o?s:n.store,a=new tr({file:this.state.id,users:n.users,store:i,initial:Object.values(this.state.comments??{}),permissions:n.permissions,onError:(l,u)=>{u.type==="thread.create"&&k(this,z,Qa).call(this,u.thread.id,n.synced?"shared":"remote"),n.onError?.(l,u)}});a.onChange((l,u)=>{o&&u==="remote"&&s.save(this.state.id,l),l.type==="thread.delete"?(!n.synced||u==="local")&&k(this,z,Qa).call(this,l.threadId,n.synced?"shared":"remote"):l.type==="thread.create"&&u==="remote"&&!n.synced&&k(this,z,el).call(this,l.thread)}),n.synced||a.ready.then(()=>{for(let l of a.threads)k(this,z,el).call(this,l)}),x(this,sn,a),x(this,yo,o),o&&sa(a,this,l=>l.type==="set_thread")},Qa=function(n,r="remote"){let o=Sc(this.state,n);o.length>0&&this.transact(o,r==="shared"?{history:!1}:{origin:"remote"})},el=function(n){if(pa(this.state.blocks).has(n.id))return;let r=ga(this.state,n);r.length>0&&this.transact(r,{origin:"remote"})},tl=function(){if(m(this,ct))return m(this,ct);let n=m(this,ye);if(!n)return{};let r=J(this.state,n.focus.block)?.block;return(r&&F(r)?Fn(r,n.focus.offset):void 0)??{}},mi=function(n){return m(this,ye)?(x(this,ct,Ho(k(this,z,tl).call(this),n)??{}),et(this,on)._++,k(this,z,bs).call(this),!0):!1},hi=function(n){gd(m(this,ye),n)||(x(this,ye,n),m(this,rn)&&n?.focus.block!==m(this,rn)&&x(this,rn,null),x(this,ct,null),et(this,on)._++,k(this,z,bs).call(this))},bs=function(){for(let n of m(this,go))n(m(this,ye))},bd=function(){return this.state.blocks[this.state.blocks.length-1]?.id??null};function gd(t,e){return t===e?!0:!t||!e?!1:t.anchor.block===e.anchor.block&&t.anchor.offset===e.anchor.offset&&t.focus.block===e.focus.block&&t.focus.offset===e.focus.offset}var gi=["bold","italic","underline","strike","code","superscript","subscript"];function vm(t,e){let n=bt(t,e),r=J(t,e.focus.block);if(!r)return null;let o=!n&&r.block.type==="table",s=r.cell,i=o?r.block:s?.table;if(!i)return null;let a=o?{row1:0,row2:i.rows.length-1,col1:0,col2:i.columns.length-1}:n??Qt(s.cell,s.row,s.col),l=o?null:n?n.row1:s.row,u=o?null:n?n.col1:s.col,c=l===null||u===null?void 0:i.rows[l]?.cells[u];return{id:i.id,rows:i.rows.length,columns:i.columns.length,row:l,column:u,selectedRows:o?i.rows.length:a.row2-a.row1+1,selectedColumns:o?i.columns.length:a.col2-a.col1+1,headerRow:!!i.headerRow,borders:i.borders??"all",shade:c?.shade,vAlign:c?.vAlign??"top",rowHeight:l===null?void 0:i.rows[l]?.height,canMerge:!!n,canSplit:lr(i,a).some(({cell:d})=>yt(d)>1||it(d)>1)}}function Cm(t,e){let n=J(t,e.focus.block),r=n?.block;if(!n||!r||r.type!=="list_item")return null;let o=ro(n.list)[n.index];return{kind:r.list,marker:En(r),number:o??null,restarts:r.start!==void 0}}function kd(t){switch(t.type){case"heading":return{type:"heading",level:t.level};case"list_item":return{type:"list_item",list:t.list};case"code_block":return{type:"code_block"};default:return{type:t.type}}}function Pm(t,e){return t.type!==e.type?!1:t.type==="heading"&&e.type==="heading"?t.level===e.level:t.type==="list_item"&&e.type==="list_item"?t.list===e.list:!0}function wd(t,e,n){if(n)return n;let r=J(t,e.focus.block)?.block;return r&&F(r)?Fn(r,e.focus.offset):void 0}function Sd(t,e,n=null){let r=Object.fromEntries(gi.map(s=>[s,!1]));if(ge(e)){let s=wd(t,e,n);for(let i of gi)r[i]=s?.[i]===!0;return r}let o=hr(t,e);if(o.length===0)return r;for(let s of gi)r[s]=o.every(i=>zs(i.block.runs,i.from,i.to,s));return r}function yr(t,e,n,r=null){if(ge(e))return{value:wd(t,e,r)?.[n],mixed:!1};let o=new Set,s,i=!1;for(let a of hr(t,e))for(let l of le(a.block.runs,a.from,a.to)){let u=l.marks?.[n];i||(s=u),i=!0,o.add(u)}return{value:s,mixed:o.size>1}}function xd(t,e){let n=Ge(t,e).filter(F),r=n[0];if(!r)return null;let o=kd(r);return n.every(s=>Pm(kd(s),o))?o:null}function Bm(t,e){let n=Ge(t,e).filter(Te);if(n.length===0)return null;let r=n[0].style??null;return n.every(o=>(o.style??null)===r)?r:null}function vd(t,e){let n=Ge(t,e).filter(o=>Te(o)||o.type==="image");if(n.length===0)return null;let r=new Set(n.map(o=>"align"in o&&Ut(t,o).align||"left"));return r.size===1?[...r][0]:null}function nl(t,e,n=null){if(!e){let i={value:void 0,mixed:!1};return{marks:Object.fromEntries(gi.map(a=>[a,!1])),fontFamily:i,fontSize:i,color:i,highlight:i,link:i,block:null,align:null,paragraphStyle:null,characterStyle:i,format:{},list:null,image:null,table:null,canIndent:!1,canOutdent:!1,columns:pr(t.page?.columns),section:0}}let o=Ge(t,e).find(Te),s=J(t,e.focus.block)?.block;return{marks:Sd(t,e,n),fontFamily:yr(t,e,"fontFamily",n),fontSize:yr(t,e,"fontSize",n),color:yr(t,e,"color",n),highlight:yr(t,e,"highlight",n),link:yr(t,e,"link",n),block:xd(t,e),align:vd(t,e),paragraphStyle:Bm(t,e),characterStyle:yr(t,e,"style",n),format:o?Ut(t,o).format??{}:{},list:Cm(t,e),image:ge(e)&&s?.type==="image"?s:null,table:vm(t,e),canIndent:ai()(t,e)!==null,canOutdent:li()(t,e)!==null,columns:s?no(t,J(t,s.id).topIndex):pr(t.page?.columns),section:s?jc(t,J(t,s.id).topIndex):0}}function Om(t){let{table:e,row1:n,row2:r,col1:o,col2:s}=t,{headerRow:i,...a}=e;return{...a,rows:e.rows.slice(n,r+1).map(l=>({...l,cells:l.cells.slice(o,s+1)})),columns:at(e.columns.slice(o,s+1)),...n===0&&e.headerRow&&{headerRow:!0}}}function yi(t,e){let n=Mm(t,e),{footnotes:r,...o}=n,s=Object.fromEntries(Ze(n.blocks).flatMap(l=>t.footnotes?.[l]?[[l,t.footnotes[l]]]:[])),i={},a=l=>{for(let u=l;u!==void 0&&t.styles?.[u]&&!i[u];u=t.styles[u].basedOn)i[u]=t.styles[u]};for(let l of Vs(n.blocks))a(l);return{...o,...Object.keys(s).length>0&&{footnotes:s},...Object.keys(i).length>0&&{styles:i}}}function Mm(t,e){if(ge(e))return{...t,blocks:[]};let n=bt(t,e);if(n)return{...t,blocks:[Om(n)]};let r=Je(t,e),o=new Set(r.map(a=>a.block.id)),s=new Set,i=[];for(let{block:a,from:l,to:u}of r)if(!s.has(a.id)){if(a.type==="table"){let c=ie([a]);c.delete(a.id);let d=[...c].filter(f=>!a.rows.some(p=>p.id===f||p.cells.some(h=>h.id===f)));if(d.every(f=>o.has(f))){i.push(a);for(let f of d)s.add(f)}continue}i.push(F(a)?{...a,runs:le(a.runs,l,u)}:a)}return{...t,blocks:i}}function Am(t){return/[\t\n\r"]/.test(t)?`"${t.replace(/"/g,'""')}"`:t}function Tm(t){return t.rows.map(e=>e.cells.map(n=>n.covered?"":Am(n.blocks.map(r=>F(r)?H(r.runs):"").join(`
`))).join("	")).join(`
`)}function bi(t,e){return yi(t,e).blocks.map(n=>n.type==="table"?Tm(n):F(n)?H(n.runs).replaceAll(Tn,""):"").join(`
`)}function rl(t){let e=0,n=0,r=0;for(let o of Pn(t.blocks)){if(!F(o))continue;let s=H(o.runs).replaceAll(Tn,"");n+=s.length,r+=s.replace(/\s/g,"").length,e+=s.split(/\s+/).filter(i=>/[\p{L}\p{N}]/u.test(i)).length}return{words:e,characters:n,charactersNoSpaces:r}}var Se=Uint8Array,ut=Uint16Array,ml=Int32Array,ki=new Se([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),wi=new Se([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),ll=new Se([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Ad=function(t,e){for(var n=new ut(31),r=0;r<31;++r)n[r]=e+=1<<t[r-1];for(var o=new ml(n[30]),r=1;r<30;++r)for(var s=n[r];s<n[r+1];++s)o[s]=s-n[r]<<5|r;return{b:n,r:o}},Td=Ad(ki,2),Rd=Td.b,cl=Td.r;Rd[28]=258,cl[258]=28;var Dd=Ad(wi,0),Rm=Dd.b,Cd=Dd.r,ul=new ut(32768);for(re=0;re<32768;++re)an=(re&43690)>>1|(re&21845)<<1,an=(an&52428)>>2|(an&13107)<<2,an=(an&61680)>>4|(an&3855)<<4,ul[re]=((an&65280)>>8|(an&255)<<8)>>1;var an,re,Ht=(function(t,e,n){for(var r=t.length,o=0,s=new ut(e);o<r;++o)t[o]&&++s[t[o]-1];var i=new ut(e);for(o=1;o<e;++o)i[o]=i[o-1]+s[o-1]<<1;var a;if(n){a=new ut(1<<e);var l=15-e;for(o=0;o<r;++o)if(t[o])for(var u=o<<4|t[o],c=e-t[o],d=i[t[o]-1]++<<c,f=d|(1<<c)-1;d<=f;++d)a[ul[d]>>l]=u}else for(a=new ut(r),o=0;o<r;++o)t[o]&&(a[o]=ul[i[t[o]-1]++]>>15-t[o]);return a}),Un=new Se(288);for(re=0;re<144;++re)Un[re]=8;var re;for(re=144;re<256;++re)Un[re]=9;var re;for(re=256;re<280;++re)Un[re]=7;var re;for(re=280;re<288;++re)Un[re]=8;var re,xs=new Se(32);for(re=0;re<32;++re)xs[re]=5;var re,Dm=Ht(Un,9,0),Em=Ht(Un,9,1),_m=Ht(xs,5,0),Nm=Ht(xs,5,1),ol=function(t){for(var e=t[0],n=1;n<t.length;++n)t[n]>e&&(e=t[n]);return e},Ot=function(t,e,n){var r=e/8|0;return(t[r]|t[r+1]<<8)>>(e&7)&n},sl=function(t,e){var n=e/8|0;return(t[n]|t[n+1]<<8|t[n+2]<<16)>>(e&7)},hl=function(t){return(t+7)/8|0},vs=function(t,e,n){return(e==null||e<0)&&(e=0),(n==null||n>t.length)&&(n=t.length),new Se(t.subarray(e,n))};var Fm=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],je=function(t,e,n){var r=new Error(e||Fm[t]);if(r.code=t,Error.captureStackTrace&&Error.captureStackTrace(r,je),!n)throw r;return r},$m=function(t,e,n,r){var o=t.length,s=r?r.length:0;if(!o||e.f&&!e.l)return n||new Se(0);var i=!n,a=i||e.i!=2,l=e.i;i&&(n=new Se(o*3));var u=function(qt){var Xt=n.length;if(qt>Xt){var ft=new Se(Math.max(Xt*2,qt));ft.set(n),n=ft}},c=e.f||0,d=e.p||0,f=e.b||0,p=e.l,h=e.d,g=e.m,y=e.n,b=o*8;do{if(!p){c=Ot(t,d,1);var w=Ot(t,d+1,3);if(d+=3,w)if(w==1)p=Em,h=Nm,g=9,y=5;else if(w==2){var R=Ot(t,d,31)+257,A=Ot(t,d+10,15)+4,$=R+Ot(t,d+5,31)+1;d+=14;for(var P=new Se($),B=new Se(19),v=0;v<A;++v)B[ll[v]]=Ot(t,d+v*3,7);d+=A*3;for(var N=ol(B),L=(1<<N)-1,q=Ht(B,N,1),v=0;v<$;){var Z=q[Ot(t,d,L)];d+=Z&15;var O=Z>>4;if(O<16)P[v++]=O;else{var X=0,V=0;for(O==16?(V=3+Ot(t,d,3),d+=2,X=P[v-1]):O==17?(V=3+Ot(t,d,7),d+=3):O==18&&(V=11+Ot(t,d,127),d+=7);V--;)P[v++]=X}}var Y=P.subarray(0,R),de=P.subarray(R);g=ol(Y),y=ol(de),p=Ht(Y,g,1),h=Ht(de,y,1)}else je(1);else{var O=hl(d)+4,_=t[O-4]|t[O-3]<<8,M=O+_;if(M>o){l&&je(0);break}a&&u(f+_),n.set(t.subarray(O,M),f),e.b=f+=_,e.p=d=M*8,e.f=c;continue}if(d>b){l&&je(0);break}}a&&u(f+131072);for(var we=(1<<g)-1,Pe=(1<<y)-1,De=d;;De=d){var X=p[sl(t,d)&we],Me=X>>4;if(d+=X&15,d>b){l&&je(0);break}if(X||je(2),Me<256)n[f++]=Me;else if(Me==256){De=d,p=null;break}else{var $e=Me-254;if(Me>264){var v=Me-257,pe=ki[v];$e=Ot(t,d,(1<<pe)-1)+Rd[v],d+=pe}var Ee=h[sl(t,d)&Pe],dn=Ee>>4;Ee||je(3),d+=Ee&15;var de=Rm[dn];if(dn>3){var pe=wi[dn];de+=sl(t,d)&(1<<pe)-1,d+=pe}if(d>b){l&&je(0);break}a&&u(f+131072);var dt=f+$e;if(f<de){var vr=s-de,be=Math.min(de,dt);for(vr+f<0&&je(3);f<be;++f)n[f]=r[vr+f]}for(;f<dt;++f)n[f]=n[f-de]}}e.l=p,e.p=De,e.b=f,e.f=c,p&&(c=1,e.m=g,e.d=h,e.n=y)}while(!c);return f!=n.length&&i?vs(n,0,f):n.subarray(0,f)},ln=function(t,e,n){n<<=e&7;var r=e/8|0;t[r]|=n,t[r+1]|=n>>8},ws=function(t,e,n){n<<=e&7;var r=e/8|0;t[r]|=n,t[r+1]|=n>>8,t[r+2]|=n>>16},il=function(t,e){for(var n=[],r=0;r<t.length;++r)t[r]&&n.push({s:r,f:t[r]});var o=n.length,s=n.slice();if(!o)return{t:_d,l:0};if(o==1){var i=new Se(n[0].s+1);return i[n[0].s]=1,{t:i,l:1}}n.sort(function(M,R){return M.f-R.f}),n.push({s:-1,f:25001});var a=n[0],l=n[1],u=0,c=1,d=2;for(n[0]={s:-1,f:a.f+l.f,l:a,r:l};c!=o-1;)a=n[n[u].f<n[d].f?u++:d++],l=n[u!=c&&n[u].f<n[d].f?u++:d++],n[c++]={s:-1,f:a.f+l.f,l:a,r:l};for(var f=s[0].s,r=1;r<o;++r)s[r].s>f&&(f=s[r].s);var p=new ut(f+1),h=dl(n[c-1],p,0);if(h>e){var r=0,g=0,y=h-e,b=1<<y;for(s.sort(function(R,A){return p[A.s]-p[R.s]||R.f-A.f});r<o;++r){var w=s[r].s;if(p[w]>e)g+=b-(1<<h-p[w]),p[w]=e;else break}for(g>>=y;g>0;){var O=s[r].s;p[O]<e?g-=1<<e-p[O]++-1:++r}for(;r>=0&&g;--r){var _=s[r].s;p[_]==e&&(--p[_],++g)}h=e}return{t:new Se(p),l:h}},dl=function(t,e,n){return t.s==-1?Math.max(dl(t.l,e,n+1),dl(t.r,e,n+1)):e[t.s]=n},Pd=function(t){for(var e=t.length;e&&!t[--e];);for(var n=new ut(++e),r=0,o=t[0],s=1,i=function(l){n[r++]=l},a=1;a<=e;++a)if(t[a]==o&&a!=e)++s;else{if(!o&&s>2){for(;s>138;s-=138)i(32754);s>2&&(i(s>10?s-11<<5|28690:s-3<<5|12305),s=0)}else if(s>3){for(i(o),--s;s>6;s-=6)i(8304);s>2&&(i(s-3<<5|8208),s=0)}for(;s--;)i(o);s=1,o=t[a]}return{c:n.subarray(0,r),n:e}},Ss=function(t,e){for(var n=0,r=0;r<e.length;++r)n+=t[r]*e[r];return n},Ed=function(t,e,n){var r=n.length,o=hl(e+2);t[o]=r&255,t[o+1]=r>>8,t[o+2]=t[o]^255,t[o+3]=t[o+1]^255;for(var s=0;s<r;++s)t[o+s+4]=n[s];return(o+4+r)*8},Bd=function(t,e,n,r,o,s,i,a,l,u,c){ln(e,c++,n),++o[256];for(var d=il(o,15),f=d.t,p=d.l,h=il(s,15),g=h.t,y=h.l,b=Pd(f),w=b.c,O=b.n,_=Pd(g),M=_.c,R=_.n,A=new ut(19),$=0;$<w.length;++$)++A[w[$]&31];for(var $=0;$<M.length;++$)++A[M[$]&31];for(var P=il(A,7),B=P.t,v=P.l,N=19;N>4&&!B[ll[N-1]];--N);var L=u+5<<3,q=Ss(o,Un)+Ss(s,xs)+i,Z=Ss(o,f)+Ss(s,g)+i+14+3*N+Ss(A,B)+2*A[16]+3*A[17]+7*A[18];if(l>=0&&L<=q&&L<=Z)return Ed(e,c,t.subarray(l,l+u));var X,V,Y,de;if(ln(e,c,1+(Z<q)),c+=2,Z<q){X=Ht(f,p,0),V=f,Y=Ht(g,y,0),de=g;var we=Ht(B,v,0);ln(e,c,O-257),ln(e,c+5,R-1),ln(e,c+10,N-4),c+=14;for(var $=0;$<N;++$)ln(e,c+3*$,B[ll[$]]);c+=3*N;for(var Pe=[w,M],De=0;De<2;++De)for(var Me=Pe[De],$=0;$<Me.length;++$){var $e=Me[$]&31;ln(e,c,we[$e]),c+=B[$e],$e>15&&(ln(e,c,Me[$]>>5&127),c+=Me[$]>>12)}}else X=Dm,V=Un,Y=_m,de=xs;for(var $=0;$<a;++$){var pe=r[$];if(pe>255){var $e=pe>>18&31;ws(e,c,X[$e+257]),c+=V[$e+257],$e>7&&(ln(e,c,pe>>23&31),c+=ki[$e]);var Ee=pe&31;ws(e,c,Y[Ee]),c+=de[Ee],Ee>3&&(ws(e,c,pe>>5&8191),c+=wi[Ee])}else ws(e,c,X[pe]),c+=V[pe]}return ws(e,c,X[256]),c+V[256]},Im=new ml([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),_d=new Se(0),Lm=function(t,e,n,r,o,s){var i=s.z||t.length,a=new Se(r+i+5*(1+Math.ceil(i/7e3))+o),l=a.subarray(r,a.length-o),u=s.l,c=(s.r||0)&7;if(e){c&&(l[0]=s.r>>3);for(var d=Im[e-1],f=d>>13,p=d&8191,h=(1<<n)-1,g=s.p||new ut(32768),y=s.h||new ut(h+1),b=Math.ceil(n/3),w=2*b,O=function(vo){return(t[vo]^t[vo+1]<<b^t[vo+2]<<w)&h},_=new ml(25e3),M=new ut(288),R=new ut(32),A=0,$=0,P=s.i||0,B=0,v=s.w||0,N=0;P+2<i;++P){var L=O(P),q=P&32767,Z=y[L];if(g[q]=Z,y[L]=q,v<=P){var X=i-P;if((A>7e3||B>24576)&&(X>423||!u)){c=Bd(t,l,0,_,M,R,$,B,N,P-N,c),B=A=$=0,N=P;for(var V=0;V<286;++V)M[V]=0;for(var V=0;V<30;++V)R[V]=0}var Y=2,de=0,we=p,Pe=q-Z&32767;if(X>2&&L==O(P-Pe))for(var De=Math.min(f,X)-1,Me=Math.min(32767,P),$e=Math.min(258,X);Pe<=Me&&--we&&q!=Z;){if(t[P+Y]==t[P+Y-Pe]){for(var pe=0;pe<$e&&t[P+pe]==t[P+pe-Pe];++pe);if(pe>Y){if(Y=pe,de=Pe,pe>De)break;for(var Ee=Math.min(Pe,pe-2),dn=0,V=0;V<Ee;++V){var dt=P-Pe+V&32767,vr=g[dt],be=dt-vr&32767;be>dn&&(dn=be,Z=dt)}}}q=Z,Z=g[q],Pe+=q-Z&32767}if(de){_[B++]=268435456|cl[Y]<<18|Cd[de];var qt=cl[Y]&31,Xt=Cd[de]&31;$+=ki[qt]+wi[Xt],++M[257+qt],++R[Xt],v=P+Y,++A}else _[B++]=t[P],++M[t[P]]}}for(P=Math.max(P,v);P<i;++P)_[B++]=t[P],++M[t[P]];c=Bd(t,l,u,_,M,R,$,B,N,P-N,c),u||(s.r=c&7|l[c/8|0]<<3,c-=7,s.h=y,s.p=g,s.i=P,s.w=v)}else{for(var P=s.w||0;P<i+u;P+=65535){var ft=P+65535;ft>=i&&(l[c/8|0]=u,ft=i),c=Ed(l,c+1,t.subarray(P,ft))}s.i=i}return vs(a,0,r+hl(c)+o)},Um=(function(){for(var t=new Int32Array(256),e=0;e<256;++e){for(var n=e,r=9;--r;)n=(n&1&&-306674912)^n>>>1;t[e]=n}return t})(),jm=function(){var t=-1;return{p:function(e){for(var n=t,r=0;r<e.length;++r)n=Um[n&255^e[r]]^n>>>8;t=n},d:function(){return~t}}};var zm=function(t,e,n,r,o){if(!o&&(o={l:1},e.dictionary)){var s=e.dictionary.subarray(-32768),i=new Se(s.length+t.length);i.set(s),i.set(t,s.length),t=i,o.w=s.length}return Lm(t,e.level==null?6:e.level,e.mem==null?o.l?Math.ceil(Math.max(8,Math.min(13,Math.log(t.length)))*1.5):20:12+e.mem,n,r,o)},Nd=function(t,e){var n={};for(var r in t)n[r]=t[r];for(var r in e)n[r]=e[r];return n};var Gt=function(t,e){return t[e]|t[e+1]<<8},wt=function(t,e){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0},al=function(t,e){return wt(t,e)+wt(t,e+4)*4294967296},Ie=function(t,e,n){for(;n;++e)t[e]=n,n>>>=8};function Gm(t,e){return zm(t,e||{},0,0)}function Hm(t,e){return $m(t,{i:2},e&&e.out,e&&e.dictionary)}var Fd=function(t,e,n,r){for(var o in t){var s=t[o],i=e+o,a=r;Array.isArray(s)&&(a=Nd(r,s[1]),s=s[0]),ArrayBuffer.isView(s)?n[i]=[s,a]:(n[i+="/"]=[new Se(0),a],Fd(s,i,n,r))}},Od=typeof TextEncoder<"u"&&new TextEncoder,fl=typeof TextDecoder<"u"&&new TextDecoder,Km=0;try{fl.decode(_d,{stream:!0}),Km=1}catch{}var Wm=function(t){for(var e="",n=0;;){var r=t[n++],o=(r>127)+(r>223)+(r>239);if(n+o>t.length)return{s:e,r:vs(t,n-1)};o?o==3?(r=((r&15)<<18|(t[n++]&63)<<12|(t[n++]&63)<<6|t[n++]&63)-65536,e+=String.fromCharCode(55296|r>>10,56320|r&1023)):o&1?e+=String.fromCharCode((r&31)<<6|t[n++]&63):e+=String.fromCharCode((r&15)<<12|(t[n++]&63)<<6|t[n++]&63):e+=String.fromCharCode(r)}};function Fe(t,e){if(e){for(var n=new Se(t.length),r=0;r<t.length;++r)n[r]=t.charCodeAt(r);return n}if(Od)return Od.encode(t);for(var o=t.length,s=new Se(t.length+(t.length>>1)),i=0,a=function(c){s[i++]=c},r=0;r<o;++r){if(i+5>s.length){var l=new Se(i+8+(o-r<<1));l.set(s),s=l}var u=t.charCodeAt(r);u<128||e?a(u):u<2048?(a(192|u>>6),a(128|u&63)):u>55295&&u<57344?(u=65536+(u&1047552)|t.charCodeAt(++r)&1023,a(240|u>>18),a(128|u>>12&63),a(128|u>>6&63),a(128|u&63)):(a(224|u>>12),a(128|u>>6&63),a(128|u&63))}return vs(s,0,i)}function gl(t,e){if(e){for(var n="",r=0;r<t.length;r+=16384)n+=String.fromCharCode.apply(null,t.subarray(r,r+16384));return n}else{if(fl)return fl.decode(t);var o=Wm(t),s=o.s,n=o.r;return n.length&&je(8),s}}var qm=function(t,e){return e+30+Gt(t,e+26)+Gt(t,e+28)},Xm=function(t,e,n){var r=Gt(t,e+28),o=Gt(t,e+30),s=gl(t.subarray(e+46,e+46+r),!(Gt(t,e+8)&2048)),i=e+46+r,a=Vm(t,i,o,n,wt(t,e+20),wt(t,e+24),wt(t,e+42)),l=a[0],u=a[1],c=a[2];return[Gt(t,e+10),l,u,s,i+o+Gt(t,e+32),c]},Vm=function(t,e,n,r,o,s,i){var a=o==4294967295,l=s==4294967295,u=i==4294967295,c=e+n,d=a+l+u;if(r&&d){for(;e+4<c;e+=4+Gt(t,e+2))if(Gt(t,e)==1)return[a?al(t,e+4+8*l):o,l?al(t,e+4):s,u?al(t,e+4+8*(l+a)):i,1];r<2&&je(13)}return[o,s,i,0]},pl=function(t){var e=0;if(t)for(var n in t){var r=t[n].length;r>65535&&je(9),e+=r+4}return e},Md=function(t,e,n,r,o,s,i,a){var l=r.length,u=n.extra,c=a&&a.length,d=pl(u);Ie(t,e,i!=null?33639248:67324752),e+=4,i!=null&&(t[e++]=20,t[e++]=n.os),t[e]=20,e+=2,t[e++]=n.flag<<1|(s<0&&8),t[e++]=o&&8,t[e++]=n.compression&255,t[e++]=n.compression>>8;var f=new Date(n.mtime==null?Date.now():n.mtime),p=f.getFullYear()-1980;if((p<0||p>119)&&je(10),Ie(t,e,p<<25|f.getMonth()+1<<21|f.getDate()<<16|f.getHours()<<11|f.getMinutes()<<5|f.getSeconds()>>1),e+=4,s!=-1&&(Ie(t,e,n.crc),Ie(t,e+4,s<0?-s-2:s),Ie(t,e+8,n.size)),Ie(t,e+12,l),Ie(t,e+14,d),e+=16,i!=null&&(Ie(t,e,c),Ie(t,e+6,n.attrs),Ie(t,e+10,i),e+=14),t.set(r,e),e+=l,d)for(var h in u){var g=u[h],y=g.length;Ie(t,e,+h),Ie(t,e+2,y),t.set(g,e+4),e+=4+y}return c&&(t.set(a,e),e+=c),e},Jm=function(t,e,n,r,o){Ie(t,e,101010256),Ie(t,e+8,n),Ie(t,e+10,n),Ie(t,e+12,r),Ie(t,e+16,o)};function $d(t,e){e||(e={});var n={},r=[];Fd(t,"",n,e);var o=0,s=0;for(var i in n){var a=n[i],l=a[0],u=a[1],c=u.level==0?0:8,d=Fe(i),f=d.length,p=u.comment,h=p&&Fe(p),g=h&&h.length,y=pl(u.extra);f>65535&&je(11);var b=c?Gm(l,u):l,w=b.length,O=jm();O.p(l),r.push(Nd(u,{size:l.length,crc:O.d(),c:b,f:d,m:h,u:f!=i.length||h&&p.length!=g,o,compression:c})),o+=30+f+y+w,s+=76+2*(f+y)+(g||0)+w}for(var _=new Se(s+22),M=o,R=s-o,A=0;A<r.length;++A){var d=r[A];Md(_,d.o,d,d.f,d.u,d.c.length);var $=30+d.f.length+pl(d.extra);_.set(d.c,d.o+$),Md(_,o,d,d.f,d.u,d.c.length,d.o,d.m),o+=16+$+(d.m?d.m.length:0)}return Jm(_,o,r.length,R,M),_}function Id(t,e){for(var n={},r=t.length-22;wt(t,r)!=101010256;--r)(!r||t.length-r>65558)&&je(13);var o=Gt(t,r+8);if(!o)return{};var s=wt(t,r+16),i=wt(t,r-20)==117853008;if(i){var a=wt(t,r-12);i=wt(t,a)==101075792,i&&(o=wt(t,a+32),s=wt(t,a+48))}for(var l=e&&e.filter,u=0;u<o;++u){var c=Xm(t,s,i),d=c[0],f=c[1],p=c[2],h=c[3],g=c[4],y=c[5],b=qm(t,y);s=g,(!l||l({name:h,size:f,originalSize:p,compression:d}))&&(d?d==8?n[h]=Hm(t.subarray(b,b+f),{out:new Se(p)}):je(14,"unknown compression type "+d):n[h]=vs(t,b,b+f))}return n}var ko="http://schemas.openxmlformats.org/wordprocessingml/2006/main",Zm="http://schemas.openxmlformats.org/officeDocument/2006/relationships",Ym="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",Ld="http://schemas.openxmlformats.org/drawingml/2006/main",Ud="http://schemas.openxmlformats.org/drawingml/2006/picture",Kt="http://schemas.openxmlformats.org/officeDocument/2006/relationships",kl=8,Si=9525,br=20,Hd=new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]","g");function Ke(t){return t.replace(Hd,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var St=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
`;function wl(t){let e=/^#?([0-9a-f]{6})$/i.exec(t)??/^#?([0-9a-f]{3})$/i.exec(t);if(!e)return;let n=e[1];return(n.length===3?[...n].map(r=>r+r).join(""):n).toUpperCase()}var Qm={FFFF00:"yellow","00FF00":"green","00FFFF":"cyan",FF00FF:"magenta","0000FF":"blue",FF0000:"red"};function jd(t,e){let n=e.replace(Hd,"").trim(),r=t?.mode==="office"?Us(n):n;return t?.names.add(r),r}function eh(t){let e=[...t].map(n=>{let r=ca(n),o=Us(n),s=o!==n?`<w:altName w:val="${Ke(o)}"/>`:"";return`<w:font w:name="${Ke(n)}">${s}<w:family w:val="${r.docxFamily}"/><w:pitch w:val="${r.docxPitch}"/></w:font>`});return`${St}<w:fonts xmlns:w="${ko}">${e.join("")}</w:fonts>`}function yl(t,e){return{links:[],images:[],shared:t,defaultStyle:e}}var xi="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";function th(t){let e=t.replace(/[^A-Za-z0-9+/]/g,""),n=new Uint8Array(Math.floor(e.length*3/4)),r=0;for(let o=0;o<e.length;o+=4){let s=xi.indexOf(e[o]),i=xi.indexOf(e[o+1]),a=o+2<e.length?xi.indexOf(e[o+2]):-1,l=o+3<e.length?xi.indexOf(e[o+3]):-1;n[r++]=s<<2|i>>4,a>=0&&(n[r++]=(i&15)<<4|a>>2),l>=0&&(n[r++]=(a&3)<<6|l)}return n.subarray(0,r)}function nh(t){let e=/^data:image\/(png|jpe?g|gif);base64,(.*)$/is.exec(t);if(!e)return null;let n=e[1].toLowerCase().startsWith("jp")?"jpeg":e[1].toLowerCase();return{bytes:th(e[2]),ext:n}}var rh={left:"left",center:"center",right:"right",justify:"both"};function Kd(t,e,n){if(!t)return"";let r="";t.link?r+='<w:rStyle w:val="Hyperlink"/>':t.style&&e?.has(t.style)&&(r+=`<w:rStyle w:val="${e.get(t.style)}"/>`);let o=t.fontFamily?.trim(),s=o?Ke(jd(n,o)):t.code?Ke(jd(n,"Courier New")):void 0;s&&(r+=`<w:rFonts w:ascii="${s}" w:hAnsi="${s}" w:cs="${s}"/>`),t.bold&&(r+="<w:b/>"),t.italic&&(r+="<w:i/>"),t.strike&&(r+="<w:strike/>");let i=t.color&&wl(t.color);i&&(r+=`<w:color w:val="${i}"/>`),t.fontSize&&(r+=`<w:sz w:val="${Math.round(t.fontSize*2)}"/><w:szCs w:val="${Math.round(t.fontSize*2)}"/>`);let a=t.highlight&&wl(t.highlight),l=a&&Qm[a];return l&&(r+=`<w:highlight w:val="${l}"/>`),(t.underline||t.link)&&(r+='<w:u w:val="single"/>'),a&&!l&&(r+=`<w:shd w:val="clear" w:color="auto" w:fill="${a}"/>`),t.superscript?r+='<w:vertAlign w:val="superscript"/>':t.subscript&&(r+='<w:vertAlign w:val="subscript"/>'),r}function zd(t,e){let n=e.runDefaults?{...e.runDefaults,...t.marks}:t.marks,r=Kd(n,e.shared.styleIds,e.shared.fonts),o=r?`<w:rPr>${r}</w:rPr>`:"";if(n?.footnote){let l='<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>';if(n.footnote===xa)return`<w:r>${l}<w:footnoteRef/></w:r>`;let u=e.shared.footnoteIds.get(n.footnote);return u===void 0?"":`<w:r>${l}<w:footnoteReference w:id="${u}"/></w:r>`}if(n?.field)return`<w:fldSimple w:instr="${n.field==="page"?" PAGE ":" NUMPAGES "}"><w:r>${o}<w:t>${Ke(t.text)}</w:t></w:r></w:fldSimple>`;let s=n?.suggest?.kind==="delete",i="";for(let l of t.text.split(/(\n|\t)/))l===`
`?i+="<w:br/>":l==="	"?i+="<w:tab/>":l!==""&&(i+=`<w:${s?"delText":"t"} xml:space="preserve">${Ke(l)}</w:${s?"delText":"t"}>`);let a=`<w:r>${o}${i}</w:r>`;if(n?.suggest){let{suggest:l}=n,u=l.kind==="insert"?"ins":"del",c=e.shared.authorName(l.by)||l.by;a=`<w:${u} w:id="${e.shared.revision++}" w:author="${Ke(c)}" w:date="${new Date(l.at).toISOString().replace(/\.\d+Z$/,"Z")}">${a}</w:${u}>`}return n?.link?(e.links.push(n.link),`<w:hyperlink r:id="rIdLink${e.links.length}">${a}</w:hyperlink>`):a}function vl(t){let e="";t.style&&(e+=`<w:pStyle w:val="${t.style}"/>`),t.num&&(e+=`<w:numPr><w:ilvl w:val="${t.num.level}"/><w:numId w:val="${t.num.id}"/></w:numPr>`),t.border&&(e+='<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>');let n=t.format;if(n&&(n.spaceBefore!==void 0||n.spaceAfter!==void 0||n.lineHeight!==void 0)){let r="";n.spaceBefore!==void 0&&(r+=` w:before="${Math.round(n.spaceBefore*br)}"`),n.spaceAfter!==void 0&&(r+=` w:after="${Math.round(n.spaceAfter*br)}"`),n.lineHeight!==void 0&&(r+=` w:line="${Math.round(n.lineHeight*240)}" w:lineRule="auto"`),e+=`<w:spacing${r}/>`}if(n&&(n.indentLeft||n.indentRight||n.indentFirst)){let r="";n.indentLeft&&(r+=` w:left="${Math.round(n.indentLeft*br)}"`),n.indentRight&&(r+=` w:right="${Math.round(n.indentRight*br)}"`),n.indentFirst&&n.indentFirst>0&&(r+=` w:firstLine="${Math.round(n.indentFirst*br)}"`),n.indentFirst&&n.indentFirst<0&&(r+=` w:hanging="${Math.round(-n.indentFirst*br)}"`),e+=`<w:ind${r}/>`}return t.align&&t.align!=="left"&&(e+=`<w:jc w:val="${rh[t.align]}"/>`),e}function oh(t,e){let n=e.shared.comments;if(n.size===0)return t.map(a=>zd(a,e)).join("");let r="",o=[],s=a=>{let l=n.get(a);return l.seen++,l.seen===1?l.word.map(u=>`<w:commentRangeStart w:id="${u}"/>`).join(""):""},i=a=>{let l=n.get(a);return l.seen===l.total?l.word.map(u=>`<w:commentRangeEnd w:id="${u}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${u}"/></w:r>`).join(""):""};for(let a of t){let l=(a.marks?.comment??[]).filter(u=>n.has(u));for(let u of o)l.includes(u)||(r+=i(u));for(let u of l)o.includes(u)||(r+=s(u));o=l,r+=zd(a,e)}for(let a of o)r+=i(a);return r}function Wt(t,e,n={}){let r=e.defaultFormat||n.format?{...e.defaultFormat,...n.format}:void 0,o=vl({...n,format:r,style:n.style??e.defaultStyle});return`<w:p>${o?`<w:pPr>${o}</w:pPr>`:""}${n.prefix??""}${oh(t,e)}</w:p>`}var Gd=t=>t.defaultStyle===void 0;function sh(t){let e=t.crop;if(!e)return"";let n=r=>Math.round(r*1e5);return`<a:srcRect l="${n(e.left)}" t="${n(e.top)}" r="${n(e.right)}" b="${n(e.bottom)}"/>`}function Wd(t,e,n){let r=nh(t.src);if(!r)return null;let{shared:o}=e,s=e.maxImageWidth??o.maxImageWidthPx,i=t.width>s?s/t.width:1,a=Math.round(t.width*i*Si),l=Math.round(t.height*i*Si),c=`image${o.nextImage++}.${r.ext==="jpeg"?"jpg":r.ext}`;o.media.push({name:c,bytes:r.bytes});let d=`rIdImg${e.images.length+1}`;e.images.push({id:d,target:`media/${c}`});let f=o.nextDocPr++,p=`<wp:docPr id="${f}" name="Picture ${f}" descr="${Ke(t.alt??"")}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${Ld}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${Ld}"><a:graphicData uri="${Ud}"><pic:pic xmlns:pic="${Ud}"><pic:nvPicPr><pic:cNvPr id="0" name="${c}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${d}"/>${sh(t)}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${a}" cy="${l}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;if(n){let h=14*Si;return`<w:drawing><wp:anchor distT="0" distB="${Math.round(8*Si)}" distL="${n==="left"?0:h}" distR="${n==="left"?h:0}" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${e.maxImageWidth!==void 0?"column":"margin"}"><wp:align>${n}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${a}" cy="${l}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${p}</wp:anchor></w:drawing>`}return`<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${a}" cy="${l}"/>${p}</wp:inline></w:drawing>`}function ih(t,e){let n=Wd(t,e);if(!n){let o=t.alt?`[Image: ${t.alt}]`:`[Image: ${t.src.slice(0,80)}]`;return Wt([{text:o,marks:{italic:!0}}],e,{align:t.align})}let r=vl({align:t.align});return`<w:p>${r?`<w:pPr>${r}</w:pPr>`:""}<w:r>${n}</w:r></w:p>`}function ah(t,e,n){n.shared.hasToc=!0;let r=t.blocks.filter(u=>u.type==="heading"&&u.level<=e.levels),o=e.title??"Table of contents",s=[];o&&s.push(Wt([{text:o}],n,{style:"TOCHeading"}));let i=`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${e.levels}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,a='<w:r><w:fldChar w:fldCharType="end"/></w:r>',l=r.length>0?r:null;return l?l.forEach((u,c)=>{let d=`<w:r><w:t xml:space="preserve">${Ke(H(u.runs))}</w:t></w:r>`;s.push(`<w:p><w:pPr><w:pStyle w:val="TOC${u.level}"/></w:pPr>${c===0?i:""}${d}${c===l.length-1?a:""}</w:p>`)}):s.push(`<w:p>${i}<w:r><w:t>Right-click and choose Update Field to build the table of contents.</w:t></w:r>${a}</w:p>`),s.join("")}function lh(t,e,n){let r=n.shared.textWidthTwips,o=t.columns.map(y=>Math.round(y*r));o[o.length-1]+=r-o.reduce((y,b)=>y+b,0);let s=t.borders??"all",i='<w:{n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',a='<w:{n} w:val="nil"/>',l=(y,b)=>(b?i:a).replace("{n}",y).replace("{n}",y),u=s==="all",c=s!=="none",d="<w:tblBorders>"+l("top",c)+l("left",u)+l("bottom",c)+l("right",u)+l("insideH",c)+l("insideV",u)+"</w:tblBorders>",f=Xr(t),p=(y,b)=>o.slice(y,y+b).reduce((w,O)=>w+O,0),h={top:"top",middle:"center",bottom:"bottom"},g=t.rows.map((y,b)=>{let w=b===0&&!!t.headerRow,O=y.cells.map((M,R)=>{if(M.covered){let N=f[b][R];if(N.row===b||N.col!==R)return"";let L=t.rows[N.row].cells[N.col],q=it(L);return`<w:tc><w:tcPr><w:tcW w:w="${p(R,q)}" w:type="dxa"/>${q>1?`<w:gridSpan w:val="${q}"/>`:""}<w:vMerge/></w:tcPr><w:p/></w:tc>`}let A=it(M),$=wl(M.shade??(w?"#f3f4f6":"")),P=`<w:tcPr><w:tcW w:w="${p(R,A)}" w:type="dxa"/>`+(A>1?`<w:gridSpan w:val="${A}"/>`:"")+(yt(M)>1?'<w:vMerge w:val="restart"/>':"")+($?`<w:shd w:val="clear" w:color="auto" w:fill="${$}"/>`:"")+(M.vAlign?`<w:vAlign w:val="${h[M.vAlign]}"/>`:"")+"</w:tcPr>",B={runDefaults:n.runDefaults,defaultFormat:n.defaultFormat,maxImageWidth:n.maxImageWidth};n.runDefaults=w?{bold:!0}:void 0,n.defaultFormat={spaceAfter:2},n.maxImageWidth=Math.max(16,p(R,A)/15-14);let v=Ci(M.blocks,e,n);return Object.assign(n,B),`<w:tc>${P}${v}</w:tc>`}).join("");return`<w:tr><w:trPr><w:cantSplit/>${y.height?`<w:trHeight w:val="${Math.round(y.height*br)}" w:hRule="atLeast"/>`:""}${w?"<w:tblHeader/>":""}</w:trPr>${O}</w:tr>`}).join("");return`<w:tbl><w:tblPr><w:tblW w:w="${r}" w:type="dxa"/>${d}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${o.map(y=>`<w:gridCol w:w="${y}"/>`).join("")}</w:tblGrid>${g}</w:tbl>`}function Ci(t,e,n){let r=[],o=!1,{shared:s}=n,i=Sh(t,s.numbering),a=ro(t),l=null,u=[],c=p=>{let h=p.style&&e.styles?.[p.style]?.kind==="paragraph"?p.style:void 0;if(!h)return{runs:p.runs,align:p.align,format:p.format,style:void 0};if(p.type==="paragraph")return{runs:p.runs,align:p.align,format:p.format,style:s.styleIds.get(h)};let g=Ut(e,p);return{runs:p.runs.map(y=>({...y,marks:Xs(e,y.marks,h)})),align:g.align,format:g.format,style:void 0}},d="",f=()=>{let p=d;return d="",p};for(let[p,h]of t.entries()){d&&!("runs"in h)&&!(h.type==="image"&&h.wrap&&Gd(n))&&r.push(`<w:p>${f()}</w:p>`),h.type!=="list_item"&&(u.length=0);let g=o;switch(o=h.type==="table",h.type){case"paragraph":{let y=c(h);r.push(Wt(y.runs,n,{prefix:f(),style:y.style,align:y.align,format:y.format}));break}case"title":{let y=c(h);r.push(Wt(y.runs,n,{prefix:f(),style:"Title",align:y.align,format:y.format}));break}case"subtitle":{let y=c(h);r.push(Wt(y.runs,n,{prefix:f(),style:"Subtitle",align:y.align,format:y.format}));break}case"heading":{let y=c(h);r.push(Wt(y.runs,n,{prefix:f(),style:`Heading${h.level}`,align:y.align,format:y.format}));break}case"quote":{let y=c(h);r.push(Wt(y.runs,n,{prefix:f(),style:"Quote",align:y.align,format:y.format}));break}case"code_block":{let y=h.runs.map(b=>b.text).join("");r.push(Wt([{text:y}],n,{style:"CodeBlock"}));break}case"divider":r.push(Wt([],n,{border:!0}));break;case"page_break":r.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');break;case"image":{let y=h.wrap&&Gd(n)?Wd(h,n,h.wrap):null;y?d+=`<w:r>${y}</w:r>`:r.push(ih(h,n));break}case"toc":r.push(ah(e,h,n));break;case"section_break":break;case"table":g&&r.push("<w:p/>"),r.push(lh(h,e,n));break;case"list_item":{let y=Math.min(Math.max(h.depth,0),kl),b;if(u.length=h.depth+1,h.list==="bullet")u[h.depth]=0,b=bh(s.numbering,i.get(p).bullet);else{let O=a[p];if(u[h.depth]=O,!l||l.abstractId!==i.get(p).ordered||wh(l,y)!==O){let _=Array.from({length:kl+1},(M,R)=>R<y?(u[R]??0)+1:R===y?O:1);l=kh(s.numbering,i.get(p).ordered,_)}l.counters.length=y+1,l.counters[y]=O,b=l.id}let w=c(h);r.push(Wt(w.runs,n,{prefix:f(),style:"ListParagraph",num:{id:b,level:y},align:w.align,format:w.format}));break}}}return d&&r.push(`<w:p>${f()}</w:p>`),o&&r.push("<w:p/>"),r.join("")}var bl=`xmlns:w="${ko}" xmlns:r="${Zm}" xmlns:wp="${Ym}"`;function ch(t,e,n){let{width:r,height:o}=fr(t),s=d=>Math.round(d*1440),i=t.margins,a=t.orientation==="landscape"?' w:orient="landscape"':"",{count:l,gap:u,rule:c}=n.columns;return"<w:sectPr>"+e.map(d=>`<w:${d.kind}Reference w:type="${d.type}" r:id="${d.rid}"/>`).join("")+(n.continuous?'<w:type w:val="continuous"/>':"")+`<w:pgSz w:w="${s(r)}" w:h="${s(o)}"${a}/><w:pgMar w:top="${s(i.top)}" w:right="${s(i.right)}" w:bottom="${s(i.bottom)}" w:left="${s(i.left)}" w:header="720" w:footer="720" w:gutter="0"/>`+(l>1?`<w:cols w:num="${l}" w:space="${Math.round(u*20)}"${c?' w:sep="1"':""}/>`:"")+(n.titlePg?"<w:titlePg/>":"")+"</w:sectPr>"}function uh(t){let e=[32,26,24,22,22,22];return`<w:style w:type="paragraph" w:styleId="Heading${t}"><w:name w:val="heading ${t}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${t===1?360:240}" w:after="80"/><w:outlineLvl w:val="${t-1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${e[t-1]}"/></w:rPr></w:style>`}function dh(t){return`<w:style w:type="paragraph" w:styleId="TOC${t}"><w:name w:val="toc ${t}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="${(t-1)*220}"/></w:pPr></w:style>`}function Sl(t){return`Pli_${t.replace(/[^A-Za-z0-9_-]/g,"_")}`}function fh(t,e){return Object.entries(t.styles??{}).map(([n,r])=>{let o=r.basedOn&&t.styles?.[r.basedOn]?.kind===r.kind?Sl(r.basedOn):r.kind==="paragraph"?"Normal":void 0,s=Kd(r.marks,void 0,e),i=r.kind==="paragraph"?vl({align:r.align,format:r.format}):"";return`<w:style w:type="${r.kind}" w:customStyle="1" w:styleId="${Sl(n)}"><w:name w:val="${Ke(r.name)}"/>`+(o?`<w:basedOn w:val="${o}"/>`:"")+"<w:qFormat/>"+(i?`<w:pPr>${i}</w:pPr>`:"")+(s?`<w:rPr>${s}</w:rPr>`:"")+"</w:style>"}).join("")}function ph(t,e){return St+`<w:styles xmlns:w="${ko}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>`+[1,2,3,4,5,6].map(uh).join("")+'<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'+[1,2,3,4,5,6].map(dh).join("")+'<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'+fh(t,e)+"</w:styles>"}var mh={disc:"\u2022",circle:"o",square:"\u25AA"},hh={decimal:"decimal","lower-alpha":"lowerLetter","upper-alpha":"upperLetter","lower-roman":"lowerRoman","upper-roman":"upperRoman"},xl=(t,e)=>Array.from({length:kl+1},(n,r)=>e(r)??He(t,r));function gh(){return{abstracts:[{id:0,bullet:!0,markers:xl("bullet",()=>{})},{id:1,bullet:!1,markers:xl("ordered",()=>{})}],instances:[],bulletNums:new Map([[0,1]]),nextNum:3}}function yh(t,e,n){let r=t.abstracts.find(s=>s.bullet===e&&s.markers.join()===n.join());if(r)return r.id;let o=t.abstracts.length;return t.abstracts.push({id:o,bullet:e,markers:n}),o}function bh(t,e){let n=t.bulletNums.get(e);return n===void 0&&(n=t.nextNum++,t.bulletNums.set(e,n)),n}function kh(t,e,n){let r={id:t.nextNum++,abstractId:e,starts:n,counters:[]};return t.instances.push(r),r}function wh(t,e){let n=t.counters[e];return n===void 0?t.starts[e]??1:n+1}function Sh(t,e){let n=new Map;for(let r=0;r<t.length;){if(t[r].type!=="list_item"){r++;continue}let o=r;for(;o<t.length&&t[o].type==="list_item";)o++;let s=t.slice(r,o),i=l=>{let u=s.filter(d=>d.list===l);if(u.length===0)return 0;let c=xl(l,d=>u.find(f=>f.depth===d&&f.marker&&En(f)===f.marker)?.marker);return yh(e,l==="bullet",c)},a={bullet:i("bullet"),ordered:i("ordered")};for(let l=r;l<o;l++)n.set(l,a);r=o}return n}function xh(t){let e=r=>r.markers.map((o,s)=>{let i=720*(s+1),a=r.bullet?"bullet":hh[o],l=r.bullet?mh[o]:`%${s+1}.`;return`<w:lvl w:ilvl="${s}"><w:start w:val="1"/><w:numFmt w:val="${a}"/><w:lvlText w:val="${l}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${i}" w:hanging="360"/></w:pPr>`+(r.bullet&&o==="circle"?'<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New" w:hint="default"/></w:rPr>':"")+"</w:lvl>"}).join(""),n=r=>r.map((o,s)=>`<w:lvlOverride w:ilvl="${s}"><w:startOverride w:val="${o}"/></w:lvlOverride>`).join("");return St+`<w:numbering xmlns:w="${ko}">`+t.abstracts.map(r=>`<w:abstractNum w:abstractNumId="${r.id}"><w:multiLevelType w:val="hybridMultilevel"/>${e(r)}</w:abstractNum>`).join("")+'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'+[...t.bulletNums].filter(([r])=>r!==0).map(([r,o])=>`<w:num w:numId="${o}"><w:abstractNumId w:val="${r}"/></w:num>`).join("")+t.instances.map(r=>`<w:num w:numId="${r.id}"><w:abstractNumId w:val="${r.abstractId}"/>${n(r.starts)}</w:num>`).join("")+"</w:numbering>"}function vi(t){return St+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+t.map(e=>`<Relationship Id="${e.id}" Type="${e.type}" Target="${Ke(e.target)}"${e.external?' TargetMode="External"':""}/>`).join("")+"</Relationships>"}var vh="http://schemas.microsoft.com/office/word/2010/wordml",Ch="http://schemas.microsoft.com/office/word/2012/wordml";function Ph(t,e,n){let r=268435456,o="",s="";for(let i of t){let a=e.comments.get(i.id).word,l=null;i.comments.forEach((u,c)=>{let d=(++r).toString(16).toUpperCase().padStart(8,"0"),f=n(u.author)||u.author,p=f.split(/\s+/).filter(Boolean).map(y=>y[0]).join("").slice(0,3).toUpperCase(),h=new Date(u.createdAt).toISOString().replace(/\.\d+Z$/,"Z"),g=u.body.split(/\r?\n/).map((y,b)=>{let w=b===0?'<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>':"";return`<w:p${b===0?` w14:paraId="${d}"`:""}><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${w}<w:r><w:t xml:space="preserve">${Ke(y)}</w:t></w:r></w:p>`});o+=`<w:comment w:id="${a[c]}" w:author="${Ke(f)}" w:date="${h}" w:initials="${Ke(p)}">${g.join("")}</w:comment>`,s+=`<w15:commentEx w15:paraId="${d}"${l?` w15:paraIdParent="${l}"`:""} w15:done="${i.resolved?1:0}"/>`,l??(l=d)})}return[`${St}<w:comments xmlns:w="${ko}" xmlns:w14="${vh}">${o}</w:comments>`,`${St}<w15:commentsEx xmlns:w15="${Ch}">${s}</w15:commentsEx>`]}function Cs(t){return[...t.links.map((e,n)=>({id:`rIdLink${n+1}`,type:`${Kt}/hyperlink`,target:e,external:!0})),...t.images.map(e=>({id:e.id,type:`${Kt}/image`,target:e.target}))]}function Cl(t,e={}){let n=jt(t),{width:r}=fr(n),o={nextImage:1,nextDocPr:1,numbering:gh(),media:[],hasToc:!1,maxImageWidthPx:Math.max(1,(r-n.margins.left-n.margins.right)*Ca),textWidthTwips:Math.max(720,Math.round((r-n.margins.left-n.margins.right)*1440)),footnoteIds:new Map,comments:new Map,styleIds:new Map(Object.keys(t.styles??{}).map(B=>[B,Sl(B)])),revision:1e3,authorName:e.authorName??(B=>B),fonts:{mode:e.fonts==="office"?"office":"keep",names:new Set(["Arial","Courier New"])}},s=[...e.comments??Object.values(t.comments??{})].map(B=>({thread:B,total:On(t,B.id).length})).filter(B=>B.total>0&&B.thread.comments.length>0),i=0;for(let{thread:B,total:v}of s)o.comments.set(B.id,{word:B.comments.map(()=>i++),total:v,seen:0});let a=Ze(t.blocks).filter(B=>t.footnotes?.[B]?.length);a.forEach((B,v)=>o.footnoteIds.set(B,v+1));let l=yl(o),u=Pt(t),c=[];u.forEach((B,v)=>{let N={differentFirstPage:Ba(t,u,v),differentOddEven:n.differentOddEven};for(let L of["header","footer"])for(let q of gu(N,L)){let Z=v===0?t[q]:B.start?.regions?.[q];if(Z===void 0||Z.length===0&&v===0)continue;let X=yl(o,L==="header"?"Header":"Footer"),V=c.filter(Y=>Y.kind===L).length+1;c.push({section:v,kind:L,type:hu(q),part:X,xml:Z.length===0?"<w:p/>":Ci(Z,t,X),file:`${L}${V}.xml`,rid:`rId${L==="header"?"Header":"Footer"}${V}`})}});let d=[],f="";u.forEach((B,v)=>{let N=zt(t,u,v),L=fr(N).width-N.margins.left-N.margins.right;o.maxImageWidthPx=Math.max(1,L*Ca),o.textWidthTwips=Math.max(720,Math.round(L*1440));let q=Ci(t.blocks.slice(B.from,B.to),t,l),Z=ch(N,c.filter(X=>X.section===v),{columns:B.columns,continuous:v>0&&!zc(t,u,v),titlePg:Ba(t,u,v)});v===u.length-1?(d.push(q),f=Z):d.push(q,`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${Z}</w:pPr></w:p>`)});let p=d.join(""),h=yl(o,"FootnoteText"),g=a.map((B,v)=>{let N=[...t.footnotes[B]],L=N[0];return"runs"in L&&(N[0]={...L,runs:[{text:"",marks:{footnote:xa}},{text:" "},...L.runs]}),`<w:footnote w:id="${v+1}">${Ci(N,t,h)}</w:footnote>`}),y=a.length>0,b=s.length>0,w=!0,O=St+`<w:document ${bl}><w:body>${p||"<w:p/>"}${f}</w:body></w:document>`,_=[{id:"rIdStyles",type:`${Kt}/styles`,target:"styles.xml"},{id:"rIdFontTable",type:`${Kt}/fontTable`,target:"fontTable.xml"},{id:"rIdNumbering",type:`${Kt}/numbering`,target:"numbering.xml"},...w?[{id:"rIdSettings",type:`${Kt}/settings`,target:"settings.xml"}]:[],...c.map(B=>({id:B.rid,type:`${Kt}/${B.kind}`,target:B.file})),...y?[{id:"rIdFootnotes",type:`${Kt}/footnotes`,target:"footnotes.xml"}]:[],...b?[{id:"rIdComments",type:`${Kt}/comments`,target:"comments.xml"},{id:"rIdCommentsExt",type:"http://schemas.microsoft.com/office/2011/relationships/commentsExtended",target:"commentsExtended.xml"}]:[],...Cs(l)],M=St+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'+(w?'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>':"")+(y?'<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>':"")+(b?'<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>':"")+c.map(B=>`<Override PartName="/word/${B.file}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${B.kind}+xml"/>`).join("")+'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',R=vi([{id:"rId1",type:`${Kt}/officeDocument`,target:"word/document.xml"},{id:"rId2",type:"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",target:"docProps/core.xml"}]),A=St+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${Ke(t.title)}</dc:title></cp:coreProperties>`,$=ph(t,o.fonts),P={"[Content_Types].xml":Fe(M),"_rels/.rels":Fe(R),"docProps/core.xml":Fe(A),"word/document.xml":Fe(O),"word/styles.xml":Fe($),"word/numbering.xml":Fe(xh(o.numbering)),"word/_rels/document.xml.rels":Fe(vi(_))};if(w&&(P["word/settings.xml"]=Fe(`${St}<w:settings xmlns:w="${ko}">${n.differentOddEven?"<w:evenAndOddHeaders/>":""}${o.hasToc?'<w:updateFields w:val="true"/>':""}${y?'<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>':""}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`)),y&&(P["word/footnotes.xml"]=Fe(`${St}<w:footnotes ${bl}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`+g.join("")+"</w:footnotes>"),Cs(h).length>0&&(P["word/_rels/footnotes.xml.rels"]=Fe(vi(Cs(h))))),b){let[B,v]=Ph(s.map(N=>N.thread),o,e.authorName??(N=>N));P["word/comments.xml"]=Fe(B),P["word/commentsExtended.xml"]=Fe(v)}for(let B of c){let v=B.kind==="header"?"hdr":"ftr";P[`word/${B.file}`]=Fe(`${St}<w:${v} ${bl}>${B.xml}</w:${v}>`),Cs(B.part).length>0&&(P[`word/_rels/${B.file}.rels`]=Fe(vi(Cs(B.part))))}for(let B of o.media)P[`word/media/${B.name}`]=B.bytes;return P["word/fontTable.xml"]=Fe(eh(o.fonts.names)),$d(P)}var Ol=class{constructor(e,n){se(this,"files");let r=0;try{this.files=Id(e,{filter(o){if(r+=o.originalSize,r>n)throw new S("invalid_document","The file is too large when unpacked");return!0}})}catch(o){throw o instanceof S?o:new S("invalid_document","Not a .docx file: it couldn't be opened as a zip archive",{cause:o})}}has(e){return e in this.files}text(e){let n=this.files[e];return n?gl(n):void 0}xml(e){let n=this.text(e);return n===void 0?void 0:ea(n)}rels(e){let n=e.lastIndexOf("/");return this.relsFile(`${e.slice(0,n+1)}_rels/${e.slice(n+1)}.rels`)}relsFile(e){let n=this.xml(e),r=new Map;for(let o of Ne(n,"Relationship")){let s=o.attrs.Id;s&&r.set(s,{type:o.attrs.Type??"",target:o.attrs.Target??"",external:o.attrs.TargetMode==="External"})}return r}};function Xd(t,e){if(e.startsWith("/"))return e.slice(1);let n=t.split("/").slice(0,-1);for(let r of e.split("/"))r===".."?n.pop():r!=="."&&r!==""&&n.push(r);return n.join("/")}var jn=20,qd=9525;function zn(t){if(!t)return!1;let e=C(t,"val");return e===void 0||!["0","false","off","none"].includes(e.toLowerCase())}var fe=t=>{if(t===void 0)return;let e=Number(t);return Number.isFinite(e)?e:void 0},Ce=(t,e,n)=>Math.min(n,Math.max(e,t));function Pl(t){if(!t||t.toLowerCase()==="auto")return;let e=/^#?([0-9a-f]{6})$/i.exec(t.trim());return e?`#${e[1].toLowerCase()}`:void 0}var Bh={black:"#000000",blue:"#0000ff",cyan:"#00ffff",darkBlue:"#000080",darkCyan:"#008080",darkGray:"#808080",darkGreen:"#008000",darkMagenta:"#800080",darkRed:"#800000",darkYellow:"#808000",green:"#00ff00",lightGray:"#c0c0c0",magenta:"#ff00ff",red:"#ff0000",white:"#ffffff",yellow:"#ffff00"},Bi=t=>t.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,""),Pi="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";function Oh(t){let e="";for(let n=0;n<t.length;n+=3){let r=t[n],o=t[n+1],s=t[n+2];e+=Pi[r>>2]+Pi[(r&3)<<4|(o??0)>>4],e+=o===void 0?"=":Pi[(o&15)<<2|(s??0)>>6],e+=s===void 0?"=":Pi[s&63]}return e}var Mh={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",bmp:"image/bmp"},Ah=new Set(["normal","title","subtitle","quote","intense quote","list paragraph","header","footer","toc heading","footnote text","footnote reference","endnote text","endnote reference","annotation text","annotation reference","annotation subject","hyperlink","followedhyperlink","default paragraph font","balloon text","page number","line number","code block","source code","table of figures","macro text"]);function Oi(t){let e=t.toLowerCase();return Ah.has(e)||/^heading [1-9]$/.test(e)||/^toc [1-9]$/.test(e)}function Th(t,e){let n=t.toLowerCase(),r=/^heading ([1-6])$/.exec(n)??/^heading([1-6])$/i.exec(e);return r?{type:"heading",level:Number(r[1])}:n==="title"?{type:"title"}:n==="subtitle"?{type:"subtitle"}:n==="quote"||n==="intense quote"?{type:"quote"}:n==="code block"||n==="source code"?{type:"code"}:null}function Rh(t){let e=new Map;for(let r of Ne(t,"abstractNum")){let o=new Map;for(let s of Ne(r,"lvl"))o.set(fe(C(s,"ilvl"))??0,{format:C(I(s,"numFmt"),"val")??"decimal",text:C(I(s,"lvlText"),"val")??"",start:Math.max(0,Math.round(fe(C(I(s,"start"),"val"))??1))});e.set(C(r,"abstractNumId")??"",o)}let n=new Map;for(let r of Ne(t,"num")){let o=C(I(r,"abstractNumId"),"val")??"",s=e.get(o);if(!s)continue;let i=new Map;for(let a of Ne(r,"lvlOverride")){let l=fe(C(I(a,"startOverride"),"val"));l!==void 0&&i.set(fe(C(a,"ilvl"))??0,Math.max(0,Math.round(l)))}n.set(C(r,"numId")??"",{levels:s,abstractId:o,overrides:i})}return{nums:n}}var Dh={decimal:"decimal",decimalZero:"decimal",lowerLetter:"lower-alpha",upperLetter:"upper-alpha",lowerRoman:"lower-roman",upperRoman:"upper-roman"};function Eh(t){if(!t)return{list:"ordered"};if(t.format==="bullet"||t.format==="none"){let n=t.text.trim(),r=n==="o"||n==="\u25E6"||n==="\u25CB"?"circle":/^[\uf0a7\u25aa\u25a0\u25fc]$/.test(n)?"square":n===""?void 0:"disc";return{list:"bullet",...r&&{marker:r}}}let e=Dh[t.format];return{list:"ordered",...e&&{marker:e}}}var Mt=t=>"section"in t;function Vd(t){let e=I(t,"pgSz"),n=I(t,"pgMar"),r=I(t,"cols"),o=(c,d)=>fe(c)??d,s=(c,d)=>Ce(Math.round(o(c,d*1440)/1440*100)/100,0,5),i=o(C(e,"w"),12240)/1440,a=o(C(e,"h"),15840)/1440,l=fe(C(r,"num"))??1,u=l>1?{count:Ce(Math.round(l),1,4),gap:Ce((fe(C(r,"space"))??720)/jn,0,200),...zn(r)&&C(r,"sep")&&C(r,"sep")!=="0"?{rule:!0}:{}}:void 0;return{width:i,height:a,landscape:C(e,"orient")==="landscape"||i>a,margins:{top:s(C(n,"top"),1),right:s(C(n,"right"),1),bottom:s(C(n,"bottom"),1),left:s(C(n,"left"),1)},...u&&{columns:u},continuous:C(I(t,"type"),"val")==="continuous",titlePg:zn(I(t,"titlePg")),refs:ze(t).filter(c=>c.name==="headerReference"||c.name==="footerReference").map(c=>({kind:c.name==="headerReference"?"header":"footer",variant:C(c,"type")==="first"?"first":C(c,"type")==="even"?"even":"default",rid:C(c,"id","r")??""}))}}function Bl(t,e){let[n,r]=[Math.min(t.width,t.height),Math.max(t.width,t.height)],o="letter",s=1/0;for(let[i,a]of Object.entries(Rn)){let l=Math.abs(a.width-n)+Math.abs(a.height-r);l<s&&(s=l,o=i)}return s>.15&&e(`A page size of ${n.toFixed(2)} \xD7 ${r.toFixed(2)} inches isn't supported, so the nearest standard size was used`),o}var wo=class t{constructor(e,n,r,o){this.shared=e;this.part=n;this.rels=r;this.mode=o;se(this,"fields",[]);se(this,"open",new Set);se(this,"skipSpace",!1);se(this,"change",null);se(this,"changeCount",0);se(this,"tocHeadings",new Set)}warn(e){this.shared.warnings.add(e)}latinFont(e){let n=o=>{let s=o&&/^(major|minor)/.test(o)?o.startsWith("major")?"major":"minor":void 0;return(s&&/^(major|minor)(Ascii|HAnsi)$/.test(o)?this.shared.themeFonts?.[s]:void 0)||void 0};return(n(C(e,"asciiTheme"))??C(e,"ascii")??n(C(e,"hAnsiTheme"))??C(e,"hAnsi"))?.trim()||void 0}blocks(e){let n=[];for(let r of e)switch(r.name){case"p":this.paragraph(r,n);break;case"tbl":this.mode==="cell"||this.mode==="note"?this.flattenTable(r,n):n.push(this.table(r));break;case"sdt":n.push(...this.blocks(ze(I(r,"sdtContent"))));break;case"ins":case"moveTo":case"customXml":n.push(...this.blocks(ze(r)));break;default:break}return this.tidy(n)}tidy(e){let n=[];return e.forEach((r,o)=>{let s=n[n.length-1];if(!Mt(r)&&r.type==="toc"&&r.title===""&&s&&!Mt(s)&&s.type==="paragraph"&&this.tocHeadings.has(s.id)){n.pop(),n.push({...r,title:H(s.runs)});return}if(!Mt(r)&&r.type==="paragraph"&&r.runs.length===0&&!r.style&&!r.align&&!r.format){let i=n[n.length-1],a=e[o+1];if(i&&!Mt(i)&&i.type==="table"&&(a===void 0||!Mt(a)&&a.type==="table"))return}n.push(r)}),n}flattenTable(e,n){this.warn("A table inside a table, or inside a note, was turned into plain paragraphs");for(let r of Ne(e,"tr"))for(let o of Ne(r,"tc"))n.push(...this.blocks(ze(o)).filter(s=>!Mt(s)))}info(e){let n=C(I(e,"pStyle"),"val"),r={type:"paragraph"},o,s=I(e,"numPr"),i=new Set;for(let h=n;h!==void 0&&!i.has(h);){i.add(h);let g=this.shared.styles.get(h);if(!g)break;let y=Th(g.name,g.id);y&&r.type==="paragraph"&&(r=y),s??(s=I(g.pPr,"numPr")),h=g.basedOn}let a=n?this.shared.styles.get(n):void 0;a&&a.type==="paragraph"&&!Oi(a.name)&&(this.shared.used.add(a.id),o=a.id);let l,u=C(I(s,"numId"),"val");if(u&&u!=="0"&&(r.type==="paragraph"||r.type==="quote")){let h=Ce(Math.round(fe(C(I(s,"ilvl"),"val"))??0),0,8),g=this.shared.numbering.nums.get(u)?.levels.get(h),y=Eh(g);l={list:y.list,depth:h,numId:u,...y.marker&&{marker:y.marker}}}let c=C(I(e,"jc"),"val"),d=c==="center"?"center":c==="right"||c==="end"?"right":c==="both"||c==="distribute"||c==="justify"?"justify":void 0,f=this.formatOf(e),p=I(I(e,"pBdr"),"bottom");return{kind:r,...o&&{style:o},...n&&{wordStyle:n},...d&&{align:d},...f&&{format:f},...l&&{list:l},pageBreakBefore:zn(I(e,"pageBreakBefore")),divider:!!p&&!["nil","none"].includes(C(p,"val")??"single")}}formatOf(e){let n={},r=I(e,"spacing"),o=fe(C(r,"before")),s=fe(C(r,"after")),i=fe(C(r,"line"));o!==void 0&&(n.spaceBefore=Ce(o/jn,0,1e3)),s!==void 0&&(n.spaceAfter=Ce(s/jn,0,1e3)),i!==void 0&&(C(r,"lineRule")??"auto")==="auto"&&(n.lineHeight=Ce(Math.round(i/240*100)/100,.5,10));let a=I(e,"ind"),l=fe(C(a,"left")??C(a,"start")),u=fe(C(a,"right")??C(a,"end")),c=fe(C(a,"firstLine")),d=fe(C(a,"hanging"));return l&&(n.indentLeft=Ce(l/jn,0,1e3)),u&&(n.indentRight=Ce(u/jn,0,1e3)),d?n.indentFirst=Ce(-d/jn,-1e3,1e3):c&&(n.indentFirst=Ce(c/jn,-1e3,1e3)),Object.keys(n).length>0?n:void 0}paragraph(e,n){let r=I(e,"pPr"),o=this.info(r),s=I(r,"sectPr"),i=this.fields.some(f=>f.kind==="toc"),a=[];this.inline(e,a,void 0);let l=this.fields.some(f=>f.kind==="toc");o.pageBreakBefore&&this.mode==="body"&&n.push({id:T("b_"),type:"page_break"});let u=[],c=!1,d=(f=!1)=>{let p=ce(u);u=[],!(p.length===0&&!f)&&(n.push(this.textBlock(o,p)),c=!0)};for(let f of a)f.kind==="run"?u.push(f.run):f.kind==="image"?(d(),n.push({...f.block,...o.align&&{align:o.align}}),c=!0):f.kind==="page_break"?(d(),this.mode==="body"&&n.push({id:T("b_"),type:"page_break"}),c=!0):(d(),this.pushToc(f.levels,n),c=!0);(u.length>0||!c&&!i&&!l&&!s)&&(!c&&u.length===0&&o.divider&&this.mode!=="note"?n.push({id:T("b_"),type:"divider"}):d(!0)),s&&this.mode==="body"&&n.push({section:Vd(s)})}pushToc(e,n){let r=n[n.length-1],o;r&&!Mt(r)&&r.type==="paragraph"&&this.tocHeadings.has(r.id)&&(o=H(r.runs),n.pop()),n.push({id:T("b_"),type:"toc",levels:Ce(e,1,6),title:o??""})}listItem(e,n,r,o){let{nums:s}=this.shared.numbering,i=s.get(n.numId);if(n.list==="ordered"&&i){let l=this.shared.counters.get(i.abstractId)??[],u=i.overrides.get(n.depth),c=!this.shared.usedLevels.has(`${n.numId}:${n.depth}`);this.shared.usedLevels.add(`${n.numId}:${n.depth}`);let d=u!==void 0&&c?u:l[n.depth]===void 0?i.levels.get(n.depth)?.start??1:l[n.depth]+1;l.length=n.depth+1,l[n.depth]=d,this.shared.counters.set(i.abstractId,l),this.shared.wordNumbers.set(e,d)}let a=n.marker&&n.marker!==He(n.list,n.depth)?n.marker:void 0;return{id:e,type:"list_item",list:n.list,depth:n.depth,...a&&{marker:a},runs:r,...o}}textBlock(e,n){let r=T("b_"),o={...e.align&&{align:e.align},...e.format&&{format:e.format},...e.style&&{style:e.style}},s=e.wordStyle?this.shared.styles.get(e.wordStyle):void 0,i=e.kind;if(this.mode==="note"&&(i.type==="heading"||i.type==="title"||i.type==="subtitle")&&(i={type:"paragraph"}),i.type==="code")return{id:r,type:"code_block",runs:n.length>0?[{text:n.map(l=>l.text).join("")}]:[]};if(e.list&&(i.type==="paragraph"||i.type==="quote"))return this.listItem(r,e.list,n,o);if(i.type==="heading")return{id:r,type:"heading",level:i.level,runs:n,...o};if(i.type==="title"||i.type==="subtitle"||i.type==="quote")return{id:r,type:i.type,runs:n,...o};let a={id:r,type:"paragraph",runs:n,...o};return s&&/^toc ?heading$/i.test(s.name)&&this.tocHeadings.add(r),a}inline(e,n,r){for(let o of ze(e))switch(o.name){case"r":this.run(o,n,r);break;case"hyperlink":{let s=C(o,"id","r"),i=s?this.rels.get(s):void 0,a=C(o,"anchor");this.inline(o,n,i?.target??(a?`#${a}`:r));break}case"fldSimple":{let s=this.classify(C(o,"instr")??"");this.fields.push({phase:"result",instr:C(o,"instr")??"",...s}),this.inline(o,n,r),this.fields.pop(),s.kind==="toc"&&n.push({kind:"toc",levels:this.tocLevels(C(o,"instr")??"")});break}case"ins":case"moveTo":this.tracked(o,"insert",n,r);break;case"del":case"moveFrom":this.tracked(o,"delete",n,r);break;case"smartTag":case"sdtContent":case"customXml":case"dir":case"bdo":this.inline(o,n,r);break;case"sdt":this.inline(I(o,"sdtContent")??o,n,r);break;case"commentRangeStart":{let s=C(o,"id");s!==void 0&&this.open.add(s);break}case"commentRangeEnd":{let s=C(o,"id");s!==void 0&&this.open.delete(s);break}case"pict":case"object":this.warn("A drawing or embedded object that isn't a picture was left out");break;default:break}}tracked(e,n,r,o){if(this.shared.acceptChanges){n==="insert"&&this.inline(e,r,o);return}let s=this.change,i=Date.parse(C(e,"date")??"");this.change={id:`sg_${C(e,"id")??`n${this.changeCount++}`}_${n}`,kind:n,by:this.shared.authorOf(C(e,"author")??""),at:Number.isFinite(i)&&i>=0?i:0},this.inline(e,r,o),this.change=s}classify(e){let n=/^\s*([A-Za-z]+)/.exec(e)?.[1]?.toUpperCase();if(n==="PAGE")return{kind:"page"};if(n==="NUMPAGES")return{kind:"pages"};if(n==="TOC")return{kind:"toc"};if(n==="HYPERLINK"){let r=/"([^"]*)"/.exec(e)?.[1],o=/\\l\s+"([^"]*)"/.exec(e)?.[1],s=o&&!r?`#${o}`:r;return s?{kind:"link",link:s}:{kind:"plain"}}return{kind:"plain"}}tocLevels(e){let n=/\\o\s+"(\d)-(\d)"/.exec(e);return n?Number(n[2]):3}run(e,n,r){let o=I(e,"rPr"),s=r,i=()=>this.fields.some(c=>c.phase==="instr"||c.kind==="toc"),a=()=>{let c=this.marksOf(o),d=this.charStyleOf(o);d&&(c.style=d);let f=[...this.fields].reverse().find(g=>g.phase==="result"&&(g.kind==="link"||g.kind==="page"||g.kind==="pages")),p=s??(f?.kind==="link"?f.link:void 0);p&&(c.link=p),f&&(f.kind==="page"||f.kind==="pages")&&(c.field=f.kind),this.change&&(c.suggest=this.change);let h=[...this.open].flatMap(g=>this.shared.threadOf.get(g)??[]);return h.length>0&&(c.comment=[...new Set(h)].sort()),c.link&&C(I(o,"rStyle"),"val")==="Hyperlink"&&delete c.underline,c},l="",u=()=>{if(l==="")return;let c={text:l},d=a();Object.keys(d).length>0&&(c.marks=d),n.push({kind:"run",run:c}),l=""};for(let c of ze(e))switch(c.name){case"fldChar":{let d=C(c,"fldCharType");if(d==="begin")u(),this.fields.push({phase:"instr",instr:"",kind:"plain"});else if(d==="separate"){u();let f=this.fields[this.fields.length-1];f&&(f.phase="result",Object.assign(f,this.classify(f.instr)),f.kind==="toc"&&n.push({kind:"toc",levels:this.tocLevels(f.instr)}))}else d==="end"&&(u(),this.fields.pop());break}case"instrText":{let d=this.fields[this.fields.length-1];d&&d.phase==="instr"&&(d.instr+=Yt(c));break}case"delText":case"t":if(c.name==="delText"&&this.change?.kind!=="delete")break;if(!i()){let d=Yt(c);this.skipSpace&&(d.startsWith(" ")&&(d=d.slice(1)),d!==""&&(this.skipSpace=!1)),l+=d}break;case"tab":i()||(l+="	");break;case"br":{if(i())break;C(c,"type")==="page"?(u(),n.push({kind:"page_break"})):l+=`
`;break}case"cr":i()||(l+=`
`);break;case"noBreakHyphen":i()||(l+="-");break;case"footnoteRef":this.skipSpace=!0;break;case"footnoteReference":{if(i())break;u();let d=C(c,"id")??"",f=this.shared.footnotes.get(d);f&&this.mode==="body"?(this.shared.referencedNotes.add(d),n.push({kind:"run",run:{text:Tn,marks:{footnote:f}}})):this.mode!=="body"&&this.warn("A footnote reference inside a table, header or note was left out");break}case"pict":case"object":i()||this.warn("A drawing or embedded object that isn't a picture was left out");break;case"drawing":{if(i())break;u();let d=this.image(c);d&&n.push({kind:"image",block:d});break}default:break}u()}charStyleOf(e){let n=C(I(e,"rStyle"),"val"),r=n?this.shared.styles.get(n):void 0;if(!(!r||r.type!=="character"||Oi(r.name)||r.linked))return this.shared.used.add(r.id),r.id}marksOf(e){let n={};if(!e)return n;let r;for(let o of ze(e))switch(o.name){case"b":zn(o)&&(n.bold=!0);break;case"i":zn(o)&&(n.italic=!0);break;case"strike":case"dstrike":zn(o)&&(n.strike=!0);break;case"u":{let s=C(o,"val");s!=="none"&&s!=="0"&&(n.underline=!0);break}case"vertAlign":{let s=C(o,"val");s==="superscript"?n.superscript=!0:s==="subscript"&&(n.subscript=!0);break}case"color":{let s=Pl(C(o,"val"));s&&(n.color=s);break}case"sz":{let s=fe(C(o,"val"));s!==void 0&&s>0&&(n.fontSize=Ce(s/2,1,400));break}case"highlight":{let s=Bh[C(o,"val")??""];s&&(n.highlight=s);break}case"shd":r=Pl(C(o,"fill"));break;case"rFonts":{let s=this.latinFont(o);s&&(n.fontFamily=s);break}default:break}return r&&!n.highlight&&(n.highlight=r),n}image(e){let n=(_,M)=>{if(_.name===M)return _;for(let R of ze(_)){let A=n(R,M);if(A)return A}},r=n(e,"blip"),o=n(e,"extent"),s=n(e,"docPr"),i=C(s,"descr")||void 0,a=C(r,"embed","r"),l=a?this.rels.get(a):void 0,u=Ce(Math.round((fe(C(o,"cx"))??0)/qd),1,2e4)||100,c=Ce(Math.round((fe(C(o,"cy"))??0)/qd),1,2e4)||100;if(!l||l.external)return this.warn("A picture that is linked rather than stored in the file was left out"),null;let d=Xd(this.part,l.target),f=this.shared.pkg.files[d],p=Mh[d.slice(d.lastIndexOf(".")+1).toLowerCase()];if(!f||!p)return this.warn("A picture in a format that can't be shown (such as EMF or TIFF) was left out"),null;let h=n(e,"anchor"),g;if(h&&(this.mode==="body"||this.mode==="cell")&&["wrapSquare","wrapTight","wrapThrough"].some(_=>n(h,_))){let _=n(h,"positionH"),M=Yt(n(_??h,"align")).trim().toLowerCase(),R=fe(Yt(n(_??h,"posOffset")).trim());g=M==="right"||M==="outside"?"right":M==="left"||M==="inside"?"left":R!==void 0&&R>2e6?"right":"left"}let y=n(e,"srcRect"),b=_=>Ce((fe(C(y,_))??0)/1e5,0,.9),w={top:b("t"),right:b("r"),bottom:b("b"),left:b("l")},O=y&&(w.top||w.right||w.bottom||w.left)&&w.left+w.right<=.95&&w.top+w.bottom<=.95?w:void 0;return{id:T("b_"),type:"image",src:`data:${p};base64,${Oh(f)}`,...i&&{alt:i},width:u,height:c,...g&&{wrap:g},...O&&{crop:O}}}table(e){let n=Ne(I(e,"tblGrid"),"gridCol").map(f=>fe(C(f,"w"))??0),r=Ne(e,"tr"),o=r.map(f=>Ne(f,"tc").reduce((p,h)=>p+Ce(Math.round(fe(C(I(I(h,"tcPr"),"gridSpan"),"val"))??1),1,63),0)+(fe(C(I(I(f,"trPr"),"gridBefore"),"val"))??0)),s=Ce(Math.max(n.length,...o,1),1,63),i=Array.from({length:s},(f,p)=>n[p]&&n[p]>0?n[p]:1),a=[],l=Array.from({length:s},()=>null);r.forEach((f,p)=>{let h=I(f,"trPr"),g=[],y=Ce(Math.round(fe(C(I(h,"gridBefore"),"val"))??0),0,s),b=0,w=()=>({id:T("c_"),blocks:[{id:T("b_"),type:"paragraph",runs:[]}]});for(;b<y;b++)g.push(w());for(let _ of Ne(f,"tc")){if(b>=s)break;let M=I(_,"tcPr"),R=Ce(Math.round(fe(C(I(M,"gridSpan"),"val"))??1),1,s-b),A=I(M,"vMerge"),$=A?C(A,"val")==="restart"?"restart":"continue":null;if($==="continue"&&l[b]){let P=l[b];P.cell.rowSpan=(P.cell.rowSpan??1)+1,g.push({id:T("c_"),blocks:[],covered:!0})}else{let P=this.cellBlocks(_),B={id:T("c_"),blocks:P},v=Pl(C(I(M,"shd"),"fill"));v&&(B.shade=v),R>1&&(B.colSpan=R);let N=C(I(M,"vAlign"),"val");N==="center"?B.vAlign="middle":N==="bottom"&&(B.vAlign="bottom"),g.push(B);for(let L=0;L<R;L++)l[b+L]=$==="restart"?{cell:B,row:p}:null}for(let P=1;P<R;P++)g.push({id:T("c_"),blocks:[],covered:!0});b+=R}for(;g.length<s;)g.push(w());let O=fe(C(I(h,"trHeight"),"val"));a.push({id:T("r_"),cells:g.slice(0,s),...O?{height:Ce(O/jn,1,5e3)}:{}});for(let _=0;_<s;_++){let M=a[p].cells[_];l[_]&&M.covered===void 0&&l[_].cell!==M&&(l[_]=null)}});let u=_h(I(I(e,"tblPr"),"tblBorders")),c=!!r[0]&&!!I(I(r[0],"trPr"),"tblHeader")&&zn(I(I(r[0],"trPr"),"tblHeader"));if(a.length===0)return{id:T("b_"),type:"paragraph",runs:[]};if(c)for(let f of a[0].cells)f.shade==="#f3f4f6"&&delete f.shade;let d={id:T("b_"),type:"table",rows:a,columns:at(i),...c&&{headerRow:!0},...u!=="all"&&{borders:u}};return Cn(d)&&(this.warn("A table whose merged cells couldn't be read was imported without merging"),d={...d,rows:d.rows.map(f=>({...f,cells:f.cells.map(p=>p.covered?{id:p.id,blocks:[{id:T("b_"),type:"paragraph",runs:[]}]}:(({colSpan:h,rowSpan:g,...y})=>y)(p))}))}),d}cellBlocks(e){let n=new t(this.shared,this.part,this.rels,"cell");n.open=this.open;let o=n.blocks(ze(e)).filter(s=>!Mt(s)).filter(s=>["paragraph","title","subtitle","quote","heading","list_item","code_block","image","divider"].includes(s.type));return o.length>0?o:[{id:T("b_"),type:"paragraph",runs:[]}]}};function _h(t){if(!t)return"all";let e=o=>{let s=I(t,o);return!!s&&!["nil","none"].includes(C(s,"val")??"single")},n=e("top")||e("bottom")||e("insideH"),r=e("left")||e("right")||e("insideV");return!n&&!r?"none":n&&!r?"horizontal":"all"}var Nh=t=>new RegExp(`/${t}$`);function kr(t,e){for(let[n,r]of t)if(Nh(e).test(r.type))return{id:n,target:r.target}}function Mi(t,e={}){let n=new Ol(t,e.maxUnpackedBytes??262144e3),r=kr(n.relsFile("_rels/.rels"),"officeDocument")?.target??"word/document.xml",o=n.has(r)?r:"word/document.xml";if(!n.has(o))throw new S("invalid_document","Not a Word document: it has no word/document.xml");let s=n.xml(o),i=I(s,"body");if(!i)throw new S("invalid_document","Not a Word document: its document.xml has no body");let a=n.rels(o),l=j=>Xd(o,j),u=new Set,c=new Map,d=kr(a,"styles"),f=n.xml(d?l(d.target):"word/styles.xml");for(let j of Ne(f,"style")){let Q=C(j,"styleId");Q&&c.set(Q,{id:Q,type:C(j,"type")??"paragraph",name:C(I(j,"name"),"val")??Q,basedOn:C(I(j,"basedOn"),"val"),linked:C(I(j,"link"),"val"),pPr:I(j,"pPr"),rPr:I(j,"rPr"),custom:C(j,"customStyle")==="1"||C(j,"customStyle")==="true",isDefault:C(j,"default")==="1"})}let p=kr(a,"numbering"),h=Rh(n.xml(p?l(p.target):"word/numbering.xml")),g=kr(a,"settings"),y=n.xml(g?l(g.target):"word/settings.xml"),b=zn(I(y,"evenAndOddHeaders")),w=new Map,O=e.userId??(j=>Bi(j)||"unknown"),_=j=>{let Q=O(j);return w.has(Q)||w.set(Q,{id:Q,name:j||Q}),Q},M=new Map,R=[],A=kr(a,"comments"),$=n.xml(A?l(A.target):"word/comments.xml");if($){let j=[...a.values()].find(ne=>/commentsExtended$/.test(ne.type)),Q=n.xml(j?l(j.target):"word/commentsExtended.xml"),Ae=new Map,_e=new Map;for(let ne of Ne(Q,"commentEx")){let he=C(ne,"paraId");he&&(Ae.set(he,C(ne,"paraIdParent")),_e.set(he,C(ne,"done")==="1"||C(ne,"done")==="true"))}let Le=[];for(let ne of Ne($,"comment")){let he=C(ne,"id");if(he===void 0)continue;let ke=Ne(ne,"p"),Qe=ke.map(Ts=>$h(Ts));for(;Qe.length>1&&Qe[Qe.length-1]==="";)Qe.pop();let Gn=Date.parse(C(ne,"date")??"");Le.push({id:he,author:C(ne,"author")??"",date:Number.isFinite(Gn)?Gn:0,body:Qe.join(`
`),para:C(ke[0],"paraId")})}let fn=new Map(Le.filter(ne=>ne.para).map(ne=>[ne.para,ne])),pn=ne=>{let he=ne;for(let ke=0;ke<100;ke++){let Qe=he.para?Ae.get(he.para):void 0,Gn=Qe?fn.get(Qe):void 0;if(!Gn)break;he=Gn}return he},Tt=new Map;for(let ne of Le){let he=pn(ne);M.set(ne.id,`th_${he.id}`),Tt.set(he.id,[...Tt.get(he.id)??[],ne])}for(let[ne,he]of Tt){let ke=Le.find(Cr=>Cr.id===ne),Qe=he.map(Cr=>({id:`cm_${Cr.id}`,author:_(Cr.author),body:Cr.body,createdAt:Cr.date})),Gn=ke.para?_e.get(ke.para):!1,Ts=he[he.length-1];R.push({id:`th_${ne}`,createdAt:ke.date,comments:Qe,...Gn&&{resolved:{by:_(Ts.author),at:Ts.date}}})}}let P=new Map,B=kr(a,"footnotes"),v=n.xml(B?l(B.target):"word/footnotes.xml"),N=Ne(v,"footnote").filter(j=>!C(j,"type")||C(j,"type")==="normal");for(let j of N){let Q=C(j,"id");Q!==void 0&&P.set(Q,`fn_${Q}`)}let L=kr(a,"theme"),q=n.xml(L?l(L.target):"word/theme/theme1.xml"),Z=I(I(q,"themeElements"),"fontScheme"),X=j=>C(I(I(Z,j),"latin"),"typeface")?.trim()||void 0,V={major:X("majorFont"),minor:X("minorFont")},Y={pkg:n,warnings:u,styles:c,numbering:h,counters:new Map,usedLevels:new Set,wordNumbers:new Map,used:new Set,threadOf:M,footnotes:P,referencedNotes:new Set,themeFonts:V,acceptChanges:e.trackedChanges==="accept",authorOf:_},we=new wo(Y,o,a,"body").blocks(ze(i).filter(j=>j.name!=="sectPr")),Pe=I(i,"sectPr");Pe&&we.push({section:Vd(Pe)});let De=[],Me=[];for(let j of we)Mt(j)?(De.push({info:j.section,blocks:Me}),Me=[]):Me.push(j);(Me.length>0||De.length===0)&&De.push({info:De[De.length-1]?.info??{width:8.5,height:11,landscape:!1,margins:{top:1,right:1,bottom:1,left:1},continuous:!1,titlePg:!1,refs:[]},blocks:Me});let $e=j=>u.add(j),pe=(j,Q)=>{let Ae=Q.startsWith("header")?"header":"footer",_e=Q.endsWith("First")?"first":Q.endsWith("Even")?"even":"default",Le=j.refs.find(ke=>ke.kind===Ae&&ke.variant===_e),fn=Le?a.get(Le.rid):void 0;if(!fn)return;let pn=l(fn.target),Tt=n.xml(pn);if(!Tt)return;let he=new wo(Y,pn,n.rels(pn),"region").blocks(ze(Tt)).filter(ke=>!Mt(ke)&&ke.type!=="page_break"&&ke.type!=="toc"&&ke.type!=="section_break");return he.every(ke=>ke.type==="paragraph"&&ke.runs.length===0)?[]:he},Ee=De[0].info,dn={size:Bl(Ee,$e),orientation:Ee.landscape?"landscape":"portrait",margins:Ee.margins,...Ee.columns&&{columns:Ee.columns},...Ee.titlePg&&{differentFirstPage:!0},...b&&{differentOddEven:!0}},dt=[];De.forEach((j,Q)=>{if(Q>0){let Ae=De[Q-1].info,_e=j.info,Le={size:Bl(_e,$e),orientation:_e.landscape?"landscape":"portrait",margins:_e.margins},fn={size:Bl(Ae,$e),orientation:Ae.landscape?"landscape":"portrait",margins:Ae.margins},pn=Le.size!==fn.size||Le.orientation!==fn.orientation||["top","right","bottom","left"].some(ne=>Le.margins[ne]!==fn.margins[ne]),Tt={};for(let ne of["header","footer"])for(let he of["default","first","even"]){let ke=is(ne,he),Qe=pe(_e,ke);Qe!==void 0&&(Tt[ke]=Qe)}dt.push({id:T("b_"),type:"section_break",kind:_e.continuous&&!pn?"continuous":"next_page",..._e.columns&&{columns:_e.columns},...pn&&{page:Le},..._e.titlePg&&{differentFirstPage:!0},...Object.keys(Tt).length>0&&{regions:Tt}})}dt.push(...j.blocks)}),dt.length===0&&dt.push({id:T("b_"),type:"paragraph",runs:[]});let vr=Yt(I(n.xml("docProps/core.xml"),"title")).trim()||e.title||"Untitled",be={id:T("doc_"),type:"document",title:vr,blocks:dt,page:dn};for(let j of["header","footer","headerFirst","footerFirst","headerEven","footerEven"]){let Q=pe(Ee,j);Q&&Q.length>0&&(be={...be,[j]:Q})}let qt={};for(let j of N){let Q=C(j,"id");if(Q===void 0||!Y.referencedNotes.has(Q))continue;let _e=new wo(Y,B?l(B.target):"word/footnotes.xml",n.rels(B?l(B.target):"word/footnotes.xml"),"note").blocks(ze(j)).filter(Le=>!Mt(Le));qt[P.get(Q)]=$c(_e)}Object.keys(qt).length>0&&(be={...be,footnotes:qt});let Xt=Lh(Y);be=Uh(be,Xt.ids),Object.keys(Xt.styles).length>0&&(be={...be,styles:Xt.styles});let ft={};for(let j of R){let Ae=On(be,j.id)[0];if(!Ae)continue;let _e=Jd(be.blocks,Ae.block),Le=_e?H(_e.runs).slice(Ae.from,Ae.to).slice(0,200):"";ft[j.id]={...j,anchor:{block:Ae.block,from:Ae.from,to:Ae.to,quote:Le}}}let vo=new Set(Object.keys(ft));be={...be,blocks:Ih(be.blocks,vo)},Object.keys(ft).length>0&&(be={...be,comments:ft}),be=Fh(be,Y.wordNumbers);let Ii;try{Ii=oi(be)}catch(j){throw new S("invalid_document",`The file was read, but the result isn't a valid document: ${j.message}`,{cause:j})}let cf=new Set(ui(Ii).map(j=>j.by)),uf=[...w.values()].filter(j=>cf.has(j.id)||Object.values(ft).some(Q=>Q.comments.some(Ae=>Ae.author===j.id)));return{doc:Ii,authors:uf,warnings:[...u]}}function Ps(t,e){let n=[];return t.map(r=>{if(r.type==="table"){n.length=0;let i=r.rows.map(a=>({...a,cells:a.cells.map(l=>({...l,blocks:Ps(l.blocks,e)}))}));return{...r,rows:i}}if(r.type!=="list_item")return n.length=0,r;if(n.length=r.depth+1,r.list==="bullet")return n[r.depth]=0,r;let o=(n[r.depth]??0)+1,s=e.get(r.id);return s===void 0||s===o?(n[r.depth]=o,r):(n[r.depth]=s,{...r,start:s})})}function Fh(t,e){if(e.size===0)return t;let n={...t,blocks:Ps(t.blocks,e)};for(let r of["header","footer","headerFirst","footerFirst","headerEven","footerEven"])n[r]&&(n[r]=Ps(n[r],e));return n.footnotes&&(n.footnotes=Object.fromEntries(Object.entries(n.footnotes).map(([r,o])=>[r,Ps(o,e)]))),n.blocks=n.blocks.map(r=>r.type==="section_break"&&r.regions?{...r,regions:Object.fromEntries(Object.entries(r.regions).map(([o,s])=>[o,Ps(s,e)]))}:r),n}function $h(t){let e="",n=r=>{for(let o of ze(r))o.name==="t"?e+=Yt(o):o.name==="tab"?e+="	":o.name==="br"||o.name==="cr"?e+=`
`:(o.name==="r"||o.name==="ins"||o.name==="hyperlink"||o.name==="smartTag")&&n(o)};return n(t),e}function Jd(t,e){for(let n of t){if(n.id===e&&"runs"in n)return n;if(n.type==="table")for(let r of n.rows)for(let o of r.cells){let s=Jd(o.blocks,e);if(s)return s}}}function Ih(t,e){let n=o=>ce(o.map(s=>{let i=s.marks?.comment?.filter(u=>e.has(u));if(!s.marks?.comment||i?.length===s.marks.comment.length)return s;let{comment:a,...l}=s.marks;return{...s,marks:i&&i.length>0?{...l,comment:i}:Object.keys(l).length>0?l:void 0}})),r=o=>o.type==="table"?{...o,rows:o.rows.map(s=>({...s,cells:s.cells.map(i=>({...i,blocks:i.blocks.map(r)}))}))}:"runs"in o?{...o,runs:n(o.runs)}:o;return t.map(r)}function Lh(t){let{styles:e,used:n}=t,r=new Set(n);for(let[u,c]of e)(c.type==="paragraph"||c.type==="character")&&c.custom&&!Oi(c.name)&&!(c.type==="character"&&c.linked)&&r.add(u);let o=u=>{let c=e.get(u);return!!c&&(c.type==="paragraph"||c.type==="character")&&!Oi(c.name)&&!c.isDefault&&!(c.type==="character"&&c.linked)};for(let u of[...r]){let c=new Set([u]);for(let d=e.get(u)?.basedOn;d!==void 0&&!c.has(d);d=e.get(d)?.basedOn)c.add(d),o(d)&&e.get(d).type===e.get(u).type&&r.add(d)}let s=new Map,i=new Set;for(let u of r){if(!o(u))continue;let c=e.get(u),d=u.startsWith("Pli_")?u.slice(4):void 0,f=d&&d.length>0?d:Bi(c.name)||Bi(u)||"style";for(let p=2;i.has(f);p++)f=`${Bi(c.name)||"style"}-${p}`;i.add(f),s.set(u,f)}let a=new wo(t,"",new Map,"body"),l={};for(let[u,c]of s){let d=e.get(u),f=d.type==="character"?"character":"paragraph",p,h=new Set([u]);for(let w=d.basedOn;w!==void 0&&!h.has(w);w=e.get(w)?.basedOn){h.add(w);let O=s.get(w);if(O&&e.get(w).type===d.type){p=O;break}}let g=a.marksOf(d.rPr),y={};for(let w of qs)g[w]!==void 0&&(y[w]=g[w]);let b={name:d.name||c,kind:f,...p&&{basedOn:p},...Object.keys(y).length>0&&{marks:y}};if(f==="paragraph"){let w=jh(a,d.pPr);w.align&&(b.align=w.align),w.format&&(b.format=w.format)}l[c]=b}return{styles:l,ids:s}}function Uh(t,e){let n=s=>s.map(i=>{let a=i.marks?.style;if(a===void 0)return i;let{style:l,...u}=i.marks,c=e.get(a),d=c?{...u,style:c}:u;return Object.keys(d).length>0?{...i,marks:d}:{text:i.text}}),r=s=>{if(s.type==="table")return{...s,rows:s.rows.map(a=>({...a,cells:a.cells.map(l=>({...l,blocks:l.blocks.map(r)}))}))};if(s.type==="section_break"&&s.regions)return{...s,regions:Object.fromEntries(Object.entries(s.regions).map(([a,l])=>[a,l.map(r)]))};if(!("runs"in s))return s;let i={...s,runs:n(s.runs)};if("style"in s&&s.style!==void 0){let a=e.get(s.style);a?i.style=a:delete i.style}return i},o={...t,blocks:t.blocks.map(r)};for(let s of["header","footer","headerFirst","footerFirst","headerEven","footerEven"])t[s]&&(o[s]=t[s].map(r));return t.footnotes&&(o.footnotes=Object.fromEntries(Object.entries(t.footnotes).map(([s,i])=>[s,i.map(r)]))),o}function jh(t,e){let n=C(I(e,"jc"),"val"),r=n==="center"?"center":n==="right"||n==="end"?"right":n==="both"||n==="distribute"||n==="justify"?"justify":void 0,o=t.formatOf(e);return{...r&&{align:r},...o&&{format:o}}}function We(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function zh(t){return/^\s*(https?:|mailto:|tel:|#|\/)/i.test(t)?t:"#"}function Gh(t){return/^\s*(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);|\/|\.)/i.test(t)?t:""}function Ti(t){return t.replace(/[^\w\s#%.,()'"-]/g,"")}function Hh(t,e){let n=We(t.text).replace(/\n/g,"<br>"),r=e?Xs(e.doc,t.marks,e.paragraph):t.marks;if(!r)return n;if(r.footnote)return`<sup class="footnote-ref"><a href="#fn-${We(t.text)}" id="fnref-${We(t.text)}">${n}</a></sup>`;r.code&&(n=`<code>${n}</code>`),r.bold&&(n=`<strong>${n}</strong>`),r.italic&&(n=`<em>${n}</em>`),r.underline&&(n=`<u>${n}</u>`),r.strike&&(n=`<s>${n}</s>`),r.superscript&&(n=`<sup>${n}</sup>`),r.subscript&&(n=`<sub>${n}</sub>`);let o=[];if(r.color&&o.push(`color:${Ti(r.color)}`),r.highlight&&o.push(`background-color:${Ti(r.highlight)}`),r.fontFamily){let s=Ti(r.fontFamily).replace(/['"]/g,"").trim();s&&o.push(`font-family:${la(s).replace(/"/g,"'")}`)}if(r.fontSize&&o.push(`font-size:${Number(r.fontSize)}pt`),o.length>0&&(n=`<span style="${We(o.join(";"))}">${n}</span>`),r.link&&(n=`<a href="${We(zh(r.link))}">${n}</a>`),r.suggest){let s=r.suggest.kind==="insert"?"ins":"del";n=`<${s} data-suggestion="${We(r.suggest.id)}" data-by="${We(r.suggest.by)}" datetime="${new Date(r.suggest.at).toISOString()}">${n}</${s}>`}return n}var So=(t,e,n)=>{let r=e?.styles?{doc:e,paragraph:n?ka(n):void 0}:void 0;return t.map(o=>Hh(o,r)).join("")},Zd=(t,e)=>{let n=ka(e);return n&&t.styles?.[n]?` data-style="${We(n)}"`:""};function wr(t,e,n=[]){let r=[...n];return t&&t!=="left"&&r.push(`text-align:${t}`),e&&(e.lineHeight&&r.push(`line-height:${e.lineHeight}`),e.spaceBefore!==void 0&&r.push(`margin-top:${e.spaceBefore}pt`),e.spaceAfter!==void 0&&r.push(`margin-bottom:${e.spaceAfter}pt`),e.indentLeft&&r.push(`margin-left:${e.indentLeft}pt`),e.indentRight&&r.push(`margin-right:${e.indentRight}pt`),e.indentFirst&&r.push(`text-indent:${e.indentFirst}pt`)),r.length>0?` style="${r.join(";")}"`:""}function Al(t){return`h-${t.id}`}function Kh(t,e){let r=t.blocks.filter(s=>s.type==="heading"&&s.level<=e.levels).map(s=>`<li style="margin-left:${(s.level-1)*1.5}em"><a href="#${Al(s)}">${We(H(s.runs))}</a></li>`).join(`
`),o=e.title??"Table of contents";return`<nav class="toc">${o?`<p class="toc-title"><strong>${We(o)}</strong></p>`:""}<ul style="list-style:none;padding:0">
${r}
</ul></nav>`}function Wh(t,e){let n=Ut(t,e),r=Zd(t,e);switch(e.type){case"paragraph":return`<p${r}${wr(n.align,n.format)}>${So(e.runs,t,e)}</p>`;case"title":return`<p class="title"${r}${wr(n.align,n.format,["font-size:26pt","font-weight:bold"])}>${So(e.runs,t,e)}</p>`;case"subtitle":return`<p class="subtitle"${r}${wr(n.align,n.format,["font-size:15pt","color:#666"])}>${So(e.runs,t,e)}</p>`;case"heading":return`<h${e.level} id="${Al(e)}"${r}${wr(n.align,n.format)}>${So(e.runs,t,e)}</h${e.level}>`;case"quote":return`<blockquote${r}${wr(n.align,n.format)}><p>${So(e.runs,t,e)}</p></blockquote>`;case"code_block":return`<pre><code${e.language?` class="language-${We(e.language)}"`:""}>${We(H(e.runs))}</code></pre>`;case"divider":return"<hr>";case"page_break":return'<div class="page-break" style="break-after:page"></div>';case"section_break":return"";case"image":{let o=Gh(e.src);if(!o)return"";let s=e.wrap?`float:${e.wrap};margin:${e.wrap==="left"?"0 14px 8px 0":"0 0 8px 14px"}`:"",i=qh(e,We(o),s);return e.wrap?i:`<p${wr(e.align,void 0)}>${i}</p>`}case"toc":return Kh(t,e);case"table":return Xh(t,e)}}function qh(t,e,n){let r=Math.round(t.width),o=Math.round(t.height),s=We(t.alt??""),i=t.crop;if(!i)return`<img src="${e}" alt="${s}" width="${r}" height="${o}"${n?` style="${n}"`:""}>`;let a=t.width/(1-i.left-i.right),l=t.height/(1-i.top-i.bottom),u=c=>`${Math.round(c*100)/100}px`;return`<span style="display:inline-block;overflow:hidden;position:relative;width:${u(t.width)};height:${u(t.height)}${n?`;${n}`:""}"><img src="${e}" alt="${s}" style="position:absolute;max-width:none;width:${u(a)};height:${u(l)};left:${u(-i.left*a)};top:${u(-i.top*l)}"></span>`}var Ml="1px solid #bfbfbf";function Xh(t,e){let n=e.borders??"all",r=n==="all"?`border:${Ml}`:n==="horizontal"?`border-top:${Ml};border-bottom:${Ml}`:"border:none",o=e.columns.map(i=>`<col style="width:${(i*100).toFixed(4).replace(/\.?0+$/,"")}%">`).join(""),s=e.rows.map((i,a)=>{let l=a===0&&e.headerRow,u=l?"th":"td",c=i.cells.filter(d=>!d.covered).map(d=>{let f=d.shade??(l?"#f3f4f6":void 0),p=[r,"padding:4pt 6pt",`vertical-align:${d.vAlign??"top"}`,l?"text-align:left":"",f?`background-color:${Ti(f)}`:""].filter(Boolean).join(";"),h=(d.colSpan?` colspan="${d.colSpan}"`:"")+(d.rowSpan?` rowspan="${d.rowSpan}"`:"");return`<${u}${h} style="${p}">${Tl(t,d.blocks)}</${u}>`}).join("");return`<tr${i.height?` style="height:${i.height}pt"`:""}>${c}</tr>`}).join(`
`);return`<table style="border-collapse:collapse;width:100%;table-layout:fixed"><colgroup>${o}</colgroup>
${s}
</table>`}function Vh(t){let e=t?.find(o=>o.type==="paragraph"||o.type==="heading"||o.type==="title"||o.type==="subtitle");if(!e||!("runs"in e)||e.runs.length===0)return null;let n=e.runs.map(o=>o.marks?.field?o.marks.field==="page"?"counter(page)":"counter(pages)":`"${o.text.replace(/["\\]/g,"\\$&").replace(/\n/g," ")}"`),r="align"in e&&e.align?e.align:"left";return{align:r==="justify"?"left":r,content:n.join(" ")}}var Jh="font: 9pt Arial, sans-serif; color: #595959;";function Ai(t,e,n){let r=[];for(let[o,s]of[[t,"top"],[e,"bottom"]]){let i=Vh(o);for(let a of["left","center","right"])i&&i.align===a?r.push(`@${s}-${a} { content: ${i.content}; ${Jh} }`):n&&r.push(`@${s}-${a} { content: none; }`)}return r.join(" ")}function Zh(t){let e=t.page,n=[],r=(o,s)=>s&&n.push(`@page${o} { ${s} }`);return e?.differentOddEven?(r(" :right",Ai(t.header,t.footer,!1)),r(" :left",Ai(t.headerEven,t.footerEven,!1))):r("",Ai(t.header,t.footer,!1)),e?.differentFirstPage&&r(" :first",Ai(t.headerFirst,t.footerFirst,!0)),n.length>0?`${n.join(`
`)}
`:""}function Tl(t,e){let n=[],r=[],o=[],s=d=>d==="bullet"?"ul":"ol",i=d=>{n[n.length-1]+=d},a=d=>{for(;r.length>d;)i(`</li></${s(r.pop())}>`),o.pop()},l=(d,f)=>d.list==="ordered"?"decimal":He("bullet",f),u=(d,f)=>{let p=En(d),h=p!==l(d,d.depth)||He(d.list,d.depth)!==l(d,d.depth)?` style="list-style-type:${p}"`:"",g=f&&d.start!==void 0?` start="${d.start}"`:"";return o.push(p),`<${s(d.list)}${g}${h}>`},c=es(e);return e.forEach((d,f)=>{if(d.type!=="list_item"){a(0),n.push(Wh(t,d));return}let p=d.depth+1;a(p);let h=!1;for(r.length===p&&(r[p-1]===d.list?i("</li>"):(i(`</li></${s(r.pop())}>`),o.pop(),n.push(u(d,!0)),r.push(d.list),h=!0));r.length<p;)n.push(u(d,r.length===p-1)),r.push(d.list),h=r.length===p,r.length<p&&n.push("<li>");let g=Ut(t,d),y=c[f].marker!==o[p-1],b=!h&&d.start!==void 0?` value="${d.start}"`:"";n.push(`<li${b}${Zd(t,d)}${wr(g.align,g.format,y?[`list-style-type:${c[f].marker}`]:[])}>${So(d.runs,t,d)}`)}),a(0),n.join(`
`)}function Yh(t){let n=Ze(t.blocks).flatMap((r,o)=>{let s=t.footnotes?.[r];return s?[`<li id="fn-${o+1}">${Tl(t,s)} <a class="footnote-back" href="#fnref-${o+1}">\u21A9</a></li>`]:[]});return n.length>0?`
<section class="footnotes">
<hr>
<ol>
${n.join(`
`)}
</ol>
</section>`:""}function Yd(t,e){let n=new Map,r=zt(t,e,0);return e.forEach((o,s)=>{s>0&&!Yo(zt(t,e,s),r)&&n.set(o,`section${s+1}`)}),n}function Qh(t){let e=Pt(t);return[...Yd(t,e)].map(([n,r])=>{let o=zt(t,e,e.indexOf(n)),{width:s,height:i}=fr(o),a=o.margins;return`@page ${r} { size: ${s}in ${i}in; margin: ${a.top}in ${a.right}in ${a.bottom}in ${a.left}in; }`}).join(`
`)}function eg(t){let e=Pt(t),n=Yd(t,e);return e.map(r=>{let o=Tl(t,t.blocks.slice(r.from,r.to)),s=[];r.start?.kind==="next_page"&&s.push("break-before:page");let i=n.get(r);i&&s.push(`page:${i}`);let{count:a,gap:l,rule:u}=r.columns;return a>1&&(s.push(`column-count:${a}`,`column-gap:${l}pt`),u&&s.push("column-rule:1px solid #bbb")),s.length>0?`<div class="section" style="${s.join(";")}">
${o}
</div>`:o}).filter(r=>r!=="").join(`
`)}function Bs(t,e={}){let n=Zs(t),r=eg(n)+Yh(n);if(!e.fullDocument)return r;let o=jt(n),{width:s,height:i}=fr(o),a=o.margins;return`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${We(n.title)}</title>
<style>
@page { size: ${s}in ${i}in; margin: ${a.top}in ${a.right}in ${a.bottom}in ${a.left}in; }
${Zh(n)}${Qh(n)}
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.15; }
p { margin: 0 0 8pt; }
img { max-width: 100%; height: auto; }
pre { background: #f2f2f2; padding: 8pt; white-space: pre-wrap; }
table p { margin: 0 0 4pt; }
td > :last-child, th > :last-child { margin-bottom: 0; }
.footnotes { font-size: 9pt; color: #333; }
.footnotes ol { padding-left: 18pt; }
.footnotes p { margin: 0 0 3pt; display: inline; }
sup.footnote-ref a { text-decoration: none; }
blockquote { margin-left: 0; padding-left: 12pt; border-left: 3pt solid #ccc; color: #555; }
</style>
</head>
<body>
${r}
</body>
</html>
`}var tg=/([\\`*_[\]<>])/g;function xo(t){return t.replace(tg,"\\$1")}function ng(t){return t.replace(/^(\s*)(#{1,6}|[-+])(?=\s)/,"$1\\$2").replace(/^(\s*\d+)\.(?=\s)/,"$1\\.")}function Qd(t){return t.replace(/\n/g,`  
`)}function cn(t){let e=t.marks;if(!e)return xo(t.text);if(e.footnote)return`[^${t.text}]`;let n=t.text.match(/^\s*/)[0],r=t.text.slice(n.length).match(/\s*$/)[0],o=t.text.slice(n.length,t.text.length-r.length);if(o==="")return t.text;let s=e.code?"`"+o.replace(/`/g,"\\`")+"`":xo(o);return e.bold&&(s=`**${s}**`),e.italic&&(s=`*${s}*`),(e.strike||e.suggest?.kind==="delete")&&(s=`~~${s}~~`),e.underline&&(s=`<u>${s}</u>`),e.superscript&&(s=`<sup>${s}</sup>`),e.subscript&&(s=`<sub>${s}</sub>`),e.link&&(s=`[${s}](${e.link.replace(/\)/g,"%29")})`),n+s+r}function rg(t){switch(t.type){case"image":return`![${xo(t.alt??"")}](${t.src.replace(/\)/g,"%29")})`;case"list_item":return"\u2022 "+t.runs.map(cn).join("");case"divider":return"";case"code_block":return"`"+H(t.runs).replace(/`/g,"\\`")+"`";default:return"runs"in t?t.runs.map(cn).join(""):""}}function og(t){let e=s=>s.blocks.map(rg).filter(i=>i!=="").join("<br>").replace(/\|/g,"\\|").replace(/\n/g,"<br>")||" ",n=s=>`| ${s.join(" | ")} |`,[r,...o]=t.rows;return r?[n(r.cells.map(e)),n(r.cells.map(()=>"---")),...o.map(s=>n(s.cells.map(e)))]:[]}function sg(t){let e=new Map,n=new Map;for(let r of t.blocks){if(r.type!=="heading")continue;let o=H(r.runs).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,"").trim().replace(/\s/g,"-")||"section",s=n.get(o)??0;n.set(o,s+1),e.set(r.id,s===0?o:`${o}-${s}`)}return e}function Ri(t){let e=Zs(t),n=sg(e),r=[],o=[],s=!1;for(let i of e.blocks)switch(i.type!=="list_item"&&(o.length=0,s&&r.push(""),s=!1),i.type){case"paragraph":r.push(ng(Qd(i.runs.map(cn).join(""))),"");break;case"heading":r.push("#".repeat(i.level)+" "+i.runs.map(cn).join("").replace(/\n/g," "),"");break;case"title":r.push("# "+i.runs.map(cn).join("").replace(/\n/g," "),"");break;case"subtitle":r.push("_"+i.runs.map(cn).join("").replace(/\n/g," ")+"_","");break;case"image":r.push(`![${xo(i.alt??"")}](${i.src.replace(/\)/g,"%29")})`,"");break;case"table":r.push(...og(i),"");break;case"section_break":break;case"page_break":r.push('<div style="page-break-after: always"></div>',"");break;case"toc":{let a=e.blocks.filter(u=>u.type==="heading"&&u.level<=i.levels),l=i.title??"Table of contents";l&&r.push(`**${xo(l)}**`,"");for(let u of a){let c=xo(H(u.runs));r.push(`${"  ".repeat(u.level-1)}- [${c}](#${n.get(u.id)})`)}r.push("");break}case"quote":r.push(...i.runs.map(cn).join("").replace(/\n/g,`  
`).split(`
`).map(a=>"> "+a),"");break;case"code_block":{let a=H(i.runs),l="`".repeat(Math.max(3,ig(a)+1));r.push(l+(i.language??""),a,l,"");break}case"divider":r.push("---","");break;case"list_item":{o.length=i.depth+1;let a="-";i.list==="ordered"?(o[i.depth]=i.start??(o[i.depth]??0)+1,a=`${o[i.depth]}.`):o[i.depth]=0;let l="   ".repeat(i.depth),u=i.runs.map(cn).join("").replace(/\n/g,`  
`+l+"  ");r.push(l+a+" "+u),s=!0;break}}for(Ze(e.blocks).forEach((i,a)=>{let l=(e.footnotes?.[i]??[]).flatMap(u=>"runs"in u?[Qd(u.runs.map(cn).join(""))]:[]);l.length!==0&&r.push(`[^${a+1}]: ${l[0]}`,...l.slice(1).flatMap(u=>["",`    ${u}`]),"")});r.length>0&&r[r.length-1]==="";)r.pop();return r.join(`
`)+`
`}function ig(t){let e=0;for(let n of t.matchAll(/`+/g))e=Math.max(e,n[0].length);return e}var Di={_:"Everything the Swift and Kotlin packages can do to a document. The bridge runs these, and scripts/generate.mjs writes the typed Swift and Kotlin methods from them, so the three stay in step. Types: string, int, double, bool, with ? for optional.",commands:[{name:"typeText",params:[{name:"text",type:"string"}],returns:"bool",doc:"Types at the caret, replacing any selected text."},{name:"pasteText",params:[{name:"text",type:"string"}],returns:"bool",doc:"Pastes plain text; line breaks become new paragraphs."},{name:"paste",params:[{name:"html",type:"string?"},{name:"rtf",type:"string?"},{name:"text",type:"string?"}],returns:"bool",doc:"Pastes what a clipboard offered, keeping formatting: HTML (a web page, Word, Google Docs), else RTF (Pages, TextEdit), else tab-separated text as a table, else the text."},{name:"splitBlock",params:[],returns:"bool",doc:"Enter: splits the paragraph at the caret."},{name:"backspace",params:[],returns:"bool",doc:"Backspace."},{name:"deleteForward",params:[],returns:"bool",doc:"Delete."},{name:"deleteSelection",params:[],returns:"bool",doc:"Deletes the selected text."},{name:"undo",params:[],returns:"bool",doc:"Undoes the last change."},{name:"redo",params:[],returns:"bool",doc:"Redoes the last undone change."},{name:"toggleBold",params:[],returns:"bool",doc:"Turns bold on or off for the selection, or for the next typed text at a caret."},{name:"toggleItalic",params:[],returns:"bool",doc:"Turns italic on or off."},{name:"toggleUnderline",params:[],returns:"bool",doc:"Turns underline on or off."},{name:"toggleStrikethrough",params:[],returns:"bool",doc:"Turns strikethrough on or off."},{name:"toggleCode",params:[],returns:"bool",doc:"Turns the code style on or off."},{name:"toggleSuperscript",params:[],returns:"bool",doc:"Turns superscript on or off."},{name:"toggleSubscript",params:[],returns:"bool",doc:"Turns subscript on or off."},{name:"setTextColor",params:[{name:"color",type:"string?"}],returns:"bool",doc:'Sets the text color, such as "#b91c1c". Null removes it.'},{name:"setHighlight",params:[{name:"color",type:"string?"}],returns:"bool",doc:"Sets the highlight color. Null removes it."},{name:"setFontFamily",params:[{name:"family",type:"string?"}],returns:"bool",doc:`Sets the font, such as "Georgia". Null goes back to the document's.`},{name:"setFontSize",params:[{name:"points",type:"double?"}],returns:"bool",doc:"Sets the font size in points. Null goes back to the document's."},{name:"setLink",params:[{name:"url",type:"string?"}],returns:"bool",doc:"Links the selected text to an address. Null removes the link."},{name:"clearFormatting",params:[],returns:"bool",doc:"Removes formatting and styles from the selection."},{name:"setParagraph",params:[],returns:"bool",doc:"Makes the selected blocks ordinary paragraphs."},{name:"setTitle",params:[],returns:"bool",doc:"Makes the selected blocks the document title style."},{name:"setSubtitle",params:[],returns:"bool",doc:"Makes the selected blocks the subtitle style."},{name:"setHeading",params:[{name:"level",type:"int"}],returns:"bool",doc:"Makes the selected blocks headings of level 1 to 6."},{name:"setQuote",params:[],returns:"bool",doc:"Makes the selected blocks quotes."},{name:"setCodeBlock",params:[],returns:"bool",doc:"Makes the selected blocks code blocks."},{name:"toggleBulletedList",params:[],returns:"bool",doc:"Makes the selected blocks a bulleted list, or ordinary paragraphs if they already are."},{name:"toggleNumberedList",params:[],returns:"bool",doc:"Makes the selected blocks a numbered list, or ordinary paragraphs if they already are."},{name:"setAlignment",params:[{name:"alignment",type:"string",oneOf:["left","center","right","justify"],enum:"Alignment"}],returns:"bool",doc:"Aligns the selected blocks: left, center, right or justify."},{name:"indent",params:[],returns:"bool",doc:"Moves the selected blocks in."},{name:"outdent",params:[],returns:"bool",doc:"Moves the selected blocks out."},{name:"setListMarker",params:[{name:"marker",type:"string?",oneOf:["decimal","lower-alpha","upper-alpha","lower-roman","upper-roman","disc","circle","square"],enum:"ListMarker"}],returns:"bool",doc:"Sets how the selected lists are marked: numbers, letters or roman numerals for a numbered list, a symbol for a bulleted one. Null goes back to the default for the depth."},{name:"setListStart",params:[{name:"start",type:"int"}],returns:"bool",doc:"Numbers the first selected item of a numbered list with `start` and carries on from it: restarts a list at 1, or starts it at any number."},{name:"continueNumbering",params:[],returns:"bool",doc:"Takes the selected numbered items back into the numbering of the list above them, undoing a restart."},{name:"setLineSpacing",params:[{name:"multiple",type:"double?"}],returns:"bool",doc:"Sets line spacing as a multiple of the font size, such as 1.5. Null removes it."},{name:"setSpaceBefore",params:[{name:"points",type:"double?"}],returns:"bool",doc:"Sets the space above the selected paragraphs, in points."},{name:"setSpaceAfter",params:[{name:"points",type:"double?"}],returns:"bool",doc:"Sets the space below the selected paragraphs, in points."},{name:"insertTable",params:[{name:"rows",type:"int"},{name:"columns",type:"int"}],returns:"bool",doc:"Inserts a table at the caret."},{name:"addRowAbove",params:[],returns:"bool",doc:"Adds a table row above the one the caret is in."},{name:"addRowBelow",params:[],returns:"bool",doc:"Adds a table row below the one the caret is in."},{name:"addColumnLeft",params:[],returns:"bool",doc:"Adds a table column left of the one the caret is in."},{name:"addColumnRight",params:[],returns:"bool",doc:"Adds a table column right of the one the caret is in."},{name:"deleteRow",params:[],returns:"bool",doc:"Deletes the selected table rows (the table, if that is every row)."},{name:"deleteColumn",params:[],returns:"bool",doc:"Deletes the selected table columns (the table, if that is every column)."},{name:"deleteTable",params:[],returns:"bool",doc:"Deletes the table the caret is in."},{name:"mergeCells",params:[],returns:"bool",doc:"Merges the selected cells (a selection from one cell to another) into one."},{name:"splitCells",params:[],returns:"bool",doc:"Splits merged cells in the selection back into single cells."},{name:"setHeaderRow",params:[{name:"on",type:"bool"}],returns:"bool",doc:"Turns a table's first row into a header row, or back."},{name:"setCellShade",params:[{name:"color",type:"string?"}],returns:"bool",doc:'Shades the selected cells, such as "#fef08a". Null clears it.'},{name:"setColumnEdge",params:[{name:"table",type:"string"},{name:"column",type:"int"},{name:"position",type:"double"},{name:"merge",type:"bool"}],returns:"bool",doc:"Moves the edge between a table's column and the next one, to `position` (0 to 1, from the table's left edge). The neighbouring columns trade width; the others keep theirs. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"setRowHeight",params:[{name:"table",type:"string"},{name:"row",type:"int"},{name:"points",type:"double?"},{name:"merge",type:"bool"}],returns:"bool",doc:"Sets the least height of a table's row, in points. Null lets it fit its content. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"insertPageBreak",params:[],returns:"bool",doc:"Inserts a page break at the caret."},{name:"insertDivider",params:[],returns:"bool",doc:"Inserts a horizontal rule at the caret."},{name:"insertImage",params:[{name:"source",type:"string"},{name:"width",type:"int"},{name:"height",type:"int"},{name:"description",type:"string?"}],returns:"bool",doc:"Inserts a picture at the caret from a data: URI or an address, shown at width by height in points of 1/96 inch."},{name:"setImageSize",params:[{name:"image",type:"string"},{name:"width",type:"int"},{name:"height",type:"int"},{name:"merge",type:"bool"}],returns:"bool",doc:"Sets the size a picture is shown at, in pixels. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"setImageCrop",params:[{name:"image",type:"string"},{name:"top",type:"double"},{name:"right",type:"double"},{name:"bottom",type:"double"},{name:"left",type:"double"},{name:"merge",type:"bool"}],returns:"bool",doc:"Crops a picture: how much to cut away from each edge, as a share of the whole picture (0 to 0.9). All zeros shows all of it again. The picture's scale stays the same, so cutting an edge makes it smaller on the page, as it does in Word. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"setImageWrap",params:[{name:"image",type:"string"},{name:"wrap",type:"string?",oneOf:["left","right"]}],returns:"bool",doc:"Makes text wrap around a picture, which sits at the left or right edge, or puts it back on a line of its own with null. A picture in a table cell stays on its own line."},{name:"deleteImage",params:[{name:"image",type:"string"}],returns:"bool",doc:"Deletes a picture."},{name:"setDocumentTitle",params:[{name:"title",type:"string"}],returns:"void",doc:"Renames the document."},{name:"applyParagraphStyle",params:[{name:"id",type:"string?"}],returns:"bool",doc:"Sets the named paragraph style of the selected paragraphs. Null takes it off."},{name:"applyCharacterStyle",params:[{name:"id",type:"string?"}],returns:"bool",doc:"Sets the named character style of the selected text. Null takes it off."},{name:"createStyle",params:[{name:"name",type:"string"},{name:"kind",type:"string",oneOf:["paragraph","character"],enum:"StyleKind"}],returns:"string?",doc:"Makes a named style from the selection and applies it. Returns its id."},{name:"deleteStyle",params:[{name:"id",type:"string"}],returns:"bool",doc:"Removes a style and takes it off the text that used it."},{name:"select",params:[{name:"anchorBlock",type:"string"},{name:"anchorOffset",type:"int"},{name:"focusBlock",type:"string"},{name:"focusOffset",type:"int"}],returns:"void",doc:"Selects text. Offsets are UTF-16 units into a block's text."},{name:"selectAll",params:[],returns:"void",doc:"Selects the whole document."},{name:"setSuggesting",params:[{name:"on",type:"bool"}],returns:"bool",doc:"Turns suggesting mode on or off. False when the current user may not suggest."},{name:"acceptSuggestion",params:[{name:"id",type:"string"}],returns:"bool",doc:"Accepts a suggestion."},{name:"rejectSuggestion",params:[{name:"id",type:"string"}],returns:"bool",doc:"Rejects a suggestion."},{name:"acceptAllSuggestions",params:[],returns:"bool",doc:"Accepts every suggestion the current user may accept."},{name:"rejectAllSuggestions",params:[],returns:"bool",doc:"Rejects every suggestion the current user may reject."}]};var ef={_:"What the Swift and Kotlin packages can do with a workbook, a deck and a PDF (documents are in catalog.json). Each method is written as a signature; types are string, int, double, bool, json, scalar (a string, number, boolean or null), T?, [T], map<T>, or the name of an enum or type of the editor. The engine (src/editors/*.ts) implements every method here and checks each call's arguments against it, and scripts/generate.mjs writes the typed Swift and Kotlin from it.",shared:["User","Thread","Comment","Peer"],editors:{docs:{class:"PliDocument",engine:"pli-engine.js",extends:!0,doc:"What a document has beyond the commands of catalog.json: comments anchored to text.",enums:{},types:{CommentRange:{doc:"Where a comment thread's text is now: a block, and a range of its text in UTF-16 units.",fields:{block:"string",from:"int",to:"int"}}},methods:[{sig:"commentOnSelection(body: string, mentions: [string]?): Thread?",doc:'Starts a comment thread on the selected text, with `body` as its first comment, as one undo step. Returns nil when no text is selected. The thread\'s anchor is `{"block": \u2026, "from": \u2026, "to": \u2026, "quote": \u2026}`.'},{sig:"commentRanges(thread: string): [CommentRange]",doc:"Where the thread's text is now, one range per block it covers; empty once the text is gone."},{sig:"threadsAtSelection(): [Thread]",doc:"The threads attached to the text at the caret, or anywhere in the selection, in the order they were started."}],files:[]},sheets:{class:"PliWorkbook",engine:"pli-sheets.js",doc:"A workbook: sheets of cells with formulas that recalculate, number formats, styles, tables and charts.",enums:{ClearWhat:["all","contents","formats"],FillDirection:["down","right"]},types:{SheetInfo:{doc:"A sheet of the workbook.",fields:{id:"string",name:"string",hidden:"bool",usedRange:"string?",tabColor:"string?"}},CellInfo:{doc:"A cell as it shows and as it was typed. `value` is what it is worth (null when empty or an error), `error` is the formula error such as `#DIV/0!`, `text` is the value with its number format, and `formula` is what was typed when it starts with `=`.",fields:{address:"string",value:"json",error:"string?",text:"string",formula:"string?",format:"string?"}},FoundCell:{doc:"A cell that has the text looked for.",fields:{sheet:"string",address:"string",text:"string"}},ReplaceResult:{doc:"What replacing text did.",fields:{cells:"int",occurrences:"int",skipped:"int"}}},methods:[{sig:"title(): string",doc:"The workbook's title."},{sig:"setTitle(title: string): void",doc:"Renames the workbook."},{sig:"sheets(): [SheetInfo]",doc:"The sheets, in tab order."},{sig:"usedRange(sheet: string): string?",doc:"Where the sheet has anything, as a range such as `A1:D20`, or nil when it is empty."},{sig:"cell(sheet: string, address: string): CellInfo",doc:"One cell: its value, how it shows and what was typed. `sheet` is a name (any case) or an id."},{sig:"value(sheet: string, address: string): json",doc:'What the cell is worth: a number, text, true or false, nil for an empty cell, or `{"error": "#DIV/0!"}`.'},{sig:"text(sheet: string, address: string): string",doc:"The cell as it shows, with its number format applied."},{sig:"values(sheet: string, range: string): json",doc:"The values of a range, row by row, as a list of lists."},{sig:"toText(sheet: string, range: string): string",doc:"A range as tab-separated text, as the clipboard has it."},{sig:"toHtml(sheet: string, range: string): string",doc:"A range as an HTML table, with its formatting."},{sig:"merges(sheet: string): [string]",doc:"The merged ranges of a sheet."},{sig:"find(text: string, matchCase: bool?, wholeCell: bool?, sheet: string?): [FoundCell]",doc:"Finds cells that show the text, in one sheet or in every visible sheet. `*` stands for any text and `?` for any one character."},{sig:"replace(text: string, replacement: string, matchCase: bool?, wholeCell: bool?, sheet: string?): ReplaceResult",doc:"Replaces text in what cells hold, as one undo step."},{sig:"setCell(sheet: string, address: string, value: scalar): void",doc:"Types into a cell as a person would: text that starts with `=` is a formula, and numbers, dates and percentages in text become what they look like."},{sig:"setCells(sheet: string, inputs: map<scalar>): void",doc:"Types into several cells at once, keyed by address, as one undo step."},{sig:"setValues(sheet: string, at: string, rows: json): void",doc:"Puts a block of values (a list of rows) with its top left at `at`."},{sig:"clear(sheet: string, range: string, what: ClearWhat): void",doc:"Clears the contents, the formats, or both."},{sig:"setFormat(sheet: string, range: string, format: string?): void",doc:"Sets the number format, such as `0.00`, `#,##0`, `0%` or `yyyy-mm-dd`; nil goes back to General."},{sig:"setStyle(sheet: string, range: string, style: json): void",doc:'Changes the look of a range: `{"bold": true, "fill": "#ffeeaa", "color": "#222222", "align": "center"}`. A property set to null is removed.'},{sig:"fill(sheet: string, range: string, direction: FillDirection): void",doc:"Copies the first row (or column) of the range over the rest, moving the formulas' references."},{sig:"autofill(sheet: string, source: string, target: string): void",doc:"Continues a series (1, 2, 3 or Monday, Tuesday) from the source range over the target."},{sig:"copy(sheet: string, range: string, toSheet: string, at: string, cut: bool): void",doc:"Copies a range to where `at` is on another (or the same) sheet; with `cut`, it moves and formulas that point at it follow."},{sig:"sort(sheet: string, range: string, by: int?, descending: bool?, header: bool?): void",doc:"Sorts the rows of a range by one column (1 is the range's first column, the default)."},{sig:"insertRows(sheet: string, at: int, count: int): void",doc:"Inserts rows before row `at` (1 is the first). Formulas that point at the rows after them follow."},{sig:"deleteRows(sheet: string, at: int, count: int): void",doc:"Deletes rows; references to deleted cells become `#REF!`."},{sig:"insertColumns(sheet: string, at: int, count: int): void",doc:"Inserts columns before column `at` (1 is A)."},{sig:"deleteColumns(sheet: string, at: int, count: int): void",doc:"Deletes columns."},{sig:"setColumnWidth(sheet: string, column: int, width: double?): void",doc:"Sets a column's width in pixels (nil for the default); `column` is 1 for A."},{sig:"setRowHeight(sheet: string, row: int, height: double?): void",doc:"Sets a row's height in pixels (nil for the default)."},{sig:"setFrozen(sheet: string, rows: int, cols: int): void",doc:"Freezes the top rows and left columns."},{sig:"mergeCells(sheet: string, range: string): void",doc:"Merges a range into one cell."},{sig:"unmergeCells(sheet: string, range: string): void",doc:"Takes a merge apart."},{sig:"setNote(sheet: string, address: string, text: string?): void",doc:"Puts a note on a cell, or takes it off with nil."},{sig:"setFilter(sheet: string, range: string?): void",doc:"Puts filter buttons on the first row of a range, or takes the filter off with nil."},{sig:"defineName(name: string, formula: string?): void",doc:"Defines a name that formulas can use (`=Tax*A1`), or removes it with nil."},{sig:"addSheet(name: string?, index: int?): SheetInfo",doc:"Adds an empty sheet."},{sig:"deleteSheet(sheet: string): void",doc:"Deletes a sheet. The last sheet stays."},{sig:"renameSheet(sheet: string, name: string): void",doc:"Renames a sheet; formulas that name it follow."},{sig:"moveSheet(sheet: string, index: int): void",doc:"Moves a sheet's tab."},{sig:"setTabColor(sheet: string, color: string?): void",doc:"Colours a sheet's tab (`#rrggbb`), or clears it with nil."},{sig:"insertChart(sheet: string, range: string, type: string?): json",doc:"Makes a chart from a range (the first row and column are labels) and returns it: type is `column`, `bar`, `line`, `area`, `pie`, `scatter` and the rest the chart types list."},{sig:"commentOnRange(sheet: string, range: string, body: string, mentions: [string]?): Thread",doc:'Starts a comment thread on a cell or a range (`B3`, `B3:C5`). The thread\'s anchor is `{"sheet": <the sheet\'s id>, "range": "B3"}`, so it stays with the sheet when it is renamed.'},{sig:"threadsAt(sheet: string, address: string): [Thread]",doc:"The comment threads whose cell or range holds this cell, oldest first."},{sig:"undo(): bool",doc:"Undoes the last step."},{sig:"redo(): bool",doc:"Does the undone step again."}],files:[{name:"exportXlsx",format:"xlsx",direction:"export",doc:"The workbook as an .xlsx file."},{name:"importXlsx",format:"xlsx",direction:"import",doc:"Replaces the workbook with an .xlsx file. History starts again."},{name:"exportCsv",format:"csv",direction:"export",params:"sheet: string?, delimiter: string?",doc:"One sheet as CSV text (UTF-8), formulas written as what they work out to. The first visible sheet by default.",text:!0},{name:"importCsv",format:"csv",direction:"import",params:"delimiter: string?",doc:"Replaces the workbook with a sheet holding the CSV.",text:!0},{name:"exportPdf",format:"pdf",direction:"export",async:!0,params:"sheet: string?",doc:"One sheet as a PDF, paged as it prints (page setup, print area and titles)."}]},decks:{class:"PliDeck",engine:"pli-decks.js",doc:"A deck of slides: masters and layouts, text, shapes, pictures, tables and charts, with notes and transitions.",enums:{ArrangeHow:["front","back","forward","backward"],AlignHow:["left","center","right","top","middle","bottom"]},types:{SlideInfo:{doc:"A slide of the deck.",fields:{id:"string",name:"string?",layout:"string",title:"string?",notes:"string",skipped:"bool",elements:"int"}},ElementInfo:{doc:"An element of a slide, layout or master. Position and size are in points; they are nil for a placeholder that takes them from its layout.",fields:{id:"string",type:"string",name:"string?",x:"double?",y:"double?",w:"double?",h:"double?",rotation:"double?",text:"string?",placeholder:"string?"}},LayoutInfo:{doc:"A layout a slide can use.",fields:{id:"string",name:"string",master:"string"}},DeckSize:{doc:"The size of the slides, in points.",fields:{width:"double",height:"double"}},DeckFindHit:{doc:"Where text was found.",fields:{slide:"string",element:"string?",paragraph:"int",offset:"int",length:"int"}}},methods:[{sig:"title(): string",doc:"The deck's title."},{sig:"setTitle(title: string): void",doc:"Renames the deck."},{sig:"size(): DeckSize",doc:"The size of the slides."},{sig:"setSize(width: double, height: double, scale: bool): void",doc:"Changes the slide size; with `scale` the elements are scaled to fit."},{sig:"slides(): [SlideInfo]",doc:"The slides, in order."},{sig:"layouts(): [LayoutInfo]",doc:"The layouts of every master."},{sig:"elements(slide: string): [ElementInfo]",doc:"The elements of a slide (or a layout or master, by its id), from the back to the front."},{sig:"notes(slide: string): string",doc:"A slide's speaker notes."},{sig:"find(query: string, matchCase: bool?, notes: bool?): [DeckFindHit]",doc:"Finds text in the slides (and in the notes with `notes`)."},{sig:"addSlide(layout: string?, after: string?): SlideInfo",doc:"Adds a slide from a layout (the first by default), after another slide (the end by default)."},{sig:"duplicateSlides(ids: [string]): [string]",doc:"Duplicates slides; returns the new ids."},{sig:"deleteSlides(ids: [string]): void",doc:"Deletes slides."},{sig:"moveSlides(ids: [string], to: int): void",doc:"Moves slides so that the first lands at position `to` (0 is first)."},{sig:"renameSlide(slide: string, name: string): void",doc:"Names a slide."},{sig:"setNotes(slide: string, notes: string): void",doc:"Sets the speaker notes."},{sig:"setSkipped(ids: [string], skipped: bool): void",doc:"Skips slides when presenting."},{sig:"setLayout(slide: string, layout: string): void",doc:"Gives a slide another layout; its placeholders follow."},{sig:"setBackground(ids: [string], fill: json): void",doc:'Sets the background of slides to a fill (a colour such as `"#102040"` or `{"theme": "dk2"}`), or back to the layout\'s with nil.'},{sig:"setTransition(ids: [string], transition: json): void",doc:"Sets how slides change when presenting, or none with nil."},{sig:"addTextBox(slide: string, x: double, y: double, w: double, h: double, text: string): string",doc:"Puts a text box on a slide. Returns its id."},{sig:"addShape(slide: string, geometry: string, x: double, y: double, w: double, h: double): string",doc:"Puts a shape (`rect`, `ellipse`, `rightArrow`, any preset name) on a slide. Returns its id."},{sig:"addImage(slide: string, src: string, width: double, height: double, x: double?, y: double?): string",doc:"Puts a picture on a slide: `src` is a `data:` address, or a reference your storage knows. Returns its id."},{sig:"addTable(slide: string, rows: int, columns: int): string",doc:"Puts an empty table on a slide. Returns its id."},{sig:"addChart(slide: string, chartType: string): string",doc:"Puts a sample chart on a slide (`column`, `bar`, `line`, `area`, `pie`, `doughnut`, `scatter`). Returns its id."},{sig:"setText(slide: string, element: string, text: string): void",doc:"Replaces the text of a shape; line breaks start new paragraphs."},{sig:"formatText(slide: string, ids: [string], patch: json): void",doc:'Formats the text of shapes: `{"bold": true, "fontSize": 24, "color": "#c00000"}`. A property set to null is removed.'},{sig:"setFrame(slide: string, element: string, x: double?, y: double?, w: double?, h: double?, rotation: double?): void",doc:"Moves, resizes and turns an element; a value left out stays."},{sig:"moveBy(slide: string, ids: [string], dx: double, dy: double): void",doc:"Moves elements by a distance in points."},{sig:"setFill(slide: string, ids: [string], fill: json): void",doc:'Fills shapes with a colour (`"#ffffff"` or `{"theme": "accent1"}`), or none with nil.'},{sig:"deleteElements(slide: string, ids: [string]): void",doc:"Deletes elements."},{sig:"duplicateElements(slide: string, ids: [string]): [string]",doc:"Duplicates elements, a little to the side. Returns the new ids."},{sig:"arrange(slide: string, ids: [string], how: ArrangeHow): void",doc:"Changes the drawing order."},{sig:"align(slide: string, ids: [string], how: AlignHow): void",doc:"Aligns elements to each other, or one element to the slide."},{sig:"group(slide: string, ids: [string]): string?",doc:"Groups elements. Returns the group's id."},{sig:"ungroup(slide: string, id: string): [string]",doc:"Takes a group apart. Returns the ids of what was in it."},{sig:"replaceAll(query: string, replacement: string, matchCase: bool?, notes: bool?): int",doc:"Replaces text in every slide; returns how many places changed."},{sig:"commentOnSlide(slide: string, body: string, mentions: [string]?): Thread",doc:"Starts a comment thread on a slide. The thread's anchor is `{\"slide\": <the slide's id>}`."},{sig:"commentOnElement(slide: string, element: string, body: string, mentions: [string]?): Thread",doc:'Starts a comment thread on an element of a slide. The anchor is `{"slide": \u2026, "element": \u2026}`.'},{sig:"threadsOn(slide: string, element: string?): [Thread]",doc:"The comment threads on a slide, or on one of its elements, oldest first."},{sig:"undo(): bool",doc:"Undoes the last step."},{sig:"redo(): bool",doc:"Does the undone step again."}],files:[{name:"exportPptx",format:"pptx",direction:"export",doc:"The deck as a .pptx file."},{name:"importPptx",format:"pptx",direction:"import",doc:"Replaces the deck with a .pptx file. History starts again."},{name:"exportPdf",format:"pdf",direction:"export",params:"slides: [string]?",doc:"The slides as a PDF, one page each; skipped slides are left out unless listed."}]},pdf:{class:"PliPdf",engine:"pli-pdf.js",doc:"A PDF: pages, annotations, form fields, text search and redaction, written back as the original file plus your changes.",enums:{MarkupKind:["highlight","underline","strikeout","squiggly"],ShapeKind:["square","circle"]},types:{PageInfo:{doc:"A page of the PDF. Sizes are in points.",fields:{id:"string",number:"int",width:"double",height:"double",rotate:"int",label:"string?",annotations:"int"}},AnnotationInfo:{doc:"An annotation on a page. `rect` is in page space.",fields:{id:"string",type:"string",page:"string",contents:"string?",author:"string?",thread:"string?"}},FieldInfo:{doc:"A form field.",fields:{id:"string",name:"string",type:"string",value:"json"}},SearchHit:{doc:"Where text was found. `rects` are one per line the match covers, in page space.",fields:{page:"string",text:"string",rects:"json"}},RedactionResult:{doc:"What applying redactions did.",fields:{pages:"[string]",rects:"int",removedAnnotations:"int"}},PdfMeta:{doc:"The file's own information.",fields:{title:"string?",author:"string?",subject:"string?",keywords:"string?",creator:"string?"}}},methods:[{sig:"pages(): [PageInfo]",doc:"The pages, in order."},{sig:"annotations(page: string): [AnnotationInfo]",doc:"The annotations of a page, bottom to top."},{sig:"fields(): [FieldInfo]",doc:"The form fields."},{sig:"formData(): json",doc:"The form's values by field name."},{sig:"metadata(): PdfMeta",doc:"The title, author and the rest the file says about itself."},{sig:"outline(): json",doc:"The bookmarks, as a tree."},{sig:"text(page: string): string",doc:"The text of a page, in reading order."},{sig:"search(query: string, caseSensitive: bool?, wholeWord: bool?): [SearchHit]",doc:"Finds text on every page."},{sig:"setMetadata(patch: json): void",doc:'Changes the file\'s information: `{"title": "Annual report"}`; null removes one.'},{sig:"rotatePages(ids: [string], degrees: int): void",doc:"Turns pages by 90, -90 or 180 degrees."},{sig:"deletePages(ids: [string]): void",doc:"Takes pages out, with what is on them. The last page stays."},{sig:"movePages(ids: [string], index: int): void",doc:"Moves pages so that the first lands at position `index`."},{sig:"duplicatePages(ids: [string]): [string]",doc:"Duplicates pages; returns the new ids."},{sig:"insertBlankPage(after: string?, width: double?, height: double?): string",doc:"Adds a blank page after another (the end by default), Letter size unless sized. Returns its id."},{sig:"addHighlight(page: string, rects: json, kind: MarkupKind?, color: string?, quote: string?): string",doc:'Marks text with a highlight, underline or strikeout over rectangles `[{"x": 72, "y": 700, "w": 100, "h": 12}]`. Returns its id.'},{sig:"addNote(page: string, x: double, y: double, text: string): string",doc:"Puts a sticky note on a page. Returns its id."},{sig:"addShape(page: string, kind: ShapeKind, x: double, y: double, w: double, h: double, color: string?): string",doc:"Draws a rectangle or an ellipse. Returns its id."},{sig:"addFreeText(page: string, x: double, y: double, w: double, h: double, text: string): string",doc:"Puts text on a page. Returns its id."},{sig:"addLink(page: string, x: double, y: double, w: double, h: double, uri: string): string",doc:"Makes a rectangle a link to a web address. Returns its id."},{sig:"setAnnotationText(id: string, text: string): void",doc:"Changes the text of a note or free text."},{sig:"moveAnnotations(ids: [string], dx: double, dy: double): void",doc:"Moves annotations by a distance in points."},{sig:"removeAnnotations(ids: [string]): void",doc:"Deletes annotations."},{sig:"setFieldValue(id: string, value: json): void",doc:"Fills a form field: text, true or false, or a list for a list box."},{sig:"fillForm(values: json): [string]",doc:"Fills fields by name; returns the ids of the fields that were filled."},{sig:"markRedaction(page: string, rects: json): string",doc:"Marks rectangles for redaction. Nothing is removed until `applyRedactions`. Returns the mark's id."},{sig:"markSearchRedactions(query: string): [string]",doc:"Marks every match of a search for redaction. Returns the marks' ids."},{sig:"applyRedactions(pages: [string]?): RedactionResult",doc:"Removes what is under the marks for good, from the pages given (all by default)."},{sig:"addComment(page: string, x: double, y: double, body: string, mentions: [string]?): Thread",doc:"Starts a comment thread with a sticky note at a point of a page; the note's text in the file is the first comment."},{sig:"commentOnAnnotation(annotation: string, body: string, mentions: [string]?): Thread",doc:"Starts a comment thread on a highlight or any other annotation."},{sig:"undo(): bool",doc:"Undoes the last step."},{sig:"redo(): bool",doc:"Does the undone step again."}],files:[{name:"exportPdf",format:"pdf",direction:"export",async:!0,doc:"The PDF written back: the original file with your changes added, so what you didn't touch stays byte for byte."},{name:"importPdf",format:"pdf",direction:"import",doc:"Replaces the document with another PDF file. History starts again."}]}}};function tf(t,e={}){let n=/^\s*(\w+)\s*\(([\s\S]*)\)\s*:\s*(\S[\s\S]*?)\s*$/.exec(t);if(!n)throw new Error(`Not a method signature: ${t}`);let[,r,o,s]=n,i=[],a=0,l="",u=[];for(let c of o)(c==="<"||c==="[")&&a++,(c===">"||c==="]")&&a--,c===","&&a===0?(u.push(l),l=""):l+=c;l.trim()&&u.push(l);for(let c of u){let d=/^\s*(\w+)\s*:\s*(\S[\s\S]*?)\s*$/.exec(c);if(!d)throw new Error(`Not a parameter in ${r}: ${c}`);let f=d[2],p=f.replace(/\?$/,"");i.push(e[p]?{name:d[1],type:f,enum:p,oneOf:e[p]}:{name:d[1],type:f})}return{name:r,params:i,returns:s}}function nf(t){let e=ef.editors[t];return e.methods.map(n=>({...tf(n.sig,e.enums),doc:n.doc}))}var Nl=[],At=t=>void Nl.push(t),of=()=>Nl.length?Nl.splice(0):void 0;function Ni(t){return JSON.stringify(t===void 0?null:t,(e,n)=>{if(n instanceof Map)return Object.fromEntries(n);if(n instanceof Set)return[...n];if(n instanceof Uint8Array)return Hn(n);if(!(typeof n=="function"||typeof n=="symbol"))return typeof n=="number"&&!Number.isFinite(n)?null:typeof n=="bigint"?Number(n):n})}var K=(t,e={})=>Ni({ok:!0,value:t===void 0?null:t,...e,events:of()}),Rl=t=>{let e=t;return Ni({ok:!1,error:{code:e?.code??"error",message:e?.message??String(t)},events:of()})};function xe(t){if(!(t==null||t===""))try{return JSON.parse(t)}catch(e){throw new S("invalid_operation","Not valid JSON",{cause:e})}}var cg=1,Fl=new Map;function un(t,e,n){let r=cg++;return new Promise((o,s)=>{Fl.set(r,{resolve:o,reject:s}),At({type:"host",handle:t?.id??0,id:r,kind:e,payload:n})})}var ug=1,$l=new Map;function dg(t,e=n=>n){let n=ug++,r={done:!1};return $l.set(n,r),t.then(o=>{try{r.value=e(o)}catch(s){r.failed=!0,r.error=s}r.done=!0},o=>{r.failed=!0,r.error=o,r.done=!0}),K(null,{pending:n})}var fg=t=>!!t&&typeof t.then=="function";function xt(t,e){return fg(t)?dg(t,e):K(e?e(t):t)}var Sr=new Map,rf=1,Os=globalThis;typeof Os.setInterval!="function"&&(Os.setInterval=(t,e=0)=>{let n=rf++;return Sr.set(n,{at:Date.now()+Math.max(1,e),every:Math.max(1,e),fn:t}),n},Os.setTimeout=(t,e=0)=>{let n=rf++;return Sr.set(n,{at:Date.now()+Math.max(0,e),every:null,fn:t}),n},Os.clearInterval=Os.clearTimeout=t=>void Sr.delete(t));function pg(){let t=Date.now();for(let[e,n]of[...Sr])if(!(n.at>t||!Sr.has(e))){n.every===null?Sr.delete(e):n.at=t+n.every;try{n.fn()}catch{}}}var Ei=new Map,Dl=1,El=new Map;function ee(t){let e=Ei.get(t);if(!e)throw new S("not_found",`No open document ${t}`);return e}function _l(t){let e=t;if(!e||typeof e.id!="string"||typeof e.name!="string")throw new S("invalid_operation","A user has an id and a name");return e}function sf(t,e){return{size:t.length,type:e,arrayBuffer:()=>Promise.resolve(t.slice().buffer)}}function mg(t){return{async upload(e,n){let r=new Uint8Array(await e.arrayBuffer());n.onProgress(.5);let o=await un(t,"storage.upload",{name:n.name,type:n.type,data:Hn(r)});return n.onProgress(1),o},resolve:e=>un(t,"storage.resolve",{ref:e}),async read(e){let n=await un(t,"storage.read",{ref:e});return sf(mn(n.data)??new Uint8Array,n.type)},delete:async e=>void await un(t,"storage.delete",{ref:e})}}function hg(t){return{load:e=>un(t,"comments.load",{file:e}),save:async(e,n)=>void await un(t,"comments.save",{file:e,change:n})}}function gg(t){return{async connect(e,n){t.receive=n,await un(t,"transport.connect",{room:e})},send:e=>void At({type:"transport.send",handle:t.id,json:Ni(e)}),disconnect(){t.receive=null,At({type:"transport.disconnect",handle:t.id})}}}function _i(t,e,n,r){if(t.endsWith("?"))return e==null||_i(t.slice(0,-1),e,n,r);if(t.startsWith("["))return Array.isArray(e)&&e.every(o=>_i(t.slice(1,-1),o,n,r));if(t.startsWith("map<"))return!!e&&typeof e=="object"&&!Array.isArray(e)&&Object.values(e).every(o=>_i(t.slice(4,-1),o,n,r));switch(t){case"string":return typeof e=="string";case"bool":return typeof e=="boolean";case"int":return Number.isInteger(e);case"double":return typeof e=="number"&&Number.isFinite(e);case"json":case"scalar":return e!==void 0;default:return r.oneOf?typeof e=="string"&&r.oneOf.includes(e):e!==void 0}}function yg(t,e){if(!Array.isArray(e)||e.length!==t.params.length)throw new S("invalid_operation",`${t.name} takes ${t.params.length} argument${t.params.length===1?"":"s"}`);t.params.forEach((n,r)=>{let o=e[r],s=n.type.endsWith("?");if(o==null){if(!s&&n.type!=="json"&&n.type!=="scalar")throw new S("invalid_operation",`${t.name}: ${n.name} is required`);return}if(n.oneOf&&!n.oneOf.includes(o))throw new S("invalid_operation",`${t.name}: ${n.name} should be one of ${n.oneOf.join(", ")}`);if(!_i(n.type,o,null,n))throw new S("invalid_operation",`${t.name}: ${n.name} should be ${n.type}`)})}function bg(t,e){let n=e.split("."),r=t;for(let o=0;o<n.length;o++){let s=n[o];if(!/^[A-Za-z][A-Za-z0-9]*$/.test(s)||s==="constructor"||s==="prototype")throw new S("not_found",`Nothing called "${e}"`);let i=r?.[s];if(o===n.length-1){if(typeof i!="function")throw new S("not_found",`Nothing called "${e}" can be called`);return{owner:r,fn:i}}if(i===null||typeof i!="object")throw new S("not_found",`Nothing called "${e}"`);r=i}throw new S("not_found",`Nothing called "${e}"`)}function kg(t,e,n){if(n!==t.watching.has(e)){if(!n){t.watching.delete(e);return}t.watching.add(e),e==="change"&&!t.extra._changeHooked&&(t.extra._changeHooked=!0,t.cleanups.push(t.core.subscribe(r=>{t.watching.has("change")&&At({type:"change",handle:t.id,origin:r.origin,reset:r.reset===!0,ops:r.ops,canUndo:t.core.canUndo,canRedo:t.core.canRedo})}))),e==="comments"&&t.comments&&!t.extra._commentsHooked&&(t.extra._commentsHooked=!0,t.cleanups.push(t.comments.onChange((r,o)=>{t.watching.has("comments")&&At({type:"comments",handle:t.id,origin:o,change:r})})))}}function af(t,e){let n=new Map(t.map(c=>[c.kind,c])),r=new Map(t.map(c=>[c.kind,new Map(c.methods.map(d=>[d.name,d]))])),o=(c,d)=>{if(c==null)throw new S("unsupported",d);return c},s=c=>{try{return c()}catch(d){return Rl(d)}};function i(c,d,f){c.directory.current=d,f&&(c.directory.role=f),d&&c.users.add([d]),c.def.userChanged?.(c)}function a(c){return o(c.comments,"Comments aren't turned on for this document")}function l(c,d,f){let p=o(n.get(c),`This engine doesn't have ${c}`),h=xe(f)??{},g={current:null},y=new Set(Array.isArray(h.host)?h.host:[]),b={id:Dl,kind:c,def:p,directory:g,host:y,watching:new Set,cleanups:[],extra:{},comments:null,storage:null,room:null,sync:null,receive:null};y.has("directory")&&(g.lookup=O=>un(b,"users.lookup",{ids:O}),g.search=O=>un(b,"users.search",{query:O})),b.users=new _r(g),h.user?i(b,_l(h.user),h.user.role??h.role??"editor"):h.role&&(g.role=h.role),y.has("storage")&&(b.storage=new Ar(mg(b),h.storage??{}));let w=y.has("comments")?hg(b):void 0;return b.extra.commentStore=w,p.open(b,d,h),b.comments=p.comments(b,h,w),Ei.set(Dl++,b),K(b.id)}return{version:e.version,editors(){return K([...n.keys()])},methods(c){return s(()=>K(o(n.get(c),`No ${c}`).methods.map(d=>d.name)))},openEditor(c,d,f,p){return s(()=>{let h=!["json","csv","tsv","html","md","markdown","txt"].includes(d),g=null;if(f!=null&&h&&(g=mn(f),!g))throw new S("invalid_document","The file isn't valid base64");return l(c,{format:d,text:h?null:f??null,bytes:g},p)})},close(c){return s(()=>{let d=Ei.get(c);if(!d)return K(!1);d.sync?.stop(),d.room?.disconnect();for(let f of d.cleanups.splice(0))f();return d.comments?.dispose(),d.def.close?.(d),Ei.delete(c),K(!0)})},invoke(c,d,f){return s(()=>{let p=ee(c),h=r.get(p.kind).get(d),g=p.def.run[d];if(!h||!g)throw new S("not_found",`No command called "${d}"`);let y=xe(f)??[];yg(h,y);let b=g(p,y);return xt(b,h.returns==="void"?()=>null:void 0)})},call(c,d,f){return s(()=>{let p=ee(c),h=xe(f)??[];if(!Array.isArray(h))throw new S("invalid_operation","The arguments are a JSON array");let{owner:g,fn:y}=bg(p.session,d);return xt(y.apply(g,h))})},apply(c,d,f){return s(()=>{let p=ee(c),h=xe(d);if(!Array.isArray(h))throw new S("invalid_operation","Operations are a JSON array");let g=xe(f)??{};return(p.session.transact??p.core.transact).call(p.session.transact?p.session:p.core,h,g),K(!0)})},read(c,d,f){return s(()=>{let p=ee(c);if(d==="document")return K(p.def.serialize(p));if(d==="state")return K({canUndo:p.core.canUndo,canRedo:p.core.canRedo,...p.def.state(p)});let h=xe(f)??[];if(!p.def.read)throw new S("not_found",`Nothing called "${d}" can be read`);return xt(p.def.read(p,d,h))})},exportFile(c,d,f){return s(()=>{let p=ee(c),h=p.def.exportFile(p,d,xe(f)??{});return xt(h,y=>Hn(typeof y=="string"?Pr(y):y))})},importFile(c,d,f,p){return s(()=>{let h=ee(c),g=!["json","csv","tsv","html","md","markdown","txt"].includes(d),y=g?mn(f):null;if(g&&!y)throw new S("invalid_document","The file isn't valid base64");return xt(h.def.importFile(h,d,{format:d,text:g?null:f,bytes:y},xe(p)??{}))})},watch(c,d,f){return s(()=>{let p=ee(c);return kg(p,d,f),K(!0)})},pump(){return K(null)},tick(){return pg(),K(Sr.size)},taskResult(c){let d=$l.get(c);return d?d.done?($l.delete(c),d.failed?Rl(d.error):K(d.value)):K(null,{pending:c}):Rl(new S("not_found",`No task ${c}`))},hostResolve(c,d,f){return s(()=>{let p=Fl.get(c);if(!p)return K(!1);if(Fl.delete(c),f){let h=xe(f)??{};p.reject(new S(h.code??"storage",h.message??"The app couldn't do that"))}else p.resolve(xe(d)??null);return K(!0)})},setUser(c,d,f){return s(()=>{let p=ee(c),h=d?_l(xe(d)):null;return i(p,h,f??void 0),K(!0)})},currentUser(c){return s(()=>{let d=ee(c);return K({user:d.users.current,role:d.users.role})})},addUsers(c,d){return s(()=>{let f=xe(d);if(!Array.isArray(f))throw new S("invalid_operation","Users are a JSON array");return ee(c).users.add(f.map(_l)),K(!0)})},getUser(c,d){return s(()=>K(ee(c).users.get(d)))},searchUsers(c,d){return s(()=>xt(ee(c).users.search(d)))},comments(c){return s(()=>K(a(ee(c)).threads))},commentsCan(c,d,f){return s(()=>{let p=a(ee(c)),h=f?p.thread(f):void 0;return K(p.can(d,h))})},commentsCreate(c,d,f,p){return s(()=>{let h=a(ee(c));return K(h.createThread(d,xe(f),void 0,xe(p)??void 0))})},commentsReply(c,d,f,p){return s(()=>K(a(ee(c)).reply(d,f,xe(p)??void 0)))},commentsEdit(c,d,f,p,h){return s(()=>(a(ee(c)).editComment(d,f,p,xe(h)??void 0),K(!0)))},commentsDelete(c,d,f){return s(()=>{let p=a(ee(c));return f?p.deleteComment(d,f):p.deleteThread(d),K(!0)})},commentsResolve(c,d,f){return s(()=>{let p=a(ee(c));return f?p.resolve(d):p.reopen(d),K(!0)})},commentsReceive(c,d){return s(()=>(a(ee(c)).receive(xe(d)),K(!0)))},commentsReload(c){return s(()=>xt(a(ee(c)).reload().then(()=>null)))},scriptRun(c,d,f){return s(()=>{let p=ee(c),h=o(p.def.editorSession?.(p),"This editor can't run scripts"),g=xe(f)??{},y;try{y=new Function("ctx",`"use strict";
${d}`)}catch(w){throw new S("invalid_operation",`The script has a mistake: ${w.message}`,{cause:w})}let b=new ir(h,{grants:g.grants,maxOps:g.maxOps,maxMs:g.maxMs});return K(b.run(w=>y(w)))})},storageUpload(c,d,f,p){return s(()=>{let h=ee(c),g=o(h.storage,"No storage: open the document with a storage adapter"),y=mn(p);if(!y)throw new S("invalid_operation","The file isn't valid base64");return xt(g.upload(sf(y,f),{name:d,type:f}))})},storageResolve(c,d){return s(()=>xt(o(ee(c).storage,"No storage: open the document with a storage adapter").resolve(d)))},storageRead(c,d){return s(()=>xt(o(ee(c).storage,"No storage: open the document with a storage adapter").read(d).then(async f=>({type:f.type,data:Hn(new Uint8Array(await f.arrayBuffer()))}))))},storageDelete(c,d){return s(()=>xt(o(ee(c).storage,"No storage: open the document with a storage adapter").delete(d).then(()=>null)))},syncStart(c,d){return s(()=>{let f=ee(c);if(f.sync)throw new S("invalid_operation","Already in a room: stop first");let p=xe(d)??{},h=p.room??f.file,g=p.live===!1?null:o(f.def.model(),`Live editing isn't available for ${f.kind} in this build`),y=new zr({room:h,transport:gg(f),users:f.users,comments:f.comments??void 0,heartbeat:p.heartbeat,timeout:p.timeout});if(f.room=y,f.cleanups.push(y.subscribe(()=>{f.watching.has("peers")&&At({type:"peers",handle:f.id,status:y.status,peers:y.peers})})),g){let b=new Sn({session:f.core,room:y,model:g,version:p.version??null,verifyEvery:p.verifyEvery??3e4,onResync:w=>At({type:"resync",handle:f.id,reason:w.reason,lost:w.lost})});f.sync=b,f.cleanups.push(b.subscribe(()=>{f.watching.has("sync")&&At({type:"sync",handle:f.id,status:b.status,unsynced:b.unsynced,version:b.version})})),b.start(),f.def.syncing?.(f,!0)}return y.connect().catch(b=>At({type:"error",handle:f.id,code:b.code??"error",message:String(b.message??b)})),K(!0)})},syncStop(c){return s(()=>{let d=ee(c);return d.sync&&d.def.syncing?.(d,!1),d.sync?.stop(),d.room?.disconnect(),d.sync=null,d.room=null,K(!0)})},syncStatus(c){return s(()=>{let d=ee(c);return K({room:d.room?.status??"idle",status:d.sync?.status??(d.room?"synced":"offline"),unsynced:d.sync?.unsynced??0,version:d.sync?.version??null,lastResync:d.sync?.lastResync??null})})},syncOnline(c,d){return s(()=>(ee(c).sync?.setOnline(d),K(!0)))},syncResync(c){return s(()=>(ee(c).sync?.resync("asked to"),K(!0)))},transportReceive(c,d){return s(()=>(ee(c).receive?.(xe(d)),K(!0)))},setPresence(c,d){return s(()=>{let f=ee(c);return o(f.room,"Not in a room: start syncing first").setPresence({...f.def.presence?.(f),...xe(d)??{}}),K(!0)})},peers(c){return s(()=>K(ee(c).room?.peers??[]))},authorityOpen(c,d){return s(()=>{let f=o(n.get(c),`This engine doesn't have ${c}`),p=o(f.model(),`Live editing isn't available for ${c} in this build`),h=Dl++,g=d??null,y=$s({store:Fs(),model:p,create:b=>g?f.parse(g):f.create?f.create(b):(()=>{throw new S("not_found",`No document for room "${b}"`)})(),onError:(b,w)=>At({type:"error",handle:h,code:b.code??"error",message:`${w}: ${String(b.message??b)}`})});return El.set(h,{kind:c,def:f,authority:y,initial:g}),K(h)})},authorityReceive(c,d,f){return s(()=>{let p=El.get(c);if(!p)throw new S("not_found",`No sequencer ${c}`);return xt(p.authority.receive(d,xe(f),h=>At({type:"authority.send",handle:c,room:d,json:Ni(h)})).then(()=>null))})},authorityClose(c){return K(El.delete(c))}}}function Ms(t,e){let n=r=>{for(let o of r){if(o.id===e)return o;if(o.type==="table")for(let s of o.rows)for(let i of s.cells){let a=n(i.blocks);if(a)return a}}};return n(t.blocks)}var xr=t=>e=>e.toggleMark(t),Fi=t=>(e,[n])=>e.setMarks({[t]:n??null}),As=t=>e=>e.setBlockType(t),wg={typeText:(t,[e])=>t.typeText(e),paste:(t,[e,n,r])=>t.paste({html:e??void 0,rtf:n??void 0,text:r??void 0}).applied,pasteText:(t,[e])=>t.paste({text:e,plain:!0}).applied,splitBlock:t=>t.splitBlock(),backspace:t=>t.backspace(),deleteForward:t=>t.deleteForward(),deleteSelection:t=>t.deleteSelection(),undo:t=>t.undo(),redo:t=>t.redo(),toggleBold:xr("bold"),toggleItalic:xr("italic"),toggleUnderline:xr("underline"),toggleStrikethrough:xr("strike"),toggleCode:xr("code"),toggleSuperscript:xr("superscript"),toggleSubscript:xr("subscript"),setTextColor:Fi("color"),setHighlight:Fi("highlight"),setFontFamily:Fi("fontFamily"),setFontSize:Fi("fontSize"),setLink:(t,[e])=>t.setLink(e??null),clearFormatting:t=>t.clearFormatting(),setParagraph:As({type:"paragraph"}),setTitle:As({type:"title"}),setSubtitle:As({type:"subtitle"}),setHeading:(t,[e])=>{if(!Number.isInteger(e)||e<1||e>6)throw new S("invalid_operation","A heading level is 1 to 6");return t.setBlockType({type:"heading",level:e})},setQuote:As({type:"quote"}),setCodeBlock:As({type:"code_block"}),toggleBulletedList:t=>t.toggleBlockType({type:"list_item",list:"bullet"}),toggleNumberedList:t=>t.toggleBlockType({type:"list_item",list:"ordered"}),setAlignment:(t,[e])=>t.setAlign(e),indent:t=>t.indent(),outdent:t=>t.outdent(),setListMarker:(t,[e])=>t.setListMarker(e),setListStart:(t,[e])=>t.setListStart(e),continueNumbering:t=>t.continueNumbering(),setLineSpacing:(t,[e])=>t.setParagraphFormat({lineHeight:e??null}),setSpaceBefore:(t,[e])=>t.setParagraphFormat({spaceBefore:e??null}),setSpaceAfter:(t,[e])=>t.setParagraphFormat({spaceAfter:e??null}),insertTable:(t,[e,n])=>t.insertTable(e,n),addRowAbove:t=>t.addRow("above"),addRowBelow:t=>t.addRow("below"),addColumnLeft:t=>t.addColumn("left"),addColumnRight:t=>t.addColumn("right"),deleteRow:t=>t.deleteRow(),deleteColumn:t=>t.deleteColumn(),deleteTable:t=>t.deleteTable(),mergeCells:t=>t.mergeCells(),splitCells:t=>t.splitCells(),setHeaderRow:(t,[e])=>t.setHeaderRow(e),setColumnEdge:(t,[e,n,r,o])=>{let s=t.state.blocks.find(p=>p.id===e&&p.type==="table");if(!s||s.type!=="table")throw new S("not_found","No table has that id");let i=n;if(i<0||i>=s.columns.length-1)throw new S("invalid_operation","A table has an edge after each column but the last");let a=s.columns.reduce((p,h)=>p+h,0),l=[...s.columns],u=l.slice(0,i).reduce((p,h)=>p+h,0),c=l[i]+l[i+1],d=a*.05,f=Math.min(Math.max(r*a-u,d),c-d);return l[i]=f,l[i+1]=c-f,t.updateBlock(e,{columns:l.map(p=>p/a)},{merge:o}),!0},setRowHeight:(t,[e,n,r,o])=>{let s=Ms(t.state,e);if(!s||s.type!=="table")throw new S("not_found","No table has that id");if(!Number.isInteger(n)||n<0||n>=s.rows.length)throw new S("invalid_operation","That table has no such row");let i=s.rows.map((a,l)=>{if(l!==n)return a;let{height:u,...c}=a;return r==null?c:{...c,height:Math.max(r,8)}});return t.updateBlock(s.id,{rows:i},{merge:o}),!0},setCellShade:(t,[e])=>t.setCellShade(e??null),insertPageBreak:t=>t.insertBlockAtCaret(Ma()),insertDivider:t=>t.insertBlockAtCaret(Aa()),setImageSize:(t,[e,n,r,o])=>{let s=Ms(t.state,e);if(!s||s.type!=="image")throw new S("not_found","No picture has that id");return t.updateBlock(s.id,{width:Math.max(n,16),height:Math.max(r,16)},{merge:o}),!0},setImageCrop:(t,[e,n,r,o,s,i])=>{let a=Ms(t.state,e);if(!a||a.type!=="image")throw new S("not_found","No picture has that id");let l={top:n,right:r,bottom:o,left:s};for(let[u,c]of Object.entries(l))if(!(c>=0&&c<=.9))throw new S("invalid_operation",`The ${u} crop is 0 to 0.9`);if(l.left+l.right>.95||l.top+l.bottom>.95)throw new S("invalid_operation","That crops away too much of the picture");return t.cropImage(a.id,l,{merge:i,rescale:!0}),!0},setImageWrap:(t,[e,n])=>{let r=Ms(t.state,e);if(!r||r.type!=="image")throw new S("not_found","No picture has that id");return t.select({anchor:{block:r.id,offset:0},focus:{block:r.id,offset:0}}),t.setImageWrap(n??null)},deleteImage:(t,[e])=>{let n=Ms(t.state,e);if(!n||n.type!=="image")throw new S("not_found","No picture has that id");return t.deleteBlock(n.id),!0},insertImage:(t,[e,n,r,o])=>t.insertBlockAtCaret(Oa(e,{width:n,height:r},o?{alt:o}:{})),setDocumentTitle:(t,[e])=>t.setTitle(e),applyParagraphStyle:(t,[e])=>t.applyParagraphStyle(e??null),applyCharacterStyle:(t,[e])=>t.applyCharacterStyle(e??null),createStyle:(t,[e,n])=>t.createStyle(e,n),deleteStyle:(t,[e])=>t.deleteStyle(e),select:(t,[e,n,r,o])=>t.select({anchor:{block:e,offset:n},focus:{block:r,offset:o}}),selectAll:t=>t.selectAll(),setSuggesting:(t,[e])=>t.setSuggesting(e),acceptSuggestion:(t,[e])=>t.acceptSuggestion(e),rejectSuggestion:(t,[e])=>t.rejectSuggestion(e),acceptAllSuggestions:t=>t.acceptAllSuggestions(),rejectAllSuggestions:t=>t.rejectAllSuggestions()};function Il(t,e=new Map){es(t).forEach((n,r)=>{n&&e.set(t[r].id,n)});for(let n of t)if(n.type==="table")for(let r of n.rows)for(let o of r.cells)Il(o.blocks,e);return e}function Sg(t){let e=Il(t.blocks);return Pn(t.blocks).map(n=>{let r={id:n.id,type:n.type};if(F(n)){if(r.text=H(n.runs),"level"in n&&(r.level=n.level),"list"in n){r.list=n.list,r.depth=n.depth;let o=e.get(n.id);o&&(r.marker=o.marker,r.label=o.text)}"align"in n&&n.align&&(r.align=n.align),"style"in n&&n.style&&(r.style=n.style)}else n.type==="table"?(r.rows=n.rows.length,r.columns=n.columns.length):n.type==="image"&&(r.width=n.width,r.height=n.height,n.alt&&(r.description=n.alt));return r})}function xg(t){let e=Il(t.blocks),n=r=>r.map(o=>{if(o.type==="table")return{...o,rows:o.rows.map(i=>({...i,cells:i.cells.map(a=>({...a,blocks:n(a.blocks)}))}))};let s=o.type==="list_item"?e.get(o.id):void 0;return s?{...o,label:s.text}:o});return n(t.blocks)}function vg(t){let e=nl(t.state,t.selection,t.pendingMarks),n=r=>({value:r.value??null,mixed:r.mixed});return{marks:e.marks,fontFamily:n(e.fontFamily),fontSize:n(e.fontSize),color:n(e.color),highlight:n(e.highlight),link:n(e.link),block:e.block,align:e.align,paragraphStyle:e.paragraphStyle,list:e.list,image:e.image?{id:e.image.id,wrap:e.image.wrap??null}:null,table:e.table?{id:e.table.id,rows:e.table.rows,columns:e.table.columns,row:e.table.row,column:e.table.column,selectedRows:e.table.selectedRows,selectedColumns:e.table.selectedColumns,headerRow:e.table.headerRow,shade:e.table.shade??null,canMerge:e.table.canMerge,canSplit:e.table.canSplit}:null,canIndent:e.canIndent,canOutdent:e.canOutdent,canUndo:t.canUndo,canRedo:t.canRedo}}function Cg(t){return t.blocks.flatMap(e=>e.type==="heading"?[{id:e.id,level:e.level,text:H(e.runs)}]:[])}function Pg(t,e){let n=t.state;switch(e){case"title":return n.title;case"plainText":return Pn(n.blocks).filter(F).map(r=>H(r.runs)).join(`
`);case"markdown":return Ri(n);case"html":return Bs(n);case"blocks":return Sg(n);case"content":return xg(n);case"format":return vg(t);case"selectedText":return t.selection?bi(n,t.selection):"";case"clipboard":return t.selection?{text:bi(n,t.selection),html:Bs(yi(n,t.selection))}:{text:"",html:""};case"outline":return Cg(n);case"statistics":return rl(n);case"selection":return t.selection;case"suggestions":return t.suggestions;case"styles":return t.styles;default:throw new S("not_found",`Nothing called "${e}" can be read`)}}var Bg=0,lf={kind:"docs",methods:[...Di.commands,...nf("docs")],run:{...Object.fromEntries(Object.entries(wg).map(([t,e])=>[t,(n,r)=>e(n.session,r)])),commentOnSelection:(t,[e,n])=>t.session.comment(e,t.session.selection,n??void 0),commentRanges:(t,[e])=>On(t.session.state,e),threadsAtSelection:t=>{let e=t.session,n=new Set(ma(e.state,e.selection));return t.comments.threads.filter(r=>n.has(r.id))}},open(t,e,n){let r=t.users.current,o=e.format==="docx"?Mi(e.bytes,{trackedChanges:"accept",title:n.title}).doc:e.text?mr(e.text):Ys(n.title??"Untitled",[{id:`b_${++Bg}_0`,type:"paragraph",runs:[]}]),s=new ks(o,{comments:{users:t.users,store:t.extra.commentStore??"document",synced:n.live===!0},...t.storage?{storage:t.storage}:{},...r&&n.suggestions!==!1?{suggestions:{users:t.users}}:{}}),i=s.state.blocks.find(F);i&&s.select({anchor:{block:i.id,offset:0},focus:{block:i.id,offset:0}}),t.session=s,t.core=s,t.file=o.id},comments:t=>t.session.comments,serialize:t=>cs(t.session.state),parse:t=>mr(t),create:()=>Ys("Untitled",[{id:"b_0",type:"paragraph",runs:[]}]),model:()=>gs,editorSession:t=>Za(t.session),presence:t=>({selection:t.session.selection}),state(t){let e=t.session;return{selection:e.selection,suggesting:e.suggesting,canSuggest:e.canSuggest}},read:(t,e)=>Pg(t.session,e),exportFile(t,e){let n=t.session.state;switch(e){case"docx":return Cl(n);case"json":return cs(n);case"markdown":case"md":return Ri(n);case"html":return Bs(n);default:throw new S("unsupported",`Documents export as docx, json, markdown or html, not ${e}`)}},importFile(t,e,n,r){let o=t.session;if(e==="docx"){let s=Mi(n.bytes,{trackedChanges:r.trackedChanges??(o.suggestionsEnabled?"keep":"accept"),title:r.title});return o.replaceDocument(s.doc),o.suggestionUsers?.add(s.authors),{warnings:s.warnings,authors:s.authors}}if(e==="json")return o.replaceDocument(mr(n.text??Co(n.bytes))),{warnings:[],authors:[]};throw new S("unsupported",`Documents import docx or json, not ${e}`)}};var $i=af([lf],{version:"0.0.0"}),Og={...$i,commands(){return K(Di.commands.map(t=>t.name))},open(t,e){return $i.openEditor("docs","json",t||null,e)},exportDocx(t){return $i.exportFile(t,"docx")},importDocx(t,e,n){return $i.importFile(t,"docx",e,n)}};globalThis.Pli=Og;})();
