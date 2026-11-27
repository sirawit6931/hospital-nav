import type { MapNode } from "./api";

export interface SearchSuggestion {
  id: string;
  building: MapNode;
  primaryText: string;
  secondaryText: string;
  matchType: "building" | "keyword" | "floor" | "fuzzy";
  score: number;
}

export interface RankedBuildingMatch {
  building: MapNode;
  score: number;
  matchedHint?: string;
}

/**
 * Strips Thai tone marks (่ ้ ๊ ๋ ์) and normalizes whitespace/case so typos like
 * "ร่มเยน" match "ตึกร่มเย็น" and "เอ็กซเรย" match "เอ็กซ์เรย์".
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u0E48-\u0E4C]/g, "")
    .replace(/[-_/().,•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getBigrams(str: string): Set<string> {
  const clean = str.replace(/\s+/g, "");
  const set = new Set<string>();
  if (clean.length < 2) {
    if (clean.length === 1) set.add(clean);
    return set;
  }
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean.slice(i, i + 2));
  }
  return set;
}

function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const biA = getBigrams(a);
  const biB = getBigrams(b);
  if (biA.size === 0 || biB.size === 0) return 0;

  let intersection = 0;
  for (const g of biA) {
    if (biB.has(g)) intersection++;
  }
  return (2 * intersection) / (biA.size + biB.size);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (Math.abs(m - n) > 3) return 4;

  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function scoreTermMatch(rawQuery: string, normQuery: string, candidate: string): number {
  if (!candidate) return 0;
  const rawCand = candidate.toLowerCase().trim();
  const normCand = normalizeSearchText(candidate);
  if (!normCand) return 0;

  // Exact or prefix match
  if (rawCand === rawQuery || normCand === normQuery) return 100;
  if (rawCand.startsWith(rawQuery) || normCand.startsWith(normQuery)) return 92;

  // Direct substring match
  if (rawCand.includes(rawQuery)) return 86;
  if (normCand.includes(normQuery)) return 80;

  // Multi-word AND match (e.g. "ชั้น 6 ตา" or "ชำระเงิน หัวใจ")
  const queryTokens = normQuery.split(" ").filter((t) => t.length > 0);
  if (queryTokens.length > 1) {
    const matchedTokens = queryTokens.filter((t) => normCand.includes(t));
    if (matchedTokens.length === queryTokens.length) return 78;
    if (matchedTokens.length > 0) {
      return Math.round(45 + (matchedTokens.length / queryTokens.length) * 25);
    }
  }

  // Fuzzy similarity on tokens & full string (handles slight typos)
  if (normQuery.length >= 2) {
    const candTokens = normCand.split(" ").filter((t) => t.length >= 2);
    let bestFuzzy = diceSimilarity(normQuery, normCand);

    for (const token of candTokens) {
      const sim = diceSimilarity(normQuery, token);
      if (sim > bestFuzzy) bestFuzzy = sim;

      if (normQuery.length >= 3 && token.length >= 3) {
        const dist = levenshtein(normQuery, token);
        const maxAllowed = normQuery.length >= 5 ? 2 : 1;
        if (dist <= maxAllowed) {
          const levScore = 1 - dist / Math.max(normQuery.length, token.length);
          if (levScore > bestFuzzy) bestFuzzy = levScore;
        }
      }
    }

    if (bestFuzzy >= 0.42) {
      return Math.round(bestFuzzy * 65);
    }
  }

  return 0;
}

/**
 * Ranks all hospital buildings against the current search query using exact, partial,
 * tone-insensitive Thai, floor-line, and fuzzy near-match scoring.
 */
export function rankBuildingsByQuery(
  buildings: MapNode[],
  query: string
): RankedBuildingMatch[] {
  const rawQuery = query.toLowerCase().trim();
  const normQuery = normalizeSearchText(query);

  if (!normQuery) {
    return buildings.map((building) => ({ building, score: 100 }));
  }

  const ranked: RankedBuildingMatch[] = [];

  for (const building of buildings) {
    let bestScore = scoreTermMatch(rawQuery, normQuery, building.name);
    let matchedHint: string | undefined;

    // Check structured departments attached from /api/buildings
    const depts = building.departments || [];
    for (const dept of depts) {
      const deptLabel = dept.floor ? `${dept.name} (${dept.floor})` : dept.name;
      const deptNameScore = scoreTermMatch(rawQuery, normQuery, dept.name);
      if (deptNameScore > bestScore) {
        bestScore = deptNameScore;
        matchedHint = deptLabel;
      } else if (!matchedHint && deptNameScore >= 58) {
        matchedHint = deptLabel;
      }

      const deptKeywords = (dept.keywords || "")
        .split(/[,|\n;•]+/)
        .map((k) => k.trim())
        .filter(Boolean);
      for (const dkw of deptKeywords) {
        const s = scoreTermMatch(rawQuery, normQuery, dkw);
        if (s > bestScore) {
          bestScore = s;
          matchedHint = deptLabel;
        } else if (!matchedHint && s >= 60) {
          matchedHint = deptLabel;
        }
      }

      const deptCombined = scoreTermMatch(
        rawQuery,
        normQuery,
        `${dept.name} ${dept.floor} ${dept.keywords}`
      );
      if (deptCombined > bestScore) {
        bestScore = deptCombined;
        matchedHint = deptLabel;
      }
    }

    // Check keywords / departments
    const keywords = (building.keywords || "")
      .split(/[,|\n;•]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    for (const kw of keywords) {
      const s = scoreTermMatch(rawQuery, normQuery, kw);
      if (s > bestScore) {
        bestScore = s;
        matchedHint = kw;
      } else if (!matchedHint && s >= 60) {
        matchedHint = kw;
      }
    }

    // Check indoor_guide lines (e.g., "ชั้น 6: หอผู้ป่วยตา (Eye Ward)")
    const guideLines = (building.indoor_guide || "")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of guideLines) {
      const s = scoreTermMatch(rawQuery, normQuery, line);
      if (s > bestScore) {
        bestScore = s;
        matchedHint = line;
      } else if (!matchedHint && s >= 65) {
        matchedHint = line;
      }
    }

    // Also test combined text for multi-word queries spanning building name + department
    const deptCombinedText = depts
      .map((d) => `${d.name} ${d.floor} ${d.keywords}`)
      .join(" ");
    const combinedScore = scoreTermMatch(
      rawQuery,
      normQuery,
      `${building.name} ${building.keywords} ${building.indoor_guide} ${deptCombinedText}`
    );
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
    }

    if (bestScore >= 28) {
      ranked.push({ building, score: bestScore, matchedHint });
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.building.name.localeCompare(b.building.name, "th");
  });

  return ranked;
}

/**
 * Generates concise autocomplete suggestions (building names, matching departments, and floor lines)
 * for instant display in the dropdown while typing.
 */
export function buildSearchSuggestions(
  buildings: MapNode[],
  query: string,
  limit = 6
): SearchSuggestion[] {
  const rawQuery = query.toLowerCase().trim();
  const normQuery = normalizeSearchText(query);
  if (!normQuery) return [];

  const suggestions: SearchSuggestion[] = [];
  const seenBuildingIds = new Set<number>();

  const ranked = rankBuildingsByQuery(buildings, query);

  for (const item of ranked) {
    const b = item.building;
    if (seenBuildingIds.has(b.id)) continue;
    seenBuildingIds.add(b.id);

    const nameScore = scoreTermMatch(rawQuery, normQuery, b.name);
    let matchType: SearchSuggestion["matchType"] = "fuzzy";
    let primaryText = b.name;
    let secondaryText = item.matchedHint || b.keywords.split(",")[0]?.trim() || "";

    if (nameScore >= 70) {
      matchType = "building";
      primaryText = b.name;
      secondaryText = item.matchedHint
        ? `ตรงกับ: ${item.matchedHint}`
        : (b.keywords || "").split(",").slice(0, 3).join(", ");
    } else if (item.matchedHint) {
      matchType = item.matchedHint.includes("ชั้น") ? "floor" : "keyword";
      primaryText = item.matchedHint;
      secondaryText = b.name;
    } else {
      matchType = "fuzzy";
      primaryText = b.name;
      secondaryText = "คำใกล้เคียงที่พบในระบบ";
    }

    suggestions.push({
      id: `sug-${b.id}`,
      building: b,
      primaryText,
      secondaryText,
      matchType,
      score: item.score,
    });

    if (suggestions.length >= limit) break;
  }

  return suggestions;
}

export const QUICK_SEARCH_TERMS = [
  "ตึกร่มเย็น",
  "ตึกร่มธรรม",
  "ฉุกเฉิน ER",
  "หัวใจเพื่อแผ่นดิน",
  "รังสีรักษา / MRI",
  "ศัลยกรรม คลอดผ่าตัด",
  "วิเคราะห์ วิจัย บำบัด",
  "ล้างไต / เอ็กซ์เรย์",
];
