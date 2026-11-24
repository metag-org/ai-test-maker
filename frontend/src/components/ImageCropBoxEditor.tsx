import React, { useRef, useState } from 'react';
import type { CropBox, QuestionImage } from '../types';

interface ImageCropBoxEditorProps {
  imageUrl: string;
  existingImages: QuestionImage[];
  activeImageId: string | null;
  onSelectBox: (box: CropBox) => void;
}

export const ImageCropBoxEditor: React.FC<ImageCropBoxEditorProps> = ({
  imageUrl,
  existingImages,
  activeImageId,
  onSelectBox,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<CropBox | null>(null);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1000, Math.round(((e.clientX - rect.left) / rect.width) * 1000)));
    const y = Math.max(0, Math.min(1000, Math.round(((e.clientY - rect.top) / rect.height) * 1000)));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e);
    setDragging(true);
    setStartPt(pt);
    setDraftBox({ ymin: pt.y, xmin: pt.x, ymax: pt.y, xmax: pt.x });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !startPt) return;
    const pt = getNormalizedPoint(e);
    setDraftBox({
      ymin: Math.min(startPt.y, pt.y),
      xmin: Math.min(startPt.x, pt.x),
      ymax: Math.max(startPt.y, pt.y),
      xmax: Math.max(startPt.x, pt.x),
    });
  };

  const handlePointerUp = () => {
    if (!dragging || !draftBox) {
      setDragging(false);
      return;
    }
    setDragging(false);
    setStartPt(null);
    if (draftBox.xmax - draftBox.xmin >= 15 && draftBox.ymax - draftBox.ymin >= 15) {
      onSelectBox(draftBox);
    }
    setDraftBox(null);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-600 flex items-center justify-between">
        <span>原本画像上をドラッグして図版範囲を切り出し／再指定できます</span>
        {activeImageId && (
          <span className="text-indigo-700 font-semibold">選択中の図版を再トリミング中</span>
        )}
      </div>
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative select-none touch-none cursor-crosshair border border-slate-300 rounded-lg overflow-hidden bg-slate-100"
      >
        <img
          src={imageUrl}
          alt="原本画像"
          draggable={false}
          className="w-full h-auto block pointer-events-none"
        />

        {existingImages.map((img, idx) => {
          const box = img.crop_box;
          if (!box || box.xmax === undefined) return null;
          const isActive = img.id === activeImageId;
          return (
            <div
              key={img.id}
              style={{
                top: `${box.ymin / 10}%`,
                left: `${box.xmin / 10}%`,
                height: `${(box.ymax - box.ymin) / 10}%`,
                width: `${(box.xmax - box.xmin) / 10}%`,
              }}
              className={`absolute pointer-events-none border-2 ${
                isActive
                  ? 'border-indigo-600 bg-indigo-500/15'
                  : 'border-emerald-600/80 bg-emerald-400/10'
              }`}
            >
              <span
                className={`inline-block text-[10px] font-bold px-1 text-white ${
                  isActive ? 'bg-indigo-600' : 'bg-emerald-600'
                }`}
              >
                {img.caption || `図${idx + 1}`}
              </span>
            </div>
          );
        })}

        {draftBox && (
          <div
            style={{
              top: `${draftBox.ymin / 10}%`,
              left: `${draftBox.xmin / 10}%`,
              height: `${(draftBox.ymax - draftBox.ymin) / 10}%`,
              width: `${(draftBox.xmax - draftBox.xmin) / 10}%`,
            }}
            className="absolute pointer-events-none border-2 border-dashed border-amber-500 bg-amber-400/20"
          />
        )}
      </div>
    </div>
  );
};
