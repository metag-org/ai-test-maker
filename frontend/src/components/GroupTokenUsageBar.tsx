import React from 'react';
import { Cpu } from 'lucide-react';
import type { GroupLLMUsage } from '../types';
import { InfoTooltip, Tooltip } from './Tooltip';

interface GroupTokenUsageBarProps {
  usage?: GroupLLMUsage | null;
  variant?: 'full' | 'badge';
}

export const GroupTokenUsageBar: React.FC<GroupTokenUsageBarProps> = ({
  usage,
  variant = 'full',
}) => {
  if (!usage || typeof usage.total_tokens !== 'number' || usage.total_tokens <= 0) {
    return null;
  }

  const extract = usage.extract;
  const suggest = usage.answer_suggest;
  const imgAns = usage.answer_image;

  const detailContent = (
    <div className="space-y-1.5">
      <div className="font-bold text-indigo-200">問題登録・解答生成 AIトークン内訳</div>
      <div>モデル: {usage.model || '不明'}</div>
      <div>
        ・画像から問題抽出: {extract?.calls ?? 0}回 / 入力 {(extract?.input_tokens ?? 0).toLocaleString()} / 出力{' '}
        {(extract?.output_tokens ?? 0).toLocaleString()} / 計 {(extract?.total_tokens ?? 0).toLocaleString()}
        {extract?.shared_groups && extract.shared_groups > 1
          ? `（1枚の画像から${extract.shared_groups}大問を一括抽出）`
          : ''}
      </div>
      <div>
        ・AI解答下書き生成: {suggest?.calls ?? 0}回 / 入力 {(suggest?.input_tokens ?? 0).toLocaleString()} / 出力{' '}
        {(suggest?.output_tokens ?? 0).toLocaleString()} / 計 {(suggest?.total_tokens ?? 0).toLocaleString()}
      </div>
      <div>
        ・解答写真から取込: {imgAns?.calls ?? 0}回 / 入力 {(imgAns?.input_tokens ?? 0).toLocaleString()} / 出力{' '}
        {(imgAns?.output_tokens ?? 0).toLocaleString()} / 計 {(imgAns?.total_tokens ?? 0).toLocaleString()}
      </div>
      <div className="pt-1 border-t border-white/10 font-mono text-indigo-100">
        合計: {usage.total_tokens.toLocaleString()} tokens（入力 {(usage.total_input_tokens ?? 0).toLocaleString()} / 出力{' '}
        {(usage.total_output_tokens ?? 0).toLocaleString()}
        {(usage.total_thoughts_tokens ?? 0) > 0
          ? ` / 思考 ${(usage.total_thoughts_tokens ?? 0).toLocaleString()}`
          : ''}
        ）
      </div>
    </div>
  );

  if (variant === 'badge') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-mono font-semibold text-slate-700 ring-1 ring-inset ring-slate-200/90">
        <Tooltip content={detailContent} maxWidth={330}>
          <span className="inline-flex items-center gap-1">
            <Cpu className="w-3 h-3 text-indigo-600" />
            AI {usage.total_tokens.toLocaleString()} tok
          </span>
        </Tooltip>
        <InfoTooltip label="AIトークン内訳" content={detailContent} maxWidth={330} />
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/90 px-3.5 py-2 text-[11.5px] text-slate-700">
      <span className="inline-flex items-center gap-1 font-bold text-slate-800">
        <Cpu className="w-3.5 h-3.5 text-indigo-600" />
        AIトークン消費:
      </span>
      <span className="font-mono font-extrabold text-indigo-700">
        合計 {usage.total_tokens.toLocaleString()}
      </span>
      <span className="text-slate-500 font-mono">
        （入力 {(usage.total_input_tokens ?? 0).toLocaleString()} / 出力{' '}
        {(usage.total_output_tokens ?? 0).toLocaleString()}
        {(usage.total_thoughts_tokens ?? 0) > 0
          ? ` / 思考 ${(usage.total_thoughts_tokens ?? 0).toLocaleString()}`
          : ''}
        ）
      </span>

      {extract && extract.total_tokens > 0 && (
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200">
          問題抽出: {extract.total_tokens.toLocaleString()}（入 {extract.input_tokens.toLocaleString()} / 出{' '}
          {extract.output_tokens.toLocaleString()}）
        </span>
      )}
      {suggest && suggest.total_tokens > 0 && (
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200">
          AI解答候補: {suggest.total_tokens.toLocaleString()}（入 {suggest.input_tokens.toLocaleString()} / 出{' '}
          {suggest.output_tokens.toLocaleString()}）
        </span>
      )}
      {imgAns && imgAns.total_tokens > 0 && (
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-mono text-slate-700 ring-1 ring-inset ring-slate-200">
          解答写真取込: {imgAns.total_tokens.toLocaleString()}（入 {imgAns.input_tokens.toLocaleString()} / 出{' '}
          {imgAns.output_tokens.toLocaleString()}）
        </span>
      )}
      {usage.model && (
        <span className="text-[10.5px] text-slate-400 font-mono">[{usage.model}]</span>
      )}
      <InfoTooltip label="AIトークン消費の内訳" content={detailContent} maxWidth={330} />
    </div>
  );
};
