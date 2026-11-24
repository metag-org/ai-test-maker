import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Camera,
  CheckCircle2,
  Crop,
  Edit3,
  Eye,
  LayoutList,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { api, uploadUrl } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImageCropBoxEditor } from '../components/ImageCropBoxEditor';
import { ReviewPreviewPanel } from '../components/ReviewPreviewPanel';
import { RichJapaneseText } from '../components/RichJapaneseText';
import { useToast } from '../components/ToastProvider';
import type {
  CropBox,
  OptionItem,
  Question,
  QuestionGroup,
  QuestionType,
  SubjectType,
} from '../types';
import { QUESTION_TYPE_LABELS, SUBJECT_LABELS } from '../types';

interface ReviewPageProps {
  onDraftsUpdated: () => void;
}

interface EditableQuestion {
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

function toEditable(q: Question): EditableQuestion {
  const normalizedBody = (q.body || '').replace(/<u>(.*?)<\/u>/gi, '==$1==');
  const defaultBoxType =
    q.question_type === 'kanji_read'
      ? 'reading_box'
      : q.question_type === 'kanji_write'
      ? 'kanji_grid'
      : 'blank_line';
  const cfg = q.answer_box_config || {};
  return {
    id: q.id,
    question_type: q.question_type,
    body: normalizedBody,
    options: q.options || [],
    answer_box_config: {
      type: cfg.type || defaultBoxType,
      cells: cfg.cells || 2,
    },
    manual_answer: q.manual_answer || '',
    memo: q.memo || '',
    needs_review: q.needs_review,
  };
}

export const ReviewPage: React.FC<ReviewPageProps> = ({ onDraftsUpdated }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const targetId = searchParams.get('id');

  const [drafts, setDrafts] = useState<QuestionGroup[]>([]);
  const [currentGroup, setCurrentGroup] = useState<QuestionGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // 編集フォーム状態
  const [subject, setSubject] = useState<SubjectType>('rika');
  const [sourceName, setSourceName] = useState('');
  const [leadText, setLeadText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'print' | 'bank'>('edit');
  const tabRefs = useRef<Record<'edit' | 'print' | 'bank', HTMLButtonElement | null>>({
    edit: null,
    print: null,
    bank: null,
  });

  const loadGroupIntoForm = (g: QuestionGroup) => {
    setCurrentGroup(g);
    setSubject(g.subject);
    setSourceName(g.source_name || '');
    setLeadText(g.lead_text || '');
    setTagsText((g.tags || []).join(', '));
    setQuestions((g.questions || []).map(toEditable));
    setActiveImageId(null);
    setActiveTab('edit');
  };

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listGroups({ status: 'draft' });
      setDrafts(res.items);

      if (targetId) {
        const grp = await api.getGroup(targetId);
        loadGroupIntoForm(grp);
      } else if (res.items.length > 0) {
        loadGroupIntoForm(res.items[0]);
      } else {
        setCurrentGroup(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  const handleSave = async (publish: boolean) => {
    if (!currentGroup) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const tags = tagsText
        .split(/[,、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const updated = await api.updateGroup(currentGroup.id, {
        subject,
        source_name: sourceName,
        lead_text: leadText,
        status: publish ? 'published' : currentGroup.status,
        tags,
        questions: questions.map((q, idx) => ({
          id: q.id || null,
          sort_order: idx,
          question_type: q.question_type,
          body: q.body.replace(/<u>(.*?)<\/u>/gi, '==$1=='),
          options: q.options.filter((o) => o.label.trim() || o.text.trim()),
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
          needs_review: q.needs_review,
        })),
      });

      onDraftsUpdated();
      if (publish) {
        const res = await api.listGroups({ status: 'draft' });
        setDrafts(res.items);
        if (res.items.length > 0) {
          setSearchParams({ id: res.items[0].id });
          loadGroupIntoForm(res.items[0]);
          setMessage('問題バンクへ登録しました。次の下書きを表示しています。');
        } else {
          setMessage('問題バンクへ登録しました！');
          setCurrentGroup(updated);
          navigate('/bank');
        }
      } else {
        loadGroupIntoForm(updated);
        setMessage('下書きを保存しました。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!currentGroup) return;
    setDeleting(true);
    try {
      await api.deleteGroup(currentGroup.id);
      setDeleteDialogOpen(false);
      onDraftsUpdated();
      setSearchParams({});
      await fetchData();
      showToast('問題グループを削除しました。', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '削除に失敗しました。', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleCropSelect = async (box: CropBox) => {
    if (!currentGroup) return;
    setCropping(true);
    setError('');
    try {
      if (activeImageId) {
        await api.updateGroupImage(currentGroup.id, activeImageId, { crop_box: box });
        setActiveImageId(null);
      } else {
        const nextNum = (currentGroup.images?.length || 0) + 1;
        await api.addGroupImage(currentGroup.id, {
          crop_box: box,
          caption: `図${nextNum}`,
          use_cleaned: true,
        });
      }
      const refreshed = await api.getGroup(currentGroup.id);
      setCurrentGroup(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : '図版の切り出しに失敗しました。');
    } finally {
      setCropping(false);
    }
  };

  const handleToggleImageCleaned = async (imgId: string, useCleaned: boolean) => {
    if (!currentGroup) return;
    await api.updateGroupImage(currentGroup.id, imgId, { use_cleaned: useCleaned });
    const refreshed = await api.getGroup(currentGroup.id);
    setCurrentGroup(refreshed);
  };

  const handleImageCaptionBlur = async (imgId: string, caption: string) => {
    if (!currentGroup) return;
    await api.updateGroupImage(currentGroup.id, imgId, { caption });
    const refreshed = await api.getGroup(currentGroup.id);
    setCurrentGroup(refreshed);
  };

  const handleDeleteImage = async (imgId: string) => {
    if (!currentGroup) return;
    await api.deleteGroupImage(currentGroup.id, imgId);
    if (activeImageId === imgId) setActiveImageId(null);
    const refreshed = await api.getGroup(currentGroup.id);
    setCurrentGroup(refreshed);
    showToast('図版を削除しました。', 'success');
  };

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        question_type: subject === 'kokugo' ? 'kanji_write' : 'short_answer',
        body: '',
        options: [],
        answer_box_config:
          subject === 'kokugo' ? { type: 'kanji_grid', cells: 2 } : { type: 'blank_line', cells: 2 },
        manual_answer: '',
        memo: '',
        needs_review: false,
      },
    ]);
  };

  const updateQuestion = (idx: number, patch: Partial<EditableQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  const removeQuestion = (idx: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse" aria-busy="true">
        <div className="ui-card p-5 h-16" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 ui-card h-96" />
          <div className="lg:col-span-7 space-y-4">
            <div className="ui-card h-56" />
            <div className="ui-card h-44" />
          </div>
        </div>
      </div>
    );
  }

  if (!currentGroup) {
    return (
      <div className="max-w-xl mx-auto ui-card p-10 sm:p-12 text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500 ring-1 ring-inset ring-emerald-200/80">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-slate-900">未検収の下書きはありません</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            「問題登録」から新しい宿題写真をアップロードするか、「問題バンク」から登録済み問題を編集できます。
          </p>
        </div>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <Link to="/upload" className="ui-btn-primary">
            <Camera className="w-4 h-4" />
            問題登録へ
          </Link>
          <Link to="/bank" className="ui-btn-secondary">
            <BookOpen className="w-4 h-4 text-slate-500" />
            問題バンクを見る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 上部バー：未検収キュー切り替え + 操作ボタン + 編集/プレビュータブ */}
      <div className="ui-card overflow-hidden">
        <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">検収・編集</h1>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full ring-1 ring-inset ${
                currentGroup.status === 'published'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-amber-200'
              }`}
            >
              {currentGroup.status === 'published' ? '登録済み' : '検収待ち'}
            </span>

            {drafts.length > 1 && (
              <select
                aria-label="検収対象の下書きを選択"
                value={currentGroup.id}
                onChange={(e) => setSearchParams({ id: e.target.value })}
                className="ui-select text-xs py-2"
              >
                {drafts.map((d, idx) => (
                  <option key={d.id} value={d.id}>
                    下書き {idx + 1}: 【{SUBJECT_LABELS[d.subject]}】{d.source_name || '(教材名なし)'} ({d.questions.length}問)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200/90 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              削除
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="ui-btn-secondary px-4 py-2 text-xs"
            >
              <Save className="w-3.5 h-3.5" />
              一時保存
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="ui-btn-primary px-4 py-2 text-xs"
            >
              <CheckCircle2 className="w-4 h-4" />
              {currentGroup.status === 'published' ? '変更を保存' : '問題バンクに登録'}
            </button>
          </div>
        </div>

        {/* 編集／登録後プレビュー切り替えタブリスト */}
        <div
          role="tablist"
          aria-label="検収・プレビュー切り替え"
          className="ui-tablist px-4 sm:px-5 bg-slate-50/70 border-t border-slate-100"
          {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
          onKeyDown={(e) => {
            const order: ('edit' | 'print' | 'bank')[] = ['edit', 'print', 'bank'];
            const idx = order.indexOf(activeTab);
            let next: 'edit' | 'print' | 'bank' | null = null;
            if (e.key === 'ArrowRight') next = order[(idx + 1) % order.length];
            else if (e.key === 'ArrowLeft') next = order[(idx - 1 + order.length) % order.length];
            else if (e.key === 'Home') next = order[0];
            else if (e.key === 'End') next = order[order.length - 1];
            if (next) {
              e.preventDefault();
              setActiveTab(next);
              tabRefs.current[next]?.focus();
            }
          }}
        >
          {(
            [
              { id: 'edit', label: '編集フォーム', icon: Edit3 },
              { id: 'print', label: 'テスト印刷プレビュー', icon: Eye },
              { id: 'bank', label: '問題バンク表示プレビュー', icon: LayoutList },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                id={`review-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                {...(selected ? ({ focusgroupstart: '' } as Record<string, string>) : {})}
                onClick={() => setActiveTab(tab.id)}
                className="ui-tab"
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {message && (
        <div role="status" className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
          {error}
        </div>
      )}

      {/* タブパネル 1：編集フォーム */}
      <div role="tabpanel" aria-labelledby="review-tab-edit" hidden={activeTab !== 'edit'}>
      {/* 左：原本画像 & 図版トリミング / 右：構造化問題フォーム */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 左カラム */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-20">
          <div className="ui-card p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                <Crop className="w-4 h-4 text-indigo-600" />
                原本画像・図版切り出し
              </div>
              {cropping && <span className="text-xs text-indigo-600">切り出し処理中...</span>}
            </div>

            {currentGroup.source_image_path ? (
              <ImageCropBoxEditor
                imageUrl={uploadUrl(currentGroup.source_image_path)}
                existingImages={currentGroup.images || []}
                activeImageId={activeImageId}
                onSelectBox={handleCropSelect}
              />
            ) : (
              <div className="text-xs text-slate-500 py-8 text-center bg-slate-50 rounded-lg">
                原本画像はありません（手入力問題）
              </div>
            )}
          </div>

          {/* 抽出・切り出し済み図版リスト */}
          {(currentGroup.images?.length || 0) > 0 && (
            <div className="ui-card p-4 sm:p-5 space-y-3">
              <div className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                <Wand2 className="w-4 h-4 text-emerald-600" />
                紐づけ図版（手書き除去切替）
              </div>
              <div className="space-y-3">
                {currentGroup.images.map((img) => {
                  const previewPath = img.use_cleaned ? img.cleaned_path : img.raw_crop_path;
                  const isActive = activeImageId === img.id;
                  return (
                    <div
                      key={img.id}
                      className={`p-3 rounded-lg border ${
                        isActive ? 'border-indigo-500 bg-indigo-50/40' : 'border-slate-200 bg-slate-50'
                      } space-y-2`}
                    >
                      <img
                        src={uploadUrl(previewPath)}
                        alt={img.caption || '図版'}
                        className="max-h-44 mx-auto bg-white border border-slate-200 rounded object-contain"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <input
                          type="text"
                          defaultValue={img.caption}
                          onBlur={(e) => handleImageCaptionBlur(img.id, e.target.value)}
                          placeholder="キャプション（例：図1）"
                          className="text-xs border border-slate-300 rounded px-2 py-1 bg-white w-32"
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleImageCleaned(img.id, !img.use_cleaned)}
                            className={`text-xs px-2 py-1 rounded border font-medium ${
                              img.use_cleaned
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-slate-700 border-slate-300'
                            }`}
                          >
                            {img.use_cleaned ? '手書き除去: ON' : '原本表示中'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveImageId(isActive ? null : img.id)}
                            className={`text-xs px-2 py-1 rounded border ${
                              isActive
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-700 border-slate-300'
                            }`}
                          >
                            {isActive ? '再指定キャンセル' : '範囲再指定'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteImage(img.id)}
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                            title="図版を削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右カラム：大問メタデータ & 小問編集 */}
        <div className="lg:col-span-7 space-y-4">
          <div className="ui-card p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="review-subject" className="block text-xs font-bold text-slate-700 mb-1.5">科目</label>
                <select
                  id="review-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value as SubjectType)}
                  className="ui-select w-full"
                >
                  <option value="kokugo">国語（漢字）</option>
                  <option value="rika">理科</option>
                  <option value="shakai">社会</option>
                </select>
              </div>
              <div>
                <label htmlFor="review-source" className="block text-xs font-bold text-slate-700 mb-1.5">
                  教材・出典
                </label>
                <input
                  id="review-source"
                  type="text"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="例：530-14"
                  className="ui-input"
                />
              </div>
            </div>

            <div>
              <label htmlFor="review-tags" className="block text-xs font-bold text-slate-700 mb-1.5">
                単元タグ（カンマ区切り）
              </label>
              <input
                id="review-tags"
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="例：物理, てこ / 歴史, 江戸時代 / 漢字の書き取り"
                className="ui-input"
              />
            </div>

            <div>
              <label htmlFor="review-lead" className="block text-xs font-bold text-slate-700 mb-1.5">
                大問リード文・指示文
              </label>
              <textarea
                id="review-lead"
                rows={3}
                value={leadText}
                onChange={(e) => setLeadText(e.target.value)}
                placeholder="例：次の実験について、あとの問いに答えなさい。"
                className="ui-input"
              />
              <div className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                <span>記法ヒント：</span>
                <span>ルビ <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">[漢字]&#123;かんじ&#125;</code></span>
                <span>傍線 <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">==対象==</code></span>
                <span>空欄 <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">[[1]]</code></span>
              </div>
            </div>
          </div>

          {/* 小問カード一覧 */}
          <div className="space-y-3.5">
            {questions.map((q, idx) => (
              <div
                key={q.id || `new-${idx}`}
                className="ui-card p-5 space-y-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-lg bg-indigo-100 px-1.5 text-xs font-extrabold text-indigo-700">
                      {idx + 1}
                    </span>
                    <select
                      value={q.question_type}
                      onChange={(e) => {
                        const nextType = e.target.value as QuestionType;
                        updateQuestion(idx, {
                          question_type: nextType,
                          answer_box_config: {
                            ...q.answer_box_config,
                            type:
                              nextType === 'kanji_read'
                                ? 'reading_box'
                                : nextType === 'kanji_write'
                                ? 'kanji_grid'
                                : 'blank_line',
                          },
                        });
                      }}
                      className="text-xs border border-slate-300 rounded px-2 py-1 bg-slate-50"
                    >
                      {Object.entries(QUESTION_TYPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>

                    {subject === 'kokugo' && q.question_type === 'kanji_write' && (
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-600">漢字マス数:</span>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={q.answer_box_config.cells || 2}
                          onChange={(e) =>
                            updateQuestion(idx, {
                              answer_box_config: {
                                ...q.answer_box_config,
                                type: 'kanji_grid',
                                cells: Number(e.target.value) || 2,
                              },
                            })
                          }
                          className="w-14 border border-slate-300 rounded px-1.5 py-0.5 text-center"
                        />
                      </div>
                    )}

                    {subject === 'kokugo' && q.question_type === 'kanji_read' && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        解答欄：読み仮名枠（縦長）
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1 text-xs text-rose-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={q.needs_review}
                        onChange={(e) => updateQuestion(idx, { needs_review: e.target.checked })}
                      />
                      要復習
                    </label>
                    <button
                      type="button"
                      onClick={() => removeQuestion(idx)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                      title="この小問を削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <textarea
                    rows={2}
                    value={q.body}
                    onChange={(e) => updateQuestion(idx, { body: e.target.value })}
                    placeholder={
                      subject === 'kokugo'
                        ? '例：友だちとの==ヤクソク==を守る。'
                        : '設問文を入力してください'
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  {q.body && (
                    <div className="mt-1.5 px-3 py-1.5 bg-slate-50 rounded border border-slate-100 text-sm font-exam">
                      <span className="text-[10px] font-sans text-slate-400 mr-2">プレビュー:</span>
                      <RichJapaneseText text={q.body} />
                    </div>
                  )}
                </div>

                {/* 理社 選択肢編集 */}
                {subject !== 'kokugo' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">選択肢（選択問題）</span>
                      <button
                        type="button"
                        onClick={() => {
                          const labels = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'];
                          const nextLabel = labels[q.options.length] || String(q.options.length + 1);
                          updateQuestion(idx, {
                            options: [...q.options, { label: nextLabel, text: '' }],
                          });
                        }}
                        className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        選択肢を追加
                      </button>
                    </div>
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const next = q.options.map((o, i) =>
                              i === oIdx ? { ...o, label: e.target.value } : o
                            );
                            updateQuestion(idx, { options: next });
                          }}
                          className="w-12 rounded border border-slate-300 px-2 py-1 text-xs text-center font-bold"
                        />
                        <input
                          type="text"
                          value={opt.text}
                          onChange={(e) => {
                            const next = q.options.map((o, i) =>
                              i === oIdx ? { ...o, text: e.target.value } : o
                            );
                            updateQuestion(idx, { options: next });
                          }}
                          placeholder="選択肢の内容"
                          className="flex-1 rounded border border-slate-300 px-2.5 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateQuestion(idx, {
                              options: q.options.filter((_, i) => i !== oIdx),
                            })
                          }
                          className="text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 保護者用手入力 解答メモ（任意・LLMは自動生成しない） */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      解答（任意・保護者用手入力）
                    </label>
                    <input
                      type="text"
                      value={q.manual_answer}
                      onChange={(e) => updateQuestion(idx, { manual_answer: e.target.value })}
                      placeholder="必要な場合のみ入力"
                      className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs bg-slate-50/70"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">メモ（任意）</label>
                    <input
                      type="text"
                      value={q.memo}
                      onChange={(e) => updateQuestion(idx, { memo: e.target.value })}
                      placeholder="解説・注意点など"
                      className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs bg-slate-50/70"
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={addQuestion}
                className="flex-1 min-w-[200px] py-2.5 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-600 hover:text-indigo-700 text-sm font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <Sparkles className="w-4 h-4" />
                小問を追加する
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('print');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="ui-btn-secondary py-2.5"
              >
                <Eye className="w-4 h-4 text-indigo-600" />
                登録後の印刷イメージを確認
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* タブパネル 2：テスト印刷プレビュー */}
      <div role="tabpanel" aria-labelledby="review-tab-print" hidden={activeTab !== 'print'}>
        {activeTab === 'print' && (
          <ReviewPreviewPanel
            mode="print"
            groupId={currentGroup.id}
            subject={subject}
            sourceName={sourceName}
            leadText={leadText}
            tags={tagsText
              .split(/[,、\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)}
            sourceImagePath={currentGroup.source_image_path}
            images={currentGroup.images || []}
            questions={questions}
          />
        )}
      </div>

      {/* タブパネル 3：問題バンク表示プレビュー */}
      <div role="tabpanel" aria-labelledby="review-tab-bank" hidden={activeTab !== 'bank'}>
        {activeTab === 'bank' && (
          <ReviewPreviewPanel
            mode="bank"
            groupId={currentGroup.id}
            subject={subject}
            sourceName={sourceName}
            leadText={leadText}
            tags={tagsText
              .split(/[,、\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)}
            sourceImagePath={currentGroup.source_image_path}
            images={currentGroup.images || []}
            questions={questions}
          />
        )}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="問題グループを削除しますか？"
        description={`【${SUBJECT_LABELS[subject]}】${sourceName || '（出典なし）'} と紐づく小問・図版をすべて削除します。この操作は取り消せません。`}
        loading={deleting}
        onConfirm={handleConfirmDeleteGroup}
      />
    </div>
  );
};
