import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Keyboard,
  LayoutList,
  Loader2,
  Maximize2,
  Pause,
  PenLine,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  SquareStack,
  X,
} from 'lucide-react';
import { api, uploadUrl } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HandwritingPad } from '../components/HandwritingPad';
import { RichJapaneseText } from '../components/RichJapaneseText';
import { useToast } from '../components/ToastProvider';
import { InfoTooltip, Tooltip } from '../components/Tooltip';
import type {
  ExamAnswer,
  ExamSubmissionDetail,
  ExamSubmissionSummary,
  InputMode,
  QuestionGroup,
  StrokesData,
  SubjectType,
  SubmissionItemBundle,
} from '../types';
import { QUESTION_TYPE_LABELS, SUBJECT_LABELS } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';

interface FlatSolveItem {
  globalIndex: number;
  subject: SubjectType;
  group: QuestionGroup;
  sectionIndex: number;
  itemIndexInGroup: number;
  bundle: SubmissionItemBundle;
}

interface LocalDraft {
  input_mode: InputMode;
  selected_options: string[];
  typed_text: string;
  strokes_data: StrokesData;
  image_data_url?: string | null;
  hasImageOnServer?: boolean;
}

function hasAnyInk(strokes: StrokesData | undefined): boolean {
  if (!strokes) return false;
  if (Array.isArray(strokes.cells)) {
    return strokes.cells.some((c) => Array.isArray(c) && c.length > 0);
  }
  if (Array.isArray(strokes.strokes)) {
    return strokes.strokes.length > 0;
  }
  return false;
}

function isDraftAnswered(d: LocalDraft | undefined): boolean {
  if (!d) return false;
  if (d.input_mode === 'choice') return d.selected_options.length > 0;
  if (d.input_mode === 'text') return d.typed_text.trim().length > 0;
  return hasAnyInk(d.strokes_data) || Boolean(d.image_data_url) || Boolean(d.hasImageOnServer);
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const ExamSolvePage: React.FC = () => {
  const { id: examId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const submissionIdParam = searchParams.get('submissionId');
  const startModeParam = searchParams.get('mode') as 'full' | 'wrong_only' | null;

  const [submission, setSubmission] = useState<ExamSubmissionDetail | null>(null);
  const [existingSubs, setExistingSubs] = useState<ExamSubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  // 作答ローカル状態
  const [drafts, setDrafts] = useState<Record<string, LocalDraft>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [viewMode, setViewMode] = useState<'single' | 'all'>('single');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [penOnly, setPenOnly] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [timerPaused, setTimerPaused] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [zoomImg, setZoomImg] = useState<{ src: string; caption: string } | null>(null);
  const [showScratch, setShowScratch] = useState(false);
  const [scratchData, setScratchData] = useState<StrokesData>({ mode: 'freehand', strokes: [] });

  const saveTimersRef = useRef<Record<string, number>>({});
  const pendingSavesRef = useRef<Set<Promise<unknown>>>(new Set());
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsedSec;

  const hydrateSubmission = useCallback((detail: ExamSubmissionDetail) => {
    setSubmission(detail);
    setElapsedSec(detail.duration_seconds || 0);
    const map: Record<string, LocalDraft> = {};
    const subjOrder: SubjectType[] = ['kokugo', 'rika', 'shakai', 'sansu'];
    for (const subj of subjOrder) {
      for (const sec of detail.sections[subj] || []) {
        for (const b of sec.items) {
          map[b.exam_item.id] = {
            input_mode: b.answer.input_mode,
            selected_options: b.answer.selected_options || [],
            typed_text: b.answer.typed_text || '',
            strokes_data: b.answer.strokes_data || {},
            hasImageOnServer: Boolean(b.answer.handwriting_image_path),
          };
        }
      }
    }
    setDrafts(map);
    setCurrentIdx(0);
  }, []);

  const startNewAttempt = useCallback(
    async (mode: 'full' | 'wrong_only') => {
      if (!examId) return;
      setStarting(true);
      setError('');
      try {
        const created = await api.createSubmission(examId, mode);
        setSearchParams({ submissionId: created.id }, { replace: true });
        hydrateSubmission(created);
        showToast(
          `第${created.attempt_number}回（${mode === 'wrong_only' ? '間違い再挑戦' : '全問'}）を開始しました。`,
          'success'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'オンライン解答の開始に失敗しました。';
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setStarting(false);
      }
    },
    [examId, hydrateSubmission, setSearchParams, showToast]
  );

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      setError('');
      try {
        if (submissionIdParam) {
          const detail = await api.getSubmission(submissionIdParam);
          if (cancelled) return;
          if (detail.status === 'graded' || detail.status === 'reviewed') {
            navigate(`/exams/${examId}/submissions/${detail.id}`, { replace: true });
            return;
          }
          hydrateSubmission(detail);
          return;
        }

        if (startModeParam === 'full' || startModeParam === 'wrong_only') {
          const created = await api.createSubmission(examId, startModeParam);
          if (cancelled) return;
          setSearchParams({ submissionId: created.id }, { replace: true });
          hydrateSubmission(created);
          return;
        }

        const list = await api.listExamSubmissions(examId);
        if (cancelled) return;
        setExistingSubs(list);

        // まだ1回も解答履歴がない場合は即座に第1回を開始
        if (list.length === 0) {
          const created = await api.createSubmission(examId, 'full');
          if (cancelled) return;
          setSearchParams({ submissionId: created.id }, { replace: true });
          hydrateSubmission(created);
          return;
        }

        // 進行中の記録があれば自動再開候補としてスタート画面を表示（または新規開始選択）
        setSubmission(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [examId, submissionIdParam, startModeParam, hydrateSubmission, navigate, setSearchParams]);

  // タイマー
  useEffect(() => {
    if (!submission || submission.status !== 'in_progress' || timerPaused || submitting) return;
    const t = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [submission, timerPaused, submitting]);

  // アンマウント時にデバウンスタイマーを掃除
  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const flatItems: FlatSolveItem[] = useMemo(() => {
    if (!submission) return [];
    const list: FlatSolveItem[] = [];
    const order: SubjectType[] = ['kokugo', 'rika', 'shakai', 'sansu'];
    for (const subj of order) {
      const secs = submission.sections[subj] || [];
      secs.forEach((sec, sIdx) => {
        sec.items.forEach((bundle, iIdx) => {
          list.push({
            globalIndex: list.length,
            subject: subj,
            group: sec.group,
            sectionIndex: sIdx,
            itemIndexInGroup: iIdx,
            bundle,
          });
        });
      });
    }
    return list;
  }, [submission]);

  const flushSaveAnswer = useCallback(
    async (subId: string, examItemId: string, draft: LocalDraft) => {
      setSaveState('saving');
      const p = api
        .saveSubmissionAnswer(subId, examItemId, {
          input_mode: draft.input_mode,
          selected_options: draft.selected_options,
          typed_text: draft.typed_text,
          strokes_data: draft.strokes_data,
          image_data_url: draft.image_data_url,
          duration_seconds: elapsedRef.current,
        })
        .then((saved: ExamAnswer) => {
          setDrafts((prev) => {
            const cur = prev[examItemId];
            if (!cur) return prev;
            return {
              ...prev,
              [examItemId]: {
                ...cur,
                hasImageOnServer: Boolean(saved.handwriting_image_path),
              },
            };
          });
          setSaveState('saved');
        })
        .catch(() => {
          setSaveState('error');
        });
      pendingSavesRef.current.add(p);
      try {
        await p;
      } finally {
        pendingSavesRef.current.delete(p);
      }
    },
    []
  );

  const scheduleSave = useCallback(
    (examItemId: string, nextDraft: LocalDraft, immediate = false) => {
      if (!submission) return;
      if (saveTimersRef.current[examItemId]) {
        window.clearTimeout(saveTimersRef.current[examItemId]);
      }
      if (immediate) {
        void flushSaveAnswer(submission.id, examItemId, nextDraft);
      } else {
        saveTimersRef.current[examItemId] = window.setTimeout(() => {
          delete saveTimersRef.current[examItemId];
          void flushSaveAnswer(submission.id, examItemId, nextDraft);
        }, 450);
      }
    },
    [submission, flushSaveAnswer]
  );

  const updateDraft = (examItemId: string, patch: Partial<LocalDraft>, immediate = false) => {
    setDrafts((prev) => {
      const cur: LocalDraft = prev[examItemId] || {
        input_mode: 'handwriting',
        selected_options: [],
        typed_text: '',
        strokes_data: {},
      };
      const next: LocalDraft = { ...cur, ...patch };
      scheduleSave(examItemId, next, immediate);
      return { ...prev, [examItemId]: next };
    });
  };

  const handleSubmitExam = async () => {
    if (!submission || !examId) return;
    setSubmitDialogOpen(false);
    setSubmitting(true);
    try {
      // 未送信デバウンス分を即時フラッシュ
      const pendingEntries = Object.keys(saveTimersRef.current);
      for (const itemId of pendingEntries) {
        window.clearTimeout(saveTimersRef.current[itemId]);
        delete saveTimersRef.current[itemId];
        if (drafts[itemId]) {
          await flushSaveAnswer(submission.id, itemId, drafts[itemId]);
        }
      }
      if (pendingSavesRef.current.size > 0) {
        await Promise.all(Array.from(pendingSavesRef.current));
      }

      const graded = await api.submitSubmission(submission.id, elapsedRef.current);
      setSubmitDialogOpen(false);
      showToast('自動採点が完了しました！結果を確認しましょう。', 'success');
      navigate(`/exams/${examId}/submissions/${graded.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '提出・採点に失敗しました。', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const answeredCount = useMemo(
    () => flatItems.filter((it) => isDraftAnswered(drafts[it.bundle.exam_item.id])).length,
    [flatItems, drafts]
  );

  if (loading) {
    return (
      <div className="ui-card p-12 text-center space-y-3">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600 mx-auto" />
        <p className="text-sm font-medium text-slate-600">オンラインテストを準備中...</p>
      </div>
    );
  }

  // 既に履歴があるテストの開始ランチャー（再開 / 全問再挑戦 / 間違いだけ再挑戦）
  if (!submission) {
    const inProgressSub = existingSubs.find((s) => s.status === 'in_progress');
    const latestGraded = existingSubs.find((s) => s.status === 'graded' || s.status === 'reviewed');
    const hasWrongToRetry =
      latestGraded && (latestGraded.wrong_count > 0 || latestGraded.uncertain_count > 0);

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/exams" className="ui-btn-secondary px-3 py-1.5 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            テスト履歴へ戻る
          </Link>
          <Link to={`/exams/${examId}`} className="text-xs font-semibold text-indigo-600 hover:underline">
            印刷・PDF表示へ
          </Link>
        </div>

        <div className="ui-card p-6 sm:p-8 space-y-6">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200">
              <PenLine className="w-3.5 h-3.5" />
              オンライン解答モード
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
              どのモードで取り組みますか？
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              このテストは複数回オンラインで解き直せます。過去の手書き記録や点数もそのまま残ります。
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3.5">
            {inProgressSub && (
              <button
                type="button"
                onClick={() => setSearchParams({ submissionId: inProgressSub.id })}
                className="sm:col-span-2 flex items-center justify-between gap-4 rounded-2xl border-2 border-indigo-500 bg-indigo-50/70 p-4 text-left hover:bg-indigo-50 transition"
              >
                <div>
                  <div className="text-sm font-bold text-indigo-900">
                    途中の第{inProgressSub.attempt_number}回を再開する
                  </div>
                  <div className="text-xs text-indigo-700 mt-0.5">
                    途中まで自動保存された手書き・選択状態からそのまま続きを書けます。
                  </div>
                </div>
                <span className="ui-btn-primary text-xs shrink-0">続きを解く</span>
              </button>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col justify-between gap-4 hover:border-indigo-300 transition">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                  新しく全問に挑戦する
                  <InfoTooltip content="このテストの全設問を最初から新しく解き直します（第N回として別記録に保存されます）。" />
                </div>
                <p className="text-xs text-slate-500">
                  新しいチャレンジ回を作成し、全問題をまっさらな状態から解答します。
                </p>
              </div>
              <button
                type="button"
                disabled={starting}
                onClick={() => startNewAttempt('full')}
                className="ui-btn-primary w-full text-xs"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                第{existingSubs.length + 1}回を開始（全問）
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col justify-between gap-4 hover:border-amber-300 transition">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                  間違えた問題だけ再挑戦
                  <InfoTooltip content="直前の採点結果で × または要確認（△）だった問題だけを抽出して再テストします。効率よく弱点を潰せます。" />
                </div>
                <p className="text-xs text-slate-500">
                  {hasWrongToRetry
                    ? `前回の結果から間違い・要確認（${(latestGraded?.wrong_count || 0) + (latestGraded?.uncertain_count || 0)}問）に絞って再挑戦します。`
                    : '前回の採点結果に間違いがないか、まだ採点済み記録がありません。'}
                </p>
              </div>
              <button
                type="button"
                disabled={starting || !hasWrongToRetry}
                onClick={() => startNewAttempt('wrong_only')}
                className="ui-btn-secondary w-full text-xs disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4 text-amber-600" />
                間違いだけ再挑戦
              </button>
            </div>
          </div>

          {existingSubs.length > 0 && (
            <div className="border-t border-slate-100 pt-4 space-y-2.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                これまでの解答履歴（{existingSubs.length}回）
              </h2>
              <div className="space-y-2">
                {existingSubs.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-800">第{s.attempt_number}回</span>
                      <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                        {s.mode === 'wrong_only' ? '間違い再挑戦' : '全問'}
                      </span>
                      <span className="text-slate-500">
                        {new Date(s.started_at).toLocaleString('ja-JP')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {s.status === 'in_progress' ? (
                        <span className="text-amber-700 font-semibold">解答途中</span>
                      ) : (
                        <>
                          <span className="font-bold text-emerald-700">
                            ○ {s.correct_count} / {s.total_count} 問
                          </span>
                          {typeof s.llm_usage?.total_tokens === 'number' && s.llm_usage.total_tokens > 0 && (
                            <Tooltip content="この回の手書き読取・自動採点で消費したLLMトークン合計です。">
                              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-500 ring-1 ring-inset ring-slate-200">
                                {s.llm_usage.total_tokens.toLocaleString()} tok
                              </span>
                            </Tooltip>
                          )}
                        </>
                      )}
                      <Link
                        to={
                          s.status === 'in_progress'
                            ? `/exams/${examId}/solve?submissionId=${s.id}`
                            : `/exams/${examId}/submissions/${s.id}`
                        }
                        className="font-semibold text-indigo-600 hover:underline"
                      >
                        {s.status === 'in_progress' ? '再開' : '結果・手書きを見る'}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const renderQuestionCard = (item: FlatSolveItem) => {
    const { bundle, group, subject, globalIndex } = item;
    const { question, exam_item } = bundle;
    const draft = drafts[exam_item.id] || {
      input_mode: bundle.answer.input_mode,
      selected_options: [],
      typed_text: '',
      strokes_data: {},
    };
    const theme = SUBJECT_THEME[subject] || SUBJECT_THEME.rika;
    const isChoice = question.question_type === 'single_choice' || question.question_type === 'multi_choice';
    const isKanjiWrite = question.question_type === 'kanji_write';
    const cells = Math.max(1, Math.min(6, question.answer_box_config?.cells || 2));

    const toggleOption = (label: string) => {
      const cur = draft.selected_options || [];
      let next: string[];
      if (question.question_type === 'single_choice') {
        next = cur.includes(label) ? [] : [label];
      } else {
        next = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label];
      }
      updateDraft(exam_item.id, { input_mode: 'choice', selected_options: next }, true);
    };

    const handleSwitchInputMode = (nextMode: 'handwriting' | 'text') => {
      if (nextMode === 'text' && isKanjiWrite) {
        showToast('漢字の書き取り練習は手書き入力をおすすめします（キーボードでも提出可能です）。', 'info');
      }
      updateDraft(exam_item.id, { input_mode: nextMode }, true);
    };

    return (
      <article
        key={exam_item.id}
        className="ui-card p-5 sm:p-6 space-y-5 scroll-mt-24"
        id={`solve-q-${globalIndex}`}
      >
        {/* 設問ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-lg bg-indigo-600 px-2 text-xs font-extrabold text-white">
              Q{globalIndex + 1}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${theme.badgeClass}`}>
              {SUBJECT_LABELS[subject]}
            </span>
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {QUESTION_TYPE_LABELS[question.question_type]}
            </span>
            {group.source_name && (
              <span className="text-[11px] text-slate-400">出典: {group.source_name}</span>
            )}
          </div>

          {!isChoice && (
            <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5">
              <Tooltip content="手書きキャンバスで解答します（漢字の書き取りにおすすめ）。">
                <button
                  type="button"
                  onClick={() => handleSwitchInputMode('handwriting')}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    draft.input_mode === 'handwriting'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <PenLine className="w-3.5 h-3.5" />
                  手書き
                </button>
              </Tooltip>
              <Tooltip content="PCキーボードや音声入力で解答します。長文記述に便利です。">
                <button
                  type="button"
                  onClick={() => handleSwitchInputMode('text')}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    draft.input_mode === 'text'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  キーボード
                </button>
              </Tooltip>
              <InfoTooltip
                label="入力モード切替の説明"
                content="手書き入力とキーボード入力を問題ごとに切り替えられます。漢字の書き取り問題は漢字の形を覚えるため「手書き」を推奨しています。"
              />
            </div>
          )}
        </div>

        {/* 大問リード文・図版 */}
        {(group.lead_text || (group.images && group.images.length > 0)) && (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 sm:p-4 space-y-3">
            {group.lead_text && (
              <div className="text-xs sm:text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                <RichJapaneseText text={group.lead_text} />
              </div>
            )}
            {group.images && group.images.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {group.images.map((img) => {
                  const src = uploadUrl(img.use_cleaned ? img.cleaned_path : img.raw_crop_path);
                  return (
                    <figure
                      key={img.id}
                      className="group relative rounded-xl border border-slate-200 bg-white p-2 max-w-full"
                    >
                      <button
                        type="button"
                        onClick={() => setZoomImg({ src, caption: img.caption || '図版' })}
                        className="block text-left focus:outline-none"
                      >
                        <img
                          src={src}
                          alt={img.caption || '図版'}
                          className="max-h-52 w-auto object-contain rounded"
                        />
                        <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-lg bg-slate-900/75 px-2 py-1 text-[10px] font-semibold text-white opacity-90 group-hover:opacity-100">
                          <Maximize2 className="w-3 h-3" />
                          拡大
                        </span>
                      </button>
                      {img.caption && (
                        <figcaption className="mt-1 text-center text-[11px] text-slate-500">
                          {img.caption}
                        </figcaption>
                      )}
                    </figure>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 問題文本体 */}
        <div
          className={`rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 ${
            subject === 'kokugo' ? 'font-serif text-lg sm:text-xl leading-loose' : 'text-base sm:text-lg leading-relaxed'
          } text-slate-900`}
        >
          <RichJapaneseText text={question.body} />
        </div>

        {/* 解答入力コントロール */}
        {isChoice ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <span>
                {question.question_type === 'multi_choice'
                  ? '当てはまる選択肢をすべてタップしてください'
                  : '正しい選択肢を1つタップしてください'}
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {(question.options || []).map((opt, optIdx) => {
                const lbl = (opt.label || '').trim();
                const txt = (opt.text || '').trim();
                const optionValue = lbl || txt || String(optIdx + 1);
                const selected = (draft.selected_options || []).includes(optionValue);
                const same = !lbl || !txt || lbl === txt;
                return (
                  <button
                    key={`${optionValue}-${optIdx}`}
                    type="button"
                    onClick={() => toggleOption(optionValue)}
                    className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition ${
                      selected
                        ? 'border-indigo-600 bg-indigo-50/90 text-indigo-950 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-7 min-w-[28px] px-1.5 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                        selected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {selected ? <Check className="w-4 h-4" /> : same ? String(optIdx + 1) : lbl}
                    </span>
                    <span className="text-sm sm:text-base leading-snug pt-0.5">
                      {!same && <span className="font-bold mr-1.5">{lbl}.</span>}
                      <RichJapaneseText text={txt || lbl} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : draft.input_mode === 'text' ? (
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600">解答入力欄</label>
            <textarea
              rows={question.question_type === 'kokugo_subjective' || question.question_type === 'short_answer' ? 3 : 2}
              value={draft.typed_text}
              onChange={(e) =>
                updateDraft(exam_item.id, { input_mode: 'text', typed_text: e.target.value })
              }
              placeholder="ここに解答を入力してください..."
              className="ui-input text-base"
            />
          </div>
        ) : (
          <HandwritingPad
            mode={isKanjiWrite ? 'kanji_grid' : 'freehand'}
            cells={cells}
            value={draft.strokes_data}
            penOnly={penOnly}
            onTogglePenOnly={setPenOnly}
            onChange={(nextStrokes, pngDataUrl) =>
              updateDraft(exam_item.id, {
                input_mode: 'handwriting',
                strokes_data: nextStrokes,
                image_data_url: pngDataUrl,
              })
            }
          />
        )}
      </article>
    );
  };

  const activeItem = flatItems[currentIdx] || flatItems[0];

  return (
    <div className="space-y-4">
      {/* 上部スティッキーヘッダー */}
      <div className="ui-card p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 sticky top-[62px] z-20 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to="/exams"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            履歴
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {submission.exam_title}
              </h1>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                第{submission.attempt_number}回
                {submission.mode === 'wrong_only' ? '（間違い再挑戦）' : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
              <span>
                進捗: <strong className="text-slate-800">{answeredCount}</strong> / {flatItems.length} 問
              </span>
              <span>
                {saveState === 'saving'
                  ? '保存中...'
                  : saveState === 'saved'
                  ? '自動保存済み'
                  : saveState === 'error'
                  ? '保存エラー（再試行してください）'
                  : '変更時に自動保存'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* タイマー */}
          <Tooltip content="解答時間タイマー（クリックで一時停止／再開）。">
            <button
              type="button"
              onClick={() => setTimerPaused((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono font-bold text-slate-700 hover:bg-slate-100"
            >
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              {formatDuration(elapsedSec)}
              {timerPaused ? <Play className="w-3 h-3 text-emerald-600" /> : <Pause className="w-3 h-3 text-slate-400" />}
            </button>
          </Tooltip>

          {/* 表示モード切替 */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5">
            <Tooltip content="1問ずつ大きく表示して集中して解きます（タブレットにおすすめ）。">
              <button
                type="button"
                onClick={() => setViewMode('single')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  viewMode === 'single' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                <SquareStack className="w-3.5 h-3.5" />
                1問集中
              </button>
            </Tooltip>
            <Tooltip content="すべての問題を縦に並べて一覧表示します（PC大画面におすすめ）。">
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  viewMode === 'all' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                全問一覧
              </button>
            </Tooltip>
          </div>

          <Tooltip content="計算メモや下書きに使える補助キャンバスを開閉します（採点対象にはなりません）。">
            <button
              type="button"
              onClick={() => setShowScratch((v) => !v)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                showScratch
                  ? 'border-amber-400 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              計算メモ
            </button>
          </Tooltip>

          <button
            type="button"
            disabled={submitting}
            onClick={() => setSubmitDialogOpen(true)}
            className="ui-btn-primary px-4 py-2 text-xs"
          >
            <Send className="w-3.5 h-3.5" />
            提出して自動採点
          </button>
        </div>
      </div>

      {/* 進捗バー & 問題番号ナビゲーション */}
      <div className="ui-card p-3.5 space-y-2.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all duration-300"
            style={{ width: `${flatItems.length ? (answeredCount / flatItems.length) * 100 : 0}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {flatItems.map((it) => {
            const done = isDraftAnswered(drafts[it.bundle.exam_item.id]);
            const active = viewMode === 'single' && currentIdx === it.globalIndex;
            return (
              <button
                key={it.bundle.exam_item.id}
                type="button"
                onClick={() => {
                  setCurrentIdx(it.globalIndex);
                  if (viewMode === 'all') {
                    document
                      .getElementById(`solve-q-${it.globalIndex}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                className={`inline-flex h-8 min-w-[34px] items-center justify-center rounded-lg px-2 text-xs font-bold transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                    : done
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {it.globalIndex + 1}
                {done && !active && <CheckCircle2 className="w-3 h-3 ml-0.5 text-emerald-600" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 任意の計算・メモ欄（採点非対象） */}
      {showScratch && (
        <div className="ui-card p-4 border-amber-200 bg-amber-50/40 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
              計算・下書きメモ欄（採点対象外）
              <InfoTooltip content="理科・算数の途中計算や国語のメモに自由に書けます。この欄の内容は自動採点には送信されません。" />
            </div>
            <button
              type="button"
              onClick={() => setShowScratch(false)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              閉じる
            </button>
          </div>
          <HandwritingPad
            mode="freehand"
            value={scratchData}
            penOnly={penOnly}
            onChange={(next) => setScratchData(next)}
          />
        </div>
      )}

      {/* 設問エリア */}
      {viewMode === 'single' && activeItem ? (
        <div className="space-y-4">
          {renderQuestionCard(activeItem)}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className="ui-btn-secondary px-4 py-2.5 text-xs disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              前の問題
            </button>

            <span className="text-xs font-semibold text-slate-500">
              {currentIdx + 1} / {flatItems.length} 問目
            </span>

            {currentIdx < flatItems.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIdx((i) => Math.min(flatItems.length - 1, i + 1))}
                className="ui-btn-primary px-5 py-2.5 text-xs"
              >
                次の問題
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSubmitDialogOpen(true)}
                className="ui-btn-primary px-5 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <Send className="w-4 h-4" />
                すべて提出して自動採点
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {flatItems.map((it) => renderQuestionCard(it))}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setSubmitDialogOpen(true)}
              className="ui-btn-primary px-6 py-3 text-sm"
            >
              <Send className="w-4 h-4" />
              提出して自動採点する（{answeredCount}/{flatItems.length}問入力済み）
            </button>
          </div>
        </div>
      )}

      {/* 提出確認ダイアログ */}
      <ConfirmDialog
        open={submitDialogOpen}
        onOpenChange={(open) => !submitting && setSubmitDialogOpen(open)}
        variant="primary"
        title="解答を提出して AI 自動採点を行いますか？"
        description={
          answeredCount < flatItems.length
            ? `未記入の問題が ${flatItems.length - answeredCount} 問あります。このまま提出すると手書き文字を AI が読み取り、模範解答と自動照合します（数秒かかります）。`
            : `全 ${flatItems.length} 問の入力が完了しています。提出すると AI が手書き文字を客観的に読み取り、模範解答と照合します。`
        }
        confirmLabel="提出して自動採点する"
        loadingLabel="AI読み取り・採点中..."
        loading={submitting}
        onConfirm={handleSubmitExam}
      />

      {/* 採点処理中オーバーレイ */}
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="ui-card max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-900">手書き認識・自動採点を実行中...</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                ① 問題文を見ない「無文脈盲識」で手書き文字を厳密に読み取り、
                <br />
                ② 模範解答と照合しています。このまま数秒お待ちください。
              </p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600 mx-auto" />
          </div>
        </div>
      )}

      {/* 図版拡大モーダル */}
      {zoomImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-4"
          onClick={() => setZoomImg(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] rounded-2xl bg-white p-4 shadow-2xl space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold text-slate-700">{zoomImg.caption}</span>
              <button
                type="button"
                onClick={() => setZoomImg(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoomImg.src}
              alt={zoomImg.caption}
              className="max-h-[78vh] w-auto mx-auto object-contain rounded"
            />
          </div>
        </div>
      )}
    </div>
  );
};
