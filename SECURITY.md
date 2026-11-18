# Security policy

Estos repositorios contienen proyectos personales, aplicaciones experimentales o material de documentación profesional. No representan sistemas financieros corporativos certificados ni comprometen un SLA de respuesta.

## Reportar un problema

- No publicar claves, contraseñas, datos de clientes, tokens, configuraciones sensibles ni pasos de explotación en issues públicos.
- Si GitHub ofrece la opción **Report a vulnerability** / private vulnerability reporting, usarla para compartir información sensible.
- Si esa opción no está disponible, enviar un contacto inicial por [LinkedIn](https://www.linkedin.com/in/augustog/) sin adjuntar secretos.

## Recomendaciones de uso

- No subir archivos `.env`, tokens de proveedores ni respaldos operativos. Utilizar variables de entorno o gestores seguros de secretos.
- Tratar las entradas de APIs de terceros como datos no confiables, con validación, límites de tiempo y mecanismos para degradación controlada.
- Interpretar las simulaciones como experimentos, no como evidencia de seguridad o rentabilidad de una inversión.
- La exposición de un secreto requiere **revocación y rotación**, incluso si el archivo dejó de estar presente en la rama actual; los commits anteriores pueden conservarlo.

El uso y mantenimiento de estos proyectos se ajusta a la documentación particular de cada repositorio. No se garantiza soporte continuo.
