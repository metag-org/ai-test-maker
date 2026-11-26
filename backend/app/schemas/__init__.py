from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, Field


SubjectType = Literal["kokugo", "rika", "shakai", "sansu"]
GroupStatus = Literal["draft", "published", "archived"]
QuestionType = Literal[
    "kanji_write",
    "kanji_read",
    "kokugo_subjective",
    "single_choice",
    "multi_choice",
    "fill_blank",
    "short_answer",
]


class OptionItem(BaseModel):
    label: str
    text: str


class CropBox(BaseModel):
    ymin: int = Field(ge=0, le=1000)
    xmin: int = Field(ge=0, le=1000)
    ymax: int = Field(ge=0, le=1000)
    xmax: int = Field(ge=0, le=1000)


class QuestionImageRead(BaseModel):
    id: UUID
    group_id: UUID
    question_id: UUID | None = None
    raw_crop_path: str
    cleaned_path: str
    use_cleaned: bool
    crop_box: dict[str, Any]
    caption: str
    sort_order: int

    model_config = {"from_attributes": True}


class QuestionImageCreate(BaseModel):
    crop_box: CropBox
    caption: str = ""
    question_id: UUID | None = None
    use_cleaned: bool = True


class QuestionImageUpdate(BaseModel):
    crop_box: CropBox | None = None
    caption: str | None = None
    use_cleaned: bool | None = None
    question_id: UUID | None = None
    sort_order: int | None = None


class ImageRotateRequest(BaseModel):
    angle_cw: Literal[90, 180, 270] = 90


class QuestionBase(BaseModel):
    sort_order: int = 0
    question_type: QuestionType = "short_answer"
    body: str = ""
    options: list[OptionItem] = Field(default_factory=list)
    answer_box_config: dict[str, Any] = Field(default_factory=dict)
    manual_answer: str | None = None
    answer_aliases: list[str] = Field(default_factory=list)
    grading_note: str = ""
    memo: str = ""
    needs_review: bool = False


class QuestionUpsert(QuestionBase):
    id: UUID | None = None


class QuestionRead(QuestionBase):
    id: UUID
    group_id: UUID
    tested_count: int
    wrong_count: int
    last_tested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QuestionGroupCreate(BaseModel):
    subject: SubjectType
    source_name: str = ""
    lead_text: str = ""
    status: GroupStatus = "draft"
    tags: list[str] = Field(default_factory=list)
    questions: list[QuestionUpsert] = Field(default_factory=list)


class QuestionGroupUpdate(BaseModel):
    subject: SubjectType | None = None
    source_name: str | None = None
    lead_text: str | None = None
    status: GroupStatus | None = None
    tags: list[str] | None = None
    questions: list[QuestionUpsert] | None = None


class QuestionGroupRead(BaseModel):
    id: UUID
    subject: SubjectType
    source_name: str
    source_image_path: str | None = None
    lead_text: str
    status: GroupStatus
    tags: list[str]
    llm_usage: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    questions: list[QuestionRead] = Field(default_factory=list)
    images: list[QuestionImageRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class QuestionGroupListResponse(BaseModel):
    items: list[QuestionGroupRead]
    total: int
    draft_count: int


# --- Exam Schemas ---

class ExamGenerateRequest(BaseModel):
    kokugo_count: int = Field(default=10, ge=0, le=60)
    rika_count: int = Field(default=3, ge=0, le=30)
    shakai_count: int = Field(default=3, ge=0, le=30)
    source_filter: str = ""
    tag_filter: str = ""
    exclude_days: int = Field(default=7, ge=0, le=365)
    prioritize_wrong: bool = True


class ExamSelectionGroup(BaseModel):
    group_id: UUID
    subject: SubjectType
    question_ids: list[UUID]


class ExamCreateRequest(BaseModel):
    title: str
    paper_size: Literal["B4", "A4"] = "B4"
    layout_config: dict[str, Any] = Field(default_factory=dict)
    selections: list[ExamSelectionGroup]


class ExamItemRead(BaseModel):
    id: UUID
    exam_id: UUID
    group_id: UUID
    question_id: UUID
    subject: SubjectType
    section_order: int
    item_order: int
    is_wrong: bool | None = None

    model_config = {"from_attributes": True}


class ExamSummaryRead(BaseModel):
    id: UUID
    title: str
    paper_size: str
    layout_config: dict[str, Any]
    created_at: datetime
    item_count: int = 0
    wrong_count: int = 0
    subjects: list[str] = Field(default_factory=list)
    submission_count: int = 0
    latest_submission_id: UUID | None = None
    latest_submission_status: str | None = None
    latest_correct_count: int | None = None
    latest_total_count: int | None = None


class ExamGroupSectionRead(BaseModel):
    group: QuestionGroupRead
    items: list[dict[str, Any]]  # [{exam_item: ExamItemRead, question: QuestionRead}]


class ExamDetailRead(BaseModel):
    id: UUID
    title: str
    paper_size: str
    layout_config: dict[str, Any]
    created_at: datetime
    sections: dict[str, list[ExamGroupSectionRead]]  # keyed by subject in order kokugo, rika, shakai


class ExamItemGradeRequest(BaseModel):
    is_wrong: bool | None = None


# --- Online Solving & Submission Schemas ---

SubmissionMode = Literal["full", "wrong_only"]
SubmissionStatus = Literal["in_progress", "grading", "graded", "reviewed"]
InputMode = Literal["choice", "handwriting", "text"]
AiGradeStatus = Literal["correct", "wrong", "partial", "uncertain", "no_key", "unanswered"]


class SubmissionCreateRequest(BaseModel):
    mode: SubmissionMode = "full"


class ExamAnswerSaveRequest(BaseModel):
    input_mode: InputMode = "handwriting"
    selected_options: list[str] = Field(default_factory=list)
    typed_text: str = ""
    strokes_data: dict[str, Any] = Field(default_factory=dict)
    image_data_url: str | None = None
    duration_seconds: int | None = Field(default=None, ge=0)


class ExamAnswerRead(BaseModel):
    id: UUID
    submission_id: UUID
    exam_item_id: UUID
    question_id: UUID
    input_mode: InputMode
    selected_options: list[str] = Field(default_factory=list)
    typed_text: str = ""
    strokes_data: dict[str, Any] = Field(default_factory=dict)
    handwriting_image_path: str | None = None
    recognized_text: str | None = None
    stroke_issues: str | None = None
    ai_confidence: float | None = None
    ai_status: AiGradeStatus = "unanswered"
    ai_feedback: str = ""
    final_is_wrong: bool | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExamSubmissionSummaryRead(BaseModel):
    id: UUID
    exam_id: UUID
    attempt_number: int
    mode: SubmissionMode
    status: SubmissionStatus
    started_at: datetime
    submitted_at: datetime | None = None
    duration_seconds: int = 0
    total_count: int = 0
    correct_count: int = 0
    wrong_count: int = 0
    uncertain_count: int = 0
    synced_to_bank: bool = False
    llm_usage: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class SubmissionSubmitRequest(BaseModel):
    duration_seconds: int | None = Field(default=None, ge=0)


class SubmissionRegradeRequest(BaseModel):
    rerun_ocr: bool = False


class ExamAnswerReviewRequest(BaseModel):
    final_is_wrong: bool | None = None


class SubmissionItemBundle(BaseModel):
    exam_item: ExamItemRead
    question: QuestionRead
    answer: ExamAnswerRead


class SubmissionGroupSection(BaseModel):
    group: QuestionGroupRead
    items: list[SubmissionItemBundle]


class ExamSubmissionDetailRead(ExamSubmissionSummaryRead):
    exam_title: str
    sections: dict[str, list[SubmissionGroupSection]]
    all_attempts: list[ExamSubmissionSummaryRead] = Field(default_factory=list)


# --- Answer Key Suggestion / Extraction Schemas ---

class AnswerSuggestionItem(BaseModel):
    question_id: UUID
    question_order: int
    suggested_answer: str
    suggested_aliases: list[str] = Field(default_factory=list)
    suggested_grading_note: str = ""
    confidence: float = 0.0
    reason: str = ""


class AnswerSuggestionResponse(BaseModel):
    group_id: UUID
    source: Literal["ai_suggest", "answer_image"]
    items: list[AnswerSuggestionItem] = Field(default_factory=list)
    call_usage: dict[str, Any] = Field(default_factory=dict)
    group_llm_usage: dict[str, Any] = Field(default_factory=dict)


# --- Settings & Auth Schemas ---

class LLMSettingsRead(BaseModel):
    provider: Literal["gemini", "openai_compatible"] = "gemini"
    gemini_api_key_masked: str = ""
    gemini_has_key: bool = False
    gemini_model: str = "gemini-2.5-flash"
    openai_api_key_masked: str = ""
    openai_has_key: bool = False
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o"


class LLMSettingsUpdate(BaseModel):
    provider: Literal["gemini", "openai_compatible"] = "gemini"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o"


class LoginRequest(BaseModel):
    password: str
