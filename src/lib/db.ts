/**
 * D1 database helpers.
 * Thin wrappers around D1 queries — keeps SQL in one place.
 */

export interface User {
  id: string;
  email: string | null;
  password_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface Progress {
  user_id: string;
  course_slug: string;
  lesson_number: number;
  current_beat: string | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

// --- Users ---

export async function createUser(db: D1Database, id: string): Promise<void> {
  const now = Date.now();
  await db
    .prepare('INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)')
    .bind(id, now, now)
    .run();
}

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
}

export async function upgradeUser(
  db: D1Database,
  id: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(email, passwordHash, Date.now(), id)
    .run();
}

// --- Progress ---

export async function getProgress(
  db: D1Database,
  userId: string,
  courseSlug: string,
): Promise<Progress[]> {
  const result = await db
    .prepare('SELECT * FROM progress WHERE user_id = ? AND course_slug = ? ORDER BY lesson_number')
    .bind(userId, courseSlug)
    .all<Progress>();
  return result.results;
}

export async function upsertBeat(
  db: D1Database,
  userId: string,
  courseSlug: string,
  lessonNumber: number,
  beat: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO progress (user_id, course_slug, lesson_number, current_beat, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, course_slug, lesson_number)
       DO UPDATE SET current_beat = ?, updated_at = ?`,
    )
    .bind(userId, courseSlug, lessonNumber, beat, now, now, beat, now)
    .run();
}

export async function completeLesson(
  db: D1Database,
  userId: string,
  courseSlug: string,
  lessonNumber: number,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO progress (user_id, course_slug, lesson_number, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, course_slug, lesson_number)
       DO UPDATE SET completed_at = ?, current_beat = NULL, updated_at = ?`,
    )
    .bind(userId, courseSlug, lessonNumber, now, now, now, now, now)
    .run();
}

/**
 * Merge anonymous-user state into an authenticated user on sign-in.
 * Carries `progress` (legacy lessons) and `user_piece_reads` (daily-piece
 * reading record, since 0029) — the target user's existing rows always
 * win via INSERT OR IGNORE on the composite PK.
 *
 * Both auth paths (password login + magic-link verify) call this so a
 * reader's anonymous history follows them into their account.
 */
export async function mergeProgress(
  db: D1Database,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO progress (user_id, course_slug, lesson_number, current_beat, completed_at, created_at, updated_at)
         SELECT ?, course_slug, lesson_number, current_beat, completed_at, created_at, updated_at
         FROM progress WHERE user_id = ?`,
      )
      .bind(toUserId, fromUserId),
    db
      .prepare(
        `INSERT OR IGNORE INTO user_piece_reads (user_id, piece_id, started_at, last_seen_at, current_beat, completed_at)
         SELECT ?, piece_id, started_at, last_seen_at, current_beat, completed_at
         FROM user_piece_reads WHERE user_id = ?`,
      )
      .bind(toUserId, fromUserId),
  ]);
}
