export type SubjectType = 'kokugo' | 'rika' | 'shakai' | 'sansu';
export type GroupStatus = 'draft' | 'published' | 'archived';
export type QuestionType =
  | 'kanji_write'
  | 'kanji_read'
  | 'kokugo_subjective'
  | 'single_choice'
  | 'multi_choice'
  | 'fill_blank'
  | 'short_answer';

export const SUBJECT_LABELS: Record<SubjectType, string> = {
  kokugo: '国語',
  rika: '理科',
  shakai: '社会',
  sansu: '算数',
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  kanji_write: '漢字の書き取り',
  kanji_read: '漢字の読み',
  kokugo_subjective: '国語記述・語句',
  single_choice: '選択（単一）',
  multi_choice: '選択（複数）',
  fill_blank: '穴埋め',
  short_answer: '用語・記述',
};

export interface OptionItem {
  label: string;
  text: string;
}

export interface CropBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface AnswerBoxConfig {
  type?: 'kanji_grid' | 'reading_box' | 'blank_line' | 'choice_only';
  cells?: number;
}

export interface QuestionImage {
  id: string;
  group_id: string;
  question_id: string | null;
  raw_crop_path: string;
  cleaned_path: string;
  use_cleaned: boolean;
  crop_box: CropBox;
  caption: string;
  sort_order: number;
}

export interface Question {
  id: string;
  group_id: string;
  sort_order: number;
  question_type: QuestionType;
  body: string;
  options: OptionItem[];
  answer_box_config: AnswerBoxConfig;
  manual_answer: string | null;
  memo: string;
  tested_count: number;
  wrong_count: number;
  last_tested_at: string | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionGroup {
  id: string;
  subject: SubjectType;
  source_name: string;
  source_image_path: string | null;
  lead_text: string;
  status: GroupStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
  questions: Question[];
  images: QuestionImage[];
}

export interface QuestionGroupListResponse {
  items: QuestionGroup[];
  total: number;
  draft_count: number;
}

export interface FacetsResponse {
  sources: string[];
  tags: string[];
  published_counts: Record<SubjectType, number>;
  draft_count: number;
}

export interface ExamCandidateSelection {
  group: QuestionGroup;
  selected_question_ids: string[];
}

export interface ExamSummary {
  id: string;
  title: string;
  paper_size: 'B4' | 'A4';
  layout_config: Record<string, unknown>;
  created_at: string;
  item_count: number;
  wrong_count: number;
  subjects: SubjectType[];
}

export interface ExamItem {
  id: string;
  exam_id: string;
  group_id: string;
  question_id: string;
  subject: SubjectType;
  section_order: number;
  item_order: number;
  is_wrong: boolean | null;
}

export interface ExamGroupSection {
  group: QuestionGroup;
  items: {
    exam_item: ExamItem;
    question: Question;
  }[];
}

export interface ExamDetail {
  id: string;
  title: string;
  paper_size: 'B4' | 'A4';
  layout_config: Record<string, unknown>;
  created_at: string;
  sections: Partial<Record<SubjectType, ExamGroupSection[]>>;
}

export interface LLMSettings {
  provider: 'gemini' | 'openai_compatible';
  gemini_api_key_masked: string;
  gemini_has_key: boolean;
  gemini_model: string;
  openai_api_key_masked: string;
  openai_has_key: boolean;
  openai_base_url: string;
  openai_model: string;
}
