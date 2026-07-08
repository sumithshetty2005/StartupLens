import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
from sentence_transformers import CrossEncoder
from src.rag.config import RERANK_MODEL_NAME

class CrossEncoderReranker:
    def __init__(self):
        self.model = CrossEncoder(RERANK_MODEL_NAME)

    def rerank(self, query: str, documents: list, top_k: int = 5) -> list:
        """
        Rerank a list of documents against a query using a Cross-Encoder.
        Returns a list of tuples: (reranked_score, document_object)
        """
        if not documents:
            return []

        # Prepare input pairs
        pairs = []
        for doc in documents:
            # We construct a rich text representing the document's content for the cross-encoder
            pairs.append([query, doc.page_content])

        # Compute scores
        scores = self.model.predict(pairs)

        # Sort documents by score descending
        ranked_docs = []
        for doc, score in zip(documents, scores):
            # Sigmoid scaling if necessary, or raw logit score. Since ms-marco is logit/probability, we keep it as float
            # Let's convert logit to a normalized score range [0, 1] using a sigmoid function for cleaner threshold check
            import math
            sigmoid_score = 1.0 / (1.0 + math.exp(-score))
            ranked_docs.append((sigmoid_score, doc))

        ranked_docs.sort(key=lambda x: x[0], reverse=True)
        return ranked_docs[:top_k]
