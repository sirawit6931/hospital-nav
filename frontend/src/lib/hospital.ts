import type { Category, MapNode, RouteResponse } from "./api";

// Real Sakon Nakhon Hospital campus center (OSM way/494975554, Charoen Muang Rd.)
export const HOSPITAL_CENTER: [number, number] = [17.1633, 104.1580];
export const HOSPITAL_DEFAULT_ZOOM = 17;

export const ESRI_SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_SATELLITE_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics";

export const OSM_STREET_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_STREET_ATTRIBUTION =
  "&copy; OpenStreetMap contributors";

export type FilterCategoryId = string;

export interface FilterChipOption {
  id: FilterCategoryId;
  label: string;
  colorHex?: string;
}

export const FILTER_CHIPS: FilterChipOption[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "er_opd", label: "ฉุกเฉิน / OPD" },
  { id: "specialty", label: "ตึก 8 ชั้น / เฉพาะทาง" },
  { id: "diagnostic", label: "ตรวจ / รังสี / กายภาพ" },
  { id: "maternal_child", label: "เด็ก / สูติฯ" },
];

export interface BuildingBadgeInfo {
  category: string;
  badgeLabel: string;
  accentColor: string;
  badgeStyle: {
    text: string;
    bg: string;
    border: string;
  };
  subtitle: string;
}

function getReadableTextHex(hex: string): string {
  const clean = (hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#0F172A";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Darken bright yellow/lime/light hex colors so badge text remains WCAG-readable
  return luminance > 0.48 ? "#713F12" : `#${clean}`;
}

function hexWithAlpha(hex: string, alphaHex = "4D"): string {
  const clean = (hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "#CBD5E1";
  return `#${clean}${alphaHex}`;
}

/**
 * Classifies a hospital building node into medical categories and applies live Category
 * names and colors from GET /api/categories when provided.
 */
export function classifyBuilding(
  node: MapNode,
  categories?: Category[]
): BuildingBadgeInfo {
  const customBadge = (node.badge_label || "").trim();

  // 1. Honor explicit category_id from PostgreSQL first when available
  if (node.category_id && categories && categories.length > 0) {
    const directCat = categories.find((c) => c.id === node.category_id);
    if (directCat) {
      const floorPrefix = node.floor_range?.trim()
        ? `ชั้น ${node.floor_range.trim()} • `
        : "";
      return {
        category: directCat.slug,
        badgeLabel: customBadge || directCat.name,
        accentColor: directCat.color_hex,
        badgeStyle: {
          text: getReadableTextHex(directCat.color_hex),
          bg: directCat.badge_bg,
          border: hexWithAlpha(directCat.color_hex, "4D"),
        },
        subtitle: `${floorPrefix}${directCat.name}`,
      };
    }
  }

  const nameLower = (node.name || "").toLowerCase();
  const deptText = (node.departments || [])
    .map((d) => `${d.name} ${d.keywords} ${d.floor}`)
    .join(" ");
  const text = `${node.name} ${node.keywords} ${node.indoor_guide} ${deptText}`.toLowerCase();

  const hasHeartCat = Boolean(
    categories?.some((c) => c.slug === "heart_center")
  );
  const hasSupportCat = Boolean(categories?.some((c) => c.slug === "support"));

  let base: BuildingBadgeInfo;

  // Check explicit primary tower names first so keywords like "Trauma" in ตึกร่มธรรม don't misclassify it as ER
  if (nameLower.includes("10 ชั้น") || nameLower.includes("ร่มเย็น")) {
    base = {
      category: "maternal_child",
      badgeLabel: "ตึก 10 ชั้น",
      accentColor: "#881337",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: "ตึกร่มเย็น 10 ชั้น • เด็ก, สูติ-นรีเวช, ตา, หู คอ จมูก, พิเศษ",
    };
  } else if (nameLower.includes("8 ชั้น") || nameLower.includes("ร่มธรรม")) {
    base = {
      category: "specialty",
      badgeLabel: "ตึก 8 ชั้น",
      accentColor: "#EAB308",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: "ตึกร่มธรรม 8 ชั้น • หอผู้ป่วยใน, MICU, Stroke, Trauma",
    };
  } else if (nameLower.includes("หัวใจเพื่อแผ่นดิน")) {
    base = {
      category: hasHeartCat ? "heart_center" : "specialty",
      badgeLabel: "ศูนย์หัวใจ",
      accentColor: "#4A83B4",
      badgeStyle: {
        text: "#1D4ED8",
        bg: "#DBEAFE",
        border: "#BFDBFE",
      },
      subtitle: "ชั้น 1 จุดชำระเงิน / รับยา • ศูนย์หัวใจ, CICU, OR, ฟอกไต",
    };
  } else if (
    nameLower.includes("ฉุกเฉิน") ||
    nameLower.includes("อุบัติเหตุ") ||
    /\ber\b/.test(nameLower) ||
    text.includes("ห้องอุบัติเหตุฉุกเฉิน")
  ) {
    base = {
      category: "er_opd",
      badgeLabel: "ER / OPD",
      accentColor: "#A61B29",
      badgeStyle: {
        text: "#BE123C",
        bg: "#FFE4E6",
        border: "#FECDD3",
      },
      subtitle: "ตึก 9 ชั้น • ฉุกเฉิน 24 ชม., ผิวหนัง, สูติฯ, ตา, หู คอ จมูก",
    };
  } else if (
    nameLower.includes("วิเคราะห์") ||
    nameLower.includes("ล้างไต") ||
    nameLower.includes("ไตเทียม")
  ) {
    base = {
      category: "diagnostic",
      badgeLabel: "ตรวจ / ไตเทียม",
      accentColor: "#1F8A70",
      badgeStyle: {
        text: "#1D4ED8",
        bg: "#DBEAFE",
        border: "#BFDBFE",
      },
      subtitle: "อาคารตรวจวิเคราะห์ ห้องปฏิบัติการ ล้างไต และเอ็กซ์เรย์",
    };
  } else if (
    text.includes("ผู้ป่วยนอก") ||
    text.includes("ห้องบัตร") ||
    text.includes("ตรวจโรคทั่วไป") ||
    /\bopd\b/.test(text)
  ) {
    base = {
      category: "er_opd",
      badgeLabel: "OPD / ตึกตรวจ",
      accentColor: "#A61B29",
      badgeStyle: {
        text: "#1D4ED8",
        bg: "#DBEAFE",
        border: "#BFDBFE",
      },
      subtitle: "อาคารตรวจผู้ป่วยนอกและลงทะเบียน",
    };
  } else if (
    text.includes("ตึกร่มเย็น") ||
    text.includes("10 ชั้น") ||
    text.includes("สูติ") ||
    text.includes("นรีเวช") ||
    text.includes("กุมาร") ||
    text.includes("เด็ก") ||
    text.includes("คลอด") ||
    text.includes("nicu") ||
    text.includes("picu")
  ) {
    base = {
      category: "maternal_child",
      badgeLabel:
        text.includes("10 ชั้น") || text.includes("ร่มเย็น")
          ? "ตึก 10 ชั้น"
          : "เด็ก / สูติฯ",
      accentColor: "#881337",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: text.includes("ร่มเย็น")
        ? "ตึกร่มเย็น 10 ชั้น • เด็ก, สูติ-นรีเวช, ตา, หู คอ จมูก, พิเศษ"
        : "คลินิกกุมารเวชกรรมและสูติ-นรีเวช",
    };
  } else if (
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
    base = {
      category: "diagnostic",
      badgeLabel: "ตรวจ / รังสี",
      accentColor: "#1F8A70",
      badgeStyle: {
        text: "#1D4ED8",
        bg: "#DBEAFE",
        border: "#BFDBFE",
      },
      subtitle: "หน่วยตรวจวินิจฉัย รังสีวิทยา และเวชกรรมฟื้นฟู",
    };
  } else if (
    hasSupportCat &&
    (text.includes("เภสัช") ||
      text.includes("ร่มโพธิ์") ||
      text.includes("พัสดุ") ||
      text.includes("จ่ายกลาง") ||
      text.includes("โภชนา") ||
      text.includes("อำนวยการ") ||
      text.includes("สนับสนุน") ||
      text.includes("ประชุม"))
  ) {
    base = {
      category: "support",
      badgeLabel: "อาคารบริการ",
      accentColor: "#6D4C41",
      badgeStyle: {
        text: "#475569",
        bg: "#F1F5F9",
        border: "#CBD5E1",
      },
      subtitle: "อาคารบริการ สนับสนุน และอำนวยการ โรงพยาบาลสกลนคร",
    };
  } else if (
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
    base = {
      category: "specialty",
      badgeLabel: text.includes("8 ชั้น") ? "ตึก 8 ชั้น" : "ศูนย์เฉพาะทาง",
      accentColor: "#EAB308",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: "อาคารหอผู้ป่วยในและศูนย์การแพทย์เฉพาะทาง",
    };
  } else {
    base = {
      category: hasSupportCat ? "support" : "specialty",
      badgeLabel: "อาคารบริการ",
      accentColor: "#047857",
      badgeStyle: {
        text: "#047857",
        bg: "#CCFBF1",
        border: "#99F6E4",
      },
      subtitle: "อาคารและจุดให้บริการ โรงพยาบาลสกลนคร",
    };
  }

  // Apply live Category metadata from GET /api/categories if available
  if (categories && categories.length > 0) {
    // Also check if an admin-defined custom category slug/name directly matches this building
    const customMatch = categories.find(
      (c) =>
        ![
          "er_opd",
          "specialty",
          "diagnostic",
          "maternal_child",
          "heart_center",
          "support",
        ].includes(c.slug) &&
        (text.includes(c.name.toLowerCase()) ||
          text.includes(c.slug.toLowerCase().replace(/_/g, " ")))
    );

    const matchedCat =
      customMatch || categories.find((c) => c.slug === base.category);

    if (matchedCat) {
      return {
        category: matchedCat.slug,
        badgeLabel: matchedCat.name,
        accentColor: matchedCat.color_hex || base.accentColor,
        badgeStyle: {
          text: getReadableTextHex(matchedCat.color_hex),
          bg: matchedCat.badge_bg || base.badgeStyle.bg,
          border: hexWithAlpha(matchedCat.color_hex, "4D"),
        },
        subtitle: base.subtitle,
      };
    }
  }

  return base;
}

/**
 * Splits keywords / indoor_guide into neat scannable department items for a 2-column card grid.
 * Prefers structured `departments` attached from PostgreSQL when present.
 */
export function extractDepartmentItems(node: MapNode): string[] {
  if (node.departments && node.departments.length > 0) {
    return node.departments.map((d) =>
      d.floor ? `${d.name} (${d.floor})` : d.name
    );
  }
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

export function calculateBearing(
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

/**
 * Computes true-North clockwise compass heading (0 = North, 90 = East, 180 = South, 270 = West)
 * from a DeviceOrientationEvent with tilt compensation:
 * - iOS Safari: uses `webkitCompassHeading` (already tilt-compensated true North).
 * - Android Chrome: strictly requires `ev.absolute === true` (from `deviceorientationabsolute`)
 *   so non-absolute relative orientation events never corrupt true North, and applies W3C Z-X'-Y''
 *   tilt compensation + screen orientation angle.
 */
export function computeCompassHeadingFromOrientation(
  ev: DeviceOrientationEvent
): number | null {
  const webkitHeading = (
    ev as DeviceOrientationEvent & { webkitCompassHeading?: number }
  ).webkitCompassHeading;

  if (
    typeof webkitHeading === "number" &&
    !Number.isNaN(webkitHeading) &&
    webkitHeading >= 0
  ) {
    return ((webkitHeading % 360) + 360) % 360;
  }

  // Strictly require absolute orientation so relative gyro alpha doesn't point randomly
  if (!ev.absolute || typeof ev.alpha !== "number" || Number.isNaN(ev.alpha)) {
    return null;
  }

  const degToRad = Math.PI / 180;
  const alpha = ev.alpha * degToRad;
  const beta = (typeof ev.beta === "number" && !Number.isNaN(ev.beta) ? ev.beta : 0) * degToRad;
  const gamma = (typeof ev.gamma === "number" && !Number.isNaN(ev.gamma) ? ev.gamma : 0) * degToRad;

  const cA = Math.cos(alpha);
  const sA = Math.sin(alpha);
  const cB = Math.cos(beta);
  const sB = Math.sin(beta);
  const cG = Math.cos(gamma);
  const sG = Math.sin(gamma);

  // Use device top edge (+Y) when held flat or tilted up naturally (|beta| <= 70 deg),
  // which is immune to hand roll (gamma). Switch to back camera (-Z) when held nearly vertical.
  let vxEast: number;
  let vyNorth: number;
  if (Math.abs(ev.beta ?? 0) > 70) {
    vxEast = -cA * sG - sA * sB * cG;
    vyNorth = -sA * sG + cA * sB * cG;
  } else {
    vxEast = -sA * cB;
    vyNorth = cA * cB;
  }

  if (Math.hypot(vxEast, vyNorth) < 1e-4) {
    return null;
  }

  let heading = (Math.atan2(vxEast, vyNorth) * 180) / Math.PI;
  const screenAngle =
    typeof window !== "undefined" &&
    typeof window.screen?.orientation?.angle === "number"
      ? window.screen.orientation.angle
      : 0;
  heading = (heading + screenAngle + 360) % 360;
  return heading;
}

/**
 * Generates a closed GeoJSON Polygon ring ([lng, lat][]) representing a circle in meters.
 * Used to visualize real-time GPS accuracy radius on MapLibre 3D.
 */
export function createGeoJsonCircle(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  steps = 36
): number[][] {
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const dx = Math.cos(theta) * radiusMeters;
    const dy = Math.sin(theta) * radiusMeters;
    ring.push([
      Number((centerLng + dx / mPerDegLng).toFixed(6)),
      Number((centerLat + dy / mPerDegLat).toFixed(6)),
    ]);
  }
  return ring;
}

/**
 * Builds crisp HTML/SVG for a directional user location triangle with a soft forward vision cone.
 * - For Leaflet 2D: pass `rotateInHtml = true` so CSS rotates the marker by `headingDeg`.
 * - For MapLibre 3D: pass `rotateInHtml = false` and use MapLibre Marker's native `setRotation(headingDeg)`
 *   with `rotationAlignment: "map"` so it stays aligned even when the 3D map is rotated/tilted.
 */
export function buildDirectionalUserMarkerHTML(
  headingDeg: number,
  isMock: boolean,
  rotateInHtml = true
): string {
  const mainColor = isMock ? "#D97706" : "#0F766E";
  const coneColor = isMock ? "#F59E0B" : "#14B8A6";
  const gradId = isMock ? "user-cone-mock" : "user-cone-live";
  const transformStyle = rotateInHtml
    ? `transform:rotate(${Math.round(headingDeg)}deg);transition:transform 180ms ease-out;`
    : "";

  return `
    <div style="width:64px;height:64px;display:flex;align-items:center;justify-content:center;pointer-events:none;${transformStyle}">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
        <defs>
          <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="${coneColor}" stop-opacity="0.52" />
            <stop offset="70%" stop-color="${coneColor}" stop-opacity="0.18" />
            <stop offset="100%" stop-color="${coneColor}" stop-opacity="0" />
          </radialGradient>
        </defs>
        <!-- Soft forward vision beam cone pointing North (0 deg) -->
        <path d="M32 32 L13 4 A32 32 0 0 1 51 4 Z" fill="url(#${gradId})" />
        <!-- Subtle outer pulse halo -->
        <circle cx="32" cy="32" r="14" fill="${coneColor}" fill-opacity="0.22" />
        <!-- Crisp directional navigation triangle pointing forward (up = 0 deg North) -->
        <path
          d="M32 13 L45 43 L32 36.5 L19 43 Z"
          fill="${mainColor}"
          stroke="#FFFFFF"
          stroke-width="3"
          stroke-linejoin="round"
          style="filter:drop-shadow(0 2px 5px rgba(15,23,42,0.45));"
        />
        <!-- Center anchor dot -->
        <circle cx="32" cy="32" r="2.8" fill="#FFFFFF" />
      </svg>
    </div>
  `;
}

function getBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  return calculateBearing(lat1, lng1, lat2, lng2);
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
