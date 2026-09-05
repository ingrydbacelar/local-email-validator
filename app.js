(() => {
  const inputEl = document.getElementById("email-input");
  const validateBtn = document.getElementById("validate-btn");
  const validateBtnLabel = document.getElementById("validate-btn-label");
  const emailCountEl = document.getElementById("email-count");
  const progressWrap = document.getElementById("progress-wrap");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  const errorBox = document.getElementById("error-box");
  const resultsSection = document.getElementById("results-section");
  const resultsBody = document.getElementById("results-body");
  const resultsSummary = document.getElementById("results-summary");
  const downloadBtn = document.getElementById("download-btn");

  let socket = null;
  let allResults = []; 

  // Atualiza o contador de e-mails detectados enquanto o usuário digita/cola.
  inputEl.addEventListener("input", updateEmailCountPreview);

  function updateEmailCountPreview() {
    const count = countLikelyEmails(inputEl.value);
    emailCountEl.textContent = count > 0 ? `${count} e-mail(s) detectado(s)` : "";
  }

  // Contagem simples no cliente, só para feedback imediato. A extração
  // acontece no backend.
  function countLikelyEmails(text) {
    const matches = text.match(/[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (!matches) return 0;
    return new Set(matches.map((m) => m.toLowerCase())).size;
  }

  validateBtn.addEventListener("click", startValidation);
  downloadBtn.addEventListener("click", downloadResultsAsCsv);

  function startValidation() {
    const text = inputEl.value.trim();
    resetUI();

    if (!text) {
      showError("Cole ao menos um e-mail antes de validar.");
      return;
    }

    setValidating(true);

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/validate`;

    socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ text }));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      handleServerMessage(message);
    });

    socket.addEventListener("error", () => {
      showError("Não foi possível conectar ao servidor local. Verifique se o backend está rodando (python run.py).");
      setValidating(false);
    });

    socket.addEventListener("close", () => {
      setValidating(false);
    });
  }

  function handleServerMessage(message) {
    switch (message.type) {
      case "start":
        onStart(message.total);
        break;
      case "result":
        onResult(message);
        break;
      case "done":
        onDone();
        break;
      case "error":
        showError(message.message);
        setValidating(false);
        break;
      default:
        break;
    }
  }

  const counts = { deliverable: 0, riskyHigh: 0, riskyLow: 0, undeliverable: 0, unknown: 0 };

  function onStart(total) {
    resultsSection.hidden = false;
    progressWrap.hidden = false;
    progressLabel.textContent = `0 / ${total}`;
    progressFill.style.width = "0%";
    counts.deliverable = 0;
    counts.riskyHigh = 0;
    counts.riskyLow = 0;
    counts.undeliverable = 0;
    counts.unknown = 0;
    allResults = [];
    downloadBtn.hidden = true;
    updateSummary();
  }

  function onResult(message) {
    addResultRow(message.email, message.verdict_label, message.reason);
    allResults.push({
      email: message.email,
      verdictLabel: message.verdict_label,
      reason: message.reason,
    });

    const percent = Math.round((message.index / message.total) * 100);
    progressFill.style.width = `${percent}%`;
    progressLabel.textContent = `${message.index} / ${message.total}`;

    switch (message.verdict_label) {
      case "Deliverable":
        counts.deliverable += 1;
        break;
      case "Risky \u2265 60%":
        counts.riskyHigh += 1;
        break;
      case "Risky < 60%":
        counts.riskyLow += 1;
        break;
      case "Undeliverable / Invalid":
        counts.undeliverable += 1;
        break;
      default:
        counts.unknown += 1;
        break;
    }
    updateSummary();
  }

  function onDone() {
    setValidating(false);
    validateBtnLabel.textContent = "VALIDAR E-MAILS";
    if (allResults.length > 0) {
      downloadBtn.hidden = false;
    }
  }

  function downloadResultsAsCsv() {
    if (allResults.length === 0) return;

    const header = ["E-MAIL", "RESULTADO", "MOTIVO"];
    const rows = allResults.map((r) => [r.email, r.verdictLabel, r.reason]);

    const csvLines = [header, ...rows].map((row) =>
      row.map(escapeCsvField).join(";")
    );
    const csvContent = csvLines.join("\r\n");

    // BOM UTF-8 no início garante que o Excel abra acentos e emojis
    // corretamente em vez de exibir caracteres corrompidos.
    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildDownloadFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function escapeCsvField(value) {
    const stringValue = String(value ?? "");
    // Usamos ";" como separador (padrão do Excel em configurações
    // regionais pt-BR), então só precisamos escapar aspas e quebras
    // de linha dentro do próprio campo.
    if (/[";\n\r]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  function buildDownloadFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `validacao-emails_${stamp}.csv`;
  }

  function addResultRow(email, verdictLabel, reason) {
    const row = document.createElement("tr");

    const emailCell = document.createElement("td");
    emailCell.className = "cell-email";
    emailCell.textContent = email;

    const verdictCell = document.createElement("td");
    verdictCell.className = "cell-verdict";
    verdictCell.textContent = verdictLabel;
    verdictCell.dataset.verdict = verdictLabel;

    const reasonCell = document.createElement("td");
    reasonCell.className = "cell-reason";
    reasonCell.textContent = reason;

    row.append(emailCell, verdictCell, reasonCell);
    resultsBody.appendChild(row);
  }

  function updateSummary() {
    resultsSummary.innerHTML = "";
    const parts = [
      { label: `Deliverable: ${counts.deliverable}`, cls: "count-deliverable" },
      { label: `Risky \u226560%: ${counts.riskyHigh}`, cls: "count-risky-high" },
      { label: `Risky <60%: ${counts.riskyLow}`, cls: "count-risky-low" },
      { label: `Undeliverable: ${counts.undeliverable}`, cls: "count-undeliverable" },
      { label: `Unknown: ${counts.unknown}`, cls: "count-unknown" },
    ];
    for (const part of parts) {
      const span = document.createElement("span");
      span.className = part.cls;
      span.textContent = part.label;
      resultsSummary.appendChild(span);
    }
  }

  function setValidating(isValidating) {
    validateBtn.disabled = isValidating;
    validateBtnLabel.textContent = isValidating ? "VALIDANDO..." : "VALIDAR E-MAILS";
  }

  function resetUI() {
    hideError();
    resultsBody.innerHTML = "";
    resultsSummary.innerHTML = "";
    resultsSection.hidden = true;
    progressWrap.hidden = true;
    progressFill.style.width = "0%";
    downloadBtn.hidden = true;
    allResults = [];
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
})();
