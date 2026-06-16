let mediaRecorder = null;
let audioChunks = [];
let recordedBlob = null;
let activeStream = null;
let audioContext = null;
let analyser = null;
let sourceNode = null;
let waveformAnimation = null;
let waveformHistory = [];
let recordingsData = [];
const activePlayers = new Set();

const MIN_YEAR = window.TIMELINE_MIN_YEAR || 1978;
const MAX_YEAR = window.TIMELINE_MAX_YEAR || new Date().getFullYear();
const MIN_MONTH_INDEX = window.TIMELINE_MIN_MONTH_INDEX || (MIN_YEAR * 12);
const MAX_MONTH_INDEX = window.TIMELINE_MAX_MONTH_INDEX || (MAX_YEAR * 12 + new Date().getMonth());
const TOTAL_MONTHS = MAX_MONTH_INDEX - MIN_MONTH_INDEX;
const BASE_TIMELINE_HEIGHT = Math.max(1080, (MAX_YEAR - MIN_YEAR + 1) * 30);

let currentZoom = 1;
let timelineHeight = BASE_TIMELINE_HEIGHT;
let selectedMonthIndex = MAX_MONTH_INDEX;
let isDraggingTimeline = false;

const selectedMoment = document.getElementById("selectedMoment");
const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const titleInput = document.getElementById("title");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const saveBtn = document.getElementById("saveBtn");
const refreshBtn = document.getElementById("refreshBtn");

const statusText = document.getElementById("status");
const preview = document.getElementById("preview");
const recordings = document.getElementById("recordings");
const timelineMap = document.getElementById("timelineMap");
const timelineYears = document.getElementById("timelineYears");
const timelineCursor = document.getElementById("timelineCursor");
const waveformCanvas = document.getElementById("waveform");
const waveformCtx = waveformCanvas.getContext("2d");

const transcriptionModal = document.getElementById("transcriptionModal");
const transcriptionText = document.getElementById("transcriptionText");
const closeTranscriptionModal = document.getElementById("closeTranscriptionModal");

function monthIndexToDate(monthIndex) {
  const year = Math.floor(Number(monthIndex) / 12);
  const month = (Number(monthIndex) % 12) + 1;
  return { year, month };
}

function dateToMonthIndex(year, month) {
  return Number(year) * 12 + (Number(month || 1) - 1);
}

function formatMoment(monthIndex) {
  const { year, month } = monthIndexToDate(monthIndex);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthIndexToTop(monthIndex) {
  const progress = (MAX_MONTH_INDEX - Number(monthIndex)) / TOTAL_MONTHS;
  return progress * timelineHeight;
}

function topToMonthIndex(top) {
  const clampedTop = Math.max(0, Math.min(timelineHeight, top));
  const progress = clampedTop / timelineHeight;
  const rawMonth = MAX_MONTH_INDEX - progress * TOTAL_MONTHS;
  return Math.max(MIN_MONTH_INDEX, Math.min(MAX_MONTH_INDEX, Math.round(rawMonth)));
}

function applyZoom() {
  currentZoom = Number(zoomRange.value) / 100;
  timelineHeight = BASE_TIMELINE_HEIGHT * currentZoom;
  timelineMap.style.height = `${timelineHeight}px`;
  zoomValue.textContent = `${zoomRange.value}%`;
  buildYearMarks();
  updateSelectedMoment();
  renderRecordings(recordingsData);
}

function updateSelectedMoment() {
  selectedMoment.textContent = formatMoment(selectedMonthIndex);
  const top = monthIndexToTop(selectedMonthIndex);
  timelineCursor.style.top = `${top}px`;
  timelineCursor.querySelector("span").textContent = formatMoment(selectedMonthIndex);
}

function selectMomentFromPointer(event) {
  const rect = timelineMap.getBoundingClientRect();
  const top = event.clientY - rect.top;
  selectedMonthIndex = topToMonthIndex(top);
  updateSelectedMoment();
}

timelineMap.addEventListener("pointerdown", event => {
  if (event.target.closest(".timeline-recording") || event.target.closest("audio")) return;
  isDraggingTimeline = true;
  timelineMap.setPointerCapture(event.pointerId);
  selectMomentFromPointer(event);
});

timelineMap.addEventListener("pointermove", event => {
  if (!isDraggingTimeline) return;
  selectMomentFromPointer(event);
});

timelineMap.addEventListener("pointerup", event => {
  isDraggingTimeline = false;
  if (timelineMap.hasPointerCapture(event.pointerId)) {
    timelineMap.releasePointerCapture(event.pointerId);
  }
});

timelineMap.addEventListener("pointercancel", () => {
  isDraggingTimeline = false;
});

zoomRange.addEventListener("input", applyZoom);

startBtn.addEventListener("click", async () => {
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    recordedBlob = null;
    preview.removeAttribute("src");
    preview.load();
    waveformHistory = [];

    startWaveform(activeStream);

    mediaRecorder = new MediaRecorder(activeStream);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(audioChunks, { type: "audio/webm" });
      preview.src = URL.createObjectURL(recordedBlob);
      saveBtn.disabled = false;
      statusText.textContent = "Grabación finalizada. Puedes escucharla o guardarla.";
      stopWaveform(false);

      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };

    mediaRecorder.start();

    startBtn.disabled = true;
    stopBtn.disabled = false;
    saveBtn.disabled = true;

    statusText.textContent = `Grabando para ${formatMoment(selectedMonthIndex)}...`;
  } catch (error) {
    statusText.textContent = "No se ha podido acceder al micrófono.";
    console.error(error);
  }
});

stopBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
});

saveBtn.addEventListener("click", async () => {
  if (!recordedBlob) return;

  const formData = new FormData();
  formData.append("month_index", selectedMonthIndex);
  formData.append("title", titleInput.value);
  formData.append("audio", recordedBlob, "recording.webm");

  try {
    const waveform = await calculateWaveformFromBlob(recordedBlob, 128);
    formData.append("waveform", JSON.stringify(waveform));
  } catch (error) {
    console.warn("No se ha podido precalcular la onda de audio.", error);
  }

  statusText.textContent = "Guardando...";

  try {
    const response = await fetch("api.php?action=upload", {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Error desconocido");
    }

    statusText.textContent = "Audio guardado en la línea temporal.";
    saveBtn.disabled = true;
    titleInput.value = "";
    await loadRecordings();
  } catch (error) {
    statusText.textContent = "No se ha podido guardar el audio.";
    console.error(error);
  }
});

refreshBtn.addEventListener("click", loadRecordings);

async function loadRecordings() {
  const response = await fetch("api.php?action=list");
  const data = await response.json();

  recordingsData = data.success ? data.items : [];
  renderRecordings(recordingsData);
}

function renderRecordings(data) {
  recordings.innerHTML = "";
  activePlayers.clear();

  if (!data || data.length === 0) {
    recordings.innerHTML = `<p class="empty timeline-empty">Todavía no hay grabaciones.</p>`;
    timelineMap.style.minWidth = "760px";
    return;
  }

  const BASE_LEFT = 82;

  const sortedData = [...data].sort((a, b) => {
    const aMonth = dateToMonthIndex(a.year, a.month || 1);
    const bMonth = dateToMonthIndex(b.year, b.month || 1);

    if (aMonth !== bMonth) {
      return monthIndexToTop(aMonth) - monthIndexToTop(bMonth);
    }

    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  sortedData.forEach((item, index) => {
    const monthIndex = dateToMonthIndex(item.year, item.month || 1);
    const top = monthIndexToTop(monthIndex);

    const article = document.createElement("article");
    article.className = "timeline-recording";
    article.style.top = `${top}px`;
    article.style.left = `${BASE_LEFT}px`;
    article.style.zIndex = String(10 + index);

    const title = escapeHtml(item.title || "Grabación sin título");
    const filename = encodeURIComponent(item.filename);
    const momentLabel = `${item.year}-${String(item.month || 1).padStart(2, "0")}`;
    const createdAt = escapeHtml(item.created_at || "");
    const waveform = normalizeWaveform(item.waveform);
    const transcription = String(item.transcription || "");
    const hasTranscription = transcription.trim() !== "";

    article.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="recording-card">
        <div class="recording-meta">
          <strong>${title}</strong>
          <span>${momentLabel}</span>
          <small>${createdAt}</small>

          <div class="transcription-actions">
            <button type="button" class="secondary transcribe-btn" data-id="${item.id}">${hasTranscription ? "Transcribir otra vez" : "Transcribir"}</button>
            <button type="button" class="secondary show-transcription-btn" ${hasTranscription ? "" : "disabled"}>Ver texto completo</button>
          </div>

          <span class="stored-transcription">${escapeHtml(JSON.stringify(transcription))}</span>
        </div>

        <div class="recording-transcription ${hasTranscription ? "has-text" : "is-empty"}">
          ${hasTranscription ? escapeHtml(transcription) : "Sin transcripción todavía."}
        </div>

        <div class="custom-audio-player" data-waveform='${JSON.stringify(waveform)}'>
          <button type="button" class="play-toggle" aria-label="Reproducir o pausar">▶</button>

          <div class="waveform-scrub">
            <canvas class="audio-waveform" width="900" height="84"></canvas>
            <div class="time-marker"></div>
          </div>

          <audio src="recordings/${filename}" preload="metadata"></audio>
        </div>
      </div>
    `;

    article.addEventListener("pointerenter", () => {
      article.style.zIndex = String(1000 + index);
    });

    article.addEventListener("pointerleave", () => {
      article.style.zIndex = String(10 + index);
    });

    recordings.appendChild(article);
  });

  timelineMap.style.minWidth = "100%";

  initialiseCustomAudioPlayers();
  initialiseTranscriptionButtons();
}

function initialiseTranscriptionButtons() {
  document.querySelectorAll(".transcribe-btn").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();

      const article = button.closest(".timeline-recording");
      const id = button.dataset.id;
      const showButton = article.querySelector(".show-transcription-btn");
      const storage = article.querySelector(".stored-transcription");
      const transcriptionBox = article.querySelector(".recording-transcription");

      button.disabled = true;
      button.textContent = "Transcribiendo...";
      statusText.textContent = "Transcribiendo audio con Whisper...";

      try {
        const formData = new FormData();
        formData.append("id", id);

        const response = await fetch("api.php?action=transcribe", {
          method: "POST",
          body: formData
        });

        let result = null;
        const rawText = await response.text();

        try {
          result = JSON.parse(rawText);
        } catch (error) {
          console.error("Respuesta no JSON del servidor:", rawText);
          alert(
            "El servidor no ha devuelto JSON válido.\n\n" +
            "ESTADO HTTP:\n" +
            response.status +
            "\n\nRESPUESTA:\n" +
            rawText
          );
          throw new Error("Respuesta inválida del servidor.");
        }

        if (!response.ok || !result.success) {
          console.error("Respuesta completa del servidor:", result);

          alert(
            (result.error || "Error desconocido") +
            "\n\nDETALLES:\n" +
            (result.details || "Sin detalles") +
            "\n\nCOMANDO:\n" +
            (result.command || "Sin comando") +
            "\n\nESTADO HTTP:\n" +
            response.status
          );

          throw new Error(result.error || "No se ha podido transcribir el audio.");
        }

        const text = String(result.transcription || "").trim();

        if (storage) {
          storage.textContent = JSON.stringify(text);
        }

        if (showButton) {
          showButton.disabled = false;
        }

        if (transcriptionBox) {
          transcriptionBox.textContent = text || "Sin transcripción todavía.";
          transcriptionBox.classList.toggle("has-text", text !== "");
          transcriptionBox.classList.toggle("is-empty", text === "");
        }

        button.textContent = "Transcribir otra vez";
        statusText.textContent = "Transcripción guardada en la base de datos.";
        openTranscriptionModal(text);
      } catch (error) {
        button.textContent = "Transcribir";
        statusText.textContent = error.message || "No se ha podido transcribir el audio.";
        console.error(error);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".show-transcription-btn").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const article = button.closest(".timeline-recording");
      const storage = article.querySelector(".stored-transcription");

      let text = "";

      try {
        text = JSON.parse(storage?.textContent || '""');
      } catch (error) {
        text = "";
      }

      openTranscriptionModal(text || "No hay transcripción guardada para esta grabación.");
    });
  });
}

function openTranscriptionModal(text) {
  transcriptionText.textContent = text;
  transcriptionModal.hidden = false;
  document.body.classList.add("modal-open");
  closeTranscriptionModal.focus();
}

function closeModal() {
  transcriptionModal.hidden = true;
  document.body.classList.remove("modal-open");
}

closeTranscriptionModal.addEventListener("click", closeModal);

transcriptionModal.addEventListener("click", event => {
  if (event.target === transcriptionModal) {
    closeModal();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !transcriptionModal.hidden) {
    closeModal();
  }
});

function normalizeWaveform(rawWaveform) {
  if (Array.isArray(rawWaveform)) {
    return rawWaveform.map(value => Math.max(0, Math.min(1, Number(value) || 0)));
  }

  if (typeof rawWaveform === "string" && rawWaveform.trim() !== "") {
    try {
      const parsed = JSON.parse(rawWaveform);

      if (Array.isArray(parsed)) {
        return parsed.map(value => Math.max(0, Math.min(1, Number(value) || 0)));
      }
    } catch (error) {
      return [];
    }
  }

  return [];
}

async function calculateWaveformFromBlob(blob, bars = 128) {
  const arrayBuffer = await blob.arrayBuffer();
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
  const channelData = audioBuffer.getChannelData(0);
  const waveform = calculateWaveformFromSamples(channelData, bars);
  await context.close();
  return waveform;
}

function calculateWaveformFromSamples(samples, bars = 128) {
  const samplesPerBar = Math.max(1, Math.floor(samples.length / bars));
  const waveform = [];
  let maxValue = 0;

  for (let i = 0; i < bars; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(samples.length, start + samplesPerBar);
    let sum = 0;

    for (let j = start; j < end; j++) {
      sum += Math.abs(samples[j]);
    }

    const value = sum / Math.max(1, end - start);
    waveform.push(value);
    maxValue = Math.max(maxValue, value);
  }

  return waveform.map(value => maxValue > 0 ? value / maxValue : 0);
}

function initialiseCustomAudioPlayers() {
  document.querySelectorAll(".custom-audio-player").forEach(player => {
    const audio = player.querySelector("audio");
    const button = player.querySelector(".play-toggle");
    const canvas = player.querySelector(".audio-waveform");
    const marker = player.querySelector(".time-marker");

    let waveform = normalizeWaveform(player.dataset.waveform || "[]");

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;

      canvas.width = Math.max(320, Math.floor(rect.width * ratio));
      canvas.height = Math.max(70, Math.floor(rect.height * ratio));

      drawInteractiveWaveform(canvas, waveform, getAudioProgress(audio));
    };

    resizeCanvas();

    if (waveform.length === 0) {
      generateWaveformForExistingAudio(audio.src).then(generated => {
        waveform = generated;
        player.dataset.waveform = JSON.stringify(waveform);
        drawInteractiveWaveform(canvas, waveform, getAudioProgress(audio));
      }).catch(() => {
        waveform = [0.18, 0.35, 0.28, 0.45, 0.22, 0.31, 0.48, 0.36, 0.25, 0.42, 0.29, 0.38];
        drawInteractiveWaveform(canvas, waveform, getAudioProgress(audio));
      });
    }

    button.addEventListener("click", async event => {
      event.stopPropagation();

      if (audio.paused) {
        pauseOtherPlayers(audio);
        await audio.play();
      } else {
        audio.pause();
      }
    });

    canvas.addEventListener("click", event => {
      event.stopPropagation();

      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

      const rect = canvas.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

      audio.currentTime = progress * audio.duration;

      drawInteractiveWaveform(canvas, waveform, progress);
      marker.style.left = `${progress * 100}%`;
    });

    audio.addEventListener("play", () => {
      activePlayers.add(audio);
      button.textContent = "❚❚";
    });

    audio.addEventListener("pause", () => {
      activePlayers.delete(audio);
      button.textContent = "▶";
    });

    audio.addEventListener("ended", () => {
      activePlayers.delete(audio);
      button.textContent = "▶";
      audio.currentTime = 0;
      drawInteractiveWaveform(canvas, waveform, 0);
      marker.style.left = "0%";
    });

    audio.addEventListener("timeupdate", () => {
      const progress = getAudioProgress(audio);
      drawInteractiveWaveform(canvas, waveform, progress);
      marker.style.left = `${progress * 100}%`;
    });

    window.addEventListener("resize", resizeCanvas, { passive: true });
  });
}

function pauseOtherPlayers(currentAudio) {
  activePlayers.forEach(audio => {
    if (audio !== currentAudio) {
      audio.pause();
    }
  });
}

function getAudioProgress(audio) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, audio.currentTime / audio.duration));
}

async function generateWaveformForExistingAudio(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
  const waveform = calculateWaveformFromSamples(audioBuffer.getChannelData(0), 128);
  await context.close();
  return waveform;
}

function drawInteractiveWaveform(canvas, waveform, progress) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const center = height / 2;
  const data = waveform.length ? waveform : [0.2];
  const bars = data.length;
  const gap = Math.max(2, Math.floor(width / bars * 0.32));
  const barWidth = Math.max(3, Math.floor((width - gap * (bars - 1)) / bars));
  const playedLimit = Math.floor(progress * bars);

  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < bars; i++) {
    const value = Math.max(0.06, Math.min(1, data[i] || 0));
    const barHeight = Math.max(6, value * (height - 18));
    const x = i * (barWidth + gap);
    const radius = Math.max(2, Math.min(8, barWidth / 2));

    ctx.fillStyle = i <= playedLimit ? "#111827" : "#c8ced6";
    roundedRect(ctx, x, center - barHeight / 2, barWidth, barHeight, radius);
    ctx.fill();
  }
}

function buildYearMarks() {
  timelineYears.innerHTML = "";

  for (let year = MAX_YEAR; year >= MIN_YEAR; year--) {
    const monthIndex = year * 12;

    if (monthIndex < MIN_MONTH_INDEX || monthIndex > MAX_MONTH_INDEX) continue;

    const isMain = year === MAX_YEAR || year === MIN_YEAR || year % 5 === 0;
    const mark = document.createElement("div");

    mark.className = isMain ? "year-mark main" : "year-mark";
    mark.style.top = `${monthIndexToTop(monthIndex)}px`;
    mark.innerHTML = `<span>${isMain ? year : ""}</span>`;

    timelineYears.appendChild(mark);
  }

  if (currentZoom >= 1.4) {
    for (let monthIndex = MAX_MONTH_INDEX; monthIndex >= MIN_MONTH_INDEX; monthIndex--) {
      const { month } = monthIndexToDate(monthIndex);

      if (month !== 1 && month !== 7) {
        const mark = document.createElement("div");
        mark.className = "month-mark";
        mark.style.top = `${monthIndexToTop(monthIndex)}px`;
        timelineYears.appendChild(mark);
      }
    }
  }
}

function startWaveform(stream) {
  stopWaveform(true);

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  sourceNode = audioContext.createMediaStreamSource(stream);
  sourceNode.connect(analyser);

  drawWaveform();
}

function drawWaveform() {
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buffer);

  const average = buffer.reduce((sum, value) => sum + value, 0) / buffer.length;
  const normalized = Math.max(4, Math.min(1, average / 130) * 100);

  waveformHistory.push(normalized);

  const maxBars = 64;

  if (waveformHistory.length > maxBars) {
    waveformHistory.shift();
  }

  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  const center = height / 2;
  const gap = 4;
  const barWidth = Math.max(3, Math.floor(width / maxBars) - gap);

  waveformCtx.clearRect(0, 0, width, height);

  waveformCtx.fillStyle = "rgba(17, 24, 39, 0.06)";
  waveformCtx.fillRect(0, 0, width, height);

  waveformCtx.fillStyle = "#111827";

  waveformHistory.forEach((value, index) => {
    const x = index * (barWidth + gap) + 8;
    const barHeight = Math.max(6, value);

    roundedRect(waveformCtx, x, center - barHeight / 2, barWidth, barHeight, barWidth / 2);
    waveformCtx.fill();
  });

  waveformAnimation = requestAnimationFrame(drawWaveform);
}

function stopWaveform(clear) {
  if (waveformAnimation) {
    cancelAnimationFrame(waveformAnimation);
    waveformAnimation = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (clear) {
    waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    drawIdleWaveform();
  }
}

function drawIdleWaveform() {
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  const center = height / 2;

  waveformCtx.clearRect(0, 0, width, height);

  waveformCtx.fillStyle = "rgba(17, 24, 39, 0.06)";
  waveformCtx.fillRect(0, 0, width, height);

  waveformCtx.fillStyle = "rgba(17, 24, 39, 0.22)";

  for (let i = 0; i < 50; i++) {
    const x = i * 10 + 12;
    const h = 8 + Math.sin(i * 0.7) * 5;

    roundedRect(waveformCtx, x, center - h / 2, 4, h, 2);
    waveformCtx.fill();
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

applyZoom();
drawIdleWaveform();
loadRecordings();
