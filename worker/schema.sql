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

-- Statut des pages (en ligne / hors ligne — verifie en temps reel)
CREATE TABLE IF NOT EXISTS page_status (
  slug TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  paid INTEGER NOT NULL DEFAULT 0,
  prenom TEXT DEFAULT '',
  nom TEXT DEFAULT '',
  metier TEXT DEFAULT '',
  ville TEXT DEFAULT '',
  demo_created_at TEXT DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
