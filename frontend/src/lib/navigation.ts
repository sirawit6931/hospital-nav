import type { RouteResponse } from "./api";
import { calculateBearing, calculateDistanceMeters } from "./hospital";

export type NavDirectionKind = "straight" | "left" | "right" | "arrive";

export interface NavigationStep {
  index: number;
  direction: NavDirectionKind;
  title: string;
  instruction: string;
  startDistanceM: number;
  turnDistanceM: number;
  segmentLengthM: number;
  bearingDeg: number;
  point: [number, number];
}

export interface ActiveNavigationProgress {
  snappedPoint: [number, number];
  passedPath: [number, number][];
  remainingPath: [number, number][];
  traveledDistanceM: number;
  totalDistanceM: number;
  remainingDistanceM: number;
  remainingMinutes: number;
  distanceFromPathM: number;
  currentSegmentBearingDeg: number;
  activeStepIndex: number;
  activeStep: NavigationStep;
  nextStep: NavigationStep | null;
  distanceToNextTurnM: number;
  hasArrived: boolean;
}

function bearingToThaiCardinal(bearing: number): string {
  if (bearing >= 337.5 || bearing < 22.5) return "ทิศเหนือ";
  if (bearing < 67.5) return "ทิศตะวันออกเฉียงเหนือ";
  if (bearing < 112.5) return "ทิศตะวันออก";
  if (bearing < 157.5) return "ทิศตะวันออกเฉียงใต้";
  if (bearing < 202.5) return "ทิศใต้";
  if (bearing < 247.5) return "ทิศตะวันตกเฉียงใต้";
  if (bearing < 292.5) return "ทิศตะวันตก";
  return "ทิศตะวันตกเฉียงเหนือ";
}

function classifyTurnAngle(
  prevBearing: number,
  nextBearing: number
): NavDirectionKind {
  const diff = ((nextBearing - prevBearing + 540) % 360) - 180;
  if (diff >= 25 && diff <= 165) return "right";
  if (diff <= -25 && diff >= -165) return "left";
  return "straight";
}

/**
 * Computes cumulative distance array along a polyline in meters.
 */
export function computeCumulativeDistances(
  polyline: [number, number][]
): number[] {
  if (!polyline || polyline.length === 0) return [];
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    total += calculateDistanceMeters(
      polyline[i][0],
      polyline[i][1],
      polyline[i + 1][0],
      polyline[i + 1][1]
    );
    cum.push(total);
  }
  return cum;
}

/**
 * Builds structured turn-by-turn navigation steps with exact distance triggers along the route polyline.
 */
export function buildActiveNavigationSteps(
  route: RouteResponse | null
): NavigationStep[] {
  const pts = route?.path ?? [];
  const targetName = route?.target_building?.name || "อาคารปลายทาง";

  if (pts.length === 0) return [];
  if (pts.length === 1) {
    return [
      {
        index: 0,
        direction: "arrive",
        title: `ถึงจุดหมาย ${targetName}`,
        instruction: `คุณอยู่บริเวณ ${targetName} แล้ว`,
        startDistanceM: 0,
        turnDistanceM: 0,
        segmentLengthM: 0,
        bearingDeg: 0,
        point: pts[0],
      },
    ];
  }

  const cum = computeCumulativeDistances(pts);
  const totalLen = cum[cum.length - 1] || 0;

  // Identify maneuver indices where a significant left/right turn occurs
  interface ManeuverPoint {
    ptIndex: number;
    direction: NavDirectionKind;
    bearingAfter: number;
    distAtPoint: number;
  }

  const firstBearing = calculateBearing(
    pts[0][0],
    pts[0][1],
    pts[1][0],
    pts[1][1]
  );

  const maneuvers: ManeuverPoint[] = [
    {
      ptIndex: 0,
      direction: "straight",
      bearingAfter: firstBearing,
      distAtPoint: 0,
    },
  ];

  let prevBearing = firstBearing;
  for (let i = 1; i < pts.length - 1; i++) {
    const segLen = calculateDistanceMeters(
      pts[i][0],
      pts[i][1],
      pts[i + 1][0],
      pts[i + 1][1]
    );
    if (segLen < 1.5) continue;
    const nextBearing = calculateBearing(
      pts[i][0],
      pts[i][1],
      pts[i + 1][0],
      pts[i + 1][1]
    );
    const turn = classifyTurnAngle(prevBearing, nextBearing);
    if (turn !== "straight") {
      maneuvers.push({
        ptIndex: i,
        direction: turn,
        bearingAfter: nextBearing,
        distAtPoint: cum[i],
      });
    }
    prevBearing = nextBearing;
  }

  const steps: NavigationStep[] = [];
  for (let m = 0; m < maneuvers.length; m++) {
    const curr = maneuvers[m];
    const nextDist =
      m < maneuvers.length - 1 ? maneuvers[m + 1].distAtPoint : totalLen;
    const segLen = Math.max(0, nextDist - curr.distAtPoint);
    const cardinal = bearingToThaiCardinal(curr.bearingAfter);

    let title = "เดินตรงไปตามทางเดิน";
    let instruction = `เดินตรงไปทาง${cardinal}`;
    if (curr.direction === "left") {
      title = "เลี้ยวซ้าย";
      instruction = `เลี้ยวซ้าย มุ่งหน้าไปทาง${cardinal}`;
    } else if (curr.direction === "right") {
      title = "เลี้ยวขวา";
      instruction = `เลี้ยวขวา มุ่งหน้าไปทาง${cardinal}`;
    } else if (m === 0) {
      title = "เดินตรงไปข้างหน้า";
      instruction = `มุ่งหน้าไปทาง${cardinal} ตามทางเดินในโรงพยาบาล`;
    }

    steps.push({
      index: steps.length,
      direction: curr.direction,
      title,
      instruction,
      startDistanceM: curr.distAtPoint,
      turnDistanceM: nextDist,
      segmentLengthM: segLen,
      bearingDeg: curr.bearingAfter,
      point: pts[curr.ptIndex],
    });
  }

  // Final arrival step
  steps.push({
    index: steps.length,
    direction: "arrive",
    title: `ถึงจุดหมาย ${targetName}`,
    instruction: `ถึงบริเวณ ${targetName} แล้ว`,
    startDistanceM: totalLen,
    turnDistanceM: totalLen,
    segmentLengthM: 0,
    bearingDeg: prevBearing,
    point: pts[pts.length - 1],
  });

  return steps;
}

/**
 * Projects the user's current coordinates onto the active route polyline, splits the path into
 * passed (faded gray) vs remaining (bright sky-blue), and computes live turn-by-turn progression.
 */
export function computeRouteProgress(
  point: [number, number],
  polyline: [number, number][],
  steps: NavigationStep[],
  arrivalThresholdM = 15
): ActiveNavigationProgress | null {
  if (!polyline || polyline.length === 0 || steps.length === 0) return null;

  const cum = computeCumulativeDistances(polyline);
  const totalDistanceM = cum[cum.length - 1] || 0;

  if (polyline.length === 1) {
    const dist = calculateDistanceMeters(
      point[0],
      point[1],
      polyline[0][0],
      polyline[0][1]
    );
    return {
      snappedPoint: polyline[0],
      passedPath: [polyline[0]],
      remainingPath: [polyline[0]],
      traveledDistanceM: 0,
      totalDistanceM: 0,
      remainingDistanceM: dist,
      remainingMinutes: 1,
      distanceFromPathM: dist,
      currentSegmentBearingDeg: 0,
      activeStepIndex: 0,
      activeStep: steps[0],
      nextStep: null,
      distanceToNextTurnM: Math.round(dist),
      hasArrived: dist < arrivalThresholdM,
    };
  }

  // Project onto every segment to find the closest point along the polyline
  let bestDistM = Infinity;
  let bestSegIdx = 0;
  let bestT = 0;
  let bestProjected: [number, number] = polyline[0];

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const cosLat = Math.cos(((a[0] + b[0]) * 0.5 * Math.PI) / 180);
    const mLat = 111320;
    const mLng = 111320 * cosLat;
    const bx = (b[1] - a[1]) * mLng;
    const by = (b[0] - a[0]) * mLat;
    const px = (point[1] - a[1]) * mLng;
    const py = (point[0] - a[0]) * mLat;
    const lenSq = bx * bx + by * by;
    const t =
      lenSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
    const proj: [number, number] = [
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
    ];
    const d = calculateDistanceMeters(point[0], point[1], proj[0], proj[1]);
    if (d < bestDistM) {
      bestDistM = d;
      bestSegIdx = i;
      bestT = t;
      bestProjected = proj;
    }
  }

  const segLen = cum[bestSegIdx + 1] - cum[bestSegIdx];
  const traveledDistanceM = Math.max(
    0,
    Math.min(totalDistanceM, cum[bestSegIdx] + bestT * segLen)
  );
  const remainingDistanceM = Math.max(0, totalDistanceM - traveledDistanceM);

  const directDistToEnd = calculateDistanceMeters(
    point[0],
    point[1],
    polyline[polyline.length - 1][0],
    polyline[polyline.length - 1][1]
  );
  const hasArrived =
    directDistToEnd < arrivalThresholdM || remainingDistanceM < 5;

  const passedPath: [number, number][] = [
    ...polyline.slice(0, bestSegIdx + 1),
    bestProjected,
  ];
  const remainingPath: [number, number][] = [
    bestProjected,
    ...polyline.slice(bestSegIdx + 1),
  ];

  // Segment bearing looking ahead
  const lookAheadIdx =
    bestT > 0.92 && bestSegIdx < polyline.length - 2
      ? bestSegIdx + 1
      : bestSegIdx;
  const currentSegmentBearingDeg = calculateBearing(
    polyline[lookAheadIdx][0],
    polyline[lookAheadIdx][1],
    polyline[lookAheadIdx + 1][0],
    polyline[lookAheadIdx + 1][1]
  );

  // Determine active step index based on traveled distance
  let activeStepIndex = steps.length - 1;
  if (!hasArrived) {
    for (let s = 0; s < steps.length - 1; s++) {
      if (traveledDistanceM < steps[s].turnDistanceM - 2) {
        activeStepIndex = s;
        break;
      }
    }
  }

  const activeStep = steps[activeStepIndex];
  const nextStep =
    activeStepIndex < steps.length - 1 ? steps[activeStepIndex + 1] : null;
  const distanceToNextTurnM = hasArrived
    ? 0
    : Math.max(0, Math.round(activeStep.turnDistanceM - traveledDistanceM));

  return {
    snappedPoint: bestProjected,
    passedPath,
    remainingPath,
    traveledDistanceM,
    totalDistanceM,
    remainingDistanceM,
    remainingMinutes: Math.max(1, Math.ceil(remainingDistanceM / 80)),
    distanceFromPathM: bestDistM,
    currentSegmentBearingDeg,
    activeStepIndex,
    activeStep,
    nextStep,
    distanceToNextTurnM,
    hasArrived,
  };
}

/**
 * Speaks a Thai turn-by-turn instruction using the browser Web Speech API (`th-TH`).
 */
export function speakThaiNavigation(text: string, enabled: boolean): void {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  const clean = text.trim();
  if (!clean) return;

  try {
    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "th-TH";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = synth.getVoices();
    const thaiVoice = voices.find((v) =>
      v.lang.toLowerCase().startsWith("th")
    );
    if (thaiVoice) {
      utterance.voice = thaiVoice;
    }

    synth.speak(utterance);
  } catch {
    // Ignore browser speech errors gracefully
  }
}

export function stopThaiNavigationSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore
  }
}
