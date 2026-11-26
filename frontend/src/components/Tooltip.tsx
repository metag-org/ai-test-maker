import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  maxWidth?: number;
  className?: string;
}

interface Coords {
  top: number;
  left: number;
  placement: 'top' | 'bottom';
}

function computePosition(rect: DOMRect, preferred: 'top' | 'bottom', maxWidth: number): Coords {
  const margin = 10;
  const vw = window.innerWidth;
  const placement: 'top' | 'bottom' =
    preferred === 'top' && rect.top < 110 ? 'bottom' : preferred;

  const centerX = rect.left + rect.width / 2;
  const half = maxWidth / 2;
  const clampedX = Math.max(half + 12, Math.min(vw - half - 12, centerX));

  return {
    top: placement === 'top' ? rect.top - margin : rect.bottom + margin,
    left: clampedX,
    placement,
  };
}

/**
 * PC のホバー・キーボードフォーカスで表示する軽量ツールチップ。
 * ポータル描画のため親要素の overflow-hidden で切れません。
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  maxWidth = 260,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  const show = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setCoords(computePosition(rect, side, maxWidth));
    setOpen(true);
  }, [side, maxWidth]);

  const hide = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => setOpen(false);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <span
      ref={anchorRef}
      className={`inline-flex items-center ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? tooltipId : undefined}
    >
      {children}
      {open &&
        coords &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              maxWidth,
              transform:
                coords.placement === 'top'
                  ? 'translate(-50%, -100%)'
                  : 'translate(-50%, 0)',
              zIndex: 9999,
            }}
            className="pointer-events-none rounded-xl bg-slate-900/95 px-3 py-2 text-[11px] leading-relaxed font-normal text-white shadow-xl ring-1 ring-white/10 backdrop-blur-sm"
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
};

interface InfoTooltipProps {
  content: React.ReactNode;
  label?: string;
  side?: 'top' | 'bottom';
  maxWidth?: number;
  className?: string;
}

/**
 * PC（ホバー）＋タブレット（タップ開閉）の両対応ヘルプツールチップ。
 * 説明が必要なラベルやスイッチの横に配置し、操作の誤解を防ぎます。
 */
export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  label = '説明を表示',
  side = 'top',
  maxWidth = 280,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    setCoords(computePosition(btnRef.current.getBoundingClientRect(), side, maxWidth));
  }, [side, maxWidth]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setPinned(false);
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <span className={`inline-flex items-center ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => {
          updatePos();
          setOpen(true);
        }}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pinned && open) {
            setPinned(false);
            setOpen(false);
          } else {
            updatePos();
            setPinned(true);
            setOpen(true);
          }
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={popRef}
            id={tooltipId}
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              maxWidth,
              transform:
                coords.placement === 'top'
                  ? 'translate(-50%, -100%)'
                  : 'translate(-50%, 0)',
              zIndex: 9999,
            }}
            className="rounded-xl bg-slate-900/95 px-3 py-2.5 text-[11.5px] leading-relaxed font-normal text-white shadow-xl ring-1 ring-white/15 backdrop-blur-sm"
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
};
