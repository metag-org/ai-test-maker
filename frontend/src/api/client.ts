import type {
  CropBox,
  ExamCandidateSelection,
  ExamDetail,
  ExamSummary,
  FacetsResponse,
  LLMSettings,
  QuestionGroup,
  QuestionGroupListResponse,
  QuestionImage,
  SubjectType,
} from '../types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    let msg = `エラーが発生しました (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) msg = String(data.detail);
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export function uploadUrl(relPath: string | null | undefined): string {
  if (!relPath) return '';
  return `/uploads/${relPath}`;
}

export const api = {
  // Auth
  authStatus: () => request<{ password_enabled: boolean; authenticated: boolean }>('/api/auth/status'),
  login: (password: string) =>
    request<{ authenticated: boolean }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Settings
  getLLMSettings: () => request<LLMSettings>('/api/settings/llm'),
  updateLLMSettings: (payload: {
    provider: 'gemini' | 'openai_compatible';
    gemini_api_key?: string;
    gemini_model: string;
    openai_api_key?: string;
    openai_base_url: string;
    openai_model: string;
  }) =>
    request<LLMSettings>('/api/settings/llm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  testLLM: () => request<{ ok: boolean; message: string }>('/api/settings/llm/test', { method: 'POST' }),

  // Upload & Extract
  uploadAndExtract: (file: File, subject: SubjectType, sourceName: string, skipLlm = false) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('subject', subject);
    fd.append('source_name', sourceName);
    fd.append('skip_llm', String(skipLlm));
    return request<QuestionGroup[]>('/api/upload/extract', {
      method: 'POST',
      body: fd,
    });
  },

  // Groups
  getFacets: () => request<FacetsResponse>('/api/groups/meta/facets'),
  listGroups: (params: {
    status?: string;
    subject?: string;
    search?: string;
    source_name?: string;
    tag?: string;
    needs_review?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set('status', params.status);
    if (params.subject) sp.set('subject', params.subject);
    if (params.search) sp.set('search', params.search);
    if (params.source_name) sp.set('source_name', params.source_name);
    if (params.tag) sp.set('tag', params.tag);
    if (params.needs_review) sp.set('needs_review', 'true');
    const qs = sp.toString();
    return request<QuestionGroupListResponse>(`/api/groups${qs ? `?${qs}` : ''}`);
  },
  getGroup: (id: string) => request<QuestionGroup>(`/api/groups/${id}`),
  createGroup: (payload: unknown) =>
    request<QuestionGroup>('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  updateGroup: (id: string, payload: unknown) =>
    request<QuestionGroup>(`/api/groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteGroup: (id: string) => request<{ deleted: boolean }>(`/api/groups/${id}`, { method: 'DELETE' }),
  toggleQuestionReview: (questionId: string, needsReview: boolean) =>
    request<{ id: string; needs_review: boolean }>(
      `/api/groups/questions/${questionId}/review?needs_review=${needsReview}`,
      { method: 'PATCH' }
    ),

  // Group Images
  addGroupImage: (groupId: string, payload: { crop_box: CropBox; caption: string; use_cleaned: boolean }) =>
    request<QuestionImage>(`/api/groups/${groupId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  updateGroupImage: (
    groupId: string,
    imageId: string,
    payload: { crop_box?: CropBox; caption?: string; use_cleaned?: boolean }
  ) =>
    request<QuestionImage>(`/api/groups/${groupId}/images/${imageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteGroupImage: (groupId: string, imageId: string) =>
    request<{ deleted: boolean }>(`/api/groups/${groupId}/images/${imageId}`, { method: 'DELETE' }),

  // Exams
  generateExamCandidates: (payload: {
    kokugo_count: number;
    rika_count: number;
    shakai_count: number;
    source_filter: string;
    tag_filter: string;
    exclude_days: number;
    prioritize_wrong: boolean;
  }) =>
    request<{ selections: ExamCandidateSelection[] }>('/api/exams/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  createExam: (payload: {
    title: string;
    paper_size: 'B4' | 'A4';
    layout_config: Record<string, unknown>;
    selections: { group_id: string; subject: SubjectType; question_ids: string[] }[];
  }) =>
    request<ExamDetail>('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  listExams: () => request<ExamSummary[]>('/api/exams'),
  getExam: (id: string) => request<ExamDetail>(`/api/exams/${id}`),
  gradeExamItem: (examId: string, itemId: string, isWrong: boolean | null) =>
    request<{ id: string; is_wrong: boolean | null }>(`/api/exams/${examId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_wrong: isWrong }),
    }),
  deleteExam: (id: string) => request<{ deleted: boolean }>(`/api/exams/${id}`, { method: 'DELETE' }),
};
