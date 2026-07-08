import os
import shutil
import pandas as pd
from langchain_core.documents import Document
from src.rag.config import CSV_DIR, QDRANT_DIR
from src.rag.embeddings import get_embeddings
from src.rag.enrichment import MetadataProvider
from langchain_qdrant import QdrantVectorStore

def load_documents_from_csvs():
    documents = []
    if not os.path.exists(CSV_DIR):
        print(f"Directory {CSV_DIR} does not exist.")
        return documents

    all_files = os.listdir(CSV_DIR)
    sector_files = [f for f in all_files if f.endswith(".csv") and f != "Startup Failures.csv"]
    general_file = "Startup Failures.csv" if "Startup Failures.csv" in all_files else None
    
    files_to_process = sector_files + ([general_file] if general_file else [])
    processed_startup_names = set()
    enricher = MetadataProvider()

    def clean_val(val):
        if pd.isna(val):
            return ""
        val_str = str(val).strip()
        if val_str.lower() in ["nan", "null", "none", ""]:
            return ""
        return val_str

    for filename in files_to_process:
        file_path = os.path.join(CSV_DIR, filename)
        try:
            df = pd.read_csv(file_path)
            df.columns = [c.strip() for c in df.columns]
            
            for _, row in df.iterrows():
                name = clean_val(row.get('Name', ''))
                if not name:
                    continue
                
                name_lower = name.lower()
                # Deduplication: only skip if generic file and we already have processed it
                if filename == "Startup Failures.csv" and name_lower in processed_startup_names:
                    continue
                
                sector = clean_val(row.get('Sector', ''))
                years = clean_val(row.get('Years of Operation', ''))
                what = clean_val(row.get('What They Did', ''))
                raised = clean_val(row.get('How Much They Raised') or row.get('Cash Burned', ''))
                why = clean_val(row.get('Why They Failed') or row.get('Why they failed', ''))
                takeaway = clean_val(row.get('Takeaway') or row.get('Learnings', ''))
                
                metadata = {
                    "source": filename,
                    "name": name,
                    "sector": sector,
                    "years_of_operation": years,
                    "what_they_did": what,
                    "cash_burned": raised,
                    "failure_analysis": why,
                    "learnings": takeaway
                }
                
                # Enrich metadata using MetadataProvider
                metadata = enricher.enrich_record(name, metadata)
                
                # Construct page content from enriched metadata
                narrative_parts = []
                name_val = metadata.get("name")
                sector_val = metadata.get("sector")
                years_val = metadata.get("years_of_operation")
                what_val = metadata.get("what_they_did")
                raised_val = metadata.get("cash_burned")
                why_val = metadata.get("failure_analysis")
                takeaway_val = metadata.get("learnings")

                if sector_val:
                    narrative_parts.append(f"{name_val} was a startup in the {sector_val} sector.")
                else:
                    narrative_parts.append(f"{name_val} was a startup company.")
                
                if years_val:
                    narrative_parts.append(f"It operated for {years_val}.")
                if what_val:
                    narrative_parts.append(f"The company worked on: {what_val}.")
                if raised_val:
                    narrative_parts.append(f"They raised or burned approximately {raised_val}.")
                if why_val:
                    narrative_parts.append(f"Ultimately, the company failed and shut down because {why_val}.")
                if takeaway_val:
                    narrative_parts.append(f"A key learning from their failure is: {takeaway_val}.")
                
                page_content = " ".join(narrative_parts)
                documents.append(Document(page_content=page_content, metadata=metadata))
                processed_startup_names.add(name_lower)
        except Exception as e:
            print(f"Error reading {filename}: {e}")

    # Inject startups from knowledge base that are not in the CSVs
    kb_startups = enricher.get_all_kb_startups()
    for startup in kb_startups:
        name_lower = startup["name"].lower()
        if name_lower not in processed_startup_names:
            print(f"Injecting missing startup from knowledge base: {startup['name']}")
            metadata = {
                "source": "knowledge_base_json",
                "name": startup["name"],
                "sector": startup["sector"],
                "years_of_operation": startup["years_of_operation"],
                "what_they_did": startup["what_they_did"],
                "cash_burned": startup["cash_burned"],
                "failure_analysis": startup["failure_analysis"],
                "learnings": startup["learnings"]
            }
            
            narrative_parts = []
            if startup["sector"]:
                narrative_parts.append(f"{startup['name']} was a startup in the {startup['sector']} sector.")
            else:
                narrative_parts.append(f"{startup['name']} was a startup company.")
            
            if startup["years_of_operation"]:
                narrative_parts.append(f"It operated for {startup['years_of_operation']}.")
            if startup["what_they_did"]:
                narrative_parts.append(f"The company worked on: {startup['what_they_did']}.")
            if startup["cash_burned"]:
                narrative_parts.append(f"They raised or burned approximately {startup['cash_burned']}.")
            if startup["failure_analysis"]:
                narrative_parts.append(f"Ultimately, the company failed and shut down because {startup['failure_analysis']}.")
            if startup["learnings"]:
                narrative_parts.append(f"A key learning from their failure is: {startup['learnings']}.")
            
            page_content = " ".join(narrative_parts)
            documents.append(Document(page_content=page_content, metadata=metadata))
            processed_startup_names.add(name_lower)
            
    return documents

def ingest_data():
    print("Loading documents from CSVs and Knowledge Base...")
    docs = load_documents_from_csvs()
    print(f"Loaded {len(docs)} documents.")
    
    if not docs:
        print("No documents to ingest. Aborting.")
        return

    print("Initializing HuggingFace BGE Embeddings...")
    embeddings = get_embeddings()
    
    print("Creating/updating Qdrant vector store...")
    os.makedirs(os.path.dirname(QDRANT_DIR), exist_ok=True)
    
    if os.path.exists(QDRANT_DIR):
        print(f"Removing old vector store directory at {QDRANT_DIR}")
        shutil.rmtree(QDRANT_DIR)
    os.makedirs(QDRANT_DIR, exist_ok=True)
        
    vectorstore = QdrantVectorStore.from_documents(
        documents=docs,
        embedding=embeddings,
        path=QDRANT_DIR,
        collection_name="failed_startups"
    )
    print("Ingestion complete. Database stored at", QDRANT_DIR)

if __name__ == "__main__":
    ingest_data()
