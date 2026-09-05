const points = {
  hub: [28.1054, 85.3006],
  junction: [28.1368, 85.3133],
  ridge: [28.169, 85.326],
  camp: [28.1985, 85.3443],
  bridge: [28.148, 85.338],
  closure: [28.158, 85.331],
};

const directRoute = [points.hub, [28.124, 85.315], points.bridge, [28.175, 85.341], points.camp];
const safeRoute = [points.hub, points.junction, [28.151, 85.302], points.ridge, [28.185, 85.331], points.camp];
const updatedRoute = [points.hub, [28.123, 85.295], [28.154, 85.289], [28.178, 85.311], points.camp];
const emergencyRoute = [points.hub, [28.121, 85.282], [28.153, 85.274], [28.184, 85.298], points.camp];
const maps = {};
const mapRoutes = {};
const routeLines = {};
const hazardLayers = {};
const routeOptions = [
  {
    key: "safe", route: safeRoute, label: "Safer access", badge: "TOP PICK", time: "1 hr 42 min",
    summary: "Recently verified ridge access · avoids failed bridge", meta: "1 OF 3 · EVIDENCE RANKED", blocked: false,
    access: "Ridge relay · 31 km", confidence: "Confidence 86%",
    evidence: "The shorter river route crosses a bridge reported impassable by two sources. Ridge access was field-checked 18 minutes ago.",
  },
  {
    key: "direct", route: directRoute, label: "River shortcut", badge: "BLOCKED", time: "1 hr 08 min",
    summary: "Fastest, but bridge reported impassable", meta: "2 OF 3 · REJECTED", blocked: true,
    access: "River crossing · 24 km", confidence: "Closure confidence 94%",
    evidence: "Rejected: the route intersects a bridge reported impassable by both IOM context and the latest field observation.",
  },
  {
    key: "fallback", route: updatedRoute, label: "Western fallback", badge: "AVAILABLE", time: "1 hr 56 min",
    summary: "Longer access · latest report is 2 hours old", meta: "3 OF 3 · CONDITIONAL", blocked: false,
    access: "Western access · 36 km", confidence: "Confidence 61%",
    evidence: "Available as a conditional fallback. It avoids the failed bridge, but its field evidence is older, so confidence is lower.",
  },
];
let activeStep = 0;
let selectedRouteIndex = 0;
let closureMarker;
let toastTimer;

function marker(label, color, glyph = "•") {
  return L.divIcon({
    className: "",
    html: `<div class="map-marker" style="--marker:${color}"><i>${glyph}</i><span>${label}</span></div>`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

function addTiles(map) {
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

function initMap(id, route = null, interactive = false) {
  const map = L.map(id, {
    zoomControl: false,
    attributionControl: true,
    dragging: interactive,
    touchZoom: interactive,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    keyboard: false,
  });
  addTiles(map);
  map.setView([28.153, 85.321], 12);
  if (route) {
    mapRoutes[id] = route;
    const directLine = L.polyline(directRoute, { color: "#858981", weight: 4, opacity: 0.38, dashArray: "6 8" }).addTo(map);
    const safeLine = L.polyline(route, { color: "#b64d32", weight: 6, opacity: 0.96, lineCap: "round" }).addTo(map);
    const fallbackLine = id === "route-map"
      ? L.polyline(updatedRoute, { color: "#858981", weight: 4, opacity: 0.3, dashArray: "3 8" }).addTo(map)
      : undefined;
    routeLines[id] = { direct: directLine, safe: safeLine, fallback: fallbackLine };
    L.marker(points.hub, { icon: marker("Dhunche hub", "#1d1e1a", "○") }).addTo(map);
    L.marker(points.camp, { icon: marker("Relief Camp A", "#b64d32", "✚") }).addTo(map);
    L.marker(points.bridge, { icon: marker("Bridge blocked", "#c94738", "!") }).addTo(map);
    map.fitBounds(L.latLngBounds(route), { padding: [34, 34] });
  } else {
    L.marker(points.hub, { icon: marker("Dhunche hub", "#1d1e1a", "○") }).addTo(map);
    L.marker(points.camp, { icon: marker("Relief Camp A", "#b64d32", "✚") }).addTo(map);
  }
  maps[id] = map;
  setTimeout(() => map.invalidateSize(), 80);
  return map;
}

function showScreen(id) {
  document.querySelectorAll(".app-screen").forEach((screen) => screen.classList.toggle("is-active", screen.id === id));
  const mapId = id.replace("-screen", "-map");
  const map = maps[mapId];
  if (map) setTimeout(() => {
    map.invalidateSize();
    if (mapRoutes[mapId]) {
      const bottomPadding = mapId === "route-map" ? 125 : mapId === "active-map" ? 265 : 80;
      map.fitBounds(L.latLngBounds(mapRoutes[mapId]), {
        animate: false,
        paddingTopLeft: [35, 55],
        paddingBottomRight: [35, bottomPadding],
      });
    }
  }, 100);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function replaceActiveRoute(route) {
  const map = maps["active-map"];
  mapRoutes["active-map"] = route;
  map.eachLayer((layer) => {
    if (layer instanceof L.Polyline) map.removeLayer(layer);
  });
  L.polyline(route, { color: "#b64d32", weight: 7, opacity: 0.96, lineCap: "round" }).addTo(map);
  map.fitBounds(L.latLngBounds(route), { paddingTopLeft: [44, 145], paddingBottomRight: [44, 260] });
}

function selectRoute(index) {
  selectedRouteIndex = index % routeOptions.length;
  const option = routeOptions[selectedRouteIndex];
  document.querySelector("#route-label").textContent = option.label;
  document.querySelector("#route-badge").textContent = option.badge;
  document.querySelector("#route-time").textContent = option.time;
  document.querySelector("#route-summary").textContent = option.summary;
  document.querySelector("#route-meta").textContent = option.meta;
  document.querySelector("#evidence-copy").textContent = option.evidence;
  document.querySelector("#selected-access").textContent = option.access;
  document.querySelector("#route-confidence").textContent = option.confidence;
  document.querySelector("#route-card").classList.toggle("is-blocked", option.blocked);
  const startButton = document.querySelector("#start-route");
  startButton.disabled = option.blocked;
  startButton.querySelector("span").textContent = option.blocked ? "Blocked route cannot start" : "Start selected route";
  Object.entries(routeLines["route-map"] ?? {}).forEach(([key, line]) => {
    if (!line) return;
    const selected = key === option.key;
    line.setStyle({
      color: selected ? (option.blocked ? "#c94738" : "#b64d32") : "#858981",
      weight: selected ? 7 : 4,
      opacity: selected ? 0.96 : 0.28,
      dashArray: selected && !option.blocked ? null : "6 8",
    });
    if (selected) line.bringToFront();
  });
  mapRoutes["route-map"] = option.route;
  maps["route-map"].fitBounds(L.latLngBounds(option.route), {
    animate: false,
    paddingTopLeft: [35, 55],
    paddingBottomRight: [35, 125],
  });
}

function resetActiveMission() {
  activeStep = 0;
  const option = routeOptions[selectedRouteIndex];
  const update = document.querySelector("#route-update");
  update.hidden = true;
  update.querySelector("strong").textContent = "New closure reported ahead";
  update.querySelector("p").textContent = "Replanning from verified field evidence…";
  const actionButton = document.querySelector("#active-action");
  actionButton.hidden = false;
  actionButton.disabled = false;
  actionButton.querySelector("span").textContent = "Simulate access change";
  const checkInButton = document.querySelector("#check-in");
  checkInButton.hidden = true;
  checkInButton.disabled = false;
  checkInButton.textContent = "Check in now";
  document.querySelector("#check-time").textContent = "18 minutes";
  document.querySelector("#active-status").innerHTML = "<i></i> AGENT LIVE";
  document.querySelector("#active-kicker").textContent = "MISSION ACTIVE";
  document.querySelector("#active-title").textContent = option.key === "fallback" ? "Continue on western access" : "Continue on ridge access";
  document.querySelector("#active-distance").textContent = option.key === "fallback" ? "36 km remaining" : "31 km remaining";
  document.querySelector("#active-copy").textContent = "Monitoring access reports and your next safety check-in.";
  if (closureMarker) {
    maps["active-map"].removeLayer(closureMarker);
    closureMarker = undefined;
  }
  replaceActiveRoute(option.route);
}

document.querySelector("#begin-mission").addEventListener("click", () => {
  showScreen("draft-screen");
  setTimeout(() => maps["draft-map"].fitBounds(L.latLngBounds([points.hub, points.camp]), { padding: [60, 45] }), 100);
});

document.querySelector("#home-search").addEventListener("click", () => document.querySelector("#begin-mission").click());
document.querySelectorAll(".quick-prompts button").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#begin-mission").click());
});
document.querySelector("#change-destination").addEventListener("click", () => showScreen("home-screen"));
document.querySelector("#cancel-draft").addEventListener("click", () => showScreen("home-screen"));
document.querySelector("#toggle-options").addEventListener("click", (event) => {
  const options = document.querySelector("#trip-options");
  options.hidden = !options.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!options.hidden));
  event.currentTarget.innerHTML = options.hidden ? "Timing, check-ins &amp; team options&nbsp; ›" : "Hide mission options&nbsp; ⌃";
});

document.querySelectorAll(".layer-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const mapId = button.dataset.map;
    const map = maps[mapId];
    if (!hazardLayers[mapId]) {
      hazardLayers[mapId] = L.layerGroup([
        L.circle(points.bridge, { radius: 850, color: "#c94738", fillColor: "#c94738", fillOpacity: 0.13, weight: 2 }),
        L.circle(points.ridge, { radius: 700, color: "#277a55", fillColor: "#277a55", fillOpacity: 0.1, weight: 2 }),
      ]);
    }
    const enabled = !map.hasLayer(hazardLayers[mapId]);
    if (enabled) hazardLayers[mapId].addTo(map);
    else map.removeLayer(hazardLayers[mapId]);
    button.setAttribute("aria-pressed", String(enabled));
    showToast(enabled ? "Relief access overlay shown" : "Relief access overlay hidden");
  });
});

document.querySelectorAll(".recenter-map").forEach((button) => {
  button.addEventListener("click", () => {
    const mapId = button.dataset.map;
    const route = mapRoutes[mapId];
    maps[mapId].fitBounds(L.latLngBounds(route ?? [points.hub, points.camp]), { animate: true, padding: [55, 45] });
    showToast("Mission area centered");
  });
});

document.querySelector("#build-route").addEventListener("click", (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  button.querySelector("span").textContent = "Comparing field evidence…";
  setTimeout(() => {
    button.disabled = false;
    button.querySelector("span").textContent = "Build relief route";
    showScreen("route-screen");
    maps["route-map"].invalidateSize();
    showToast("3 access options compared · latest field evidence attached");
  }, 700);
});

document.querySelector("#route-back").addEventListener("click", () => showScreen("draft-screen"));
document.querySelector("#active-back").addEventListener("click", () => showScreen("route-screen"));
document.querySelector("#next-route").addEventListener("click", () => selectRoute(selectedRouteIndex + 1));

document.querySelector("#start-route").addEventListener("click", () => {
  resetActiveMission();
  showScreen("active-screen");
  maps["active-map"].invalidateSize();
  showToast("Mission started · team check-ins are active");
});

document.querySelector("#active-action").addEventListener("click", (event) => {
  if (activeStep > 0) return;
  activeStep = 1;
  const button = event.currentTarget;
  const update = document.querySelector("#route-update");
  update.hidden = false;
  button.querySelector("span").textContent = "Replanning…";
  button.disabled = true;
  const startedOnFallback = routeOptions[selectedRouteIndex].key === "fallback";
  const closurePoint = startedOnFallback ? updatedRoute[2] : points.closure;
  const replacementRoute = startedOnFallback ? emergencyRoute : updatedRoute;
  closureMarker = L.marker(closurePoint, { icon: marker("New closure", "#c94738", "!") }).addTo(maps["active-map"]);
  setTimeout(() => {
    replaceActiveRoute(replacementRoute);
    update.querySelector("strong").textContent = "Safer access route found";
    update.querySelector("p").textContent = startedOnFallback ? "Adds 22 min · uses emergency west access" : "Adds 14 min · avoids new slope failure";
    document.querySelector("#active-kicker").textContent = "ROUTE UPDATED";
    document.querySelector("#active-title").textContent = startedOnFallback ? "Continue via emergency west access" : "Continue via western ridge";
    document.querySelector("#active-distance").textContent = startedOnFallback ? "41 km remaining · +22 min" : "34 km remaining · +14 min";
    document.querySelector("#active-copy").textContent = "Route changed from a verified field report. Review and check in with your team.";
    button.hidden = true;
    document.querySelector("#check-in").hidden = false;
    showToast("Route updated · human dispatch control preserved");
  }, 1300);
});

document.querySelector("#check-in").addEventListener("click", (event) => {
  event.currentTarget.textContent = "✓ Team checked in";
  event.currentTarget.disabled = true;
  document.querySelector("#check-time").textContent = "Checked in just now";
  document.querySelector("#active-status").innerHTML = "<i></i> TEAM SAFE";
  showToast("Check-in recorded · next reminder in 20 minutes");
});

initMap("home-map");
initMap("draft-map", safeRoute);
initMap("route-map", safeRoute);
initMap("active-map", safeRoute);
selectRoute(0);
