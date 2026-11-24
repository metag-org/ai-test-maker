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
    groups: list[ExtractedGroup] = Field(default_factory=list)
