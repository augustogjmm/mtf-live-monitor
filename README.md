# MTF Live Monitor

Monitor de señales para operar **manualmente** en cripto, CEDEAR y ADR.
La interfaz y las reglas implementadas no constituyen una validación de
rentabilidad. El monitor no envía órdenes a un broker.

## Desarrollo

Usar Node 24.19.0 (>=24.5), como la CI. La API usa fetch nativo.
Playwright es una dependencia de desarrollo para probar el navegador.

```sh
npm ci
npm test
npm run dev
```

Para probar el navegador: instalar Chromium con
`npx playwright install --with-deps chromium` y ejecutar `npm run test:browser`.
Si el entorno ya tiene Chromium, usar
`BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`.

El servidor de desarrollo usa el proxy HTTP/HTTPS del entorno mediante el
soporte nativo de Node 24, conservando la verificación TLS. Escucha en 127.0.0.1:3000. Se puede cambiar el puerto
con PORT. Sirve la interfaz y adapta la API original de Vercel; no ejecuta los
motores ni los cron de Supabase. La comprobación local
`GET /api/data?op=health` debe devolver `ok: true` y el build
`MTF-MONITOR-FORWARD-SAFETY`. Ese endpoint comprueba la aplicación, no la
conectividad al backend.

La API consulta por defecto el proyecto Supabase público existente. Para
usar un proyecto de pruebas, definir juntas `MTF_SUPABASE_URL` y
`MTF_SUPABASE_PUBLISHABLE_KEY` en el servidor (por ejemplo, en Vercel).
Usar el origen HTTPS y una clave pública; nunca una service-role key.
Si falta una de las dos variables, la consulta falla sin volver a producción.
La interfaz consulta el backend exclusivamente a través de esta API.
Los motores necesitan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno
seguro de Supabase. Nunca poner una service-role key en el navegador.
TELEGRAM_BOT_TOKEN es opcional para alertas. No es necesario para las pruebas
locales. Este repositorio no incluye un bootstrap completo de base de datos ni
una configuración local de Supabase: las migraciones y los SQL históricos
dependen de objetos y cohortes existentes.

## Reglas y confiabilidad

- Cripto: contexto H1/H4 alineado, impulso MACD, OB con desplazamiento,
  confirmación de rechazo en vela cerrada de 15 minutos y R/R a TP1 >= 1,8.
  El motor bloquea contexto posterior a la apertura de la vela, snapshots
  generados después de su cierre, estructura mayor a 20 minutos y
  confirmaciones con más de 5 minutos de demora. Las velas omitidas se
  reconocen sin crear entradas retrospectivas.
- ADR: contexto diario y semanal alcista, recuperación de OB en 15 minutos y
  R/R >= 1,8. El primer ciclo establece una línea de base. No se insertan
  confirmaciones abiertas, ya procesadas ni demoradas más de 20 minutos.
  El stop de ADR sigue siendo una referencia técnica, no una salida automática.
- CEDEAR: conservar la confirmación de 15 minutos y los controles de frescura
  existentes del motor. No confundir un universo de liquidez recuperado con
  cotizaciones actuales.
- La interfaz marca como antiguos los snapshots vencidos en los tres mercados.
  No presenta rendimiento actual de operaciones usando precios de un snapshot
  vencido. Un fallo al cargar operaciones se muestra como estado no verificado.
- La API limita cada consulta Supabase a 12 segundos y rechaza mercados
  desconocidos y respuestas paginadas incompletas.

Los límites de tiempo son controles operativos conservadores, no parámetros
optimizados para maximizar resultados. Pueden omitir oportunidades durante
demoras del proveedor o del planificador; medir esos descartes antes de ajustar.

## Estado de validación

`npm test` cubre integridad de consola, datos ausentes, snapshots vencidos,
causalidad de confirmaciones, primera ejecución de ADR, validación OHLC,
fallos y timeouts de API y límites de paginación. Estas son regresiones
deterministas; no son un backtest ni una prueba del backend desplegado.

Ver [criterios para la validación de estrategias](docs/STRATEGY_VALIDATION.md)
antes de declarar terminada la aplicación o de usar sus señales.

## Validación real e histórica

`npm run validate:live -- artifacts/live-report.json` realiza sólo lecturas
de runtime, estadísticas y estado, verifica las edades de los snapshots y
guarda un informe. No invoca motores ni envía alertas.

`node --use-env-proxy scripts/evaluate-history.cjs artifacts/history-audit.json`
audita confirmaciones históricas sobre BTC, ETH, AAPL, MSFT, GGAL e YPF.
Reutiliza funciones reales de los motores en una ejecución con efectos externos
bloqueados. Guarda los datos descargados en una caché junto al informe.
Es una muestra de seis activos y 30 días; no simula una cartera ni demuestra
rentabilidad. Ver las limitaciones del informe antes de interpretar resultados.

`npm run evaluate:execution -- artifacts/history-audit.json artifacts/execution-report.json`
reproduce las confirmaciones de ese informe sobre su caché de velas. Modela
entrada en una apertura posterior a la confirmación y a 60 segundos de demora,
costos de 10 puntos básicos por ejecución y deslizamiento adverso de 5 puntos
básicos. Descarta entradas demoradas más de 30 minutos y señales durante una
posición abierta. Resuelve velas ambiguas con el resultado adverso. Los costos
son supuestos de investigación y deben contrastarse con el mercado real.

El modelo es aproximado: no reconstruye el break-even de un minuto en cripto
ni la liquidez y conversión ARS de CEDEAR. ADR y CEDEAR mantienen posiciones
abiertas hasta TP1; sus marcas pendientes no se cuentan como ganancias
realizadas. No reemplaza el backtest completo de la estrategia. Cuando no hay
operaciones cerradas, las métricas quedan nulas y el estado es
`INSUFFICIENT_TRADES`.

## Comprobación del despliegue

`npm run validate:deployment -- artifacts/production-check.json` comprueba
la aplicación publicada en https://mtf-monitor.vercel.app: versión de frontend,
API, los tres mercados, estadísticas y salud. Sólo realiza lecturas.
También puede ejecutarse desde GitHub Actions mediante el workflow manual
**MTF production read-only check**. Guarda un informe sin credenciales.
No se programa automáticamente para evitar comprobaciones repetidas fuera
del alcance solicitado. Un despliegue exitoso y una comprobación funcional
son evidencias distintas; los correos y preferencias de notificación requieren
acceso a la cuenta correspondiente.
