import os

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
CSV_DIR = os.path.join(BASE_DIR, "data", "CSV")
QDRANT_DIR = os.path.join(BASE_DIR, "data", "qdrant")
KNOWLEDGE_BASE_JSON = os.path.join(BASE_DIR, "data", "startup_knowledge_base.json")

# Model configuration
EMBEDDING_MODEL_NAME = "BAAI/bge-base-en-v1.5"
RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
GENERATOR_MODEL_NAME = "qwen/qwen3.6-27b"

# RAG parameters
TOP_K_RETRIEVE = 20  # Number of candidate documents retrieved by hybrid search
TOP_K_RERANK = 5     # Number of documents passed to generator after reranking
CONFIDENCE_THRESHOLD = 0.35  # Threshold score below which Agentic Web Fallback is triggered
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
