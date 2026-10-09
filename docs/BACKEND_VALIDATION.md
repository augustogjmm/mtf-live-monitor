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
