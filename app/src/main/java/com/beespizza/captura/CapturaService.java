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
        if (activa) mostrarBurbuja();
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
            long ahora = System.currentTimeMillis();
            if (ahora - ultimaDeteccion < 1500) return;
            ultimaDeteccion = ahora;
            AccessibilityNodeInfo raiz = getRootInActiveWindow();
            if (raiz == null) return;
            List<String> lineas = new ArrayList<>();
            recolectar(raiz, lineas);
            String texto = String.join("\n", lineas);
            if (!LINEA_PRODUCTO.matcher(texto).find()) return;
            String firma = Integer.toHexString(texto.hashCode());
            if (firma.equals(ultimaFirmaDeteccion) && ahora - ultimaFirmaT < 120000) return;
            ultimaFirmaDeteccion = firma;
            ultimaFirmaT = ahora;
            avisarDetectado(texto, plat);
        } catch (Exception ignored) { }
    }

    private long ultimaDeteccion = 0, ultimaFirmaT = 0;
    private String ultimaFirmaDeteccion = "";

    /** Si la pantalla de Bee's está abierta, la pregunta ahí; si no, manda una notificación. */
    private void avisarDetectado(String texto, String plat) {
        MainActivity m = MainActivity.activa;
        if (m != null) { m.pedidoDetectado(texto, plat); return; }
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
        if (!Latido.capturaActiva(this)) {
            aviso("La captura de pedidos está desactivada por el supervisor.");
            return;
        }
        ocupado = true;
        plataforma = plataformaDe(paquete);
        Latido.recordarPlataforma(this, plataforma);
        segmentos.clear();
        bajadas = 0;
        tarjetaDidi = null;
        estadoBurbuja("Leyendo…");
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
        List<String> lineas = new ArrayList<>();
        recolectar(raiz, lineas);
        String texto = String.join("\n", lineas);
        boolean repetida = !segmentos.isEmpty() && segmentos.get(segmentos.size() - 1).equals(texto);
        if (!repetida) segmentos.add(texto);

        AccessibilityNodeInfo lista = buscarLista(raiz);
        if (repetida || paso >= MAX_PANTALLAS || lista == null
                || !lista.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {
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
