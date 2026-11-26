import React, { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  BookOpen,
  Camera,
  ClipboardCheck,
  FileCheck2,
  History,
  LogOut,
  Settings,
} from 'lucide-react';
import { api } from './api/client';
import { BrandLogo } from './components/BrandLogo';
import { ToastProvider } from './components/ToastProvider';
import { BankPage } from './pages/BankPage';
import { ExamBuilderPage } from './pages/ExamBuilderPage';
import { ExamHistoryPage } from './pages/ExamHistoryPage';
import { ExamPrintPage } from './pages/ExamPrintPage';
import { ExamSolvePage } from './pages/ExamSolvePage';
import { ExamSubmissionReviewPage } from './pages/ExamSubmissionReviewPage';
import { LoginPage } from './pages/LoginPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { UploadPage } from './pages/UploadPage';

const NavBar: React.FC<{
  draftCount: number;
  passwordEnabled: boolean;
  onLogout: () => void;
}> = ({ draftCount, passwordEnabled, onLogout }) => {
  const { pathname } = useLocation();

  const items = [
    { to: '/upload', label: '問題登録', icon: Camera },
    { to: '/review', label: '検収・編集', icon: FileCheck2, badge: draftCount },
    { to: '/bank', label: '問題バンク', icon: BookOpen },
    { to: '/exams/new', label: 'テスト作成', icon: ClipboardCheck },
    { to: '/exams', label: 'テスト履歴', icon: History },
    { to: '/settings', label: '設定', icon: Settings },
  ];

  const isActive = (to: string) => {
    if (to === '/exams') {
      return pathname === '/exams' || (pathname.startsWith('/exams/') && pathname !== '/exams/new');
    }
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md shadow-[0_1px_12px_-4px_rgba(15,23,42,0.06)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/upload"
          className="group flex items-center gap-2.5 rounded-xl pr-2 py-0.5 transition hover:opacity-90"
        >
          <BrandLogo className="h-10 w-10 shrink-0 drop-shadow-sm transition-transform duration-150 group-hover:scale-[1.03]" />
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="inline-block rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-extrabold tracking-widest text-indigo-700 ring-1 ring-inset ring-indigo-200/80">
                AI
              </span>
              <span className="text-sm sm:text-[15px] font-bold tracking-tight text-slate-900">
                復習テストメーカー
              </span>
            </div>
            <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">
              家庭学習の宿題から B4 / A4 復習テストを自動生成
            </p>
          </div>
        </Link>

        <nav
          aria-label="メインナビゲーション"
          className="flex items-center gap-1 overflow-x-auto py-0.5 max-w-full"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-[13px] font-semibold whitespace-nowrap transition-all duration-150 ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/25'
                    : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-indigo-100' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      active
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-amber-500 text-white shadow-sm'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          {passwordEnabled && (
            <button
              type="button"
              onClick={onLogout}
              className="ml-1 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
              title="ログアウト"
              aria-label="ログアウト"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};

export const App: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [draftCount, setDraftCount] = useState(0);

  const refreshDraftCount = async () => {
    try {
      const f = await api.getFacets();
      setDraftCount(f.draft_count || 0);
    } catch {
      // ignore
    }
  };

  const checkAuth = async () => {
    try {
      const st = await api.authStatus();
      setPasswordEnabled(st.password_enabled);
      setAuthenticated(st.authenticated);
      if (st.authenticated) {
        refreshDraftCount();
      }
    } finally {
      setAuthChecked(true);
    }
  };

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 text-slate-500 text-sm">
        <BrandLogo className="h-14 w-14 animate-pulse drop-shadow-md" />
        <span className="font-medium text-slate-600">読み込み中...</span>
      </div>
    );
  }

  if (passwordEnabled && !authenticated) {
    return (
      <LoginPage
        onSuccess={() => {
          setAuthenticated(true);
          refreshDraftCount();
        }}
      />
    );
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <div className="min-h-[100dvh] flex flex-col">
          <NavBar
            draftCount={draftCount}
            passwordEnabled={passwordEnabled}
            onLogout={async () => {
              await api.logout();
              setAuthenticated(false);
            }}
          />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 print-only-wrapper">
            <Routes>
              <Route path="/" element={<Navigate to="/upload" replace />} />
              <Route path="/upload" element={<UploadPage onDraftsUpdated={refreshDraftCount} />} />
              <Route path="/review" element={<ReviewPage onDraftsUpdated={refreshDraftCount} />} />
              <Route path="/bank" element={<BankPage />} />
              <Route path="/exams/new" element={<ExamBuilderPage />} />
              <Route path="/exams" element={<ExamHistoryPage />} />
              <Route path="/exams/:id" element={<ExamPrintPage />} />
              <Route path="/exams/:id/solve" element={<ExamSolvePage />} />
              <Route path="/exams/:id/submissions/:submissionId" element={<ExamSubmissionReviewPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
          <footer className="no-print border-t border-slate-200/60 bg-white/50 py-3.5 text-center text-[11px] text-slate-400">
            復習テストメーカー — 家庭学習・B4/A4 印刷対応
          </footer>
        </div>
      </BrowserRouter>
    </ToastProvider>
  );
};
