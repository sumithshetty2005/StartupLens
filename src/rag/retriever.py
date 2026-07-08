import os
import math
import time
import json
import re
import hashlib
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from pydantic import BaseModel, Field
from duckduckgo_search import DDGS

from src.rag.config import (
    QDRANT_DIR,
    GENERATOR_MODEL_NAME,
    TOP_K_RETRIEVE,
    TOP_K_RERANK,
    CONFIDENCE_THRESHOLD
)
from src.rag.embeddings import get_embeddings
from src.rag.reranker import CrossEncoderReranker

# In-memory query cache
QUERY_CACHE = {}

# Load environment variables
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

try:
    embeddings_model = get_embeddings()
except Exception as e:
    print(f"Error initializing embeddings model: {e}")
    embeddings_model = None

# Global reranker instance to avoid re-instantiating on every request
try:
    global_reranker = CrossEncoderReranker()
except Exception as e:
    print(f"Error initializing CrossEncoderReranker: {e}")
    global_reranker = None

class FailedStartupInfo(BaseModel):
    name: str = Field(description="Name of the startup")
    sector: str = Field(description="The sector or industry it belonged to")
    product_type: str = Field(description="What they did or their product/service")
    cash_burned: str = Field(description="Total cash burned or how much they raised before failing")
    years_of_operation: str = Field(description="Years of operation (format: start_year - end_year)")
    failure_analysis: str = Field(description="Why they failed, main reasons for shutting down")
    learnings: str = Field(description="Startup learnings or key takeaways from their failure")

class FailedStartupResponse(BaseModel):
    startups: list[FailedStartupInfo] = Field(description="List of maximum 3 relevant failed startups from the context")
    summary: str = Field(description="A brief summary of why startups in this space typically fail")

class QueryVariations(BaseModel):
    variations: list[str] = Field(description="Exactly 3 semantic search variations of the original query.")

def robust_parse_json(text: str) -> dict:
    """
    Robustly extract and parse the last JSON object from the text.
    This prevents schema replication or formatting prefixes from breaking JSON parsing.
    """
    text = text.strip()
    # Find all JSON-like blocks between { and }
    matches = list(re.finditer(r'\{', text))
    if not matches:
        return {}
    
    # Try finding the largest outermost JSON block first
    first_brace = text.find('{')
    last_brace = text.rfind('}')
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidate = text[first_brace:last_brace+1]
        try:
            parsed = json.loads(candidate)
            # If it's just the schema metadata, keep looking
            if "$defs" not in parsed and "properties" in parsed and "startups" in parsed:
                # Schema block, skip
                pass
            else:
                return parsed
        except Exception:
            pass

    # Fallback: find all matching brace groups and try to parse them from the end
    # (since the actual response is usually the last JSON block outputted)
    brace_count = 0
    start_idx = -1
    for i, char in enumerate(text):
        if char == '{':
            if brace_count == 0:
                start_idx = i
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0 and start_idx != -1:
                candidate = text[start_idx:i+1]
                try:
                    parsed = json.loads(candidate)
                    if "$defs" not in parsed:
                        return parsed
                except Exception:
                    pass
                start_idx = -1
                
    # Final fallback: raw json loads
    try:
        return json.loads(text)
    except Exception:
        return {}

# Simple BM25 Implementation
class SimpleBM25:
    def __init__(self, corpus_docs: list, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs = corpus_docs
        self.doc_texts = []
        
        for doc in corpus_docs:
            meta = doc.metadata
            text = f"{meta.get('name', '')} {meta.get('sector', '')} {meta.get('what_they_did', '')} {meta.get('failure_analysis', '')} {meta.get('learnings', '')} {doc.page_content}"
            self.doc_texts.append(text.lower())
            
        self.doc_len = [len(t.split()) for t in self.doc_texts]
        self.avg_doc_len = sum(self.doc_len) / len(self.doc_len) if self.doc_len else 1.0
        self.doc_count = len(self.doc_texts)
        
        self.dfs = {}
        self.tfs = []
        for text in self.doc_texts:
            words = text.split()
            tf = {}
            for w in words:
                tf[w] = tf.get(w, 0) + 1
            self.tfs.append(tf)
            for w in set(words):
                self.dfs[w] = self.dfs.get(w, 0) + 1
                
        self.idfs = {}
        for w, df in self.dfs.items():
            self.idfs[w] = math.log((self.doc_count - df + 0.5) / (df + 0.5) + 1.0)
            
    def score(self, query: str) -> list[tuple[float, int]]:
        query_words = query.lower().split()
        scored_indices = []
        for idx, tf in enumerate(self.tfs):
            doc_score = 0.0
            d_len = self.doc_len[idx]
            for w in query_words:
                if w in tf:
                    w_tf = tf[w]
                    idf = self.idfs.get(w, 0)
                    denom = w_tf + self.k1 * (1 - self.b + self.b * (d_len / self.avg_doc_len))
                    doc_score += idf * (w_tf * (self.k1 + 1)) / denom
            scored_indices.append((doc_score, idx))
        return sorted(scored_indices, key=lambda x: x[0], reverse=True)

_bm25_instance = None
_all_documents = []

def get_bm25_index():
    global _bm25_instance, _all_documents
    if _bm25_instance is None:
        try:
            from src.rag.ingestion import load_documents_from_csvs
            docs = load_documents_from_csvs()
            _all_documents = docs
            _bm25_instance = SimpleBM25(docs)
        except Exception as e:
            print(f"Error initializing BM25 from CSV: {e}")
    return _bm25_instance, _all_documents

def understand_query(query: str, groq_key: str) -> dict:
    # Check cache first
    query_clean = query.strip().lower()
    query_hash = hashlib.md5(query_clean.encode('utf-8')).hexdigest()
    if query_hash in QUERY_CACHE:
        print(f"--> [Cache Hit] Query understanding found in cache for query: '{query[:50]}...'")
        return QUERY_CACHE[query_hash]
        
    print(f"--> [Cache Miss] Extracting structured query metadata for: '{query[:50]}...'")
    llm = ChatGroq(temperature=0.0, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_key)
    
    prompt = PromptTemplate(
        template="You are an expert business analyst. Analyze this startup idea query and extract query metadata.\n"
                 "Return strictly valid JSON matching this exact structure, with no markdown code fences or other wrapper text:\n"
                 "{{\n"
                 '  "industry": "e.g. Agritech, EdTech, Fintech, BioTech, E-commerce, etc.",\n'
                 '  "business_model": "e.g. B2B SaaS, B2C Subscription, Marketplace, Hardware, Drone-as-a-Service, etc.",\n'
                 '  "core_product": "A brief description of what the core product or service is.",\n'
                 '  "keywords": ["keyphrase1", "keyphrase2", "keyphrase3", "keyphrase4"],\n'
                 '  "synonyms": ["synonym1", "synonym2", "synonym3"],\n'
                 '  "canonical_concept": "A very short, simplified canonical concept phrase (3-6 words) representing the idea."\n'
                 "}}\n\n"
                 "Query: {query}\n\n"
                 "JSON Output:",
        input_variables=["query"]
    )
    
    chain = prompt | llm
    try:
        res = chain.invoke({"query": query})
        parsed = robust_parse_json(res.content)
        required_keys = ["industry", "business_model", "core_product", "keywords", "synonyms", "canonical_concept"]
        for k in required_keys:
            if k not in parsed:
                parsed[k] = "" if k not in ["keywords", "synonyms"] else []
        if not parsed.get("canonical_concept"):
            parsed["canonical_concept"] = " ".join(query.split()[:4])
        QUERY_CACHE[query_hash] = parsed
        return parsed
    except Exception as e:
        print(f"Query understanding failed: {e}")
        fallback = {
            "industry": "Unknown",
            "business_model": "Unknown",
            "core_product": query[:100],
            "keywords": query.split()[:4],
            "synonyms": [],
            "canonical_concept": " ".join(query.split()[:4])
        }
        QUERY_CACHE[query_hash] = fallback
        return fallback

def get_query_expansion(query: str, metadata: dict, groq_key: str) -> list[str]:
    # Check cache first
    query_clean = query.strip().lower()
    query_hash = hashlib.md5(f"expansion_{query_clean}".encode('utf-8')).hexdigest()
    if query_hash in QUERY_CACHE:
        return QUERY_CACHE[query_hash]
        
    llm = ChatGroq(temperature=0.1, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_key)
    
    prompt = PromptTemplate(
        template="You are a search query engineering assistant. Given a startup idea and its analyzed metadata, "
                 "generate exactly 4 diverse, high-quality search variations to maximize retrieval recall in our database:\n"
                 "1. A semantic variation (the same core concept rephrased differently)\n"
                 "2. A keyword variation (concise, packed with core business and technical keywords)\n"
                 "3. A synonym variation (substituting industry/domain words with synonyms)\n"
                 "4. A concise canonical variation (highly simplified representation, 3-5 words)\n\n"
                 "Original Query: {query}\n"
                 "Metadata:\n"
                 "- Industry: {industry}\n"
                 "- Business Model: {business_model}\n"
                 "- Keywords: {keywords}\n"
                 "- Synonyms: {synonyms}\n"
                 "- Canonical Concept: {canonical}\n\n"
                 "Return ONLY a JSON object matching this exact structure with no other text:\n"
                 '{{\n'
                 '  "semantic": "...",\n'
                 '  "keyword": "...",\n'
                 '  "synonym": "...",\n'
                 '  "canonical": "..."\n'
                 '}}\n',
        input_variables=["query", "industry", "business_model", "keywords", "synonyms", "canonical"]
    )
    
    chain = prompt | llm
    try:
        res = chain.invoke({
            "query": query,
            "industry": metadata.get("industry", ""),
            "business_model": metadata.get("business_model", ""),
            "keywords": ", ".join(metadata.get("keywords", [])),
            "synonyms": ", ".join(metadata.get("synonyms", [])),
            "canonical": metadata.get("canonical_concept", "")
        })
        parsed = robust_parse_json(res.content)
        variations = []
        for key in ["semantic", "keyword", "synonym", "canonical"]:
            val = parsed.get(key, "").strip()
            if val:
                variations.append(val)
        unique_vars = list(set([query] + variations))
        QUERY_CACHE[query_hash] = unique_vars
        return unique_vars
    except Exception as e:
        print(f"Query expansion failed: {e}")
        canonical = metadata.get("canonical_concept", "")
        keywords = metadata.get("keywords", [])
        fallback = [query]
        if canonical:
            fallback.append(canonical)
        if keywords:
            fallback.append(" ".join(keywords[:3]))
        unique_vars = list(set(fallback))
        QUERY_CACHE[query_hash] = unique_vars
        return unique_vars

def rewrite_query(query: str, groq_key: str) -> list[str]:
    metadata = understand_query(query, groq_key)
    return get_query_expansion(query, metadata, groq_key)

def web_fallback_search(query: str, groq_key: str, metadata: dict = None, local_matches: list = None) -> dict:
    if metadata is None:
        metadata = understand_query(query, groq_key)
    if local_matches is None:
        local_matches = []
        
    print(f"Executing Smart Web Fallback Search for query: '{query[:50]}...'")
    
    google_keys = os.environ.get("GOOGLE_API_KEYS", "") or os.environ.get("GOOGLE_API_KEY", "")
    available_keys = []
    if google_keys:
        available_keys = [k.strip() for k in google_keys.split(',') if k.strip()]
        
    local_ref_str = "\n".join([
        f"- {s.get('name')} ({s.get('sector')}): {s.get('product_type')} - failed due to: {s.get('failure_analysis')}"
        for s in local_matches[:3]
    ]) if local_matches else "None"
    
    for index, key in enumerate(available_keys):
        try:
            print(f"Attempting Smart Web Grounding [Key {index+1}/{len(available_keys)}]...")
            from google import genai
            from google.genai import types
            
            client = genai.Client(api_key=key)
            
            prompt = f"""
            You are an expert startup post-mortem analyst operating in fallback mode.
            The user is building a startup with the following context:
            - Original Query: {query}
            - Industry: {metadata.get('industry', 'Unknown')}
            - Business Model: {metadata.get('business_model', 'Unknown')}
            - Canonical Concept: {metadata.get('canonical_concept', 'Unknown')}
            - Keywords: {', '.join(metadata.get('keywords', []))}
            
            We found these top local database references (which may have low similarity but are contextual):
            {local_ref_str}
            
            Use Google Search to identify and describe up to 3 real failed startups in this space.
            
            CRITICAL RULES:
            1. Only list real startups that actually existed and failed. Do NOT make up names, invent placeholders like "None found", or invent stories.
            2. If you cannot find failures for the exact specific niche, you MUST search for and list failed startups in the broader sector or related industries (e.g., agricultural automation, agritech, commercial drones, or hardware robotics failures).
            3. Cite your sources in the 'summary' field using markdown links pointing directly to the source URLs from the search results.
            4. Make sure every single startup returned has a valid name, sector, and failure analysis. Do NOT return dummy values.
            
            Format: You must output ONLY a JSON object matching this structure:
            {{
              "startups": [
                {{
                  "name": "Startup Name",
                  "sector": "Sector/Industry",
                  "product_type": "What they did",
                  "cash_burned": "Estimated cash burned/raised",
                  "years_of_operation": "Years active (e.g. 2018-2021)",
                  "failure_analysis": "Why they failed",
                  "learnings": "Key takeaway/learning",
                  "source": "Full URL link to the search result article or reference about this startup failure"
                }}
              ],
              "summary": "Detailed summary citing sources with URL markdown links"
            }}
            """
            
            config = types.GenerateContentConfig(
                temperature=0.2,
                tools=[{"google_search": {}}],
            )
            
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=config
            )
            
            if response.text:
                parsed = robust_parse_json(response.text)
                if parsed and parsed.get("startups") and parsed.get("startups")[0].get("name") != "None found":
                    print("--> Successfully retrieved failed startups using Smart Web Grounding!")
                    return parsed
        except Exception as gemini_e:
            print(f"Gemini smart fallback search failed on Key {index+1}: {gemini_e}")
            
    # Fallback to DuckDuckGo search + Groq
    print("Attempting DuckDuckGo search + Groq fallback...")
    search_results = []
    try:
        with DDGS() as ddgs:
            words = query.split()
            industry = words[0] if words else "tech"
            ddg_query = f"failed {industry} startups post-mortem"
            print(f"Searching DuckDuckGo for: '{ddg_query}'")
            res = list(ddgs.text(ddg_query, max_results=5))
            if not res:
                simplified_query = " ".join(words[:4])
                print(f"DDG returned empty, trying general query: 'failed startup {simplified_query}'")
                res = list(ddgs.text(f"failed startup {simplified_query}", max_results=5))
            for r in res:
                search_results.append({
                    "title": r.get("title", ""),
                    "snippet": r.get("body", ""),
                    "href": r.get("href", "")
                })
    except Exception as e:
        print(f"DuckDuckGo search failed: {e}")

    llm = ChatGroq(temperature=0, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_key)
    
    context_str = "\n\n".join([
        f"Title: {item['title']}\nSnippet: {item['snippet']}\nSource: {item['href']}"
        for item in search_results
    ]) if search_results else "No online search results found."

    prompt = PromptTemplate(
        template="You are an expert startup post-mortem analyst operating in fallback mode.\n"
                 "The user query '{query}' did not match any historical startup records in our database.\n"
                 "Using the online search results below, identify up to 3 relevant failed startups in this space and summarize why startups in this niche fail.\n\n"
                 "CRITICAL RULES:\n"
                 "1. Only use facts present in the 'Search Results' below.\n"
                 "2. Cite your sources in the 'summary' field using markdown links pointing directly to the URLs from the search results.\n"
                 "3. If search results are empty or lack startup details, state clearly that no details were found.\n\n"
                 "Search Results:\n{context}\n\n"
                 "Format: You must output ONLY a JSON object matching this structure:\n"
                 '{{\n'
                 '  "startups": [\n'
                 '    {{"name": "...", "sector": "...", "product_type": "...", "cash_burned": "...", "years_of_operation": "...", "failure_analysis": "...", "learnings": "..."}}\n'
                 '  ],\n'
                 '  "summary": "..."\n'
                 '}}',
        input_variables=["query", "context"]
    )
    
    chain = prompt | llm
    try:
        res = chain.invoke({"query": query, "context": context_str})
        return robust_parse_json(res.content)
    except Exception as e:
        return {
            "startups": [],
            "summary": f"Low retrieval confidence and web fallback search failed. Error: {str(e)}"
        }

def generate_similarity_explanations(query: str, startups: list, groq_key: str) -> list:
    if not startups:
        return []
    llm = ChatGroq(temperature=0.0, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_key)
    prompt = PromptTemplate(
        template="Compare the user's startup idea against the following failed startups. "
                 "For each startup, calculate a similarity percentage (0-100) based on domain/product match, "
                 "and list specific matched features/strengths (marked with checkmark ✓) and different features/risks (marked with crossmark ✗).\n\n"
                 "User Startup Idea: {query}\n\n"
                 "Failed Startups:\n{startups_data}\n\n"
                 "Return strictly valid JSON matching this exact structure with no other text:\n"
                 "{{\n"
                 '  "explanations": [\n'
                 '    {{\n'
                 '      "name": "Startup Name",\n'
                 '      "similarity_percentage": 85,\n'
                 '      "matched_features": ["✓ Feature/Domain 1", "✓ Feature/Domain 2"],\n'
                 '      "different_features": ["✗ Feature/Domain 1", "✗ Feature/Domain 2"]\n'
                 '    }}\n'
                 '  ]\n'
                 "}}\n",
        input_variables=["query", "startups_data"]
    )
    
    startups_data = "\n---\n".join([
        f"Name: {s.get('name')}\nSector: {s.get('sector')}\nWhat They Did: {s.get('product_type', s.get('what_they_did', ''))}\nWhy They Failed: {s.get('failure_analysis', s.get('why_they_failed', ''))}"
        for s in startups
    ])
    
    chain = prompt | llm
    try:
        res = chain.invoke({"query": query, "startups_data": startups_data})
        parsed = robust_parse_json(res.content)
        return parsed.get("explanations", [])
    except Exception as e:
        print(f"Failed to generate similarity explanations: {e}")
        return []

def extract_failure_clusters(startups: list, groq_key: str) -> dict:
    if not startups:
        return {"clusters": {"Funding": 30, "PMF": 30, "Competition": 20, "Scaling": 10, "Regulation": 10}, "summary": "No data available."}
    llm = ChatGroq(temperature=0.0, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_key)
    prompt = PromptTemplate(
        template="Analyze the failure reasons for the following failed startups. "
                 "Categorize/cluster their reasons into exactly these 6 buckets, assigning a percentage value to each based on prevalence. "
                 "The percentages MUST sum up to exactly 100.\n"
                 "Buckets: 'Funding', 'PMF', 'Competition', 'Scaling', 'Regulation', 'Execution'\n\n"
                 "Failed Startups:\n{startups_data}\n\n"
                 "Return strictly valid JSON matching this exact structure with no other text:\n"
                 "{{\n"
                 '  "clusters": {{\n'
                 '    "Funding": 35,\n'
                 '    "PMF": 25,\n'
                 '    "Competition": 20,\n'
                 '    "Scaling": 10,\n'
                 '    "Regulation": 5,\n'
                 '    "Execution": 5\n'
                 '  }},\n'
                 '  "summary": "Brief 1-2 sentence explanation of the dominant failure patterns, e.g. \'The most common failure pattern among similar startups is poor product-market fit (35%), followed by funding issues (25%).\'"\n'
                 "}}\n",
        input_variables=["startups_data"]
    )
    
    startups_data = "\n---\n".join([
        f"Name: {s.get('name')}\nWhy They Failed: {s.get('failure_analysis', s.get('why_they_failed', ''))}"
        for s in startups
    ])
    
    chain = prompt | llm
    try:
        res = chain.invoke({"startups_data": startups_data})
        parsed = robust_parse_json(res.content)
        # Ensure sum is exactly 100
        clusters = parsed.get("clusters", {})
        total = sum(clusters.values())
        if total != 100 and total > 0:
            for k in clusters.keys():
                clusters[k] = round((clusters[k] / total) * 100)
            # Recheck and adjust rounding error
            diff = 100 - sum(clusters.values())
            if diff != 0 and clusters:
                first_key = list(clusters.keys())[0]
                clusters[first_key] += diff
        return parsed
    except Exception as e:
        print(f"Failed to extract failure clusters: {e}")
        return {
            "clusters": {"Funding": 40, "PMF": 30, "Competition": 15, "Scaling": 10, "Regulation": 5},
            "summary": "Typical failure patterns are dominated by Funding/Cash issues and Product-Market Fit constraints."
        }

def get_failed_startups_info(query: str, groq_api_key: str):
    start_time = time.time()
    local_client = None
    local_vectorstore = None
    try:
        groq_api_key = groq_api_key.strip() if groq_api_key else ""
        if not groq_api_key:
            return {"startups": [], "summary": "API Key is required to run RAG pipeline."}

        try:
            local_client = QdrantClient(path=QDRANT_DIR)
            local_vectorstore = QdrantVectorStore(
                client=local_client,
                collection_name="failed_startups",
                embeddings=embeddings_model
            )
        except Exception as e:
            print(f"--> [Qdrant Error] Failed to initialize Qdrant local client inside query: {e}")

        # 1. Query Understanding
        metadata = understand_query(query, groq_api_key)
        canonical_concept = metadata.get("canonical_concept", query)
        
        # 2. Query Expansion (using Canonical Concept as base)
        variations = get_query_expansion(query, metadata, groq_api_key)
        all_queries = list(set([query, canonical_concept] + variations))
        print(f"Generated query variations for retrieval: {all_queries}")

        bm25, all_docs = get_bm25_index()

        # 3. Parallel Retrieval: Vector Search (Top 30) + BM25 Search (Top 30)
        def run_vector_search():
            results = {}
            if not local_vectorstore:
                print("--> [Qdrant Error] local_vectorstore is None inside search!")
                return results
            for q in all_queries:
                try:
                    res = local_vectorstore.similarity_search_with_relevance_scores(q, k=30)
                    for doc, score in res:
                        name = doc.metadata.get('name', '').strip().lower()
                        if name not in results or results[name][0] < score:
                            results[name] = (score, doc)
                except Exception as e:
                    print(f"Vector search failed: {e}")
            return results

        def run_bm25_search():
            results = {}
            if not bm25:
                return results
            for q in all_queries:
                try:
                    res = bm25.score(q)
                    for score, idx in res:
                        doc = all_docs[idx]
                        name = doc.metadata.get('name', '').strip().lower()
                        if name not in results or results[name][0] < score:
                            results[name] = (score, doc)
                except Exception as e:
                    print(f"BM25 search failed: {e}")
            return results

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_vector = executor.submit(run_vector_search)
            future_bm25 = executor.submit(run_bm25_search)
            vector_candidates = future_vector.result()
            bm25_candidates = future_bm25.result()

        # 4. Metadata-based Boosting & Deduplication
        all_candidate_names = set(vector_candidates.keys()) | set(bm25_candidates.keys())
        combined_candidates = []

        # Find min/max for BM25 scores to do Min-Max Normalization
        bm25_scores = [bm25_candidates[n][0] for n in all_candidate_names if n in bm25_candidates]
        max_bm25 = max(bm25_scores) if bm25_scores else 0.0
        min_bm25 = min(bm25_scores) if bm25_scores else 0.0

        for name in all_candidate_names:
            v_score, doc_v = vector_candidates.get(name, (0.0, None))
            b_score, doc_b = bm25_candidates.get(name, (0.0, None))
            doc = doc_v if doc_v else doc_b
            if not doc:
                continue

            # Normalize BM25 via Min-Max
            norm_b = (b_score - min_bm25) / (max_bm25 - min_bm25) if max_bm25 > min_bm25 else (1.0 if max_bm25 > 0 else 0.0)
            norm_v = max(0.0, min(1.0, v_score))

            # Metadata Boosting
            doc_sector = doc.metadata.get('sector', '').lower()
            doc_desc = doc.metadata.get('what_they_did', doc.page_content).lower()
            boost = 0.0
            
            ext_ind = metadata.get('industry', '').lower()
            ext_bm = metadata.get('business_model', '').lower()
            
            if ext_ind and (ext_ind in doc_sector or ext_ind in doc_desc):
                boost += 0.05
            if ext_bm and ext_bm in doc_desc:
                boost += 0.05
            
            boosted_v = min(1.0, norm_v + boost)
            boosted_b = min(1.0, norm_b + boost)

            combined_candidates.append({
                "name": name,
                "doc": doc,
                "raw_vector": v_score,
                "raw_bm25": b_score,
                "norm_vector": boosted_v,
                "norm_bm25": boosted_b
            })

        # Sort by average score to select top 15 candidates for CrossEncoder Reranking
        for c in combined_candidates:
            c["initial_rank_score"] = 0.5 * c["norm_vector"] + 0.5 * c["norm_bm25"]
            
        top_15_candidates = sorted(combined_candidates, key=lambda x: x["initial_rank_score"], reverse=True)[:15]
        top_15_docs = [c["doc"] for c in top_15_candidates]
        print(f"Hybrid retrieval and boosting selected {len(top_15_docs)} candidate documents for reranking.")

        # 5. Cross-Encoder Reranking on Top 15 candidates using global_reranker
        rerank_scores_map = {}
        if global_reranker:
            reranked_results = global_reranker.rerank(canonical_concept, top_15_docs, top_k=TOP_K_RERANK)
            for score, doc in reranked_results:
                rerank_scores_map[doc.metadata.get('name', '').strip().lower()] = score
        
        # 6. Hybrid Score Calculation & Level Decision
        final_startups = []
        for idx, doc in enumerate(top_15_docs):
            name_clean = doc.metadata.get('name', '').strip().lower()
            cross_score = rerank_scores_map.get(name_clean, 0.0)
            
            candidate_item = next(c for c in top_15_candidates if c["name"] == name_clean)
            
            hybrid_score = (
                0.30 * candidate_item["norm_vector"] +
                0.20 * candidate_item["norm_bm25"] +
                0.50 * cross_score
            )
            
            final_startups.append({
                "name": doc.metadata.get('name', 'N/A'),
                "sector": doc.metadata.get('sector', 'N/A'),
                "years_of_operation": doc.metadata.get('years_of_operation', 'N/A'),
                "product_type": doc.metadata.get('what_they_did', doc.metadata.get('product_type', 'N/A')),
                "cash_burned": doc.metadata.get('cash_burned', 'N/A'),
                "failure_analysis": doc.metadata.get('failure_analysis', 'N/A'),
                "learnings": doc.metadata.get('learnings', 'N/A'),
                "vector_score": float(candidate_item["raw_vector"]),
                "bm25_score": float(candidate_item["raw_bm25"]),
                "crossencoder_score": float(cross_score),
                "hybrid_score": float(hybrid_score),
                "doc": doc
            })

        # Sort final list by hybrid score
        final_startups = sorted(final_startups, key=lambda x: x["hybrid_score"], reverse=True)
        top_hybrid_score = final_startups[0]["hybrid_score"] if final_startups else 0.0
        print(f"Top Hybrid Confidence Score: {top_hybrid_score:.4f}")

        # Determine Confidence Level
        confidence_level = "Low"
        if top_hybrid_score >= 0.70:
            confidence_level = "High"
        elif top_hybrid_score >= 0.40:
            confidence_level = "Medium"
        print(f"Determined Confidence Level: {confidence_level}")

        fallback_reason = "None"
        is_fallback = False
        output_startups = []
        summary = ""

        # Fetch local candidates for formatting
        local_candidates = final_startups[:TOP_K_RERANK]
        local_docs_formatted = []
        for l in local_candidates:
            matched_source = l["doc"].metadata.get("source", "Startup Failures.csv")
            source_display = matched_source.replace(".csv", "")
            local_docs_formatted.append({
                "name": l["name"],
                "sector": l["sector"],
                "years_of_operation": l["years_of_operation"],
                "product_type": l["product_type"],
                "cash_burned": l["cash_burned"],
                "failure_analysis": l["failure_analysis"],
                "learnings": l["learnings"],
                "source": f"{source_display} (Tabular Dataset)",
                "hybrid_score": l["hybrid_score"]
            })

        if confidence_level == "High":
            output_startups = local_docs_formatted[:3]
            is_fallback = False
            
            context_str = "\n---\n".join([
                f"- Name: {s['name']}\n- Why They Failed: {s['failure_analysis']}" for s in output_startups
            ])
            llm = ChatGroq(temperature=0, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_api_key)
            prompt = PromptTemplate(
                template="Summarize typical failure reasons for a startup in the '{query}' space based strictly on these local examples:\n{context}\nOutput summary in 2 sentences:",
                input_variables=["query", "context"]
            )
            summary = (prompt | llm).invoke({"query": query, "context": context_str}).content.strip()

        elif confidence_level == "Medium":
            fallback_reason = "Score is Medium (0.40 - 0.69). Enriched with Web sources."
            is_fallback = True
            web_data = web_fallback_search(query, groq_api_key, metadata, local_docs_formatted)
            web_startups = web_data.get("startups", [])
            for ws in web_startups:
                ws["source"] = ws.get("source", "Web Grounding")
                ws["hybrid_score"] = 0.50
            
            output_startups = local_docs_formatted[:2] + web_startups[:1]
            summary = web_data.get("summary", "Analysis enriched with live web sources.")

        else:
            fallback_reason = "Score is Low (< 0.40). Enriched with Web sources."
            is_fallback = True
            web_data = web_fallback_search(query, groq_api_key, metadata, local_docs_formatted)
            web_startups = web_data.get("startups", [])
            for ws in web_startups:
                ws["source"] = ws.get("source", "Web Grounding")
                ws["hybrid_score"] = 0.20
            output_startups = local_docs_formatted[:2] + web_startups[:1]
            summary = "Analysis of relevant startup failures and market indicators in this category."

        # 8. Similarity Explanation
        local_startups_only = [s for s in output_startups if "Tabular Dataset" in s.get("source", "")]
        explanations = generate_similarity_explanations(query, local_startups_only, groq_api_key)
        exp_map = {e.get("name", "").strip().lower(): e for e in explanations}
        
        for s in output_startups:
            name_clean = s.get("name", "").strip().lower()
            if name_clean in exp_map:
                exp = exp_map[name_clean]
                s["similarity_percentage"] = exp.get("similarity_percentage", 50)
                s["matched_features"] = exp.get("matched_features", [])
                s["different_features"] = exp.get("different_features", [])
            else:
                s["similarity_percentage"] = round(s.get("hybrid_score", 0.5) * 100)
                s["matched_features"] = ["✓ Related sector or technology focus"]
                s["different_features"] = ["✗ Different scaling timeline or market dynamics"]

        # 9. Failure Pattern Clustering
        all_for_clustering = output_startups + local_docs_formatted[:3]
        seen_names = set()
        unique_for_clustering = []
        for s in all_for_clustering:
            n = s.get("name", "").lower()
            if n not in seen_names:
                seen_names.add(n)
                unique_for_clustering.append(s)
                
        risk_graph = extract_failure_clusters(unique_for_clustering, groq_api_key)

        # 9.5 AI Analyst Synthesis Stage
        synthesis = synthesize_failure_intelligence(query, output_startups, local_docs_formatted[:3], groq_api_key)

        # 10. Logging
        log_entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "original_query": query,
            "canonical_query": canonical_concept,
            "expanded_queries": all_queries,
            "retrieved_documents": [s["name"] for s in final_startups[:10]],
            "vector_score": float(final_startups[0]["vector_score"]) if final_startups else 0.0,
            "bm25_score": float(final_startups[0]["bm25_score"]) if final_startups else 0.0,
            "crossencoder_score": float(final_startups[0]["crossencoder_score"]) if final_startups else 0.0,
            "hybrid_score": float(top_hybrid_score),
            "confidence_level": confidence_level,
            "fallback_reason": fallback_reason
        }
        
        with open("rag_pipeline_debug.log", "a", encoding="utf-8") as log_file:
            log_file.write(json.dumps(log_entry) + "\n")

        print(f"E2E Latency: {time.time() - start_time:.2f}s")
        
        return {
            "startups": output_startups,
            "summary": summary,
            "is_fallback": is_fallback,
            "confidence_level": confidence_level,
            "hybrid_score": float(top_hybrid_score),
            "risk_graph": risk_graph,
            "synthesis": synthesis,
            "local_references": local_docs_formatted[:3]
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "startups": [],
            "summary": f"Data processing error: {str(e)}.",
            "is_fallback": True,
            "confidence_level": "Low",
            "hybrid_score": 0.0,
            "risk_graph": {"clusters": {"Funding": 100}, "summary": "Error loading failure clusters."},
            "synthesis": {
                "competitor_summary": "Error running synthesis.",
                "historical_failure_patterns": "Error running synthesis.",
                "market_saturation_analysis": "Error running synthesis.",
                "opportunity_analysis": "Error running synthesis.",
                "risk_analysis": "Error running synthesis.",
                "recommendation": "Error running synthesis.",
                "contrarian_take": {
                    "consensus": "Error retrieving consensus view.",
                    "reality": "Error retrieving contrarian reality."
                }
            },
            "local_references": []
        }
    finally:
        if local_client:
            try:
                local_client.close()
                print("--> [Qdrant] Directory lock released successfully.")
            except Exception as close_e:
                print(f"--> [Qdrant Error] Failed to release directory lock: {close_e}")

def synthesize_failure_intelligence(query: str, startups: list, local_references: list, groq_key: str) -> dict:
    llm = ChatGroq(temperature=0.2, model_name=GENERATOR_MODEL_NAME, groq_api_key=groq_key)
    prompt = PromptTemplate(
        template="You are a principal startup investment analyst. "
                 "Perform a final synthesized failure intelligence analysis for a new startup concept:\n"
                 "Startup Concept: {query}\n\n"
                 "Failed Startups Context (mixture of database records and grounded web search results):\n"
                 "{startups_data}\n\n"
                 "Additional Database References:\n"
                 "{references_data}\n\n"
                 "Synthesize this intelligence and return strictly valid JSON matching this exact structure with no other text:\n"
                 "{{\n"
                 '  "competitor_summary": "A brief overview of how past competitors positioned themselves and failed.",\n'
                 '  "historical_failure_patterns": "Key failure patterns extracted from the matched records (e.g., funding gaps, PMF issues).",\n'
                 '  "market_saturation_analysis": "An assessment of whether this market is oversaturated or if there is a true entry opportunity.",\n'
                 '  "opportunity_analysis": "The clear whitespace or pivot opportunities identified from competitor post-mortems.",\n'
                 '  "risk_analysis": "Key execution and strategic risks for the founder to watch out for.",\n'
                 '  "recommendation": "Principal\'s recommendation: key actions to mitigate risks and proceed (e.g. secure B2B pilot, etc.)",\n'
                 '  "contrarian_take": {{\n'
                 '    "consensus": "The mainstream consensus/belief or obvious assumption about this business idea.",\n'
                 '    "reality": "The non-obvious reality, counter-intuitive insight, or hidden risk revealed by historical failure records."\n'
                 '  }}\n'
                 "}}\n",
        input_variables=["query", "startups_data", "references_data"]
    )
    
    startups_data = "\n---\n".join([
        f"Name: {s.get('name')}\nSector: {s.get('sector')}\nWhat They Did: {s.get('product_type', s.get('what_they_did', ''))}\nWhy They Failed: {s.get('failure_analysis', s.get('why_they_failed', ''))}\nTakeaway: {s.get('learnings', '')}"
        for s in startups
    ])
    
    references_data = "\n---\n".join([
        f"Name: {s.get('name')}\nWhy They Failed: {s.get('failure_analysis')}"
        for s in local_references
    ])
    
    chain = prompt | llm
    try:
        res = chain.invoke({
            "query": query,
            "startups_data": startups_data,
            "references_data": references_data
        })
        parsed = robust_parse_json(res.content)
        
        default_synthesis = {
            "competitor_summary": "No consensus competitor history available.",
            "historical_failure_patterns": "Typical failure patterns could not be synthesized.",
            "market_saturation_analysis": "Market saturation data is inconclusive.",
            "opportunity_analysis": "No distinct whitespace identified.",
            "risk_analysis": "Standard execution risks apply.",
            "recommendation": "Maintain standard risk mitigation protocols.",
            "contrarian_take": {
                "consensus": "Mainstream belief suggests this is a standard market opportunity with linear growth potential.",
                "reality": "Historical evidence reveals high hidden churn due to customer acquisition costs outstripping lifetime value."
            }
        }
        
        # Clean up any literal "string" values and strip markdown asterisks
        for k in ["competitor_summary", "historical_failure_patterns", "market_saturation_analysis", "opportunity_analysis", "risk_analysis", "recommendation"]:
            if parsed.get(k) == "string":
                parsed[k] = default_synthesis[k]
            elif parsed.get(k):
                parsed[k] = str(parsed[k]).replace("*", "")
                
        if isinstance(parsed.get("contrarian_take"), dict):
            for sub_k in ["consensus", "reality"]:
                if parsed["contrarian_take"].get(sub_k) == "string":
                    parsed["contrarian_take"][sub_k] = default_synthesis["contrarian_take"][sub_k]
                elif parsed["contrarian_take"].get(sub_k):
                    parsed["contrarian_take"][sub_k] = str(parsed["contrarian_take"][sub_k]).replace("*", "")

        # Ensure all keys exist
        for k, v in default_synthesis.items():
            if k not in parsed or not parsed[k]:
                parsed[k] = v
            elif k == "contrarian_take":
                if not isinstance(parsed[k], dict):
                    parsed[k] = v
                else:
                    for sub_k, sub_v in v.items():
                        if sub_k not in parsed[k] or not parsed[k][sub_k] or parsed[k][sub_k] == "string":
                            parsed[k][sub_k] = sub_v
                        elif parsed[k][sub_k]:
                            parsed[k][sub_k] = str(parsed[k][sub_k]).replace("*", "")
        return parsed
    except Exception as e:
        print(f"Synthesis failed: {e}")
        return {
            "competitor_summary": "Data unavailable due to synthesis error.",
            "historical_failure_patterns": "Data unavailable.",
            "market_saturation_analysis": "Data unavailable.",
            "opportunity_analysis": "Data unavailable.",
            "risk_analysis": "Data unavailable.",
            "recommendation": "Data unavailable.",
            "contrarian_take": {
                "consensus": "Mainstream belief suggests this is a standard market opportunity.",
                "reality": "Historical evidence reveals high customer acquisition costs."
            }
        }
