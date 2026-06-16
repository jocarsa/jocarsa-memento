# jocarsa | biografía

Aplicación PHP + SQLite para grabar recuerdos de audio en una línea temporal vertical, con precisión mensual.

## Funciones principales

- Interfaz completa en español.
- Marca integrada en la columna izquierda.
- Línea temporal vertical de 1978 hasta el mes actual.
- Grabación de audio desde el navegador.
- Onda real precalculada del audio y guardada en SQLite.
- Reproductor personalizado con botón circular, barras de progreso, marcador temporal y scrubbing sobre la onda.
- Eventos a ancho completo, con 50% para título/fecha y 50% para audio.
- Transcripción bajo demanda con Whisper local.
- La transcripción se guarda en SQLite y se puede ver en un modal desde cada evento.

## Whisper

La transcripción intenta usar automáticamente el comando `whisper` si está instalado:
