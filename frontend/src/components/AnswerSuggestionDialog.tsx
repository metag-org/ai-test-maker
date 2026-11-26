import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Cpu, Image as ImageIcon, Sparkles, X } from 'lucide-react';
import type { AnswerSuggestionItem, AnswerSuggestionResponse } from '../types';
import { InfoTooltip } from './Tooltip';

export interface CurrentQuestionRef {
  id?: string;
  body: string;
  manual_answer: string;
}

interface AnswerSuggestionDialogProps {
  open: boolean;
  response: AnswerSuggestionResponse | null;
  currentQuestions: CurrentQuestionRef[];
  onClose: () => void;
  onApply: (selectedItems: AnswerSuggestionItem[]) => void;
}

export const AnswerSuggestionDialog: React.FC<AnswerSuggestionDialogProps> = ({
  open,
  response,
  currentQuestions,
  onClose,
  onApply,
}) => {
  const [checkedOrders, setCheckedOrders] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || !response) return;
    // 既存の解答が空で、候補が存在する設問だけ初期チェック（既存の手入力を誤上書きしない）
    const init = new Set<number>();
    response.items.forEach((it) => {
      const cur = currentQuestions[it.question_order - 1];
      const hasExisting = Boolean(cur?.manual_answer?.trim());
      if (it.suggested_answer.trim() && !hasExisting) {
        init.add(it.question_order);
      }
    });
    setCheckedOrders(init);
  }, [open, response, currentQuestions]);

  if (!open || !response) return null;

  const isFromImage = response.source === 'answer_image';

  const toggleOrder = (order: number) => {
    setCheckedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  };

  const selectEmptyOnly = () => {
    const next = new Set<number>();
    response.items.forEach((it) => {
      const cur = currentQuestions[it.question_order - 1];
      if (it.suggested_answer.trim() && !cur?.manual_answer?.trim()) {
        next.add(it.question_order);
      }
    });
    setCheckedOrders(next);
  };

  const selectAllValid = () => {
    const next = new Set<number>();
    response.items.forEach((it) => {
      if (it.suggested_answer.trim()) next.add(it.question_order);
    });
    setCheckedOrders(next);
  };

  const handleConfirm = () => {
    const chosen = response.items.filter((it) => checkedOrders.has(it.question_order));
    onApply(chosen);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 bg-slate-50/70">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {isFromImage ? (
                <ImageIcon className="w-4 h-4 text-emerald-600" />
              ) : (
                <Sparkles className="w-4 h-4 text-indigo-600" />
              )}
              <h2 className="text-base font-bold text-slate-900">
                {isFromImage
                  ? '解答ページ写真から抽出した模範解答（確認・反映）'
                  : 'AI が作成した模範解答の候補（確認・反映）'}
              </h2>
              <InfoTooltip content="ここでは編集フォームへの下書き反映のみ行います。反映後に画面で内容を確認し、「保存」または「問題バンクへ登録」を押すまでデータベースは更新されません。" />
            </div>
            <p className="text-xs text-slate-500">
              すでに手入力済みの設問は初期状態では未チェックになっています。反映したい設問を選んでください。
            </p>
            {response.call_usage && typeof response.call_usage.total_tokens === 'number' && response.call_usage.total_tokens > 0 && (
              <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200 mt-1">
                <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                <span className="font-sans font-bold text-slate-700">今回の消費:</span>
                <span className="font-bold text-indigo-700">
                  {response.call_usage.total_tokens.toLocaleString()} tokens
                </span>
                <span className="text-slate-500">
                  （入力 {(response.call_usage.input_tokens ?? 0).toLocaleString()} / 出力{' '}
                  {(response.call_usage.output_tokens ?? 0).toLocaleString()}
                  {(response.call_usage.thoughts_tokens ?? 0) > 0
                    ? ` / 思考 ${(response.call_usage.thoughts_tokens ?? 0).toLocaleString()}`
                    : ''}
                  ）
                </span>
                {response.call_usage.model && (
                  <span className="text-slate-400">[{response.call_usage.model}]</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 一括選択バー */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-2.5 text-xs bg-white">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectEmptyOnly}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              未登録の空欄のみ選択
            </button>
            <button
              type="button"
              onClick={selectAllValid}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              候補ありをすべて選択
            </button>
            <button
              type="button"
              onClick={() => setCheckedOrders(new Set())}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-500 hover:bg-slate-50"
            >
              すべて解除
            </button>
          </div>
          <span className="font-bold text-indigo-700">選択中: {checkedOrders.size} 問</span>
        </div>

        {/* 対比リスト */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {response.items.map((it) => {
            const cur = currentQuestions[it.question_order - 1];
            const checked = checkedOrders.has(it.question_order);
            const hasCandidate = Boolean(it.suggested_answer.trim());
            const confPct = Math.round((it.confidence || 0) * 100);

            return (
              <label
                key={it.question_order}
                className={`block rounded-xl border p-3.5 transition cursor-pointer ${
                  checked
                    ? 'border-indigo-400 bg-indigo-50/40 ring-1 ring-indigo-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50/70'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    disabled={!hasCandidate}
                    checked={checked}
                    onChange={() => toggleOrder(it.question_order)}
                    className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-800 truncate">
                        ({it.question_order}) {cur?.body || '（問題文なし）'}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
                          confPct >= 95
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-300'
                            : confPct >= 80
                            ? 'bg-amber-100 text-amber-950 ring-amber-400'
                            : 'bg-rose-100 text-rose-800 ring-rose-400'
                        }`}
                      >
                        {confPct < 95 && <AlertTriangle className="w-3 h-3" />}
                        確信度 {confPct}%{confPct < 95 ? '（要確認）' : ''}
                      </span>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-slate-50 px-2.5 py-2 border border-slate-200/70">
                        <div className="text-[10px] font-semibold text-slate-400">現在の解答</div>
                        <div className="font-semibold text-slate-700 mt-0.5">
                          {cur?.manual_answer?.trim() || '（未登録）'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-emerald-50/60 px-2.5 py-2 border border-emerald-200/70">
                        <div className="text-[10px] font-semibold text-emerald-700">
                          {isFromImage ? '解答写真から抽出' : 'AI候補'}
                        </div>
                        <div className="font-bold text-emerald-900 mt-0.5">
                          {it.suggested_answer.trim() || '（該当なし）'}
                        </div>
                        {it.suggested_aliases.length > 0 && (
                          <div className="text-[11px] text-emerald-800 mt-0.5">
                            別解: {it.suggested_aliases.join(' / ')}
                          </div>
                        )}
                        {it.suggested_grading_note && (
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            採点ルール: {it.suggested_grading_note}
                          </div>
                        )}
                      </div>
                    </div>

                    {it.reason && (
                      <div className="text-[11px] text-slate-500">根拠: {it.reason}</div>
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5 bg-slate-50/70">
          <button type="button" onClick={onClose} className="ui-btn-secondary px-4 py-2 text-xs">
            キャンセル
          </button>
          <button
            type="button"
            disabled={checkedOrders.size === 0}
            onClick={handleConfirm}
            className="ui-btn-primary px-4 py-2 text-xs disabled:opacity-40"
          >
            <Check className="w-4 h-4" />
            選択した {checkedOrders.size} 問をフォームに反映
          </button>
        </div>
      </div>
    </div>
  );
};
