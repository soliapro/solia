-- Solia D1 Schema
-- Tables pour le dashboard temps réel

-- Tracking des contacts (remplace localStorage solia_prospection)
CREATE TABLE IF NOT EXISTS tracking (
  slug TEXT PRIMARY KEY,
  contacted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Notes par prospect (remplace localStorage solia_notes)
CREATE TABLE IF NOT EXISTS notes (
  slug TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
