import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { api } from '../api/client';
import { BrandLogo } from '../components/BrandLogo';

interface LoginPageProps {
  onSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm ui-card p-7 space-y-5"
      >
        <div className="flex flex-col items-center text-center space-y-2.5">
          <BrandLogo className="h-16 w-16 drop-shadow-md" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">復習テストメーカー</h1>
            <p className="text-xs text-slate-500 mt-1">
              パスワードを入力してログインしてください
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 mb-1.5">
            パスワード
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              className="ui-input pl-10 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="ui-btn-primary w-full py-2.5">
          {loading ? '確認中...' : 'ログイン'}
        </button>
      </form>
    </div>
  );
};
