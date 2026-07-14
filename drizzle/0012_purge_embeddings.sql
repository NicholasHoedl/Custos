-- ADR-052: purge all embedding vectors so they are re-embedded at the new model's dimension (768).
-- The embedder was swapped from Xenova/all-MiniLM-L6-v2 (384-dim) to Alibaba-NLP/gte-base-en-v1.5 (768-dim).
-- backfill() re-embeds by CONTENT HASH only, so it would SKIP unchanged notes and leave stale 384-dim
-- vectors that dot-product to garbage against 768-dim query vectors. Emptying the tables makes every row
-- "missing", so the post-download backfill re-embeds the whole campaign at 768. Data-only (no schema change).
DELETE FROM `note_embedding`;
--> statement-breakpoint
DELETE FROM `entity_embedding`;
