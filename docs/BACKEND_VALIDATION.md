# Validación del backend

El acceso de administración al proyecto existente fue comprobado con HTTP 200.
Crear un proyecto separado fue rechazado con HTTP 403; las ramas de pruebas
requieren un plan Pro. No se cambió el plan ni se creó infraestructura paga.

## Base de datos real

Se inspeccionaron los triggers de `mtf_signals`, `mtf_state` y
`mtf_analyzer_state` antes de ejecutar las pruebas. Los triggers utilizados no
realizan llamadas externas. La prueba completa se envía en una sola conexión,
usa IDs negativos explícitos sin avanzar secuencias y termina en `ROLLBACK`.
Comprueba además que no quedaron datos con el prefijo de validación.

`tests/backend-transactional.sql` valida los tres mercados: inserción válida,
rechazo de posiciones duplicadas, riesgo/beneficio insuficiente, protección
contra borrado, actualización a break-even, cierre y nueva entrada. También
verifica la deduplicación de setups cerrados, cruces entre versiones v1/v2 y
recuperación del cursor de análisis mediante upsert. No toca filas de activos
reales ni dispara cron o Telegram.

La prueba detectó la falta de una garantía común de una posición abierta por
activo. La migración `20261009180000_one_open_manual_signal_per_asset.sql`
añade un índice único para las versiones operativas y sus posiciones legadas.
La consulta previa no encontró conflictos existentes. La migración y la prueba
pasaron juntas dentro de una transacción revertida antes de publicar cambios.

Estas pruebas usan acceso de administración. No equivalen a una ejecución
completa de los motores en un backend separado ni prueban una operación real
de principio a fin.

## Funciones Edge

`npm run deploy:edge` compila las cuatro funciones modificadas mediante la API
oficial de Supabase sin cambiar su versión desplegada. Requiere el token en
`SUPABASE_ACCESS_TOKEN` y la referencia pública en `MTF_SUPABASE_PROJECT_REF`.
No imprime credenciales. Conserva la configuración JWT existente y guarda
copias de los bundles anteriores y un informe bajo `artifacts/`, excluido de Git.

`npm run deploy:edge -- --deploy` publica las funciones sólo después de compilar
las cuatro. Comprueba que no haya otro despliegue concurrente y que cada versión
quede ACTIVE con su configuración JWT conservada. No aplica migraciones, cambia
secretos, ejecuta motores ni envía notificaciones. Los despliegues de distintas
funciones no son una operación atómica; revisar el informe y las versiones si
alguno falla.

La validación de desempeño económico y el primer ciclo de entrada/salida real
siguen siendo requisitos distintos de la compilación y de estas restricciones
de base de datos. Consultar `STRATEGY_VALIDATION.md` antes de afirmar rentabilidad.

## Autenticación de claves de servicio

La verificación real detectó que un JWT de servicio válido podía diferir de la
clave literal del entorno. Los motores conservan el acceso de su clave interna
y, para otro JWT de servicio, requieren una comprobación de PostgREST. La
lectura del claim es únicamente un filtro previo: la firma y el rol deben ser
validados por Supabase. Una caída, respuesta inválida o denegación rechaza la
petición. Las claves públicas y de usuarios siguen bloqueadas.

Aplicar `20261009181500_engine_service_role_verification.sql` antes de publicar
esta versión de los motores. Su RPC es SECURITY INVOKER, sólo ejecutable por
service_role, y devuelve el rol real de la conexión. Sus permisos pasaron una
prueba transaccional revertida. Las pruebas locales cubren las cuatro funciones,
claves actuales, JWT alternativos, claims falsificados y caída del verificador.

## Tiempo de respuesta de salud

La revisión final detectó un HTTP 500 en la sonda de `mtf_system_status`: el
registro de PostgREST indicó `canceling statement due to statement timeout`.
La consulta recorría repetidamente el historial de cron para los mismos trabajos.
La migración `20261009183000_bounded_status_cron_queries.sql` materializa una
lectura de los trabajos relevantes y comparte sus datos entre las métricas.
Mantiene el último evento histórico y los contadores de 24 horas. No cambia
permisos, límites de tiempo ni registros del historial.

`tests/status-query-regression.sql`, con la migración sustituida en su marcador,
comparó la respuesta JSON completa anterior y nueva dentro de una transacción
REPEATABLE READ; fueron iguales y los cambios de prueba se revirtieron. La
migración comprueba los fragmentos de la definición antes de reemplazarlos
y falla si la versión encontrada no es la esperada. Es idempotente.
