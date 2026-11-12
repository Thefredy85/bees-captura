/* Motor de lectura de pedidos y resúmenes de Bee's Captura (compartido por la app y el Lector web) */
/*PARSER-START*/
const norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const STOP = new Set(['pizza','de','la','el','del','con','y','orden','agua','ml','cola','regular']);
const tokens = s => norm(s).replace(/\b(pzas|piezas|pza|pzs)\b/g,'pz').replace(/\b2 ?l(ts|itros)?\b/g,'2l').split(' ').filter(t => t && !STOP.has(t));
function near(a,b){
  if (a===b) return true;
  if (Math.min(a.length,b.length) < 5 || Math.abs(a.length-b.length) > 1) return false;
  let i=0,j=0,ed=0;
  while (i<a.length && j<b.length){
    if (a[i]===b[j]){ i++; j++; continue; }
    if (++ed > 1) return false;
    if (a.length>b.length) i++; else if (b.length>a.length) j++; else { i++; j++; }
  }
  return ed + (a.length-i) + (b.length-j) <= 1;
}

// Productos con los mismos nombres que usa el comandero para llenar el formato REGISTRO DELIVERY
const CATALOG = [
  {cat:'Pizzas', names:['Bee Cheesy Wings','Bee Classic','Bee Meat Mania','Bee Mexican Pizza','Bee Mix Manía (Hawaiana)','Bee Mix Manía (Mexicana)','Bee Mix Manía (Meat Mania)','Bee Mix Manía (Tropical Spicy)','Bee Mix Manía (Vegetariana)','Bee Taco Pizza','Bee Tropical Puff','Bee Veggie','Double Cheese','Hawaiian Bee','Supreme Bee','Tropical Bee Spicy','Xtreme Bee','Queen Bee','Pibil Bee']},
  {cat:'Combos', names:['Combo Antojo','Bee Cheesy Pack','Bee Crunch','Bee Double Date','Bee Hawaiian Combo','Bee Pizza & Chicken','Tropical Feast','Combo Queen Bee','Bee Duo','Combo Pibil Bee','Combo Clásico']},
  {cat:'Complementos', names:['Cheesy Bombs 8 pz','Cheesy Bombs 12 pz','Bee Crust (Pepperoni)','Bee Crust (Hawaiano)','Bee Crust (Queso)','Bee Crust (Champiñones)','Bee’s Chicken','Bee’s Wings','Bumblebee Hawaianos','Bumblebee Pepperoni','Bumblebee Mexicanos','Bumblebee de Queso','Papas Gajo']},
  {cat:'Postres', names:['Canela Dips','Sweet Bee Bites 8 pz','Sweet Bee Bites 12 pz']},
  {cat:'Bebidas', names:['Bee Water (Jamaica)','Bee Water (Limón con Chía)','Bee Water (Maracuyá)','Bee Water (Horchata)','Agua Mineral 600','Agua Natural 600','Coca 2L','Coca 600','Coca Light 600','Coca Zero 600','Fanta 2L','Fanta 600','Fuze Tea Durazno','Fuze Tea Frutos Rojos','Fuze Tea Limón','Mundet 2L','Mundet 600','Sprite 2L','Sprite 600']},
  {cat:'Extras', names:['Orilla de queso','Aderezo BBQ','Aderezo Búfalo','Aderezo Mango Habanero','Aderezo Ranch','Bee Sauce','Bee Sauce Chipotle','Dip de Queso']},
];
const EXTRA_NAMES = new Set(CATALOG.find(c=>c.cat==='Extras').names);
const COMBO_NAMES = new Set(CATALOG.find(c=>c.cat==='Combos').names);
const ALL_NAMES = CATALOG.flatMap(c=>c.names);
const WATER = [[/horchata/,'Bee Water (Horchata)'],[/jamaica/,'Bee Water (Jamaica)'],[/maracuya/,'Bee Water (Maracuyá)'],[/chia/,'Bee Water (Limón con Chía)']];
// Piezas fijas de cada combo (del menú del comandero). Lo que el cliente elige llega como opción del pedido.
const COMBO_FIJO = {
  'Combo Clásico':['Supreme Bee'], 'Combo Antojo':['Supreme Bee','Papas Gajo','Dip de Queso'],
  'Bee Crunch':['Xtreme Bee','Papas Gajo','Dip de Queso'], 'Bee Hawaiian Combo':['Hawaiian Bee','Bee’s Chicken'],
  'Bee Double Date':['Papas Gajo'], 'Bee Pizza & Chicken':['Bee’s Chicken'],
  'Tropical Feast':['Bee Tropical Puff','Papas Gajo','Dip de Queso'], 'Bee Cheesy Pack':['Bee Tropical Puff','Papas Gajo'],
  'Combo Pibil Bee':['Pibil Bee','Sweet Bee Bites 8 pz'], 'Bee Duo':[], 'Combo Queen Bee':['Queen Bee']
};

const DEFAULT_DICT = {
  'tropical spicy': {excel:'Tropical Bee Spicy', tipo:'producto'},
  'pizza tropical spicy': {excel:'Tropical Bee Spicy', tipo:'producto'},
  'bee hawaiian': {excel:'Hawaiian Bee', tipo:'producto'},
  'aderezo mango habanero': {excel:'Aderezo Mango Habanero', tipo:'extra'},
  'orilla de queso': {excel:'Orilla de queso', tipo:'extra'},
  'bee sauce chipotle': {excel:'', tipo:'incluido'},
  'dip chocolate liquido': {excel:'', tipo:'incluido'},
  'agua bee water': {excel:'Bee Water', tipo:'segun-opcion'},
  'bee water': {excel:'Bee Water', tipo:'segun-opcion'},
};
const MIX_ESP = [[/hawai/,'Hawaiana'],[/mexic/,'Mexicana'],[/meat/,'Meat Mania'],[/tropical|spicy/,'Tropical Spicy'],[/veg/,'Vegetariana']];

function resolve(name, dict){
  const k = norm(name).replace(/\bpromocion\b/g,'').trim();
  if (dict[k]) return {...dict[k]};
  const fl = WATER.find(([re]) => re.test(k));
  if (fl && !/\b(fuze|tea)\b/.test(k)) return {excel:fl[1], tipo:'producto', sabor:true};
  if (/\b(pepe|pp|mix)\b/.test(k)) {
    const esp = (MIX_ESP.find(([re]) => re.test(k))||[])[1];
    return esp ? {excel:'Bee Mix Manía ('+esp+')', tipo:'producto'} : null;
  }
  const kt = tokens(name);
  let best = null, bestN = 0;
  for (const n of ALL_NAMES){
    const nt = tokens(n);
    if (nt.length && nt.length > bestN && nt.every(t => kt.some(u => near(t,u)))) { best = n; bestN = nt.length; }
  }
  return best ? {excel:best, tipo: EXTRA_NAMES.has(best) ? 'extra' : 'producto'} : null;
}

const PRICE = '(?:MXN\\s*|MX|Mex)?\\$?\\s*([\\d,]+\\.\\d{1,2})';
const MONEY = new RegExp(PRICE, 'i');
const ITEM = new RegExp('^([0-9lIi|]{1,2})\\s*[xX×]\\s*(.+?)\\s*(?:[–—-]+|'+PRICE+'(?:\\s+'+PRICE+')?)?\\s*$');
const MONEY_ONLY = /^\(?(MXN\s*|MX|Mex)?\$?\s?[\d,]+\.\d{1,2}\)?$/i;
// Reservándonos: «Bee Classic 35cm» y abajo «[1] X Mex$ 133.0»
const RESV_QTY = /^\W{0,2}([0-9lI]{1,2})\W{0,2}\s*[xX×]\s*Mex\s?\$\s*([\d,]+(?:\.\d{1,2})?)$/i;
const RESV_LISTA = /^[^$#:]+?\s[xX×]\s?\d{1,2}(\s*,\s*[^$#:]+?\s[xX×]\s?\d{1,2})*$/;
const UBER_HEAD = /^(.+?)\s*[•·]\s*([A-Z0-9]{4,8})$/;
// Solo los números largos (Rappi) y el encabezado de Uber separan capturas; los #18 de DiDi pueden ser la lista de pedidos
const isNumLine = l => /^#\s?\d{6,}$/.test(l) || UBER_HEAD.test(l);
const SOLO_QTY = /^[0-9lIi|]{1,2}\s*[xX×]$/;
const GUION = /^[–—-]+$/;
const DOS_PRECIOS = new RegExp('^'+PRICE+'\\s+'+PRICE+'$', 'i');
const ETQ_TOTAL = /^(subtotal|oferta especial|total|descuentos?|promoci[oó]n|propina|tarifa|cargo|impuestos?|iva|ajuste de la cuota.*|cuota de servicio.*)$/i;
const VALOR = /^\(?-?(MXN\s*|MX|Mex)?\$?\s?[\d,]+\.\d{1,2}\)?$/i;
// Lo leído en pantalla puede venir partido: "1x" / "Pizza" / "$329.00". Aquí se vuelve a juntar.
function prepass(lines){
  const out = [];
  const mex = lines.some(x => /mex\s?\$/i.test(x));
  const MEXP = /^mex\s?\$\s*[\d,]+(?:\.\d{1,2})?$/i;
  for (let i=0;i<lines.length;i++){
    let l = lines[i];
    if (mex) {
      // Reservándonos: la cajita «[1]», la «X» y el precio pueden llegar en renglones separados
      if (/^\[?\s?\d{1,2}\s?\]?$/.test(l) && lines[i+1] && /^[xX×]$/.test(lines[i+1])) { l = l+' X'; i++; if (lines[i+1] && MEXP.test(lines[i+1])) l = l+' '+lines[++i]; }
      else if (/^\[?\s?\d{1,2}\s?\]?$/.test(l) && lines[i+1] && /^[xX×]\s*mex/i.test(lines[i+1])) l = l+' '+lines[++i];
      else if (/^[xX×]$/.test(l) && lines[i+1] && MEXP.test(lines[i+1])) l = '1 X '+lines[++i];
      else if (/^[xX×]\s*mex/i.test(l)) l = '1 '+l;
      // el importe del renglón pudo llegar antes que la cantidad
      // sin cajita de cantidad: «Bee Classic 35cm» y abajo solo «Mex$ 133.0»
      if (!RESV_QTY.test(l) && !MONEY_ONLY.test(l) && !ITEM.test(l) && !IGNORE.test(l) && !/total|env[ií]o|^comentario|^id de pedido|^tiempo|^cliente|^repartidor/i.test(l)
          && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(l) && lines[i+1] && MEXP.test(lines[i+1]) && !(lines[i+2] && /^\[?\s?\d{1,2}\s?\]?$|^[xX×]/.test(lines[i+2]))) {
        const pr = lines[++i]; if (lines[i+1] && lines[i+1] === pr) i++;
        out.push('1x '+l+' $'+parseFloat(pr.replace(/[^\d.]/g,'')).toFixed(2)); continue;
      }
      if (RESV_QTY.test(l) && out.length > 1 && MEXP.test(out[out.length-1]) && !ITEM.test(out[out.length-2]) && !MONEY_ONLY.test(out[out.length-2])) out.pop();
    }
    if (SOLO_QTY.test(l) && lines[i+1]) l = l+' '+lines[++i];
    if (GUION.test(l) && !/^-{3,}$/.test(l)) continue;      // «---» separa pantallas al bajar: se conserva
    // Uber: «Subtotal / Oferta especial / Total» y abajo sus importes en el mismo orden → se emparejan
    if (ETQ_TOTAL.test(l)) {
      let k = i; while (k < lines.length && ETQ_TOTAL.test(lines[k])) k++;
      const n = k - i; let v = 0; while (v < n && lines[k+v] && VALOR.test(lines[k+v])) v++;
      if (n > 1 && v === n) { for (let a=0; a<n; a++) out.push(lines[i+a]+' '+lines[k+a]); i = k+n-1; continue; }
    }
    const rq = l.match(RESV_QTY);
    if (rq && out.length && !ITEM.test(out[out.length-1]) && !MONEY_ONLY.test(out[out.length-1])) {
      const nombre = out.pop(); const q = parseInt(rq[1],10) || 1; const pu = parseFloat(rq[2].replace(/,/g,''));
      l = q + 'x ' + nombre + ' $' + (pu*q).toFixed(2);
      if (lines[i+1] && MONEY_ONLY.test(lines[i+1])) i++;      // importe del renglón
      out.push(l); continue;
    }
    if (RESV_LISTA.test(l) && !ITEM.test(l)) {                 // «Bee Classic 35cm x 1, Bee's Chicken x 1»
      l.split(/\s*,\s*/).forEach(parte => { const mm = parte.match(/^(.+?)\s[xX×]\s?(\d{1,2})$/); if (mm) out.push(mm[2] + 'x ' + mm[1]); });
      continue;
    }
    const m = l.match(ITEM);
    if (m && !m[3]) {
      let j = i+1; const prices = [];
      if (lines[j] && /^promoci[oó]n$/i.test(lines[j])) { l = l+' Promoción'; j++; i++; }
      else if (lines[j] && /^(combo|nuevo|m[aá]s vendido)$/i.test(lines[j])) { j++; i++; }   // etiqueta junto al nombre (DiDi)
      if (lines[j] && DOS_PRECIOS.test(lines[j])) { prices.push(lines[j]); j++; }
      while (prices.length < 2 && lines[j] && MONEY_ONLY.test(lines[j]) && !/^\(/.test(lines[j])) { prices.push(lines[j]); j++; }
      if (prices.length) { l = l+' '+prices.join(' '); i = j-1; }
    }
    if (out.length && out[out.length-1] === l) continue;
    out.push(l);
  }
  return out;
}
const IGNORE = /^(datos de facturaci|tel\s*:|tengo un producto agotado|historial de [oó]rdenes|detalle de orden|bess?.?s pizza|aliados|rappitendero|estamos buscando|c[oó]digos rt|gestor de tiendas|turbo$|m[aá]s opciones|ir a detalles|pedido listo|aceptaci[oó]n autom|procesamiento restante|preparar pedido|llegar[aá] en|listo en \d+|listo$|ajustar pedido|un socio de la app|pedido cuando|cliente nuevo|no$|oferta especial|detalle de la orden|tiempo de la orden|direcci[oó]n de entrega|repartidor|uber_direct|tipo de pago|liquidaci[oó]n de pagos|los gastos de env|terminado$|aceptado$|despacho$|seguir en uber|vista$|listo para recoger|pedidos en vivo|nuevo$|aceptar$|procesando$|imprimir recibo|soporte didi|entregado$|costo de promoci|el usuario recibi|pedido recibido$|se inici[oó] la preparaci|el usuario repartidor|entrega iniciada|lleg[oó] a la ubicaci)/i;
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DATE2 = /\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i;
const DATE = new RegExp('\\b(\\d{1,2})\\s+(?:de\\s+)?('+MONTHS.join('|')+')\\s+(?:de\\s+)?(\\d{4})\\b','i');
const money = s => { const m = String(s).match(MONEY); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };

function isHeader(l){
  if (ITEM.test(l) || IGNORE.test(l)) return false;
  if (/^(comentarios?|notas del pedido|cliente)/i.test(l)) return false;
  if (/^(elige|desear?|selecciona|escoge|agrega|quieres)\b/i.test(l) || (/^[¿A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(l) && /\?$/.test(l) && l.length < 60)) return true;
  const letters = l.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g,'');
  return letters.length >= 4 && l.length < 60 && l === l.toUpperCase() && !MONEY.test(l);
}

function detectPlatform(text){
  if (/mex\s?\$|id de pedido|reserv[aá]ndonos/i.test(text)) return 'Reservándonos';
  if (/uber|ajustar pedido|\d+\s+art[ií]culos?|MXN\s?\d|socio de la app/i.test(text)) return 'Uber';
  if (/rappi|total sugerido|detalle de orden/i.test(text)) return 'Rappi';
  if (/MX\$|precio total del art|preparar pedido|didi|ir a detalles/i.test(text)) return 'DiDi';
  if (/uber/i.test(text)) return 'Uber';
  if (/reservandonos|reservándonos/i.test(text)) return 'Reservándonos';
  return '';
}

function splitSegments(lines){
  const segs = [[]]; let seenNum = false;
  for (const l of lines){
    if (/^-{3,}/.test(l) || /^(captura|pantalla)\s*\d*/i.test(l)) { if (segs[segs.length-1].length) { segs.push([]); seenNum = false; } continue; }
    if (isNumLine(l)) { if (seenNum) { segs.push([]); } seenNum = true; }
    segs[segs.length-1].push(l);
  }
  return segs.filter(s => s.length);
}

function parseSegment(lines, dict){
  const seg = {number:'', nums:[], products:[], orphans:0, orderNotes:[], alerts:[], total:null, totalNote:'', expected:null, date:'', client:''};
  let cur = null, inMod = false, lastWasMod = false, mode = '';
  for (let i=0;i<lines.length;i++){
    const l = lines[i];
    const num = l.match(/^#\s?(\d+)$/); if (num) { seg.nums.push(num[1]); if (!seg.number) seg.number = num[1]; continue; }
    const idp = l.match(/id de pedido\s*[:#]*\s*#?\s*(\d{6,})/i); if (idp) { if (!seg.number) seg.number = idp[1]; continue; }
    if (/\+\d{2}\s?\d{7,}/.test(l)) continue;                     // teléfono del cliente: no se guarda
    const uh = l.match(UBER_HEAD); if (uh) { if (!seg.number) seg.number = uh[2]; if (!seg.client) seg.client = uh[1]; continue; }
    const na = l.match(/^(\d+)\s+art[ií]culos?\b/i); if (na) { seg.expected = parseInt(na[1],10); continue; }
    if (/^subtotal/i.test(l)) continue;
    const dm = l.match(DATE); if (dm && !ITEM.test(l)) { if (!seg.date) seg.date = dm[3]+'-'+String(MONTHS.indexOf(dm[2].toLowerCase())+1).padStart(2,'0')+'-'+dm[1].padStart(2,'0'); continue; }
    const d2 = l.match(DATE2); if (d2 && !ITEM.test(l)) { if (!seg.date) seg.date = d2[3]+'-'+String(['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(d2[1].toLowerCase())+1).padStart(2,'0')+'-'+d2[2].padStart(2,'0'); continue; }
    const np = l.match(/^(\d+)\s+productos?$/i); if (np) { seg.expected = parseInt(np[1],10); continue; }
    if (/^(cliente|usuario)$/i.test(l)) {
      let j = i+1; while (lines[j] && /pidi[oó]|vez\/veces/i.test(lines[j])) j++;
      const nx = lines[j]; if (nx && !IGNORE.test(nx) && !ITEM.test(nx)) { seg.client = nx; i = j; }
      continue;
    }
    if (/^socio repartidor$/i.test(l)) {                          // DiDi historial: nombre del repartidor y estado
      if (lines[i+1] && !ITEM.test(lines[i+1])) i++;
      if (lines[i+1] && /^(entregad|en camino|recogid|asignad|esperando)/i.test(lines[i+1])) i++;
      continue;
    }
    if (/reembolso|pedido cancelado|orden cancelada/i.test(l)) { seg.alerts.push(l); continue; }
    if (IGNORE.test(l)) continue;
    if (/^notas del pedido/i.test(l)) { mode='orderNote'; continue; }
    const cm = l.match(/^comentarios?\s*:?\s*(.*)$/i);
    if (cm) { mode='comment'; if (cm[1] && cur && !cur.notes.includes(cm[1])) cur.notes.push(cm[1]); continue; }
    if (/total|^ganancia/i.test(l)) {
      const v = money(l) ?? (lines[i+1] && MONEY_ONLY.test(lines[i+1]) ? money(lines[i+1]) : null);
      if (/^total\b/.test(l) && seg.subtotal == null && v != null) { seg.subtotal = v; mode=''; continue; }   // Reservándonos: «total» en minúscula = sin envío
      if (/ganancia/i.test(seg.totalNote) && !/ganancia/i.test(l)) { mode=''; continue; }   // DiDi: lo que manda es la ganancia
      if (v != null) seg.total = v;
      seg.totalNote = /ganancia/i.test(l) ? 'ganancia después del descuento' : /sin promoci/i.test(l) ? 'sin promoción' : (/sugerido/i.test(l) ? 'sugerido a facturar' : seg.totalNote);
      mode=''; continue;
    }
    const m = l.match(ITEM);
    if (m) {
      mode='';
      const qty = parseInt(m[1].replace(/[lIi|]/g,'1'),10) || 1;
      const promo = /promoci[oó]n/i.test(m[2]);
      const name = m[2].replace(/\s+promoci[oó]n\s*$/i,'').trim();
      const price = m[3] ? parseFloat(m[3].replace(/,/g,'')) : null;
      const listPrice = m[4] ? parseFloat(m[4].replace(/,/g,'')) : null;
      const map = resolve(name, dict);
      if (inMod) {
        if (cur) cur.mods.push({qty, name, price, map}); else seg.orphans++;
        inMod = false; lastWasMod = true;
      } else {
        cur = {qty, name, price, listPrice, map, mods:[], notes:[], promo: promo || (listPrice != null && listPrice > price), afterMod:lastWasMod};
        seg.products.push(cur); lastWasMod = false;
      }
      continue;
    }
    if (isHeader(l)) { inMod = /^(elige|desear?|selecciona|escoge|agrega|quieres)\b|\?$|:$/i.test(l) ? 'pregunta' : true; mode=''; continue; }
    if (inMod === 'pregunta' && cur && !MONEY_ONLY.test(l) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(l) && l.length < 60) {
      const pr = lines[i+1] && MONEY_ONLY.test(lines[i+1]) ? money(lines[i+1]) : null; if (pr != null) i++;
      cur.mods.push({qty:1, name:l, price:pr, map:resolve(l, dict)}); inMod = false; lastWasMod = true; continue;
    }
    if (mode==='orderNote') { seg.orderNotes.push(l); mode=''; continue; }
    if (mode==='comment') { if (cur && !cur.notes.includes(l)) cur.notes.push(l); continue; }
    if (MONEY_ONLY.test(l)) continue;
    lastWasMod = false; // descripción: se ignora
  }
  return seg;
}

const pkey = p => norm(p.name)+'|'+p.qty;
function overlap(X,Y){
  for (let k=Math.min(X.length,Y.length); k>0; k--){
    let ok = true;
    for (let i=0;i<k;i++) if (pkey(X[X.length-k+i]) !== pkey(Y[i])) { ok=false; break; }
    if (ok) return k;
  }
  return 0;
}
const richer = (a,b) => (b.mods.length + b.notes.length > a.mods.length + a.notes.length) ? b : a;
function mergeProducts(A,B){
  const kab = overlap(A,B), kba = overlap(B,A);
  let first = A, second = B, k = kab;
  if (kba > kab) { first = B; second = A; k = kba; }
  const out = first.slice(0, first.length-k);
  for (let i=0;i<k;i++) out.push(richer(first[first.length-k+i], second[i]));
  return out.concat(second.slice(k));
}

function parseOrder(text, hint, dict){
  // Los íconos de las apps llegan como caracteres privados (\uE000–\uF8FF): se quitan
  const lines = prepass(String(text).split(/\r?\n/).map(s=>s.replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim()).filter(Boolean));
  const segs = splitSegments(lines).map(s => parseSegment(s, dict));
  const o = {platform: hint || detectPlatform(text), number:'', products:[], orderNotes:[], alerts:[], total:null, totalNote:'', expected:null, date:'', client:'', captures:segs.length, mixedNumbers:false};
  for (const s of segs){
    if (s.number) { if (o.number && o.number !== s.number) o.mixedNumbers = true; o.number = o.number || s.number; }
    o.products = o.products.length ? mergeProducts(o.products, s.products) : s.products;
    for (const a of s.alerts) if (!o.alerts.includes(a)) o.alerts.push(a);
    for (const n of s.orderNotes) if (!o.orderNotes.includes(n)) o.orderNotes.push(n);
    if (s.total != null) o.total = s.total;
    if (s.subtotal != null) o.subtotal = s.subtotal;
    o.totalNote = s.totalNote || o.totalNote;
    o.expected = s.expected ?? o.expected;
    o.date = o.date || s.date; o.client = o.client || s.client;
  }
  if (!o.number) { const short = text.match(/#\s?(\d{1,12})\b/); if (short) o.number = short[1]; }
  o.numDudoso = new Set(segs.flatMap(s => s.nums)).size > 1;
  if (o.platform === 'Reservándonos' && o.subtotal != null) { o.total = o.subtotal; o.totalNote = 'sin envío'; }
  // Si se leyeron más productos de los que dice el pedido, lo que vino justo después de una opción era otra opción
  if (o.expected) {
    let sum = o.products.reduce((a,p)=>a+p.qty,0);
    for (let i=1; i<o.products.length && sum > o.expected; i++){
      const p = o.products[i];
      if (p.afterMod && p.map?.tipo !== 'producto') { o.products[i-1].mods.push(p); o.products.splice(i,1); sum -= p.qty; i--; }
    }
  }
  o.readQty = o.products.reduce((a,p)=>a+p.qty,0);
  o.sum = o.products.reduce((a,p)=>a+(p.price||0)+(o.platform === 'Uber' ? 0 : p.mods.reduce((b,md)=>b+(md.price||0),0)),0);
  return o;
}

const isCombo = p => !!(p.map && COMBO_NAMES.has(p.map.excel));
function modStatus(md, parent){
  if (!md.map) return 'nuevo';
  if (md.map.tipo === 'incluido' || md.map.tipo === 'ignorar') return 'incluido';
  if (isCombo(parent)) return 'combo';
  return 'cuenta';
}
const esOrilla = m => !!(m && m.excel === 'Orilla de queso');

/* Convierte el pedido leído al formato del comandero: [{n, qty, orilla, parts:[{n}]}].
   Los combos llevan sus piezas fijas más lo que eligió el cliente (el Excel marca también las piezas). */
function toItems(order){
  const items = []; let pending = 0;
  for (const p of order.products){
    const m = p.map;
    p.mods.forEach(md => { if (!md.map) pending++; });
    if (!m) { pending++; continue; }
    if (m.tipo === 'incluido' || m.tipo === 'ignorar') continue;
    if (m.tipo === 'segun-opcion') {
      const sabores = p.mods.filter(md => md.map && md.map.sabor);
      if (!sabores.length) { pending++; continue; }
      sabores.forEach(md => items.push({n: md.map.excel, qty: md.qty * p.qty}));
      continue;
    }
    const orilla = p.mods.some(md => esOrilla(md.map));
    const otros = p.mods.filter(md => md.map && !esOrilla(md.map) && md.map.tipo !== 'incluido' && md.map.tipo !== 'ignorar');
    if (esOrilla(m)) { items.push({n:'Orilla de queso', qty:p.qty}); continue; }
    if (isCombo(p)) {
      const fijos = (COMBO_FIJO[m.excel] || []).slice();
      const parts = fijos.map(n => ({n}));
      otros.forEach(md => {
        const i = fijos.indexOf(md.map.excel);
        if (i >= 0) { fijos.splice(i,1); return; }      // ya viene como pieza fija
        parts.push({n: md.qty > 1 ? md.qty + ' ' + md.map.excel : md.map.excel});
      });
      items.push({n: m.excel, qty: p.qty, orilla, parts});
    } else {
      items.push({n: m.excel, qty: p.qty, orilla});
      otros.forEach(md => items.push({n: md.map.excel, qty: md.qty * p.qty}));
    }
  }
  return {items, pending};
}

// Renglones del formato REGISTRO DELIVERY (6 a 67), como aparecen en la hoja
const RENGLONES = ['BEE CHEESY WINGS','BEE CLASSIC','BEE MEAT MANIA','BEE MEXICAN PIZZA','BEE MIX MANÍA','BEE TACO PIZZA','BEE TROPICAL PUFF','BEE VEGGIE','DOUBLE CHEESE','HAWAIIAN BEE','SUPREME BEE','TROPICAL BEE SPICY','XTREME BEE','PIZZA QUEEN BEE',
  'BEE ANTOJO','BEE CHEESY PACK','BEE CRUNCH COMBO','BEE DOUBLE DATE','BEE HAWAIIAN COMBO','BEE PIZZA & CHICKEN','BEE TROPICAL FEAST','COMBO QUEEN BEE','COMBO BEE DUO','COMBO PIBIL BEE',
  'BEE CHEESY BOMBS (8 PZ)','BEE CRUST','BEE CHEESY BOMBS (12 PZ)',"BEE'S CHICKEN",'BEES WINGS','BUMBLEBEE HAWAIANOS','BUMBLEBEE PEPPERONI','ORILLA EXTRA DE QUESO','PAPAS GAJO',
  'CANELA DIPS','SWEET BEE BITES (12 PZ)','SWEET BEE BITES (8 PZ)',
  'AGUA MINERAL 600 ML','AGUA NATURAL 600 ML','COCA COLA 2 L','COCA COLA REGULAR 600 ML','COCA COLA LIGHT 600 ML','COCA COLA ZERO 600 ML','FANTA 2 L','FANTA 600 ML','FUZE TEA DURAZNO','FUZE TEA FRUTOS ROJOS','FUZE TEA LIMÓN','SIDRAL MUNDET 2 L','SIDRAL MUNDET 600 ML','SPRITE 2 L','SPRITE 600 ML','JAMAICA 500 ML','LIMÓN CON CHÍA 500 ML','MARACUYÁ 500 ML','HORCHATA',
  'ADEREZO BBQ','ADEREZO BÚFALO','ADEREZO MANGO HABANERO','ADEREZO RANCH','BEE SAUCE','BEE SAUCE CHIPOTLE','DIP QUESO'];
const renglon = r => RENGLONES[r-6] || ('Renglón '+r);

/* Lo que se marcará en el Excel para un pedido: [{excel, qty}] con nombres del formato, y lo que no tiene renglón. */
function marcas(items){
  const R = (typeof Registro !== 'undefined') ? Registro : (typeof globalThis !== 'undefined' && globalThis.Registro);
  if (!R) return {lines: items.map(i => ({excel:i.n, qty:i.qty})), sinRenglon: []};
  const m = R.orderMarks({items}, true);
  const lines = [...m.rows.entries()].sort((a,b)=>a[0]-b[0]).map(([r,q]) => ({excel: renglon(r), qty: q, row: r}));
  const sinRenglon = [...m.missing.entries()].map(([n,q]) => ({excel:n, qty:q}));
  return {lines, sinRenglon};
}
/* ---------- Resumen de ventas del día (para el corte) ----------
   Rappi: «Resumen de ventas» → Total con descuentos. DiDi: «Historial» → Ventas. Uber: «Historial de pedidos» → Ventas. */
const COMISION = {didi:56.53, uber:58.42, rappi:47.73, resv:0};
const MESES_AB = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const pad2 = n => String(n).padStart(2,'0');
function fechaResumen(lines){
  for (const l of lines){
    let m = l.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (m) return m[3]+'-'+pad2(m[2])+'-'+pad2(m[1]);
    m = norm(l).match(/\b(\d{1,2}) (?:de )?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]* (?:de )?(\d{4})\b/);
    if (m) return m[3]+'-'+pad2(MESES_AB.indexOf(m[2])+1)+'-'+pad2(m[1]);
  }
  return '';
}
const dineroEn = l => { const m = String(l).match(/(?:MXN\s*|MX)?\$\s*([\d,]+(?:\.\d{1,2})?)|\b([\d,]+\.\d{2})\b/); return m ? parseFloat((m[1]||m[2]).replace(/,/g,'')) : null; };
/* Todos los valores que siguen a una etiqueta (en la misma línea o en las 3 siguientes). */
function valores(lines, re, tipo){
  const out = [];
  for (let i=0;i<lines.length;i++){
    if (!re.test(lines[i])) continue;
    const resto = lines[i].replace(re,'');
    let v = tipo === 'dinero' ? dineroEn(resto) : ((resto.match(/^\D*?(\d+)\s*$/)||[])[1] ?? null);
    for (let j=i+1; v == null && j < Math.min(lines.length, i+4); j++){
      if (tipo === 'dinero') v = dineroEn(lines[j]);
      else if (/^\d+$/.test(lines[j])) v = lines[j];
    }
    if (v != null) out.push(tipo === 'entero' ? parseInt(v,10) : v);
  }
  return out;
}
const hora12 = l => { const m = String(l).match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m/i); if (!m) return ''; let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return pad2(h)+':'+m[2]; };

function parseResumen(text, hint){
  const lines = String(text).split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(l => l && !/^-{3,}/.test(l));
  const t = lines.join('\n');
  let plat = '';
  if (/historial de pedidos/i.test(t) && /pago pendiente|[oó]rdenes pendientes|pedidos completados|id de pedido/i.test(t)) plat = 'resv';
  else if (/resumen de ventas|[oó]rdenes finalizadas|total con descuentos/i.test(t)) plat = 'rappi';
  else if (/historial de pedidos/i.test(t) && /entrega en curso|completado|calificaci|ventas/i.test(t)) plat = 'uber';
  else if (/historial/i.test(t) && /ventas sin descuentos|n[uú]mero de recolec|ganancias estimadas|pedido aceptado/i.test(t)) plat = 'didi';
  if (!plat) return null;
  const HK = {Uber:'uber', DiDi:'didi', Rappi:'rappi', 'Reservándonos':'resv'};
  if (hint && HK[hint] && HK[hint] !== plat) plat = HK[hint];
  const r = {resumen:true, plat, dia: fechaResumen(lines), pedidos:null, cancelados:null, total:null, totalNota:'', lista:[], extra:{}};
  if (plat === 'rappi') {
    // Dos columnas (finalizadas y canceladas): la de finalizadas es la mayor
    const ords = valores(lines, /^[oó]rdenes(?!\s*(finalizadas|canceladas))\b:?/i, 'entero');
    const tcd = valores(lines, /^total con descuentos\b/i, 'dinero');
    if (ords.length) { r.pedidos = Math.max(...ords); if (ords.length > 1) r.cancelados = Math.min(...ords); }
    if (tcd.length) r.total = Math.max(...tcd);
    r.totalNota = 'Total con descuentos';
    const acu = valores(lines, /^total acumulado\b/i, 'dinero'), tr = valores(lines, /^total restaurante\b/i, 'dinero');
    const dr = valores(lines, /^total descuento restaurante\b/i, 'dinero'), dp = valores(lines, /^total descuento rappi\b/i, 'dinero');
    if (acu.length) r.extra.total_acumulado = Math.max(...acu);
    if (dr.length) r.extra.descuento_restaurante = Math.max(...dr);
    if (tr.length) r.extra.total_restaurante = Math.max(...tr);
    if (dp.length) r.extra.descuento_rappi = Math.max(...dp);
  }
  if (plat === 'didi') {
    const ped = valores(lines, /^pedidos\b:?/i, 'entero'); if (ped.length) r.pedidos = ped[0];
    const ven = valores(lines, /^ventas(?!\s*sin)\b\s*[ⓘⓘ(i)]*/i, 'dinero'); if (ven.length) r.total = ven[0];
    const sd = valores(lines, /^ventas sin descuentos\b\s*[ⓘ(i)]*/i, 'dinero'); if (sd.length) r.extra.ventas_sin_descuentos = sd[0];
    r.totalNota = 'Ventas';
    for (let i=0;i<lines.length;i++){
      const m = lines[i].match(/^#\s?(\d{1,5})$/); if (!m) continue;
      const fila = {code:m[1], monto:null, ganancia:null, hora:'', estado:''};
      for (let j=i+1; j<lines.length && j<=i+8 && !/^#\s?\d/.test(lines[j]); j++){
        const d = dineroEn(lines[j]);
        if (d != null) { if (fila.monto == null) fila.monto = d; else if (fila.ganancia == null) fila.ganancia = d; }
        if (!fila.hora && hora12(lines[j])) fila.hora = hora12(lines[j]);
        if (/completado|cancelado|reembols/i.test(lines[j])) fila.estado = (lines[j].match(/completado|cancelado|reembols\w*/i)||[''])[0];
      }
      if (!r.lista.some(x => x.code === fila.code)) r.lista.push(fila);
    }
  }
  if (plat === 'uber') {
    const ven = valores(lines, /^ventas\b/i, 'dinero'); if (ven.length) r.total = ven[0];
    const ped = valores(lines, /^pedidos\b/i, 'entero'); if (ped.length) r.pedidos = ped[0];
    r.totalNota = 'Ventas';
    for (let i=0;i<lines.length;i++){
      if (!/^[A-Z0-9]{5}$/.test(lines[i]) || !/\d/.test(lines[i])) continue;
      const fila = {code:lines[i], cliente: lines[i-1] && !/\d/.test(lines[i-1]) ? lines[i-1] : '', monto:null, hora:'', estado:''};
      for (let j=i+1; j<lines.length && j<=i+6 && !/^[A-Z0-9]{5}$/.test(lines[j]); j++){
        const d = /MXN|\$/.test(lines[j]) ? dineroEn(lines[j]) : null;
        if (d != null && fila.monto == null) fila.monto = d;
        if (!fila.hora && hora12(lines[j])) fila.hora = hora12(lines[j]);
        if (/entregado|cancelado|reembols/i.test(lines[j])) fila.estado = (lines[j].match(/entregado|cancelado|reembols\w*/i)||[''])[0];
      }
      if (!r.lista.some(x => x.code === fila.code)) r.lista.push(fila);
    }
  }
  if (plat === 'resv') {
    // Se suma el monto de cada pedido de la lista (Terminado y Despacho), sin comisión; no se usan los recuadros de arriba
    for (let i=0;i<lines.length;i++){
      const m = lines[i].match(/id de pedido\s*[:#]*\s*#?\s*(\d{6,})/i); if (!m) continue;
      const fila = {code:m[1], cliente:'', monto:null, estado:''};
      for (let j=Math.max(0,i-2); j<=Math.min(lines.length-1, i+3); j++){
        if (j !== i && /id de pedido/i.test(lines[j])) { if (j > i) break; else continue; }
        const e = (lines[j].match(/terminado|despacho|cancelad\w*|aceptado/i)||[])[0]; if (e && !fila.estado) fila.estado = e;
        if (j >= i-1 && fila.monto == null && /mex\s?\$/i.test(lines[j]) && !/pendiente/i.test(lines[j])) fila.monto = dineroEn(lines[j]);
      }
      const prev = lines[i-1] && /terminado|despacho|aceptado|cancelad/i.test(lines[i-1]) ? lines[i-2] : lines[i-1];
      if (prev && !/\$|id de pedido|\d{3,}/i.test(prev)) fila.cliente = prev.replace(/\s*(terminado|despacho|aceptado|cancelad\w*)\s*$/i,'');
      if (!r.lista.some(x => x.code === fila.code)) r.lista.push(fila);
    }
    const val = r.lista.filter(x => !/cancel/i.test(x.estado||''));
    r.pedidos = val.length;
    r.total = Math.round(val.reduce((a,x) => a + (x.monto||0), 0) * 100) / 100;
    if (r.lista.length > val.length) r.cancelados = r.lista.length - val.length;
    r.totalNota = 'Suma de los pedidos, sin comisión';
  }
  if (r.total == null && r.pedidos == null) return null;
  return r;
}
const neto = (plat, bruto) => Math.round((Number(bruto)||0) * (1 - (COMISION[plat]||0)/100) * 100) / 100;

function excelLines(order){
  const t = toItems(order);
  const m = marcas(t.items);
  return {lines: m.lines, sinRenglon: m.sinRenglon, pending: t.pending, items: t.items};
}
/*PARSER-END*/
