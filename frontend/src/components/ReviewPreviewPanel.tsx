import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Columns2,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { uploadUrl } from '../api/client';
import type {
  ExamGroupSection,
  OptionItem,
  Question,
  QuestionGroup,
  QuestionImage,
  QuestionType,
  SubjectType,
} from '../types';
import { QUESTION_TYPE_LABELS, SUBJECT_LABELS } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';
import { ExamFontSizeControl, loadSavedFontScale } from './ExamFontSizeControl';
import { KokugoVerticalSection } from './print/KokugoVerticalSection';
import { RishaHorizontalSection } from './print/RishaHorizontalSection';
import { RichJapaneseText } from './RichJapaneseText';

export interface PreviewEditableQuestion {
  id?: string;
  question_type: QuestionType;
  body: string;
  options: OptionItem[];
  answer_box_config: {
    type?: 'kanji_grid' | 'reading_box' | 'blank_line' | 'choice_only';
    cells?: number;
  };
  manual_answer: string;
  memo: string;
  needs_review: boolean;
}

interface ReviewPreviewPanelProps {
  mode: 'print' | 'bank';
  groupId: string;
  subject: SubjectType;
  sourceName: string;
  leadText: string;
  tags: string[];
  sourceImagePath: string | null;
  images: QuestionImage[];
  questions: PreviewEditableQuestion[];
}

export const ReviewPreviewPanel: React.FC<ReviewPreviewPanelProps> = ({
  mode,
  groupId,
  subject,
  sourceName,
  leadText,
  tags,
  sourceImagePath,
  images,
  questions,
}) => {
  const [paperSize, setPaperSize] = useState<'B4' | 'A4'>('B4');
  const [twoColumns, setTwoColumns] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState(Boolean(sourceImagePath));
  const [fontScale, setFontScale] = useState<number>(() => loadSavedFontScale());

  const todayStr = new Date().toLocaleDateString('ja-JP');
  const theme = SUBJECT_THEME[subject] || SUBJECT_THEME.rika;

  const previewSection = useMemo<ExamGroupSection>(() => {
    const nowIso = new Date().toISOString();
    const mappedQuestions: Question[] = questions.map((q, idx) => ({
      id: q.id || `preview-q-${idx}`,
      group_id: groupId,
      sort_order: idx,
      question_type: q.question_type,
      body: (q.body || '').replace(/<u>(.*?)<\/u>/gi, '==$1=='),
      options: (q.options || []).filter((o) => o.label.trim() || o.text.trim()),
      answer_box_config: {
        ...q.answer_box_config,
        type:
          q.question_type === 'kanji_read'
            ? 'reading_box'
            : q.question_type === 'kanji_write'
            ? 'kanji_grid'
            : q.answer_box_config.type || 'blank_line',
      },
      manual_answer: q.manual_answer.trim() || null,
      memo: q.memo,
      tested_count: 0,
      wrong_count: 0,
      last_tested_at: null,
      needs_review: q.needs_review,
      created_at: nowIso,
      updated_at: nowIso,
    }));

    const previewGroup: QuestionGroup = {
      id: groupId,
      subject,
      source_name: sourceName,
      source_image_path: sourceImagePath,
      lead_text: leadText,
      status: 'published',
      tags,
      created_at: nowIso,
      updated_at: nowIso,
      questions: mappedQuestions,
      images,
    };

    return {
      group: previewGroup,
      items: mappedQuestions.map((question, idx) => ({
        exam_item: {
          id: `preview-item-${idx}`,
          exam_id: 'preview',
          group_id: groupId,
          question_id: question.id,
          subject,
          section_order: 0,
          item_order: idx,
          is_wrong: null,
        },
        question,
      })),
    };
  }, [groupId, subject, sourceName, sourceImagePath, leadText, tags, questions, images]);

  const manualAnswerRows = questions
    .map((q, idx) => ({
      num: idx + 1,
      answer: q.manual_answer.trim(),
      memo: q.memo.trim(),
    }))
    .filter((row) => row.answer || row.memo);

  if (mode === 'bank') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-900">
          <Info className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
          <span>
            「問題バンクに登録」を押したあと、<strong>問題バンク一覧</strong>で実際に表示されるカードイメージです（未保存の編集内容もリアルタイム反映されます）。
          </span>
        </div>

        <article className="ui-card overflow-hidden max-w-4xl">
          <div className={`h-1.5 w-full ${theme.accentBarClass}`} />
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex-balance items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${theme.badgeClass}`}>
                  {SUBJECT_LABELS[subject]}
                </span>
                {sourceName ? (
                  <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                    {sourceName}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">（教材・出典なし）</span>
                )}
                {tags.map((t) => (
                  <span
                    key={t}
                    className="text-xs font-medium text-indigo-700 bg-indigo-50/80 px-2.5 py-0.5 rounded-lg"
                  >
                    #{t}
                  </span>
                ))}
                {images.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg ring-1 ring-inset ring-emerald-200/70">
                    <ImageIcon className="w-3 h-3" />
                    図版 {images.length}枚
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full ring-1 ring-inset ring-emerald-200">
                登録済みイメージ
              </span>
            </div>

            {leadText && (
              <div className="text-sm text-slate-800 bg-slate-50/90 border border-slate-100 rounded-xl p-3.5 font-exam leading-relaxed">
                <RichJapaneseText text={leadText} />
              </div>
            )}

            {images.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1 scroll-contain">
                {images.map((img) => (
                  <figure
                    key={img.id}
                    className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm text-center"
                  >
                    <img
                      src={uploadUrl(img.use_cleaned ? img.cleaned_path : img.raw_crop_path)}
                      alt={img.caption || '図版'}
                      className="block h-28 w-auto rounded-lg object-contain mx-auto"
                    />
                    {img.caption && (
                      <figcaption className="mt-1 text-[11px] font-medium text-slate-600">
                        {img.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}

            {questions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                小問がまだ登録されていません。「編集」タブから小問を追加してください。
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {questions.map((q, idx) => (
                  <div
                    key={q.id || `bank-q-${idx}`}
                    className="py-3 first:pt-1 last:pb-0 flex flex-wrap items-start justify-between gap-3 text-sm"
                  >
                    <div className="flex-1 min-w-[220px] space-y-1">
                      <div>
                        <span className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-md bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600 mr-2 align-middle">
                          {idx + 1}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100/80 px-1.5 py-0.5 rounded mr-2 align-middle">
                          {QUESTION_TYPE_LABELS[q.question_type]}
                        </span>
                        <span className="font-exam text-slate-900 leading-relaxed">
                          {q.body ? (
                            <RichJapaneseText text={q.body} />
                          ) : (
                            <span className="text-slate-400 font-sans text-xs">（設問文が未入力です）</span>
                          )}
                        </span>
                      </div>

                      {q.options && q.options.length > 0 && (
                        <div className="pl-7 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                          {q.options.map((opt, oi) => (
                            <span key={oi} className="inline-flex items-baseline gap-1">
                              <strong className="text-slate-800">{opt.label}</strong>
                              <span>{opt.text}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {(q.manual_answer.trim() || q.memo.trim()) && (
                        <div className="pl-7 pt-1 flex flex-wrap items-center gap-2 text-[11px]">
                          {q.manual_answer.trim() && (
                            <span className="rounded-md bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 font-semibold text-emerald-800">
                              解答: {q.manual_answer.trim()}
                            </span>
                          )}
                          {q.memo.trim() && (
                            <span className="text-slate-500">メモ: {q.memo.trim()}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {q.needs_review && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-rose-600 text-white px-2.5 py-1 font-semibold">
                          <AlertCircle className="w-3 h-3" />
                          要復習
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>
    );
  }

  // mode === 'print'（実際のテスト用紙レイアウト リアルタイムプレビュー）
  return (
    <div className="space-y-4">
      {/* プレビュー制御バー */}
      <div className="ui-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Eye className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>
            <strong className="text-slate-900">テスト印刷プレビュー</strong>
            （{subject === 'kokugo' ? '国語：縦書き・漢字マス' : `${SUBJECT_LABELS[subject]}：横書き・図版付き`} — 未保存の変更も即時反映）
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ExamFontSizeControl value={fontScale} onChange={setFontScale} />

          {subject === 'kokugo' ? (
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
              {(['B4', 'A4'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setPaperSize(sz)}
                  className={`px-3 py-1 rounded-lg font-bold transition ${
                    paperSize === sz
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sz} 横向き
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTwoColumns((v) => !v)}
              aria-pressed={twoColumns}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-semibold transition ${
                twoColumns
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              {twoColumns ? '2段組プレビュー中' : '1段組プレビュー中'}
            </button>
          )}

          {sourceImagePath && (
            <button
              type="button"
              role="switch"
              aria-checked={compareOriginal}
              onClick={() => setCompareOriginal((v) => !v)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-semibold transition ${
                compareOriginal
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100/80'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {compareOriginal ? (
                <PanelLeftClose className="w-3.5 h-3.5 text-indigo-600" />
              ) : (
                <PanelLeftOpen className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>原本画像</span>
              <span
                aria-hidden="true"
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  compareOriginal ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                    compareOriginal ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="text-[11px] font-bold">
                {compareOriginal ? '表示' : '非表示'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* プレビュー本体（任意で左に原本画像を並べて照合可能） */}
      <div
        className={
          compareOriginal && sourceImagePath
            ? 'grid grid-cols-1 xl:grid-cols-12 gap-5 items-start'
            : 'block'
        }
      >
        {compareOriginal && sourceImagePath && (
          <div className="xl:col-span-4 ui-card p-4 space-y-2.5 xl:sticky xl:top-20">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-slate-800 truncate">原本画像（照合用）</span>
                <span className="text-[11px] text-slate-400 hidden sm:inline">誤字・抜けチェック</span>
              </div>
              <button
                type="button"
                onClick={() => setCompareOriginal(false)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition shrink-0"
                title="原本画像パネルを非表示にする"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
                非表示
              </button>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-[72vh] overflow-y-auto scroll-contain">
              <img
                src={uploadUrl(sourceImagePath)}
                alt="原本宿題画像"
                className="block w-full h-auto object-contain"
              />
            </div>
          </div>
        )}

        <div className={compareOriginal && sourceImagePath ? 'xl:col-span-8 min-w-0' : 'min-w-0'}>
          {questions.length === 0 ? (
            <div className="ui-card p-10 text-center text-sm text-slate-500">
              小問がまだありません。「編集」タブから小問を追加すると、ここに印刷レイアウトが表示されます。
            </div>
          ) : (
            <div className="rounded-3xl bg-slate-200/75 p-4 sm:p-6 border border-slate-300/70 overflow-x-auto scroll-contain">
              {subject === 'kokugo' ? (
                <div
                  style={{ '--exam-font-scale': String(fontScale) } as React.CSSProperties}
                  className={`exam-sheet ${
                    paperSize === 'B4' ? 'exam-paper-b4-landscape' : 'exam-paper-a4-landscape'
                  } mx-auto shadow-xl ring-1 ring-slate-900/10`}
                >
                  <KokugoVerticalSection
                    title="確認テスト（プレビュー）"
                    dateStr={todayStr}
                    groups={[previewSection]}
                    gradingMode={false}
                    onToggleGrade={() => {}}
                  />
                </div>
              ) : (
                <div
                  style={{ '--exam-font-scale': String(fontScale) } as React.CSSProperties}
                  className={`exam-sheet mx-auto shadow-xl ring-1 ring-slate-900/10 p-6 sm:p-10 ${
                    twoColumns ? 'min-w-[820px] max-w-[1040px]' : 'max-w-[780px]'
                  }`}
                >
                  <RishaHorizontalSection
                    subject={subject}
                    title="確認テスト（プレビュー）"
                    dateStr={todayStr}
                    twoColumns={twoColumns}
                    groups={[previewSection]}
                    gradingMode={false}
                    onToggleGrade={() => {}}
                  />
                </div>
              )}
            </div>
          )}

          {/* 保護者手入力の解答メモ確認 */}
          {manualAnswerRows.length > 0 && (
            <div className="mt-4 ui-card p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <FileText className="w-4 h-4 text-indigo-600" />
                解答メモ（保護者用添付プレビュー）
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {manualAnswerRows.map((row) => (
                  <div key={row.num} className="py-1.5 flex flex-wrap items-baseline gap-3">
                    <span className="font-bold text-slate-500 w-10">({row.num})</span>
                    {row.answer && <span className="font-bold text-slate-900">{row.answer}</span>}
                    {row.memo && <span className="text-slate-500">{row.memo}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
