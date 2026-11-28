package com.beespizza.captura;

import android.animation.ObjectAnimator;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Globito tipo Messenger junto al hexágono: «Nuevo pedido detectado · Uber #2E005 · ¿Lo registro?»
 * con Registrar / Ahora no, o «✓ Registrado» por unos segundos. Sale encima de la app de pedidos.
 */
final class Globo {
    private static final int MIEL = 0xFFF2B705, TINTA = 0xFF1E1C17, GRIS = 0xFF6C6556, VERDE = 0xFF1F7A4D, FONDO = 0xFFFFFDF7;

    private final Context c;
    private final WindowManager wm;
    private final Handler h = new Handler(Looper.getMainLooper());
    private View vista;
    private final Runnable ocultar = this::quitar;

    Globo(Context c, WindowManager wm) { this.c = c; this.wm = wm; }

    private int dp(float v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }

    static int colorDe(String plat) {
        if ("Uber".equals(plat)) return 0xFF1BAF7A;
        if ("DiDi".equals(plat)) return 0xFFEB6834;
        if ("Rappi".equals(plat)) return 0xFFE0234E;
        if ("Reservándonos".equals(plat)) return 0xFF6250D6;
        return MIEL;
    }

    private TextView texto(String t, float sp, int color, boolean negrita) {
        TextView v = new TextView(c);
        v.setText(t);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        v.setTextColor(color);
        if (negrita) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private TextView boton(String t, boolean principal) {
        TextView b = texto(t, 16, principal ? TINTA : GRIS, true);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(18), dp(11), dp(18), dp(11));
        GradientDrawable f = new GradientDrawable();
        f.setCornerRadius(dp(22));
        if (principal) f.setColor(MIEL); else { f.setColor(Color.TRANSPARENT); f.setStroke(dp(1.5f), 0x33000000); }
        b.setBackground(f);
        b.setClickable(true);
        return b;
    }

    /** Arma la tarjeta: franja del color de la app, encabezado, título y (si hay) botones. */
    private LinearLayout tarjeta(String plat, String encabezado, int colorEnc, String titulo, String sub) {
        LinearLayout caja = new LinearLayout(c);
        caja.setOrientation(LinearLayout.HORIZONTAL);
        GradientDrawable f = new GradientDrawable();
        f.setColor(FONDO);
        f.setCornerRadius(dp(20));
        f.setStroke(dp(1), 0x1A000000);
        caja.setBackground(f);
        caja.setElevation(dp(10));
        caja.setPadding(dp(6), dp(6), dp(16), dp(14));

        View franja = new View(c);
        GradientDrawable fr = new GradientDrawable();
        fr.setColor(colorDe(plat));
        fr.setCornerRadius(dp(4));
        franja.setBackground(fr);
        LinearLayout.LayoutParams lf = new LinearLayout.LayoutParams(dp(6), LinearLayout.LayoutParams.MATCH_PARENT);
        lf.setMargins(dp(2), dp(8), dp(12), 0);
        caja.addView(franja, lf);

        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(0, dp(8), 0, 0);
        TextView e = texto(encabezado.toUpperCase(), 11.5f, colorEnc, true);
        e.setLetterSpacing(0.08f);
        col.addView(e);
        TextView t = texto(titulo, 19, TINTA, true);
        t.setPadding(0, dp(3), 0, 0);
        col.addView(t);
        if (sub != null && !sub.isEmpty()) {
            TextView s = texto(sub, 14, GRIS, false);
            s.setPadding(0, dp(2), 0, 0);
            col.addView(s);
        }
        caja.addView(col, new LinearLayout.LayoutParams(dp(250), LinearLayout.LayoutParams.WRAP_CONTENT));
        return caja;
    }

    /** Pregunta si se registra el pedido detectado. */
    void preguntar(String plat, String codigo, int anclaX, int anclaY, int anchoAncla, Runnable registrar, Runnable ahoraNo) {
        quitar();
        LinearLayout caja = tarjeta(plat, "Nuevo pedido detectado", 0xFF7A5600,
                plat + (codigo != null ? " #" + codigo : ""), "¿Lo registro en Bee's?");
        LinearLayout col = (LinearLayout) caja.getChildAt(1);
        LinearLayout fila = new LinearLayout(c);
        fila.setOrientation(LinearLayout.HORIZONTAL);
        fila.setPadding(0, dp(12), 0, 0);
        TextView no = boton("Ahora no", false), si = boton("Registrar", true);
        LinearLayout.LayoutParams lb = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        fila.addView(no, lb);
        LinearLayout.LayoutParams ls = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.3f);
        ls.setMargins(dp(10), 0, 0, 0);
        fila.addView(si, ls);
        col.addView(fila);
        no.setOnClickListener(v -> { quitar(); if (ahoraNo != null) ahoraNo.run(); });
        si.setOnClickListener(v -> { quitar(); if (registrar != null) registrar.run(); });
        mostrar(caja, anclaX, anclaY, anchoAncla, 30000);
    }

    /** Avisa unos segundos que ya quedó registrado. */
    void hecho(String plat, String mensaje, int anclaX, int anclaY, int anchoAncla) {
        quitar();
        // La abejita sale del hexágono y vuela a donde aparece la tarjeta; al llegar, sale «✓ Registrado»
        int[] pos = posicion(anclaX, anclaY, anchoAncla);
        int cx = anclaX + anchoAncla / 2, cy = anclaY + anchoAncla / 2;
        Abeja.volar(c, wm, cx, cy, pos[0] + dp(30), pos[1] + dp(18), () -> {
            LinearLayout caja = tarjeta(plat, "✓ Registrado", VERDE, mensaje, null);
            mostrar(caja, anclaX, anclaY, anchoAncla, 4500);
        });
    }

    /** Dónde va la tarjeta: a la derecha del hexágono si cabe; si no, a la izquierda. */
    private int[] posicion(int anclaX, int anclaY, int anchoAncla) {
        int ancho = c.getResources().getDisplayMetrics().widthPixels;
        int caja = dp(290);
        int x = anclaX + anchoAncla + dp(10) + caja <= ancho ? anclaX + anchoAncla + dp(10) : Math.max(dp(8), anclaX - caja - dp(10));
        return new int[]{x, Math.max(dp(8), anclaY - dp(10))};
    }

    private void mostrar(View v, int anclaX, int anclaY, int anchoAncla, long dura) {
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | Gravity.START;
        int[] pos = posicion(anclaX, anclaY, anchoAncla);
        p.x = pos[0];
        p.y = pos[1];
        try {
            wm.addView(v, p);
            vista = v;
            v.setAlpha(0f);
            v.setTranslationY(dp(12));
            v.animate().alpha(1f).translationY(0).setDuration(220).setInterpolator(new DecelerateInterpolator()).start();
            ObjectAnimator.ofFloat(v, "scaleX", 0.96f, 1f).setDuration(220).start();
            h.removeCallbacks(ocultar);
            h.postDelayed(ocultar, dura);
        } catch (Exception ignored) { vista = null; }
    }

    boolean visible() { return vista != null; }

    void quitar() {
        h.removeCallbacks(ocultar);
        if (vista != null) { try { wm.removeView(vista); } catch (Exception ignored) { } }
        vista = null;
    }
}
