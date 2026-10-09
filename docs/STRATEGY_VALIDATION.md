# Validación pendiente de cripto, CEDEAR y ADR

Objetivo: señales manuales, con datos verificables y desempeño medido por
mercado. Estado actual: controles locales verificados; estrategias no
certificadas por desempeño.

## Evidencia necesaria

1. Un backend de prueba identificado, con esquema, funciones y cron completos.
   Probar precios, estados, señales, estadísticas y recuperación tras una
   interrupción; verificar que los descartes por reloj aparecen en el funnel.
2. Datos históricos con hora de disponibilidad, zona horaria, OHLCV y fuente.
   Cripto requiere H1/H4 y confirmaciones M15; ADR y CEDEAR necesitan diarios,
   semanas cerradas y M15. Para CEDEAR registrar también liquidez BYMA,
   moneda y conversión del subyacente. Los activos del universo deben ser los
   que eran elegibles en cada fecha, no únicamente los sobrevivientes actuales.
3. Reproducir las reglas exactas del motor con datos disponibles en cada
   instante. Separar por fecha entrenamiento y evaluación fuera de muestra;
   no ajustar parámetros con el período reservado para evaluación.
4. Simular entrada ejecutable después de conocer la confirmación, con
   comisiones, spread, deslizamiento y latencia. Separar el precio teórico de
   cierre del precio al que una persona podría ejecutar. Resolver velas con
   stop y objetivo tocados usando datos más finos o registrar ambigüedad;
   no contarlas automáticamente como ganadoras.
5. Reportar por mercado, activo y período: cantidad de operaciones,
   expectativa neta, profit factor, drawdown máximo, exposición, duración,
   concentración y sensibilidad a costos. Para ADR, contemplar que su
   invalidación técnica no produce hoy una salida automática.
6. Comparar con una referencia simple y realizar seguimiento en papel con
   señales fechadas antes del movimiento. Definir tolerancia de pérdida y
   criterios de aceptación antes de decidir que la estrategia está validada.

## Evidencia de esta revisión

- Se resolvió el bloqueo de red y se verificaron las lecturas públicas de runtime
  de 20 criptoactivos, 316 CEDEAR y 14 ADR, estadísticas y salud. Node 24 usa el
  proxy del entorno con verificación TLS. Los reportes tienen fecha de ejecución;
  no equivalen a una garantía de disponibilidad futura.
- Pasaron las cuatro suites de regresión y la prueba de navegador: inicio,
  ambos grupos de mercados (incluyendo ADR), estadísticas, vista móvil y caída
  del proveedor. La suite de motores carga el TypeScript real y bloquea llamadas
  externas; comprueba además los ocho invariantes incluidos en el motor ADR.
- La auditoría histórica cubrió 8.042 velas de confirmación: BTC y ETH (2.879
  cada uno), AAPL, MSFT, GGAL e YPF (571 cada uno). No encontró confirmaciones
  que pasaran todas las reglas en esa muestra. Esto no demuestra rentabilidad
  ni permite estimar una tasa de acierto. No se ajustaron parámetros para
  fabricar operaciones o mejorar retrospectivamente el resultado.
- La cohorte estadística activa consultada estaba vacía; las posiciones
  existentes estaban etiquetadas como legadas. No mezclar esa cohorte con
  rendimiento anterior.
- Se agregó una simulación aproximada de ejecución con demora, costos,
  deslizamiento, gaps y resolución adversa de velas ambiguas. La prueba cubre
  además operaciones abiertas, bloqueo de posiciones simultáneas y entradas
  SHORT. Ejecutada sobre la misma muestra histórica, informó evidencia
  insuficiente en los seis activos. No reconstruye el break-even de un minuto,
  no usa un período reservado fuera de muestra y no certifica desempeño.

## Pendiente para finalizar la certificación

- No existe todavía un proyecto Supabase de pruebas identificado por el usuario.
  No se ejecutaron migraciones, motores, cron ni pruebas SQL contra producción.
  Crear un proyecto de pruebas y suministrar su configuración de forma segura
  para validar la escritura, deduplicación, fallos y recuperación.
- Falta un backtest de ejecución con costos, latencia, liquidez histórica BYMA,
  universo por fecha y evaluación fuera de muestra. La auditoría de confirmaciones
  no reemplaza ese trabajo. Ampliar activos y períodos requiere datos apropiados;
  Yahoo limita el histórico intradiario disponible.
- El estado real informó incidencias históricas de fuentes CEDEAR. Validar
  clasificación, reintentos y cobertura en el backend de pruebas.

Los cambios de código locales requieren su publicación mediante el flujo
normal del proyecto para afectar Vercel o las funciones Edge. Guardar o publicar
el entorno de desarrollo no despliega la aplicación.
