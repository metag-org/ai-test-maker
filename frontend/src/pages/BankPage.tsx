import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  BookMarked,
  BookOpen,
  Camera,
  Edit3,
  FlaskConical,
  Globe2,
  Image as ImageIcon,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { api, uploadUrl } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RichJapaneseText } from '../components/RichJapaneseText';
import { useToast } from '../components/ToastProvider';
import type { FacetsResponse, QuestionGroup, SubjectType } from '../types';
import { SUBJECT_LABELS } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';

export const BankPage: React.FC = () => {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<QuestionGroup[]>([]);
  const [facets, setFacets] = useState<FacetsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [subject, setSubject] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('');
  const [tag, setTag] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [onlyReview, setOnlyReview] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<QuestionGroup | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  const load = async (overrides?: {
    subject?: string;
    sourceName?: string;
    tag?: string;
    search?: string;
    onlyReview?: boolean;
  }) => {
    const qSubject = overrides?.subject !== undefined ? overrides.subject : subject;
    const qSource = overrides?.sourceName !== undefined ? overrides.sourceName : sourceName;
    const qTag = overrides?.tag !== undefined ? overrides.tag : tag;
    const qSearch = overrides?.search !== undefined ? overrides.search : search;
    const qReview = overrides?.onlyReview !== undefined ? overrides.onlyReview : onlyReview;

    setLoading(true);
    try {
      const [res, f] = await Promise.all([
        api.listGroups({
          status: 'published',
          subject: qSubject || undefined,
          source_name: qSource || undefined,
          tag: qTag || undefined,
          search: qSearch || undefined,
          needs_review: qReview || undefined,
        }),
        api.getFacets(),
      ]);
      setGroups(res.items);
      setFacets(f);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, sourceName, tag, onlyReview]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const handleResetFilters = () => {
    setSubject('');
    setSourceName('');
    setTag('');
    setSearch('');
    setOnlyReview(false);
    load({ subject: '', sourceName: '', tag: '', search: '', onlyReview: false });
  };

  const handleToggleReview = async (qId: string, nextVal: boolean) => {
    await api.toggleQuestionReview(qId, nextVal);
    await load();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteGroup(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      showToast('問題グループを削除しました。', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '削除に失敗しました。', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const totalCount = facets
    ? (facets.published_counts.kokugo || 0) +
      (facets.published_counts.rika || 0) +
      (facets.published_counts.shakai || 0)
    : 0;

  const hasFilters = Boolean(subject || sourceName || tag || search || onlyReview);

  const statTabs: {
    key: string;
    label: string;
    count: number;
    icon: React.FC<{ className?: string }>;
    activeClass: string;
    iconClass: string;
  }[] = [
    {
      key: '',
      label: 'すべての科目',
      count: totalCount,
      icon: BookOpen,
      activeClass: 'border-indigo-500 bg-indigo-50/70 ring-2 ring-indigo-500/20',
      iconClass: 'bg-indigo-100 text-indigo-700',
    },
    {
      key: 'kokugo',
      label: '国語（漢字）',
      count: facets?.published_counts.kokugo ?? 0,
      icon: BookMarked,
      activeClass: 'border-rose-500 bg-rose-50/70 ring-2 ring-rose-500/20',
      iconClass: 'bg-rose-100 text-rose-700',
    },
    {
      key: 'rika',
      label: '理科',
      count: facets?.published_counts.rika ?? 0,
      icon: FlaskConical,
      activeClass: 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/20',
      iconClass: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'shakai',
      label: '社会',
      count: facets?.published_counts.shakai ?? 0,
      icon: Globe2,
      activeClass: 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-500/20',
      iconClass: 'bg-amber-100 text-amber-700',
    },
  ];

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-900">
            問題バンク
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            登録済みの問題を科目・教材・タグ・要復習フラグで素早く検索・管理できます。
          </p>
        </div>
        <Link to="/upload" className="ui-btn-primary">
          <Camera className="w-4 h-4" />
          新しい問題を登録
        </Link>
      </div>

      {/* 科目別サマリーカード（クリックで絞り込み） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statTabs.map((tab) => {
          const Icon = tab.icon;
          const active = subject === tab.key;
          return (
            <button
              key={tab.key || 'all'}
              type="button"
              onClick={() => setSubject(tab.key)}
              aria-pressed={active}
              className={`text-left rounded-2xl border p-4 transition-all duration-150 flex items-center justify-between gap-3 ${
                active
                  ? `${tab.activeClass} shadow-sm`
                  : 'border-slate-200/80 bg-white/95 hover:border-slate-300 hover:bg-white shadow-sm'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-500 truncate">{tab.label}</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900 tabular-nums">
                  {tab.count}
                  <span className="ml-1 text-xs font-medium text-slate-400">大問</span>
                </div>
              </div>
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tab.iconClass}`}
              >
                <Icon className="h-5 w-5" />
              </span>
            </button>
          );
        })}
      </div>

      {/* 絞り込みバー（セマンティック <search>） */}
      <search className="block ui-card p-4 sm:p-5">
        <form onSubmit={handleSearchSubmit} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-3">
              <label htmlFor="bank-source-filter" className="visually-hidden">
                教材で絞り込み
              </label>
              <select
                id="bank-source-filter"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className="ui-select w-full"
              >
                <option value="">すべての教材</option>
                {(facets?.sources || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-3">
              <label htmlFor="bank-tag-filter" className="visually-hidden">
                タグで絞り込み
              </label>
              <select
                id="bank-tag-filter"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="ui-select w-full"
              >
                <option value="">すべてのタグ</option>
                {(facets?.tags || []).map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-6 flex gap-2">
              <div className="relative flex-1 min-w-0">
                <label htmlFor="bank-search-input" className="visually-hidden">
                  キーワード検索
                </label>
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="bank-search-input"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.nativeEvent.isComposing) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="問題文・リード文・教材名で検索..."
                  enterKeyHint="search"
                  className="ui-input pl-10"
                />
              </div>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 hover:bg-slate-800 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition shrink-0"
              >
                検索
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label
              htmlFor="only-review-checkbox"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold cursor-pointer transition ${
                onlyReview
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:bg-slate-100/80'
              }`}
            >
              <input
                id="only-review-checkbox"
                type="checkbox"
                checked={onlyReview}
                onChange={(e) => setOnlyReview(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600"
              />
              <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
              <span>「要復習（間違い記録あり）」の問題のみ表示</span>
            </label>

            {hasFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-700 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                絞り込みをリセット
              </button>
            )}
          </div>
        </form>
      </search>

      {/* 問題リスト */}
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="問題を読み込み中">
          {[1, 2, 3].map((n) => (
            <div key={n} className="ui-card p-5 space-y-3 animate-pulse">
              <div className="flex items-center gap-2">
                <div className="h-5 w-20 rounded-full bg-slate-200" />
                <div className="h-5 w-32 rounded-lg bg-slate-100" />
              </div>
              <div className="h-4 w-3/4 rounded bg-slate-100" />
              <div className="h-4 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="ui-card p-12 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <BookOpen className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-800">
              {hasFilters ? '条件に一致する問題が見つかりません' : 'まだ登録済みの問題がありません'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              {hasFilters
                ? '絞り込み条件を変更するか、リセットして再度お試しください。'
                : '「問題登録」から宿題の写真をアップロードして、最初の問題を追加しましょう。'}
            </p>
          </div>
          <div className="pt-1 flex justify-center gap-3">
            {hasFilters ? (
              <button type="button" onClick={handleResetFilters} className="ui-btn-secondary">
                <RotateCcw className="w-4 h-4" />
                絞り込みをリセット
              </button>
            ) : (
              <Link to="/upload" className="ui-btn-primary">
                <Camera className="w-4 h-4" />
                問題を登録する
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((grp) => {
            const theme = SUBJECT_THEME[grp.subject as SubjectType] || SUBJECT_THEME.rika;
            return (
              <article
                key={grp.id}
                className="ui-card overflow-hidden transition hover:shadow-md"
              >
                <div className={`h-1 w-full ${theme.accentBarClass}`} />
                <div className="p-4 sm:p-5 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex-balance items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${theme.badgeClass}`}
                      >
                        {SUBJECT_LABELS[grp.subject]}
                      </span>
                      {grp.source_name && (
                        <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                          {grp.source_name}
                        </span>
                      )}
                      {(grp.tags || []).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTag(t)}
                          className="text-xs font-medium text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 px-2.5 py-0.5 rounded-lg transition"
                        >
                          #{t}
                        </button>
                      ))}
                      {grp.images.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg ring-1 ring-inset ring-emerald-200/70">
                          <ImageIcon className="w-3 h-3" />
                          図版 {grp.images.length}枚
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`/review?id=${grp.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs font-semibold text-slate-700 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                        編集
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(grp)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                        title="削除"
                        aria-label="この問題グループを削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {grp.lead_text && (
                    <div className="text-sm text-slate-800 bg-slate-50/90 border border-slate-100 rounded-xl p-3 font-exam leading-relaxed">
                      <RichJapaneseText text={grp.lead_text} />
                    </div>
                  )}

                  {grp.images.length > 0 && (
                    <div className="flex gap-2.5 overflow-x-auto pb-1 scroll-contain">
                      {grp.images.map((img) => (
                        <figure
                          key={img.id}
                          className="shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
                        >
                          <img
                            src={uploadUrl(img.use_cleaned ? img.cleaned_path : img.raw_crop_path)}
                            alt={img.caption || '図版'}
                            className="block h-24 w-auto rounded-lg object-contain"
                          />
                        </figure>
                      ))}
                    </div>
                  )}

                  <div className="divide-y divide-slate-100">
                    {grp.questions.map((q, idx) => (
                      <div
                        key={q.id}
                        className="py-2.5 first:pt-1 last:pb-0 flex flex-wrap items-start justify-between gap-3 text-sm"
                      >
                        <div className="flex-1 min-w-[220px]">
                          <span className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-md bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600 mr-2 align-middle">
                            {idx + 1}
                          </span>
                          <span className="font-exam text-slate-900 leading-relaxed">
                            <RichJapaneseText text={q.body} />
                          </span>
                          {q.options && q.options.length > 0 && (
                            <div className="mt-1.5 pl-7 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                              {q.options.map((opt, oi) => (
                                <span key={oi} className="inline-flex items-baseline gap-1">
                                  <strong className="text-slate-800">{opt.label}</strong>
                                  <span>{opt.text}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 text-xs shrink-0">
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            出題 {q.tested_count} / 誤答 {q.wrong_count}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleReview(q.id, !q.needs_review)}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition ${
                              q.needs_review
                                ? 'bg-rose-600 text-white border-rose-600 shadow-sm hover:bg-rose-700'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700'
                            }`}
                          >
                            {q.needs_review ? '★ 要復習' : '復習マーク'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="問題グループを削除しますか？"
        description={`【${deleteTarget ? SUBJECT_LABELS[deleteTarget.subject] : ''}】${deleteTarget?.source_name || '（出典なし）'} に含まれる小問と図版をすべて削除します。この操作は取り消せません。`}
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
