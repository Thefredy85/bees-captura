package com.beespizza.captura;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Cada 2 minutos la tableta avisa a la base que sigue conectada, con su batería y sus permisos.
 * Si deja de llegar el latido, la base avisa por Telegram (solo en horario de tienda).
 * La respuesta trae los ajustes compartidos, como el interruptor de captura.
 */
final class Latido {

    private static final String RPC = "https://iwjhmdeffwhqxmcivfso.supabase.co/rest/v1/rpc/delivery_latido";
    private static final long CADA_MS = 2 * 60 * 1000;
    private static final Handler h = new Handler(Looper.getMainLooper());
    private static Context app;
    private static boolean corriendo = false;

    private Latido() { }

    static SharedPreferences prefs(Context c) { return AvisosService.prefs(c); }

    /** ¿Está activada la captura de pedidos? (lo decide un supervisor para todas las tabletas) */
    static boolean capturaActiva(Context c) { return prefs(c).getBoolean("captura", true); }

    /** De qué plataforma es esta tableta (la última app de pedidos que avisó o se capturó aquí). */
    static void recordarPlataforma(Context c, String plat) {
        if (plat == null || plat.isEmpty()) return;
        if (!plat.equals(prefs(c).getString("plat_tableta", ""))) prefs(c).edit().putString("plat_tableta", plat).apply();
    }

    static synchronized void iniciar(Context c) {
        app = c.getApplicationContext();
        if (corriendo) return;
        corriendo = true;
        h.postDelayed(Latido::tick, 5000);
    }

    /** Manda el latido ya (por ejemplo, al abrir la app). */
    static void ahora(Context c) {
        app = c.getApplicationContext();
        enviar();
    }

    private static void tick() {
        enviar();
        h.postDelayed(Latido::tick, CADA_MS);
    }

    private static void enviar() {
        final Context c = app;
        if (c == null) return;
        final String clave = prefs(c).getString("clave", "");
        if (clave.isEmpty()) return;
        new Thread(() -> {
            HttpURLConnection con = null;
            try {
                JSONObject d = new JSONObject();
                String id = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ANDROID_ID);
                d.put("id", id == null ? Build.MODEL : id);
                d.put("plat", prefs(c).getString("plat_tableta", ""));
                d.put("modelo", Build.MANUFACTURER + " " + Build.MODEL);
                d.put("nombre", Build.MODEL);
                d.put("version", BuildConfigInfo.VERSION);
                Intent b = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (b != null) {
                    int nivel = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), escala = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    if (nivel >= 0 && escala > 0) d.put("bateria", Math.round(nivel * 100f / escala));
                    int enchufe = b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
                    d.put("cargando", enchufe != 0);
                }
                d.put("avisos", AvisosService.activo(c));
                d.put("lectura", CapturaService.instancia != null);
                JSONObject cuerpo = new JSONObject();
                cuerpo.put("d", d);

                con = (HttpURLConnection) new URL(RPC).openConnection();
                con.setRequestMethod("POST");
                con.setConnectTimeout(15000);
                con.setReadTimeout(15000);
                con.setDoOutput(true);
                con.setRequestProperty("apikey", AvisosService.SB_KEY);
                con.setRequestProperty("Authorization", "Bearer " + AvisosService.SB_KEY);
                con.setRequestProperty("x-bees-clave", clave);
                con.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = con.getOutputStream()) { os.write(cuerpo.toString().getBytes("UTF-8")); }
                if (con.getResponseCode() != 200) return;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = con.getInputStream()) {
                    byte[] buf = new byte[1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                JSONObject r = new JSONObject(out.toString("UTF-8"));
                if (r.has("rol")) prefs(c).edit().putString("rol", r.optString("rol", "tableta")).apply();
                if (r.has("captura")) aplicarCaptura(c, r.optBoolean("captura", true));
            } catch (Exception ignored) {
            } finally { if (con != null) con.disconnect(); }
        }).start();
    }

    /** Guarda el interruptor de captura y muestra u oculta el hexágono. */
    static void aplicarCaptura(Context c, boolean activa) {
        prefs(c).edit().putBoolean("captura", activa).apply();
        h.post(() -> { if (CapturaService.instancia != null) CapturaService.instancia.aplicarCaptura(activa); });
    }
}
