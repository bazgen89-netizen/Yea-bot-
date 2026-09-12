import type { SqlDriver } from './driver';
import { matchesRole, type Permission, type Role } from '../domain/permissions';
import type { Id } from '../domain/types';

/**
 * Сотрудники.
 *
 * Кто сейчас за прилавком, хранится в `app_state` одной строкой, а не в
 * отдельной таблице сессий: планшет в чайной один, и «сессия» здесь — это
 * ровно один вопрос «кто работает».
 */

export interface Staff {
  id: Id;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  /** Свой список прав через запятую; пусто — права берутся от роли. */
  permissions: string | null;
  pin: string | null;
  location_id: Id | null;
  archived: number;
  created_at: string;
}

export interface StaffInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  role: Role;
  /** Пусто — права роли. */
  permissions?: Permission[] | null;
  pin?: string | null;
  location_id?: Id | null;
}

export function listStaff(db: SqlDriver, includeArchived = false): Staff[] {
  return db.all<Staff>(
    `SELECT * FROM staff ${includeArchived ? '' : 'WHERE archived = 0'}
     ORDER BY archived, name COLLATE NOCASE`,
  );
}

export function getStaff(db: SqlDriver, id: Id): Staff | null {
  return db.get<Staff>('SELECT * FROM staff WHERE id = ?', [id]);
}

/**
 * Список прав пишется, только если он отличается от роли.
 *
 * Иначе сотрудник, заведённый управляющим сегодня, застрял бы с сегодняшним
 * набором прав навсегда — правка роли до него бы не дошла.
 */
function permissionsColumn(input: StaffInput): string | null {
  if (!input.permissions) return null;
  if (matchesRole(input.role, input.permissions)) return null;
  return input.permissions.join(',');
}

export function createStaff(db: SqlDriver, input: StaffInput): Id {
  db.run(
    `INSERT INTO staff (name, phone, email, role, permissions, pin, location_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.role,
      permissionsColumn(input),
      input.pin?.trim() || null,
      input.location_id ?? null,
      new Date().toISOString(),
    ],
  );
  return db.lastInsertId();
}

export function updateStaff(db: SqlDriver, id: Id, input: StaffInput): void {
  db.run(
    `UPDATE staff SET name = ?, phone = ?, email = ?, role = ?, permissions = ?,
                      pin = ?, location_id = ?
     WHERE id = ?`,
    [
      input.name.trim(),
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.role,
      permissionsColumn(input),
      input.pin?.trim() || null,
      input.location_id ?? null,
      id,
    ],
  );
}

/**
 * Сотрудники не удаляются, а архивируются: на них ссылаются проведённые
 * документы, и удаление стёрло бы ответ на вопрос «кто это провёл».
 */
export function archiveStaff(db: SqlDriver, id: Id): void {
  db.run('UPDATE staff SET archived = 1 WHERE id = ?', [id]);
  if (currentStaffId(db) === id) clearCurrentStaff(db);
}

export function restoreStaff(db: SqlDriver, id: Id): void {
  db.run('UPDATE staff SET archived = 0 WHERE id = ?', [id]);
}

const CURRENT_KEY = 'current_staff';

export function currentStaffId(db: SqlDriver): Id | null {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [
    CURRENT_KEY,
  ]);
  return row ? Number(row.value) : null;
}

/** Кто сейчас работает; null — сотрудников не заводили, программа открыта. */
export function currentStaff(db: SqlDriver): Staff | null {
  const id = currentStaffId(db);
  if (id === null) return null;

  const staff = getStaff(db, id);
  // Уволенный не остаётся за прилавком после архивации.
  return staff && !staff.archived ? staff : null;
}

/**
 * Ставит сотрудника за прилавок. Код проверяется здесь же: если он задан,
 * без него не переключиться.
 */
export function setCurrentStaff(db: SqlDriver, id: Id, pin?: string): boolean {
  const staff = getStaff(db, id);
  if (!staff || staff.archived) return false;
  if (staff.pin && staff.pin !== pin?.trim()) return false;

  db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CURRENT_KEY, String(id)],
  );
  return true;
}

export function clearCurrentStaff(db: SqlDriver): void {
  db.run('DELETE FROM app_state WHERE key = ?', [CURRENT_KEY]);
}
