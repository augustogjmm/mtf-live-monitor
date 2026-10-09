# Publicación y backend de pruebas

Esta entrega prepara el monitor para señales manuales en cripto, CEDEAR y
ADR. La autorización para publicar no reemplaza las credenciales de los
servicios ni demuestra rentabilidad.

## Entorno separado

1. Crear un proyecto Supabase de pruebas desde la cuenta propietaria.
2. Obtener una copia del esquema completo del backend existente mediante
   las herramientas oficiales de Supabase. Excluir datos personales, secretos
   de Vault, cron activos y alertas Telegram. Las migraciones de este repositorio
   son incrementales y no reconstruyen una base vacía por sí solas.
3. Restaurar el esquema en pruebas y revisar RLS y permisos de RPC antes de
   habilitar lecturas públicas. Desplegar las funciones Edge del repositorio en
   ese proyecto; configurar sus secretos en Supabase y mantener cron desactivado
   hasta verificar una ejecución manual autenticada por mercado.
4. Configurar una instancia separada del frontend/API con
   `MTF_SUPABASE_URL` y `MTF_SUPABASE_PUBLISHABLE_KEY`. Las dos variables son
   obligatorias si se sobrescribe el backend. La URL debe ser un origen HTTPS.
   No usar claves de servicio en la API pública o en el navegador.
5. Verificar registros, inserciones de señales, deduplicación, reinicio,
   recuperación tras caída del proveedor y descartes por datos antiguos.
   Las notificaciones deben estar desactivadas o dirigidas a un canal de prueba.

## Comprobaciones de entrega

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run validate:live -- artifacts/live-report.json
```

La última comprobación realiza lecturas del backend configurado y no activa
motores. Revisar la fecha del informe y los problemas que registra: un proceso
que termina correctamente no implica que todas las fuentes estén actuales.

Para producción, publicar primero el frontend/API en una vista previa de
Vercel y verificar los tres mercados, estadísticas, navegación móvil y caída
de fuentes. Publicar las funciones Edge desde la cuenta autorizada de Supabase
y observar al menos un ciclo de cada cron. Verificar que ninguna instancia de
pruebas comparte cron o alertas con producción. Mantener la versión anterior
como opción de reversión de frontend y funciones.

## Criterio de aceptación

Las regresiones locales y las lecturas públicas no certifican las escrituras
del backend ni el desempeño de la estrategia. La auditoría inicial de seis
activos no encontró confirmaciones válidas. No presentar tasas de acierto,
rentabilidad o expectativas de ganancias hasta completar la evaluación
descrita en [STRATEGY_VALIDATION.md](STRATEGY_VALIDATION.md).
