package com.beespizza.captura;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.AccelerateDecelerateInterpolator;

import java.util.ArrayList;
import java.util.List;

/**
 * La abejita que confirma un registro: sale del hexágono, vuela en curva dejando puntitos de miel,
 * llega a donde aparecerá «✓ Registrado» y se va volando. No se puede tocar (deja pasar los toques).
 */
final class Abeja extends View {
    private static final int MIEL = 0xFFEF9F27, CAFE = 0xFF412402, ALA = 0xCCE6F1FB, ALA_BORDE = 0xFF85B7EB, RASTRO = 0xFFBA7517;

    private final WindowManager wm;
    private final float d;
    private final float[][] ruta;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final List<float[]> puntos = new ArrayList<>();   // x, y, momento
    private float x, y, giro = 1, aleteo = 0;
    private long inicio;
    private ValueAnimator vuelo, salida;

    private Abeja(Context c, WindowManager wm, float[][] ruta) {
        super(c);
        this.wm = wm;
        this.d = c.getResources().getDisplayMetrics().density;
        this.ruta = ruta;
        x = ruta[0][0];
        y = ruta[0][1];
    }

    /**
     * Vuela del punto (desdeX, desdeY) al (hastaX, hastaY) en pantalla; al llegar corre «llego».
     * Si no se puede mostrar, corre «llego» de una vez.
     */
    static void volar(Context c, WindowManager wm, int desdeX, int desdeY, int hastaX, int hastaY, Runnable llego) {
        float dd = c.getResources().getDisplayMetrics().density;
        float dx = hastaX - desdeX, dy = hastaY - desdeY;
        // Una curva con un par de vueltas: sube, da un rizo y baja a la tarjeta
        float[][] r = {
                {desdeX, desdeY},
                {desdeX + dx * 0.25f + 30 * dd, desdeY + dy * 0.2f - 70 * dd},
                {desdeX + dx * 0.10f, desdeY + dy * 0.45f - 120 * dd},
                {desdeX + dx * 0.55f, desdeY + dy * 0.7f - 150 * dd},
                {desdeX + dx * 0.85f, desdeY + dy * 0.85f - 90 * dd},
                {hastaX + 25 * dd, hastaY - 40 * dd},
                {hastaX, hastaY},
        };
        Abeja a = new Abeja(c, wm, r);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        try {
            wm.addView(a, lp);
        } catch (Exception e) {
            if (llego != null) llego.run();
            return;
        }
        a.empezar(llego);
    }

    private void empezar(Runnable llego) {
        inicio = System.currentTimeMillis();
        vuelo = ValueAnimator.ofFloat(0f, 1f);
        vuelo.setDuration(1800);
        vuelo.setInterpolator(new AccelerateDecelerateInterpolator());
        vuelo.addUpdateListener(va -> {
            float t = (float) va.getAnimatedValue();
            float[] q = punto(t), sig = punto(Math.min(1f, t + 0.01f));
            if (Math.abs(sig[0] - q[0]) > 0.5f) giro = sig[0] < q[0] ? -1 : 1;
            x = q[0];
            y = q[1];
            long ahora = System.currentTimeMillis();
            if (puntos.isEmpty() || ahora - (long) puntos.get(puntos.size() - 1)[2] > 45)
                puntos.add(new float[]{x, y + 6 * d, ahora});
            invalidate();
        });
        vuelo.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator an) {
                if (llego != null) llego.run();
                postDelayed(Abeja.this::irse, 650);
            }
        });
        vuelo.start();
        // Las alas aletean todo el tiempo
        ValueAnimator alas = ValueAnimator.ofFloat(0f, 1f);
        alas.setDuration(90);
        alas.setRepeatCount(ValueAnimator.INFINITE);
        alas.setRepeatMode(ValueAnimator.REVERSE);
        alas.addUpdateListener(va -> { aleteo = (float) va.getAnimatedValue(); invalidate(); });
        alas.start();
        setTag(alas);
    }

    private void irse() {
        final float x0 = x, y0 = y;
        final float w = getWidth() > 0 ? getWidth() : 2000;
        giro = 1;
        salida = ValueAnimator.ofFloat(0f, 1f);
        salida.setDuration(600);
        salida.setInterpolator(new AccelerateInterpolator());
        salida.addUpdateListener(va -> {
            float t = (float) va.getAnimatedValue();
            x = x0 + (w - x0 + 60 * d) * t;
            y = y0 - 60 * d * t;
            setAlpha(1f - t * 0.6f);
            invalidate();
        });
        salida.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator an) { quitar(); }
        });
        salida.start();
    }

    private void quitar() {
        Object alas = getTag();
        if (alas instanceof ValueAnimator) ((ValueAnimator) alas).cancel();
        try { wm.removeView(this); } catch (Exception ignored) { }
    }

    /** Punto de la curva (Catmull-Rom) que pasa por todos los puntos de la ruta. */
    private float[] punto(float t) {
        int n = ruta.length - 1;
        float s = Math.min(n - 1e-4f, t * n);
        int i = (int) Math.floor(s);
        float u = s - i;
        float[] p0 = ruta[Math.max(0, i - 1)], p1 = ruta[i], p2 = ruta[i + 1], p3 = ruta[Math.min(n, i + 2)];
        return new float[]{cr(p0[0], p1[0], p2[0], p3[0], u), cr(p0[1], p1[1], p2[1], p3[1], u)};
    }

    private static float cr(float a, float b, float c, float e, float u) {
        return 0.5f * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - e) * u * u + (-a + 3 * b - 3 * c + e) * u * u * u);
    }

    @Override
    protected void onDraw(Canvas cv) {
        long ahora = System.currentTimeMillis();
        // Rastro de miel que se desvanece
        p.setStyle(Paint.Style.FILL);
        for (float[] q : puntos) {
            long edad = ahora - (long) q[2];
            if (edad > 1200) continue;
            p.setColor(RASTRO);
            p.setAlpha((int) (255 * (1f - edad / 1200f)));
            cv.drawCircle(q[0], q[1], 2.4f * d, p);
        }
        p.setAlpha(255);
        cv.save();
        cv.translate(x, y);
        cv.scale(giro * d * 1.15f, d * 1.15f);
        // Alas (se aplastan al aletear)
        float ala = 1f - 0.6f * aleteo;
        for (float[] w : new float[][]{{-4, -11, 7, 9}, {5, -11, 6, 8}}) {
            RectF r = new RectF(w[0] - w[2], -3 - 2 * w[3] * ala, w[0] + w[2], -3);
            p.setStyle(Paint.Style.FILL); p.setColor(ALA); cv.drawOval(r, p);
            p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(1); p.setColor(ALA_BORDE); cv.drawOval(r, p);
        }
        // Cuerpo con rayas
        RectF cuerpo = new RectF(-15, -7, 15, 15);
        p.setStyle(Paint.Style.FILL); p.setColor(MIEL); cv.drawOval(cuerpo, p);
        cv.save();
        cv.clipRect(cuerpo);
        p.setColor(CAFE);
        cv.drawRect(-8, -8, -4, 16, p);
        cv.drawRect(0, -8, 4, 16, p);
        cv.restore();
        p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(2); p.setColor(CAFE); cv.drawOval(cuerpo, p);
        // Aguijón, cabeza y ojo
        cv.drawLine(-15, 4, -20, 6, p);
        p.setStyle(Paint.Style.FILL);
        cv.drawCircle(16, 3, 6, p);
        p.setColor(0xFFFFFFFF);
        cv.drawCircle(18, 1, 1.6f, p);
        cv.restore();
    }
}
