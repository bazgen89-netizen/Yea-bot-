/**
 * Схема базы и миграции.
 *
 * Остатки нигде не хранятся отдельным числом — они всегда SUM(stock_moves.qty_delta)
 * по товару. Так остаток невозможно рассинхронизировать с историей: любое изменение
 * склада — это запись движения, и «почему тут 3 штуки» всегда можно объяснить.
 */
import type { SqlDriver } from './driver';

/**
 * Каждая миграция применяется один раз, в порядке номеров. Добавлять новые —
 * только в конец массива, не меняя уже выпущенные: они уже применены на телефонах.
 */
export const MIGRATIONS: string[] = [
  // 1 — начальная схема
  `
  CREATE TABLE categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    sku         TEXT,
    barcode     TEXT    UNIQUE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit        TEXT    NOT NULL DEFAULT 'шт',
    cost_price  INTEGER NOT NULL DEFAULT 0,
    sale_price  INTEGER NOT NULL DEFAULT 0,
    min_qty     INTEGER NOT NULL DEFAULT 0,
    photo_uri   TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    -- name + sku + barcode в нижнем регистре, для поиска.
    -- Своя колонка нужна потому, что LIKE и LOWER() в SQLite игнорируют регистр
    -- только для латиницы: по «улун» товар «Улун» иначе не находится.
    search_text TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX idx_products_name     ON products(name);
  CREATE INDEX idx_products_archived ON products(archived);

  CREATE TABLE docs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL CHECK (type IN ('receipt','writeoff','adjust')),
    counterparty TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE sales (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discount   INTEGER NOT NULL DEFAULT 0,
    total      INTEGER NOT NULL,
    cost_total INTEGER NOT NULL,
    payment    TEXT    NOT NULL DEFAULT 'cash'
                       CHECK (payment IN ('cash','card','transfer')),
    created_at TEXT    NOT NULL
  );

  CREATE INDEX idx_sales_created ON sales(created_at);

  CREATE TABLE sale_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL,
    price      INTEGER NOT NULL,
    cost_price INTEGER NOT NULL
  );

  CREATE INDEX idx_sale_items_sale    ON sale_items(sale_id);
  CREATE INDEX idx_sale_items_product ON sale_items(product_id);

  CREATE TABLE stock_moves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_delta  INTEGER NOT NULL,
    reason     TEXT    NOT NULL
                       CHECK (reason IN ('receipt','writeoff','sale','adjust','return')),
    doc_id     INTEGER REFERENCES docs(id)  ON DELETE CASCADE,
    sale_id    INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    price      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );

  CREATE INDEX idx_moves_product ON stock_moves(product_id);
  CREATE INDEX idx_moves_created ON stock_moves(created_at);
  `,

  // 2 — контрагенты: клиенты и поставщики
  `
  CREATE TABLE counterparties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 'both' — запись, которая и покупает, и поставляет; попадает в оба списка.
    kind        TEXT    NOT NULL CHECK (kind IN ('customer','supplier','both')),
    name        TEXT    NOT NULL,
    phone       TEXT,
    email       TEXT,
    note        TEXT,
    -- Личная скидка в сотых долях процента: 500 = 5 %.
    discount_bp INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    -- Как и у товаров: имя, телефон и почта в нижнем регистре, плюс телефон
    -- без разделителей — «+7 (999) 123-45-67» ищется и как «9991234567».
    search_text TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX idx_parties_kind ON counterparties(kind, archived);
  CREATE INDEX idx_parties_name ON counterparties(name);

  ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES counterparties(id);

  CREATE INDEX idx_sales_customer ON sales(customer_id);
  `,

  // 3 — магазины: остаток считается по точкам, а не общей кучей
  `
  CREATE TABLE locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );

  -- NULL означает «до появления магазинов»: у движений, записанных раньше,
  -- точки не было, и придумывать её задним числом нельзя.
  ALTER TABLE stock_moves ADD COLUMN location_id INTEGER REFERENCES locations(id);
  ALTER TABLE sales       ADD COLUMN location_id INTEGER REFERENCES locations(id);
  ALTER TABLE docs        ADD COLUMN location_id INTEGER REFERENCES locations(id);

  CREATE INDEX idx_moves_location ON stock_moves(location_id);

  -- Отметка о том, что каталог уже загружен: иначе при каждом запуске
  -- приложение заводило бы те же товары заново.
  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 4 — поля карточки клиента из выгрузки
  `
  ALTER TABLE counterparties ADD COLUMN birthday    TEXT;
  ALTER TABLE counterparties ADD COLUMN gender      TEXT;
  ALTER TABLE counterparties ADD COLUMN address     TEXT;
  -- Кто завёл карточку. В выгрузке это имя сотрудника или магазина строкой,
  -- а не ссылка: своих сотрудников в базе ещё нет, и связывать пока не с чем.
  ALTER TABLE counterparties ADD COLUMN created_by  TEXT;
  `,

  // 5 — виды документов кабинета
  `
  -- type остаётся про склад: плюс или минус. Но закупка и оприходование
  -- приходуют товар одинаково, а называются и заполняются по-разному —
  -- смысл документа хранится отдельно.
  --
  -- Отдельной колонкой, а не расширением CHECK у type: перебрать значения
  -- в CHECK можно только пересборкой таблицы, а на неё завязаны движения
  -- с ON DELETE CASCADE — сборка стоила бы риска потерять их.
  ALTER TABLE docs ADD COLUMN subtype TEXT;

  -- Куда перемещаем. У всех документов, кроме перемещения, пусто.
  ALTER TABLE docs ADD COLUMN location_to INTEGER REFERENCES locations(id);
  `,

  // 6 — деньги, не рождённые чеком: приход, расход, перевод между счетами
  `
  CREATE TABLE money_docs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT    NOT NULL CHECK (type IN ('income','expense','transfer')),
    -- Всегда положительная: знак задаёт тип, а не сумма. Иначе расход на
    -- «минус пятьсот» означал бы приход, и это никак не поймать.
    amount          INTEGER NOT NULL CHECK (amount > 0),
    account         TEXT    NOT NULL,
    -- Куда переводим. У прихода и расхода пусто.
    account_to      TEXT,
    counterparty_id INTEGER REFERENCES counterparties(id),
    counterparty    TEXT,
    category        TEXT,
    note            TEXT,
    location_id     INTEGER REFERENCES locations(id),
    created_at      TEXT    NOT NULL
  );

  CREATE INDEX idx_money_docs_created ON money_docs(created_at);
  `,

  // 7 — кассы и смены
  `
  CREATE TABLE registers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    location_id INTEGER REFERENCES locations(id),
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE shifts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    register_id  INTEGER NOT NULL REFERENCES registers(id),
    opened_at    TEXT    NOT NULL,
    -- Пусто, пока смена открыта. Открытая смена — та, у которой здесь NULL,
    -- а не та, у которой стоит какой-нибудь флаг: два способа узнать одно и
    -- то же рано или поздно разойдутся.
    closed_at    TEXT,
    -- Наличные в ящике на момент открытия, копейки.
    opening_cash INTEGER NOT NULL DEFAULT 0,
    -- Сколько насчитали при закрытии. Расхождение с ожидаемым — это Z-отчёт.
    closing_cash INTEGER,
    cashier      TEXT,
    created_at   TEXT    NOT NULL
  );

  CREATE INDEX idx_shifts_register ON shifts(register_id, closed_at);

  -- Чек знает свою смену. У чеков, пробитых до появления смен, её нет.
  ALTER TABLE sales      ADD COLUMN shift_id INTEGER REFERENCES shifts(id);
  ALTER TABLE money_docs ADD COLUMN shift_id INTEGER REFERENCES shifts(id);

  CREATE INDEX idx_sales_shift ON sales(shift_id);
  `,

  // 8 — поля карточки товара, которых не хватало против исходного приложения
  `
  -- Вид позиции. Так их описывает само исходное приложение:
  --   product — «продукт, имеющий остаток, который необходимо восполнять»
  --   service — «продукт, не имеющий остатка на складе»
  --   set     — «продукт, состоящий из нескольких других»
  ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'product'
    CHECK (kind IN ('product','service','set'));

  -- Код товара — отдельно от артикула: артикул поставщика, код внутренний.
  ALTER TABLE products ADD COLUMN code TEXT;

  -- Ставка НДС в сотых долях процента: 2000 = 20 %. NULL — без НДС.
  ALTER TABLE products ADD COLUMN vat_bp INTEGER;

  -- Срок годности, YYYY-MM-DD. На нём держатся три фильтра каталога.
  ALTER TABLE products ADD COLUMN expires_at TEXT;

  -- Скидка на товар в сотых долях процента: 500 = 5 %. Хранится процентом,
  -- а не готовой ценой: цена продажи меняется, и записанная цена со скидкой
  -- разошлась бы с ней молча.
  ALTER TABLE products ADD COLUMN discount_bp INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX idx_products_expires ON products(expires_at);
  `,

  // 9 — сотрудники и права
  `
  CREATE TABLE staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    phone       TEXT,
    email       TEXT,
    -- Пять ролей исходного приложения. Роль задаёт права по умолчанию,
    -- а не заменяет их: у продавца одного магазина и продавца другого
    -- набор может отличаться.
    role        TEXT    NOT NULL DEFAULT 'seller'
                        CHECK (role IN ('owner','manager','cashier','storekeeper','seller')),
    -- Права списком через запятую; пусто — берутся от роли.
    permissions TEXT,
    -- Код, который сотрудник набирает у кассы. Не пароль: файл базы на
    -- планшете читается целиком, и хранить здесь что-то, охраняющее деньги,
    -- было бы обманом. Он защищает от чужого нажатия, а не от злого умысла.
    pin         TEXT,
    location_id INTEGER REFERENCES locations(id),
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );

  CREATE INDEX idx_staff_archived ON staff(archived);

  -- Кто провёл документ. У всего, что заведено до появления сотрудников, пусто.
  ALTER TABLE docs       ADD COLUMN staff_id INTEGER REFERENCES staff(id);
  ALTER TABLE sales      ADD COLUMN staff_id INTEGER REFERENCES staff(id);
  ALTER TABLE money_docs ADD COLUMN staff_id INTEGER REFERENCES staff(id);

  CREATE INDEX idx_sales_staff ON sales(staff_id);
  `,

  // 10 — поля товара из исходного приложения, которых не хватало
  `
  -- Цена закупки — то, что заплатили поставщику в последний раз.
  -- Отдельно от себестоимости: себестоимость там считается по среднему и
  -- меняется с каждой закупкой, а цена закупки — число из последней накладной.
  -- Одним полем их держать нельзя: по одному считают прибыль, по другому
  -- решают, не подорожал ли товар.
  ALTER TABLE products ADD COLUMN purchase_price INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE products ADD COLUMN country     TEXT;
  ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES counterparties(id);
  ALTER TABLE products ADD COLUMN description TEXT;

  -- Код для весов: на весах набирают его, а не штрихкод.
  ALTER TABLE products ADD COLUMN plu_code TEXT;
  ALTER TABLE products ADD COLUMN gtin     TEXT;

  -- Весовой товар продаётся долями единицы, штучный — только целыми.
  ALTER TABLE products ADD COLUMN weighted INTEGER NOT NULL DEFAULT 0;

  -- Габариты и вес, тысячные (миллиметры и граммы).
  ALTER TABLE products ADD COLUMN height_mm INTEGER;
  ALTER TABLE products ADD COLUMN width_mm  INTEGER;
  ALTER TABLE products ADD COLUMN depth_mm  INTEGER;
  ALTER TABLE products ADD COLUMN weight_g  INTEGER;

  -- Кассир может поменять цену в чеке; товар продаётся по цене магазина.
  ALTER TABLE products ADD COLUMN free_price  INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN store_price INTEGER NOT NULL DEFAULT 0;

  -- Цена продажи в отдельном магазине. Строки заводятся только для тех точек,
  -- где цена отличается от общей: иначе у каждого товара висели бы семь
  -- одинаковых строк, и «поменял цену» пришлось бы делать семь раз.
  CREATE TABLE product_prices (
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    price       INTEGER NOT NULL,
    PRIMARY KEY (product_id, location_id)
  );

  -- Упаковка: «коробка — 12 шт». Их несколько на товар.
  CREATE TABLE product_packs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    qty        INTEGER NOT NULL
  );

  CREATE INDEX idx_packs_product ON product_packs(product_id);

  -- Состав комплекта: из каких товаров он собран.
  CREATE TABLE product_set_items (
    set_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL,
    PRIMARY KEY (set_id, product_id)
  );
  `,

  // 11 — маркировка, налогообложение и акциз
  `
  -- Код товарной группы «Честного знака»: «01» — обувь, «12» — молочная
  -- продукция. Хранится кодом, а не названием: названия групп меняются, коды
  -- нет, и по коду товар опознаёт касса.
  ALTER TABLE products ADD COLUMN marking_type TEXT;

  -- Система налогообложения позиции: «02» — ОСНО, «04» — УСН Доход. У товара
  -- своя, потому что в одном чеке встречаются позиции с разными режимами, и
  -- касса печатает их разными фискальными документами.
  ALTER TABLE products ADD COLUMN tax_system TEXT;

  ALTER TABLE products ADD COLUMN excisable INTEGER NOT NULL DEFAULT 0;

  -- Категорий у товара бывает несколько: чай может быть и «Пуэром», и
  -- «Подарочным». Одной колонкой это не выразить, но и убрать её нельзя —
  -- на products.category_id стоят отчёт по категориям, колонка справочника и
  -- фильтры. Поэтому список отдельной таблицей, а в колонке — первая из них:
  -- то, что показывают в строке справочника и по чему группируют отчёт.
  CREATE TABLE product_categories (
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, category_id)
  );

  -- Перенос того, что уже проставлено: без него у всех заведённых товаров
  -- список категорий оказался бы пустым, хотя категория у них есть.
  INSERT INTO product_categories (product_id, category_id)
  SELECT id, category_id FROM products WHERE category_id IS NOT NULL;
  `,

  // 12 — лояльность контрагента
  `
  -- Номер карты лояльности: по нему клиента находят на кассе, когда он не
  -- помнит телефон.
  ALTER TABLE counterparties ADD COLUMN discount_card TEXT;

  -- Какая система на клиенте: 'discount' — скидка процентом, 'bonus' —
  -- бонусный счёт. Пусто — никакой.
  ALTER TABLE counterparties ADD COLUMN loyalty_type TEXT;

  -- Бонусный счёт, копейки: бонус приравнен к рублю, и держать его в других
  -- единицах значило бы пересчитывать при каждой оплате.
  ALTER TABLE counterparties ADD COLUMN bonus_balance INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE counterparties ADD COLUMN bonus_spent   INTEGER NOT NULL DEFAULT 0;

  -- Кешбэк в сотых долях процента: 500 = 5 %.
  ALTER TABLE counterparties ADD COLUMN cashback_bp INTEGER NOT NULL DEFAULT 0;

  -- Контрагент документа ссылкой, а не именем.
  --
  -- Именем он лежал с самого начала, и это мешало посчитать закупки
  -- поставщика: имена меняются, повторяются и пишутся по-разному. Старая
  -- колонка остаётся — по ней подписаны уже заведённые документы.
  ALTER TABLE docs ADD COLUMN counterparty_id INTEGER REFERENCES counterparties(id);

  UPDATE docs SET counterparty_id = (
    SELECT c.id FROM counterparties c WHERE c.name = docs.counterparty
  ) WHERE counterparty IS NOT NULL;

  CREATE INDEX idx_docs_counterparty ON docs(counterparty_id);
  `,

  // 13 — документ как бумага: номер, дата, проведение, статус и оплаты
  `
  -- Номер документа. Строкой, а не числом: в номерах бывают буквы и префиксы
  -- («ТН-0012»), и складывать их никто не собирается.
  ALTER TABLE docs ADD COLUMN number TEXT;

  -- Дата документа отдельно от created_at. Документ заводят задним числом —
  -- накладная пришла вчера, а вбили её сегодня, — и отчёт должен считать по
  -- дате накладной, а не по дате ввода.
  ALTER TABLE docs ADD COLUMN doc_date TEXT;
  UPDATE docs SET doc_date = created_at WHERE doc_date IS NULL;

  -- Проведён или отложен.
  --
  -- Отложенный документ склад не двигает: у него нет движений вовсе. Поэтому
  -- у всех уже заведённых документов здесь 1 — движения у них есть, и без
  -- единицы они разом стали бы черновиками.
  ALTER TABLE docs ADD COLUMN posted INTEGER NOT NULL DEFAULT 1;

  -- Статус заказа: 0 без статуса, 1 новый, 2 в работе, 3 закрыт, 4 отменен.
  -- К проведению отношения не имеет — проведённый документ бывает «В работе».
  ALTER TABLE docs ADD COLUMN state INTEGER NOT NULL DEFAULT 0;

  -- Скидка на весь документ, сотые доли процента: 500 = 5 %.
  ALTER TABLE docs ADD COLUMN discount_bp INTEGER NOT NULL DEFAULT 0;

  -- Позиции отложенного документа.
  --
  -- У проведённого позиции восстанавливаются из движений, и второй копии для
  -- них не нужно. Но у отложенного движений нет — а позиции есть, и хранить
  -- их больше негде.
  CREATE TABLE doc_lines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL,
    price      INTEGER NOT NULL DEFAULT 0,
    -- Скидка на позицию, сотые доли процента.
    discount_bp INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX idx_doc_lines_doc ON doc_lines(doc_id);

  -- Оплаты документа — вкладка «Счета и оплаты».
  --
  -- Оплат у одного документа бывает несколько: половину внесли при отгрузке,
  -- остальное через неделю. Каждая — своя строка со своим счётом и датой.
  CREATE TABLE doc_payments (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id  INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    account TEXT    NOT NULL,
    amount  INTEGER NOT NULL,
    -- Оплачено или только выставлено.
    paid    INTEGER NOT NULL DEFAULT 0,
    date    TEXT    NOT NULL
  );

  CREATE INDEX idx_doc_payments_doc ON doc_payments(doc_id);
  `,

  // 14 — счета отдельными записями
  `
  -- Счета до сих пор были именами внутри денежных документов: «Касса
  -- магазина» существовала ровно потому, что кто-то так написал. Завести
  -- новый счёт было нечем, а у существующего не было ни типа, ни реквизитов.
  --
  -- Документы по-прежнему ссылаются на счёт по имени: переписывать их на
  -- ссылки значило бы трогать каждую уже заведённую запись, а имя счёта и
  -- так уникально.
  CREATE TABLE accounts (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    -- store | wallet | bank_card | bank_account | register — его типы.
    type    TEXT NOT NULL DEFAULT 'wallet',
    -- Остаток, с которого счёт начался: то, что лежало до первого документа.
    opening_balance INTEGER NOT NULL DEFAULT 0,
    -- Учитывать ли счёт в общем балансе компании.
    include INTEGER NOT NULL DEFAULT 1,
    -- Через этот счёт проходит эквайринг.
    use_terminal INTEGER NOT NULL DEFAULT 0,
    account_number TEXT,
    -- Банковские реквизиты списком «название → номер», как у компании.
    bank_details   TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    is_default  INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Три счёта, которые были зашиты в коде, становятся записями: без этого
  -- уже заведённые документы ссылались бы на счета, которых нет в списке.
  INSERT INTO accounts (name, type, include, use_terminal, is_default) VALUES
    ('Касса магазина',          'register',     1, 0, 1),
    ('Терминал / Счет в банке', 'bank_account', 1, 1, 0),
    ('Счет в банке',            'bank_account', 1, 0, 0);

  -- Счета, встретившиеся в уже заведённых документах, но не в этой тройке.
  INSERT INTO accounts (name, type)
  SELECT DISTINCT account, 'wallet' FROM money_docs
  WHERE account IS NOT NULL
    AND account NOT IN (SELECT name FROM accounts);

  INSERT INTO accounts (name, type)
  SELECT DISTINCT account_to, 'wallet' FROM money_docs
  WHERE account_to IS NOT NULL
    AND account_to NOT IN (SELECT name FROM accounts);
  `,

  // 15 — карточка магазина
  `
  -- У магазина было одно название. В карточке он показывает адрес, описание,
  -- отметку «по умолчанию» и налоги точки: в разных точках ставки бывают
  -- разными, и чек печатается с той, что у точки.
  ALTER TABLE locations ADD COLUMN address     TEXT;
  ALTER TABLE locations ADD COLUMN description TEXT;
  ALTER TABLE locations ADD COLUMN is_default  INTEGER NOT NULL DEFAULT 0;

  -- Налоги точки — список кодов через запятую. Отдельной таблицей их держать
  -- не за чем: сами налоги лежат в настройках компании одним JSON, и связь
  -- ссылками пришлось бы поддерживать вручную с обеих сторон.
  ALTER TABLE locations ADD COLUMN taxes TEXT NOT NULL DEFAULT '';

  -- Первый заведённый магазин становится магазином по умолчанию: он и так им
  -- был — на него подставлялись документы и чеки.
  UPDATE locations SET is_default = 1
  WHERE id = (SELECT MIN(id) FROM locations WHERE archived = 0);
  `,

  // 16 — карточка контрагента целиком
  `
  -- Физическое лицо или организация. От этого зависит половина карточки:
  -- у человека пол и день рождения, у организации реквизиты, расчётный счёт
  -- и юридический адрес.
  ALTER TABLE counterparties ADD COLUMN party_type TEXT NOT NULL DEFAULT 'person';

  -- Контрагент по умолчанию — тот, что подставляется в документ.
  ALTER TABLE counterparties ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

  -- Накопительная скидка: считать ли клиенту скидку по правилам из
  -- «Лояльности», а не по его личному проценту.
  ALTER TABLE counterparties ADD COLUMN enable_savings INTEGER NOT NULL DEFAULT 0;

  -- Телефонов у клиента бывает несколько: рабочий и личный. Старая колонка
  -- phone остаётся — по ней ищут и на неё смотрят списки, и в ней лежит
  -- первый из списка.
  ALTER TABLE counterparties ADD COLUMN phones TEXT NOT NULL DEFAULT '[]';
  UPDATE counterparties SET phones = '["' || replace(phone, '"', '') || '"]'
  WHERE phone IS NOT NULL AND TRIM(phone) <> '';

  -- Реквизиты организации и банковские — списками «название → номер»,
  -- как у компании и у счёта.
  ALTER TABLE counterparties ADD COLUMN details        TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE counterparties ADD COLUMN bank_details   TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE counterparties ADD COLUMN account_number TEXT;
  ALTER TABLE counterparties ADD COLUMN legal_address  TEXT;
  `,

  // 17 — комментарий к продаже
  `
  -- «Комментарий к продаже» в окне оплаты. Кассир пишет туда то, что иначе
  -- не запомнить: «оплата двумя картами», «обещал занести остаток завтра».
  -- Без колонки поле было бы обманом — набранное исчезало бы с чеком.
  ALTER TABLE sales ADD COLUMN note TEXT;
  `,

  // 18 — долги покупателей
  `
  -- Отсрочка: товар отдали, деньги не взяли. Столько из чека осталось за
  -- покупателем. Раньше окно оплаты отсрочку принимало, а записывать её было
  -- некуда — чек уходил как оплаченный, и деньги, которых нет, попадали
  -- в кассу.
  ALTER TABLE sales ADD COLUMN debt INTEGER NOT NULL DEFAULT 0;

  -- Погашения долга. Отдельной записью, а не убыванием числа в чеке: долг
  -- гасят частями и в разные дни, и «когда и сколько занёс» — это история,
  -- которую нельзя терять, как нельзя терять движения товара.
  CREATE TABLE debt_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id     INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES counterparties(id),
    amount      INTEGER NOT NULL,
    payment     TEXT    NOT NULL DEFAULT 'cash',
    location_id INTEGER REFERENCES locations(id),
    staff_id    INTEGER REFERENCES staff(id),
    created_at  TEXT    NOT NULL
  );

  CREATE INDEX idx_debt_payments_customer ON debt_payments(customer_id);
  CREATE INDEX idx_debt_payments_sale ON debt_payments(sale_id);
  `,

  // 19 — списки рекомендаций
  `
  -- «Рекомендации» на кассе. Список — это правило, по которому подбираются
  -- товары к тому, что уже в чеке: «Покупают вместе» считает по прошлым
  -- чекам, свой список — это отобранные руками товары.
  --
  -- Строка над чеком с надписью «Рекомендации» была одна и не показывала
  -- ничего: подбирать было нечем и настраивать нечего.
  CREATE TABLE reco_lists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    -- 'together' — считается по чекам, 'manual' — отобран руками.
    kind       TEXT    NOT NULL DEFAULT 'together',
    enabled    INTEGER NOT NULL DEFAULT 1,
    -- Сколько товаров показывать: «Количество товаров, шт».
    size       INTEGER NOT NULL DEFAULT 8,
    -- Порядок списков: их перетаскивают за уголок.
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );

  CREATE TABLE reco_items (
    list_id    INTEGER NOT NULL REFERENCES reco_lists(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sort       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (list_id, product_id)
  );

  INSERT INTO reco_lists (name, kind, enabled, size, sort, created_at)
  VALUES ('Покупают вместе', 'together', 1, 8, 0, datetime('now'));
  `,

  // 20 — вид категории на витрине: цвет, порядок, размер плитки, скрытие.
  //
  // Всё это — настройки показа, а не свойства товара, но живут они у самой
  // категории: цвет «Шу Пуэра» один на все кассы магазина, как у него.
  `
  ALTER TABLE categories ADD COLUMN color TEXT;
  ALTER TABLE categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE categories ADD COLUMN big INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE categories ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

  -- Порядок при первом запуске — по алфавиту: иначе все номера были бы
  -- нулями, и список выглядел бы сломанным ещё до первого перетаскивания.
  UPDATE categories
     SET sort = (SELECT COUNT(*) FROM categories other
                  WHERE other.name < categories.name COLLATE NOCASE);
  `,
];

/** Применяет неприменённые миграции. Безопасно вызывать при каждом запуске. */
export function migrate(db: SqlDriver): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );`);

  const row = db.get<{ version: number }>('SELECT version FROM schema_version LIMIT 1');
  const current = row?.version ?? 0;

  if (row === null) {
    db.run('INSERT INTO schema_version (version) VALUES (0)');
  }

  // Каждая миграция — отдельная транзакция: при сбое на середине база остаётся
  // на предыдущей версии целиком, а не в половинчатом состоянии.
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.tx(() => {
      db.exec(MIGRATIONS[i]);
      db.run('UPDATE schema_version SET version = ?', [i + 1]);
    });
  }
}
