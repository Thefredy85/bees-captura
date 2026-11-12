# Bee's Captura

App para las tabletas de delivery de Bee's Pizza's (Sullivan). Pone un botón **Capturar** encima de Uber, DiDi y Rappi. Al tocarlo lee el pedido abierto, lo traduce a los productos del Excel y lo deja listo para confirmar y registrar en el día.

La app solo lee y baja la pantalla para ver todo el pedido; nunca toca botones como «Listo» o «Pedido listo».

## Cómo lee
1. **Texto de la pantalla** (accesibilidad). Es lo más preciso. Si el pedido no cabe, baja la lista, lee lo que falta y la regresa a como estaba.
2. **Imagen de la pantalla** si la app de pedidos no deja leer su texto. Se lee dentro de la tableta, sin internet.
   - Samsung (Uber) y Lenovo (Rappi): automático.
   - Huawei (DiDi, Android 8): la primera vez pide permiso de «captura de pantalla»; se acepta una vez cada que se abre la app.

## Compilar
Al subir esta carpeta a un repositorio de GitHub, la acción «Compilar Bee's Captura» genera el archivo `app-debug.apk` (pestaña Actions → la última ejecución → bees-captura-apk).

## Instalar en cada tableta
1. Pasar `app-debug.apk` a la tableta (WhatsApp, Drive o cable) y abrirlo.
2. Permitir «instalar apps desconocidas» para la app con la que se abrió.
3. Abrir **Bee's Captura** → «Abrir ajustes de accesibilidad» → Bee's Captura → activar.
   - Samsung: Ajustes → Accesibilidad → Apps instaladas → Bee's Captura.
   - Lenovo (Android 13 o más nuevo): si no deja activarlo, Ajustes → Apps → Bee's Captura → menú de tres puntos → «Permitir ajustes restringidos», y volver a intentar.
   - Huawei: Ajustes → Asistencia inteligente → Accesibilidad → Bee's Captura. En Batería → Inicio de aplicaciones, dejar Bee's Captura en manual con todo activado para que EMUI no la cierre.
4. Aparece el botón amarillo. Se puede arrastrar a donde no estorbe.

## Uso
Abrir el pedido → tocar **Capturar** → revisar → **Registrar** → **Volver al pedido**.
Al final del día, en «Para el Excel», tocar **Compartir conteo** y mandarlo por WhatsApp.

## Pendiente
- Juntar los registros de las tres tabletas en un solo lugar (página y Excel).
- Alertas de pedido nuevo al teléfono.

## Actualizaciones sin QR (desde la v1.1)
Cada compilación publica en la release `ultima`: `BeesCaptura.apk`, `version.json` y `web.zip` (la pantalla y el lector de `app/src/main/assets`).
- **Solo cambió la pantalla o la lectura** (app.html, app.js, motor.js, registro.js): sube en 1 el número `web` de `app/src/main/assets/web.json`. Las tabletas lo bajan solas al abrir la app (o cada 20 min) y lo aplican cuando no hay un pedido a medio confirmar.
- **Cambió el código de Android** (Java, permisos, manifiesto): sube `versionCode`/`versionName` en `app/build.gradle` y `CODE`/`VERSION` en `BuildConfigInfo.java`. Si la pantalla nueva necesita ese APK, pon `minApk` en `web.json` igual al nuevo `versionCode`. En las tabletas sale el aviso «Hay una versión nueva · Actualizar».
- Si una pantalla descargada no arranca, la app vuelve sola a la que trae el APK y no vuelve a bajar esa versión.
