package com.beespizza.captura;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * Botón flotante "Capturar" encima de las apps de pedidos.
 * Al tocarlo: lee el texto del pedido abierto (accesibilidad), baja la pantalla
 * para leer lo que falta, la regresa a como estaba y abre la confirmación.
 * Si la app de pedidos no deja leer su texto, toma la imagen de la pantalla y la lee.
 * Solo lee y desplaza: nunca toca botones de la app de pedidos.
 */
public class CapturaService extends AccessibilityService {

    static CapturaService instancia;

    private static final int MAX_PANTALLAS = 6;
    private static final long ESPERA_SCROLL_MS = 700;
    private static final Pattern LINEA_PRODUCTO = Pattern.compile("(?m)^\\s*[0-9lI]{1,2}\\s*[xX×]");

    private final Handler h = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private Burbuja burbuja;
    private WindowManager.LayoutParams lp;
    private boolean ocupado = false;

    private final List<String> segmentos = new ArrayList<>();
    private String paquete = "";
    private String plataforma = "";
    private int bajadas = 0;
    private TextRecognizer lectorImagen;

    // ---------- ciclo de vida ----------

    @Override
    protected void onServiceConnected() {
        instancia = this;
        if (Latido.capturaActiva(this)) mostrarBurbuja();
        Latido.iniciar(this);
    }

    /** Un supervisor activó o desactivó la captura en todas las tabletas. */
    void aplicarCaptura(boolean activa) {
        if (activa && !Latido.esAdmin(this)) mostrarBurbuja();
        else if (!ocupado) quitarBurbuja();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        try {
            // Detección de pedidos nuevos: solo lee lo que ya está en pantalla (no baja ni toca nada)
            if (event == null || ocupado) return;
            int t = event.getEventType();
            if (t != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED && t != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
            String plat = plataformaDe(String.valueOf(event.getPackageName()));
            // DiDi necesita elegir la tarjeta naranja: sigue siendo solo con el botón
            if (plat.isEmpty() || "DiDi".equals(plat)) return;
            if (!Latido.capturaActiva(this)) return;
            // Registro automático: cuando la pantalla se queda quieta 2 s, revisa el tablero de pedidos
            if (Latido.autoActivo(this)) { h.removeCallbacks(revisionTablero); h.postDelayed(revisionTablero, 2000); }
            // Si hay una lectura completa esperando, cualquier movimiento la vuelve a posponer
            if (lecturaPendiente != null) { h.removeCallbacks(lecturaPendiente); h.postDelayed(lecturaPendiente, 1800); }
            long ahora = System.currentTimeMillis();
            if (ahora - ultimaDeteccion < 1500) return;
            ultimaDeteccion = ahora;
            AccessibilityNodeInfo raiz = getRootInActiveWindow();
            if (raiz == null) return;
            List<String> lineas = new ArrayList<>();
            recolectar(raiz, lineas);
            String texto = String.join("\n", lineas);
            if (!LINEA_PRODUCTO.matcher(texto).find()) return;
            String codigo = codigoDe(texto);
            if (codigo != null && registrados.contains(codigo)) return;   // ya está en el registro de hoy
            if (!TOTAL.matcher(texto).find()) {
                // Pedido nuevo que no se ve completo (el total queda abajo): se lee completo en silencio
                if (codigo == null || (codigo.equals(ultimoLeido) && ahora - ultimoLeidoT < 300000)) return;
                final String cod = codigo;
                if (lecturaPendiente != null) h.removeCallbacks(lecturaPendiente);
                lecturaPendiente = () -> { lecturaPendiente = null; if (!ocupado) { ultimoLeido = cod; ultimoLeidoT = System.currentTimeMillis(); capturaSilenciosa(); } };
                h.postDelayed(lecturaPendiente, 1800);
                return;
            }
            String firma = Integer.toHexString(texto.hashCode());
            if (firma.equals(ultimaFirmaDeteccion) && ahora - ultimaFirmaT < 120000) return;
            ultimaFirmaDeteccion = firma;
            ultimaFirmaT = ahora;
            avisarDetectado(texto, plat);
        } catch (Exception ignored) { }
    }

    private long ultimaDeteccion = 0, ultimaFirmaT = 0, ultimoLeidoT = 0;
    private String ultimaFirmaDeteccion = "", ultimoLeido = "";
    private Runnable lecturaPendiente = null;
    private boolean silencioso = false, usarGesto = false;
    /** Números de pedido ya registrados hoy (los manda la pantalla de Bee's). */
    static final java.util.Set<String> registrados = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    private static final java.util.regex.Pattern TOTAL = java.util.regex.Pattern.compile("(?im)^\\s*total\\b");
    private static final java.util.regex.Pattern COD_UBER = java.util.regex.Pattern.compile("•\\s*([A-Z0-9]{4,8})\\b");
    private static final java.util.regex.Pattern COD_NUM = java.util.regex.Pattern.compile("#\\s?(\\d{4,12})\\b");

    private static final Pattern COD_ID = Pattern.compile("(?i)\\bID\\s*:?\\s*#?\\s?(\\d{4,12})\\b");

    /** Número del pedido en pantalla: «Nombre • 08480» (Uber), «ID: 2487823707» o «#2487823707» (Rappi y otras). */
    static String codigoDe(String texto) {
        java.util.regex.Matcher m = COD_UBER.matcher(texto);
        if (m.find()) return m.group(1);
        m = COD_ID.matcher(texto);
        if (m.find()) return m.group(1);
        m = COD_NUM.matcher(texto);
        return m.find() ? m.group(1) : null;
    }

    // ---------- registro automático desde el tablero (Uber y Rappi) ----------
    //
    // Con el automático prendido, cuando en el tablero aparece un pedido ya aceptado que no está en el registro:
    // toca SOLO el número del pedido, lee el detalle (bajando dentro del detalle), lo cierra con la X
    // (o «atrás») y lo manda a Bee's para registrarse. Nunca toca Aceptar, Rechazar ni Listo.

    private static final Pattern UBER_SOLO = Pattern.compile("^#?\\s?([0-9A-F]{5})$");
    private static final Pattern DETALLE = Pattern.compile("(?i)(detalle de (la )?orden|total sugerido|detalles del pedido)");
    private static final Pattern PENDIENTE = Pattern.compile("(?im)(para aceptar|aceptar pedido|^\\s*aceptar\\s*$|rechazar|nuevo pedido|pedido nuevo)");
    private static final Pattern BOTON_ACEPTAR = Pattern.compile("(?i)^\\s*aceptar( pedido| orden)?\\s*$");
    private static final Pattern PROHIBIDO = Pattern.compile("(?i)(aceptar|rechazar|orden lista|pedido listo|^\\s*listo\\s*$|cancelar|llamar)");
    private static final Pattern CERRAR = Pattern.compile("(?i)^\\s*(x|✕|×|╳|cerrar|close|atr[aá]s|back|regresar|volver|navigate up|navegar hacia arriba|subir)\\s*$");

    private final java.util.Set<String> conocidos = new java.util.HashSet<>();
    private final java.util.Map<String, Integer> intentos = new java.util.HashMap<>();
    private final java.util.Map<String, Long> esperarHasta = new java.util.HashMap<>();
    private long baseAuto = -1;
    private boolean deTablero = false;
    private String codigoTablero = "";
    private final Runnable revisionTablero = this::revisarTablero;

    private static class Nodo { final AccessibilityNodeInfo n; final String s; final Rect r; Nodo(AccessibilityNodeInfo n, String s, Rect r) { this.n = n; this.s = s; this.r = r; } }

    private void nodosConTexto(AccessibilityNodeInfo n, List<Nodo> out) {
        if (n == null) return;
        if (n.isVisibleToUser()) {
            CharSequence t = n.getText();
            if (t == null || t.length() == 0) t = n.getContentDescription();
            if (t != null && t.toString().trim().length() > 0) { Rect r = new Rect(); n.getBoundsInScreen(r); out.add(new Nodo(n, t.toString().trim(), r)); }
        }
        for (int i = 0; i < n.getChildCount(); i++) nodosConTexto(n.getChild(i), out);
    }

    private static String codigoTarjeta(String s, String plat) {
        java.util.regex.Matcher m = COD_ID.matcher(s);
        if (m.find()) return m.group(1);
        if ("Uber".equals(plat)) {
            m = COD_UBER.matcher(s);
            if (m.find()) return m.group(1);
            m = UBER_SOLO.matcher(s.trim());
            if (m.matches() && m.group(1).matches(".*\\d.*")) return m.group(1);
        }
        if ("Rappi".equals(plat)) { m = COD_NUM.matcher(s); if (m.find()) return m.group(1); }
        return null;
    }

    /** La tarjeta del pedido: el primer contenedor tocable alrededor del número (si no es toda la pantalla). */
    private AccessibilityNodeInfo tarjetaDe(AccessibilityNodeInfo n, Rect pantalla) {
        AccessibilityNodeInfo p = n;
        for (int i = 0; i < 7 && p != null; i++) {
            if (p.isClickable()) {
                Rect r = new Rect(); p.getBoundsInScreen(r);
                return r.height() < pantalla.height() * 0.6f ? p : null;
            }
            p = p.getParent();
        }
        return null;
    }

    private static String textoDe(AccessibilityNodeInfo n) {
        if (n == null) return "";
        CharSequence t = n.getText();
        if (t == null || t.length() == 0) t = n.getContentDescription();
        return t == null ? "" : t.toString();
    }

    private void revisarTablero() {
        try {
            if (ocupado || !Latido.autoActivo(this) || Latido.esAdmin(this) || !Latido.capturaActiva(this)) return;
            AccessibilityNodeInfo raiz = getRootInActiveWindow();
            if (raiz == null) return;
            String pkg = String.valueOf(raiz.getPackageName());
            String plat = plataformaDe(pkg);
            if (!"Uber".equals(plat) && !"Rappi".equals(plat)) return;
            List<Nodo> todos = new ArrayList<>();
            nodosConTexto(raiz, todos);
            StringBuilder sb = new StringBuilder();
            for (Nodo x : todos) sb.append(x.s).append('\n');
            String todo = sb.toString();
            // Solo en el tablero (no dentro de un pedido abierto)
            if (DETALLE.matcher(todo).find() || TOTAL.matcher(todo).find() || LINEA_PRODUCTO.matcher(todo).find()) return;
            Rect pantalla = new Rect();
            raiz.getBoundsInScreen(pantalla);
            Collections.sort(todos, (a, b) -> Integer.compare(a.r.top, b.r.top));
            long hasta = Latido.prefs(this).getLong("auto_hasta", 0);
            boolean primera = hasta != baseAuto;
            java.util.Set<String> vistos = new java.util.HashSet<>();
            Nodo elegido = null;
            long ahora = System.currentTimeMillis();
            for (Nodo x : todos) {
                String cod = codigoTarjeta(x.s, plat);
                if (cod == null || !vistos.add(cod)) continue;
                AccessibilityNodeInfo tarjeta = tarjetaDe(x.n, pantalla);
                List<String> l = new ArrayList<>();
                if (tarjeta != null) recolectar(tarjeta, l);
                boolean pendiente = PENDIENTE.matcher(String.join("\n", l)).find();
                if (primera) { if (!pendiente) conocidos.add(cod); continue; }   // lo que ya estaba al prender el automático no se toca
                if (pendiente || conocidos.contains(cod) || registrados.contains(cod)) continue;
                Integer n = intentos.get(cod);
                if (n != null && n >= 2) continue;
                Long espera = esperarHasta.get(cod);
                if (espera != null && ahora < espera) continue;
                if (elegido == null) elegido = x;
            }
            if (primera) { baseAuto = hasta; return; }
            if (elegido != null) abrirDesdeTablero(elegido, plat, pkg, pantalla);
        } catch (Exception ignored) { }
    }

    private boolean tocar(int x, int y) {
        if (Build.VERSION.SDK_INT < 24) return false;
        android.graphics.Path p = new android.graphics.Path();
        p.moveTo(x, y);
        android.accessibilityservice.GestureDescription g = new android.accessibilityservice.GestureDescription.Builder()
                .addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(p, 0, 60)).build();
        return dispatchGesture(g, null, null);
    }

    private void abrirDesdeTablero(Nodo x, String plat, String pkg, Rect pantalla) {
        String cod = codigoTarjeta(x.s, plat);
        if (cod == null) return;
        // El número no debe estar dentro de un botón de la app (Aceptar, Listo…)
        AccessibilityNodeInfo tarjeta = tarjetaDe(x.n, pantalla);
        if (tarjeta != null && (String.valueOf(tarjeta.getClassName()).contains("Button") || PROHIBIDO.matcher(textoDe(tarjeta)).matches())) { conocidos.add(cod); return; }
        ocupado = true;
        deTablero = true;
        codigoTablero = cod;
        plataforma = plat;
        paquete = pkg;
        intentos.put(cod, (intentos.containsKey(cod) ? intentos.get(cod) : 0) + 1);
        estadoBurbuja("Leyendo…");
        boolean ok = tocar(x.r.centerX(), x.r.centerY());
        if (!ok && tarjeta != null) ok = tarjeta.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        if (!ok) { terminarTablero(); return; }
        esperarDetalle(0);
    }

    /** ¿Sigue abierto el detalle del pedido? (nunca deslizar sobre el tablero: en Rappi deslizar hacia abajo acepta) */
    private boolean sigueEnDetalle(AccessibilityNodeInfo raiz) {
        if (raiz == null || !paquete.equals(String.valueOf(raiz.getPackageName()))) return false;
        List<String> l = new ArrayList<>();
        recolectar(raiz, l);
        String t = String.join("\n", l);
        return DETALLE.matcher(t).find() || TOTAL.matcher(t).find() || LINEA_PRODUCTO.matcher(t).find();
    }

    private void esperarDetalle(int intento) {
        h.postDelayed(() -> {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r != null && !paquete.equals(String.valueOf(r.getPackageName()))) { terminarTablero(); return; }
            if (r == null || !sigueEnDetalle(r)) {
                if (intento < 10) esperarDetalle(intento + 1);
                else { fallaTablero("no se abrió el pedido"); terminarTablero(); }
                return;
            }
            // Uber: si todavía pide «Aceptar», se cierra sin tocar nada y se intenta cuando ya esté aceptado
            if ("Uber".equals(plataforma) && hayBotonAceptar(r)) {
                intentos.put(codigoTablero, Math.max(0, intentos.get(codigoTablero) - 1));
                esperarHasta.put(codigoTablero, System.currentTimeMillis() + 30000);
                cerrarDetalle(this::terminarTablero);
                return;
            }
            segmentos.clear();
            bajadas = 0;
            usarGesto = false;
            tarjetaDidi = null;
            silencioso = true;
            leerPorTexto(r, 0);
        }, intento == 0 ? 1200 : 500);
    }

    private boolean hayBotonAceptar(AccessibilityNodeInfo raiz) {
        List<Nodo> l = new ArrayList<>();
        nodosConTexto(raiz, l);
        for (Nodo x : l) if (BOTON_ACEPTAR.matcher(x.s).matches()) return true;
        return false;
    }

    /** Cierra el detalle con la X de arriba (o «atrás» si no la encuentra) y revisa que ya se vea el tablero. */
    private void cerrarDetalle(Runnable despues) {
        AccessibilityNodeInfo r = getRootInActiveWindow();
        boolean ok = false;
        if (r != null && paquete.equals(String.valueOf(r.getPackageName()))) {
            Rect pant = new Rect();
            r.getBoundsInScreen(pant);
            List<Nodo> l = new ArrayList<>();
            nodosConTexto(r, l);
            Nodo mejor = null;
            for (Nodo x : l) {
                if (!CERRAR.matcher(x.s).matches() || x.r.centerY() > pant.top + pant.height() * 0.3f) continue;
                if (mejor == null || x.r.centerX() > mejor.r.centerX()) mejor = x;   // la de más a la derecha
            }
            if (mejor != null) {
                AccessibilityNodeInfo p = mejor.n;
                for (int i = 0; i < 4 && p != null && !p.isClickable(); i++) p = p.getParent();
                ok = p != null && p.isClickable() && p.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                if (!ok) ok = tocar(mejor.r.centerX(), mejor.r.centerY());
            }
        }
        if (!ok) performGlobalAction(GLOBAL_ACTION_BACK);
        h.postDelayed(() -> {
            AccessibilityNodeInfo r2 = getRootInActiveWindow();
            if (r2 != null && sigueEnDetalle(r2)) {
                performGlobalAction(GLOBAL_ACTION_BACK);
                h.postDelayed(despues, 800);
            } else despues.run();
        }, 900);
    }

    private void terminarTablero() {
        deTablero = false;
        silencioso = false;
        fin();
    }

    private void fallaTablero(String motivo) {
        Integer n = intentos.get(codigoTablero);
        if (n != null && n >= 2) { avisarFallo(this, plataforma, codigoTablero, motivo); conocidos.add(codigoTablero); }
        else esperarHasta.put(codigoTablero, System.currentTimeMillis() + 20000);
    }

    private static final java.util.Map<String, Long> fallosAvisados = new java.util.HashMap<>();

    /** Avisa por Telegram que un pedido no se pudo registrar solo (una vez por pedido cada 30 min). */
    static void avisarFallo(android.content.Context c, String plat, String numero, String motivo) {
        try {
            String k = plat + "#" + numero;
            long ahora = System.currentTimeMillis();
            synchronized (fallosAvisados) {
                Long antes = fallosAvisados.get(k);
                if (antes != null && ahora - antes < 1800000) return;
                fallosAvisados.put(k, ahora);
            }
            Latido.diagnostico(c, new org.json.JSONObject().put("aviso", "fallo").put("plat", plat)
                    .put("numero", numero == null ? "" : numero).put("motivo", motivo == null ? "" : motivo));
        } catch (Exception ignored) { }
    }

    /** Lee el pedido completo (bajando y regresando) sin abrir Bee's ni mostrar avisos. */
    private void capturaSilenciosa() {
        AccessibilityNodeInfo raiz = getRootInActiveWindow();
        if (raiz == null || ocupado) return;
        paquete = String.valueOf(raiz.getPackageName());
        String plat = plataformaDe(paquete);
        if (plat.isEmpty() || "DiDi".equals(plat) || Latido.esAdmin(this) || !Latido.capturaActiva(this)) return;
        ocupado = true;
        plataforma = plat;
        segmentos.clear();
        bajadas = 0;
        usarGesto = false;
        tarjetaDidi = null;
        silencioso = true;
        leerPorTexto(raiz, 0);
    }

    /** Desliza con un dedo simulado sobre la lista de productos (para apps cuya lista no acepta «bajar»). */
    private boolean deslizar(AccessibilityNodeInfo raiz, boolean haciaAbajo) {
        if (android.os.Build.VERSION.SDK_INT < 24) return false;
        Rect pantalla = new Rect();
        raiz.getBoundsInScreen(pantalla);
        if (pantalla.height() < 200) return false;
        Rect prod = boundsDeProducto(raiz);
        int x = prod != null ? prod.centerX() : pantalla.left + pantalla.width() / 3;
        int yAbajo = pantalla.top + (int) (pantalla.height() * 0.78f), yArriba = pantalla.top + (int) (pantalla.height() * 0.32f);
        android.graphics.Path p = new android.graphics.Path();
        if (haciaAbajo) { p.moveTo(x, yAbajo); p.lineTo(x, yArriba); } else { p.moveTo(x, yArriba); p.lineTo(x, yAbajo); }
        android.accessibilityservice.GestureDescription g = new android.accessibilityservice.GestureDescription.Builder()
                .addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(p, 0, 380)).build();
        return dispatchGesture(g, null, null);
    }

    /** Dónde está el primer producto en pantalla (para deslizar sobre la lista correcta). */
    private Rect boundsDeProducto(AccessibilityNodeInfo raiz) {
        ArrayDeque<AccessibilityNodeInfo> cola = new ArrayDeque<>();
        cola.add(raiz);
        while (!cola.isEmpty()) {
            AccessibilityNodeInfo n = cola.poll();
            if (n == null) continue;
            CharSequence t = n.getText();
            if (t != null && LINEA_PRODUCTO.matcher(t).find()) { Rect r = new Rect(); n.getBoundsInScreen(r); if (r.width() > 0) return r; }
            for (int i = 0; i < n.getChildCount(); i++) cola.add(n.getChild(i));
        }
        return null;
    }

    /** Cuando un pedido de Uber se lee sin total, manda a la base cómo está armada la pantalla (para arreglar la lectura). */
    private void enviarDiagnostico(String texto) {
        if (!"Uber".equals(plataforma)) return;
        try {
            AccessibilityNodeInfo raiz = getRootInActiveWindow();
            org.json.JSONArray listas = new org.json.JSONArray();
            if (raiz != null) {
                ArrayDeque<AccessibilityNodeInfo> cola = new ArrayDeque<>();
                cola.add(raiz);
                while (!cola.isEmpty() && listas.length() < 15) {
                    AccessibilityNodeInfo n = cola.poll();
                    if (n == null) continue;
                    if (n.isScrollable()) {
                        Rect r = new Rect(); n.getBoundsInScreen(r);
                        List<String> l = new ArrayList<>(); recolectar(n, l);
                        listas.put(new org.json.JSONObject().put("clase", String.valueOf(n.getClassName())).put("id", String.valueOf(n.getViewIdResourceName()))
                                .put("caja", r.flattenToString()).put("lineas", l.size()).put("hijos", n.getChildCount()));
                    }
                    for (int i = 0; i < n.getChildCount(); i++) cola.add(n.getChild(i));
                }
            }
            final org.json.JSONObject d = new org.json.JSONObject().put("plat", plataforma).put("paquete", paquete).put("bajadas", bajadas)
                    .put("gesto", usarGesto).put("silencioso", silencioso).put("pantallas", segmentos.size()).put("listas", listas)
                    .put("final", texto.length() > 600 ? texto.substring(texto.length() - 600) : texto);
            Latido.diagnostico(this, d);
        } catch (Exception ignored) { }
    }

    /** Si la pantalla de Bee's está abierta, la pregunta ahí; si no, manda una notificación. */
    private void avisarDetectado(String texto, String plat) {
        MainActivity m = MainActivity.activa;
        if (m != null) { m.pedidoDetectado(texto, plat); return; }
        if (Latido.autoActivo(this)) {
            Intent a = new Intent(this, MainActivity.class);
            a.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            a.putExtra("texto", texto);
            a.putExtra("plataforma", plat);
            a.putExtra("metodo", "detectado");
            a.putExtra("paquete", paquete);
            a.putExtra("detectado", true);
            startActivity(a);
            return;
        }
        android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (android.os.Build.VERSION.SDK_INT >= 26)
            nm.createNotificationChannel(new android.app.NotificationChannel("pedidos", "Pedidos nuevos", android.app.NotificationManager.IMPORTANCE_HIGH));
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(this, 0, i,
                android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.Notification n = new androidx.core.app.NotificationCompat.Builder(this, "pedidos")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Se detectó pedido nuevo · " + plat)
                .setContentText("Abre Bee's Captura y toca Registrar si es el pedido.")
                .setAutoCancel(true).setContentIntent(pi).build();
        nm.notify(4242, n);
    }

    @Override
    public void onInterrupt() { }

    @Override
    public boolean onUnbind(Intent intent) {
        quitarBurbuja();
        instancia = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        quitarBurbuja();
        instancia = null;
        super.onDestroy();
    }

    // ---------- botón flotante ----------

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void mostrarBurbuja() {
        if (burbuja != null) return;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        burbuja = new Burbuja(this);

        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        SharedPreferences pref = getSharedPreferences("burbuja", MODE_PRIVATE);
        lp.x = pref.getInt("x", dp(16));
        lp.y = pref.getInt("y", dp(140));

        burbuja.setOnTouchListener(new View.OnTouchListener() {
            float tx, ty;
            int sx, sy;
            boolean movio;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        tx = e.getRawX(); ty = e.getRawY(); sx = lp.x; sy = lp.y; movio = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int mx = (int) (e.getRawX() - tx), my = (int) (e.getRawY() - ty);
                        if (Math.abs(mx) > dp(8) || Math.abs(my) > dp(8)) movio = true;
                        if (movio) {
                            lp.x = Math.max(0, sx + mx);
                            lp.y = Math.max(0, sy + my);
                            wm.updateViewLayout(burbuja, lp);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (movio) {
                            getSharedPreferences("burbuja", MODE_PRIVATE).edit()
                                    .putInt("x", lp.x).putInt("y", lp.y).apply();
                        } else {
                            capturar();
                        }
                        return true;
                }
                return false;
            }
        });

        try {
            wm.addView(burbuja, lp);
        } catch (Exception e) {
            burbuja = null;
        }
    }

    private void quitarBurbuja() {
        if (burbuja != null && wm != null) {
            try { wm.removeView(burbuja); } catch (Exception ignored) { }
        }
        burbuja = null;
    }

    private void estadoBurbuja(String texto) {
        if (burbuja != null) burbuja.setEstado(texto.startsWith("Leyendo") ? Burbuja.LEYENDO : Burbuja.LISTO);
    }

    /** La pantalla de confirmación avisa que se registró: el hexágono se pone verde y sale el aviso. */
    void marcarRegistrado(String mensaje) {
        h.post(() -> {
            if (burbuja != null) burbuja.setEstado(Burbuja.HECHO);
            if (mensaje != null && !mensaje.isEmpty()) Toast.makeText(this, mensaje, Toast.LENGTH_SHORT).show();
        });
    }

    private void aviso(String m) {
        Toast.makeText(this, m, Toast.LENGTH_LONG).show();
    }

    private void fin() {
        ocupado = false;
        estadoBurbuja("Capturar");
        if (burbuja != null) burbuja.setVisibility(View.VISIBLE);
    }

    // ---------- captura ----------

    void capturar() {
        if (ocupado) return;
        AccessibilityNodeInfo raiz = getRootInActiveWindow();
        if (raiz == null) {
            aviso("No pude leer la pantalla. Abre el pedido e intenta de nuevo.");
            return;
        }
        paquete = String.valueOf(raiz.getPackageName());
        if (paquete.equals(getPackageName())) {
            aviso("Primero abre el pedido en Uber, DiDi, Rappi o Reservándonos.");
            return;
        }
        if (Latido.esAdmin(this)) {
            aviso("Este equipo está en modo administrador: no captura pedidos.");
            return;
        }
        if (!Latido.capturaActiva(this)) {
            aviso("La captura de pedidos está desactivada por el supervisor.");
            return;
        }
        ocupado = true;
        plataforma = plataformaDe(paquete);
        Latido.recordarPlataforma(this, plataforma);
        segmentos.clear();
        bajadas = 0;
        usarGesto = false;
        silencioso = false;
        tarjetaDidi = null;
        estadoBurbuja("Leyendo…");
        guardarPantalla();
        if ("DiDi".equals(plataforma)) elegirTarjetaDidi(raiz, () -> {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r == null) { aviso("No pude leer la pantalla. Intenta de nuevo."); fin(); } else leerPorTexto(r, 0);
        });
        else leerPorTexto(raiz, 0);
    }

    // ---------- DiDi: solo el pedido marcado en naranja ----------

    /** Zona (en la pantalla) de la tarjeta del pedido abierto en la lista de la izquierda de DiDi. */
    private Rect tarjetaDidi = null;
    private int corteIzq = 0;   // x donde termina la lista de pedidos de la izquierda
    private static final Pattern NUM_TARJETA = Pattern.compile("^#\\s?\\d{1,6}$");
    private static final Pattern ACTIVO = Pattern.compile("(?i)(preparar pedido|llegar[aá] en|listo en|recoger|entregar)");
    private static final Pattern NO_ACTIVO = Pattern.compile("(?i)(reembolso|cancel|procesamiento restante)");

    private static class Txt { final String s; final Rect r; Txt(String s, Rect r) { this.s = s; this.r = r; } }

    private void textosConCaja(AccessibilityNodeInfo n, List<Txt> out) {
        if (n == null) return;
        if (n.isVisibleToUser()) {
            CharSequence t = n.getText();
            if (t == null || t.length() == 0) t = n.getContentDescription();
            if (t != null && t.toString().trim().length() > 0) {
                Rect r = new Rect();
                n.getBoundsInScreen(r);
                out.add(new Txt(t.toString().trim(), r));
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) textosConCaja(n.getChild(i), out);
    }

    private boolean algunoSeleccionado(AccessibilityNodeInfo n, Rect zona) {
        if (n == null) return false;
        Rect r = new Rect();
        n.getBoundsInScreen(r);
        // Solo cuenta algo seleccionado dentro de la tarjeta (no el menú «En curso» de la orilla)
        if (n.isSelected() && r.left >= zona.left && zona.contains(r.centerX(), r.centerY()) && r.height() <= zona.height() * 1.2f) return true;
        for (int i = 0; i < n.getChildCount(); i++) if (algunoSeleccionado(n.getChild(i), zona)) return true;
        return false;
    }

    /**
     * En la pantalla «En curso» de DiDi hay una tarjeta por pedido a la izquierda; el abierto lleva una franja naranja.
     * Se elige esa tarjeta (por la franja en la imagen, por estar seleccionada o por su estado) y se ignoran las demás.
     */
    private void elegirTarjetaDidi(AccessibilityNodeInfo raiz, Runnable sigue) {
        Rect pant = new Rect();
        raiz.getBoundsInScreen(pant);
        int ancho = Math.max(1, pant.width());
        corteIzq = pant.left + Math.round(ancho * 0.40f);
        List<Txt> todos = new ArrayList<>();
        textosConCaja(raiz, todos);
        List<Rect> nums = new ArrayList<>();
        for (Txt t : todos) if (t.r.centerX() < corteIzq && NUM_TARJETA.matcher(t.s).matches()) nums.add(t.r);
        if (nums.size() < 2) { sigue.run(); return; }   // un solo pedido: no hay nada que elegir
        Collections.sort(nums, (a, b) -> Integer.compare(a.top, b.top));
        final List<Rect> tarjetas = new ArrayList<>();
        for (int i = 0; i < nums.size(); i++) {
            int top = nums.get(i).top - Math.round(nums.get(i).height() * 0.8f);
            int bottom = i + 1 < nums.size() ? nums.get(i + 1).top - Math.round(nums.get(i + 1).height() * 0.8f) : pant.bottom;
            int left = Math.max(pant.left, nums.get(i).left - Math.round(ancho * 0.05f));
            tarjetas.add(new Rect(left, top, corteIzq, bottom));
        }
        // 1) La tarjeta marcada como seleccionada
        for (Rect z : tarjetas) if (algunoSeleccionado(raiz, z)) { tarjetaDidi = z; sigue.run(); return; }
        // 2) La franja naranja en la imagen de la pantalla (si se puede tomar sin pedir permiso)
        if (Build.VERSION.SDK_INT >= 30 || ProyeccionService.proyeccion != null) {
            if (burbuja != null) burbuja.setVisibility(View.INVISIBLE);
            h.postDelayed(() -> tomarImagen(bmp -> {
                if (burbuja != null) burbuja.setVisibility(View.VISIBLE);
                int k = bmp == null ? -1 : tarjetaConFranja(bmp, tarjetas);
                tarjetaDidi = k >= 0 ? tarjetas.get(k) : porEstado(todos, tarjetas);
                sigue.run();
            }), 150);
            return;
        }
        // 3) La única tarjeta con un pedido en preparación
        tarjetaDidi = porEstado(todos, tarjetas);
        sigue.run();
    }

    private Rect porEstado(List<Txt> todos, List<Rect> tarjetas) {
        Rect elegida = null;
        int activas = 0;
        for (Rect z : tarjetas) {
            StringBuilder sb = new StringBuilder();
            for (Txt t : todos) if (z.contains(t.r.centerX(), t.r.centerY())) sb.append(t.s).append('\n');
            String s = sb.toString();
            if (ACTIVO.matcher(s).find() && !NO_ACTIVO.matcher(s).find()) { activas++; elegida = z; }
        }
        return activas == 1 ? elegida : null;
    }

    private static boolean naranja(int c) {
        int r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
        return r > 200 && g > 50 && g < 160 && b < 100 && r - g > 70;
    }

    /** Cuál tarjeta tiene la franja naranja de su lado izquierdo (o -1 si ninguna se distingue). */
    static int tarjetaConFranja(Bitmap bmp, List<Rect> tarjetas) {
        int mejor = -1, mejorPuntos = 0, segundo = 0;
        for (int i = 0; i < tarjetas.size(); i++) {
            Rect z = tarjetas.get(i);
            int x0 = Math.max(0, z.left), x1 = Math.min(bmp.getWidth() - 1, z.left + Math.round((z.right - z.left) * 0.25f));
            int y0 = Math.max(0, z.top), y1 = Math.min(bmp.getHeight() - 1, z.bottom);
            int puntos = 0;
            for (int x = x0; x <= x1; x += 2) {
                int col = 0;
                for (int y = y0; y <= y1; y += 3) if (naranja(bmp.getPixel(x, y))) col++;
                puntos = Math.max(puntos, col);   // la columna con más naranja (la franja es vertical)
            }
            if (puntos > mejorPuntos) { segundo = mejorPuntos; mejorPuntos = puntos; mejor = i; }
            else if (puntos > segundo) segundo = puntos;
        }
        int alto = Math.max(1, (tarjetas.get(Math.max(0, mejor)).height()) / 3);
        return mejor >= 0 && mejorPuntos >= alto * 0.4f && mejorPuntos > segundo * 2 ? mejor : -1;
    }

    /** Con DiDi: de la lista de la izquierda solo cuenta lo que está dentro de la tarjeta elegida. */
    private boolean fueraDeTarjeta(Rect r) {
        if (tarjetaDidi == null) return false;
        if (r.centerX() >= corteIzq) return false;
        return !tarjetaDidi.contains(r.centerX(), r.centerY());
    }

    static String plataformaDe(String pkg) {
        String p = pkg.toLowerCase();
        if (p.contains("uber")) return "Uber";
        if (p.contains("rappi")) return "Rappi";
        if (p.contains("didi")) return "DiDi";
        if (p.contains("reserv")) return "Reservándonos";
        return "";
    }

    /** Lee el texto de la pantalla, baja y vuelve a leer hasta que ya no cambie. */
    private void leerPorTexto(AccessibilityNodeInfo raiz, int paso) {
        // Desde el tablero: si el detalle ya no está abierto, no se lee ni se desliza nada más
        if (deTablero && !sigueEnDetalle(raiz)) { terminarTexto(); return; }
        List<String> lineas = new ArrayList<>();
        recolectar(raiz, lineas);
        String texto = String.join("\n", lineas);
        boolean repetida = !segmentos.isEmpty() && segmentos.get(segmentos.size() - 1).equals(texto);
        if (!repetida) segmentos.add(texto);

        boolean bajo = false;
        if (repetida && !usarGesto && paso <= 1 && android.os.Build.VERSION.SDK_INT >= 24) {
            // La lista dijo que sí bajó pero no se movió (pasa en Uber): se intenta deslizando
            if (bajadas > 0) bajadas--;
            usarGesto = true;
            bajo = deslizar(raiz, true);
        } else if (!repetida && paso < MAX_PANTALLAS) {
            AccessibilityNodeInfo lista = usarGesto ? null : buscarLista(raiz);
            if (lista != null && lista.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) bajo = true;
            else if (android.os.Build.VERSION.SDK_INT >= 24 && deslizar(raiz, true)) { usarGesto = true; bajo = true; }
        }
        if (!bajo) {
            terminarTexto();
            return;
        }
        bajadas++;
        h.postDelayed(() -> {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r == null) terminarTexto(); else leerPorTexto(r, paso + 1);
        }, ESPERA_SCROLL_MS);
    }

    private void terminarTexto() {
        final String texto = String.join("\n---\n", segmentos);
        if (!TOTAL.matcher(texto).find()) enviarDiagnostico(texto);
        if (deTablero) {
            // Se regresa arriba, se cierra el detalle y ya con el tablero a la vista se manda a registrar
            final String cod = codigoTablero, plat = plataforma;
            final boolean completo = LINEA_PRODUCTO.matcher(texto).find() && TOTAL.matcher(texto).find();
            regresarArriba(() -> cerrarDetalle(() -> {
                if (completo) { conocidos.add(cod); avisarDetectado(texto, plat); }
                else fallaTablero("no se pudo leer completo");
                terminarTablero();
            }));
            return;
        }
        if (silencioso) {
            regresarArriba(() -> {
                silencioso = false;
                if (LINEA_PRODUCTO.matcher(texto).find()) avisarDetectado(texto, plataforma);
                fin();
            });
            return;
        }
        regresarArriba(() -> {
            if (LINEA_PRODUCTO.matcher(texto).find()) {
                abrirConfirmacion(texto, plataforma, "texto");
            } else {
                // La app no deja leer su texto: usamos la imagen de la pantalla
                leerPorImagen();
            }
        });
    }

    /** Regresa la lista a como estaba antes de capturar. */
    private void regresarArriba(Runnable despues) {
        if (bajadas <= 0) { despues.run(); return; }
        if (usarGesto) {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r == null || android.os.Build.VERSION.SDK_INT < 24 || (deTablero && !sigueEnDetalle(r))) { bajadas = 0; despues.run(); return; }
            deslizar(r, false);
            bajadas--;
            h.postDelayed(() -> regresarArriba(despues), 450);
            return;
        }
        AccessibilityNodeInfo r = getRootInActiveWindow();
        AccessibilityNodeInfo lista = r == null ? null : buscarLista(r);
        if (lista == null) { bajadas = 0; despues.run(); return; }
        lista.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
        bajadas--;
        h.postDelayed(() -> regresarArriba(despues), 350);
    }

    /** Recorre la pantalla en orden y junta el texto visible, una línea por renglón. */
    private void recolectar(AccessibilityNodeInfo n, List<String> out) {
        if (n == null) return;
        if (n.isVisibleToUser()) {
            CharSequence t = n.getText();
            if (t == null || t.length() == 0) t = n.getContentDescription();
            if (t != null && tarjetaDidi != null) {
                Rect r = new Rect();
                n.getBoundsInScreen(r);
                if (fueraDeTarjeta(r)) t = null;
            }
            if (t != null) {
                for (String l : t.toString().split("\\r?\\n")) {
                    String s = l.trim();
                    if (s.isEmpty()) continue;
                    if (!out.isEmpty() && out.get(out.size() - 1).equals(s)) continue;
                    out.add(s);
                }
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) recolectar(n.getChild(i), out);
    }

    /** La lista que se puede bajar y que tiene más productos (la del detalle del pedido). */
    private AccessibilityNodeInfo buscarLista(AccessibilityNodeInfo raiz) {
        AccessibilityNodeInfo mejor = null;
        int mejorPuntos = -1;
        ArrayDeque<AccessibilityNodeInfo> cola = new ArrayDeque<>();
        cola.add(raiz);
        while (!cola.isEmpty()) {
            AccessibilityNodeInfo n = cola.poll();
            if (n == null) continue;
            if (n.isScrollable()) {
                List<String> l = new ArrayList<>();
                recolectar(n, l);
                int puntos = 0;
                for (String s : l) if (LINEA_PRODUCTO.matcher(s).find()) puntos += 10;
                puntos += Math.min(l.size(), 9);
                if (puntos > mejorPuntos) { mejorPuntos = puntos; mejor = n; }
            }
            for (int i = 0; i < n.getChildCount(); i++) cola.add(n.getChild(i));
        }
        return mejor;
    }

    // ---------- lectura de imagen (respaldo) ----------

    private void leerPorImagen() {
        segmentos.clear();
        estadoBurbuja("Leyendo imagen…");
        if (Build.VERSION.SDK_INT < 30 && ProyeccionService.proyeccion == null) {
            // Android 8 a 10: hay que dar permiso de captura de pantalla una vez
            Intent i = new Intent(this, ProyeccionActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return; // sigue en proyeccionLista()
        }
        tomarImagenYBajar(0);
    }

    void proyeccionLista() {
        // Se espera a que se cierre la ventana del permiso y vuelva a verse la app de pedidos
        h.postDelayed(() -> {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r != null && getPackageName().equals(String.valueOf(r.getPackageName()))) {
                aviso("Permiso listo. Abre el pedido y toca el hexágono otra vez.");
                fin();
                return;
            }
            tomarImagenYBajar(0);
        }, 1200);
    }

    void proyeccionNegada() {
        aviso("Sin el permiso de captura no puedo leer esta app.");
        fin();
    }

    private void tomarImagenYBajar(int paso) {
        if (burbuja != null) burbuja.setVisibility(View.INVISIBLE);
        h.postDelayed(() -> tomarImagen(bmp -> {
            if (burbuja != null) burbuja.setVisibility(View.VISIBLE);
            if (bmp == null) { cerrarImagen(); return; }
            leerTexto(bmp, texto -> {
                boolean repetida = !segmentos.isEmpty() && segmentos.get(segmentos.size() - 1).equals(texto);
                if (!repetida && !texto.isEmpty()) segmentos.add(texto);
                AccessibilityNodeInfo r = getRootInActiveWindow();
                AccessibilityNodeInfo lista = r == null ? null : buscarLista(r);
                if (repetida || paso >= MAX_PANTALLAS || lista == null
                        || !lista.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {
                    cerrarImagen();
                    return;
                }
                bajadas++;
                h.postDelayed(() -> tomarImagenYBajar(paso + 1), ESPERA_SCROLL_MS);
            });
        }), 200);
    }

    private void cerrarImagen() {
        final String texto = String.join("\n---\n", segmentos);
        regresarArriba(() -> {
            if (texto.trim().isEmpty()) {
                aviso("No encontré texto en la pantalla.");
                fin();
            } else {
                abrirConfirmacion(texto, plataforma, "imagen");
            }
        });
    }

    // ---------- Imagen de la pantalla (para el resumen de ventas del corte) ----------
    static volatile String ultimaPantalla = "";
    static volatile long ultimaPantallaAt = 0;

    /** Guarda una imagen de lo que se ve al tocar el hexágono (Android 11 o más nuevo). Si es un resumen de ventas, Bee's la guarda para el corte. */
    private void guardarPantalla() {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult r) {
                    new Thread(() -> {
                        try {
                            Bitmap hw = Bitmap.wrapHardwareBuffer(r.getHardwareBuffer(), r.getColorSpace());
                            Bitmap bmp = hw == null ? null : hw.copy(Bitmap.Config.ARGB_8888, false);
                            r.getHardwareBuffer().close();
                            if (bmp == null) return;
                            float k = Math.min(1f, 1400f / Math.max(bmp.getWidth(), bmp.getHeight()));
                            Bitmap chica = k < 1f ? Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * k), Math.round(bmp.getHeight() * k), true) : bmp;
                            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                            chica.compress(Bitmap.CompressFormat.JPEG, 72, out);
                            ultimaPantalla = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
                            ultimaPantallaAt = System.currentTimeMillis();
                        } catch (Exception ignored) { }
                    }).start();
                }

                @Override
                public void onFailure(int codigo) { }
            });
        } catch (Exception ignored) { }
    }

    private void tomarImagen(Consumer<Bitmap> listo) {
        if (Build.VERSION.SDK_INT >= 30) {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult r) {
                    try {
                        Bitmap hw = Bitmap.wrapHardwareBuffer(r.getHardwareBuffer(), r.getColorSpace());
                        Bitmap bmp = hw == null ? null : hw.copy(Bitmap.Config.ARGB_8888, false);
                        r.getHardwareBuffer().close();
                        listo.accept(bmp);
                    } catch (Exception e) {
                        listo.accept(null);
                    }
                }

                @Override
                public void onFailure(int codigo) {
                    aviso("No pude tomar la imagen de la pantalla (código " + codigo + ").");
                    listo.accept(null);
                }
            });
        } else {
            ProyeccionService.capturar(this, bmp -> h.post(() -> listo.accept(bmp)));
        }
    }

    private void leerTexto(Bitmap bmp, Consumer<String> listo) {
        if (lectorImagen == null) lectorImagen = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        final int ancho = bmp.getWidth();
        lectorImagen.process(InputImage.fromBitmap(bmp, 0))
                .addOnSuccessListener(t -> { bmpActual = bmp; try { listo.accept(ordenarRenglones(t, ancho)); } finally { bmpActual = null; } })
                .addOnFailureListener(e -> listo.accept(""));
    }

    private Bitmap bmpActual = null;

    /**
     * Ordena el texto leído de la imagen por renglones, de arriba abajo y de izquierda a derecha.
     * Quita las columnas que no son el detalle del pedido: en DiDi la lista de pedidos
     * de la izquierda; en Uber y Rappi el panel de la derecha.
     */
    private String ordenarRenglones(Text t, int ancho) {
        List<Text.Line> lineas = new ArrayList<>();
        // DiDi tiene dos pantallas: el pedido en curso (lista de pedidos a la izquierda)
        // y el detalle del historial (ventana completa con la línea de tiempo a la derecha)
        boolean historialDidi = "DiDi".equals(plataforma) && t.getText().matches("(?is).*(imprimir recibo|soporte didi|socio repartidor).*");
        // DiDi en curso: de la lista de la izquierda solo se queda la tarjeta con la franja naranja (el pedido abierto)
        Rect tarjeta = tarjetaDidi;
        if ("DiDi".equals(plataforma) && !historialDidi && tarjeta == null && bmpActual != null) {
            List<Rect> nums = new ArrayList<>();
            for (Text.TextBlock b : t.getTextBlocks())
                for (Text.Line l : b.getLines()) {
                    Rect r = l.getBoundingBox();
                    if (r != null && r.left < ancho * 0.38f && NUM_TARJETA.matcher(l.getText().trim()).matches()) nums.add(r);
                }
            if (nums.size() >= 2) {
                Collections.sort(nums, (a, b) -> Integer.compare(a.top, b.top));
                List<Rect> zonas = new ArrayList<>();
                for (int i = 0; i < nums.size(); i++) {
                    int top = nums.get(i).top - Math.round(nums.get(i).height() * 0.8f);
                    int bottom = i + 1 < nums.size() ? nums.get(i + 1).top - Math.round(nums.get(i + 1).height() * 0.8f) : bmpActual.getHeight();
                    zonas.add(new Rect(Math.max(0, nums.get(i).left - Math.round(ancho * 0.05f)), top, Math.round(ancho * 0.40f), bottom));
                }
                int k = tarjetaConFranja(bmpActual, zonas);
                if (k >= 0) tarjeta = zonas.get(k);
            }
        }
        for (Text.TextBlock b : t.getTextBlocks()) {
            for (Text.Line l : b.getLines()) {
                Rect r = l.getBoundingBox();
                if (r == null) continue;
                float x = r.left / (float) ancho;
                boolean enTarjeta = tarjeta != null && x < 0.40f && tarjeta.contains(r.centerX(), r.centerY());
                if (!enTarjeta && (historialDidi ? x > 0.68f : "DiDi".equals(plataforma) ? x < 0.38f : x > 0.64f)) continue;
                lineas.add(l);
            }
        }
        Collections.sort(lineas, (a, b) -> Integer.compare(a.getBoundingBox().centerY(), b.getBoundingBox().centerY()));
        StringBuilder sb = new StringBuilder();
        List<Text.Line> renglon = new ArrayList<>();
        // Un renglón junta lo que se encima de alto (aunque tenga distinto tamaño de letra),
        // así «Usuario» y «Socio repartidor», o el nombre del combo y su etiqueta, quedan juntos y en orden
        int arriba = 0, abajo = 0, altoMin = 0;
        for (Text.Line l : lineas) {
            Rect r = l.getBoundingBox();
            if (!renglon.isEmpty()) {
                int encima = Math.min(abajo, r.bottom) - Math.max(arriba, r.top);
                if (encima < 0.45f * Math.min(altoMin, Math.max(1, r.height()))) {
                    volcar(renglon, sb);
                    renglon.clear();
                }
            }
            if (renglon.isEmpty()) { arriba = r.top; abajo = r.bottom; altoMin = Math.max(1, r.height()); }
            else { arriba = Math.min(arriba, r.top); abajo = Math.max(abajo, r.bottom); altoMin = Math.min(altoMin, Math.max(1, r.height())); }
            renglon.add(l);
        }
        volcar(renglon, sb);
        return sb.toString().trim();
    }

    private void volcar(List<Text.Line> renglon, StringBuilder sb) {
        Collections.sort(renglon, (a, b) -> Integer.compare(a.getBoundingBox().left, b.getBoundingBox().left));
        for (Text.Line l : renglon) sb.append(l.getText().trim()).append('\n');
    }

    // ---------- confirmación ----------

    private void abrirConfirmacion(String texto, String plat, String metodo) {
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("texto", texto);
        i.putExtra("plataforma", plat);
        i.putExtra("metodo", metodo);
        i.putExtra("paquete", paquete);
        startActivity(i);
        fin();
    }
}
