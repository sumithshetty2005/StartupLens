import os
os.environ["TQDM_DISABLE"] = "1"
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
load_dotenv(override=True)
from src.agents.agent import (
    create_agent_graph, 
    run_agent,
    model_primary_name,
    model_fallback_name
)
from src.rag.retriever import get_failed_startups_info

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/', methods=['GET'])
def health_check():
    return jsonify({"status": "StartupLens Flask API is running"})

@app.route('/analyze', methods=['POST'])
def analyze():
    # Hot-reload environment variables on every request so manual server restarts are unnecessary
    load_dotenv(override=True)
    
    data = request.json
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400
        
    idea = data.get('idea')
    industry = data.get('industry')
    geographic_market = data.get('geographic_market', 'Global')
    custom_api_key = data.get('custom_api_key') 
    extra_context = data.get('extra_context', '')
    
    print(f"\n=== Starting KPI Analysis for: {idea} ({industry}) in market: {geographic_market} ===")
    
    master_prompt = f"""
    Analyze the startup idea: '{idea}' in the '{industry}' industry, targeting the '{geographic_market}' geographic market. {extra_context}
    
    Perform a complete business deep-dive:
    1. Research 3 Competitors (Name, Market Share %, Audience, Strategy) in the target geographic market '{geographic_market}'.
    2. Identify the Whitespace Opportunity.
    3. Calculate Viability Score (0-100).
    4. Define Risk, Roadmap, Business Models (3), Acquisition Channels (3), Target Persona, and SWOT.
    5. Financial Projections (Revenue per user, Min Investment, Break-even, Growth Rate).
       - CALCULATE realistic, unique figures based on the specific market of '{idea}' in '{geographic_market}'. DO NOT repeat the examples below.
       - For Min Investment, provide a breakdown, e.g., '[Value] (Dev, Marketing, Ops)'.
       - For Growth Rate, specify the driver, e.g., '[X]% MoM (via [Channel])'.
       - For Revenue / User, mention the model, e.g., '$[X] / [Period] ([Model])'.
    6. Market Trends (4 Key trends).
    7. Demographics Data (Age group distribution percentages).
    8. Calculate unique, realistic market sizing metrics specifically for the '{geographic_market}' market: TAM (Total Addressable Market), SAM (Serviceable Addressable Market), and SOM (Serviceable Obtainable Market). Include a brief explanation of how these were calculated.
    9. Boardroom Debate: 3 reasons to invest (Bull Agent), 3 reasons NOT to invest (Bear Agent), and a final Verdict by a Judge Agent (verdict title: "Invest" / "Avoid" / "Invest with Conditions", confidence percentage 0-100, and a brief reasoning justification).
    
    Output strictly VALID JSON with this structure. Do NOT include any emojis in any of the response text. IMPORTANT: Ensure all JSON string values are written on a single line and do not contain raw newlines or control characters. If you need a line break, write the literal characters '\\n' inside the string:
    {{
      "research": {{
          "competitors": [ {{ "name": "...", "market_share": 30, "target_audience": "...", "marketing_strategy": "..." }}, ... ],
          "opportunity": "...",
          "market_trends": ["Trend 1...", "Trend 2...", "Trend 3...", "Trend 4..."],
          "market_share_insight": "Brief insight on competitor dominance...",
          "market_sizing": {{
              "tam": "$...",
              "sam": "$...",
              "som": "$...",
              "confidence": 82,
              "explanation": "..."
          }}
      }},
      "strategy": {{
          "viability_score": 85,
          "risk_analysis": "...",
          "roadmap": ["Step 1...", "Step 2...", "Step 3..."],
          "summary": "...",
          "business_models": ["Model: Why...", ...],
          "user_acquisition": ["Channel: How...", ...],
          "target_users": "...",
          "financials": {{
              "revenue_per_user": "$...",
              "min_investment": "$...",
              "break_even": "... months",
              "user_growth_rate": "...%"
          }},
          "demographics": {{
              "age_groups": {{ "18-24": 20, "25-34": 40, "35-44": 25, "45+": 15 }},
              "demographics_insight": "Brief insight on target age group..."
          }},
          "swot": {{ "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] }},
          "investment_debate": {{
              "bull_agent": ["Reason 1...", "Reason 2...", "Reason 3..."],
              "bear_agent": ["Reason 1...", "Reason 2...", "Reason 3..."],
              "judge_verdict": "Invest with Conditions",
              "judge_confidence": 93,
              "judge_reasoning": "Brief reasoning..."
          }}
      }}
    }}
    """
    
    available_keys = []
    if custom_api_key:
        available_keys.extend([k.strip() for k in custom_api_key.split(',') if k.strip()])
    
    # Support multiple keys separated by comma
    env_keys = os.environ.get("GOOGLE_API_KEYS", "") or os.environ.get("GOOGLE_API_KEY", "")
    if env_keys:
        available_keys.extend([k.strip() for k in env_keys.split(',') if k.strip()])
        
    if not available_keys:
        return jsonify({"error": "Missing GOOGLE_API_KEY. Please provide it in .env or as custom_api_key."}), 401
    
    json_response = None
    last_error_msg = None
    
    # Shift through Gemini API keys
    for index, key in enumerate(available_keys):
        print(f"--> Invoking Master Analyst Agent (Primary: {model_primary_name}) [Key {index+1}/{len(available_keys)}]...")
        try:
            agent = create_agent_graph(target_model_name=model_primary_name, target_api_key=key)
            json_response = run_agent(agent, master_prompt)
            print(f"    -> Success on Primary (Gemini Key {index+1}).")
            break # Success, break out of key loop
        except Exception as e:
            last_error_msg = str(e)
            print(f"    -> Error on Primary (Key {index+1}): {last_error_msg}")
            if any(term in last_error_msg.upper() for term in ["QUOTA", "LIMIT", "EXHAUSTED", "INVALID", "UNAVAILABLE", "503", "429", "API KEY"]):
                 print(f"    -> Error on Key {index+1} (temporary or key issue). Shifting to next key if available...")
                 continue # Try next key
            else:
                 # If it's a structural schema/parsing error, fail immediately
                 return jsonify({"error": "Agent Execution Failed", "details": last_error_msg}), 500
                 
    # If all Gemini keys failed due to exhaustion or invalidity, trigger fallback
    if not json_response and last_error_msg and any(term in last_error_msg.upper() for term in ["QUOTA", "LIMIT", "EXHAUSTED", "INVALID", "UNAVAILABLE", "503", "429", "API KEY"]):
         print("    -> All Gemini keys exhausted or unavailable! Falling back to Secondary (Groq: llama-3.1-8b-instant)...")
         groq_api_key = os.environ.get("GROQ_API_KEY")
         if not groq_api_key:
             print("    -> Missing GROQ_API_KEY for fallback.")
             return jsonify({"error": "API_QUOTA_EXHAUSTED"}), 429
             
         try:
             from langchain_groq import ChatGroq
             llm = ChatGroq(temperature=0.2, model_name="llama-3.1-8b-instant", groq_api_key=groq_api_key)
             response = llm.invoke(master_prompt)
             json_response = response.content
             print("    -> Success on Secondary (Groq).")
         except Exception as fallback_e:
             fallback_error = str(fallback_e)
             print(f"    -> Error on Secondary: {fallback_error}")
             return jsonify({"error": "Agent Execution Failed", "details": fallback_error}), 500
    elif not json_response:
         return jsonify({"error": "Agent Execution Failed", "details": last_error_msg}), 500

    
    import json
    import re
    
    research_data = {}
    strategy_data = {}
    
    try:
        if not json_response:
             raise ValueError("Empty response from agent")

        # 1. Try to sanitize markdown
        clean_response = json_response.strip()
        if clean_response.startswith('```json'):
            clean_response = clean_response[7:]
        if clean_response.startswith('```'):
            clean_response = clean_response[3:]
        if clean_response.endswith('```'):
            clean_response = clean_response[:-3]
        clean_response = clean_response.strip()

        # 2. Extract substring between first { and last }
        start_idx = clean_response.find('{')
        end_idx = clean_response.rfind('}')
        
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            extracted_json = clean_response[start_idx:end_idx+1]
            
            # Aggressive sanitization of raw control characters (like newlines inside strings)
            # which break standard JSON parsers.
            sanitized = re.sub(r'[\x00-\x1f\x7f]', ' ', extracted_json)
            # Remove trailing commas in objects and arrays
            sanitized = re.sub(r',\s*}', '}', sanitized)
            sanitized = re.sub(r',\s*]', ']', sanitized)
            
            try:
                full_data = json.loads(sanitized)
                research_data = full_data.get('research', {})
                strategy_data = full_data.get('strategy', {})
            except Exception as e:
                # If still failing, try loading the raw extracted_json as fallback
                print(f"Sanitized JSON load failed: {e}. Trying raw extracted JSON...")
                full_data = json.loads(extracted_json)
                research_data = full_data.get('research', {})
                strategy_data = full_data.get('strategy', {})
        else:
            raise ValueError("No valid JSON found in response")
            
    except Exception as e:
        print(f"JSON Parsing Failed: {e}")
        research_data = {
            "competitors": [], 
            "opportunity": "Analysis generated invalid format.",
            "market_trends": [],
            "market_share_insight": "Data unavailable.",
            "market_sizing": {
                "tam": "N/A",
                "sam": "N/A",
                "som": "N/A",
                "explanation": "Market sizing data is currently unavailable."
            }
        }
        strategy_data = {
            "viability_score": 0, 
            "summary": "Error parsing results.",
            "financials": {},
            "demographics": {"age_groups": {}, "demographics_insight": "Data unavailable."}
        }

    print("\n=== KPI Analysis Complete ===")
    
    return jsonify({
        "idea": idea,
        "industry": industry,
        "research": research_data,
        "strategy": strategy_data
    })

@app.route('/api/failed-startups', methods=['POST'])
def failed_startups():
    data = request.json
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400
        
    query = data.get('query')
    custom_api_key = data.get('custom_api_key')
    
    if not query:
        return jsonify({"error": "No 'query' provided in payload"}), 400
        
    groq_api_key = custom_api_key or os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        print("Missing GROQ_API_KEY")
        return jsonify({"error": "Missing GROQ_API_KEY. Please provide it in .env or as custom_api_key."}), 401
    
    try:
        query_safe = query.encode('ascii', 'ignore').decode('ascii')
        print(f"\n=== Starting Failed Startups RAG Analysis for: {query_safe[:50]}... ===")
        result = get_failed_startups_info(query, groq_api_key)
        print("    -> RAG Analysis Complete.")
        return jsonify(result)
    except Exception as e:
        import traceback
        with open("traceback_error.log", "w") as f:
            traceback.print_exc(file=f)
        print(f"Error in /api/failed-startups: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 7860))
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=True)