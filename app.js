/* ひとことToDo — データはすべてこの端末の IndexedDB に保存し、外部には送らない */
(function(){
"use strict";
const APP_VERSION = "1.0.0";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return ymd(d); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
const WD = ["日","月","火","水","木","金","土"];
const ls = { get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v);}catch(e){return d;} }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };

/* ---------- IndexedDB ---------- */
const idb = {
  db:null,
  open(){
    return new Promise((ok,ng)=>{
      const r = indexedDB.open("hitokoto-todo",1);
      r.onupgradeneeded = ()=>{ const d=r.result;
        d.createObjectStore("tasks",{keyPath:"id"});
        d.createObjectStore("images",{keyPath:"id"});
        d.createObjectStore("meta"); };
      r.onsuccess = ()=>{ this.db=r.result; ok(); };
      r.onerror = ()=>ng(r.error);
    });
  },
  tx(store, mode, fn){
    return new Promise((ok,ng)=>{
      const t = this.db.transaction(store, mode); let out;
      const s = Array.isArray(store) ? store.map(n=>t.objectStore(n)) : t.objectStore(store);
      const r = fn(s); if(r && "onsuccess" in r) r.onsuccess = ()=>{ out=r.result; };
      t.oncomplete = ()=>ok(out); t.onerror = ()=>ng(t.error); t.onabort = ()=>ng(t.error);
    });
  },
  all(store){ return this.tx(store,"readonly",s=>s.getAll()); },
  get(store,key){ return this.tx(store,"readonly",s=>s.get(key)); },
  put(store,val,key){ return this.tx(store,"readwrite",s=>key===undefined?s.put(val):s.put(val,key)); },
  del(store,key){ return this.tx(store,"readwrite",s=>s.delete(key)); },
};
const meta = { get:k=>idb.get("meta",k), set:(k,v)=>idb.put("meta",v,k) };

/* ---------- state ---------- */
let tasks = [];
let view = ls.get("todo.view","all");
let showDone = false;
let openId = null;
const imgURL = new Map();   // imageId -> objectURL
async function urlFor(id){
  if(imgURL.has(id)) return imgURL.get(id);
  const rec = await idb.get("images",id); if(!rec) return "";
  const u = URL.createObjectURL(rec.blob); imgURL.set(id,u); return u;
}
async function warmImages(){ for(const t of tasks) for(const id of (t.images||[])) await urlFor(id); }

function dueLabel(due){
  if(!due) return "";
  if(due===addDays(0)) return "今日";
  if(due===addDays(1)) return "明日";
  const [y,m,d] = due.split("-").map(Number); const dt = new Date(y,m-1,d);
  const s = `${m}/${d}(${WD[dt.getDay()]})`;
  return y!==new Date().getFullYear() ? `${y}/${s}` : s;
}
function lateDays(due){
  if(!due) return 0;
  const [y,m,d] = due.split("-").map(Number); const a=new Date(y,m-1,d), b=new Date(); b.setHours(0,0,0,0);
  return Math.round((b-a)/86400000);
}
function paintToday(){ const n=new Date(); $("#today").textContent = `${n.getMonth()+1}月${n.getDate()}日(${WD[n.getDay()]})`; }

/* ---------- save helpers ---------- */
async function saveTask(t){
  try{ await idb.put("tasks",t); }catch(e){ toast(e?.name==="QuotaExceededError" ? "保存容量がいっぱいです。不要な画像を削除してください。" : "保存できませんでした"); }
}
function patch(id,data){
  const t = tasks.find(x=>x.id===id); if(!t) return Promise.resolve();
  Object.assign(t,data,{updatedAt:Date.now(), example:false});
  render(); if(openId===id) paintSheetMeta();
  return saveTask(t);
}
let persistAsked=false;
function askPersist(){ if(persistAsked) return; persistAsked=true; try{ navigator.storage?.persist?.(); }catch(e){} }

/* ---------- quick add ---------- */
let addArea = ls.get("todo.area","work"), addDue = "", addStar = false;
const titleEl = $("#a-title"), goEl = $("#a-go");
function paintAdd(){
  $("#a-work").setAttribute("aria-pressed", addArea==="work");
  $("#a-life").setAttribute("aria-pressed", addArea==="life");
  document.querySelectorAll("[data-due]").forEach(b=> b.setAttribute("aria-pressed", addDue===addDays(+b.dataset.due)));
  const custom = addDue && addDue!==addDays(0) && addDue!==addDays(1);
  $("#a-datechip").setAttribute("aria-pressed", !!custom);
  $("#a-datelabel").textContent = custom ? dueLabel(addDue) : "日付";
  $("#a-star").setAttribute("aria-pressed", addStar);
  goEl.disabled = !titleEl.value.trim();
}
$("#a-work").onclick = ()=>{ addArea="work"; ls.set("todo.area",addArea); paintAdd(); titleEl.focus(); };
$("#a-life").onclick = ()=>{ addArea="life"; ls.set("todo.area",addArea); paintAdd(); titleEl.focus(); };
document.querySelectorAll("[data-due]").forEach(b=> b.onclick = ()=>{ const v=addDays(+b.dataset.due); addDue = addDue===v?"":v; paintAdd(); titleEl.focus(); });
$("#a-date").onchange = e=>{ addDue = e.target.value||""; paintAdd(); };
$("#a-star").onclick = ()=>{ addStar=!addStar; paintAdd(); titleEl.focus(); };
titleEl.oninput = paintAdd;

function parseQuick(raw){
  let title=raw, area=addArea, star=addStar;
  title = title.replace(/[#＃](仕事|しごと|work|w)(?=\s|$)/gi, ()=>{ area="work"; return ""; });
  title = title.replace(/[#＃](プライベート|ぷらいべーと|プ|private|p|life)(?=\s|$)/gi, ()=>{ area="life"; return ""; });
  title = title.replace(/(^|\s)[!！](?=\s|$)|[!！]$/g, (m,p1)=>{ star=true; return p1||""; });
  return { title:title.replace(/\s+/g," ").trim(), area, star };
}
$("#addForm").onsubmit = async e=>{
  e.preventDefault();
  const raw = titleEl.value.trim(); if(!raw) return;
  const p = parseQuick(raw); if(!p.title) return;
  const now = Date.now();
  const t = { id:uid(), title:p.title, area:p.area, due:addDue, star:p.star, memo:"", images:[], done:false, doneAt:0, createdAt:now, updatedAt:now };
  tasks.push(t); titleEl.value=""; addStar=false; paintAdd(); render(); titleEl.focus();
  askPersist(); await saveTask(t);
};

/* ---------- list ---------- */
document.querySelectorAll("#tabs button").forEach(b=>{
  b.setAttribute("aria-pressed", b.dataset.v===view);
  b.onclick = ()=>{ view=b.dataset.v; ls.set("todo.view",view);
    document.querySelectorAll("#tabs button").forEach(x=>x.setAttribute("aria-pressed", x===b)); render(); };
});
function inView(t){
  if(view==="work") return t.area==="work";
  if(view==="life") return t.area==="life";
  if(view==="star") return !!t.star;
  if(view==="today") return !!t.due && t.due<=addDays(0);
  return true;
}
const byOrder = (a,b)=> (!!b.star - !!a.star) || ((b.createdAt||0)-(a.createdAt||0));
function itemHTML(t){
  const late = !t.done && lateDays(t.due)>0, imgs = t.images||[];
  return `<div class="item${t.done?" done":""}" data-id="${esc(t.id)}">
    <button class="check" data-act="toggle" aria-label="${t.done?"未完了に戻す":"完了にする"}"><svg><use href="#i-check"/></svg></button>
    <button class="body" data-act="open">
      <div class="ttl">${esc(t.title)}</div>
      <div class="meta">
        <span class="tag ${t.area==="life"?"life":"work"}">${t.area==="life"?"プライベート":"仕事"}</span>
        ${t.due?`<span class="${late?"late":""}"><svg><use href="#i-cal"/></svg>${esc(dueLabel(t.due))}${late?` ・${lateDays(t.due)}日超過`:""}</span>`:""}
        ${t.memo?`<span><svg><use href="#i-note"/></svg>メモ</span>`:""}
        ${imgs.length?`<span><svg><use href="#i-img"/></svg>${imgs.length}</span>`:""}
      </div>
      ${imgs.length && !t.done?`<div class="thumbs">${imgs.slice(0,4).map(id=>`<img src="${esc(imgURL.get(id)||"")}" alt="">`).join("")}</div>`:""}
    </button>
    <button class="starbtn${t.star?" on":""}" data-act="star" aria-label="${t.star?"重要を外す":"重要にする"}"><svg><use href="#i-star"/></svg></button>
  </div>`;
}
function section(title,list,cls=""){
  if(!list.length) return "";
  return `<section class="sec ${cls}"><h2>${title}<span class="n">${list.length}</span></h2><div class="list">${list.map(itemHTML).join("")}</div></section>`;
}
function render(){
  const today = addDays(0), open = tasks.filter(t=>!t.done);
  const cnt = { all:open.length, today:open.filter(t=>t.due&&t.due<=today).length, work:open.filter(t=>t.area==="work").length,
    life:open.filter(t=>t.area==="life").length, star:open.filter(t=>t.star).length };
  for(const k in cnt) $("#n-"+k).textContent = cnt[k]||"";
  const vis = open.filter(inView);
  const byDue = (a,b)=>a.due.localeCompare(b.due)||byOrder(a,b);
  const done = tasks.filter(t=>t.done&&inView(t)).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  let html = section("期限切れ", vis.filter(t=>t.due&&t.due<today).sort(byDue), "overdue")
    + section("今日", vis.filter(t=>t.due===today).sort(byOrder))
    + section("これから", vis.filter(t=>t.due&&t.due>today).sort(byDue))
    + section("期限なし", vis.filter(t=>!t.due).sort(byOrder));
  if(!vis.length) html = `<div class="empty"><b>${tasks.length?"このリストは空です":"まだタスクはありません"}</b>下の入力欄に書いて <svg><use href="#i-up"/></svg> を押すと追加されます。</div>`;
  if(done.length){
    html += `<section class="sec"><h2>完了<span class="n">${done.length}</span></h2>` + (showDone
      ? `<div class="list">${done.slice(0,100).map(itemHTML).join("")}</div><button class="more" data-act="hidedone">完了を隠す</button>`
      : `<button class="more" data-act="showdone">完了したタスクを表示</button>`) + `</section>`;
  }
  $("#main").innerHTML = html;
}
$("#main").addEventListener("click", e=>{
  const btn = e.target.closest("[data-act]"); if(!btn) return;
  const act = btn.dataset.act;
  if(act==="showdone"){ showDone=true; render(); return; }
  if(act==="hidedone"){ showDone=false; render(); return; }
  const t = tasks.find(x=>x.id===btn.closest(".item")?.dataset.id); if(!t) return;
  if(act==="toggle") toggleDone(t);
  else if(act==="star") patch(t.id,{star:!t.star});
  else if(act==="open") openSheet(t.id);
});
function toggleDone(t){
  const done=!t.done; patch(t.id,{done,doneAt:done?Date.now():0});
  if(done) toast("完了しました","元に戻す",()=>patch(t.id,{done:false,doneAt:0}));
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg,actLabel,act){
  clearTimeout(toastTimer); const r=$("#toastRoot");
  r.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${actLabel?`<button type="button">${esc(actLabel)}</button>`:""}</div>`;
  if(actLabel) r.querySelector("button").onclick = ()=>{ act(); r.innerHTML=""; };
  toastTimer = setTimeout(()=>{ r.innerHTML=""; }, 4000);
}

/* ---------- detail sheet ---------- */
let titleTimer, memoTimer, delArmed=false;
const cur = ()=> tasks.find(x=>x.id===openId) || {};
function openSheet(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  openId=id; delArmed=false;
  const c = new Date(t.createdAt||Date.now());
  $("#sheetRoot").innerHTML = `
  <div class="scrim" data-close></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="タスクの詳細">
    <div class="grip"></div>
    <div class="shead"><span class="saved" id="s-saved">変更は自動で保存されます</span><button class="close" data-close>閉じる</button></div>
    <textarea class="sttl" id="s-title" rows="1" aria-label="タスク名"></textarea>
    <div class="field"><span class="flabel">分類</span><div class="chips">
      <button class="chip work" id="s-work">仕事</button><button class="chip life" id="s-life">プライベート</button>
      <button class="chip st" id="s-star"><svg><use href="#i-star"/></svg>重要</button>
      <button class="chip" id="s-done"><svg><use href="#i-check"/></svg>完了</button></div></div>
    <div class="field"><span class="flabel">期限</span><div class="chips">
      <button class="chip" data-sdue="">なし</button><button class="chip" data-sdue="0">今日</button><button class="chip" data-sdue="1">明日</button>
      <button class="chip" data-sdue="7">1週間後</button>
      <label class="chip" id="s-datechip"><svg><use href="#i-cal"/></svg><span id="s-datelabel">日付を選ぶ</span><input type="date" id="s-date" aria-label="期限の日付"></label></div></div>
    <div class="field"><label for="s-memo">メモ</label><textarea class="memo" id="s-memo" placeholder="詳しいこと、URL、手順など"></textarea></div>
    <div class="field"><span class="flabel">画像</span><div class="gal" id="s-gal"></div><div class="status" id="s-imgstatus" hidden></div></div>
    <div class="danger"><button class="del" id="s-del">このタスクを削除</button><span class="created">${c.getFullYear()}/${c.getMonth()+1}/${c.getDate()} 作成</span></div>
  </div>`;
  const tt=$("#s-title"), memo=$("#s-memo");
  tt.value=t.title; memo.value=t.memo||"";
  const grow = el=>{ el.style.height="auto"; el.style.height=el.scrollHeight+"px"; }; grow(tt);
  const saving = ()=>{ $("#s-saved").textContent="保存中…"; };
  const saved = ()=>{ const s=$("#s-saved"); if(s) s.textContent="保存しました"; };
  tt.oninput = ()=>{ grow(tt); saving(); clearTimeout(titleTimer); titleTimer=setTimeout(()=>{ titleTimer=null; const v=tt.value.trim(); if(v) patch(id,{title:v}).then(saved); },500); };
  tt.onkeydown = e=>{ if(e.key==="Enter" && !e.isComposing){ e.preventDefault(); tt.blur(); } };
  memo.oninput = ()=>{ saving(); clearTimeout(memoTimer); memoTimer=setTimeout(()=>{ memoTimer=null; patch(id,{memo:memo.value}).then(saved); },500); };
  $("#s-work").onclick = ()=>patch(id,{area:"work"});
  $("#s-life").onclick = ()=>patch(id,{area:"life"});
  $("#s-star").onclick = ()=>patch(id,{star:!cur().star});
  $("#s-done").onclick = ()=>{ const d=!cur().done; patch(id,{done:d,doneAt:d?Date.now():0}); };
  document.querySelectorAll("[data-sdue]").forEach(b=> b.onclick = ()=>patch(id,{due:b.dataset.sdue===""?"":addDays(+b.dataset.sdue)}));
  $("#s-date").onchange = e=>patch(id,{due:e.target.value||""});
  $("#s-del").onclick = ()=>{
    const b=$("#s-del");
    if(!delArmed){ delArmed=true; b.textContent="もう一度押すと削除します"; b.classList.add("confirm");
      setTimeout(()=>{ if(delArmed && b.isConnected){ delArmed=false; b.textContent="このタスクを削除"; b.classList.remove("confirm"); } },3500); return; }
    removeTask(id);
  };
  document.querySelectorAll("#sheetRoot [data-close]").forEach(el=> el.onclick = closeSheet);
  paintSheetMeta();
}
function flush(){
  const tt=$("#s-title"), memo=$("#s-memo"), t=cur(); if(!tt||!t.id) return;
  if(titleTimer){ clearTimeout(titleTimer); titleTimer=null; const v=tt.value.trim(); if(v&&v!==t.title) patch(t.id,{title:v}); }
  if(memoTimer){ clearTimeout(memoTimer); memoTimer=null; if(memo.value!==(t.memo||"")) patch(t.id,{memo:memo.value}); }
}
function closeSheet(){ flush(); openId=null; $("#sheetRoot").innerHTML=""; }
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ const v=$(".viewer"); if(v) v.remove(); else if($("#sheetRoot").innerHTML) closeAny(); } });
document.addEventListener("visibilitychange", ()=>{ if(document.hidden) flush(); else { paintToday(); render(); } });
function closeAny(){ if(openId) closeSheet(); else $("#sheetRoot").innerHTML=""; }

function paintSheetMeta(){
  const t=cur(); if(!t.id || !$("#s-gal")) return;
  $("#s-work").setAttribute("aria-pressed", t.area!=="life");
  $("#s-life").setAttribute("aria-pressed", t.area==="life");
  $("#s-star").setAttribute("aria-pressed", !!t.star);
  $("#s-done").setAttribute("aria-pressed", !!t.done);
  const map = {"":"", "0":addDays(0), "1":addDays(1), "7":addDays(7)}; let matched=false;
  document.querySelectorAll("[data-sdue]").forEach(b=>{ const on=(t.due||"")===map[b.dataset.sdue]; if(on) matched=true; b.setAttribute("aria-pressed",on); });
  $("#s-datechip").setAttribute("aria-pressed", !matched);
  $("#s-datelabel").textContent = !matched ? dueLabel(t.due) : "日付を選ぶ";
  $("#s-date").value = t.due||"";
  const imgs = t.images||[];
  $("#s-gal").innerHTML = imgs.map((id,i)=>`<figure><img src="${esc(imgURL.get(id)||"")}" alt="添付画像 ${i+1}" data-view="${i}"><button class="x" data-rm="${i}" aria-label="画像を削除">✕</button></figure>`).join("")
    + `<label class="addimg"><span><svg style="width:22px;height:22px"><use href="#i-img"/></svg><br>写真を追加</span><input type="file" accept="image/*" multiple id="s-file" aria-label="写真を追加"></label>`;
  $("#s-gal").querySelectorAll("[data-view]").forEach(img=> img.onclick = ()=>{
    const v=document.createElement("div"); v.className="viewer"; v.innerHTML=`<img src="${esc(img.src)}" alt="">`; v.onclick=()=>v.remove(); document.body.appendChild(v); });
  $("#s-gal").querySelectorAll("[data-rm]").forEach(b=> b.onclick = async ()=>{
    const i=+b.dataset.rm, rid=imgs[i];
    await patch(t.id,{images:imgs.filter((_,j)=>j!==i)});
    await idb.del("images",rid).catch(()=>{}); const u=imgURL.get(rid); if(u){ URL.revokeObjectURL(u); imgURL.delete(rid); }
    toast("画像を削除しました");
  });
  const f=$("#s-file"); f.onchange = ()=>addImages(t.id,[...f.files]);
}
async function shrink(file){
  // iPhoneの写真は大きいので、長辺1600pxのJPEGに縮めて保存する
  try{
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok,ng)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=ng; i.src=url; });
    const s = Math.min(1, 1600/Math.max(img.naturalWidth,img.naturalHeight));
    const c = document.createElement("canvas"); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
    return await new Promise(ok=>c.toBlob(b=>ok(b||file),"image/jpeg",0.85));
  }catch(e){ return file; }
}
async function addImages(id,files){
  if(!files.length) return;
  const st=$("#s-imgstatus"); if(st){ st.hidden=false; st.textContent="画像を保存中…"; }
  const added=[];
  for(const f of files){
    try{ const blob=await shrink(f), iid=uid(); await idb.put("images",{id:iid,blob,type:blob.type}); imgURL.set(iid,URL.createObjectURL(blob)); added.push(iid); }
    catch(e){ toast(e?.name==="QuotaExceededError" ? "保存容量がいっぱいです" : "画像を保存できませんでした"); }
  }
  const t=tasks.find(x=>x.id===id);
  if(added.length && t){ askPersist(); await patch(id,{images:[...(t.images||[]),...added]}); }
  const st2=$("#s-imgstatus"); if(st2) st2.hidden=true;
}
async function removeTask(id){
  const t=tasks.find(x=>x.id===id); closeSheet();
  const before=tasks; tasks=tasks.filter(x=>x.id!==id); render();
  try{
    await idb.del("tasks",id);
    for(const iid of (t?.images||[])){ await idb.del("images",iid).catch(()=>{}); const u=imgURL.get(iid); if(u){ URL.revokeObjectURL(u); imgURL.delete(iid); } }
    toast("削除しました");
  }catch(e){ tasks=before; render(); toast("削除できませんでした"); }
}

/* ---------- backup ---------- */
const blobToDataURL = b => new Promise((ok,ng)=>{ const r=new FileReader(); r.onload=()=>ok(r.result); r.onerror=()=>ng(r.error); r.readAsDataURL(b); });
async function dataURLToBlob(u){ return (await fetch(u)).blob(); }

async function exportBackup(){
  const imgs = await idb.all("images"), images = {};
  for(const r of imgs) images[r.id] = await blobToDataURL(r.blob);
  const payload = { app:"hitokoto-todo", format:1, appVersion:APP_VERSION, exportedAt:new Date().toISOString(), tasks, images };
  const name = `hitokoto-todo-${ymd(new Date()).replace(/-/g,"")}.json`;
  const file = new File([JSON.stringify(payload)], name, {type:"application/json"});
  let ok=false;
  try{
    if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:"ひとことToDo バックアップ"}); ok=true; }
  }catch(e){ if(e?.name==="AbortError") return; }
  if(!ok){
    const a=document.createElement("a"); a.href=URL.createObjectURL(file); a.download=name; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000); ok=true;
  }
  await meta.set("lastBackup",Date.now()); paintNotices(); paintSettings();
  toast("バックアップを書き出しました");
}
async function importBackup(file){
  let data;
  try{ data=JSON.parse(await file.text()); }catch(e){ toast("このファイルは読み込めません"); return; }
  if(data?.app!=="hitokoto-todo" || !Array.isArray(data.tasks)){ toast("ひとことToDoのバックアップファイルではありません"); return; }
  let n=0, m=0;
  // 新しい端末に入っている「例」のタスクは、読み込み時に片付ける
  for(const t of tasks.filter(t=>t.example)) await idb.del("tasks",t.id);
  for(const [id,u] of Object.entries(data.images||{})){
    try{ const blob=await dataURLToBlob(u); await idb.put("images",{id,blob,type:blob.type}); const old=imgURL.get(id); if(old) URL.revokeObjectURL(old); imgURL.set(id,URL.createObjectURL(blob)); m++; }catch(e){}
  }
  for(const t of data.tasks){
    if(!t || typeof t.id!=="string" || typeof t.title!=="string") continue;
    const clean = { id:t.id, title:t.title, area:t.area==="life"?"life":"work", due:typeof t.due==="string"?t.due:"", star:!!t.star,
      memo:typeof t.memo==="string"?t.memo:"", images:Array.isArray(t.images)?t.images.filter(x=>typeof x==="string"):[],
      done:!!t.done, doneAt:+t.doneAt||0, createdAt:+t.createdAt||Date.now(), updatedAt:+t.updatedAt||Date.now() };
    await idb.put("tasks",clean); n++;
  }
  tasks = await idb.all("tasks"); render(); closeAny();
  toast(`${n}件のタスクと${m}枚の画像を読み込みました`);
}

/* ---------- settings sheet ---------- */
async function openSettings(){
  openId=null;
  $("#sheetRoot").innerHTML = `
  <div class="scrim" data-close></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="設定">
    <div class="grip"></div>
    <div class="shead"><h3>設定とバックアップ</h3><button class="close" data-close>閉じる</button></div>
    <div class="group">
      <h4>バックアップ</h4>
      <p id="bk-last"></p>
      <p>データはこのiPhoneの中だけに保存されています。機種変更やSafariのデータ削除に備えて、ときどき書き出して「ファイル」アプリなどに保存してください。</p>
      <div class="btns">
        <button class="btn" id="bk-export">書き出す</button>
        <label class="btn sub">読み込む<input type="file" accept="application/json,.json" id="bk-import" aria-label="バックアップを読み込む"></label>
      </div>
    </div>
    <div class="group">
      <h4>完了したタスクの整理</h4>
      <p>完了済みのタスクを、添付画像ごとまとめて削除します。</p>
      <button class="btn sub" id="clean-done">完了済みを削除</button>
    </div>
    <div class="group" id="usage-box" hidden><h4>保存容量</h4><p id="usage"></p></div>
    <p class="about">ひとことToDo バージョン ${APP_VERSION}<br>
      このアプリは入力した内容を外部に送信しません。<a href="privacy.html">プライバシーポリシー</a> ・ <a href="terms.html">利用規約</a></p>
  </div>`;
  document.querySelectorAll("#sheetRoot [data-close]").forEach(el=> el.onclick = closeAny);
  $("#bk-export").onclick = ()=>exportBackup().catch(()=>toast("書き出せませんでした"));
  $("#bk-import").onchange = e=>{ const f=e.target.files[0]; if(f) importBackup(f); };
  let armed=false;
  $("#clean-done").onclick = async ()=>{
    const b=$("#clean-done"), done=tasks.filter(t=>t.done);
    if(!done.length){ toast("完了済みのタスクはありません"); return; }
    if(!armed){ armed=true; b.textContent=`${done.length}件を削除する`; b.classList.remove("sub"); return; }
    for(const t of done){ await idb.del("tasks",t.id); for(const iid of t.images||[]) await idb.del("images",iid).catch(()=>{}); }
    tasks=tasks.filter(t=>!t.done); render(); closeAny(); toast(`${done.length}件を削除しました`);
  };
  paintSettings();
}
async function paintSettings(){
  const el=$("#bk-last"); if(!el) return;
  const last = await meta.get("lastBackup");
  el.textContent = last ? `前回の書き出し：${new Date(last).toLocaleDateString("ja-JP")}` : "まだ書き出していません";
  try{ const e=await navigator.storage?.estimate?.(); if(e && $("#usage")){ $("#usage-box").hidden=false; $("#usage").textContent=`約${(e.usage/1048576).toFixed(1)}MB 使用中`; } }catch(e){}
}
$("#openSettings").onclick = openSettings;

/* ---------- notices (home screen / backup reminder) ---------- */
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const standalone = window.navigator.standalone===true || matchMedia("(display-mode: standalone)").matches;
async function paintNotices(){
  const box=$("#notices"); let html="";
  if(isIOS && !standalone && !ls.get("todo.hideA2HS",false)){
    html += `<div class="notice" id="nt-a2hs"><p><b>ホーム画面に追加してください</b><br>下の共有ボタン → 「ホーム画面に追加」で、アプリとしてすぐ開けます。データも消えにくくなります。</p><button data-nt="a2hs">閉じる</button></div>`;
  }
  const last = await meta.get("lastBackup"), first = await meta.get("firstUse");
  const ref = last || first || Date.now();
  const snooze = ls.get("todo.bkSnooze",0);
  if(tasks.length>3 && Date.now()-ref > 14*86400000 && Date.now()>snooze){
    html += `<div class="notice"><p>${last?"前回のバックアップから2週間以上たちました。":"まだバックアップをしていません。"}</p><button data-nt="backup">書き出す</button><button data-nt="later">あとで</button></div>`;
  }
  box.innerHTML = html;
}
$("#notices").addEventListener("click", e=>{
  const b=e.target.closest("[data-nt]"); if(!b) return;
  if(b.dataset.nt==="a2hs") ls.set("todo.hideA2HS",true);
  if(b.dataset.nt==="backup") { exportBackup().catch(()=>toast("書き出せませんでした")); return; }
  if(b.dataset.nt==="later") ls.set("todo.bkSnooze", Date.now()+3*86400000);
  paintNotices();
});

/* ---------- boot ---------- */
async function seedExamples(){
  const now=Date.now();
  const ex = [
    {title:"（例）左の丸をタップすると完了", area:"work", due:addDays(0), star:true, memo:"右の★で重要マーク。不要になったら、タスクを開いて「削除」してください。"},
    {title:"（例）タスクをタップするとメモ・写真・期限を編集", area:"life", due:addDays(1), star:false, memo:"ここにメモを書けます。写真も添付できます。"},
    {title:"（例）「牛乳を買う #プ !」と書くとプライベート＋重要で追加", area:"life", due:"", star:false, memo:""},
  ];
  for(let i=0;i<ex.length;i++){ const t={id:uid(), example:true, images:[], done:false, doneAt:0, createdAt:now+i, updatedAt:now+i, ...ex[i]}; await idb.put("tasks",t); }
}
async function boot(){
  paintToday(); paintAdd();
  try{
    await idb.open();
    if(!(await meta.get("firstUse"))){ await meta.set("firstUse",Date.now()); await seedExamples(); }
    tasks = await idb.all("tasks");
    await warmImages();
    render(); paintNotices();
  }catch(e){
    $("#main").innerHTML = `<div class="empty"><b>データを開けませんでした</b>プライベートブラウズを使っている場合は、通常のタブで開き直してください。</div>`;
  }
  if("serviceWorker" in navigator && location.protocol!=="file:") navigator.serviceWorker.register("sw.js").catch(()=>{});
}
// 日付が変わったら表示を更新
setInterval(()=>{ const t=ymd(new Date()); if(t!==boot.lastDay){ boot.lastDay=t; paintToday(); paintAdd(); render(); } }, 60000);
boot.lastDay = ymd(new Date());
boot();
})();
