# Migración gratuita desde Supabase

El 10 de octubre de 2026 se apagaron los nueve cron MTF de Supabase. La API desplegada en Vercel ya no utiliza su URL ni su clave pública. El aviso del proveedor indicaba 11,87 GB de egreso sobre 5,5 GB y restricciones desde el 13 de octubre. Detener consultas no borra el consumo del ciclo ni cancela ese aviso.

El respaldo privado está fuera del repositorio, en `/workspace/.mtf-migration/supabase-backup.json.gz`, con permisos 0600. Conserva 19 señales, 6 estados, 24 estados del detector, 1.615 filas de trabajo CEDEAR, 7 estrategias, 55 eventos, 55 huellas de entrega y la configuración privada de alertas. No se eliminó el proyecto ni su historial.

## Arquitectura

Vercel conserva la aplicación y la API. Cloudflare Workers atiende las lecturas, con caché de 20 segundos; un Durable Object con SQLite guarda el estado y programa los motores con alarmas persistentes. Los motores se compilan desde las fuentes existentes sin SDK de Supabase, llamadas a Supabase, eval ni dependencias remotas en ejecución. Los nombres de tabla y el protocolo REST son compatibilidad interna.

SQLite conserva importaciones atómicas, una posición abierta por activo, deduplicación de setups y alertas, historial de señales y huellas de Telegram no borrables, identidad de operaciones inmutable, registro de estrategias congelado y RR mínimo 1,8 para nuevas señales activas. El movimiento del stop a break-even permanece permitido.

Cada alarma ejecuta un solo trabajo, con máximo 42 llamadas externas y 45 segundos de presupuesto de red. El universo crypto importado se mantiene estable durante esta primera migración (no se recalcula automáticamente el ranking ni se reconstruyen detectores nuevos); la estructura de esos activos se actualiza por bloques de 5. El motor live mantiene la confirmación causal de M15. Los primeros ciclos son baseline en los tres mercados. CEDEAR completa un recorrido baseline antes de permitir nuevas entradas. Las preparaciones de liquidez procesan bloques de 16. Los trabajos pendientes se ordenan por último procesamiento para evitar que un motor bloquee a los demás. Se conservan los relojes individuales de cada activo; un heartbeat global no renueva datos viejos.

Retención: decisiones 24 horas, errores 3 días y trabajo CEDEAR 7 días, preservando además la última rueda con liquidez válida. Las señales y las huellas de entrega permanecen. Los cambios de edad de cotizaciones se calculan en las lecturas, evitando reescribir cientos de filas cada minuto.

## Límites del plan gratuito

Cloudflare incluye Workers y Durable Objects con SQLite en su plan Free. Existen cuotas: Workers 100.000 solicitudes/día; Durable Objects 100.000 solicitudes/día y 13.000 GB-s/día; SQLite 5 millones de filas leídas/día, 100.000 escritas/día y 5 GB almacenados. Las alarmas y los índices consumen parte de esas cuotas. El Worker HTTP tiene 10 ms de CPU; el cálculo se ejecuta dentro del Durable Object, cuyo límite predeterminado es 30 segundos de CPU por invocación. El tiempo esperando HTTP y la CPU son límites distintos.

No se activa ningún plan de pago. Debe medirse el consumo real tras el despliegue: las pruebas locales no acreditan cumplimiento de cuotas ni disponibilidad ilimitada. Referencias oficiales: [Workers](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [límites SQLite](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Activación en la cuenta del propietario

1. Crear una cuenta gratuita en Cloudflare y habilitar Workers con un subdominio `workers.dev` propio.
2. Crear un API token restringido a la cuenta, con permiso **Account / Workers Scripts / Edit**. Cargar `CLOUDFLARE_API_TOKEN` mediante los ajustes seguros del entorno. Cargar el identificador público `CLOUDFLARE_ACCOUNT_ID`. No pegar credenciales en el chat. El borrador guardado requiere revisión, guardado y publicación en los ajustes del entorno; no aplica valores automáticamente.
3. Con Node 24 activo, ejecutar desde el checkout:

   ```sh
   npm run deploy:cloudflare -- --deploy --import /workspace/.mtf-migration/supabase-backup.json.gz
   ```

   El script despliega módulos y almacenamiento SQLite, genera la credencial administrativa, importa únicamente en una base vacía y verifica todos los conteos. Los motores quedan apagados. Repetir `--import` sobre una base poblada falla sin reemplazarla. El informe ignorado `artifacts/cloudflare/deployment.json` contiene solamente la URL pública y metadatos sin secretos.
4. Activar con `npm run deploy:cloudflare -- --deploy --activate`. Verificar que los estados de los tres mercados avanzan, que no aparecen señales por reproducción de historia y que las cuotas permanecen dentro del plan Free. Telegram requiere su token de bot opcional seguro; conservar el chat del respaldo no prueba entrega funcional.
5. La API incluye la URL pública desplegada como valor predeterminado. `MTF_BACKEND_URL` permite cambiarla para staging o desactivar explícitamente la conexión con un valor vacío; no hace falta una credencial de Vercel para conectar este despliegue. Verificar `backend_configured=true`, las ocho rutas de producción y los estados recientes. No usar un dominio ficticio ni volver a apuntar a Supabase.

Sin cuenta y autenticación del propietario no puede desplegarse este servicio. La aplicación muestra indisponibilidad explícita (HTTP 503) mientras falta la conexión; no presenta el respaldo viejo como señales actuales.

## Validación realizada

`npm test` ejecuta nueve suites, incluyendo SQLite real y la API de datos crypto: importación y rollback, preservación de snapshots, protecciones de riesgo e identidad, cierre sin reapertura, baseline al activar, denegación de escrituras públicas y autenticación administrativa. `npm run test:browser` verifica los tres mercados, estadísticas, móvil y fallos de API. Los ocho controles ADR pasan en los módulos compilados. El respaldo real se importó en una base SQLite local y se comprobaron todos los conteos.

También se ejecutaron los tres motores en baseline contra proveedores reales usando únicamente la copia SQLite local: crypto procesó 20 activos, CEDEAR 9 y ADR completó el ciclo; todos devolvieron cero señales nuevas y cero errores. Esto no escribió en producción ni activó alertas.

Las pruebas locales y las comprobaciones de proveedores no sustituyen el despliegue en Cloudflare, sus alarmas reales ni la medición de cuotas. La rentabilidad de la estrategia sigue sin validación estadística; la aplicación emite señales para operación manual y no envía órdenes a brokers.


## Despliegue del 11 de octubre de 2026

Backend desplegado: `https://mtf-monitor-backend.augusto-garciajm.workers.dev`. Se verificaron los conteos del respaldo en la base real: 19 señales, 6 estados, 24 detectores, 1.615 filas CEDEAR y 7 estrategias, además de eventos, configuración y huellas de entrega. Las alarmas se activaron con baseline; ADR y CEDEAR ejecutaron ciclos reales. El arranque también permite baseline fuera del horario de mercado y después respeta las ventanas operativas.

La primera instancia estadounidense encontró restricciones geográficas de Binance. Se detuvo esa instancia, se exportó una copia privada y se importó íntegramente en la jurisdicción europea oficial de Durable Objects. Se preservaron también los ocho errores de la primera prueba; no se eliminó el historial para aparentar un sistema sin incidentes. Las consultas directas desde Cloudflare europeo también recibieron 403: por eso los datos públicos crypto pasan por una API de Vercel ubicada en `fra1`. La API acepta solamente velas y cotizaciones spot, limita símbolos, parámetros y tamaño, rechaza escrituras y URLs arbitrarias, y nunca recibe claves de broker o de cuentas de trading.

Las cotizaciones solicitan únicamente el universo monitoreado (hasta 50 pares), en lugar de descargar todo el listado del exchange. El contexto H4 y diario se guarda en SQLite hasta el siguiente cierre UTC; sólo se usan sus velas cerradas para las reglas. H1 y M15 se consultan en vivo, con caché HTTP máxima de 30 segundos y sin caché de errores. Se conservan el proveedor Binance, los precios, los cierres y las reglas de confirmación; no se sintetizan velas ni se mezclan exchanges.

Las credenciales administrativas se generan una vez y se conservan en un archivo privado fuera del repositorio. El despliegue reutiliza esa credencial y configura los secretos antes de actualizar un Worker existente, evitando que el proceso use una credencial diferente de la herramienta de mantenimiento. No publicar ese archivo ni los respaldos. La lectura de `/admin/export` requiere autenticación y sirve para respaldar sin truncar señales.

El consumo mensual de Vercel y las cuotas diarias de Cloudflare deben verificarse con uso real. La evidencia final de las rutas de producción y los motores se guarda fuera del repositorio en `/workspace/.mtf-validation`; un despliegue exitoso por sí solo no prueba que el proveedor de datos esté disponible.

El 11 de octubre de 2026 se verificó HTTP 200 en las ocho rutas de producción, incluidas las lecturas de los tres mercados, estadísticas y estado. Las velas Binance reales llegaron por Vercel y los motores crypto, CEDEAR y ADR completaron ciclos en Cloudflare. Se conservaron las 19 señales importadas y no se generaron entradas durante el baseline crypto. CEDEAR muestra datos vencidos fuera de rueda; el heartbeat del motor no oculta esa condición. Los errores de las pruebas iniciales permanecen en el historial y vencen según la retención, sin truncar la base.

La API también admite las velas de un minuto, limitadas a 1.000, que el watcher usa para comprobar niveles de operaciones abiertas. Un fallo al obtener esas velas hace fallar el ciclo y conserva `last_watcher_at`, permitiendo reintentar el intervalo pendiente. La prueba sobre SQLite real comprueba esa conservación; la API mantiene bloqueadas las operaciones de trading y las consultas a cuentas privadas.
