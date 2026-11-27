import { calculateDistanceMeters } from "./hospital";

export interface QuickWaypoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  createdAt: string;
}

/**
 * Formats elapsed seconds into Geo Tracker-style HH:MM:SS clock.
 */
export function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

/**
 * Perpendicular distance in meters from point P to segment AB using local tangent-plane projection.
 */
function perpendicularDistanceMeters(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const cosLat = Math.cos(((a[0] + b[0]) * 0.5 * Math.PI) / 180);
  const mLat = 111320;
  const mLng = 111320 * cosLat;

  const bx = (b[1] - a[1]) * mLng;
  const by = (b[0] - a[0]) * mLat;
  const px = (p[1] - a[1]) * mLng;
  const py = (p[0] - a[0]) * mLat;

  const lenSq = bx * bx + by * by;
  if (lenSq <= 1e-9) {
    return calculateDistanceMeters(p[0], p[1], a[0], a[1]);
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const projX = t * bx;
  const projY = t * by;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Simplifies a raw GPS polyline using Douglas-Peucker in meters to smooth walking jitter.
 */
export function simplifyTrackDouglasPeucker(
  points: [number, number][],
  toleranceMeters = 1.8
): [number, number][] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistanceMeters(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist > toleranceMeters) {
    const left = simplifyTrackDouglasPeucker(
      points.slice(0, maxIndex + 1),
      toleranceMeters
    );
    const right = simplifyTrackDouglasPeucker(
      points.slice(maxIndex),
      toleranceMeters
    );
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[end]];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates a standard GPX 1.1 XML string compatible with Geo Tracker, QGIS, and Google Earth.
 */
export function buildGpxXml(
  trackName: string,
  points: [number, number][],
  waypoints: QuickWaypoint[] = []
): string {
  const safeName = escapeXml(trackName || "Sakon Nakhon Hospital Survey Track");
  const nowIso = new Date().toISOString();

  const wptXml = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}">\n    <name>${escapeXml(
          w.label
        )}</name>\n    <time>${escapeXml(w.createdAt)}</time>\n  </wpt>`
    )
    .join("\n");

  const trkptXml = points
    .map(
      ([lat, lng]) =>
        `      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"></trkpt>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Sakon Nakhon Hospital Navigator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
    <time>${nowIso}</time>
  </metadata>
${wptXml ? `${wptXml}\n` : ""}  <trk>
    <name>${safeName}</name>
    <trkseg>
${trkptXml}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Parses an imported .gpx (e.g. from Android Geo Tracker) or .geojson file into [lat, lng][] points.
 */
export function parseGpxOrGeoJson(
  content: string,
  fallbackName: string
): { name: string; points: [number, number][] } {
  const trimmed = content.trim();

  // Try GeoJSON first if it starts with '{'
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as {
      type?: string;
      name?: string;
      features?: Array<{
        properties?: { name?: string };
        geometry?: { type?: string; coordinates?: unknown };
      }>;
      geometry?: { type?: string; coordinates?: unknown };
      coordinates?: unknown;
    };

    const points: [number, number][] = [];
    const pushCoords = (geom?: { type?: string; coordinates?: unknown }) => {
      if (!geom || !geom.coordinates) return;
      if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
        for (const c of geom.coordinates) {
          if (Array.isArray(c) && c.length >= 2) {
            points.push([Number(c[1]), Number(c[0])]);
          }
        }
      } else if (
        geom.type === "MultiLineString" &&
        Array.isArray(geom.coordinates)
      ) {
        for (const line of geom.coordinates) {
          if (Array.isArray(line)) {
            for (const c of line) {
              if (Array.isArray(c) && c.length >= 2) {
                points.push([Number(c[1]), Number(c[0])]);
              }
            }
          }
        }
      }
    };

    let detectedName = parsed.name || fallbackName;
    if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      for (const f of parsed.features) {
        if (f.properties?.name && detectedName === fallbackName) {
          detectedName = f.properties.name;
        }
        pushCoords(f.geometry);
      }
    } else if (parsed.type === "Feature") {
      pushCoords(parsed.geometry);
    } else {
      pushCoords(parsed);
    }

    return {
      name: detectedName.replace(/\.(gpx|geojson|json)$/i, ""),
      points: points.filter(
        ([lat, lng]) => !Number.isNaN(lat) && !Number.isNaN(lng)
      ),
    };
  }

  // Parse GPX XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("รูปแบบไฟล์ GPX ไม่ถูกต้อง");
  }

  const nameNode =
    doc.querySelector("trk > name") || doc.querySelector("metadata > name");
  const name =
    nameNode?.textContent?.trim() ||
    fallbackName.replace(/\.(gpx|geojson|json)$/i, "");

  const points: [number, number][] = [];
  const trkpts = doc.querySelectorAll("trkpt, rtept");
  trkpts.forEach((pt) => {
    const lat = Number(pt.getAttribute("lat"));
    const lng = Number(pt.getAttribute("lon"));
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      points.push([Number(lat.toFixed(7)), Number(lng.toFixed(7))]);
    }
  });

  return { name, points };
}
