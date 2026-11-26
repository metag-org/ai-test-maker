import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Camera,
  CheckCircle2,
  Crop,
  Edit3,
  Eye,
  ImagePlus,
  LayoutList,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { api, uploadUrl } from '../api/client';
import { AnswerSuggestionDialog } from '../components/AnswerSuggestionDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GroupTokenUsageBar } from '../components/GroupTokenUsageBar';
import { ImageCropBoxEditor } from '../components/ImageCropBoxEditor';
import { ReviewPreviewPanel } from '../components/ReviewPreviewPanel';
import { RichJapaneseText } from '../components/RichJapaneseText';
import { useToast } from '../components/ToastProvider';
import { InfoTooltip, Tooltip } from '../components/Tooltip';
import type {
  AnswerSuggestionItem,
  AnswerSuggestionResponse,
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
  answer_aliases_text: string;
  grading_note: string;
  memo: string;
  needs_review: boolean;
  is_ai_candidate?: boolean;
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
    answer_aliases_text: (q.answer_aliases || []).join(', '),
    grading_note: q.grading_note || '',
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
  const [suggestingAnswers, setSuggestingAnswers] = useState(false);
  const [extractingAnswerImg, setExtractingAnswerImg] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<AnswerSuggestionResponse | null>(null);
  const answerImgInputRef = useRef<HTMLInputElement | null>(null);
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
          answer_aliases: q.answer_aliases_text
            .split(/[,、|｜]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          grading_note: q.grading_note.trim(),
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

  const handleRecleanImage = async (imgId: string) => {
    if (!currentGroup) return;
    setCropping(true);
    try {
      await api.recleanGroupImage(currentGroup.id, imgId);
      const refreshed = await api.getGroup(currentGroup.id);
      setCurrentGroup(refreshed);
      showToast('図版の補正を再実行しました。', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '図版の再補正に失敗しました。', 'error');
    } finally {
      setCropping(false);
    }
  };

  const handleRotateImage = async (imgId: string, angleCw: 90 | 180 | 270) => {
    if (!currentGroup) return;
    setCropping(true);
    try {
      await api.rotateGroupImage(currentGroup.id, imgId, angleCw);
      const refreshed = await api.getGroup(currentGroup.id);
      setCurrentGroup(refreshed);
      showToast('図版を回転しました。', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '図版の回転に失敗しました。', 'error');
    } finally {
      setCropping(false);
    }
  };

  const handleRotateSourceImage = async (angleCw: 90 | 180 | 270) => {
    if (!currentGroup) return;
    setCropping(true);
    try {
      const updated = await api.rotateGroupSourceImage(currentGroup.id, angleCw);
      setCurrentGroup(updated);
      showToast('原本画像とすべての図版を一括回転しました。', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '原本画像の回転に失敗しました。', 'error');
    } finally {
      setCropping(false);
    }
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
        answer_aliases_text: '',
        grading_note: '',
        memo: '',
        needs_review: false,
      },
    ]);
  };

  const handleSuggestAnswersByAI = async () => {
    if (!currentGroup) return;
    setSuggestingAnswers(true);
    setError('');
    try {
      const res = await api.suggestGroupAnswers(currentGroup.id);
      if (res.group_llm_usage) {
        setCurrentGroup((prev) => (prev ? { ...prev, llm_usage: res.group_llm_usage } : prev));
      }
      setSuggestionResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI解答候補の生成に失敗しました。';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSuggestingAnswers(false);
    }
  };

  const handleUploadAnswerSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentGroup) return;
    setExtractingAnswerImg(true);
    setError('');
    try {
      const res = await api.extractGroupAnswersFromImage(currentGroup.id, file);
      if (res.group_llm_usage) {
        setCurrentGroup((prev) => (prev ? { ...prev, llm_usage: res.group_llm_usage } : prev));
      }
      setSuggestionResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解答ページからの抽出に失敗しました。';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setExtractingAnswerImg(false);
    }
  };

  const handleApplySuggestions = (selectedItems: AnswerSuggestionItem[]) => {
    const byOrder = new Map<number, AnswerSuggestionItem>();
    selectedItems.forEach((it) => byOrder.set(it.question_order, it));

    setQuestions((prev) =>
      prev.map((q, idx) => {
        const hit = byOrder.get(idx + 1);
        if (!hit) return q;
        return {
          ...q,
          manual_answer: hit.suggested_answer.trim() || q.manual_answer,
          answer_aliases_text:
            hit.suggested_aliases.length > 0
              ? hit.suggested_aliases.join(', ')
              : q.answer_aliases_text,
          grading_note: hit.suggested_grading_note.trim() || q.grading_note,
          is_ai_candidate: true,
        };
      })
    );
    setSuggestionResult(null);
    showToast(
      `${selectedItems.length} 問の模範解答をフォームに反映しました。内容を確認のうえ保存してください。`,
      'success'
    );
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

        {currentGroup.llm_usage && (currentGroup.llm_usage.total_tokens ?? 0) > 0 && (
          <div className="px-4 sm:px-5 pb-3.5">
            <GroupTokenUsageBar usage={currentGroup.llm_usage} variant="full" />
          </div>
        )}

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                <Crop className="w-4 h-4 text-indigo-600" />
                原本画像・図版切り出し
              </div>
              <div className="flex items-center gap-1.5">
                {cropping && <span className="text-xs text-indigo-600">処理中...</span>}
                {currentGroup.source_image_path && (
                  <>
                    <Tooltip content="原本画像と切り出し済みの全図版を左に90°一括回転します。">
                      <button
                        type="button"
                        disabled={cropping}
                        onClick={() => handleRotateSourceImage(270)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        左90°
                      </button>
                    </Tooltip>
                    <Tooltip content="原本画像と切り出し済みの全図版を右に90°一括回転します。">
                      <button
                        type="button"
                        disabled={cropping}
                        onClick={() => handleRotateSourceImage(90)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 transition"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        右90°
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Tooltip content="補正後（赤青ペン除去＋白地補正）と切り抜き原本を切り替えます。">
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
                          </Tooltip>
                          <Tooltip content="切り抜き原本から最新の補正アルゴリズムを再実行します（白抜けや線のかすれを改善したいときに押してください）。">
                            <button
                              type="button"
                              disabled={cropping}
                              onClick={() => handleRecleanImage(img.id)}
                              className="text-xs px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium disabled:opacity-50"
                            >
                              再補正
                            </button>
                          </Tooltip>
                          <Tooltip content="この図版だけを左に90°回転します。">
                            <button
                              type="button"
                              disabled={cropping}
                              onClick={() => handleRotateImage(img.id, 270)}
                              className="p-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                              aria-label="左に90度回転"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="この図版だけを右に90°回転します。">
                            <button
                              type="button"
                              disabled={cropping}
                              onClick={() => handleRotateImage(img.id, 90)}
                              className="p-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                              aria-label="右に90度回転"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
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

          {/* 模範解答 一括入力アシスト（オンライン自動採点用） */}
          <div className="ui-card p-4 bg-indigo-50/45 border-indigo-200/70 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                模範解答の一括入力アシスト（オンライン自動採点用）
                <InfoTooltip
                  label="模範解答アシストの説明"
                  content="オンライン解答の自動採点には各設問の「模範解答」が必要です。AIによる下書き生成と、解答冊子の写真アップロードの2通りの方法で一括入力できます。いずれも確認画面を経てからフォームに反映されます。"
                />
              </div>
              <p className="text-[11px] text-slate-600">
                既存の手入力を勝手に上書きせず、確認ダイアログで1問ずつ見比べて反映できます。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip content="登録済みの問題文・図版からAIが模範解答と別解の候補を下書き作成します（保護者確認後に保存）。">
                <button
                  type="button"
                  disabled={suggestingAnswers || extractingAnswerImg || questions.length === 0}
                  onClick={handleSuggestAnswersByAI}
                  className="ui-btn-secondary px-3 py-1.5 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {suggestingAnswers ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {suggestingAnswers ? 'AI候補を作成中...' : 'AIで解答を下書き'}
                </button>
              </Tooltip>

              <input
                ref={answerImgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUploadAnswerSheet}
              />
              <Tooltip content="解答・解説ページの写真をアップロードすると、問題番号を自動照合して公式解答を一括抽出します。">
                <button
                  type="button"
                  disabled={suggestingAnswers || extractingAnswerImg || questions.length === 0}
                  onClick={() => answerImgInputRef.current?.click()}
                  className="ui-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {extractingAnswerImg ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="w-3.5 h-3.5" />
                  )}
                  {extractingAnswerImg ? '解答写真を解析中...' : '解答写真から取込'}
                </button>
              </Tooltip>
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

                {/* 模範解答・別解・採点ルール・メモ */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <label className="text-[11px] font-semibold text-slate-600">
                        模範解答（オンライン採点キー）
                      </label>
                      {q.is_ai_candidate && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                          候補反映済・要確認
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={q.manual_answer}
                      onChange={(e) =>
                        updateQuestion(idx, {
                          manual_answer: e.target.value,
                          is_ai_candidate: false,
                        })
                      }
                      placeholder="例：ア / 約束 / 光合成"
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50/70"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <label className="text-[11px] font-semibold text-slate-600">
                        別解（カンマ区切り・任意）
                      </label>
                      <InfoTooltip
                        label="別解の説明"
                        content="模範解答以外に正解とみなす表記をカンマ区切りで登録できます（例：こうごうせい, 光合成）。漢字の書き取り問題ではひらがなを別解に入れないでください。"
                      />
                    </div>
                    <input
                      type="text"
                      value={q.answer_aliases_text}
                      onChange={(e) => updateQuestion(idx, { answer_aliases_text: e.target.value })}
                      placeholder="例：こうごうせい, 光合成作用"
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50/70"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <label className="text-[11px] font-semibold text-slate-600">
                        採点ルール（任意）
                      </label>
                      <InfoTooltip
                        label="採点ルールの説明"
                        content="AI自動採点時に厳守させたい条件を書きます（例：「必ず漢字で書くこと」「カタカナ指定」「理由に温度と体積の両方を含むこと」）。"
                      />
                    </div>
                    <input
                      type="text"
                      value={q.grading_note}
                      onChange={(e) => updateQuestion(idx, { grading_note: e.target.value })}
                      placeholder="例：漢字で書くこと / カタカナ指定"
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50/70"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                      解説メモ（任意）
                    </label>
                    <input
                      type="text"
                      value={q.memo}
                      onChange={(e) => updateQuestion(idx, { memo: e.target.value })}
                      placeholder="保護者向け解説・注意点など"
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50/70"
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

      <AnswerSuggestionDialog
        open={Boolean(suggestionResult)}
        response={suggestionResult}
        currentQuestions={questions}
        onClose={() => setSuggestionResult(null)}
        onApply={handleApplySuggestions}
      />
    </div>
  );
};
