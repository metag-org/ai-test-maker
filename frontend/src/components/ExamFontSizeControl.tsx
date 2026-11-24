import React from 'react';
import { Minus, Plus, Type } from 'lucide-react';

const STORAGE_KEY = 'review_exam_font_scale';
export const MIN_FONT_SCALE = 0.75;
export const MAX_FONT_SCALE = 1.5;

export const FONT_SCALE_PRESETS = [
  { value: 0.85, label: '小 (85%)' },
  { value: 1.0, label: '標準 (100%)' },
  { value: 1.15, label: 'やや大 (115%)' },
  { value: 1.3, label: '大 (130%)' },
  { value: 1.45, label: '特大 (145%)' },
];

export function clampFontScale(val: number): number {
  if (!Number.isFinite(val)) return 1.0;
  return Math.round(Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, val)) * 100) / 100;
}

export function loadSavedFontScale(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 1.0;
    return clampFontScale(Number(raw));
  } catch {
    return 1.0;
  }
}

export function saveFontScale(val: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampFontScale(val)));
  } catch {
    // ignore storage errors
  }
}

interface ExamFontSizeControlProps {
  value: number;
  onChange: (next: number) => void;
  persist?: boolean;
}

export const ExamFontSizeControl: React.FC<ExamFontSizeControlProps> = ({
  value,
  onChange,
  persist = true,
}) => {
  const pct = Math.round(value * 100);

  const update = (next: number) => {
    const clamped = clampFontScale(next);
    if (persist) saveFontScale(clamped);
    onChange(clamped);
  };

  const isPreset = FONT_SCALE_PRESETS.some((p) => Math.round(p.value * 100) === pct);

  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl border border-slate-300/90 bg-white px-1.5 py-1 text-xs shadow-sm"
      role="group"
      aria-label="問題の文字サイズ調整"
    >
      <span className="inline-flex items-center gap-1 pl-1 pr-0.5 text-slate-500 font-semibold">
        <Type className="w-3.5 h-3.5 text-indigo-600" />
        <span className="hidden sm:inline">文字</span>
      </span>

      <button
        type="button"
        onClick={() => update(value - 0.05)}
        disabled={value <= MIN_FONT_SCALE}
        aria-label="文字サイズを小さくする"
        title="文字を小さく (-5%)"
        className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 transition"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <select
        aria-label="文字サイズを選択"
        value={String(value)}
        onChange={(e) => update(Number(e.target.value))}
        className="bg-transparent font-bold text-slate-800 text-xs px-1 py-0.5 focus:outline-none cursor-pointer tabular-nums"
      >
        {!isPreset && <option value={String(value)}>{pct}%</option>}
        {FONT_SCALE_PRESETS.map((p) => (
          <option key={p.value} value={String(p.value)}>
            {p.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => update(value + 0.05)}
        disabled={value >= MAX_FONT_SCALE}
        aria-label="文字サイズを大きくする"
        title="文字を大きく (+5%)"
        className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-35 transition"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
