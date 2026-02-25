from pydantic import BaseModel, Field

class TrainingSession(BaseModel):
    date: str = Field(description="Date of the training session in YYYY-MM-DD format.")
    title: str = Field(description="Title of the training or 'Rest Day'.")
    details: str = Field(description="Detailed menu of the training, or explanation for rest.")

class WeeklyPlan(BaseModel):
    report_markdown: str = Field(
        description="Markdown text containing the weekly summary (total distance, time, elevation), "
                    "data-driven intensity analysis based on AeT(149 bpm) and LT(161 bpm), and "
                    "advice for next week incorporating 'The Antifragile Engine' and 'Earth Explorer' concepts."
    )
    training_plan: list[TrainingSession] = Field(
        description="7-day training plan for the next week, including running, strength training, and rest days."
    )
