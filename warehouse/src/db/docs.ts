import type { SqlDriver } from './driver';
import { currentStaffId } from './staff';
import { averageCost, ONE_SIDE } from './stock';
import { DOC_TYPES } from '../domain/docTypes';
import { DOC_KIND_TYPE, type DocKind, type Id } from '../domain/types';

/**
 * Документ как бумага: номер, дата, стороны, позиции, оплаты.
 *
 * Отдельно от `stock.ts` потому, что там документ — способ подвинуть склад,
 * а здесь он сам себе предмет: у него есть номер, его правят, его откладывают
 * непроведённым. Проведение склада — только одно из его состояний.
 *
 * Главное правило: **у отложенного документа движений нет вовсе**. Не
 * «движения с нулём», не «движения с пометкой» — их просто не существует,
 * иначе остаток пришлось бы считать с оговоркой, а он считается одной суммой
 * по `stock_moves` и никак иначе.
 */

export interface DocLineInput {
  product_id: Id;
  qty: number;
  price: number;
  /** Скидка на позицию, сотые доли процента. */
  discount_bp?: number;
}

export interface DocPaymentInput {
  id?: Id;
  account: string;
  amount: number;
  paid: boolean;
  date: string;
}

export interface DocDraft {
  /** У нового документа пусто. */
  id?: Id;
  kind: DocKind;
  number: string;
  /** Дата документа — ISO. */
  date: string;
  posted: boolean;
  /** Статус заказа: 0…4. */
  state: number;
  /** Скидка на документ, сотые доли процента. */
  discount_bp: number;
  note: string;
  /** Магазин-отправитель либо магазин, в котором заводят документ. */
  locationId: Id | null;
  /** Магазин-получатель у перемещения. */
  locationToId: Id | null;
  counterpartyId: Id | null;
  counterparty: string;
  lines: DocLineInput[];
  payments: DocPaymentInput[];
}

/** Пустой документ выбранного вида. */
export function blankDoc(kind: DocKind): DocDraft {
  return {
    kind,
    number: '',
    date: new Date().toISOString(),
    // Их форма открывается с включённым переключателем: чаще всего документ
    // заводят по факту, а не откладывают.
    posted: true,
    state: 0,
    discount_bp: 0,
    note: '',
    locationId: null,
    locationToId: null,
    counterpartyId: null,
    counterparty: '',
    lines: [],
    payments: [],
  };
}

/**
 * Следующий номер документа этого вида.
 *
 * Считается по уже заведённым, а не хранится счётчиком: счётчик разошёлся бы
 * с документами при любом удалении, а нумерация нужна не для учёта, а для
 * того, чтобы бумаги было чем называть. Буквенные номера в расчёт не берутся.
 */
export function nextNumber(db: SqlDriver, kind: DocKind): string {
  const row = db.get<{ top: number | null }>(
    `SELECT MAX(CAST(number AS INTEGER)) AS top
     FROM docs
     WHERE subtype = ? AND number IS NOT NULL AND number GLOB '[0-9]*'`,
    [kind],
  );
  return String((row?.top ?? 0) + 1);
}

/** Позиция документа так, как её показывает форма. */
export interface DocFormLine extends DocLineInput {
  name: string;
  unit: string;
  code: string | null;
  sku: string | null;
  barcode: string | null;
  /** Остаток в магазине документа на сейчас. */
  stock: number;
}

export interface DocLoaded extends DocDraft {
  id: Id;
  lines: DocFormLine[];
  created_at: string;
  author: string | null;
}

/** Документ целиком — для формы правки. */
export function loadDoc(db: SqlDriver, id: Id): DocLoaded | null {
  const doc = db.get<{
    id: Id;
    subtype: DocKind | null;
    type: string;
    number: string | null;
    doc_date: string | null;
    created_at: string;
    posted: number;
    state: number;
    discount_bp: number;
    note: string | null;
    location_id: Id | null;
    location_to: Id | null;
    counterparty_id: Id | null;
    counterparty: string | null;
    author: string | null;
  }>(
    `SELECT d.*, (SELECT s.name FROM staff s WHERE s.id = d.staff_id) AS author
     FROM docs d WHERE d.id = ?`,
    [id],
  );
  if (!doc) return null;

  const kind = (doc.subtype ?? 'adjustment') as DocKind;

  // Позиции берутся из doc_lines, и только если их там нет — из движений.
  //
  // Из движений читать приходится потому, что документы, заведённые до
  // появления черновиков, в doc_lines ничего не писали: у них позиции есть
  // только движениями. У перемещения берётся расходная сторона — приходная
  // повторила бы каждую позицию вторым разом.
  let lines = db.all<DocFormLine>(
    `SELECT l.product_id, l.qty, l.price, l.discount_bp,
            p.name, p.unit, p.code, p.sku, p.barcode,
            COALESCE((SELECT SUM(s.qty_delta) FROM stock_moves s
                      WHERE s.product_id = l.product_id), 0) AS stock
     FROM doc_lines l
     JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?
     ORDER BY l.id`,
    [id],
  );

  if (lines.length === 0) {
    lines = db.all<DocFormLine>(
      `SELECT m.product_id,
              ABS(m.qty_delta) AS qty,
              m.price,
              0 AS discount_bp,
              p.name, p.unit, p.code, p.sku, p.barcode,
              COALESCE((SELECT SUM(s.qty_delta) FROM stock_moves s
                        WHERE s.product_id = m.product_id), 0) AS stock
       FROM stock_moves m
       JOIN products p ON p.id = m.product_id
       JOIN docs d ON d.id = m.doc_id
       WHERE m.doc_id = ? AND ${ONE_SIDE}
       ORDER BY m.id`,
      [id],
    );
  }

  const payments = db.all<{
    id: Id;
    account: string;
    amount: number;
    paid: number;
    date: string;
  }>('SELECT * FROM doc_payments WHERE doc_id = ? ORDER BY id', [id]);

  return {
    id: doc.id,
    kind,
    number: doc.number ?? '',
    date: doc.doc_date ?? doc.created_at,
    posted: doc.posted === 1,
    state: doc.state,
    discount_bp: doc.discount_bp,
    note: doc.note ?? '',
    locationId: doc.location_id,
    locationToId: doc.location_to,
    counterpartyId: doc.counterparty_id,
    counterparty: doc.counterparty ?? '',
    lines,
    payments: payments.map((row) => ({ ...row, paid: row.paid === 1 })),
    created_at: doc.created_at,
    author: doc.author,
  };
}

function validate(draft: DocDraft): void {
  const spec = DOC_TYPES[draft.kind];

  if (draft.lines.length === 0) throw new Error('Документ без позиций сохранить нельзя');
  if (spec.from === 'stores' && draft.locationId === null) {
    throw new Error('Не выбран магазин');
  }
  if (draft.kind === 'transfer') {
    if (draft.locationToId === null) throw new Error('Не выбран магазин получатель');
    if (draft.locationId === draft.locationToId) {
      throw new Error('Магазины отправителя и получателя совпадают');
    }
  }
  for (const line of draft.lines) {
    if (line.qty <= 0) throw new Error('Количество должно быть больше нуля');
  }
}

/**
 * Сохраняет документ: заводит новый или переписывает уже заведённый.
 *
 * Правка переписывает движения целиком, а не пытается сопоставить старые
 * с новыми: позицию могли убрать, добавить и поменять ей количество, и
 * разница между двумя списками — это и есть новый список.
 */
export function saveDoc(db: SqlDriver, draft: DocDraft): Id {
  validate(draft);

  const spec = DOC_TYPES[draft.kind];
  const docType = DOC_KIND_TYPE[draft.kind];
  const now = new Date().toISOString();

  return db.tx(() => {
    let docId: Id;

    if (draft.id) {
      db.run(
        `UPDATE docs SET subtype = ?, type = ?, number = ?, doc_date = ?, posted = ?,
                         state = ?, discount_bp = ?, note = ?, location_id = ?,
                         location_to = ?, counterparty_id = ?, counterparty = ?
         WHERE id = ?`,
        [
          draft.kind,
          docType,
          draft.number.trim() || null,
          draft.date,
          draft.posted ? 1 : 0,
          draft.state,
          draft.discount_bp,
          draft.note.trim() || null,
          draft.locationId,
          draft.locationToId,
          draft.counterpartyId,
          draft.counterparty.trim() || null,
          draft.id,
        ],
      );
      docId = draft.id;
      db.run('DELETE FROM stock_moves WHERE doc_id = ?', [docId]);
      db.run('DELETE FROM doc_lines WHERE doc_id = ?', [docId]);
      db.run('DELETE FROM doc_payments WHERE doc_id = ?', [docId]);
    } else {
      db.run(
        `INSERT INTO docs (type, subtype, number, doc_date, posted, state, discount_bp,
                           counterparty, counterparty_id, note, location_id, location_to,
                           staff_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          docType,
          draft.kind,
          draft.number.trim() || null,
          draft.date,
          draft.posted ? 1 : 0,
          draft.state,
          draft.discount_bp,
          draft.counterparty.trim() || null,
          draft.counterpartyId,
          draft.note.trim() || null,
          draft.locationId,
          draft.locationToId,
          currentStaffId(db),
          now,
        ],
      );
      docId = db.lastInsertId();
    }

    // Позиции лежат в doc_lines всегда: у отложенного это единственное место,
    // где они есть, а у проведённого — то, что откроется при правке, когда
    // движения уже переписаны.
    for (const line of draft.lines) {
      db.run(
        `INSERT INTO doc_lines (doc_id, product_id, qty, price, discount_bp)
         VALUES (?, ?, ?, ?, ?)`,
        [docId, line.product_id, line.qty, line.price, line.discount_bp ?? 0],
      );
    }

    if (draft.posted) {
      if (draft.kind === 'transfer') {
        for (const line of draft.lines) {
          db.run(
            `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
             VALUES (?, ?, 'writeoff', ?, ?, ?, ?)`,
            [line.product_id, -line.qty, docId, line.price, draft.locationId, draft.date],
          );
          db.run(
            `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
             VALUES (?, ?, 'receipt', ?, ?, ?, ?)`,
            [line.product_id, line.qty, docId, line.price, draft.locationToId, draft.date],
          );
        }
      } else {
        const sign = docType === 'receipt' ? 1 : -1;
        // Магазин у документа — та сторона, которая склад: у закупки товар
        // приходит в `to`, у продажи уходит из `from`.
        const store = spec.from === 'stores' ? draft.locationId : draft.locationToId;

        for (const line of draft.lines) {
          if (draft.kind === 'purchase' && line.price > 0) {
            averageCost(db, line.product_id, line.qty, line.price);
            db.run('UPDATE products SET purchase_price = ? WHERE id = ?', [
              line.price,
              line.product_id,
            ]);
          }

          db.run(
            `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [line.product_id, sign * line.qty, docType, docId, line.price, store, draft.date],
          );
        }
      }
    }

    for (const payment of draft.payments) {
      db.run(
        `INSERT INTO doc_payments (doc_id, account, amount, paid, date)
         VALUES (?, ?, ?, ?, ?)`,
        [docId, payment.account, payment.amount, payment.paid ? 1 : 0, payment.date],
      );
    }

    return docId;
  });
}

/** Сумма позиций документа со скидками, копейки. */
export function docTotal(lines: DocLineInput[], discountBp = 0): number {
  const lineSum = lines.reduce((sum, line) => {
    const gross = Math.round((line.qty * line.price) / 1000);
    return sum + gross - Math.round((gross * (line.discount_bp ?? 0)) / 10000);
  }, 0);
  return lineSum - Math.round((lineSum * discountBp) / 10000);
}

/** Сколько по документу уже оплачено, копейки. */
export function docPaid(payments: DocPaymentInput[]): number {
  return payments.filter((payment) => payment.paid).reduce((sum, p) => sum + p.amount, 0);
}
