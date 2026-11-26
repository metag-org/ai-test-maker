import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, FileText, PenLine, Printer } from 'lucide-react';
import { api } from '../api/client';
import { Tooltip } from '../components/Tooltip';
import {
  clampFontScale,
  ExamFontSizeControl,
  loadSavedFontScale,
} from '../components/ExamFontSizeControl';
import { KokugoVerticalSection } from '../components/print/KokugoVerticalSection';
import { RishaHorizontalSection } from '../components/print/RishaHorizontalSection';
import type { ExamDetail, SubjectType } from '../types';
import { SUBJECT_LABELS } from '../types';

export const ExamPrintPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [paperSize, setPaperSize] = useState<'B4' | 'A4'>('B4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [twoColumns, setTwoColumns] = useState(true);
  const [fontScale, setFontScale] = useState<number>(() => loadSavedFontScale());
  const [gradingMode, setGradingMode] = useState(searchParams.get('mode') === 'grade');
  const [showAnswerMemo, setShowAnswerMemo] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.getExam(id);
      setExam(data);
      setPaperSize(data.paper_size === 'A4' ? 'A4' : 'B4');
      const lc = data.layout_config || {};
      if (lc.orientation === 'portrait' || lc.orientation === 'landscape') {
        setOrientation(lc.orientation);
      }
      if (typeof lc.two_columns === 'boolean') {
        setTwoColumns(lc.two_columns);
      }
      if (typeof lc.font_scale === 'number') {
        setFontScale(clampFontScale(lc.font_scale));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleToggleGrade = async (examItemId: string, nextWrong: boolean | null) => {
    if (!exam) return;
    await api.gradeExamItem(exam.id, examItemId, nextWrong);
    // ローカル状態即時反映
    setExam((prev) => {
      if (!prev) return prev;
      const nextSections: ExamDetail['sections'] = {};
      for (const [subj, secList] of Object.entries(prev.sections)) {
        if (!secList) continue;
        nextSections[subj as SubjectType] = secList.map((sec) => ({
          ...sec,
          items: sec.items.map((it) =>
            it.exam_item.id === examItemId
              ? { ...it, exam_item: { ...it.exam_item, is_wrong: nextWrong } }
              : it
          ),
        }));
      }
      return { ...prev, sections: nextSections };
    });
  };

  if (loading || !exam) {
    return <div className="p-8 text-center text-slate-500">読み込み中...</div>;
  }

  const dateStr = new Date(exam.created_at).toLocaleDateString('ja-JP');

  // 保護者手入力の解答が存在するかをチェック
  const manualAnswers: { subject: SubjectType; numLabel: string; source: string; answer: string; memo: string }[] = [];
  (['kokugo', 'rika', 'shakai', 'sansu'] as SubjectType[]).forEach((subj) => {
    const secs = exam.sections[subj] || [];
    secs.forEach((sec, sIdx) => {
      sec.items.forEach(({ question }, qIdx) => {
        if (question.manual_answer && question.manual_answer.trim()) {
          manualAnswers.push({
            subject: subj,
            numLabel: `大問${sIdx + 1} (${qIdx + 1})`,
            source: sec.group.source_name,
            answer: question.manual_answer.trim(),
            memo: question.memo || '',
          });
        }
      });
    });
  });

  // 動的 @page サイズルール (JIS B4 = 257mm x 364mm, A4 = 210mm x 297mm)
  const pageDims =
    paperSize === 'B4'
      ? orientation === 'landscape'
        ? '364mm 257mm'
        : '257mm 364mm'
      : orientation === 'landscape'
      ? '297mm 210mm'
      : '210mm 297mm';

  const paperClass =
    paperSize === 'B4'
      ? orientation === 'landscape'
        ? 'exam-paper-b4-landscape'
        : 'exam-paper-b4-portrait'
      : orientation === 'landscape'
      ? 'exam-paper-a4-landscape'
      : 'exam-paper-a4-portrait';

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          @page {
            size: ${pageDims};
            margin: 12mm 14mm;
          }
        }
      `}</style>

      {/* 上部ツールバー（印刷時は非表示） */}
      <div className="no-print ui-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/exams"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-indigo-700 transition shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            一覧へ
          </Link>
          <span className="font-bold text-slate-900 truncate">{exam.title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ExamFontSizeControl value={fontScale} onChange={setFontScale} />

          <select
            aria-label="用紙サイズ"
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as 'B4' | 'A4')}
            className="rounded-xl border border-slate-300/90 px-3 py-2 bg-white font-semibold text-slate-700"
          >
            <option value="B4">B4（257×364mm）</option>
            <option value="A4">A4（210×297mm）</option>
          </select>

          <select
            aria-label="用紙の向き"
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}
            className="rounded-xl border border-slate-300/90 px-3 py-2 bg-white font-semibold text-slate-700"
          >
            <option value="landscape">横向き</option>
            <option value="portrait">縦向き</option>
          </select>

          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/90 hover:bg-slate-100 cursor-pointer font-medium text-slate-700 transition">
            <input
              type="checkbox"
              checked={twoColumns}
              onChange={(e) => setTwoColumns(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            <span>理社2段組</span>
          </label>

          {manualAnswers.length > 0 && (
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/90 hover:bg-slate-100 cursor-pointer font-medium text-slate-700 transition">
              <input
                type="checkbox"
                checked={showAnswerMemo}
                onChange={(e) => setShowAnswerMemo(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>解答メモ ({manualAnswers.length})</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => setGradingMode((v) => !v)}
            aria-pressed={gradingMode}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border font-bold transition ${
              gradingMode
                ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            {gradingMode ? '採点モード ON' : '採点・間違い記録'}
          </button>

          <Tooltip content="このテストをPC・タブレットでそのまま手書き解答し、AI自動採点を行います。">
            <Link
              to={`/exams/${exam.id}/solve`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100 transition"
            >
              <PenLine className="w-4 h-4" />
              オンラインで解く
            </Link>
          </Tooltip>

          <button
            type="button"
            onClick={() => window.print()}
            className="ui-btn-primary px-4 py-2 text-xs"
          >
            <Printer className="w-4 h-4" />
            印刷 / PDF保存
          </button>
        </div>
      </div>

      {gradingMode && (
        <div className="no-print bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-4 py-3 text-xs leading-relaxed">
          <strong>採点モード中：</strong>各問題の横にある「× 要復習」を押すと、問題バンクの要復習フラグと間違い回数が自動更新され、次回のテスト作成時に優先抽出されます。
        </div>
      )}

      {/* テスト用紙プレビュー＆印刷エリア */}
      <div className="print-only-wrapper overflow-x-auto rounded-3xl bg-slate-200/70 p-4 sm:p-8 border border-slate-300/60">
        <div
          style={{ '--exam-font-scale': String(fontScale) } as React.CSSProperties}
          className={`exam-sheet ${paperClass} mx-auto shadow-xl ring-1 ring-slate-900/10 space-y-10`}
        >
          {/* 国語（必ず縦書き） */}
          {exam.sections.kokugo && exam.sections.kokugo.length > 0 && (
            <KokugoVerticalSection
              title={exam.title}
              dateStr={dateStr}
              groups={exam.sections.kokugo}
              gradingMode={gradingMode}
              onToggleGrade={handleToggleGrade}
            />
          )}

          {/* 理科（横書き・別ページ） */}
          {exam.sections.rika && exam.sections.rika.length > 0 && (
            <RishaHorizontalSection
              subject="rika"
              title={exam.title}
              dateStr={dateStr}
              twoColumns={twoColumns}
              groups={exam.sections.rika}
              gradingMode={gradingMode}
              onToggleGrade={handleToggleGrade}
            />
          )}

          {/* 社会（横書き・別ページ） */}
          {exam.sections.shakai && exam.sections.shakai.length > 0 && (
            <RishaHorizontalSection
              subject="shakai"
              title={exam.title}
              dateStr={dateStr}
              twoColumns={twoColumns}
              groups={exam.sections.shakai}
              gradingMode={gradingMode}
              onToggleGrade={handleToggleGrade}
            />
          )}

          {/* 保護者手入力 解答メモ一覧（任意添付） */}
          {showAnswerMemo && manualAnswers.length > 0 && (
            <section className="subject-page-break risha-horizontal-container">
              <div className="border-b-2 border-black pb-2 mb-4">
                <h2 className="text-lg font-bold">{exam.title}【解答メモ（保護者用）】</h2>
              </div>
              <table className="w-full text-sm border-collapse border border-black">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-black px-2 py-1 text-left w-20">科目</th>
                    <th className="border border-black px-2 py-1 text-left w-28">番号</th>
                    <th className="border border-black px-2 py-1 text-left">解答</th>
                    <th className="border border-black px-2 py-1 text-left">出典・メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {manualAnswers.map((row, idx) => (
                    <tr key={idx}>
                      <td className="border border-black px-2 py-1">{SUBJECT_LABELS[row.subject]}</td>
                      <td className="border border-black px-2 py-1">{row.numLabel}</td>
                      <td className="border border-black px-2 py-1 font-bold">{row.answer}</td>
                      <td className="border border-black px-2 py-1 text-xs">
                        {row.source} {row.memo}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
