import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import {
  archiveStaff,
  clearCurrentStaff,
  createStaff,
  currentStaff,
  getStaff,
  listStaff,
  setCurrentStaff,
  updateStaff,
} from '../staff';
import { createProduct } from '../products';
import { staffReport } from '../reports';
import { createSale } from '../sales';
import { postDoc } from '../stock';
import { ROLE_PERMISSIONS, can, permissionsOf } from '../../domain/permissions';

const ALL_TIME = { from: '1970-01-01T00:00:00.000Z', to: '2999-01-01T00:00:00.000Z' };

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

describe('права', () => {
  it('без сотрудников программа открыта целиком', () => {
    expect(currentStaff(db)).toBeNull();
    expect(can(null, 'reports')).toBe(true);
    expect(can(null, 'staff')).toBe(true);
  });

  it('роль задаёт права, и они не хранятся копией', () => {
    const id = createStaff(db, { name: 'Анна', role: 'seller' });
    const anna = getStaff(db, id)!;

    // Список не записан: у продавца он берётся от роли и поедет за ней.
    expect(anna.permissions).toBeNull();
    expect(permissionsOf(anna)).toEqual(ROLE_PERMISSIONS.seller);
    expect(can(anna, 'sales')).toBe(true);
    expect(can(anna, 'reports')).toBe(false);
    expect(can(anna, 'staff')).toBe(false);
  });

  it('свой набор прав записывается и переживает правку', () => {
    const id = createStaff(db, {
      name: 'Борис',
      role: 'seller',
      permissions: [...ROLE_PERMISSIONS.seller, 'reports'],
    });

    const boris = getStaff(db, id)!;
    expect(boris.permissions).not.toBeNull();
    expect(can(boris, 'reports')).toBe(true);

    updateStaff(db, id, { name: 'Борис Петрович', role: 'seller' });
    // Список стёрли — снова права роли.
    expect(can(getStaff(db, id)!, 'reports')).toBe(false);
  });

  it('владелец видит всё, управляющий — всё кроме сотрудников и интеграций', () => {
    const owner = getStaff(db, createStaff(db, { name: 'Вазген', role: 'owner' }))!;
    const manager = getStaff(db, createStaff(db, { name: 'Гоар', role: 'manager' }))!;

    expect(can(owner, 'staff')).toBe(true);
    expect(can(owner, 'integrations')).toBe(true);
    expect(can(manager, 'reports')).toBe(true);
    expect(can(manager, 'staff')).toBe(false);
    expect(can(manager, 'integrations')).toBe(false);
  });
});

describe('кто работает', () => {
  it('встаёт за прилавок и уходит', () => {
    const id = createStaff(db, { name: 'Анна', role: 'cashier' });

    expect(setCurrentStaff(db, id)).toBe(true);
    expect(currentStaff(db)?.name).toBe('Анна');

    clearCurrentStaff(db);
    expect(currentStaff(db)).toBeNull();
  });

  it('с кодом не пускает без кода', () => {
    const id = createStaff(db, { name: 'Анна', role: 'cashier', pin: '1234' });

    expect(setCurrentStaff(db, id)).toBe(false);
    expect(setCurrentStaff(db, id, '9999')).toBe(false);
    expect(currentStaff(db)).toBeNull();

    expect(setCurrentStaff(db, id, '1234')).toBe(true);
    expect(currentStaff(db)?.name).toBe('Анна');
  });

  it('уволенный не остаётся за прилавком', () => {
    const id = createStaff(db, { name: 'Анна', role: 'cashier' });
    setCurrentStaff(db, id);

    archiveStaff(db, id);

    expect(currentStaff(db)).toBeNull();
    expect(setCurrentStaff(db, id)).toBe(false);
    // Из списка он пропадает, но из базы — нет: на нём висят документы.
    expect(listStaff(db)).toHaveLength(0);
    expect(listStaff(db, true)).toHaveLength(1);
  });
});

describe('кто провёл', () => {
  it('чек и документ помнят сотрудника, и отчёт считает по ним', () => {
    const annaId = createStaff(db, { name: 'Анна', role: 'cashier' });
    setCurrentStaff(db, annaId);

    const tea = createProduct(db, {
      name: 'Шу пуэр',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'кг',
      cost_price: 200000,
      sale_price: 500000,
      min_qty: 0,
      photo_uri: null,
    });

    postDoc(db, {
      type: 'purchase',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', qty: 8000, price: 200000 }],
    });
    createSale(db, {
      lines: [
        {
          product_id: tea,
          name: 'Шу пуэр',
          unit: 'кг',
          qty: 1000,
          price: 500000,
          cost_price: 200000,
          stock: 8000,
        },
      ],
      discount: 50000,
      payment: 'cash',
    });

    const report = staffReport(db, ALL_TIME);
    expect(report).toHaveLength(1);
    expect(report[0].name).toBe('Анна');
    expect(report[0].salesCount).toBe(1);
    // 5000,00 за килограмм минус 500,00 скидки.
    expect(report[0].salesSum).toBe(450000);
    expect(report[0].discounts).toBe(50000);
    expect(report[0].itemsPerReceipt).toBe(100);
  });

  it('без выбранного сотрудника чеки ни за кем не числятся', () => {
    createStaff(db, { name: 'Анна', role: 'cashier' });
    expect(staffReport(db, ALL_TIME)).toEqual([]);
  });
});
