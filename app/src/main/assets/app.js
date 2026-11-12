const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
/* Bee's Captura · pantalla de la tableta (diseño A · Panal) */
(function(){
'use strict';
const $ = id => document.getElementById(id);
const APP = !!window.Android;
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
const pad = n => String(n).padStart(2,'0');
const isoDia = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const hoy = () => isoDia(new Date());
const hhmm = t => { const d = new Date(t); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const nombreDia = iso => { const [y,m,d] = iso.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('es-MX',{weekday:'long', day:'numeric', month:'long'}); };
const masDias = (iso, n) => { const [y,m,d] = iso.split('-').map(Number); return isoDia(new Date(y, m-1, d+n)); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dinero = v => v == null ? '—' : '$' + (Number(v)||0).toLocaleString('es-MX',{minimumFractionDigits:2, maximumFractionDigits:2});

const PLATS = ['Uber','DiDi','Rappi','Reservándonos'];
const PKEY = {'Uber':'uber','DiDi':'didi','Rappi':'rappi','Reservándonos':'resv'};
const PNAME = {uber:'Uber', didi:'DiDi', rappi:'Rappi', resv:'Reservándonos'};
const PCORTE = {didi:'Didi', uber:'Uber', rappi:'Rappi', resv:'Reservandonos'};
const PCOLOR = {Uber:'var(--uber)', DiDi:'var(--didi)', Rappi:'var(--rappi)', 'Reservándonos':'var(--resv)'};
const EN_EXCEL = p => p !== 'Reservándonos';

let dict = Object.assign({}, DEFAULT_DICT, store.get('bees.dict', {}));
let texto = '', plataformaHint = '', metodo = '';
let order = null, resumen = null, estadoConf = 'vacio';   // vacio | pedido | resumen | registrado
let ultimoMsg = '', viewDay = hoy(), filtro = '', abierta = null, porQuitar = null, conTodos = false;
const vistos = new Set();

/* ---------- base compartida ---------- */
const SB_URL = 'https://iwjhmdeffwhqxmcivfso.supabase.co/rest/v1/';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3amhtZGVmZndocXhtY2l2ZnNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjE0MTUsImV4cCI6MjEwOTYzNzQxNX0.b36fWyQxjLwukD8FWis7ef-uynLBoO_tYWTKubaJQbM';
let clave = store.get('bees.clave', '');
const SYNC = () => !!clave;
const remoto = {}, remotoRes = {};
let syncInfo = {ok:null, txt:''};
const cola = () => store.get('bees.cola', []);
const setCola = c => store.set('bees.cola', c);
const colaRes = () => store.get('bees.colaRes', []);
const setColaRes = c => store.set('bees.colaRes', c);
const logKey = d => 'bees.log.' + d;

async function sb(method, tabla, query, body, prefer, conClave){
  return fetch(SB_URL + tabla + query, {method, headers:{apikey:SB_KEY, Authorization:'Bearer '+SB_KEY, 'x-bees-clave': conClave ?? clave,
    'Content-Type':'application/json', Prefer: prefer || 'return=minimal'}, body: body ? JSON.stringify(body) : undefined});
}
function filaAEntrada(r){
  return {id:r.id, dia:r.dia, platform:PNAME[r.plat]||r.plat, number:r.code, client:r.cust||'', created:r.created_at,
    time: r.created_at && isoDia(new Date(r.created_at)) === r.dia ? hhmm(r.created_at) : '',
    items:r.items||[], lines:r.lineas||[], total:r.total, totalNote:r.total_nota||'', sum:r.suma,
    notes: r.nota ? [r.nota] : [], pendiente:false};
}
function entradaAFila(e){
  const f = {id:e.id, dia:e.dia, plat:PKEY[e.platform], code:e.number, cust:e.client||null, items:e.items, lineas:e.lines,
    total:e.total, total_nota:e.totalNote||null, suma:e.sum, nota:(e.notes||[]).join(' · ')||null,
    tableta:e.platform||null, texto:e.texto||null, created_at:e.created};
  if (!f.created_at) delete f.created_at;
  return f;
}
function getLog(day = viewDay){
  if (!SYNC()) return store.get(logKey(day), []);
  const base = (remoto[day] || []).map(filaAEntrada);
  const ids = new Set(base.map(e => e.id));
  cola().filter(e => e.dia === day && !ids.has(e.id)).forEach(e => base.push({...e, pendiente:true}));
  return base.sort((a,b) => String(a.created).localeCompare(String(b.created)));
}
function getResumenes(day = viewDay){
  const base = SYNC() ? (remotoRes[day] || []).slice() : Object.values(store.get('bees.resumen.'+day, {}));
  if (SYNC()) colaRes().filter(r => r.dia === day).forEach(r => { const i = base.findIndex(x => x.id === r.id); if (i >= 0) base[i] = {...r, pendiente:true}; else base.push({...r, pendiente:true}); });
  return base;
}
async function refrescar(day = viewDay){
  if (!SYNC()) { pintarSync(); return; }
  try {
    const r = await sb('GET', 'delivery_pedidos', '?select=*&code=neq.prueba&dia=eq.'+day+'&order=created_at.asc');
    if (!r.ok) throw new Error('HTTP');
    remoto[day] = await r.json();
    const rr = await sb('GET', 'delivery_resumen', '?select=*&dia=eq.'+day);
    if (rr.ok) remotoRes[day] = await rr.json();
    syncInfo = {ok:true, txt:'Actualizado ' + hhmm(Date.now())};
  } catch(e) { syncInfo = {ok:false, txt:'Sin conexión: se guarda aquí y se sube después'}; }
  pintarSync();
}
let subiendo = false;
async function subirCola(){
  if (!SYNC() || subiendo) return;
  subiendo = true;
  const yaEstaban = [];
  try {
    for (const rs of colaRes()) {
      try { const r = await sb('POST', 'delivery_resumen', '', rs, 'resolution=merge-duplicates,return=minimal'); if (r.ok) setColaRes(colaRes().filter(x => x.id !== rs.id)); else break; }
      catch(err) { break; }
    }
    for (const e of cola()) {
      let r;
      try { r = await sb('POST', 'delivery_pedidos', '', entradaAFila(e)); } catch(err) { syncInfo = {ok:false, txt:'Sin conexión: se guarda aquí y se sube después'}; break; }
      if (r.ok || r.status === 409) { if (r.status === 409) yaEstaban.push(e); setCola(cola().filter(x => x.id !== e.id)); }
      else if (r.status === 401 || r.status === 403) { syncInfo = {ok:false, txt:'La clave no es correcta'}; break; }
      else { syncInfo = {ok:false, txt:'La base respondió ' + r.status + '; se reintenta después'}; break; }
    }
  } finally { subiendo = false; }
  if (yaEstaban.length) aviso('El pedido #' + yaEstaban.map(e => e.number).join(', #') + ' ya lo había registrado otra tableta.', true);
  await refrescar(viewDay);
  pintarTodo();
}
function pintarSync(){
  const el = $('sync'), pend = cola().length + colaRes().length;
  if (!clave) { el.className = 'sync warn'; $('syncTxt').textContent = 'Falta la clave'; }
  else if (syncInfo.ok === false) { el.className = 'sync off'; $('syncTxt').textContent = 'Sin conexión' + (pend ? ' · ' + pend + ' por subir' : ''); }
  else { el.className = 'sync'; $('syncTxt').textContent = 'Tabletas sincronizadas' + (pend ? ' · ' + pend + ' por subir' : ''); }
  pintarAjustes();
}

/* ---------- avisos ---------- */
let tAviso = null;
function aviso(t, malo){
  const el = $('toast'); el.textContent = t; el.className = 'toast' + (malo ? ' bad' : ''); el.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => el.hidden = true, 3200);
}

/* ---------- navegación ---------- */
function ir(v){
  document.querySelectorAll('.vista').forEach(s => s.hidden = s.id !== v);
  document.querySelectorAll('.dock button').forEach(b => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  window.scrollTo({top:0});
  if (v !== 'vConfirmar' && SYNC()) refrescar(viewDay).then(pintarTodo);
  pintarTodo();
}
document.querySelectorAll('.dock button').forEach(b => b.onclick = () => ir(b.dataset.v));

/* ---------- Confirmar ---------- */
const dayOf = () => (order && order.date) || hoy();
const idDe = (dia, platform, number) => dia + '|' + PKEY[platform] + '|' + String(number).trim();
function saveDict(){ const c = {}; for (const k in dict) if (JSON.stringify(dict[k]) !== JSON.stringify(DEFAULT_DICT[k])) c[k] = dict[k]; store.set('bees.dict', c); }
function selector(key){
  let h = `<select data-learn="${esc(key)}" aria-label="Producto del Excel"><option value="">¿A qué producto corresponde?</option>`;
  for (const c of CATALOG) h += `<optgroup label="${c.cat}">` + c.names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') + '</optgroup>';
  return h + '<optgroup label="Otro"><option value="__incluido">Viene incluido, no cuenta</option><option value="__ignorar">Ignorar</option></optgroup></select>';
}
function leer(){
  resumen = parseResumen(texto, plataformaHint);
  if (resumen) { order = null; estadoConf = 'resumen'; return; }
  const prev = order;
  order = parseOrder(texto, plataformaHint, dict);
  if (prev && prev._keep) { order.platform = prev.platform || order.platform; order.number = prev.number || order.number; }
  estadoConf = 'pedido';
}
function pintarConfirmar(){
  const el = $('vConfirmar');
  if (estadoConf === 'registrado') { el.innerHTML = pantallaExito(); enlazarExito(); return; }
  if (estadoConf === 'resumen' && resumen) { el.innerHTML = pantallaResumen(); enlazarResumen(); return; }
  if (estadoConf === 'pedido' && order) { el.innerHTML = pantallaPedido(); enlazarPedido(); return; }
  el.innerHTML = pantallaVacia();
  const b = $('irAj'); if (b) b.onclick = abrirAjustes;
}
function pantallaVacia(){
  let est = {}; try { est = APP ? JSON.parse(window.Android.estado()) : {lectura:true}; } catch(e) {}
  const listo = !!est.lectura, conClave = !!clave;
  const log = getLog(hoy()), ult = log[log.length-1];
  let h = `<div class="vacio">
    <div class="big hex late" aria-hidden="true"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#3a2c00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2"></path><path d="M8 12h8"></path></svg></div>
    <h2>${listo && conClave ? 'Abre un pedido y toca el hexágono amarillo' : 'Falta poco para empezar'}</h2>
    <p>${listo && conClave ? 'Funciona encima de Uber, DiDi, Rappi y Reservándonos. Al cierre, captura también el resumen de ventas de cada app.' : 'Completa estos pasos una sola vez en esta tableta.'}</p>`;
  if (!listo || !conClave) {
    h += `<div class="pasos">
      <div class="paso ${listo?'ok':'falta'}"><b>1. Activar el botón Capturar</b><span class="hint">${listo ? 'Listo.' : 'Se activa en Accesibilidad.'}</span></div>
      <div class="paso ${conClave?'ok':'falta'}"><b>2. Poner la clave de la sucursal</b><span class="hint">${conClave ? 'Listo: comparte con las otras tabletas.' : 'Para juntar las 4 tabletas.'}</span></div>
    </div><button class="btn dark" id="irAj" type="button">Abrir ajustes</button>`;
  }
  if (ult) h += `<div class="card" style="width:100%;max-width:640px;text-align:left;display:flex;gap:14px;align-items:center;border-left:6px solid ${PCOLOR[ult.platform]}">
      <div style="flex:1;min-width:0"><div class="eyebrow">Último registrado · ${esc(ult.time||'')}</div><div style="font-weight:700;font-size:18px">${esc(ult.platform)} #${esc(ult.number)}</div><div class="hint">${(ult.lines||[]).map(l=>esc(l.excel)).join(' · ')}</div></div>
      <div style="font-weight:800;font-size:20px">${dinero(ult.total)}</div></div>`;
  return h + '</div>';
}
function cabeceraPed(){
  const color = PCOLOR[order.platform] || 'var(--muted)';
  const plat = order.platform ? `<span class="plat" style="background:${color}">${esc(order.platform)}</span>`
    : `<select id="oPlat" aria-label="Plataforma"><option value="">¿De qué app es?</option>${PLATS.map(p=>`<option>${p}</option>`).join('')}</select>`;
  const num = order.number ? `<div class="ped-num num">#${esc(order.number)}</div>` : `<div class="ped-num"><input id="oNum" placeholder="# de pedido" aria-label="Número de pedido"></div>`;
  return `${plat}${num}`;
}
function pantallaPedido(){
  const xl = excelLines(order), day = dayOf();
  const dup = !!(order.platform && order.number) && getLog(day).some(o => o.id === idDe(day, order.platform, order.number));
  const ex = EN_EXCEL(order.platform);
  let al = '';
  for (const a of order.alerts) al += `<div class="banner bad">${esc(a)}</div>`;
  if (dup) al += `<div class="banner bad">Este pedido ya está registrado${SYNC() ? ' (puede ser de otra tableta)' : ''}.</div>`;
  if (order.mixedNumbers) al += '<div class="banner bad">Las capturas son de pedidos distintos. Captura un pedido a la vez.</div>';
  if (order.numDudoso) al += '<div class="banner warn">En la pantalla se ven varios números de pedido. Revisa que sea el del pedido abierto.</div>';
  if (order.expected && order.readQty < order.expected) al += `<div class="banner warn">El pedido dice ${order.expected} productos y se leyeron ${order.readQty}. Vuelve a capturar con todo el pedido a la vista.</div>`;
  else if (order.expected && order.readQty > order.expected) al += `<div class="banner warn">Se leyeron ${order.readQty} productos y el pedido dice ${order.expected}. Revisa antes de registrar.</div>`;
  if (xl.pending) al += `<div class="banner warn">Hay ${xl.pending} producto${xl.pending>1?'s':''} que la app no conoce. Elige a cuál corresponde y lo recordará.</div>`;

  const filas = order.products.map(p => {
    const m = p.map, combo = m && COMBO_NAMES.has(m.excel);
    const nuevo = !m, nocuenta = m && (m.tipo === 'incluido' || m.tipo === 'ignorar');
    let nombre = m ? (m.tipo === 'segun-opcion' ? 'Bee Water ' + (p.mods.find(md => md.map && md.map.sabor)?.map.excel.replace(/^Bee Water \(|\)$/g,'') || '') : (m.excel || p.name)) : p.name;
    const sub = [p.name !== nombre ? 'Leído: ' + p.name : '', p.price != null ? dinero(p.price) : ''].filter(Boolean).join(' · ');
    const piezas = combo ? (COMBO_FIJO[m.excel]||[]).concat(p.mods.filter(md => md.map && md.map.tipo !== 'incluido' && md.map.tipo !== 'ignorar' && !(COMBO_FIJO[m.excel]||[]).includes(md.map.excel)).map(md => md.map.excel)) : [];
    const mods = !combo ? p.mods.filter(md => !(m && m.tipo === 'segun-opcion' && md.map && md.map.sabor)) : p.mods.filter(md => !md.map);
    const modsTxt = mods.map(md => md.map ? (modStatus(md,p) === 'incluido' ? md.name + ' (incluido)' : '+ ' + md.map.excel) : md.name).join(' · ');
    return `<li class="item ${combo?'combo':''} ${nuevo?'nuevo':''} ${nocuenta?'nocuenta':''}">
      <div class="q hex num" aria-label="Cantidad">${p.qty}</div>
      <div style="min-width:0">
        <div class="nom">${esc(nombre)}${combo ? ' <span class="chip" style="background:var(--honey-ink);color:var(--honey);font-size:12px;padding:3px 8px">COMBO</span>' : ''}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
        ${modsTxt ? `<div class="sub">${esc(modsTxt)}</div>` : ''}
        ${piezas.length ? `<div class="piezas">${piezas.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        ${p.notes.map(n => `<div class="nota">Comentario: ${esc(n)}</div>`).join('')}
        ${nuevo ? selector(norm(p.name)) : ''}
        ${p.mods.filter(md => !md.map).map(md => `<div class="sub" style="margin-top:6px">Opción nueva: <b>${esc(md.name)}</b></div>${selector(norm(md.name))}`).join('')}
      </div>
      <div class="der">${nuevo ? '<span class="chip warn">Nuevo</span>' : nocuenta ? 'No cuenta' : ex ? '<b>✓ Excel</b>' : '<b>✓ Registro</b>'}</div>
    </li>`;
  }).join('');
  const can = order.platform && order.number && !xl.pending && !dup && order.products.length && !order.mixedNumbers;
  const sinR = xl.sinRenglon && xl.sinRenglon.length ? `<p class="hint" style="margin:0">Sin renglón en el formato (no se marca): ${xl.sinRenglon.map(l => esc(l.excel)).join(', ')}</p>` : '';
  const marcas = ex ? (xl.lines.length ? `<div class="marcas">${xl.lines.map(l => `<span>${l.qty>1?l.qty+' ':''}${esc(l.excel)}</span>`).join('')}</div>${sinR}` : (xl.pending ? '<p class="hint" style="margin:0">Elige los productos nuevos para ver qué se marca.</p>' : sinR || '<p class="hint" style="margin:0">Nada que marcar.</p>'))
    : '<p class="hint" style="margin:0">Reservándonos no va en el Excel: se guarda en el registro del día y en el corte, sin comisión.</p>';
  return `<div class="conf">
    <section class="card pedido entra">
      ${al}
      <div class="ped-head">${cabeceraPed()}<div style="flex:1"></div>${order.expected ? `<span class="chip ${order.readQty===order.expected?'ok':'warn'}">${order.readQty} de ${order.expected} productos${order.readQty===order.expected?' ✓':''}</span>` : ''}</div>
      <div class="meta">${order.client ? `<span>Cliente <b>${esc(order.client)}</b></span>` : ''}<span>Día <b>${esc(nombreDia(day))}</b></span>${metodo ? `<span>Leído de la <b>${metodo === 'imagen' ? 'imagen' : 'pantalla'}</b></span>` : ''}${order.captures > 1 ? `<span><b>${order.captures}</b> pantallas unidas</span>` : ''}</div>
      ${order.orderNotes.length ? `<div class="nota">Nota del pedido: ${esc(order.orderNotes.join(' · '))}</div>` : ''}
      <ul class="items">${filas || '<li class="empty">No se encontraron productos en la pantalla. Vuelve a capturar con el pedido abierto.</li>'}</ul>
    </section>
    <aside class="lado">
      <div class="dark entra2"><div class="eyebrow">Total${order.totalNote ? ' · ' + esc(order.totalNote) : ''}</div><div class="monto num">${dinero(order.total)}</div><div class="hint" style="color:#cfc6b1">Suma de productos ${dinero(order.sum)}</div></div>
      <div class="card entra3" style="display:grid;gap:10px"><div class="eyebrow">${ex ? 'En el Excel se marca' : 'Registro del día'}</div>${marcas}</div>
      <button class="btn primary ${can?'pulso':''}" id="btnReg" type="button" ${can?'':'disabled'}>${dup ? 'Ya registrado' : 'Registrar pedido'}</button>
      ${APP ? `<button class="btn ghost" id="btnVolver" type="button">Volver${order.platform ? ' a ' + esc(order.platform) : ''}</button>` : ''}
    </aside>
  </div>`;
}
function enlazarPedido(){
  const op = $('oPlat'); if (op) op.onchange = e => { order.platform = e.target.value; order._keep = true; pintarConfirmar(); };
  const on = $('oNum'); if (on) on.onchange = e => { order.number = e.target.value.replace(/^#/,'').trim(); order._keep = true; pintarConfirmar(); };
  document.querySelectorAll('select[data-learn]').forEach(s => s.onchange = e => {
    const v = e.target.value; if (!v) return;
    dict[e.target.dataset.learn] = v === '__incluido' ? {excel:'', tipo:'incluido'} : v === '__ignorar' ? {excel:'', tipo:'ignorar'} : {excel:v, tipo: EXTRA_NAMES.has(v) ? 'extra' : 'producto'};
    saveDict(); order._keep = true; const keep = order; leer(); order.platform = keep.platform || order.platform; order.number = keep.number || order.number; pintarConfirmar(); pintarAjustes();
  });
  $('btnReg').onclick = registrar;
  const bv = $('btnVolver'); if (bv) bv.onclick = () => window.Android.volver();
}
function registrar(){
  const xl = excelLines(order), day = dayOf(), id = idDe(day, order.platform, order.number);
  if (getLog(day).some(o => o.id === id)) { aviso('Este pedido ya está en el registro.', true); return; }
  const now = new Date();
  const e = {id, dia:day, platform:order.platform, number:order.number, client:order.client||'', created:now.toISOString(),
    time: day === hoy() ? hhmm(now) : '', items:xl.items, lines:xl.lines.map(l => ({excel:l.excel, qty:l.qty})),
    total:order.total, totalNote:order.totalNote, sum:order.sum,
    notes:[...order.orderNotes, ...order.products.flatMap(p => p.notes), ...order.alerts], texto: texto.slice(0, 8000)};
  if (!EN_EXCEL(order.platform)) e.lines = xl.items.map(i => ({excel:i.n, qty:i.qty}));
  if (SYNC()) { setCola([...cola(), e]); subirCola(); }
  else { const log = store.get(logKey(day), []); log.push(e); store.set(logKey(day), log); }
  ultimoMsg = `${order.platform} #${order.number} registrado` + (EN_EXCEL(order.platform) ? ` · ${pl(xl.lines.reduce((a,l)=>a+l.qty,0),'marca')} en el Excel` : '');
  if (APP && window.Android.registrado) { try { window.Android.registrado(ultimoMsg); } catch(err) {} }
  viewDay = day; estadoConf = 'registrado';
  pintarTodo();
  // Regresa solo a la app de pedidos; el botón hexagonal se pone verde allá
  clearTimeout(timerVolver);
  if (APP && window.Android.volver) timerVolver = setTimeout(() => { if (estadoConf !== 'registrado') return; estadoConf = 'vacio'; pintarConfirmar(); window.Android.volver(); }, 1200);
}
let timerVolver = null;
function pantallaExito(){
  return `<div class="exito">
    <div class="check hex" aria-hidden="true"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg></div>
    <h2>¡Registrado!</h2><p class="hint" style="font-size:17px;margin:0">${esc(ultimoMsg)}</p>${APP ? '<p class="hint" style="margin:0">Regresando a la app de pedidos…</p>' : ''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      ${APP ? '<button class="btn primary" id="exVolver" type="button" style="font-size:20px;padding:18px 28px">Volver a la app de pedidos</button>' : ''}
      <button class="btn ghost" id="exVer" type="button">Ver registro del día</button>
    </div></div>`;
}
function enlazarExito(){
  const v = $('exVolver'); if (v) v.onclick = () => { clearTimeout(timerVolver); estadoConf = 'vacio'; pintarConfirmar(); window.Android.volver(); };
  $('exVer').onclick = () => { clearTimeout(timerVolver); estadoConf = 'vacio'; ir('vRegistro'); };
}

/* ---------- Resumen de ventas ---------- */
function comparar(r){
  const regs = getLog(r.dia).filter(o => o.platform === PNAME[r.plat]);
  const cods = new Set(regs.map(o => String(o.number).toUpperCase().replace(/^#/,'')));
  const lista = (r.lista||[]).filter(x => !/cancel/i.test(x.estado||''));
  return {capturados: regs.length, cods, faltan: lista.filter(x => !cods.has(String(x.code).toUpperCase())), completa: r.pedidos == null || lista.length >= r.pedidos};
}
const lineaCorte = (p, total) => p === 'resv' ? `Reservandonos: ${dinero(total)}` : `${PCORTE[p]}: ${dinero(total)} -${COMISION[p]}%=${dinero(neto(p, total))}`;
function pantallaResumen(){
  const r = resumen; r.dia = r.dia || hoy();
  const c = comparar(r), nom = PNAME[r.plat];
  const ya = getResumenes(r.dia).find(x => x.id === r.dia + '|' + r.plat);
  const cuadra = r.pedidos != null && c.capturados === r.pedidos;
  const ex = r.extra || {}, nombres = {total_acumulado:'Total acumulado', descuento_restaurante:'Descuento restaurante', total_restaurante:'Total restaurante', descuento_rappi:'Descuento Rappi', ventas_sin_descuentos:'Ventas sin descuentos'};
  const lista = (r.lista||[]).length ? `<div class="tw"><table><thead><tr><th>Pedido</th><th>Hora</th><th class="n">Monto</th><th>Estado</th><th>Capturado</th></tr></thead><tbody>${r.lista.map(x =>
      `<tr><td>#${esc(x.code)}${x.cliente ? `<div class="hint">${esc(x.cliente)}</div>` : ''}</td><td>${esc(x.hora||'')}</td><td class="n">${x.monto != null ? dinero(x.monto) : ''}</td><td>${esc(x.estado||'')}</td><td>${c.cods.has(String(x.code).toUpperCase()) ? '<span class="chip ok">Sí</span>' : /cancel/i.test(x.estado||'') ? '<span class="chip">Cancelado</span>' : '<span class="chip bad">Falta</span>'}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="conf">
    <section class="card pedido entra">
      <div class="ped-head"><span class="plat" style="background:${PCOLOR[nom]}">${esc(nom)}</span><div class="ped-num">Resumen del día</div><div style="flex:1"></div>${ya ? '<span class="chip">Ya guardado: se reemplaza</span>' : ''}</div>
      <div class="meta"><span>Día <b>${esc(nombreDia(r.dia))}</b></span><span>Para el corte: <b>${esc(r.totalNota)}</b></span></div>
      ${r.pedidos != null ? (cuadra ? '<div class="banner ok">Cuadra: todos los pedidos de la app están capturados.</div>'
        : `<div class="banner warn">${esc(nom)} dice ${r.pedidos} pedidos y hay ${c.capturados} capturados.${c.faltan.length ? ' Falta: ' + c.faltan.map(x => '#' + esc(x.code) + (x.hora ? ' (' + x.hora + ')' : '')).join(', ') + '.' : ''}</div>`) : ''}
      <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0">
        <div class="stat" style="--c:${PCOLOR[nom]}"><span class="eyebrow">Pedidos según la app</span><b class="num">${r.pedidos ?? '—'}</b>${r.cancelados ? `<span class="hint">${r.cancelados} cancelados</span>` : ''}</div>
        <div class="stat" style="--c:${PCOLOR[nom]}"><span class="eyebrow">Capturados</span><b class="num">${c.capturados}</b></div>
        <div class="stat" style="--c:${PCOLOR[nom]}"><span class="eyebrow">${r.plat === 'resv' ? 'Sin comisión' : 'Después de comisión'}</span><b class="num" style="font-size:26px">${dinero(neto(r.plat, r.total))}</b></div>
      </div>
      ${Object.keys(ex).filter(k => nombres[k]).length ? `<p class="hint" style="margin:0">${Object.keys(ex).filter(k => nombres[k]).map(k => nombres[k] + ': ' + dinero(ex[k])).join(' · ')}</p>` : ''}
      ${lista}
      ${!c.completa && (r.lista||[]).length ? `<p class="hint" style="margin:0">La pantalla muestra ${r.lista.length} de ${r.pedidos} pedidos; para revisarlos uno por uno, captura con la lista completa.</p>` : ''}
    </section>
    <aside class="lado">
      <div class="dark entra2"><div class="eyebrow">Para el corte · ${esc(r.totalNota)}</div><div class="monto num">${dinero(r.total)}</div><div class="hint" style="color:#cfc6b1;font-family:ui-monospace,Menlo,monospace">${esc(lineaCorte(r.plat, r.total))}</div></div>
      <button class="btn primary pulso" id="btnRes" type="button" ${r.total == null ? 'disabled' : ''}>Guardar resumen</button>
      ${APP ? `<button class="btn ghost" id="btnVolverR" type="button">Volver a ${esc(nom)}</button>` : ''}
    </aside></div>`;
}
function enlazarResumen(){
  $('btnRes').onclick = () => {
    const r = resumen;
    const rec = {id: r.dia + '|' + r.plat, dia:r.dia, plat:r.plat, pedidos:r.pedidos, cancelados:r.cancelados, total:r.total, total_nota:r.totalNota,
      lista:r.lista, extra:r.extra, texto:texto.slice(0, 8000), updated_at:new Date().toISOString()};
    if (SYNC()) { setColaRes([...colaRes().filter(x => x.id !== rec.id), rec]); subirCola(); }
    else { const m = store.get('bees.resumen.' + r.dia, {}); m[r.plat] = rec; store.set('bees.resumen.' + r.dia, m); }
    ultimoMsg = `Resumen de ${PNAME[r.plat]} guardado · ${lineaCorte(r.plat, r.total)}`;
    if (APP && window.Android.registrado) { try { window.Android.registrado(ultimoMsg); } catch(err) {} }
    viewDay = r.dia; estadoConf = 'registrado'; pintarTodo();
  };
  const bv = $('btnVolverR'); if (bv) bv.onclick = () => window.Android.volver();
}

/* ---------- selector de día (Registro y Excel) ---------- */
function barraDia(titulo){
  return `<div class="dia"><h2>${titulo}</h2><div class="nav"><button type="button" data-d="-1" aria-label="Día anterior">◀</button><span>${viewDay === hoy() ? 'Hoy · ' : ''}${esc(nombreDia(viewDay))}</span><button type="button" data-d="1" aria-label="Día siguiente">▶</button></div>${viewDay !== hoy() ? '<button class="btn small ghost" type="button" data-d="0">Hoy</button>' : ''}</div>`;
}
function enlazarDia(root){
  root.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    const d = +b.dataset.d; viewDay = d === 0 ? hoy() : masDias(viewDay, d); abierta = null;
    pintarTodo(); await refrescar(viewDay); pintarTodo();
  });
}

/* ---------- Registro del día ---------- */
function pintarRegistro(){
  const el = $('vRegistro'); const log = getLog();
  const ped = {}, venta = {}; PLATS.forEach(p => { ped[p] = 0; venta[p] = 0; });
  log.forEach(o => { if (o.platform in ped) { ped[o.platform]++; venta[o.platform] += Number(o.total)||0; } });
  const tot = log.length;
  let h = barraDia('Registro del día');
  h += `<div class="stats"><div class="stat total"><span class="eyebrow">Pedidos</span><b class="num">${tot}</b><span class="hint" style="color:#cfc6b1">en las 4 tabletas</span></div>` +
    PLATS.map(p => `<div class="stat" style="--c:${PCOLOR[p]}"><span class="eyebrow">${p}</span><b class="num">${ped[p]}</b><span class="hint">${dinero(venta[p])}</span></div>`).join('') + '</div>';
  h += `<div class="filtros">${[['','Todas'], ...PLATS.map(p => [p,p])].map(([k,n]) => `<button type="button" data-f="${esc(k)}" aria-pressed="${filtro===k}">${n}</button>`).join('')}</div>`;
  const lista = log.filter(o => !filtro || o.platform === filtro).slice().reverse();
  h += lista.length ? '<ul class="lista">' + lista.map(o => {
    const nueva = !vistos.has(o.id) && vistos.size > 0; vistos.add(o.id);
    const det = abierta === o.id ? `<div class="det">${(o.notes||[]).length ? `<span class="nota">${esc(o.notes.join(' · '))}</span>` : ''}${o.pendiente ? '<span class="chip warn">Por subir</span>' : ''}<div style="flex:1"></div><button class="btn small ${porQuitar===o.id?'dark':'ghost'}" type="button" data-q="${esc(o.id)}">${porQuitar===o.id ? '¿Seguro? Toca otra vez para quitar' : 'Quitar del registro'}</button></div>` : '';
    return `<li class="fila ${nueva?'nueva':''}" style="--c:${PCOLOR[o.platform]||'var(--muted)'}"><button type="button" data-o="${esc(o.id)}" aria-expanded="${abierta===o.id}">
      <span class="hr num">${esc(o.time || '—')}</span>
      <span><span class="pl">${esc(o.platform)}</span><span class="id" style="display:block">#${esc(o.number)}${o.client ? ' · ' + esc(o.client) : ''}</span></span>
      <span class="prods">${(o.lines||[]).map(l => (l.qty>1?l.qty+' ':'') + esc(l.excel)).join(' · ') || '<span class="hint">Sin productos</span>'}</span>
      <span class="tt num">${dinero(o.total)}${o.totalNote ? `<small>${esc(o.totalNote)}</small>` : ''}</span>
    </button>${det}</li>`;
  }).join('') + '</ul>' : `<div class="empty">Sin pedidos ${filtro ? 'de ' + esc(filtro) + ' ' : ''}${viewDay === hoy() ? 'todavía hoy' : 'ese día'}. Aquí aparece lo que registre cualquiera de las tabletas.</div>`;
  el.innerHTML = h;
  enlazarDia(el);
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; pintarRegistro(); });
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { abierta = abierta === b.dataset.o ? null : b.dataset.o; porQuitar = null; pintarRegistro(); });
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { if (porQuitar !== b.dataset.q) { porQuitar = b.dataset.q; pintarRegistro(); } else quitar(b.dataset.q); });
}
async function quitar(id){
  porQuitar = null;
  if (SYNC()) { setCola(cola().filter(e => e.id !== id)); try { await sb('DELETE', 'delivery_pedidos', '?id=eq.' + encodeURIComponent(id)); } catch(e) {} await refrescar(viewDay); }
  else store.set(logKey(viewDay), store.get(logKey(viewDay), []).filter(e => e.id !== id));
  aviso('Pedido quitado del registro.'); pintarTodo();
}

/* ---------- Excel y corte ---------- */
const CATS = [['Pizzas',6,19],['Combos / promos',20,29],['Complementos',30,38],['Postres',39,41],['Bebidas',42,60],['Dips / aderezos',61,67]];
const PL3 = ['Uber','DiDi','Rappi'];
function textoCorte(){
  const res = getResumenes(), de = p => res.find(r => r.plat === p);
  let tot = 0;
  const l = ['didi','uber','rappi','resv'].map(p => { const v = de(p) ? Number(de(p).total)||0 : 0; tot += neto(p, v); return lineaCorte(p, v); });
  return l.join('\n') + '\n\nDelivery neto: ' + dinero(tot);
}
function pintarExcel(){
  const el = $('vExcel'); const log = getLog(), res = getResumenes();
  // Corte
  let corte = '<div class="tw"><table><thead><tr><th>App</th><th class="n">Capturados</th><th class="n">Venta</th><th class="n">Neto</th></tr></thead><tbody>', tot = 0;
  for (const p of ['didi','uber','rappi','resv']) {
    const r = res.find(x => x.plat === p), capt = log.filter(o => o.platform === PNAME[p]).length;
    if (r) tot += neto(p, r.total);
    const c = r ? comparar(r) : null;
    const av = r && r.pedidos != null && capt !== r.pedidos ? `<div class="hint" style="color:var(--warn);font-weight:600">${capt < r.pedidos ? 'Faltan ' + (r.pedidos - capt) : 'Sobran ' + (capt - r.pedidos)}${c.faltan.length ? ': #' + c.faltan.map(x => esc(x.code)).join(', #') : ''}</div>` : '';
    corte += `<tr><td><b style="color:${PCOLOR[PNAME[p]]}">${PNAME[p]}</b>${r ? (r.pendiente ? ' <span class="chip warn">Por subir</span>' : '') : '<div class="hint">sin resumen</div>'}</td><td class="n">${capt}${r && r.pedidos != null ? ' de ' + r.pedidos : ''}${av}</td><td class="n">${r ? dinero(r.total) : '—'}</td><td class="n">${r ? dinero(neto(p, r.total)) : '—'}</td></tr>`;
  }
  corte += `<tr class="tot"><td colspan="3">Delivery neto</td><td class="n">${dinero(tot)}</td></tr></tbody></table></div><pre class="corte">${esc(textoCorte())}</pre>`;
  // Concentrado (solo Uber, DiDi y Rappi: lo que lleva el Excel)
  const tabla = new Map(); let marcas = 0;
  log.filter(o => PL3.includes(o.platform)).forEach(o => (o.lines||[]).forEach(l => { const t = tabla.get(l.excel) || {Uber:0,DiDi:0,Rappi:0}; t[o.platform] += l.qty; tabla.set(l.excel, t); marcas += l.qty; }));
  const suma = t => t.Uber + t.DiDi + t.Rappi;
  let con = '';
  if (!marcas && !conTodos) con = `<div class="empty">Sin productos de Uber, DiDi o Rappi ${viewDay === hoy() ? 'todavía hoy' : 'ese día'}.</div>`;
  else {
    con = '<div class="tw"><table><thead><tr><th>Producto</th>' + PL3.map(p => `<th class="n">${p}</th>`).join('') + '<th class="n">Total</th></tr></thead><tbody>';
    for (const [cat,a,b] of CATS) {
      const fs = RENGLONES.slice(a-6, b-5).map(n => [n, tabla.get(n) || {Uber:0,DiDi:0,Rappi:0}]).filter(([,t]) => conTodos || suma(t));
      if (!fs.length) continue;
      con += `<tr class="cat"><td colspan="5">${cat}</td></tr>` + fs.map(([n,t]) => `<tr><td>${esc(n)}</td>${PL3.map(p => `<td class="n${t[p]?'':' cero'}">${t[p]}</td>`).join('')}<td class="n">${suma(t)}</td></tr>`).join('');
    }
    con += '<tr class="tot"><td>Total</td>' + PL3.map(p => { let s = 0; tabla.forEach(t => s += t[p]); return `<td class="n">${s}</td>`; }).join('') + `<td class="n">${marcas}</td></tr></tbody></table></div>`;
  }
  el.innerHTML = barraDia('Excel y corte') + `<div class="dos">
    <section class="card"><div class="fila-tit"><h3>Corte</h3><div style="display:flex;gap:8px"><button class="btn small" type="button" id="cCopiar" style="background:var(--honey)">Copiar</button>${APP ? '<button class="btn small ghost" type="button" id="cCompartir">Compartir</button>' : ''}</div></div>
      ${res.length ? '' : '<p class="hint" style="margin-top:0">Al cierre, abre el resumen de ventas de cada app y toca el hexágono para llenar el corte.</p>'}${corte}</section>
    <section class="card"><div class="fila-tit"><h3>Concentrado del Excel</h3><label class="hint" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cTodos" ${conTodos?'checked':''} style="width:20px;height:20px;accent-color:var(--honey)"> Todos los productos</label></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><button class="btn primary" type="button" id="xDescargar" style="font-size:18px;padding:14px 20px">Descargar Excel del día</button><span class="hint" id="xMsg">${log.filter(o => PL3.includes(o.platform)).length} pedidos · ${pl(marcas,'marca')}</span></div>
      ${con}</section></div>`;
  enlazarDia(el);
  $('cTodos').onchange = e => { conTodos = e.target.checked; pintarExcel(); };
  $('cCopiar').onclick = () => copiar(textoCorte(), 'Corte copiado');
  const cc = $('cCompartir'); if (cc) cc.onclick = () => window.Android.compartir(textoCorte());
  $('xDescargar').onclick = descargarExcel;
}
function copiar(t, ok){
  if (APP) { try { window.Android.copiar(t); aviso(ok); } catch(e) { aviso('No se pudo copiar', true); } return; }
  try { navigator.clipboard.writeText(t).then(() => aviso(ok), () => aviso('No se pudo copiar', true)); } catch(e) { aviso('No se pudo copiar', true); }
}
function aBase64(bytes){ let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function descargarExcel(){
  const m = $('xMsg'); m.textContent = 'Armando el Excel…';
  try {
    if (SYNC()) { await subirCola(); await refrescar(viewDay); }
    const orders = getLog().filter(e => PL3.includes(e.platform)).map(e => ({plat:PKEY[e.platform], code:e.number, cust:e.client, items:e.items||[], status:'registrado',
      createdAt: e.created ? Date.parse(e.created) : Date.now(),
      note: [e.total != null ? 'Total ' + dinero(e.total) + (e.totalNote ? ' (' + e.totalNote + ')' : '') : '', ...(e.notes||[])].filter(Boolean).join(' · ')}));
    const {bytes, report} = await Registro.buildXlsx(JSZip, window.TEMPLATE_B64, orders, viewDay, {markParts:true, lateMin:10, fmt:hhmm});
    const nombre = 'REGISTRO_DELIVERY_' + viewDay + '.xlsx';
    let res;
    if (APP) res = window.Android.guardarExcel(nombre, aBase64(bytes));
    else { const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); res = 'Descargado: ' + nombre; }
    $('xMsg').textContent = (res || nombre) + ` · ${pl(report.total,'marca')}` + (report.missing.length ? ' · sin renglón: ' + report.missing.map(x => x.qty + ' ' + x.name).join(', ') : '');
    aviso('Excel listo');
  } catch(e) { $('xMsg').textContent = 'No se pudo armar el Excel: ' + (e && e.message || e); aviso('No se pudo armar el Excel', true); }
}

/* ---------- Ajustes ---------- */
function abrirAjustes(){ $('ajustes').hidden = false; pintarAjustes(); }
$('btnAjustes').onclick = abrirAjustes;
$('sync').onclick = abrirAjustes;
$('ajCerrar').onclick = () => { $('ajustes').hidden = true; pintarConfirmar(); };
$('ajustes').onclick = e => { if (e.target.id === 'ajustes') { $('ajustes').hidden = true; pintarConfirmar(); } };
function pintarAjustes(){
  let est = {}; try { est = APP ? JSON.parse(window.Android.estado()) : {}; } catch(e) {}
  const activo = !!est.lectura;
  $('ajBoton').textContent = APP ? (activo ? 'Activo' : 'Apagado') : 'Solo en la tableta';
  $('ajBoton').className = 'chip ' + (activo ? 'ok' : 'warn');
  $('ajBotonTxt').textContent = activo ? 'El hexágono está encima de las apps de pedidos. Puedes arrastrarlo a donde no estorbe.'
    : 'Abre Accesibilidad, entra a «Bee\'s Captura» y actívalo.' + ((est.android||0) >= 33 ? ' Si Android no te deja, toca «Permitir ajustes restringidos», luego los tres puntos de arriba y «Permitir ajustes restringidos».' : '');
  $('ajAcc').hidden = !APP || activo; $('ajInfo').hidden = !APP || activo || (est.android||0) < 33;
  $('ajSync').textContent = clave ? (syncInfo.ok === false ? 'Sin conexión' : 'Compartido') : 'Sin clave';
  $('ajSync').className = 'chip ' + (clave ? (syncInfo.ok === false ? 'bad' : 'ok') : 'warn');
  $('ajSyncTxt').textContent = clave ? (syncInfo.txt || 'Conectando…') + '. Lo que registra cualquier tableta aparece en todas.' : 'Escribe la clave para que esta tableta comparta sus pedidos con las demás.';
  const keys = Object.keys(dict).filter(k => JSON.stringify(dict[k]) !== JSON.stringify(DEFAULT_DICT[k])).sort();
  $('ajDict').innerHTML = keys.length ? '<div class="tw"><table><tbody>' + keys.map(k => { const d = dict[k];
    return `<tr><td>${esc(k)}</td><td>${esc(d.tipo === 'incluido' ? 'Incluido' : d.tipo === 'ignorar' ? 'Ignorar' : d.excel)}</td><td class="n"><button class="btn small ghost" type="button" data-olvidar="${esc(k)}">Olvidar</button></td></tr>`; }).join('') + '</tbody></table></div>' : '<p class="hint" style="margin:0">Todavía no hay.</p>';
  $('ajDict').querySelectorAll('[data-olvidar]').forEach(b => b.onclick = () => { delete dict[b.dataset.olvidar]; saveDict(); pintarAjustes(); });
  $('ajVersion').textContent = 'Versión ' + (est.version || 'web');
}
$('ajAcc').onclick = () => window.Android.abrirAccesibilidad();
$('ajInfo').onclick = () => window.Android.abrirInfoApp();
$('ajGuardarClave').onclick = async () => {
  const v = $('ajClave').value.trim().toUpperCase(); if (!v) return;
  $('ajSyncTxt').textContent = 'Revisando la clave…';
  try {
    const prueba = {id:'prueba|' + Date.now(), dia:hoy(), plat:'resv', code:'prueba', items:[]};
    const w = await sb('POST', 'delivery_pedidos', '', prueba, null, v);
    if (!w.ok) throw new Error();
    await sb('DELETE', 'delivery_pedidos', '?id=eq.' + encodeURIComponent(prueba.id), null, null, v);
    clave = v; store.set('bees.clave', v); $('ajClave').value = '';
    const locales = Object.keys(localStorage).filter(k => k.startsWith('bees.log.')).flatMap(k => store.get(k, []).filter(e => e.id && e.items));
    if (locales.length) setCola([...cola(), ...locales.filter(e => !cola().some(c => c.id === e.id))]);
    syncInfo = {ok:true, txt:'Clave guardada'}; aviso('Clave guardada: tabletas conectadas');
    await subirCola();
  } catch(e) { $('ajSyncTxt').textContent = 'Esa clave no funciona o no hay internet. Revisa y vuelve a intentar.'; }
  pintarAjustes(); pintarSync();
};

/* ---------- todo ---------- */
function pintarTodo(){
  pintarConfirmar();
  if (!$('vRegistro').hidden) pintarRegistro();
  if (!$('vExcel').hidden) pintarExcel();
  $('badgeHoy').textContent = getLog(hoy()).length;
  pintarSync();
}
function reloj(){ $('reloj').textContent = new Date().toLocaleTimeString('es-MX', {hour:'numeric', minute:'2-digit'}); }
setInterval(reloj, 15000); reloj();

// La tableta manda aquí lo que leyó de la pantalla
window.cargarCaptura = async (t, plataforma, met) => {
  texto = String(t || ''); plataformaHint = PLATS.includes(plataforma) ? plataforma : ''; metodo = met || '';
  order = null; resumen = null; leer();
  ir('vConfirmar');
  const d = resumen ? (resumen.dia || hoy()) : dayOf();
  if (SYNC()) { await refrescar(d); pintarConfirmar(); }
};
window.actualizarEstado = () => { pintarAjustes(); if (estadoConf === 'vacio') pintarConfirmar(); if (SYNC()) subirCola(); };

if (SYNC()) { refrescar(hoy()).then(() => { pintarTodo(); subirCola(); }); setInterval(() => { subirCola(); }, 60000); }
pintarTodo();
})();
