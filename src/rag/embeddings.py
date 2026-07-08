import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
from langchain_huggingface import HuggingFaceEmbeddings
from src.rag.config import EMBEDDING_MODEL_NAME

def get_embeddings():
    """
    Returns HuggingFaceEmbeddings using BAAI/bge-base-en-v1.5 with normalized embeddings.
    """
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL_NAME,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True}  # Ensures cosine similarity = dot product
    )
