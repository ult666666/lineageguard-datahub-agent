const form = document.querySelector("#review-form");
const loadDemo = document.querySelector("#load-demo");
const analyzeButton = document.querySelector("#analyze");
const datasetUrn = document.querySelector("#dataset-urn");
const changeRequest = document.querySelector("#change-request");
const emptyState = document.querySelector("#empty-state");
const results = document.querySelector("#results");

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

async function loadExample() {
  const response = await fetch("/api/demo");
  const demo = await response.json();
  datasetUrn.value = demo.datasetUrn;
  changeRequest.value = JSON.stringify(demo.changeRequest, null, 2);
}

function render(result) {
  emptyState.hidden = true;
  results.hidden = false;
  setText("#decision", result.decision.replaceAll("-", " ").toUpperCase());
  setText("#score", result.score);
  document.querySelector("#score").dataset.severity = result.severity;
  setText("#severity", result.severity.toUpperCase());
  setText("#asset-count", result.impactedAssets.length);
  setText("#owner-count", result.ownerNotifications.length);
  document.querySelector("#reasons").innerHTML = result.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
  document.querySelector("#assets").innerHTML = result.impactedAssets.map((asset) => `<article><div><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.type)}</span></div><p>${escapeHtml(asset.owner || "Owner missing")}</p></article>`).join("");
  setText("#sql", result.migrationSql);
  setText("#pr", result.prMarkdown);
  document.querySelector("#trace").innerHTML = result.trace.map((step) => `<article><span class="dot ${step.status}"></span><div><strong>${escapeHtml(step.step)}</strong><p>${escapeHtml(step.detail)}</p></div></article>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  analyzeButton.disabled = true;
  analyzeButton.textContent = "Reading DataHub context…";
  try {
    const response = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ datasetUrn: datasetUrn.value.trim(), changeRequest: JSON.parse(changeRequest.value) }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Analysis failed");
    render(body);
  } catch (error) {
    alert(error.message);
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = "Analyze with LineageGuard";
  }
});

loadDemo.addEventListener("click", loadExample);

fetch("/api/health").then((response) => response.json()).then((health) => {
  setText("#mode", health.mode === "live-datahub-mcp" ? "LIVE DATAHUB MCP" : "DEMO SNAPSHOT");
});

await loadExample();
