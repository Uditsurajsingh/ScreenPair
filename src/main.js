import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Store from "electron-store";
import screenshot from "screenshot-desktop";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import PizZip from "pizzip";
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  ImageRun, PageBreak, AlignmentType
} from "docx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({
  name: "screenpair-settings",
  defaults: {
    apiKey: "",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5-mini",
    customModel: "",
    autoCapture: false,
    intervalSec: 60,
    templatePath: "",
    systemPrompt:
      "You are a senior software engineer acting as a precise pair programmer. " +
      "Study the screenshot, objective, prior step, and background context. " +
      "Identify the current state and give the next concrete action. " +
      "Prefer exact commands, filenames, code changes, verification steps, and warnings. " +
      "Do not claim to have executed anything. Return valid JSON only."
  }
});

let win;
let sessionSteps = [];
let backgroundFiles = [];

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "ScreenPair", submenu: [{ role: "quit" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggledevtools" }] }
  ]));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!value) return "https://api.openai.com/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

function modelsEndpoint(chatEndpoint) {
  const normalized = normalizeEndpoint(chatEndpoint);
  if (normalized.endsWith("/chat/completions")) {
    return normalized.slice(0, -"/chat/completions".length) + "/models";
  }
  return "https://api.openai.com/v1/models";
}

function extractMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === "string" ? part : (part?.text || part?.content || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const firstObj = cleaned.indexOf("{");
  const lastObj = cleaned.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    return JSON.parse(cleaned.slice(firstObj, lastObj + 1));
  }
  throw new Error("The model response was not valid JSON.");
}

function normalizeResult(raw) {
  return {
    state: String(raw?.state || raw?.summary || "Current state assessed."),
    next_action: String(raw?.next_action || raw?.nextStep || "Review the screenshot and continue manually."),
    details: Array.isArray(raw?.details)
      ? raw.details.map(String)
      : (Array.isArray(raw?.next_steps)
          ? raw.next_steps.map(x => typeof x === "string" ? x : `${x?.title || "Step"}: ${x?.detail || ""}`)
          : []),
    commands: Array.isArray(raw?.commands) ? raw.commands.map(String) : [],
    verification: Array.isArray(raw?.verification) ? raw.verification.map(String) : [],
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String) : []
  };
}

async function callChatApi({ objective, dataUrl, previousStep }) {
  const settings = store.store;
  const apiKey = String(settings.apiKey || "").trim();
  if (!apiKey) throw new Error("API key is missing. Open Settings and enter it.");

  const selectedModel =
    settings.model === "__custom__"
      ? String(settings.customModel || "").trim()
      : String(settings.model || "").trim();
  if (!selectedModel) throw new Error("Model ID is missing.");

  const context = backgroundFiles.length
    ? backgroundFiles.map(f => `--- ${f.name} ---\n${f.text}`).join("\n\n")
    : "(No background files attached.)";

  const previous = previousStep
    ? JSON.stringify(previousStep.result, null, 2)
    : "(This is the first step.)";

  const userText = [
    `OBJECTIVE:\n${objective || "(No objective provided.)"}`,
    `PREVIOUS ASSISTANT STEP:\n${previous}`,
    `BACKGROUND FILES:\n${context}`,
    "Analyze the screenshot and return exactly one JSON object with this shape:",
    JSON.stringify({
      state: "short description of what is visible/current status",
      next_action: "the single most important action to perform next",
      details: ["ordered implementation detail"],
      commands: ["exact command if relevant"],
      verification: ["how to verify success"],
      warnings: ["risk, blocker, or uncertainty"]
    }, null, 2)
  ].join("\n\n");

  const messages = [
    { role: "system", content: settings.systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
      ]
    }
  ];

  const baseBody = {
    model: selectedModel,
    messages
  };

  const endpoint = normalizeEndpoint(settings.endpoint);
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...baseBody,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const firstError = await response.text();
    const canRetry =
      response.status === 400 &&
      /response_format|json_object|unsupported/i.test(firstError);

    if (!canRetry) {
      throw new Error(`API error ${response.status}: ${firstError.slice(0, 1200)}`);
    }

    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(baseBody)
    });

    if (!response.ok) {
      const retryError = await response.text();
      throw new Error(`API error ${response.status}: ${retryError.slice(0, 1200)}`);
    }
  }

  const payload = await response.json();
  const text = extractMessageText(payload?.choices?.[0]?.message);
  if (!text) throw new Error("The API returned no assistant message.");
  return normalizeResult(extractJson(text));
}

async function extractBackgroundFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  let text = "";

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else if (ext === ".pdf") {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const result = await parser.getText();
    await parser.destroy();
    text = result.text;
  } else {
    text = fs.readFileSync(filePath, "utf8");
  }

  const maxChars = 80000;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n\n[File truncated by ScreenPair]";
  }
  return { path: filePath, name, text };
}

function dataUrlToBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).split(",")[1], "base64");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlParagraph(text, bold = false, size = 22) {
  const safe = xmlEscape(text);
  return `<w:p><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function imageDrawingXml(relId, docPrId, cx = 5486400, cy = 3086100) {
  return `
<w:p>
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
      <wp:extent cx="${cx}" cy="${cy}"/>
      <wp:docPr id="${docPrId}" name="Screenshot ${docPrId}"/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr><pic:cNvPr id="0" name="screenshot.png"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r>
</w:p>`;
}

async function exportWithTemplate(templatePath, outPath) {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Invalid DOCX template: word/document.xml is missing.");

  let documentXml = documentFile.asText();
  const relsPath = "word/_rels/document.xml.rels";
  let relsXml = zip.file(relsPath)?.asText() ||
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const relIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]));
  let nextRel = (relIds.length ? Math.max(...relIds) : 0) + 1;

  let reportXml = xmlParagraph("ScreenPair Session Report", true, 34);
  reportXml += xmlParagraph(`Exported: ${new Date().toLocaleString()}`, false, 20);
  reportXml += xmlParagraph(`Objective: ${sessionSteps[0]?.objective || ""}`, false, 22);

  sessionSteps.forEach((step, index) => {
    const imageName = `screenpair-step-${index + 1}.png`;
    const relId = `rId${nextRel++}`;
    zip.file(`word/media/${imageName}`, dataUrlToBuffer(step.imageDataUrl), { binary: true });

    relsXml = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imageName}"/></Relationships>`
    );

    reportXml += xmlParagraph(`Step ${step.idx} — ${step.timestamp}`, true, 28);
    reportXml += xmlParagraph(`State: ${step.result.state}`, true, 22);
    reportXml += xmlParagraph(`Next action: ${step.result.next_action}`, true, 22);
    for (const item of step.result.details || []) reportXml += xmlParagraph(`• ${item}`);
    for (const command of step.result.commands || []) reportXml += xmlParagraph(`Command: ${command}`);
    for (const verify of step.result.verification || []) reportXml += xmlParagraph(`Verify: ${verify}`);
    for (const warning of step.result.warnings || []) reportXml += xmlParagraph(`Warning: ${warning}`);
    reportXml += imageDrawingXml(relId, 2000 + index);
  });

  const sectPrMatch = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  if (sectPrMatch) {
    documentXml = documentXml.replace(sectPrMatch[0], `${reportXml}${sectPrMatch[0]}`);
  } else {
    documentXml = documentXml.replace("</w:body>", `${reportXml}</w:body>`);
  }

  zip.file("word/document.xml", documentXml);
  zip.file(relsPath, relsXml);

  const contentTypesPath = "[Content_Types].xml";
  let contentTypes = zip.file(contentTypesPath)?.asText();
  if (contentTypes && !/Extension="png"/i.test(contentTypes)) {
    contentTypes = contentTypes.replace(
      "</Types>",
      `<Default Extension="png" ContentType="image/png"/></Types>`
    );
    zip.file(contentTypesPath, contentTypes);
  }

  fs.writeFileSync(outPath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function exportDefault(outPath) {
  const children = [
    new Paragraph({ text: "ScreenPair Session Report", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `Exported: ${new Date().toLocaleString()}` }),
    new Paragraph({
      children: [
        new TextRun({ text: "Objective: ", bold: true }),
        new TextRun(sessionSteps[0]?.objective || "")
      ]
    })
  ];

  for (const step of sessionSteps) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      text: `Step ${step.idx} — ${step.timestamp}`,
      heading: HeadingLevel.HEADING_1
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "State: ", bold: true }),
        new TextRun(step.result.state)
      ]
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "Next action: ", bold: true }),
        new TextRun(step.result.next_action)
      ]
    }));

    for (const item of step.result.details || []) {
      children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
    }
    for (const command of step.result.commands || []) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `Command: ${command}`, font: "Consolas" })]
      }));
    }
    for (const verify of step.result.verification || []) {
      children.push(new Paragraph({ text: `Verify: ${verify}` }));
    }
    for (const warning of step.result.warnings || []) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "Warning: ", bold: true }),
          new TextRun(warning)
        ]
      }));
    }

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: dataUrlToBuffer(step.imageDataUrl),
          transformation: { width: 640, height: 360 },
          type: "png"
        })
      ]
    }));
  }

  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
}

ipcMain.handle("settings:get", () => store.store);

ipcMain.handle("settings:save", (_event, settings) => {
  const safe = {
    apiKey: String(settings.apiKey || ""),
    endpoint: normalizeEndpoint(settings.endpoint),
    model: String(settings.model || "gpt-5-mini"),
    customModel: String(settings.customModel || ""),
    autoCapture: Boolean(settings.autoCapture),
    intervalSec: Math.max(15, Number(settings.intervalSec) || 60),
    templatePath: String(settings.templatePath || ""),
    systemPrompt: String(settings.systemPrompt || store.get("systemPrompt"))
  };
  store.set(safe);
  return store.store;
});

ipcMain.handle("models:list", async () => {
  const settings = store.store;
  if (!settings.apiKey) throw new Error("Enter and save the API key first.");
  const response = await fetch(modelsEndpoint(settings.endpoint), {
    headers: { Authorization: `Bearer ${settings.apiKey}` }
  });
  if (!response.ok) throw new Error(`Model-list error ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  const data = await response.json();
  return (data.data || []).map(m => m.id).filter(Boolean).sort();
});

ipcMain.handle("template:choose", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Choose Word template",
    properties: ["openFile"],
    filters: [{ name: "Word document", extensions: ["docx"] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  store.set("templatePath", result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle("background:add", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Add background files",
    properties: ["openFile", "multiSelections"],
    filters: [{
      name: "Supported files",
      extensions: [
        "txt","md","json","csv","log","xml","yaml","yml","py","js","ts","tsx",
        "jsx","html","css","sql","docx","pdf"
      ]
    }]
  });
  if (result.canceled) return backgroundFiles.map(({ name, path }) => ({ name, path }));

  const added = [];
  for (const filePath of result.filePaths) {
    try {
      added.push(await extractBackgroundFile(filePath));
    } catch (error) {
      throw new Error(`Could not read ${path.basename(filePath)}: ${error.message}`);
    }
  }
  const byPath = new Map(backgroundFiles.map(f => [f.path, f]));
  for (const item of added) byPath.set(item.path, item);
  backgroundFiles = [...byPath.values()];
  return backgroundFiles.map(({ name, path }) => ({ name, path }));
});

ipcMain.handle("background:clear", () => {
  backgroundFiles = [];
  return [];
});

ipcMain.handle("capture", async () => {
  const img = await screenshot({ format: "png" });
  return `data:image/png;base64,${img.toString("base64")}`;
});

ipcMain.handle("analyze", async (_event, payload) => {
  return await callChatApi({
    objective: String(payload.objective || ""),
    dataUrl: payload.dataUrl,
    previousStep: sessionSteps.at(-1) || null
  });
});

ipcMain.handle("session:add", (_event, payload) => {
  const step = {
    idx: sessionSteps.length + 1,
    timestamp: new Date().toLocaleString(),
    objective: String(payload.objective || ""),
    imageDataUrl: payload.imageDataUrl,
    result: payload.result
  };
  sessionSteps.push(step);
  return { count: sessionSteps.length, step };
});

ipcMain.handle("session:list", () =>
  sessionSteps.map(s => ({
    idx: s.idx,
    timestamp: s.timestamp,
    objective: s.objective,
    result: s.result
  }))
);

ipcMain.handle("session:clear", () => {
  sessionSteps = [];
  return { count: 0 };
});

ipcMain.handle("report:export", async () => {
  if (!sessionSteps.length) throw new Error("No completed steps are available to export.");
  const result = await dialog.showSaveDialog(win, {
    title: "Export ScreenPair report",
    defaultPath: path.join(
      app.getPath("documents"),
      `ScreenPair-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.docx`
    ),
    filters: [{ name: "Word document", extensions: ["docx"] }]
  });
  if (result.canceled || !result.filePath) return null;

  const templatePath = store.get("templatePath");
  if (templatePath && fs.existsSync(templatePath)) {
    await exportWithTemplate(templatePath, result.filePath);
  } else {
    await exportDefault(result.filePath);
  }
  return { path: result.filePath, count: sessionSteps.length };
});

ipcMain.handle("path:open", async (_event, filePath) => {
  if (filePath) await shell.showPathInFolder(filePath);
});
