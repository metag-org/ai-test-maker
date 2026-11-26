import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  HelpCircle,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { api, uploadUrl } from '../api/client';
import { RichJapaneseText } from '../components/RichJapaneseText';
import { useToast } from '../components/ToastProvider';
import { InfoTooltip, Tooltip } from '../components/Tooltip';
import type {
  AiGradeStatus,
  ExamSubmissionDetail,
  QuestionGroup,
  SubjectType,
  SubmissionItemBundle,
} from '../types';
import { QUESTION_TYPE_LABELS, SUBJECT_LABELS } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';

interface FlatReviewItem {
  index: number;
  subject: SubjectType;
  group: QuestionGroup;
  bundle: SubmissionItemBundle;
}

const AI_STATUS_META: Record<
  AiGradeStatus,
  { label: string; className: string; tip: string }
> = {
  correct: {
    label: 'AI判定: 正解',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    tip: '読み取り結果または選択内容が模範解答と一致しました。',
  },
  wrong: {
    label: 'AI判定: 不正解',
    className: 'bg-rose-50 text-rose-700 ring-rose-200',
    tip: '模範解答と異なると判定されました。手書き読み違いがあれば右のボタンで ○ に修正できます。',
  },
  partial: {
    label: 'AI判定: 惜しい（要確認）',
    className: 'bg-amber-50 text-amber-800 ring-amber-300',
    tip: '意味は近いですが一部不足または表記違いがあります。保護者の方が最終判定してください。',
  },
  uncertain: {
    label: '要確認（△）',
    className: 'bg-amber-50 text-amber-800 ring-amber-300',
    tip: '字形（画数不足・崩れ）または読み取り確信度に懸念があるため、手書き原画を目視確認してください。',
  },
  no_key: {
    label: '模範解答未登録',
    className: 'bg-slate-100 text-slate-700 ring-slate-300',
    tip: 'この問題にはまだ模範解答が登録されていません。手書き原画を見て ○ / × を付けてください。',
  },
  unanswered: {
    label: '未解答',
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
    tip: '解答が未記入または文字が検出されませんでした。',
  },
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}

export const ExamSubmissionReviewPage: React.FC = () => {
  const { id: examId, submissionId } = useParams<{ id: string; submissionId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<ExamSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'attention' | 'wrong' | 'low_conf'>('all');
  const [syncing, setSyncing] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<{ src: string; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!submissionId) return;
    setLoading(true);
    try {
      const data = await api.getSubmission(submissionId);
      setDetail(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '結果の読み込みに失敗しました。', 'error');
    } finally {
      setLoading(false);
    }
  }, [submissionId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const flatItems: FlatReviewItem[] = useMemo(() => {
    if (!detail) return [];
    const list: FlatReviewItem[] = [];
    const order: SubjectType[] = ['kokugo', 'rika', 'shakai', 'sansu'];
    for (const subj of order) {
      for (const sec of detail.sections[subj] || []) {
        for (const bundle of sec.items) {
          list.push({
            index: list.length,
            subject: subj,
            group: sec.group,
            bundle,
          });
        }
      }
    }
    return list;
  }, [detail]);

  const newlyKeyedCount = useMemo(
    () =>
      flatItems.filter(
        (it) =>
          it.bundle.answer.ai_status === 'no_key' &&
          Boolean(it.bundle.question.manual_answer?.trim())
      ).length,
    [flatItems]
  );

  const lowConfidenceCount = useMemo(
    () =>
      flatItems.filter(
        (it) =>
          it.bundle.answer.input_mode === 'handwriting' &&
          it.bundle.answer.ai_confidence !== null &&
          Math.round(it.bundle.answer.ai_confidence * 100) < 95
      ).length,
    [flatItems]
  );

  const filteredItems = useMemo(() => {
    if (filter === 'all') return flatItems;
    if (filter === 'wrong') {
      return flatItems.filter((it) => it.bundle.answer.final_is_wrong === true);
    }
    if (filter === 'low_conf') {
      return flatItems.filter(
        (it) =>
          it.bundle.answer.input_mode === 'handwriting' &&
          it.bundle.answer.ai_confidence !== null &&
          Math.round(it.bundle.answer.ai_confidence * 100) < 95
      );
    }
    return flatItems.filter((it) => it.bundle.answer.final_is_wrong !== false);
  }, [flatItems, filter]);

  const handleOverride = async (examItemId: string, nextWrong: boolean | null) => {
    if (!detail) return;
    try {
      const res = await api.reviewSubmissionAnswer(detail.id, examItemId, nextWrong);
      setDetail((prev) => {
        if (!prev) return prev;
        const nextSections: ExamSubmissionDetail['sections'] = {};
        for (const [subj, secs] of Object.entries(prev.sections)) {
          if (!secs) continue;
          nextSections[subj as SubjectType] = secs.map((sec) => ({
            ...sec,
            items: sec.items.map((b) =>
              b.exam_item.id === examItemId
                ? { ...b, answer: { ...b.answer, final_is_wrong: res.final_is_wrong } }
                : b
            ),
          }));
        }
        return {
          ...prev,
          sections: nextSections,
          correct_count: res.correct_count,
          wrong_count: res.wrong_count,
          uncertain_count: res.uncertain_count,
          status: res.status as ExamSubmissionDetail['status'],
        };
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '判定の更新に失敗しました。', 'error');
    }
  };

  const handleSyncToBank = async () => {
    if (!detail) return;
    setSyncing(true);
    try {
      const res = await api.syncSubmissionMistakes(detail.id);
      setDetail((prev) => (prev ? { ...prev, synced_to_bank: true } : prev));
      showToast(
        `問題バンクへ反映しました（反映: ${res.updated_count}問 / 要復習登録: ${res.wrong_marked}問 / 復習解除: ${res.cleared_review}問）。`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '反映に失敗しました。', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleRegrade = async (rerunOcr = false) => {
    if (!detail) return;
    setRegrading(true);
    try {
      const updated = await api.regradeSubmission(detail.id, rerunOcr);
      setDetail(updated);
      showToast(
        `最新の模範解答で再採点しました（正解 ${updated.correct_count} / ${updated.total_count} 問）。`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '再採点に失敗しました。', 'error');
    } finally {
      setRegrading(false);
    }
  };

  const handleStartRetry = async (mode: 'full' | 'wrong_only') => {
    if (!examId) return;
    setRetrying(true);
    try {
      const created = await api.createSubmission(examId, mode);
      navigate(`/exams/${examId}/solve?submissionId=${created.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '再挑戦の開始に失敗しました。', 'error');
    } finally {
      setRetrying(false);
    }
  };

  if (loading || !detail) {
    return (
      <div className="ui-card p-12 text-center space-y-3">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600 mx-auto" />
        <p className="text-sm text-slate-500">採点結果を読み込み中...</p>
      </div>
    );
  }

  const scorePct =
    detail.total_count > 0 ? Math.round((detail.correct_count / detail.total_count) * 100) : 0;
  const canRetryWrong = detail.wrong_count + detail.uncertain_count > 0;

  return (
    <div className="space-y-5">
      {/* 上部ナビ & 履歴切替 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Link to="/exams" className="ui-btn-secondary px-3 py-1.5 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            テスト履歴
          </Link>
          <Link to={`/exams/${examId}`} className="text-xs font-semibold text-slate-600 hover:text-indigo-700">
            印刷・PDF表示
          </Link>
        </div>

        {detail.all_attempts.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">回数を切替:</label>
            <select
              value={detail.id}
              onChange={(e) => {
                const target = detail.all_attempts.find((a) => a.id === e.target.value);
                if (!target) return;
                if (target.status === 'in_progress') {
                  navigate(`/exams/${examId}/solve?submissionId=${target.id}`);
                } else {
                  navigate(`/exams/${examId}/submissions/${target.id}`);
                }
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
            >
              {detail.all_attempts.map((a) => (
                <option key={a.id} value={a.id}>
                  第{a.attempt_number}回（{a.mode === 'wrong_only' ? '間違い再挑戦' : '全問'}）
                  {a.status === 'in_progress'
                    ? ' - 解答中'
                    : ` - ${a.correct_count}/${a.total_count}問正解`}
                </option>
              ))}
            </select>
            <InfoTooltip content="同じテストで過去に取り組んだ回の手書き画像や点数を切り替えて成長を確認できます。" />
          </div>
        )}
      </div>

      {/* 成績サマリーカード */}
      <section className="ui-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-800">
                第{detail.attempt_number}回
                {detail.mode === 'wrong_only' ? '（間違い再挑戦）' : '（全問）'}
              </span>
              {detail.synced_to_bank && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  問題バンク反映済み
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{detail.exam_title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              {detail.submitted_at && (
                <span>提出日時: {new Date(detail.submitted_at).toLocaleString('ja-JP')}</span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                所要時間: {formatDuration(detail.duration_seconds)}
              </span>
            </div>

            {/* LLM トークン消費明細（手書き読取 OCR / 記述意味採点） */}
            {detail.llm_usage && typeof detail.llm_usage.total_tokens === 'number' && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-2 text-[11.5px] text-slate-700">
                <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                  <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                  AIトークン消費:
                </span>
                <span className="font-mono font-extrabold text-indigo-700">
                  合計 {detail.llm_usage.total_tokens.toLocaleString()}
                </span>
                <span className="text-slate-500 font-mono">
                  （入力 {(detail.llm_usage.total_input_tokens ?? 0).toLocaleString()} / 出力{' '}
                  {(detail.llm_usage.total_output_tokens ?? 0).toLocaleString()}
                  {(detail.llm_usage.total_thoughts_tokens ?? 0) > 0
                    ? ` / 思考 ${(detail.llm_usage.total_thoughts_tokens ?? 0).toLocaleString()}`
                    : ''}
                  ）
                </span>
                {detail.llm_usage.ocr && (detail.llm_usage.ocr.calls > 0 || detail.llm_usage.ocr.total_tokens > 0) && (
                  <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200">
                    手書きOCR: {detail.llm_usage.ocr.total_tokens.toLocaleString()}（入{' '}
                    {detail.llm_usage.ocr.input_tokens.toLocaleString()} / 出{' '}
                    {detail.llm_usage.ocr.output_tokens.toLocaleString()}）
                  </span>
                )}
                {detail.llm_usage.semantic &&
                  (detail.llm_usage.semantic.calls > 0 || detail.llm_usage.semantic.total_tokens > 0) && (
                    <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200">
                      意味採点: {detail.llm_usage.semantic.total_tokens.toLocaleString()}（入{' '}
                      {detail.llm_usage.semantic.input_tokens.toLocaleString()} / 出{' '}
                      {detail.llm_usage.semantic.output_tokens.toLocaleString()}）
                    </span>
                  )}
                {detail.llm_usage.model && (
                  <span className="text-[10.5px] text-slate-400 font-mono">
                    [{detail.llm_usage.model}]
                  </span>
                )}
                <InfoTooltip
                  label="AIトークン消費の内訳"
                  maxWidth={320}
                  content={
                    <div className="space-y-1.5">
                      <div className="font-bold text-indigo-200">
                        オンライン採点 LLM トークン内訳
                      </div>
                      <div>
                        モデル: {detail.llm_usage.model || '未使用（選択問題のみ等）'}
                      </div>
                      <div>
                        ・手書き読取 (OCR): {detail.llm_usage.ocr?.calls ?? 0}回 / 入力{' '}
                        {(detail.llm_usage.ocr?.input_tokens ?? 0).toLocaleString()} / 出力{' '}
                        {(detail.llm_usage.ocr?.output_tokens ?? 0).toLocaleString()} / 計{' '}
                        {(detail.llm_usage.ocr?.total_tokens ?? 0).toLocaleString()}
                      </div>
                      <div>
                        ・記述意味採点: {detail.llm_usage.semantic?.calls ?? 0}回 / 入力{' '}
                        {(detail.llm_usage.semantic?.input_tokens ?? 0).toLocaleString()} / 出力{' '}
                        {(detail.llm_usage.semantic?.output_tokens ?? 0).toLocaleString()} / 計{' '}
                        {(detail.llm_usage.semantic?.total_tokens ?? 0).toLocaleString()}
                      </div>
                      <div className="text-slate-300 pt-1 border-t border-white/10">
                        「最新の模範解答で再採点」は OCR 結果を再利用するため、手書き読取の追加トークンは発生しません。
                      </div>
                    </div>
                  }
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[11px] font-bold text-slate-500">正答率</div>
              <div className="text-3xl font-extrabold text-indigo-600">
                {scorePct}
                <span className="text-base font-bold text-slate-400 ml-0.5">%</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50 px-3 py-2 ring-1 ring-inset ring-emerald-200">
                <div className="text-[10px] font-bold text-emerald-700">正解 ○</div>
                <div className="text-lg font-extrabold text-emerald-700">{detail.correct_count}</div>
              </div>
              <div className="rounded-xl bg-rose-50 px-3 py-2 ring-1 ring-inset ring-rose-200">
                <div className="text-[10px] font-bold text-rose-700">間違い ×</div>
                <div className="text-lg font-extrabold text-rose-700">{detail.wrong_count}</div>
              </div>
              <div className="rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-200">
                <div className="text-[10px] font-bold text-amber-800">要確認 △</div>
                <div className="text-lg font-extrabold text-amber-800">{detail.uncertain_count}</div>
              </div>
            </div>
          </div>
        </div>

        {/* アクションバー */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={syncing}
              onClick={handleSyncToBank}
              className="ui-btn-primary text-xs px-4 py-2"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {detail.synced_to_bank ? '問題バンクの要復習を再反映' : '間違い記録（問題バンク）に反映'}
            </button>
            <InfoTooltip
              label="問題バンク反映の説明"
              content="確定した ○ / × を問題バンクへ反映します。× の問題は次回テスト作成で優先出題される「要復習」に登録され、解き直しで ○ になった問題は要復習が解除されます。"
            />

            <div className="inline-flex items-center gap-1.5">
              <Tooltip content="あとから追加・修正した模範解答／別解を使って判定を再計算します。既存の手書き読み取り結果を再利用するため高速です。">
                <button
                  type="button"
                  disabled={regrading}
                  onClick={() => handleRegrade(false)}
                  className="ui-btn-secondary text-xs px-3.5 py-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {regrading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {regrading ? '再採点中...' : '最新の模範解答で再採点'}
                </button>
              </Tooltip>
              <InfoTooltip
                label="最新の模範解答で再採点とは"
                content="テスト提出後に問題バンクで模範解答や別解を追加・修正した場合に押します。すでに完了している手書き文字のAI読み取り結果をそのまま使い、最新の模範解答と再照合して正答率を更新します。"
              />
            </div>

            <div className="inline-flex items-center gap-1 rounded-xl bg-indigo-50/70 px-2.5 py-1.5 text-[11px] font-medium text-indigo-800">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              AI無文脈盲識で採点
              <InfoTooltip
                label="AI無文脈盲識とは"
                content="誤字をAIが文脈から勝手に正解へ脳内補正するのを防ぐため、手書き認識時は問題文も模範解答もAIに見せず、純粋な字形だけを読み取ってから模範解答と照合しています。"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tooltip content="今回 × または要確認（△）だった問題だけを抽出してすぐにもう一度解きます。">
              <button
                type="button"
                disabled={retrying || !canRetryWrong}
                onClick={() => handleStartRetry('wrong_only')}
                className="ui-btn-secondary text-xs px-3.5 py-2 disabled:opacity-40"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                間違えた問題だけ再挑戦
              </button>
            </Tooltip>
            <Tooltip content="このテストの全問題を新しいチャレンジ回としてもう一度解きます。">
              <button
                type="button"
                disabled={retrying}
                onClick={() => handleStartRetry('full')}
                className="ui-btn-secondary text-xs px-3.5 py-2"
              >
                <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
                全問もう一度解く
              </button>
            </Tooltip>
          </div>
        </div>
      </section>

      {/* 後から模範解答が追加された場合の再採点リマインドバナー */}
      {newlyKeyedCount > 0 && (
        <div className="rounded-2xl border border-indigo-300 bg-indigo-50 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-2.5 text-xs sm:text-sm text-indigo-950">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">
                提出後に模範解答が登録された問題が {newlyKeyedCount} 問あります。
              </span>
              <span className="text-indigo-800 ml-1">
                「最新の模範解答で再採点」を押すと、読み取り済みの手書き結果を使って即座に ○ / × を自動判定できます。
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={regrading}
            onClick={() => handleRegrade(false)}
            className="ui-btn-primary text-xs px-4 py-2 shrink-0"
          >
            {regrading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            今すぐ再採点する
          </button>
        </div>
      )}

      {/* 絞り込みバー */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3 py-1.5 font-bold transition ${
              filter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            すべて ({flatItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('attention')}
            className={`rounded-lg px-3 py-1.5 font-bold transition ${
              filter === 'attention' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            間違い・要確認のみ ({detail.wrong_count + detail.uncertain_count})
          </button>
          <button
            type="button"
            onClick={() => setFilter('wrong')}
            className={`rounded-lg px-3 py-1.5 font-bold transition ${
              filter === 'wrong' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            間違いのみ ({detail.wrong_count})
          </button>
          {lowConfidenceCount > 0 && (
            <Tooltip content="AIの手書き読み取り確信度が 95% 未満の問題だけに絞り込みます。">
              <button
                type="button"
                onClick={() => setFilter('low_conf')}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-bold transition ${
                  filter === 'low_conf'
                    ? 'bg-orange-600 text-white'
                    : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                確信度95%未満 ({lowConfidenceCount})
              </button>
            </Tooltip>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {lowConfidenceCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              読取確信度 95% 未満が {lowConfidenceCount} 問あります（目視確認推奨）
            </div>
          )}
          {detail.uncertain_count > 0 && (
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              要確認（△）が {detail.uncertain_count} 問あります。
            </div>
          )}
        </div>
      </div>

      {/* 各問題の採点詳細カード */}
      {filteredItems.length === 0 ? (
        <div className="ui-card p-10 text-center text-sm text-slate-500">
          該当する問題はありません。
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map(({ index, subject, group, bundle }) => {
            const { question, answer, exam_item } = bundle;
            const theme = SUBJECT_THEME[subject] || SUBJECT_THEME.rika;
            const aiMeta = AI_STATUS_META[answer.ai_status] || AI_STATUS_META.uncertain;
            const hwSrc = answer.handwriting_image_path ? uploadUrl(answer.handwriting_image_path) : '';
            const confPct =
              answer.ai_confidence !== null && answer.input_mode === 'handwriting'
                ? Math.round(answer.ai_confidence * 100)
                : null;
            const isLowConfidence = confPct !== null && confPct < 95;
            const isVeryLowConfidence = confPct !== null && confPct < 80;

            const borderClass =
              answer.final_is_wrong === false
                ? 'border-l-4 border-l-emerald-500'
                : answer.final_is_wrong === true
                ? 'border-l-4 border-l-rose-500'
                : 'border-l-4 border-l-amber-400';

            return (
              <article key={exam_item.id} className={`ui-card p-4 sm:p-5 space-y-4 ${borderClass}`}>
                {/* ヘッダー行 */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-7 min-w-[30px] items-center justify-center rounded-lg bg-slate-800 px-2 text-xs font-extrabold text-white">
                      Q{index + 1}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${theme.badgeClass}`}>
                      {SUBJECT_LABELS[subject]}
                    </span>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {QUESTION_TYPE_LABELS[question.question_type]}
                    </span>
                    <Tooltip content={aiMeta.tip}>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${aiMeta.className}`}
                      >
                        {aiMeta.label}
                      </span>
                    </Tooltip>
                    {confPct !== null && (
                      <Tooltip
                        content={
                          isLowConfidence
                            ? 'AIの手書き読み取り確信度が 95% 未満です。誤読や字形の崩れがないか、手書き原画を目視で確認してください。'
                            : 'AIが高確信度（95%以上）で手書き文字を読み取りました。'
                        }
                      >
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] ring-1 ring-inset ${
                            isVeryLowConfidence
                              ? 'bg-rose-100 text-rose-800 ring-rose-400 font-extrabold shadow-xs'
                              : isLowConfidence
                              ? 'bg-amber-100 text-amber-950 ring-amber-400 font-extrabold shadow-xs'
                              : 'bg-emerald-50 text-emerald-800 ring-emerald-300 font-bold'
                          }`}
                        >
                          {isLowConfidence && (
                            <AlertTriangle
                              className={`w-3.5 h-3.5 ${
                                isVeryLowConfidence ? 'text-rose-600' : 'text-amber-600'
                              }`}
                            />
                          )}
                          読取確信度 {confPct}%
                          {isVeryLowConfidence
                            ? '（低確信・要確認）'
                            : isLowConfidence
                            ? '（95%未満・要確認）'
                            : ''}
                        </span>
                      </Tooltip>
                    )}
                  </div>

                  {/* 保護者最終判定ボタン */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 mr-0.5">最終判定:</span>
                    <Tooltip content="正解（○）として確定します。">
                      <button
                        type="button"
                        onClick={() =>
                          handleOverride(exam_item.id, answer.final_is_wrong === false ? null : false)
                        }
                        className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                          answer.final_is_wrong === false
                            ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-emerald-50 hover:text-emerald-700'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        ○ 正解
                      </button>
                    </Tooltip>
                    <Tooltip content="不正解（×）として確定します。問題バンクへ反映すると要復習になります。">
                      <button
                        type="button"
                        onClick={() =>
                          handleOverride(exam_item.id, answer.final_is_wrong === true ? null : true)
                        }
                        className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                          answer.final_is_wrong === true
                            ? 'border-rose-600 bg-rose-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-rose-50 hover:text-rose-700'
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        × 不正解
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {/* 問題文 */}
                <div className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 py-3 text-sm sm:text-base text-slate-900">
                  {group.source_name && (
                    <div className="text-[11px] text-slate-400 mb-1">出典: {group.source_name}</div>
                  )}
                  <RichJapaneseText text={question.body} />
                </div>

                {/* 生徒の解答 vs 模範解答 比較グリッド */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* 左：生徒の解答（手書き原画＋読取テキスト） */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                    <div className="text-xs font-bold text-slate-600">生徒の解答</div>

                    {answer.input_mode === 'choice' ? (
                      <div className="text-base font-bold text-slate-900">
                        {answer.selected_options.length > 0
                          ? answer.selected_options.join('・')
                          : '（未選択）'}
                      </div>
                    ) : answer.input_mode === 'text' ? (
                      <div className="text-base font-bold text-slate-900 whitespace-pre-wrap">
                        {answer.typed_text || '（未記入）'}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {hwSrc ? (
                          <div className="relative group inline-block max-w-full rounded-xl border border-slate-200 bg-white p-2">
                            <button
                              type="button"
                              onClick={() => setZoomSrc({ src: hwSrc, title: `Q${index + 1} の手書き解答` })}
                              className="block"
                            >
                              <img
                                src={hwSrc}
                                alt={`Q${index + 1} 手書き解答`}
                                className="max-h-36 w-auto object-contain"
                              />
                              <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-white opacity-85 group-hover:opacity-100">
                                <Maximize2 className="w-3 h-3" />
                                拡大
                              </span>
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400">（手書き画像なし）</div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs border border-slate-200/70">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-500">AI読み取り:</span>
                            <span className="font-bold text-slate-900 text-sm">
                              {answer.recognized_text || '（読み取れず）'}
                            </span>
                          </div>
                          {confPct !== null && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                isVeryLowConfidence
                                  ? 'bg-rose-100 text-rose-800'
                                  : isLowConfidence
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {isLowConfidence && <AlertTriangle className="w-3 h-3" />}
                              確信度 {confPct}%
                            </span>
                          )}
                        </div>

                        {isLowConfidence && (
                          <div
                            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                              isVeryLowConfidence
                                ? 'border-rose-300 bg-rose-50 text-rose-900'
                                : 'border-amber-300 bg-amber-50 text-amber-950'
                            }`}
                          >
                            <AlertTriangle
                              className={`w-4 h-4 shrink-0 mt-0.5 ${
                                isVeryLowConfidence ? 'text-rose-600' : 'text-amber-600'
                              }`}
                            />
                            <span>
                              読取確信度が 95% 未満（<strong>{confPct}%</strong>）です。上の手書き原画と「AI読み取り」が一致しているか目視確認してください。
                            </span>
                          </div>
                        )}

                        {answer.stroke_issues && (
                          <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                            <span>字形メモ: {answer.stroke_issues}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 右：模範解答・AIコメント */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">模範解答・照合コメント</span>
                      {!question.manual_answer && (
                        <Link
                          to={`/review?id=${group.id}`}
                          className="text-[11px] font-semibold text-indigo-600 hover:underline"
                        >
                          模範解答を登録する →
                        </Link>
                      )}
                    </div>

                    <div className="text-base font-bold text-emerald-800">
                      {question.manual_answer ? (
                        question.manual_answer
                      ) : (
                        <span className="text-xs font-normal text-slate-400 inline-flex items-center gap-1">
                          <HelpCircle className="w-3.5 h-3.5" />
                          模範解答が未登録です
                        </span>
                      )}
                    </div>

                    {question.answer_aliases && question.answer_aliases.length > 0 && (
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-500">別解: </span>
                        {question.answer_aliases.join(' / ')}
                      </div>
                    )}

                    {question.grading_note && (
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-500">採点ルール: </span>
                        {question.grading_note}
                      </div>
                    )}

                    {answer.ai_feedback && (
                      <div className="rounded-lg bg-indigo-50/70 px-3 py-2 text-xs text-indigo-950">
                        {answer.ai_feedback}
                      </div>
                    )}

                    {question.memo && (
                      <div className="text-[11.5px] text-slate-500 border-t border-slate-100 pt-2">
                        解説メモ: {question.memo}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 手書き拡大モーダル */}
      {zoomSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-4"
          onClick={() => setZoomSrc(null)}
        >
          <div
            className="relative max-w-3xl max-h-[90vh] rounded-2xl bg-white p-4 shadow-2xl space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold text-slate-700">{zoomSrc.title}</span>
              <button
                type="button"
                onClick={() => setZoomSrc(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoomSrc.src}
              alt={zoomSrc.title}
              className="max-h-[75vh] w-auto mx-auto object-contain rounded border border-slate-200"
            />
          </div>
        </div>
      )}
    </div>
  );
};
