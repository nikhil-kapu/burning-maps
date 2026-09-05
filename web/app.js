const COLORS = {
  ink: "#171914",
  orange: "#e85d2a",
  amber: "#d99a2b",
  red: "#c83e32",
  green: "#277455",
};

const points = {
  hub: [28.1087, 85.2967],
  camp: [28.1845, 85.361],
  bridge: [28.1415, 85.327],
  slope: [28.163, 85.344],
  closure: [28.149, 85.313],
};

const routes = {
  river: [
    points.hub,
    [28.121, 85.306],
    [28.132, 85.317],
    points.bridge,
    [28.157, 85.341],
    points.camp,
  ],
  ridge: [
    points.hub,
    [28.119, 85.286],
    [28.136, 85.296],
    [28.153, 85.309],
    [28.172, 85.333],
    points.camp,
  ],
  fallback: [
    points.hub,
    [28.116, 85.279],
    [28.142, 85.27],
    [28.17, 85.292],
    [28.191, 85.326],
    points.camp,
  ],
};

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
}).setView([28.145, 85.323], 12);

L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

function markerIcon(label, symbol, color) {
  return L.divIcon({
    className: "",
    html: `<div class="map-marker" style="--marker-color:${color}"><i>${symbol}</i><span>${label}</span></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

L.marker(points.hub, { icon: markerIcon("Dhunche hub", "□", COLORS.ink) }).addTo(map);
L.marker(points.camp, { icon: markerIcon("Relief camp A", "+", COLORS.green) }).addTo(map);
L.marker(points.bridge, { icon: markerIcon("Bridge out", "×", COLORS.red) }).addTo(map);
L.marker(points.slope, { icon: markerIcon("Slope watch", "!", COLORS.amber) }).addTo(map);

let stage = "brief";
let routeLayers = [];
let closureMarker;
let actionTimer;

const primaryAction = document.querySelector("#primary-action");
const actionLabel = primaryAction.querySelector("span");
const actionIcon = primaryAction.querySelector("i");
const actionNote = document.querySelector("#action-note");
const decisionPanel = document.querySelector("#decision-panel");
const evidencePanel = document.querySelector("#evidence-panel");
const workflow = document.querySelector("#workflow");
const stageNumber = document.querySelector("#stage-number");
const stageLabel = document.querySelector("#stage-label");
const mapAlert = document.querySelector("#map-alert");
const toast = document.querySelector("#toast");

function addRoute(coordinates, options) {
  const layer = L.polyline(coordinates, {
    color: options.color,
    weight: options.weight ?? 5,
    opacity: options.opacity ?? 1,
    dashArray: options.dashArray,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(map);
  routeLayers.push(layer);
  return layer;
}

function clearRoutes() {
  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];
}

function drawPlannedRoutes() {
  clearRoutes();
  addRoute(routes.river, { color: COLORS.red, weight: 4, dashArray: "8 7", opacity: 0.8 });
  addRoute(routes.fallback, { color: COLORS.amber, weight: 3, dashArray: "4 7", opacity: 0.75 });
  addRoute(routes.ridge, { color: stage === "planned" ? COLORS.ink : COLORS.green, weight: 6 });
  map.fitBounds(L.latLngBounds([...routes.river, ...routes.fallback]), { padding: [54, 54] });
}

function drawReroutedRoutes() {
  clearRoutes();
  addRoute(routes.river, { color: COLORS.red, weight: 3, dashArray: "8 7", opacity: 0.52 });
  addRoute(routes.ridge, { color: COLORS.red, weight: 4, dashArray: "6 7", opacity: 0.72 });
  addRoute(routes.fallback, { color: COLORS.amber, weight: 6 });
  if (!closureMarker) {
    closureMarker = L.marker(points.closure, {
      icon: markerIcon("New closure", "!", COLORS.red),
      zIndexOffset: 1000,
    }).addTo(map);
  }
  map.fitBounds(L.latLngBounds(routes.fallback), { padding: [65, 65] });
}

function setWorkflow(activeIndex) {
  document.querySelectorAll(".workflow-step").forEach((step, index) => {
    step.classList.toggle("is-active", index === activeIndex);
    step.classList.toggle("is-complete", index < activeIndex);
    const circle = step.querySelector("i");
    circle.textContent = index < activeIndex ? "✓" : String(index + 1);
  });
}

function reveal(element) {
  element.hidden = false;
  element.classList.remove("is-revealing");
  requestAnimationFrame(() => element.classList.add("is-revealing"));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function setButton({ label, icon, tone = "primary", note }) {
  actionLabel.textContent = label;
  actionIcon.textContent = icon;
  actionNote.textContent = note;
  primaryAction.classList.toggle("is-danger", tone === "danger");
  primaryAction.classList.toggle("is-success", tone === "success");
  primaryAction.disabled = false;
}

function setDecisionForFallback() {
  document.querySelector("#decision-heading").textContent = "REPLANNED ACCESS";
  document.querySelector("#selected-route-letter").textContent = "C";
  document.querySelector("#selected-route-name").textContent = "Western fallback";
  document.querySelector("#selected-route-meta").textContent = "42 km · 2 hr 08 min";
  const chip = document.querySelector("#selected-route-chip");
  chip.className = "chip chip-warn";
  chip.innerHTML = "<i></i> CONDITIONAL";
  document.querySelector("#route-reason-copy").textContent =
    "Selected after Team R–4 reported a new washout. Adds 11 km; no known blocked crossings.";
  const fill = document.querySelector("#confidence-fill");
  fill.style.width = "68%";
  fill.style.background = COLORS.amber;
  document.querySelector("#confidence-value").textContent = "68%";
  document.querySelector("#field-source").textContent = "Team R–4 · field radio";
  document.querySelector("#field-detail").textContent = "Washout at km 12 · 3 min ago";
  document.querySelector("#field-status").textContent = "NEW";
  document.querySelector("#map-clock").textContent = "UPDATED 14:44";
}

function analyze() {
  primaryAction.disabled = true;
  actionLabel.textContent = "Checking official sources…";
  actionIcon.textContent = "···";
  actionNote.textContent = "Comparing access evidence, route geometry and vehicle constraints.";
  setWorkflow(0);

  window.setTimeout(() => {
    setWorkflow(1);
    actionLabel.textContent = "Comparing three route candidates…";
  }, 520);

  actionTimer = window.setTimeout(() => {
    stage = "planned";
    stageNumber.textContent = "02 / 04";
    stageLabel.textContent = "ROUTE READY · APPROVAL REQUIRED";
    setWorkflow(2);
    reveal(decisionPanel);
    reveal(evidencePanel);
    drawPlannedRoutes();
    setButton({
      label: "Human approve & dispatch",
      icon: "✓",
      tone: "success",
      note: "The recommendation cannot dispatch a team without coordinator approval.",
    });
    showToast("3 candidates checked · 1 route rejected by access evidence");
    decisionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 1120);
}

function authorize() {
  stage = "authorized";
  stageNumber.textContent = "03 / 04";
  stageLabel.textContent = "TEAM K–2 EN ROUTE";
  setWorkflow(3);
  drawPlannedRoutes();
  setButton({
    label: "Simulate new road closure",
    icon: "!",
    tone: "danger",
    note: "Demonstrates failure recovery when new field evidence invalidates the active route.",
  });
  document.querySelector("#selected-route-chip").innerHTML = "<i></i> ACTIVE";
  showToast("Mission BM–1024 authorized by human coordinator");
}

function replan() {
  stage = "rerouted";
  stageNumber.textContent = "04 / 04";
  stageLabel.textContent = "MISSION REPLANNED · CHECK-IN DUE";
  mapAlert.hidden = false;
  setDecisionForFallback();
  drawReroutedRoutes();
  setButton({
    label: "Confirm responder check-in",
    icon: "⌁",
    tone: "success",
    note: "Fallback remains conditional until the field team confirms progress.",
  });
  showToast("Active route invalidated · fallback selected with lower confidence");
  window.setTimeout(() => {
    mapAlert.hidden = true;
  }, 5200);
}

function confirmCheckIn() {
  stage = "checkedIn";
  stageLabel.textContent = "TEAM K–2 SAFE · 14:47";
  setButton({
    label: "Restart training scenario",
    icon: "↻",
    tone: "primary",
    note: "Check-in received. Fallback route active; next scheduled check-in in 20 minutes.",
  });
  showToast("Team K–2 checked in safely · position received");
}

function reset() {
  window.clearTimeout(actionTimer);
  stage = "brief";
  stageNumber.textContent = "01 / 04";
  stageLabel.textContent = "MISSION AWAITING ANALYSIS";
  decisionPanel.hidden = true;
  evidencePanel.hidden = true;
  workflow.hidden = false;
  mapAlert.hidden = true;
  setWorkflow(0);
  clearRoutes();
  if (closureMarker) {
    map.removeLayer(closureMarker);
    closureMarker = undefined;
  }
  map.setView([28.145, 85.323], 12);
  document.querySelector("#decision-heading").textContent = "ROUTE DECISION";
  document.querySelector("#selected-route-letter").textContent = "B";
  document.querySelector("#selected-route-name").textContent = "Ridge relay";
  document.querySelector("#selected-route-meta").textContent = "31 km · 1 hr 42 min";
  const chip = document.querySelector("#selected-route-chip");
  chip.className = "chip chip-good";
  chip.innerHTML = "<i></i> RECOMMENDED";
  document.querySelector("#route-reason-copy").textContent =
    "Latest passability check is 18 minutes old. Avoids the washed river crossing and carries the required vehicle class.";
  const fill = document.querySelector("#confidence-fill");
  fill.style.width = "86%";
  fill.style.background = COLORS.green;
  document.querySelector("#confidence-value").textContent = "86%";
  document.querySelector("#field-source").textContent = "Team K–1 · field check";
  document.querySelector("#field-detail").textContent = "Ridge relay passable · 18 min ago";
  document.querySelector("#field-status").textContent = "VERIFIED";
  document.querySelector("#map-clock").textContent = "UPDATED 14:31";
  setButton({
    label: "Analyze access evidence",
    icon: "→",
    note: "Burning Maps will compare map routes against timestamped access reports.",
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

primaryAction.addEventListener("click", () => {
  if (stage === "brief") analyze();
  else if (stage === "planned") authorize();
  else if (stage === "authorized") replan();
  else if (stage === "rerouted") confirmCheckIn();
  else reset();
});

window.addEventListener("beforeunload", () => window.clearTimeout(actionTimer));
