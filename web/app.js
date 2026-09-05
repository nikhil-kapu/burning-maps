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
const maps = {};
let activeStep = 0;
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
    L.polyline(directRoute, { color: "#858981", weight: 4, opacity: 0.38, dashArray: "6 8" }).addTo(map);
    L.polyline(route, { color: "#b64d32", weight: 6, opacity: 0.96, lineCap: "round" }).addTo(map);
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
  const map = maps[id.replace("-screen", "-map")];
  if (map) setTimeout(() => map.invalidateSize(), 60);
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
  map.eachLayer((layer) => {
    if (layer instanceof L.Polyline) map.removeLayer(layer);
  });
  L.polyline(route, { color: "#b64d32", weight: 7, opacity: 0.96, lineCap: "round" }).addTo(map);
  map.fitBounds(L.latLngBounds(route), { paddingTopLeft: [44, 145], paddingBottomRight: [44, 260] });
}

document.querySelector("#begin-mission").addEventListener("click", () => {
  showScreen("draft-screen");
  setTimeout(() => maps["draft-map"].fitBounds(L.latLngBounds([points.hub, points.camp]), { padding: [60, 45] }), 100);
});

document.querySelectorAll(".quick-prompts button").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#begin-mission").click());
});

document.querySelector("#build-route").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.querySelector("span").textContent = "Comparing field evidence…";
  setTimeout(() => {
    button.querySelector("span").textContent = "Build relief route";
    showScreen("route-screen");
    maps["route-map"].invalidateSize();
    showToast("3 access options compared · latest field evidence attached");
  }, 700);
});

document.querySelector("#route-back").addEventListener("click", () => showScreen("draft-screen"));
document.querySelector("#active-back").addEventListener("click", () => showScreen("route-screen"));

document.querySelector("#start-route").addEventListener("click", () => {
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
  L.marker(points.closure, { icon: marker("New closure", "#c94738", "!") }).addTo(maps["active-map"]);
  setTimeout(() => {
    replaceActiveRoute(updatedRoute);
    update.querySelector("strong").textContent = "Safer access route found";
    update.querySelector("p").textContent = "Adds 14 min · avoids new slope failure";
    document.querySelector("#active-kicker").textContent = "ROUTE UPDATED";
    document.querySelector("#active-title").textContent = "Continue via western ridge";
    document.querySelector("#active-distance").textContent = "34 km remaining · +14 min";
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
