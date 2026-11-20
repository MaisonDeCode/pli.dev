"use strict";(()=>{var Tf=Object.defineProperty;var Xl=t=>{throw TypeError(t)};var Rf=(t,e,n)=>e in t?Tf(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var ue=(t,e,n)=>Rf(t,typeof e!="symbol"?e+"":e,n),Xi=(t,e,n)=>e.has(t)||Xl("Cannot "+n);var h=(t,e,n)=>(Xi(t,e,"read from private field"),n?n.call(t):e.get(t)),E=(t,e,n)=>e.has(t)?Xl("Cannot add the same private member more than once"):e instanceof WeakSet?e.add(t):e.set(t,n),v=(t,e,n,r)=>(Xi(t,e,"write to private field"),r?r.call(t,n):e.set(t,n),n),w=(t,e,n)=>(Xi(t,e,"access private method"),n);var nt=(t,e,n,r)=>({set _(o){v(t,e,o,n)},get _(){return h(t,e,r)}});function Ar(t){let e=[];for(let n=0;n<t.length;n++){let r=t.charCodeAt(n);if(r>=55296&&r<56320&&n+1<t.length){let o=t.charCodeAt(n+1);o>=56320&&o<57344&&(r=65536+(r-55296<<10)+(o-56320),n++)}r>=55296&&r<57344&&(r=65533),r<128?e.push(r):r<2048?e.push(192|r>>6,128|r&63):r<65536?e.push(224|r>>12,128|r>>6&63,128|r&63):e.push(240|r>>18,128|r>>12&63,128|r>>6&63,128|r&63)}return Uint8Array.from(e)}function Ro(t){let e="",n=[];for(let r=0;r<t.length;){let o=t[r++],s;o<128?s=o:o>=194&&o<224&&r<t.length?s=(o&31)<<6|t[r++]&63:o>=224&&o<240&&r+1<t.length?s=(o&15)<<12|(t[r++]&63)<<6|t[r++]&63:o>=240&&o<245&&r+2<t.length?s=(o&7)<<18|(t[r++]&63)<<12|(t[r++]&63)<<6|t[r++]&63:s=65533,s>=65536?(s-=65536,n.push(55296+(s>>10),56320+(s&1023))):n.push(s),n.length>4096&&(e+=String.fromCharCode(...n),n=[])}return e+String.fromCharCode(...n)}var js=globalThis;typeof js.TextEncoder>"u"&&(js.TextEncoder=class{constructor(){ue(this,"encoding","utf-8")}encode(e=""){return Ar(String(e))}});typeof js.TextDecoder>"u"&&(js.TextDecoder=class{constructor(e="utf-8"){this.encoding=e}decode(e){if(e===void 0)return"";let n=e instanceof Uint8Array?e:ArrayBuffer.isView(e)?new Uint8Array(e.buffer,e.byteOffset,e.byteLength):new Uint8Array(e),r=Ro(n);return r.charCodeAt(0)===65279?r.slice(1):r}});var Df=new Set(["divider","page_break","section_break","image","toc","table"]);function _(t){return!Df.has(t.type)}function Ae(t){return _(t)&&t.type!=="code_block"}function Xe(t){return(t.type==="image"||t.type==="table")&&t.float!==void 0}var Ff=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);function D(t=""){return t+Ff()}var Do="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",Ef=new Map([...Do].map((t,e)=>[t,e]));function Xn(t){let e=[];for(let n=0;n<t.length;n+=3){let r=t[n],o=t[n+1],s=t[n+2],i=r<<16|(o??0)<<8|(s??0);e.push(Do[i>>18&63]+Do[i>>12&63]+(o===void 0?"=":Do[i>>6&63])+(s===void 0?"=":Do[i&63]))}return e.join("")}function yn(t){let e=t.replace(/\s+/g,""),n=e.replace(/=+$/,"");if(e.length-n.length>2||e.length%4!==0&&e.length!==n.length||n.length%4===1)return null;let r=new Uint8Array(Math.floor(n.length*3/4)),o=0,s=0,i=0;for(let a of n){let l=Ef.get(a);if(l===void 0)return null;s=s<<6|l,o+=6,o>=8&&(o-=8,r[i++]=s>>o&255)}return r}var C=class extends Error{constructor(n,r,o){super(r,o);ue(this,"code");this.name="PliError",this.code=n}};var Et,$o,pt,$t,Tr,rt,Vi,Ji,Fo,Eo=class{constructor(e,n){E(this,rt);E(this,Et);E(this,$o);E(this,pt,[]);E(this,$t,[]);E(this,Tr,new Set);v(this,Et,e),v(this,$o,n)}get state(){return h(this,Et)}get canUndo(){return h(this,pt).length>0}get canRedo(){return h(this,$t).length>0}transact(e,n={}){if(e.length===0)return;let r=n.origin??"local",{state:o,inverse:s}=w(this,rt,Ji).call(this,e);if(v(this,Et,o),r==="local"&&n.history!==!1){let i=n.merge?h(this,pt)[h(this,pt).length-1]:void 0;i?(i.ops=[...s,...i.ops],i.other=n.after):h(this,pt).push({ops:s,restore:n.before,other:n.after}),v(this,$t,[])}w(this,rt,Fo).call(this,{state:o,ops:e,origin:r,meta:n.after})}reset(e){v(this,Et,e),v(this,pt,[]),v(this,$t,[]),w(this,rt,Fo).call(this,{state:e,ops:[],origin:"remote",reset:!0})}rebaseHistory(e,n){if(e.length===0)return;let r=(s,i)=>s===void 0||!n.mapMeta?s:n.mapMeta(s,i),o=s=>{let i=e,a=[];for(let l=s.length-1;l>=0;l--){let c=s[l],[d,u]=n.transform(c.ops,i);c.restore=r(c.restore,u),c.other=r(c.other,i),c.ops=d,i=u,d.length>0&&a.push(c)}return a.reverse()};v(this,pt,o(h(this,pt))),v(this,$t,o(h(this,$t)))}undo(){let e=h(this,pt).pop();if(!e)return!1;let n=w(this,rt,Vi).call(this,e.ops);if(!n)return!1;let{state:r,inverse:o}=n;return v(this,Et,r),h(this,$t).push({ops:o,restore:e.other,other:e.restore}),w(this,rt,Fo).call(this,{state:r,ops:e.ops,origin:"undo",meta:e.restore}),!0}redo(){let e=h(this,$t).pop();if(!e)return!1;let n=w(this,rt,Vi).call(this,e.ops);if(!n)return!1;let{state:r,inverse:o}=n;return v(this,Et,r),h(this,pt).push({ops:o,restore:e.other,other:e.restore}),w(this,rt,Fo).call(this,{state:r,ops:e.ops,origin:"redo",meta:e.restore}),!0}subscribe(e){return h(this,Tr).add(e),()=>h(this,Tr).delete(e)}};Et=new WeakMap,$o=new WeakMap,pt=new WeakMap,$t=new WeakMap,Tr=new WeakMap,rt=new WeakSet,Vi=function(e){try{return w(this,rt,Ji).call(this,e)}catch{return null}},Ji=function(e){let n=h(this,Et),r=[];for(let o of e){let s=h(this,$o).apply(n,o);n=s.state,r.unshift(s.inverse)}return{state:n,inverse:r}},Fo=function(e){for(let n of h(this,Tr))n(e)};var $f={aborted:!1,addEventListener(){},removeEventListener(){}};function Gs(){let t=new Set,e={aborted:!1,addEventListener(n,r){t.add(r)},removeEventListener(n,r){t.delete(r)}};return{signal:e,abort(){if(!e.aborted){e.aborted=!0;for(let n of[...t])n()}}}}var No=()=>new C("cancelled","The upload was cancelled."),Zi=class{constructor(e,n){this.bytes=e;this.type=n;ue(this,"size");this.size=e.length}arrayBuffer(){return Promise.resolve(this.bytes.slice().buffer)}},Nf=/^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is;function _f(t){let e=Nf.exec(t);if(!e||!/;base64$/i.test(e[2]))return null;let n=yn(e[3]);return n?{type:e[1]||"application/octet-stream",bytes:n}:null}var If=t=>/^(https?:|data:|blob:)/i.test(t);function Lf(t,e){let n=t.toLowerCase();return e.some(r=>{let o=r.toLowerCase();return o.endsWith("/*")?n.startsWith(o.slice(0,-1)):n===o})}function zs(t){return t instanceof Error?t.message:String(t)}var ot,Rr,Dr,Vn,bn,Jn,Zn,Er,Vl,Jl,Fr=class{constructor(e,n={}){E(this,Er);E(this,ot);E(this,Rr);E(this,Dr);E(this,Vn);E(this,bn,new Map);E(this,Jn,0);E(this,Zn,[]);v(this,ot,e),v(this,Rr,n),v(this,Dr,n.resolveCacheMs??5*6e4),v(this,Vn,n.now??Date.now)}get canRead(){return!!h(this,ot).read}get canDelete(){return!!h(this,ot).delete}check(e,n=e.type){let{maxBytes:r,allowedTypes:o}=h(this,Rr);if(o&&!Lf(n,o))throw new C("invalid_operation",`Files of type "${n||"unknown"}" aren't allowed here. Allowed: ${o.join(", ")}.`);if(r!==void 0&&e.size>r)throw new C("invalid_operation",`The file is ${e.size} bytes; the limit is ${r}.`)}async upload(e,n={}){let r=n.signal??$f,o=n.type??e.type,s=n.name??e.name??"file";this.check(e,o),await w(this,Er,Vl).call(this,r);try{if(r.aborted)throw No();let i=0,a=p=>{Number.isFinite(p)&&(i=Math.max(i,Math.min(1,Math.max(0,p))),n.onProgress?.(i))},l;try{l=await h(this,ot).upload(e,{name:s,type:o,signal:r,onProgress:a})}catch(p){throw r.aborted?No():p instanceof C?p:new C("storage",`Upload failed: ${zs(p)}`,{cause:p})}if(r.aborted)throw No();if(!l||typeof l.ref!="string"||l.ref==="")throw new C("storage","The storage adapter didn't return a reference for the uploaded file.");a(1);let c=p=>typeof p=="number"&&Number.isFinite(p)&&p>0?p:void 0,d=typeof l.url=="string"&&l.url!==""?l.url:void 0,u=c(l.width),f=c(l.height);return{ref:l.ref,...d&&{url:d},...u&&{width:u},...f&&{height:f}}}finally{w(this,Er,Jl).call(this)}}resolve(e){let n=h(this,ot).resolve;if(!n)return If(e)?Promise.resolve(e):Promise.reject(new C("storage",`Can't show "${e}": the storage adapter has no resolve() to turn it into an address.`));if(/^(data|blob):/i.test(e))return Promise.resolve(e);let r=h(this,bn).get(e);if(r&&h(this,Dr)>0&&h(this,Vn).call(this)-r.at<h(this,Dr))return r.value;let o=Promise.resolve().then(()=>n.call(h(this,ot),e)).then(s=>{if(typeof s!="string"||s==="")throw new C("storage",`resolve() returned no address for "${e}".`);return s}).catch(s=>{throw h(this,bn).delete(e),s instanceof C?s:new C("storage",`Couldn't resolve "${e}": ${zs(s)}`,{cause:s})});return h(this,bn).set(e,{at:h(this,Vn).call(this),value:o}),o}prime(e,n){h(this,bn).set(e,{at:h(this,Vn).call(this),value:Promise.resolve(n)})}async read(e){let n=_f(e);if(n)return new Zi(n.bytes,n.type);if(/^data:/i.test(e))throw new C("storage","That data URI isn't base64, so it can't be read.");let r=h(this,ot).read;if(!r)throw new C("storage",`Can't read "${e}": the storage adapter has no read(). Add it to export documents with stored files.`);try{let o=await r.call(h(this,ot),e);if(!o||typeof o.arrayBuffer!="function")throw new Error("read() didn't return a file");return o}catch(o){throw o instanceof C?o:new C("storage",`Couldn't read "${e}": ${zs(o)}`,{cause:o})}}async delete(e){let n=h(this,ot).delete;if(!(!n||/^(data|blob):/i.test(e))){h(this,bn).delete(e);try{await n.call(h(this,ot),e)}catch(r){throw r instanceof C?r:new C("storage",`Couldn't delete "${e}": ${zs(r)}`,{cause:r})}}}};ot=new WeakMap,Rr=new WeakMap,Dr=new WeakMap,Vn=new WeakMap,bn=new WeakMap,Jn=new WeakMap,Zn=new WeakMap,Er=new WeakSet,Vl=function(e){return e.aborted?Promise.reject(No()):h(this,Jn)<(h(this,Rr).maxConcurrent??3)?(nt(this,Jn)._++,Promise.resolve()):new Promise((n,r)=>{let o=()=>{e.removeEventListener("abort",s),nt(this,Jn)._++,n()},s=()=>{let i=h(this,Zn).indexOf(o);i>=0&&h(this,Zn).splice(i,1),r(No())};h(this,Zn).push(o),e.addEventListener("abort",s,{once:!0})})},Jl=function(){nt(this,Jn)._--,h(this,Zn).shift()?.()};var Zl=["#d9480f","#1c7ed6","#2f9e44","#9c36b5","#c2255c","#0c8599","#e67700","#5f3dc4"];function Qi(t){let e=0;for(let n=0;n<t.length;n++)e=e*31+t.charCodeAt(n)>>>0;return Zl[e%Zl.length]}function Uf(t){return typeof t.id=="string"&&typeof t.name=="string"}var ze,Zt,$r,Yn,Nr,_r,Nt,_o,Yi,Ir=class{constructor(e=null){E(this,Nt);E(this,ze);E(this,Zt,new Map);E(this,$r,new Set);E(this,Yn,new Set);E(this,Nr,!1);E(this,_r,new Set);v(this,ze,e===null?{current:null}:Uf(e)?{current:e}:e),h(this,ze).current&&h(this,Zt).set(h(this,ze).current.id,h(this,ze).current)}get current(){let e=h(this,ze).current;return e?w(this,Nt,_o).call(this,e):null}get role(){return h(this,ze).role??"editor"}get(e){let n=h(this,Zt).get(e);return n?w(this,Nt,_o).call(this,n):(this.prefetch([e]),w(this,Nt,_o).call(this,{id:e,name:e}))}prefetch(e){if(h(this,ze).lookup){for(let n of e)!h(this,Zt).has(n)&&!h(this,$r).has(n)&&h(this,Yn).add(n);h(this,Yn).size===0||h(this,Nr)||(v(this,Nr,!0),Promise.resolve().then(()=>{v(this,Nr,!1);let n=[...h(this,Yn)];h(this,Yn).clear();for(let r of n)h(this,$r).add(r);Promise.resolve(h(this,ze).lookup(n)).then(r=>{for(let o of r)h(this,Zt).set(o.id,o);w(this,Nt,Yi).call(this)}).catch(()=>{for(let r of n)h(this,$r).delete(r)})}))}}add(e){let n=!1;for(let r of e){let o=h(this,Zt).get(r.id);(!o||o.name!==r.name||o.avatar!==r.avatar||o.color!==r.color)&&(h(this,Zt).set(r.id,r),n=!0)}n&&w(this,Nt,Yi).call(this)}async search(e,n){let r=await h(this,ze).search?.(e,n)??[];return this.add(r),r.map(o=>w(this,Nt,_o).call(this,o))}get canSearch(){return!!h(this,ze).search}get canOpen(){return!!h(this,ze).open}open(e){h(this,ze).open?.(e)}subscribe(e){return h(this,_r).add(e),()=>h(this,_r).delete(e)}};ze=new WeakMap,Zt=new WeakMap,$r=new WeakMap,Yn=new WeakMap,Nr=new WeakMap,_r=new WeakMap,Nt=new WeakSet,_o=function(e){return e.color?e:{...e,color:Qi(e.id)}},Yi=function(){for(let e of h(this,_r))e()};var jf=t=>[...new Set(t)];function ea(t,e){let n=new Map;for(let c of t.threads)for(let d of c.comments)n.set(d.id,d.mentions??[]);let r=new WeakMap,o=(c,d,u)=>jf(c).filter(f=>f!==u).map(f=>({user:t.users.get(f),reason:d})),s=(...c)=>{let d=new Set;return c.flat().filter(u=>!d.has(u.user.id)&&!!d.add(u.user.id))},i=c=>{let d=t.users.current,u={file:t.file,at:Date.now()};switch(c.type){case"thread.create":{let f=c.thread.comments[0];return!d||!f?null:{...u,type:"comment.created",actor:d,thread:c.thread,comment:f,recipients:o(f.mentions??[],"mention",d.id)}}case"comment.add":{let f=t.thread(c.threadId);if(!d||!f)return null;let p=f.comments.filter(m=>m.id!==c.comment.id).map(m=>m.author);return{...u,type:"comment.replied",actor:d,thread:f,comment:c.comment,recipients:s(o(c.comment.mentions??[],"mention",d.id),o(p,"participant",d.id))}}case"comment.edit":{let f=t.thread(c.threadId),p=f?.comments.find(y=>y.id===c.commentId);if(!d||!f||!p)return null;let m=new Set(n.get(c.commentId)??[]),g=(c.mentions??[]).filter(y=>!m.has(y));return{...u,type:"comment.edited",actor:d,thread:f,comment:p,recipients:o(g,"mention",d.id)}}case"thread.resolve":case"thread.reopen":{let f=t.thread(c.threadId);return!d||!f?null:{...u,type:c.type==="thread.resolve"?"thread.resolved":"thread.reopened",actor:d,thread:f,recipients:o(f.comments.map(p=>p.author),"participant",d.id)}}default:return null}},a=t.onChange((c,d)=>{if(d==="local"){let u=i(c);u&&r.set(c,u)}if(c.type==="thread.create")for(let u of c.thread.comments)n.set(u.id,u.mentions??[]);else c.type==="comment.add"?n.set(c.comment.id,c.comment.mentions??[]):c.type==="comment.edit"&&n.set(c.commentId,c.mentions??[])}),l=t.onOutgoing(c=>{let d=r.get(c);if(!d)return;r.delete(c);let u=f=>void setTimeout(()=>{throw f},0);try{Promise.resolve(e(d)).catch(u)}catch(f){u(f)}});return()=>{a(),l()}}function Sn(t,e){let n=(r,o)=>t.map(s=>s.id===r?o(s):s);switch(e.type){case"thread.create":return t.some(r=>r.id===e.thread.id)?n(e.thread.id,()=>e.thread):[...t,e.thread];case"thread.delete":return t.filter(r=>r.id!==e.threadId);case"thread.resolve":return n(e.threadId,r=>({...r,resolved:{by:e.by,at:e.at}}));case"thread.reopen":return n(e.threadId,({resolved:r,...o})=>o);case"comment.add":return n(e.threadId,r=>r.comments.some(o=>o.id===e.comment.id)?r:{...r,comments:[...r.comments,e.comment]});case"comment.edit":return n(e.threadId,r=>({...r,comments:r.comments.map(o=>o.id===e.commentId?ta({...o,body:e.body,editedAt:e.at},e.mentions):o)}));case"comment.delete":return n(e.threadId,r=>({...r,comments:r.comments.filter(o=>o.id!==e.commentId)}))}}function ta(t,e){let{mentions:n,...r}=t;return e&&e.length>0?{...r,mentions:[...e]}:r}function Io(t){return t.type==="thread.create"?t.thread.id:t.threadId}var _t,Qn,Ve,st,er,Lo,tr,nr,wn,rr,Ur,Uo,jr,or,te,na,kn,Yt,Lr,Hs,sr=class{constructor(e){E(this,te);ue(this,"file");ue(this,"users");E(this,_t);E(this,Qn);E(this,Ve);E(this,st,[]);E(this,er);E(this,Lo,Promise.resolve());E(this,tr,new Set);E(this,nr,new Set);E(this,wn,new Set);E(this,rr,"ready");E(this,Ur,null);E(this,Uo);E(this,jr,null);E(this,or);v(this,Qn,e),this.file=e.file,this.users=e.users,v(this,_t,e.store??null),v(this,Ve,e.initial??[]),v(this,er,h(this,Ve)),v(this,or,h(this,_t)?w(this,te,na).call(this):Promise.resolve()),v(this,Ur,h(this,_t)?.subscribe?.(this.file,n=>this.receive(n))??null),v(this,Uo,this.users.subscribe(()=>w(this,te,Hs).call(this))),e.onNotify&&v(this,jr,ea(this,e.onNotify))}get threads(){return h(this,er)}get status(){return h(this,rr)}get ready(){return h(this,or)}thread(e){return h(this,er).find(n=>n.id===e)}subscribe(e){return h(this,tr).add(e),()=>h(this,tr).delete(e)}onChange(e){return h(this,wn).add(e),()=>h(this,wn).delete(e)}onOutgoing(e){return h(this,nr).add(e),()=>h(this,nr).delete(e)}can(e,n,r){let o=this.users.current;if(!o)return!1;let s={user:{id:o.id,role:this.users.role},thread:n,comment:r},i=h(this,Qn).permissions?.(e,s);if(i!==void 0)return i;let a=this.users.role;if(a==="viewer")return!1;if(a==="editor")return!0;switch(e){case"comment":case"reply":case"resolve":return!0;case"edit":case"delete":return r?.author===o.id;case"deleteThread":return n?.comments.every(l=>l.author===o.id)??!1}}createThread(e,n,r=D("th_"),o){let s=w(this,te,kn).call(this,"comment"),i=Date.now(),a={id:r,comments:[ta({id:D("cm_"),author:s,body:e,createdAt:i},o)],createdAt:i};return n!==void 0&&(a.anchor=n),w(this,te,Yt).call(this,{type:"thread.create",thread:a}),a}reply(e,n,r){let o=w(this,te,kn).call(this,"reply",e),s=ta({id:D("cm_"),author:o,body:n,createdAt:Date.now()},r);return w(this,te,Yt).call(this,{type:"comment.add",threadId:e,comment:s}),s}editComment(e,n,r,o){w(this,te,kn).call(this,"edit",e,n);let s={type:"comment.edit",threadId:e,commentId:n,body:r,at:Date.now()};o&&o.length>0&&(s.mentions=[...o]),w(this,te,Yt).call(this,s)}deleteComment(e,n){w(this,te,kn).call(this,"delete",e,n);let r=this.thread(e);r&&r.comments.length<=1?w(this,te,Yt).call(this,{type:"thread.delete",threadId:e}):w(this,te,Yt).call(this,{type:"comment.delete",threadId:e,commentId:n})}deleteThread(e){w(this,te,kn).call(this,"deleteThread",e),w(this,te,Yt).call(this,{type:"thread.delete",threadId:e})}resolve(e){let n=w(this,te,kn).call(this,"resolve",e);w(this,te,Yt).call(this,{type:"thread.resolve",threadId:e,by:n,at:Date.now()})}reopen(e){w(this,te,kn).call(this,"resolve",e),w(this,te,Yt).call(this,{type:"thread.reopen",threadId:e})}receive(e){v(this,Ve,Sn(h(this,Ve),e)),w(this,te,Lr).call(this);for(let n of h(this,wn))n(e,"remote")}dispose(){var e,n;(e=h(this,Ur))==null||e.call(this),v(this,Ur,null),h(this,Uo).call(this),(n=h(this,jr))==null||n.call(this),v(this,jr,null),h(this,tr).clear(),h(this,wn).clear()}reload(){return h(this,_t)?(v(this,or,w(this,te,na).call(this)),h(this,or)):Promise.resolve()}};_t=new WeakMap,Qn=new WeakMap,Ve=new WeakMap,st=new WeakMap,er=new WeakMap,Lo=new WeakMap,tr=new WeakMap,nr=new WeakMap,wn=new WeakMap,rr=new WeakMap,Ur=new WeakMap,Uo=new WeakMap,jr=new WeakMap,or=new WeakMap,te=new WeakSet,na=async function(){v(this,rr,"loading"),w(this,te,Hs).call(this);try{let e=await h(this,_t).load(this.file),n=new Set(e.map(r=>r.id));v(this,Ve,[...e,...h(this,Ve).filter(r=>!n.has(r.id)&&h(this,st).some(o=>o.type==="thread.create"&&o.thread.id===r.id))]),v(this,rr,"ready")}catch(e){v(this,rr,"error"),h(this,Qn).onError?.(new C("storage","Couldn't load comments",{cause:e}),{type:"thread.delete",threadId:""})}w(this,te,Lr).call(this)},kn=function(e,n,r){let o=this.users.current;if(!o)throw new C("invalid_operation","Sign in to comment: no current user was given");let s=n?this.thread(n):void 0;if(n&&!s)throw new C("not_found",`No thread "${n}"`);let i=r?s?.comments.find(a=>a.id===r):void 0;if(r&&!i)throw new C("not_found",`No comment "${r}"`);if(!this.can(e,s,i))throw new C("invalid_operation",`Not allowed to ${e}`);return o.id},Yt=function(e){h(this,st).push(e),w(this,te,Lr).call(this);for(let r of h(this,wn))r(e,"local");if(!h(this,_t)){v(this,st,h(this,st).filter(r=>r!==e)),v(this,Ve,Sn(h(this,Ve),e));for(let r of h(this,nr))r(e);return}let n=Io(e);v(this,Lo,h(this,Lo).then(async()=>{if(h(this,st).includes(e))try{await h(this,_t).save(this.file,e),v(this,st,h(this,st).filter(r=>r!==e)),v(this,Ve,Sn(h(this,Ve),e)),w(this,te,Lr).call(this);for(let r of h(this,nr))r(e)}catch(r){v(this,st,h(this,st).filter(o=>Io(o)!==n)),w(this,te,Lr).call(this),h(this,Qn).onError?.(new C("storage","Couldn't save the comment",{cause:r}),e)}}))},Lr=function(){v(this,er,h(this,st).reduce((e,n)=>Sn(e,n),h(this,Ve))),w(this,te,Hs).call(this)},Hs=function(){for(let e of h(this,tr))e()};var mt,vt,Ho,ht,Gr,Hr,ir,Ko,Wo,Kr,Wr,ie,ra,zr,jo,Yl,Ql,zo,Go,qr=class{constructor(e){E(this,ie);ue(this,"client",D("c_"));E(this,mt);E(this,vt,new Map);E(this,Ho,{});E(this,ht,"idle");E(this,Gr,new Set);E(this,Hr,new Map);E(this,ir,null);E(this,Ko,null);E(this,Wo,null);E(this,Kr,[]);E(this,Wr,0);v(this,mt,e),e.comments&&this.attachComments(e.comments)}attachComments(e){var n;(n=h(this,Wo))==null||n.call(this),v(this,Ko,e),v(this,Wo,e?.onOutgoing(r=>h(this,ht)==="connected"&&w(this,ie,zr).call(this,{type:"comment",change:r}))??null)}get status(){return h(this,ht)}get peers(){return h(this,Kr)}async connect(){if(h(this,ht)!=="idle")return;v(this,ht,"connecting"),w(this,ie,Go).call(this);let e=++nt(this,Wr)._,{transport:n,room:r}=h(this,mt);if(await n.connect(r,s=>w(this,ie,Yl).call(this,s)),e!==h(this,Wr))return;v(this,ht,"connected"),w(this,ie,zr).call(this,{type:"hello"}),w(this,ie,jo).call(this);let o=h(this,mt).heartbeat??1e4;v(this,ir,setInterval(()=>{w(this,ie,jo).call(this),w(this,ie,Ql).call(this)},o)),w(this,ie,Go).call(this)}disconnect(){h(this,ht)!=="idle"&&(nt(this,Wr)._++,h(this,ht)==="connected"&&w(this,ie,zr).call(this,{type:"presence",user:w(this,ie,ra).call(this)??{id:"",name:""},state:null}),h(this,ir)&&clearInterval(h(this,ir)),v(this,ir,null),h(this,mt).transport.disconnect(),h(this,vt).clear(),v(this,Kr,[]),v(this,ht,"idle"),w(this,ie,Go).call(this))}setPresence(e){v(this,Ho,e),h(this,ht)==="connected"&&w(this,ie,jo).call(this)}mapPresence(e){let n=!1;for(let r of h(this,vt).values()){let o=e(r.state);o!==r.state&&(r.state=o,n=!0)}n&&w(this,ie,zo).call(this)}sendCustom(e,n){w(this,ie,zr).call(this,{type:"custom",kind:e,data:n})}onCustom(e,n){let r=h(this,Hr).get(e)??new Set;return h(this,Hr).set(e,r),r.add(n),()=>r.delete(n)}subscribe(e){return h(this,Gr).add(e),()=>h(this,Gr).delete(e)}};mt=new WeakMap,vt=new WeakMap,Ho=new WeakMap,ht=new WeakMap,Gr=new WeakMap,Hr=new WeakMap,ir=new WeakMap,Ko=new WeakMap,Wo=new WeakMap,Kr=new WeakMap,Wr=new WeakMap,ie=new WeakSet,ra=function(){return h(this,mt).users.current},zr=function(e){h(this,mt).transport.send({v:1,client:this.client,message:e})},jo=function(){let e=w(this,ie,ra).call(this);e&&w(this,ie,zr).call(this,{type:"presence",user:e,state:h(this,Ho)})},Yl=function(e){let n=e;if(!n||n.v!==1||typeof n.client!="string"||!n.message||n.client===this.client)return;let{client:r,message:o}=n;switch(o.type){case"hello":w(this,ie,jo).call(this);break;case"presence":o.state===null?h(this,vt).delete(r)&&w(this,ie,zo).call(this):o.user?.id&&(h(this,mt).users.add([o.user]),h(this,vt).set(r,{client:r,user:o.user,state:o.state,seen:Date.now()}),w(this,ie,zo).call(this));break;case"comment":h(this,Ko)?.receive(o.change);break;case"custom":{let s=h(this,vt).get(r)??null;for(let i of h(this,Hr).get(o.kind)??[])i(o.data,s);break}}},Ql=function(){let e=h(this,mt).timeout??(h(this,mt).heartbeat??1e4)*3,n=Date.now(),r=!1;for(let[o,s]of h(this,vt))n-s.seen>e&&(h(this,vt).delete(o),r=!0);r&&w(this,ie,zo).call(this)},zo=function(){v(this,Kr,[...h(this,vt).values()]),w(this,ie,Go).call(this)},Go=function(){for(let e of h(this,Gr))e()};var Xr="sync",Ks="server";function ec(t){return(e,n,r)=>{let[o,s]=t(e,r),[i,a]=t(n,s);return{inflight:o,pending:i,incoming:a}}}function Ws(t={}){let e=new Map,n=s=>JSON.parse(JSON.stringify(s)),r=s=>{let i=e.get(s);return i||e.set(s,i={snapshot:null,log:[]}),i},o=s=>s.log[s.log.length-1]?.version??s.snapshot?.version??0;return{head:s=>o(r(s)),async load(s){let i=r(s).snapshot;return i?n(i):null},async entries(s,i){let a=r(s),l=a.log[0]?.version;return l!==void 0&&l>i+1||l===void 0&&(a.snapshot?.version??0)>i?null:n(a.log.filter(c=>c.version>i))},async append(s,i){let a=r(s);return o(a)!==i.version-1?!1:(a.log.push(n(i)),!0)},async save(s,i){let a=r(s);a.snapshot=n(i),t.keepEntries!==void 0&&(a.log=a.log.filter(l=>l.version>i.version-t.keepEntries))}}}var oa=t=>typeof t=="object"&&t!==null;function qs(t){let{store:e,model:n}=t,r=t.snapshotEvery??100,o=t.maxCatchUp??500,s=new Map,i=new Map,a=(f,p)=>p.reduce((m,g)=>g.ops.reduce((y,b)=>n.apply(y,b),m),f);async function l(f){let p=await e.load(f);if(!p){if(!t.create)throw new C("not_found",`No document for room "${f}"`);p={state:await t.create(f),version:0},await e.save(f,p)}let m=await e.entries(f,p.version)??[];return{state:a(p.state,m),version:m[m.length-1]?.version??p.version}}async function c(f){let p=s.get(f);if(!p){let g=await l(f);return s.set(f,g),g}let m=await e.entries(f,p.version);if(m===null){let g=await l(f);return s.set(f,g),g}if(m.length===0)return p;try{let g={state:a(p.state,m),version:m[m.length-1].version};return s.set(f,g),g}catch{let g=await l(f);return s.set(f,g),g}}let d=f=>({v:1,client:Ks,message:{type:"custom",kind:Xr,data:f}});async function u(f,p,m,g){let y=T=>g(d(T)),b=T=>y({type:"resync",to:p,reason:T});if(t.authorize&&!await t.authorize({room:f,client:p,message:m}))return b("not allowed");if(m.type==="join"){let T=await c(f),I=m.have,O=typeof I=="number"&&I>=0&&I<=T.version?await e.entries(f,I):null;O===null||O.length>o?y({type:"snapshot",to:p,version:T.version,state:T.state}):y({type:"caught_up",to:p,version:T.version,entries:O});return}if(m.type==="hash"){let T=await c(f);T.version===m.version&&n.hash(T.state)!==m.hash&&b("your document differs from the server's");return}let k=m.base;for(let T=0;T<8;T++){let I=await c(f);if(!Number.isInteger(k)||k<0||k>I.version)return b("unknown version");let O=await e.entries(f,k);if(O===null)return b("too far behind");if(k+O.length!==I.version)continue;let F=O.find($=>$.client===p&&$.batch===m.batch);if(F)return y({type:"entry",...F});let[R]=n.transform(m.ops,O.flatMap($=>$.ops)),N=I.state,P=[],B=!1;for(let $ of R)try{N=n.apply(N,$),P.push($)}catch(L){if(L instanceof C&&L.code==="not_found")B=!0;else throw L}let x={version:I.version+1,client:p,batch:m.batch,ops:P,...B?{dropped:!0}:{}};if(await e.append(f,x)){s.set(f,{state:N,version:x.version}),y({type:"entry",...x}),x.version%r===0&&await e.save(f,{state:N,version:x.version});return}}b("too busy")}return{receive(f,p,m){let g=p;if(!oa(g)||g.v!==1||typeof g.client!="string"||g.client===Ks)return Promise.resolve();let y=g.message;if(!oa(y)||y.type!=="custom"||y.kind!==Xr||!oa(y.data))return Promise.resolve();let b=y.data;if(!(b.type==="join"&&(b.have===null||Number.isInteger(b.have))||b.type==="ops"&&typeof b.batch=="string"&&Array.isArray(b.ops)&&typeof b.base=="number"||b.type==="hash"&&typeof b.hash=="string"&&typeof b.version=="number"))return Promise.resolve();let T=g.client,O=(i.get(f)??Promise.resolve()).then(()=>u(f,T,b,m).catch(F=>{t.onError?.(F,f),s.delete(f),m(d({type:"resync",to:T,reason:"error"}))}));return i.set(f,O),O}}}var Le,Qt,xn,Vo,Te,Je,Lt,ar,gt,Me,it,vn,Vr,Jo,lr,cr,G,qo,Xo,Xs,tc,sa,nc,ia,aa,It,la,Cn=class{constructor(e){E(this,G);E(this,Le);E(this,Qt);E(this,xn);E(this,Vo);E(this,Te);E(this,Je,!1);E(this,Lt,!1);E(this,ar,!1);E(this,gt,!0);E(this,Me,null);E(this,it,[]);E(this,vn,"connecting");E(this,Vr,new Set);E(this,Jo,[]);E(this,lr,null);E(this,cr,null);v(this,Le,e),v(this,Qt,e.session),v(this,xn,e.model),v(this,Vo,e.model.rebase??ec(e.model.transform)),v(this,Te,e.version??null)}get room(){return h(this,Le).room}get lastResync(){return h(this,cr)}get version(){return h(this,Te)}get status(){return h(this,vn)}get unsynced(){return(h(this,Me)?.ops.length??0)+h(this,it).length}subscribe(e){return h(this,Vr).add(e),()=>h(this,Vr).delete(e)}start(){if(h(this,ar))return;v(this,ar,!0);let{room:e}=h(this,Le);h(this,Jo).push(h(this,Qt).subscribe(r=>{r.origin!=="remote"&&(w(this,G,aa).call(this,r.ops),h(this,it).push(...r.ops),w(this,G,It).call(this),w(this,G,Xs).call(this))}),e.onCustom(Xr,r=>w(this,G,nc).call(this,r)),e.subscribe(()=>{e.status==="connected"&&!h(this,Je)&&h(this,gt)?w(this,G,Xo).call(this):e.status==="idle"&&w(this,G,sa).call(this)}));let n=h(this,Le).verifyEvery??3e4;n>0&&v(this,lr,setInterval(()=>w(this,G,tc).call(this),n)),e.status==="connected"&&h(this,gt)&&w(this,G,Xo).call(this),w(this,G,It).call(this)}stop(){for(let e of h(this,Jo).splice(0))e();h(this,lr)&&clearInterval(h(this,lr)),v(this,lr,null),v(this,ar,!1),v(this,Je,!1),v(this,Lt,!1)}setOnline(e){e!==h(this,gt)&&(v(this,gt,e),e?Promise.resolve().then(()=>{h(this,gt)&&h(this,ar)&&h(this,Le).room.status==="connected"&&w(this,G,Xo).call(this)}):w(this,G,sa).call(this),w(this,G,It).call(this))}resync(e="asked to"){let n=this.unsynced;v(this,Me,null),v(this,it,[]),v(this,Te,null),v(this,Je,!1),v(this,Lt,!1),v(this,vn,"resyncing"),v(this,cr,{reason:e,lost:n,at:Date.now()}),w(this,G,la).call(this),h(this,Le).onResync?.({reason:e,lost:n}),h(this,gt)&&h(this,Le).room.status==="connected"&&w(this,G,Xo).call(this)}};Le=new WeakMap,Qt=new WeakMap,xn=new WeakMap,Vo=new WeakMap,Te=new WeakMap,Je=new WeakMap,Lt=new WeakMap,ar=new WeakMap,gt=new WeakMap,Me=new WeakMap,it=new WeakMap,vn=new WeakMap,Vr=new WeakMap,Jo=new WeakMap,lr=new WeakMap,cr=new WeakMap,G=new WeakSet,qo=function(e){h(this,Le).room.sendCustom(Xr,e)},Xo=function(){h(this,Lt)||(v(this,Je,!1),v(this,Lt,!0),w(this,G,qo).call(this,{type:"join",have:h(this,Te)}),w(this,G,It).call(this))},Xs=function(){!h(this,Je)||!h(this,gt)||h(this,Me)||h(this,it).length===0||h(this,Te)===null||(v(this,Me,{batch:D("bt_"),ops:h(this,it)}),v(this,it,[]),w(this,G,qo).call(this,{type:"ops",batch:h(this,Me).batch,base:h(this,Te),ops:h(this,Me).ops}))},tc=function(){!h(this,Je)||!h(this,gt)||h(this,Me)||h(this,it).length>0||h(this,Te)===null||w(this,G,qo).call(this,{type:"hash",version:h(this,Te),hash:h(this,xn).hash(h(this,Qt).state)})},sa=function(){v(this,Je,!1),v(this,Lt,!1),w(this,G,It).call(this)},nc=function(e){if(!(!e||typeof e!="object")&&!("to"in e&&e.to!==h(this,Le).room.client))switch(e.type){case"snapshot":{let n=this.unsynced;v(this,Te,e.version),v(this,Me,null),v(this,it,[]),h(this,Qt).reset(e.state),v(this,Je,!0),v(this,Lt,!1),w(this,G,It).call(this),n>0&&h(this,vn)!=="resyncing"&&(v(this,cr,{reason:"joined with changes the server doesn't have",lost:n,at:Date.now()}),h(this,Le).onResync?.({reason:h(this,cr).reason,lost:n}));break}case"caught_up":{v(this,Je,!0),v(this,Lt,!1);for(let n of e.entries)w(this,G,ia).call(this,n);h(this,Je)&&h(this,Me)&&h(this,Te)!==null&&w(this,G,qo).call(this,{type:"ops",batch:h(this,Me).batch,base:h(this,Te),ops:h(this,Me).ops}),w(this,G,It).call(this),w(this,G,Xs).call(this);break}case"entry":w(this,G,ia).call(this,e);break;case"resync":this.resync(e.reason);break}},ia=function(e){if(h(this,Te)===null||e.version<=h(this,Te))return;if(e.version!==h(this,Te)+1)return this.resync("missed an update");if(h(this,Me)&&e.client===h(this,Le).room.client&&e.batch===h(this,Me).batch){if(v(this,Me,null),v(this,Te,e.version),e.dropped)return this.resync("the server left out part of a change");w(this,G,It).call(this),w(this,G,Xs).call(this);return}let n=h(this,Vo).call(this,h(this,Me)?.ops??[],h(this,it),e.ops);try{n.incoming.length>0&&(h(this,Qt).transact(n.incoming,{origin:"remote"}),h(this,Qt).rebaseHistory(n.incoming,{transform:h(this,xn).transform,mapMeta:h(this,xn).mapMeta}),w(this,G,aa).call(this,n.incoming))}catch{return this.resync("couldn't apply an update")}h(this,Me)&&v(this,Me,{batch:h(this,Me).batch,ops:n.inflight}),v(this,it,n.pending),v(this,Te,e.version),w(this,G,It).call(this)},aa=function(e){let n=h(this,xn).mapPresence;n&&e.length>0&&h(this,Le).room.mapPresence(r=>n(r,e))},It=function(){let e=!h(this,gt)||h(this,Le).room.status==="idle"?"offline":h(this,Je)?this.unsynced>0?"saving":"synced":h(this,vn)==="resyncing"?"resyncing":"connecting";v(this,vn,e),w(this,G,la).call(this)},la=function(){for(let e of h(this,Vr))e()};var zf=256,Gf=5e6,Hf={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};function rc(t){return t.includes("&")?t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,(e,n)=>{if(n[0]==="#"){let r=n[1]==="x"||n[1]==="X"?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return Number.isFinite(r)&&r>0&&r<=1114111&&!(r>=55296&&r<=57343)?String.fromCodePoint(r):""}return Hf[n]??e}):t}var ca=t=>t.slice(t.indexOf(":")+1);function ua(t){let e=t.charCodeAt(0)===65279?1:0,n=i=>{throw new C("invalid_document",`Not valid XML: ${i} (at ${e})`)},r=null,o=[],s=0;for(;e<t.length;){let i=t.indexOf("<",e),a=i<0?t.length:i;if(a>e){let l=t.slice(e,a),c=o[o.length-1];c?c.children.push(rc(l)):l.trim()!==""&&n("text outside the root element"),e=a}if(i<0)break;if(t.startsWith("<!--",e)){let l=t.indexOf("-->",e+4);l<0&&n("unclosed comment"),e=l+3}else if(t.startsWith("<![CDATA[",e)){let l=t.indexOf("]]>",e+9);l<0&&n("unclosed CDATA"),o[o.length-1]?.children.push(t.slice(e+9,l)),e=l+3}else if(t.startsWith("<?",e)){let l=t.indexOf("?>",e+2);l<0&&n("unclosed declaration"),e=l+2}else if(t.startsWith("<!",e)){let l=0,c=e+2;for(;c<t.length;c++){let d=t[c];if(d==="[")l++;else if(d==="]")l--;else if(d===">"&&l<=0)break}c>=t.length&&n("unclosed declaration"),e=c+1}else if(t.startsWith("</",e)){let l=t.indexOf(">",e+2);l<0&&n("unclosed end tag");let c=ca(t.slice(e+2,l).trim()),d=o.pop();(!d||d.name!==c)&&n(`unexpected </${c}>`),e=l+1}else{let l=e+1,c=l;for(;l<t.length&&!/[\s/>]/.test(t[l]);)l++;let d={name:ca(t.slice(c,l)),attrs:{},children:[]};for(d.name===""&&n("a tag with no name");;){for(;l<t.length&&/\s/.test(t[l]);)l++;let p=t[l];if(p===void 0&&n("unclosed tag"),p===">"||p==="/")break;let m=l;for(;l<t.length&&!/[\s=/>]/.test(t[l]);)l++;let g=t.slice(m,l);for(;l<t.length&&/\s/.test(t[l]);)l++;for(t[l]!=="="&&n(`attribute "${g}" has no value`),l++;l<t.length&&/\s/.test(t[l]);)l++;let y=t[l];y!=='"'&&y!=="'"&&n(`attribute "${g}" isn't quoted`);let b=t.indexOf(y,l+1);b<0&&n("unclosed attribute value"),d.attrs[g]=rc(t.slice(l+1,b)),l=b+1}let u=t[l]==="/";u&&l++,t[l]!==">"&&n("a tag that doesn't end"),e=l+1,++s>Gf&&n("too many elements");let f=o[o.length-1];f?f.children.push(d):r?n("more than one root element"):r=d,u||(o.push(d),o.length>zf&&n("elements nested too deeply"))}}return o.length>0&&n(`<${o[o.length-1].name}> was never closed`),r||n("no root element"),r}function Fe(t){return t?t.children.filter(e=>typeof e!="string"):[]}function A(t,e){return t?.children.find(n=>typeof n!="string"&&n.name===e)}function Ee(t,e){return t?t.children.filter(n=>typeof n!="string"&&n.name===e):[]}function S(t,e,n){if(!t)return;let r=n?`${n}:${e}`:void 0;if(r&&r in t.attrs)return t.attrs[r];if(!n){if(`w:${e}`in t.attrs)return t.attrs[`w:${e}`];if(e in t.attrs)return t.attrs[e]}for(let[o,s]of Object.entries(t.attrs))if(ca(o)===e&&(!n||o.startsWith(`${n}:`)))return s}function Ct(t){return t?t.children.map(e=>typeof e=="string"?e:Ct(e)).join(""):""}function Jr(t){return Array.isArray(t)?`[${t.map(Jr).join(",")}]`:t&&typeof t=="object"?`{${Object.entries(t).filter(([,n])=>n!==void 0).sort(([n],[r])=>n<r?-1:n>r?1:0).map(([n,r])=>`${JSON.stringify(n)}:${Jr(r)}`).join(",")}}`:JSON.stringify(t)??"null"}function da(t){let e=2166136261;for(let n=0;n<t.length;n++)e^=t.charCodeAt(n),e=Math.imul(e,16777619)>>>0;return`${e.toString(36)}.${t.length.toString(36)}`}function fa(t){return da(Jr(t))}function Kf(t,e){let n=()=>t.setOnline(!1),r=()=>t.setOnline(!0);return e.on("disconnect",n),e.on("connect",r),()=>{e.off?.("disconnect",n),e.off?.("connect",r)}}function oc(t,e,n){let r="core"in t?t.core:t,{room:o,comments:s}=n,i=new Cn({session:r,room:o,model:e,version:n.version,verifyEvery:n.verifyEvery,onResync:n.onResync}),a=[];s&&o.attachComments(s),n.socket&&a.push(Kf(i,n.socket)),i.start();let l=o.status==="idle";l&&Promise.resolve(o.connect()).catch(()=>{});let c=new Promise(u=>{if(i.version!==null)return u();let f=i.subscribe(()=>{i.version!==null&&(f(),u())});a.push(f)}),d=!1;return{sync:i,ready:c,stop(){if(!d){d=!0,i.stop();for(let u of a.splice(0))u();s&&o.attachComments(null),l&&o.disconnect()}}}}var Zr,Ut,Pn,ur=class{constructor(e,n={}){E(this,Zr);E(this,Ut);E(this,Pn,!1);v(this,Zr,e),v(this,Ut,n)}get running(){return h(this,Pn)}run(e){if(h(this,Pn))throw new C("invalid_operation","A script is already running");let n=new Set(h(this,Ut).grants??["read","write"]),r=h(this,Ut).maxOps??1e4,o=h(this,Ut).maxMs??5e3,s=h(this,Ut).now??Date.now,i=s(),a=h(this,Zr),l=0,c=u=>{if(!n.has(u))throw new C("invalid_operation",`Scripts are not allowed to ${u} here`)},d={get state(){return c("read"),a.state},get applied(){return l},can:u=>n.has(u),apply:(u,f={})=>{if(c("write"),u.length!==0){if(s()-i>o)throw new C("invalid_operation",`The script ran for longer than ${o} ms`);if(l+u.length>r)throw new C("invalid_operation",`The script tried to apply more than ${r} operations`);for(let p of u)if(h(this,Ut).allow&&!h(this,Ut).allow(p))throw new C("invalid_operation","The script tried to make a change it is not allowed to");a.transact(u,{...f,...l>0?{merge:!0}:{}}),l+=u.length}}};v(this,Pn,!0);try{return e(d)}catch(u){throw l>0&&a.undo(),u}finally{v(this,Pn,!1)}}onEdit(e,n={}){return h(this,Zr).subscribe(r=>{h(this,Pn)||r.origin==="remote"&&n.remote===!1||e(r)})}};Zr=new WeakMap,Ut=new WeakMap,Pn=new WeakMap;function pa(t){let{core:e,model:n,kind:r}=t,o={kind:r,core:e,model:n,get state(){return e.state},get canUndo(){return e.canUndo},get canRedo(){return e.canRedo},transact:(s,i)=>(t.transact??((a,l)=>e.transact(a,l)))(s,i),undo:()=>t.undo?t.undo():e.undo(),redo:()=>t.redo?t.redo():e.redo(),subscribe:s=>e.subscribe(s),serialize:()=>Jr(e.state),hash:()=>n.hash(e.state),get supportsComments(){return!!t.comments},get comments(){return t.comments?.get()??null},enableComments(s){if(!t.comments)throw new C("unsupported",`The ${r} editor doesn't have comments yet`);return t.comments.get()??t.comments.enable(s)},attachSync(s,i={}){return oc(e,n,{comments:o.comments,...i,room:s})},script:s=>new ur(o,s)};return o}function ma(t){let e=()=>[...t.threads()].sort((n,r)=>n.createdAt-r.createdAt);return{load:()=>e(),save(n,r){let o=Io(r);t.write(o,Sn(e(),r).find(s=>s.id===o)??null)}}}function ha(t,e,n){return e.subscribe(r=>{(r.reset||(r.origin==="undo"||r.origin==="redo")&&r.ops.some(n))&&t.reload()})}var Wf=[["Arial","sans-serif","47",!0,["Arimo","Liberation Sans","Helvetica","Helvetica Neue"],["ArialMT","Arial MT"]],["Arial Black","sans-serif","9",!1,["Arial","Archivo Black","Helvetica"]],["Arial Narrow","sans-serif","47",!0,["Arimo","Liberation Sans Narrow","Roboto Condensed","Arial"]],["Aptos","sans-serif","3467",!0,["Segoe UI","Calibri","Carlito","Arial"]],["Aptos Display","sans-serif","4",!1,["Aptos","Segoe UI","Calibri","Arial"]],["Book Antiqua","serif","47",!0,["Palatino Linotype","Palatino","Tinos","Georgia"]],["Bookman Old Style","serif","47",!0,["Bookman","Georgia","Tinos"]],["Calibri","sans-serif","347",!0,["Carlito","Segoe UI","Open Sans","Arial"]],["Calibri Light","sans-serif","3",!0,["Carlito","Calibri","Segoe UI","Arial"]],["Cambria","serif","47",!0,["Caladea","Georgia","Times New Roman"]],["Candara","sans-serif","47",!0,["Calibri","Carlito","Segoe UI","Arial"]],["Century Gothic","sans-serif","47",!0,["Questrial","Poppins","Avenir","Arial"]],["Comic Sans MS","handwriting","47",!0,["Comic Neue","Chalkboard SE","Comic Sans"]],["Consolas","monospace","47",!0,["Inconsolata","Menlo","Courier New"]],["Constantia","serif","47",!0,["Georgia","Gelasio","Times New Roman"]],["Corbel","sans-serif","47",!0,["Calibri","Carlito","Segoe UI","Arial"]],["Courier","monospace","47",!0,["Courier New","Cousine"]],["Courier New","monospace","47",!0,["Cousine","Liberation Mono","Courier"]],["Franklin Gothic Medium","sans-serif","5",!0,["Libre Franklin","Arial"]],["Garamond","serif","47",!0,["EB Garamond","Cormorant Garamond","Georgia","Times New Roman"]],["Georgia","serif","47",!0,["Gelasio","Times New Roman"]],["Gill Sans MT","sans-serif","47",!0,["Gill Sans","Lato","Arial"]],["Helvetica","sans-serif","47",!0,["Arial","Arimo","Liberation Sans"]],["Helvetica Neue","sans-serif","1234567",!0,["Helvetica","Arial","Arimo"]],["Impact","display","5",!1,["Anton","Haettenschweiler","Arial Black"]],["Lucida Console","monospace","4",!1,["Courier New","Cousine","Monaco"]],["Lucida Sans Unicode","sans-serif","4",!1,["Lucida Grande","Arial","Arimo"]],["Menlo","monospace","47",!0,["Monaco","Consolas","Courier New"]],["Monaco","monospace","4",!1,["Menlo","Consolas","Courier New"]],["Palatino Linotype","serif","47",!0,["Palatino","Book Antiqua","Tinos","Georgia"],["Palatino"]],["Rockwell","serif","47",!0,["Roboto Slab","Zilla Slab","Georgia"]],["Brush Script MT","handwriting","4",!0,["Dancing Script","Pacifico","Comic Sans MS"]],["Segoe Print","handwriting","47",!1,["Caveat","Comic Neue","Comic Sans MS"]],["Segoe Script","handwriting","47",!1,["Dancing Script","Pacifico","Comic Sans MS"]],["Segoe UI","sans-serif","3467",!0,["Selawik","Open Sans","Helvetica Neue","Arial"]],["Tahoma","sans-serif","47",!1,["Noto Sans","DejaVu Sans","Verdana","Arial"]],["Times New Roman","serif","47",!0,["Tinos","Liberation Serif","Times"],["Times","TimesNewRomanPSMT"]],["Trebuchet MS","sans-serif","47",!0,["Fira Sans","Lucida Grande","Arial"]],["Verdana","sans-serif","47",!0,["DejaVu Sans","Geneva","Arial"]]],qf=t=>[...t].map(e=>Number(e)*100),sc=Wf.map(([t,e,n,r,o,s])=>({family:t,category:e,origin:"system",weights:qf(n),italic:r,subsets:[],fallbacks:o,...s?{aliases:s}:{},office:t})),ic={arialmt:"Arial","arial mt":"Arial","arial-boldmt":"Arial",times:"Times New Roman",timesnewromanpsmt:"Times New Roman","times new roman ps":"Times New Roman","courier new ps":"Courier New",couriernewpsmt:"Courier New","helvetica neue light":"Helvetica Neue","segoe ui light":"Segoe UI","segoe ui semibold":"Segoe UI","calibri (body)":"Calibri","calibri (headings)":"Calibri Light","cambria (headings)":"Cambria","cambria (body)":"Cambria","system-ui":"Segoe UI","-apple-system":"Helvetica Neue","sans-serif":"Arial",serif:"Times New Roman",monospace:"Courier New"};var ac="cyrillic|cyrillic-ext|greek|greek-ext|latin|latin-ext|vietnamese|hebrew|armenian|bengali|canadian-aboriginal|devanagari|ethiopic|georgian|gujarati|gurmukhi|khmer|lao|malayalam|oriya|sinhala|tamil|telugu|thai|japanese|arabic|korean|chinese-traditional|chinese-simplified|cherokee|nushu|syriac|tifinagh|adlam|old-permic|gothic|old-italic|runic|chinese-hongkong|kayah-li|myanmar|kannada|meetei-mayek|ol-chiki|mayan-numerals|lisu|tibetan|warang-citi|khojki|cypriot|mongolian|samaritan|thaana|tagalog|kirat-rai|sora-sompeng|buhid|new-tai-lue|beria-erfe|yi|nabataean|javanese|phoenician|bhaiksuki|osmanya|old-persian|tai-viet|brahmi|tangsa|chakma|linear-a|anatolian-hieroglyphs|pahawh-hmong|dives-akuru|coptic|hanunoo|tangut|shavian|wancho|egyptian-hieroglyphs|tai-le|nag-mundari|balinese|vithkuqi|batak|cypro-minoan|multani|marchen|syloti-nagri|ahom|nko|sunuwar|limbu|kaithi|carian|takri|glagolitic|old-north-arabian|old-turkic|gunjala-gondi|dogra|toto|yezidi|cuneiform|elbasan|nandinagari|indic-siyaq-numbers|osage|old-hungarian|sundanese|medefaidrin|avestan|duployan|nyiakeng-puachue-hmong|lepcha|lydian|grantha|siddham|inscriptional-pahlavi|meroitic|meroitic-cursive|meroitic-hieroglyphs|bamum|makasar|todhri|imperial-aramaic|ottoman-siyaq-numbers|mahajani|newa|vai|tai-tham|inscriptional-parthian|kana-extended|cham|ugaritic|mende-kikakui|buginese|tagbanwa|linear-b|deseret|sharada|old-south-arabian|zanabazar-square|kharoshthi|palmyrene|mro|znamenny|khitan-small-script|miao|saurashtra|bassa-vah|old-uyghur|caucasian-albanian|phags-pa|kawi|signwriting|masaram-gondi|old-sogdian|hanifi-rohingya|rejang|hatran|sogdian|tamil-supplement|khudawadi|psalter-pahlavi|soyombo|ogham|chorasmian|lycian|tirhuta|elymaic|modi|pau-cin-hau|mandaic|manichaean";var lc=`Roboto;s;123456789;i;0,1,2,3,4,5,6
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
YakuHanRPs;d;1345789;;4`;var Xf={s:"sans-serif",r:"serif",d:"display",m:"monospace",h:"handwriting"};var ga;function cc(){if(ga)return ga;let t=ac.split("|"),e=[],n=lc.split(`
`);for(let r=0;r<n.length;r++){let[o,s,i,a,l,c]=n[r].split(";");e.push({family:o,category:Xf[s]??"sans-serif",origin:"google",weights:[...i].map(d=>Number(d)*100),italic:a.includes("i"),subsets:l===""?[]:l.split(",").map(d=>t[Number(d)]),id:c??o.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),rank:r,fallbacks:[]})}return ga=e,e}var uc;function Yr(t){return t.trim().replace(/^["']|["']$/g,"").replace(/\s+/g," ").toLowerCase()}function Vf(){let t=new Map;for(let e of cc())t.set(Yr(e.family),e);for(let e of sc){t.set(Yr(e.family),e);for(let n of e.aliases??[])t.set(Yr(n),e)}for(let[e,n]of Object.entries(ic)){let r=t.get(Yr(n));r&&!t.has(e)&&t.set(e,r)}return t}var Jf=new Map;function jt(t){uc??(uc=Vf());let e=Yr(t);return Jf.get(e)??uc.get(e)}function ya(t){return(t.split(",")[0]??"").trim().replace(/^["']|["']$/g,"")}var Zf={"sans-serif":"sans-serif",serif:"serif",monospace:"monospace",display:"sans-serif",handwriting:"cursive"},Yf=t=>/^[A-Za-z][A-Za-z0-9-]*$/.test(t)&&!/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(t)?t:`"${t.replace(/["\\]/g,"")}"`;function Vs(t){let e=t.toLowerCase();return/mono|courier|consolas|menlo|monaco|code|typewriter|terminal/.test(e)?"monospace":/script|hand|brush|marker|cursive|calligraph/.test(e)?"handwriting":/times|georgia|garamond|palatino|cambria|book|minion|charter|baskerville|didot|bodoni|serif/.test(e)&&!/sans/.test(e)?"serif":"sans-serif"}function dc(t){return jt(t)?.category??Vs(t)}function ba(t,e=[],n){let r=n??jt(t),o=[ya(t)||t,...r?.fallbacks??[],...e];return[...[...new Set(o.filter(Boolean))].map(Yf),Zf[r?.category??Vs(t)]].join(", ")}function ka(t){switch(dc(t)){case"serif":return{docxFamily:"roman",docxPitch:"variable",xlsxFamily:1,pptxPitchFamily:18};case"monospace":return{docxFamily:"modern",docxPitch:"fixed",xlsxFamily:3,pptxPitchFamily:49};case"handwriting":return{docxFamily:"script",docxPitch:"variable",xlsxFamily:4,pptxPitchFamily:66};case"display":return{docxFamily:"decorative",docxPitch:"variable",xlsxFamily:5,pptxPitchFamily:82};default:return{docxFamily:"swiss",docxPitch:"variable",xlsxFamily:2,pptxPitchFamily:34}}}var Qf={roboto:"Arial","open sans":"Segoe UI",lato:"Calibri",montserrat:"Century Gothic",poppins:"Century Gothic",inter:"Segoe UI","source sans 3":"Calibri","source sans pro":"Calibri","noto sans":"Segoe UI",raleway:"Century Gothic",nunito:"Calibri","nunito sans":"Calibri","work sans":"Arial","fira sans":"Trebuchet MS",ubuntu:"Trebuchet MS","pt sans":"Calibri","dm sans":"Arial",mulish:"Calibri",rubik:"Arial",karla:"Arial",barlow:"Arial",quicksand:"Century Gothic","josefin sans":"Century Gothic",oswald:"Impact","bebas neue":"Impact",anton:"Impact","archivo black":"Arial Black",lora:"Georgia",merriweather:"Georgia","playfair display":"Georgia","pt serif":"Georgia","crimson text":"Garamond","eb garamond":"Garamond","cormorant garamond":"Garamond","libre baskerville":"Georgia","noto serif":"Georgia","source serif 4":"Georgia","roboto slab":"Rockwell","zilla slab":"Rockwell",bitter:"Rockwell",arvo:"Rockwell","roboto mono":"Consolas","source code pro":"Consolas","fira code":"Consolas","jetbrains mono":"Consolas",inconsolata:"Consolas","ibm plex mono":"Consolas","space mono":"Courier New","courier prime":"Courier New","dancing script":"Segoe Script",pacifico:"Segoe Script",caveat:"Segoe Print",lobster:"Segoe Script","comic neue":"Comic Sans MS",carlito:"Calibri",caladea:"Cambria",arimo:"Arial",tinos:"Times New Roman",cousine:"Courier New",gelasio:"Georgia"};function Js(t){let e=jt(t);if(e?.origin==="system")return e.family;let n=Qf[(e?.family??t).toLowerCase()];if(n)return n;switch(e?.category??Vs(t)){case"serif":return"Times New Roman";case"monospace":return"Courier New";case"handwriting":return"Comic Sans MS";default:return"Arial"}}function H(t){let e="";for(let n of t)e+=n.text;return e}function q(t){let e=0;for(let n of t)e+=n.text.length;return e}function Zs(t,e){let n=t?Object.keys(t):[],r=e?Object.keys(e):[];return n.length!==r.length?!1:n.every(o=>{let s=t[o],i=e?.[o];return Array.isArray(s)&&Array.isArray(i)?s.length===i.length&&s.every((a,l)=>a===i[l]):s&&i&&typeof s=="object"&&typeof i=="object"?JSON.stringify(s)===JSON.stringify(i):s===i})}function zt(t,e){let n=0;for(let r of t){let o=n+r.text.length;if(e>=n&&e<o)return r.marks;n=o}}function Ys(t,e,n,r){return n<=e?!1:me(t,e,n).every(o=>o.marks?.[r]===!0)}function he(t){let e=[];for(let n of t){if(n.text==="")continue;let r=n.marks&&Object.keys(n.marks).length>0?n.marks:void 0,o=e[e.length-1];o&&Zs(o.marks,r)?o.text+=n.text:e.push(r?{text:n.text,marks:{...r}}:{text:n.text})}return e}function dr(t,e,n){let r=q(t);if(!Number.isInteger(e)||!Number.isInteger(n)||e<0||n<e||n>r)throw new C("out_of_range",`Range ${e}-${n} is outside text of length ${r}`)}function me(t,e,n){dr(t,e,n);let r=[],o=0;for(let s of t){let i=o,a=o+s.text.length;o=a;let l=Math.max(e,i),c=Math.min(n,a);l<c&&r.push({text:s.text.slice(l-i,c-i),marks:s.marks})}return he(r)}function fc(t,e,n){return dr(t,e,e),he([...me(t,0,e),...n,...me(t,e,q(t))])}function pc(t,e,n){return dr(t,e,n),he([...me(t,0,e),...me(t,n,q(t))])}function Zo(t,e){let n={...t};for(let[r,o]of Object.entries(e))o===null||o===!1||o===void 0?delete n[r]:n[r]=o;return n}function mc(t,e,n,r){dr(t,e,n);let o=q(t),s=me(t,e,n).map(i=>({text:i.text,marks:Zo(i.marks,r)}));return he([...me(t,0,e),...s,...me(t,n,o)])}function hc(t){if(!t||!t.comment)return t;let{comment:e,...n}=t;return Object.keys(n).length>0?n:void 0}function Yo(t,e,n){let r=[];for(let o of me(t,e,n)){let s=hc(o.marks),i=r[r.length-1];i&&Zs(i.marks,s)?i.length+=o.text.length:r.push(s?{length:o.text.length,marks:s}:{length:o.text.length})}return r}function gc(t,e,n,r){dr(t,e,n);let o=r.reduce((m,g)=>m+g.length,0);if(o!==n-e)throw new C("invalid_operation",`Mark segments cover ${o} characters, not ${n-e}`);let s=me(t,e,n),i=H(s),a=m=>m.reduce((g,y)=>[...g,(g[g.length-1]??0)+y],[]),l=a(r.map(m=>m.length)),c=a(s.map(m=>m.text.length)),d=[],u=0,f=0,p=0;for(;u<o;){for(;l[f]<=u;)f++;for(;c[p]<=u;)p++;let m=Math.min(l[f],c[p]),g={...hc(r[f].marks),...s[p].marks?.comment?{comment:s[p].marks.comment}:{}};d.push({text:i.slice(u,m),marks:Object.keys(g).length>0?g:void 0}),u=m}return he([...me(t,0,e),...d,...me(t,n,q(t))])}function lt(t){let e=t.reduce((o,s)=>o+Math.max(0,s),0);if(e<=0)return t.map(()=>1/t.length);let n=t.map(o=>Math.max(0,o)/e),r=n.slice(0,-1).reduce((o,s)=>o+s,0);return n[n.length-1]=1-r,n}function yt(t){return t.rowSpan??1}function at(t){return t.colSpan??1}function Qr(t){let e=t.rows.length,n=t.columns.length,r=Array.from({length:e},()=>Array.from({length:n},()=>{}));return t.rows.forEach((o,s)=>o.cells.forEach((i,a)=>{if(!i.covered)for(let l=s;l<Math.min(e,s+yt(i));l++)for(let c=a;c<Math.min(n,a+at(i));c++)r[l][c]||(r[l][c]={row:s,col:a})})),r.map((o,s)=>o.map((i,a)=>i??{row:s,col:a}))}function eo(t,e,n){let r=Qr(t)[e][n];return{cell:t.rows[r.row].cells[r.col],row:r.row,col:r.col}}function en(t,e,n){return{row1:e,row2:e+yt(t)-1,col1:n,col2:n+at(t)-1}}function yc(t,e){let n=Qr(t),{row1:r,row2:o,col1:s,col2:i}=e;for(let a=!0;a;){a=!1;for(let l=r;l<=o;l++)for(let c=s;c<=i;c++){let d=n[l][c],u=en(t.rows[d.row].cells[d.col],d.row,d.col);u.row1<r&&(r=u.row1,a=!0),u.row2>o&&(o=u.row2,a=!0),u.col1<s&&(s=u.col1,a=!0),u.col2>i&&(i=u.col2,a=!0)}}return{row1:r,row2:o,col1:s,col2:i}}function fr(t,e){let n=[];for(let r=e.row1;r<=e.row2;r++)for(let o=e.col1;o<=e.col2;o++){let s=t.rows[r].cells[o];s.covered||n.push({cell:s,row:r,col:o})}return n}var bc=()=>({id:D("b_"),type:"paragraph",runs:[]});function kc(){return{id:D("c_"),blocks:[bc()]}}function wc(){return{id:D("c_"),blocks:[],covered:!0}}function Bn(t,e){let n={...t,...e};for(let r of Object.keys(n))n[r]===void 0&&delete n[r];return n}var to=t=>({rows:t.rows.map(e=>({...e,cells:e.cells.slice()}))});function Qs(t,e){let{rows:n}=to(t),r=Qr(t),o=[];for(let s=0;s<t.columns.length;s++){let i=e>0&&e<t.rows.length?r[e][s]:null;if(i&&i.row<e){if(o.push(wc()),s===i.col){let a=n[i.row];a.cells[i.col]=Bn(a.cells[i.col],{rowSpan:yt(a.cells[i.col])+1})}}else o.push(kc())}return n.splice(e,0,{id:D("r_"),cells:o}),{...t,rows:n}}function ei(t,e){let{rows:n}=to(t),r=Qr(t);t.rows.forEach((i,a)=>{let l=e>0&&e<t.columns.length?r[a][e]:null,c=n[a].cells;l&&l.col<e?(c.splice(e,0,wc()),a===l.row&&(c[l.col]=Bn(c[l.col],{colSpan:at(c[l.col])+1}))):c.splice(e,0,kc())});let o=1/(t.columns.length+1),s=lt([...t.columns.slice(0,e).map(i=>i*(1-o)),o,...t.columns.slice(e).map(i=>i*(1-o))]);return{...t,rows:n,columns:s}}function Sc(t,e,n){let{rows:r}=to(t);return t.rows.forEach((o,s)=>{o.cells.forEach((i,a)=>{if(i.covered)return;let l=s+yt(i)-1;if(s>=e&&s<=n&&l>n){let c=r[n+1].cells,d=l-n;c[a]=Bn(i,{rowSpan:d>1?d:void 0,covered:void 0})}else if(s<e&&l>=e){let c=Math.min(l,n)-e+1,d=yt(i)-c;r[s].cells[a]=Bn(i,{rowSpan:d>1?d:void 0})}})}),{...t,rows:r.filter((o,s)=>s<e||s>n)}}function xc(t,e,n){let{rows:r}=to(t);return t.rows.forEach((o,s)=>{o.cells.forEach((i,a)=>{if(i.covered)return;let l=a+at(i)-1;if(a>=e&&a<=n&&l>n){let c=l-n;r[s].cells[n+1]=Bn(i,{colSpan:c>1?c:void 0,covered:void 0})}else if(a<e&&l>=e){let c=Math.min(l,n)-e+1,d=at(i)-c;r[s].cells[a]=Bn(i,{colSpan:d>1?d:void 0})}})}),{...t,rows:r.map(o=>({...o,cells:o.cells.filter((s,i)=>i<e||i>n)})),columns:lt(t.columns.filter((o,s)=>s<e||s>n))}}var lp=t=>t.blocks.every(e=>("runs"in e?e.runs.length===0:!1)&&e.type!=="image"&&e.type!=="divider");function vc(t,e){if(e.row1===e.row2&&e.col1===e.col2)return null;let{rows:n}=to(t),r=fr(t,e),o=r[0],s=[];for(let{cell:a}of r)lp(a)||s.push(...a.blocks);let i=s.length>0?s:o.cell.blocks;n[o.row].cells[o.col]=Bn(o.cell,{blocks:i,rowSpan:e.row2>e.row1?e.row2-e.row1+1:void 0,colSpan:e.col2>e.col1?e.col2-e.col1+1:void 0});for(let a=e.row1;a<=e.row2;a++)for(let l=e.col1;l<=e.col2;l++){if(a===e.row1&&l===e.col1)continue;let c=n[a].cells[l];n[a].cells[l]={id:c.id,blocks:[],covered:!0}}return{...t,rows:n}}function Cc(t,e,n){let r=t.rows[e]?.cells[n];if(!r||r.covered||yt(r)===1&&at(r)===1)return null;let{rows:o}=to(t),s=en(r,e,n);for(let i=s.row1;i<=s.row2;i++)for(let a=s.col1;a<=s.col2;a++)i===e&&a===n||(o[i].cells[a]={id:o[i].cells[a].id,blocks:[bc()]});return o[e].cells[n]=Bn(r,{rowSpan:void 0,colSpan:void 0}),{...t,rows:o}}function Mn(t){let e=t.rows.length,n=t.columns.length,r=Array.from({length:e},()=>Array.from({length:n},()=>null));for(let o=0;o<e;o++){let s=t.rows[o];if(s.cells.length!==n)return`rows[${o}] has ${s.cells.length} cells, expected ${n}`;for(let i=0;i<n;i++){let a=s.cells[i];if(a.covered){if(a.blocks.length>0)return`rows[${o}].cells[${i}] is covered but has content`;if(a.rowSpan||a.colSpan)return`rows[${o}].cells[${i}] is covered but has a span`;continue}if(a.blocks.length===0)return`rows[${o}].cells[${i}] needs at least one block`;let l=yt(a),c=at(a);if(o+l>e||i+c>n)return`rows[${o}].cells[${i}] spans outside the table`;for(let d=o;d<o+l;d++)for(let u=i;u<i+c;u++){if(r[d][u])return`rows[${d}].cells[${u}] is covered twice`;if(r[d][u]=a.id,(d!==o||u!==i)&&!t.rows[d].cells[u].covered)return`rows[${d}].cells[${u}] is under a merged cell but not marked covered`}}}for(let o=0;o<e;o++)for(let s=0;s<n;s++)if(!r[o][s]&&t.rows[o].cells[s].covered)return`rows[${o}].cells[${s}] is covered by nothing`;return null}function On(t){let e=[];for(let n of t)if(e.push(n),n.type==="table")for(let r of n.rows)for(let o of r.cells)e.push(...o.blocks);return e}function X(t,e){for(let n=0;n<t.blocks.length;n++){let r=t.blocks[n];if(r.id===e)return{block:r,list:t.blocks,index:n,topIndex:n,cell:null};if(r.type==="table")for(let o=0;o<r.rows.length;o++){let s=r.rows[o].cells;for(let i=0;i<s.length;i++){let a=s[i],l=a.blocks.findIndex(c=>c.id===e);if(l>=0)return{block:a.blocks[l],list:a.blocks,index:l,topIndex:n,cell:{table:r,row:o,col:i,cell:a}}}}}return null}function Qo(t,e){for(let n=0;n<t.blocks.length;n++){let r=t.blocks[n];if(r.type==="table")for(let o=0;o<r.rows.length;o++){let s=r.rows[o].cells.findIndex(i=>i.id===e);if(s>=0)return{table:r,row:o,col:s,cell:r.rows[o].cells[s],topIndex:n}}}return null}function no(t,e,n){let r=t.findIndex(o=>o.id===e);if(r>=0)return n(t.slice(),r);for(let o=0;o<t.length;o++){let s=t[o];if(s.type==="table")for(let i=0;i<s.rows.length;i++){let a=s.rows[i];for(let l=0;l<a.cells.length;l++){let c=a.cells[l],d=c.blocks.findIndex(g=>g.id===e);if(d<0)continue;let u=n(c.blocks.slice(),d),f=s.rows.slice(),p=a.cells.slice();p[l]={...c,blocks:u},f[i]={...a,cells:p};let m=t.slice();return m[o]={...s,rows:f},m}}}return null}function Pc(t,e,n){for(let r=0;r<t.length;r++){let o=t[r];if(o.type==="table")for(let s=0;s<o.rows.length;s++){let i=o.rows[s],a=i.cells.findIndex(u=>u.id===e);if(a<0)continue;let l=o.rows.slice(),c=i.cells.slice();c[a]={...i.cells[a],blocks:n(i.cells[a].blocks.slice())},l[s]={...i,cells:c};let d=t.slice();return d[r]={...o,rows:l},d}}return null}function de(t,e=new Set){for(let n of t)if(e.add(n.id),n.type==="table")for(let r of n.rows){e.add(r.id);for(let o of r.cells)e.add(o.id),de(o.blocks,e)}return e}function j(t,e){return{anchor:{block:t,offset:e},focus:{block:t,offset:e}}}function Se(t){return t.anchor.block===t.focus.block&&t.anchor.offset===t.focus.offset}function Pt(t){return _(t)?q(t.runs):0}var Bc=new WeakMap;function Ze(t){let e=Bc.get(t.blocks);if(!e){let n=On(t.blocks);e={list:n,index:new Map(n.map((r,o)=>[r.id,o]))},Bc.set(t.blocks,e)}return e}function An(t,e){let n=Ze(t).index.get(e);if(n===void 0)throw new C("not_found",`No block with id "${e}"`);return n}function cp(t,e,n){return e.block===n.block?e.offset-n.offset:An(t,e.block)-An(t,n.block)}function pr(t,e){return cp(t,e.anchor,e.focus)<=0?{start:e.anchor,end:e.focus}:{start:e.focus,end:e.anchor}}function bt(t,e){let n=X(t,e.anchor.block),r=X(t,e.focus.block);if(!n?.cell||!r?.cell||n.cell.table.id!==r.cell.table.id||n.cell.cell.id===r.cell.cell.id)return null;let o=en(n.cell.cell,n.cell.row,n.cell.col),s=en(r.cell.cell,r.cell.row,r.cell.col),i=yc(n.cell.table,{row1:Math.min(o.row1,s.row1),row2:Math.max(o.row2,s.row2),col1:Math.min(o.col1,s.col1),col2:Math.max(o.col2,s.col2)});return{table:n.cell.table,topIndex:n.topIndex,...i}}function wa(t){return fr(t.table,t)}function Ye(t,e,n={}){let r=n.raw?null:bt(t,e);if(r)return wa(r).flatMap(({cell:d})=>d.blocks.map(u=>({block:u,from:0,to:Pt(u)})));let{start:o,end:s}=pr(t,e),{list:i}=Ze(t),a=An(t,o.block),l=An(t,s.block);!n.raw&&l>a&&s.offset===0&&l--;let c=[];for(let d=a;d<=l;d++){let u=i[d],f=Pt(u);c.push({block:u,from:d===a&&u.id===o.block?o.offset:0,to:d===l&&u.id===s.block?s.offset:f})}return c}function Ge(t,e){return Ye(t,e).map(n=>n.block)}function Oc(t){let e=Ze(t).list.filter(o=>o.type!=="table"),n=e[0],r=e[e.length-1];return!n||!r?null:{anchor:{block:n.id,offset:0},focus:{block:r.id,offset:Pt(r)}}}function Mc(t,e){let n=X(t,e.block);if(!n)return null;let r=Math.min(Math.max(Math.trunc(e.offset)||0,0),Pt(n.block));return{block:n.block.id,offset:r}}function ti(t,e){let n=Ze(t).list.find(s=>s.type!=="table");if(!n)return null;let r=e&&Mc(t,e.anchor),o=e&&Mc(t,e.focus);return r&&o?{anchor:r,focus:o}:j(n.id,0)}function es(t,e,n){let r=i=>{let a=i;for(let l of e)if(l.type==="insert_text"&&l.block===a.block&&l.offset<a.offset)a={block:a.block,offset:a.offset+l.runs.reduce((c,d)=>c+d.text.length,0)};else if(l.type==="delete_text"&&l.block===a.block){let c=a.offset<=l.from?a.offset:a.offset>=l.to?a.offset-(l.to-l.from):l.from;c!==a.offset&&(a={block:a.block,offset:c})}else l.type==="delete_block"&&n&&(l.id===a.block||l.within?.includes(a.block))&&(a=up(n,l)??a);if(n&&!X(n,a.block)&&a.block.endsWith("~empty")){let c=Qo(n,a.block.slice(0,-6))?.cell.blocks[0];c&&(a={block:c.id,offset:0})}return a},o=r(t.anchor),s=r(t.focus);return o===t.anchor&&s===t.focus?t:{anchor:o,focus:s}}function up(t,e){if(typeof e.after=="string"){let r=X(t,e.after)?.block;if(r){if(r.type!=="table")return{block:r.id,offset:Pt(r)};let o=r.rows.at(-1)?.cells.at(-1)?.blocks.at(-1);if(o)return{block:o.id,offset:Pt(o)}}}let n=e.cell!==void 0?Qo(t,e.cell)?.cell.blocks[0]:Ze(t).list.find(r=>r.type!=="table");return n?{block:n.id,offset:0}:null}var dp=200,fp=(t,e)=>t?.includes(e)?[...t]:[...t??[],e].sort();function Sa(t,e,n,r){let o=[],s=0;for(let i of t){let a=s+i.text.length,l=Math.max(e,s),c=Math.min(n,a);l>=c?o.push(i):(l>s&&o.push({...i,text:i.text.slice(0,l-s)}),o.push({text:i.text.slice(l-s,c-s),marks:{...i.marks,comment:fp(i.marks?.comment,r)}}),c<a&&o.push({...i,text:i.text.slice(c-s)})),s=a}return he(o)}function xa(t,e,n=0,r=1/0){if(!t.some(i=>i.marks?.comment?.includes(e)))return t;let o=[],s=0;for(let i of t){let a=s+i.text.length,l=Math.max(n,s),c=Math.min(r,a);if(l>=c||!i.marks?.comment?.includes(e))o.push(i);else{let{comment:d,...u}=i.marks,f=d.filter(p=>p!==e);l>s&&o.push({...i,text:i.text.slice(0,l-s)}),o.push({text:i.text.slice(l-s,c-s),marks:f.length>0?{...u,comment:f}:u}),c<a&&o.push({...i,text:i.text.slice(c-s)})}s=a}return he(o)}function va(t,e=new Set){let n=r=>{if(_(r))for(let o of r.runs)for(let s of o.marks?.comment??[])e.add(s);else if(r.type==="table")for(let o of r.rows)for(let s of o.cells)s.blocks.forEach(n)};return t.forEach(n),e}function Tn(t,e){let n=[];for(let r of Ze(t).list){if(!_(r))continue;let o=0,s=null;for(let i of r.runs){let a=o+i.text.length;i.marks?.comment?.includes(e)?s?s.to=a:s={block:r.id,from:o,to:a}:s&&(n.push(s),s=null),o=a}s&&n.push(s)}return n}function Ca(t,e){if(!e)return[];let n=new Set,r=Se(e);for(let{block:o,from:s,to:i}of Ye(t,e)){if(!_(o))continue;let a=0;for(let l of o.runs){let c=a+l.text.length;if(r?s>a&&s<=c:s<c&&i>a)for(let u of l.marks?.comment??[])n.add(u);a=c}}return[...n]}function Pa(t,e){let n=Ye(t,e).find(o=>_(o.block)&&o.to>o.from);if(!n)return null;let r=H(n.block.runs).slice(n.from,n.to);return{block:n.block.id,from:n.from,to:n.to,quote:r.slice(0,dp)}}function Ac(t,e,n){let r=[];for(let{block:o,from:s,to:i}of Ye(t,e))!_(o)||i<=s||r.push({type:"comment_text",block:o.id,from:s,to:i,id:n,on:!0});return r}function Tc(t,e){return Tn(t,e).map(({block:n,from:r,to:o})=>({type:"comment_text",block:n,from:r,to:o,id:e,on:!1}))}function Ba(t,e){let n=e.anchor;if(!n||n.quote==="")return[];let r=Ze(t).list.find(i=>i.id===n.block);if(!r||!_(r))return[];let o=H(r.runs),s=n.from;return o.slice(s,s+n.quote.length)!==n.quote&&(s=o.indexOf(n.quote),s<0)?[]:[{type:"comment_text",block:r.id,from:s,to:s+n.quote.length,id:e.id,on:!0}]}function Ma(t){let e=r=>he(r.map(o=>{if(!o.marks?.comment)return o;let{comment:s,...i}=o.marks;return{text:o.text,marks:i}})),n=r=>{if(_(r)&&q(r.runs)>0){let o=r.runs;return o.some(s=>s.marks?.comment)?{...r,runs:e(o)}:r}return r.type==="table"?{...r,rows:r.rows.map(o=>({...o,cells:o.cells.map(s=>({...s,blocks:s.blocks.map(n)}))}))}:r};return t.map(n)}function Oa(t){return ma({threads:()=>Object.values(t.state.comments??{}),write:(e,n)=>t.write([{type:"set_thread",id:e,thread:n}])})}function ts(t,e){let n=X(t,e);if(!n)throw new C("not_found",`No block with id "${e}"`);return n}function ro(t,e){let{block:n}=ts(t,e);if(!_(n))throw new C("invalid_operation",`Block "${e}" (${n.type}) has no text`);return n}function oo(t,e){let n=no(t.blocks,e.id,(r,o)=>(r[o]=e,r));return{...t,blocks:n}}function pp(t){let e=t.list[t.index-1];return e?{after:e.id}:t.cell?{after:null,cell:t.cell.cell.id}:{after:null}}var Rn={apply(t,e){switch(e.type){case"insert_block":{let n=de([e.block]),r=de(t.blocks);for(let a of n)if(r.has(a))throw new C("invalid_operation",`Block id "${a}" already exists`);let o,s=a=>a.length===1&&a[0].id.endsWith("~empty")&&_(a[0])&&q(a[0].runs)===0;if(e.after!==null)ts(t,e.after),o=no(t.blocks,e.after,(a,l)=>(s(a)?a.splice(0,1,e.block):a.splice(l+1,0,e.block),a));else if(e.cell!==void 0){if(!Qo(t,e.cell))throw new C("not_found",`No table cell with id "${e.cell}"`);o=Pc(t.blocks,e.cell,a=>(s(a)?a.splice(0,1,e.block):a.unshift(e.block),a))}else o=[e.block,...t.blocks];let i=[...de([e.block])].filter(a=>a!==e.block.id);return{state:{...t,blocks:o},inverse:{type:"delete_block",id:e.block.id,after:e.after,...e.cell!==void 0&&{cell:e.cell},...i.length>0&&{within:i}}}}case"delete_block":{let n=ts(t,e.id),r=!!n.cell&&n.list.length===1,o=no(t.blocks,e.id,(s,i)=>(r?s[i]={id:`${n.cell.cell.id}~empty`,type:"paragraph",runs:[]}:s.splice(i,1),s));return{state:{...t,blocks:o},inverse:{type:"insert_block",block:n.block,...pp(n)}}}case"replace_block":{let n=ts(t,e.id);if(e.block.id!==e.id)throw new C("invalid_operation","replace_block must keep the block id");let r=no(t.blocks,e.id,(o,s)=>(o[s]=e.block,o));return{state:{...t,blocks:r},inverse:{type:"replace_block",id:e.id,block:n.block}}}case"update_block":{let r=ts(t,e.id).block,o={...r},s={};for(let[l,c]of Object.entries(e.patch)){if(l==="id"||l==="runs")throw new C("invalid_operation",`update_block can't change "${l}"`);s[l]=r[l]===void 0?null:r[l],c==null?delete o[l]:o[l]=c}let i=no(t.blocks,e.id,(l,c)=>(l[c]=o,l)),a=Array.isArray(e.patch.rows)?[...de([o])].filter(l=>l!==e.id):[];return{state:{...t,blocks:i},inverse:{type:"update_block",id:e.id,patch:s,...a.length>0?{within:a}:{}}}}case"insert_text":{let n=ro(t,e.block),r=fc(n.runs,e.offset,e.runs);return{state:oo(t,{...n,runs:r}),inverse:{type:"delete_text",block:e.block,from:e.offset,to:e.offset+e.runs.reduce((o,s)=>o+s.text.length,0)}}}case"delete_text":{let n=ro(t,e.block),r=me(n.runs,e.from,e.to),o=pc(n.runs,e.from,e.to);return{state:oo(t,{...n,runs:o}),inverse:{type:"insert_text",block:e.block,offset:e.from,runs:r}}}case"format_text":{let n=ro(t,e.block),r=mc(n.runs,e.from,e.to,e.patch);return{state:oo(t,{...n,runs:r}),inverse:{type:"restore_marks",block:e.block,from:e.from,to:e.to,segments:Yo(n.runs,e.from,e.to)}}}case"restore_marks":{let n=ro(t,e.block),r=gc(n.runs,e.from,e.to,e.segments);return{state:oo(t,{...n,runs:r}),inverse:{type:"restore_marks",block:e.block,from:e.from,to:e.to,segments:Yo(n.runs,e.from,e.to)}}}case"set_runs":{let n=ro(t,e.block);return{state:oo(t,{...n,runs:he(e.runs)}),inverse:{type:"set_runs",block:e.block,runs:n.runs}}}case"set_title":return{state:{...t,title:e.title},inverse:{type:"set_title",title:t.title}};case"set_page":{let{page:n,...r}=t;return{state:e.page?{...r,page:e.page}:r,inverse:{type:"set_page",page:n??null}}}case"set_footnote":{let n=t.footnotes?.[e.id]??null,{[e.id]:r,...o}=t.footnotes??{},s=e.blocks?{...o,[e.id]:e.blocks}:o,{footnotes:i,...a}=t;return{state:Object.keys(s).length>0?{...a,footnotes:s}:a,inverse:{type:"set_footnote",id:e.id,blocks:n}}}case"comment_text":{let n=ro(t,e.block);dr(n.runs,e.from,e.to);let r=e.on?Sa(n.runs,e.from,e.to,e.id):xa(n.runs,e.id,e.from,e.to);return{state:oo(t,{...n,runs:r}),inverse:{...e,on:!e.on}}}case"set_thread":{let n=t.comments?.[e.id]??null,{[e.id]:r,...o}=t.comments??{},s=e.thread?{...o,[e.id]:e.thread}:o,{comments:i,...a}=t;return{state:Object.keys(s).length>0?{...a,comments:s}:a,inverse:{type:"set_thread",id:e.id,thread:n}}}case"set_style":{let n=t.styles?.[e.id]??null,{[e.id]:r,...o}=t.styles??{},s=e.style?{...o,[e.id]:e.style}:o,{styles:i,...a}=t;return{state:Object.keys(s).length>0?{...a,styles:s}:a,inverse:{type:"set_style",id:e.id,style:n}}}case"set_region":{let n=t[e.region]??null,{[e.region]:r,...o}=t;return{state:e.blocks?{...o,[e.region]:e.blocks}:o,inverse:{type:"set_region",region:e.region,blocks:n}}}}}};function Dn(t,e){let n=t;for(let r of e)n=Rn.apply(n,r).state;return n}function Oe(t,e){let n=X(t,e);if(!n)throw new C("not_found",`No block with id "${e}"`);return n}function tn(t,e){return Oe(t,e).block}function ct(t=D("b_")){return{id:t,type:"paragraph",runs:[]}}function nn(t){if(t.type!=="table")return{block:t.id,offset:0};let e=t.rows[0]?.cells[0]?.blocks[0];return e?{block:e.id,offset:0}:null}function ni(t){if(t.type!=="table")return{block:t.id,offset:Pt(t)};let e=t.rows[t.rows.length-1]?.cells,n=e?.[e.length-1]?.blocks.at(-1);return n?{block:n.id,offset:Pt(n)}:null}function ns(t,e,n){let r=e.slice(),o=new Set;for(let u of r)u.type==="delete_block"&&o.add(u.id);let s=t.blocks.filter(u=>u.type==="table"&&o.has(u.id)),i=new Set;for(let u of s)de([u],i);let a=new Set;for(let u of t.blocks)if(!(u.type!=="table"||o.has(u.id)))for(let f of u.rows)for(let p of f.cells){if(p.covered||!p.blocks.every(y=>o.has(y.id)))continue;let m=p.blocks[p.blocks.length-1],g=r.findIndex(y=>y.type==="delete_block"&&y.id===m.id);g>=0&&r.splice(g,1),r.push({type:"replace_block",id:m.id,block:ct(m.id)}),o.delete(m.id),a.add(m.id)}let l=n,c=u=>o.has(u)||i.has(u);if(t.blocks.filter(u=>o.has(u.id)).length>=t.blocks.length){let u=ct();return r.push({type:"insert_block",block:u,after:null}),{ops:r,selection:j(u.id,0)}}if(c(l.anchor.block)||c(l.focus.block)){let{list:u,index:f}=Ze(t),p=f.get(l.focus.block)??0,m=y=>y.type!=="table"&&!c(y.id),g=u.slice(p).find(m)??[...u.slice(0,p)].reverse().find(m);l=g?j(g.id,0):l}return{ops:r,selection:l}}var ri=["bold","italic","underline","strike","superscript","subscript","color","highlight","fontFamily","fontSize"],mp=16;function so(t,e){if(e===void 0)return null;let n=t.styles,r=n?.[e];if(!n||!r)return null;let o=[],s=new Set;for(let a=e;a!==void 0&&o.length<mp;){let l=n[a];if(!l||s.has(a)||l.kind!==r.kind)break;s.add(a),o.push(l),a=l.basedOn}let i={marks:{}};for(let a of o.reverse())i.marks={...i.marks,...a.marks},a.align&&(i.align=a.align),a.format&&(i.format={...i.format,...a.format});return i}function Aa(t){return Ae(t)?t.style:void 0}function oi(t,e,n){if(!t.styles)return e??{};let r=so(t,n),o=so(t,e?.style);return!r&&!o?e??{}:{...r?.marks,...o?.marks,...e}}function Gt(t,e){if(!t.styles||!Ae(e)||!e.style)return e;let n=so(t,e.style);if(!n||!n.align&&!n.format)return e;let r=e,o=n.format||r.format?{...n.format,...r.format}:void 0,s=r.align??n.align;return{...e,...s&&{align:s},...o&&{format:o}}}function Rc(t,e){let n=e.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,"")||"style",r=n;for(let o=2;t.styles?.[r];o++)r=`${n}-${o}`;return r}function si(t){let e=new Set,n=r=>{for(let o of r)if(o.type==="table"&&o.rows.forEach(s=>s.cells.forEach(i=>n(i.blocks))),"runs"in o){"style"in o&&o.style&&e.add(o.style);for(let s of o.runs)s.marks?.style&&e.add(s.marks.style)}};return n(t),e}function hp(){return{id:D("c_"),blocks:[ct()]}}function gp(t){return{id:D("r_"),cells:Array.from({length:t},hp)}}function Ta(t,e,n={}){let r=Math.max(1,Math.floor(t)),o=Math.max(1,Math.floor(e));return{id:D("b_"),type:"table",rows:Array.from({length:r},()=>gp(o)),columns:lt(Array.from({length:o},()=>1)),...n.headerRow&&{headerRow:!0},...n.borders&&{borders:n.borders}}}function kt(t,e){let n=bt(t,e);if(n){let{row1:o,row2:s,col1:i,col2:a}=n;return{table:n.table,row:o,col:i,rect:{row1:o,row2:s,col1:i,col2:a}}}let r=Oe(t,e.focus.block);if(r.cell){let{table:o,row:s,col:i,cell:a}=r.cell;return{table:o,row:s,col:i,rect:en(a,s,i)}}if(r.block.type==="table"){let o=r.block;return{table:o,row:null,col:null,rect:{row1:0,row2:o.rows.length-1,col1:0,col2:o.columns.length-1}}}return null}function io(t,e,n){return{ops:[{type:"replace_block",id:t.id,block:e}],selection:j(n.block,n.offset)}}function mr(t,e,n){let r=Math.min(Math.max(e,0),t.rows.length-1),o=Math.min(Math.max(n,0),t.columns.length-1);return{block:eo(t,r,o).cell.blocks[0].id,offset:0}}function Ra(t,e){return(n,r)=>{let o=kt(n,r);if(!o)return null;let{table:s,rect:i}=o,a=t==="above"?o.row===null?0:i.row1:o.row===null?s.rows.length:i.row2+1,l=Qs(s,a);return io(s,l,mr(l,a,e??o.col??0))}}function Dc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let{table:o,rect:s}=r,i=t==="left"?r.col===null?0:s.col1:r.col===null?o.columns.length:s.col2+1,a=ei(o,i);return io(o,a,mr(a,r.row??0,i))}}function Fc(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let{table:r,rect:o}=n;if(o.row1===0&&o.row2===r.rows.length-1)return ii()(t,e);let s=Sc(r,o.row1,o.row2);return io(r,s,mr(s,o.row1,n.col??0))}}function Ec(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let{table:r,rect:o}=n;if(o.col1===0&&o.col2===r.columns.length-1)return ii()(t,e);let s=xc(r,o.col1,o.col2);return io(r,s,mr(s,n.row??0,o.col1))}}function ii(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let{table:r}=n,o=t.blocks.findIndex(l=>l.id===r.id),s=t.blocks[o-1],i=t.blocks[o+1],a=s&&ni(s)||i&&nn(i)||null;return ns(t,[{type:"delete_block",id:r.id}],a?j(a.block,a.offset):j(r.id,0))}}function $c(){return(t,e)=>{let n=bt(t,e);if(!n)return null;let r=vc(n.table,n);return r?io(n.table,r,mr(r,n.row1,n.col1)):null}}function Nc(){return(t,e)=>{let n=kt(t,e);if(!n)return null;let r=null;for(let{row:o,col:s}of fr(n.table,n.rect))r=Cc(r??n.table,o,s)??r;return r?io(n.table,r,mr(r,n.rect.row1,n.rect.col1)):null}}function _c(t){return(e,n)=>{let r=kt(e,n);if(!r||!!r.table.headerRow===t)return null;let{headerRow:o,...s}=r.table,i=t?{...s,headerRow:!0}:s;return{ops:[{type:"replace_block",id:r.table.id,block:i}],selection:n}}}function Ic(t){return(e,n)=>{let r=kt(e,n);if(!r||(r.table.borders??"all")===t)return null;let{borders:o,...s}=r.table,i=t==="all"?s:{...s,borders:t};return{ops:[{type:"replace_block",id:r.table.id,block:i}],selection:n}}}function Lc(t,e,n){let r=t.rows.map((o,s)=>({...o,cells:o.cells.map((i,a)=>s>=e.row1&&s<=e.row2&&a>=e.col1&&a<=e.col2&&!i.covered?n(i):i)}));return{...t,rows:r}}function Uc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let o=Lc(r.table,r.rect,s=>{let{shade:i,...a}=s;return t?{...a,shade:t}:a});return{ops:[{type:"replace_block",id:r.table.id,block:o}],selection:n}}}function jc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let o=Lc(r.table,r.rect,s=>{let{vAlign:i,...a}=s;return t==="top"?a:{...a,vAlign:t}});return{ops:[{type:"replace_block",id:r.table.id,block:o}],selection:n}}}function zc(t){return(e,n)=>{let r=kt(e,n);if(!r)return null;let o=t===null?null:Math.min(2e3,Math.max(6,t)),s=r.table.rows.map((i,a)=>{if(a<r.rect.row1||a>r.rect.row2)return i;let{height:l,...c}=i;return o===null?c:{...c,height:o}});return{ops:[{type:"replace_block",id:r.table.id,block:{...r.table,rows:s}}],selection:n}}}function Gc(t){return(e,n)=>{let r=kt(e,n);if(!r||t.length!==r.table.columns.length)return null;let o=lt(t);return{ops:[{type:"replace_block",id:r.table.id,block:{...r.table,columns:o}}],selection:n}}}function Hc(t,e,n){let r=Oe(t,e.focus.block);if(!r.cell)return null;let{table:o,row:s,col:i}=r.cell,a=o.columns.length,l=o.rows.length*a;for(let c=s*a+i+n;c>=0&&c<l;c+=n){let d=Math.floor(c/a),u=c%a;if(!o.rows[d].cells[u].covered)return{to:mr(o,d,u)}}return n>0?{appendRow:!0}:null}var Fn="\u200B",rs=t=>t.marks?.footnote;function Qe(t){let e=new Set,n=r=>{if(_(r))for(let o of r.runs){let s=rs(o);s!==void 0&&e.add(s)}else if(r.type==="table")for(let o of r.rows)for(let s of o.cells)s.blocks.forEach(n)};return t.forEach(n),[...e]}function yp(t){return new Map(Qe(t.blocks).map((e,n)=>[e,n+1]))}function Kc(t){if(!t.footnotes)return t;let e=new Set(Qe(t.blocks)),n=Object.keys(t.footnotes).filter(s=>e.has(s));if(n.length===Object.keys(t.footnotes).length)return t;let{footnotes:r,...o}=t;return n.length>0?{...o,footnotes:Object.fromEntries(n.map(s=>[s,t.footnotes[s]]))}:o}function Wc(t){let e=[];for(let n of t)n.type==="heading"||n.type==="title"||n.type==="subtitle"?e.push({id:n.id,type:"paragraph",runs:n.runs.filter(r=>!rs(r)),...n.align&&{align:n.align}}):_(n)&&e.push({...n,runs:n.runs.filter(r=>!rs(r))});return e.length>0?e:[{id:D("b_"),type:"paragraph",runs:[]}]}function qc(t){return t.type==="paragraph"||t.type==="quote"||t.type==="list_item"||t.type==="code_block"}function Xc(t,e){let n=new Map,r=a=>{let l=rs(a);return l===void 0?a:(n.has(l)||n.set(l,D("fn_")),{...a,marks:{...a.marks,footnote:n.get(l)}})},o=a=>_(a)?{...a,runs:a.runs.map(r)}:a.type==="table"?{...a,rows:a.rows.map(l=>({...l,cells:l.cells.map(c=>({...c,blocks:c.blocks.map(o)}))}))}:a,s=t.map(o),i={};for(let[a,l]of n){let c=e?.[a];i[l]=(c??[{id:D("b_"),type:"paragraph",runs:[]}]).map(d=>({...d,id:D("b_")}))}return{blocks:s,notes:i}}var Da="\0self";function ai(t){let e=yp(t);if(e.size===0)return t;let n=o=>{let s=rs(o);return s!==void 0&&e.has(s)?{...o,text:String(e.get(s))}:o},r=o=>_(o)?{...o,runs:o.runs.map(n)}:o.type==="table"?{...o,rows:o.rows.map(s=>({...s,cells:s.cells.map(i=>({...i,blocks:i.blocks.map(r)}))}))}:o;return{...t,blocks:t.blocks.map(r)}}var En={letter:{width:8.5,height:11,label:"Letter (8.5 \xD7 11 in)"},a4:{width:8.27,height:11.69,label:"A4 (210 \xD7 297 mm)"},legal:{width:8.5,height:14,label:"Legal (8.5 \xD7 14 in)"},a5:{width:5.83,height:8.27,label:"A5 (148 \xD7 210 mm)"}},Fa={size:"letter",orientation:"portrait",margins:{top:1,right:1,bottom:1,left:1}},Ea=96;function Ht(t){return t.page??Fa}function hr(t){let{width:e,height:n}=En[t.size];return t.orientation==="landscape"?{width:n,height:e}:{width:e,height:n}}var Vc=36,bp=4;function gr(t){return{count:Math.min(bp,Math.max(1,Math.round(t?.count??1))),gap:t?.gap??Vc,rule:!!t?.rule}}function Bt(t){let e=[],n={from:0,to:t.blocks.length,columns:gr(t.page?.columns)};return t.blocks.forEach((r,o)=>{r.type==="section_break"&&(n.to=o,e.push(n),n={from:o+1,to:t.blocks.length,columns:gr(r.columns),start:r})}),e.push(n),e}function $a(t,e){let n=Bt(t);for(let r=n.length-1;r>=0;r--){let o=n[r],s=o.start?o.from-1:0;if(e>=s)return o}return n[0]}function Jc(t,e){let n=Bt(t);for(let r=n.length-1;r>=0;r--)if(e>=(n[r].start?n[r].from-1:0))return r;return 0}function ao(t,e){return $a(t,e).columns}function os(t){if(!(t.count<2))return{count:t.count,...t.gap!==Vc&&{gap:t.gap},...t.rule&&{rule:!0}}}function Na(t,e,n){return n===0?!!t.page?.differentFirstPage:!!e[n]?.start?.differentFirstPage}function Kt(t,e,n){let r=Ht(t),o={size:r.size,orientation:r.orientation,margins:r.margins};for(let s=1;s<=Math.min(n,e.length-1);s++){let i=e[s].start?.page;i&&(o={size:i.size??o.size,orientation:i.orientation??o.orientation,margins:i.margins??o.margins})}return o}function ss(t,e){return t.size===e.size&&t.orientation===e.orientation&&["top","right","bottom","left"].every(n=>t.margins[n]===e.margins[n])}function Zc(t,e,n){return n===0?!1:e[n].start?.kind==="next_page"||!ss(Kt(t,e,n),Kt(t,e,n-1))}function _a(t,e,n={}){return{id:D("b_"),type:"image",src:t,...e,...n}}function is(t="continuous",e){return{id:D("b_"),type:"section_break",kind:t,...e&&e.count>1&&{columns:e}}}function Ia(){return{id:D("b_"),type:"page_break"}}function La(){return{id:D("b_"),type:"divider"}}function li(t,e=[]){return{id:D("doc_"),type:"document",title:t,blocks:e}}var $n=["decimal","lower-alpha","upper-alpha","lower-roman","upper-roman"],rn=["disc","circle","square"];var kp={disc:"\u2022",circle:"\u25E6",square:"\u25AA"};function He(t,e){let n=e%3;return t==="bullet"?rn[n]:["decimal","lower-alpha","lower-roman"][n]}function Nn(t){let e=t.list==="bullet"?rn:$n;return t.marker&&e.includes(t.marker)?t.marker:He(t.list,t.depth)}function Yc(t){let e="";for(let n=t;n>0;n=Math.floor((n-1)/26))e=String.fromCharCode(97+(n-1)%26)+e;return e}function Qc(t){let e=[[1e3,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]],n="";for(let[r,o]of e)for(;t>=r;)n+=o,t-=r;return n}function tu(t,e){if(t<1)return String(t);switch(e){case"lower-alpha":return Yc(t);case"upper-alpha":return Yc(t).toUpperCase();case"lower-roman":return Qc(t);case"upper-roman":return Qc(t).toUpperCase();default:return String(t)}}function lo(t){let e=[];return t.map(n=>{if(n.type!=="list_item"){e.length=0;return}if(e.length=n.depth+1,n.list==="bullet"){e[n.depth]=0;return}return e[n.depth]=n.start??(e[n.depth]??0)+1})}function as(t){let e=lo(t);return t.map((n,r)=>{if(n.type!=="list_item")return;let o=Nn(n);if(n.list==="bullet")return{text:kp[o],marker:o};let s=e[r];return{text:`${tu(s,o)}.`,marker:o,number:s}})}function Ua(t,e){let n=t[e];if(!n||n.type!=="list_item")return[];let r=s=>!!s&&s.type==="list_item"&&s.depth===n.depth&&s.list===n.list,o=[e];for(let s=e-1;s>=0;s--){let i=t[s];if(i.type!=="list_item"||i.depth<n.depth)break;if(i.depth===n.depth){if(!r(i))break;o.unshift(s)}}for(let s=e+1;s<t.length;s++){let i=t[s];if(i.type!=="list_item"||i.depth<n.depth)break;if(i.depth===n.depth){if(!r(i))break;o.push(s)}}return o}var eu={i:1,v:5,x:10,l:50,c:100,d:500,m:1e3};function wp(t){let e=0;for(let n=0;n<t.length;n++){let r=eu[t[n]];e+=r<(eu[t[n+1]??""]??0)?-r:r}return e}function ci(t){let e=/^[\(\[]?([^.)\]]+)[.)\]]/.exec(t)?.[1];if(!e)return null;if(/^\d+$/.test(e))return{marker:"decimal",number:Number(e)};let n=e===e.toLowerCase();if(/^[ivxlcdm]+$/i.test(e)&&(e.length>1||/^[ivx]$/i.test(e)))return{marker:n?"lower-roman":"upper-roman",number:wp(e.toLowerCase())};if(/^[a-z]+$/i.test(e)){let o=[...e.toLowerCase()].reduce((s,i)=>s*26+i.charCodeAt(0)-96,0);return{marker:n?"lower-alpha":"upper-alpha",number:o}}return null}function ls(t){if(/^[o○◦]$/.test(t))return"circle";if(/^[§▪■\uf0a7]$/.test(t))return"square"}var ru=/(^#|#|%23)(heading(=|%3D)|h\.|_toc|__refheading|bookmark(=|%3D)|toc|_ref|id\.)/i,Sp=/^\s*(table of )?contents\s*$/i,xp=/^[\s .·•…_\-–—\d]*$/;function nu(t){if(t.type!=="paragraph"&&t.type!=="list_item")return!1;let e=t.runs.filter(o=>o.marks?.link&&ru.test(ou(o.marks.link)));if(e.length===0||e.map(o=>o.text).join("").trim()==="")return!1;let r=t.runs.filter(o=>!e.includes(o)).map(o=>o.text).join("");return xp.test(r)}function ou(t){try{return decodeURIComponent(t)}catch{return t}}function su(t){return vp(Cp(t))}function vp(t){let e=n=>n.map(r=>{let o=r.marks?.link;if(!o||!(o.startsWith("#")||ru.test(ou(o))))return r;let{link:s,...i}=r.marks;return Object.keys(i).length>0?{...r,marks:i}:{text:r.text}});return t.map(n=>n.type==="table"||!("runs"in n)||!n.runs.some(r=>r.marks?.link)?n:{...n,runs:he(e(n.runs))})}function Cp(t){let e=[];for(let n=0;n<t.length;n++){let r=t[n];if(!nu(r)){e.push(r);continue}let o=n;for(;o+1<t.length&&nu(t[o+1]);)o++;let s=t.slice(n,o+1),i=e[e.length-1],a=!!i&&(i.type==="paragraph"||i.type==="heading")&&Sp.test(H(i.runs));if(s.length<2&&!a){e.push(r);continue}let l=new Set(s.map(u=>("format"in u?u.format?.indentLeft??0:0)+("depth"in u?u.depth*36:0))),c=Math.min(6,Math.max(1,l.size)),d="";a&&(d=H(i.runs).trim(),e.pop()),e.push({id:D("b_"),type:"toc",levels:c,title:d}),n=o}return e}function ui(t){let e={},n=0,r="",o=0,s=i=>{let a=t.slice(o,i),l=a.indexOf(":");if(l>0){let c=a.slice(0,l).trim().toLowerCase(),d=a.slice(l+1).replace(/!important/gi,"").trim();c&&d&&(e[c]=d)}o=i+1};for(let i=0;i<t.length;i++){let a=t[i];r?a===r&&t[i-1]!=="\\"&&(r=""):a==='"'||a==="'"?r=a:a==="("?n++:a===")"?n=Math.max(0,n-1):a===";"&&n===0&&s(i)}return s(t.length),e}function au(t){let e=[],n=t.replace(/\/\*[\s\S]*?\*\//g,"").replace(/<!--|-->/g,""),r=/([^{}]+)\{([^{}]*)\}/g;for(let o=r.exec(n);o;o=r.exec(n)){let s=o[1].trim();if(s.startsWith("@"))continue;let i=ui(o[2]);for(let a of s.split(",")){let l=a.trim(),c=/^([a-zA-Z][a-zA-Z0-9]*)?((?:\.[\w-]+)*)(#[\w-]+)?$/.exec(l);if(!c||!l)continue;let d=c[2]?c[2].split(".").filter(Boolean):[];e.push({selector:{tag:c[1]?.toLowerCase(),classes:d,id:c[3]?.slice(1)},specificity:(c[3]?100:0)+d.length*10+(c[1]?1:0),declarations:i})}}return e}function lu(t,e,n,r){let{selector:o}=t;return o.tag&&o.tag!==e||o.id&&o.id!==r?!1:o.classes.every(s=>n.includes(s))}var iu={black:"#000000",white:"#ffffff",red:"#ff0000",green:"#008000",blue:"#0000ff",yellow:"#ffff00",orange:"#ffa500",purple:"#800080",gray:"#808080",grey:"#808080",silver:"#c0c0c0",maroon:"#800000",navy:"#000080",teal:"#008080",olive:"#808000",lime:"#00ff00",aqua:"#00ffff",cyan:"#00ffff",fuchsia:"#ff00ff",magenta:"#ff00ff",brown:"#a52a2a",pink:"#ffc0cb",gold:"#ffd700",coral:"#ff7f50",crimson:"#dc143c",indigo:"#4b0082",violet:"#ee82ee",turquoise:"#40e0d0",tan:"#d2b48c"},ja=t=>Math.max(0,Math.min(255,Math.round(t))).toString(16).padStart(2,"0");function co(t){if(!t)return null;let e=t.trim().toLowerCase();if(e in iu)return iu[e];let n=/^#([0-9a-f]{3})$/.exec(e);if(n)return`#${[...n[1]].map(r=>r+r).join("")}`;if(n=/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(e),n)return`#${n[1]}`;if(n=/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(e),n){let r=s=>s.endsWith("%")?parseFloat(s)/100*255:parseFloat(s);return(n[4]===void 0?1:n[4].endsWith("%")?parseFloat(n[4])/100:parseFloat(n[4]))===0?null:`#${ja(r(n[1]))}${ja(r(n[2]))}${ja(r(n[3]))}`}return null}var Pp={pt:1,px:.75,in:72,cm:28.3465,mm:2.83465,pc:12,q:.7087};function uo(t){if(!t)return null;let e=/^([\d.]+)\s*(pt|px|in|cm|mm|pc|q)$/.exec(t.trim().toLowerCase());if(!e)return null;let n=parseFloat(e[1])*Pp[e[2]];return Number.isFinite(n)?n:null}var Bp={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",ensp:"\u2002",emsp:"\u2003",thinsp:"\u2009",copy:"\xA9",reg:"\xAE",trade:"\u2122",hellip:"\u2026",mdash:"\u2014",ndash:"\u2013",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",sbquo:"\u201A",bdquo:"\u201E",laquo:"\xAB",raquo:"\xBB",bull:"\u2022",middot:"\xB7",deg:"\xB0",plusmn:"\xB1",times:"\xD7",divide:"\xF7",frac12:"\xBD",frac14:"\xBC",frac34:"\xBE",euro:"\u20AC",pound:"\xA3",yen:"\xA5",cent:"\xA2",sect:"\xA7",para:"\xB6",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193",harr:"\u2194",le:"\u2264",ge:"\u2265",ne:"\u2260",asymp:"\u2248",infin:"\u221E",check:"\u2713",eacute:"\xE9",egrave:"\xE8",agrave:"\xE0",aacute:"\xE1",uuml:"\xFC",ouml:"\xF6",auml:"\xE4",ntilde:"\xF1",ccedil:"\xE7",szlig:"\xDF",iexcl:"\xA1",iquest:"\xBF"};function fo(t){return t.includes("&")?t.replace(/&(?:#(\d{1,10})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,8}));?/g,(e,n,r,o)=>{if(n!==void 0||r!==void 0){let i=n!==void 0?Number(n):parseInt(r,16);return i>1114111||i>=55296&&i<=57343||i<32&&i!==9&&i!==10&&i!==13||i===0?"\uFFFD":String.fromCodePoint(i)}let s=Bp[o];return s===void 0?e:e.endsWith(";")||["amp","lt","gt","quot","nbsp","copy","reg"].includes(o)?s:e}):t}var Mp=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]),Op=new Set(["script","style","textarea","title","xmp"]),uu=new Set(["address","article","aside","blockquote","details","dialog","div","dl","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hgroup","hr","main","menu","nav","ol","p","pre","section","table","ul"]),Ap=uu,Tp=256,cu=4e5;function Rp(t){let e={},n=/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;for(let r=n.exec(t);r;r=n.exec(t)){let o=r[1].toLowerCase();o in e||(e[o]=fo(r[2]??r[3]??r[4]??""))}return e}function du(t){let e={kind:"el",tag:"#root",attrs:{},children:[]},n=[e],r=0,o=0,s=t.length,i=()=>n[n.length-1],a=u=>{if(u===""||r>cu)return;let f=i(),p=f.children[f.children.length-1];p?.kind==="text"?p.text+=u:f.children.push({kind:"text",text:u}),r++},l=u=>{for(let f=n.length-1;f>0;f--)if(n[f].tag===u){n.length=f;return}},c=(u,f)=>{for(let p=n.length-1;p>0;p--){if(n[p].tag===u)return!0;if(f.includes(n[p].tag))return!1}return!1},d=u=>{if(Ap.has(u)&&c("p",["div","td","th","li","blockquote","table","body"])&&l("p"),u==="li"&&c("li",["ul","ol"])&&l("li"),(u==="td"||u==="th")&&(c("td",["tr","table"])||c("th",["tr","table"]))&&l(c("td",["tr","table"])?"td":"th"),u==="tr"&&((c("td",["table"])||c("th",["table"]))&&l(c("td",["tr","table"])?"td":"th"),c("tr",["table"])&&l("tr")),["thead","tbody","tfoot"].includes(u)){for(let f of["thead","tbody","tfoot"])c(f,["table"])&&l(f);c("tr",["table"])&&l("tr")}(u==="dt"||u==="dd")&&(c("dt",["dl"])||c("dd",["dl"]))&&l(c("dd",["dl"])?"dd":"dt")};for(;o<s;){let u=t.indexOf("<",o);if(u<0){a(fo(t.slice(o)));break}if(u>o&&a(fo(t.slice(o,u))),o=u,t.startsWith("<!--",o)){let R=t.indexOf("-->",o+4);o=R<0?s:R+3;continue}if(t[o+1]==="!"||t[o+1]==="?"){let R=t.indexOf(">",o+2);o=R<0?s:R+1;continue}let f=t[o+1]==="/",p=o+(f?2:1),m=/^[a-zA-Z][^\s/>]*/.exec(t.slice(p,p+64));if(!m){a("<"),o++;continue}let g=m[0].toLowerCase(),y=t.indexOf(">",p+m[0].length);if(y<0){a(fo(t.slice(o)));break}if(f){l(g),o=y+1;continue}let b=y,k=p+m[0].length,T="";for(let R=k;R<s;R++){let N=t[R];if(T)N===T&&(T="");else if(N==='"'||N==="'")T=N;else if(N===">"){b=R;break}}let I=t.slice(k,b),O=I.trimEnd().endsWith("/");o=b+1,d(g);let F={kind:"el",tag:g,attrs:Rp(I),children:[]};if(!(r++>cu)){if(i().children.push(F),Op.has(g)){let R=t.toLowerCase().indexOf(`</${g}`,o),N=R<0?t.slice(o):t.slice(o,R);N&&F.children.push({kind:"text",text:g==="textarea"||g==="title"?fo(N):N});let P=R<0?-1:t.indexOf(">",R);o=P<0?s:P+1;continue}Mp.has(g)||O||n.length<Tp&&n.push(F)}}return e}function fu(t){return uu.has(t)}function cs(t){return t.kind==="text"?t.text:t.tag==="br"?`
`:t.children.map(cs).join("")}var pu=2e4,Dp=500,mu=40,Fp=40,ku=new Set(["head","script","style","title","meta","link","noscript","template","iframe","object","embed","svg","canvas","video","audio","select","button","input","textarea","map","math","base","datalist","dialog"]),Ep={1:20,2:16,3:14,4:12,5:11,6:11},$p=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-sans-serif","ui-serif","ui-monospace","ui-rounded","inherit","initial","unset","-apple-system","blinkmacsystemfont","emoji","math","fangsong"]),Np=[0,7.5,10,12,13.5,18,24,36],_p=t=>{let e=t?.trim();return e&&(/^(https?:|mailto:|tel:)/i.test(e)||/^#.+/.test(e))&&e.length<=2048?e:void 0},Ip=t=>{let e=t?.trim();if(e){if(/^https?:\/\//i.test(e)&&e.length<=4096)return e;if(/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(e)&&e.length<=8e6)return e.replace(/\s+/g,"")}};function ds(t){let e=n=>{let r=parseInt(t.slice(1+n*2,3+n*2),16)/255;return r<=.03928?r/12.92:((r+.055)/1.055)**2.4};return .2126*e(0)+.7152*e(1)+.0722*e(2)}function wu(t){let e=co(t["background-color"]);if(e)return e;let n=t.background?.trim().split(/\s+(?![^()]*\))/)[0];return n?co(n):null}function Lp(t){if(!t)return;let e=t.trim().toLowerCase();if(e==="bold"||e==="bolder")return!0;if(e==="normal"||e==="lighter")return!1;let n=parseInt(e,10);return Number.isFinite(n)?n>=600:void 0}function Su(t){let e=t?.trim().toLowerCase();if(e==="center"||e==="right"||e==="justify")return e}function Ga(t){if(t)for(let e of t.replace(/!\s*important/gi,"").split(",")){let n=e.trim().replace(/^["']|["']$/g,"").replace(/[^\p{L}\p{N} _-]/gu,"").replace(/\s+/g," ").trim();if(n&&!$p.has(n.toLowerCase())){let r=jt(n);return(r&&r.family.toLowerCase()===n.toLowerCase()?r.family:n).slice(0,64)}}}function Up(t){let e=t&&/(?:^|\s)(?:\d*\.?\d+(?:px|pt|em|rem|%|ex|ch|cm|mm|in|pc|vw|vh)|(?:xx?-)?(?:small|large)|xxx-large|medium|smaller|larger)(?:\/\S+)?\s+(.+)$/i.exec(t.trim());return e?Ga(e[1]):void 0}var jp=(t,e)=>"hidden"in e.attrs||t.display?.trim().toLowerCase()==="none"||t.visibility?.trim().toLowerCase()==="hidden"||t["mso-hide"]?.trim().toLowerCase()==="all",fs=class{constructor(e,n,r=!1,o=!1){this.rules=e;this.options=n;this.inCell=r;this.inline=o;ue(this,"blocks",[]);ue(this,"unsized",[]);ue(this,"buffer",null);ue(this,"kinds",[{type:"paragraph"}]);ue(this,"lists",[]);ue(this,"marker",null);ue(this,"floats",[]);ue(this,"anchored",[])}declarations(e){let n=(e.attrs.class??"").split(/\s+/).filter(Boolean),r=this.rules.filter(s=>lu(s,e.tag,n,e.attrs.id)).sort((s,i)=>s.specificity-i.specificity),o={};for(let s of r)Object.assign(o,s.declarations);return e.attrs.style&&Object.assign(o,ui(e.attrs.style)),o}styleFor(e,n,r){let o={...n.marks},s=n.link,i=n.align,a=n.white;switch(e.tag){case"b":case"strong":o.bold=!0;break;case"i":case"em":case"cite":case"dfn":case"var":o.italic=!0;break;case"u":case"ins":o.underline=!0;break;case"s":case"strike":case"del":o.strike=!0;break;case"code":case"kbd":case"samp":case"tt":o.code=!0;break;case"sup":o.superscript=!0,o.subscript=null;break;case"sub":o.subscript=!0,o.superscript=null;break;case"mark":o.highlight="#ffff00";break;case"a":s=_p(e.attrs.href)??s;break;case"center":i="center";break;case"font":{let I=Ga(e.attrs.face);I&&(o.fontFamily=I);let O=co(e.attrs.color);O&&(o.color=O);let F=Np[Number(e.attrs.size)];F&&(o.fontSize=F);break}}let l=Lp(r["font-weight"]);l!==void 0&&(o.bold=l?!0:null);let c=r["font-style"]?.trim().toLowerCase();c&&(o.italic=c==="italic"||c==="oblique"?!0:c==="normal"?null:o.italic);let d=(r["text-decoration-line"]??r["text-decoration"]??"").toLowerCase();d&&e.tag!=="a"&&(o.underline=d.includes("underline")?!0:d.includes("none")?null:o.underline,o.strike=d.includes("line-through")?!0:d.includes("none")?null:o.strike);let u=co(r.color);u?o.color=ds(u)>.75||u==="#000000"?null:u:r.color&&/^(inherit|initial|unset|windowtext|currentcolor)$/i.test(r.color.trim())&&(o.color=null);let f=wu(r);f&&(o.highlight=ds(f)>.9||ds(f)<.1?null:f);let p=Ga(r["font-family"])??Up(r.font);p&&(o.fontFamily=p);let m=uo(r["font-size"]);m&&m>0&&m<=400&&(o.fontSize=Math.round(m*2)/2);let g=r["vertical-align"]?.trim().toLowerCase();g==="super"?(o.superscript=!0,o.subscript=null):g==="sub"?(o.subscript=!0,o.superscript=null):g==="baseline"&&(o.superscript=null,o.subscript=null);let y=r["text-align"]??e.attrs.align;y&&(i=Su(y)??(/^(left|start)$/i.test(y.trim())?void 0:i));let b=r["white-space"]?.trim().toLowerCase();e.tag==="pre"||b==="pre"||b==="pre-wrap"||b==="break-spaces"?a="pre":b==="pre-line"?a="pre-line":(b==="normal"||b==="nowrap")&&(a="normal");let k=uo(r["margin-left"]??r["padding-left"]),T=k&&k>0&&k<=720&&!/^(blockquote|li|ul|ol|td|th)$/.test(e.tag)?(n.indent??0)+k:n.indent;return{marks:o,white:a,align:i,link:s,indent:T}}marksFor(e,n){let r={};for(let[o,s]of Object.entries(e.marks))s==null||s===!1||(r[o]=s);return e.link&&(r.link=e.link),r.fontSize===this.options.defaultFontSize&&delete r.fontSize,n!==null&&(delete r.bold,r.fontSize===Ep[n]&&delete r.fontSize),r.fontFamily&&r.fontFamily.toLowerCase()===this.options.defaultFontFamily.toLowerCase()&&delete r.fontFamily,Object.keys(r).length>0?r:void 0}get kind(){return this.kinds[this.kinds.length-1]}add(e){this.blocks.length<pu&&this.blocks.push(e)}addText(e,n){let r=e.replace(/\r\n?/g,`
`);n.white==="normal"?r=r.replace(/[ \t\n\f]+/g," "):n.white==="pre-line"&&(r=r.replace(/[ \t\f]+/g," "));let o=this.buffer;if(n.white!=="pre"&&!this.inline&&r.startsWith(" ")&&(!o||o.endsInSpace||o.runs.length===0)&&(r=r.slice(1)),r==="")return;let s=o??this.open(n),i=s.kind.type==="heading"?s.kind.level:null;s.runs.push({text:r.replace(/ /g," "),marks:this.marksFor(n,i)}),s.endsInSpace=n.white!=="pre"&&r.endsWith(" ")}open(e){return this.buffer={kind:this.kind,align:e.align,indent:e.indent,runs:[],endsInSpace:!this.inline},this.buffer}flush(e=!1){let n=this.buffer;this.buffer=null;for(let o of this.anchored.splice(0))this.add(o);if(!n&&!e)return!1;let r=n?he(this.inline?n.runs:zp(n.runs)):[];return r.length===0&&!e?!1:(this.add(gu(n?.kind??this.kind,r,n?.align,n?.indent)),!0)}block(e,n,r){this.flush();let o=this.blocks.length;this.buffer=null,n(),this.flush(),r&&this.blocks.length===o&&this.add(gu(this.kind,[],e.align,e.indent))}walk(e,n){if(!(this.blocks.length>=pu)&&e!==this.marker){if(e.kind==="text"){this.addText(e.text,n);return}this.element(e,n)}}children(e,n,r){r&&(this.marker=r);for(let o of e.children)o!==r&&this.walk(o,n)}breakAround(e,n){let r=i=>!!i&&/^(always|page|left|right|recto|verso)$/.test(i.trim().toLowerCase()),o=(n["mso-break-type"]??"").trim().toLowerCase()==="section-break",s=r(n["page-break-before"])||r(n["break-before"])||/\bpage-?break\b/i.test(e.attrs.class??"");return{before:o?"section_break":s?"page_break":null,after:r(n["page-break-after"])||r(n["break-after"])?"page_break":null,kind:s?"next_page":"continuous"}}addBreak_(e,n){if(this.inCell)return;this.flush();let r=this.blocks[this.blocks.length-1];!r||r.type==="page_break"||r.type==="section_break"||this.add(e==="page_break"?{id:D("b_"),type:"page_break"}:{id:D("b_"),type:"section_break",kind:n})}element(e,n){if(ku.has(e.tag))return;let r=this.declarations(e),o=this.breakAround(e,r);o.before&&this.addBreak_(o.before,o.kind);let s=r.float==="left"||r.float==="right"?r.float:(e.attrs.align==="left"||e.attrs.align==="right")&&e.tag==="img"?e.attrs.align:null;this.floats.push(s),this.elementInner(e,n,r,(e.tag==="hr"||e.tag==="br")&&(o.before!==null||o.after!==null)),this.floats.pop(),o.after&&this.addBreak_(o.after,"next_page")}elementInner(e,n,r,o){if(o||jp(r,e))return;let s=this.styleFor(e,n,r);switch(e.tag){case"br":this.addBreak(s);return;case"hr":this.flush(),this.add({id:D("b_"),type:"divider"});return;case"img":this.image(e,r);return;case"table":this.flush(),this.table(e,s);return;case"pre":this.flush(),this.code(e);return;case"h1":case"h2":case"h3":case"h4":case"h5":case"h6":{this.kinds.push({type:"heading",level:Number(e.tag[1])}),this.block(s,()=>this.children(e,s),!0),this.kinds.pop();return}case"blockquote":this.kinds.push({type:"quote"}),this.block(s,()=>this.children(e,s),!1),this.kinds.pop();return;case"ul":case"ol":{this.flush();let i=e.tag==="ol"?"ordered":"bullet",a=Number.parseInt(e.attrs.start??"",10);this.lists.push({list:i,...za(i,r["list-style-type"]??r["list-style"],e.attrs.type)&&{marker:za(i,r["list-style-type"]??r["list-style"],e.attrs.type)},start:Number.isInteger(a)&&a>=0&&a<=99999?a:1,first:!0}),this.children(e,s),this.flush(),this.lists.pop();return}case"li":{let i=this.lists[this.lists.length-1],a=Number.parseInt(e.attrs.value??"",10),l=za(i?.list??"bullet",r["list-style-type"]??r["list-style"],void 0),c=i?.list==="ordered"?Number.isInteger(a)&&a>=0&&a<=99999?a:i.first?i.start:void 0:void 0;i&&(i.first=!1);let d=l??i?.marker;this.kinds.push({type:"list_item",list:i?.list??"bullet",depth:Math.max(0,this.lists.length-1),...d&&{marker:d},...c!==void 0&&{start:c}}),this.block(s,()=>this.children(e,s),!0),this.kinds.pop();return}case"p":{let i=this.wordList(e,r);if(i){this.kinds.push({type:"list_item",list:i.list,depth:i.depth,...i.style&&{marker:i.style},...i.start!==void 0&&{start:i.start}}),this.block(s,()=>this.children(e,s,i.marker),!0),this.kinds.pop();return}let a=/(?:^|\s)Mso(Title|Subtitle|Quote|IntenseQuote)(?:\s|$)/.exec(e.attrs.class??"")?.[1];if(a){this.kinds.push({type:a==="Title"?"title":a==="Subtitle"?"subtitle":"quote"}),this.block(s,()=>this.children(e,s),!0),this.kinds.pop();return}this.block(s,()=>this.children(e,s),!0);return}case"div":case"section":case"article":case"header":case"footer":case"main":case"aside":case"nav":case"figure":case"figcaption":case"form":case"fieldset":case"address":case"details":case"summary":case"center":case"dl":case"dt":case"dd":case"caption":case"hgroup":case"menu":{let i=this.wordList(e,r);if(i){this.kinds.push({type:"list_item",list:i.list,depth:i.depth,...i.style&&{marker:i.style},...i.start!==void 0&&{start:i.start}}),this.block(s,()=>this.children(e,s,i.marker),!0),this.kinds.pop();return}this.block(s,()=>this.children(e,s),!1);return}default:this.children(e,s)}}addBreak(e){let n=this.buffer??this.open(e);n.runs.push({text:`
`,marks:void 0}),n.endsInSpace=!0}wordList(e,n){let r=n["mso-list"];if(!r||/^\s*(none|ignore)/i.test(r))return null;let o=/level(\d+)/i.exec(r)?.[1];if(!o)return null;let s=u=>{for(let f of u.children){if(f.kind!=="el")continue;if(/ignore/i.test(ui(f.attrs.style??"")["mso-list"]??""))return f;let p=s(f);if(p)return p}},i=s(e),a=i?cs(i).replace(/[\s ]+/g,""):"",l=/^[\(\[]?(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)\]]/.test(a),c=Math.min(8,Math.max(0,Number(o)-1));if(!l)return{depth:c,list:"bullet",marker:i,...ls(a)&&{style:ls(a)}};let d=ci(a);return{depth:c,list:"ordered",marker:i,...d&&{style:d.marker,start:d.number}}}code(e){let n=cs(e).replace(/\r\n?/g,`
`).replace(/^\n/,"").replace(/\n+$/,"");if(n=n.replace(/ /g," "),n.trim()==="")return;let r=e.children.find(s=>s.kind==="el"&&s.tag==="code"),o=/(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(`${e.attrs.class??""} ${r?.attrs.class??""}`)?.[1];this.add({id:D("b_"),type:"code_block",runs:[{text:n}],...o&&{language:o.slice(0,24)}})}image(e,n){let r=Ip(e.attrs.src);if(!r)return;let o=d=>{if(!d)return null;let u=/^[\d.]+$/.test(d.trim()),f=uo(u?`${d.trim()}${e.attrs["v:shapes"]!==void 0?"pt":"px"}`:d);return f&&f>0?Math.round(f*4/3):null},s=o(n.width??e.attrs.width),i=o(n.height??e.attrs.height),a=s!==null&&i!==null,l={id:D("b_"),type:"image",src:r,width:Math.min(4e3,s??300),height:Math.min(4e3,i??200),...e.attrs.alt&&{alt:e.attrs.alt.slice(0,500)}},c=[...this.floats].reverse().find(d=>d!==null);c&&(l.wrap=c),!(this.inCell&&l.type!=="image")&&(l.wrap&&this.buffer&&this.buffer.runs.length>0?this.anchored.push(l):(this.flush(),this.add(l)),a||this.unsized.push(l.id))}table(e,n){let r=Hp(e,this.rules,this.options,this.declarations(e));if(r){if(this.inCell){for(let o of r.rows){let s=o.cells.filter(i=>!i.covered).map(i=>i.blocks.map(a=>"runs"in a?a.runs.map(l=>l.text).join(""):"").join(" ")).join("  ");s.trim()&&this.add({id:D("b_"),type:"paragraph",runs:[{text:s}],...n.align&&{align:n.align}})}return}this.add(r)}}};function zp(t){let e=t.slice();for(;e.length>0;){let n=e[e.length-1],r=n.text.replace(/[ \n]+$/,"");if(r==="")e.pop();else{e[e.length-1]={...n,text:r};break}}return e}function za(t,e,n){let r=(e??"").toLowerCase().split(/\s+/).find(s=>s in hu),o=r?hu[r]:n?Gp[n]:void 0;return o&&(t==="bullet"?rn:$n).includes(o)?o:void 0}var hu={decimal:"decimal","lower-alpha":"lower-alpha","lower-latin":"lower-alpha","upper-alpha":"upper-alpha","upper-latin":"upper-alpha","lower-roman":"lower-roman","upper-roman":"upper-roman",disc:"disc",circle:"circle",square:"square"},Gp={1:"decimal",a:"lower-alpha",A:"upper-alpha",i:"lower-roman",I:"upper-roman"};function di(t){let e=[];return t.map(n=>{if(n.type==="table")return e.length=0,{...n,rows:n.rows.map(o=>({...o,cells:o.cells.map(s=>({...s,blocks:di(s.blocks)}))}))};if(n.type!=="list_item")return e.length=0,n;if(e.length=n.depth+1,n.list==="bullet")return e[n.depth]=0,n;let r=(e[n.depth]??0)+1;if(e[n.depth]=n.start??r,n.start===r){let{start:o,...s}=n;return s}return n})}function gu(t,e,n,r){let s={id:D("b_"),runs:e,...n&&{align:n},...r&&t.type!=="list_item"&&{format:{indentLeft:Math.round(r*100)/100}}};switch(t.type){case"heading":return{...s,type:"heading",level:t.level};case"quote":return{...s,type:"quote"};case"title":return{...s,type:"title"};case"subtitle":return{...s,type:"subtitle"};case"list_item":{let i=t.marker&&t.marker!==He(t.list,t.depth)?t.marker:void 0;return{...s,type:"list_item",list:t.list,depth:t.depth,...i&&{marker:i},...t.start!==void 0&&t.list==="ordered"&&{start:t.start}}}default:return{...s,type:"paragraph"}}}var yu=()=>({id:D("b_"),type:"paragraph",runs:[]});function bu(t){if(!t)return null;let e=t.trim().toLowerCase(),n=/^([\d.]+)%$/.exec(e);if(n)return{amount:parseFloat(n[1]),percent:!0};let r=uo(/^[\d.]+$/.test(e)?`${e}px`:e);return r?{amount:r*4/3,percent:!1}:null}function us(t,e,n,r=[]){for(let o of t.children)o.kind==="el"&&(e.has(o.tag)?r.push(o):n.has(o.tag)||us(o,e,n,r));return r}function Hp(t,e,n,r){let o=new fs(e,n,!0),s=x=>o.declarations(x),i=us(t,new Set(["tr"]),new Set(["table"])).filter(x=>!("hidden"in x.attrs)&&s(x).display?.trim()!=="none"),a=Math.min(i.length,Dp);if(a===0)return null;let l=Array.from({length:a},()=>[]),c=[],d=0;if(i.slice(0,a).forEach((x,$)=>{let L=0;for(let W of us(x,new Set(["td","th"]),new Set(["table","tr"]))){for(;l[$][L];)L++;if(L>=mu)break;let Q=se=>Math.max(1,Math.min(Fp,parseInt(W.attrs[se]??"1",10)||1)),V=Math.min(Q("rowspan"),a-$),J=Math.min(Q("colspan"),mu-L);for(let se=$;se<$+V;se++)for(let pe=L;pe<L+J;pe++)l[se][pe]=!0;c.push({el:W,row:$,col:L,rowSpan:V,colSpan:J}),d=Math.max(d,L+J),L+=J}}),c.length===0||d===0)return null;let u=Array.from({length:a},()=>Array.from({length:d},()=>null)),f={value:!1};for(let x of c){let $=s(x.el),L=new fs(e,n,!0),W={marks:{},white:"normal",align:Su($["text-align"]??x.el.attrs.align)},Q=L.styleFor(x.el,W,$);for(let ge of x.el.children)L.walk(ge,Q);L.flush();let V=L.blocks.filter(ge=>ge.type!=="table"&&ge.type!=="toc"&&ge.type!=="page_break");for(;V.length>1&&V[V.length-1].type==="paragraph"&&V[V.length-1].runs.length===0;)V.pop();let J={id:D("c_"),blocks:V.length>0?V:[yu()]},se=wu($)??co(x.el.attrs.bgcolor);se&&ds(se)<.97&&ds(se)>.05&&(J.shade=se);let pe=($["vertical-align"]??x.el.attrs.valign??"").trim().toLowerCase();pe==="middle"||pe==="center"?J.vAlign="middle":pe==="bottom"&&(J.vAlign="bottom"),x.rowSpan>1&&(J.rowSpan=x.rowSpan),x.colSpan>1&&(J.colSpan=x.colSpan);for(let ge of Object.keys($))ge.startsWith("border")&&!/^(none|0|0px|hidden)$/i.test($[ge].trim().split(/\s+/)[0]??"")&&(f.value=!0);u[x.row][x.col]=J;for(let ge=x.row;ge<x.row+x.rowSpan;ge++)for(let Re=x.col;Re<x.col+x.colSpan;Re++)(ge!==x.row||Re!==x.col)&&(u[ge][Re]={id:D("c_"),blocks:[],covered:!0})}let p=u.map((x,$)=>{let L=s(i[$]),W={id:D("r_"),cells:x.map(V=>V??{id:D("c_"),blocks:[yu()]})},Q=uo(L.height??(i[$].attrs.height?`${i[$].attrs.height}px`:void 0));return Q&&Q>=6&&Q<=2e3&&(W.height=Math.round(Q*2)/2),W}),m=us(t,new Set(["col"]),new Set(["table"])),g=Array.from({length:d},()=>null),y=0;for(let x of m){let $=Math.max(1,parseInt(x.attrs.span??"1",10)||1),L=bu(s(x).width??x.attrs.width);for(let W=0;W<$&&y<d;W++)g[y++]=L}if(!g.some(x=>x!==null))for(let x of c)x.row===0&&x.colSpan===1&&(g[x.col]=bu(s(x.el).width??x.el.attrs.width));let b=g.some(x=>x?.percent),k=g.filter(x=>!!x&&x.percent===b),T=k.length>0?k.reduce((x,$)=>x+$.amount,0)/k.length:1,I=lt(g.map(x=>x&&x.percent===b&&x.amount>0?x.amount:T)),O=c.filter(x=>x.row===0),F=us(t,new Set(["thead"]),new Set(["table"])).length>0,R=O.length>0&&(O.every(x=>x.el.tag==="th")||F&&a>1),N=(r["border-style"]??r.border??"").trim().toLowerCase(),P=!f.value&&(t.attrs.border==="0"||/^(none|0|hidden)/.test(N)||t.attrs.border===void 0&&!N),B={id:D("b_"),type:"table",rows:p,columns:I,...R&&{headerRow:!0},...P&&t.attrs.border==="0"&&{borders:"none"}};return Mn(B)?null:B}function xu(t,e={}){let n={defaultFontSize:e.defaultFontSize??11,defaultFontFamily:e.defaultFontFamily??"Arial"},r=du(t),o=[],s=f=>{for(let p of f.children)p.kind==="el"&&(p.tag==="style"?o.push(cs(p)):s(p))};s(r);let i=au(o.join(`
`)),a=f=>f.children.some(p=>p.kind==="el"&&!ku.has(p.tag)&&(fu(p.tag)||p.tag==="li"||p.tag==="img"||a(p))),l=new fs(i,n,!1,!a(r)),c={marks:{},white:"normal"};for(let f of r.children)l.walk(f,c);l.flush();let d=di(su(l.blocks.slice())),u=f=>f.type==="paragraph"&&f.runs.every(p=>p.text.trim()==="");for(;d.length>0&&u(d[0]);)d.shift();for(;d.length>0&&u(d[d.length-1]);)d.pop();return{blocks:d,unsizedImages:l.unsized.filter(f=>d.some(p=>p.id===f))}}var Kp=8e6,Wp=2e4,qp=64,Xp="\u20AC\x81\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\x8D\u017D\x8F\x90\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\x9D\u017E\u0178",Vp=new Set(["fonttbl","colortbl","stylesheet","info","pict","header","footer","headerl","headerr","footerl","footerr","listtable","listoverridetable","expandedcolortbl","rsidtbl","generator","themedata","colorschememapping","latentstyles","datastore","xmlnstbl","fldinst","private","object","falt","panose"]);function vu(t){if(t.length>Kp||!/^\s*\{\\rtf/.test(t))return[];let e=new Map,n=[],r=[],o={bold:!1,italic:!1,underline:!1,strike:!1,superscript:!1,subscript:!1,skip:!1,uc:1},s=[],i={list:!1,depth:0},a=[],l="",c=0,d=null,u=0,f=-1,p={r:-1,g:-1,b:-1},m="",g=0,y=()=>{let F={};o.bold&&(F.bold=!0),o.italic&&(F.italic=!0),o.underline&&(F.underline=!0),o.strike&&(F.strike=!0),o.superscript&&(F.superscript=!0),o.subscript&&(F.subscript=!0),o.size!==void 0&&o.size!==22&&o.size>0&&(F.fontSize=o.size/2);let R=o.color!==void 0&&o.color>0?n[o.color]:void 0;R&&R!=="#000000"&&(F.color=R);let N=o.font!==void 0?e.get(o.font):void 0;return N&&(F.fontFamily=N),Object.keys(F).length>0?F:void 0},b=F=>{if(F===""||o.skip)return;if(c>0){l+=F;return}let R=y();a.push(R?{text:F,marks:R}:{text:F})},k=()=>{if(r.length>=Wp)return;let F=he(a);a=[];let R=l.replace(/[\s\u00a0]+/g,"");l="";let N={id:D("b_"),runs:F,...i.align&&{align:i.align}};if(i.list&&R!==""){let B=ci(R),x=Math.min(8,i.depth),$=B?B.marker:ls(R);r.push({...N,type:"list_item",list:B?"ordered":"bullet",depth:x,...$&&$!==He(B?"ordered":"bullet",x)&&{marker:$},...B&&{start:B.number}});return}let P=i.indent&&i.indent>0?Math.round(i.indent/20*100)/100:void 0;r.push({...N,type:"paragraph",...P&&{format:{indentLeft:P}}})},T=(F,R)=>{if(d==="fonts"||d==="colors"){d==="fonts"&&F==="f"&&R!==void 0&&(f=R),d==="colors"&&(F==="red"&&(p.r=R??0),F==="green"&&(p.g=R??0),F==="blue"&&(p.b=R??0));return}switch(F){case"b":o.bold=R!==0;break;case"i":o.italic=R!==0;break;case"ul":case"uld":case"uldb":case"ulth":case"ulw":o.underline=R!==0;break;case"ulnone":o.underline=!1;break;case"strike":case"striked":o.strike=R!==0;break;case"super":o.superscript=!0,o.subscript=!1;break;case"sub":o.subscript=!0,o.superscript=!1;break;case"nosupersub":o.superscript=!1,o.subscript=!1;break;case"fs":R!==void 0&&(o.size=R);break;case"cf":R!==void 0&&(o.color=R);break;case"f":R!==void 0&&(o.font=R);break;case"uc":o.uc=R??1;break;case"plain":o={...o,bold:!1,italic:!1,underline:!1,strike:!1,superscript:!1,subscript:!1,size:void 0,color:void 0,font:void 0};break;case"pard":i={list:!1,depth:0};break;case"qc":i.align="center";break;case"qr":i.align="right";break;case"qj":i.align="justify";break;case"ql":i.align=void 0;break;case"ls":i.list=!0;break;case"ilvl":i.depth=R??0;break;case"li":i.indent=R;break;case"par":k();break;case"line":b(`
`);break;case"tab":b("	");break;case"emspace":case"enspace":case"~":b("\xA0");break;case"endash":b("\u2013");break;case"emdash":b("\u2014");break;case"lquote":b("\u2018");break;case"rquote":b("\u2019");break;case"ldblquote":b("\u201C");break;case"rdblquote":b("\u201D");break;case"bullet":b("\u2022");break;case"listtext":c=s.length;break;default:break}},I=t.length,O=0;for(;O<I;){let F=t[O];if(F==="{"){if(s.length>=qp)return r;s.push({...o}),O++;let P=/^\\\*?\\?([a-z]+)/i.exec(t.slice(O,O+40));if(t[O]==="\\"&&t[O+1]==="*")o.skip=!0;else if(P&&Vp.has(P[1].toLowerCase())){let B=P[1].toLowerCase();B==="fonttbl"?(d="fonts",u=s.length,f=-1,m=""):B==="colortbl"?(d="colors",u=s.length,p={r:-1,g:-1,b:-1}):o.skip=!0}continue}if(F==="}"){let P=s.length;if(c===P&&(c=0),d&&P===u&&(d==="fonts"&&f>=0&&m.trim()!==""&&e.set(f,m.trim()),d=null),o=s.pop()??o,O++,s.length===0&&P===1)break;continue}if(F==="\\"){let P=t[O+1]??"";if(P==="'"){let L=parseInt(t.slice(O+2,O+4),16);if(O+=4,g>0){g--;continue}if(Number.isNaN(L))continue;let W=L>=128&&L<=159?Xp[L-128]:String.fromCharCode(L);d==="fonts"?m+=W:b(W);continue}if(P===`
`||P==="\r"){O+=2,P==="\r"&&t[O]===`
`&&O++,!o.skip&&d===null&&k();continue}if(/[\\{}]/.test(P)){if(O+=2,g>0){g--;continue}d==="fonts"?m+=P:b(P);continue}if(P==="~"||P==="-"||P==="_"){O+=2,b(P==="~"?"\xA0":P==="_"?"\u2011":"");continue}let B=/^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(t.slice(O,O+40));if(!B){O++;continue}O+=B[0].length;let x=B[1],$=B[2]!==void 0?Number(B[2]):void 0;if(x==="u"&&$!==void 0){let L=$<0?$+65536:$;d==="fonts"?m+=String.fromCharCode(L):b(String.fromCharCode(L)),g=o.uc;continue}T(x,$);continue}if(F===`
`||F==="\r"){O++;continue}let R=O;for(;R<I&&!`\\{}\r
`.includes(t[R]);)R++;let N=t.slice(O,R);for(O=R;g>0&&N.length>0;)N=N.slice(1),g--;if(d==="fonts"){let P=N.indexOf(";");m+=P>=0?N.slice(0,P):N,P>=0&&f>=0&&m.trim()!==""&&(e.set(f,m.trim()),m="")}else if(d==="colors")for(let P of N)P===";"&&(p.r>=0?n.push(`#${[p.r,p.g,p.b].map(B=>Math.max(0,Math.min(255,B)).toString(16).padStart(2,"0")).join("")}`):n.push(""),p={r:-1,g:-1,b:-1});else b(N)}return(a.length>0||l!=="")&&k(),di(Zp(r))}function Jp(t){let e=jt(t);if(e)return e.family;let r=t.split("-")[0].replace(/([a-z])([A-Z])/g,"$1 $2");return jt(r)?.family??r}function Zp(t){let e=t.map(n=>"runs"in n?{...n,runs:n.runs.map(r=>r.marks?.fontFamily?{...r,marks:{...r.marks,fontFamily:Jp(r.marks.fontFamily)}}:r)}:n);for(;e.length>1;){let n=e[e.length-1];if(n.type==="paragraph"&&n.runs.length===0)e.pop();else break}return e}var po=["header","footer","headerFirst","footerFirst","headerEven","footerEven"];function Cu(t){return t.endsWith("First")?"first":t.endsWith("Even")?"even":"default"}function ps(t,e){return e==="first"?`${t}First`:e==="even"?`${t}Even`:t}function Pu(t,e){return[ps(e,"default"),...t?.differentFirstPage?[ps(e,"first")]:[],...t?.differentOddEven?[ps(e,"even")]:[]]}var Ka="pli.doc",Wa=1;function M(t,e){throw new C("invalid_document",`${t}: ${e}`)}function le(t){return typeof t=="object"&&t!==null&&!Array.isArray(t)}function ne(t,e,n){for(let r of Object.keys(e))n.includes(r)||M(t,`unknown field "${r}"`)}function ae(t,e,{nonEmpty:n=!1}={}){return(typeof e!="string"||n&&e==="")&&M(t,n?"expected a non-empty string":"expected a string"),e}function fe(t,e,n,r){return(typeof e!="number"||!Number.isFinite(e)||e<n||e>r)&&M(t,`expected a number from ${n} to ${r}`),e}var Au=["bold","italic","underline","strike","code","superscript","subscript"],Yp=["link","color","highlight","fontFamily"],Bu=["left","center","right","justify"],Mu=["page","pages"];function fi(t,e){Array.isArray(e)||M(t,"expected an array of runs"),e.forEach((n,r)=>{let o=`${t}[${r}]`;if(le(n)||M(o,"expected a run object"),ne(o,n,["text","marks"]),ae(`${o}.text`,n.text),n.marks!==void 0){le(n.marks)||M(`${o}.marks`,"expected an object");for(let[s,i]of Object.entries(n.marks)){let a=`${o}.marks.${s}`;Au.includes(s)?typeof i!="boolean"&&M(a,"expected a boolean"):Yp.includes(s)?ae(a,i):s==="fontSize"?fe(a,i,1,400):s==="field"?Mu.includes(i)||M(a,`expected one of ${Mu.join(", ")}`):s==="style"?ae(a,i,{nonEmpty:!0}):s==="suggest"?(le(i)||M(a,"expected an object"),ne(a,i,["id","kind","by","at"]),ae(`${a}.id`,i.id,{nonEmpty:!0}),i.kind!=="insert"&&i.kind!=="delete"&&M(`${a}.kind`,'expected "insert" or "delete"'),ae(`${a}.by`,i.by,{nonEmpty:!0}),fe(`${a}.at`,i.at,0,Number.MAX_SAFE_INTEGER)):s==="footnote"?ae(a,i,{nonEmpty:!0}):s==="comment"?((!Array.isArray(i)||i.length===0)&&M(a,"expected a list of thread ids"),i.forEach((l,c)=>ae(`${a}[${c}]`,l,{nonEmpty:!0}))):M(`${o}.marks`,`unknown mark "${s}"`)}}})}var Qp=["bold","italic","underline","strike","superscript","subscript","color","highlight","fontFamily","fontSize"];function em(t,e){le(e)||M(t,"expected an object");for(let[n,r]of Object.entries(e)){let o=`${t}.${n}`;if(n===""&&M(t,"a style needs an id"),le(r)||M(o,"expected a style object"),ne(o,r,["name","kind","basedOn","marks","align","format"]),ae(`${o}.name`,r.name,{nonEmpty:!0}),r.kind!=="paragraph"&&r.kind!=="character"&&M(`${o}.kind`,'expected "paragraph" or "character"'),r.basedOn!==void 0){let s=ae(`${o}.basedOn`,r.basedOn,{nonEmpty:!0}),i=e[s];(!le(i)||i.kind!==r.kind)&&M(`${o}.basedOn`,`"${s}" isn't a ${String(r.kind)} style of this document`)}if(r.marks!==void 0){le(r.marks)||M(`${o}.marks`,"expected an object");let s=r.marks;for(let[i,a]of Object.entries(s)){let l=`${o}.marks.${i}`;Qp.includes(i)||M(`${o}.marks`,`a style can't set "${i}"`),Au.includes(i)?typeof a!="boolean"&&M(l,"expected a boolean"):i==="fontSize"?fe(l,a,1,400):ae(l,a)}}r.kind==="character"&&(r.align!==void 0||r.format!==void 0)&&M(o,"a character style can't set alignment or spacing"),ms(o,r.align),pi(o,r.format)}for(let n of Object.keys(e)){let r=new Set;for(let o=n;o!==void 0;o=e[o].basedOn)r.has(o)&&M(`${t}.${n}.basedOn`,"styles can't be based on each other in a circle"),r.add(o)}}function ms(t,e){e!==void 0&&!Bu.includes(e)&&M(`${t}.align`,`expected one of ${Bu.join(", ")}`)}function pi(t,e){if(e!==void 0){le(e)||M(`${t}.format`,"expected an object"),ne(`${t}.format`,e,["lineHeight","spaceBefore","spaceAfter","indentLeft","indentRight","indentFirst"]);for(let[n,r]of Object.entries(e)){let o=`${t}.format.${n}`;n==="lineHeight"?fe(o,r,.5,10):n==="indentFirst"?fe(o,r,-1e3,1e3):fe(o,r,0,1e3)}}}var Ha=["id","type","runs","align","format","style"],tm=new Set(["paragraph","title","subtitle","quote","heading","list_item","code_block","image","divider"]);function qa(t,e,n){let r=ae(t,n,{nonEmpty:!0});return e.has(r)&&M(t,`duplicate id "${r}"`),e.add(r),r}function Tu(t,e){for(let[n,r,o]of[["x",["page","margin","column"],["left","center","right"]],["y",["page","margin","paragraph"],["top","center","bottom"]]]){let s=e[n];le(s)||M(`${t}.${n}`,"expected an object"),ne(`${t}.${n}`,s,["from","offset","align"]),r.includes(s.from)||M(`${t}.${n}.from`,`expected one of ${r.join(", ")}`),s.offset!==void 0&&fe(`${t}.${n}.offset`,s.offset,-1e5,1e5),s.align!==void 0&&!o.includes(s.align)&&M(`${t}.${n}.align`,`expected one of ${o.join(", ")}`)}e.behind!==void 0&&typeof e.behind!="boolean"&&M(`${t}.behind`,"expected true or false"),e.z!==void 0&&fe(`${t}.z`,e.z,-1e6,1e6)}var Ou=/^#[0-9a-fA-F]{6}$/;function nm(t,e){if(ne(t,e,["x","y","behind","z","width","height","shape","fill","fillOpacity","line","padding"]),Tu(t,e),fe(`${t}.width`,e.width,1,2e4),fe(`${t}.height`,e.height,1,2e4),e.shape!==void 0&&!["rect","round_rect","ellipse"].includes(e.shape)&&M(`${t}.shape`,'expected "rect", "round_rect" or "ellipse"'),e.fill!==void 0&&!Ou.test(ae(`${t}.fill`,e.fill))&&M(`${t}.fill`,"expected a colour like #1a2b3c"),e.fillOpacity!==void 0&&fe(`${t}.fillOpacity`,e.fillOpacity,0,1),e.line!==void 0){let n=e.line;le(n)||M(`${t}.line`,"expected an object"),ne(`${t}.line`,n,["color","width","style"]),Ou.test(ae(`${t}.line.color`,n.color))||M(`${t}.line.color`,"expected a colour like #1a2b3c"),fe(`${t}.line.width`,n.width,0,200),n.style!==void 0&&!["solid","dashed","dotted","double"].includes(n.style)&&M(`${t}.line.style`,'expected "solid", "dashed", "dotted" or "double"')}if(e.padding!==void 0){let n=e.padding;le(n)||M(`${t}.padding`,"expected an object"),ne(`${t}.padding`,n,["x","y"]),fe(`${t}.padding.x`,n.x,0,1e3),fe(`${t}.padding.y`,n.y,0,1e3)}}function rm(t,e,n){ne(t,e,["id","type","rows","columns","headerRow","borders","float"]),e.float!==void 0&&(le(e.float)||M(`${t}.float`,"expected an object"),nm(`${t}.float`,e.float),(e.columns?.length!==1||e.rows?.length!==1)&&M(`${t}.float`,"a text box has one row and one column")),e.headerRow!==void 0&&typeof e.headerRow!="boolean"&&M(`${t}.headerRow`,"expected a boolean"),e.borders!==void 0&&!["all","horizontal","none"].includes(e.borders)&&M(`${t}.borders`,'expected "all", "horizontal" or "none"'),(!Array.isArray(e.columns)||e.columns.length===0)&&M(`${t}.columns`,"expected a non-empty array");let r=e.columns,o=0;r.forEach((i,a)=>o+=fe(`${t}.columns[${a}]`,i,1e-4,1)),Math.abs(o-1)>1e-6&&M(`${t}.columns`,"column widths must add up to 1"),(!Array.isArray(e.rows)||e.rows.length===0)&&M(`${t}.rows`,"expected at least one row"),e.rows.forEach((i,a)=>{let l=`${t}.rows[${a}]`;le(i)||M(l,"expected a row object"),ne(l,i,["id","cells","height"]),qa(`${l}.id`,n,i.id),i.height!==void 0&&fe(`${l}.height`,i.height,1,5e3),(!Array.isArray(i.cells)||i.cells.length!==r.length)&&M(`${l}.cells`,`expected ${r.length} cells, one per column`),i.cells.forEach((c,d)=>{let u=`${l}.cells[${d}]`;le(c)||M(u,"expected a cell object"),ne(u,c,["id","blocks","shade","colSpan","rowSpan","vAlign","covered"]),qa(`${u}.id`,n,c.id),c.shade!==void 0&&ae(`${u}.shade`,c.shade);for(let f of["colSpan","rowSpan"])c[f]!==void 0&&(!Number.isInteger(c[f])||c[f]<2)&&M(`${u}.${f}`,"expected a whole number of 2 or more");c.vAlign!==void 0&&!["top","middle","bottom"].includes(c.vAlign)&&M(`${u}.vAlign`,'expected "top", "middle" or "bottom"'),c.covered!==void 0&&c.covered!==!0&&M(`${u}.covered`,"expected true"),Array.isArray(c.blocks)||M(`${u}.blocks`,"expected an array"),c.covered!==!0&&c.blocks.length===0&&M(`${u}.blocks`,"a cell needs at least one block"),hs(`${u}.blocks`,c.blocks,n,!0)})});let s=Mn(e);s&&M(`${t}`,s)}function hs(t,e,n,r=!1){Array.isArray(e)||M(t,"expected an array"),e.forEach((o,s)=>{let i=`${t}[${s}]`;switch(le(o)||M(i,"expected a block object"),qa(`${i}.id`,n,o.id),r&&!tm.has(o.type)&&M(`${i}.type`,`${JSON.stringify(o.type)} can't go inside a table cell`),o.type){case"paragraph":case"title":case"subtitle":case"quote":ne(i,o,Ha),ms(i,o.align),pi(i,o.format),fi(`${i}.runs`,o.runs);break;case"heading":ne(i,o,[...Ha,"level"]),[1,2,3,4,5,6].includes(o.level)||M(`${i}.level`,"expected 1 to 6"),ms(i,o.align),pi(i,o.format),fi(`${i}.runs`,o.runs);break;case"list_item":if(ne(i,o,[...Ha,"list","depth","marker","start"]),o.list!=="bullet"&&o.list!=="ordered"&&M(`${i}.list`,'expected "bullet" or "ordered"'),(!Number.isInteger(o.depth)||o.depth<0)&&M(`${i}.depth`,"expected a non-negative integer"),o.marker!==void 0){let a=o.list==="bullet"?rn:$n;a.includes(o.marker)||M(`${i}.marker`,`expected one of ${a.join(", ")}`)}o.start!==void 0&&(o.list!=="ordered"&&M(`${i}.start`,"only a numbered item has a start"),(!Number.isInteger(o.start)||o.start<0||o.start>99999)&&M(`${i}.start`,`expected a whole number from 0 to ${99999}`)),ms(i,o.align),pi(i,o.format),fi(`${i}.runs`,o.runs);break;case"code_block":ne(i,o,["id","type","language","runs"]),o.language!==void 0&&ae(`${i}.language`,o.language),fi(`${i}.runs`,o.runs);break;case"divider":case"page_break":ne(i,o,["id","type"]);break;case"section_break":ne(i,o,["id","type","kind","columns","page","differentFirstPage","regions"]),o.kind!=="next_page"&&o.kind!=="continuous"&&M(`${i}.kind`,'expected "next_page" or "continuous"'),Ru(`${i}.columns`,o.columns),om(`${i}.page`,o.page),o.differentFirstPage!==void 0&&typeof o.differentFirstPage!="boolean"&&M(`${i}.differentFirstPage`,"expected true or false"),sm(`${i}.regions`,o.regions);break;case"image":if(ne(i,o,["id","type","src","alt","width","height","align","wrap","crop","float"]),ae(`${i}.src`,o.src,{nonEmpty:!0}),o.alt!==void 0&&ae(`${i}.alt`,o.alt),fe(`${i}.width`,o.width,1,2e4),fe(`${i}.height`,o.height,1,2e4),ms(i,o.align),o.wrap!==void 0&&o.wrap!=="left"&&o.wrap!=="right"&&M(`${i}.wrap`,'expected "left" or "right"'),o.float!==void 0&&(r&&M(`${i}.float`,"a picture inside a table cell or text box can't float"),le(o.float)||M(`${i}.float`,"expected an object"),ne(`${i}.float`,o.float,["x","y","behind","z"]),Tu(`${i}.float`,o.float),o.wrap!==void 0&&M(`${i}.wrap`,"a floating picture takes no room in the text, so nothing wraps")),o.crop!==void 0){(typeof o.crop!="object"||o.crop===null||Array.isArray(o.crop))&&M(`${i}.crop`,"expected an object");let a=o.crop;ne(`${i}.crop`,a,["top","right","bottom","left"]);for(let l of["top","right","bottom","left"])fe(`${i}.crop.${l}`,a[l],0,.9);(a.left+a.right>.95||a.top+a.bottom>.95)&&M(`${i}.crop`,"too much is cut away")}break;case"toc":ne(i,o,["id","type","levels","title"]),[1,2,3,4,5,6].includes(o.levels)||M(`${i}.levels`,"expected 1 to 6"),o.title!==void 0&&ae(`${i}.title`,o.title);break;case"table":rm(i,o,n);break;default:M(`${i}.type`,`unknown block type ${JSON.stringify(o.type)}`)}})}function om(t,e){if(e!==void 0&&(le(e)||M(t,"expected an object"),ne(t,e,["size","orientation","margins"]),e.size!==void 0&&!(ae(`${t}.size`,e.size)in En)&&M(`${t}.size`,`expected one of ${Object.keys(En).join(", ")}`),e.orientation!==void 0&&e.orientation!=="portrait"&&e.orientation!=="landscape"&&M(`${t}.orientation`,'expected "portrait" or "landscape"'),e.margins!==void 0)){let n=e.margins;le(n)||M(`${t}.margins`,"expected an object"),ne(`${t}.margins`,n,["top","right","bottom","left"]);for(let r of["top","right","bottom","left"])fe(`${t}.margins.${r}`,n[r],0,5)}}function sm(t,e){if(e!==void 0){le(e)||M(t,"expected an object"),ne(t,e,po);for(let[n,r]of Object.entries(e))hs(`${t}.${n}`,r,new Set),r.some(o=>o.type==="section_break")&&M(`${t}.${n}`,"a header or footer can't hold a section break")}}function Ru(t,e){e!==void 0&&(le(e)||M(t,"expected an object"),ne(t,e,["count","gap","rule"]),(!Number.isInteger(e.count)||e.count<1||e.count>4)&&M(`${t}.count`,"expected a whole number from 1 to 4"),e.gap!==void 0&&fe(`${t}.gap`,e.gap,0,200),e.rule!==void 0&&typeof e.rule!="boolean"&&M(`${t}.rule`,"expected true or false"))}function im(t,e){le(e)||M(t,"expected an object"),ne(t,e,["size","orientation","margins","columns","differentFirstPage","differentOddEven"]),Ru(`${t}.columns`,e.columns);for(let r of["differentFirstPage","differentOddEven"])e[r]!==void 0&&typeof e[r]!="boolean"&&M(`${t}.${r}`,"expected true or false");ae(`${t}.size`,e.size)in En||M(`${t}.size`,`expected one of ${Object.keys(En).join(", ")}`),e.orientation!=="portrait"&&e.orientation!=="landscape"&&M(`${t}.orientation`,'expected "portrait" or "landscape"');let n=e.margins;le(n)||M(`${t}.margins`,"expected an object"),ne(`${t}.margins`,n,["top","right","bottom","left"]);for(let r of["top","right","bottom","left"])fe(`${t}.margins.${r}`,n[r],0,5)}function am(t,e,n){if(le(n)||M(t,"expected a thread object"),ne(t,n,["id","anchor","comments","resolved","createdAt"]),ae(`${t}.id`,n.id,{nonEmpty:!0})!==e&&M(`${t}.id`,"must match its key"),fe(`${t}.createdAt`,n.createdAt,0,Number.MAX_SAFE_INTEGER),Array.isArray(n.comments)||M(`${t}.comments`,"expected an array"),n.comments.forEach((r,o)=>{let s=`${t}.comments[${o}]`;le(r)||M(s,"expected a comment object"),ne(s,r,["id","author","body","createdAt","editedAt","mentions"]),ae(`${s}.id`,r.id,{nonEmpty:!0}),ae(`${s}.author`,r.author,{nonEmpty:!0}),ae(`${s}.body`,r.body),fe(`${s}.createdAt`,r.createdAt,0,Number.MAX_SAFE_INTEGER),r.editedAt!==void 0&&fe(`${s}.editedAt`,r.editedAt,0,Number.MAX_SAFE_INTEGER),r.mentions!==void 0&&(Array.isArray(r.mentions)||M(`${s}.mentions`,"expected an array"),r.mentions.forEach((i,a)=>ae(`${s}.mentions[${a}]`,i,{nonEmpty:!0})))}),n.resolved!==void 0&&(le(n.resolved)||M(`${t}.resolved`,"expected an object"),ne(`${t}.resolved`,n.resolved,["by","at"]),ae(`${t}.resolved.by`,n.resolved.by,{nonEmpty:!0}),fe(`${t}.resolved.at`,n.resolved.at,0,Number.MAX_SAFE_INTEGER)),n.anchor!==void 0){let r=n.anchor;le(r)||M(`${t}.anchor`,"expected an object"),ne(`${t}.anchor`,r,["block","from","to","quote"]),ae(`${t}.anchor.block`,r.block),fe(`${t}.anchor.from`,r.from,0,Number.MAX_SAFE_INTEGER),fe(`${t}.anchor.to`,r.to,0,Number.MAX_SAFE_INTEGER),ae(`${t}.anchor.quote`,r.quote)}}function mi(t){if(le(t)||M("doc","expected an object"),ne("doc",t,["id","type","title","blocks","page","footnotes","comments","styles",...po]),t.type!=="document"&&M("doc.type",'expected "document"'),ae("doc.id",t.id,{nonEmpty:!0}),ae("doc.title",t.title),hs("doc.blocks",t.blocks,new Set),t.page!==void 0&&im("doc.page",t.page),t.footnotes!==void 0){le(t.footnotes)||M("doc.footnotes","expected an object");for(let[n,r]of Object.entries(t.footnotes)){n===""&&M("doc.footnotes","a note needs an id"),hs(`doc.footnotes.${n}`,r,new Set);for(let o of r)qc(o)||M(`doc.footnotes.${n}`,`a footnote can't hold a ${o.type}`);r.length===0&&M(`doc.footnotes.${n}`,"a note needs at least one block")}}if(t.styles!==void 0&&em("doc.styles",t.styles),t.comments!==void 0){le(t.comments)||M("doc.comments","expected an object");for(let[n,r]of Object.entries(t.comments))am(`doc.comments.${n}`,n,r)}let e=t.footnotes??{};for(let n of Qe(t.blocks))n in e||M("doc.blocks",`a footnote reference points at "${n}", which has no note`);for(let n of po)t[n]!==void 0&&(hs(`doc.${n}`,t[n],new Set),t[n].some(r=>r.type==="section_break")&&M(`doc.${n}`,"a header or footer can't hold a section break"));return t}function gs(t){return JSON.stringify({format:Ka,version:Wa,doc:Kc(t)})}function yr(t){let e;try{e=JSON.parse(t)}catch{throw new C("invalid_document","Not valid JSON")}if(!le(e)||e.format!==Ka)throw new C("invalid_document",`Not a Pli document (expected format "${Ka}")`);if(e.version!==Wa)throw new C("unsupported",`Document version ${String(e.version)} isn't supported by this release (supports ${Wa})`);return mi(e.doc)}var Xa=500,Du=40,lm=32e6,cm=4e6;function um(t){return{...t,id:D("c_"),blocks:t.blocks.map(e=>({...e,id:D("b_")}))}}function dm(t){return t.type!=="table"?{...t,id:D("b_")}:{...t,id:D("b_"),rows:t.rows.map(e=>({...e,id:D("r_"),cells:e.cells.map(um)}))}}function Fu(t){return t.map(dm)}function fm(t,e){let n=de(t.blocks);return[...de(e)].some(o=>n.has(o))?Fu(e):e.slice()}function pm(t){if(t.length===0||t.length>lm)return null;try{let{blocks:e,footnotes:n,styles:r}=yr(t);return e.length>0?{blocks:e,...n&&{footnotes:n},...r&&{styles:r}}:null}catch{return null}}function mm(t){if(!t.includes("	")||t.length>cm)return null;let e=[],n=[],r="",o=!1;for(let a=0;a<t.length;a++){let l=t[a];if(o?l!=='"'?r+=l:t[a+1]==='"'?(r+='"',a++):o=!1:l==='"'&&r===""?o=!0:l==="	"?(n.push(r),r=""):l===`
`||l==="\r"?(l==="\r"&&t[a+1]===`
`&&a++,n.push(r),e.push(n),n=[],r=""):r+=l,e.length>Xa)return null}(r!==""||n.length>0)&&(n.push(r),e.push(n));let s=e[0]?.length??0;if(e.length<2||e.length>Xa||s<2||s>Du||e.some(a=>a.length!==s))return null;let i=a=>({id:D("c_"),blocks:a.replace(/\r\n?/g,`
`).split(`
`).map(l=>({id:D("b_"),type:"paragraph",runs:l===""?[]:[{text:l}]}))});return{id:D("b_"),type:"table",rows:e.map(a=>({id:D("r_"),cells:a.map(i)})),columns:lt(Array.from({length:s},()=>1))}}function Eu(t,e){let n=t.html&&t.html.trim()!==""?xu(t.html,e):null;if(t.plain){let r=t.text??(n?n.blocks.map(o=>_(o)?H(o.runs):"").join(`
`):"");return r===""?null:{source:"text",text:r}}if(t.fragment){let r=typeof t.fragment=="string"?pm(t.fragment):t.fragment.length>0?{blocks:t.fragment.slice(),footnotes:t.footnotes,styles:t.styles}:null;if(r)return{source:"fragment",blocks:r.blocks,unsizedImages:[],...r.footnotes&&{footnotes:r.footnotes},...r.styles&&{styles:r.styles}}}if(n&&n.blocks.length>0)return{source:"html",blocks:n.blocks,unsizedImages:n.unsizedImages};if(t.rtf){let r=vu(t.rtf);if(r.some(o=>_(o)&&H(o.runs)!==""))return{source:"html",blocks:r,unsizedImages:[]}}if(t.text){let r=mm(t.text);return r?{source:"table",blocks:[r],unsizedImages:[]}:{source:"text",text:t.text}}return null}function hm(t){return t.rows.map(e=>{let n=[];return e.cells.filter(r=>!r.covered).forEach((r,o)=>{o>0&&n.push({text:"	"}),r.blocks.forEach((s,i)=>{i>0&&n.push({text:" "}),_(s)&&n.push(...s.runs)})}),{id:D("b_"),type:"paragraph",runs:he(n)}})}function gm(t){let e=n=>n.type==="image"&&n.float?(({float:r,...o})=>o)(n):n;return t.flatMap(n=>n.type==="table"?hm(n):n.type==="toc"||n.type==="page_break"||n.type==="section_break"?[]:[e(n)])}function ym(t){let e=t.list[t.index-1];return e?{after:e.id}:t.cell?{after:null,cell:t.cell.cell.id}:{after:null}}function bm(t,e,n){let r=e.block.id;for(let a of n)t.push({type:"insert_block",block:a,after:r}),r=a.id;let o=n[n.length-1];if(_(o))return{ops:t,selection:j(o.id,q(o.runs))};let s=e.list[e.index+1];if(s&&_(s))return{ops:t,selection:j(s.id,0)};let i=ct();return t.push({type:"insert_block",block:i,after:r}),{ops:t,selection:j(i.id,0)}}function km(t,e,n){let r=on(t,e),o=[...r.ops],s=Oe(r.doc,r.at.block),i=fm(t,n);if(s.cell&&(i=gm(i)),i.length===0)return o.length>0?{ops:o,selection:j(r.at.block,r.at.offset)}:null;let a=s.block;if(!_(a))return bm(o,s,i);let l=q(a.runs),c=Math.min(r.at.offset,l),d=i[0];if(i.length===1&&_(d))return l===0&&a.type==="paragraph"&&d.type!=="paragraph"&&d.runs.length>0?(o.push({type:"replace_block",id:a.id,block:{...d,id:a.id}}),{ops:o,selection:j(a.id,q(d.runs))}):d.runs.length===0?o.length>0?{ops:o,selection:j(a.id,c)}:null:(o.push({type:"insert_text",block:a.id,offset:c,runs:d.runs}),{ops:o,selection:j(a.id,c+q(d.runs))});let u=me(a.runs,c,l),f=i;c>0&&(c<l&&o.push({type:"delete_text",block:a.id,from:c,to:l}),_(d)&&(d.runs.length>0&&o.push({type:"insert_text",block:a.id,offset:c,runs:d.runs}),f=i.slice(1)));let p=f.slice(),m=p[p.length-1],g,y=!1;if(_(m))g={block:m.id,offset:q(m.runs)},p[p.length-1]={...m,runs:he([...m.runs,...u])},y=c===0;else if(c>0){let k=s.list[s.index+1];if(u.length===0&&k&&_(k))g={block:k.id,offset:0};else{let T=u.length>0?{...a,id:D("b_"),runs:u}:ct();p.push(T),g={block:T.id,offset:0}}}else g={block:a.id,offset:0};let b=c>0?{after:a.id}:ym(s);for(let k of p)o.push({type:"insert_block",block:k,after:b.after,..."cell"in b&&b.cell!==void 0&&{cell:b.cell}}),b={after:k.id};return y&&o.push({type:"delete_block",id:a.id}),{ops:o,selection:j(g.block,g.offset)}}function wm(t,e,n){let r=bt(t,e),o,s,i;if(r)o=r.table,s=r.row1,i=r.col1;else{if(e.anchor.block!==e.focus.block||e.anchor.offset!==e.focus.offset)return null;let b=X(t,e.focus.block);if(!b?.cell)return null;({table:o,row:s,col:i}=b.cell)}let a=n.rows.length,l=n.columns.length;if(s+a>Xa||i+l>Du)return null;for(let b=s;b<Math.min(o.rows.length,s+a);b++)for(let k=i;k<Math.min(o.columns.length,i+l);k++){let T=o.rows[b].cells[k];if(T.covered||T.rowSpan||T.colSpan)return null}let c=o;for(;c.rows.length<s+a;)c=Qs(c,c.rows.length);for(;c.columns.length<i+l;)c=ei(c,c.columns.length);let d=Fu([n])[0],u=c.rows.map((b,k)=>k<s||k>=s+a?b:{...b,cells:b.cells.map((T,I)=>I>=i&&I<i+l?d.rows[k-s].cells[I-i]:T)}),f={...c,rows:u};if(Mn(f))return null;let p={type:"replace_block",id:o.id,block:f},m=eo(f,s,i).cell.blocks[0],g=eo(f,s+a-1,i+l-1),y=g.cell.blocks;if(g.cell.id===eo(f,s,i).cell.id){let b=y[y.length-1];return{ops:[p],selection:j(b.id,_(b)?q(b.runs):0)}}return{ops:[p],selection:{anchor:{block:m.id,offset:0},focus:{block:y[0].id,offset:0}}}}function $u(t,e,n){return(r,o)=>{if(t.length===0)return null;let s=Qe(t).length>0,i=ys(Ma(t)),a=s?Xc(i,e):null,l=a?.blocks??i,c=Object.entries(a?.notes??{}).map(([u,f])=>({type:"set_footnote",id:u,blocks:f}));if(n){let u=new Set;for(let f of si(l))for(let p=f;p!==void 0&&n[p]&&!u.has(p);p=n[p].basedOn)u.add(p);for(let f of u)r.styles?.[f]||c.push({type:"set_style",id:f,style:n[f]})}let d=null;return l.length===1&&l[0].type==="table"&&(d=wm(r,o,l[0])),d??(d=km(r,o,l)),d&&c.length>0?{...d,ops:[...c,...d.ops]}:d}}var Sm=8;function xm(t,e){let n=e.table,r=n.rows.map((s,i)=>({...s,cells:s.cells.map((a,l)=>{if(a.covered||i<e.row1||i>e.row2||l<e.col1||l>e.col2)return a;let c=a.blocks[0],d=Ae(c)?{...ct(c.id),...c.align&&{align:c.align},...c.format&&{format:c.format}}:ct(c.id);return{...a,blocks:[d]}})})),o=wa(e)[0].cell.blocks[0];return{ops:[{type:"replace_block",id:n.id,block:{...n,rows:r}}],selection:j(o.id,0)}}function _u(t,e){let n=bt(t,e);if(n)return xm(t,n);let r=pr(t,e),{start:o}=r,{end:s}=r;if(s.offset===0&&o.block!==s.block&&tn(t,s.block).type==="table"){let{list:m}=Ze(t),g=m[An(t,s.block)-1];g&&An(t,g.id)>=An(t,o.block)&&(s={block:g.id,offset:Pt(g)},e={anchor:o,focus:s})}let i=[];if(o.block===s.block){let m=tn(t,o.block);return _(m)&&s.offset>o.offset&&i.push({type:"delete_text",block:m.id,from:o.offset,to:s.offset}),{ops:i,selection:j(m.id,o.offset)}}let a=Ye(t,e,{raw:!0}),l=a[0].block,c=a[a.length-1].block,d=Oe(t,o.block),u=Oe(t,s.block),f=d.list===u.list&&_(l)&&_(c),p=new Set;for(let{block:m}of a)m.type==="table"&&d.cell?.table.id!==m.id&&u.cell?.table.id!==m.id&&p.add(m.id);for(let{block:m,from:g,to:y}of a){if(m.type==="table"){p.has(m.id)&&i.push({type:"delete_block",id:m.id});continue}let b=Oe(t,m.id).cell;if(!(b&&p.has(b.table.id)))if(!_(m))i.push({type:"delete_block",id:m.id});else if(m.id===l.id){let k=q(m.runs);k>g&&i.push({type:"delete_text",block:m.id,from:g,to:k})}else m.id===c.id?!f&&y>0&&i.push({type:"delete_text",block:m.id,from:0,to:y}):i.push({type:"delete_block",id:m.id})}if(f&&_(l)&&_(c)){let m=me(c.runs,s.offset,q(c.runs));i.push({type:"delete_block",id:c.id}),m.length>0&&i.push({type:"insert_text",block:l.id,offset:o.offset,runs:m})}return ns(t,i,j(o.block,o.offset))}function on(t,e){let{start:n}=pr(t,e);if(Se(e))return{ops:[],doc:t,at:n};let r=_u(t,e);return{ops:r.ops,doc:Dn(t,r.ops),at:r.selection.focus}}function In(t,e){if(e===0){let o=zt(t.runs,0);if(!o)return;let{link:s,field:i,footnote:a,...l}=o;return Object.keys(l).length>0?l:void 0}let n=zt(t.runs,e-1);if(!n)return;let r={...n};return delete r.field,delete r.footnote,r.link&&zt(t.runs,e)?.link!==r.link&&delete r.link,Object.keys(r).length>0?r:void 0}function vm(t,e){let n=t.charCodeAt(e-1),r=e>=2?t.charCodeAt(e-2):0;return n>=56320&&n<=57343&&r>=55296&&r<=56319?2:1}function Cm(t,e){let n=t.charCodeAt(e),r=t.charCodeAt(e+1);return n>=55296&&n<=56319&&r>=56320&&r<=57343?2:1}function mo(){return(t,e)=>Se(e)?null:_u(t,e)}function ho(t,e){return(n,r)=>{if(t==="")return mo()(n,r);let o=on(n,r),s=tn(o.doc,o.at.block);if(!_(s))return null;let i=e??In(s,o.at.offset),a=i?{text:t,marks:i}:{text:t};return{ops:[...o.ops,{type:"insert_text",block:s.id,offset:o.at.offset,runs:[a]}],selection:j(s.id,o.at.offset+t.length)}}}function gi(){return(t,e)=>{let n=on(t,e),r=tn(n.doc,n.at.block),o=n.ops;if(!_(r)){let d={id:D("b_"),type:"paragraph",runs:[]};return{ops:[...o,{type:"insert_block",block:d,after:r.id}],selection:j(d.id,0)}}let s=q(r.runs),i=n.at.offset;if(r.type==="code_block")return{ops:[...o,{type:"insert_text",block:r.id,offset:i,runs:[{text:`
`}]}],selection:j(r.id,i+1)};if(s===0&&r.type==="list_item"){let d=r.depth>0?{...r,depth:r.depth-1}:{id:r.id,type:"paragraph",runs:[]};return{ops:[...o,{type:"replace_block",id:r.id,block:d}],selection:j(r.id,0)}}if(s===0&&r.type==="quote")return{ops:[...o,{type:"replace_block",id:r.id,block:{id:r.id,type:"paragraph",runs:[]}}],selection:j(r.id,0)};let a=me(r.runs,i,s),l=D("b_"),c;switch(r.type){case"heading":case"title":case"subtitle":c=i===s?{id:l,type:"paragraph",runs:a,...r.align&&{align:r.align}}:{...r,id:l,runs:a};break;case"list_item":{let{start:d,...u}=r;c={...u,id:l,runs:a};break}case"paragraph":c={...r,id:l,runs:a};break;case"quote":c={...r,id:l,runs:a};break}return i<s&&o.push({type:"delete_text",block:r.id,from:i,to:s}),o.push({type:"insert_block",block:c,after:r.id}),{ops:o,selection:j(l,0)}}}function Iu(t,e){let n=[];return e.runs.length>0&&n.push({type:"insert_text",block:t.id,offset:q(t.runs),runs:e.runs}),n.push({type:"delete_block",id:e.id}),n}function Lu(t,e,n){let r=[],o=e+n;for(;t[o]&&Xe(t[o]);)r.push(t[o]),o+=n;return n<0&&r.reverse(),{block:t[o],floats:r,at:o}}function Uu(t,e,n){if(n.length===0)return[];let r=n.map(a=>({type:"delete_block",id:a.id})),o=new Set(n.map(a=>a.id)),s;for(let a=e-1;a>=0&&!s;a--)o.has(t[a].id)||(s=t[a]);let i=s?s.id:null;for(let a of n)r.push({type:"insert_block",block:a,after:i}),i=a.id;return r}function Pm(t,e){let{block:n}=e;if(e.cell&&e.list.length===1)return{ops:[{type:"replace_block",id:n.id,block:ct(n.id)}],selection:j(n.id,0)};let r=e.list[e.index-1],o=e.list[e.index+1],s=r?ni(r):o?nn(o):null;return ns(t,[{type:"delete_block",id:n.id}],s?j(s.block,s.offset):j(n.id,0))}function go(){return(t,e)=>{if(!Se(e))return mo()(t,e);let n=e.focus,r=Oe(t,n.block),o=r.block,s=Lu(r.list,r.index,-1),i=s.block;if(!_(o))return Pm(t,r);if(n.offset>0){let l=vm(H(o.runs),n.offset);return{ops:[{type:"delete_text",block:o.id,from:n.offset-l,to:n.offset}],selection:j(o.id,n.offset-l)}}if(o.type==="list_item"){let l=o.depth>0?{...o,depth:o.depth-1}:{id:o.id,type:"paragraph",runs:o.runs};return{ops:[{type:"replace_block",id:o.id,block:l}],selection:j(o.id,0)}}if(o.type!=="paragraph"){let l={id:o.id,type:"paragraph",runs:o.runs};return{ops:[{type:"replace_block",id:o.id,block:l}],selection:j(o.id,0)}}if(!i||i.type==="table")return null;if(!_(i))return{ops:[{type:"delete_block",id:i.id}],selection:j(o.id,0)};let a=r.list.indexOf(i);return{ops:[...Iu(i,o),...Uu(r.list,a,s.floats)],selection:j(i.id,q(i.runs))}}}function bs(){return(t,e)=>{if(!Se(e))return mo()(t,e);let n=e.focus,r=Oe(t,n.block),o=r.block,s=Lu(r.list,r.index,1),i=s.block;if(!_(o))return go()(t,e);let a=q(o.runs);if(n.offset<a){let l=Cm(H(o.runs),n.offset);return{ops:[{type:"delete_text",block:o.id,from:n.offset,to:n.offset+l}],selection:j(o.id,n.offset)}}if(i?.type==="table"&&a===0&&o.type==="paragraph"){let l=nn(i);return l?{ops:[{type:"delete_block",id:o.id}],selection:j(l.block,l.offset)}:null}return!i||i.type==="table"?null:_(i)?{ops:[...Iu(o,i),...Uu(r.list,r.index,s.floats)],selection:j(o.id,n.offset)}:{ops:[{type:"delete_block",id:i.id}],selection:j(o.id,n.offset)}}}function br(t,e){let n=[];for(let{block:r,from:o,to:s}of Ye(t,e))_(r)&&r.type!=="code_block"&&s>o&&n.push({block:r,from:o,to:s});return n}function ks(t){return(e,n)=>{let r=br(e,n);return r.length===0?null:{ops:r.map(o=>({type:"format_text",block:o.block.id,from:o.from,to:o.to,patch:t})),selection:n}}}var Bm={superscript:"subscript",subscript:"superscript"};function Ja(t,e){let n={[t]:e?!0:null},r=Bm[t];return e&&r&&(n[r]=null),n}function ju(t){return(e,n)=>{let r=br(e,n);if(r.length===0)return null;let o=r.every(s=>Ys(s.block.runs,s.from,s.to,t));return ks(Ja(t,!o))(e,n)}}function zu(t,e){return t.type!==e.type?!1:t.type==="heading"&&e.type==="heading"?t.level===e.level:t.type==="list_item"&&e.type==="list_item"?t.list===e.list:!0}function Mm(t,e){let n=t.id,r=Ae(t)?{...t.align&&{align:t.align},...t.format&&{format:t.format},...e.type==="list_item"&&t.style&&{style:t.style}}:{};switch(e.type){case"paragraph":return{id:n,type:"paragraph",runs:t.runs,...r};case"title":return{id:n,type:"title",runs:t.runs,...r};case"subtitle":return{id:n,type:"subtitle",runs:t.runs,...r};case"heading":return{id:n,type:"heading",level:e.level,runs:t.runs,...r};case"quote":return{id:n,type:"quote",runs:t.runs,...r};case"code_block":{let o=H(t.runs);return{id:n,type:"code_block",runs:o===""?[]:[{text:o}],...e.language&&{language:e.language}}}case"list_item":{let o=t.type==="list_item"&&t.list===e.list;return{id:n,type:"list_item",list:e.list,depth:t.type==="list_item"?t.depth:0,...o&&t.type==="list_item"&&t.marker&&{marker:t.marker},...o&&t.type==="list_item"&&t.start!==void 0&&{start:t.start},runs:t.runs,...r}}}}function Gu(t,e){return Ge(t,e).filter(_)}function hi(t){return(e,n)=>{let r=Gu(e,n).filter(o=>!zu(o,t)||t.type!=="list_item"&&Ae(o)&&o.style).map(o=>({type:"replace_block",id:o.id,block:Mm(o,t)}));return r.length>0?{ops:r,selection:n}:null}}function Hu(t){return(e,n)=>{let r=Gu(e,n);return r.length>0&&r.every(o=>zu(o,t))?hi({type:"paragraph"})(e,n):hi(t)(e,n)}}var Ku=36,Om=720;function yi(){return(t,e)=>{let n=Ye(t,e)[0];if(!n)return null;let r=Oe(t,n.block.id),o=r.list[r.index-1],s=o?.type==="list_item"?o.depth:-1,i=[];for(let a of Ge(t,e)){if(a.type!=="list_item"){s=-1;let c=Xu(a,Ku);c&&i.push({type:"replace_block",id:a.id,block:c});continue}let l=Math.min(a.depth+1,s+1,Sm);l>a.depth&&i.push({type:"replace_block",id:a.id,block:{...a,depth:l}}),s=Math.max(l,a.depth)}return i.length>0?{ops:i,selection:e}:null}}function bi(){return(t,e)=>{let n=[];for(let r of Ge(t,e)){if(r.type!=="list_item"){let s=Xu(r,-Ku);s&&n.push({type:"replace_block",id:r.id,block:s});continue}let o=r.depth>0?{...r,depth:r.depth-1}:{id:r.id,type:"paragraph",runs:r.runs,...r.align&&{align:r.align},...r.format&&{format:r.format}};n.push({type:"replace_block",id:r.id,block:o})}return n.length>0?{ops:n,selection:e}:null}}function Wu(t,e){let n=[];for(let r of Ge(t,e)){if(r.type!=="list_item")continue;let o=Oe(t,r.id);n.push({item:r,list:o.list,index:o.index})}return n}function qu(t){return(e,n)=>{let r=[],o=new Set;for(let{item:s,list:i,index:a}of Wu(e,n))if(!(t&&!(s.list==="bullet"?rn:$n).includes(t)))for(let l of Ua(i,a)){let c=i[l];if(o.has(c.id))continue;o.add(c.id);let d=t&&t!==He(c.list,c.depth)?t:void 0;if(c.marker===d)continue;let{marker:u,...f}=c;r.push({type:"replace_block",id:c.id,block:d?{...f,marker:d}:f})}return r.length>0?{ops:r,selection:n}:null}}function Za(t){return(e,n)=>{if(t!==null&&(!Number.isInteger(t)||t<0||t>99999))return null;let r=Wu(e,n).filter(({item:s})=>s.list==="ordered"),o=[];for(let{item:s,list:i,index:a}of t===null?r:r.slice(0,1)){if(s.start===(t??void 0))continue;let l=Ua(i,a)[0]===a,{start:c,...d}=s,u=t!==null&&!(t===1&&l);!u&&s.start===void 0||o.push({type:"replace_block",id:s.id,block:u?{...d,start:t}:d})}return o.length>0?{ops:o,selection:n}:null}}function Xu(t,e){if(!Ae(t)||t.type==="title"||t.type==="subtitle")return null;let n=t.format?.indentLeft??0,r=Math.min(Om,Math.max(0,n+e));if(r===n)return null;let{indentLeft:o,...s}=t.format??{},i=r===0?s:{...s,indentLeft:r},{format:a,...l}=t;return Object.keys(i).length>0?{...l,format:i}:l}function Vu(t){return(e,n)=>{let r=[];for(let o of Ge(e,n)){if(!Ae(o)&&o.type!=="image"||(o.align??"left")===t)continue;let{align:s,...i}=o;r.push({type:"replace_block",id:o.id,block:t==="left"?i:{...i,align:t}})}return r.length>0?{ops:r,selection:n}:null}}function Ya(t){return(e,n)=>{let r=[];for(let o of Ge(e,n)){if(!Ae(o))continue;let s={...o.format};for(let[c,d]of Object.entries(t))d==null?delete s[c]:s[c]=d;let{format:i,...a}=o;JSON.stringify(s)!==JSON.stringify(o.format??{})&&r.push({type:"replace_block",id:o.id,block:Object.keys(s).length>0?{...a,format:s}:a})}return r.length>0?{ops:r,selection:n}:null}}var Am={bold:null,italic:null,underline:null,strike:null,code:null,superscript:null,subscript:null,color:null,highlight:null,fontFamily:null,fontSize:null,style:null};function Ju(){return(t,e)=>{let n=[];for(let r of br(t,e))n.push({type:"format_text",block:r.block.id,from:r.from,to:r.to,patch:Am});for(let r of Ge(t,e))!Ae(r)||!r.align&&!r.format&&!r.style||n.push({type:"update_block",id:r.id,patch:{align:null,format:null,style:null}});return n.length>0?{ops:n,selection:e}:null}}function ws(t,e={}){return(n,r)=>{let o=on(n,r),s=Oe(o.doc,o.at.block),i=s.block;if(s.cell&&t.type!=="image"&&t.type!=="divider")return null;let a=[...o.ops],l=o.doc,c,d,u=_(i)&&i.type==="paragraph"&&q(i.runs)===0&&(e.replaceEmpty??(!!s.cell&&t.type==="image")),f=e.trailingParagraph??!(u&&s.cell);if(!_(i))c=i.id;else{let b=q(i.runs),k=o.at.offset;if(k===0){let T=s.list[s.index-1];c=T?T.id:null,!T&&s.cell&&(d=s.cell.cell.id)}else if(k>=b)c=i.id;else{let T=gi()(l,j(i.id,k));a.push(...T.ops),l=Dn(l,T.ops),c=i.id}}let p={type:"insert_block",block:t,after:c,...d!==void 0&&{cell:d}};if(a.push(p),l=Dn(l,[p]),u){let b={type:"delete_block",id:i.id};a.push(b),l=Dn(l,[b])}let m=Oe(l,t.id),g=m.list[m.index+1];if(g&&_(g))return{ops:a,selection:j(g.id,0)};if(!f)return{ops:a,selection:j(t.id,0)};let y=ct();return a.push({type:"insert_block",block:y,after:t.id}),{ops:a,selection:j(y.id,0)}}}function Zu(t){return(e,n)=>{let r=on(e,n),o=X(r.doc,r.at.block);if(!o)return null;let s=r.doc.blocks[o.topIndex-1],i={type:"insert_block",block:t,after:s?s.id:null},a=[...r.ops,i];return t.type==="table"?{ops:a,selection:nn(t)?j(nn(t).block,0):n}:{ops:a,selection:j(t.id,0)}}}function Yu(t,e,n){return(r,o)=>{let s=Ta(t,e,n),i=ws(s)(r,o);if(!i)return null;let a=nn(s);return a?{ops:i.ops,selection:j(a.block,0)}:i}}function Qu(t){return(e,n)=>{let r=Ta(1,t,{borders:"none"}),o=t===2?["left","right"]:["left","center","right"];r.rows[0].cells.forEach((a,l)=>{let c=a.blocks[0];c.type==="paragraph"&&o[l]!=="left"&&(c.align=o[l])});let s=ws(r,{replaceEmpty:!0,trailingParagraph:!1})(e,n);if(!s)return null;let i=nn(r);return i?{ops:s.ops,selection:j(i.block,0)}:s}}function ed(t,e){return(n,r)=>{let o=on(n,r),s=tn(o.doc,o.at.block);if(!_(s)||s.type==="code_block")return null;let i=e&&e.length>0?e:[ct()],a={text:Fn,marks:{footnote:t}};return{ops:[...o.ops,{type:"insert_text",block:s.id,offset:o.at.offset,runs:[a]},{type:"set_footnote",id:t,blocks:i}],selection:j(s.id,o.at.offset+1)}}}function td(t){return(e,n)=>{let r=os(ao(e,Oe(e,n.focus.block).topIndex));return ws(is(t,r))(e,n)}}function nd(t){return(e,n)=>{let r=t&&t.count>1?os(gr(t)):void 0,o=(y,b)=>JSON.stringify(y??null)===JSON.stringify(b??null),s=y=>{let{columns:b,...k}=y;return r?{...k,columns:r}:k},i=()=>{let y=Ht(e);if(o(y.columns,r))return null;let{columns:b,...k}=y;return{type:"set_page",page:r?{...k,columns:r}:k}},a=Ye(e,n).map(y=>Oe(e,y.block.id).topIndex),l=Math.min(...a),c=Math.max(...a);for(;l<c&&e.blocks[l].type==="section_break";)l++;for(;c>l&&e.blocks[c].type==="section_break";)c--;if(Se(n)||l===c&&e.blocks[l].type==="section_break"){let y=$a(e,l);if(y.start)return o(y.start.columns,r)?null:{ops:[{type:"replace_block",id:y.start.id,block:s(y.start)}],selection:n};let b=i();return b?{ops:[b],selection:n}:null}let d=[],u=os(ao(e,c)),f=e.blocks[c],p=e.blocks[c+1];p&&p.type!=="section_break"&&!o(u,r)&&d.push({type:"insert_block",block:is("continuous",u),after:f.id});for(let y=l+1;y<=c;y++){let b=e.blocks[y];b.type==="section_break"&&!o(b.columns,r)&&d.push({type:"replace_block",id:b.id,block:s(b)})}let m=e.blocks[l],g=e.blocks[l-1];if(m.type==="section_break")o(m.columns,r)||d.push({type:"replace_block",id:m.id,block:s(m)});else if(g?.type==="section_break")o(g.columns,r)||d.push({type:"replace_block",id:g.id,block:s(g)});else if(l===0){let y=i();y&&d.push(y)}else o(os(ao(e,l)),r)||d.push({type:"insert_block",block:is("continuous",r),after:g.id});return d.length>0?{ops:d,selection:n}:null}}function rd(t){return(e,n)=>{let r=on(e,n),o=tn(r.doc,r.at.block);if(!_(o))return null;let{link:s,...i}=In(o,r.at.offset)??{},a={text:"1",marks:{...i,field:t}};return{ops:[...r.ops,{type:"insert_text",block:o.id,offset:r.at.offset,runs:[a]}],selection:j(o.id,r.at.offset+1)}}}function od(t,e){return(n,r)=>Se(r)?t?ho(e||t,{link:t})(n,r):null:ks({link:t})(n,r)}function sd(t){return(e,n)=>{if(t==="")return mo()(e,n);let r=t.replace(/\r\n?/g,`
`).split(`
`),o=on(e,n),s=[...o.ops],i=o.doc,a=o.at,l=c=>{let d=c(i,j(a.block,a.offset));d&&(s.push(...d.ops),i=Dn(i,d.ops),a=d.selection.focus)};return r.forEach((c,d)=>{d>0&&l(gi()),c!==""&&l(ho(c))}),{ops:s,selection:j(a.block,a.offset)}}}function id(t){return(e,n)=>{if(t!==null&&e.styles?.[t]?.kind!=="paragraph")return null;let r=[];for(let o of Ge(e,n)){if(!Ae(o)||(o.style??null)===t&&(t===null||!o.align&&!o.format))continue;let i={style:t};t!==null&&Object.assign(i,{align:null,format:null}),r.push({type:"update_block",id:o.id,patch:i})}return r.length>0?{ops:r,selection:n}:null}}function ad(t){return(e,n)=>t!==null&&e.styles?.[t]?.kind!=="character"?null:ks({style:t})(e,n)}function Va(t,e,n){let r={},o=me(t,e,n).filter(s=>s.text!=="");if(o.length===0)return r;for(let s of ri){let i=o[0].marks?.[s];i!==void 0&&o.every(a=>a.marks?.[s]===i)&&(r[s]=i)}return r}function Nu(t,e){let n={...t,...e};for(let r of Object.keys(n))n[r]===!1&&delete n[r];return Object.keys(n).length>0?n:void 0}function Qa(t){return(e,n)=>{let r=[];if(t.kind==="paragraph"){let o=Ge(e,n).filter(Ae),s=o[0];if(!s)return null;let i=Va(s.runs,0,q(s.runs)),a=so(e,s.style),l=Gt(e,s),c=Nu(a?.marks,i),d={name:t.name,kind:"paragraph",...t.basedOn&&{basedOn:t.basedOn},...c&&{marks:c},...l.align&&{align:l.align},...l.format&&{format:l.format}};r.push({type:"set_style",id:t.id,style:d});for(let u of o){r.push({type:"update_block",id:u.id,patch:{style:t.id,align:null,format:null}});let f=q(u.runs),p=Object.keys(Va(u.runs,0,f)).filter(m=>m in i);p.length>0&&f>0&&r.push({type:"format_text",block:u.id,from:0,to:f,patch:Object.fromEntries(p.map(m=>[m,null]))})}}else{let o=br(e,n);if(o.length===0)return null;let s=o.map(f=>Va(f.block.runs,f.from,f.to)),i=Object.fromEntries(Object.entries(s[0]).filter(([f,p])=>s.every(m=>m[f]===p))),a=new Set(o.flatMap(f=>me(f.block.runs,f.from,f.to).map(p=>p.marks?.style))),l=a.size===1?so(e,[...a][0])?.marks:void 0,c=Nu(l,i),d={name:t.name,kind:"character",...t.basedOn&&{basedOn:t.basedOn},...c&&{marks:c}};r.push({type:"set_style",id:t.id,style:d});let u=Object.fromEntries(Object.keys(i).map(f=>[f,null]));for(let f of o)r.push({type:"format_text",block:f.block.id,from:f.from,to:f.to,patch:{...u,style:t.id}})}return{ops:r,selection:n}}}function ld(t){return(e,n)=>{let r=e.styles?.[t];if(!r)return null;let o=[];for(let[i,a]of Object.entries(e.styles??{})){if(a.basedOn!==t)continue;let{basedOn:l,...c}=a;o.push({type:"set_style",id:i,style:r.basedOn?{...c,basedOn:r.basedOn}:c})}let s=i=>{for(let a of i){if(a.type==="table"&&a.rows.forEach(c=>c.cells.forEach(d=>s(d.blocks))),!("runs"in a))continue;Ae(a)&&a.style===t&&o.push({type:"update_block",id:a.id,patch:{style:null}});let l=0;for(let c of a.runs){let d=c.text.length;c.marks?.style===t&&d>0&&o.push({type:"format_text",block:a.id,from:l,to:l+d,patch:{style:null}}),l+=d}}};return s(e.blocks),o.push({type:"set_style",id:t,style:null}),{ops:o,selection:n}}}function dd(t){return Ze(t).list.filter(e=>_(e)&&e.type!=="code_block"&&!e.id.endsWith("~empty"))}function wi(t){let e=new Map;for(let n of dd(t)){let r=0;for(let o of n.runs){let s=o.marks?.suggest;if(s){let i=e.get(s.id);i?i.text=(i.text+o.text).slice(0,200):e.set(s.id,{...s,text:o.text.slice(0,200),block:n.id,from:r})}r+=o.text.length}}return[...e.values()]}function Tm(t,e){let n=[];for(let r of dd(t)){let o=0,s=null;for(let i of r.runs){let a=o+i.text.length,l=i.marks?.suggest;l&&e(l)?s&&s.suggest.id===l.id&&s.to===o?s.to=a:n.push(s={block:r.id,from:o,to:a,suggest:l}):s=null,o=a}}return n}function fd(t,e,n=()=>!0){let o=Tm(t,typeof n=="string"?a=>a.id===n:n);o.sort((a,l)=>a.block===l.block?l.from-a.from:0);let s=new Map;for(let a of o)s.set(a.block,[...s.get(a.block)??[],a]);let i=[];for(let a of s.values())for(let l of a){let c=e==="accept"?l.suggest.kind==="delete":l.suggest.kind==="insert";i.push(c?{type:"delete_text",block:l.block,from:l.from,to:l.to}:{type:"format_text",block:l.block,from:l.from,to:l.to,patch:{suggest:null}})}return i}function ys(t){let e=n=>n.map(r=>{if(!r.marks?.suggest)return r;let{suggest:o,...s}=r.marks;return Object.keys(s).length>0?{...r,marks:s}:{text:r.text}});return t.map(n=>n.type==="table"?{...n,rows:n.rows.map(r=>({...r,cells:r.cells.map(o=>({...o,blocks:ys(o.blocks)}))}))}:"runs"in n&&n.runs.some(r=>r.marks?.suggest)?{...n,runs:e(n.runs)}:n)}var Ss=t=>t?.suggest;function ki(t,e,n,r){let{end:o}=pr(t,e),s=r??{id:n.newId(),kind:"delete",by:n.by,at:n.at},i=[],a=[],l=0;for(let{block:c,from:d,to:u}of Ye(t,e,{raw:!0})){if(!_(c)||u<=d)continue;if(c.type==="code_block"){a.push({type:"delete_text",block:c.id,from:d,to:u}),c.id===o.block&&(l+=u-d);continue}let f=d,p=[];for(let m of me(c.runs,d,u)){let g=f+m.text.length,y=Ss(m.marks);if(y?.kind!=="delete")if(y?.kind==="insert"&&y.by===n.by)p.push([f,g]);else{let b=i[i.length-1];b&&b.type==="format_text"&&b.block===c.id&&b.to===f?b.to=g:i.push({type:"format_text",block:c.id,from:f,to:g,patch:{suggest:s}})}f=g}for(let[m,g]of p.reverse())a.push({type:"delete_text",block:c.id,from:m,to:g}),c.id===o.block&&(l+=g-m)}return i.length===0&&a.length===0?null:{ops:[...i,...a],end:{block:o.block,offset:o.offset-l}}}function el(t,e,n){return(r,o)=>{if(t==="")return xs("selection",e)(r,o);let s=[],i=r,a=pr(r,o).end;if(!Se(o)){let p=ki(r,o,e);p&&(s=p.ops,i=Dn(r,s),a=p.end)}let l=tn(i,a.block);if(!_(l))return null;if(l.type==="code_block")return ho(t,n)(r,o);let c=a.offset>0?Ss(zt(l.runs,a.offset-1)):void 0,d=c?.kind==="insert"&&c.by===e.by?c:void 0,u={...n??In(l,a.offset)};delete u.suggest;let f=d??{id:e.newId(),kind:"insert",by:e.by,at:e.at};return{ops:[...s,{type:"insert_text",block:l.id,offset:a.offset,runs:[{text:t,marks:{...u,suggest:f}}]}],selection:j(l.id,a.offset+t.length)}}}var ud=(t,e)=>Ss(zt(t.runs,e))?.kind==="delete";function xs(t,e){return(n,r)=>{if(!Se(r)){let g=ki(n,r,e);return g?{ops:g.ops,selection:j(g.end.block,g.end.offset)}:null}if(t==="selection")return null;let o=r.focus,s=Oe(n,o.block).block;if(!_(s)||s.type==="code_block")return t==="backspace"?go()(n,r):bs()(n,r);let i=H(s.runs),a=q(s.runs);if(t==="backspace"){let g=o.offset;for(;g>0&&ud(s,g-1);)g--;if(g===0)return o.offset>0?{ops:[],selection:j(s.id,0)}:go()(n,r);let y=i.charCodeAt(g-1),b=g>=2?i.charCodeAt(g-2):0,k=y>=56320&&y<=57343&&b>=55296&&b<=56319?2:1,T={anchor:{block:s.id,offset:g-k},focus:{block:s.id,offset:g}},I=g<a?Ss(zt(s.runs,g)):void 0;return{ops:ki(n,T,e,I?.kind==="delete"&&I.by===e.by?I:void 0)?.ops??[],selection:j(s.id,g-k)}}let l=o.offset;for(;l<a&&ud(s,l);)l++;if(l>=a)return o.offset<a?{ops:[],selection:j(s.id,a)}:bs()(n,r);let c=i.charCodeAt(l),d=i.charCodeAt(l+1),u=c>=55296&&c<=56319&&d>=56320&&d<=57343?2:1,f={anchor:{block:s.id,offset:l},focus:{block:s.id,offset:l+u}},p=l>0?Ss(zt(s.runs,l-1)):void 0,m=ki(n,f,e,p?.kind==="delete"&&p.by===e.by?p:void 0);return{ops:m?.ops??[],selection:j(s.id,m?.end.offset??l+u)}}}var Si=(t,e)=>JSON.stringify(t)===JSON.stringify(e);function pd(t){let e=[];for(let n of t){let r=e[e.length-1];r&&Si(r[1],n.marks?.comment)?r[0]+=n.text.length:e.push([n.text.length,n.marks?.comment])}return e}function Rm(t,e,n){let r=X(t,e);if(!r)throw new C("not_found",`No block with id "${e}"`);if(n.id!==e)throw new C("invalid_operation","replace_block must keep the block id");let o=r.block,s=[];if(_(o)&&_(n)){let c=he(o.runs),d=he(n.runs);if(!Si(c,d)){let u=f=>f.map(p=>p.text).join("");if(u(c)===u(d)){if(!Si(pd(c),pd(d)))return[{type:"replace_block",id:e,block:n}];s.push({type:"restore_marks",block:e,from:0,to:q(d),segments:Yo(d,0,q(d))})}else q(c)>0&&s.push({type:"delete_text",block:e,from:0,to:q(c)}),q(d)>0&&s.push({type:"insert_text",block:e,offset:0,runs:d})}}else if(_(o)!==_(n))return[{type:"replace_block",id:e,block:n}];let i={},a=o,l=n;for(let c of new Set([...Object.keys(a),...Object.keys(l)]))c==="id"||c==="runs"||Si(a[c],l[c])||(i[c]=l[c]===void 0?null:l[c]);return Object.keys(i).length>0&&s.push(hd(t,{type:"update_block",id:e,patch:i})),s}function md(t,e){let n=s=>s.type==="replace_block"||s.type==="delete_block"&&s.after===void 0||s.type==="update_block"&&Array.isArray(s.patch.rows)&&s.within===void 0;if(!e.some(n))return e;let r=[],o=t;for(let s of e){let i=s.type==="replace_block"?Rm(o,s.id,s.block):s.type==="delete_block"&&s.after===void 0?[Dm(o,s)]:s.type==="update_block"?[hd(o,s)]:[s];for(let a of i)o=Rn.apply(o,a).state;r.push(...i)}return r}function Dm(t,e){let n=X(t,e.id);if(!n)return e;let r=n.list[n.index-1],o=[...de([n.block])].filter(s=>s!==e.id);return{type:"delete_block",id:e.id,after:r?r.id:null,...!r&&n.cell?{cell:n.cell.cell.id}:{},...o.length>0?{within:o}:{}}}function hd(t,e){if(!Array.isArray(e.patch.rows)||e.within!==void 0)return e;let n=X(t,e.id);if(!n)return e;let r=[...de([n.block])].filter(o=>o!==e.id);return r.length>0?{...e,within:r}:e}function Fm(t){switch(t.type){case"insert_text":case"delete_text":case"format_text":case"restore_marks":case"comment_text":case"set_runs":return t.block;case"update_block":case"replace_block":return t.id;default:return null}}function Em(t,e){switch(t.type){case"insert_text":case"delete_text":case"format_text":case"restore_marks":case"comment_text":case"set_runs":return{...t,block:e};case"update_block":return{...t,id:e};case"replace_block":return{...t,id:e,block:{...t.block,id:e}};default:return t}}function gd(t,e){let n=new Map,r=[];for(let o of e){let s=Fm(o);if(s!==null&&!n.has(s)&&s.endsWith("~empty")){let i=X(t,s);if(i?.cell&&i.list.length===1&&_(i.block)&&q(i.block.runs)===0){let a=D("b_");n.set(s,a),r.push({type:"insert_block",block:{id:a,type:"paragraph",runs:[]},after:null,cell:i.cell.cell.id})}}r.push(s!==null&&n.has(s)?Em(o,n.get(s)):o)}return{ops:r,renames:n}}function $m(t,e){let n=_m(t,e);if(n)return n;if(t.type==="insert_text"||t.type==="delete_text"||yo(t))return(e.type==="insert_text"||e.type==="delete_text"||yo(e))&&vd(t)===vd(e)?Lm(t,e):[[t],[e]];if(t.type==="insert_block"&&e.type==="insert_block"&&t.block.id===e.block.id){let o=[...de([e.block])].filter(i=>i!==e.block.id);return[[{type:"delete_block",id:e.block.id,after:e.after,...e.cell!==void 0?{cell:e.cell}:{},...o.length>0?{within:o}:{}},t],[]]}if(t.type==="insert_block"&&e.type==="insert_block"){if(t.after===e.after&&(t.after!==null||t.cell===e.cell)){let{cell:s,...i}=t;return[[{...i,after:e.block.id}],[e]]}return[[t],[e]]}if(t.type==="update_block"&&e.type==="update_block"&&t.id===e.id){let o=Object.fromEntries(Object.entries(e.patch).filter(([i])=>!(i in t.patch))),s=Object.keys(o).length>0?[{...e,patch:o}]:[];return[["rows"in t.patch&&"rows"in e.patch?nl(t,e):t].flat(),s]}return t.type==="delete_block"&&e.type==="delete_block"&&t.id!==e.id?[[t.after===e.id?kd(t,e):t],[e.after===t.id?kd(e,t):e]]:t.type==="delete_block"&&e.type==="insert_block"&&yd(e,t)?[[bd(t,e.block.id)],[e]]:t.type==="insert_block"&&e.type==="delete_block"&&yd(t,e)?[[t],[bd(e,t.block.id)]]:Im(t,e)?[[t],[]]:[[t],[e]]}function Ln(t,e){if(t.length===0||e.length===0)return[[...t],[...e]];if(t.length===1&&e.length===1)return $m(t[0],e[0]);if(t.length>1){let[c,...d]=t,[u,f]=Ln([c],e),p=rl(c,u,d,f),[m,g]=Ln(p.kept,f);return[[...u,...m],tl(g,p.dropped)]}let[n,...r]=e,[o,s]=Ln(t,[n]),i=rl(n,s,r,o),[a,l]=Ln(o,i.kept);return[tl(a,i.dropped),[...s,...l]]}function tl(t,e){return e.length===0?t:t.map(n=>{let r=ol(n);if(!r||n.type!=="delete_block"&&n.type!=="update_block")return n;let o=new Set(n.within??[]),s=i=>i===r.self||r.covered.has(i)||o.has(i);for(let i of e)if(il(i).some(s))for(let a of xi(i))o.add(a);return o.size===(n.within?.length??0)?n:{...n,within:[...o]}})}function yd(t,e){return e.after===void 0?!1:t.after===e.after&&(t.after!==null||t.cell===e.cell)}function bd(t,e){let{cell:n,...r}=t;return{...r,after:e}}function kd(t,e){let{cell:n,...r}=t,o=e.after??null;return o===null&&e.cell!==void 0?{...r,after:null,cell:e.cell}:{...r,after:o}}function nl(t,e){let n=Nm(e);return n.size===0?t:t.type==="delete_block"||t.type==="update_block"&&Array.isArray(t.patch.rows)?{...t,within:[...new Set([...t.within??[],...n])]}:t}function Od(t,e,n){let[r,o]=Ln(t,n),s=rl(t,r,[...e],o),[i,a]=Ln(s.kept,o);return{inflight:r,pending:i,incoming:tl(a,s.dropped)}}function wd(t){if(t.type==="insert_block"||t.type==="replace_block")return de([t.block]);if(t.type==="update_block"&&Array.isArray(t.patch.rows)){let e=de([{id:t.id,type:"table",rows:t.patch.rows,columns:[]}]);return e.delete(t.id),e}return new Set}function Nm(t){let e=xi(t);if(t.type==="update_block"||t.type==="delete_block")for(let n of t.within??[])e.add(n);return e}function xi(t){switch(t.type){case"insert_block":return de([t.block]);case"replace_block":return de([t.block]);case"update_block":{if(!Array.isArray(t.patch.rows))return new Set;let e=de([{id:t.id,type:"table",rows:t.patch.rows,columns:[]}]);e.delete(t.id);for(let n of t.within??[])e.delete(n);return e}default:return new Set}}function rl(t,e,n,r=[]){let o=new Set;for(let a of Array.isArray(t)?t:[t])for(let l of xi(a))o.add(l);if(o.size===0)return{kept:n,lost:o,dropped:[]};for(let a of[...e,...r])for(let l of wd(a))o.delete(l);if(o.size===0)return{kept:n,lost:o,dropped:[]};let s=[],i=[];for(let a of n)if(il(a).some(l=>o.has(l))){i.push(a);for(let l of xi(a))o.add(l)}else{s.push(a);for(let l of wd(a))o.delete(l)}return{kept:s,lost:o,dropped:i}}function ol(t){switch(t.type){case"delete_block":return{rank:3,self:t.id,covered:new Set(t.within??[])};case"replace_block":{let e=de([t.block]);return e.delete(t.id),{rank:2,self:t.id,covered:e}}case"set_runs":return{rank:2,self:t.block,covered:new Set};case"update_block":if(Array.isArray(t.patch.rows)){let e=de([{id:t.id,type:"table",rows:t.patch.rows,columns:[]}]);e.delete(t.id);for(let n of t.within??[])e.add(n);return{rank:1,self:null,covered:e}}return null;default:return null}}function il(t){switch(t.type){case"insert_text":case"delete_text":case"format_text":case"restore_marks":case"comment_text":case"set_runs":return[t.block];case"update_block":case"replace_block":case"delete_block":return[t.id];case"insert_block":return[t.after,t.cell].filter(e=>typeof e=="string");default:return[]}}function Sd(t,e){return e.type==="insert_block"?typeof e.after=="string"&&e.after!==t.self&&t.covered.has(e.after)||e.cell!==void 0&&t.covered.has(e.cell):il(e).some(n=>n===t.self||t.covered.has(n))}function _m(t,e){let n=ol(t),r=ol(e),o=!!r&&Sd(r,t),s=!!n&&Sd(n,e);return o&&s&&(n.rank>r.rank?o=!1:r.rank>n.rank?s=!1:n.rank!==3&&(o=!1)),o||s?[o?[]:[s?nl(t,e):t],s?[]:[o?nl(e,t):e]]:t.type==="insert_block"&&e.type==="delete_block"&&t.after===e.id?[[xd(t,e)],[e]]:e.type==="insert_block"&&t.type==="delete_block"&&e.after===t.id?[[t],[xd(e,t)]]:null}function xd(t,e){let{cell:n,...r}=t,o=e.after??null;return o===null&&e.cell!==void 0?{...r,after:null,cell:e.cell}:{...r,after:o}}function Im(t,e){if(t.type!==e.type)return!1;switch(t.type){case"set_title":case"set_page":return!0;case"set_region":return t.region===e.region;case"set_footnote":case"set_thread":case"set_style":return t.id===e.id;default:return!1}}function yo(t){return t.type==="format_text"||t.type==="restore_marks"||t.type==="comment_text"}function vd(t){return"block"in t&&typeof t.block=="string"?t.block:null}var vi=t=>t.runs.reduce((e,n)=>e+n.text.length,0),ko=(t,e,n)=>t<=e?t:t>=n?t-(n-e):e;function Lm(t,e){if(t.type==="insert_text"&&e.type==="insert_text"){let n=e.offset<=t.offset?t.offset+vi(e):t.offset,r=t.offset<e.offset?e.offset+vi(t):e.offset;return[[{...t,offset:n}],[{...e,offset:r}]]}return t.type==="insert_text"&&e.type==="delete_text"?[[{...t,offset:ko(t.offset,e.from,e.to)}],Cd(e,t)]:t.type==="delete_text"&&e.type==="insert_text"?[Cd(t,e),[{...e,offset:ko(e.offset,t.from,t.to)}]]:t.type==="delete_text"&&e.type==="delete_text"?[Pd(t,e),Pd(e,t)]:yo(t)&&e.type==="insert_text"?[Bd(t,e),[e]]:t.type==="insert_text"&&yo(e)?[[t],Bd(e,t)]:yo(t)&&e.type==="delete_text"?[Md(t,e),[e]]:t.type==="delete_text"&&yo(e)?[[t],Md(e,t)]:[[t],Um(e,t)]}function Cd(t,e){let n=vi(e);return e.offset<=t.from?[{...t,from:t.from+n,to:t.to+n}]:e.offset>=t.to?[t]:[{...t,from:e.offset+n,to:t.to+n},{...t,from:t.from,to:e.offset}]}function Pd(t,e){let n=ko(t.from,e.from,e.to),r=ko(t.to,e.from,e.to);return r>n?[{...t,from:n,to:r}]:[]}function bo(t,e,n,r=0){return t.type==="restore_marks"?{...t,from:e+r,to:n+r,segments:sl(t.segments,e-t.from,n-t.from)}:{...t,from:e+r,to:n+r}}function sl(t,e,n){let r=[],o=0;for(let s of t){let i=Math.max(e,o),a=Math.min(n,o+s.length);i<a&&r.push(s.marks?{length:a-i,marks:s.marks}:{length:a-i}),o+=s.length}return r}function Bd(t,e){let n=vi(e);return e.offset<=t.from?[bo(t,t.from,t.to,n)]:e.offset>=t.to?[t]:[bo(t,t.from,e.offset),bo(t,e.offset,t.to,n)]}function Md(t,e){let n=ko(t.from,e.from,e.to),r=ko(t.to,e.from,e.to);if(r<=n)return[];if(t.type!=="restore_marks")return[{...t,from:n,to:r}];let o=Math.max(t.from,e.from)-t.from,s=Math.min(t.to,e.to)-t.from,i=s>o?[...sl(t.segments,0,o),...sl(t.segments,s,t.to-t.from)]:t.segments;return[{...t,from:n,to:r,segments:i}]}function Um(t,e){let n=Math.max(e.from,t.from),r=Math.min(e.to,t.to);if(n>=r)return[t];let o=[];t.from<n&&o.push(bo(t,t.from,n));let s=jm(t,e,n,r);return s&&o.push(s),r<t.to&&o.push(bo(t,r,t.to)),o}function jm(t,e,n,r){let o=bo(t,n,r);if(t.type==="comment_text"||e.type==="comment_text")return t.type==="comment_text"&&e.type==="comment_text"&&t.id===e.id&&t.on!==e.on?null:o;if(e.type==="restore_marks")return null;if(e.type==="format_text"&&t.type==="format_text"){let s=Object.fromEntries(Object.entries(t.patch).filter(([i])=>!(i in e.patch)));return Object.keys(s).length>0?{...o,patch:s}:null}if(e.type==="format_text"&&t.type==="restore_marks"){let s=o.segments.map(i=>{let a=Zo(i.marks,e.patch);return a&&Object.keys(a).length>0?{length:i.length,marks:a}:{length:i.length}});return{...o,segments:zm(s)}}return o}function zm(t){let e=[];for(let n of t){let r=e[e.length-1];r&&Zs(r.marks,n.marks)?r.length+=n.length:e.push({...n})}return e}var Ad=t=>fa(t),vs={apply:(t,e)=>Rn.apply(t,e).state,transform:Ln,rebase:Od,mapMeta:(t,e)=>t&&es(t,e),mapPresence:(t,e)=>{let n=t.selection;if(!n)return t;let r=es(n,e);return r===n?t:{...t,selection:r}},hash:Ad};function al(t){return pa({kind:"document",core:t,model:vs,comments:{get:()=>t.comments,enable:e=>t.enableComments({...e,store:e.store??"document"})}})}var Gm=1e3;function Rd(t="Untitled"){return{id:D("doc_"),type:"document",title:t,blocks:[]}}var ye,an,ut,ln,jn,So,kr,et,cn,xo,Mt,vo,z,sn,Un,wo,Cs,ll,cl,ul,dl,Ci,Pi,Ps,Dd,Bs=class extends Eo{constructor(n=Rd(),r={}){super(n,Rn);E(this,z);E(this,ye);E(this,an,null);E(this,ut,null);E(this,ln,0);E(this,jn,null);E(this,So,new Set);E(this,kr);E(this,et,new Map);E(this,cn,null);E(this,xo,!1);E(this,Mt,null);E(this,vo,!1);v(this,kr,r.storage??null),r.comments&&w(this,z,ll).call(this,r.comments),v(this,Mt,r.suggestions?.users??null),v(this,ye,ti(n,null)),this.subscribe(o=>{nt(this,ln)._++;let s=o.origin==="remote"&&o.meta===void 0&&h(this,ye)?es(h(this,ye),o.ops,o.state):h(this,ye),i=ti(o.state,o.meta!==void 0?o.meta:s);w(this,z,Pi).call(this,i)})}get selection(){return h(this,ye)}get pendingMarks(){return h(this,ut)}get revision(){return h(this,ln)}get comments(){return h(this,cn)}get storage(){return h(this,kr)}setStorage(n){v(this,kr,n),w(this,z,sn).call(this)}uploadState(n){return h(this,et).get(n)?.state}get pendingUploads(){let n=0;for(let r of h(this,et).values())r.state.status==="uploading"&&n++;return n}async whenUploadsSettle(){for(;;){let n=[...h(this,et).values()].filter(r=>r.state.status==="uploading");if(n.length===0)return;await Promise.all(n.map(r=>r.done))}}uploadImage(n,r,o={}){let s=h(this,kr);if(!s)throw new C("unsupported","This document has no storage client to upload to.");let i=h(this,et).get(n);if(i?.state.status==="uploading")return i.done;let a=Gs(),l=this.state,c={file:r,options:o,handle:a,state:{status:"uploading",progress:0},done:Promise.resolve({status:"gone",merged:!1})};h(this,et).set(n,c),w(this,z,sn).call(this);let d=0;return c.done=(async()=>{try{let u=await s.upload(r,{...o,signal:a.signal,onProgress:m=>{m-d<.05&&m<1||(d=m,c.state={status:"uploading",progress:m},w(this,z,sn).call(this))}});if(u.url&&s.prime(u.ref,u.url),h(this,et).delete(n),X(this.state,n)?.block?.type!=="image")return w(this,z,sn).call(this),{status:"gone",merged:!1};let p=this.state===l;return this.updateBlock(n,{src:u.ref},{merge:p}),w(this,z,sn).call(this),{status:"stored",merged:p}}catch(u){let f=u instanceof C?u:new C("storage",`Upload failed: ${u instanceof Error?u.message:String(u)}`,{cause:u});return X(this.state,n)?.block.type==="image"?c.state={status:"failed",error:f}:h(this,et).delete(n),w(this,z,sn).call(this),{status:"failed",merged:!1,error:f}}})(),c.done}retryUpload(n){let r=h(this,et).get(n);return!r||r.state.status!=="failed"?null:this.uploadImage(n,r.file,r.options)}cancelUpload(n){h(this,et).get(n)?.handle.abort()}dismissUpload(n){h(this,et).get(n)?.state.status==="failed"&&(h(this,et).delete(n),w(this,z,sn).call(this))}select(n){w(this,z,Pi).call(this,ti(this.state,n))}selectAll(){w(this,z,Pi).call(this,Oc(this.state))}onSelectionChange(n){return h(this,So).add(n),()=>h(this,So).delete(n)}exec(n){return w(this,z,Un).call(this,n)}transact(n,r){v(this,jn,null);let o=r?.origin==="remote"?{ops:n,renames:new Map}:gd(this.state,n);if(o.renames.size>0&&r?.after){let s=i=>({block:o.renames.get(i.block)??i.block,offset:i.offset});r={...r,after:{anchor:s(r.after.anchor),focus:s(r.after.focus)}}}super.transact(md(this.state,o.ops),r)}undo(){return v(this,jn,null),super.undo()}redo(){return v(this,jn,null),super.redo()}get suggestionsEnabled(){return!!h(this,Mt)}get suggestionUsers(){return h(this,Mt)}get canSuggest(){return!!h(this,Mt)?.current&&h(this,Mt).role!=="viewer"}get suggesting(){return h(this,vo)&&this.canSuggest}setSuggesting(n){return n&&!this.canSuggest?!1:(h(this,vo)===n||(v(this,vo,n),v(this,ut,null),w(this,z,sn).call(this)),!0)}get suggestions(){return wi(this.state)}canResolveSuggestion(n,r){let o=h(this,Mt)?.current;if(!o)return!1;let s=h(this,Mt).role;return s==="editor"?!0:s==="commenter"&&r==="reject"&&n.by===o.id}acceptSuggestion(n){return w(this,z,Cs).call(this,"accept",n)}rejectSuggestion(n){return w(this,z,Cs).call(this,"reject",n)}acceptAllSuggestions(){return w(this,z,Cs).call(this,"accept")}rejectAllSuggestions(){return w(this,z,Cs).call(this,"reject")}typeText(n,r){if(this.suggesting){let s=w(this,z,Un).call(this,el(n,w(this,z,wo).call(this),r??h(this,ut)??void 0),n===`
`?void 0:"insert");return v(this,ut,null),s}let o=w(this,z,Un).call(this,ho(n,r??h(this,ut)??void 0),n===`
`?void 0:"insert");return v(this,ut,null),o}pastePlainText(n){return this.suggesting?this.exec(el(n.replace(/\r\n?/g,`
`),w(this,z,wo).call(this))):this.exec(sd(n))}paste(n,r){let o=Eu(n,r);if(!o)return{applied:!1,unsizedImages:[]};if(o.source==="text")return{applied:this.pastePlainText(o.text),unsizedImages:[]};if(this.suggesting)return{applied:this.pastePlainText(ys(o.blocks).map(i=>"runs"in i?H(i.runs):"").join(`
`)),unsizedImages:[]};let s=this.exec($u(o.blocks,o.footnotes,o.styles));return{applied:s,unsizedImages:s?o.unsizedImages:[]}}splitBlock(){return this.exec(gi())}backspace(){return this.suggesting?w(this,z,Un).call(this,xs("backspace",w(this,z,wo).call(this)),"backspace"):w(this,z,Un).call(this,go(),"backspace")}deleteForward(){return this.suggesting?w(this,z,Un).call(this,xs("delete",w(this,z,wo).call(this)),"delete"):w(this,z,Un).call(this,bs(),"delete")}deleteSelection(){return this.suggesting?this.exec(xs("selection",w(this,z,wo).call(this))):this.exec(mo())}toggleMark(n){let r=h(this,ye);return r?Se(r)?w(this,z,Ci).call(this,Ja(n,!w(this,z,dl).call(this)[n])):this.exec(ju(n)):!1}setMarks(n){let r=h(this,ye);return r&&Se(r)?w(this,z,Ci).call(this,n):this.exec(ks(n))}clearFormatting(){return this.exec(Ju())}setImageWrap(n){let r=h(this,ye),o=r?X(this.state,r.focus.block)?.block:void 0;if(!o||o.type!=="image")return!1;if((o.wrap??null)===n&&!o.float)return!0;let{wrap:s,float:i,...a}=o;return this.transact([{type:"replace_block",id:o.id,block:n?{...a,wrap:n}:a}]),!0}setImageCrop(n,r={}){let o=h(this,ye),s=o?X(this.state,o.focus.block)?.block:void 0;return!s||s.type!=="image"?!1:this.cropImage(s.id,n,r)}cropImage(n,r,o={}){let s=X(this.state,n)?.block;if(!s||s.type!=="image")return!1;let i=r&&(r.top>0||r.right>0||r.bottom>0||r.left>0)?r:null,{crop:a,...l}=s,{width:c,height:d}=s;if(o.rescale){let u=a??{top:0,right:0,bottom:0,left:0},f=i??{top:0,right:0,bottom:0,left:0},p=s.width/(1-u.left-u.right),m=s.height/(1-u.top-u.bottom);c=Math.max(Math.round(p*(1-f.left-f.right)),1),d=Math.max(Math.round(m*(1-f.top-f.bottom)),1)}return this.transact([{type:"replace_block",id:n,block:{...l,width:c,height:d,...i&&{crop:i}}}],o.merge?{merge:!0}:void 0),!0}insertFloat(n){return this.exec(Zu(n))}setFloat(n,r,o={}){let s=r??h(this,ye)?.focus.block,i=s?X(this.state,s):null,a=i?.cell&&i.cell.table.float?i.cell.table:i?.block,l=a?.type==="image"&&!a.float&&!i?.cell&&n!==null;if(!a||!Xe(a)&&!l)return!1;let c=null;if(n){c=Xe(a)?{...a.float}:{x:{from:"column"},y:{from:"paragraph"}};for(let[u,f]of Object.entries(n))f===void 0?delete c[u]:c[u]=f;if(a.type==="image")for(let u of["width","height","shape","fill","fillOpacity","line","padding"])delete c[u]}let d={float:c};return a.type==="image"&&c&&Object.assign(d,{wrap:null,align:null}),a.type==="image"&&n&&(n.width!==void 0||n.height!==void 0)&&(d.width=Math.max(1,Math.round(n.width??a.width)),d.height=Math.max(1,Math.round(n.height??a.height))),this.transact([{type:"update_block",id:a.id,patch:d}],o.merge?{merge:!0}:void 0),!0}get floats(){return this.state.blocks.filter(Xe)}get croppingImage(){return h(this,an)}setCropping(n){let r=h(this,ye),o=r?X(this.state,r.focus.block)?.block:void 0;if(n&&(!o||o.type!=="image"))return!1;let s=n?o.id:null;return s===h(this,an)||(v(this,an,s),nt(this,ln)._++,w(this,z,Ps).call(this)),!0}get styles(){return this.state.styles??{}}applyParagraphStyle(n){return this.exec(id(n))}applyCharacterStyle(n){let r=h(this,ye);return n!==null&&this.state.styles?.[n]?.kind!=="character"?!1:r&&Se(r)?w(this,z,Ci).call(this,{style:n}):this.exec(ad(n))}createStyle(n,r){let o=Rc(this.state,n);return this.exec(Qa({id:o,name:n.trim()||"Style",kind:r}))?o:null}updateStyleFromSelection(n){let r=this.state.styles?.[n];return r?this.exec(Qa({id:n,name:r.name,kind:r.kind,...r.basedOn&&{basedOn:r.basedOn}})):!1}setStyle(n,r){this.transact([{type:"set_style",id:n,style:r}])}changeStyle(n,r){let o=this.state.styles?.[n];return o?(this.transact([{type:"set_style",id:n,style:{...o,...r}}]),!0):!1}deleteStyle(n){return this.exec(ld(n))}setParagraphFormat(n,r={}){if(!r.merge)return this.exec(Ya(n));let o=h(this,ye),s=o&&Ya(n)(this.state,o);return s?(this.transact(s.ops,{before:o,after:s.selection,merge:!0}),!0):!1}setLink(n,r){return this.exec(od(n,r))}insertBlockAtCaret(n){return this.exec(ws(n))}insertField(n){return this.exec(rd(n))}insertTable(n,r,o){return this.exec(Yu(n,r,o))}addRow(n){return this.exec(Ra(n))}addColumn(n){return this.exec(Dc(n))}deleteRow(){return this.exec(Fc())}deleteColumn(){return this.exec(Ec())}deleteTable(){return this.exec(ii())}mergeCells(){return this.exec($c())}splitCells(){return this.exec(Nc())}setRowHeight(n){return this.exec(zc(n))}setCellVerticalAlign(n){return this.exec(jc(n))}setHeaderRow(n){return this.exec(_c(n))}setTableBorders(n){return this.exec(Ic(n))}setCellShade(n){return this.exec(Uc(n))}setColumnWidths(n){return this.exec(Gc(n))}moveToCell(n){let r=h(this,ye);if(!r)return!1;let o=Hc(this.state,r,n);return o?"appendRow"in o?this.exec(Ra("below",0)):(this.select(j(o.to.block,o.to.offset)),!0):!1}setBlockType(n){return this.exec(hi(n))}toggleBlockType(n){return this.exec(Hu(n))}indent(){return this.exec(yi())}outdent(){return this.exec(bi())}setListMarker(n){return this.exec(qu(n))}setListStart(n){return this.exec(Za(n))}continueNumbering(){return this.exec(Za(null))}setAlign(n){return this.exec(Vu(n))}insertBlock(n,r=w(this,z,Dd).call(this)){this.transact([{type:"insert_block",block:n,after:r}])}deleteBlock(n){let r=X(this.state,n);if(r?.cell&&r.list.length===1)throw new C("invalid_operation","A table cell must keep at least one block");this.transact([{type:"delete_block",id:n}])}insertText(n,r,o,s){let i=s?{text:o,marks:s}:{text:o};this.transact([{type:"insert_text",block:n,offset:r,runs:[i]}])}appendText(n,r,o){let s=X(this.state,n)?.block,i=s&&"runs"in s?q(s.runs):0;this.insertText(n,i,r,o)}deleteText(n,r,o){this.transact([{type:"delete_text",block:n,from:r,to:o}])}format(n,r,o,s){this.transact([{type:"format_text",block:n,from:r,to:o,patch:s}])}setTitle(n){this.transact([{type:"set_title",title:n}])}setPage(n,r={}){this.transact([{type:"set_page",page:n}],r.merge?{merge:!0}:void 0)}insertSectionBreak(n){return this.exec(td(n))}setColumns(n){return this.exec(nd(n))}replaceDocument(n){let r=this.state,o=de(r.blocks);for(let l of de(n.blocks))if(o.has(l))throw new C("invalid_operation",`Block id "${l}" is already in the document`);let s=[];n.title!==r.title&&s.push({type:"set_title",title:n.title}),JSON.stringify(n.page??null)!==JSON.stringify(r.page??null)&&s.push({type:"set_page",page:n.page??null});let i=r.blocks[r.blocks.length-1]?.id??null;for(let l of n.blocks)s.push({type:"insert_block",block:l,after:i}),i=l.id;for(let l of r.blocks)s.push({type:"delete_block",id:l.id});for(let l of po)(r[l]!==void 0||n[l]!==void 0)&&s.push({type:"set_region",region:l,blocks:n[l]??null});for(let l of Object.keys(r.footnotes??{}))n.footnotes?.[l]||s.push({type:"set_footnote",id:l,blocks:null});for(let[l,c]of Object.entries(n.footnotes??{}))s.push({type:"set_footnote",id:l,blocks:c});for(let l of Object.keys(r.styles??{}))n.styles?.[l]||s.push({type:"set_style",id:l,style:null});for(let[l,c]of Object.entries(n.styles??{}))s.push({type:"set_style",id:l,style:c});if(h(this,xo)){for(let l of Object.keys(r.comments??{}))n.comments?.[l]||s.push({type:"set_thread",id:l,thread:null});for(let[l,c]of Object.entries(n.comments??{}))s.push({type:"set_thread",id:l,thread:c})}let a=n.blocks.find(_);this.transact(s,{before:this.selection,after:a?j(a.id,0):null}),h(this,xo)&&h(this,cn)?.reload()}setRegion(n,r){this.transact([{type:"set_region",region:n,blocks:r}])}comment(n,r=this.selection,o){let s=h(this,cn);if(!s)throw new C("unsupported","Comments aren't turned on: pass `comments` when making the session");if(!r||Se(r))return null;let i=Pa(this.state,r);if(!i)return null;let a=D("th_"),l=Ac(this.state,r,a),c=s.createThread(n,i,a,o);return this.transact(l,{before:r,after:r}),c}enableComments(n){return h(this,cn)||w(this,z,ll).call(this,n),h(this,cn)}setFootnote(n,r){this.transact([{type:"set_footnote",id:n,blocks:r}])}insertFootnote(n){let r=D("fn_");return this.exec(ed(r,n))?r:null}setSectionRegion(n,r,o){if(n===0)return this.setRegion(r,o&&o.length>0?o:null);let s=Bt(this.state)[n]?.start;if(!s)throw new C("not_found",`No section ${n}`);let{[r]:i,...a}=s.regions??{},l=o?{...a,[r]:o}:a,{regions:c,...d}=s;this.transact([{type:"replace_block",id:s.id,block:Object.keys(l).length>0?{...d,regions:l}:d}])}setPageShape(n,r="document",o={}){let s=this.state,i=Bt(s),a=Ht(s),l=[];if(r==="document"){l.push({type:"set_page",page:{...a,size:n.size,orientation:n.orientation,margins:n.margins}});for(let c of i)if(c.start?.page){let{page:d,...u}=c.start;l.push({type:"replace_block",id:c.start.id,block:u})}}else{let c=i[r];if(!c)throw new C("not_found",`No section ${r}`);let d=Kt(s,i,r);if(ss(d,n))return;r===0?l.push({type:"set_page",page:{...a,size:n.size,orientation:n.orientation,margins:n.margins}}):l.push({type:"replace_block",id:c.start.id,block:{...c.start,page:{size:n.size,orientation:n.orientation,margins:n.margins}}});let u=i[r+1]?.start;u&&!u.page&&l.push({type:"replace_block",id:u.id,block:{...u,page:{size:d.size,orientation:d.orientation,margins:d.margins}}})}l.length>0&&this.transact(l,o.merge?{merge:!0}:void 0)}setSectionFirstPage(n,r){if(n===0)return this.setRegionOptions({differentFirstPage:r});let o=Bt(this.state)[n]?.start;if(!o)throw new C("not_found",`No section ${n}`);if(!!o.differentFirstPage===r)return;let{differentFirstPage:s,...i}=o;this.transact([{type:"replace_block",id:o.id,block:r?{...i,differentFirstPage:!0}:i}])}setRegionOptions(n){let r=this.state.page??Fa,o={...r};for(let s of["differentFirstPage","differentOddEven"]){let i=n[s];i!==void 0&&(i?o[s]=!0:delete o[s])}JSON.stringify(o)!==JSON.stringify(r)&&this.setPage(o)}insertColumns(n){return this.exec(Qu(n))}updateBlock(n,r,o={}){let s=X(this.state,n)?.block;if(!s)throw new C("not_found",`No block with id "${n}"`);this.transact([{type:"replace_block",id:n,block:{...s,...r}}],o.merge?{merge:!0}:void 0)}};ye=new WeakMap,an=new WeakMap,ut=new WeakMap,ln=new WeakMap,jn=new WeakMap,So=new WeakMap,kr=new WeakMap,et=new WeakMap,cn=new WeakMap,xo=new WeakMap,Mt=new WeakMap,vo=new WeakMap,z=new WeakSet,sn=function(){nt(this,ln)._++,w(this,z,Ps).call(this)},Un=function(n,r){let o=h(this,ye);if(!o)return!1;let s=n(this.state,o);if(!s)return!1;let i=Date.now(),a=h(this,jn),l=!!r&&!!a&&a.kind===r&&i-a.at<Gm&&Se(o)&&Td(a.after,o);return this.transact(s.ops,{before:o,after:s.selection,merge:l}),v(this,jn,r?{kind:r,at:i,after:s.selection}:null),!0},wo=function(){return{by:h(this,Mt).current.id,at:Date.now(),newId:()=>D("sg_")}},Cs=function(n,r){let o=new Map(this.suggestions.map(i=>[i.id,this.canResolveSuggestion(i,n)])),s=fd(this.state,n,i=>(r===void 0||i.id===r)&&!!o.get(i.id));return s.length===0?!1:(this.transact(s,{before:h(this,ye),after:h(this,ye)}),!0)},ll=function(n){let r=this,o=n.store===void 0||n.store==="document",s=Oa({get state(){return r.state},write:l=>r.transact(l,{origin:"remote"})}),i=o?s:n.store,a=new sr({file:this.state.id,users:n.users,store:i,initial:Object.values(this.state.comments??{}),permissions:n.permissions,onNotify:n.onNotify,onError:(l,c)=>{c.type==="thread.create"&&w(this,z,cl).call(this,c.thread.id,n.synced?"shared":"remote"),n.onError?.(l,c)}});a.onChange((l,c)=>{o&&c==="remote"&&s.save(this.state.id,l),l.type==="thread.delete"?(!n.synced||c==="local")&&w(this,z,cl).call(this,l.threadId,n.synced?"shared":"remote"):l.type==="thread.create"&&c==="remote"&&!n.synced&&w(this,z,ul).call(this,l.thread)}),n.synced||a.ready.then(()=>{for(let l of a.threads)w(this,z,ul).call(this,l)}),v(this,cn,a),v(this,xo,o),o&&ha(a,this,l=>l.type==="set_thread")},cl=function(n,r="remote"){let o=Tc(this.state,n);o.length>0&&this.transact(o,r==="shared"?{history:!1}:{origin:"remote"})},ul=function(n){if(va(this.state.blocks).has(n.id))return;let r=Ba(this.state,n);r.length>0&&this.transact(r,{origin:"remote"})},dl=function(){if(h(this,ut))return h(this,ut);let n=h(this,ye);if(!n)return{};let r=X(this.state,n.focus.block)?.block;return(r&&_(r)?In(r,n.focus.offset):void 0)??{}},Ci=function(n){return h(this,ye)?(v(this,ut,Zo(w(this,z,dl).call(this),n)??{}),nt(this,ln)._++,w(this,z,Ps).call(this),!0):!1},Pi=function(n){Td(h(this,ye),n)||(v(this,ye,n),h(this,an)&&n?.focus.block!==h(this,an)&&v(this,an,null),v(this,ut,null),nt(this,ln)._++,w(this,z,Ps).call(this))},Ps=function(){for(let n of h(this,So))n(h(this,ye))},Dd=function(){return this.state.blocks[this.state.blocks.length-1]?.id??null};function Td(t,e){return t===e?!0:!t||!e?!1:t.anchor.block===e.anchor.block&&t.anchor.offset===e.anchor.offset&&t.focus.block===e.focus.block&&t.focus.offset===e.focus.offset}var Bi=["bold","italic","underline","strike","code","superscript","subscript"];function Hm(t,e){let n=X(t,e.focus.block);if(!n)return null;let r=n.cell?.table.float?n.cell.table:n.block;return Xe(r)?r:null}function Km(t,e){let n=bt(t,e),r=X(t,e.focus.block);if(!r||(r.block.type==="table"?r.block.float:r.cell?.table.float))return null;let o=!n&&r.block.type==="table",s=r.cell,i=o?r.block:s?.table;if(!i)return null;let a=o?{row1:0,row2:i.rows.length-1,col1:0,col2:i.columns.length-1}:n??en(s.cell,s.row,s.col),l=o?null:n?n.row1:s.row,c=o?null:n?n.col1:s.col,d=l===null||c===null?void 0:i.rows[l]?.cells[c];return{id:i.id,rows:i.rows.length,columns:i.columns.length,row:l,column:c,selectedRows:o?i.rows.length:a.row2-a.row1+1,selectedColumns:o?i.columns.length:a.col2-a.col1+1,headerRow:!!i.headerRow,borders:i.borders??"all",shade:d?.shade,vAlign:d?.vAlign??"top",rowHeight:l===null?void 0:i.rows[l]?.height,canMerge:!!n,canSplit:fr(i,a).some(({cell:u})=>yt(u)>1||at(u)>1)}}function Wm(t,e){let n=X(t,e.focus.block),r=n?.block;if(!n||!r||r.type!=="list_item")return null;let o=lo(n.list)[n.index];return{kind:r.list,marker:Nn(r),number:o??null,restarts:r.start!==void 0}}function Fd(t){switch(t.type){case"heading":return{type:"heading",level:t.level};case"list_item":return{type:"list_item",list:t.list};case"code_block":return{type:"code_block"};default:return{type:t.type}}}function qm(t,e){return t.type!==e.type?!1:t.type==="heading"&&e.type==="heading"?t.level===e.level:t.type==="list_item"&&e.type==="list_item"?t.list===e.list:!0}function Ed(t,e,n){if(n)return n;let r=X(t,e.focus.block)?.block;return r&&_(r)?In(r,e.focus.offset):void 0}function $d(t,e,n=null){let r=Object.fromEntries(Bi.map(s=>[s,!1]));if(Se(e)){let s=Ed(t,e,n);for(let i of Bi)r[i]=s?.[i]===!0;return r}let o=br(t,e);if(o.length===0)return r;for(let s of Bi)r[s]=o.every(i=>Ys(i.block.runs,i.from,i.to,s));return r}function wr(t,e,n,r=null){if(Se(e))return{value:Ed(t,e,r)?.[n],mixed:!1};let o=new Set,s,i=!1;for(let a of br(t,e))for(let l of me(a.block.runs,a.from,a.to)){let c=l.marks?.[n];i||(s=c),i=!0,o.add(c)}return{value:s,mixed:o.size>1}}function Nd(t,e){let n=Ge(t,e).filter(_),r=n[0];if(!r)return null;let o=Fd(r);return n.every(s=>qm(Fd(s),o))?o:null}function Xm(t,e){let n=Ge(t,e).filter(Ae);if(n.length===0)return null;let r=n[0].style??null;return n.every(o=>(o.style??null)===r)?r:null}function _d(t,e){let n=Ge(t,e).filter(o=>Ae(o)||o.type==="image");if(n.length===0)return null;let r=new Set(n.map(o=>"align"in o&&Gt(t,o).align||"left"));return r.size===1?[...r][0]:null}function fl(t,e,n=null){if(!e){let i={value:void 0,mixed:!1};return{marks:Object.fromEntries(Bi.map(a=>[a,!1])),fontFamily:i,fontSize:i,color:i,highlight:i,link:i,block:null,align:null,paragraphStyle:null,characterStyle:i,format:{},list:null,image:null,table:null,floating:null,canIndent:!1,canOutdent:!1,columns:gr(t.page?.columns),section:0}}let o=Ge(t,e).find(Ae),s=X(t,e.focus.block)?.block;return{marks:$d(t,e,n),fontFamily:wr(t,e,"fontFamily",n),fontSize:wr(t,e,"fontSize",n),color:wr(t,e,"color",n),highlight:wr(t,e,"highlight",n),link:wr(t,e,"link",n),block:Nd(t,e),align:_d(t,e),paragraphStyle:Xm(t,e),characterStyle:wr(t,e,"style",n),format:o?Gt(t,o).format??{}:{},list:Wm(t,e),image:Se(e)&&s?.type==="image"?s:null,table:Km(t,e),floating:Hm(t,e),canIndent:yi()(t,e)!==null,canOutdent:bi()(t,e)!==null,columns:s?ao(t,X(t,s.id).topIndex):gr(t.page?.columns),section:s?Jc(t,X(t,s.id).topIndex):0}}function Vm(t){let{table:e,row1:n,row2:r,col1:o,col2:s}=t,{headerRow:i,...a}=e;return{...a,rows:e.rows.slice(n,r+1).map(l=>({...l,cells:l.cells.slice(o,s+1)})),columns:lt(e.columns.slice(o,s+1)),...n===0&&e.headerRow&&{headerRow:!0}}}function Mi(t,e){let n=Jm(t,e),{footnotes:r,...o}=n,s=Object.fromEntries(Qe(n.blocks).flatMap(l=>t.footnotes?.[l]?[[l,t.footnotes[l]]]:[])),i={},a=l=>{for(let c=l;c!==void 0&&t.styles?.[c]&&!i[c];c=t.styles[c].basedOn)i[c]=t.styles[c]};for(let l of si(n.blocks))a(l);return{...o,...Object.keys(s).length>0&&{footnotes:s},...Object.keys(i).length>0&&{styles:i}}}function Jm(t,e){if(Se(e))return{...t,blocks:[]};let n=bt(t,e);if(n)return{...t,blocks:[Vm(n)]};let r=Ye(t,e),o=new Set(r.map(a=>a.block.id)),s=new Set,i=[];for(let{block:a,from:l,to:c}of r)if(!s.has(a.id)){if(a.type==="table"){let d=de([a]);d.delete(a.id);let u=[...d].filter(f=>!a.rows.some(p=>p.id===f||p.cells.some(m=>m.id===f)));if(u.every(f=>o.has(f))){i.push(a);for(let f of u)s.add(f)}continue}i.push(_(a)?{...a,runs:me(a.runs,l,c)}:a)}return{...t,blocks:i}}function Zm(t){return/[\t\n\r"]/.test(t)?`"${t.replace(/"/g,'""')}"`:t}function Ym(t){return t.rows.map(e=>e.cells.map(n=>n.covered?"":Zm(n.blocks.map(r=>_(r)?H(r.runs):"").join(`
`))).join("	")).join(`
`)}function Oi(t,e){return Mi(t,e).blocks.map(n=>n.type==="table"?Ym(n):_(n)?H(n.runs).replaceAll(Fn,""):"").join(`
`)}function pl(t){let e=0,n=0,r=0;for(let o of On(t.blocks)){if(!_(o))continue;let s=H(o.runs).replaceAll(Fn,"");n+=s.length,r+=s.replace(/\s/g,"").length,e+=s.split(/\s+/).filter(i=>/[\p{L}\p{N}]/u.test(i)).length}return{words:e,characters:n,charactersNoSpaces:r}}var Pe=Uint8Array,dt=Uint16Array,Cl=Int32Array,Ai=new Pe([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Ti=new Pe([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),bl=new Pe([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Gd=function(t,e){for(var n=new dt(31),r=0;r<31;++r)n[r]=e+=1<<t[r-1];for(var o=new Cl(n[30]),r=1;r<30;++r)for(var s=n[r];s<n[r+1];++s)o[s]=s-n[r]<<5|r;return{b:n,r:o}},Hd=Gd(Ai,2),Kd=Hd.b,kl=Hd.r;Kd[28]=258,kl[258]=28;var Wd=Gd(Ti,0),Qm=Wd.b,Id=Wd.r,wl=new dt(32768);for(oe=0;oe<32768;++oe)un=(oe&43690)>>1|(oe&21845)<<1,un=(un&52428)>>2|(un&13107)<<2,un=(un&61680)>>4|(un&3855)<<4,wl[oe]=((un&65280)>>8|(un&255)<<8)>>1;var un,oe,qt=(function(t,e,n){for(var r=t.length,o=0,s=new dt(e);o<r;++o)t[o]&&++s[t[o]-1];var i=new dt(e);for(o=1;o<e;++o)i[o]=i[o-1]+s[o-1]<<1;var a;if(n){a=new dt(1<<e);var l=15-e;for(o=0;o<r;++o)if(t[o])for(var c=o<<4|t[o],d=e-t[o],u=i[t[o]-1]++<<d,f=u|(1<<d)-1;u<=f;++u)a[wl[u]>>l]=c}else for(a=new dt(r),o=0;o<r;++o)t[o]&&(a[o]=wl[i[t[o]-1]++]>>15-t[o]);return a}),zn=new Pe(288);for(oe=0;oe<144;++oe)zn[oe]=8;var oe;for(oe=144;oe<256;++oe)zn[oe]=9;var oe;for(oe=256;oe<280;++oe)zn[oe]=7;var oe;for(oe=280;oe<288;++oe)zn[oe]=8;var oe,As=new Pe(32);for(oe=0;oe<32;++oe)As[oe]=5;var oe,eh=qt(zn,9,0),th=qt(zn,9,1),nh=qt(As,5,0),rh=qt(As,5,1),ml=function(t){for(var e=t[0],n=1;n<t.length;++n)t[n]>e&&(e=t[n]);return e},Ot=function(t,e,n){var r=e/8|0;return(t[r]|t[r+1]<<8)>>(e&7)&n},hl=function(t,e){var n=e/8|0;return(t[n]|t[n+1]<<8|t[n+2]<<16)>>(e&7)},Pl=function(t){return(t+7)/8|0},Ts=function(t,e,n){return(e==null||e<0)&&(e=0),(n==null||n>t.length)&&(n=t.length),new Pe(t.subarray(e,n))};var oh=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],Ue=function(t,e,n){var r=new Error(e||oh[t]);if(r.code=t,Error.captureStackTrace&&Error.captureStackTrace(r,Ue),!n)throw r;return r},sh=function(t,e,n,r){var o=t.length,s=r?r.length:0;if(!o||e.f&&!e.l)return n||new Pe(0);var i=!n,a=i||e.i!=2,l=e.i;i&&(n=new Pe(o*3));var c=function(Kn){var ke=n.length;if(Kn>ke){var Dt=new Pe(Math.max(ke*2,Kn));Dt.set(n),n=Dt}},d=e.f||0,u=e.p||0,f=e.b||0,p=e.l,m=e.d,g=e.m,y=e.n,b=o*8;do{if(!p){d=Ot(t,u,1);var k=Ot(t,u+1,3);if(u+=3,k)if(k==1)p=th,m=rh,g=9,y=5;else if(k==2){var F=Ot(t,u,31)+257,R=Ot(t,u+10,15)+4,N=F+Ot(t,u+5,31)+1;u+=14;for(var P=new Pe(N),B=new Pe(19),x=0;x<R;++x)B[bl[x]]=Ot(t,u+x*3,7);u+=R*3;for(var $=ml(B),L=(1<<$)-1,W=qt(B,$,1),x=0;x<N;){var Q=W[Ot(t,u,L)];u+=Q&15;var T=Q>>4;if(T<16)P[x++]=T;else{var V=0,J=0;for(T==16?(J=3+Ot(t,u,3),u+=2,V=P[x-1]):T==17?(J=3+Ot(t,u,7),u+=3):T==18&&(J=11+Ot(t,u,127),u+=7);J--;)P[x++]=V}}var se=P.subarray(0,F),pe=P.subarray(F);g=ml(se),y=ml(pe),p=qt(se,g,1),m=qt(pe,y,1)}else Ue(1);else{var T=Pl(u)+4,I=t[T-4]|t[T-3]<<8,O=T+I;if(O>o){l&&Ue(0);break}a&&c(f+I),n.set(t.subarray(T,O),f),e.b=f+=I,e.p=u=O*8,e.f=d;continue}if(u>b){l&&Ue(0);break}}a&&c(f+131072);for(var ge=(1<<g)-1,Re=(1<<y)-1,ft=u;;ft=u){var V=p[hl(t,u)&ge],_e=V>>4;if(u+=V&15,u>b){l&&Ue(0);break}if(V||Ue(2),_e<256)n[f++]=_e;else if(_e==256){ft=u,p=null;break}else{var ve=_e-254;if(_e>264){var x=_e-257,ce=Ai[x];ve=Ot(t,u,(1<<ce)-1)+Kd[x],u+=ce}var We=m[hl(t,u)&Re],Jt=We>>4;We||Ue(3),u+=We&15;var pe=Qm[Jt];if(Jt>3){var ce=Ti[Jt];pe+=hl(t,u)&(1<<ce)-1,u+=ce}if(u>b){l&&Ue(0);break}a&&c(f+131072);var qe=f+ve;if(f<pe){var Mr=s-pe,Rt=Math.min(pe,qe);for(Mr+f<0&&Ue(3);f<Rt;++f)n[f]=r[Mr+f]}for(;f<qe;++f)n[f]=n[f-pe]}}e.l=p,e.p=ft,e.b=f,e.f=d,p&&(d=1,e.m=g,e.d=m,e.n=y)}while(!d);return f!=n.length&&i?Ts(n,0,f):n.subarray(0,f)},dn=function(t,e,n){n<<=e&7;var r=e/8|0;t[r]|=n,t[r+1]|=n>>8},Ms=function(t,e,n){n<<=e&7;var r=e/8|0;t[r]|=n,t[r+1]|=n>>8,t[r+2]|=n>>16},gl=function(t,e){for(var n=[],r=0;r<t.length;++r)t[r]&&n.push({s:r,f:t[r]});var o=n.length,s=n.slice();if(!o)return{t:Xd,l:0};if(o==1){var i=new Pe(n[0].s+1);return i[n[0].s]=1,{t:i,l:1}}n.sort(function(O,F){return O.f-F.f}),n.push({s:-1,f:25001});var a=n[0],l=n[1],c=0,d=1,u=2;for(n[0]={s:-1,f:a.f+l.f,l:a,r:l};d!=o-1;)a=n[n[c].f<n[u].f?c++:u++],l=n[c!=d&&n[c].f<n[u].f?c++:u++],n[d++]={s:-1,f:a.f+l.f,l:a,r:l};for(var f=s[0].s,r=1;r<o;++r)s[r].s>f&&(f=s[r].s);var p=new dt(f+1),m=Sl(n[d-1],p,0);if(m>e){var r=0,g=0,y=m-e,b=1<<y;for(s.sort(function(F,R){return p[R.s]-p[F.s]||F.f-R.f});r<o;++r){var k=s[r].s;if(p[k]>e)g+=b-(1<<m-p[k]),p[k]=e;else break}for(g>>=y;g>0;){var T=s[r].s;p[T]<e?g-=1<<e-p[T]++-1:++r}for(;r>=0&&g;--r){var I=s[r].s;p[I]==e&&(--p[I],++g)}m=e}return{t:new Pe(p),l:m}},Sl=function(t,e,n){return t.s==-1?Math.max(Sl(t.l,e,n+1),Sl(t.r,e,n+1)):e[t.s]=n},Ld=function(t){for(var e=t.length;e&&!t[--e];);for(var n=new dt(++e),r=0,o=t[0],s=1,i=function(l){n[r++]=l},a=1;a<=e;++a)if(t[a]==o&&a!=e)++s;else{if(!o&&s>2){for(;s>138;s-=138)i(32754);s>2&&(i(s>10?s-11<<5|28690:s-3<<5|12305),s=0)}else if(s>3){for(i(o),--s;s>6;s-=6)i(8304);s>2&&(i(s-3<<5|8208),s=0)}for(;s--;)i(o);s=1,o=t[a]}return{c:n.subarray(0,r),n:e}},Os=function(t,e){for(var n=0,r=0;r<e.length;++r)n+=t[r]*e[r];return n},qd=function(t,e,n){var r=n.length,o=Pl(e+2);t[o]=r&255,t[o+1]=r>>8,t[o+2]=t[o]^255,t[o+3]=t[o+1]^255;for(var s=0;s<r;++s)t[o+s+4]=n[s];return(o+4+r)*8},Ud=function(t,e,n,r,o,s,i,a,l,c,d){dn(e,d++,n),++o[256];for(var u=gl(o,15),f=u.t,p=u.l,m=gl(s,15),g=m.t,y=m.l,b=Ld(f),k=b.c,T=b.n,I=Ld(g),O=I.c,F=I.n,R=new dt(19),N=0;N<k.length;++N)++R[k[N]&31];for(var N=0;N<O.length;++N)++R[O[N]&31];for(var P=gl(R,7),B=P.t,x=P.l,$=19;$>4&&!B[bl[$-1]];--$);var L=c+5<<3,W=Os(o,zn)+Os(s,As)+i,Q=Os(o,f)+Os(s,g)+i+14+3*$+Os(R,B)+2*R[16]+3*R[17]+7*R[18];if(l>=0&&L<=W&&L<=Q)return qd(e,d,t.subarray(l,l+c));var V,J,se,pe;if(dn(e,d,1+(Q<W)),d+=2,Q<W){V=qt(f,p,0),J=f,se=qt(g,y,0),pe=g;var ge=qt(B,x,0);dn(e,d,T-257),dn(e,d+5,F-1),dn(e,d+10,$-4),d+=14;for(var N=0;N<$;++N)dn(e,d+3*N,B[bl[N]]);d+=3*$;for(var Re=[k,O],ft=0;ft<2;++ft)for(var _e=Re[ft],N=0;N<_e.length;++N){var ve=_e[N]&31;dn(e,d,ge[ve]),d+=B[ve],ve>15&&(dn(e,d,_e[N]>>5&127),d+=_e[N]>>12)}}else V=eh,J=zn,se=nh,pe=As;for(var N=0;N<a;++N){var ce=r[N];if(ce>255){var ve=ce>>18&31;Ms(e,d,V[ve+257]),d+=J[ve+257],ve>7&&(dn(e,d,ce>>23&31),d+=Ai[ve]);var We=ce&31;Ms(e,d,se[We]),d+=pe[We],We>3&&(Ms(e,d,ce>>5&8191),d+=Ti[We])}else Ms(e,d,V[ce]),d+=J[ce]}return Ms(e,d,V[256]),d+J[256]},ih=new Cl([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),Xd=new Pe(0),ah=function(t,e,n,r,o,s){var i=s.z||t.length,a=new Pe(r+i+5*(1+Math.ceil(i/7e3))+o),l=a.subarray(r,a.length-o),c=s.l,d=(s.r||0)&7;if(e){d&&(l[0]=s.r>>3);for(var u=ih[e-1],f=u>>13,p=u&8191,m=(1<<n)-1,g=s.p||new dt(32768),y=s.h||new dt(m+1),b=Math.ceil(n/3),k=2*b,T=function(Wn){return(t[Wn]^t[Wn+1]<<b^t[Wn+2]<<k)&m},I=new Cl(25e3),O=new dt(288),F=new dt(32),R=0,N=0,P=s.i||0,B=0,x=s.w||0,$=0;P+2<i;++P){var L=T(P),W=P&32767,Q=y[L];if(g[W]=Q,y[L]=W,x<=P){var V=i-P;if((R>7e3||B>24576)&&(V>423||!c)){d=Ud(t,l,0,I,O,F,N,B,$,P-$,d),B=R=N=0,$=P;for(var J=0;J<286;++J)O[J]=0;for(var J=0;J<30;++J)F[J]=0}var se=2,pe=0,ge=p,Re=W-Q&32767;if(V>2&&L==T(P-Re))for(var ft=Math.min(f,V)-1,_e=Math.min(32767,P),ve=Math.min(258,V);Re<=_e&&--ge&&W!=Q;){if(t[P+se]==t[P+se-Re]){for(var ce=0;ce<ve&&t[P+ce]==t[P+ce-Re];++ce);if(ce>se){if(se=ce,pe=Re,ce>ft)break;for(var We=Math.min(Re,ce-2),Jt=0,J=0;J<We;++J){var qe=P-Re+J&32767,Mr=g[qe],Rt=qe-Mr&32767;Rt>Jt&&(Jt=Rt,Q=qe)}}}W=Q,Q=g[W],Re+=W-Q&32767}if(pe){I[B++]=268435456|kl[se]<<18|Id[pe];var Kn=kl[se]&31,ke=Id[pe]&31;N+=Ai[Kn]+Ti[ke],++O[257+Kn],++F[ke],x=P+se,++R}else I[B++]=t[P],++O[t[P]]}}for(P=Math.max(P,x);P<i;++P)I[B++]=t[P],++O[t[P]];d=Ud(t,l,c,I,O,F,N,B,$,P-$,d),c||(s.r=d&7|l[d/8|0]<<3,d-=7,s.h=y,s.p=g,s.i=P,s.w=x)}else{for(var P=s.w||0;P<i+c;P+=65535){var Dt=P+65535;Dt>=i&&(l[d/8|0]=c,Dt=i),d=qd(l,d+1,t.subarray(P,Dt))}s.i=i}return Ts(a,0,r+Pl(d)+o)},lh=(function(){for(var t=new Int32Array(256),e=0;e<256;++e){for(var n=e,r=9;--r;)n=(n&1&&-306674912)^n>>>1;t[e]=n}return t})(),ch=function(){var t=-1;return{p:function(e){for(var n=t,r=0;r<e.length;++r)n=lh[n&255^e[r]]^n>>>8;t=n},d:function(){return~t}}};var uh=function(t,e,n,r,o){if(!o&&(o={l:1},e.dictionary)){var s=e.dictionary.subarray(-32768),i=new Pe(s.length+t.length);i.set(s),i.set(t,s.length),t=i,o.w=s.length}return ah(t,e.level==null?6:e.level,e.mem==null?o.l?Math.ceil(Math.max(8,Math.min(13,Math.log(t.length)))*1.5):20:12+e.mem,n,r,o)},Vd=function(t,e){var n={};for(var r in t)n[r]=t[r];for(var r in e)n[r]=e[r];return n};var Wt=function(t,e){return t[e]|t[e+1]<<8},wt=function(t,e){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0},yl=function(t,e){return wt(t,e)+wt(t,e+4)*4294967296},Ne=function(t,e,n){for(;n;++e)t[e]=n,n>>>=8};function dh(t,e){return uh(t,e||{},0,0)}function fh(t,e){return sh(t,{i:2},e&&e.out,e&&e.dictionary)}var Jd=function(t,e,n,r){for(var o in t){var s=t[o],i=e+o,a=r;Array.isArray(s)&&(a=Vd(r,s[1]),s=s[0]),ArrayBuffer.isView(s)?n[i]=[s,a]:(n[i+="/"]=[new Pe(0),a],Jd(s,i,n,r))}},jd=typeof TextEncoder<"u"&&new TextEncoder,xl=typeof TextDecoder<"u"&&new TextDecoder,ph=0;try{xl.decode(Xd,{stream:!0}),ph=1}catch{}var mh=function(t){for(var e="",n=0;;){var r=t[n++],o=(r>127)+(r>223)+(r>239);if(n+o>t.length)return{s:e,r:Ts(t,n-1)};o?o==3?(r=((r&15)<<18|(t[n++]&63)<<12|(t[n++]&63)<<6|t[n++]&63)-65536,e+=String.fromCharCode(55296|r>>10,56320|r&1023)):o&1?e+=String.fromCharCode((r&31)<<6|t[n++]&63):e+=String.fromCharCode((r&15)<<12|(t[n++]&63)<<6|t[n++]&63):e+=String.fromCharCode(r)}};function $e(t,e){if(e){for(var n=new Pe(t.length),r=0;r<t.length;++r)n[r]=t.charCodeAt(r);return n}if(jd)return jd.encode(t);for(var o=t.length,s=new Pe(t.length+(t.length>>1)),i=0,a=function(d){s[i++]=d},r=0;r<o;++r){if(i+5>s.length){var l=new Pe(i+8+(o-r<<1));l.set(s),s=l}var c=t.charCodeAt(r);c<128||e?a(c):c<2048?(a(192|c>>6),a(128|c&63)):c>55295&&c<57344?(c=65536+(c&1047552)|t.charCodeAt(++r)&1023,a(240|c>>18),a(128|c>>12&63),a(128|c>>6&63),a(128|c&63)):(a(224|c>>12),a(128|c>>6&63),a(128|c&63))}return Ts(s,0,i)}function Bl(t,e){if(e){for(var n="",r=0;r<t.length;r+=16384)n+=String.fromCharCode.apply(null,t.subarray(r,r+16384));return n}else{if(xl)return xl.decode(t);var o=mh(t),s=o.s,n=o.r;return n.length&&Ue(8),s}}var hh=function(t,e){return e+30+Wt(t,e+26)+Wt(t,e+28)},gh=function(t,e,n){var r=Wt(t,e+28),o=Wt(t,e+30),s=Bl(t.subarray(e+46,e+46+r),!(Wt(t,e+8)&2048)),i=e+46+r,a=yh(t,i,o,n,wt(t,e+20),wt(t,e+24),wt(t,e+42)),l=a[0],c=a[1],d=a[2];return[Wt(t,e+10),l,c,s,i+o+Wt(t,e+32),d]},yh=function(t,e,n,r,o,s,i){var a=o==4294967295,l=s==4294967295,c=i==4294967295,d=e+n,u=a+l+c;if(r&&u){for(;e+4<d;e+=4+Wt(t,e+2))if(Wt(t,e)==1)return[a?yl(t,e+4+8*l):o,l?yl(t,e+4):s,c?yl(t,e+4+8*(l+a)):i,1];r<2&&Ue(13)}return[o,s,i,0]},vl=function(t){var e=0;if(t)for(var n in t){var r=t[n].length;r>65535&&Ue(9),e+=r+4}return e},zd=function(t,e,n,r,o,s,i,a){var l=r.length,c=n.extra,d=a&&a.length,u=vl(c);Ne(t,e,i!=null?33639248:67324752),e+=4,i!=null&&(t[e++]=20,t[e++]=n.os),t[e]=20,e+=2,t[e++]=n.flag<<1|(s<0&&8),t[e++]=o&&8,t[e++]=n.compression&255,t[e++]=n.compression>>8;var f=new Date(n.mtime==null?Date.now():n.mtime),p=f.getFullYear()-1980;if((p<0||p>119)&&Ue(10),Ne(t,e,p<<25|f.getMonth()+1<<21|f.getDate()<<16|f.getHours()<<11|f.getMinutes()<<5|f.getSeconds()>>1),e+=4,s!=-1&&(Ne(t,e,n.crc),Ne(t,e+4,s<0?-s-2:s),Ne(t,e+8,n.size)),Ne(t,e+12,l),Ne(t,e+14,u),e+=16,i!=null&&(Ne(t,e,d),Ne(t,e+6,n.attrs),Ne(t,e+10,i),e+=14),t.set(r,e),e+=l,u)for(var m in c){var g=c[m],y=g.length;Ne(t,e,+m),Ne(t,e+2,y),t.set(g,e+4),e+=4+y}return d&&(t.set(a,e),e+=d),e},bh=function(t,e,n,r,o){Ne(t,e,101010256),Ne(t,e+8,n),Ne(t,e+10,n),Ne(t,e+12,r),Ne(t,e+16,o)};function Zd(t,e){e||(e={});var n={},r=[];Jd(t,"",n,e);var o=0,s=0;for(var i in n){var a=n[i],l=a[0],c=a[1],d=c.level==0?0:8,u=$e(i),f=u.length,p=c.comment,m=p&&$e(p),g=m&&m.length,y=vl(c.extra);f>65535&&Ue(11);var b=d?dh(l,c):l,k=b.length,T=ch();T.p(l),r.push(Vd(c,{size:l.length,crc:T.d(),c:b,f:u,m,u:f!=i.length||m&&p.length!=g,o,compression:d})),o+=30+f+y+k,s+=76+2*(f+y)+(g||0)+k}for(var I=new Pe(s+22),O=o,F=s-o,R=0;R<r.length;++R){var u=r[R];zd(I,u.o,u,u.f,u.u,u.c.length);var N=30+u.f.length+vl(u.extra);I.set(u.c,u.o+N),zd(I,o,u,u.f,u.u,u.c.length,u.o,u.m),o+=16+N+(u.m?u.m.length:0)}return bh(I,o,r.length,F,O),I}function Yd(t,e){for(var n={},r=t.length-22;wt(t,r)!=101010256;--r)(!r||t.length-r>65558)&&Ue(13);var o=Wt(t,r+8);if(!o)return{};var s=wt(t,r+16),i=wt(t,r-20)==117853008;if(i){var a=wt(t,r-12);i=wt(t,a)==101075792,i&&(o=wt(t,a+32),s=wt(t,a+48))}for(var l=e&&e.filter,c=0;c<o;++c){var d=gh(t,s,i),u=d[0],f=d[1],p=d[2],m=d[3],g=d[4],y=d[5],b=hh(t,y);s=g,(!l||l({name:m,size:f,originalSize:p,compression:u}))&&(u?u==8?n[m]=fh(t.subarray(b,b+f),{out:new Pe(p)}):Ue(14,"unknown compression type "+u):n[m]=Ts(t,b,b+f))}return n}var Co="http://schemas.openxmlformats.org/wordprocessingml/2006/main",kh="http://schemas.openxmlformats.org/officeDocument/2006/relationships",wh="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",Al="http://schemas.openxmlformats.org/drawingml/2006/main",Qd="http://schemas.openxmlformats.org/drawingml/2006/picture",ef="http://schemas.microsoft.com/office/word/2010/wordprocessingShape",Xt="http://schemas.openxmlformats.org/officeDocument/2006/relationships",Tl=8,fn=9525,Sr=20,rf=new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]","g");function Ke(t){return t.replace(rf,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var St=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
`;function Fi(t){let e=/^#?([0-9a-f]{6})$/i.exec(t)??/^#?([0-9a-f]{3})$/i.exec(t);if(!e)return;let n=e[1];return(n.length===3?[...n].map(r=>r+r).join(""):n).toUpperCase()}var Sh={FFFF00:"yellow","00FF00":"green","00FFFF":"cyan",FF00FF:"magenta","0000FF":"blue",FF0000:"red"};function tf(t,e){let n=e.replace(rf,"").trim(),r=t?.mode==="office"?Js(n):n;return t?.names.add(r),r}function xh(t){let e=[...t].map(n=>{let r=ka(n),o=Js(n),s=o!==n?`<w:altName w:val="${Ke(o)}"/>`:"";return`<w:font w:name="${Ke(n)}">${s}<w:family w:val="${r.docxFamily}"/><w:pitch w:val="${r.docxPitch}"/></w:font>`});return`${St}<w:fonts xmlns:w="${Co}">${e.join("")}</w:fonts>`}function Ml(t,e){return{links:[],images:[],shared:t,defaultStyle:e}}var Ri="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";function vh(t){let e=t.replace(/[^A-Za-z0-9+/]/g,""),n=new Uint8Array(Math.floor(e.length*3/4)),r=0;for(let o=0;o<e.length;o+=4){let s=Ri.indexOf(e[o]),i=Ri.indexOf(e[o+1]),a=o+2<e.length?Ri.indexOf(e[o+2]):-1,l=o+3<e.length?Ri.indexOf(e[o+3]):-1;n[r++]=s<<2|i>>4,a>=0&&(n[r++]=(i&15)<<4|a>>2),l>=0&&(n[r++]=(a&3)<<6|l)}return n.subarray(0,r)}function Ch(t){let e=/^data:image\/(png|jpe?g|gif);base64,(.*)$/is.exec(t);if(!e)return null;let n=e[1].toLowerCase().startsWith("jp")?"jpeg":e[1].toLowerCase();return{bytes:vh(e[2]),ext:n}}var Ph={left:"left",center:"center",right:"right",justify:"both"};function of(t,e,n){if(!t)return"";let r="";t.link?r+='<w:rStyle w:val="Hyperlink"/>':t.style&&e?.has(t.style)&&(r+=`<w:rStyle w:val="${e.get(t.style)}"/>`);let o=t.fontFamily?.trim(),s=o?Ke(tf(n,o)):t.code?Ke(tf(n,"Courier New")):void 0;s&&(r+=`<w:rFonts w:ascii="${s}" w:hAnsi="${s}" w:cs="${s}"/>`),t.bold&&(r+="<w:b/>"),t.italic&&(r+="<w:i/>"),t.strike&&(r+="<w:strike/>");let i=t.color&&Fi(t.color);i&&(r+=`<w:color w:val="${i}"/>`),t.fontSize&&(r+=`<w:sz w:val="${Math.round(t.fontSize*2)}"/><w:szCs w:val="${Math.round(t.fontSize*2)}"/>`);let a=t.highlight&&Fi(t.highlight),l=a&&Sh[a];return l&&(r+=`<w:highlight w:val="${l}"/>`),(t.underline||t.link)&&(r+='<w:u w:val="single"/>'),a&&!l&&(r+=`<w:shd w:val="clear" w:color="auto" w:fill="${a}"/>`),t.superscript?r+='<w:vertAlign w:val="superscript"/>':t.subscript&&(r+='<w:vertAlign w:val="subscript"/>'),r}function nf(t,e){let n=e.runDefaults?{...e.runDefaults,...t.marks}:t.marks,r=of(n,e.shared.styleIds,e.shared.fonts),o=r?`<w:rPr>${r}</w:rPr>`:"";if(n?.footnote){let l='<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>';if(n.footnote===Da)return`<w:r>${l}<w:footnoteRef/></w:r>`;let c=e.shared.footnoteIds.get(n.footnote);return c===void 0?"":`<w:r>${l}<w:footnoteReference w:id="${c}"/></w:r>`}if(n?.field)return`<w:fldSimple w:instr="${n.field==="page"?" PAGE ":" NUMPAGES "}"><w:r>${o}<w:t>${Ke(t.text)}</w:t></w:r></w:fldSimple>`;let s=n?.suggest?.kind==="delete",i="";for(let l of t.text.split(/(\n|\t)/))l===`
`?i+="<w:br/>":l==="	"?i+="<w:tab/>":l!==""&&(i+=`<w:${s?"delText":"t"} xml:space="preserve">${Ke(l)}</w:${s?"delText":"t"}>`);let a=`<w:r>${o}${i}</w:r>`;if(n?.suggest){let{suggest:l}=n,c=l.kind==="insert"?"ins":"del",d=e.shared.authorName(l.by)||l.by;a=`<w:${c} w:id="${e.shared.revision++}" w:author="${Ke(d)}" w:date="${new Date(l.at).toISOString().replace(/\.\d+Z$/,"Z")}">${a}</w:${c}>`}return n?.link?(e.links.push(n.link),`<w:hyperlink r:id="rIdLink${e.links.length}">${a}</w:hyperlink>`):a}function El(t){let e="";t.style&&(e+=`<w:pStyle w:val="${t.style}"/>`),t.num&&(e+=`<w:numPr><w:ilvl w:val="${t.num.level}"/><w:numId w:val="${t.num.id}"/></w:numPr>`),t.border&&(e+='<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>');let n=t.format;if(n&&(n.spaceBefore!==void 0||n.spaceAfter!==void 0||n.lineHeight!==void 0)){let r="";n.spaceBefore!==void 0&&(r+=` w:before="${Math.round(n.spaceBefore*Sr)}"`),n.spaceAfter!==void 0&&(r+=` w:after="${Math.round(n.spaceAfter*Sr)}"`),n.lineHeight!==void 0&&(r+=` w:line="${Math.round(n.lineHeight*240)}" w:lineRule="auto"`),e+=`<w:spacing${r}/>`}if(n&&(n.indentLeft||n.indentRight||n.indentFirst)){let r="";n.indentLeft&&(r+=` w:left="${Math.round(n.indentLeft*Sr)}"`),n.indentRight&&(r+=` w:right="${Math.round(n.indentRight*Sr)}"`),n.indentFirst&&n.indentFirst>0&&(r+=` w:firstLine="${Math.round(n.indentFirst*Sr)}"`),n.indentFirst&&n.indentFirst<0&&(r+=` w:hanging="${Math.round(-n.indentFirst*Sr)}"`),e+=`<w:ind${r}/>`}return t.align&&t.align!=="left"&&(e+=`<w:jc w:val="${Ph[t.align]}"/>`),e}function Bh(t,e){let n=e.shared.comments;if(n.size===0)return t.map(a=>nf(a,e)).join("");let r="",o=[],s=a=>{let l=n.get(a);return l.seen++,l.seen===1?l.word.map(c=>`<w:commentRangeStart w:id="${c}"/>`).join(""):""},i=a=>{let l=n.get(a);return l.seen===l.total?l.word.map(c=>`<w:commentRangeEnd w:id="${c}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${c}"/></w:r>`).join(""):""};for(let a of t){let l=(a.marks?.comment??[]).filter(c=>n.has(c));for(let c of o)l.includes(c)||(r+=i(c));for(let c of l)o.includes(c)||(r+=s(c));o=l,r+=nf(a,e)}for(let a of o)r+=i(a);return r}function Vt(t,e,n={}){let r=e.defaultFormat||n.format?{...e.defaultFormat,...n.format}:void 0,o=El({...n,format:r,style:n.style??e.defaultStyle});return`<w:p>${o?`<w:pPr>${o}</w:pPr>`:""}${n.prefix??""}${Bh(t,e)}</w:p>`}var Rs=t=>t.defaultStyle===void 0;function Mh(t){let e=t.crop;if(!e)return"";let n=r=>Math.round(r*1e5);return`<a:srcRect l="${n(e.left)}" t="${n(e.top)}" r="${n(e.right)}" b="${n(e.bottom)}"/>`}function sf(t){let e=(n,r)=>{let o=r.align==="left"||r.align==="top"?n==="positionH"?"left":"top":r.align==="right"||r.align==="bottom"?n==="positionH"?"right":"bottom":r.align,s=o?`<wp:align>${o}</wp:align>`:`<wp:posOffset>${Math.round((r.offset??0)*fn)}</wp:posOffset>`;return`<wp:${n} relativeFrom="${r.from}">${s}</wp:${n}>`};return`<wp:simplePos x="0" y="0"/>${e("positionH",t.x)}${e("positionV",t.y)}`}function af(t,e){let n=251658240+(t.z??0)+e.shared.nextDocPr;return`<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${Math.max(0,Math.round(n))}" behindDoc="${t.behind?1:0}" locked="0" layoutInCell="1" allowOverlap="1">`}function Rl(t,e,n,r){let o=Ch(t.src);if(!o)return null;let{shared:s}=e,i=r?1/0:e.maxImageWidth??s.maxImageWidthPx,a=t.width>i?i/t.width:1,l=Math.round(t.width*a*fn),c=Math.round(t.height*a*fn),u=`image${s.nextImage++}.${o.ext==="jpeg"?"jpg":o.ext}`;s.media.push({name:u,bytes:o.bytes});let f=`rIdImg${e.images.length+1}`;e.images.push({id:f,target:`media/${u}`});let p=s.nextDocPr++,m=`<wp:docPr id="${p}" name="Picture ${p}" descr="${Ke(t.alt??"")}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${Al}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${Al}"><a:graphicData uri="${Qd}"><pic:pic xmlns:pic="${Qd}"><pic:nvPicPr><pic:cNvPr id="0" name="${u}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${f}"/>${Mh(t)}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${l}" cy="${c}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;if(r)return`<w:drawing>${af(r,e)}${sf(r)}<wp:extent cx="${l}" cy="${c}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>${m}</wp:anchor></w:drawing>`;if(n){let g=14*fn;return`<w:drawing><wp:anchor distT="0" distB="${Math.round(8*fn)}" distL="${n==="left"?0:g}" distR="${n==="left"?g:0}" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${e.maxImageWidth!==void 0?"column":"margin"}"><wp:align>${n}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${l}" cy="${c}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${m}</wp:anchor></w:drawing>`}return`<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${l}" cy="${c}"/>${m}</wp:inline></w:drawing>`}function Oh(t,e){let n=Rl(t,e);if(!n){let o=t.alt?`[Image: ${t.alt}]`:`[Image: ${t.src.slice(0,80)}]`;return Vt([{text:o,marks:{italic:!0}}],e,{align:t.align})}let r=El({align:t.align});return`<w:p>${r?`<w:pPr>${r}</w:pPr>`:""}<w:r>${n}</w:r></w:p>`}function Ah(t,e,n){n.shared.hasToc=!0;let r=t.blocks.filter(c=>c.type==="heading"&&c.level<=e.levels),o=e.title??"Table of contents",s=[];o&&s.push(Vt([{text:o}],n,{style:"TOCHeading"}));let i=`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${e.levels}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,a='<w:r><w:fldChar w:fldCharType="end"/></w:r>',l=r.length>0?r:null;return l?l.forEach((c,d)=>{let u=`<w:r><w:t xml:space="preserve">${Ke(H(c.runs))}</w:t></w:r>`;s.push(`<w:p><w:pPr><w:pStyle w:val="TOC${c.level}"/></w:pPr>${d===0?i:""}${u}${d===l.length-1?a:""}</w:p>`)}):s.push(`<w:p>${i}<w:r><w:t>Right-click and choose Update Field to build the table of contents.</w:t></w:r>${a}</w:p>`),s.join("")}function Th(t,e,n){let{float:r}=t,o=t.rows[0].cells[0],s=Math.round(r.width*fn),i=Math.round(r.height*fn),a=n.shared.nextDocPr++,l=r.padding??{x:10,y:5},c=(b,k)=>`<a:srgbClr val="${Fi(b)??"000000"}">${k!==void 0&&k<1?`<a:alpha val="${Math.round(k*1e5)}"/>`:""}</a:srgbClr>`,d=r.fill?`<a:solidFill>${c(r.fill,r.fillOpacity)}</a:solidFill>`:"<a:noFill/>",u=r.line?`<a:ln w="${Math.round(r.line.width*fn)}"${r.line.style==="double"?' cmpd="dbl"':""}><a:solidFill>${c(r.line.color)}</a:solidFill>`+(r.line.style==="dashed"?'<a:prstDash val="dash"/>':r.line.style==="dotted"?'<a:prstDash val="sysDot"/>':"")+"</a:ln>":"<a:ln><a:noFill/></a:ln>",f=r.shape==="ellipse"?"ellipse":r.shape==="round_rect"?"roundRect":"rect",p={runDefaults:n.runDefaults,defaultFormat:n.defaultFormat,maxImageWidth:n.maxImageWidth};n.runDefaults=void 0,n.defaultFormat={spaceAfter:2},n.maxImageWidth=Math.max(16,r.width-l.x*2-4);let m=Fs(o.blocks,e,n);Object.assign(n,p);let g=b=>Math.round(b*fn),y=o.vAlign==="middle"?"ctr":o.vAlign==="bottom"?"b":"t";return`<w:drawing>${af(r,n)}${sf(r)}<wp:extent cx="${s}" cy="${i}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${a}" name="Text Box ${a}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${Al}"><a:graphicData uri="${ef}"><wps:wsp xmlns:wps="${ef}"><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${s}" cy="${i}"/></a:xfrm><a:prstGeom prst="${f}"><a:avLst/></a:prstGeom>${d}${u}</wps:spPr><wps:txbx><w:txbxContent>${m}</w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${g(l.x)}" tIns="${g(l.y)}" rIns="${g(l.x)}" bIns="${g(l.y)}" anchor="${y}" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`}function Rh(t,e,n){let r=n.shared.textWidthTwips,o=t.columns.map(y=>Math.round(y*r));o[o.length-1]+=r-o.reduce((y,b)=>y+b,0);let s=t.borders??"all",i='<w:{n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>',a='<w:{n} w:val="nil"/>',l=(y,b)=>(b?i:a).replace("{n}",y).replace("{n}",y),c=s==="all",d=s!=="none",u="<w:tblBorders>"+l("top",d)+l("left",c)+l("bottom",d)+l("right",c)+l("insideH",d)+l("insideV",c)+"</w:tblBorders>",f=Qr(t),p=(y,b)=>o.slice(y,y+b).reduce((k,T)=>k+T,0),m={top:"top",middle:"center",bottom:"bottom"},g=t.rows.map((y,b)=>{let k=b===0&&!!t.headerRow,T=y.cells.map((O,F)=>{if(O.covered){let $=f[b][F];if($.row===b||$.col!==F)return"";let L=t.rows[$.row].cells[$.col],W=at(L);return`<w:tc><w:tcPr><w:tcW w:w="${p(F,W)}" w:type="dxa"/>${W>1?`<w:gridSpan w:val="${W}"/>`:""}<w:vMerge/></w:tcPr><w:p/></w:tc>`}let R=at(O),N=Fi(O.shade??(k?"#f3f4f6":"")),P=`<w:tcPr><w:tcW w:w="${p(F,R)}" w:type="dxa"/>`+(R>1?`<w:gridSpan w:val="${R}"/>`:"")+(yt(O)>1?'<w:vMerge w:val="restart"/>':"")+(N?`<w:shd w:val="clear" w:color="auto" w:fill="${N}"/>`:"")+(O.vAlign?`<w:vAlign w:val="${m[O.vAlign]}"/>`:"")+"</w:tcPr>",B={runDefaults:n.runDefaults,defaultFormat:n.defaultFormat,maxImageWidth:n.maxImageWidth};n.runDefaults=k?{bold:!0}:void 0,n.defaultFormat={spaceAfter:2},n.maxImageWidth=Math.max(16,p(F,R)/15-14);let x=Fs(O.blocks,e,n);return Object.assign(n,B),`<w:tc>${P}${x}</w:tc>`}).join("");return`<w:tr><w:trPr><w:cantSplit/>${y.height?`<w:trHeight w:val="${Math.round(y.height*Sr)}" w:hRule="atLeast"/>`:""}${k?"<w:tblHeader/>":""}</w:trPr>${T}</w:tr>`}).join("");return`<w:tbl><w:tblPr><w:tblW w:w="${r}" w:type="dxa"/>${u}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${o.map(y=>`<w:gridCol w:w="${y}"/>`).join("")}</w:tblGrid>${g}</w:tbl>`}function Fs(t,e,n){let r=[],o=!1,{shared:s}=n,i=Hh(t,s.numbering),a=lo(t),l=null,c=[],d=p=>{let m=p.style&&e.styles?.[p.style]?.kind==="paragraph"?p.style:void 0;if(!m)return{runs:p.runs,align:p.align,format:p.format,style:void 0};if(p.type==="paragraph")return{runs:p.runs,align:p.align,format:p.format,style:s.styleIds.get(m)};let g=Gt(e,p);return{runs:p.runs.map(y=>({...y,marks:oi(e,y.marks,m)})),align:g.align,format:g.format,style:void 0}},u="",f=()=>{let p=u;return u="",p};for(let[p,m]of t.entries()){u&&!("runs"in m)&&!(m.type==="image"&&m.wrap&&Rs(n))&&!(Xe(m)&&Rs(n))&&r.push(`<w:p>${f()}</w:p>`),m.type!=="list_item"&&(c.length=0);let g=o;switch(o=m.type==="table",m.type){case"paragraph":{let y=d(m);r.push(Vt(y.runs,n,{prefix:f(),style:y.style,align:y.align,format:y.format}));break}case"title":{let y=d(m);r.push(Vt(y.runs,n,{prefix:f(),style:"Title",align:y.align,format:y.format}));break}case"subtitle":{let y=d(m);r.push(Vt(y.runs,n,{prefix:f(),style:"Subtitle",align:y.align,format:y.format}));break}case"heading":{let y=d(m);r.push(Vt(y.runs,n,{prefix:f(),style:`Heading${m.level}`,align:y.align,format:y.format}));break}case"quote":{let y=d(m);r.push(Vt(y.runs,n,{prefix:f(),style:"Quote",align:y.align,format:y.format}));break}case"code_block":{let y=m.runs.map(b=>b.text).join("");r.push(Vt([{text:y}],n,{style:"CodeBlock"}));break}case"divider":r.push(Vt([],n,{border:!0}));break;case"page_break":r.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');break;case"image":{if(m.float&&Rs(n)){let b=Rl(m,n,void 0,m.float);b&&(u+=`<w:r>${b}</w:r>`);break}let y=m.wrap&&Rs(n)?Rl(m,n,m.wrap):null;y?u+=`<w:r>${y}</w:r>`:r.push(Oh(m,n));break}case"toc":r.push(Ah(e,m,n));break;case"section_break":break;case"table":if(Xe(m)&&Rs(n)){u+=`<w:r>${Th(m,e,n)}</w:r>`,o=g;break}g&&r.push("<w:p/>"),r.push(Rh(m,e,n));break;case"list_item":{let y=Math.min(Math.max(m.depth,0),Tl),b;if(c.length=m.depth+1,m.list==="bullet")c[m.depth]=0,b=jh(s.numbering,i.get(p).bullet);else{let T=a[p];if(c[m.depth]=T,!l||l.abstractId!==i.get(p).ordered||Gh(l,y)!==T){let I=Array.from({length:Tl+1},(O,F)=>F<y?(c[F]??0)+1:F===y?T:1);l=zh(s.numbering,i.get(p).ordered,I)}l.counters.length=y+1,l.counters[y]=T,b=l.id}let k=d(m);r.push(Vt(k.runs,n,{prefix:f(),style:"ListParagraph",num:{id:b,level:y},align:k.align,format:k.format}));break}}}return u&&r.push(`<w:p>${f()}</w:p>`),o&&r.push("<w:p/>"),r.join("")}var Ol=`xmlns:w="${Co}" xmlns:r="${kh}" xmlns:wp="${wh}"`;function Dh(t,e,n){let{width:r,height:o}=hr(t),s=u=>Math.round(u*1440),i=t.margins,a=t.orientation==="landscape"?' w:orient="landscape"':"",{count:l,gap:c,rule:d}=n.columns;return"<w:sectPr>"+e.map(u=>`<w:${u.kind}Reference w:type="${u.type}" r:id="${u.rid}"/>`).join("")+(n.continuous?'<w:type w:val="continuous"/>':"")+`<w:pgSz w:w="${s(r)}" w:h="${s(o)}"${a}/><w:pgMar w:top="${s(i.top)}" w:right="${s(i.right)}" w:bottom="${s(i.bottom)}" w:left="${s(i.left)}" w:header="720" w:footer="720" w:gutter="0"/>`+(l>1?`<w:cols w:num="${l}" w:space="${Math.round(c*20)}"${d?' w:sep="1"':""}/>`:"")+(n.titlePg?"<w:titlePg/>":"")+"</w:sectPr>"}function Fh(t){let e=[32,26,24,22,22,22];return`<w:style w:type="paragraph" w:styleId="Heading${t}"><w:name w:val="heading ${t}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${t===1?360:240}" w:after="80"/><w:outlineLvl w:val="${t-1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${e[t-1]}"/></w:rPr></w:style>`}function Eh(t){return`<w:style w:type="paragraph" w:styleId="TOC${t}"><w:name w:val="toc ${t}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="${(t-1)*220}"/></w:pPr></w:style>`}function Dl(t){return`Pli_${t.replace(/[^A-Za-z0-9_-]/g,"_")}`}function $h(t,e){return Object.entries(t.styles??{}).map(([n,r])=>{let o=r.basedOn&&t.styles?.[r.basedOn]?.kind===r.kind?Dl(r.basedOn):r.kind==="paragraph"?"Normal":void 0,s=of(r.marks,void 0,e),i=r.kind==="paragraph"?El({align:r.align,format:r.format}):"";return`<w:style w:type="${r.kind}" w:customStyle="1" w:styleId="${Dl(n)}"><w:name w:val="${Ke(r.name)}"/>`+(o?`<w:basedOn w:val="${o}"/>`:"")+"<w:qFormat/>"+(i?`<w:pPr>${i}</w:pPr>`:"")+(s?`<w:rPr>${s}</w:rPr>`:"")+"</w:style>"}).join("")}function Nh(t,e){return St+`<w:styles xmlns:w="${Co}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>`+[1,2,3,4,5,6].map(Fh).join("")+'<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'+[1,2,3,4,5,6].map(Eh).join("")+'<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'+$h(t,e)+"</w:styles>"}var _h={disc:"\u2022",circle:"o",square:"\u25AA"},Ih={decimal:"decimal","lower-alpha":"lowerLetter","upper-alpha":"upperLetter","lower-roman":"lowerRoman","upper-roman":"upperRoman"},Fl=(t,e)=>Array.from({length:Tl+1},(n,r)=>e(r)??He(t,r));function Lh(){return{abstracts:[{id:0,bullet:!0,markers:Fl("bullet",()=>{})},{id:1,bullet:!1,markers:Fl("ordered",()=>{})}],instances:[],bulletNums:new Map([[0,1]]),nextNum:3}}function Uh(t,e,n){let r=t.abstracts.find(s=>s.bullet===e&&s.markers.join()===n.join());if(r)return r.id;let o=t.abstracts.length;return t.abstracts.push({id:o,bullet:e,markers:n}),o}function jh(t,e){let n=t.bulletNums.get(e);return n===void 0&&(n=t.nextNum++,t.bulletNums.set(e,n)),n}function zh(t,e,n){let r={id:t.nextNum++,abstractId:e,starts:n,counters:[]};return t.instances.push(r),r}function Gh(t,e){let n=t.counters[e];return n===void 0?t.starts[e]??1:n+1}function Hh(t,e){let n=new Map;for(let r=0;r<t.length;){if(t[r].type!=="list_item"){r++;continue}let o=r;for(;o<t.length&&t[o].type==="list_item";)o++;let s=t.slice(r,o),i=l=>{let c=s.filter(u=>u.list===l);if(c.length===0)return 0;let d=Fl(l,u=>c.find(f=>f.depth===u&&f.marker&&Nn(f)===f.marker)?.marker);return Uh(e,l==="bullet",d)},a={bullet:i("bullet"),ordered:i("ordered")};for(let l=r;l<o;l++)n.set(l,a);r=o}return n}function Kh(t){let e=r=>r.markers.map((o,s)=>{let i=720*(s+1),a=r.bullet?"bullet":Ih[o],l=r.bullet?_h[o]:`%${s+1}.`;return`<w:lvl w:ilvl="${s}"><w:start w:val="1"/><w:numFmt w:val="${a}"/><w:lvlText w:val="${l}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${i}" w:hanging="360"/></w:pPr>`+(r.bullet&&o==="circle"?'<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New" w:hint="default"/></w:rPr>':"")+"</w:lvl>"}).join(""),n=r=>r.map((o,s)=>`<w:lvlOverride w:ilvl="${s}"><w:startOverride w:val="${o}"/></w:lvlOverride>`).join("");return St+`<w:numbering xmlns:w="${Co}">`+t.abstracts.map(r=>`<w:abstractNum w:abstractNumId="${r.id}"><w:multiLevelType w:val="hybridMultilevel"/>${e(r)}</w:abstractNum>`).join("")+'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'+[...t.bulletNums].filter(([r])=>r!==0).map(([r,o])=>`<w:num w:numId="${o}"><w:abstractNumId w:val="${r}"/></w:num>`).join("")+t.instances.map(r=>`<w:num w:numId="${r.id}"><w:abstractNumId w:val="${r.abstractId}"/>${n(r.starts)}</w:num>`).join("")+"</w:numbering>"}function Di(t){return St+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+t.map(e=>`<Relationship Id="${e.id}" Type="${e.type}" Target="${Ke(e.target)}"${e.external?' TargetMode="External"':""}/>`).join("")+"</Relationships>"}var Wh="http://schemas.microsoft.com/office/word/2010/wordml",qh="http://schemas.microsoft.com/office/word/2012/wordml";function Xh(t,e,n){let r=268435456,o="",s="";for(let i of t){let a=e.comments.get(i.id).word,l=null;i.comments.forEach((c,d)=>{let u=(++r).toString(16).toUpperCase().padStart(8,"0"),f=n(c.author)||c.author,p=f.split(/\s+/).filter(Boolean).map(y=>y[0]).join("").slice(0,3).toUpperCase(),m=new Date(c.createdAt).toISOString().replace(/\.\d+Z$/,"Z"),g=c.body.split(/\r?\n/).map((y,b)=>{let k=b===0?'<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>':"";return`<w:p${b===0?` w14:paraId="${u}"`:""}><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${k}<w:r><w:t xml:space="preserve">${Ke(y)}</w:t></w:r></w:p>`});o+=`<w:comment w:id="${a[d]}" w:author="${Ke(f)}" w:date="${m}" w:initials="${Ke(p)}">${g.join("")}</w:comment>`,s+=`<w15:commentEx w15:paraId="${u}"${l?` w15:paraIdParent="${l}"`:""} w15:done="${i.resolved?1:0}"/>`,l??(l=u)})}return[`${St}<w:comments xmlns:w="${Co}" xmlns:w14="${Wh}">${o}</w:comments>`,`${St}<w15:commentsEx xmlns:w15="${qh}">${s}</w15:commentsEx>`]}function Ds(t){return[...t.links.map((e,n)=>({id:`rIdLink${n+1}`,type:`${Xt}/hyperlink`,target:e,external:!0})),...t.images.map(e=>({id:e.id,type:`${Xt}/image`,target:e.target}))]}function $l(t,e={}){let n=Ht(t),{width:r}=hr(n),o={nextImage:1,nextDocPr:1,numbering:Lh(),media:[],hasToc:!1,maxImageWidthPx:Math.max(1,(r-n.margins.left-n.margins.right)*Ea),textWidthTwips:Math.max(720,Math.round((r-n.margins.left-n.margins.right)*1440)),footnoteIds:new Map,comments:new Map,styleIds:new Map(Object.keys(t.styles??{}).map(B=>[B,Dl(B)])),revision:1e3,authorName:e.authorName??(B=>B),fonts:{mode:e.fonts==="office"?"office":"keep",names:new Set(["Arial","Courier New"])}},s=[...e.comments??Object.values(t.comments??{})].map(B=>({thread:B,total:Tn(t,B.id).length})).filter(B=>B.total>0&&B.thread.comments.length>0),i=0;for(let{thread:B,total:x}of s)o.comments.set(B.id,{word:B.comments.map(()=>i++),total:x,seen:0});let a=Qe(t.blocks).filter(B=>t.footnotes?.[B]?.length);a.forEach((B,x)=>o.footnoteIds.set(B,x+1));let l=Ml(o),c=Bt(t),d=[];c.forEach((B,x)=>{let $={differentFirstPage:Na(t,c,x),differentOddEven:n.differentOddEven};for(let L of["header","footer"])for(let W of Pu($,L)){let Q=x===0?t[W]:B.start?.regions?.[W];if(Q===void 0||Q.length===0&&x===0)continue;let V=Ml(o,L==="header"?"Header":"Footer"),J=d.filter(se=>se.kind===L).length+1;d.push({section:x,kind:L,type:Cu(W),part:V,xml:Q.length===0?"<w:p/>":Fs(Q,t,V),file:`${L}${J}.xml`,rid:`rId${L==="header"?"Header":"Footer"}${J}`})}});let u=[],f="";c.forEach((B,x)=>{let $=Kt(t,c,x),L=hr($).width-$.margins.left-$.margins.right;o.maxImageWidthPx=Math.max(1,L*Ea),o.textWidthTwips=Math.max(720,Math.round(L*1440));let W=Fs(t.blocks.slice(B.from,B.to),t,l),Q=Dh($,d.filter(V=>V.section===x),{columns:B.columns,continuous:x>0&&!Zc(t,c,x),titlePg:Na(t,c,x)});x===c.length-1?(u.push(W),f=Q):u.push(W,`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${Q}</w:pPr></w:p>`)});let p=u.join(""),m=Ml(o,"FootnoteText"),g=a.map((B,x)=>{let $=[...t.footnotes[B]],L=$[0];return"runs"in L&&($[0]={...L,runs:[{text:"",marks:{footnote:Da}},{text:" "},...L.runs]}),`<w:footnote w:id="${x+1}">${Fs($,t,m)}</w:footnote>`}),y=a.length>0,b=s.length>0,k=!0,T=St+`<w:document ${Ol}><w:body>${p||"<w:p/>"}${f}</w:body></w:document>`,I=[{id:"rIdStyles",type:`${Xt}/styles`,target:"styles.xml"},{id:"rIdFontTable",type:`${Xt}/fontTable`,target:"fontTable.xml"},{id:"rIdNumbering",type:`${Xt}/numbering`,target:"numbering.xml"},...k?[{id:"rIdSettings",type:`${Xt}/settings`,target:"settings.xml"}]:[],...d.map(B=>({id:B.rid,type:`${Xt}/${B.kind}`,target:B.file})),...y?[{id:"rIdFootnotes",type:`${Xt}/footnotes`,target:"footnotes.xml"}]:[],...b?[{id:"rIdComments",type:`${Xt}/comments`,target:"comments.xml"},{id:"rIdCommentsExt",type:"http://schemas.microsoft.com/office/2011/relationships/commentsExtended",target:"commentsExtended.xml"}]:[],...Ds(l)],O=St+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'+(k?'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>':"")+(y?'<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>':"")+(b?'<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>':"")+d.map(B=>`<Override PartName="/word/${B.file}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${B.kind}+xml"/>`).join("")+'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',F=Di([{id:"rId1",type:`${Xt}/officeDocument`,target:"word/document.xml"},{id:"rId2",type:"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",target:"docProps/core.xml"}]),R=St+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${Ke(t.title)}</dc:title></cp:coreProperties>`,N=Nh(t,o.fonts),P={"[Content_Types].xml":$e(O),"_rels/.rels":$e(F),"docProps/core.xml":$e(R),"word/document.xml":$e(T),"word/styles.xml":$e(N),"word/numbering.xml":$e(Kh(o.numbering)),"word/_rels/document.xml.rels":$e(Di(I))};if(k&&(P["word/settings.xml"]=$e(`${St}<w:settings xmlns:w="${Co}">${n.differentOddEven?"<w:evenAndOddHeaders/>":""}${o.hasToc?'<w:updateFields w:val="true"/>':""}${y?'<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>':""}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`)),y&&(P["word/footnotes.xml"]=$e(`${St}<w:footnotes ${Ol}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`+g.join("")+"</w:footnotes>"),Ds(m).length>0&&(P["word/_rels/footnotes.xml.rels"]=$e(Di(Ds(m))))),b){let[B,x]=Xh(s.map($=>$.thread),o,e.authorName??($=>$));P["word/comments.xml"]=$e(B),P["word/commentsExtended.xml"]=$e(x)}for(let B of d){let x=B.kind==="header"?"hdr":"ftr";P[`word/${B.file}`]=$e(`${St}<w:${x} ${Ol}>${B.xml}</w:${x}>`),Ds(B.part).length>0&&(P[`word/_rels/${B.file}.rels`]=$e(Di(Ds(B.part))))}for(let B of o.media)P[`word/media/${B.name}`]=B.bytes;return P["word/fontTable.xml"]=$e(xh(o.fonts.names)),Zd(P)}var _l=class{constructor(e,n){ue(this,"files");let r=0;try{this.files=Yd(e,{filter(o){if(r+=o.originalSize,r>n)throw new C("invalid_document","The file is too large when unpacked");return!0}})}catch(o){throw o instanceof C?o:new C("invalid_document","Not a .docx file: it couldn't be opened as a zip archive",{cause:o})}}has(e){return e in this.files}text(e){let n=this.files[e];return n?Bl(n):void 0}xml(e){let n=this.text(e);return n===void 0?void 0:ua(n)}rels(e){let n=e.lastIndexOf("/");return this.relsFile(`${e.slice(0,n+1)}_rels/${e.slice(n+1)}.rels`)}relsFile(e){let n=this.xml(e),r=new Map;for(let o of Ee(n,"Relationship")){let s=o.attrs.Id;s&&r.set(s,{type:o.attrs.Type??"",target:o.attrs.Target??"",external:o.attrs.TargetMode==="External"})}return r}};function cf(t,e){if(e.startsWith("/"))return e.slice(1);let n=t.split("/").slice(0,-1);for(let r of e.split("/"))r===".."?n.pop():r!=="."&&r!==""&&n.push(r);return n.join("/")}var Gn=20,xr=9525;function Hn(t){if(!t)return!1;let e=S(t,"val");return e===void 0||!["0","false","off","none"].includes(e.toLowerCase())}var Y=t=>{if(t===void 0)return;let e=Number(t);return Number.isFinite(e)?e:void 0},be=(t,e,n)=>Math.min(n,Math.max(e,t));function Es(t,e){if(t){if(t.name===e)return t;for(let n of Fe(t)){let r=Es(n,e);if(r)return r}}}var Vh={dk1:"#000000",lt1:"#ffffff",dk2:"#44546a",lt2:"#e7e6e6",accent1:"#4472c4",accent2:"#ed7d31",accent3:"#a5a5a5",accent4:"#ffc000",accent5:"#5b9bd5",accent6:"#70ad47",hlink:"#0563c1",folHlink:"#954f72"},Jh={bg1:"lt1",tx1:"dk1",bg2:"lt2",tx2:"dk2"},Zh=(t,e,n)=>`#${[t,e,n].map(r=>Math.round(be(r,0,255)).toString(16).padStart(2,"0")).join("")}`;function Yh(t,e){let[n,r,o]=[1,3,5].map(s=>parseInt(t.slice(s,s+2),16));for(let s of e){let i=(Y(S(s,"val"))??1e5)/1e5;if(s.name==="lumMod"||s.name==="lumOff"){let a=Math.max(n,r,o)/255,l=Math.min(n,r,o)/255,c=0,d=0,u=(a+l)/2,f=a-l;if(f>0){d=u>.5?f/(2-a-l):f/(a+l);let g=n/255,y=r/255,b=o/255;c=a===g?(y-b)/f+(y<b?6:0):a===y?(b-g)/f+2:(g-y)/f+4,c/=6}let p=be(s.name==="lumMod"?u*i:u+i,0,1),m=(g,y,b)=>{let k=b<0?b+1:b>1?b-1:b;return k<1/6?g+(y-g)*6*k:k<1/2?y:k<2/3?g+(y-g)*(2/3-k)*6:g};if(d===0)n=r=o=p*255;else{let g=p<.5?p*(1+d):p+d-p*d,y=2*p-g;[n,r,o]=[m(y,g,c+1/3)*255,m(y,g,c)*255,m(y,g,c-1/3)*255]}}else s.name==="shade"?[n,r,o]=[n*i,r*i,o*i]:s.name==="tint"&&([n,r,o]=[255-(255-n)*i,255-(255-r)*i,255-(255-o)*i])}return Zh(n,r,o)}function Po(t){if(!t||t.toLowerCase()==="auto")return;let e=/^#?([0-9a-f]{6})$/i.exec(t.trim());return e?`#${e[1].toLowerCase()}`:void 0}var lf={black:"#000000",blue:"#0000ff",cyan:"#00ffff",darkBlue:"#000080",darkCyan:"#008080",darkGray:"#808080",darkGreen:"#008000",darkMagenta:"#800080",darkRed:"#800000",darkYellow:"#808000",green:"#00ff00",lightGray:"#c0c0c0",magenta:"#ff00ff",red:"#ff0000",white:"#ffffff",yellow:"#ffff00"},$i=t=>t.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,""),Ei="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";function Qh(t){let e="";for(let n=0;n<t.length;n+=3){let r=t[n],o=t[n+1],s=t[n+2];e+=Ei[r>>2]+Ei[(r&3)<<4|(o??0)>>4],e+=o===void 0?"=":Ei[(o&15)<<2|(s??0)>>6],e+=s===void 0?"=":Ei[s&63]}return e}var eg={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",bmp:"image/bmp"},tg=new Set(["normal","title","subtitle","quote","intense quote","list paragraph","header","footer","toc heading","footnote text","footnote reference","endnote text","endnote reference","annotation text","annotation reference","annotation subject","hyperlink","followedhyperlink","default paragraph font","balloon text","page number","line number","code block","source code","table of figures","macro text"]);function Ni(t){let e=t.toLowerCase();return tg.has(e)||/^heading [1-9]$/.test(e)||/^toc [1-9]$/.test(e)}function ng(t,e){let n=t.toLowerCase(),r=/^heading ([1-6])$/.exec(n)??/^heading([1-6])$/i.exec(e);return r?{type:"heading",level:Number(r[1])}:n==="title"?{type:"title"}:n==="subtitle"?{type:"subtitle"}:n==="quote"||n==="intense quote"?{type:"quote"}:n==="code block"||n==="source code"?{type:"code"}:null}function rg(t){let e=new Map;for(let r of Ee(t,"abstractNum")){let o=new Map;for(let s of Ee(r,"lvl"))o.set(Y(S(s,"ilvl"))??0,{format:S(A(s,"numFmt"),"val")??"decimal",text:S(A(s,"lvlText"),"val")??"",start:Math.max(0,Math.round(Y(S(A(s,"start"),"val"))??1))});e.set(S(r,"abstractNumId")??"",o)}let n=new Map;for(let r of Ee(t,"num")){let o=S(A(r,"abstractNumId"),"val")??"",s=e.get(o);if(!s)continue;let i=new Map;for(let a of Ee(r,"lvlOverride")){let l=Y(S(A(a,"startOverride"),"val"));l!==void 0&&i.set(Y(S(a,"ilvl"))??0,Math.max(0,Math.round(l)))}n.set(S(r,"numId")??"",{levels:s,abstractId:o,overrides:i})}return{nums:n}}var og={decimal:"decimal",decimalZero:"decimal",lowerLetter:"lower-alpha",upperLetter:"upper-alpha",lowerRoman:"lower-roman",upperRoman:"upper-roman"};function sg(t){if(!t)return{list:"ordered"};if(t.format==="bullet"||t.format==="none"){let n=t.text.trim(),r=n==="o"||n==="\u25E6"||n==="\u25CB"?"circle":/^[\uf0a7\u25aa\u25a0\u25fc]$/.test(n)?"square":n===""?void 0:"disc";return{list:"bullet",...r&&{marker:r}}}let e=og[t.format];return{list:"ordered",...e&&{marker:e}}}var At=t=>"section"in t;function uf(t){let e=A(t,"pgSz"),n=A(t,"pgMar"),r=A(t,"cols"),o=(d,u)=>Y(d)??u,s=(d,u)=>be(Math.round(o(d,u*1440)/1440*100)/100,0,5),i=o(S(e,"w"),12240)/1440,a=o(S(e,"h"),15840)/1440,l=Y(S(r,"num"))??1,c=l>1?{count:be(Math.round(l),1,4),gap:be((Y(S(r,"space"))??720)/Gn,0,200),...Hn(r)&&S(r,"sep")&&S(r,"sep")!=="0"?{rule:!0}:{}}:void 0;return{width:i,height:a,landscape:S(e,"orient")==="landscape"||i>a,margins:{top:s(S(n,"top"),1),right:s(S(n,"right"),1),bottom:s(S(n,"bottom"),1),left:s(S(n,"left"),1)},...c&&{columns:c},continuous:S(A(t,"type"),"val")==="continuous",titlePg:Hn(A(t,"titlePg")),refs:Fe(t).filter(d=>d.name==="headerReference"||d.name==="footerReference").map(d=>({kind:d.name==="headerReference"?"header":"footer",variant:S(d,"type")==="first"?"first":S(d,"type")==="even"?"even":"default",rid:S(d,"id","r")??""}))}}function Nl(t,e){let[n,r]=[Math.min(t.width,t.height),Math.max(t.width,t.height)],o="letter",s=1/0;for(let[i,a]of Object.entries(En)){let l=Math.abs(a.width-n)+Math.abs(a.height-r);l<s&&(s=l,o=i)}return s>.15&&e(`A page size of ${n.toFixed(2)} \xD7 ${r.toFixed(2)} inches isn't supported, so the nearest standard size was used`),o}var Bo=class t{constructor(e,n,r,o){this.shared=e;this.part=n;this.rels=r;this.mode=o;ue(this,"fields",[]);ue(this,"open",new Set);ue(this,"skipSpace",!1);ue(this,"change",null);ue(this,"changeCount",0);ue(this,"tocHeadings",new Set)}warn(e){this.shared.warnings.add(e)}latinFont(e){let n=o=>{let s=o&&/^(major|minor)/.test(o)?o.startsWith("major")?"major":"minor":void 0;return(s&&/^(major|minor)(Ascii|HAnsi)$/.test(o)?this.shared.themeFonts?.[s]:void 0)||void 0};return(n(S(e,"asciiTheme"))??S(e,"ascii")??n(S(e,"hAnsiTheme"))??S(e,"hAnsi"))?.trim()||void 0}blocks(e){let n=[];for(let r of e)switch(r.name){case"p":this.paragraph(r,n);break;case"tbl":this.mode==="cell"||this.mode==="note"?this.flattenTable(r,n):n.push(this.table(r));break;case"sdt":n.push(...this.blocks(Fe(A(r,"sdtContent"))));break;case"ins":case"moveTo":case"customXml":n.push(...this.blocks(Fe(r)));break;default:break}return this.tidy(n)}tidy(e){let n=[];return e.forEach((r,o)=>{let s=n[n.length-1];if(!At(r)&&r.type==="toc"&&r.title===""&&s&&!At(s)&&s.type==="paragraph"&&this.tocHeadings.has(s.id)){n.pop(),n.push({...r,title:H(s.runs)});return}if(!At(r)&&r.type==="paragraph"&&r.runs.length===0&&!r.style&&!r.align&&!r.format){let i=n[n.length-1],a=e[o+1];if(i&&!At(i)&&i.type==="table"&&(a===void 0||!At(a)&&a.type==="table"))return}n.push(r)}),n}flattenTable(e,n){this.warn("A table inside a table, or inside a note, was turned into plain paragraphs");for(let r of Ee(e,"tr"))for(let o of Ee(r,"tc"))n.push(...this.blocks(Fe(o)).filter(s=>!At(s)))}info(e){let n=S(A(e,"pStyle"),"val"),r={type:"paragraph"},o,s=A(e,"numPr"),i=new Set;for(let m=n;m!==void 0&&!i.has(m);){i.add(m);let g=this.shared.styles.get(m);if(!g)break;let y=ng(g.name,g.id);y&&r.type==="paragraph"&&(r=y),s??(s=A(g.pPr,"numPr")),m=g.basedOn}let a=n?this.shared.styles.get(n):void 0;a&&a.type==="paragraph"&&!Ni(a.name)&&(this.shared.used.add(a.id),o=a.id);let l,c=S(A(s,"numId"),"val");if(c&&c!=="0"&&(r.type==="paragraph"||r.type==="quote")){let m=be(Math.round(Y(S(A(s,"ilvl"),"val"))??0),0,8),g=this.shared.numbering.nums.get(c)?.levels.get(m),y=sg(g);l={list:y.list,depth:m,numId:c,...y.marker&&{marker:y.marker}}}let d=S(A(e,"jc"),"val"),u=d==="center"?"center":d==="right"||d==="end"?"right":d==="both"||d==="distribute"||d==="justify"?"justify":void 0,f=this.formatOf(e),p=A(A(e,"pBdr"),"bottom");return{kind:r,...o&&{style:o},...n&&{wordStyle:n},...u&&{align:u},...f&&{format:f},...l&&{list:l},pageBreakBefore:Hn(A(e,"pageBreakBefore")),divider:!!p&&!["nil","none"].includes(S(p,"val")??"single")}}formatOf(e){let n={},r=A(e,"spacing"),o=Y(S(r,"before")),s=Y(S(r,"after")),i=Y(S(r,"line"));o!==void 0&&(n.spaceBefore=be(o/Gn,0,1e3)),s!==void 0&&(n.spaceAfter=be(s/Gn,0,1e3)),i!==void 0&&(S(r,"lineRule")??"auto")==="auto"&&(n.lineHeight=be(Math.round(i/240*100)/100,.5,10));let a=A(e,"ind"),l=Y(S(a,"left")??S(a,"start")),c=Y(S(a,"right")??S(a,"end")),d=Y(S(a,"firstLine")),u=Y(S(a,"hanging"));return l&&(n.indentLeft=be(l/Gn,0,1e3)),c&&(n.indentRight=be(c/Gn,0,1e3)),u?n.indentFirst=be(-u/Gn,-1e3,1e3):d&&(n.indentFirst=be(d/Gn,-1e3,1e3)),Object.keys(n).length>0?n:void 0}paragraph(e,n){let r=A(e,"pPr"),o=this.info(r),s=A(r,"sectPr"),i=this.fields.some(f=>f.kind==="toc"),a=[];this.inline(e,a,void 0);let l=this.fields.some(f=>f.kind==="toc");o.pageBreakBefore&&this.mode==="body"&&n.push({id:D("b_"),type:"page_break"});for(let f of a)f.kind==="float"&&n.push(f.block);let c=[],d=!1,u=(f=!1)=>{let p=he(c);c=[],!(p.length===0&&!f)&&(n.push(this.textBlock(o,p)),d=!0)};for(let f of a)f.kind!=="float"&&(f.kind==="run"?c.push(f.run):f.kind==="image"?(u(),n.push({...f.block,...o.align&&{align:o.align}}),d=!0):f.kind==="page_break"?(u(),this.mode==="body"&&n.push({id:D("b_"),type:"page_break"}),d=!0):(u(),this.pushToc(f.levels,n),d=!0));(c.length>0||!d&&!i&&!l&&!s)&&(!d&&c.length===0&&o.divider&&this.mode!=="note"?n.push({id:D("b_"),type:"divider"}):u(!0)),s&&this.mode==="body"&&n.push({section:uf(s)})}pushToc(e,n){let r=n[n.length-1],o;r&&!At(r)&&r.type==="paragraph"&&this.tocHeadings.has(r.id)&&(o=H(r.runs),n.pop()),n.push({id:D("b_"),type:"toc",levels:be(e,1,6),title:o??""})}listItem(e,n,r,o){let{nums:s}=this.shared.numbering,i=s.get(n.numId);if(n.list==="ordered"&&i){let l=this.shared.counters.get(i.abstractId)??[],c=i.overrides.get(n.depth),d=!this.shared.usedLevels.has(`${n.numId}:${n.depth}`);this.shared.usedLevels.add(`${n.numId}:${n.depth}`);let u=c!==void 0&&d?c:l[n.depth]===void 0?i.levels.get(n.depth)?.start??1:l[n.depth]+1;l.length=n.depth+1,l[n.depth]=u,this.shared.counters.set(i.abstractId,l),this.shared.wordNumbers.set(e,u)}let a=n.marker&&n.marker!==He(n.list,n.depth)?n.marker:void 0;return{id:e,type:"list_item",list:n.list,depth:n.depth,...a&&{marker:a},runs:r,...o}}textBlock(e,n){let r=D("b_"),o={...e.align&&{align:e.align},...e.format&&{format:e.format},...e.style&&{style:e.style}},s=e.wordStyle?this.shared.styles.get(e.wordStyle):void 0,i=e.kind;if(this.mode==="note"&&(i.type==="heading"||i.type==="title"||i.type==="subtitle")&&(i={type:"paragraph"}),i.type==="code")return{id:r,type:"code_block",runs:n.length>0?[{text:n.map(l=>l.text).join("")}]:[]};if(e.list&&(i.type==="paragraph"||i.type==="quote"))return this.listItem(r,e.list,n,o);if(i.type==="heading")return{id:r,type:"heading",level:i.level,runs:n,...o};if(i.type==="title"||i.type==="subtitle"||i.type==="quote")return{id:r,type:i.type,runs:n,...o};let a={id:r,type:"paragraph",runs:n,...o};return s&&/^toc ?heading$/i.test(s.name)&&this.tocHeadings.add(r),a}inline(e,n,r){for(let o of Fe(e))switch(o.name){case"r":this.run(o,n,r);break;case"hyperlink":{let s=S(o,"id","r"),i=s?this.rels.get(s):void 0,a=S(o,"anchor");this.inline(o,n,i?.target??(a?`#${a}`:r));break}case"fldSimple":{let s=this.classify(S(o,"instr")??"");this.fields.push({phase:"result",instr:S(o,"instr")??"",...s}),this.inline(o,n,r),this.fields.pop(),s.kind==="toc"&&n.push({kind:"toc",levels:this.tocLevels(S(o,"instr")??"")});break}case"ins":case"moveTo":this.tracked(o,"insert",n,r);break;case"del":case"moveFrom":this.tracked(o,"delete",n,r);break;case"smartTag":case"sdtContent":case"customXml":case"dir":case"bdo":this.inline(o,n,r);break;case"sdt":this.inline(A(o,"sdtContent")??o,n,r);break;case"commentRangeStart":{let s=S(o,"id");s!==void 0&&this.open.add(s);break}case"commentRangeEnd":{let s=S(o,"id");s!==void 0&&this.open.delete(s);break}case"pict":case"object":this.warn("A drawing or embedded object that isn't a picture was left out");break;default:break}}tracked(e,n,r,o){if(this.shared.acceptChanges){n==="insert"&&this.inline(e,r,o);return}let s=this.change,i=Date.parse(S(e,"date")??"");this.change={id:`sg_${S(e,"id")??`n${this.changeCount++}`}_${n}`,kind:n,by:this.shared.authorOf(S(e,"author")??""),at:Number.isFinite(i)&&i>=0?i:0},this.inline(e,r,o),this.change=s}classify(e){let n=/^\s*([A-Za-z]+)/.exec(e)?.[1]?.toUpperCase();if(n==="PAGE")return{kind:"page"};if(n==="NUMPAGES")return{kind:"pages"};if(n==="TOC")return{kind:"toc"};if(n==="HYPERLINK"){let r=/"([^"]*)"/.exec(e)?.[1],o=/\\l\s+"([^"]*)"/.exec(e)?.[1],s=o&&!r?`#${o}`:r;return s?{kind:"link",link:s}:{kind:"plain"}}return{kind:"plain"}}tocLevels(e){let n=/\\o\s+"(\d)-(\d)"/.exec(e);return n?Number(n[2]):3}run(e,n,r){let o=A(e,"rPr"),s=r,i=()=>this.fields.some(u=>u.phase==="instr"||u.kind==="toc"),a=()=>{let u=this.marksOf(o),f=this.charStyleOf(o);f&&(u.style=f);let p=[...this.fields].reverse().find(y=>y.phase==="result"&&(y.kind==="link"||y.kind==="page"||y.kind==="pages")),m=s??(p?.kind==="link"?p.link:void 0);m&&(u.link=m),p&&(p.kind==="page"||p.kind==="pages")&&(u.field=p.kind),this.change&&(u.suggest=this.change);let g=[...this.open].flatMap(y=>this.shared.threadOf.get(y)??[]);return g.length>0&&(u.comment=[...new Set(g)].sort()),u.link&&S(A(o,"rStyle"),"val")==="Hyperlink"&&delete u.underline,u},l="",c=()=>{if(l==="")return;let u={text:l},f=a();Object.keys(f).length>0&&(u.marks=f),n.push({kind:"run",run:u}),l=""},d=u=>{switch(u.name){case"AlternateContent":for(let f of Fe(A(u,"Choice")))d(f);break;case"fldChar":{let f=S(u,"fldCharType");if(f==="begin")c(),this.fields.push({phase:"instr",instr:"",kind:"plain"});else if(f==="separate"){c();let p=this.fields[this.fields.length-1];p&&(p.phase="result",Object.assign(p,this.classify(p.instr)),p.kind==="toc"&&n.push({kind:"toc",levels:this.tocLevels(p.instr)}))}else f==="end"&&(c(),this.fields.pop());break}case"instrText":{let f=this.fields[this.fields.length-1];f&&f.phase==="instr"&&(f.instr+=Ct(u));break}case"delText":case"t":if(u.name==="delText"&&this.change?.kind!=="delete")break;if(!i()){let f=Ct(u);this.skipSpace&&(f.startsWith(" ")&&(f=f.slice(1)),f!==""&&(this.skipSpace=!1)),l+=f}break;case"tab":i()||(l+="	");break;case"br":{if(i())break;S(u,"type")==="page"?(c(),n.push({kind:"page_break"})):l+=`
`;break}case"cr":i()||(l+=`
`);break;case"noBreakHyphen":i()||(l+="-");break;case"footnoteRef":this.skipSpace=!0;break;case"footnoteReference":{if(i())break;c();let f=S(u,"id")??"",p=this.shared.footnotes.get(f);p&&this.mode==="body"?(this.shared.referencedNotes.add(f),n.push({kind:"run",run:{text:Fn,marks:{footnote:p}}})):this.mode!=="body"&&this.warn("A footnote reference inside a table, header or note was left out");break}case"pict":case"object":i()||this.warn("A drawing or embedded object that isn't a picture was left out");break;case"drawing":{if(i())break;if(c(),Es(u,"wsp")){let p=this.textBox(u);p&&n.push({kind:"float",block:p});break}let f=this.image(u);f&&n.push(f.float?{kind:"float",block:f}:{kind:"image",block:f});break}default:break}};for(let u of Fe(e))d(u);c()}charStyleOf(e){let n=S(A(e,"rStyle"),"val"),r=n?this.shared.styles.get(n):void 0;if(!(!r||r.type!=="character"||Ni(r.name)||r.linked))return this.shared.used.add(r.id),r.id}marksOf(e){let n={};if(!e)return n;let r;for(let o of Fe(e))switch(o.name){case"b":Hn(o)&&(n.bold=!0);break;case"i":Hn(o)&&(n.italic=!0);break;case"strike":case"dstrike":Hn(o)&&(n.strike=!0);break;case"u":{let s=S(o,"val");s!=="none"&&s!=="0"&&(n.underline=!0);break}case"vertAlign":{let s=S(o,"val");s==="superscript"?n.superscript=!0:s==="subscript"&&(n.subscript=!0);break}case"color":{let s=Po(S(o,"val"));s&&(n.color=s);break}case"sz":{let s=Y(S(o,"val"));s!==void 0&&s>0&&(n.fontSize=be(s/2,1,400));break}case"highlight":{let s=lf[S(o,"val")??""];s&&(n.highlight=s);break}case"shd":r=Po(S(o,"fill"));break;case"rFonts":{let s=this.latinFont(o);s&&(n.fontFamily=s);break}default:break}return r&&!n.highlight&&(n.highlight=r),n}image(e){let n=(O,F)=>Es(O,F),r=n(e,"blip"),o=n(e,"extent"),s=n(e,"docPr"),i=S(s,"descr")||void 0;if(!r)return this.warn("A drawing that isn't a picture (a chart, a diagram or a group of shapes) was left out"),null;let a=S(r,"embed","r"),l=a?this.rels.get(a):void 0,c=be(Math.round((Y(S(o,"cx"))??0)/xr),1,2e4)||100,d=be(Math.round((Y(S(o,"cy"))??0)/xr),1,2e4)||100;if(!l||l.external)return this.warn("A picture that is linked rather than stored in the file was left out"),null;let u=cf(this.part,l.target),f=this.shared.pkg.files[u],p=eg[u.slice(u.lastIndexOf(".")+1).toLowerCase()];if(!f||!p)return this.warn("A picture in a format that can't be shown (such as EMF or TIFF) was left out"),null;let m=n(e,"anchor"),g;if(m&&(this.mode==="body"||this.mode==="cell")&&["wrapSquare","wrapTight","wrapThrough"].some(O=>n(m,O))){let O=n(m,"positionH"),F=Ct(n(O??m,"align")).trim().toLowerCase(),R=Y(Ct(n(O??m,"posOffset")).trim());g=F==="right"||F==="outside"?"right":F==="left"||F==="inside"?"left":R!==void 0&&R>2e6?"right":"left"}let y=n(e,"srcRect"),b=O=>be((Y(S(y,O))??0)/1e5,0,.9),k={top:b("t"),right:b("r"),bottom:b("b"),left:b("l")},T=y&&(k.top||k.right||k.bottom||k.left)&&k.left+k.right<=.95&&k.top+k.bottom<=.95?k:void 0,I=m&&this.mode==="body"&&n(m,"wrapNone")?this.placement(m):void 0;return{id:D("b_"),type:"image",src:`data:${p};base64,${Qh(f)}`,...i&&{alt:i},width:c,height:d,...g&&{wrap:g},...T&&{crop:T},...I&&{float:I}}}placement(e){let n={page:"page",margin:"margin",leftMargin:"margin",rightMargin:"margin",insideMargin:"margin",outsideMargin:"margin",column:"column",character:"column"},r={page:"page",margin:"margin",topMargin:"margin",bottomMargin:"margin",insideMargin:"margin",outsideMargin:"margin",paragraph:"paragraph",line:"paragraph"},o={left:"left",inside:"left",center:"center",right:"right",outside:"right"},s={top:"top",inside:"top",center:"center",bottom:"bottom",outside:"bottom"},i=(a,l,c,d)=>{let u=l[S(a,"relativeFrom")??""]??c,f=d[Ct(A(a,"align")).trim()],p=Math.round((Y(Ct(A(a,"posOffset")).trim())??0)/xr);return{from:u,...f?{align:f}:p?{offset:p}:{}}};return{x:i(A(e,"positionH"),n,"column",o),y:i(A(e,"positionV"),r,"paragraph",s),...S(e,"behindDoc")==="1"||S(e,"behindDoc")==="true"?{behind:!0}:{}}}colourIn(e){let n=A(e,"srgbClr")??A(e,"schemeClr")??A(e,"sysClr")??A(e,"prstClr");if(!n)return;let r;if(n.name==="srgbClr")r=Po(S(n,"val"));else if(n.name==="schemeClr"){let i=S(n,"val")??"";r=this.shared.themeColors?.[Jh[i]??i]}else n.name==="sysClr"?r=Po(S(n,"lastClr"))??(S(n,"val")==="window"?"#ffffff":"#000000"):r=lf[S(n,"val")??""]??"#000000";if(!r)return;let o=Fe(n),s=Y(S(o.find(i=>i.name==="alpha"),"val"));return{color:Yh(r,o),...s!==void 0&&s<1e5&&{alpha:s/1e5}}}textBox(e){let n=Es(e,"anchor"),r=Es(e,"wsp");if(!n||!r)return this.warn("A text box that isn't anchored to a page was left out"),null;if(this.mode!=="body")return this.warn("A text box or shape inside a header, footer, table or note was left out"),null;let o=A(n,"extent"),s=be(Math.round((Y(S(o,"cx"))??0)/xr),1,2e4)||100,i=be(Math.round((Y(S(o,"cy"))??0)/xr),1,2e4)||100,a=A(r,"spPr"),l=A(r,"style"),c=S(A(a,"prstGeom"),"prst")??"rect",d=c==="ellipse"?"ellipse":c==="roundRect"?"round_rect":"rect";["rect","roundRect","ellipse"].includes(c)||this.warn("A shape other than a rectangle, rounded rectangle or oval was drawn as a rectangle");let u,f=A(a,"solidFill"),p=A(A(A(a,"gradFill"),"gsLst"),"gs");f?u=this.colourIn(f):p?u=this.colourIn(p):!A(a,"noFill")&&!A(a,"blipFill")&&(Y(S(A(l,"fillRef"),"idx"))??0)>0&&(u=this.colourIn(A(l,"fillRef")));let m=A(a,"ln"),g,y=A(m,"solidFill"),b=y?this.colourIn(y):(!m||!A(m,"noFill"))&&(Y(S(A(l,"lnRef"),"idx"))??0)>0&&!A(m,"noFill")?this.colourIn(A(l,"lnRef")):void 0;if(b){let B=Y(S(m,"w")),x=S(A(m,"prstDash"),"val")??"solid",$=S(m,"cmpd")??"sng";g={color:b.color,width:Math.max(0,Math.round((B??12700)/xr*10)/10),...$!=="sng"?{style:"double"}:/dot/i.test(x)&&!/dash/i.test(x)?{style:"dotted"}:/dash/i.test(x)?{style:"dashed"}:{}}}let k=A(r,"bodyPr"),T=(B,x)=>Math.round((Y(S(k,B))??x)/xr),I={x:T("lIns",91440),y:T("tIns",45720)},O=S(k,"anchor"),F=A(A(r,"txbx"),"txbxContent"),R=F?this.cellBlocks(F):[{id:D("b_"),type:"paragraph",runs:[]}],N={...this.placement(n),width:s,height:i,...d!=="rect"&&{shape:d},...u&&{fill:u.color,...u.alpha!==void 0&&{fillOpacity:u.alpha}},...g&&{line:g},...(I.x!==10||I.y!==5)&&{padding:I}},P=O==="ctr"?"middle":O==="b"?"bottom":void 0;return{id:D("b_"),type:"table",rows:[{id:D("r_"),cells:[{id:D("c_"),blocks:R,...P&&{vAlign:P}}]}],columns:[1],borders:"none",float:N}}table(e){let n=Ee(A(e,"tblGrid"),"gridCol").map(f=>Y(S(f,"w"))??0),r=Ee(e,"tr"),o=r.map(f=>Ee(f,"tc").reduce((p,m)=>p+be(Math.round(Y(S(A(A(m,"tcPr"),"gridSpan"),"val"))??1),1,63),0)+(Y(S(A(A(f,"trPr"),"gridBefore"),"val"))??0)),s=be(Math.max(n.length,...o,1),1,63),i=Array.from({length:s},(f,p)=>n[p]&&n[p]>0?n[p]:1),a=[],l=Array.from({length:s},()=>null);r.forEach((f,p)=>{let m=A(f,"trPr"),g=[],y=be(Math.round(Y(S(A(m,"gridBefore"),"val"))??0),0,s),b=0,k=()=>({id:D("c_"),blocks:[{id:D("b_"),type:"paragraph",runs:[]}]});for(;b<y;b++)g.push(k());for(let I of Ee(f,"tc")){if(b>=s)break;let O=A(I,"tcPr"),F=be(Math.round(Y(S(A(O,"gridSpan"),"val"))??1),1,s-b),R=A(O,"vMerge"),N=R?S(R,"val")==="restart"?"restart":"continue":null;if(N==="continue"&&l[b]){let P=l[b];P.cell.rowSpan=(P.cell.rowSpan??1)+1,g.push({id:D("c_"),blocks:[],covered:!0})}else{let P=this.cellBlocks(I),B={id:D("c_"),blocks:P},x=Po(S(A(O,"shd"),"fill"));x&&(B.shade=x),F>1&&(B.colSpan=F);let $=S(A(O,"vAlign"),"val");$==="center"?B.vAlign="middle":$==="bottom"&&(B.vAlign="bottom"),g.push(B);for(let L=0;L<F;L++)l[b+L]=N==="restart"?{cell:B,row:p}:null}for(let P=1;P<F;P++)g.push({id:D("c_"),blocks:[],covered:!0});b+=F}for(;g.length<s;)g.push(k());let T=Y(S(A(m,"trHeight"),"val"));a.push({id:D("r_"),cells:g.slice(0,s),...T?{height:be(T/Gn,1,5e3)}:{}});for(let I=0;I<s;I++){let O=a[p].cells[I];l[I]&&O.covered===void 0&&l[I].cell!==O&&(l[I]=null)}});let c=ig(A(A(e,"tblPr"),"tblBorders")),d=!!r[0]&&!!A(A(r[0],"trPr"),"tblHeader")&&Hn(A(A(r[0],"trPr"),"tblHeader"));if(a.length===0)return{id:D("b_"),type:"paragraph",runs:[]};if(d)for(let f of a[0].cells)f.shade==="#f3f4f6"&&delete f.shade;let u={id:D("b_"),type:"table",rows:a,columns:lt(i),...d&&{headerRow:!0},...c!=="all"&&{borders:c}};return Mn(u)&&(this.warn("A table whose merged cells couldn't be read was imported without merging"),u={...u,rows:u.rows.map(f=>({...f,cells:f.cells.map(p=>p.covered?{id:p.id,blocks:[{id:D("b_"),type:"paragraph",runs:[]}]}:(({colSpan:m,rowSpan:g,...y})=>y)(p))}))}),u}cellBlocks(e){let n=new t(this.shared,this.part,this.rels,"cell");n.open=this.open;let o=n.blocks(Fe(e)).filter(s=>!At(s)).filter(s=>["paragraph","title","subtitle","quote","heading","list_item","code_block","image","divider"].includes(s.type));return o.length>0?o:[{id:D("b_"),type:"paragraph",runs:[]}]}};function ig(t){if(!t)return"all";let e=o=>{let s=A(t,o);return!!s&&!["nil","none"].includes(S(s,"val")??"single")},n=e("top")||e("bottom")||e("insideH"),r=e("left")||e("right")||e("insideV");return!n&&!r?"none":n&&!r?"horizontal":"all"}var ag=t=>new RegExp(`/${t}$`);function vr(t,e){for(let[n,r]of t)if(ag(e).test(r.type))return{id:n,target:r.target}}function _i(t,e={}){let n=new _l(t,e.maxUnpackedBytes??262144e3),r=vr(n.relsFile("_rels/.rels"),"officeDocument")?.target??"word/document.xml",o=n.has(r)?r:"word/document.xml";if(!n.has(o))throw new C("invalid_document","Not a Word document: it has no word/document.xml");let s=n.xml(o),i=A(s,"body");if(!i)throw new C("invalid_document","Not a Word document: its document.xml has no body");let a=n.rels(o),l=U=>cf(o,U),c=new Set,d=new Map,u=vr(a,"styles"),f=n.xml(u?l(u.target):"word/styles.xml");for(let U of Ee(f,"style")){let Z=S(U,"styleId");Z&&d.set(Z,{id:Z,type:S(U,"type")??"paragraph",name:S(A(U,"name"),"val")??Z,basedOn:S(A(U,"basedOn"),"val"),linked:S(A(U,"link"),"val"),pPr:A(U,"pPr"),rPr:A(U,"rPr"),custom:S(U,"customStyle")==="1"||S(U,"customStyle")==="true",isDefault:S(U,"default")==="1"})}let p=vr(a,"numbering"),m=rg(n.xml(p?l(p.target):"word/numbering.xml")),g=vr(a,"settings"),y=n.xml(g?l(g.target):"word/settings.xml"),b=Hn(A(y,"evenAndOddHeaders")),k=new Map,T=e.userId??(U=>$i(U)||"unknown"),I=U=>{let Z=T(U);return k.has(Z)||k.set(Z,{id:Z,name:U||Z}),Z},O=new Map,F=[],R=vr(a,"comments"),N=n.xml(R?l(R.target):"word/comments.xml");if(N){let U=[...a.values()].find(re=>/commentsExtended$/.test(re.type)),Z=n.xml(U?l(U.target):"word/commentsExtended.xml"),Ce=new Map,De=new Map;for(let re of Ee(Z,"commentEx")){let we=S(re,"paraId");we&&(Ce.set(we,S(re,"paraIdParent")),De.set(we,S(re,"done")==="1"||S(re,"done")==="true"))}let Ie=[];for(let re of Ee(N,"comment")){let we=S(re,"id");if(we===void 0)continue;let xe=Ee(re,"p"),tt=xe.map(Us=>cg(Us));for(;tt.length>1&&tt[tt.length-1]==="";)tt.pop();let qn=Date.parse(S(re,"date")??"");Ie.push({id:we,author:S(re,"author")??"",date:Number.isFinite(qn)?qn:0,body:tt.join(`
`),para:S(xe[0],"paraId")})}let hn=new Map(Ie.filter(re=>re.para).map(re=>[re.para,re])),gn=re=>{let we=re;for(let xe=0;xe<100;xe++){let tt=we.para?Ce.get(we.para):void 0,qn=tt?hn.get(tt):void 0;if(!qn)break;we=qn}return we},Ft=new Map;for(let re of Ie){let we=gn(re);O.set(re.id,`th_${we.id}`),Ft.set(we.id,[...Ft.get(we.id)??[],re])}for(let[re,we]of Ft){let xe=Ie.find(Or=>Or.id===re),tt=we.map(Or=>({id:`cm_${Or.id}`,author:I(Or.author),body:Or.body,createdAt:Or.date})),qn=xe.para?De.get(xe.para):!1,Us=we[we.length-1];F.push({id:`th_${re}`,createdAt:xe.date,comments:tt,...qn&&{resolved:{by:I(Us.author),at:Us.date}}})}}let P=new Map,B=vr(a,"footnotes"),x=n.xml(B?l(B.target):"word/footnotes.xml"),$=Ee(x,"footnote").filter(U=>!S(U,"type")||S(U,"type")==="normal");for(let U of $){let Z=S(U,"id");Z!==void 0&&P.set(Z,`fn_${Z}`)}let L=vr(a,"theme"),W=n.xml(L?l(L.target):"word/theme/theme1.xml"),Q=A(A(W,"themeElements"),"fontScheme"),V=U=>S(A(A(Q,U),"latin"),"typeface")?.trim()||void 0,J={major:V("majorFont"),minor:V("minorFont")},se={...Vh},pe=A(A(W,"themeElements"),"clrScheme");for(let U of Fe(pe)){let Z=A(U,"srgbClr")??A(U,"sysClr"),Ce=Po(S(Z,"val")??S(Z,"lastClr"));Ce&&(se[U.name]=Ce)}let ge={pkg:n,warnings:c,styles:d,numbering:m,counters:new Map,usedLevels:new Set,wordNumbers:new Map,used:new Set,threadOf:O,footnotes:P,referencedNotes:new Set,themeFonts:J,themeColors:se,acceptChanges:e.trackedChanges==="accept",authorOf:I},ft=new Bo(ge,o,a,"body").blocks(Fe(i).filter(U=>U.name!=="sectPr")),_e=A(i,"sectPr");_e&&ft.push({section:uf(_e)});let ve=[],ce=[];for(let U of ft)At(U)?(ve.push({info:U.section,blocks:ce}),ce=[]):ce.push(U);(ce.length>0||ve.length===0)&&ve.push({info:ve[ve.length-1]?.info??{width:8.5,height:11,landscape:!1,margins:{top:1,right:1,bottom:1,left:1},continuous:!1,titlePg:!1,refs:[]},blocks:ce});let We=U=>c.add(U),Jt=(U,Z)=>{let Ce=Z.startsWith("header")?"header":"footer",De=Z.endsWith("First")?"first":Z.endsWith("Even")?"even":"default",Ie=U.refs.find(xe=>xe.kind===Ce&&xe.variant===De),hn=Ie?a.get(Ie.rid):void 0;if(!hn)return;let gn=l(hn.target),Ft=n.xml(gn);if(!Ft)return;let we=new Bo(ge,gn,n.rels(gn),"region").blocks(Fe(Ft)).filter(xe=>!At(xe)&&xe.type!=="page_break"&&xe.type!=="toc"&&xe.type!=="section_break");return we.every(xe=>xe.type==="paragraph"&&xe.runs.length===0)?[]:we},qe=ve[0].info,Mr={size:Nl(qe,We),orientation:qe.landscape?"landscape":"portrait",margins:qe.margins,...qe.columns&&{columns:qe.columns},...qe.titlePg&&{differentFirstPage:!0},...b&&{differentOddEven:!0}},Rt=[];ve.forEach((U,Z)=>{if(Z>0){let Ce=ve[Z-1].info,De=U.info,Ie={size:Nl(De,We),orientation:De.landscape?"landscape":"portrait",margins:De.margins},hn={size:Nl(Ce,We),orientation:Ce.landscape?"landscape":"portrait",margins:Ce.margins},gn=Ie.size!==hn.size||Ie.orientation!==hn.orientation||["top","right","bottom","left"].some(re=>Ie.margins[re]!==hn.margins[re]),Ft={};for(let re of["header","footer"])for(let we of["default","first","even"]){let xe=ps(re,we),tt=Jt(De,xe);tt!==void 0&&(Ft[xe]=tt)}Rt.push({id:D("b_"),type:"section_break",kind:De.continuous&&!gn?"continuous":"next_page",...De.columns&&{columns:De.columns},...gn&&{page:Ie},...De.titlePg&&{differentFirstPage:!0},...Object.keys(Ft).length>0&&{regions:Ft}})}Rt.push(...U.blocks)}),Rt.length===0&&Rt.push({id:D("b_"),type:"paragraph",runs:[]});let Kn=Ct(A(n.xml("docProps/core.xml"),"title")).trim()||e.title||"Untitled",ke={id:D("doc_"),type:"document",title:Kn,blocks:Rt,page:Mr};for(let U of["header","footer","headerFirst","footerFirst","headerEven","footerEven"]){let Z=Jt(qe,U);Z&&Z.length>0&&(ke={...ke,[U]:Z})}let Dt={};for(let U of $){let Z=S(U,"id");if(Z===void 0||!ge.referencedNotes.has(Z))continue;let De=new Bo(ge,B?l(B.target):"word/footnotes.xml",n.rels(B?l(B.target):"word/footnotes.xml"),"note").blocks(Fe(U)).filter(Ie=>!At(Ie));Dt[P.get(Z)]=Wc(De)}Object.keys(Dt).length>0&&(ke={...ke,footnotes:Dt});let Wn=dg(ge);ke=fg(ke,Wn.ids),Object.keys(Wn.styles).length>0&&(ke={...ke,styles:Wn.styles});let To={};for(let U of F){let Ce=Tn(ke,U.id)[0];if(!Ce)continue;let De=df(ke.blocks,Ce.block),Ie=De?H(De.runs).slice(Ce.from,Ce.to).slice(0,200):"";To[U.id]={...U,anchor:{block:Ce.block,from:Ce.from,to:Ce.to,quote:Ie}}}let Mf=new Set(Object.keys(To));ke={...ke,blocks:ug(ke.blocks,Mf)},Object.keys(To).length>0&&(ke={...ke,comments:To}),ke=lg(ke,ge.wordNumbers);let qi;try{qi=mi(ke)}catch(U){throw new C("invalid_document",`The file was read, but the result isn't a valid document: ${U.message}`,{cause:U})}let Of=new Set(wi(qi).map(U=>U.by)),Af=[...k.values()].filter(U=>Of.has(U.id)||Object.values(To).some(Z=>Z.comments.some(Ce=>Ce.author===U.id)));return{doc:qi,authors:Af,warnings:[...c]}}function $s(t,e){let n=[];return t.map(r=>{if(r.type==="table"){n.length=0;let i=r.rows.map(a=>({...a,cells:a.cells.map(l=>({...l,blocks:$s(l.blocks,e)}))}));return{...r,rows:i}}if(r.type!=="list_item")return n.length=0,r;if(n.length=r.depth+1,r.list==="bullet")return n[r.depth]=0,r;let o=(n[r.depth]??0)+1,s=e.get(r.id);return s===void 0||s===o?(n[r.depth]=o,r):(n[r.depth]=s,{...r,start:s})})}function lg(t,e){if(e.size===0)return t;let n={...t,blocks:$s(t.blocks,e)};for(let r of["header","footer","headerFirst","footerFirst","headerEven","footerEven"])n[r]&&(n[r]=$s(n[r],e));return n.footnotes&&(n.footnotes=Object.fromEntries(Object.entries(n.footnotes).map(([r,o])=>[r,$s(o,e)]))),n.blocks=n.blocks.map(r=>r.type==="section_break"&&r.regions?{...r,regions:Object.fromEntries(Object.entries(r.regions).map(([o,s])=>[o,$s(s,e)]))}:r),n}function cg(t){let e="",n=r=>{for(let o of Fe(r))o.name==="t"?e+=Ct(o):o.name==="tab"?e+="	":o.name==="br"||o.name==="cr"?e+=`
`:(o.name==="r"||o.name==="ins"||o.name==="hyperlink"||o.name==="smartTag")&&n(o)};return n(t),e}function df(t,e){for(let n of t){if(n.id===e&&"runs"in n)return n;if(n.type==="table")for(let r of n.rows)for(let o of r.cells){let s=df(o.blocks,e);if(s)return s}}}function ug(t,e){let n=o=>he(o.map(s=>{let i=s.marks?.comment?.filter(c=>e.has(c));if(!s.marks?.comment||i?.length===s.marks.comment.length)return s;let{comment:a,...l}=s.marks;return{...s,marks:i&&i.length>0?{...l,comment:i}:Object.keys(l).length>0?l:void 0}})),r=o=>o.type==="table"?{...o,rows:o.rows.map(s=>({...s,cells:s.cells.map(i=>({...i,blocks:i.blocks.map(r)}))}))}:"runs"in o?{...o,runs:n(o.runs)}:o;return t.map(r)}function dg(t){let{styles:e,used:n}=t,r=new Set(n);for(let[c,d]of e)(d.type==="paragraph"||d.type==="character")&&d.custom&&!Ni(d.name)&&!(d.type==="character"&&d.linked)&&r.add(c);let o=c=>{let d=e.get(c);return!!d&&(d.type==="paragraph"||d.type==="character")&&!Ni(d.name)&&!d.isDefault&&!(d.type==="character"&&d.linked)};for(let c of[...r]){let d=new Set([c]);for(let u=e.get(c)?.basedOn;u!==void 0&&!d.has(u);u=e.get(u)?.basedOn)d.add(u),o(u)&&e.get(u).type===e.get(c).type&&r.add(u)}let s=new Map,i=new Set;for(let c of r){if(!o(c))continue;let d=e.get(c),u=c.startsWith("Pli_")?c.slice(4):void 0,f=u&&u.length>0?u:$i(d.name)||$i(c)||"style";for(let p=2;i.has(f);p++)f=`${$i(d.name)||"style"}-${p}`;i.add(f),s.set(c,f)}let a=new Bo(t,"",new Map,"body"),l={};for(let[c,d]of s){let u=e.get(c),f=u.type==="character"?"character":"paragraph",p,m=new Set([c]);for(let k=u.basedOn;k!==void 0&&!m.has(k);k=e.get(k)?.basedOn){m.add(k);let T=s.get(k);if(T&&e.get(k).type===u.type){p=T;break}}let g=a.marksOf(u.rPr),y={};for(let k of ri)g[k]!==void 0&&(y[k]=g[k]);let b={name:u.name||d,kind:f,...p&&{basedOn:p},...Object.keys(y).length>0&&{marks:y}};if(f==="paragraph"){let k=pg(a,u.pPr);k.align&&(b.align=k.align),k.format&&(b.format=k.format)}l[d]=b}return{styles:l,ids:s}}function fg(t,e){let n=s=>s.map(i=>{let a=i.marks?.style;if(a===void 0)return i;let{style:l,...c}=i.marks,d=e.get(a),u=d?{...c,style:d}:c;return Object.keys(u).length>0?{...i,marks:u}:{text:i.text}}),r=s=>{if(s.type==="table")return{...s,rows:s.rows.map(a=>({...a,cells:a.cells.map(l=>({...l,blocks:l.blocks.map(r)}))}))};if(s.type==="section_break"&&s.regions)return{...s,regions:Object.fromEntries(Object.entries(s.regions).map(([a,l])=>[a,l.map(r)]))};if(!("runs"in s))return s;let i={...s,runs:n(s.runs)};if("style"in s&&s.style!==void 0){let a=e.get(s.style);a?i.style=a:delete i.style}return i},o={...t,blocks:t.blocks.map(r)};for(let s of["header","footer","headerFirst","footerFirst","headerEven","footerEven"])t[s]&&(o[s]=t[s].map(r));return t.footnotes&&(o.footnotes=Object.fromEntries(Object.entries(t.footnotes).map(([s,i])=>[s,i.map(r)]))),o}function pg(t,e){let n=S(A(e,"jc"),"val"),r=n==="center"?"center":n==="right"||n==="end"?"right":n==="both"||n==="distribute"||n==="justify"?"justify":void 0,o=t.formatOf(e);return{...r&&{align:r},...o&&{format:o}}}function je(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function mg(t){return/^\s*(https?:|mailto:|tel:|#|\/)/i.test(t)?t:"#"}function pf(t){return/^\s*(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);|\/|\.)/i.test(t)?t:""}function Oo(t){return t.replace(/[^\w\s#%.,()'"-]/g,"")}function hg(t,e){let n=je(t.text).replace(/\n/g,"<br>"),r=e?oi(e.doc,t.marks,e.paragraph):t.marks;if(!r)return n;if(r.footnote)return`<sup class="footnote-ref"><a href="#fn-${je(t.text)}" id="fnref-${je(t.text)}">${n}</a></sup>`;r.code&&(n=`<code>${n}</code>`),r.bold&&(n=`<strong>${n}</strong>`),r.italic&&(n=`<em>${n}</em>`),r.underline&&(n=`<u>${n}</u>`),r.strike&&(n=`<s>${n}</s>`),r.superscript&&(n=`<sup>${n}</sup>`),r.subscript&&(n=`<sub>${n}</sub>`);let o=[];if(r.color&&o.push(`color:${Oo(r.color)}`),r.highlight&&o.push(`background-color:${Oo(r.highlight)}`),r.fontFamily){let s=Oo(r.fontFamily).replace(/['"]/g,"").trim();s&&o.push(`font-family:${ba(s).replace(/"/g,"'")}`)}if(r.fontSize&&o.push(`font-size:${Number(r.fontSize)}pt`),o.length>0&&(n=`<span style="${je(o.join(";"))}">${n}</span>`),r.link&&(n=`<a href="${je(mg(r.link))}">${n}</a>`),r.suggest){let s=r.suggest.kind==="insert"?"ins":"del";n=`<${s} data-suggestion="${je(r.suggest.id)}" data-by="${je(r.suggest.by)}" datetime="${new Date(r.suggest.at).toISOString()}">${n}</${s}>`}return n}var Mo=(t,e,n)=>{let r=e?.styles?{doc:e,paragraph:n?Aa(n):void 0}:void 0;return t.map(o=>hg(o,r)).join("")},mf=(t,e)=>{let n=Aa(e);return n&&t.styles?.[n]?` data-style="${je(n)}"`:""};function Cr(t,e,n=[]){let r=[...n];return t&&t!=="left"&&r.push(`text-align:${t}`),e&&(e.lineHeight&&r.push(`line-height:${e.lineHeight}`),e.spaceBefore!==void 0&&r.push(`margin-top:${e.spaceBefore}pt`),e.spaceAfter!==void 0&&r.push(`margin-bottom:${e.spaceAfter}pt`),e.indentLeft&&r.push(`margin-left:${e.indentLeft}pt`),e.indentRight&&r.push(`margin-right:${e.indentRight}pt`),e.indentFirst&&r.push(`text-indent:${e.indentFirst}pt`)),r.length>0?` style="${r.join(";")}"`:""}function Ll(t){return`h-${t.id}`}function gg(t,e){let r=t.blocks.filter(s=>s.type==="heading"&&s.level<=e.levels).map(s=>`<li style="margin-left:${(s.level-1)*1.5}em"><a href="#${Ll(s)}">${je(H(s.runs))}</a></li>`).join(`
`),o=e.title??"Table of contents";return`<nav class="toc">${o?`<p class="toc-title"><strong>${je(o)}</strong></p>`:""}<ul style="list-style:none;padding:0">
${r}
</ul></nav>`}function yg(t,e){let n=Gt(t,e),r=mf(t,e);switch(e.type){case"paragraph":return`<p${r}${Cr(n.align,n.format)}>${Mo(e.runs,t,e)}</p>`;case"title":return`<p class="title"${r}${Cr(n.align,n.format,["font-size:26pt","font-weight:bold"])}>${Mo(e.runs,t,e)}</p>`;case"subtitle":return`<p class="subtitle"${r}${Cr(n.align,n.format,["font-size:15pt","color:#666"])}>${Mo(e.runs,t,e)}</p>`;case"heading":return`<h${e.level} id="${Ll(e)}"${r}${Cr(n.align,n.format)}>${Mo(e.runs,t,e)}</h${e.level}>`;case"quote":return`<blockquote${r}${Cr(n.align,n.format)}><p>${Mo(e.runs,t,e)}</p></blockquote>`;case"code_block":return`<pre><code${e.language?` class="language-${je(e.language)}"`:""}>${je(H(e.runs))}</code></pre>`;case"divider":return"<hr>";case"page_break":return'<div class="page-break" style="break-after:page"></div>';case"section_break":return"";case"image":{let o=pf(e.src);if(!o)return"";if(e.float)return ff(t,e);let s=e.wrap?`float:${e.wrap};margin:${e.wrap==="left"?"0 14px 8px 0":"0 0 8px 14px"}`:"",i=hf(e,je(o),s);return e.wrap?i:`<p${Cr(e.align,void 0)}>${i}</p>`}case"toc":return gg(t,e);case"table":return Xe(e)?ff(t,e):kg(t,e)}}function ff(t,e){let{x:n,y:r,behind:o,z:s}=e.float,i=e.type==="image"?{width:e.width,height:e.height}:{width:e.float.width,height:e.float.height},l=`position:absolute;${n.align==="right"?`right:${n.offset??0}px`:n.align==="center"?"left:50%;transform:translateX(-50%)":`left:${n.offset??0}px`};top:${r.offset??0}px;width:${Math.round(i.width)}px;height:${Math.round(i.height)}px;z-index:${o?-1:1+Math.round(s??0)}`,c;if(e.type==="image"){let d=pf(e.src);if(!d)return"";c=`<span style="${l}">${hf(e,je(d),"")}</span>`}else{let d=e.float,u=e.rows[0].cells[0],f=d.padding??{x:10,y:5},p=d.shape==="ellipse"?"border-radius:50%":d.shape==="round_rect"?`border-radius:${Math.round(Math.min(d.width,d.height)/6)}px`:"",m=d.fill?`background-color:${Oo(d.fill)}${d.fillOpacity!==void 0&&d.fillOpacity<1?";background-color:"+bg(d.fill,d.fillOpacity):""}`:"",g=d.line&&d.line.width>0?`border:${d.line.width}px ${d.line.style??"solid"} ${Oo(d.line.color)}`:"",y=u.vAlign==="middle"?"center":u.vAlign==="bottom"?"flex-end":"flex-start";c=`<div style="${[l,"box-sizing:border-box","overflow:hidden",`padding:${f.y}px ${f.x}px`,"display:flex","flex-direction:column",`justify-content:${y}`,m,g,p].filter(Boolean).join(";")}">${Li(t,u.blocks)}</div>`}return`<div class="float" style="position:relative;height:0">${c}</div>`}function bg(t,e){let n=parseInt(t.slice(1),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${Math.max(0,e)})`}function hf(t,e,n){let r=Math.round(t.width),o=Math.round(t.height),s=je(t.alt??""),i=t.crop;if(!i)return`<img src="${e}" alt="${s}" width="${r}" height="${o}"${n?` style="${n}"`:""}>`;let a=t.width/(1-i.left-i.right),l=t.height/(1-i.top-i.bottom),c=d=>`${Math.round(d*100)/100}px`;return`<span style="display:inline-block;overflow:hidden;position:relative;width:${c(t.width)};height:${c(t.height)}${n?`;${n}`:""}"><img src="${e}" alt="${s}" style="position:absolute;max-width:none;width:${c(a)};height:${c(l)};left:${c(-i.left*a)};top:${c(-i.top*l)}"></span>`}var Il="1px solid #bfbfbf";function kg(t,e){let n=e.borders??"all",r=n==="all"?`border:${Il}`:n==="horizontal"?`border-top:${Il};border-bottom:${Il}`:"border:none",o=e.columns.map(i=>`<col style="width:${(i*100).toFixed(4).replace(/\.?0+$/,"")}%">`).join(""),s=e.rows.map((i,a)=>{let l=a===0&&e.headerRow,c=l?"th":"td",d=i.cells.filter(u=>!u.covered).map(u=>{let f=u.shade??(l?"#f3f4f6":void 0),p=[r,"padding:4pt 6pt",`vertical-align:${u.vAlign??"top"}`,l?"text-align:left":"",f?`background-color:${Oo(f)}`:""].filter(Boolean).join(";"),m=(u.colSpan?` colspan="${u.colSpan}"`:"")+(u.rowSpan?` rowspan="${u.rowSpan}"`:"");return`<${c}${m} style="${p}">${Li(t,u.blocks)}</${c}>`}).join("");return`<tr${i.height?` style="height:${i.height}pt"`:""}>${d}</tr>`}).join(`
`);return`<table style="border-collapse:collapse;width:100%;table-layout:fixed"><colgroup>${o}</colgroup>
${s}
</table>`}function wg(t){let e=t?.find(o=>o.type==="paragraph"||o.type==="heading"||o.type==="title"||o.type==="subtitle");if(!e||!("runs"in e)||e.runs.length===0)return null;let n=e.runs.map(o=>o.marks?.field?o.marks.field==="page"?"counter(page)":"counter(pages)":`"${o.text.replace(/["\\]/g,"\\$&").replace(/\n/g," ")}"`),r="align"in e&&e.align?e.align:"left";return{align:r==="justify"?"left":r,content:n.join(" ")}}var Sg="font: 9pt Arial, sans-serif; color: #595959;";function Ii(t,e,n){let r=[];for(let[o,s]of[[t,"top"],[e,"bottom"]]){let i=wg(o);for(let a of["left","center","right"])i&&i.align===a?r.push(`@${s}-${a} { content: ${i.content}; ${Sg} }`):n&&r.push(`@${s}-${a} { content: none; }`)}return r.join(" ")}function xg(t){let e=t.page,n=[],r=(o,s)=>s&&n.push(`@page${o} { ${s} }`);return e?.differentOddEven?(r(" :right",Ii(t.header,t.footer,!1)),r(" :left",Ii(t.headerEven,t.footerEven,!1))):r("",Ii(t.header,t.footer,!1)),e?.differentFirstPage&&r(" :first",Ii(t.headerFirst,t.footerFirst,!0)),n.length>0?`${n.join(`
`)}
`:""}function Li(t,e){let n=[],r=[],o=[],s=u=>u==="bullet"?"ul":"ol",i=u=>{n[n.length-1]+=u},a=u=>{for(;r.length>u;)i(`</li></${s(r.pop())}>`),o.pop()},l=(u,f)=>u.list==="ordered"?"decimal":He("bullet",f),c=(u,f)=>{let p=Nn(u),m=p!==l(u,u.depth)||He(u.list,u.depth)!==l(u,u.depth)?` style="list-style-type:${p}"`:"",g=f&&u.start!==void 0?` start="${u.start}"`:"";return o.push(p),`<${s(u.list)}${g}${m}>`},d=as(e);return e.forEach((u,f)=>{if(u.type!=="list_item"){a(0),n.push(yg(t,u));return}let p=u.depth+1;a(p);let m=!1;for(r.length===p&&(r[p-1]===u.list?i("</li>"):(i(`</li></${s(r.pop())}>`),o.pop(),n.push(c(u,!0)),r.push(u.list),m=!0));r.length<p;)n.push(c(u,r.length===p-1)),r.push(u.list),m=r.length===p,r.length<p&&n.push("<li>");let g=Gt(t,u),y=d[f].marker!==o[p-1],b=!m&&u.start!==void 0?` value="${u.start}"`:"";n.push(`<li${b}${mf(t,u)}${Cr(g.align,g.format,y?[`list-style-type:${d[f].marker}`]:[])}>${Mo(u.runs,t,u)}`)}),a(0),n.join(`
`)}function vg(t){let n=Qe(t.blocks).flatMap((r,o)=>{let s=t.footnotes?.[r];return s?[`<li id="fn-${o+1}">${Li(t,s)} <a class="footnote-back" href="#fnref-${o+1}">\u21A9</a></li>`]:[]});return n.length>0?`
<section class="footnotes">
<hr>
<ol>
${n.join(`
`)}
</ol>
</section>`:""}function gf(t,e){let n=new Map,r=Kt(t,e,0);return e.forEach((o,s)=>{s>0&&!ss(Kt(t,e,s),r)&&n.set(o,`section${s+1}`)}),n}function Cg(t){let e=Bt(t);return[...gf(t,e)].map(([n,r])=>{let o=Kt(t,e,e.indexOf(n)),{width:s,height:i}=hr(o),a=o.margins;return`@page ${r} { size: ${s}in ${i}in; margin: ${a.top}in ${a.right}in ${a.bottom}in ${a.left}in; }`}).join(`
`)}function Pg(t){let e=Bt(t),n=gf(t,e);return e.map(r=>{let o=Li(t,t.blocks.slice(r.from,r.to)),s=[];r.start?.kind==="next_page"&&s.push("break-before:page");let i=n.get(r);i&&s.push(`page:${i}`);let{count:a,gap:l,rule:c}=r.columns;return a>1&&(s.push(`column-count:${a}`,`column-gap:${l}pt`),c&&s.push("column-rule:1px solid #bbb")),s.length>0?`<div class="section" style="${s.join(";")}">
${o}
</div>`:o}).filter(r=>r!=="").join(`
`)}function Ns(t,e={}){let n=ai(t),r=Pg(n)+vg(n);if(!e.fullDocument)return r;let o=Ht(n),{width:s,height:i}=hr(o),a=o.margins;return`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${je(n.title)}</title>
<style>
@page { size: ${s}in ${i}in; margin: ${a.top}in ${a.right}in ${a.bottom}in ${a.left}in; }
${xg(n)}${Cg(n)}
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
`}var Bg=/([\\`*_[\]<>])/g;function Ao(t){return t.replace(Bg,"\\$1")}function Mg(t){return t.replace(/^(\s*)(#{1,6}|[-+])(?=\s)/,"$1\\$2").replace(/^(\s*\d+)\.(?=\s)/,"$1\\.")}function yf(t){return t.replace(/\n/g,`  
`)}function pn(t){let e=t.marks;if(!e)return Ao(t.text);if(e.footnote)return`[^${t.text}]`;let n=t.text.match(/^\s*/)[0],r=t.text.slice(n.length).match(/\s*$/)[0],o=t.text.slice(n.length,t.text.length-r.length);if(o==="")return t.text;let s=e.code?"`"+o.replace(/`/g,"\\`")+"`":Ao(o);return e.bold&&(s=`**${s}**`),e.italic&&(s=`*${s}*`),(e.strike||e.suggest?.kind==="delete")&&(s=`~~${s}~~`),e.underline&&(s=`<u>${s}</u>`),e.superscript&&(s=`<sup>${s}</sup>`),e.subscript&&(s=`<sub>${s}</sub>`),e.link&&(s=`[${s}](${e.link.replace(/\)/g,"%29")})`),n+s+r}function bf(t){switch(t.type){case"image":return`![${Ao(t.alt??"")}](${t.src.replace(/\)/g,"%29")})`;case"list_item":return"\u2022 "+t.runs.map(pn).join("");case"divider":return"";case"code_block":return"`"+H(t.runs).replace(/`/g,"\\`")+"`";default:return"runs"in t?t.runs.map(pn).join(""):""}}function Og(t){let e=s=>s.blocks.map(bf).filter(i=>i!=="").join("<br>").replace(/\|/g,"\\|").replace(/\n/g,"<br>")||" ",n=s=>`| ${s.join(" | ")} |`,[r,...o]=t.rows;return r?[n(r.cells.map(e)),n(r.cells.map(()=>"---")),...o.map(s=>n(s.cells.map(e)))]:[]}function Ag(t){let e=new Map,n=new Map;for(let r of t.blocks){if(r.type!=="heading")continue;let o=H(r.runs).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,"").trim().replace(/\s/g,"-")||"section",s=n.get(o)??0;n.set(o,s+1),e.set(r.id,s===0?o:`${o}-${s}`)}return e}function Ui(t){let e=ai(t),n=Ag(e),r=[],o=[],s=!1;for(let i of e.blocks)switch(i.type!=="list_item"&&(o.length=0,s&&r.push(""),s=!1),i.type){case"paragraph":r.push(Mg(yf(i.runs.map(pn).join(""))),"");break;case"heading":r.push("#".repeat(i.level)+" "+i.runs.map(pn).join("").replace(/\n/g," "),"");break;case"title":r.push("# "+i.runs.map(pn).join("").replace(/\n/g," "),"");break;case"subtitle":r.push("_"+i.runs.map(pn).join("").replace(/\n/g," ")+"_","");break;case"image":if(i.float)break;r.push(`![${Ao(i.alt??"")}](${i.src.replace(/\)/g,"%29")})`,"");break;case"table":if(i.float){for(let a of i.rows[0].cells[0].blocks){let l=bf(a);l.trim()!==""&&r.push(l,"")}break}r.push(...Og(i),"");break;case"section_break":break;case"page_break":r.push('<div style="page-break-after: always"></div>',"");break;case"toc":{let a=e.blocks.filter(c=>c.type==="heading"&&c.level<=i.levels),l=i.title??"Table of contents";l&&r.push(`**${Ao(l)}**`,"");for(let c of a){let d=Ao(H(c.runs));r.push(`${"  ".repeat(c.level-1)}- [${d}](#${n.get(c.id)})`)}r.push("");break}case"quote":r.push(...i.runs.map(pn).join("").replace(/\n/g,`  
`).split(`
`).map(a=>"> "+a),"");break;case"code_block":{let a=H(i.runs),l="`".repeat(Math.max(3,Tg(a)+1));r.push(l+(i.language??""),a,l,"");break}case"divider":r.push("---","");break;case"list_item":{o.length=i.depth+1;let a="-";i.list==="ordered"?(o[i.depth]=i.start??(o[i.depth]??0)+1,a=`${o[i.depth]}.`):o[i.depth]=0;let l="   ".repeat(i.depth),c=i.runs.map(pn).join("").replace(/\n/g,`  
`+l+"  ");r.push(l+a+" "+c),s=!0;break}}for(Qe(e.blocks).forEach((i,a)=>{let l=(e.footnotes?.[i]??[]).flatMap(c=>"runs"in c?[yf(c.runs.map(pn).join(""))]:[]);l.length!==0&&r.push(`[^${a+1}]: ${l[0]}`,...l.slice(1).flatMap(c=>["",`    ${c}`]),"")});r.length>0&&r[r.length-1]==="";)r.pop();return r.join(`
`)+`
`}function Tg(t){let e=0;for(let n of t.matchAll(/`+/g))e=Math.max(e,n[0].length);return e}var ji={_:"Everything the Swift and Kotlin packages can do to a document. The bridge runs these, and scripts/generate.mjs writes the typed Swift and Kotlin methods from them, so the three stay in step. Types: string, int, double, bool, with ? for optional.",commands:[{name:"typeText",params:[{name:"text",type:"string"}],returns:"bool",doc:"Types at the caret, replacing any selected text."},{name:"pasteText",params:[{name:"text",type:"string"}],returns:"bool",doc:"Pastes plain text; line breaks become new paragraphs."},{name:"paste",params:[{name:"html",type:"string?"},{name:"rtf",type:"string?"},{name:"text",type:"string?"}],returns:"bool",doc:"Pastes what a clipboard offered, keeping formatting: HTML (a web page, Word, Google Docs), else RTF (Pages, TextEdit), else tab-separated text as a table, else the text."},{name:"splitBlock",params:[],returns:"bool",doc:"Enter: splits the paragraph at the caret."},{name:"backspace",params:[],returns:"bool",doc:"Backspace."},{name:"deleteForward",params:[],returns:"bool",doc:"Delete."},{name:"deleteSelection",params:[],returns:"bool",doc:"Deletes the selected text."},{name:"undo",params:[],returns:"bool",doc:"Undoes the last change."},{name:"redo",params:[],returns:"bool",doc:"Redoes the last undone change."},{name:"toggleBold",params:[],returns:"bool",doc:"Turns bold on or off for the selection, or for the next typed text at a caret."},{name:"toggleItalic",params:[],returns:"bool",doc:"Turns italic on or off."},{name:"toggleUnderline",params:[],returns:"bool",doc:"Turns underline on or off."},{name:"toggleStrikethrough",params:[],returns:"bool",doc:"Turns strikethrough on or off."},{name:"toggleCode",params:[],returns:"bool",doc:"Turns the code style on or off."},{name:"toggleSuperscript",params:[],returns:"bool",doc:"Turns superscript on or off."},{name:"toggleSubscript",params:[],returns:"bool",doc:"Turns subscript on or off."},{name:"setTextColor",params:[{name:"color",type:"string?"}],returns:"bool",doc:'Sets the text color, such as "#b91c1c". Null removes it.'},{name:"setHighlight",params:[{name:"color",type:"string?"}],returns:"bool",doc:"Sets the highlight color. Null removes it."},{name:"setFontFamily",params:[{name:"family",type:"string?"}],returns:"bool",doc:`Sets the font, such as "Georgia". Null goes back to the document's.`},{name:"setFontSize",params:[{name:"points",type:"double?"}],returns:"bool",doc:"Sets the font size in points. Null goes back to the document's."},{name:"setLink",params:[{name:"url",type:"string?"}],returns:"bool",doc:"Links the selected text to an address. Null removes the link."},{name:"clearFormatting",params:[],returns:"bool",doc:"Removes formatting and styles from the selection."},{name:"setParagraph",params:[],returns:"bool",doc:"Makes the selected blocks ordinary paragraphs."},{name:"setTitle",params:[],returns:"bool",doc:"Makes the selected blocks the document title style."},{name:"setSubtitle",params:[],returns:"bool",doc:"Makes the selected blocks the subtitle style."},{name:"setHeading",params:[{name:"level",type:"int"}],returns:"bool",doc:"Makes the selected blocks headings of level 1 to 6."},{name:"setQuote",params:[],returns:"bool",doc:"Makes the selected blocks quotes."},{name:"setCodeBlock",params:[],returns:"bool",doc:"Makes the selected blocks code blocks."},{name:"toggleBulletedList",params:[],returns:"bool",doc:"Makes the selected blocks a bulleted list, or ordinary paragraphs if they already are."},{name:"toggleNumberedList",params:[],returns:"bool",doc:"Makes the selected blocks a numbered list, or ordinary paragraphs if they already are."},{name:"setAlignment",params:[{name:"alignment",type:"string",oneOf:["left","center","right","justify"],enum:"Alignment"}],returns:"bool",doc:"Aligns the selected blocks: left, center, right or justify."},{name:"indent",params:[],returns:"bool",doc:"Moves the selected blocks in."},{name:"outdent",params:[],returns:"bool",doc:"Moves the selected blocks out."},{name:"setListMarker",params:[{name:"marker",type:"string?",oneOf:["decimal","lower-alpha","upper-alpha","lower-roman","upper-roman","disc","circle","square"],enum:"ListMarker"}],returns:"bool",doc:"Sets how the selected lists are marked: numbers, letters or roman numerals for a numbered list, a symbol for a bulleted one. Null goes back to the default for the depth."},{name:"setListStart",params:[{name:"start",type:"int"}],returns:"bool",doc:"Numbers the first selected item of a numbered list with `start` and carries on from it: restarts a list at 1, or starts it at any number."},{name:"continueNumbering",params:[],returns:"bool",doc:"Takes the selected numbered items back into the numbering of the list above them, undoing a restart."},{name:"setLineSpacing",params:[{name:"multiple",type:"double?"}],returns:"bool",doc:"Sets line spacing as a multiple of the font size, such as 1.5. Null removes it."},{name:"setSpaceBefore",params:[{name:"points",type:"double?"}],returns:"bool",doc:"Sets the space above the selected paragraphs, in points."},{name:"setSpaceAfter",params:[{name:"points",type:"double?"}],returns:"bool",doc:"Sets the space below the selected paragraphs, in points."},{name:"insertTable",params:[{name:"rows",type:"int"},{name:"columns",type:"int"}],returns:"bool",doc:"Inserts a table at the caret."},{name:"addRowAbove",params:[],returns:"bool",doc:"Adds a table row above the one the caret is in."},{name:"addRowBelow",params:[],returns:"bool",doc:"Adds a table row below the one the caret is in."},{name:"addColumnLeft",params:[],returns:"bool",doc:"Adds a table column left of the one the caret is in."},{name:"addColumnRight",params:[],returns:"bool",doc:"Adds a table column right of the one the caret is in."},{name:"deleteRow",params:[],returns:"bool",doc:"Deletes the selected table rows (the table, if that is every row)."},{name:"deleteColumn",params:[],returns:"bool",doc:"Deletes the selected table columns (the table, if that is every column)."},{name:"deleteTable",params:[],returns:"bool",doc:"Deletes the table the caret is in."},{name:"mergeCells",params:[],returns:"bool",doc:"Merges the selected cells (a selection from one cell to another) into one."},{name:"splitCells",params:[],returns:"bool",doc:"Splits merged cells in the selection back into single cells."},{name:"setHeaderRow",params:[{name:"on",type:"bool"}],returns:"bool",doc:"Turns a table's first row into a header row, or back."},{name:"setCellShade",params:[{name:"color",type:"string?"}],returns:"bool",doc:'Shades the selected cells, such as "#fef08a". Null clears it.'},{name:"setColumnEdge",params:[{name:"table",type:"string"},{name:"column",type:"int"},{name:"position",type:"double"},{name:"merge",type:"bool"}],returns:"bool",doc:"Moves the edge between a table's column and the next one, to `position` (0 to 1, from the table's left edge). The neighbouring columns trade width; the others keep theirs. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"setRowHeight",params:[{name:"table",type:"string"},{name:"row",type:"int"},{name:"points",type:"double?"},{name:"merge",type:"bool"}],returns:"bool",doc:"Sets the least height of a table's row, in points. Null lets it fit its content. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"insertPageBreak",params:[],returns:"bool",doc:"Inserts a page break at the caret."},{name:"insertDivider",params:[],returns:"bool",doc:"Inserts a horizontal rule at the caret."},{name:"insertImage",params:[{name:"source",type:"string"},{name:"width",type:"int"},{name:"height",type:"int"},{name:"description",type:"string?"}],returns:"bool",doc:"Inserts a picture at the caret from a data: URI or an address, shown at width by height in points of 1/96 inch."},{name:"setImageSize",params:[{name:"image",type:"string"},{name:"width",type:"int"},{name:"height",type:"int"},{name:"merge",type:"bool"}],returns:"bool",doc:"Sets the size a picture is shown at, in pixels. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"setImageCrop",params:[{name:"image",type:"string"},{name:"top",type:"double"},{name:"right",type:"double"},{name:"bottom",type:"double"},{name:"left",type:"double"},{name:"merge",type:"bool"}],returns:"bool",doc:"Crops a picture: how much to cut away from each edge, as a share of the whole picture (0 to 0.9). All zeros shows all of it again. The picture's scale stays the same, so cutting an edge makes it smaller on the page, as it does in Word. With `merge` true the change joins the previous undo step, so a drag is one step to undo."},{name:"setImageWrap",params:[{name:"image",type:"string"},{name:"wrap",type:"string?",oneOf:["left","right"]}],returns:"bool",doc:"Makes text wrap around a picture, which sits at the left or right edge, or puts it back on a line of its own with null. A picture in a table cell stays on its own line."},{name:"deleteImage",params:[{name:"image",type:"string"}],returns:"bool",doc:"Deletes a picture."},{name:"setDocumentTitle",params:[{name:"title",type:"string"}],returns:"void",doc:"Renames the document."},{name:"applyParagraphStyle",params:[{name:"id",type:"string?"}],returns:"bool",doc:"Sets the named paragraph style of the selected paragraphs. Null takes it off."},{name:"applyCharacterStyle",params:[{name:"id",type:"string?"}],returns:"bool",doc:"Sets the named character style of the selected text. Null takes it off."},{name:"createStyle",params:[{name:"name",type:"string"},{name:"kind",type:"string",oneOf:["paragraph","character"],enum:"StyleKind"}],returns:"string?",doc:"Makes a named style from the selection and applies it. Returns its id."},{name:"deleteStyle",params:[{name:"id",type:"string"}],returns:"bool",doc:"Removes a style and takes it off the text that used it."},{name:"select",params:[{name:"anchorBlock",type:"string"},{name:"anchorOffset",type:"int"},{name:"focusBlock",type:"string"},{name:"focusOffset",type:"int"}],returns:"void",doc:"Selects text. Offsets are UTF-16 units into a block's text."},{name:"selectAll",params:[],returns:"void",doc:"Selects the whole document."},{name:"setSuggesting",params:[{name:"on",type:"bool"}],returns:"bool",doc:"Turns suggesting mode on or off. False when the current user may not suggest."},{name:"acceptSuggestion",params:[{name:"id",type:"string"}],returns:"bool",doc:"Accepts a suggestion."},{name:"rejectSuggestion",params:[{name:"id",type:"string"}],returns:"bool",doc:"Rejects a suggestion."},{name:"acceptAllSuggestions",params:[],returns:"bool",doc:"Accepts every suggestion the current user may accept."},{name:"rejectAllSuggestions",params:[],returns:"bool",doc:"Rejects every suggestion the current user may reject."}]};var kf={_:"What the Swift and Kotlin packages can do with a workbook, a deck and a PDF (documents are in catalog.json). Each method is written as a signature; types are string, int, double, bool, json, scalar (a string, number, boolean or null), T?, [T], map<T>, or the name of an enum or type of the editor. The engine (src/editors/*.ts) implements every method here and checks each call's arguments against it, and scripts/generate.mjs writes the typed Swift and Kotlin from it.",shared:["User","Thread","Comment","Peer"],editors:{docs:{class:"PliDocument",engine:"pli-engine.js",extends:!0,doc:"What a document has beyond the commands of catalog.json: comments anchored to text.",enums:{},types:{CommentRange:{doc:"Where a comment thread's text is now: a block, and a range of its text in UTF-16 units.",fields:{block:"string",from:"int",to:"int"}}},methods:[{sig:"commentOnSelection(body: string, mentions: [string]?): Thread?",doc:'Starts a comment thread on the selected text, with `body` as its first comment, as one undo step. Returns nil when no text is selected. The thread\'s anchor is `{"block": \u2026, "from": \u2026, "to": \u2026, "quote": \u2026}`.'},{sig:"commentRanges(thread: string): [CommentRange]",doc:"Where the thread's text is now, one range per block it covers; empty once the text is gone."},{sig:"threadsAtSelection(): [Thread]",doc:"The threads attached to the text at the caret, or anywhere in the selection, in the order they were started."}],files:[]},sheets:{class:"PliWorkbook",engine:"pli-sheets.js",doc:"A workbook: sheets of cells with formulas that recalculate, number formats, styles, tables and charts.",enums:{ClearWhat:["all","contents","formats"],FillDirection:["down","right"]},types:{SheetInfo:{doc:"A sheet of the workbook.",fields:{id:"string",name:"string",hidden:"bool",usedRange:"string?",tabColor:"string?"}},CellInfo:{doc:"A cell as it shows and as it was typed. `value` is what it is worth (null when empty or an error), `error` is the formula error such as `#DIV/0!`, `text` is the value with its number format, and `formula` is what was typed when it starts with `=`.",fields:{address:"string",value:"json",error:"string?",text:"string",formula:"string?",format:"string?"}},FoundCell:{doc:"A cell that has the text looked for.",fields:{sheet:"string",address:"string",text:"string"}},ReplaceResult:{doc:"What replacing text did.",fields:{cells:"int",occurrences:"int",skipped:"int"}}},methods:[{sig:"title(): string",doc:"The workbook's title."},{sig:"setTitle(title: string): void",doc:"Renames the workbook."},{sig:"sheets(): [SheetInfo]",doc:"The sheets, in tab order."},{sig:"usedRange(sheet: string): string?",doc:"Where the sheet has anything, as a range such as `A1:D20`, or nil when it is empty."},{sig:"cell(sheet: string, address: string): CellInfo",doc:"One cell: its value, how it shows and what was typed. `sheet` is a name (any case) or an id."},{sig:"value(sheet: string, address: string): json",doc:'What the cell is worth: a number, text, true or false, nil for an empty cell, or `{"error": "#DIV/0!"}`.'},{sig:"text(sheet: string, address: string): string",doc:"The cell as it shows, with its number format applied."},{sig:"values(sheet: string, range: string): json",doc:"The values of a range, row by row, as a list of lists."},{sig:"toText(sheet: string, range: string): string",doc:"A range as tab-separated text, as the clipboard has it."},{sig:"toHtml(sheet: string, range: string): string",doc:"A range as an HTML table, with its formatting."},{sig:"merges(sheet: string): [string]",doc:"The merged ranges of a sheet."},{sig:"find(text: string, matchCase: bool?, wholeCell: bool?, sheet: string?): [FoundCell]",doc:"Finds cells that show the text, in one sheet or in every visible sheet. `*` stands for any text and `?` for any one character."},{sig:"replace(text: string, replacement: string, matchCase: bool?, wholeCell: bool?, sheet: string?): ReplaceResult",doc:"Replaces text in what cells hold, as one undo step."},{sig:"setCell(sheet: string, address: string, value: scalar): void",doc:"Types into a cell as a person would: text that starts with `=` is a formula, and numbers, dates and percentages in text become what they look like."},{sig:"setCells(sheet: string, inputs: map<scalar>): void",doc:"Types into several cells at once, keyed by address, as one undo step."},{sig:"setValues(sheet: string, at: string, rows: json): void",doc:"Puts a block of values (a list of rows) with its top left at `at`."},{sig:"clear(sheet: string, range: string, what: ClearWhat): void",doc:"Clears the contents, the formats, or both."},{sig:"setFormat(sheet: string, range: string, format: string?): void",doc:"Sets the number format, such as `0.00`, `#,##0`, `0%` or `yyyy-mm-dd`; nil goes back to General."},{sig:"setStyle(sheet: string, range: string, style: json): void",doc:'Changes the look of a range: `{"bold": true, "fill": "#ffeeaa", "color": "#222222", "align": "center"}`. A property set to null is removed.'},{sig:"fill(sheet: string, range: string, direction: FillDirection): void",doc:"Copies the first row (or column) of the range over the rest, moving the formulas' references."},{sig:"autofill(sheet: string, source: string, target: string): void",doc:"Continues a series (1, 2, 3 or Monday, Tuesday) from the source range over the target."},{sig:"copy(sheet: string, range: string, toSheet: string, at: string, cut: bool): void",doc:"Copies a range to where `at` is on another (or the same) sheet; with `cut`, it moves and formulas that point at it follow."},{sig:"sort(sheet: string, range: string, by: int?, descending: bool?, header: bool?): void",doc:"Sorts the rows of a range by one column (1 is the range's first column, the default)."},{sig:"insertRows(sheet: string, at: int, count: int): void",doc:"Inserts rows before row `at` (1 is the first). Formulas that point at the rows after them follow."},{sig:"deleteRows(sheet: string, at: int, count: int): void",doc:"Deletes rows; references to deleted cells become `#REF!`."},{sig:"insertColumns(sheet: string, at: int, count: int): void",doc:"Inserts columns before column `at` (1 is A)."},{sig:"deleteColumns(sheet: string, at: int, count: int): void",doc:"Deletes columns."},{sig:"setColumnWidth(sheet: string, column: int, width: double?): void",doc:"Sets a column's width in pixels (nil for the default); `column` is 1 for A."},{sig:"setRowHeight(sheet: string, row: int, height: double?): void",doc:"Sets a row's height in pixels (nil for the default)."},{sig:"setFrozen(sheet: string, rows: int, cols: int): void",doc:"Freezes the top rows and left columns."},{sig:"mergeCells(sheet: string, range: string): void",doc:"Merges a range into one cell."},{sig:"unmergeCells(sheet: string, range: string): void",doc:"Takes a merge apart."},{sig:"setNote(sheet: string, address: string, text: string?): void",doc:"Puts a note on a cell, or takes it off with nil."},{sig:"setFilter(sheet: string, range: string?): void",doc:"Puts filter buttons on the first row of a range, or takes the filter off with nil."},{sig:"defineName(name: string, formula: string?): void",doc:"Defines a name that formulas can use (`=Tax*A1`), or removes it with nil."},{sig:"addSheet(name: string?, index: int?): SheetInfo",doc:"Adds an empty sheet."},{sig:"deleteSheet(sheet: string): void",doc:"Deletes a sheet. The last sheet stays."},{sig:"renameSheet(sheet: string, name: string): void",doc:"Renames a sheet; formulas that name it follow."},{sig:"moveSheet(sheet: string, index: int): void",doc:"Moves a sheet's tab."},{sig:"setTabColor(sheet: string, color: string?): void",doc:"Colours a sheet's tab (`#rrggbb`), or clears it with nil."},{sig:"insertChart(sheet: string, range: string, type: string?): json",doc:"Makes a chart from a range (the first row and column are labels) and returns it: type is `column`, `bar`, `line`, `area`, `pie`, `scatter` and the rest the chart types list."},{sig:"commentOnRange(sheet: string, range: string, body: string, mentions: [string]?): Thread",doc:'Starts a comment thread on a cell or a range (`B3`, `B3:C5`). The thread\'s anchor is `{"sheet": <the sheet\'s id>, "range": "B3"}`, so it stays with the sheet when it is renamed.'},{sig:"threadsAt(sheet: string, address: string): [Thread]",doc:"The comment threads whose cell or range holds this cell, oldest first."},{sig:"undo(): bool",doc:"Undoes the last step."},{sig:"redo(): bool",doc:"Does the undone step again."}],files:[{name:"exportXlsx",format:"xlsx",direction:"export",doc:"The workbook as an .xlsx file."},{name:"importXlsx",format:"xlsx",direction:"import",doc:"Replaces the workbook with an .xlsx file. History starts again."},{name:"exportCsv",format:"csv",direction:"export",params:"sheet: string?, delimiter: string?",doc:"One sheet as CSV text (UTF-8), formulas written as what they work out to. The first visible sheet by default.",text:!0},{name:"importCsv",format:"csv",direction:"import",params:"delimiter: string?",doc:"Replaces the workbook with a sheet holding the CSV.",text:!0},{name:"exportPdf",format:"pdf",direction:"export",async:!0,params:"sheet: string?",doc:"One sheet as a PDF, paged as it prints (page setup, print area and titles)."}]},decks:{class:"PliDeck",engine:"pli-decks.js",doc:"A deck of slides: masters and layouts, text, shapes, pictures, tables and charts, with notes and transitions.",enums:{ArrangeHow:["front","back","forward","backward"],AlignHow:["left","center","right","top","middle","bottom"]},types:{SlideInfo:{doc:"A slide of the deck.",fields:{id:"string",name:"string?",layout:"string",title:"string?",notes:"string",skipped:"bool",elements:"int"}},ElementInfo:{doc:"An element of a slide, layout or master. Position and size are in points; they are nil for a placeholder that takes them from its layout.",fields:{id:"string",type:"string",name:"string?",x:"double?",y:"double?",w:"double?",h:"double?",rotation:"double?",text:"string?",placeholder:"string?"}},LayoutInfo:{doc:"A layout a slide can use.",fields:{id:"string",name:"string",master:"string"}},DeckSize:{doc:"The size of the slides, in points.",fields:{width:"double",height:"double"}},DeckFindHit:{doc:"Where text was found.",fields:{slide:"string",element:"string?",paragraph:"int",offset:"int",length:"int"}}},methods:[{sig:"title(): string",doc:"The deck's title."},{sig:"setTitle(title: string): void",doc:"Renames the deck."},{sig:"size(): DeckSize",doc:"The size of the slides."},{sig:"setSize(width: double, height: double, scale: bool): void",doc:"Changes the slide size; with `scale` the elements are scaled to fit."},{sig:"slides(): [SlideInfo]",doc:"The slides, in order."},{sig:"layouts(): [LayoutInfo]",doc:"The layouts of every master."},{sig:"elements(slide: string): [ElementInfo]",doc:"The elements of a slide (or a layout or master, by its id), from the back to the front."},{sig:"notes(slide: string): string",doc:"A slide's speaker notes."},{sig:"find(query: string, matchCase: bool?, notes: bool?): [DeckFindHit]",doc:"Finds text in the slides (and in the notes with `notes`)."},{sig:"addSlide(layout: string?, after: string?): SlideInfo",doc:"Adds a slide from a layout (the first by default), after another slide (the end by default)."},{sig:"duplicateSlides(ids: [string]): [string]",doc:"Duplicates slides; returns the new ids."},{sig:"deleteSlides(ids: [string]): void",doc:"Deletes slides."},{sig:"moveSlides(ids: [string], to: int): void",doc:"Moves slides so that the first lands at position `to` (0 is first)."},{sig:"renameSlide(slide: string, name: string): void",doc:"Names a slide."},{sig:"setNotes(slide: string, notes: string): void",doc:"Sets the speaker notes."},{sig:"setSkipped(ids: [string], skipped: bool): void",doc:"Skips slides when presenting."},{sig:"setLayout(slide: string, layout: string): void",doc:"Gives a slide another layout; its placeholders follow."},{sig:"setBackground(ids: [string], fill: json): void",doc:'Sets the background of slides to a fill (a colour such as `"#102040"` or `{"theme": "dk2"}`), or back to the layout\'s with nil.'},{sig:"setTransition(ids: [string], transition: json): void",doc:"Sets how slides change when presenting, or none with nil."},{sig:"addTextBox(slide: string, x: double, y: double, w: double, h: double, text: string): string",doc:"Puts a text box on a slide. Returns its id."},{sig:"addShape(slide: string, geometry: string, x: double, y: double, w: double, h: double): string",doc:"Puts a shape (`rect`, `ellipse`, `rightArrow`, any preset name) on a slide. Returns its id."},{sig:"addImage(slide: string, src: string, width: double, height: double, x: double?, y: double?): string",doc:"Puts a picture on a slide: `src` is a `data:` address, or a reference your storage knows. Returns its id."},{sig:"addTable(slide: string, rows: int, columns: int): string",doc:"Puts an empty table on a slide. Returns its id."},{sig:"addChart(slide: string, chartType: string): string",doc:"Puts a sample chart on a slide (`column`, `bar`, `line`, `area`, `pie`, `doughnut`, `scatter`). Returns its id."},{sig:"setText(slide: string, element: string, text: string): void",doc:"Replaces the text of a shape; line breaks start new paragraphs."},{sig:"formatText(slide: string, ids: [string], patch: json): void",doc:'Formats the text of shapes: `{"bold": true, "fontSize": 24, "color": "#c00000"}`. A property set to null is removed.'},{sig:"setFrame(slide: string, element: string, x: double?, y: double?, w: double?, h: double?, rotation: double?): void",doc:"Moves, resizes and turns an element; a value left out stays."},{sig:"moveBy(slide: string, ids: [string], dx: double, dy: double): void",doc:"Moves elements by a distance in points."},{sig:"setFill(slide: string, ids: [string], fill: json): void",doc:'Fills shapes with a colour (`"#ffffff"` or `{"theme": "accent1"}`), or none with nil.'},{sig:"deleteElements(slide: string, ids: [string]): void",doc:"Deletes elements."},{sig:"duplicateElements(slide: string, ids: [string]): [string]",doc:"Duplicates elements, a little to the side. Returns the new ids."},{sig:"arrange(slide: string, ids: [string], how: ArrangeHow): void",doc:"Changes the drawing order."},{sig:"align(slide: string, ids: [string], how: AlignHow): void",doc:"Aligns elements to each other, or one element to the slide."},{sig:"group(slide: string, ids: [string]): string?",doc:"Groups elements. Returns the group's id."},{sig:"ungroup(slide: string, id: string): [string]",doc:"Takes a group apart. Returns the ids of what was in it."},{sig:"replaceAll(query: string, replacement: string, matchCase: bool?, notes: bool?): int",doc:"Replaces text in every slide; returns how many places changed."},{sig:"commentOnSlide(slide: string, body: string, mentions: [string]?): Thread",doc:"Starts a comment thread on a slide. The thread's anchor is `{\"slide\": <the slide's id>}`."},{sig:"commentOnElement(slide: string, element: string, body: string, mentions: [string]?): Thread",doc:'Starts a comment thread on an element of a slide. The anchor is `{"slide": \u2026, "element": \u2026}`.'},{sig:"threadsOn(slide: string, element: string?): [Thread]",doc:"The comment threads on a slide, or on one of its elements, oldest first."},{sig:"undo(): bool",doc:"Undoes the last step."},{sig:"redo(): bool",doc:"Does the undone step again."}],files:[{name:"exportPptx",format:"pptx",direction:"export",doc:"The deck as a .pptx file."},{name:"importPptx",format:"pptx",direction:"import",doc:"Replaces the deck with a .pptx file. History starts again."},{name:"exportPdf",format:"pdf",direction:"export",params:"slides: [string]?",doc:"The slides as a PDF, one page each; skipped slides are left out unless listed."}]},pdf:{class:"PliPdf",engine:"pli-pdf.js",doc:"A PDF: pages, annotations, form fields, text search and redaction, written back as the original file plus your changes.",enums:{MarkupKind:["highlight","underline","strikeout","squiggly"],ShapeKind:["square","circle"]},types:{PageInfo:{doc:"A page of the PDF. Sizes are in points.",fields:{id:"string",number:"int",width:"double",height:"double",rotate:"int",label:"string?",annotations:"int"}},AnnotationInfo:{doc:"An annotation on a page. `rect` is in page space.",fields:{id:"string",type:"string",page:"string",contents:"string?",author:"string?",thread:"string?"}},FieldInfo:{doc:"A form field.",fields:{id:"string",name:"string",type:"string",value:"json"}},SearchHit:{doc:"Where text was found. `rects` are one per line the match covers, in page space.",fields:{page:"string",text:"string",rects:"json"}},RedactionResult:{doc:"What applying redactions did.",fields:{pages:"[string]",rects:"int",removedAnnotations:"int"}},PdfMeta:{doc:"The file's own information.",fields:{title:"string?",author:"string?",subject:"string?",keywords:"string?",creator:"string?"}}},methods:[{sig:"pages(): [PageInfo]",doc:"The pages, in order."},{sig:"annotations(page: string): [AnnotationInfo]",doc:"The annotations of a page, bottom to top."},{sig:"fields(): [FieldInfo]",doc:"The form fields."},{sig:"formData(): json",doc:"The form's values by field name."},{sig:"metadata(): PdfMeta",doc:"The title, author and the rest the file says about itself."},{sig:"outline(): json",doc:"The bookmarks, as a tree."},{sig:"text(page: string): string",doc:"The text of a page, in reading order."},{sig:"search(query: string, caseSensitive: bool?, wholeWord: bool?): [SearchHit]",doc:"Finds text on every page."},{sig:"setMetadata(patch: json): void",doc:'Changes the file\'s information: `{"title": "Annual report"}`; null removes one.'},{sig:"rotatePages(ids: [string], degrees: int): void",doc:"Turns pages by 90, -90 or 180 degrees."},{sig:"deletePages(ids: [string]): void",doc:"Takes pages out, with what is on them. The last page stays."},{sig:"movePages(ids: [string], index: int): void",doc:"Moves pages so that the first lands at position `index`."},{sig:"duplicatePages(ids: [string]): [string]",doc:"Duplicates pages; returns the new ids."},{sig:"insertBlankPage(after: string?, width: double?, height: double?): string",doc:"Adds a blank page after another (the end by default), Letter size unless sized. Returns its id."},{sig:"addHighlight(page: string, rects: json, kind: MarkupKind?, color: string?, quote: string?): string",doc:'Marks text with a highlight, underline or strikeout over rectangles `[{"x": 72, "y": 700, "w": 100, "h": 12}]`. Returns its id.'},{sig:"addNote(page: string, x: double, y: double, text: string): string",doc:"Puts a sticky note on a page. Returns its id."},{sig:"addShape(page: string, kind: ShapeKind, x: double, y: double, w: double, h: double, color: string?): string",doc:"Draws a rectangle or an ellipse. Returns its id."},{sig:"addFreeText(page: string, x: double, y: double, w: double, h: double, text: string): string",doc:"Puts text on a page. Returns its id."},{sig:"addLink(page: string, x: double, y: double, w: double, h: double, uri: string): string",doc:"Makes a rectangle a link to a web address. Returns its id."},{sig:"setAnnotationText(id: string, text: string): void",doc:"Changes the text of a note or free text."},{sig:"moveAnnotations(ids: [string], dx: double, dy: double): void",doc:"Moves annotations by a distance in points."},{sig:"removeAnnotations(ids: [string]): void",doc:"Deletes annotations."},{sig:"setFieldValue(id: string, value: json): void",doc:"Fills a form field: text, true or false, or a list for a list box."},{sig:"fillForm(values: json): [string]",doc:"Fills fields by name; returns the ids of the fields that were filled."},{sig:"markRedaction(page: string, rects: json): string",doc:"Marks rectangles for redaction. Nothing is removed until `applyRedactions`. Returns the mark's id."},{sig:"markSearchRedactions(query: string): [string]",doc:"Marks every match of a search for redaction. Returns the marks' ids."},{sig:"applyRedactions(pages: [string]?): RedactionResult",doc:"Removes what is under the marks for good, from the pages given (all by default)."},{sig:"addComment(page: string, x: double, y: double, body: string, mentions: [string]?): Thread",doc:"Starts a comment thread with a sticky note at a point of a page; the note's text in the file is the first comment."},{sig:"commentOnAnnotation(annotation: string, body: string, mentions: [string]?): Thread",doc:"Starts a comment thread on a highlight or any other annotation."},{sig:"undo(): bool",doc:"Undoes the last step."},{sig:"redo(): bool",doc:"Does the undone step again."}],files:[{name:"exportPdf",format:"pdf",direction:"export",async:!0,doc:"The PDF written back: the original file with your changes added, so what you didn't touch stays byte for byte."},{name:"importPdf",format:"pdf",direction:"import",doc:"Replaces the document with another PDF file. History starts again."}]}}};function wf(t,e={}){let n=/^\s*(\w+)\s*\(([\s\S]*)\)\s*:\s*(\S[\s\S]*?)\s*$/.exec(t);if(!n)throw new Error(`Not a method signature: ${t}`);let[,r,o,s]=n,i=[],a=0,l="",c=[];for(let d of o)(d==="<"||d==="[")&&a++,(d===">"||d==="]")&&a--,d===","&&a===0?(c.push(l),l=""):l+=d;l.trim()&&c.push(l);for(let d of c){let u=/^\s*(\w+)\s*:\s*(\S[\s\S]*?)\s*$/.exec(d);if(!u)throw new Error(`Not a parameter in ${r}: ${d}`);let f=u[2],p=f.replace(/\?$/,"");i.push(e[p]?{name:u[1],type:f,enum:p,oneOf:e[p]}:{name:u[1],type:f})}return{name:r,params:i,returns:s}}function Sf(t){let e=kf.editors[t];return e.methods.map(n=>({...wf(n.sig,e.enums),doc:n.doc}))}var Hl=[],Tt=t=>void Hl.push(t),vf=()=>Hl.length?Hl.splice(0):void 0;function Hi(t){return JSON.stringify(t===void 0?null:t,(e,n)=>{if(n instanceof Map)return Object.fromEntries(n);if(n instanceof Set)return[...n];if(n instanceof Uint8Array)return Xn(n);if(!(typeof n=="function"||typeof n=="symbol"))return typeof n=="number"&&!Number.isFinite(n)?null:typeof n=="bigint"?Number(n):n})}var K=(t,e={})=>Hi({ok:!0,value:t===void 0?null:t,...e,events:vf()}),Ul=t=>{let e=t;return Hi({ok:!1,error:{code:e?.code??"error",message:e?.message??String(t)},events:vf()})};function Be(t){if(!(t==null||t===""))try{return JSON.parse(t)}catch(e){throw new C("invalid_operation","Not valid JSON",{cause:e})}}var Fg=1,Kl=new Map;function mn(t,e,n){let r=Fg++;return new Promise((o,s)=>{Kl.set(r,{resolve:o,reject:s}),Tt({type:"host",handle:t?.id??0,id:r,kind:e,payload:n})})}var Eg=1,Wl=new Map;function $g(t,e=n=>n){let n=Eg++,r={done:!1};return Wl.set(n,r),t.then(o=>{try{r.value=e(o)}catch(s){r.failed=!0,r.error=s}r.done=!0},o=>{r.failed=!0,r.error=o,r.done=!0}),K(null,{pending:n})}var Ng=t=>!!t&&typeof t.then=="function";function xt(t,e){return Ng(t)?$g(t,e):K(e?e(t):t)}var Pr=new Map,xf=1,_s=globalThis;typeof _s.setInterval!="function"&&(_s.setInterval=(t,e=0)=>{let n=xf++;return Pr.set(n,{at:Date.now()+Math.max(1,e),every:Math.max(1,e),fn:t}),n},_s.setTimeout=(t,e=0)=>{let n=xf++;return Pr.set(n,{at:Date.now()+Math.max(0,e),every:null,fn:t}),n},_s.clearInterval=_s.clearTimeout=t=>void Pr.delete(t));function _g(){let t=Date.now();for(let[e,n]of[...Pr])if(!(n.at>t||!Pr.has(e))){n.every===null?Pr.delete(e):n.at=t+n.every;try{n.fn()}catch{}}}var zi=new Map,jl=1,zl=new Map;function ee(t){let e=zi.get(t);if(!e)throw new C("not_found",`No open document ${t}`);return e}function Gl(t){let e=t;if(!e||typeof e.id!="string"||typeof e.name!="string")throw new C("invalid_operation","A user has an id and a name");return e}function Cf(t,e){return{size:t.length,type:e,arrayBuffer:()=>Promise.resolve(t.slice().buffer)}}function Ig(t){return{async upload(e,n){let r=new Uint8Array(await e.arrayBuffer());n.onProgress(.5);let o=await mn(t,"storage.upload",{name:n.name,type:n.type,data:Xn(r)});return n.onProgress(1),o},resolve:e=>mn(t,"storage.resolve",{ref:e}),async read(e){let n=await mn(t,"storage.read",{ref:e});return Cf(yn(n.data)??new Uint8Array,n.type)},delete:async e=>void await mn(t,"storage.delete",{ref:e})}}function Lg(t){return{load:e=>mn(t,"comments.load",{file:e}),save:async(e,n)=>void await mn(t,"comments.save",{file:e,change:n})}}function Ug(t){return{async connect(e,n){t.receive=n,await mn(t,"transport.connect",{room:e})},send:e=>void Tt({type:"transport.send",handle:t.id,json:Hi(e)}),disconnect(){t.receive=null,Tt({type:"transport.disconnect",handle:t.id})}}}function Gi(t,e,n,r){if(t.endsWith("?"))return e==null||Gi(t.slice(0,-1),e,n,r);if(t.startsWith("["))return Array.isArray(e)&&e.every(o=>Gi(t.slice(1,-1),o,n,r));if(t.startsWith("map<"))return!!e&&typeof e=="object"&&!Array.isArray(e)&&Object.values(e).every(o=>Gi(t.slice(4,-1),o,n,r));switch(t){case"string":return typeof e=="string";case"bool":return typeof e=="boolean";case"int":return Number.isInteger(e);case"double":return typeof e=="number"&&Number.isFinite(e);case"json":case"scalar":return e!==void 0;default:return r.oneOf?typeof e=="string"&&r.oneOf.includes(e):e!==void 0}}function jg(t,e){if(!Array.isArray(e)||e.length!==t.params.length)throw new C("invalid_operation",`${t.name} takes ${t.params.length} argument${t.params.length===1?"":"s"}`);t.params.forEach((n,r)=>{let o=e[r],s=n.type.endsWith("?");if(o==null){if(!s&&n.type!=="json"&&n.type!=="scalar")throw new C("invalid_operation",`${t.name}: ${n.name} is required`);return}if(n.oneOf&&!n.oneOf.includes(o))throw new C("invalid_operation",`${t.name}: ${n.name} should be one of ${n.oneOf.join(", ")}`);if(!Gi(n.type,o,null,n))throw new C("invalid_operation",`${t.name}: ${n.name} should be ${n.type}`)})}function zg(t,e){let n=e.split("."),r=t;for(let o=0;o<n.length;o++){let s=n[o];if(!/^[A-Za-z][A-Za-z0-9]*$/.test(s)||s==="constructor"||s==="prototype")throw new C("not_found",`Nothing called "${e}"`);let i=r?.[s];if(o===n.length-1){if(typeof i!="function")throw new C("not_found",`Nothing called "${e}" can be called`);return{owner:r,fn:i}}if(i===null||typeof i!="object")throw new C("not_found",`Nothing called "${e}"`);r=i}throw new C("not_found",`Nothing called "${e}"`)}function Gg(t,e,n){if(n!==t.watching.has(e)){if(!n){t.watching.delete(e);return}t.watching.add(e),e==="change"&&!t.extra._changeHooked&&(t.extra._changeHooked=!0,t.cleanups.push(t.core.subscribe(r=>{t.watching.has("change")&&Tt({type:"change",handle:t.id,origin:r.origin,reset:r.reset===!0,ops:r.ops,canUndo:t.core.canUndo,canRedo:t.core.canRedo})}))),e==="comments"&&t.comments&&!t.extra._commentsHooked&&(t.extra._commentsHooked=!0,t.cleanups.push(t.comments.onChange((r,o)=>{t.watching.has("comments")&&Tt({type:"comments",handle:t.id,origin:o,change:r})})))}}function Pf(t,e){let n=new Map(t.map(d=>[d.kind,d])),r=new Map(t.map(d=>[d.kind,new Map(d.methods.map(u=>[u.name,u]))])),o=(d,u)=>{if(d==null)throw new C("unsupported",u);return d},s=d=>{try{return d()}catch(u){return Ul(u)}};function i(d,u,f){d.directory.current=u,f&&(d.directory.role=f),u&&d.users.add([u]),d.def.userChanged?.(d)}function a(d){return o(d.comments,"Comments aren't turned on for this document")}function l(d,u,f){let p=o(n.get(d),`This engine doesn't have ${d}`),m=Be(f)??{},g={current:null},y=new Set(Array.isArray(m.host)?m.host:[]),b={id:jl,kind:d,def:p,directory:g,host:y,watching:new Set,cleanups:[],extra:{},comments:null,storage:null,room:null,sync:null,receive:null};y.has("directory")&&(g.lookup=T=>mn(b,"users.lookup",{ids:T}),g.search=T=>mn(b,"users.search",{query:T})),b.users=new Ir(g),m.user?i(b,Gl(m.user),m.user.role??m.role??"editor"):m.role&&(g.role=m.role),y.has("storage")&&(b.storage=new Fr(Ig(b),m.storage??{}));let k=y.has("comments")?Lg(b):void 0;return b.extra.commentStore=k,p.open(b,u,m),b.comments=p.comments(b,m,k),zi.set(jl++,b),K(b.id)}return{version:e.version,editors(){return K([...n.keys()])},methods(d){return s(()=>K(o(n.get(d),`No ${d}`).methods.map(u=>u.name)))},openEditor(d,u,f,p){return s(()=>{let m=!["json","csv","tsv","html","md","markdown","txt"].includes(u),g=null;if(f!=null&&m&&(g=yn(f),!g))throw new C("invalid_document","The file isn't valid base64");return l(d,{format:u,text:m?null:f??null,bytes:g},p)})},close(d){return s(()=>{let u=zi.get(d);if(!u)return K(!1);u.sync?.stop(),u.room?.disconnect();for(let f of u.cleanups.splice(0))f();return u.comments?.dispose(),u.def.close?.(u),zi.delete(d),K(!0)})},invoke(d,u,f){return s(()=>{let p=ee(d),m=r.get(p.kind).get(u),g=p.def.run[u];if(!m||!g)throw new C("not_found",`No command called "${u}"`);let y=Be(f)??[];jg(m,y);let b=g(p,y);return xt(b,m.returns==="void"?()=>null:void 0)})},call(d,u,f){return s(()=>{let p=ee(d),m=Be(f)??[];if(!Array.isArray(m))throw new C("invalid_operation","The arguments are a JSON array");let{owner:g,fn:y}=zg(p.session,u);return xt(y.apply(g,m))})},apply(d,u,f){return s(()=>{let p=ee(d),m=Be(u);if(!Array.isArray(m))throw new C("invalid_operation","Operations are a JSON array");let g=Be(f)??{};return(p.session.transact??p.core.transact).call(p.session.transact?p.session:p.core,m,g),K(!0)})},read(d,u,f){return s(()=>{let p=ee(d);if(u==="document")return K(p.def.serialize(p));if(u==="state")return K({canUndo:p.core.canUndo,canRedo:p.core.canRedo,...p.def.state(p)});let m=Be(f)??[];if(!p.def.read)throw new C("not_found",`Nothing called "${u}" can be read`);return xt(p.def.read(p,u,m))})},exportFile(d,u,f){return s(()=>{let p=ee(d),m=p.def.exportFile(p,u,Be(f)??{});return xt(m,y=>Xn(typeof y=="string"?Ar(y):y))})},importFile(d,u,f,p){return s(()=>{let m=ee(d),g=!["json","csv","tsv","html","md","markdown","txt"].includes(u),y=g?yn(f):null;if(g&&!y)throw new C("invalid_document","The file isn't valid base64");return xt(m.def.importFile(m,u,{format:u,text:g?null:f,bytes:y},Be(p)??{}))})},watch(d,u,f){return s(()=>{let p=ee(d);return Gg(p,u,f),K(!0)})},pump(){return K(null)},tick(){return _g(),K(Pr.size)},taskResult(d){let u=Wl.get(d);return u?u.done?(Wl.delete(d),u.failed?Ul(u.error):K(u.value)):K(null,{pending:d}):Ul(new C("not_found",`No task ${d}`))},hostResolve(d,u,f){return s(()=>{let p=Kl.get(d);if(!p)return K(!1);if(Kl.delete(d),f){let m=Be(f)??{};p.reject(new C(m.code??"storage",m.message??"The app couldn't do that"))}else p.resolve(Be(u)??null);return K(!0)})},setUser(d,u,f){return s(()=>{let p=ee(d),m=u?Gl(Be(u)):null;return i(p,m,f??void 0),K(!0)})},currentUser(d){return s(()=>{let u=ee(d);return K({user:u.users.current,role:u.users.role})})},addUsers(d,u){return s(()=>{let f=Be(u);if(!Array.isArray(f))throw new C("invalid_operation","Users are a JSON array");return ee(d).users.add(f.map(Gl)),K(!0)})},getUser(d,u){return s(()=>K(ee(d).users.get(u)))},searchUsers(d,u){return s(()=>xt(ee(d).users.search(u)))},comments(d){return s(()=>K(a(ee(d)).threads))},commentsCan(d,u,f){return s(()=>{let p=a(ee(d)),m=f?p.thread(f):void 0;return K(p.can(u,m))})},commentsCreate(d,u,f,p){return s(()=>{let m=a(ee(d));return K(m.createThread(u,Be(f),void 0,Be(p)??void 0))})},commentsReply(d,u,f,p){return s(()=>K(a(ee(d)).reply(u,f,Be(p)??void 0)))},commentsEdit(d,u,f,p,m){return s(()=>(a(ee(d)).editComment(u,f,p,Be(m)??void 0),K(!0)))},commentsDelete(d,u,f){return s(()=>{let p=a(ee(d));return f?p.deleteComment(u,f):p.deleteThread(u),K(!0)})},commentsResolve(d,u,f){return s(()=>{let p=a(ee(d));return f?p.resolve(u):p.reopen(u),K(!0)})},commentsReceive(d,u){return s(()=>(a(ee(d)).receive(Be(u)),K(!0)))},commentsReload(d){return s(()=>xt(a(ee(d)).reload().then(()=>null)))},scriptRun(d,u,f){return s(()=>{let p=ee(d),m=o(p.def.editorSession?.(p),"This editor can't run scripts"),g=Be(f)??{},y;try{y=new Function("ctx",`"use strict";
${u}`)}catch(k){throw new C("invalid_operation",`The script has a mistake: ${k.message}`,{cause:k})}let b=new ur(m,{grants:g.grants,maxOps:g.maxOps,maxMs:g.maxMs});return K(b.run(k=>y(k)))})},storageUpload(d,u,f,p){return s(()=>{let m=ee(d),g=o(m.storage,"No storage: open the document with a storage adapter"),y=yn(p);if(!y)throw new C("invalid_operation","The file isn't valid base64");return xt(g.upload(Cf(y,f),{name:u,type:f}))})},storageResolve(d,u){return s(()=>xt(o(ee(d).storage,"No storage: open the document with a storage adapter").resolve(u)))},storageRead(d,u){return s(()=>xt(o(ee(d).storage,"No storage: open the document with a storage adapter").read(u).then(async f=>({type:f.type,data:Xn(new Uint8Array(await f.arrayBuffer()))}))))},storageDelete(d,u){return s(()=>xt(o(ee(d).storage,"No storage: open the document with a storage adapter").delete(u).then(()=>null)))},syncStart(d,u){return s(()=>{let f=ee(d);if(f.sync)throw new C("invalid_operation","Already in a room: stop first");let p=Be(u)??{},m=p.room??f.file,g=p.live===!1?null:o(f.def.model(),`Live editing isn't available for ${f.kind} in this build`),y=new qr({room:m,transport:Ug(f),users:f.users,comments:f.comments??void 0,heartbeat:p.heartbeat,timeout:p.timeout});if(f.room=y,f.cleanups.push(y.subscribe(()=>{f.watching.has("peers")&&Tt({type:"peers",handle:f.id,status:y.status,peers:y.peers})})),g){let b=new Cn({session:f.core,room:y,model:g,version:p.version??null,verifyEvery:p.verifyEvery??3e4,onResync:k=>Tt({type:"resync",handle:f.id,reason:k.reason,lost:k.lost})});f.sync=b,f.cleanups.push(b.subscribe(()=>{f.watching.has("sync")&&Tt({type:"sync",handle:f.id,status:b.status,unsynced:b.unsynced,version:b.version})})),b.start(),f.def.syncing?.(f,!0)}return y.connect().catch(b=>Tt({type:"error",handle:f.id,code:b.code??"error",message:String(b.message??b)})),K(!0)})},syncStop(d){return s(()=>{let u=ee(d);return u.sync&&u.def.syncing?.(u,!1),u.sync?.stop(),u.room?.disconnect(),u.sync=null,u.room=null,K(!0)})},syncStatus(d){return s(()=>{let u=ee(d);return K({room:u.room?.status??"idle",status:u.sync?.status??(u.room?"synced":"offline"),unsynced:u.sync?.unsynced??0,version:u.sync?.version??null,lastResync:u.sync?.lastResync??null})})},syncOnline(d,u){return s(()=>(ee(d).sync?.setOnline(u),K(!0)))},syncResync(d){return s(()=>(ee(d).sync?.resync("asked to"),K(!0)))},transportReceive(d,u){return s(()=>(ee(d).receive?.(Be(u)),K(!0)))},setPresence(d,u){return s(()=>{let f=ee(d);return o(f.room,"Not in a room: start syncing first").setPresence({...f.def.presence?.(f),...Be(u)??{}}),K(!0)})},peers(d){return s(()=>K(ee(d).room?.peers??[]))},authorityOpen(d,u){return s(()=>{let f=o(n.get(d),`This engine doesn't have ${d}`),p=o(f.model(),`Live editing isn't available for ${d} in this build`),m=jl++,g=u??null,y=qs({store:Ws(),model:p,create:b=>g?f.parse(g):f.create?f.create(b):(()=>{throw new C("not_found",`No document for room "${b}"`)})(),onError:(b,k)=>Tt({type:"error",handle:m,code:b.code??"error",message:`${k}: ${String(b.message??b)}`})});return zl.set(m,{kind:d,def:f,authority:y,initial:g}),K(m)})},authorityReceive(d,u,f){return s(()=>{let p=zl.get(d);if(!p)throw new C("not_found",`No sequencer ${d}`);return xt(p.authority.receive(u,Be(f),m=>Tt({type:"authority.send",handle:d,room:u,json:Hi(m)})).then(()=>null))})},authorityClose(d){return K(zl.delete(d))}}}function Is(t,e){let n=r=>{for(let o of r){if(o.id===e)return o;if(o.type==="table")for(let s of o.rows)for(let i of s.cells){let a=n(i.blocks);if(a)return a}}};return n(t.blocks)}var Br=t=>e=>e.toggleMark(t),Ki=t=>(e,[n])=>e.setMarks({[t]:n??null}),Ls=t=>e=>e.setBlockType(t),Hg={typeText:(t,[e])=>t.typeText(e),paste:(t,[e,n,r])=>t.paste({html:e??void 0,rtf:n??void 0,text:r??void 0}).applied,pasteText:(t,[e])=>t.paste({text:e,plain:!0}).applied,splitBlock:t=>t.splitBlock(),backspace:t=>t.backspace(),deleteForward:t=>t.deleteForward(),deleteSelection:t=>t.deleteSelection(),undo:t=>t.undo(),redo:t=>t.redo(),toggleBold:Br("bold"),toggleItalic:Br("italic"),toggleUnderline:Br("underline"),toggleStrikethrough:Br("strike"),toggleCode:Br("code"),toggleSuperscript:Br("superscript"),toggleSubscript:Br("subscript"),setTextColor:Ki("color"),setHighlight:Ki("highlight"),setFontFamily:Ki("fontFamily"),setFontSize:Ki("fontSize"),setLink:(t,[e])=>t.setLink(e??null),clearFormatting:t=>t.clearFormatting(),setParagraph:Ls({type:"paragraph"}),setTitle:Ls({type:"title"}),setSubtitle:Ls({type:"subtitle"}),setHeading:(t,[e])=>{if(!Number.isInteger(e)||e<1||e>6)throw new C("invalid_operation","A heading level is 1 to 6");return t.setBlockType({type:"heading",level:e})},setQuote:Ls({type:"quote"}),setCodeBlock:Ls({type:"code_block"}),toggleBulletedList:t=>t.toggleBlockType({type:"list_item",list:"bullet"}),toggleNumberedList:t=>t.toggleBlockType({type:"list_item",list:"ordered"}),setAlignment:(t,[e])=>t.setAlign(e),indent:t=>t.indent(),outdent:t=>t.outdent(),setListMarker:(t,[e])=>t.setListMarker(e),setListStart:(t,[e])=>t.setListStart(e),continueNumbering:t=>t.continueNumbering(),setLineSpacing:(t,[e])=>t.setParagraphFormat({lineHeight:e??null}),setSpaceBefore:(t,[e])=>t.setParagraphFormat({spaceBefore:e??null}),setSpaceAfter:(t,[e])=>t.setParagraphFormat({spaceAfter:e??null}),insertTable:(t,[e,n])=>t.insertTable(e,n),addRowAbove:t=>t.addRow("above"),addRowBelow:t=>t.addRow("below"),addColumnLeft:t=>t.addColumn("left"),addColumnRight:t=>t.addColumn("right"),deleteRow:t=>t.deleteRow(),deleteColumn:t=>t.deleteColumn(),deleteTable:t=>t.deleteTable(),mergeCells:t=>t.mergeCells(),splitCells:t=>t.splitCells(),setHeaderRow:(t,[e])=>t.setHeaderRow(e),setColumnEdge:(t,[e,n,r,o])=>{let s=t.state.blocks.find(p=>p.id===e&&p.type==="table");if(!s||s.type!=="table")throw new C("not_found","No table has that id");let i=n;if(i<0||i>=s.columns.length-1)throw new C("invalid_operation","A table has an edge after each column but the last");let a=s.columns.reduce((p,m)=>p+m,0),l=[...s.columns],c=l.slice(0,i).reduce((p,m)=>p+m,0),d=l[i]+l[i+1],u=a*.05,f=Math.min(Math.max(r*a-c,u),d-u);return l[i]=f,l[i+1]=d-f,t.updateBlock(e,{columns:l.map(p=>p/a)},{merge:o}),!0},setRowHeight:(t,[e,n,r,o])=>{let s=Is(t.state,e);if(!s||s.type!=="table")throw new C("not_found","No table has that id");if(!Number.isInteger(n)||n<0||n>=s.rows.length)throw new C("invalid_operation","That table has no such row");let i=s.rows.map((a,l)=>{if(l!==n)return a;let{height:c,...d}=a;return r==null?d:{...d,height:Math.max(r,8)}});return t.updateBlock(s.id,{rows:i},{merge:o}),!0},setCellShade:(t,[e])=>t.setCellShade(e??null),insertPageBreak:t=>t.insertBlockAtCaret(Ia()),insertDivider:t=>t.insertBlockAtCaret(La()),setImageSize:(t,[e,n,r,o])=>{let s=Is(t.state,e);if(!s||s.type!=="image")throw new C("not_found","No picture has that id");return t.updateBlock(s.id,{width:Math.max(n,16),height:Math.max(r,16)},{merge:o}),!0},setImageCrop:(t,[e,n,r,o,s,i])=>{let a=Is(t.state,e);if(!a||a.type!=="image")throw new C("not_found","No picture has that id");let l={top:n,right:r,bottom:o,left:s};for(let[c,d]of Object.entries(l))if(!(d>=0&&d<=.9))throw new C("invalid_operation",`The ${c} crop is 0 to 0.9`);if(l.left+l.right>.95||l.top+l.bottom>.95)throw new C("invalid_operation","That crops away too much of the picture");return t.cropImage(a.id,l,{merge:i,rescale:!0}),!0},setImageWrap:(t,[e,n])=>{let r=Is(t.state,e);if(!r||r.type!=="image")throw new C("not_found","No picture has that id");return t.select({anchor:{block:r.id,offset:0},focus:{block:r.id,offset:0}}),t.setImageWrap(n??null)},deleteImage:(t,[e])=>{let n=Is(t.state,e);if(!n||n.type!=="image")throw new C("not_found","No picture has that id");return t.deleteBlock(n.id),!0},insertImage:(t,[e,n,r,o])=>t.insertBlockAtCaret(_a(e,{width:n,height:r},o?{alt:o}:{})),setDocumentTitle:(t,[e])=>t.setTitle(e),applyParagraphStyle:(t,[e])=>t.applyParagraphStyle(e??null),applyCharacterStyle:(t,[e])=>t.applyCharacterStyle(e??null),createStyle:(t,[e,n])=>t.createStyle(e,n),deleteStyle:(t,[e])=>t.deleteStyle(e),select:(t,[e,n,r,o])=>t.select({anchor:{block:e,offset:n},focus:{block:r,offset:o}}),selectAll:t=>t.selectAll(),setSuggesting:(t,[e])=>t.setSuggesting(e),acceptSuggestion:(t,[e])=>t.acceptSuggestion(e),rejectSuggestion:(t,[e])=>t.rejectSuggestion(e),acceptAllSuggestions:t=>t.acceptAllSuggestions(),rejectAllSuggestions:t=>t.rejectAllSuggestions()};function ql(t,e=new Map){as(t).forEach((n,r)=>{n&&e.set(t[r].id,n)});for(let n of t)if(n.type==="table")for(let r of n.rows)for(let o of r.cells)ql(o.blocks,e);return e}function Kg(t){let e=ql(t.blocks);return On(t.blocks).map(n=>{let r={id:n.id,type:n.type};if(_(n)){if(r.text=H(n.runs),"level"in n&&(r.level=n.level),"list"in n){r.list=n.list,r.depth=n.depth;let o=e.get(n.id);o&&(r.marker=o.marker,r.label=o.text)}"align"in n&&n.align&&(r.align=n.align),"style"in n&&n.style&&(r.style=n.style)}else n.type==="table"?(r.rows=n.rows.length,r.columns=n.columns.length):n.type==="image"&&(r.width=n.width,r.height=n.height,n.alt&&(r.description=n.alt));return r})}function Wg(t){let e=ql(t.blocks),n=r=>r.map(o=>{if(o.type==="table")return{...o,rows:o.rows.map(i=>({...i,cells:i.cells.map(a=>({...a,blocks:n(a.blocks)}))}))};let s=o.type==="list_item"?e.get(o.id):void 0;return s?{...o,label:s.text}:o});return n(t.blocks)}function qg(t){let e=fl(t.state,t.selection,t.pendingMarks),n=r=>({value:r.value??null,mixed:r.mixed});return{marks:e.marks,fontFamily:n(e.fontFamily),fontSize:n(e.fontSize),color:n(e.color),highlight:n(e.highlight),link:n(e.link),block:e.block,align:e.align,paragraphStyle:e.paragraphStyle,list:e.list,image:e.image?{id:e.image.id,wrap:e.image.wrap??null}:null,table:e.table?{id:e.table.id,rows:e.table.rows,columns:e.table.columns,row:e.table.row,column:e.table.column,selectedRows:e.table.selectedRows,selectedColumns:e.table.selectedColumns,headerRow:e.table.headerRow,shade:e.table.shade??null,canMerge:e.table.canMerge,canSplit:e.table.canSplit}:null,canIndent:e.canIndent,canOutdent:e.canOutdent,canUndo:t.canUndo,canRedo:t.canRedo}}function Xg(t){return t.blocks.flatMap(e=>e.type==="heading"?[{id:e.id,level:e.level,text:H(e.runs)}]:[])}function Vg(t,e){let n=t.state;switch(e){case"title":return n.title;case"plainText":return On(n.blocks).filter(_).map(r=>H(r.runs)).join(`
`);case"markdown":return Ui(n);case"html":return Ns(n);case"blocks":return Kg(n);case"content":return Wg(n);case"format":return qg(t);case"selectedText":return t.selection?Oi(n,t.selection):"";case"clipboard":return t.selection?{text:Oi(n,t.selection),html:Ns(Mi(n,t.selection))}:{text:"",html:""};case"outline":return Xg(n);case"statistics":return pl(n);case"selection":return t.selection;case"suggestions":return t.suggestions;case"styles":return t.styles;default:throw new C("not_found",`Nothing called "${e}" can be read`)}}var Jg=0,Bf={kind:"docs",methods:[...ji.commands,...Sf("docs")],run:{...Object.fromEntries(Object.entries(Hg).map(([t,e])=>[t,(n,r)=>e(n.session,r)])),commentOnSelection:(t,[e,n])=>t.session.comment(e,t.session.selection,n??void 0),commentRanges:(t,[e])=>Tn(t.session.state,e),threadsAtSelection:t=>{let e=t.session,n=new Set(Ca(e.state,e.selection));return t.comments.threads.filter(r=>n.has(r.id))}},open(t,e,n){let r=t.users.current,o=e.format==="docx"?_i(e.bytes,{trackedChanges:"accept",title:n.title}).doc:e.text?yr(e.text):li(n.title??"Untitled",[{id:`b_${++Jg}_0`,type:"paragraph",runs:[]}]),s=new Bs(o,{comments:{users:t.users,store:t.extra.commentStore??"document",synced:n.live===!0},...t.storage?{storage:t.storage}:{},...r&&n.suggestions!==!1?{suggestions:{users:t.users}}:{}}),i=s.state.blocks.find(_);i&&s.select({anchor:{block:i.id,offset:0},focus:{block:i.id,offset:0}}),t.session=s,t.core=s,t.file=o.id},comments:t=>t.session.comments,serialize:t=>gs(t.session.state),parse:t=>yr(t),create:()=>li("Untitled",[{id:"b_0",type:"paragraph",runs:[]}]),model:()=>vs,editorSession:t=>al(t.session),presence:t=>({selection:t.session.selection}),state(t){let e=t.session;return{selection:e.selection,suggesting:e.suggesting,canSuggest:e.canSuggest}},read:(t,e)=>Vg(t.session,e),exportFile(t,e){let n=t.session.state;switch(e){case"docx":return $l(n);case"json":return gs(n);case"markdown":case"md":return Ui(n);case"html":return Ns(n);default:throw new C("unsupported",`Documents export as docx, json, markdown or html, not ${e}`)}},importFile(t,e,n,r){let o=t.session;if(e==="docx"){let s=_i(n.bytes,{trackedChanges:r.trackedChanges??(o.suggestionsEnabled?"keep":"accept"),title:r.title});return o.replaceDocument(s.doc),o.suggestionUsers?.add(s.authors),{warnings:s.warnings,authors:s.authors}}if(e==="json")return o.replaceDocument(yr(n.text??Ro(n.bytes))),{warnings:[],authors:[]};throw new C("unsupported",`Documents import docx or json, not ${e}`)}};var Wi=Pf([Bf],{version:"0.0.0"}),Zg={...Wi,commands(){return K(ji.commands.map(t=>t.name))},open(t,e){return Wi.openEditor("docs","json",t||null,e)},exportDocx(t){return Wi.exportFile(t,"docx")},importDocx(t,e,n){return Wi.importFile(t,"docx",e,n)}};globalThis.Pli=Zg;})();
