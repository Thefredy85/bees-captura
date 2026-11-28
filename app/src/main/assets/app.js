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
/* Líneas de las apps que NO son productos y alguien asignó a mano (p. ej. «Completado» → Tropical Bee Spicy): se olvidan */
const NO_PRODUCTO = /^(completado|ajuste de la cuota|cuota de servicio|oferta especial|subtotal|total|calificar|calificacion|obtener ayuda|cliente recurrente|\d+ pedidos|\d+$|(35|40) ?cm$|elige tu)/;
(() => { let n = 0; for (const k of Object.keys(dict)) if (!(k in DEFAULT_DICT) && NO_PRODUCTO.test(k)) { delete dict[k]; n++; } if (n) { try { saveDict(); } catch(e) {} } })();
let texto = '', plataformaHint = '', metodo = '';
let order = null, resumen = null, estadoConf = 'vacio';   // vacio | pedido | resumen | registrado
let detectado = false, autoOn = false, autoHasta = 0, registrandoAuto = false;   // pedido detectado en pantalla (pregunta) · registro automático (solo admin, 30 min)
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
    notes: r.nota ? [r.nota] : [], pendiente:false, tarde:!!r.tarde, por:r.por||'', corregido:r.corregido_por||''};
}
function entradaAFila(e){
  const f = {id:e.id, dia:e.dia, plat:PKEY[e.platform], code:e.number, cust:e.client||null, items:e.items, lineas:e.lines,
    total:e.total, total_nota:e.totalNote||null, suma:e.sum, nota:(e.notes||[]).join(' · ')||null,
    tableta:e.platform||null, texto:e.texto||null, created_at:e.created, origen:e.origen||null};
  if (e.tarde) { f.tarde = true; f.por = e.por || null; }
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
    const ra = await sb('GET', 'delivery_ajustes', '?select=valor&clave=eq.captura');
    if (ra.ok) { const a = await ra.json(); if (a[0]) ponerCapturaLocal(a[0].valor !== false); }
    const rf = await sb('GET', 'delivery_ajustes', '?select=valor&clave=eq.fotos_delivery');
    if (rf.ok) { const f = await rf.json(); if (f[0]) fotosOn = f[0].valor !== false; }
    const ru = await sb('GET', 'delivery_ajustes', '?select=valor&clave=eq.auto_registro');
    if (ru.ok) { const u = await ru.json(); if (u[0]) { const v = u[0].valor || {}; autoOn = !!v.activa && Date.parse(v.hasta) > Date.now(); autoHasta = autoOn ? Date.parse(v.hasta) : 0; avisarAuto(); } }
    if (day === hoy()) avisarRegistrados();
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
  if (v === 'vAnalitica') { cargarAnalitica(); return; }
  if (v !== 'vConfirmar' && SYNC()) refrescar(viewDay).then(pintarTodo);
  pintarTodo();
}
document.querySelectorAll('.dock button').forEach(b => b.onclick = () => ir(b.dataset.v));

/* ---------- Confirmar ---------- */
const dayOf = () => modoReg ? modoReg.dia : ((order && order.date) || hoy());
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
  const b = $('irAj'); if (b) b.onclick = abrirAjustesConClave;
  const ia = $('irApp'); if (ia) ia.onclick = () => { const t = window.Android.abrirApp ? window.Android.abrirApp() : ''; if (t) aviso(t, true); };
}
function pantallaVacia(){
  let est = {}; try { est = APP ? JSON.parse(window.Android.estado()) : {lectura:true}; } catch(e) {}
  const listo = !!est.lectura, conClave = !!clave;
  const log = getLog(hoy()), ult = log[log.length-1];
  if (!capturaOn) return `<div class="vacio">
    <div class="big hex" aria-hidden="true" style="background:var(--line)"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#6c6556" stroke-width="2.2" stroke-linecap="round"><path d="M9 6v12M15 6v12"></path></svg></div>
    <h2>La captura de pedidos está desactivada</h2>
    <p>Un supervisor la apagó para todas las tabletas. Los avisos de pedidos a Telegram siguen funcionando.</p></div>`;
  let h = `<div class="vacio">
    <div class="big hex late" aria-hidden="true"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#3a2c00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2"></path><path d="M8 12h8"></path></svg></div>
    <h2>${modoReg ? 'Abre el pedido del ' + esc(nombreDia(modoReg.dia)) + ' y toca el hexágono' : listo && conClave ? 'Abre un pedido y toca el hexágono amarillo' : 'Falta poco para empezar'}</h2>
    ${APP && est.plat && listo && conClave && !modoReg ? `<button class="btn primary" id="irApp" type="button" style="font-size:22px;padding:18px 34px;background:${PCOLOR[est.plat] || 'var(--honey)'};color:#fff">Ir a ${esc(est.plat)}</button>` : ''}
    <p>${modoReg ? 'Estás en modo registro: lo que captures se guarda en ese día, sin avisos a Telegram ni petición de foto.' : listo && conClave ? 'Funciona encima de Uber, DiDi, Rappi y Reservándonos. Al cierre, abre el historial de ventas de la app: se lee y se guarda solo para el corte.' : 'Completa estos pasos una sola vez en esta tableta.'}</p>`;
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
  const plat = order.platform ? `<span class="plat" style="background:${PCOLOR[order.platform]}">${esc(order.platform)}</span>`
    : `<select id="oPlat" aria-label="Plataforma"><option value="">¿De qué app es?</option>${PLATS.map(p=>`<option>${p}</option>`).join('')}</select>`;
  const num = order.number ? `<div class="ped-num num">#${esc(order.number)}</div>` : `<div class="ped-num"><input id="oNum" placeholder="# de pedido" aria-label="Número de pedido"></div>`;
  return `${plat}${num}`;
}
const firma = items => (items||[]).map(i => (i.qty||1) + '×' + norm(String(i.n||'')) + (i.orilla ? '+o' : '')).sort().join('|');
/** Duplicado = mismo día, plataforma, número, productos y total. Mismo número con otros productos = pedido aparte. */
function buscarDup(day){
  if (!order || !order.platform || !order.number) return {igual:null, otros:[]};
  const f = firma(excelLines(order).items), num = String(order.number).trim();
  const otros = getLog(day).filter(o => o.platform === order.platform && String(o.number).trim() === num);
  const igual = otros.find(o => firma(o.items) === f && (o.total == null || order.total == null || Math.abs(Number(o.total) - Number(order.total)) < 0.5)) || null;
  return {igual, otros};
}
const diaCorto = iso => { const [y,m,d] = iso.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('es-MX',{weekday:'short', day:'numeric', month:'short'}).replace(/\./g,''); };
let fechaOk = false, verInfo = false;
function pantallaPedido(){
  const xl = excelLines(order), day = dayOf(), ex = EN_EXCEL(order.platform);
  const dup = buscarDup(day);
  const pend = [];   // cosas que revisar antes de registrar: [texto, id del elemento]
  if (!order.platform) pend.push(['Elige la plataforma', 'oPlat']);
  if (!order.number) pend.push(['Escribe el número de pedido', 'oNum']);
  if (order.mixedNumbers) pend.push(['Capturas de pedidos distintos', 'chMix']);
  if (xl.pending) pend.push([pl(xl.pending, 'producto') + ' sin reconocer', 'itNuevo']);
  const fechaDistinta = modoReg && order.date && order.date !== modoReg.dia;
  if (fechaDistinta && !fechaOk) pend.push(['La pantalla dice otra fecha', 'chFecha']);
  const chips = [];
  if (detectado) chips.push('<span class="chip warn" id="chDet">🔔 <b>Se detectó pedido nuevo.</b> ¿Deseas registrarlo?</span>');
  for (const a of order.alerts) chips.push(`<span class="chip bad">⚠ ${esc(a)}</span>`);
  if (order.mixedNumbers) chips.push('<span class="chip bad" id="chMix">⚠ Las capturas son de pedidos distintos: captura uno a la vez</span>');
  if (dup.igual) chips.push(`<span class="chip bad">✓ Ya registrado${dup.igual.time ? ' a las ' + esc(dup.igual.time) : ''}${SYNC() ? ' (puede ser de otra tableta)' : ''}</span>`);
  else if (dup.otros.length) chips.push(`<span class="chip warn">Ya hay ${dup.otros.length > 1 ? dup.otros.length + ' pedidos' : 'un pedido'} ${esc(order.platform)} #${esc(order.number)} este día con otros productos: este se registra aparte</span>`);
  if (fechaDistinta) chips.push(`<span class="chip ${fechaOk ? 'past' : 'warn'}" id="chFecha">🗓 La pantalla dice ${esc(nombreDia(order.date))}; se registrará en ${esc(nombreDia(modoReg.dia))}${fechaOk ? ' ✓' : ' <button type="button" id="fechaSi">Sí, registrar ahí</button>'}</span>`);
  if (order.numDudoso) chips.push('<span class="chip warn">Se ven varios números de pedido: revisa que sea el abierto</span>');
  if (order.expected && order.readQty !== order.expected) chips.push(`<span class="chip warn">El pedido dice ${order.expected} productos y se leyeron ${order.readQty}</span>`);
  if (order.client) chips.push(`<span class="chip">Cliente: ${esc(order.client)}</span>`);
  if (!modoReg && day !== hoy()) chips.push(`<span class="chip">Día: ${esc(nombreDia(day))}</span>`);
  let primerNuevo = true;
  const filas = order.products.map(p => {
    const m = p.map, combo = m && COMBO_NAMES.has(m.excel);
    const nuevo = !m || p.mods.some(md => !md.map), nocuenta = m && (m.tipo === 'incluido' || m.tipo === 'ignorar');
    const nombre = m ? (m.tipo === 'segun-opcion' ? 'Bee Water ' + (p.mods.find(md => md.map && md.map.sabor)?.map.excel.replace(/^Bee Water \(|\)$/g,'') || '') : (m.excel || p.name)) : p.name;
    const piezas = combo ? (COMBO_FIJO[m.excel]||[]).concat(p.mods.filter(md => md.map && md.map.tipo !== 'incluido' && md.map.tipo !== 'ignorar' && !(COMBO_FIJO[m.excel]||[]).includes(md.map.excel)).map(md => md.map.excel)) : [];
    const mods = !combo ? p.mods.filter(md => md.map && !(m && m.tipo === 'segun-opcion' && md.map.sabor)) : [];
    const detalle = [...piezas, ...mods.map(md => modStatus(md,p) === 'incluido' ? md.name + ' (incluido)' : '+ ' + md.map.excel)].join(' · ');
    const leido = m && p.name !== nombre ? 'Leído: ' + p.name : '';
    const idN = nuevo && primerNuevo ? (primerNuevo = false, ' id="itNuevo"') : '';
    return `<li class="item ${combo?'combo':''} ${nuevo?'nuevo':''} ${nocuenta?'nocuenta':''}"${idN}>
      <div class="q hex num" aria-label="Cantidad">${p.qty}</div>
      <div style="min-width:0">
        <div class="nom">${esc(nombre)}${p.tam ? ` <span class="chip ${p.tam==='40'?'warn':''}" style="font-size:11px;padding:2px 8px">${p.tam} cm</span>` : ''}${combo ? ' <span class="chip" style="background:var(--honey-ink);color:var(--honey);font-size:11px;padding:2px 8px">COMBO</span>' : ''}</div>
        ${detalle ? `<div class="sub">${esc(detalle)}</div>` : ''}
        ${leido && verInfo ? `<div class="sub">${esc(leido)}</div>` : ''}
        ${p.notes.map(n => `<div class="nota">Comentario: ${esc(n)}</div>`).join('')}
        ${!m ? `<div class="sub" style="margin-top:4px">Leído: <b>${esc(p.name)}</b> · no está en el Excel</div>${selector(norm(p.name))}` : ''}
        ${p.mods.filter(md => !md.map).map(md => `<div class="sub" style="margin-top:6px">Opción nueva: <b>${esc(md.name)}</b></div>${selector(norm(md.name))}`).join('')}
      </div>
      <div class="der">${p.price != null ? `<div style="color:var(--ink);font-weight:700">${dinero(p.price)}</div>` : ''}${nuevo ? '<span class="chip warn">Nuevo</span>' : nocuenta ? 'No cuenta' : ex ? '<b>✓ Excel</b>' : '<b>✓ Registro</b>'}</div>
    </li>`;
  }).join('');
  const can = !pend.length && !dup.igual && order.products.length;
  const etiqueta = dup.igual ? 'Ya registrado' : pend.length ? '⚠ Revisar ' + pend.length : modoReg ? 'Registrar en ' + diaCorto(modoReg.dia) : 'Registrar';
  const cls = dup.igual || !order.products.length ? '' : pend.length ? 'rev' : modoReg ? 'past' : '';
  const sinR = xl.sinRenglon && xl.sinRenglon.length ? `<p class="hint" style="margin:0">Sin renglón en el formato (no se marca): ${xl.sinRenglon.map(l => esc(l.excel)).join(', ')}</p>` : '';
  const marcas = ex ? (xl.lines.length ? `<div class="marcas">${xl.lines.map(l => `<span>${l.qty>1?l.qty+' ':''}${esc(l.excel)}</span>`).join('')}</div>${sinR}` : (xl.pending ? '<p class="hint" style="margin:0">Elige los productos nuevos para ver qué se marca.</p>' : sinR || '<p class="hint" style="margin:0">Nada que marcar.</p>'))
    : '<p class="hint" style="margin:0">Reservándonos no va en el Excel: se guarda en el registro del día y en el corte, sin comisión.</p>';
  const nProd = order.products.reduce((a, p) => a + (Number(p.qty)||1), 0);
  const ganancia = /ganancia/i.test(order.totalNote || '');
  return `<div class="accion" style="--pc:${modoReg ? 'var(--past)' : PCOLOR[order.platform] || 'var(--honey)'}">
      <div class="acc-id">${cabeceraPed()}</div>
      <div class="acc-tot"><b class="num">${dinero(order.total)}</b><span>${ganancia ? 'Ganancia' : 'Total'} · ${pl(nProd, 'producto')}</span></div>
      <div class="acc-btns">
        ${APP ? `<button class="bt back" id="btnVolver" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 6l-6 6 6 6"></path></svg>Volver${order.platform ? ' a ' + esc(order.platform) : ''}</button>` : ''}
        <button class="bt go ${cls}" id="btnReg" type="button" ${dup.igual || !order.products.length ? 'disabled' : ''}>${pend.length || dup.igual ? '' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>'}${etiqueta}</button>
      </div>
    </div>
    ${chips.length ? `<div class="chips-fila">${chips.join('')}</div>` : ''}
    <div class="conf2">
      <section class="card pedido entra" style="padding:16px 18px;gap:10px">
        <div class="eyebrow">Productos</div>
        <ul class="items compact">${filas || '<li class="empty">No se encontraron productos en la pantalla. Vuelve a capturar con el pedido abierto.</li>'}</ul>
        ${order.orderNotes.length ? `<div class="banner warn" style="font-size:14px">📝 Nota del pedido: ${esc(order.orderNotes.join(' · '))}</div>` : ''}
      </section>
      <aside class="lado">
        <div class="card cuentas entra2" style="padding:16px 18px">
          <div class="eyebrow" style="margin-bottom:6px">Cuentas</div>
          <div class="kv"><span>Suma de productos</span><b class="num">${dinero(order.sum)}</b></div>
          <div class="kv big"><span>${esc(order.totalNote ? order.totalNote.replace(/^./, c => c.toUpperCase()) : 'Total')}</span><span class="num">${dinero(order.total)}</span></div>
        </div>
        <div class="card entra3" style="display:grid;gap:10px;padding:16px 18px"><div class="eyebrow">${ex ? 'En el Excel se marca' : 'Registro del día'}</div>${marcas}</div>
        <button class="info" type="button" id="btnInfo"><i>i</i>${esc(nombreDia(day))}${verInfo ? ` · leído de la ${metodo === 'imagen' ? 'imagen' : 'pantalla'}${order.captures > 1 ? ' · ' + order.captures + ' pantallas unidas' : ''}` : ' · detalles de lectura'}</button>
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
  const fs = $('fechaSi'); if (fs) fs.onclick = () => { fechaOk = true; pintarConfirmar(); };
  $('btnInfo').onclick = () => { verInfo = !verInfo; pintarConfirmar(); };
  $('btnReg').onclick = () => {
    const b = $('btnReg');
    if (b.classList.contains('rev')) {
      // Lleva a lo primero que hay que revisar
      const ids = ['oPlat','oNum','chMix','itNuevo','chFecha'], el = ids.map($).find(Boolean);
      if (el) { el.scrollIntoView({behavior:'smooth', block:'center'}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); if (el.focus && /SELECT|INPUT/.test(el.tagName)) el.focus(); }
      return;
    }
    registrar();
  };
  const bv = $('btnVolver'); if (bv) bv.onclick = () => window.Android.volver();
}
let ultimoId = null;
function registrar(){
  const origen = registrandoAuto ? 'auto' : (detectado ? 'detectado' : 'boton');
  registrandoAuto = false;
  detectado = false;
  const xl = excelLines(order), day = dayOf(), dup = buscarDup(day);
  if (dup.igual) { aviso('Este pedido ya está en el registro.', true); return; }
  let id = idDe(day, order.platform, order.number);
  const ids = new Set(getLog(day).map(o => o.id));
  for (let k = 2; ids.has(id); k++) id = idDe(day, order.platform, order.number) + '|' + k;
  const now = new Date();
  const e = {id, dia:day, platform:order.platform, number:order.number, client:order.client||'', created:now.toISOString(),
    time: day === hoy() ? hhmm(now) : '', items:xl.items, lines:xl.lines.map(l => ({excel:l.excel, qty:l.qty})),
    total:order.total, totalNote:order.totalNote, sum:order.sum,
    notes:[...order.orderNotes, ...order.products.flatMap(p => p.notes), ...order.alerts], texto: texto.slice(0, 8000), origen};
  if (modoReg) { e.tarde = true; e.por = modoReg.por; e.notes.push('Registrado después por ' + modoReg.por); }
  if (!EN_EXCEL(order.platform)) e.lines = xl.items.map(i => ({excel:i.n, qty:i.qty}));
  if (SYNC()) { setCola([...cola(), e]); subirCola(); }
  else { const log = store.get(logKey(day), []); log.push(e); store.set(logKey(day), log); }
  ultimoId = id;
  avisarRegistrados();
  if (modoReg) tocarModo();
  ultimoMsg = `${order.platform} #${order.number} registrado` + (modoReg ? ' en ' + nombreDia(day) : '') + (EN_EXCEL(order.platform) ? ` · ${pl(xl.lines.reduce((a,l)=>a+l.qty,0),'marca')} en el Excel` : '');
  if (APP && window.Android.registrado) { try { window.Android.registrado(ultimoMsg); } catch(err) {} }
  viewDay = day; estadoConf = 'registrado';
  pintarTodo();
  // Regresa solo a la app de pedidos (con tiempo para deshacer)
  clearTimeout(timerVolver);
  if (APP && window.Android.volver) timerVolver = setTimeout(() => { if (estadoConf !== 'registrado') return; estadoConf = 'vacio'; pintarConfirmar(); window.Android.volver(); }, 2600);
}
let timerVolver = null;
function pantallaExito(){
  return `<div class="exito">
    <div class="check hex" aria-hidden="true"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg></div>
    <h2>¡Registrado!</h2><p class="hint" style="font-size:17px;margin:0">${esc(ultimoMsg)}</p>
    ${APP && ultimoId ? '<p class="hint" style="margin:0">Regresando a la app de pedidos…</p><div class="barra"><i></i></div>' : ''}
    <div class="ex-btns">
      ${APP ? '<button class="bt go" id="exVolver" type="button">Volver a la app de pedidos</button>' : ''}
      ${ultimoId ? '<button class="bt lt" id="exDeshacer" type="button">Deshacer</button>' : ''}
      <button class="bt lt" id="exVer" type="button">Ver registro del día</button>
    </div></div>`;
}
function enlazarExito(){
  const v = $('exVolver'); if (v) v.onclick = () => { clearTimeout(timerVolver); estadoConf = 'vacio'; pintarConfirmar(); window.Android.volver(); };
  const d = $('exDeshacer'); if (d) d.onclick = async () => {
    clearTimeout(timerVolver); const id = ultimoId; ultimoId = null;
    await quitarSinClave(id); estadoConf = order ? 'pedido' : 'vacio'; aviso('Se deshizo el registro.'); pintarTodo();
  };
  $('exVer').onclick = () => { clearTimeout(timerVolver); estadoConf = 'vacio'; ir('vRegistro'); };
}

/* ---------- Resumen de ventas ---------- */
function comparar(r){
  const regs = getLog(r.dia).filter(o => o.platform === PNAME[r.plat]);
  const cods = new Set(regs.map(o => String(o.number).toUpperCase().replace(/^#/,'')));
  const lista = (r.lista||[]).filter(x => !/cancel/i.test(x.estado||''));
  const porCod = new Map(regs.map(o => [String(o.number).toUpperCase().replace(/^#/,''), o]));
  const registrado = regs.reduce((t, o) => t + (Number(o.total) || 0), 0);
  const sinTotal = regs.filter(o => o.total == null).length;
  // Pedidos registrados con otro precio que el de la lista de la plataforma
  const distintos = lista.filter(x => x.monto != null && porCod.has(String(x.code).toUpperCase()) && Math.abs(Number(porCod.get(String(x.code).toUpperCase()).total || 0) - x.monto) >= 1)
    .map(x => ({code:x.code, monto:x.monto, reg:porCod.get(String(x.code).toUpperCase()).total}));
  const dif = r.total != null ? Math.round((r.total - registrado) * 100) / 100 : null;
  return {capturados: regs.length, cods, faltan: lista.filter(x => !cods.has(String(x.code).toUpperCase())), completa: r.pedidos == null || lista.length >= r.pedidos,
    registrado, sinTotal, distintos, dif, porCod};
}
const cuadreTxt = c => c.dif == null ? '' : Math.abs(c.dif) < 1 ? 'Cuadra en pesos' : c.dif > 0 ? 'Faltan ' + dinero(c.dif) + ' por registrar' : 'Sobran ' + dinero(-c.dif) + ' registrados';
const lineaCorte = (p, total) => p === 'resv' ? `Reservandonos: ${dinero(total)}` : `${PCORTE[p]}: ${dinero(total)} -${COMISION[p]}%=${dinero(neto(p, total))}`;
function pantallaResumen(){
  const r = resumen; r.dia = r.dia || hoy();
  const c = comparar(r), nom = PNAME[r.plat];
  const ya = getResumenes(r.dia).find(x => x.id === r.dia + '|' + r.plat);
  const cuadra = r.pedidos != null && c.capturados === r.pedidos;
  const ex = r.extra || {}, nombres = {total_acumulado:'Total acumulado', descuento_restaurante:'Descuento restaurante', total_restaurante:'Total restaurante', descuento_rappi:'Descuento Rappi', ventas_sin_descuentos:'Ventas sin descuentos'};
  const lista = (r.lista||[]).length ? `<div class="tw"><table><thead><tr><th>Pedido</th><th>Hora</th><th class="n">Monto</th><th>Estado</th><th>Capturado</th></tr></thead><tbody>${r.lista.map(x =>
      `<tr><td>#${esc(x.code)}${x.cliente ? `<div class="hint">${esc(x.cliente)}</div>` : ''}</td><td>${esc(x.hora||'')}</td><td class="n">${x.monto != null ? dinero(x.monto) : ''}</td><td>${esc(x.estado||'')}</td><td>${c.cods.has(String(x.code).toUpperCase()) ? (c.distintos.some(d => d.code === x.code) ? `<span class="chip warn">${dinero(c.porCod.get(String(x.code).toUpperCase()).total)}</span>` : '<span class="chip ok">Sí</span>') : /cancel/i.test(x.estado||'') ? '<span class="chip">Cancelado</span>' : '<span class="chip bad">Falta</span>'}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="conf">
    <section class="card pedido entra">
      <div class="ped-head"><span class="plat" style="background:${PCOLOR[nom]}">${esc(nom)}</span><div class="ped-num">Resumen del día</div><div style="flex:1"></div>${ya ? '<span class="chip">Ya guardado: se reemplaza</span>' : ''}</div>
      <div class="meta"><span>Día <b>${esc(nombreDia(r.dia))}</b></span><span>Para el corte: <b>${esc(r.totalNota)}</b></span></div>
      ${r.pedidos != null ? (cuadra ? '<div class="banner ok">Cuadra: todos los pedidos de la app están capturados.</div>'
        : `<div class="banner warn">${esc(nom)} dice ${r.pedidos} pedidos y hay ${c.capturados} capturados.${c.faltan.length ? ' Falta: ' + c.faltan.map(x => '#' + esc(x.code) + (x.hora ? ' (' + x.hora + ')' : '')).join(', ') + '.' : ''}</div>`) : ''}
      ${c.dif != null ? `<div class="banner ${Math.abs(c.dif) < 1 ? 'ok' : 'warn'}">${esc(nom)}: ${dinero(r.total)} · registrado en Bee's: ${dinero(c.registrado)} · <b>${esc(cuadreTxt(c))}</b>${c.sinTotal ? ` · ${pl(c.sinTotal, 'pedido')} sin total` : ''}${c.distintos.length ? '<br>Con otro precio: ' + c.distintos.map(x => '#' + esc(x.code) + ' (app ' + dinero(x.monto) + ', registrado ' + dinero(x.reg) + ')').join(', ') + '. Corrígelos en el Registro.' : ''}</div>` : ''}
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
/* Imagen de la pantalla de ventas (se toma al tocar el hexágono) para el corte */
async function guardarImagenResumen(rec){
  if (!APP || !window.Android.pantallaCapturada) return;
  let img = ''; try { img = window.Android.pantallaCapturada(); } catch(e) {}
  if (!img) return;
  try {
    const r = await sb('POST', 'delivery_resumen_img', '', {id:rec.id, dia:rec.dia, plat:rec.plat, img, created_at:new Date().toISOString()}, 'resolution=merge-duplicates,return=minimal');
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch(e) { aviso('No se pudo subir la imagen del resumen', true); }
}
/* La capturadora detectó sola la pantalla de ventas de una app: se guarda el resumen y su imagen sin preguntar */
window.resumenDetectado = async (txt, plat, img) => {
  const r = parseResumen(txt, plat);
  if (!r || r.total == null) return;
  r.dia = r.dia || hoy();
  const id = r.dia + '|' + r.plat;
  const ya = getResumenes(r.dia).find(x => x.id === id);
  const igual = ya && Number(ya.total) === Number(r.total) && (ya.pedidos ?? null) === (r.pedidos ?? null);
  if (!igual) {
    const rec = {id, dia:r.dia, plat:r.plat, pedidos:r.pedidos, cancelados:r.cancelados, total:r.total, total_nota:r.totalNota,
      lista:r.lista, extra:r.extra, texto:String(txt).slice(0, 8000), updated_at:new Date().toISOString()};
    if (SYNC()) { setColaRes([...colaRes().filter(x => x.id !== rec.id), rec]); await subirCola(); }
    else { const m = store.get('bees.resumen.' + r.dia, {}); m[r.plat] = rec; store.set('bees.resumen.' + r.dia, m); }
  }
  if (img && SYNC()) {
    try { await sb('POST', 'delivery_resumen_img', '', {id, dia:r.dia, plat:r.plat, img, created_at:new Date().toISOString()}, 'resolution=merge-duplicates,return=minimal'); } catch(e) {}
  }
  if (!igual) {
    aviso(`Resumen de ${PNAME[r.plat]} guardado · ${dinero(r.total)}`);
    if (SYNC()) { await refrescar(viewDay); pintarTodo(); }
  }
};
function resumenesPendientes(){
  if (!APP || !window.Android.resumenesPendientes) return;
  let l = []; try { l = JSON.parse(window.Android.resumenesPendientes() || '[]'); } catch(e) {}
  l.reduce((p, x) => p.then(() => window.resumenDetectado(x.texto, x.plat, x.img)), Promise.resolve());
}
async function bajarImagenesDia(){
  const m = $('xImgMsg'); if (m) m.textContent = 'Buscando imágenes…';
  try {
    const r = await sb('GET', 'delivery_resumen_img', '?select=plat,img&dia=eq.' + viewDay);
    const fs = r.ok ? await r.json() : [];
    if (!fs.length) { if (m) m.textContent = 'No hay imágenes de ' + nombreDia(viewDay) + '.'; return; }
    const lista = fs.map(f => ({nombre:'Resumen_' + (PNAME[f.plat] || f.plat).replace(/\W/g,'') + '_' + viewDay + '.jpg', b64:f.img}));
    if (APP && window.Android.guardarImagenes) { const t = window.Android.guardarImagenes(JSON.stringify(lista)); if (m) m.textContent = t; }
    else lista.forEach(x => { const a = document.createElement('a'); a.href = 'data:image/jpeg;base64,' + x.b64; a.download = x.nombre; document.body.appendChild(a); a.click(); a.remove(); });
  } catch(e) { if (m) m.textContent = 'Sin conexión: no se pudieron bajar las imágenes.'; }
}
async function verImagenResumen(p){
  $('modalCaja').innerHTML = `<h2>Resumen de ${esc(PNAME[p])}</h2><p class="hint" style="margin:0">Cargando imagen…</p>`;
  $('modal').hidden = false;
  try {
    const r = await sb('GET', 'delivery_resumen_img', '?select=img,created_at&id=eq.' + encodeURIComponent(viewDay + '|' + p));
    const f = r.ok ? (await r.json())[0] : null;
    if (!f) { $('modalCaja').innerHTML = `<h2>Resumen de ${esc(PNAME[p])}</h2><p class="hint">No hay imagen guardada de este día. Se guarda al tocar el hexágono en la pantalla de ventas (tabletas con Android 11 o más nuevo).</p><div style="display:flex;justify-content:flex-end"><button class="bt lt" type="button" id="imCerrar">Cerrar</button></div>`; $('imCerrar').onclick = cerrarModal; return; }
    const nombre = 'Resumen_' + PNAME[p].replace(/\W/g,'') + '_' + viewDay + '.jpg';
    $('modalCaja').innerHTML = `<h2>Resumen de ${esc(PNAME[p])} · ${esc(nombreDia(viewDay))}</h2>
      <img src="data:image/jpeg;base64,${f.img}" alt="Pantalla de ventas de ${esc(PNAME[p])}" style="width:100%;border-radius:12px;border:1px solid var(--line)">
      <p class="hint" style="margin:0">Tomada ${esc(hhmm(f.created_at))}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">${APP ? '<button class="btn primary" type="button" id="imBajar">Descargar o compartir</button>' : `<a class="btn primary" href="data:image/jpeg;base64,${f.img}" download="${nombre}">Descargar</a>`}<button class="bt lt" type="button" id="imCerrar">Cerrar</button></div>`;
    $('imCerrar').onclick = cerrarModal;
    const b = $('imBajar'); if (b) b.onclick = () => { const m = window.Android.guardarImagen(nombre, f.img); aviso(m || 'Imagen guardada'); };
  } catch(e) { $('modalCaja').innerHTML = '<h2>Sin conexión</h2><p class="hint">No se pudo cargar la imagen.</p><div style="display:flex;justify-content:flex-end"><button class="bt lt" type="button" id="imCerrar">Cerrar</button></div>'; $('imCerrar').onclick = cerrarModal; }
}
function enlazarResumen(){
  $('btnRes').onclick = () => {
    const r = resumen;
    const rec = {id: r.dia + '|' + r.plat, dia:r.dia, plat:r.plat, pedidos:r.pedidos, cancelados:r.cancelados, total:r.total, total_nota:r.totalNota,
      lista:r.lista, extra:r.extra, texto:texto.slice(0, 8000), updated_at:new Date().toISOString()};
    if (SYNC()) { setColaRes([...colaRes().filter(x => x.id !== rec.id), rec]); subirCola(); guardarImagenResumen(rec); }
    else { const m = store.get('bees.resumen.' + r.dia, {}); m[r.plat] = rec; store.set('bees.resumen.' + r.dia, m); }
    ultimoMsg = `Resumen de ${PNAME[r.plat]} guardado · ${lineaCorte(r.plat, r.total)}`;
    if (APP && window.Android.registrado) { try { window.Android.registrado(ultimoMsg); } catch(err) {} }
    ultimoId = null; viewDay = r.dia; estadoConf = 'registrado'; pintarTodo();
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
  let h = barraDia('Registro del día').replace(/<\/div>$/, `<div style="flex:1"></div><button class="btn small" type="button" id="btnModoReg" style="background:var(--past);color:#fff">🗓 ${modoReg ? 'Cambiar día del modo registro' : 'Modo registro'}</button></div>`);
  h += `<div class="stats"><div class="stat total"><span class="eyebrow">Pedidos</span><b class="num">${tot}</b><span class="hint" style="color:#cfc6b1">en las 4 tabletas</span></div>` +
    PLATS.map(p => `<div class="stat" style="--c:${PCOLOR[p]}"><span class="eyebrow">${p}</span><b class="num">${ped[p]}</b><span class="hint">${dinero(venta[p])}</span></div>`).join('') + '</div>';
  h += `<div class="filtros">${[['','Todas'], ...PLATS.map(p => [p,p])].map(([k,n]) => `<button type="button" data-f="${esc(k)}" aria-pressed="${filtro===k}">${n}</button>`).join('')}</div>`;
  const lista = log.filter(o => !filtro || o.platform === filtro).slice().reverse();
  h += lista.length ? '<ul class="lista">' + lista.map(o => {
    const nueva = !vistos.has(o.id) && vistos.size > 0; vistos.add(o.id);
    const det = abierta === o.id ? `<div class="det">${(o.notes||[]).length ? `<span class="nota">${esc(o.notes.join(' · '))}</span>` : ''}${o.pendiente ? '<span class="chip warn">Por subir</span>' : ''}<div style="flex:1"></div>${o.pendiente ? '' : `<button class="btn small ghost" type="button" data-cr="${esc(o.id)}">Corregir</button>`}<button class="btn small ${porQuitar===o.id?'dark':'ghost'}" type="button" data-q="${esc(o.id)}">${porQuitar===o.id ? '¿Seguro? Toca otra vez para quitar' : 'Quitar del registro'}</button></div>` : '';
    return `<li class="fila ${nueva?'nueva':''}" style="--c:${PCOLOR[o.platform]||'var(--muted)'}"><button type="button" data-o="${esc(o.id)}" aria-expanded="${abierta===o.id}">
      <span class="hr num">${esc(o.time || '—')}</span>
      <span><span class="pl">${esc(o.platform)}</span><span class="id" style="display:block">#${esc(o.number)}${o.client ? ' · ' + esc(o.client) : ''}</span>${o.tarde ? `<span class="tarde" style="display:block">Registrado después${o.por ? ' · ' + esc(o.por) : ''}</span>` : ''}${o.corregido ? `<span class="tarde" style="display:block">Corregido por ${esc(o.corregido)}</span>` : ''}</span>
      <span class="prods">${(o.lines||[]).map(l => (l.qty>1?l.qty+' ':'') + esc(l.excel)).join(' · ') || '<span class="hint">Sin productos</span>'}${grandes(o)}</span>
      <span class="tt num">${dinero(o.total)}${o.totalNote ? `<small>${esc(o.totalNote)}</small>` : ''}</span>
    </button>${det}</li>`;
  }).join('') + '</ul>' : `<div class="empty">Sin pedidos ${filtro ? 'de ' + esc(filtro) + ' ' : ''}${viewDay === hoy() ? 'todavía hoy' : 'ese día'}. Aquí aparece lo que registre cualquiera de las tabletas.</div>`;
  el.innerHTML = h;
  enlazarDia(el);
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; pintarRegistro(); });
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { abierta = abierta === b.dataset.o ? null : b.dataset.o; porQuitar = null; pintarRegistro(); });
  el.querySelectorAll('[data-cr]').forEach(b => b.onclick = () => abrirCorregir(b.dataset.cr));
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { if (porQuitar !== b.dataset.q) { porQuitar = b.dataset.q; pintarRegistro(); } else { const id = b.dataset.q; conSupervisor('Quitar un pedido del registro', () => quitar(id)); } });
  const bm = $('btnModoReg'); if (bm) bm.onclick = abrirModoRegistro;
}
async function quitarSinClave(id){
  const dia = id.split('|')[0];
  if (SYNC()) { setCola(cola().filter(e => e.id !== id)); try { await sb('DELETE', 'delivery_pedidos', '?id=eq.' + encodeURIComponent(id)); } catch(e) {} await refrescar(dia); }
  else store.set(logKey(dia), store.get(logKey(dia), []).filter(e => e.id !== id));
}
async function quitar(id){
  porQuitar = null;
  await quitarSinClave(id);
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
  let corte = '<div class="tw"><table><thead><tr><th>App</th><th class="n">Capturados</th><th class="n">Registrado</th><th class="n">Venta</th><th class="n">Neto</th></tr></thead><tbody>', tot = 0;
  for (const p of ['didi','uber','rappi','resv']) {
    const r = res.find(x => x.plat === p), capt = log.filter(o => o.platform === PNAME[p]).length;
    if (r) tot += neto(p, r.total);
    const c = r ? comparar(r) : null;
    const av = r && r.pedidos != null && capt !== r.pedidos ? `<div class="hint" style="color:var(--warn);font-weight:600">${capt < r.pedidos ? 'Faltan ' + (r.pedidos - capt) : 'Sobran ' + (capt - r.pedidos)}${c.faltan.length ? ': #' + c.faltan.map(x => esc(x.code)).join(', #') : ''}</div>` : '';
    const regP = log.filter(o => o.platform === PNAME[p]).reduce((t, o) => t + (Number(o.total) || 0), 0);
    const cq = c && c.dif != null ? `<div class="hint" style="font-weight:700;color:${Math.abs(c.dif) < 1 ? 'var(--ok)' : 'var(--warn)'}">${esc(cuadreTxt(c))}</div>${c.distintos.length ? `<div class="hint" style="color:var(--warn)">Otro precio: #${c.distintos.map(x => esc(x.code)).join(', #')}</div>` : ''}` : '';
    corte += `<tr><td><b style="color:${PCOLOR[PNAME[p]]}">${PNAME[p]}</b>${r ? (r.pendiente ? ' <span class="chip warn">Por subir</span>' : '') : '<div class="hint">sin resumen</div>'}${r && SYNC() ? `<div><button class="btn small ghost" type="button" data-img="${p}" style="margin-top:4px;padding:4px 10px">Ver imagen</button></div>` : ''}</td><td class="n">${capt}${r && r.pedidos != null ? ' de ' + r.pedidos : ''}${av}</td><td class="n">${capt ? dinero(regP) : '—'}${cq}</td><td class="n">${r ? dinero(r.total) : '—'}</td><td class="n">${r ? dinero(neto(p, r.total)) : '—'}</td></tr>`;
  }
  corte += `<tr class="tot"><td colspan="4">Delivery neto</td><td class="n">${dinero(tot)}</td></tr></tbody></table></div><pre class="corte">${esc(textoCorte())}</pre>`;
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
      ${res.length ? '' : '<p class="hint" style="margin-top:0">Al cierre, abre el historial o resumen de ventas de cada app: la capturadora lo lee y guarda la imagen sola (o toca el hexágono).</p>'}${corte}
      ${SYNC() ? '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px"><button class="btn ghost" type="button" id="xImagenes">Descargar imágenes del día</button><span class="hint" id="xImgMsg"></span></div>' : ''}</section>
    <section class="card"><div class="fila-tit"><h3>Concentrado del Excel</h3><label class="hint" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cTodos" ${conTodos?'checked':''} style="width:20px;height:20px;accent-color:var(--honey)"> Todos los productos</label></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><button class="btn primary" type="button" id="xDescargar" style="font-size:18px;padding:14px 20px">Descargar Excel del día</button><span class="hint" id="xMsg">${log.filter(o => PL3.includes(o.platform)).length} pedidos · ${pl(marcas,'marca')}</span></div>
      ${con}</section></div>`;
  enlazarDia(el);
  $('cTodos').onchange = e => { conTodos = e.target.checked; pintarExcel(); };
  $('cCopiar').onclick = () => copiar(textoCorte(), 'Corte copiado');
  const cc = $('cCompartir'); if (cc) cc.onclick = () => window.Android.compartir(textoCorte());
  $('xDescargar').onclick = descargarExcel;
  el.querySelectorAll('[data-img]').forEach(b => b.onclick = () => verImagenResumen(b.dataset.img));
  const xi = $('xImagenes'); if (xi) xi.onclick = bajarImagenesDia;
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

/* ---------- Actualizaciones (las avisa la app) ---------- */
let versionNueva = null;
window.avisoVersion = v => {
  let est = {}; try { est = JSON.parse(window.Android.estado()); } catch(e) {}
  if (!v || !est.code || !(v.versionCode > est.code)) { $('nueva').hidden = true; versionNueva = null; return; }
  versionNueva = v;
  $('nuevaTit').textContent = 'Hay una versión nueva: ' + (v.versionName || v.versionCode);
  if (!$('nuevaBtn').disabled) $('nuevaTxt').textContent = 'Se descarga y Android te pide confirmar con «Instalar». No se pierde nada de lo registrado.';
  $('nueva').hidden = false;
};
window.progresoVersion = p => {
  const t = $('nuevaTxt'), b = $('nuevaBtn');
  if (p === 'permiso') { t.textContent = 'Activa «Permitir de esta fuente» para Bee\'s Captura, regresa y vuelve a tocar Actualizar.'; b.disabled = false; return; }
  if (p === 'instalar') { t.textContent = 'Listo. Toca «Instalar» en la ventana de Android.'; b.disabled = false; b.textContent = 'Volver a intentar'; return; }
  if (p === 'error') { t.textContent = 'No se pudo descargar. Revisa el internet y vuelve a intentar.'; b.disabled = false; b.textContent = 'Volver a intentar'; return; }
  t.textContent = 'Descargando… ' + (p >= 0 ? p + '%' : ''); b.disabled = true;
};
$('nuevaBtn').onclick = () => { if (!APP || !window.Android.actualizarApk) return; $('nuevaBtn').disabled = true; $('nuevaTxt').textContent = 'Preparando la descarga…'; window.Android.actualizarApk(); };
// La app pregunta antes de aplicar una pantalla nueva: no a media confirmación
window.puedeRecargar = () => estadoConf === 'vacio' && $('ajustes').hidden && $('modal').hidden;

/* ---------- Ajustes ---------- */
function abrirAjustes(){ $('ajustes').hidden = false; pintarAjustes(); pintarAjustesSup(); }
function abrirAjustesConClave(){ if (!clave) abrirAjustes(); else conSupervisor('Entrar a Ajustes', abrirAjustes); }
$('btnAjustes').onclick = abrirAjustesConClave;
$('sync').onclick = abrirAjustesConClave;
function cerrarAjustes(){
  $('ajustes').hidden = true;
  if (!esAdmin()) sup = null;   // en las tabletas, cada entrada a Ajustes pide la clave
  pintarConfirmar();
  if (!modoEquipo) revisarModo();
}
$('ajCerrar').onclick = cerrarAjustes;
$('ajustes').onclick = e => { if (e.target.id === 'ajustes') cerrarAjustes(); };
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
  const conAvisos = 'avisos' in est, avOn = !!est.avisos;
  $('ajAvisos').textContent = !APP ? 'Solo en la tableta' : !conAvisos ? 'Actualiza la app' : avOn ? 'Activo' : 'Apagado';
  $('ajAvisos').className = 'chip ' + (avOn ? 'ok' : 'warn');
  $('ajAvisosTxt').textContent = !conAvisos ? 'Para avisar al celular cuando entra un pedido, instala la versión nueva (aviso de arriba).'
    : avOn ? (clave ? 'Cuando Uber, DiDi, Rappi o Reservándonos avisan un pedido en esta tableta, te llega al celular.' : 'Falta la clave de la sucursal (abajo) para mandar los avisos.')
    : 'Toca el botón, entra a «Bee\'s Captura · avisos de pedidos» y actívalo. Solo lee las notificaciones de las apps de pedidos.';
  $('ajAvisosBtn').hidden = !APP || !conAvisos || avOn;
  if (APP && clave && window.Android.guardarClave) window.Android.guardarClave(clave);
  if (clave && SYNC()) sb('POST', 'rpc/alertas_equipo', '', {}).then(r => r.ok ? r.json() : null).then(l => {
    if (!Array.isArray(l)) return;
    $('ajEquipo').innerHTML = l.length ? l.map(p => '• ' + esc(p.nombre) + (p.admin ? ' <span class="chip ok">administrador</span>' : '')).join('<br>') : 'Nadie todavía.';
  }).catch(() => {});
  $('ajVersion').textContent = 'Versión ' + (est.version || 'web') + (est.web ? ' · lector ' + est.web : '') + '. Se actualiza sola cuando hay internet.';
}
$('ajAcc').onclick = () => window.Android.abrirAccesibilidad();
$('ajAvisosBtn').onclick = () => window.Android.abrirAvisos && window.Android.abrirAvisos();
if (APP && clave && window.Android.guardarClave) { try { window.Android.guardarClave(clave); } catch(e) {} }
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

/* ---------- Modo supervisor ---------- */
const SUP_MIN = 12 * 60;   // la sesión se cierra al salir de Ajustes (tableta) o al salir de la app (administrador)
let sup = null;   // {nombre, admin, pin, hasta}
const supVigente = () => sup && Date.now() < sup.hasta ? sup : null;
async function rpc(fn, body){
  const r = await sb('POST', 'rpc/' + fn, '', body, 'return=representation');
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch(e) {}
  if (!r.ok) throw new Error((j && j.message) || 'No se pudo conectar. Revisa el internet.');
  return j;
}
function cerrarModal(){ $('modal').hidden = true; $('modalCaja').innerHTML = ''; }
$('modal').onclick = e => { if (e.target.id === 'modal') cerrarModal(); };
/** Pide la clave de supervisor (o la crea la primera vez) y luego sigue. */
function conSupervisor(motivo, sigue){
  if (!SYNC()) { aviso('Primero pon la clave de la sucursal en Ajustes.', true); return; }
  const s = supVigente(); if (s) { s.hasta = Date.now() + SUP_MIN * 60000; sigue(s); return; }
  let pin = '', primera = false, ocupado = false;
  const caja = $('modalCaja');
  const pintar = (msg, mal) => {
    caja.innerHTML = `<h2>${primera ? 'Crea la clave de supervisor' : 'Clave de supervisor'}</h2>
      <p class="hint" style="margin:0">${esc(motivo)}${primera ? '. Es la primera vez: tú quedas como administrador.' : ''}</p>
      ${primera ? '<label class="eyebrow" for="supNom">Tu nombre</label><input id="supNom" autocomplete="off" maxlength="30" placeholder="Ej. Alfredo">' : ''}
      <div class="pin-dots ${mal ? 'mal' : ''}" aria-label="${pin.length} de 4">${[0,1,2,3].map(i => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('')}</div>
      ${msg ? `<div class="banner ${mal ? 'bad' : 'ok'}" style="text-align:center">${esc(msg)}</div>` : ''}
      <div class="teclado">${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}<button type="button" data-k="x" aria-label="Cancelar" style="font-size:16px">Cancelar</button><button type="button" data-k="0">0</button><button type="button" data-k="b" aria-label="Borrar">⌫</button></div>`;
    caja.querySelectorAll('[data-k]').forEach(b => b.onclick = () => tecla(b.dataset.k));
  };
  const tecla = async k => {
    if (ocupado) return;
    if (k === 'x') { cerrarModal(); return; }
    if (k === 'b') { pin = pin.slice(0, -1); pintar(); return; }
    if (pin.length >= 4) return;
    pin += k; const nom = $('supNom') ? $('supNom').value : ''; pintar(); if ($('supNom')) $('supNom').value = nom;
    if (pin.length < 4) return;
    ocupado = true;
    try {
      const r = await rpc('delivery_sup', {accion:'entrar', pin, d:{nombre: nom}});
      sup = {nombre:r.nombre, admin:!!r.admin, pin, hasta: Date.now() + SUP_MIN * 60000};
      cerrarModal(); aviso((r.nuevo ? 'Clave creada. ' : '') + 'Hola, ' + r.nombre); sigue(sup);
    } catch(e) { pin = ''; ocupado = false; pintar(e.message, true); if ($('supNom')) $('supNom').value = nom; return; }
    ocupado = false;
  };
  $('modal').hidden = false; pintar('Revisando…');
  rpc('delivery_sup', {accion:'estado'}).then(r => { primera = !r.hay; pintar(); }).catch(e => pintar(e.message, true));
}

/* ---------- Modo del equipo: tableta de registro o administrador ---------- */
let modoEquipo = (() => { if (!APP) return 'admin'; try { return JSON.parse(window.Android.estado()).modo || ''; } catch(e) { return ''; } })();
const esAdmin = () => modoEquipo === 'admin';
function ponerModoEquipo(m){
  modoEquipo = m;
  if (APP && window.Android.ponerModo) { try { window.Android.ponerModo(m); } catch(e) {} }
  aplicarModoUI();
}
function aplicarModoUI(){
  document.body.classList.toggle('admin', esAdmin());
  if (!esAdmin()) return;
  if (!$('vConfirmar').hidden) ir('vRegistro');
  if (!supVigente()) { bloquear(); pedirDesbloqueo(); }
}
/** La primera vez se elige el modo. Las tabletas que ya trabajaban (y el celular ya marcado) no preguntan. */
function revisarModo(alArrancar){
  if (modoEquipo) { aplicarModoUI(); return; }
  if (alArrancar) {   // equipos que ya trabajaban antes de la 1.7: se deduce su modo sin preguntar
    let est = {}; try { est = JSON.parse(window.Android.estado()); } catch(e) {}
    if (est.rol === 'celular') { ponerModoEquipo('admin'); return; }
    if (est.plat || clave) { ponerModoEquipo('registro'); return; }
  }
  pintarElegirModo();
}
function pintarElegirModo(){
  const c = $('elegirModo');
  c.innerHTML = `<div class="panel elegir" role="dialog" aria-modal="true" aria-labelledby="emTit">
    <div class="eyebrow">Bee's Captura</div>
    <h2 id="emTit">¿Cómo se usará este equipo?</h2>
    <p class="hint" style="margin:0">Se elige una sola vez y se queda guardado aunque se apague. Para cambiarlo después se pide la clave de supervisor.</p>
    <button type="button" class="opcion" id="emReg"><span class="ico" aria-hidden="true">🧾</span><span><b>Tableta de registro</b><span class="hint">Lee los pedidos de Uber, DiDi, Rappi o Reservándonos con el hexágono, avisa a Telegram y detecta pedidos nuevos.</span></span></button>
    <button type="button" class="opcion" id="emAdm"><span class="ico" aria-hidden="true">🔑</span><span><b>Administrador</b><span class="hint">Para el celular del administrador o de un supervisor: ver pedidos, corregir y descargar el Excel. No lee pantallas ni reenvía notificaciones. Pide la clave cada vez que se abre.</span></span></button>
  </div>`;
  c.hidden = false;
  $('emReg').onclick = () => { c.hidden = true; ponerModoEquipo('registro'); aviso('Listo: este equipo es tableta de registro.'); pintarTodo(); };
  $('emAdm').onclick = () => {
    if (!SYNC()) { c.hidden = true; abrirAjustes(); aviso('Primero escribe la clave de la sucursal y luego cierra Ajustes.', true); return; }
    conSupervisor('Usar este equipo como administrador', () => { c.hidden = true; ponerModoEquipo('admin'); aviso('Listo: modo administrador.'); });
  };
}
/* Candado del modo administrador: pide la clave cada vez que se abre la app */
function bloquear(){
  sup = null;
  const c = $('candado');
  c.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="cdTit"><div style="font-size:44px" aria-hidden="true">🔒</div><h2 id="cdTit">Modo administrador</h2><p class="hint" style="margin:0">Escribe tu clave de supervisor para ver los pedidos.</p><button class="btn primary" type="button" id="cdAbrir">Desbloquear</button></div>`;
  c.hidden = false;
  $('cdAbrir').onclick = pedirDesbloqueo;
}
function pedirDesbloqueo(){ if (!$('modal').hidden) return; conSupervisor('Entrar como administrador', () => { $('candado').hidden = true; pintarTodo(); }); }
window.alSalir = () => { if (!esAdmin()) return; cerrarModal(); $('ajustes').hidden = true; bloquear(); };
window.alVolver = () => { if (esAdmin() && !$('candado').hidden) pedirDesbloqueo(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.alSalir(); else window.alVolver(); });

/* Pizzas de 40 cm de un pedido (las demás son de 35) */
const grandes = o => { const g = (o.items||[]).filter(i => i.tam === '40'); return g.length ? ` <b class="g40">· 40 cm: ${g.map(i => (i.qty>1?i.qty+' ':'') + esc(i.n)).join(', ')}</b>` : ''; };
const PIZZAS = new Set((CATALOG.find(c => c.cat === 'Pizzas') || {names:[]}).names);
const esPizza = n => PIZZAS.has(n) || PIZZAS.has(String(n).replace(/\s*\([^)]*\)\s*$/, ''));

/* ---------- Corregir un pedido (con clave de supervisor) ---------- */
function abrirCorregir(id){
  const o = getLog().find(x => x.id === id); if (!o) return;
  conSupervisor('Corregir ' + o.platform + ' #' + o.number, s => editorPedido(o, s));
}
const lineasDe = (platform, items) => EN_EXCEL(platform) ? marcas(items).lines.map(l => ({excel:l.excel, qty:l.qty})) : items.map(i => ({excel:i.n, qty:i.qty}));
function editorPedido(o, s){
  const items = (o.items || []).map(i => ({...i}));
  const caja = $('modalCaja');
  const opciones = CATALOG.map(c => `<optgroup label="${esc(c.cat)}">${c.names.map(n => `<option>${esc(n)}</option>`).join('')}</optgroup>`).join('');
  let v = {num: String(o.number || ''), tot: o.total == null ? '' : String(o.total), cli: o.client || ''};
  const leerCampos = () => { if ($('crNum')) v = {num:$('crNum').value, tot:$('crTot').value, cli:$('crCli').value}; };
  const pintar = msg => {
    caja.innerHTML = `<h2>Corregir ${esc(o.platform)} #${esc(o.number)}</h2>
      <div class="cr-campos">
        <label><span class="eyebrow">Número</span><input id="crNum" autocomplete="off"></label>
        <label><span class="eyebrow">Total</span><input id="crTot" type="number" inputmode="decimal" step="0.01"></label>
        <label style="grid-column:1/-1"><span class="eyebrow">Cliente</span><input id="crCli" autocomplete="off"></label>
      </div>
      <ul class="cr-items">${items.map((i,k) => `<li><span>${esc(i.n)}</span><span class="cr-q">${esPizza(i.n) ? `<button type="button" class="cr-tam${i.tam==='40'?' on':''}" data-t="${k}" aria-label="Tamaño de ${esc(i.n)}: ${i.tam==='40'?'40':'35'} cm, toca para cambiar">${i.tam==='40'?'40':'35'}</button>` : ''}<button type="button" data-m="${k}" aria-label="Uno menos de ${esc(i.n)}">−</button><b class="num">${i.qty}</b><button type="button" data-p="${k}" aria-label="Uno más de ${esc(i.n)}">+</button><button type="button" data-x="${k}" aria-label="Quitar ${esc(i.n)}">✕</button></span></li>`).join('') || '<li><span class="hint">Sin productos</span></li>'}</ul>
      <select id="crAdd" aria-label="Agregar producto"><option value="">+ Agregar producto…</option>${opciones}</select>
      ${msg ? `<div class="banner bad">${esc(msg)}</div>` : ''}
      <div class="cr-acc"><button class="btn ghost" type="button" id="crNo">Cancelar</button><button class="btn primary" type="button" id="crSi">Guardar corrección</button></div>`;
    $('crNum').value = v.num; $('crTot').value = v.tot; $('crCli').value = v.cli;
    const cambia = f => () => { leerCampos(); f(); pintar(); };
    caja.querySelectorAll('[data-m]').forEach(b => b.onclick = cambia(() => { const i = items[b.dataset.m]; if (i.qty > 1) i.qty--; }));
    caja.querySelectorAll('[data-p]').forEach(b => b.onclick = cambia(() => { items[b.dataset.p].qty++; }));
    caja.querySelectorAll('[data-x]').forEach(b => b.onclick = cambia(() => { items.splice(Number(b.dataset.x), 1); }));
    caja.querySelectorAll('[data-t]').forEach(b => b.onclick = cambia(() => { const i = items[b.dataset.t]; if (i.tam === '40') delete i.tam; else i.tam = '40'; }));
    $('crAdd').onchange = e => { const n = e.target.value; if (!n) return; leerCampos(); const ya = items.find(i => i.n === n && !i.parts && !i.tam); if (ya) ya.qty++; else items.push({n, qty:1}); pintar(); };
    $('crNo').onclick = cerrarModal;
    $('crSi').onclick = async () => {
      leerCampos();
      if (!v.num.trim()) { pintar('Escribe el número de pedido.'); return; }
      if (!items.length) { pintar('El pedido no tiene productos: si ya no va, mejor quítalo del registro.'); return; }
      const total = v.tot.trim() === '' ? null : Number(v.tot);
      if (total != null && !(total >= 0)) { pintar('Revisa el total.'); return; }
      $('crSi').disabled = true;
      try {
        await rpc('delivery_corregir', {pin:s.pin, id:o.id, d:{code:v.num.trim(), cust:v.cli.trim(), total, items, lineas:lineasDe(o.platform, items)}});
        cerrarModal(); aviso('Pedido corregido.'); await refrescar(o.dia); pintarTodo();
      } catch(e) { pintar(e.message); }
    };
  };
  $('modal').hidden = false; pintar();
}

/* ---------- Modo registro (días pasados) ---------- */
const MODO_MIN = 15;
let modoReg = (() => { const m = store.get('bees.modoReg', null); return m && m.hasta > Date.now() ? m : null; })();
function tocarModo(){ if (!modoReg) return; modoReg.hasta = Date.now() + MODO_MIN * 60000; store.set('bees.modoReg', modoReg); }
function pintarModo(){
  const b = $('modoReg');
  b.hidden = !modoReg;
  if (modoReg) { $('modoRegDia').textContent = 'Registrando para: ' + nombreDia(modoReg.dia); $('modoRegPor').textContent = modoReg.por; }
  medir();
}
function terminarModo(msg){
  if (!modoReg) return;
  modoReg = null; store.set('bees.modoReg', null); viewDay = hoy(); fechaOk = false;
  pintarModo(); aviso(msg || 'Modo registro terminado. La tableta regresó a hoy.'); refrescar(hoy()).then(pintarTodo);
}
$('modoRegFin').onclick = () => terminarModo();
setInterval(() => { if (modoReg && Date.now() > modoReg.hasta) terminarModo('Se terminó el modo registro: 15 min sin escanear.'); }, 20000);
function abrirModoRegistro(){
  conSupervisor('Modo registro de días pasados', s => {
    const h = hoy(), dias = [];
    for (let i = 30; i >= 1; i--) dias.push(masDias(h, -i));
    const [y,m,d] = dias[0].split('-').map(Number), lunes = (new Date(y,m-1,d).getDay() + 6) % 7;
    const sel = modoReg ? modoReg.dia : '';
    $('modalCaja').innerHTML = `<h2>¿Qué día vas a registrar?</h2>
      <p class="hint" style="margin:0">Hasta 30 días atrás. Lo que escanees se guarda en ese día, marcado como registrado después por ${esc(s.nombre)}, sin avisos ni petición de foto. Se apaga solo tras ${MODO_MIN} min sin escanear.</p>
      <div class="cal">${['L','M','M','J','V','S','D'].map(x => `<b>${x}</b>`).join('')}${'<span></span>'.repeat(lunes)}${dias.map(x => `<button type="button" data-dia="${x}" class="${x === sel ? 'on' : ''}" aria-label="${esc(nombreDia(x))}">${Number(x.slice(8))}</button>`).join('')}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">${modoReg ? '<button class="bt lt" type="button" id="mrFin">Terminar modo registro</button>' : ''}<button class="bt lt" type="button" id="mrCancel">Cancelar</button></div>`;
    $('modal').hidden = false;
    $('modalCaja').querySelectorAll('[data-dia]').forEach(b => b.onclick = async () => {
      modoReg = {dia:b.dataset.dia, por:s.nombre, hasta: Date.now() + MODO_MIN * 60000}; store.set('bees.modoReg', modoReg);
      cerrarModal(); viewDay = modoReg.dia; fechaOk = false; pintarModo();
      aviso('Modo registro: ' + nombreDia(modoReg.dia));
      await refrescar(viewDay); pintarTodo();
    });
    $('mrCancel').onclick = cerrarModal;
    const f = $('mrFin'); if (f) f.onclick = () => { cerrarModal(); terminarModo(); };
  });
}
function medir(){
  const t = document.querySelector('.top'), b = $('modoReg');
  document.documentElement.style.setProperty('--topH', (t ? t.offsetHeight : 69) + 'px');
  document.documentElement.style.setProperty('--bandH', (b && !b.hidden ? b.offsetHeight : 0) + 'px');
}
addEventListener('resize', medir);

/* ---------- Interruptor de captura ---------- */
let capturaOn = (() => { try { const e = APP ? JSON.parse(window.Android.estado()) : {}; return e.captura !== false; } catch(e) { return true; } })();
let fotosOn = true;
function ponerCapturaLocal(v){
  if (v === capturaOn) return;
  capturaOn = v;
  if (APP && window.Android.ponerCaptura) { try { window.Android.ponerCaptura(v); } catch(e) {} }
  if (estadoConf === 'vacio') pintarConfirmar();
}

/* ---------- Ajustes de supervisor ---------- */
let supLista = null, tabletas = [], supEdit = null;
const hace = t => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 1 ? 'ahora' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m/60) + ' h' : 'hace ' + Math.round(m/1440) + ' d'; };
async function pintarAjustesSup(){
  const el = $('ajSup'), s = supVigente();
  if (!clave || !s) { el.innerHTML = ''; return; }
  let est = {}; try { est = APP ? JSON.parse(window.Android.estado()) : {}; } catch(e) {}
  const filasTab = tabletas.map(t => {
    const fuera = Date.now() - Date.parse(t.ultimo) > 10 * 60000;
    const prob = [t.avisos === false ? 'sin permiso de avisos' : '', t.lectura === false ? 'botón Capturar apagado' : ''].filter(Boolean);
    const color = fuera ? 'var(--bad)' : prob.length ? 'var(--warn)' : 'var(--ok)';
    return `<div class="tab-fila"><span class="dot" style="background:${color}"></span><div style="min-width:0"><b>${esc(t.plat || 'Sin plataforma')} · ${esc(t.modelo || '')}</b>
      <div class="hint">${fuera ? '<b style="color:var(--bad)">Sin conexión</b> desde ' + esc(hhmm(t.ultimo)) : 'En línea ' + hace(t.ultimo)}${t.bateria != null ? ' · 🔋 ' + t.bateria + ' %' + (t.cargando ? ' cargando' : '') : ''}${prob.length ? ' · <b style="color:var(--warn)">' + esc(prob.join(', ')) + '</b>' : ''} · v${esc(t.version || '?')}${t.id === est.id ? ' · <b>esta tableta</b>' : ''}</div></div></div>`;
  }).join('') || '<p class="hint" style="margin:0">Todavía ninguna tableta con la versión 1.4 ha mandado su estado.</p>';
  const filasSup = (supLista || []).map(x => supEdit === x.id
    ? `<div class="sup-fila"><input id="seNom" value="${esc(x.nombre)}" maxlength="30" style="flex:1;min-width:120px"><input id="sePin" inputmode="numeric" maxlength="4" placeholder="Nueva clave (opcional)" style="width:170px"><button class="btn small" type="button" id="seOk" style="background:var(--honey)">Guardar</button><button class="btn small ghost" type="button" id="seNo">Cancelar</button></div>`
    : `<div class="sup-fila"><div style="flex:1;min-width:0"><b>${esc(x.nombre)}</b> ${x.admin ? '<span class="chip ok" style="font-size:12px">Administrador</span>' : '<span class="chip" style="font-size:12px">Supervisor</span>'}</div><button class="btn small ghost" type="button" data-se="${x.id}">Editar</button>${x.nombre !== s.nombre ? `<button class="btn small ghost" type="button" data-sb="${x.id}">${supEdit === 'borrar:' + x.id ? '¿Seguro? Toca otra vez' : 'Quitar'}</button>` : ''}</div>`).join('');
  el.innerHTML = `
    <div class="card" style="display:grid;gap:8px;border-left:6px solid var(--past)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>Modo supervisor</b><span class="chip past">🔒 ${esc(s.nombre)}${s.admin ? ' · administrador' : ''}</span></div>
      <p class="hint" style="margin:0">${esAdmin() ? 'La sesión se cierra al salir de la app.' : 'Se cierra al salir de Ajustes: la próxima vez se vuelve a pedir la clave.'}</p>
      <div><button class="btn small ghost" type="button" id="supSalir">${esAdmin() ? 'Bloquear la app' : 'Salir del modo supervisor'}</button></div>
    </div>
    ${APP ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="min-width:0"><b>Modo de este equipo</b><div class="hint">${esAdmin() ? '🔑 Administrador: no lee pedidos ni reenvía avisos' : '🧾 Tableta de registro'}</div></div>
      <button class="btn small ghost" type="button" id="ajCambiarModo">Cambiar a ${esAdmin() ? 'tableta de registro' : 'administrador'}</button>
    </div>` : ''}
    <div class="card" style="display:grid;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><b>Captura de pedidos</b><div class="hint">Aplica a las 4 tabletas. Los avisos a Telegram siguen aunque esté apagada.</div></div><button class="sw" type="button" role="switch" id="swCaptura" aria-checked="${capturaOn}" aria-label="Captura de pedidos"></button></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:10px"><div><b>Fotos de pedidos de delivery</b><div class="hint">Si está apagado, ya no se piden fotos en Telegram ni se avisa de pedidos sin foto.</div></div><button class="sw" type="button" role="switch" id="swFotos" aria-checked="${fotosOn}" aria-label="Fotos de pedidos de delivery"></button></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:10px"><div><b>Registro automático</b><div class="hint">Apagado por defecto. Solo el administrador lo activa y se apaga solo a los 30 min. Registra solo pedidos completos y sin dudas.</div></div><button class="sw" type="button" role="switch" id="swAuto" aria-checked="${autoOn}" aria-label="Registro automático"></button></div>
      <div class="solo-registro" style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:10px"><div><b>Modo registro de días pasados</b><div class="hint">${modoReg ? 'Activo: ' + esc(nombreDia(modoReg.dia)) : 'Hasta 30 días atrás, para ponerse al corriente.'}</div></div><button class="btn small" type="button" id="ajModo" style="background:var(--past);color:#fff">${modoReg ? 'Cambiar' : 'Empezar'}</button></div>
    </div>
    <div class="card" style="display:grid;gap:8px">
      <b>Estado de las tabletas</b>
      <div>${filasTab}</div>
      <p class="hint" style="margin:0">Si una deja de reportarse 10 min, se queda con poca batería o pierde permisos, llega aviso a Telegram (todos los días 11:00 a.m.–11:30 p.m.; viernes y sábado hasta 4:30 a.m.).</p>
      ${esAdmin() ? '' : `<label class="eyebrow" for="ajPlat">Esta tableta es de</label>
      <select id="ajPlat"><option value="">— Elegir —</option>${PLATS.map(p => `<option ${est.plat === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`}
    </div>
    ${s.admin ? `<div class="card" style="display:grid;gap:8px">
      <b>Supervisores</b>
      <div>${filasSup || '<p class="hint" style="margin:0">Cargando…</p>'}</div>
      <div class="eyebrow" style="margin-top:6px">Agregar supervisor</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="snNom" placeholder="Nombre" maxlength="30" style="flex:1;min-width:120px"><input id="snPin" inputmode="numeric" maxlength="4" placeholder="Clave de 4 números" style="width:170px"><button class="btn small" type="button" id="snOk" style="background:var(--honey)">Agregar</button></div>
    </div>` : ''}`;
  $('supSalir').onclick = () => {
    $('ajustes').hidden = true;
    if (esAdmin()) { bloquear(); return; }
    sup = null; aviso('Saliste del modo supervisor.'); pintarConfirmar();
  };
  const cm = $('ajCambiarModo');
  if (cm) cm.onclick = () => {
    const nuevo = esAdmin() ? 'registro' : 'admin';
    $('ajustes').hidden = true;
    ponerModoEquipo(nuevo);
    if (nuevo === 'registro') { sup = null; ir('vConfirmar'); aviso('Este equipo ahora es tableta de registro.'); }
    else aviso('Este equipo ahora es de administrador.');
  };
  $('swCaptura').onclick = async () => {
    const v = !capturaOn, ss = supVigente(); if (!ss) { $('ajustes').hidden = true; return; }
    try { const r = await rpc('delivery_sup', {accion:'captura', pin:ss.pin, d:{activa:v}}); ponerCapturaLocal(r.captura !== false); aviso(capturaOn ? 'Captura activada en todas las tabletas' : 'Captura desactivada en todas las tabletas'); }
    catch(e) { aviso(e.message, true); }
    pintarAjustesSup();
  };
  $('swAuto').onclick = async () => {
    const v = !autoOn, ss = supVigente(); if (!ss) { $('ajustes').hidden = true; return; }
    try { const r = await rpc('delivery_auto', {pin:ss.pin, d:{activa:v, minutos:30}}); autoOn = !!r.activa && Date.parse(r.hasta) > Date.now(); autoHasta = autoOn ? Date.parse(r.hasta) : 0; avisarAuto(); aviso(autoOn ? 'Registro automático activado por 30 min' : 'Registro automático apagado'); }
    catch(e) { aviso(e.message, true); }
    pintarAjustesSup();
  };
  $('swFotos').onclick = async () => {
    const v = !fotosOn, ss = supVigente(); if (!ss) { $('ajustes').hidden = true; return; }
    try { const r = await rpc('delivery_fotos', {pin:ss.pin, d:{activa:v}}); fotosOn = r.fotos !== false; aviso(fotosOn ? 'Fotos de delivery activadas' : 'Fotos de delivery desactivadas'); }
    catch(e) { aviso(e.message, true); }
    pintarAjustesSup();
  };
  $('ajModo').onclick = () => { $('ajustes').hidden = true; abrirModoRegistro(); };
  if ($('ajPlat')) $('ajPlat').onchange = e => { if (APP && window.Android.ponerPlataforma) window.Android.ponerPlataforma(e.target.value); aviso('Listo: esta tableta es de ' + e.target.value); };
  if (s.admin) {
    const guardar = async d => { try { supLista = await rpc('delivery_sup', {accion:'guardar', pin:s.pin, d}); if (d.pin && d.id && supLista && s.nombre === d.nombre) s.pin = d.pin; supEdit = null; aviso('Supervisor guardado'); } catch(e) { aviso(e.message, true); } pintarAjustesSup(); };
    $('snOk').onclick = () => guardar({nombre:$('snNom').value, pin:$('snPin').value});
    el.querySelectorAll('[data-se]').forEach(b => b.onclick = () => { supEdit = b.dataset.se; pintarAjustesSup(); });
    el.querySelectorAll('[data-sb]').forEach(b => b.onclick = async () => {
      if (supEdit !== 'borrar:' + b.dataset.sb) { supEdit = 'borrar:' + b.dataset.sb; pintarAjustesSup(); return; }
      try { supLista = await rpc('delivery_sup', {accion:'borrar', pin:s.pin, d:{id:b.dataset.sb}}); supEdit = null; aviso('Supervisor quitado'); } catch(e) { aviso(e.message, true); }
      pintarAjustesSup();
    });
    const ok = $('seOk'); if (ok) ok.onclick = () => { const x = supLista.find(z => z.id === supEdit); const pin = $('sePin').value.trim(); guardar({id:supEdit, nombre:$('seNom').value, pin, admin:x && x.admin}).then(() => { if (x && x.nombre === s.nombre && pin) s.pin = pin; }); };
    const no = $('seNo'); if (no) no.onclick = () => { supEdit = null; pintarAjustesSup(); };
  }
  // Datos frescos (sin repintar en bucle)
  if (!pintarAjustesSup.cargando) {
    pintarAjustesSup.cargando = true;
    try {
      const [rt, rl] = await Promise.all([sb('GET', 'delivery_tabletas', '?select=*&order=plat.asc'), s.admin ? rpc('delivery_sup', {accion:'lista', pin:s.pin}) : Promise.resolve(null)]);
      if (rt.ok) tabletas = await rt.json();
      if (rl) supLista = rl;
    } catch(e) {}
    pintarAjustesSup.cargando = false;
    if (!$('ajustes').hidden && !document.activeElement.matches('#ajSup input')) { pintarAjustesSup.cargando = 'listo'; await pintarAjustesSup(); pintarAjustesSup.cargando = false; }
  }
}

/* ---------- todo ---------- */

/* ---------- Analíticas (modo administrador) ---------- */
let anRango = '7', anDatos = null, anCargando = false, anError = '';
const DSEM = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const nEnt = v => Math.round(Number(v) || 0).toLocaleString('es-MX');
function rangoFechas(r){
  const h = new Date(), d = new Date(h);
  if (r === 'hoy') return [isoDia(h), isoDia(h)];
  if (r === 'ayer') { d.setDate(d.getDate() - 1); return [isoDia(d), isoDia(d)]; }
  if (r === 'mes') return [isoDia(new Date(h.getFullYear(), h.getMonth(), 1)), isoDia(h)];
  d.setDate(d.getDate() - (Number(r) - 1)); return [isoDia(d), isoDia(h)];
}
async function cargarAnalitica(){
  if (!SYNC()) { anError = 'Primero pon la clave de la sucursal en Ajustes.'; pintarAnalitica(); return; }
  const [desde, hasta] = rangoFechas(anRango);
  anCargando = true; anError = ''; pintarAnalitica();
  try { anDatos = await rpc('delivery_analitica', {d: {desde, hasta}}); }
  catch(e) { anError = e.message || 'No se pudo cargar'; }
  anCargando = false; pintarAnalitica();
}
function barrasHtml(filas, etiqueta, valor, fmt){
  const max = Math.max(1, ...filas.map(valor));
  const top = filas.length ? Math.max(...filas.map(valor)) : 0;
  return '<div class="an-barras">' + filas.map(f => { const v = valor(f);
    return `<div class="an-barra ${v === top && v > 0 ? 'pico' : ''}"><span>${etiqueta(f)}</span><i style="width:${Math.max(1, v / max * 100)}%"></i><span class="v">${fmt ? fmt(f) : nEnt(v)}</span></div>`; }).join('') + '</div>';
}
function pintarAnalitica(){
  const el = $('vAnalitica'); if (!el) return;
  const rangos = [['hoy','Hoy'],['ayer','Ayer'],['7','7 días'],['30','30 días'],['mes','Este mes']];
  let h = `<div class="fila-tit" style="margin-bottom:12px"><h2 style="margin:0;font:800 30px/1.1 var(--display)">Analíticas de delivery</h2></div>
    <div class="an-rangos">${rangos.map(([k,n]) => `<button type="button" data-r="${k}" aria-pressed="${anRango===k}">${n}</button>`).join('')}
    <span class="hint">${anCargando ? 'Cargando…' : anDatos ? esc(nombreDia(anDatos.desde)) + (anDatos.hasta !== anDatos.desde ? ' al ' + esc(nombreDia(anDatos.hasta)) : '') : ''}</span></div>`;
  if (anError) h += `<div class="empty">${esc(anError)}</div>`;
  const a = anDatos;
  if (a && !anError) {
    const pz = a.pizzas || {}, dias = a.dias || 1, pr = a.pronostico || {};
    const prods = a.productos || [];
    const cat = c => prods.filter(x => x.cat === c);
    const suma = c => cat(c).reduce((t, x) => t + Number(x.qty || 0), 0);
    h += `<div class="stats">
      <div class="stat total"><span class="eyebrow">Pizzas</span><b class="num">${nEnt(pz.total)}</b><div class="an-sub"><span>35 cm ${nEnt(pz.t35)}</span><span>40 cm ${nEnt(pz.t40)}</span></div></div>
      <div class="stat" style="--c:var(--honey)"><span class="eyebrow">Orillas</span><b class="num">${nEnt(pz.orillas)}</b><div class="an-sub"><span>Queso ${nEnt(pz.queso)}</span><span>Puff ${nEnt(pz.puff)}</span><span>Queen ${nEnt(pz.queen)}</span>${Number(pz.wings) ? `<span>Cheesy Wings ${nEnt(pz.wings)}</span>` : ''}</div></div>
      <div class="stat" style="--c:var(--ok)"><span class="eyebrow">Promedio al día</span><b class="num">${nEnt(Number(pz.total||0) / dias)}</b><span class="hint">pizzas · ${pl(dias,'día')} con pedidos</span></div>
      <div class="stat" style="--c:var(--ink)"><span class="eyebrow">Pedidos</span><b class="num">${nEnt(a.pedidos)}</b><span class="hint">${dinero(a.venta)}</span></div>
      <div class="stat" style="--c:var(--resv)"><span class="eyebrow">Pizzas en combo</span><b class="num">${nEnt(pz.en_combo)}</b><span class="hint">${pl(Math.round(suma('Combos')), 'combo')}</span></div>
    </div>`;
    // Pronóstico para producción
    const DS = pr.dia ? DSEM[new Date(pr.dia + 'T12:00').getDay() || 7] : '';
    h += `<section class="card an-pron"><div class="fila-tit"><h3>Producción para ${esc(DS ? DS.toLowerCase() : 'mañana')}</h3><span class="chip">${pr.semanas ? 'promedio de ' + pl(pr.semanas, DS.toLowerCase()) + ' anteriores' : 'sin datos suficientes'}</span></div>
      ${pr.semanas ? `<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-end;margin-top:10px"><div><b class="num">~${nEnt(pr.pizzas)}</b><div class="hint">pizzas esperadas</div></div>
      <div class="an-sub"><span>Con orilla ${nEnt(pr.orillas)}</span><span>Queso ${nEnt(pr.queso)}</span><span>Puff ${nEnt(pr.puff)}</span><span>Queen ${nEnt(pr.queen)}</span>${Number(pr.wings) ? `<span>Cheesy Wings ${nEnt(pr.wings)}</span>` : ''}<span>40 cm ${nEnt(pr.t40)}</span></div></div>` : '<p class="hint">Se calcula con el mismo día de las 4 semanas anteriores.</p>'}</section>`;
    h += '<div class="an-grid">';
    // Por hora
    const horas = a.por_hora || [];
    h += `<section class="card"><div class="fila-tit"><h3>¿A qué hora?</h3><span class="hint">pizzas por hora</span></div>
      ${horas.length ? barrasHtml(horas, f => pad(f.h) + ':00', f => Number(f.pizzas), f => nEnt(f.pizzas)) : '<p class="hint">Sin pedidos con hora.</p>'}
      <p class="hint" style="margin-bottom:0">Hora real de ${nEnt(a.hora_real)} de ${nEnt(a.pedidos)} pedidos (Uber la trae en el pedido, DiDi en su aviso; Rappi se suma conforme se registre al momento).</p></section>`;
    // Por día de la semana
    const sem = a.por_semana || [];
    if (sem.length > 1) h += `<section class="card"><div class="fila-tit"><h3>Por día de la semana</h3><span class="hint">promedio de pizzas</span></div>
      ${barrasHtml(sem, f => DSEM[f.dow].slice(0,3), f => Number(f.prom), f => nEnt(f.prom))}</section>`;
    // Por día
    const pd = a.por_dia || [];
    if (pd.length > 1) h += `<section class="card"><div class="fila-tit"><h3>Día por día</h3></div><div class="tw"><table><thead><tr><th>Día</th><th class="n">Pedidos</th><th class="n">Pizzas</th><th class="n">40 cm</th><th class="n">Orillas</th></tr></thead><tbody>${
      pd.slice().reverse().map(f => `<tr><td>${esc(new Date(f.dia + 'T12:00').toLocaleDateString('es-MX', {weekday:'short', day:'numeric', month:'short'}))}</td><td class="n">${f.pedidos}</td><td class="n">${nEnt(f.pizzas)}</td><td class="n">${nEnt(f.t40)}</td><td class="n">${nEnt(f.orillas)}</td></tr>`).join('')}</tbody></table></div></section>`;
    // Por plataforma
    const pp = a.por_plat || [];
    h += `<section class="card"><div class="fila-tit"><h3>Por plataforma</h3></div><ul class="an-lista">${pp.map(f => `<li><span><b style="color:${PCOLOR[f.plat]||'var(--ink)'}">${esc(f.plat)}</b> <small>${f.pedidos} pedidos</small></span><span><b>${nEnt(f.pizzas)}</b> <small>pizzas · ${dinero(f.venta)}</small></span></li>`).join('')}</ul></section>`;
    // Productos por categoría
    const lista = (c, titulo, extra) => { const fs = cat(c); if (!fs.length) return '';
      return `<section class="card"><div class="fila-tit"><h3>${titulo}</h3><span class="chip">${nEnt(suma(c))}</span></div><ul class="an-lista">${fs.map(f => `<li><span>${esc(f.n)}${extra ? ' ' + extra(f) : ''}</span><b>${nEnt(f.qty)}</b></li>`).join('')}</ul></section>`; };
    h += lista('Pizzas', 'Pizzas', f => [Number(f.t40) ? '40 cm ' + nEnt(f.t40) : '', Number(f.orillas) ? 'orilla ' + nEnt(f.orillas) : '', Number(f.en_combo) ? 'en combo ' + nEnt(f.en_combo) : ''].filter(Boolean).map(t => `<small>· ${t}</small>`).join(' '));
    h += lista('Combos', 'Combos') + lista('Bebidas', 'Bebidas') + lista('Complementos', 'Complementos') + lista('Postres', 'Postres') + lista('Extras', 'Extras y aderezos');
    h += '</div>';
  } else if (!anError && !anCargando) h += '<div class="empty">Toca un periodo para ver las analíticas.</div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { anRango = b.dataset.r; cargarAnalitica(); });
}
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
  detectado = false;
  texto = String(t || ''); plataformaHint = PLATS.includes(plataforma) ? plataforma : ''; metodo = met || '';
  order = null; resumen = null; fechaOk = false; verInfo = false; ultimoId = null; leer();
  if (modoReg) tocarModo();
  // No se leyó ni un pedido ni un resumen de ventas: ventana emergente en lugar de un pedido vacío
  const nada = !resumen && (!order || (!order.products.length && !order.number && order.total == null));
  if (nada) {
    if (SYNC()) sb('POST', 'delivery_lecturas', '', {plat: plataformaHint || null, tableta: plataformaHint || null, metodo: metodo || null,
      motivo: 'nada detectado', version: 'web', texto: texto.slice(0, 12000)}).catch(() => {});
    order = null; estadoConf = 'vacio'; ir('vConfirmar');
    $('modalCaja').innerHTML = `<h2>No se ha detectado pedido o corte</h2>
      <p class="hint" style="margin:0">Abre el pedido completo (con sus productos y el total) o el historial de ventas del día, y vuelve a tocar el hexágono.</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">${APP ? `<button class="btn primary" type="button" id="ndVolver">Volver a ${esc(plataformaHint || 'la app')}</button>` : ''}<button class="bt lt" type="button" id="ndCerrar">Cerrar</button></div>`;
    $('modal').hidden = false;
    $('ndCerrar').onclick = cerrarModal;
    const v = $('ndVolver'); if (v) v.onclick = () => { cerrarModal(); window.Android.volver(); };
    return;
  }
  ir('vConfirmar');
  // Si no salió ningún producto, se guarda lo que leyó la tableta para poder corregir el lector
  if (SYNC() && order && (!order.products.length || order.total == null)) {
    let est = {}; try { est = JSON.parse(window.Android.estado()); } catch(e) {}
    sb('POST', 'delivery_lecturas', '', {plat: order.platform || plataformaHint || null, tableta: plataformaHint || null, metodo: metodo || null,
      motivo: !order.products.length ? 'sin productos' : 'sin total', version: (est.version || 'web') + '/' + (est.web || ''), texto: texto.slice(0, 12000)}).catch(() => {});
  }
  const d = resumen ? (resumen.dia || hoy()) : dayOf();
  if (SYNC()) { await refrescar(d); pintarConfirmar(); }
};
/* Pedido detectado en pantalla (sin tocar nada): si la lectura está completa y es nuevo, lo pregunta.
   Con el registro automático activo y limpio, lo registra y avisa. Nunca pisa un pedido que se está revisando. */
/* Números de pedido ya registrados hoy → la tableta no los vuelve a leer al abrirlos */
function avisarRegistrados(){
  if (!APP || !window.Android.ponerRegistrados) return;
  try { window.Android.ponerRegistrados(JSON.stringify([...new Set(getLog(hoy()).map(o => String(o.number || '')).filter(Boolean))])); } catch(e) {}
}
function avisarAuto(){ if (APP && window.Android.ponerAuto) { try { window.Android.ponerAuto(autoOn ? autoHasta : 0); } catch(e) {} } }
window.pedidoDetectado = async (t, plataforma, lanzada) => {
  // «lanzada»: Bee's se abrió solo para registrar en automático; si no registra, regresa a la app de pedidos
  const regresar = () => { if (lanzada && APP && window.Android.volver) { try { window.Android.volver(); } catch(e) {} } };
  if (!SYNC()) return regresar();
  await refrescar(dayOf());
  // Si en Confirmar quedó otro pedido a medias: en automático (o si es el mismo) se sigue; si no, no se pisa
  if (estadoConf === 'pedido' && order && !(autoOn && Date.now() < autoHasta) && !lanzada) return regresar();
  // Si al final no se usa la lectura, la pantalla regresa exactamente a como estaba
  const antes = {texto, order, resumen, estadoConf, plataformaHint, metodo, fechaOk, verInfo, ultimoId};
  const descartar = () => { ({texto, order, resumen, estadoConf, plataformaHint, metodo, fechaOk, verInfo, ultimoId} = antes); regresar(); };
  texto = String(t || ''); plataformaHint = PLATS.includes(plataforma) ? plataforma : ''; metodo = 'detectado';
  order = null; resumen = null; fechaOk = false; verInfo = false; ultimoId = null; leer();
  const completo = order && order.platform && order.number && order.products.length && order.total != null
    && !order.numDudoso && !order.mixedNumbers && (!order.expected || order.readQty === order.expected);
  // En automático, si no se puede registrar solo, avisa por Telegram para registrarlo a mano
  const fallo = (motivo) => { if (autoOn && Date.now() < autoHasta && APP && window.Android.avisoFallo) { try { window.Android.avisoFallo(plataformaHint || (order && order.platform) || '', String((order && order.number) || ''), motivo); } catch(e) {} } };
  if (!completo) { fallo('la lectura salió incompleta'); return descartar(); }  // no molesta; queda el botón
  if (buscarDup(dayOf()).igual) return descartar();  // ya está en el registro
  const limpio = !excelLines(order).pending && !order.alerts.length && !buscarDup(dayOf()).otros.length && !modoReg;
  if (autoOn && Date.now() < autoHasta && limpio) {
    const n = order.number;
    registrandoAuto = true; await registrar();
    aviso('Pedido #' + n + ' registrado automáticamente.');
    // Si Bee's estaba atrás (en otra app), no la trae al frente: se queda registrando en silencio
    if (!lanzada && document.hidden) { clearTimeout(timerVolver); estadoConf = 'vacio'; }
    return;
  }
  fallo('necesita revisión (' + (order.alerts.length ? order.alerts.length + ' alerta(s)' : 'productos sin acomodar') + '); quedó en la pantalla de confirmar');
  detectado = true; ir('vConfirmar'); pintarConfirmar();
};
window.actualizarEstado = () => { pintarAjustes(); if (estadoConf === 'vacio') pintarConfirmar(); if (SYNC()) subirCola(); };

if (modoReg) viewDay = modoReg.dia;
pintarModo();
if (SYNC()) { refrescar(viewDay).then(() => { pintarTodo(); subirCola(); }); setInterval(() => { subirCola(); }, 60000); }
pintarTodo();
revisarModo(true);
setTimeout(resumenesPendientes, 2500);
})();
