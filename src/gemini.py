import os
import json
import logging
from google import genai
from google.genai import types
from src.models import WeeklyPlan

def generate_report_and_plan(activities: list) -> WeeklyPlan:
    """Use Gemini API to analyze data and create a report/plan."""
    api_key = os.environ.get("GEMINI_API_KEY")
    logging.info("Initializing Gemini client...")
    client = genai.Client(api_key=api_key)
    
    activities_summary = []
    for a in activities:
        summary = {
            "date": str(a.get('startTimeLocal', ''))[:10],
            "type": a.get('activityType', {}).get('typeKey'),
            "distance_m": a.get('distance'),
            "duration_s": a.get('duration'),
            "elevation_gain_m": a.get('elevationGain'),
            "avg_hr": a.get('averageHR'),
            "max_hr": a.get('maxHR')
        }
        activities_summary.append(summary)
        
    prompt = f"""
    Analyze the following recent running activity data and generate a weekly report and a training plan for the next 7 days.
    
    Data:
    {json.dumps(activities_summary, indent=2)}
    
    Requirements for `report_markdown`:
    - Weekly summary (total distance, total time, total elevation gain).
    - Data-driven intensity analysis using Aerobic Threshold (AeT: 149 bpm) and Lactate Threshold (LT: 161 bpm).
    - Advice for next week incorporating the concepts of "The Antifragile Engine" (pursuit of durability and toughness) and "Earth Explorer".
    
    Requirements for `training_plan`:
    - 7-day schedule for next week.
    - Include running, strength training, and appropriate rest days.
    - Fields needed: date (YYYY-MM-DD), title, details.
    """
    
    logging.info("Calling Gemini API...")
    response = client.models.generate_content(
        model='gemini-2.5-pro',
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=WeeklyPlan,
        ),
    )
    
    logging.info("Received response from Gemini.")
    return WeeklyPlan.model_validate_json(response.text)
