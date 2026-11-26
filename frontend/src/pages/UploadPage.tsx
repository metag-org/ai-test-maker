import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookMarked,
  BookOpen,
  Camera,
  Check,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  FlaskConical,
  Globe2,
  ImagePlus,
  Lightbulb,
  Loader2,
  RotateCcw,
  RotateCw,
  Settings,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';
import { Tooltip } from '../components/Tooltip';
import type { FacetsResponse, LLMSettings, SubjectType } from '../types';
import { SUBJECT_THEME } from '../utils/subjectTheme';

interface UploadPageProps {
  onDraftsUpdated: () => void;
}

const SUBJECT_CARDS: {
  value: SubjectType;
  icon: React.FC<{ className?: string }>;
}[] = [
  { value: 'kokugo', icon: BookMarked },
  { value: 'rika', icon: FlaskConical },
  { value: 'shakai', icon: Globe2 },
];

const QUICK_SOURCES: Record<SubjectType, string[]> = {
  kokugo: ['漢字練習プリント', '漢字確認テスト', '語彙・ことばプリント', '国語ワーク'],
  rika: ['理科テキスト ', '理科要点プリント', '確認問題'],
  shakai: ['社会テキスト ', '社会要点プリント', '白地図プリント'],
  sansu: ['算数テキスト ', '計算・基礎プリント'],
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UploadPage: React.FC<UploadPageProps> = ({ onDraftsUpdated }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState<SubjectType>('rika');
  const [sourceName, setSourceName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [skipLlm, setSkipLlm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [facets, setFacets] = useState<FacetsResponse | null>(null);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);

  useEffect(() => {
    Promise.all([
      api.getFacets().catch(() => null),
      api.getLLMSettings().catch(() => null),
    ]).then(([f, s]) => {
      if (f) setFacets(f);
      if (s) setLlmSettings(s);
    });
  }, []);

  const appendFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    setError('');
    setFiles((prev) => [...prev, ...arr]);
    setPreviews((prev) => [...prev, ...arr.map((f) => URL.createObjectURL(f))]);
  };

  // クリップボード貼り付け（Cmd+V / Ctrl+V）でスクリーンショット等を直接追加
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedImages: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) pastedImages.push(file);
        }
      }
      if (pastedImages.length > 0) {
        appendFiles(pastedImages);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const rotateFile = async (idx: number, angleCw: 90 | 270) => {
    const srcUrl = previews[idx];
    const origFile = files[idx];
    if (!srcUrl || !origFile) return;

    const img = new Image();
    img.src = srcUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angleCw * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) return;

    const nextFile = new File([blob], origFile.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
    const nextUrl = URL.createObjectURL(nextFile);
    URL.revokeObjectURL(srcUrl);
    setFiles((prev) => prev.map((f, i) => (i === idx ? nextFile : f)));
    setPreviews((prev) => prev.map((u, i) => (i === idx ? nextUrl : u)));
  };

  const clearAllFiles = () => {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setFiles([]);
    setPreviews([]);
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('写真を選択・撮影するか、ここにドラッグ＆ドロップしてください。');
      return;
    }
    setError('');
    setLoading(true);
    setProgressIndex(0);
    let lastCreatedId: string | null = null;
    let totalExtractTokens = 0;
    let totalExtractIn = 0;
    let totalExtractOut = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setProgressIndex(i + 1);
        setProgressText(
          skipLlm
            ? `画像を登録中 (${i + 1} / ${files.length})...`
            : `AIが問題を読み取り中 (${i + 1} / ${files.length}) — 手書き除去と図版切り出しを実行しています`
        );
        const created = await api.uploadAndExtract(files[i], subject, sourceName, skipLlm);
        if (created.length > 0) {
          if (!lastCreatedId) lastCreatedId = created[0].id;
          // 1枚の画像から複数グループが抽出された場合は同一抽出コールのため先頭グループ分のみ加算
          const ex = created[0].llm_usage?.extract;
          if (ex && ex.total_tokens > 0) {
            totalExtractTokens += ex.total_tokens;
            totalExtractIn += ex.input_tokens;
            totalExtractOut += ex.output_tokens;
          }
        }
      }
      onDraftsUpdated();
      if (totalExtractTokens > 0) {
        showToast(
          `AI問題抽出が完了しました（消費: ${totalExtractTokens.toLocaleString()} tokens / 入力 ${totalExtractIn.toLocaleString()}・出力 ${totalExtractOut.toLocaleString()}）`,
          'success'
        );
      }
      navigate(lastCreatedId ? `/review?id=${lastCreatedId}` : '/review');
    } catch (err) {
      setError(err instanceof Error ? err.message : '抽出処理中にエラーが発生しました。');
    } finally {
      setLoading(false);
      setProgressText('');
      setProgressIndex(0);
    }
  };

  const handleCreateManualBlank = async () => {
    setError('');
    setLoading(true);
    try {
      const grp = await api.createGroup({
        subject,
        source_name: sourceName,
        lead_text: '',
        status: 'draft',
        tags: [],
        questions: [
          {
            sort_order: 0,
            question_type: subject === 'kokugo' ? 'kanji_write' : 'short_answer',
            body: '',
            options: [],
            answer_box_config:
              subject === 'kokugo'
                ? { type: 'kanji_grid', cells: 2 }
                : { type: 'blank_line', cells: 2 },
            manual_answer: null,
            memo: '',
            needs_review: false,
          },
        ],
      });
      onDraftsUpdated();
      navigate(`/review?id=${grp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const hasApiKeyConfigured =
    llmSettings == null
      ? true
      : llmSettings.provider === 'gemini'
      ? llmSettings.gemini_has_key
      : llmSettings.openai_has_key;

  const totalPublished = facets
    ? (facets.published_counts.kokugo || 0) +
      (facets.published_counts.rika || 0) +
      (facets.published_counts.shakai || 0)
    : 0;

  return (
    <div className="space-y-6">
      {/* ページヘッダー・ワークフローバナー */}
      <section className="relative overflow-hidden rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 p-6 sm:p-7 text-white shadow-lg shadow-indigo-950/15">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-indigo-500/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-emerald-400/15 blur-3xl"
        />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-indigo-100 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              AI 宿題スキャン＆B4/A4 テスト生成
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              問題登録（写真アップロード）
            </h1>
            <p className="text-xs sm:text-sm text-indigo-100/85 leading-relaxed">
              書き込みや赤ペン採点が残ったままの宿題・テキストを撮影するだけで、AIが解答の筆跡を取り除き、設問・選択肢・図版をきれいにデータ化します。
            </p>
          </div>

          <ol className="flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs shrink-0">
            {[
              { step: '1', label: '撮影・登録', active: true },
              { step: '2', label: '検収・微調整', active: false },
              { step: '3', label: 'テスト印刷', active: false },
            ].map((s, idx) => (
              <React.Fragment key={s.step}>
                <li
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 border backdrop-blur-sm ${
                    s.active
                      ? 'bg-white/15 border-white/30 text-white font-bold'
                      : 'bg-white/5 border-white/10 text-indigo-200/80'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      s.active ? 'bg-amber-400 text-slate-950' : 'bg-white/15 text-white'
                    }`}
                  >
                    {s.step}
                  </span>
                  <span className="whitespace-nowrap">{s.label}</span>
                </li>
                {idx < 2 && <ArrowRight className="hidden sm:block h-3.5 w-3.5 text-indigo-300/60" />}
              </React.Fragment>
            ))}
          </ol>
        </div>
      </section>

      {/* LLM 未設定時のやさしい案内バナー */}
      {!hasApiKeyConfigured && !skipLlm && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/80 bg-amber-50/90 px-4 py-3.5 text-sm text-amber-950 shadow-sm">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">AI 抽出用の API キーが未設定です。</span>
              <span className="text-amber-900/90 ml-1">
                先に設定画面で Gemini または OpenAI 互換 API キーを登録すると、写真からの自動問題抽出が使えます。
              </span>
            </div>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition shrink-0"
          >
            <Settings className="h-3.5 w-3.5" />
            設定画面を開く
          </Link>
        </div>
      )}

      {/* メイン 2カラムレイアウト */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左カラム：問題登録フォーム */}
        <form onSubmit={handleExtract} className="lg:col-span-8 ui-card p-5 sm:p-7 space-y-6">
          {/* 1. 科目選択（セマンティック fieldset + radio カード） */}
          <fieldset className="space-y-3">
            <legend className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-xs font-extrabold text-indigo-700">
                1
              </span>
              科目を選択
            </legend>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SUBJECT_CARDS.map(({ value, icon: Icon }) => {
                const theme = SUBJECT_THEME[value];
                const active = subject === value;
                return (
                  <label
                    key={value}
                    className={`radio-card relative cursor-pointer rounded-2xl border-2 p-4 transition-all duration-150 ${
                      active
                        ? theme.activeCardClass
                        : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <input
                      type="radio"
                      name="subject"
                      value={value}
                      checked={active}
                      onChange={() => setSubject(value)}
                      className="visually-hidden"
                    />
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                          active ? theme.iconBgClass : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      {active && (
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${theme.accentBarClass}`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="mt-3 font-bold text-slate-900 text-sm">{theme.label}</div>
                    <div className="text-xs text-slate-500 mt-1 leading-relaxed">{theme.desc}</div>
                    <div className="mt-2.5 inline-block rounded-md bg-slate-100/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {theme.layoutHint}
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* 2. 教材・テキスト番号 */}
          <div className="space-y-2">
            <label
              htmlFor="source-name-input"
              className="flex items-center gap-2 text-sm font-bold text-slate-800"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-xs font-extrabold text-indigo-700">
                2
              </span>
              教材・テキスト番号
              <span className="text-xs font-normal text-slate-400">（任意）</span>
            </label>
            <input
              id="source-name-input"
              name="source_name"
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="例：理科プリント 第14回 / 漢字ワーク p.24 / 単元テスト"
              className="ui-input"
            />
            <div className="flex-balance items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-slate-400 mr-1">クイック入力:</span>
              {QUICK_SOURCES[subject].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSourceName(preset)}
                  className="rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  + {preset.trim()}
                </button>
              ))}
            </div>
          </div>

          {/* 3. 写真アップロード（ドラッグ＆ドロップ + 貼り付け + カメラ） */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-xs font-extrabold text-indigo-700">
                  3
                </span>
                宿題ページを撮影／選択
              </div>
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllFiles}
                  className="text-xs font-medium text-slate-400 hover:text-rose-600 transition"
                >
                  すべてクリア ({files.length}枚)
                </button>
              )}
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                appendFiles(e.target.files);
                e.target.value = '';
              }}
              className="visually-hidden"
            />
            <input
              ref={albumInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                appendFiles(e.target.files);
                e.target.value = '';
              }}
              className="visually-hidden"
            />

            {/* ドロップゾーン */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                appendFiles(e.dataTransfer.files);
              }}
              className={`rounded-2xl border-2 border-dashed p-6 sm:p-7 text-center transition-all duration-150 ${
                isDragging
                  ? 'border-indigo-500 bg-indigo-50/80 scale-[1.005]'
                  : 'border-slate-300/90 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/25'
              }`}
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200/80">
                <UploadCloud className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-bold text-slate-800">
                画像をここにドラッグ＆ドロップ
              </p>
              <p className="mt-1 text-xs text-slate-500">
                複数ページの一括アップロードや、スクリーンショットの貼り付け（⌘V / Ctrl+V）にも対応しています
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="ui-btn-primary"
                >
                  <Camera className="w-4 h-4" />
                  カメラで撮影（スマホ）
                </button>
                <button
                  type="button"
                  onClick={() => albumInputRef.current?.click()}
                  className="ui-btn-secondary"
                >
                  <ImagePlus className="w-4 h-4 text-indigo-600" />
                  画像ファイルを選択
                </button>
              </div>
            </div>

            {/* プレビューサムネイル */}
            {previews.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                {previews.map((src, idx) => (
                  <div
                    key={src}
                    className="group relative rounded-2xl overflow-hidden border border-slate-200/90 bg-white shadow-sm transition hover:shadow-md"
                  >
                    <div className="relative aspect-[4/3] bg-slate-100">
                      <img
                        src={src}
                        alt={`選択画像 ${idx + 1}`}
                        className="block h-full w-full object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded-lg bg-slate-900/75 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                        {idx + 1}枚目
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/75 text-white backdrop-blur-sm transition hover:bg-rose-600"
                        title="この画像を削除"
                        aria-label={`${idx + 1}枚目の画像を削除`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="px-2.5 py-2 flex items-center justify-between gap-1.5 text-[11px] bg-white">
                      <span className="truncate font-medium text-slate-700 flex-1 min-w-0">
                        {files[idx]?.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip content="アップロード前に左へ90°回転します。">
                          <button
                            type="button"
                            onClick={() => rotateFile(idx, 270)}
                            className="p-1 rounded-md border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition"
                            aria-label={`${idx + 1}枚目を左に90度回転`}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip content="アップロード前に右へ90°回転します。">
                          <button
                            type="button"
                            onClick={() => rotateFile(idx, 90)}
                            className="p-1 rounded-md border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition"
                            aria-label={`${idx + 1}枚目を右に90度回転`}
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <span className="text-slate-400 ml-0.5">
                          {files[idx] ? formatFileSize(files[idx].size) : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => albumInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 text-xs font-semibold text-slate-500 transition hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700 min-h-[140px]"
                >
                  <ImagePlus className="h-5 w-5" />
                  <span>ページを追加</span>
                </button>
              </div>
            )}
          </div>

          {/* オプション */}
          <div className="rounded-xl bg-slate-50/90 border border-slate-200/70 px-4 py-3">
            <label
              htmlFor="skip-llm-checkbox"
              className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer"
            >
              <input
                id="skip-llm-checkbox"
                type="checkbox"
                checked={skipLlm}
                onChange={(e) => setSkipLlm(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>
                <strong className="text-slate-800">AI抽出をスキップして取り込む</strong>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  原本画像のみ登録し、次の画面で手動トリミングと問題文入力を行います。
                </span>
              </span>
            </label>
          </div>

          {/* 進捗インジケータ */}
          {loading && progressText && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 space-y-2.5"
            >
              <div className="flex items-center gap-2.5 text-sm font-bold text-indigo-900">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600 shrink-0" />
                <span>{progressText}</span>
              </div>
              {files.length > 0 && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.max(12, Math.round((progressIndex / files.length) * 100))}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-rose-50 border border-rose-200/90 px-4 py-3 text-rose-700 text-sm"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* アクションバー */}
          <div className="pt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <button
              type="button"
              disabled={loading}
              onClick={handleCreateManualBlank}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-indigo-700 font-semibold transition"
            >
              <FilePlus2 className="w-4 h-4" />
              画像なしで新規問題を手入力
            </button>

            <button
              type="submit"
              disabled={loading}
              className="ui-btn-emerald px-6 py-3 text-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>処理中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {skipLlm
                      ? `下書きを作成${files.length > 0 ? ` (${files.length}枚)` : ''}`
                      : `AIで問題を抽出する${files.length > 0 ? ` (${files.length}枚)` : ''}`}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* 右カラム：学習ステータス＆撮影のコツ */}
        <aside className="lg:col-span-4 space-y-5">
          {/* 検収待ちショートカット */}
          {facets && facets.draft_count > 0 && (
            <Link
              to="/review"
              className="group block rounded-2xl border border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-4 shadow-sm transition hover:border-amber-400 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
                    <FileCheck2 className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-amber-800">検収待ちの下書き</div>
                    <div className="text-lg font-extrabold text-amber-950">
                      {facets.draft_count} 件あります
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-amber-600 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          )}

          {/* 登録済み問題バンクサマリー */}
          <div className="ui-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-indigo-600" />
                問題バンク状況
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                合計 {totalPublished} 大問
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {(['kokugo', 'rika', 'shakai'] as SubjectType[]).map((s) => {
                const theme = SUBJECT_THEME[s];
                const count = facets?.published_counts?.[s] ?? 0;
                return (
                  <div
                    key={s}
                    className={`rounded-xl border p-3 text-center ${theme.softBgClass} ${theme.borderClass}`}
                  >
                    <div className={`text-[11px] font-bold ${theme.countTextClass}`}>
                      {theme.shortLabel}
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link
                to="/bank"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                <BookOpen className="h-3.5 w-3.5 text-slate-500" />
                問題を見る
              </Link>
              <Link
                to="/exams/new"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                テスト作成へ
              </Link>
            </div>
          </div>

          {/* 撮影・登録のコツ */}
          <div className="ui-card p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              きれいに抽出するコツ
            </h2>
            <ul className="space-y-2.5 text-xs text-slate-600 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span>
                  <strong className="text-slate-800">書き込みはそのままでOK</strong>：鉛筆の答えや赤ペンの丸付けはAIが自動で無視します。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>
                  <strong className="text-slate-800">真上から明るく撮影</strong>：ページのゆがみが少ないほど図版の切り出し精度が上がります。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                <span>
                  <strong className="text-slate-800">スマホからも利用可能</strong>：同じWi-Fi内のスマホで開くとカメラで直接スキャンできます。
                </span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
};
