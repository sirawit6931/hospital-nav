"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CornerDownLeft,
  MapPin,
  Navigation,
  Search,
  X,
} from "lucide-react";
import type { Category, MapNode } from "@/lib/api";
import { classifyBuilding } from "@/lib/hospital";
import {
  QUICK_SEARCH_TERMS,
  buildSearchSuggestions,
  type SearchSuggestion,
} from "@/lib/search";

interface BuildingSearchBarProps {
  value: string;
  allBuildings: MapNode[];
  categories?: Category[];
  onChange: (nextValue: string) => void;
  onSubmit: (query: string) => void;
  onClear: () => void;
  onSelectSuggestion: (building: MapNode, fillText: string) => void;
  onRouteSuggestion: (building: MapNode) => void;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  if (parts.length <= 1) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === trimmed.toLowerCase() ? (
          <mark
            key={i}
            className="bg-[#CCFBF1] text-[#0F766E] font-bold rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function BuildingSearchBar({
  value,
  allBuildings,
  categories,
  onChange,
  onSubmit,
  onClear,
  onSelectSuggestion,
  onRouteSuggestion,
}: BuildingSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo<SearchSuggestion[]>(
    () => buildSearchSuggestions(allBuildings, value, 6),
    [allBuildings, value]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1
      );
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      const picked = suggestions[highlightedIndex];
      if (picked) {
        onSelectSuggestion(picked.building, picked.building.name);
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsOpen(false);
    setHighlightedIndex(-1);
    onSubmit(value.trim());
  };

  const hasTyped = value.trim().length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={value}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              onChange(e.target.value);
              setIsOpen(true);
              setHighlightedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder="พิมพ์ชื่อตึก, แผนก เช่น ร่มเย็น, NICU, ตา, MRI"
            aria-label="ค้นหาอาคารหรือแผนก"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            autoComplete="off"
            className="w-full min-h-[48px] pl-11 pr-10 rounded-xl bg-white border border-slate-200 text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-teal-600/15"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setHighlightedIndex(-1);
              }}
              aria-label="ล้างคำค้นหา"
              className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="submit"
          className="min-h-[48px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-semibold shrink-0 shadow-sm transition-colors cursor-pointer"
        >
          ค้นหา
        </button>
      </form>

      {/* Autocomplete Suggestions Dropdown */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[600] rounded-2xl bg-white border border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.14)] overflow-hidden"
        >
          {!hasTyped ? (
            /* Quick popular department suggestions when focused & empty */
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-slate-500">
                  คำค้นหายอดนิยม (แตะเพื่อค้นหาทันที)
                </span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  ปิด
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_SEARCH_TERMS.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      onChange(term);
                      setIsOpen(true);
                    }}
                    className="min-h-[38px] px-3 rounded-xl bg-slate-50 hover:bg-[#CCFBF1] border border-slate-200 hover:border-teal-300 text-xs font-semibold text-slate-700 hover:text-[#0F766E] transition-colors cursor-pointer"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="py-1.5">
              <div className="px-3.5 py-1.5 flex items-center justify-between border-b border-slate-100">
                <span className="text-[11px] font-bold text-slate-500">
                  ตัวเลือกใกล้เคียง ({suggestions.length} รายการ)
                </span>
                <span className="text-[11px] text-slate-400 hidden sm:inline-flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" />
                  <span>กดเพื่อเลือก</span>
                </span>
              </div>

              <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                {suggestions.map((item, idx) => {
                  const badge = classifyBuilding(item.building, categories);
                  const isHighlighted = idx === highlightedIndex;

                  return (
                    <li
                      key={item.id}
                      role="option"
                      aria-selected={isHighlighted}
                      className={`flex items-center justify-between gap-2 px-3 py-2.5 transition-colors ${
                        isHighlighted ? "bg-teal-50/90" : "hover:bg-slate-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectSuggestion(item.building, item.building.name);
                          setIsOpen(false);
                          setHighlightedIndex(-1);
                        }}
                        className="flex-1 min-w-0 flex items-start gap-2.5 text-left cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F766E] flex items-center justify-center shrink-0 mt-0.5">
                          {item.matchType === "building" ||
                          item.matchType === "fuzzy" ? (
                            <Building2 className="w-4 h-4" />
                          ) : (
                            <MapPin className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-[#0F172A] leading-snug">
                              <HighlightMatch
                                text={item.primaryText}
                                query={value}
                              />
                            </span>
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border"
                              style={{
                                color: badge.badgeStyle.text,
                                backgroundColor: badge.badgeStyle.bg,
                                borderColor: badge.badgeStyle.border,
                              }}
                            >
                              {badge.badgeLabel}
                            </span>
                          </div>
                          {item.secondaryText && (
                            <p className="text-xs text-slate-500 truncate mt-0.5">
                              <HighlightMatch
                                text={item.secondaryText}
                                query={value}
                              />
                            </p>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setIsOpen(false);
                          setHighlightedIndex(-1);
                          onRouteSuggestion(item.building);
                        }}
                        title={`นำทางไป ${item.building.name}`}
                        aria-label={`นำทางไป ${item.building.name}`}
                        className="min-h-[38px] px-2.5 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">นำทาง</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="px-4 py-4 text-center space-y-1">
              <p className="text-sm font-semibold text-slate-700">
                ไม่พบอาคารหรือแผนกที่ใกล้เคียงกับ &ldquo;{value}&rdquo;
              </p>
              <p className="text-xs text-slate-500">
                ลองพิมพ์คำสั้นลง เช่น &ldquo;ร่มเย็น&rdquo;, &ldquo;ฉุกเฉิน&rdquo;, &ldquo;รับยา&rdquo;, หรือ &ldquo;MRI&rdquo;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
