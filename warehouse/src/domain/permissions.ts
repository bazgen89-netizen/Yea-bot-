/**
 * Роли и права.
 *
 * Восемнадцать прав и пять ролей — те же, что в исходном приложении: там у
 * каждого экрана в коде прописано право, которое он требует, и роли собраны
 * из этих же названий. Придумывать своё деление значило бы разойтись с
 * программой, из которой сюда переходят.
 *
 * Здесь нет ни React, ни базы: право — это правило, а не запись в таблице.
 */

export type Permission =
  | 'dashboard'
  | 'catalog'
  | 'clients'
  | 'suppliers'
  | 'stores'
  | 'staff'
  | 'accounts'
  | 'money'
  | 'movements'
  | 'sales'
  | 'purchases'
  | 'return_sales'
  | 'return_purchases'
  | 'changes'
  | 'registers'
  | 'shifts'
  | 'reports'
  | 'integrations';

export const PERMISSION_LABEL: Record<Permission, string> = {
  dashboard: 'Главная',
  catalog: 'Товары и услуги',
  clients: 'Клиенты',
  suppliers: 'Поставщики',
  stores: 'Магазины',
  staff: 'Сотрудники',
  accounts: 'Счета',
  money: 'Движение денег',
  movements: 'Движение товара',
  sales: 'Продажи',
  purchases: 'Закупки',
  return_sales: 'Возвраты продаж',
  return_purchases: 'Возвраты закупок',
  changes: 'Корректировки и инвентаризация',
  registers: 'Кассы',
  shifts: 'Смены',
  reports: 'Отчёты',
  integrations: 'Интеграции',
};

export const PERMISSIONS = Object.keys(PERMISSION_LABEL) as Permission[];

export type Role = 'owner' | 'manager' | 'cashier' | 'storekeeper' | 'seller';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Управляющий',
  cashier: 'Кассир',
  storekeeper: 'Кладовщик',
  seller: 'Продавец',
};

export const ROLE_HINT: Record<Role, string> = {
  owner: 'Видит всё и меняет всё, включая сотрудников и права',
  manager: 'Всё, кроме сотрудников и интеграций',
  cashier: 'Касса, смены, продажи и возвраты',
  storekeeper: 'Склад: приход, списание, перемещение, инвентаризация',
  seller: 'Только продажи и справочник, без цен закупки и отчётов',
};

/**
 * Права роли по умолчанию.
 *
 * Владелец перечислен целиком, а не «все»: список прав растёт, и новое право
 * должно попадать к владельцу осознанно, а не потому, что у него стоит звёздочка.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  manager: PERMISSIONS.filter((p) => p !== 'staff' && p !== 'integrations'),
  cashier: ['dashboard', 'catalog', 'clients', 'sales', 'return_sales', 'registers', 'shifts'],
  storekeeper: ['dashboard', 'catalog', 'suppliers', 'movements', 'purchases', 'return_purchases', 'changes'],
  seller: ['catalog', 'clients', 'sales'],
};

/**
 * Права сотрудника: свой список, если он задан, иначе список роли.
 *
 * Своим списком, а не «роль плюс поправки»: поправка «минус отчёты» у
 * управляющего перестала бы работать в тот день, когда роль управляющего
 * поменяют, и никто бы этого не заметил.
 */
export function permissionsOf(staff: {
  role: Role;
  permissions?: string | null;
}): Permission[] {
  if (!staff.permissions) return ROLE_PERMISSIONS[staff.role];

  const own = staff.permissions
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is Permission => PERMISSIONS.includes(value as Permission));

  return own;
}

export function can(
  staff: { role: Role; permissions?: string | null } | null,
  permission: Permission,
): boolean {
  // Без сотрудников программа работает как раньше — открыта целиком.
  // Иначе первый же запуск после обновления запер бы владельца снаружи.
  if (!staff) return true;
  return permissionsOf(staff).includes(permission);
}

/** Совпадает ли набор прав с ролью: по нему решается, писать ли свой список. */
export function matchesRole(role: Role, permissions: Permission[]): boolean {
  const base = ROLE_PERMISSIONS[role];
  return (
    base.length === permissions.length && base.every((value) => permissions.includes(value))
  );
}
