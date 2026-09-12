/**
 * Права того, кто сейчас работает.
 *
 * Один вызов на экран вместо проверки роли в каждой кнопке: экран спрашивает
 * «можно ли мне сюда», а не «кто здесь стоит». Роль от этого можно менять,
 * не переписывая экраны.
 */
import { currentStaff } from '../db/staff';
import { can, permissionsOf, type Permission } from '../domain/permissions';
import { useQuery } from './DatabaseProvider';

export function usePermissions() {
  const staff = useQuery((db) => currentStaff(db));

  return {
    staff,
    /** Кто работает; null — сотрудников не заводили и всё открыто. */
    allowed: (permission: Permission) => can(staff, permission),
    list: staff ? permissionsOf(staff) : null,
  };
}
