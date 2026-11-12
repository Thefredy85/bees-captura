package com.beespizza.captura;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Escucha las notificaciones de Uber, DiDi, Rappi y Reservándonos en la tableta
 * y las manda a la base; la base avisa al celular (ntfy). No lee nada de otras apps.
 */
public class AvisosService extends NotificationListenerService {

    private static final String SB = "https://iwjhmdeffwhqxmcivfso.supabase.co/rest/v1/delivery_eventos";
    private static final String SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3amhtZGVmZndocXhtY2l2ZnNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjE0MTUsImV4cCI6MjEwOTYzNzQxNX0.b36fWyQxjLwukD8FWis7ef-uynLBoO_tYWTKubaJQbM";

    /** Palabras con las que las apps anuncian un pedido que acaba de entrar. */
    private static final Pattern NUEVO = Pattern.compile(
            "(?iu)(nuevo pedido|pedido nuevo|nueva orden|orden nueva|new order|tienes un (nuevo )?pedido|recibiste un pedido|nueva solicitud|pedido entrante|incoming order|acepta(r)? (el )?pedido)");

    /** Para no avisar dos veces lo mismo (las apps repiten la notificación mientras suena). */
    private final Map<String, Long> vistos = new HashMap<>();

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("avisos", Context.MODE_PRIVATE); }

    static boolean activo(Context c) {
        try {
            return androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.getPackageName());
        } catch (Exception e) { return false; }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            String plat = CapturaService.plataformaDe(pkg);
            if (plat.isEmpty()) return;
            Notification n = sbn.getNotification();
            if (n == null) return;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle x = n.extras;
            String titulo = texto(x, Notification.EXTRA_TITLE);
            String cuerpo = texto(x, Notification.EXTRA_BIG_TEXT);
            if (cuerpo.isEmpty()) cuerpo = texto(x, Notification.EXTRA_TEXT);
            if (titulo.isEmpty() && cuerpo.isEmpty()) return;
            boolean nuevo = NUEVO.matcher(titulo + " " + cuerpo).find();
            // Las notificaciones fijas (servicio en marcha) solo cuentan si anuncian un pedido
            if ((n.flags & Notification.FLAG_ONGOING_EVENT) != 0 && !nuevo) return;

            long ahora = System.currentTimeMillis();
            String firma = plat + "|" + titulo + "|" + cuerpo;
            synchronized (vistos) {
                for (Iterator<Map.Entry<String, Long>> it = vistos.entrySet().iterator(); it.hasNext(); )
                    if (ahora - it.next().getValue() > 3 * 60 * 1000) it.remove();
                if (vistos.containsKey(firma)) return;
                vistos.put(firma, ahora);
            }
            enviar(plat, nuevo ? "nuevo" : "aviso", titulo, cuerpo);
        } catch (Exception ignored) { }
    }

    private static String texto(Bundle x, String k) {
        if (x == null) return "";
        CharSequence c = x.getCharSequence(k);
        return c == null ? "" : c.toString().replaceAll("\\s+", " ").trim();
    }

    private void enviar(String plat, String tipo, String titulo, String cuerpo) {
        final String clave = prefs(this).getString("clave", "");
        if (clave.isEmpty()) return;   // sin clave de la sucursal no se puede escribir en la base
        new Thread(() -> {
            HttpURLConnection h = null;
            try {
                JSONObject o = new JSONObject();
                o.put("plat", plat);
                o.put("tipo", tipo);
                o.put("titulo", titulo.length() > 200 ? titulo.substring(0, 200) : titulo);
                o.put("texto", cuerpo.length() > 1000 ? cuerpo.substring(0, 1000) : cuerpo);
                o.put("tableta", plat);
                h = (HttpURLConnection) new URL(SB).openConnection();
                h.setRequestMethod("POST");
                h.setConnectTimeout(15000);
                h.setReadTimeout(15000);
                h.setDoOutput(true);
                h.setRequestProperty("apikey", SB_KEY);
                h.setRequestProperty("Authorization", "Bearer " + SB_KEY);
                h.setRequestProperty("x-bees-clave", clave);
                h.setRequestProperty("Content-Type", "application/json");
                h.setRequestProperty("Prefer", "return=minimal");
                try (OutputStream os = h.getOutputStream()) { os.write(o.toString().getBytes("UTF-8")); }
                h.getResponseCode();
            } catch (Exception ignored) {
            } finally { if (h != null) h.disconnect(); }
        }).start();
    }
}
