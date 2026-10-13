# Revisión de estrategia — 13 de octubre de 2026

La migración comprobó funcionamiento técnico, no utilidad económica. En producción se conservaron 19 señales anteriores y no se generaron entradas nuevas de las estrategias actuales. No corresponde presentar esa ausencia como una estrategia validada.

## Evidencia nueva

Se descargaron nuevamente velas reales hasta el 13 de octubre y se ejecutó el evaluador de confirmaciones sobre BTC, ETH, AAPL, MSFT, GGAL y YPF. La estrategia vigente produjo cero confirmaciones en la muestra mensual de los seis activos. No hay operaciones suficientes para estimar su rentabilidad.

También se compararon tres alternativas fijas — ruptura de tendencia, retroceso de tendencia y recuperación de sobreventa — con división temporal 70/30, una posición por activo, 10 puntos básicos de comisión por ejecución y 5 de deslizamiento. Las 18 combinaciones de activo y alternativa tuvieron expectativa neta negativa en el período de entrenamiento. No se seleccionó ninguna usando el período reservado.

En una comparación separada de order blocks, permitir menos niveles no produjo operaciones. La variante de recuperación con contexto H4 produjo sólo dos confirmaciones BTC en entrenamiento, una operación cerrada y ninguna confirmación en el período reservado; ETH no produjo confirmaciones. Esa muestra es insuficiente y la variante no se activa.

Los resultados son investigación sobre activos seleccionados, sin un universo histórico completo ni asignación de capital. CEDEAR usa el subyacente USD: no simula liquidez BYMA, conversión ARS ni costos locales reales. La simulación resuelve stops y objetivos coincidentes de forma adversa, pero no reconstruye break-even de un minuto. No acredita rentabilidad futura.

## Correcciones operativas

- Crypto informa fallos al leer confirmaciones M15 y conserva el cursor afectado. El trabajo deja de aparecer exitoso si hubo errores de datos.
- Se conserva un contador diario de confirmaciones evaluadas, descartes, errores y entradas. `started_at` indica desde cuándo se registró evidencia; el contador no reconstruye ciclos anteriores a esta publicación.
- El motor live reutiliza el reloj H1 del snapshot estructural en vez de repetir una consulta por activo. Esto reduce llamadas y evita consumir el presupuesto antes de completar el lote.
- La estructura elimina activos que ya no pertenecen al universo ni tienen operaciones abiertas canónicas, evitando mantener filas con errores antiguos indefinidamente.
- ADR procesa los 14 activos cada cinco minutos; anteriormente rotaba bloques de cuatro, con un recorrido de aproximadamente veinte minutos que podía perder confirmaciones.
- CEDEAR conserva el recorrido general y el reintento, y agrega una vía rápida limitada a ocho candidatos que ya admiten entradas y están cerca o dentro de sus zonas. No modifica filtros ni reproduce velas vencidas. Activos fuera de esta vía siguen sujetos al tiempo del recorrido general; no se promete cobertura instantánea del universo completo.
- El estado del sistema devuelve resúmenes en vez de repetir los snapshots completos de todos los activos. La respuesta anterior superaba 1,8 MB; las cotizaciones completas permanecen en las rutas de cada mercado.
- El panel distingue salud técnica de estrategia: muestra `SIN VALIDAR` y el número de confirmaciones y entradas registradas. No se inventan operaciones para aumentar actividad.

## Reproducir

Con Node 24 y desde la raíz del repositorio, guardar los informes fuera del checkout:

```sh
node --use-env-proxy scripts/evaluate-history.cjs /workspace/.mtf-validation/review-20261013/history-audit.json
node scripts/evaluate-execution.cjs /workspace/.mtf-validation/review-20261013/history-audit.json /workspace/.mtf-validation/review-20261013/execution.json
node scripts/compare-strategies.cjs /workspace/.mtf-validation/review-20261013/history-cache /workspace/.mtf-validation/review-20261013/comparison.json
node scripts/compare-ob-strategies.cjs /workspace/.mtf-validation/review-20261013/history-cache /workspace/.mtf-validation/review-20261013/ob-comparison.json
```

Los informes contienen ventanas exactas y resultados. Ningún evaluador escribe en producción, configura una estrategia ni autoriza operaciones. Las reglas congeladas y las señales históricas se conservan; cualquier futura estrategia debe tener una versión y cohorte nuevas y evidencia independiente suficiente.
