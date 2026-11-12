/* Copiado del Comandero Bee's (generador del formato REGISTRO DELIVERY). Cambios: renglones de Bee Sauce Chipotle y
   Orilla de queso, y pedidos registrados desde la app de captura. */
/* Llena el formato REGISTRO DELIVERY (plantilla en blanco) con los pedidos de un día.
   No usa el DOM: recibe JSZip, así se puede probar fuera del navegador. */
(function (root) {
  'use strict';
  var X_IDX = '133';            // índice de la "X" en sharedStrings de la plantilla
  var MAX_COLS = 50;            // P1..P50 (columnas C..AZ)
  var FIRST_COL = 3;            // C
  var SHEET_FILE = { uber: 'xl/worksheets/sheet2.xml', didi: 'xl/worksheets/sheet3.xml', rappi: 'xl/worksheets/sheet4.xml' };
  var PLAT_NAMES = { uber: 'Uber Eats', didi: 'DiDi Food', rappi: 'Rappi', resv: 'Reservándonos' };
  var ORILLA_ROW = 37;          // ORILLA EXTRA DE QUESO
  var COMBO_ROWS = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  var NO_ROW_OK = { 'Pizza 2 Especialidades': 1, 'Bee Crust': 1 };   // no son combos: sus partes siempre se marcan

  // Renglón del formato para cada producto del comandero.
  var ROW = {
    'Bee Cheesy Wings': 6, 'Bee Classic': 7, 'Bee Meat Mania': 8, 'Bee Mexican Pizza': 9, 'Bee Mix Manía': 10,
    'Bee Taco Pizza': 11, 'Bee Tropical Puff': 12, 'Bee Veggie': 13, 'Double Cheese': 14, 'Hawaiian Bee': 15,
    'Supreme Bee': 16, 'Tropical Bee Spicy': 17, 'Xtreme Bee': 18, 'Queen Bee': 19,
    'Combo Antojo': 20, 'Bee Cheesy Pack': 21, 'Bee Crunch': 22, 'Bee Double Date': 23, 'Bee Hawaiian Combo': 24,
    'Bee Pizza & Chicken': 25, 'Tropical Feast': 26, 'Combo Queen Bee': 27, 'Queen Bee Promo': 27,
    'Bee Duo': 28, 'Combo Pibil Bee': 29,
    'Cheesy Bombs 8 pz': 30, 'Bee Crust': 31, 'Cheesy Bombs 12 pz': 32, 'Bee’s Chicken': 33, 'Bee’s Wings': 34,
    'Bumblebee Hawaianos': 35, 'Bumblebee Pepperoni': 36, 'Papas Gajo': 38,
    'Canela Dips': 39, 'Sweet Bee Bites 12 pz': 40, 'Sweet Bee Bites 8 pz': 41, 'Sweet Bee Bites': 41,
    'Agua Mineral 600': 42, 'Agua Natural 600': 43, 'Coca 2L': 44, 'Coca 600': 45, 'Coca Light 600': 46,
    'Coca Zero 600': 47, 'Fanta 2L': 48, 'Fanta 600': 49, 'Fuze Tea Durazno': 50, 'Fuze Tea Frutos Rojos': 51,
    'Fuze Tea Limón': 52, 'Mundet 2L': 53, 'Mundet 600': 54, 'Sprite 2L': 55, 'Sprite 600': 56,
    'Aderezo BBQ': 61, 'Aderezo Búfalo': 62, 'Aderezo Mango Habanero': 63, 'Aderezo Ranch': 64,
    'Bee Sauce': 65, 'Bee Sauce Chipotle': 66, 'Dip de Queso': 67, 'Orilla de queso': 37,
    'Bee Water (Jamaica)': 57, 'Bee Water (Limón con Chía)': 58, 'Bee Water (Maracuyá)': 59, 'Bee Water (Horchata)': 60
  };
  // Siempre se marcan aunque estén dentro de un combo (se descuentan por sabor).
  function alwaysMark(name) { return /^Bee Water \(/.test(name); }
  // "Bee Mix Manía (Hawaiana)" -> renglón de "Bee Mix Manía"; el detalle entre paréntesis no cambia el renglón.
  function rowOf(name) {
    if (ROW[name]) return ROW[name];
    var base = String(name).replace(/\s*\([^)]*\)\s*$/, '');
    return ROW[base];
  }

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
    function put(name, q) { var r = rowOf(name); if (r) add(rows, r, q); else add(missing, name, q); }
    (o.items || []).forEach(function (it) {
      var q = it.qty || 1;
      if (it.parts) {
        var isCombo = !NO_ROW_OK[it.n], r0 = ROW[it.n];
        if (isCombo) {
          if (r0 && COMBO_ROWS.indexOf(r0) >= 0) add(rows, r0, q);
          else add(missing, it.n + ' (combo sin renglón)', q);
        }
        it.parts.forEach(function (p) {
          var pp = parsePart(p.n);
          if (!isCombo || markParts || alwaysMark(pp.name)) put(pp.name, pp.qty * q);
          if (p.orilla) add(rows, ORILLA_ROW, q);
        });
        if (it.orilla) add(rows, ORILLA_ROW, q);
      } else {
        put(it.n, q);
        if (it.orilla) add(rows, ORILLA_ROW, q);
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
    return xml.replace(re, '<c r="' + ref + '"$1 t="s"><v>' + X_IDX + '</v></c>');
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
    var prepped = valid.filter(function (o) { return o.readyAt; });
    var avg = prepped.length ? prepped.reduce(function (a, o) { return a + (o.readyAt - o.createdAt); }, 0) / prepped.length / 6e4 : null;
    var late = prepped.filter(function (o) { return o.readyAt - o.createdAt > lateMs; }).length;
    var rows = [];
    function s(ref, t, st) { return '<c r="' + ref + '"' + (st != null ? ' s="' + st + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + esc(t) + '</t></is></c>'; }
    function n(ref, v, st) { return '<c r="' + ref + '"' + (st != null ? ' s="' + st + '"' : '') + '><v>' + v + '</v></c>'; }
    var cols = 'ABCDEFGHIJKL'.split('');
    var title = s('A1', "REGISTRO DE OPERACIÓN DELIVERY — BEE'S PIZZA", 29);
    cols.slice(1).forEach(function (c) { title += '<c r="' + c + '1" s="29" />'; });
    rows.push('<row r="1" ht="27.95" customHeight="1">' + title + '</row>');
    rows.push('<row r="2">' + s('A2', 'FECHA:', 2) + n('B2', dateSerial(dayKey), 3) + '</row>');
    rows.push('<row r="3">' + s('A3', 'Pedidos (sin cancelados)', 2) + n('B3', valid.length) + '</row>');
    rows.push('<row r="4">' + s('A4', 'Preparación promedio (min)', 2) + (avg == null ? s('B4', '—') : n('B4', Math.round(avg * 10) / 10)) + '</row>');
    rows.push('<row r="5">' + s('A5', 'Salieron tarde (más de ' + (opts.lateMin || 10) + ' min)', 2) + n('B5', late) + '</row>');
    rows.push('<row r="6">' + s('A6', 'Cancelados', 2) + n('B6', sorted.length - valid.length) + '</row>');
    var heads = ['Hora de entrada', 'Plataforma', '# Pedido', 'Cliente', 'Prioridad', 'Productos', 'Nota', 'Listo a las', 'Preparación (min)', '¿Atrasado?', 'Entregado a las', 'Estado'];
    rows.push('<row r="8" ht="30" customHeight="1">' + heads.map(function (h, i) { return s(cols[i] + '8', h, 20); }).join('') + '</row>');
    var stTxt = { cocina: 'En cocina', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado', registrado: 'Registrado (app)' };
    sorted.forEach(function (o, i) {
      var r = 9 + i;
      var prod = (o.items || []).map(function (it) {
        var t = it.qty + '× ' + it.n + (it.orilla ? ' + orilla de queso' : '');
        if (it.parts) t += ' (' + it.parts.map(function (p) { return p.n + (p.orilla ? ' + orilla' : ''); }).join(', ') + ')';
        if (it.note) t += ' [' + it.note + ']';
        return t;
      }).join('; ');
      var prep = o.readyAt ? Math.round((o.readyAt - o.createdAt) / 6e3) / 10 : null;
      var atr = (o.status === 'cancelado' || o.backfill || o.status === 'registrado') ? '—' : (o.readyAt ? (o.readyAt - o.createdAt > lateMs ? 'SÍ' : 'NO') : 'EN COCINA');
      var c = [
        s('A' + r, o.backfill ? 'Capturado después' : fmt(o.createdAt)), s('B' + r, PLAT_NAMES[o.plat] || o.plat), s('C' + r, o.code || ''), s('D' + r, o.cust || ''),
        s('E' + r, o.prio === 'urgente' ? 'Urgente' : 'Normal'), s('F' + r, prod), s('G' + r, o.note || ''),
        s('H' + r, o.readyAt ? fmt(o.readyAt) : ''), prep == null ? s('I' + r, '') : n('I' + r, prep), s('J' + r, atr),
        s('K' + r, o.deliveredAt ? fmt(o.deliveredAt) : ''), s('L' + r, o.backfill && o.status !== 'cancelado' ? 'Registrado' : (stTxt[o.status] || o.status))
      ];
      rows.push('<row r="' + r + '">' + c.join('') + '</row>');
    });
    var widths = [16, 15, 14, 18, 11, 70, 28, 12, 15, 13, 15, 13];
    var colsXml = '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    var last = Math.max(8, 8 + sorted.length);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:L' + last + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + colsXml + '<sheetData>' + rows.join('') + '</sheetData>' +
      '<mergeCells count="1"><mergeCell ref="A1:L1"/></mergeCells>' +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }

  /* orders: pedidos del día (cualquier plataforma, cualquier estado). */
  async function buildXlsx(JSZip, templateB64, orders, dayKey, opts) {
    opts = opts || {};
    var markParts = opts.markParts === true;
    var fmt = opts.fmt || function (t) { return new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }); };
    var zip = await JSZip.loadAsync(templateB64, { base64: true });
    var serial = dateSerial(dayKey);
    var report = { dayKey: dayKey, plat: {}, resv: 0, cancelled: 0, missing: [], overflow: [], open: 0 };
    var counts = {}, missingAll = new Map();
    var sorted = orders.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    report.cancelled = sorted.filter(function (o) { return o.status === 'cancelado'; }).length;
    report.resv = sorted.filter(function (o) { return o.plat === 'resv' && o.status !== 'cancelado'; }).length;
    report.open = sorted.filter(function (o) { return o.status === 'cocina' || o.status === 'listo'; }).length;
    for (var k of ['uber', 'didi', 'rappi']) {
      var file = SHEET_FILE[k];
      var xml = await zip.file(file).async('string');
      var list = sorted.filter(function (o) { return o.plat === k && o.status !== 'cancelado'; });
      var plan = planPlatform(list, markParts);
      xml = setCached(xml, 'B3', serial);
      var cnt = {};
      plan.cells.forEach(function (rc) { xml = setX(xml, colName(FIRST_COL + rc[1]) + rc[0]); cnt[rc[0]] = (cnt[rc[0]] || 0) + 1; });
      var sum = 0;
      for (var r = 6; r <= 67; r++) { var v = cnt[r] || 0; sum += v; xml = setCached(xml, 'BA' + r, v); }
      xml = setCached(xml, 'BA69', sum);
      zip.file(file, xml);
      counts[k] = cnt;
      plan.missing.forEach(function (q, name) { add(missingAll, name, q); });
      plan.overflow.forEach(function (o) { report.overflow.push({ plat: k, row: o.row, total: o.total }); });
      report.plat[k] = { name: PLAT_NAMES[k], orders: list.length, withMarks: plan.orders, columns: plan.columns, layout: plan.layout, units: sum };
    }
    var c1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
    c1 = setCached(c1, 'C3', serial);
    var grand = 0, F = {};
    for (var r2 = 6; r2 <= 67; r2++) {
      var f = (counts.uber[r2] || 0) + (counts.didi[r2] || 0) + (counts.rappi[r2] || 0); F[r2] = f; grand += f;
    }
    for (var r3 = 6; r3 <= 67; r3++) {
      c1 = setCached(c1, 'C' + r3, counts.uber[r3] || 0); c1 = setCached(c1, 'D' + r3, counts.didi[r3] || 0);
      c1 = setCached(c1, 'E' + r3, counts.rappi[r3] || 0); c1 = setCached(c1, 'F' + r3, F[r3]);
      c1 = setCached(c1, 'G' + r3, grand ? F[r3] / grand : 0);
    }
    c1 = setCached(c1, 'F69', grand);
    zip.file('xl/worksheets/sheet1.xml', c1);
    report.total = grand;

    // hoja OPERACIÓN
    zip.file('xl/worksheets/sheet5.xml', operationSheet(dayKey, sorted, opts, fmt));
    var ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>'));
    var rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    zip.file('xl/_rels/workbook.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml" /></Relationships>'));
    var wbx = await zip.file('xl/workbook.xml').async('string');
    if (wbx.indexOf('</sheets>') < 0) throw new Error('Plantilla sin lista de hojas');
    zip.file('xl/workbook.xml', wbx.replace('</sheets>', '<sheet name="OPERACIÓN" sheetId="5" r:id="rId20" /></sheets>'));
    var app = await zip.file('docProps/app.xml').async('string');
    app = app.replace('<vt:i4>4</vt:i4>', '<vt:i4>5</vt:i4>').replace('<vt:vector size="4" baseType="lpstr">', '<vt:vector size="5" baseType="lpstr">')
      .replace('</vt:vector></TitlesOfParts>', '<vt:lpstr>OPERACIÓN</vt:lpstr></vt:vector></TitlesOfParts>');
    zip.file('docProps/app.xml', app);

    missingAll.forEach(function (q, name) { report.missing.push({ name: name, qty: q }); });
    report.missing.sort(function (a, b) { return b.qty - a.qty; });
    var bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return { bytes: bytes, report: report };
  }

  var api = { buildXlsx: buildXlsx, ROW: ROW, rowOf: rowOf, orderMarks: orderMarks, planPlatform: planPlatform, dateSerial: dateSerial };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Registro = api;
})(typeof window !== 'undefined' ? window : globalThis);
