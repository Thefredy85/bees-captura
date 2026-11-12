package com.beespizza.captura;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Actualizaciones sin QR.
 * Cada compilación publica junto al APK un version.json y un web.zip con la pantalla y el lector de pedidos.
 *  - Si solo cambió la lectura/pantalla (web), se descarga y se aplica sola.
 *  - Si hay un APK nuevo, se avisa en la pantalla y con un toque se descarga e instala.
 */
final class Actualizador {

    static final String BASE = "https://github.com/Thefredy85/bees-captura/releases/latest/download/";

    interface Aviso { void listo(JSONObject version, boolean webNueva); }

    private Actualizador() { }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("actualizacion", Context.MODE_PRIVATE); }

    static File dirWeb(Context c) { return new File(c.getFilesDir(), "web"); }

    /** Versión de la pantalla que viene dentro del APK (assets/web.json). */
    static int webIncluida(Context c) {
        try (InputStream in = c.getAssets().open("web.json")) {
            return new JSONObject(leer(in)).optInt("web", 0);
        } catch (Exception e) { return 0; }
    }

    /** Versión de la pantalla descargada, si se puede usar con este APK. */
    static int webDescargada(Context c) {
        SharedPreferences p = prefs(c);
        if (!new File(dirWeb(c), "app.html").exists()) return 0;
        if (p.getInt("minApk", 0) > BuildConfigInfo.CODE) return 0;
        return p.getInt("web", 0);
    }

    static int webActiva(Context c) { return Math.max(webIncluida(c), webDescargada(c)); }

    /** Dirección de la pantalla a cargar: la descargada si es más nueva que la incluida. */
    static String urlPantalla(Context c) {
        if (webDescargada(c) > webIncluida(c)) return "file://" + new File(dirWeb(c), "app.html").getAbsolutePath();
        return "file:///android_asset/app.html";
    }

    /** La pantalla descargada falló al abrir: se borra y no se vuelve a bajar esa versión. */
    static void descartarWeb(Context c) {
        SharedPreferences p = prefs(c);
        p.edit().putInt("webMala", p.getInt("web", 0)).putInt("web", 0).apply();
        borrar(dirWeb(c));
    }

    /** Revisa en segundo plano. Llama a aviso en el hilo de fondo. */
    static void revisar(Context ctx, Aviso aviso) {
        final Context c = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(new String(bajar(BASE + "version.json?t=" + System.currentTimeMillis()), "UTF-8"));
                int web = v.optInt("web", 0), minApk = v.optInt("minApk", 0);
                boolean webNueva = false;
                if (web > webActiva(c) && minApk <= BuildConfigInfo.CODE && web != prefs(c).getInt("webMala", -1)) {
                    webNueva = instalarWeb(c, web, minApk);
                }
                aviso.listo(v, webNueva);
            } catch (Exception e) {
                // Sin internet o publicándose una versión: se vuelve a intentar después
            }
        }).start();
    }

    private static boolean instalarWeb(Context c, int web, int minApk) throws Exception {
        byte[] zip = bajar(BASE + "web.zip?t=" + System.currentTimeMillis());
        File tmp = new File(c.getFilesDir(), "web_nueva");
        borrar(tmp);
        tmp.mkdirs();
        try (ZipInputStream z = new ZipInputStream(new java.io.ByteArrayInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[16384];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(tmp, e.getName());
                if (!f.getCanonicalPath().startsWith(tmp.getCanonicalPath())) continue;   // rutas raras: se ignoran
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(f)) { int n; while ((n = z.read(buf)) > 0) o.write(buf, 0, n); }
            }
        }
        if (!new File(tmp, "app.html").exists() || !new File(tmp, "app.js").exists()) { borrar(tmp); return false; }
        File dir = dirWeb(c);
        borrar(dir);
        if (!tmp.renameTo(dir)) return false;
        prefs(c).edit().putInt("web", web).putInt("minApk", minApk).apply();
        return true;
    }

    /** Descarga el APK nuevo a la caché. avance recibe el porcentaje (0-100). */
    static File bajarApk(Context c, java.util.function.IntConsumer avance) throws Exception {
        File dir = new File(c.getCacheDir(), "apk");
        dir.mkdirs();
        File f = new File(dir, "BeesCaptura.apk");
        HttpURLConnection h = abrir(BASE + "BeesCaptura.apk?t=" + System.currentTimeMillis());
        int total = h.getContentLength(), leidos = 0, ultimo = -1;
        try (InputStream in = h.getInputStream(); OutputStream o = new FileOutputStream(f)) {
            byte[] buf = new byte[32768]; int n;
            while ((n = in.read(buf)) > 0) {
                o.write(buf, 0, n); leidos += n;
                int pct = total > 0 ? (int) (leidos * 100L / total) : -1;
                if (pct != ultimo) { ultimo = pct; avance.accept(pct); }
            }
        } finally { h.disconnect(); }
        if (f.length() < 100_000) throw new Exception("archivo incompleto");
        return f;
    }

    private static HttpURLConnection abrir(String url) throws Exception {
        // GitHub manda a otro servidor; se siguen las redirecciones a mano por si cambian de dominio
        for (int i = 0; i < 6; i++) {
            HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
            h.setConnectTimeout(15000);
            h.setReadTimeout(30000);
            h.setInstanceFollowRedirects(false);
            h.setUseCaches(false);
            int code = h.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = h.getHeaderField("Location");
                h.disconnect();
                if (loc == null) throw new Exception("redirección sin destino");
                url = new URL(new URL(url), loc).toString();
                continue;
            }
            if (code != 200) { h.disconnect(); throw new Exception("HTTP " + code); }
            return h;
        }
        throw new Exception("demasiadas redirecciones");
    }

    private static byte[] bajar(String url) throws Exception {
        HttpURLConnection h = abrir(url);
        try (InputStream in = h.getInputStream()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[16384]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toByteArray();
        } finally { h.disconnect(); }
    }

    private static String leer(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096]; int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toString("UTF-8");
    }

    static void borrar(File f) {
        if (f == null || !f.exists()) return;
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrar(h);
        f.delete();
    }
}
