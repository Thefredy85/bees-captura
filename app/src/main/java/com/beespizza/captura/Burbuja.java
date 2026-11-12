package com.beespizza.captura;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * Botón flotante en forma de hexágono de panal (diseño A).
 * Listo: miel y late suave. Leyendo: oscuro con un arco que gira. Hecho: verde con palomita 3 segundos.
 */
public class Burbuja extends View {

    static final int LISTO = 0, LEYENDO = 1, HECHO = 2;

    private static final int MIEL = 0xFFF2B705, TINTA = 0xFF3A2C00, VERDE = 0xFF1F7A4D, BLANCO = 0xFFFFFFFF;

    private int estado = LISTO;
    private float fase = 0f;
    private final Paint relleno = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borde = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint trazo = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path hex = new Path();
    private final RectF arco = new RectF();
    private ValueAnimator anim;
    private final Handler h = new Handler(Looper.getMainLooper());

    public Burbuja(Context c) {
        super(c);
        borde.setStyle(Paint.Style.STROKE);
        borde.setStrokeWidth(dp(2));
        borde.setColor(TINTA);
        trazo.setStyle(Paint.Style.STROKE);
        trazo.setStrokeCap(Paint.Cap.ROUND);
        trazo.setStrokeJoin(Paint.Join.ROUND);
        trazo.setStrokeWidth(dp(3));
        setContentDescription("Capturar pedido");
        animar();
    }

    private float dp(float v) { return v * getResources().getDisplayMetrics().density; }

    @Override
    protected void onMeasure(int w, int hh) {
        setMeasuredDimension((int) dp(64), (int) dp(72));
    }

    @Override
    protected void onSizeChanged(int w, int hh, int ow, int oh) {
        float m = dp(4), cx = w / 2f, top = m, bot = hh - m, left = m, right = w - m;
        float q = (bot - top) / 4f;
        hex.reset();
        hex.moveTo(cx, top);
        hex.lineTo(right, top + q);
        hex.lineTo(right, bot - q);
        hex.lineTo(cx, bot);
        hex.lineTo(left, bot - q);
        hex.lineTo(left, top + q);
        hex.close();
    }

    void setEstado(int e) {
        estado = e;
        animar();
        invalidate();
        if (e == HECHO) h.postDelayed(() -> { if (estado == HECHO) setEstado(LISTO); }, 3000);
    }

    private void animar() {
        if (anim != null) anim.cancel();
        anim = ValueAnimator.ofFloat(0f, 1f);
        anim.setDuration(estado == LEYENDO ? 900 : 2000);
        anim.setRepeatCount(estado == HECHO ? 0 : ValueAnimator.INFINITE);
        anim.setInterpolator(new LinearInterpolator());
        anim.addUpdateListener(a -> { fase = (float) a.getAnimatedValue(); invalidate(); });
        anim.start();
    }

    @Override
    protected void onDetachedFromWindow() {
        if (anim != null) anim.cancel();
        super.onDetachedFromWindow();
    }

    @Override
    protected void onDraw(Canvas c) {
        float w = getWidth(), hh = getHeight(), cx = w / 2f, cy = hh / 2f;
        c.save();
        if (estado == LISTO) {
            float s = 1f + 0.05f * (float) Math.sin(fase * Math.PI * 2);
            c.scale(s, s, cx, cy);
        } else if (estado == HECHO) {
            float s = 0.7f + 0.3f * Math.min(1f, fase * 3f);
            c.scale(s, s, cx, cy);
        }
        relleno.setColor(estado == LEYENDO ? TINTA : estado == HECHO ? VERDE : MIEL);
        c.drawPath(hex, relleno);
        borde.setColor(estado == HECHO ? VERDE : TINTA);
        c.drawPath(hex, borde);

        float u = w / 24f;   // unidades del ícono (como un viewBox de 24)
        if (estado == LISTO) {
            trazo.setColor(TINTA);
            // esquinas de "escanear" y una línea al centro
            Path p = new Path();
            float o = (hh - w) / 2f;
            p.moveTo(6 * u, 9 * u + o); p.lineTo(6 * u, 7 * u + o); p.lineTo(8 * u, 7 * u + o);
            p.moveTo(16 * u, 7 * u + o); p.lineTo(18 * u, 7 * u + o); p.lineTo(18 * u, 9 * u + o);
            p.moveTo(18 * u, 15 * u + o); p.lineTo(18 * u, 17 * u + o); p.lineTo(16 * u, 17 * u + o);
            p.moveTo(8 * u, 17 * u + o); p.lineTo(6 * u, 17 * u + o); p.lineTo(6 * u, 15 * u + o);
            p.moveTo(9 * u, 12 * u + o); p.lineTo(15 * u, 12 * u + o);
            c.drawPath(p, trazo);
        } else if (estado == LEYENDO) {
            trazo.setColor(MIEL);
            float r = w * 0.22f;
            arco.set(cx - r, cy - r, cx + r, cy + r);
            c.drawArc(arco, fase * 360f, 100f, false, trazo);
        } else {
            trazo.setColor(BLANCO);
            Path p = new Path();
            float o = (hh - w) / 2f;
            p.moveTo(7 * u, 12.5f * u + o); p.lineTo(10.5f * u, 16 * u + o); p.lineTo(17.5f * u, 8.5f * u + o);
            c.drawPath(p, trazo);
        }
        c.restore();
    }
}
