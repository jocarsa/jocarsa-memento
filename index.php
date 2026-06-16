<?php
$dbPath = __DIR__ . '/data/timeline.sqlite';
if (!is_dir(__DIR__ . '/data')) {
    mkdir(__DIR__ . '/data', 0775, true);
}
$db = new SQLite3($dbPath);

$db->exec("CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  filename TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  waveform TEXT,
  transcription TEXT
)");

$columns = [];
$result = $db->query("PRAGMA table_info(recordings)");
while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
    $columns[] = $row['name'];
}
if (!in_array('month', $columns, true)) {
    $db->exec("ALTER TABLE recordings ADD COLUMN month INTEGER NOT NULL DEFAULT 1");
}
if (!in_array('waveform', $columns, true)) {
    $db->exec("ALTER TABLE recordings ADD COLUMN waveform TEXT");
}
if (!in_array('transcription', $columns, true)) {
    $db->exec("ALTER TABLE recordings ADD COLUMN transcription TEXT");
}

$currentYear = intval(date('Y'));
$currentMonth = intval(date('n'));
$minMonthIndex = 1978 * 12;
$maxMonthIndex = $currentYear * 12 + ($currentMonth - 1);
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>jocarsa | memento</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="style.css">
</head>
<body>

<main class="app">
  <section class="workspace">
    <aside class="panel recorder-panel">
      <div class="brand-block">
        <div class="brand-mark">j</div>
        <div>
          <p class="eyebrow">archivo personal de audio</p>
          <h1>jocarsa | biografía</h1>
          <p class="subtitle">Selecciona un mes en la línea temporal, graba un recuerdo y guárdalo justo en ese momento.</p>
        </div>
      </div>

      <div class="selected-moment">
        <span>Momento seleccionado</span>
        <strong id="selectedMoment"><?= sprintf('%04d-%02d', $currentYear, $currentMonth) ?></strong>
      </div>

      <label for="title">Título de la grabación</label>
      <input type="text" id="title" placeholder="Título opcional, por ejemplo: primer ordenador, colegio, familia...">

      <div class="waveform-card">
        <canvas id="waveform" width="520" height="110"></canvas>
        <p id="status" class="status">Preparado</p>
      </div>

      <div class="buttons">
        <button id="startBtn">Empezar grabación</button>
        <button id="stopBtn" disabled>Detener grabación</button>
        <button id="saveBtn" disabled>Guardar audio</button>
      </div>

      <audio id="preview" controls></audio>
    </aside>

    <section class="panel timeline-panel">
      <div class="section-title">
        <div>
          <h2>Línea temporal vertical</h2>
          <p>Pulsa o arrastra sobre la línea temporal para seleccionar el mes actual. Usa el zoom para ampliar o comprimir la escala.</p>
        </div>
        <button id="refreshBtn" class="secondary">Actualizar</button>
      </div>

      <div class="timeline-stage" id="timelineStage">
        <div class="timeline-map-wrap">
          <div class="zoom-control">
            <label for="zoomRange">Zoom de la línea temporal</label>
            <input type="range" id="zoomRange" min="50" max="260" value="100" step="10">
            <span id="zoomValue">100%</span>
          </div>

          <div class="timeline-map" id="timelineMap">
            <div class="timeline-line"></div>
            <div id="timelineYears" class="timeline-years"></div>
            <div id="timelineCursor" class="timeline-cursor">
              <span></span>
            </div>
            <div id="recordings" class="recordings-on-timeline"></div>
          </div>
        </div>
      </div>
    </section>
  </section>
</main>

<div id="transcriptionModal" class="modal-backdrop" hidden>
  <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="transcriptionTitle">
    <div class="modal-head">
      <h2 id="transcriptionTitle">Transcripción</h2>
      <button id="closeTranscriptionModal" class="secondary modal-close" type="button">Cerrar</button>
    </div>
    <pre id="transcriptionText" class="transcription-text"></pre>
  </section>
</div>

<script>
  window.TIMELINE_MIN_YEAR = 1978;
  window.TIMELINE_MAX_YEAR = <?= $currentYear ?>;
  window.TIMELINE_MIN_MONTH_INDEX = <?= $minMonthIndex ?>;
  window.TIMELINE_MAX_MONTH_INDEX = <?= $maxMonthIndex ?>;
</script>
<script src="app.js"></script>
</body>
</html>
