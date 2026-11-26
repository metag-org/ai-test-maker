from typing import Literal
from pydantic import BaseModel, Field


class ExtractedOption(BaseModel):
    label: str = Field(description="選択肢の記号（例: ア, イ, ウ, エ や A, B, C, D）")
    text: str = Field(description="選択肢の本文")


class ExtractedImageBox(BaseModel):
    caption: str = Field(default="", description="図のキャプション（例: 図1, グラフA, 地図）")
    ymin: int = Field(ge=0, le=1000, description="図版の上端 (0-1000正規化座標)")
    xmin: int = Field(ge=0, le=1000, description="図版の左端 (0-1000正規化座標)")
    ymax: int = Field(ge=0, le=1000, description="図版の下端 (0-1000正規化座標)")
    xmax: int = Field(ge=0, le=1000, description="図版の右端 (0-1000正規化座標)")


class ExtractedAnswerBox(BaseModel):
    type: Literal["kanji_grid", "reading_box", "blank_line", "choice_only"] = "blank_line"
    cells: int = Field(default=2, ge=1, le=10, description="漢字マス目の数（kanji_write時）")


class ExtractedQuestion(BaseModel):
    question_type: Literal[
        "kanji_write",
        "kanji_read",
        "kokugo_subjective",
        "single_choice",
        "multi_choice",
        "fill_blank",
        "short_answer",
    ] = "short_answer"
    body: str = Field(description="印刷された設問文のみ。手書きの解答や丸付けは完全に除去すること。")
    options: list[ExtractedOption] = Field(default_factory=list, description="選択肢がある場合はすべて抽出する")
    answer_box_config: ExtractedAnswerBox = Field(default_factory=ExtractedAnswerBox)


class ExtractedGroup(BaseModel):
    lead_text: str = Field(default="", description="大問の共通リード文・実験説明・条件文（単発の漢字問題なら空文字可）")
    tags: list[str] = Field(default_factory=list, description="単元・分野タグ（例: 漢字の書き取り, てこ, 江戸時代）")
    images: list[ExtractedImageBox] = Field(
        default_factory=list,
        description="問題に必要な図表・実験図・地図・グラフの座標（0-1000正規化）。文字だけなら空配列。",
    )
    questions: list[ExtractedQuestion] = Field(default_factory=list)


class ExtractedPageResult(BaseModel):
    image_rotation_cw: Literal[0, 90, 180, 270] = Field(
        default=0,
        description="渡された写真が横向き・上下逆の場合に、印刷文字を正しい向きにするために必要な時計回りの回転角度（正立なら0、左倒しなら90、上下逆なら180、右倒しなら270）。",
    )
    groups: list[ExtractedGroup] = Field(default_factory=list)


# --- Answer Key Suggestion / Extraction from Answer Sheet ---

class LLMAnswerSuggestionItem(BaseModel):
    question_order: int = Field(description="渡された設問リストの1始まりの番号 (1, 2, 3...)")
    suggested_answer: str = Field(default="", description="標準の模範解答（選択問題なら記号のみ 例: ア、複数なら ア, ウ）")
    suggested_aliases: list[str] = Field(
        default_factory=list,
        description="正解とみなせる別解の配列（不要なら空配列）",
    )
    suggested_grading_note: str = Field(
        default="",
        description="採点時の注意点（例: 漢字で書くこと、カタカナ指定、キーワードA・Bを含むこと）",
    )
    confidence: float = Field(default=0.8, ge=0.0, le=1.0, description="確信度 (0.0〜1.0)")
    reason: str = Field(default="", description="短い根拠や補足（30文字以内）")


class LLMAnswerSuggestionResult(BaseModel):
    items: list[LLMAnswerSuggestionItem] = Field(default_factory=list)


# --- Stage 1: Blind OCR (No question context / No answer key) ---

class BlindOcrItem(BaseModel):
    item_index: int = Field(description="画像の赤いラベル番号 (#1 -> 1, #2 -> 2)")
    recognized_text: str = Field(
        default="",
        description="手書きされた文字を視覚そのままに読み取った文字列。空白・未記入なら空文字。",
    )
    confidence: float = Field(default=0.8, ge=0.0, le=1.0, description="読み取りの確信度 (0.0〜1.0)")
    stroke_issues: str = Field(
        default="",
        description="漢字の画数不足・余分な画・誤った部首・判読困難な崩れがある場合のみ日本語で簡潔に記載。問題なければ空文字。",
    )


class BlindOcrResult(BaseModel):
    items: list[BlindOcrItem] = Field(default_factory=list)


# --- Stage 2: Semantic Grading for Subjective / Short Answers ---

class SemanticGradeItem(BaseModel):
    item_index: int = Field(description="渡された採点対象リストの1始まりの番号")
    status: Literal["correct", "partial", "wrong", "uncertain"] = Field(
        description="correct=正解, partial=部分点/惜しい, wrong=不正解, uncertain=保護者確認推奨"
    )
    feedback: str = Field(default="", description="小学生・保護者向けの簡潔な日本語コメント（40文字以内）")


class SemanticGradeResult(BaseModel):
    items: list[SemanticGradeItem] = Field(default_factory=list)
