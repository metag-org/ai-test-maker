import type { SubjectType } from '../types';

export interface SubjectVisualTheme {
  label: string;
  shortLabel: string;
  desc: string;
  layoutHint: string;
  badgeClass: string;
  softBgClass: string;
  borderClass: string;
  activeCardClass: string;
  accentBarClass: string;
  iconBgClass: string;
  ringClass: string;
  countTextClass: string;
}

export const SUBJECT_THEME: Record<SubjectType, SubjectVisualTheme> = {
  kokugo: {
    label: '国語（漢字）',
    shortLabel: '国語',
    desc: '書き取り・読み・傍線問題',
    layoutHint: '縦書き・漢字マス印刷',
    badgeClass: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/80',
    softBgClass: 'bg-rose-50/70',
    borderClass: 'border-rose-200/80',
    activeCardClass:
      'border-rose-500 bg-gradient-to-br from-rose-50 via-white to-rose-50/40 shadow-md shadow-rose-100/80 ring-2 ring-rose-500/20',
    accentBarClass: 'bg-rose-500',
    iconBgClass: 'bg-rose-100 text-rose-700',
    ringClass: 'focus-within:ring-rose-500/30',
    countTextClass: 'text-rose-700',
  },
  rika: {
    label: '理科',
    shortLabel: '理科',
    desc: '実験図・グラフ・選択／記述',
    layoutHint: '横書き・図版付き2段組',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/80',
    softBgClass: 'bg-emerald-50/70',
    borderClass: 'border-emerald-200/80',
    activeCardClass:
      'border-emerald-500 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40 shadow-md shadow-emerald-100/80 ring-2 ring-emerald-500/20',
    accentBarClass: 'bg-emerald-500',
    iconBgClass: 'bg-emerald-100 text-emerald-700',
    ringClass: 'focus-within:ring-emerald-500/30',
    countTextClass: 'text-emerald-700',
  },
  shakai: {
    label: '社会',
    shortLabel: '社会',
    desc: '地図・年表・統計・選択／記述',
    layoutHint: '横書き・資料付き2段組',
    badgeClass: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/90',
    softBgClass: 'bg-amber-50/70',
    borderClass: 'border-amber-200/80',
    activeCardClass:
      'border-amber-500 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 shadow-md shadow-amber-100/80 ring-2 ring-amber-500/20',
    accentBarClass: 'bg-amber-500',
    iconBgClass: 'bg-amber-100 text-amber-700',
    ringClass: 'focus-within:ring-amber-500/30',
    countTextClass: 'text-amber-700',
  },
  sansu: {
    label: '算数',
    shortLabel: '算数',
    desc: '計算・図形・文章題',
    layoutHint: '横書きレイアウト',
    badgeClass: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/80',
    softBgClass: 'bg-sky-50/70',
    borderClass: 'border-sky-200/80',
    activeCardClass:
      'border-sky-500 bg-gradient-to-br from-sky-50 via-white to-sky-50/40 shadow-md shadow-sky-100/80 ring-2 ring-sky-500/20',
    accentBarClass: 'bg-sky-500',
    iconBgClass: 'bg-sky-100 text-sky-700',
    ringClass: 'focus-within:ring-sky-500/30',
    countTextClass: 'text-sky-700',
  },
};
