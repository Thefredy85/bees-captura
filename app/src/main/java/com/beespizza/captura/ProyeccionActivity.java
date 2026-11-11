package com.beespizza.captura;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;

/** Pide el permiso de captura de pantalla (solo Android 10 o anterior). */
public class ProyeccionActivity extends Activity {

    private static final int PEDIR = 7;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        startActivityForResult(m.createScreenCaptureIntent(), PEDIR);
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        super.onActivityResult(pedido, resultado, datos);
        if (pedido == PEDIR && resultado == RESULT_OK && datos != null) {
            Intent s = new Intent(this, ProyeccionService.class);
            s.putExtra("codigo", resultado);
            s.putExtra("datos", datos);
            startForegroundService(s);
        } else if (CapturaService.instancia != null) {
            CapturaService.instancia.proyeccionNegada();
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
