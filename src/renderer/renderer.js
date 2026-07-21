const $ = selector => document.querySelector(selector);

let settings = null;
let autoTimer = null;
let busy = false;
let backgroundFiles = [];

function setStatus(text) {
  $("#status").textContent = text;
}

function formatResult(result) {
  const lines = [
    "CURRENT STATE",
    result.state,
    "",
    "NEXT ACTION",
    result.next_action
  ];
  if (result.details?.length) {
    lines.push("", "DETAILS", ...result.details.map((x, i) => `${i + 1}. ${x}`));
  }
  if (result.commands?.length) {
    lines.push("", "COMMANDS", ...result.commands.map(x => `> ${x}`));
  }
  if (result.verification?.length) {
    lines.push("", "VERIFY", ...result.verification.map(x => `- ${x}`));
  }
  if (result.warnings?.length) {
    lines.push("", "WARNINGS", ...result.warnings.map(x => `! ${x}`));
  }
  return lines.join("\n");
}

function renderFiles() {
  const root = $("#fileList");
  root.innerHTML = "";
  if (!backgroundFiles.length) {
    root.innerHTML = '<div class="item small">No files attached.</div>';
    return;
  }
  for (const file of backgroundFiles) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = file.name;
    div.title = file.path;
    root.appendChild(div);
  }
}

async function renderSteps() {
  const steps = await window.screenPair.listSteps();
  const root = $("#stepList");
  root.innerHTML = "";
  if (!steps.length) {
    root.innerHTML = '<div class="item small">No completed steps.</div>';
    return;
  }
  for (const step of [...steps].reverse()) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `Step ${step.idx} — ${step.timestamp}: ${step.result.next_action}`;
    root.appendChild(div);
  }
}

function stopAuto() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  $("#toggleAuto").textContent = "Start automatic capture";
  $("#toggleAuto").classList.add("secondary");
}

function startAuto(runImmediately = false) {
  stopAuto();
  const interval = Math.max(15, Number(settings.intervalSec) || 60) * 1000;
  autoTimer = setInterval(runOnce, interval);
  $("#toggleAuto").textContent = `Stop automatic capture (${Math.round(interval / 1000)}s)`;
  $("#toggleAuto").classList.remove("secondary");
  if (runImmediately) runOnce();
}

async function runOnce() {
  if (busy) return;
  busy = true;
  $("#captureOnce").disabled = true;
  try {
    setStatus("Capturing");
    const dataUrl = await window.screenPair.capture();
    $("#screenshot").src = dataUrl;

    setStatus("Analysing");
    $("#output").textContent = "Waiting for the API response...";
    const objective = $("#objective").value.trim();
    const result = await window.screenPair.analyze({ objective, dataUrl });

    $("#output").textContent = formatResult(result);
    await window.screenPair.addStep({ objective, imageDataUrl: dataUrl, result });
    await renderSteps();
    setStatus("Ready");
  } catch (error) {
    setStatus("Error");
    $("#output").textContent = `ERROR\n${error?.message || String(error)}`;
    stopAuto();
  } finally {
    busy = false;
    $("#captureOnce").disabled = false;
  }
}

function openSettings() {
  $("#settingsModal").classList.add("open");
  $("#modalBg").classList.add("open");
}

function closeSettings() {
  $("#settingsModal").classList.remove("open");
  $("#modalBg").classList.remove("open");
}

async function loadSettings() {
  settings = await window.screenPair.getSettings();
  $("#apiKey").value = settings.apiKey || "";
  $("#endpoint").value = settings.endpoint || "https://api.openai.com/v1/chat/completions";
  $("#model").value = settings.model || "gpt-5-mini";
  $("#customModel").value = settings.customModel || "";
  $("#autoCapture").checked = Boolean(settings.autoCapture);
  $("#intervalSec").value = settings.intervalSec || 60;
  $("#templatePath").textContent = settings.templatePath || "(No template selected)";
  $("#systemPrompt").value = settings.systemPrompt || "";
  if (settings.autoCapture) startAuto(false);
}

$("#captureOnce").addEventListener("click", runOnce);
$("#toggleAuto").addEventListener("click", () => autoTimer ? stopAuto() : startAuto(true));

$("#addFiles").addEventListener("click", async () => {
  try {
    backgroundFiles = await window.screenPair.addBackgroundFiles();
    renderFiles();
  } catch (error) {
    $("#output").textContent = `FILE ERROR\n${error?.message || String(error)}`;
  }
});

$("#clearFiles").addEventListener("click", async () => {
  backgroundFiles = await window.screenPair.clearBackgroundFiles();
  renderFiles();
});

$("#clearSession").addEventListener("click", async () => {
  await window.screenPair.clearSteps();
  $("#output").textContent = "Session cleared.";
  $("#screenshot").removeAttribute("src");
  await renderSteps();
});

$("#export").addEventListener("click", async () => {
  try {
    setStatus("Exporting");
    const result = await window.screenPair.exportReport();
    if (result) {
      $("#output").textContent = `Exported ${result.count} step(s) to:\n${result.path}`;
      await window.screenPair.showInFolder(result.path);
    }
    setStatus("Ready");
  } catch (error) {
    setStatus("Error");
    $("#output").textContent = `EXPORT ERROR\n${error?.message || String(error)}`;
  }
});

$("#settingsBtn").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", closeSettings);
$("#modalBg").addEventListener("click", closeSettings);

$("#chooseTemplate").addEventListener("click", async () => {
  const selected = await window.screenPair.chooseTemplate();
  if (selected) {
    $("#templatePath").textContent = selected;
    settings.templatePath = selected;
  }
});

$("#loadModels").addEventListener("click", async () => {
  const box = $("#availableModels");
  box.textContent = "Loading...";
  try {
    settings = await window.screenPair.saveSettings({
      apiKey: $("#apiKey").value.trim(),
      endpoint: $("#endpoint").value.trim(),
      model: $("#model").value,
      customModel: $("#customModel").value.trim(),
      autoCapture: $("#autoCapture").checked,
      intervalSec: Number($("#intervalSec").value),
      templatePath: settings.templatePath || "",
      systemPrompt: $("#systemPrompt").value
    });
    const models = await window.screenPair.listModels();
    const gptModels = models.filter(id => /^gpt-/i.test(id));
    box.textContent = gptModels.length ? gptModels.join(", ") : "No GPT models returned for this API key.";
  } catch (error) {
    box.textContent = error?.message || String(error);
  }
});

$("#saveSettings").addEventListener("click", async () => {
  settings = await window.screenPair.saveSettings({
    apiKey: $("#apiKey").value.trim(),
    endpoint: $("#endpoint").value.trim(),
    model: $("#model").value,
    customModel: $("#customModel").value.trim(),
    autoCapture: $("#autoCapture").checked,
    intervalSec: Number($("#intervalSec").value),
    templatePath: settings.templatePath || "",
    systemPrompt: $("#systemPrompt").value
  });

  stopAuto();
  if (settings.autoCapture) startAuto(false);
  closeSettings();
  setStatus("Settings saved");
});

loadSettings();
renderFiles();
renderSteps();
