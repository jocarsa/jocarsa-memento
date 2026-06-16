<?php
header('Content-Type: application/json; charset=utf-8');

putenv('PATH=/home/josevicente/.local/bin:/usr/local/bin:/usr/bin:/bin');

define(
    'JOCARSA_WHISPER_COMMAND',
    '/var/www/whisper-venv/bin/python -m whisper {input} --language Spanish --task transcribe --output_format txt --output_dir {output_dir} 2>&1'
);

$dbPath = __DIR__ . '/data/timeline.sqlite';
$recordingsDir = __DIR__ . '/recordings';

if (!is_dir(__DIR__ . '/data')) {
    mkdir(__DIR__ . '/data', 0775, true);
}

if (!is_dir($recordingsDir)) {
    mkdir($recordingsDir, 0775, true);
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

$action = $_GET['action'] ?? '';

if ($action === 'upload') {
    $monthIndex = intval($_POST['month_index'] ?? 0);
    $title = trim($_POST['title'] ?? '');
    $waveform = trim($_POST['waveform'] ?? '');

    if ($waveform !== '') {
        $decodedWaveform = json_decode($waveform, true);

        if (!is_array($decodedWaveform)) {
            $waveform = '';
        } else {
            $decodedWaveform = array_slice($decodedWaveform, 0, 160);
            $decodedWaveform = array_map(function ($value) {
                return max(0, min(1, floatval($value)));
            }, $decodedWaveform);
            $waveform = json_encode($decodedWaveform);
        }
    }

    $currentYear = intval(date('Y'));
    $currentMonth = intval(date('n'));
    $minMonthIndex = 1978 * 12;
    $maxMonthIndex = $currentYear * 12 + ($currentMonth - 1);

    if ($monthIndex < $minMonthIndex || $monthIndex > $maxMonthIndex) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Momento seleccionado no válido']);
        exit;
    }

    $year = intdiv($monthIndex, 12);
    $month = ($monthIndex % 12) + 1;

    if (!isset($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'No se ha recibido un archivo de audio válido']);
        exit;
    }

    $safeTitle = preg_replace('/[^a-zA-Z0-9_-]+/', '-', strtolower($title));
    $safeTitle = trim($safeTitle, '-');

    if ($safeTitle === '') {
        $safeTitle = 'grabacion';
    }

    $filename = sprintf('%04d-%02d', $year, $month) . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '_' . $safeTitle . '.webm';
    $path = $recordingsDir . '/' . $filename;

    if (!move_uploaded_file($_FILES['audio']['tmp_name'], $path)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'No se ha podido guardar el archivo de audio']);
        exit;
    }

    $stmt = $db->prepare("INSERT INTO recordings (year, month, title, filename, waveform) VALUES (:year, :month, :title, :filename, :waveform)");
    $stmt->bindValue(':year', $year, SQLITE3_INTEGER);
    $stmt->bindValue(':month', $month, SQLITE3_INTEGER);
    $stmt->bindValue(':title', $title, SQLITE3_TEXT);
    $stmt->bindValue(':filename', $filename, SQLITE3_TEXT);
    $stmt->bindValue(':waveform', $waveform, SQLITE3_TEXT);
    $stmt->execute();

    echo json_encode([
        'success' => true,
        'filename' => $filename,
        'year' => $year,
        'month' => $month
    ]);
    exit;
}

if ($action === 'list') {
    $result = $db->query("SELECT id, year, month, title, filename, created_at, waveform, transcription FROM recordings ORDER BY year DESC, month DESC, created_at DESC");
    $items = [];

    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $items[] = $row;
    }

    echo json_encode(['success' => true, 'items' => $items]);
    exit;
}

if ($action === 'transcribe') {
    $id = intval($_POST['id'] ?? $_GET['id'] ?? 0);

    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Identificador no válido']);
        exit;
    }

    $stmt = $db->prepare("SELECT id, filename, transcription FROM recordings WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Grabación no encontrada']);
        exit;
    }

    $audioPath = realpath($recordingsDir . '/' . $row['filename']);
    $recordingsRoot = realpath($recordingsDir);

    if (!$audioPath || !$recordingsRoot || strpos($audioPath, $recordingsRoot) !== 0 || !is_file($audioPath)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Archivo de audio no encontrado']);
        exit;
    }

    $tmpDir = __DIR__ . '/data/transcriptions';

    if (!is_dir($tmpDir)) {
        mkdir($tmpDir, 0775, true);
    }

    $baseName = 'transcripcion_' . $id . '_' . bin2hex(random_bytes(4));
    $outputBase = $tmpDir . '/' . $baseName;
    $txtPath = $outputBase . '.txt';

    $customCommand = defined('JOCARSA_WHISPER_COMMAND')
        ? JOCARSA_WHISPER_COMMAND
        : (getenv('JOCARSA_WHISPER_COMMAND') ?: '');

    if ($customCommand !== '') {
        if (strpos($customCommand, '{input}') !== false) {
            $command = str_replace(
                ['{input}', '{output}', '{output_dir}', '{output_base}'],
                [
                    escapeshellarg($audioPath),
                    escapeshellarg($txtPath),
                    escapeshellarg($tmpDir),
                    escapeshellarg($outputBase)
                ],
                $customCommand
            );
        } else {
            $command = escapeshellcmd($customCommand)
                . ' ' . escapeshellarg($audioPath)
                . ' --language Spanish'
                . ' --task transcribe'
                . ' --output_format txt'
                . ' --output_dir ' . escapeshellarg($tmpDir)
                . ' 2>&1';
        }
    } else {
        $whisper = trim((string)shell_exec('command -v whisper 2>/dev/null'));
        $whisperCli = trim((string)shell_exec('command -v whisper-cli 2>/dev/null'));

        if ($whisper !== '') {
            $command = escapeshellcmd($whisper)
                . ' ' . escapeshellarg($audioPath)
                . ' --language Spanish'
                . ' --task transcribe'
                . ' --output_format txt'
                . ' --output_dir ' . escapeshellarg($tmpDir)
                . ' 2>&1';
        } elseif ($whisperCli !== '') {
            $model = getenv('JOCARSA_WHISPER_MODEL') ?: (__DIR__ . '/models/ggml-base.bin');

            if (!is_file($model)) {
                http_response_code(500);
                echo json_encode([
                    'success' => false,
                    'error' => 'Se ha encontrado whisper-cli, pero falta el modelo. Define JOCARSA_WHISPER_MODEL con la ruta del modelo .bin.'
                ]);
                exit;
            }

            $command = escapeshellcmd($whisperCli)
                . ' -m ' . escapeshellarg($model)
                . ' -f ' . escapeshellarg($audioPath)
                . ' -l es'
                . ' -otxt'
                . ' -of ' . escapeshellarg($outputBase)
                . ' 2>&1';
        } else {
            http_response_code(500);
            echo json_encode([
                'success' => false,
                'error' => 'No se ha encontrado Whisper. Instala el comando whisper o define JOCARSA_WHISPER_COMMAND.'
            ]);
            exit;
        }
    }

    @set_time_limit(0);

    $commandOutput = [];
    $exitCode = 0;
    exec($command, $commandOutput, $exitCode);

    if (!is_file($txtPath)) {
        $candidate = $tmpDir . '/' . pathinfo($row['filename'], PATHINFO_FILENAME) . '.txt';

        if (is_file($candidate)) {
            $txtPath = $candidate;
        }
    }

    if ($exitCode !== 0 || !is_file($txtPath)) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Whisper no ha generado una transcripción válida',
            'details' => implode("\n", array_slice($commandOutput, -20)),
            'command' => $command
        ]);
        exit;
    }

    $text = trim((string)file_get_contents($txtPath));

    if ($text === '') {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'La transcripción está vacía',
            'details' => implode("\n", array_slice($commandOutput, -20))
        ]);
        exit;
    }

    $stmt = $db->prepare("UPDATE recordings SET transcription = :transcription WHERE id = :id");
    $stmt->bindValue(':transcription', $text, SQLITE3_TEXT);
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();

    echo json_encode([
        'success' => true,
        'transcription' => $text
    ]);
    exit;
}

http_response_code(404);
echo json_encode(['success' => false, 'error' => 'Acción desconocida']);
