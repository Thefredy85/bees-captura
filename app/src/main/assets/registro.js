/* Llena el formato CONCENTRADO DE VENTAS DELIVERY (el Excel de los supervisores) con los pedidos de un día.
   Hojas: CONCENTRADO DELIVERY, UBER, DIDI, RAPPI y RESERVANDONOS. En cada hoja de plataforma, cada columna
   P1–P50 (C..AZ) es un pedido y se marca X en el renglón de cada producto (con los componentes de los combos).
   Renglones 6–107: pizzas 35 cm, pizzas 40 cm, combos, complementos, postres, dips y bebidas; total en el 109.
   No usa el DOM: recibe JSZip, así se puede probar fuera del navegador. */
(function (root) {
  'use strict';
  var MAX_COLS = 50;            // P1..P50 (columnas C..AZ)
  var FIRST_COL = 3;            // C
  var FIRST_ROW = 6, LAST_ROW = 113, TOTAL_ROW = 115;
  var PLATS = ['uber', 'didi', 'rappi', 'resv'];
  var SHEET_FILE = { uber: 'xl/worksheets/sheet2.xml', didi: 'xl/worksheets/sheet3.xml', rappi: 'xl/worksheets/sheet4.xml', resv: 'xl/worksheets/sheet5.xml' };
  var CONC_COL = { uber: 'C', didi: 'D', rappi: 'E', resv: 'F' };
  var PLAT_NAMES = { uber: 'Uber Eats', didi: 'DiDi Food', rappi: 'Rappi', resv: 'Reservándonos' };
  var NO_ROW_OK = { 'Bee Crust': 1 };             // no son combos: sus partes siempre se marcan

  // Renglones del formato, como aparecen en la hoja (6 a 113)
  var CATEGORIAS = [['PIZZAS 35 CM', 6, 24], ['PIZZAS 40 CM', 25, 43], ['COMBOS', 44, 66], ['COMPLEMENTOS', 67, 86],
    ['POSTRES', 87, 92], ['DIPS / ADEREZOS', 93, 99], ['BEBIDAS', 100, 113]];
  var RENGLONES = ['BEE CLASSIC', 'DOUBLE CHEESE', 'SUPREME BEE', 'MIX MANÍA HAWAIIAN', 'MIX MANÍA XTREME', 'MIX MANÍA BEE MEAT MANÍA',
    'MIX MANÍA MEXICAN', 'MIX MANÍA VEGGIE', 'MIX MANÍA SPICY', 'MIX MANÍA (2 ESPECIALIDADES)', 'BEE MEAT MANÍA', 'BEE MEXICAN PIZZA',
    'BEE VEGGIE', 'HAWAIIAN BEE', 'XTREME BEE', 'TROPICAL BEE SPICY', 'BEE TROPICAL PUFF', 'BEE CHEESY WINGS', 'QUEEN BEE',
    'BEE CLASSIC', 'DOUBLE CHEESE', 'SUPREME BEE', 'MIX MANÍA HAWAIIAN', 'MIX MANÍA XTREME', 'MIX MANÍA BEE MEAT MANÍA',
    'MIX MANÍA MEXICAN', 'MIX MANÍA VEGGIE', 'MIX MANÍA SPICY', 'MITAD Y MITAD (2 ESPECIALIDADES)', 'HAWAIIAN BEE', 'XTREME BEE',
    'BEE MEAT MANÍA', 'BEE MEXICANA', 'BEE VEGGIE', 'TROPICAL BEE SPICY', 'BEE TROPICAL PUFF', 'BEE CHEESY WINGS', 'QUEEN BEE',
    'BEE COMBO CLÁSICO', 'COMBO BEE SUPREME', 'BEE COMBO ANTOJO', 'BEE SNACK', 'BEE HAWAIIAN COMBO', 'BEE CRUNCH COMBO',
    'BEE HOUR (2 PIZZAS)', 'BEE DUO', 'BEE PIZZA & CHICKEN', 'COMBO BEE MAX', 'BEE CHEESY PACK', 'BEE FAMILY PACK', 'BEE FIESTA PACK',
    'BEE MIXTO DÚO', 'BEE MIXTO TRÍO', 'BEE MIXTO FAMILIAR', 'BEE MIXTO FIESTA', 'BEE GIGANTE CLÁSICO', 'BEE GIGANTE DÚO', 'BEE GIGANTE TRÍO',
    'BEE DOUBLE DATE', 'BEE TROPICAL FEAST', 'COMBO QUEEN BEE',
    'CANELA DIPS', 'BEE CRUST QUESO', 'BEE CRUST HAWAIANO', 'BEE CRUST PEPPERONI', 'BEE CRUST CHAMPIÑONES', 'BUMBLEBEE QUESO',
    'BUMBLEBEE PEPPERONI', 'BUMBLEBEE MEXICANO', 'BUMBLEBEE HAWAIANO', 'BEE WINGS', 'BEE’S CHICKEN', 'PAPAS GAJO',
    'CHEESY BOMBS (8 PZ)', 'CHEESY BOMBS (12 PZ)',
    'PORCIÓN EXTRA DE QUESO', 'PROTEÍNA EXTRA', 'ORILLA EXTRA DE QUESO 35 CM', 'ORILLA EXTRA DE QUESO 40 CM', 'ORILLA PUFF 35 CM', 'ORILLA PUFF 40 CM',
    'BEE’S CREAMY', 'BEE’S MEGA CREAMY', 'CHOCO BEE', 'FLUFFLY BEE', 'SWEET BEE BITES (8 PZ)', 'SWEET BEE BITES (12 PZ)',
    'BEE SAUCE', 'RANCH', 'BUFFALO', 'BBQ', 'MANGO HABANERO', 'HOT HONEY BEE', 'DIP DE QUESO',
    'AGUA MINERAL 600 ML', 'AGUA NATURAL 600 ML', 'BEE WATER 500 ML', 'COCA-COLA 600 ML', 'COCA-COLA LIGHT 600 ML', 'COCA-COLA ZERO 600 ML',
    'FANTA 600 ML', 'SPRITE 600 ML', 'FUZE TEA 600 ML', 'SIDRAL MUNDET 600 ML', 'COCA-COLA 2 L', 'FANTA 2 L', 'SPRITE 2 L', 'SIDRAL MUNDET 2 L'];
  /* Renglón de una etiqueta del formato dentro de una categoría */
  function fila(cat, etiqueta) {
    for (var c = 0; c < CATEGORIAS.length; c++) {
      if (CATEGORIAS[c][0] !== cat) continue;
      for (var r = CATEGORIAS[c][1]; r <= CATEGORIAS[c][2]; r++) if (RENGLONES[r - FIRST_ROW] === etiqueta) return r;
    }
    throw new Error('Renglón no encontrado: ' + cat + ' / ' + etiqueta);
  }
  var ORILLA_ROW = { '35': fila('COMPLEMENTOS', 'ORILLA EXTRA DE QUESO 35 CM'), '40': fila('COMPLEMENTOS', 'ORILLA EXTRA DE QUESO 40 CM') };
  var ORILLA_PUFF_ROW = { '35': fila('COMPLEMENTOS', 'ORILLA PUFF 35 CM'), '40': fila('COMPLEMENTOS', 'ORILLA PUFF 40 CM') };
  var COMBO_FIRST = 44, COMBO_LAST = 66;

  // Pizzas: etiqueta en 35 cm y en 40 cm (null = el formato no tiene ese tamaño)
  var PIZZA_ETQ = {
    'Bee Classic': ['BEE CLASSIC'], 'Double Cheese': ['DOUBLE CHEESE'], 'Supreme Bee': ['SUPREME BEE'],
    'Bee Mix Manía (Hawaiana)': ['MIX MANÍA HAWAIIAN'], 'Bee Mix Manía (Xtreme)': ['MIX MANÍA XTREME'], 'Bee Mix Manía (Meat Mania)': ['MIX MANÍA BEE MEAT MANÍA'],
    'Bee Mix Manía (Mexicana)': ['MIX MANÍA MEXICAN'], 'Bee Mix Manía (Vegetariana)': ['MIX MANÍA VEGGIE'], 'Bee Mix Manía (Tropical Spicy)': ['MIX MANÍA SPICY'],
    'Bee Mix Manía': ['MIX MANÍA (2 ESPECIALIDADES)', 'MITAD Y MITAD (2 ESPECIALIDADES)'], 'Pizza 2 Especialidades': ['MIX MANÍA (2 ESPECIALIDADES)', 'MITAD Y MITAD (2 ESPECIALIDADES)'],
    'Bee Meat Mania': ['BEE MEAT MANÍA'], 'Bee Mexican Pizza': ['BEE MEXICAN PIZZA', 'BEE MEXICANA'], 'Bee Veggie': ['BEE VEGGIE'], 'Hawaiian Bee': ['HAWAIIAN BEE'],
    'Xtreme Bee': ['XTREME BEE'], 'Tropical Bee Spicy': ['TROPICAL BEE SPICY'], 'Bee Tropical Puff': ['BEE TROPICAL PUFF'], 'Bee Cheesy Wings': ['BEE CHEESY WINGS'], 'Queen Bee': ['QUEEN BEE']
  };
  var PIZZA = {};
  Object.keys(PIZZA_ETQ).forEach(function (k) { var e = PIZZA_ETQ[k]; PIZZA[k] = [fila('PIZZAS 35 CM', e[0]), fila('PIZZAS 40 CM', e[1] || e[0])]; });
  // Lo demás: catálogo → etiqueta del formato
  var ETQ = {
    'Combo Clásico': 'BEE COMBO CLÁSICO', 'Combo Bee Supreme': 'COMBO BEE SUPREME', 'Combo Antojo': 'BEE COMBO ANTOJO', 'Bee Snack': 'BEE SNACK',
    'Bee Hawaiian Combo': 'BEE HAWAIIAN COMBO', 'Bee Crunch': 'BEE CRUNCH COMBO', 'Bee Hour': 'BEE HOUR (2 PIZZAS)', 'Bee Duo': 'BEE DUO',
    'Bee Pizza & Chicken': 'BEE PIZZA & CHICKEN', 'Combo Bee Max': 'COMBO BEE MAX', 'Bee Cheesy Pack': 'BEE CHEESY PACK', 'Bee Family Pack': 'BEE FAMILY PACK',
    'Bee Fiesta Pack': 'BEE FIESTA PACK', 'Bee Mixto Dúo': 'BEE MIXTO DÚO', 'Bee Mixto Trío': 'BEE MIXTO TRÍO', 'Bee Mixto Familiar': 'BEE MIXTO FAMILIAR',
    'Bee Mixto Fiesta': 'BEE MIXTO FIESTA', 'Bee Gigante Clásico': 'BEE GIGANTE CLÁSICO', 'Bee Gigante Dúo': 'BEE GIGANTE DÚO', 'Bee Gigante Trío': 'BEE GIGANTE TRÍO',
    'Bee Double Date': 'BEE DOUBLE DATE', 'Tropical Feast': 'BEE TROPICAL FEAST', 'Combo Queen Bee': 'COMBO QUEEN BEE', 'Queen Bee Promo': 'COMBO QUEEN BEE',
    'Canela Dips': 'CANELA DIPS', 'Bee Crust (Queso)': 'BEE CRUST QUESO', 'Bee Crust (Hawaiano)': 'BEE CRUST HAWAIANO', 'Bee Crust (Pepperoni)': 'BEE CRUST PEPPERONI',
    'Bee Crust (Champiñones)': 'BEE CRUST CHAMPIÑONES', 'Bumblebee de Queso': 'BUMBLEBEE QUESO', 'Bumblebee Pepperoni': 'BUMBLEBEE PEPPERONI',
    'Bumblebee Mexicanos': 'BUMBLEBEE MEXICANO', 'Bumblebee Hawaianos': 'BUMBLEBEE HAWAIANO', 'Bee’s Wings': 'BEE WINGS', 'Bee’s Chicken': 'BEE’S CHICKEN',
    'Papas Gajo': 'PAPAS GAJO', 'Cheesy Bombs 8 pz': 'CHEESY BOMBS (8 PZ)', 'Cheesy Bombs 12 pz': 'CHEESY BOMBS (12 PZ)',
    'Porción extra de queso': 'PORCIÓN EXTRA DE QUESO', 'Proteína extra': 'PROTEÍNA EXTRA',
    'Bee’s Creamy': 'BEE’S CREAMY', 'Bee’s Mega Creamy': 'BEE’S MEGA CREAMY', 'Choco Bee': 'CHOCO BEE', 'Fluffly Bee': 'FLUFFLY BEE',
    'Sweet Bee Bites 8 pz': 'SWEET BEE BITES (8 PZ)', 'Sweet Bee Bites': 'SWEET BEE BITES (8 PZ)', 'Sweet Bee Bites 12 pz': 'SWEET BEE BITES (12 PZ)',
    'Bee Sauce': 'BEE SAUCE', 'Bee Sauce Chipotle': 'BEE SAUCE', 'Aderezo Ranch': 'RANCH', 'Aderezo Búfalo': 'BUFFALO', 'Aderezo BBQ': 'BBQ',
    'Aderezo Mango Habanero': 'MANGO HABANERO', 'Hot Honey Bee': 'HOT HONEY BEE', 'Dip de Queso': 'DIP DE QUESO',
    'Agua Mineral 600': 'AGUA MINERAL 600 ML', 'Agua Natural 600': 'AGUA NATURAL 600 ML', 'Bee Water': 'BEE WATER 500 ML', 'Coca 600': 'COCA-COLA 600 ML',
    'Coca Light 600': 'COCA-COLA LIGHT 600 ML', 'Coca Zero 600': 'COCA-COLA ZERO 600 ML', 'Fanta 600': 'FANTA 600 ML', 'Sprite 600': 'SPRITE 600 ML',
    'Fuze Tea': 'FUZE TEA 600 ML', 'Mundet 600': 'SIDRAL MUNDET 600 ML', 'Coca 2L': 'COCA-COLA 2 L', 'Fanta 2L': 'FANTA 2 L', 'Sprite 2L': 'SPRITE 2 L', 'Mundet 2L': 'SIDRAL MUNDET 2 L'
  };
  var ROW = {};
  Object.keys(ETQ).forEach(function (k) {
    var e = ETQ[k], r = RENGLONES.indexOf(e);
    if (r < 0) throw new Error('Renglón no encontrado: ' + e);
    ROW[k] = r + FIRST_ROW;
  });
  function sinAcentos(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  var POR_NOMBRE = {};
  RENGLONES.forEach(function (n, i) { var k = sinAcentos(n); if (!POR_NOMBRE[k]) POR_NOMBRE[k] = FIRST_ROW + i; });

  // Siempre se marcan aunque estén dentro de un combo (se descuentan por sabor).
  function alwaysMark(name) { return /^Bee Water \(/.test(name); }
  /* Renglón de un producto. tam: '40' para pizzas de 40 cm. */
  function rowOf(name, tam) {
    name = String(name);
    var p = PIZZA[name] || PIZZA[name.replace(/\s*\([^)]*\)\s*$/, '')];
    if (p) return tam === '40' ? p[1] : p[0];
    if (ROW[name]) return ROW[name];
    if (/^Bee Water\b/.test(name)) return ROW['Bee Water'];
    if (/^Fuze Tea\b/.test(name)) return ROW['Fuze Tea'];
    if (/^Orilla puff/i.test(name)) return ORILLA_PUFF_ROW[tam === '40' ? '40' : '35'];
    if (/^Orilla de queso/i.test(name)) return ORILLA_ROW[tam === '40' ? '40' : '35'];
    var base = name.replace(/\s*\([^)]*\)\s*$/, '');
    if (ROW[base]) return ROW[base];
    return POR_NOMBRE[sinAcentos(name)] || null;
  }
  function esPizza(name) { return !!(PIZZA[name] || PIZZA[String(name).replace(/\s*\([^)]*\)\s*$/, '')]); }

  function colName(n) { var s = ''; while (n) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
  function add(m, k, q) { m.set(k, (m.get(k) || 0) + q); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function dateSerial(key) { var p = key.split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5) + 25569; }
  function parsePart(n) {
    n = String(n).replace(/^½\s*/, '');
    var m = /^(\d+)\s+(.+)$/.exec(n);
    return m ? { name: m[2], qty: +m[1] } : { name: n, qty: 1 };
  }

  /* Cuántas unidades de cada renglón lleva un pedido; lo que no tiene renglón va a "missing". */
  function orderMarks(o, markParts) {
    var rows = new Map(), missing = new Map();
    function put(name, q, tam) {
      var r = rowOf(name, tam);
      if (r) add(rows, r, q);
      else add(missing, name + (tam === '40' && esPizza(name) ? ' 40 cm' : ''), q);
    }
    function orilla(q, tam) { add(rows, ORILLA_ROW[tam === '40' ? '40' : '35'], q); }
    (o.items || []).forEach(function (it) {
      var q = it.qty || 1, tam = it.tam === '40' ? '40' : '35';
      if (it.parts && !PIZZA[it.n]) {
        var isCombo = !NO_ROW_OK[it.n], r0 = ROW[it.n];
        if (isCombo) {
          if (r0 && r0 >= COMBO_FIRST && r0 <= COMBO_LAST) add(rows, r0, q);
          else add(missing, it.n + ' (combo sin renglón)', q);
        }
        it.parts.forEach(function (p) {
          var pp = parsePart(p.n);
          if (!isCombo || markParts || alwaysMark(pp.name)) put(pp.name, pp.qty * q, '35');
          if (p.orilla) orilla(q, '35');
        });
        if (it.orilla) orilla(q, '35');
      } else {
        put(it.n, q, tam);
        if (it.orilla) orilla(q, tam);
      }
    });
    return { rows: rows, missing: missing };
  }

  /* Reparte las X en columnas: un pedido por columna (o varias si repite un producto). */
  function planPlatform(list, markParts) {
    var per = [], total = 0, missing = new Map();
    list.forEach(function (o) {
      var m = orderMarks(o, markParts);
      m.missing.forEach(function (q, k) { add(missing, k, q); });
      if (!m.rows.size) return;
      var span = 0; m.rows.forEach(function (q) { span = Math.max(span, q); });
      per.push({ rows: m.rows, span: span }); total += span;
    });
    var cells = [], layout = 'pedidos', overflow = [];
    if (total <= MAX_COLS) {
      var c = 0;
      per.forEach(function (p) {
        p.rows.forEach(function (q, r) { for (var i = 0; i < q; i++) cells.push([r, c + i]); });
        c += p.span;
      });
    } else {
      layout = 'compacto';
      var agg = new Map();
      per.forEach(function (p) { p.rows.forEach(function (q, r) { add(agg, r, q); }); });
      agg.forEach(function (T, r) {
        for (var i = 0; i < Math.min(T, MAX_COLS); i++) cells.push([r, i]);
        if (T > MAX_COLS) overflow.push({ row: r, total: T });
      });
    }
    return { cells: cells, layout: layout, orders: per.length, columns: Math.min(total, MAX_COLS), missing: missing, overflow: overflow };
  }

  function setX(xml, ref) {
    var re = new RegExp('<c r="' + ref + '"( s="\\d+")?\\s*/>');
    if (!re.test(xml)) throw new Error('No encontré la celda ' + ref + ' en la plantilla');
    return xml.replace(re, '<c r="' + ref + '"$1 t="inlineStr"><is><t>X</t></is></c>');
  }
  function setText(xml, ref, text) {
    var re = new RegExp('<c r="' + ref + '"( s="\\d+")?\\s*/>');
    if (!re.test(xml)) return xml;
    return xml.replace(re, '<c r="' + ref + '"$1 t="inlineStr"><is><t xml:space="preserve">' + esc(text) + '</t></is></c>');
  }
  function setCached(xml, ref, val) {
    var re = new RegExp('(<c r="' + ref + '"[^>]*>(?:<f[^>]*/>|<f[^>]*>[^<]*</f>)?)<v>[^<]*</v>');
    if (!re.test(xml)) throw new Error('No encontré el valor de ' + ref + ' en la plantilla');
    return xml.replace(re, '$1<v>' + val + '</v>');
  }

  function operationSheet(dayKey, orders, opts, fmt) {
    var lateMs = (opts.lateMin || 10) * 6e4;
    var sorted = orders.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    var valid = sorted.filter(function (o) { return o.status !== 'cancelado'; });
    var rows = [];
    function s(ref, t) { return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(t) + '</t></is></c>'; }
    function n(ref, v) { return '<c r="' + ref + '"><v>' + v + '</v></c>'; }
    var cols = 'ABCDEFGH'.split('');
    rows.push('<row r="1">' + s('A1', "REGISTRO DE OPERACIÓN DELIVERY — BEE'S PIZZA") + '</row>');
    rows.push('<row r="2">' + s('A2', 'FECHA:') + s('B2', dayKey) + '</row>');
    rows.push('<row r="3">' + s('A3', 'Pedidos (sin cancelados)') + n('B3', valid.length) + '</row>');
    var heads = ['Hora', 'Plataforma', '# Pedido', 'Cliente', 'Productos', 'Total', 'Nota', 'Estado'];
    rows.push('<row r="5">' + heads.map(function (h, i) { return s(cols[i] + '5', h); }).join('') + '</row>');
    var stTxt = { cancelado: 'Cancelado', registrado: 'Registrado (app)' };
    sorted.forEach(function (o, i) {
      var r = 6 + i;
      var prod = (o.items || []).map(function (it) {
        var t = it.qty + '× ' + it.n + (it.tam === '40' ? ' 40 cm' : '') + (it.orilla ? ' + orilla de queso' : '');
        if (it.parts) t += ' (' + it.parts.map(function (p) { return p.n + (p.orilla ? ' + orilla' : ''); }).join(', ') + ')';
        return t;
      }).join('; ');
      var c = [s('A' + r, o.backfill ? 'Capturado después' : fmt(o.createdAt)), s('B' + r, PLAT_NAMES[o.plat] || o.plat), s('C' + r, o.code || ''),
        s('D' + r, o.cust || ''), s('E' + r, prod), o.total != null ? n('F' + r, o.total) : s('F' + r, ''), s('G' + r, o.note || ''),
        s('H' + r, stTxt[o.status] || o.status || '')];
      rows.push('<row r="' + r + '">' + c.join('') + '</row>');
    });
    var widths = [12, 15, 14, 18, 70, 11, 40, 16];
    var colsXml = '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    var last = Math.max(5, 5 + sorted.length);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:H' + last + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + colsXml + '<sheetData>' + rows.join('') + '</sheetData>' +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }

  /* orders: pedidos del día (cualquier plataforma, cualquier estado). */
  async function buildXlsx(JSZip, templateB64, orders, dayKey, opts) {
    opts = opts || {};
    var markParts = opts.markParts !== false;
    var fmt = opts.fmt || function (t) { return new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }); };
    var zip = await JSZip.loadAsync(templateB64, { base64: true });
    var serial = dateSerial(dayKey);
    var report = { dayKey: dayKey, plat: {}, cancelled: 0, missing: [], overflow: [] };
    var counts = {}, missingAll = new Map();
    var sorted = orders.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    report.cancelled = sorted.filter(function (o) { return o.status === 'cancelado'; }).length;
    for (var k of PLATS) {
      var file = SHEET_FILE[k];
      var xml = await zip.file(file).async('string');
      var list = sorted.filter(function (o) { return o.plat === k && o.status !== 'cancelado'; });
      var plan = planPlatform(list, markParts);
      xml = setCached(xml, 'B3', serial).replace(/topLeftCell="[A-Z]+\d+"/, 'topLeftCell="C6"');
      var cnt = {};
      plan.cells.forEach(function (rc) { xml = setX(xml, colName(FIRST_COL + rc[1]) + rc[0]); cnt[rc[0]] = (cnt[rc[0]] || 0) + 1; });
      var sum = 0;
      for (var r = FIRST_ROW; r <= LAST_ROW; r++) { var v = cnt[r] || 0; sum += v; xml = setCached(xml, 'BA' + r, v); }
      xml = setCached(xml, 'BA' + TOTAL_ROW, sum);
      zip.file(file, xml);
      counts[k] = cnt;
      plan.missing.forEach(function (q, name) { add(missingAll, name, q); });
      plan.overflow.forEach(function (o) { report.overflow.push({ plat: k, row: o.row, total: o.total }); });
      report.plat[k] = { name: PLAT_NAMES[k], orders: list.length, withMarks: plan.orders, columns: plan.columns, layout: plan.layout, units: sum };
    }
    var c1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
    c1 = setCached(c1, 'F3', serial).replace(/topLeftCell="[A-Z]+\d+"/, 'topLeftCell="A6"');
    if (opts.sucursal) c1 = setText(c1, 'B3', opts.sucursal);
    var grand = 0, G = {};
    for (var r2 = FIRST_ROW; r2 <= LAST_ROW; r2++) {
      G[r2] = PLATS.reduce(function (t, p) { return t + (counts[p][r2] || 0); }, 0); grand += G[r2];
    }
    for (var r3 = FIRST_ROW; r3 <= LAST_ROW; r3++) {
      PLATS.forEach(function (p) { c1 = setCached(c1, CONC_COL[p] + r3, counts[p][r3] || 0); });
      c1 = setCached(c1, 'G' + r3, G[r3]);
      c1 = setCached(c1, 'H' + r3, grand ? G[r3] / grand : 0);
    }
    c1 = setCached(c1, 'G' + TOTAL_ROW, grand);
    zip.file('xl/worksheets/sheet1.xml', c1);
    report.total = grand;

    // Hoja OPERACIÓN (lista de pedidos del día) y que Excel recalcule al abrir
    zip.file('xl/worksheets/sheet6.xml', operationSheet(dayKey, sorted, opts, fmt));
    var ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>'));
    var rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    zip.file('xl/_rels/workbook.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml" /></Relationships>'));
    var wbx = await zip.file('xl/workbook.xml').async('string');
    if (wbx.indexOf('</sheets>') < 0) throw new Error('Plantilla sin lista de hojas');
    wbx = wbx.replace('</sheets>', '<sheet name="OPERACIÓN" sheetId="6" r:id="rId20" /></sheets>')
      .replace(/activeTab="\d+"/, 'activeTab="0"')
      .replace(/<calcPr([^>]*?)\s*\/>/, function (m, a) { return '<calcPr' + a.replace(/\s*fullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1" />'; });
    zip.file('xl/workbook.xml', wbx);
    var app = await zip.file('docProps/app.xml').async('string');
    app = app.replace('<vt:i4>5</vt:i4>', '<vt:i4>6</vt:i4>').replace('<vt:vector size="5" baseType="lpstr">', '<vt:vector size="6" baseType="lpstr">')
      .replace('</vt:vector></TitlesOfParts>', '<vt:lpstr>OPERACIÓN</vt:lpstr></vt:vector></TitlesOfParts>');
    zip.file('docProps/app.xml', app);

    missingAll.forEach(function (q, name) { report.missing.push({ name: name, qty: q }); });
    report.missing.sort(function (a, b) { return b.qty - a.qty; });
    var bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return { bytes: bytes, report: report };
  }

  var api = { buildXlsx: buildXlsx, ROW: ROW, PIZZA: PIZZA, rowOf: rowOf, orderMarks: orderMarks, planPlatform: planPlatform, dateSerial: dateSerial,
    RENGLONES: RENGLONES, CATEGORIAS: CATEGORIAS, FIRST_ROW: FIRST_ROW, LAST_ROW: LAST_ROW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Registro = api;
})(typeof window !== 'undefined' ? window : globalThis);
