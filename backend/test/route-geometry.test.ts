import assert from "node:assert/strict";
import test from "node:test";
import { decodeRoutePolyline, distanceMeters, encodeRoutePolyline } from "../src/services/route-geometry.js";

test("route geometry uses a compact polyline that round trips coordinates", () => {
  const coordinates = [
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ];
  const encoded = encodeRoutePolyline(coordinates);
  assert.equal(encoded, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(decodeRoutePolyline(encoded), coordinates);
});

test("route geometry rejects malformed or excessive input", () => {
  assert.throws(() => decodeRoutePolyline("not a polyline"));
  const repeated = Array.from({ length: 5 }, (_, index) => ({ latitude: 37 + index * 0.01, longitude: -122 }));
  assert.throws(() => decodeRoutePolyline(encodeRoutePolyline(repeated), 4), /too many points/);
});

test("route geometry distance supports destination and waypoint validation", () => {
  const meters = distanceMeters({ latitude: 37.7749, longitude: -122.4194 }, { latitude: 37.8044, longitude: -122.2712 });
  assert.ok(meters > 12_000 && meters < 15_000);
});
