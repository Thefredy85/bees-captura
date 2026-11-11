package com.beespizza.captura;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
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
import android.widget.TextView;
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
    private TextView burbuja;
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
        mostrarBurbuja();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { }

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

        burbuja = new TextView(this);
        burbuja.setText("Capturar");
        burbuja.setTextColor(0xFF3A2C00);
        burbuja.setTypeface(Typeface.DEFAULT_BOLD);
        burbuja.setTextSize(16);
        burbuja.setGravity(Gravity.CENTER);
        burbuja.setPadding(dp(20), dp(12), dp(20), dp(12));
        GradientDrawable fondo = new GradientDrawable();
        fondo.setColor(0xFFF2B705);
        fondo.setCornerRadius(dp(28));
        fondo.setStroke(dp(2), 0xFF3A2C00);
        burbuja.setBackground(fondo);
        burbuja.setElevation(dp(6));

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
        if (burbuja != null) burbuja.setText(texto);
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
            aviso("Primero abre el pedido en la app de Uber, DiDi o Rappi.");
            return;
        }
        ocupado = true;
        plataforma = plataformaDe(paquete);
        segmentos.clear();
        bajadas = 0;
        estadoBurbuja("Leyendo…");
        leerPorTexto(raiz, 0);
    }

    static String plataformaDe(String pkg) {
        String p = pkg.toLowerCase();
        if (p.contains("uber")) return "Uber";
        if (p.contains("rappi")) return "Rappi";
        if (p.contains("didi")) return "DiDi";
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
        h.postDelayed(() -> tomarImagenYBajar(0), 600);
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
                .addOnSuccessListener(t -> listo.accept(ordenarRenglones(t, ancho)))
                .addOnFailureListener(e -> listo.accept(""));
    }

    /**
     * Ordena el texto leído de la imagen por renglones, de arriba abajo y de izquierda a derecha.
     * Quita las columnas que no son el detalle del pedido: en DiDi la lista de pedidos
     * de la izquierda; en Uber y Rappi el panel de la derecha.
     */
    private String ordenarRenglones(Text t, int ancho) {
        List<Text.Line> lineas = new ArrayList<>();
        for (Text.TextBlock b : t.getTextBlocks()) {
            for (Text.Line l : b.getLines()) {
                Rect r = l.getBoundingBox();
                if (r == null) continue;
                float x = r.left / (float) ancho;
                if ("DiDi".equals(plataforma) ? x < 0.38f : x > 0.64f) continue;
                lineas.add(l);
            }
        }
        Collections.sort(lineas, (a, b) -> Integer.compare(a.getBoundingBox().centerY(), b.getBoundingBox().centerY()));
        StringBuilder sb = new StringBuilder();
        List<Text.Line> renglon = new ArrayList<>();
        float centro = -1, alto = 0;
        for (Text.Line l : lineas) {
            Rect r = l.getBoundingBox();
            if (!renglon.isEmpty() && Math.abs(r.centerY() - centro) > alto * 0.6f) {
                volcar(renglon, sb);
                renglon.clear();
            }
            if (renglon.isEmpty()) { centro = r.centerY(); alto = Math.max(1, r.height()); }
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
