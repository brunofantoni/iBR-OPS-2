# IBR Ops - Knowledge Management & Ingestion Pipeline

This document describes the design of our Knowledge Base and Ingestion processing.

## 1. Document Lifecycle
```
[Ingest Event] --> [Sanitization & Secret Scan] --> [Structure Extraction] --> [DRAFT KB Entry] --> [Review] --> [CANONICAL KB] --> [Sync to File Search Index]
```

## 2. Ingestion Rules & Taxonomy Matching
- Standard extensions: `.md`, `.txt`, `.pdf`, `.json`, `.csv`, `.log`.
- Auto-extract client association by matching names (e.g. `CRECI DF`).
- Identify IP addresses (`192.168.x.x`) and automatically link them to their target assets or network segments.
- Flag discrepancies in document updates, generating a `knowledge_conflict` record instead of overwriting canonical truth.
