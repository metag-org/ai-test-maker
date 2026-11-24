import React from 'react';
import type { ExamGroupSection } from '../../types';
import { RichJapaneseText } from '../RichJapaneseText';

interface KokugoVerticalSectionProps {
  title: string;
  dateStr: string;
  groups: ExamGroupSection[];
  gradingMode: boolean;
  onToggleGrade: (examItemId: string, nextWrong: boolean | null) => void;
}

const KANJI_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export const KokugoVerticalSection: React.FC<KokugoVerticalSectionProps> = ({
  title,
  dateStr,
  groups,
  gradingMode,
  onToggleGrade,
}) => {
  return (
    <section className="subject-page-break">
      <div className="kokugo-vertical-container">
        {/* 国語 縦書きテスト表頭（右端） */}
        <div className="kokugo-header-vertical">
          <div>
            <div className="text-xs tracking-widest mb-1 font-sans text-slate-700">
              復習プリント
            </div>
            <div className="text-lg font-bold tracking-wider">
              {title}【国語】
            </div>
          </div>

          <div className="flex flex-col items-start gap-2.5 text-sm">
            <div>
              実施日：<span className="border-l border-black pl-1 py-0.5">{dateStr}</span>
            </div>
            <div>
              氏名：<span className="inline-block h-24 border-l border-black/80 ml-1 align-middle" />
            </div>
            <div className="border border-black px-1.5 py-2 text-center">
              <div className="text-xs mb-1">得点</div>
              <div className="h-12" />
              <div className="text-xs border-t border-black pt-1">点</div>
            </div>
          </div>
        </div>

        {/* 各大問（漢字プリント風の縦書き列グリッド） */}
        {groups.map((sec, secIdx) => {
          const daimonLabel = KANJI_NUMERALS[secIdx] || String(secIdx + 1);
          const lead =
            sec.group.lead_text ||
            '傍線部のカタカナを漢字に、漢字を読み仮名に直しなさい。';
          return (
            <React.Fragment key={`${sec.group.id}-${secIdx}`}>
              {/* 大問リード文列 */}
              <div className="kokugo-daimon-lead">
                <span className="inline-block border border-black px-1 py-0.5 ml-1 font-sans text-sm">
                  {daimonLabel}
                </span>{' '}
                <RichJapaneseText text={lead} vertical />
                {sec.group.source_name && (
                  <span className="text-[0.8em] text-slate-500 mt-3 inline-block no-print">
                    （出典：{sec.group.source_name}）
                  </span>
                )}
              </div>

              {/* 小問グリッド（右から左へ 1, 2, 3... と整列） */}
              <div className="kokugo-grid-strip">
                {sec.items.map(({ exam_item, question }, qIdx) => {
                  const cells = Math.max(1, Math.min(6, question.answer_box_config?.cells || 2));
                  const boxType =
                    question.question_type === 'kanji_read'
                      ? 'reading_box'
                      : question.answer_box_config?.type || 'kanji_grid';

                  return (
                    <div key={exam_item.id} className="kokugo-question-col">
                      {/* 上部：問題番号 */}
                      <div className="kokugo-qnum-cell">{qIdx + 1}</div>

                      {/* 中部：縦書き問題文（右傍線・ルビ付き） */}
                      <div className="kokugo-qbody-cell">
                        <RichJapaneseText text={question.body} vertical />
                      </div>

                      {/* 下部：揃った解答欄（漢字マス目 または 読み仮名枠） */}
                      <div className="kokugo-qanswer-cell">
                        {boxType === 'kanji_grid' ? (
                          <div className="kanji-grid-vertical" aria-label="漢字解答マス">
                            {Array.from({ length: cells }).map((_, cIdx) => (
                              <div key={cIdx} className="kanji-cell" />
                            ))}
                          </div>
                        ) : (
                          <div className="reading-box-vertical" aria-label="読み解答欄" />
                        )}
                      </div>

                      {/* 採点モード時の ○/× ボタン（印刷非表示） */}
                      {gradingMode && (
                        <div
                          className="no-print flex flex-col items-center gap-1 py-1 border-t border-slate-200 bg-slate-50"
                          style={{ writingMode: 'horizontal-tb' }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onToggleGrade(
                                exam_item.id,
                                exam_item.is_wrong === false ? null : false
                              )
                            }
                            className={`w-10 py-0.5 text-[11px] rounded border font-bold ${
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
                            className={`w-10 py-0.5 text-[11px] rounded border font-bold ${
                              exam_item.is_wrong === true
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-rose-50'
                            }`}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
};
