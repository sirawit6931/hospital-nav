import type { MapNode, RouteResponse } from "./api";

// Default Sakon Nakhon Hospital coordinates
export const HOSPITAL_CENTER: [number, number] = [17.1634, 104.1476];
export const HOSPITAL_DEFAULT_ZOOM = 17;

export const ESRI_SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_SATELLITE_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics";

export const OSM_STREET_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_STREET_ATTRIBUTION =
  "&copy; OpenStreetMap contributors";

export type FilterCategoryId =
  | "all"
  | "er_opd"
  | "specialty"
  | "diagnostic"
  | "maternal_child";

export interface FilterChipOption {
  id: FilterCategoryId;
  label: string;
}

export const FILTER_CHIPS: FilterChipOption[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "er_opd", label: "ฉุกเฉิน / OPD" },
  { id: "specialty", label: "ตึก 8 ชั้น / เฉพาะทาง" },
  { id: "diagnostic", label: "ตรวจ / รังสี / กายภาพ" },
  { id: "maternal_child", label: "เด็ก / สูติฯ" },
];

export interface BuildingBadgeInfo {
  category: Exclude<FilterCategoryId, "all">;
  badgeLabel: string;
  badgeStyle: {
    text: string;
    bg: string;
    border: string;
  };
  subtitle: string;
}

/**
 * Classifies a hospital building node into medical categories and Healthcare UX badge colors:
 * - ER / ฉุกเฉิน: #BE123C on #FFE4E6
 * - OPD / ตึกตรวจ: #1D4ED8 on #DBEAFE
 * - ศูนย์เฉพาะทาง / ตึก 8 ชั้น: #047857 on #CCFBF1
 */
export function classifyBuilding(node: MapNode): BuildingBadgeInfo {
  const text = `${node.name} ${node.keywords} ${node.indoor_guide}`.toLowerCase();

  if (
    text.includes("ฉุกเฉิน") ||
    text.includes("อุบัติเหตุ") ||
    text.includes("trauma") ||
    /\ber\b/.test(text)
  ) {
    return {
      category: "er_opd",
      badgeLabel: "ER / ฉุกเฉิน",
      badgeStyle: {
        text: "#BE123C",
        bg: "#FFE4E6",
        border: "#FECDD3",
      },
      subtitle: "เปิดบริการ 24 ชั่วโมง • จุดคัดกรองและฉุกเฉิน",
    };
  }

  if (
    text.includes("ผู้ป่วยนอก") ||
    text.includes("ห้องบัตร") ||
    text.includes("ตรวจโรคทั่วไป") ||
    /\bopd\b/.test(text)
  ) {
    return {
      category: "er_opd",
      badgeLabel: "OPD / ตึกตรวจ",
      badgeStyle: {
        text: "#1D4ED8",
        bg: "#DBEAFE",
        border: "#BFDBFE",
      },
      subtitle: "อาคารตรวจผู้ป่วยนอกและลงทะเบียน",
    };
  }

  if (
    text.includes("สูติ") ||
    text.includes("นรีเวช") ||
    text.includes("กุมาร") ||
    text.includes("เด็ก") ||
    text.includes("คลอด") ||
    text.includes("nicu")
  ) {
    return {
      category: "maternal_child",
      badgeLabel: "เด็ก / สูติฯ",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: "คลินิกกุมารเวชกรรมและสูติ-นรีเวช",
    };
  }

  if (
    text.includes("เอ็กซ์เรย์") ||
    text.includes("เอกซเรย์") ||
    text.includes("รังสี") ||
    text.includes("x-ray") ||
    text.includes("xray") ||
    text.includes("ct") ||
    text.includes("mri") ||
    text.includes("กายภาพ") ||
    text.includes("แล็บ") ||
    text.includes("lab") ||
    text.includes("ทันตกรรม")
  ) {
    return {
      category: "diagnostic",
      badgeLabel: "ตรวจ / รังสี",
      badgeStyle: {
        text: "#1D4ED8",
        bg: "#DBEAFE",
        border: "#BFDBFE",
      },
      subtitle: "หน่วยตรวจวินิจฉัย รังสีวิทยา และเวชกรรมฟื้นฟู",
    };
  }

  if (
    text.includes("8 ชั้น") ||
    text.includes("หัวใจ") ||
    text.includes("cicu") ||
    text.includes("micu") ||
    text.includes("icu") ||
    text.includes("ฟอกไต") ||
    text.includes("stroke") ||
    text.includes("ผ่าตัด") ||
    text.includes("เฉพาะทาง")
  ) {
    return {
      category: "specialty",
      badgeLabel: text.includes("8 ชั้น") ? "ตึก 8 ชั้น" : "ศูนย์เฉพาะทาง",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: "อาคารหอผู้ป่วยในและศูนย์การแพทย์เฉพาะทาง",
    };
  }

  return {
    category: "specialty",
    badgeLabel: "อาคารบริการ",
    badgeStyle: {
      text: "#047857",
      bg: "#CCFBF1",
      border: "#99F6E4",
    },
    subtitle: "อาคารและจุดให้บริการ โรงพยาบาลสกลนคร",
  };
}

/**
 * Splits keywords / indoor_guide into neat scannable department items for a 2-column card grid.
 */
export function extractDepartmentItems(node: MapNode): string[] {
  const raw = (node.keywords || node.indoor_guide || "").trim();
  if (!raw) return [];

  return raw
    .split(/[,|\n;•]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

/**
 * Computes Haversine distance in meters between two WGS84 coordinates.
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistanceAndTime(distanceMeters: number): {
  distanceLabel: string;
  walkMin: number;
  combinedLabel: string;
} {
  const roundedMeters = Math.max(0, Math.round(distanceMeters));
  const walkMin = Math.max(1, Math.round(roundedMeters / 80));
  const distanceLabel =
    roundedMeters >= 1000
      ? `${(roundedMeters / 1000).toFixed(2)} กม.`
      : `${roundedMeters} ม.`;

  return {
    distanceLabel,
    walkMin,
    combinedLabel: `${distanceLabel} • ${walkMin} นาที`,
  };
}

export interface TurnStep {
  stepNumber: number;
  title: string;
  detail: string;
  isDestination?: boolean;
}

function getBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingToThaiDirection(bearing: number): string {
  if (bearing >= 337.5 || bearing < 22.5) return "ทิศเหนือ";
  if (bearing < 67.5) return "ทิศตะวันออกเฉียงเหนือ";
  if (bearing < 112.5) return "ทิศตะวันออก";
  if (bearing < 157.5) return "ทิศตะวันออกเฉียงใต้";
  if (bearing < 202.5) return "ทิศใต้";
  if (bearing < 247.5) return "ทิศตะวันตกเฉียงใต้";
  if (bearing < 292.5) return "ทิศตะวันตก";
  return "ทิศตะวันตกเฉียงเหนือ";
}

function turnDirectionThai(prevBearing: number, nextBearing: number): string {
  const diff = ((nextBearing - prevBearing + 540) % 360) - 180;
  if (diff > 30 && diff < 150) return "เลี้ยวขวา";
  if (diff < -30 && diff > -150) return "เลี้ยวซ้าย";
  return "เดินตรงต่อไป";
}

/**
 * Generates clean, patient-friendly turn-by-turn steps from the computed route path.
 */
export function buildTurnByTurnSteps(
  route: RouteResponse,
  originLabel: string
): TurnStep[] {
  const pts = route.path || [];
  const targetName = route.target_building?.name || "อาคารปลายทาง";

  if (pts.length <= 1) {
    return [
      {
        stepNumber: 1,
        title: `คุณอยู่บริเวณ ${targetName} แล้ว`,
        detail:
          route.target_building?.indoor_guide ||
          "ตรวจสอบป้ายบอกทางบริเวณทางเข้าอาคาร",
        isDestination: true,
      },
    ];
  }

  const steps: TurnStep[] = [];
  const firstDist = Math.round(
    calculateDistanceMeters(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
  );
  const firstBearing = getBearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);

  steps.push({
    stepNumber: 1,
    title: `เริ่มต้นจาก ${originLabel}`,
    detail: `มุ่งหน้าไปทาง${bearingToThaiDirection(firstBearing)} ตามทางเดินหลักประมาณ ${Math.max(10, firstDist)} เมตร`,
  });

  if (pts.length >= 3) {
    // Group intermediate segments into concise, easy-to-follow turns
    let accumulatedDist = 0;
    let prevBearing = firstBearing;
    let intermediateAdded = 0;

    for (let i = 1; i < pts.length - 1; i++) {
      const segDist = calculateDistanceMeters(
        pts[i][0],
        pts[i][1],
        pts[i + 1][0],
        pts[i + 1][1]
      );
      const nextBearing = getBearing(
        pts[i][0],
        pts[i][1],
        pts[i + 1][0],
        pts[i + 1][1]
      );
      const turnText = turnDirectionThai(prevBearing, nextBearing);
      accumulatedDist += segDist;

      const isLastSegment = i === pts.length - 2;
      if (turnText !== "เดินตรงต่อไป" || isLastSegment) {
        if (intermediateAdded < 3) {
          steps.push({
            stepNumber: steps.length + 1,
            title: `${turnText} ตามแนวทางเดินในโรงพยาบาล`,
            detail: `เดินต่อไปทาง${bearingToThaiDirection(nextBearing)} ประมาณ ${Math.max(10, Math.round(accumulatedDist))} เมตร`,
          });
          intermediateAdded++;
          accumulatedDist = 0;
        }
      }
      prevBearing = nextBearing;
    }
  }

  steps.push({
    stepNumber: steps.length + 1,
    title: `ถึงจุดหมาย ${targetName}`,
    detail: route.target_building?.indoor_guide
      ? "เข้าสู่ตัวอาคารและปฏิบัติตามคำแนะนำการเดินภายในอาคารด้านล่าง"
      : "ถึงบริเวณทางเข้าอาคารปลายทางเรียบร้อยแล้ว",
    isDestination: true,
  });

  return steps;
}

export interface SnapResult {
  snappedCoords: [number, number];
  distanceFromPathMeters: number;
  isSnapped: boolean;
  isOffRoute: boolean;
}

/**
 * Projects a geographic point onto a line segment [a, b] using a local tangent-plane approximation
 * (millimeter accuracy at hospital scale) and returns the closest point and Haversine distance.
 */
function projectPointOntoSegment(
  point: [number, number],
  a: [number, number],
  b: [number, number]
): { projected: [number, number]; distanceMeters: number } {
  const cosLat = Math.cos(((a[0] + b[0]) * 0.5 * Math.PI) / 180);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * cosLat;

  const ax = 0;
  const ay = 0;
  const bx = (b[1] - a[1]) * metersPerDegLng;
  const by = (b[0] - a[0]) * metersPerDegLat;
  const px = (point[1] - a[1]) * metersPerDegLng;
  const py = (point[0] - a[0]) * metersPerDegLat;

  const abLenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  if (abLenSq <= 1e-9) {
    return {
      projected: [a[0], a[1]],
      distanceMeters: calculateDistanceMeters(point[0], point[1], a[0], a[1]),
    };
  }

  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const projLat = a[0] + t * (b[0] - a[0]);
  const projLng = a[1] + t * (b[1] - a[1]);
  const projected: [number, number] = [projLat, projLng];

  return {
    projected,
    distanceMeters: calculateDistanceMeters(point[0], point[1], projLat, projLng),
  };
}

/**
 * Snaps a raw GPS coordinate onto the closest point on a route polyline if within maxSnapMeters (default 15m).
 * If further than maxSnapMeters, marks isOffRoute = true so the caller can trigger Auto-Reroute.
 */
export function snapToPolyline(
  point: [number, number],
  polyline: [number, number][],
  maxSnapMeters = 15
): SnapResult {
  if (!polyline || polyline.length === 0) {
    return {
      snappedCoords: point,
      distanceFromPathMeters: 0,
      isSnapped: false,
      isOffRoute: false,
    };
  }

  if (polyline.length === 1) {
    const dist = calculateDistanceMeters(
      point[0],
      point[1],
      polyline[0][0],
      polyline[0][1]
    );
    const within = dist <= maxSnapMeters;
    return {
      snappedCoords: within ? polyline[0] : point,
      distanceFromPathMeters: dist,
      isSnapped: within,
      isOffRoute: !within,
    };
  }

  let minDist = Infinity;
  let bestProjected: [number, number] = point;

  for (let i = 0; i < polyline.length - 1; i++) {
    const { projected, distanceMeters } = projectPointOntoSegment(
      point,
      polyline[i],
      polyline[i + 1]
    );
    if (distanceMeters < minDist) {
      minDist = distanceMeters;
      bestProjected = projected;
    }
  }

  const within = minDist <= maxSnapMeters;
  return {
    snappedCoords: within ? bestProjected : point,
    distanceFromPathMeters: minDist,
    isSnapped: within,
    isOffRoute: !within,
  };
}

/**
 * Interpolates a coordinate smoothly along a polyline for a progress ratio in [0, 1].
 * Used by the Mock GPS simulator slider and auto-walk playback.
 */
export function interpolateAlongPolyline(
  polyline: [number, number][],
  progress01: number
): [number, number] | null {
  if (!polyline || polyline.length === 0) return null;
  if (polyline.length === 1) return polyline[0];

  const clamped = Math.max(0, Math.min(1, progress01));
  if (clamped === 0) return polyline[0];
  if (clamped === 1) return polyline[polyline.length - 1];

  const segLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = calculateDistanceMeters(
      polyline[i][0],
      polyline[i][1],
      polyline[i + 1][0],
      polyline[i + 1][1]
    );
    segLengths.push(d);
    totalLength += d;
  }

  if (totalLength <= 0) return polyline[polyline.length - 1];

  const targetDist = clamped * totalLength;
  let traversed = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (traversed + segLen >= targetDist && segLen > 0) {
      const ratio = (targetDist - traversed) / segLen;
      const start = polyline[i];
      const end = polyline[i + 1];
      return [
        start[0] + ratio * (end[0] - start[0]),
        start[1] + ratio * (end[1] - start[1]),
      ];
    }
    traversed += segLen;
  }

  return polyline[polyline.length - 1];
}
