import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';
import { Eraser, PenTool, RotateCcw, Trash2 } from 'lucide-react';
import type { StrokeItem, StrokePoint, StrokesData } from '../types';
import { InfoTooltip, Tooltip } from './Tooltip';

interface HandwritingPadProps {
  mode: 'kanji_grid' | 'freehand';
  cells?: number;
  value: StrokesData;
  penOnly: boolean;
  onTogglePenOnly?: (next: boolean) => void;
  onChange: (nextData: StrokesData, exportedPngDataUrl: string) => void;
  disabled?: boolean;
}

const PEN_SIZES = [
  { label: '細', value: 4 },
  { label: '中', value: 7 },
  { label: '太', value: 11 },
];

const KANJI_CELL_W = 148;
const KANJI_CELL_H = 148;
const FREEHAND_W = 640;
const FREEHAND_H = 190;

function drawStrokeOnCtx(ctx: CanvasRenderingContext2D, stroke: StrokeItem) {
  if (!stroke.points || stroke.points.length === 0) return;
  const pts = stroke.points.map((pt) => [pt.x, pt.y, pt.p ?? 0.5]);
  const outline = getStroke(pts, {
    size: stroke.size || 6,
    thinning: 0.45,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: true,
    last: true,
  });
  if (outline.length === 0) return;

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i += 1) {
    ctx.lineTo(outline[i][0], outline[i][1]);
  }
  ctx.closePath();
  ctx.fill();
}

function pointNearStroke(x: number, y: number, stroke: StrokeItem, radius = 14): boolean {
  const r2 = radius * radius;
  for (const pt of stroke.points) {
    const dx = pt.x - x;
    const dy = pt.y - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

function renderExportPng(
  mode: 'kanji_grid' | 'freehand',
  cellCount: number,
  cellsData: StrokeItem[][],
  freeStrokes: StrokeItem[]
): string {
  if (mode === 'kanji_grid') {
    const hasAny = cellsData.some((arr) => arr.length > 0);
    if (!hasAny) return '';

    const pad = 16;
    const gap = 14;
    const scale = 2;
    const totalW = pad * 2 + cellCount * KANJI_CELL_W + (cellCount - 1) * gap;
    const totalH = pad * 2 + KANJI_CELL_H;

    const canvas = document.createElement('canvas');
    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    for (let i = 0; i < cellCount; i += 1) {
      const ox = pad + i * (KANJI_CELL_W + gap);
      const oy = pad;
      // 各マスの薄い外枠だけ残して文字区切りを明確にする
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox, oy, KANJI_CELL_W, KANJI_CELL_H);

      ctx.save();
      ctx.translate(ox, oy);
      for (const st of cellsData[i] || []) {
        drawStrokeOnCtx(ctx, st);
      }
      ctx.restore();
    }
    return canvas.toDataURL('image/png');
  }

  if (freeStrokes.length === 0) return '';
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = FREEHAND_W * scale;
  canvas.height = FREEHAND_H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, FREEHAND_W, FREEHAND_H);
  for (const st of freeStrokes) {
    drawStrokeOnCtx(ctx, st);
  }
  return canvas.toDataURL('image/png');
}

interface SingleCanvasProps {
  width: number;
  height: number;
  strokes: StrokeItem[];
  guide: 'kanji' | 'lines';
  tool: 'pen' | 'eraser';
  penSize: number;
  penOnly: boolean;
  disabled?: boolean;
  onStrokesChange: (next: StrokeItem[]) => void;
}

const SingleCanvas: React.FC<SingleCanvasProps> = ({
  width,
  height,
  strokes,
  guide,
  tool,
  penSize,
  penOnly,
  disabled,
  onStrokesChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const activeStrokeRef = useRef<StrokeItem | null>(null);
  const strokesRef = useRef<StrokeItem[]>(strokes);
  strokesRef.current = strokes;

  const redraw = useCallback(
    (items: StrokeItem[], liveStroke?: StrokeItem | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // 補助ガイド線（エクスポートPNGには含まれない）
      ctx.save();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      if (guide === 'kanji') {
        ctx.beginPath();
        ctx.moveTo(width / 2, 6);
        ctx.lineTo(width / 2, height - 6);
        ctx.moveTo(6, height / 2);
        ctx.lineTo(width - 6, height / 2);
        ctx.stroke();
      } else {
        const y1 = Math.round(height * 0.48);
        const y2 = Math.round(height * 0.84);
        ctx.beginPath();
        ctx.moveTo(12, y1);
        ctx.lineTo(width - 12, y1);
        ctx.moveTo(12, y2);
        ctx.lineTo(width - 12, y2);
        ctx.stroke();
      }
      ctx.restore();

      for (const st of items) {
        drawStrokeOnCtx(ctx, st);
      }
      if (liveStroke) {
        drawStrokeOnCtx(ctx, liveStroke);
      }
    },
    [width, height, guide]
  );

  useEffect(() => {
    redraw(strokes, null);
  }, [strokes, redraw]);

  const toLocalPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    const p = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      p: Math.round(p * 100) / 100,
    };
  };

  const shouldIgnorePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return true;
    // タッチペン専用モードでもPCのマウスは通す（タブレットでの指・手のひら誤タッチのみ防止）
    if (penOnly && e.pointerType === 'touch') return true;
    if (e.pointerType === 'mouse' && e.button !== 0) return true;
    return false;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (shouldIgnorePointer(e)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toLocalPoint(e);
    drawingRef.current = true;

    if (tool === 'eraser') {
      const remaining = strokesRef.current.filter((st) => !pointNearStroke(pt.x, pt.y, st));
      if (remaining.length !== strokesRef.current.length) {
        onStrokesChange(remaining);
      }
      return;
    }

    const nextStroke: StrokeItem = { points: [pt], size: penSize };
    activeStrokeRef.current = nextStroke;
    redraw(strokesRef.current, nextStroke);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    if (penOnly && e.pointerType === 'touch') return;
    e.preventDefault();
    const pt = toLocalPoint(e);

    if (tool === 'eraser') {
      const remaining = strokesRef.current.filter((st) => !pointNearStroke(pt.x, pt.y, st));
      if (remaining.length !== strokesRef.current.length) {
        onStrokesChange(remaining);
      }
      return;
    }

    if (!activeStrokeRef.current) return;
    activeStrokeRef.current.points.push(pt);
    redraw(strokesRef.current, activeStrokeRef.current);
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (tool === 'pen' && activeStrokeRef.current) {
      const finished = activeStrokeRef.current;
      activeStrokeRef.current = null;
      const next = [...strokesRef.current, finished];
      onStrokesChange(next);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: width,
        aspectRatio: `${width} / ${height}`,
        touchAction: penOnly ? 'pan-y' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      className={`block rounded-xl border-2 bg-white select-none transition ${
        tool === 'eraser'
          ? 'cursor-cell border-amber-300'
          : 'cursor-crosshair border-slate-300 focus:border-indigo-400'
      }`}
    />
  );
};

export const HandwritingPad: React.FC<HandwritingPadProps> = ({
  mode,
  cells = 2,
  value,
  penOnly,
  onTogglePenOnly,
  onChange,
  disabled = false,
}) => {
  const safeCells = Math.max(1, Math.min(6, cells || 2));
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [penSize, setPenSize] = useState<number>(7);
  // 操作履歴（Undo 用に最後に変更したセルインデックスを記憶）
  const [undoStack, setUndoStack] = useState<Array<{ cellIndex?: number; prev: StrokeItem[] }>>([]);

  const normalizedCells: StrokeItem[][] = Array.from({ length: safeCells }, (_, i) =>
    Array.isArray(value?.cells?.[i]) ? value.cells![i] : []
  );
  const freeStrokes: StrokeItem[] = Array.isArray(value?.strokes) ? value.strokes : [];

  const emitKanji = (nextCells: StrokeItem[][]) => {
    const png = renderExportPng('kanji_grid', safeCells, nextCells, []);
    onChange({ mode: 'kanji_grid', cells: nextCells }, png);
  };

  const emitFree = (nextStrokes: StrokeItem[]) => {
    const png = renderExportPng('freehand', 1, [], nextStrokes);
    onChange({ mode: 'freehand', strokes: nextStrokes }, png);
  };

  const handleCellChange = (cellIdx: number, nextCellStrokes: StrokeItem[]) => {
    setUndoStack((prev) => [...prev.slice(-24), { cellIndex: cellIdx, prev: normalizedCells[cellIdx] }]);
    const nextCells = normalizedCells.map((c, idx) => (idx === cellIdx ? nextCellStrokes : c));
    emitKanji(nextCells);
  };

  const handleFreeChange = (nextStrokes: StrokeItem[]) => {
    setUndoStack((prev) => [...prev.slice(-24), { prev: freeStrokes }]);
    emitFree(nextStrokes);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    if (mode === 'kanji_grid' && typeof last.cellIndex === 'number') {
      const nextCells = normalizedCells.map((c, idx) => (idx === last.cellIndex ? last.prev : c));
      emitKanji(nextCells);
    } else if (mode === 'freehand') {
      emitFree(last.prev);
    }
  };

  const handleClearAll = () => {
    if (mode === 'kanji_grid') {
      emitKanji(Array.from({ length: safeCells }, () => []));
    } else {
      emitFree([]);
    }
    setUndoStack([]);
  };

  const hasAnyInk =
    mode === 'kanji_grid'
      ? normalizedCells.some((c) => c.length > 0)
      : freeStrokes.length > 0;

  return (
    <div className="space-y-2.5">
      {/* 手書きツールバー */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip content="ペンモード：マウス・指・タッチペンで解答を書きます。">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setTool('pen')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                tool === 'pen'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              ペン
            </button>
          </Tooltip>

          <Tooltip content="消しゴム：消したい線をなぞると1画単位で消せます。">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setTool('eraser')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                tool === 'eraser'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Eraser className="h-3.5 w-3.5" />
              消しゴム
            </button>
          </Tooltip>

          <div className="mx-1 h-4 w-px bg-slate-200" />

          <div className="inline-flex items-center gap-1">
            {PEN_SIZES.map((s) => (
              <Tooltip key={s.value} content={`ペンの太さ：${s.label}`}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setTool('pen');
                    setPenSize(s.value);
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                    tool === 'pen' && penSize === s.value
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {s.label}
                </button>
              </Tooltip>
            ))}
          </div>

          <div className="mx-1 h-4 w-px bg-slate-200" />

          <Tooltip content="1つ前の操作に戻します（元に戻す）。">
            <button
              type="button"
              disabled={disabled || undoStack.length === 0}
              onClick={handleUndo}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              戻す
            </button>
          </Tooltip>

          <Tooltip content="この問題の手書き内容をすべて消去します。">
            <button
              type="button"
              disabled={disabled || !hasAnyInk}
              onClick={handleClearAll}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              全消去
            </button>
          </Tooltip>
        </div>

        {/* 誤タッチ防止スイッチ（タブレット用） */}
        {onTogglePenOnly && (
          <div className="inline-flex items-center gap-1.5">
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11.5px] font-medium text-slate-600 select-none">
              <input
                type="checkbox"
                checked={penOnly}
                onChange={(e) => onTogglePenOnly(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              ペン専用
            </label>
            <InfoTooltip
              label="ペン専用モードの説明"
              content="タブレットでタッチペンを使うときの誤タッチ防止機能です。ON にすると指や手のひらで画面をスクロールでき、ペン先だけ書けます。指で書く場合や PC マウス操作時は OFF のままで問題ありません。"
            />
          </div>
        )}
      </div>

      {/* 手書きエリア本体 */}
      {mode === 'kanji_grid' ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-start gap-3">
            {normalizedCells.map((cellStrokes, idx) => (
              <div key={idx} className="flex flex-col items-center gap-1">
                <div className="flex items-center justify-between w-full px-0.5">
                  <span className="text-[11px] font-bold text-slate-500">{idx + 1}文字目</span>
                  {cellStrokes.length > 0 && !disabled && (
                    <Tooltip content={`${idx + 1}文字目のマスだけ消去します。`}>
                      <button
                        type="button"
                        onClick={() => handleCellChange(idx, [])}
                        className="text-[10.5px] text-slate-400 hover:text-rose-600 transition"
                      >
                        クリア
                      </button>
                    </Tooltip>
                  )}
                </div>
                <div className="w-[136px] sm:w-[148px]">
                  <SingleCanvas
                    width={KANJI_CELL_W}
                    height={KANJI_CELL_H}
                    strokes={cellStrokes}
                    guide="kanji"
                    tool={tool}
                    penSize={penSize}
                    penOnly={penOnly}
                    disabled={disabled}
                    onStrokesChange={(next) => handleCellChange(idx, next)}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            1マスに1文字ずつ、とめ・はね・はらいをはっきり書いてください。
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <SingleCanvas
            width={FREEHAND_W}
            height={FREEHAND_H}
            strokes={freeStrokes}
            guide="lines"
            tool={tool}
            penSize={penSize}
            penOnly={penOnly}
            disabled={disabled}
            onStrokesChange={handleFreeChange}
          />
          <p className="text-[11px] text-slate-500">
            枠内に大きくはっきり書いてください（長文は右上の「キーボード入力」へ切替も可能です）。
          </p>
        </div>
      )}
    </div>
  );
};
