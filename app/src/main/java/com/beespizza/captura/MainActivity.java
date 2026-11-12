package com.beespizza.captura;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
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
    private boolean usandoDescargada = false;
    private boolean recargaPendiente = false;
    private long ultimaRevision = 0;
    private String infoVersion = null;   // version.json publicado, para el aviso de APK nuevo

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        // La pantalla vive en los archivos de la app y habla con la base en línea
        s.setAllowUniversalAccessFromFileURLs(true);
        web.addJavascriptInterface(new Puente(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String url) {
                cargada = true;
                if (usandoDescargada) {
                    // Si la pantalla descargada no arrancó bien, se vuelve a la que trae la app
                    web.evaluateJavascript("typeof window.cargarCaptura", r -> {
                        if (!"\"function\"".equals(r)) { Actualizador.descartarWeb(MainActivity.this); cargarPantalla(); }
                    });
                }
                if (pendiente != null) { web.evaluateJavascript(pendiente, null); pendiente = null; }
                actualizarEstado();
                avisarVersion();
            }
        });
        cargarPantalla();
        setContentView(web);
        manejar(getIntent());
        revisarActualizacion();
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
        if (recargaPendiente) recargarSiPuede();
        if (System.currentTimeMillis() - ultimaRevision > 20 * 60 * 1000) revisarActualizacion();
    }

    private void cargarPantalla() {
        String url = Actualizador.urlPantalla(this);
        usandoDescargada = !url.startsWith("file:///android_asset/");
        cargada = false;
        web.loadUrl(url);
    }

    private void revisarActualizacion() {
        ultimaRevision = System.currentTimeMillis();
        Actualizador.revisar(this, (v, webNueva) -> runOnUiThread(() -> {
            infoVersion = v.toString();
            if (webNueva) { recargaPendiente = true; recargarSiPuede(); }
            avisarVersion();
        }));
    }

    /** Aplica la pantalla nueva solo si no hay un pedido a medio confirmar. */
    private void recargarSiPuede() {
        if (!cargada) return;
        web.evaluateJavascript("window.puedeRecargar ? puedeRecargar() : true", r -> {
            if ("true".equals(r)) { recargaPendiente = false; cargarPantalla(); }
        });
    }

    private void avisarVersion() {
        if (cargada && infoVersion != null)
            web.evaluateJavascript("window.avisoVersion && avisoVersion(" + infoVersion + ")", null);
    }

    private void js(String codigo) { runOnUiThread(() -> { if (cargada) web.evaluateJavascript(codigo, null); }); }

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
                o.put("code", BuildConfigInfo.CODE);
                o.put("avisos", AvisosService.activo(MainActivity.this));
                o.put("web", Actualizador.webActiva(MainActivity.this));
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

        /** La pantalla le pasa la clave de la sucursal para que los avisos puedan escribir en la base. */
        @JavascriptInterface
        public void guardarClave(String c) {
            AvisosService.prefs(MainActivity.this).edit().putString("clave", c == null ? "" : c.trim()).apply();
        }

        @JavascriptInterface
        public void abrirAvisos() {
            Intent i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
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
        public void registrado(String mensaje) {
            if (CapturaService.instancia != null) CapturaService.instancia.marcarRegistrado(mensaje);
        }

        /** Descarga el APK nuevo y abre el instalador de Android. */
        @JavascriptInterface
        public void actualizarApk() {
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                js("window.progresoVersion && progresoVersion('permiso')");
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return;
            }
            new Thread(() -> {
                try {
                    java.io.File f = Actualizador.bajarApk(MainActivity.this, pct -> js("window.progresoVersion && progresoVersion(" + pct + ")"));
                    js("window.progresoVersion && progresoVersion('instalar')");
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".archivos", f);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    js("window.progresoVersion && progresoVersion('error')");
                }
            }).start();
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

        /** Guarda el Excel en Descargas/Bees y abre el menú para compartirlo. Devuelve el mensaje para la pantalla. */
        @JavascriptInterface
        public String guardarExcel(String nombre, String base64) {
            try {
                byte[] datos = Base64.decode(base64, Base64.DEFAULT);
                String tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, nombre);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, tipo);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Bees");
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "No se pudo crear el archivo en Descargas.";
                    try (OutputStream os = cr.openOutputStream(uri)) { os.write(datos); }
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType(tipo);
                    i.putExtra(Intent.EXTRA_STREAM, uri);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent elegir = Intent.createChooser(i, "Enviar Excel del día");
                    elegir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(elegir);
                    return "Guardado en Descargas/Bees: " + nombre;
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 9));
                        return "Acepta el permiso de almacenamiento y vuelve a tocar «Descargar Excel del día».";
                    }
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Bees");
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, nombre);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(datos); }
                    return "Guardado en Descargas/Bees: " + nombre;
                }
            } catch (Exception e) {
                return "No se pudo guardar el Excel: " + e.getMessage();
            }
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
