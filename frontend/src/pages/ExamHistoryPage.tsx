import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  PenLine,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { Tooltip } from '../components/Tooltip';
import type { ExamSummary } from '../types';
import { SUBJECT_LABELS } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';

export const ExamHistoryPage: React.FC = () => {
  const { showToast } = useToast();
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ExamSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setExams(await api.listExams());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteExam(deleteTarget.id);
      const deletedTitle = deleteTarget.title;
      setDeleteTarget(null);
      await load();
      showToast(`「${deletedTitle}」を削除しました。`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '削除に失敗しました。', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-900">
            テスト履歴・採点
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            作成したテストの再印刷や、実施後の間違いチェック（要復習マーク登録）が行えます。
          </p>
        </div>
        <Link to="/exams/new" className="ui-btn-primary">
          <Plus className="w-4 h-4" />
          新しくテストを作成
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[1, 2, 3].map((n) => (
            <div key={n} className="ui-card p-5 animate-pulse flex items-center justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="h-5 w-52 rounded bg-slate-200" />
                <div className="h-3.5 w-72 rounded bg-slate-100" />
              </div>
              <div className="h-9 w-40 rounded-xl bg-slate-100" />
            </div>
          ))}
        </div>
      ) : exams.length === 0 ? (
        <div className="ui-card p-12 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
            <History className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-800">まだ作成されたテストがありません</h2>
            <p className="text-xs sm:text-sm text-slate-500">
              登録済みの問題から確認テストを作成すると、ここに履歴と採点記録が蓄積されます。
            </p>
          </div>
          <div className="pt-1">
            <Link to="/exams/new" className="ui-btn-primary">
              <Plus className="w-4 h-4" />
              最初のテストを作成する
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {exams.map((ex) => (
            <article
              key={ex.id}
              className="ui-card p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 transition hover:shadow-md"
            >
              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                <span className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/exams/${ex.id}`}
                      className="text-base font-bold text-slate-900 hover:text-indigo-700 transition"
                    >
                      {ex.title}
                    </Link>
                    <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-bold ring-1 ring-inset ring-slate-200/80">
                      {ex.paper_size}
                    </span>
                    {ex.subjects.map((s) => {
                      const theme = SUBJECT_THEME[s] || SUBJECT_THEME.rika;
                      return (
                        <span
                          key={s}
                          className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${theme.badgeClass}`}
                        >
                          {SUBJECT_LABELS[s]}
                        </span>
                      );
                    })}
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(ex.created_at).toLocaleString('ja-JP')}
                    </span>
                    <span className="font-medium text-slate-600">全 {ex.item_count} 問</span>
                    {ex.submission_count > 0 && (
                      <Tooltip content="オンライン解答の実施回数と直近の正答数です。クリックで最新結果を確認できます。">
                        <Link
                          to={
                            ex.latest_submission_status === 'in_progress' && ex.latest_submission_id
                              ? `/exams/${ex.id}/solve?submissionId=${ex.latest_submission_id}`
                              : ex.latest_submission_id
                              ? `/exams/${ex.id}/submissions/${ex.latest_submission_id}`
                              : `/exams/${ex.id}/solve`
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-700 font-bold ring-1 ring-inset ring-indigo-200/80 hover:bg-indigo-100 transition"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          オンライン {ex.submission_count}回
                          {ex.latest_submission_status === 'in_progress'
                            ? '（解答中）'
                            : ex.latest_correct_count !== null && ex.latest_total_count !== null
                            ? `・直近 ${ex.latest_correct_count}/${ex.latest_total_count}`
                            : ''}
                        </Link>
                      </Tooltip>
                    )}
                    {ex.wrong_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700 font-bold ring-1 ring-inset ring-rose-200/80">
                        <AlertCircle className="w-3 h-3" />
                        間違い記録: {ex.wrong_count}問
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Tooltip content="PC・タブレット上で直接手書き・選択解答し、AIが自動で読み取り＆採点します。何度でも再挑戦可能です。">
                  <Link
                    to={`/exams/${ex.id}/solve`}
                    className="ui-btn-primary px-3.5 py-2 text-xs"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    オンラインで解く
                  </Link>
                </Tooltip>
                <Tooltip content="紙のテスト用紙（B4 / A4）として印刷・PDF保存します。">
                  <Link
                    to={`/exams/${ex.id}`}
                    className="ui-btn-secondary px-3.5 py-2 text-xs"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-600" />
                    印刷・PDF
                  </Link>
                </Tooltip>
                <Tooltip content="紙で解いたテストの間違いを手動で ○ / × 記録します。">
                  <Link
                    to={`/exams/${ex.id}?mode=grade`}
                    className="ui-btn-secondary px-3.5 py-2 text-xs"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5 text-indigo-600" />
                    紙採点
                  </Link>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(ex)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                  title="削除"
                  aria-label={`「${ex.title}」を削除`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="テスト履歴を削除しますか？"
        description={`「${deleteTarget?.title || ''}」を削除します。この操作は取り消せません（問題バンクの問題自体は削除されません）。`}
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
