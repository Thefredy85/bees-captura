/* Llena el formato CONCENTRADO DE VENTAS DELIVERY (el Excel de los supervisores) con los pedidos de un día.
   Hojas: CONCENTRADO DELIVERY, UBER, DIDI, RAPPI y RESERVANDONOS. En cada hoja de plataforma, cada columna
   P1–P50 (C..AZ) es un pedido y se marca X en el renglón de cada producto (con los componentes de los combos).
   Renglones 6–107: pizzas 35 cm, pizzas 40 cm, combos, complementos, postres, dips y bebidas; total en el 109.
   No usa el DOM: recibe JSZip, así se puede probar fuera del navegador. */
(function (root) {
  'use strict';
  var MAX_COLS = 50;            // P1..P50 (columnas C..AZ)
  var FIRST_COL = 3;            // C
  var FIRST_ROW = 6, LAST_ROW = 107, TOTAL_ROW = 109;
  var PLATS = ['uber', 'didi', 'rappi', 'resv'];
  var SHEET_FILE = { uber: 'xl/worksheets/sheet2.xml', didi: 'xl/worksheets/sheet3.xml', rappi: 'xl/worksheets/sheet4.xml', resv: 'xl/worksheets/sheet5.xml' };
  var CONC_COL = { uber: 'C', didi: 'D', rappi: 'E', resv: 'F' };
  var PLAT_NAMES = { uber: 'Uber Eats', didi: 'DiDi Food', rappi: 'Rappi', resv: 'Reservándonos' };
  var ORILLA_ROW = { '35': 77, '40': 78 };        // ORILLA EXTRA DE QUESO 35 / 40 CM
  var ORILLA_PUFF_ROW = { '35': 79, '40': 80 };   // ORILLA PUFF 35 / 40 CM
  var COMBO_FIRST = 43, COMBO_LAST = 62;
  var NO_ROW_OK = { 'Bee Crust': 1 };             // no son combos: sus partes siempre se marcan

  // Renglones del formato, como aparecen en la hoja (6 a 107)
  var CATEGORIAS = [['PIZZAS 35 CM', 6, 23], ['PIZZAS 40 CM', 24, 42], ['COMBOS', 43, 62], ['COMPLEMENTOS', 63, 80],
    ['POSTRES', 81, 86], ['DIPS / ADEREZOS', 87, 93], ['BEBIDAS', 94, 107]];
  var RENGLONES = ['BEE CLASSIC', 'DOUBLE CHEESE', 'SUPREME BEE', 'MIX MANÍA HAWAIIAN', 'MIX MANÍA XTREME', 'MIX MANÍA BEE MEAT MANÍA',
    'MIX MANÍA MEXICAN', 'MIX MANÍA VEGGIE', 'MIX MANÍA SPICY', 'MIX MANÍA (2 ESPECIALIDADES)', 'BEE MEAT MANÍA', 'BEE MEXICAN PIZZA',
    'BEE VEGGIE', 'HAWAIIAN BEE', 'TROPICAL BEE SPICY', 'BEE TROPICAL PUFF', 'BEE CHEESY WINGS', 'QUEEN BEE',
    'BEE CLASSIC', 'DOUBLE CHEESE', 'SUPREME BEE', 'MIX MANÍA HAWAIIAN', 'MIX MANÍA XTREME', 'MIX MANÍA BEE MEAT MANÍA',
    'MIX MANÍA MEXICAN', 'MIX MANÍA VEGGIE', 'MIX MANÍA SPICY', 'MITAD Y MITAD (2 ESPECIALIDADES)', 'HAWAIIAN BEE', 'XTREME BEE',
    'BEE MEAT MANÍA', 'BEE MEXICANA', 'BEE VEGGIE', 'TROPICAL BEE SPICY', 'BEE TROPICAL PUFF', 'BEE CHEESY WINGS', 'QUEEN BEE',
    'BEE COMBO CLÁSICO', 'COMBO BEE SUPREME', 'BEE COMBO ANTOJO', 'BEE SNACK', 'BEE HAWAIIAN COMBO', 'BEE CRUNCH COMBO',
    'BEE HOUR (2 PIZZAS)', 'BEE DUO', 'BEE PIZZA & CHICKEN', 'COMBO BEE MAX', 'BEE CHEESY PACK', 'BEE FAMILY PACK', 'BEE FIESTA PACK',
    'BEE MIXTO DÚO', 'BEE MIXTO TRÍO', 'BEE MIXTO FAMILIAR', 'BEE MIXTO FIESTA', 'BEE GIGANTE CLÁSICO', 'BEE GIGANTE DÚO', 'BEE GIGANTE TRÍO',
    'CANELA DIPS', 'BEE CRUST QUESO', 'BEE CRUST HAWAIANO', 'BEE CRUST PEPPERONI', 'BEE CRUST CHAMPIÑONES', 'BUMBLEBEE QUESO',
    'BUMBLEBEE PEPPERONI', 'BUMBLEBEE MEXICANO', 'BUMBLEBEE HAWAIANO', 'BEE WINGS', 'BEE’S CHICKEN', 'PAPAS GAJO',
    'PORCIÓN EXTRA DE QUESO', 'PROTEÍNA EXTRA', 'ORILLA EXTRA DE QUESO 35 CM', 'ORILLA EXTRA DE QUESO 40 CM', 'ORILLA PUFF 35 CM', 'ORILLA PUFF 40 CM',
    'BEE’S CREAMY', 'BEE’S MEGA CREAMY', 'CHOCO BEE', 'FLUFFLY BEE', 'SWEET BEE BITES (8 PZ)', 'SWEET BEE BITES (12 PZ)',
    'BEE SAUCE', 'RANCH', 'BUFFALO', 'BBQ', 'MANGO HABANERO', 'HOT HONEY BEE', 'DIP DE QUESO',
    'AGUA MINERAL 600 ML', 'AGUA NATURAL 600 ML', 'BEE WATER 500 ML', 'COCA-COLA 600 ML', 'COCA-COLA LIGHT 600 ML', 'COCA-COLA ZERO 600 ML',
    'FANTA 600 ML', 'SPRITE 600 ML', 'FUZE TEA 600 ML', 'SIDRAL MUNDET 600 ML', 'COCA-COLA 2 L', 'FANTA 2 L', 'SPRITE 2 L', 'SIDRAL MUNDET 2 L'];

  // Pizzas: renglón de 35 cm y de 40 cm (null = el formato no tiene ese tamaño)
  var PIZZA = {
    'Bee Classic': [6, 24], 'Double Cheese': [7, 25], 'Supreme Bee': [8, 26],
    'Bee Mix Manía (Hawaiana)': [9, 27], 'Bee Mix Manía (Xtreme)': [10, 28], 'Bee Mix Manía (Meat Mania)': [11, 29],
    'Bee Mix Manía (Mexicana)': [12, 30], 'Bee Mix Manía (Vegetariana)': [13, 31], 'Bee Mix Manía (Tropical Spicy)': [14, 32],
    'Bee Mix Manía': [15, 33], 'Pizza 2 Especialidades': [15, 33],
    'Bee Meat Mania': [16, 36], 'Bee Mexican Pizza': [17, 37], 'Bee Veggie': [18, 38], 'Hawaiian Bee': [19, 34],
    'Tropical Bee Spicy': [20, 39], 'Bee Tropical Puff': [21, 40], 'Bee Cheesy Wings': [22, 41], 'Queen Bee': [23, 42],
    'Xtreme Bee': [null, 35]
  };
  // Lo demás: un solo renglón
  var ROW = {
    'Combo Clásico': 43, 'Combo Bee Supreme': 44, 'Combo Antojo': 45, 'Bee Snack': 46, 'Bee Hawaiian Combo': 47, 'Bee Crunch': 48,
    'Bee Hour': 49, 'Bee Duo': 50, 'Bee Pizza & Chicken': 51, 'Combo Bee Max': 52, 'Bee Cheesy Pack': 53, 'Bee Family Pack': 54,
    'Bee Fiesta Pack': 55, 'Bee Mixto Dúo': 56, 'Bee Mixto Trío': 57, 'Bee Mixto Familiar': 58, 'Bee Mixto Fiesta': 59,
    'Bee Gigante Clásico': 60, 'Bee Gigante Dúo': 61, 'Bee Gigante Trío': 62,
    'Canela Dips': 63, 'Bee Crust (Queso)': 64, 'Bee Crust (Hawaiano)': 65, 'Bee Crust (Pepperoni)': 66, 'Bee Crust (Champiñones)': 67,
    'Bumblebee de Queso': 68, 'Bumblebee Pepperoni': 69, 'Bumblebee Mexicanos': 70, 'Bumblebee Hawaianos': 71,
    'Bee’s Wings': 72, 'Bee’s Chicken': 73, 'Papas Gajo': 74, 'Porción extra de queso': 75, 'Proteína extra': 76,
    'Bee’s Creamy': 81, 'Bee’s Mega Creamy': 82, 'Choco Bee': 83, 'Fluffly Bee': 84,
    'Sweet Bee Bites 8 pz': 85, 'Sweet Bee Bites': 85, 'Sweet Bee Bites 12 pz': 86,
    'Bee Sauce': 87, 'Bee Sauce Chipotle': 87, 'Aderezo Ranch': 88, 'Aderezo Búfalo': 89, 'Aderezo BBQ': 90,
    'Aderezo Mango Habanero': 91, 'Hot Honey Bee': 92, 'Dip de Queso': 93,
    'Agua Mineral 600': 94, 'Agua Natural 600': 95, 'Bee Water': 96, 'Coca 600': 97, 'Coca Light 600': 98, 'Coca Zero 600': 99,
    'Fanta 600': 100, 'Sprite 600': 101, 'Fuze Tea': 102, 'Mundet 600': 103, 'Coca 2L': 104, 'Fanta 2L': 105, 'Sprite 2L': 106, 'Mundet 2L': 107
  };
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
      xml = setCached(xml, 'B3', serial);
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
    c1 = setCached(c1, 'F3', serial);
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
