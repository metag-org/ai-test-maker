import React from 'react';
import { uploadUrl } from '../../api/client';
import type { ExamGroupSection, SubjectType } from '../../types';
import { SUBJECT_LABELS } from '../../types';
import { RichJapaneseText } from '../RichJapaneseText';

interface RishaHorizontalSectionProps {
  subject: SubjectType;
  title: string;
  dateStr: string;
  twoColumns: boolean;
  groups: ExamGroupSection[];
  gradingMode: boolean;
  onToggleGrade: (examItemId: string, nextWrong: boolean | null) => void;
}

export const RishaHorizontalSection: React.FC<RishaHorizontalSectionProps> = ({
  subject,
  title,
  dateStr,
  twoColumns,
  groups,
  gradingMode,
  onToggleGrade,
}) => {
  const subjName = SUBJECT_LABELS[subject] || subject;

  return (
    <section className="subject-page-break risha-horizontal-container">
      {/* 理科・社会 横書き表頭 */}
      <div className="border-b-2 border-black pb-2 mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans tracking-wider text-slate-700">復習プリント</div>
          <h2 className="text-xl font-bold mt-0.5">
            {title}【{subjName}】
          </h2>
        </div>

        <div className="flex items-end gap-5 text-sm">
          <div>
            実施日：<span className="border-b border-black px-2">{dateStr}</span>
          </div>
          <div>
            氏名：<span className="inline-block w-36 border-b border-black" />
          </div>
          <div className="border border-black px-3 py-1 text-center min-w-[78px]">
            <span className="text-xs mr-3">得点</span>
            <span className="inline-block w-8" />
            <span className="text-xs">点</span>
          </div>
        </div>
      </div>

      {/* 大問本体 */}
      <div className={twoColumns ? 'risha-two-columns' : ''}>
        {groups.map((sec, secIdx) => {
          const images = sec.group.images || [];
          return (
            <div key={`${sec.group.id}-${secIdx}`} className="risha-group-block">
              {/* 大問番号 + リード文 */}
              <div className="flex items-start mb-2.5">
                <span className="daimon-badge">{secIdx + 1}</span>
                <div className="flex-1 font-medium">
                  {sec.group.lead_text ? (
                    <RichJapaneseText text={sec.group.lead_text} />
                  ) : (
                    <span>次の問いに答えなさい。</span>
                  )}
                  {sec.group.source_name && (
                    <span className="text-xs text-slate-500 ml-2 no-print">
                      （出典：{sec.group.source_name}）
                    </span>
                  )}
                </div>
              </div>

              {/* グループ共通図版 */}
              {images.length > 0 && (
                <div className="my-3 flex flex-wrap gap-3 justify-center">
                  {images.map((img) => {
                    const imgSrc = uploadUrl(img.use_cleaned ? img.cleaned_path : img.raw_crop_path);
                    return (
                      <figure
                        key={img.id}
                        className="border border-slate-300 p-1.5 bg-white max-w-full text-center"
                      >
                        <img
                          src={imgSrc}
                          alt={img.caption || '図版'}
                          className="max-h-56 w-auto mx-auto object-contain"
                        />
                        {img.caption && (
                          <figcaption className="text-xs mt-1 font-sans text-slate-700">
                            {img.caption}
                          </figcaption>
                        )}
                      </figure>
                    );
                  })}
                </div>
              )}

              {/* 小問リスト */}
              <div className="space-y-3 pl-2">
                {sec.items.map(({ exam_item, question }, qIdx) => {
                  const hasOptions = question.options && question.options.length > 0;
                  const shortOptions =
                    hasOptions && question.options.every((o) => (o.text || '').length <= 14);

                  return (
                    <div key={exam_item.id} className="risha-question-block">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <span className="font-sans font-semibold mr-1.5">({qIdx + 1})</span>
                          <RichJapaneseText text={question.body} />
                        </div>

                        {gradingMode && (
                          <div className="no-print flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                onToggleGrade(
                                  exam_item.id,
                                  exam_item.is_wrong === false ? null : false
                                )
                              }
                              className={`px-2 py-0.5 text-xs rounded border ${
                                exam_item.is_wrong === false
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : 'bg-white text-slate-600 border-slate-300 hover:bg-emerald-50'
                              }`}
                            >
                              ○
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onToggleGrade(
                                  exam_item.id,
                                  exam_item.is_wrong === true ? null : true
                                )
                              }
                              className={`px-2 py-0.5 text-xs rounded border ${
                                exam_item.is_wrong === true
                                  ? 'bg-rose-600 text-white border-rose-600'
                                  : 'bg-white text-slate-600 border-slate-300 hover:bg-rose-50'
                              }`}
                            >
                              × 要復習
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 選択肢一覧 */}
                      {hasOptions && (
                        <div
                          className={`mt-1.5 pl-6 grid gap-x-5 gap-y-1 text-[0.95em] ${
                            shortOptions ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'
                          }`}
                        >
                          {question.options.map((opt, oIdx) => (
                            <div key={oIdx} className="flex items-start gap-1">
                              <span className="font-sans font-semibold shrink-0">{opt.label}</span>
                              <span>
                                <RichJapaneseText text={opt.text} />
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 解答欄（選択問題でも記号記入欄、記述問題なら下線） */}
                      {hasOptions ? (
                        <div className="mt-1.5 pl-6 text-right text-xs text-slate-700">
                          答（　　　　　　）
                        </div>
                      ) : (
                        <div className="pl-6">
                          <span className="answer-line-horizontal" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
