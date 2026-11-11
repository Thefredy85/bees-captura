package com.beespizza.captura;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.nio.ByteBuffer;
import java.util.function.Consumer;

/**
 * Mantiene el permiso de captura de pantalla mientras la app está abierta
 * (solo se usa en tabletas con Android 10 o anterior, como la Huawei de DiDi).
 */
public class ProyeccionService extends Service {

    static MediaProjection proyeccion;
    private static final Handler h = new Handler(Looper.getMainLooper());

    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel("captura", getString(R.string.canal), NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, "captura")
                .setContentTitle("Bee's Captura")
                .setContentText("Lista para leer pedidos de la pantalla")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(1, n);
        }

        if (intent != null && intent.hasExtra("datos")) {
            MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent datos = intent.getParcelableExtra("datos");
            proyeccion = m.getMediaProjection(intent.getIntExtra("codigo", 0), datos);
            if (proyeccion != null) {
                proyeccion.registerCallback(new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        proyeccion = null;
                        stopSelf();
                    }
                }, h);
                if (CapturaService.instancia != null) CapturaService.instancia.proyeccionLista();
            } else if (CapturaService.instancia != null) {
                CapturaService.instancia.proyeccionNegada();
            }
        }
        return START_NOT_STICKY;
    }

    /** Toma una sola imagen de la pantalla. */
    static void capturar(Context c, Consumer<Bitmap> listo) {
        if (proyeccion == null) { listo.accept(null); return; }
        WindowManager wm = (WindowManager) c.getSystemService(WINDOW_SERVICE);
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        final int w = dm.widthPixels, alto = dm.heightPixels;
        final ImageReader lector = ImageReader.newInstance(w, alto, PixelFormat.RGBA_8888, 2);
        final VirtualDisplay[] vd = new VirtualDisplay[1];
        final boolean[] listoYa = {false};
        lector.setOnImageAvailableListener(r -> {
            if (listoYa[0]) return;
            Image img = r.acquireLatestImage();
            if (img == null) return;
            listoYa[0] = true;
            Bitmap bmp = null;
            try {
                Image.Plane p = img.getPlanes()[0];
                ByteBuffer buf = p.getBuffer();
                int ps = p.getPixelStride(), rs = p.getRowStride();
                int anchoConRelleno = w + (rs - ps * w) / ps;
                Bitmap crudo = Bitmap.createBitmap(anchoConRelleno, alto, Bitmap.Config.ARGB_8888);
                crudo.copyPixelsFromBuffer(buf);
                bmp = Bitmap.createBitmap(crudo, 0, 0, w, alto);
            } catch (Exception ignored) {
            } finally {
                img.close();
                if (vd[0] != null) vd[0].release();
                lector.close();
            }
            listo.accept(bmp);
        }, h);
        vd[0] = proyeccion.createVirtualDisplay("bees-captura", w, alto, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, lector.getSurface(), null, h);
    }
}
