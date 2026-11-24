import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookMarked,
  Check,
  FlaskConical,
  Globe2,
  Minus,
  Plus,
  Printer,
  Shuffle,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import {
  ExamFontSizeControl,
  loadSavedFontScale,
} from '../components/ExamFontSizeControl';
import { RichJapaneseText } from '../components/RichJapaneseText';
import type {
  ExamCandidateSelection,
  FacetsResponse,
  QuestionGroup,
  SubjectType,
} from '../types';
import { SUBJECT_LABELS } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';

export const ExamBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const [facets, setFacets] = useState<FacetsResponse | null>(null);
  const [allGroups, setAllGroups] = useState<QuestionGroup[]>([]);

  // 抽出条件
  const [kokugoCount, setKokugoCount] = useState(10);
  const [rikaCount, setRikaCount] = useState(2);
  const [shakaiCount, setShakaiCount] = useState(2);
  const [sourceFilter, setSourceFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [excludeDays, setExcludeDays] = useState(7);
  const [prioritizeWrong, setPrioritizeWrong] = useState(true);

  // テスト情報
  const todayStr = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(`確認テスト ${todayStr}`);
  const [paperSize, setPaperSize] = useState<'B4' | 'A4'>('B4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [twoColumns, setTwoColumns] = useState(true);
  const [fontScale, setFontScale] = useState<number>(() => loadSavedFontScale());

  // 抽出候補リスト
  const [selections, setSelections] = useState<ExamCandidateSelection[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getFacets(), api.listGroups({ status: 'published' })]).then(([f, list]) => {
      setFacets(f);
      setAllGroups(list.items);
    });
  }, []);

  const applyPreset = (k: number, r: number, s: number, presetTitle: string) => {
    setKokugoCount(k);
    setRikaCount(r);
    setShakaiCount(s);
    setTitle(`${presetTitle} ${todayStr}`);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.generateExamCandidates({
        kokugo_count: kokugoCount,
        rika_count: rikaCount,
        shakai_count: shakaiCount,
        source_filter: sourceFilter,
        tag_filter: tagFilter,
        exclude_days: excludeDays,
        prioritize_wrong: prioritizeWrong,
      });
      setSelections(res.selections);
      if (res.selections.length === 0) {
        setError('条件に一致する登録済み問題が見つかりませんでした。先に問題を登録してください。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '抽出に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const moveSelection = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= selections.length) return;
    const copy = [...selections];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setSelections(copy);
  };

  const removeSelection = (idx: number) => {
    setSelections((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleQuestionInSelection = (selIdx: number, qId: string) => {
    setSelections((prev) =>
      prev
        .map((sel, i) => {
          if (i !== selIdx) return sel;
          const exists = sel.selected_question_ids.includes(qId);
          const nextIds = exists
            ? sel.selected_question_ids.filter((id) => id !== qId)
            : [...sel.selected_question_ids, qId];
          return { ...sel, selected_question_ids: nextIds };
        })
        .filter((sel) => sel.selected_question_ids.length > 0)
    );
  };

  const addGroupManually = (grp: QuestionGroup) => {
    if (selections.some((s) => s.group.id === grp.id)) return;
    setSelections((prev) => [
      ...prev,
      {
        group: grp,
        selected_question_ids: grp.questions.map((q) => q.id),
      },
    ]);
  };

  const handleCreateExam = async () => {
    if (selections.length === 0) {
      setError('出題する問題が選ばれていません。');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const created = await api.createExam({
        title,
        paper_size: paperSize,
        layout_config: {
          orientation,
          two_columns: twoColumns,
          font_scale: fontScale,
        },
        selections: selections.map((s) => ({
          group_id: s.group.id,
          subject: s.group.subject,
          question_ids: s.selected_question_ids,
        })),
      });
      navigate(`/exams/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'テストの作成に失敗しました。');
    } finally {
      setCreating(false);
    }
  };

  const totalQuestions = selections.reduce((sum, s) => sum + s.selected_question_ids.length, 0);

  const countCards: {
    subject: SubjectType;
    label: string;
    unit: string;
    value: number;
    max: number;
    setValue: (v: number) => void;
    icon: React.FC<{ className?: string }>;
  }[] = [
    {
      subject: 'kokugo',
      label: '国語（漢字）',
      unit: '小問数',
      value: kokugoCount,
      max: 60,
      setValue: setKokugoCount,
      icon: BookMarked,
    },
    {
      subject: 'rika',
      label: '理科',
      unit: '大問数',
      value: rikaCount,
      max: 20,
      setValue: setRikaCount,
      icon: FlaskConical,
    },
    {
      subject: 'shakai',
      label: '社会',
      unit: '大問数',
      value: shakaiCount,
      max: 20,
      setValue: setShakaiCount,
      icon: Globe2,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-900">
            テスト作成（問題抽出・組合せ）
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            国語（縦書き）・理科・社会（横書き）を自由に組み合わせて B4 / A4 印刷用テストを作成します。
          </p>
        </div>

        {/* プリセットボタン */}
        <div className="flex-balance items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 inline-flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            プリセット:
          </span>
          <button
            type="button"
            onClick={() => applyPreset(10, 0, 0, '漢字ミニテスト')}
            className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition"
          >
            漢字10問
          </button>
          <button
            type="button"
            onClick={() => applyPreset(0, 2, 2, '理社復習テスト')}
            className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition"
          >
            理社セット
          </button>
          <button
            type="button"
            onClick={() => applyPreset(10, 2, 2, '3科目総合確認テスト')}
            className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
          >
            3科目総合
          </button>
        </div>
      </div>

      {/* 1. 抽出ルール設定 */}
      <section className="ui-card p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-xs font-extrabold text-indigo-700">
            1
          </span>
          自動抽出ルール
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {countCards.map(({ subject: s, label, unit, value, max, setValue, icon: Icon }) => {
            const theme = SUBJECT_THEME[s];
            const available = facets?.published_counts?.[s] ?? 0;
            return (
              <div
                key={s}
                className={`rounded-2xl border p-4 space-y-3 ${theme.softBgClass} ${theme.borderClass}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-xl ${theme.iconBgClass}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-slate-900">{label}</div>
                      <div className="text-[11px] text-slate-500">登録済: {available} 大問</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">{unit}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`${label}を減らす`}
                    onClick={() => setValue(Math.max(0, value - 1))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    id={`count-${s}`}
                    type="number"
                    min={0}
                    max={max}
                    value={value}
                    onChange={(e) => setValue(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
                    aria-label={`${label}の${unit}`}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 text-center text-base font-extrabold text-slate-900 tabular-nums focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`${label}を増やす`}
                    onClick={() => setValue(Math.min(max, value + 1))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="builder-source-filter" className="block text-xs font-semibold text-slate-700 mb-1.5">
              教材絞り込み（任意）
            </label>
            <select
              id="builder-source-filter"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="ui-select w-full"
            >
              <option value="">指定なし</option>
              {(facets?.sources || []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="builder-tag-filter" className="block text-xs font-semibold text-slate-700 mb-1.5">
              タグ絞り込み（任意）
            </label>
            <select
              id="builder-tag-filter"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="ui-select w-full"
            >
              <option value="">指定なし</option>
              {(facets?.tags || []).map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="builder-exclude-days" className="block text-xs font-semibold text-slate-700 mb-1.5">
              直近の出題を除外（日数）
            </label>
            <input
              id="builder-exclude-days"
              type="number"
              min={0}
              max={365}
              value={excludeDays}
              onChange={(e) => setExcludeDays(Number(e.target.value) || 0)}
              className="ui-input"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <label
            htmlFor="prioritize-wrong-checkbox"
            className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-medium"
          >
            <input
              id="prioritize-wrong-checkbox"
              type="checkbox"
              checked={prioritizeWrong}
              onChange={(e) => setPrioritizeWrong(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>「要復習・間違えた問題」を優先して抽出する</span>
          </label>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              aria-expanded={showPicker}
              className="ui-btn-secondary"
            >
              <Plus className="w-4 h-4 text-indigo-600" />
              {showPicker ? '手動追加を閉じる' : '手動で問題を追加'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleGenerate}
              className="ui-btn-primary"
            >
              <Shuffle className="w-4 h-4" />
              {loading ? '抽出中...' : '条件で自動抽出する'}
            </button>
          </div>
        </div>
      </section>

      {/* 手動追加ピッカー */}
      {showPicker && (
        <section className="ui-card p-5 space-y-3 border-indigo-200/80 bg-indigo-50/20">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-800">
              問題バンクから手動で追加（{allGroups.length}件）
            </h2>
            <button
              type="button"
              onClick={() => setShowPicker(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              閉じる
            </button>
          </div>
          {allGroups.length === 0 ? (
            <div className="text-xs text-slate-500 py-4 text-center">
              登録済みの問題がまだありません。
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1 scroll-contain">
              {allGroups.map((g) => {
                const added = selections.some((s) => s.group.id === g.id);
                const theme = SUBJECT_THEME[g.subject] || SUBJECT_THEME.rika;
                return (
                  <div
                    key={g.id}
                    className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/90 text-xs shadow-sm"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full font-bold shrink-0 ${theme.badgeClass}`}>
                        {SUBJECT_LABELS[g.subject]}
                      </span>
                      {g.source_name && (
                        <span className="text-slate-500 font-medium shrink-0">{g.source_name}</span>
                      )}
                      <span className="truncate text-slate-700">
                        {g.lead_text || g.questions[0]?.body || '(問題)'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addGroupManually(g)}
                      className={`px-3 py-1.5 rounded-lg font-bold shrink-0 transition ${
                        added
                          ? 'bg-slate-100 text-slate-400'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                      {added ? '追加済み' : '+ 追加'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. 抽出結果のプレビューと手動微調整 + 印刷用紙設定 */}
      {selections.length > 0 && (
        <section className="ui-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-xs font-extrabold text-emerald-700">
                2
              </span>
              出題内容の確認・微調整
              <span className="ml-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700">
                計 {selections.length} 大問 / {totalQuestions} 小問
              </span>
            </div>
            <span className="text-xs text-slate-500">
              印刷時は自動で「国語（縦書き）→ 理科 → 社会」の順に改ページされます
            </span>
          </div>

          <div className="space-y-3">
            {selections.map((sel, idx) => {
              const theme = SUBJECT_THEME[sel.group.subject] || SUBJECT_THEME.rika;
              return (
                <div
                  key={`${sel.group.id}-${idx}`}
                  className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs ${theme.badgeClass}`}>
                        {SUBJECT_LABELS[sel.group.subject]}
                      </span>
                      <span className="text-slate-900">{sel.group.source_name || '(出典なし)'}</span>
                      <span className="text-xs font-medium text-slate-500">
                        選択小問: {sel.selected_question_ids.length} / {sel.group.questions.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveSelection(idx, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 transition"
                        title="上へ"
                        aria-label="上へ移動"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSelection(idx, 1)}
                        disabled={idx === selections.length - 1}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 transition"
                        title="下へ"
                        aria-label="下へ移動"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSelection(idx)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition"
                        title="除外"
                        aria-label="この大問を除外"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {sel.group.lead_text && (
                    <div className="text-xs text-slate-700 line-clamp-2 font-exam bg-white/80 rounded-xl px-3 py-2 border border-slate-100">
                      <RichJapaneseText text={sel.group.lead_text} />
                    </div>
                  )}

                  <div className="space-y-1.5 pl-1">
                    {sel.group.questions.map((q, qIdx) => {
                      const checked = sel.selected_question_ids.includes(q.id);
                      return (
                        <label
                          key={q.id}
                          className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer py-0.5"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleQuestionInSelection(idx, q.id)}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                          />
                          <span className={checked ? 'leading-relaxed' : 'line-through text-slate-400'}>
                            <strong className="mr-1 text-slate-500">({qIdx + 1})</strong>
                            <RichJapaneseText text={q.body} />
                            {q.needs_review && (
                              <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                                要復習
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* テスト名・用紙サイズ（ラジオカード採用） */}
          <div className="pt-4 border-t border-slate-200/80 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-5">
              <label htmlFor="exam-title-input" className="block text-xs font-bold text-slate-700 mb-1.5">
                テストタイトル
              </label>
              <input
                id="exam-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="ui-input"
              />
            </div>

            <fieldset className="lg:col-span-3">
              <legend className="text-xs font-bold text-slate-700 mb-1.5">用紙サイズ</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['B4', 'A4'] as const).map((size) => {
                  const active = paperSize === size;
                  return (
                    <label
                      key={size}
                      className={`radio-card cursor-pointer rounded-xl border-2 px-3 py-2 text-center text-xs font-bold transition ${
                        active
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paper_size"
                        value={size}
                        checked={active}
                        onChange={() => setPaperSize(size)}
                        className="visually-hidden"
                      />
                      <span className="inline-flex items-center gap-1">
                        {active && <Check className="w-3 h-3" />}
                        {size}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="lg:col-span-4">
              <legend className="text-xs font-bold text-slate-700 mb-1.5">用紙の向き</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'landscape' as const, label: '横向き（推奨）' },
                  { value: 'portrait' as const, label: '縦向き' },
                ].map((opt) => {
                  const active = orientation === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`radio-card cursor-pointer rounded-xl border-2 px-3 py-2 text-center text-xs font-bold transition ${
                        active
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="orientation"
                        value={opt.value}
                        checked={active}
                        onChange={() => setOrientation(opt.value)}
                        className="visually-hidden"
                      />
                      <span className="inline-flex items-center gap-1">
                        {active && <Check className="w-3 h-3" />}
                        {opt.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="two-columns-checkbox"
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                <input
                  id="two-columns-checkbox"
                  type="checkbox"
                  checked={twoColumns}
                  onChange={(e) => setTwoColumns(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span>理科・社会を2段組レイアウトで印刷する</span>
              </label>
              <ExamFontSizeControl value={fontScale} onChange={setFontScale} />
            </div>

            <button
              type="button"
              disabled={creating}
              onClick={handleCreateExam}
              className="ui-btn-emerald px-6 py-3"
            >
              <Printer className="w-4 h-4" />
              {creating ? '作成中...' : 'テストを確定して印刷画面へ'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
