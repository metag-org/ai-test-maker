import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  Save,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import type { LLMSettings } from '../types';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [provider, setProvider] = useState<'gemini' | 'openai_compatible'>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o');

  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    api.getLLMSettings().then((data) => {
      setSettings(data);
      setProvider(data.provider);
      setGeminiModel(data.gemini_model);
      setOpenaiBaseUrl(data.openai_base_url);
      setOpenaiModel(data.openai_model);
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg('');
    setStatusError(false);
    setTestResult(null);
    try {
      const updated = await api.updateLLMSettings({
        provider,
        gemini_api_key: geminiApiKey || undefined,
        gemini_model: geminiModel,
        openai_api_key: openaiApiKey || undefined,
        openai_base_url: openaiBaseUrl,
        openai_model: openaiModel,
      });
      setSettings(updated);
      setGeminiApiKey('');
      setOpenaiApiKey('');
      setStatusMsg('設定を保存しました。');
    } catch (err) {
      setStatusError(true);
      setStatusMsg(err instanceof Error ? err.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testLLM();
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'テストに失敗しました。',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-900">
          LLM 設定
        </h1>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">
          写真から問題を抽出するマルチモーダルLLMのAPIキーとモデルを設定します。日本語OCRと図版座標の精度が高い Gemini 2.5 Flash / Pro がおすすめです。
        </p>
      </div>

      <form onSubmit={handleSave} className="ui-card p-5 sm:p-7 space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-bold text-slate-800">使用するプロバイダ</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                value: 'gemini' as const,
                title: 'Google Gemini（推奨）',
                desc: '日本語OCRと図版切り出し座標の精度が非常に高い',
                icon: Sparkles,
              },
              {
                value: 'openai_compatible' as const,
                title: 'OpenAI 互換 API',
                desc: 'OpenAI / OneAPI / 中継サーバー / ローカルVLM対応',
                icon: Cpu,
              },
            ].map((item) => {
              const Icon = item.icon;
              const active = provider === item.value;
              return (
                <label
                  key={item.value}
                  className={`radio-card cursor-pointer rounded-2xl border-2 p-4 transition-all duration-150 ${
                    active
                      ? 'border-indigo-600 bg-gradient-to-br from-indigo-50 via-white to-indigo-50/40 shadow-sm ring-2 ring-indigo-500/15'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="llm_provider"
                    value={item.value}
                    checked={active}
                    onChange={() => setProvider(item.value)}
                    className="visually-hidden"
                  />
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {active && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="mt-3 font-bold text-sm text-slate-900">{item.title}</div>
                  <div className="text-xs text-slate-500 mt-1 leading-relaxed">{item.desc}</div>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Gemini 設定 */}
        <div
          className={`p-5 rounded-2xl border space-y-4 transition ${
            provider === 'gemini'
              ? 'border-indigo-200/90 bg-indigo-50/30'
              : 'border-slate-200/80 bg-slate-50/40 opacity-75'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm text-slate-900">Google Gemini 設定</div>
            {settings?.gemini_has_key && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                キー登録済 ({settings.gemini_api_key_masked})
              </span>
            )}
          </div>

          <div>
            <label htmlFor="gemini-api-key" className="block text-xs font-semibold text-slate-700 mb-1.5">
              API キー
            </label>
            <div className="relative">
              <input
                id="gemini-api-key"
                name="gemini_api_key"
                type={showGeminiKey ? 'text' : 'password'}
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder={settings?.gemini_has_key ? '変更する場合のみ新しく入力' : 'AIza...'}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="ui-input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey((v) => !v)}
                aria-pressed={showGeminiKey}
                aria-label={showGeminiKey ? 'Gemini APIキーを隠す' : 'Gemini APIキーを表示'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="gemini-model" className="block text-xs font-semibold text-slate-700 mb-1.5">
              モデル名
            </label>
            <input
              id="gemini-model"
              name="gemini_model"
              type="text"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              placeholder="gemini-2.5-flash"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="ui-input"
            />
            <div className="mt-2 flex-balance items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">おすすめ:</span>
              {['gemini-2.5-flash', 'gemini-2.5-pro'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setGeminiModel(m)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* OpenAI 互換設定 */}
        <div
          className={`p-5 rounded-2xl border space-y-4 transition ${
            provider === 'openai_compatible'
              ? 'border-indigo-200/90 bg-indigo-50/30'
              : 'border-slate-200/80 bg-slate-50/40 opacity-75'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm text-slate-900">OpenAI 互換 API 設定</div>
            {settings?.openai_has_key && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                キー登録済 ({settings.openai_api_key_masked})
              </span>
            )}
          </div>

          <div>
            <label htmlFor="openai-base-url" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Base URL
            </label>
            <input
              id="openai-base-url"
              name="openai_base_url"
              type="url"
              value={openaiBaseUrl}
              onChange={(e) => setOpenaiBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="ui-input"
            />
          </div>

          <div>
            <label htmlFor="openai-api-key" className="block text-xs font-semibold text-slate-700 mb-1.5">
              API キー
            </label>
            <div className="relative">
              <input
                id="openai-api-key"
                name="openai_api_key"
                type={showOpenaiKey ? 'text' : 'password'}
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder={settings?.openai_has_key ? '変更する場合のみ新しく入力' : 'sk-...'}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="ui-input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowOpenaiKey((v) => !v)}
                aria-pressed={showOpenaiKey}
                aria-label={showOpenaiKey ? 'OpenAI APIキーを隠す' : 'OpenAI APIキーを表示'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                {showOpenaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="openai-model" className="block text-xs font-semibold text-slate-700 mb-1.5">
              モデル名
            </label>
            <input
              id="openai-model"
              name="openai_model"
              type="text"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              placeholder="gpt-4o"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="ui-input"
            />
          </div>
        </div>

        {statusMsg && (
          <div
            role="status"
            className={`text-sm p-3.5 rounded-xl border flex items-center gap-2 ${
              statusError
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {statusError ? (
              <XCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMsg}</span>
          </div>
        )}

        {testResult && (
          <div
            role="status"
            className={`text-sm p-3.5 rounded-xl border flex items-center gap-2 ${
              testResult.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="ui-btn-secondary"
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            ) : (
              <PlugZap className="w-4 h-4 text-indigo-600" />
            )}
            接続テスト
          </button>

          <button type="submit" disabled={saving} className="ui-btn-primary px-6">
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>
      </form>
    </div>
  );
};
