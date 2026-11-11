package com.beespizza.captura;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * Pantalla principal: el mismo Lector de Pedidos de la página, dentro de la tableta.
 * Aquí se confirma cada captura, se lleva el registro del día y el conteo para el Excel.
 */
public class MainActivity extends Activity {

    private WebView web;
    private boolean cargada = false;
    private String pendiente = null;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.addJavascriptInterface(new Puente(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String url) {
                cargada = true;
                if (pendiente != null) { web.evaluateJavascript(pendiente, null); pendiente = null; }
                actualizarEstado();
            }
        });
        web.loadUrl("file:///android_asset/lector.html");
        setContentView(web);
        manejar(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        manejar(i);
    }

    @Override
    protected void onResume() {
        super.onResume();
        actualizarEstado();
    }

    private void actualizarEstado() {
        if (cargada) web.evaluateJavascript("window.actualizarEstado && actualizarEstado()", null);
    }

    private void manejar(Intent i) {
        if (i == null) return;
        String texto = i.getStringExtra("texto");
        if (texto == null) return;
        String plat = i.getStringExtra("plataforma");
        String metodo = i.getStringExtra("metodo");
        i.removeExtra("texto");
        String js = "window.cargarCaptura && cargarCaptura(" + JSONObject.quote(texto) + ","
                + JSONObject.quote(plat == null ? "" : plat) + ","
                + JSONObject.quote(metodo == null ? "" : metodo) + ")";
        if (cargada) web.evaluateJavascript(js, null); else pendiente = js;
    }

    /** Funciones que la página puede llamar como Android.xxx() */
    class Puente {
        @JavascriptInterface
        public String estado() {
            try {
                JSONObject o = new JSONObject();
                o.put("lectura", CapturaService.instancia != null);
                o.put("android", Build.VERSION.SDK_INT);
                o.put("version", BuildConfigInfo.VERSION);
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void abrirAccesibilidad() {
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        }

        @JavascriptInterface
        public void abrirInfoApp() {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        }

        @JavascriptInterface
        public void volver() {
            runOnUiThread(() -> moveTaskToBack(true));
        }

        @JavascriptInterface
        public void copiar(String t) {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Bee's Captura", t));
        }

        @JavascriptInterface
        public void compartir(String t) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, t);
            Intent elegir = Intent.createChooser(i, "Compartir conteo");
            elegir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(elegir);
        }
    }
}
