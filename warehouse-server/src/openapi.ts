/**
 * Описание API в формате OpenAPI 3.1.
 *
 * Пишется руками, а не выводится из кода: описание — это обещание внешним
 * потребителям (сайт, 1С, бот). Если бы оно генерировалось автоматически,
 * случайное переименование поля молча меняло бы контракт.
 */

const bearer = [{ bearerAuth: [] }];

const errorResponse = {
  description: 'Ошибка',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

function json(schema: object) {
  return { content: { 'application/json': { schema } } };
}

function ok(schema: object, description = 'Успешно') {
  return { description, ...json(schema) };
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: string) => ({ type: 'array', items: ref(name) });

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const locationQuery = {
  name: 'location_id',
  in: 'query',
  schema: { type: 'string', format: 'uuid' },
  description: 'Считать остатки и фильтровать по этой точке. По умолчанию — все точки.',
};

const periodParams = [
  {
    name: 'from',
    in: 'query',
    required: true,
    schema: { type: 'string', format: 'date-time' },
    description: 'Начало периода включительно.',
  },
  {
    name: 'to',
    in: 'query',
    required: true,
    schema: { type: 'string', format: 'date-time' },
    description: 'Конец периода, не включается.',
  },
  locationQuery,
];

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'API склада',
    version: '1.0.0',
    description: [
      'Учёт товаров, остатков и продаж.',
      '',
      '**Единицы измерения.** Деньги передаются целыми копейками (`50000` = 500,00 ₽),',
      'количества — целыми тысячными (`1500` = 1,5 кг). Дробных чисел в API нет:',
      'на длинных чеках они накапливают ошибку округления.',
      '',
      '**Авторизация.** Заголовок `Authorization: Bearer <токен>`. Токен получают',
      'входом по паролю (`/auth/login`) либо выпускают как ключ интеграции',
      '(`/api-keys`, префикс `whk_`).',
      '',
      '**Права.** Владелец видит и может всё. Продавец продаёт и видит остатки,',
      'но не заводит товары, не оформляет приход и не открывает отчёты; закупочные',
      'цены и прибыль ему не отдаются вовсе. Ключ интеграции ограничен своими',
      '`scopes`: `read` или `read` + `write`.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'Текущий сервер' }],
  security: bearer,
  tags: [
    { name: 'Авторизация' },
    { name: 'Сотрудники' },
    { name: 'Ключи интеграций' },
    { name: 'Точки' },
    { name: 'Товары' },
    { name: 'Склад' },
    { name: 'Продажи' },
    { name: 'Отчёты' },
    { name: 'Контрагенты' },
    { name: 'Загрузка данных' },
    { name: 'Синхронизация' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Авторизация'],
        summary: 'Проверка живости сервера',
        security: [],
        responses: { 200: ok({ type: 'object', properties: { ok: { type: 'boolean' } } }) },
      },
    },
    '/api/v1/auth/register': {
      post: {
        tags: ['Авторизация'],
        summary: 'Создать организацию и её владельца',
        description: 'Заодно создаёт первую точку — без неё некуда оприходовать товар.',
        security: [],
        requestBody: json({
          type: 'object',
          required: ['org_name', 'name', 'email', 'password'],
          properties: {
            org_name: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
        }),
        responses: { 201: ok(ref('Session')), 400: errorResponse, 409: errorResponse },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Авторизация'],
        summary: 'Войти по почте и паролю',
        security: [],
        requestBody: json({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
            device_name: { type: 'string', description: 'Название устройства для списка сессий.' },
          },
        }),
        responses: { 200: ok(ref('Session')), 401: errorResponse },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Авторизация'],
        summary: 'Завершить текущую сессию',
        responses: { 200: ok({ type: 'object', properties: { ok: { type: 'boolean' } } }) },
      },
    },
    '/api/v1/me': {
      get: {
        tags: ['Авторизация'],
        summary: 'Кто я',
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/v1/users': {
      get: {
        tags: ['Сотрудники'],
        summary: 'Список сотрудников',
        description: 'Только владелец.',
        responses: { 200: ok(arrayOf('User')), 403: errorResponse },
      },
      post: {
        tags: ['Сотрудники'],
        summary: 'Добавить сотрудника',
        requestBody: json({
          type: 'object',
          required: ['name', 'email', 'password', 'role'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            role: { type: 'string', enum: ['owner', 'seller'] },
          },
        }),
        responses: { 201: ok(ref('User')), 403: errorResponse, 409: errorResponse },
      },
    },
    '/api/v1/users/{id}': {
      patch: {
        tags: ['Сотрудники'],
        summary: 'Изменить сотрудника',
        description:
          'Смена пароля и отключение закрывают его открытые сессии. Владелец не может понизить или отключить сам себя.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: json({
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string', enum: ['owner', 'seller'] },
            disabled: { type: 'boolean' },
            password: { type: 'string', minLength: 8 },
          },
        }),
        responses: { 200: ok(ref('User')), 400: errorResponse, 403: errorResponse },
      },
    },
    '/api/v1/api-keys': {
      get: {
        tags: ['Ключи интеграций'],
        summary: 'Список ключей',
        responses: { 200: ok(arrayOf('ApiKey')) },
      },
      post: {
        tags: ['Ключи интеграций'],
        summary: 'Выпустить ключ',
        description: 'Полный ключ возвращается один раз: в базе хранится только его хеш.',
        requestBody: json({
          type: 'object',
          required: ['name', 'scopes'],
          properties: {
            name: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string', enum: ['read', 'write'] } },
          },
        }),
        responses: { 201: ok(ref('ApiKeyCreated')), 403: errorResponse },
      },
    },
    '/api/v1/api-keys/{id}': {
      delete: {
        tags: ['Ключи интеграций'],
        summary: 'Отозвать ключ',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok({ type: 'object' }), 404: errorResponse },
      },
    },
    '/api/v1/locations': {
      get: { tags: ['Точки'], summary: 'Список точек', responses: { 200: ok(arrayOf('Location')) } },
      post: {
        tags: ['Точки'],
        summary: 'Создать точку',
        requestBody: json({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' }, address: { type: 'string' } },
        }),
        responses: { 201: ok(ref('Location')), 403: errorResponse },
      },
    },
    '/api/v1/locations/{id}': {
      patch: {
        tags: ['Точки'],
        summary: 'Изменить точку',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: json({
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'string', nullable: true },
            archived: { type: 'boolean' },
          },
        }),
        responses: { 200: ok(ref('Location')), 404: errorResponse },
      },
    },
    '/api/v1/categories': {
      get: { tags: ['Товары'], summary: 'Категории', responses: { 200: ok(arrayOf('Category')) } },
      post: {
        tags: ['Товары'],
        summary: 'Создать категорию',
        description: 'Если категория с таким названием уже есть, возвращается она же.',
        requestBody: json({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        }),
        responses: { 201: ok(ref('Category')) },
      },
    },
    '/api/v1/products': {
      get: {
        tags: ['Товары'],
        summary: 'Список товаров с остатками',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Название, артикул или штрихкод.' },
          locationQuery,
          { name: 'category_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'low_stock', in: 'query', schema: { type: 'boolean' }, description: 'Только те, где остаток не выше порога.' },
          { name: 'include_archived', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000 } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: ok(arrayOf('Product')) },
      },
      post: {
        tags: ['Товары'],
        summary: 'Завести товар',
        requestBody: json(ref('ProductInput')),
        responses: { 201: ok(ref('Product')), 403: errorResponse, 409: errorResponse },
      },
    },
    '/api/v1/products/{id}': {
      get: {
        tags: ['Товары'],
        summary: 'Товар с остатком',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          locationQuery,
        ],
        responses: { 200: ok(ref('Product')), 404: errorResponse },
      },
      patch: {
        tags: ['Товары'],
        summary: 'Изменить товар',
        description: 'Меняются только переданные поля. `null` очищает поле, отсутствие поля оставляет как было.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: json(ref('ProductInput')),
        responses: { 200: ok(ref('Product')), 404: errorResponse, 409: errorResponse },
      },
    },
    '/api/v1/products/by-barcode/{barcode}': {
      get: {
        tags: ['Товары'],
        summary: 'Найти товар по штрихкоду',
        parameters: [
          { name: 'barcode', in: 'path', required: true, schema: { type: 'string' } },
          locationQuery,
        ],
        responses: { 200: ok(ref('Product')), 404: errorResponse },
      },
    },
    '/api/v1/products/{id}/stock': {
      get: {
        tags: ['Склад'],
        summary: 'Остатки товара по точкам',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok(arrayOf('StockByLocation')) },
      },
    },
    '/api/v1/products/{id}/moves': {
      get: {
        tags: ['Склад'],
        summary: 'История движений товара',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          locationQuery,
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
        ],
        responses: { 200: ok(arrayOf('StockMove')) },
      },
    },
    '/api/v1/docs': {
      get: {
        tags: ['Склад'],
        summary: 'Журнал документов',
        parameters: [locationQuery, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: ok(arrayOf('Doc')), 403: errorResponse },
      },
      post: {
        tags: ['Склад'],
        summary: 'Провести приход, списание или перемещение',
        description:
          'Перемещение (`transfer`) требует `to_location_id` и пишет два движения на позицию: минус на исходной точке, плюс на целевой.',
        requestBody: json(ref('DocInput')),
        responses: { 201: ok(ref('Doc')), 400: errorResponse, 403: errorResponse },
      },
    },
    '/api/v1/docs/adjust': {
      post: {
        tags: ['Склад'],
        summary: 'Инвентаризация',
        description: 'Выставляет остаток равным факту и записывает разницу движением.',
        requestBody: json({
          type: 'object',
          required: ['product_id', 'location_id', 'actual_qty'],
          properties: {
            product_id: { type: 'string', format: 'uuid' },
            location_id: { type: 'string', format: 'uuid' },
            actual_qty: { type: 'integer', description: 'Фактический остаток, тысячные.' },
            note: { type: 'string' },
          },
        }),
        responses: {
          201: ok({
            type: 'object',
            properties: { delta: { type: 'integer' }, doc: ref('Doc') },
          }),
        },
      },
    },
    '/api/v1/sales': {
      get: {
        tags: ['Продажи'],
        summary: 'Список чеков',
        parameters: [locationQuery, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: ok(arrayOf('Sale')) },
      },
      post: {
        tags: ['Продажи'],
        summary: 'Провести продажу',
        description: [
          'Остаток проверяется на сервере, а не по данным клиента.',
          'Себестоимость берётся из карточки товара — присланная в позиции игнорируется.',
          'Повторная отправка с тем же `id` возвращает уже созданный чек и не списывает остаток второй раз.',
        ].join(' '),
        requestBody: json(ref('SaleInput')),
        responses: { 201: ok(ref('Sale')), 400: errorResponse, 409: errorResponse },
      },
    },
    '/api/v1/sales/{id}': {
      get: {
        tags: ['Продажи'],
        summary: 'Чек с позициями',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok(ref('Sale')), 404: errorResponse },
      },
    },
    '/api/v1/sales/{id}/refund': {
      post: {
        tags: ['Продажи'],
        summary: 'Оформить возврат',
        description: 'Товар возвращается на склад, суммы чека обнуляются. Повторный возврат отклоняется.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok(ref('Sale')), 409: errorResponse },
      },
    },
    '/api/v1/reports/summary': {
      get: {
        tags: ['Отчёты'],
        summary: 'Выручка, прибыль, средний чек',
        parameters: periodParams,
        responses: { 200: ok(ref('SalesSummary')), 403: errorResponse },
      },
    },
    '/api/v1/reports/top-products': {
      get: {
        tags: ['Отчёты'],
        summary: 'Лучшие товары по выручке',
        parameters: [...periodParams, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }) },
      },
    },
    '/api/v1/reports/daily': {
      get: {
        tags: ['Отчёты'],
        summary: 'Выручка по дням',
        parameters: periodParams,
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }) },
      },
    },
    '/api/v1/reports/by-location': {
      get: {
        tags: ['Отчёты'],
        summary: 'Выручка в разрезе точек',
        parameters: periodParams,
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }) },
      },
    },
    '/api/v1/reports/stock-value': {
      get: {
        tags: ['Отчёты'],
        summary: 'Сколько денег лежит на складе',
        parameters: [locationQuery],
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/v1/counterparties': {
      get: {
        tags: ['Контрагенты'],
        summary: 'Список клиентов и поставщиков',
        description: 'Долг считается из первички: чеки в долг минус поставки и платежи.',
        parameters: [
          {
            name: 'kind',
            in: 'query',
            schema: { type: 'string', enum: ['customer', 'supplier', 'both'] },
            description: 'Записи `both` попадают и в клиентов, и в поставщиков.',
          },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'include_archived', in: 'query', schema: { type: 'boolean' } },
          { name: 'with_debt', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }) },
      },
      post: {
        tags: ['Контрагенты'],
        summary: 'Завести карточку',
        description: 'Доступно и продавцу: нового клиента заводят прямо на кассе.',
        requestBody: json({ type: 'object' }),
        responses: { 201: ok({ type: 'object' }), 400: errorResponse },
      },
    },
    '/api/v1/counterparties/{id}': {
      get: {
        tags: ['Контрагенты'],
        summary: 'Карточка вместе с долгом',
        parameters: [idParam],
        responses: { 200: ok({ type: 'object' }), 404: errorResponse },
      },
      patch: {
        tags: ['Контрагенты'],
        summary: 'Изменить карточку',
        parameters: [idParam],
        requestBody: json({ type: 'object' }),
        responses: { 200: ok({ type: 'object' }), 403: errorResponse, 404: errorResponse },
      },
    },
    '/api/v1/counterparties/{id}/history': {
      get: {
        tags: ['Контрагенты'],
        summary: 'Продажи, поставки и платежи одной лентой',
        parameters: [idParam, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }), 403: errorResponse },
      },
    },
    '/api/v1/counterparties/{id}/payments': {
      get: {
        tags: ['Контрагенты'],
        summary: 'Платежи по контрагенту',
        parameters: [idParam],
        responses: { 200: ok({ type: 'array', items: { type: 'object' } }), 403: errorResponse },
      },
      post: {
        tags: ['Контрагенты'],
        summary: 'Погасить долг',
        description: 'Клиент вернул деньги или мы заплатили поставщику. Сумма в копейках.',
        parameters: [idParam],
        requestBody: json({ type: 'object' }),
        responses: { 201: ok({ type: 'object' }), 400: errorResponse, 403: errorResponse },
      },
    },
    '/api/v1/import/products': {
      post: {
        tags: ['Загрузка данных'],
        summary: 'Загрузить каталог из выгрузки другой программы',
        description: [
          'Товар опознаётся по коду; кода нет — по штрихкоду, потом по артикулу.',
          'Совпало — карточка обновляется, не совпало — заводится новая, поэтому',
          'повторная загрузка того же файла не плодит дубли.',
          'Остатки в `stocks` проставляются инвентаризацией — как итог, а не приход.',
        ].join(' '),
        requestBody: json({ type: 'object' }),
        responses: { 200: ok({ type: 'object' }), 400: errorResponse, 403: errorResponse },
      },
    },
    '/api/v1/import/counterparties': {
      post: {
        tags: ['Загрузка данных'],
        summary: 'Загрузить клиентскую базу',
        description: [
          'Человек опознаётся по последним десяти цифрам телефона — так совпадают',
          '«+7 999…» и «8 (999) …». Телефона нет — по имени.',
          'Пустые поля в выгрузке не затирают заполненные в базе.',
        ].join(' '),
        requestBody: json({ type: 'object' }),
        responses: { 200: ok({ type: 'object' }), 400: errorResponse, 403: errorResponse },
      },
    },
    '/api/v1/sync/push': {
      post: {
        tags: ['Синхронизация'],
        summary: 'Отправить накопленные офлайн изменения',
        description: [
          'Справочники сливаются по времени правки: побеждает более поздняя.',
          'События вставляются один раз — повторная отправка того же чека ничего не меняет.',
          'Продажа не проверяется на остаток: она уже случилась.',
        ].join(' '),
        requestBody: json(ref('PushPayload')),
        responses: { 200: ok(ref('PushResult')), 400: errorResponse, 403: errorResponse },
      },
    },
    '/api/v1/sync/pull': {
      get: {
        tags: ['Синхронизация'],
        summary: 'Забрать изменения после указанного номера',
        parameters: [
          { name: 'since', in: 'query', schema: { type: 'integer' }, description: 'Последний полученный номер. 0 — забрать всё.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 2000 } },
        ],
        responses: { 200: ok(ref('PullResult')) },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Токен сессии или ключ интеграции (`whk_...`).' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', examples: ['out_of_stock'] },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
      Session: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
          user: ref('User'),
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['owner', 'seller'] },
          disabled: { type: 'boolean' },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          key_prefix: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          revoked_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ApiKeyCreated: {
        allOf: [ref('ApiKey'), {
          type: 'object',
          properties: { key: { type: 'string', description: 'Показывается один раз.' } },
        }],
      },
      Location: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          address: { type: 'string', nullable: true },
          archived: { type: 'boolean' },
          seq: { type: 'integer' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
      ProductInput: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Можно задать своим — так работает офлайн-создание.' },
          name: { type: 'string' },
          sku: { type: 'string', nullable: true },
          barcode: { type: 'string', nullable: true },
          category_id: { type: 'string', format: 'uuid', nullable: true },
          category_name: { type: 'string', description: 'Альтернатива category_id: категория создастся при необходимости.' },
          unit: { type: 'string', examples: ['кг'] },
          cost_price: { type: 'integer', description: 'Закупочная цена за единицу, копейки.' },
          sale_price: { type: 'integer', description: 'Цена продажи за единицу, копейки.' },
          min_qty: { type: 'integer', description: 'Порог «заканчивается», тысячные. 0 — не следить.' },
          photo_uri: { type: 'string', nullable: true },
        },
      },
      Product: {
        allOf: [ref('ProductInput'), {
          type: 'object',
          properties: {
            stock: { type: 'integer', description: 'Остаток, тысячные.' },
            archived: { type: 'boolean' },
            seq: { type: 'integer' },
          },
        }],
      },
      StockByLocation: {
        type: 'object',
        properties: {
          location_id: { type: 'string', format: 'uuid' },
          location_name: { type: 'string' },
          stock: { type: 'integer' },
        },
      },
      StockMove: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          product_id: { type: 'string', format: 'uuid' },
          location_id: { type: 'string', format: 'uuid' },
          qty_delta: { type: 'integer', description: 'Плюс — приход, минус — расход. Тысячные.' },
          reason: { type: 'string', enum: ['receipt', 'writeoff', 'sale', 'adjust', 'return', 'transfer'] },
          price: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      DocInput: {
        type: 'object',
        required: ['type', 'location_id', 'lines'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['receipt', 'writeoff', 'transfer'] },
          location_id: { type: 'string', format: 'uuid' },
          to_location_id: { type: 'string', format: 'uuid', description: 'Только для перемещения.' },
          counterparty: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['product_id', 'qty'],
              properties: {
                product_id: { type: 'string', format: 'uuid' },
                qty: { type: 'integer', description: 'Всегда положительное, тысячные.' },
                price: { type: 'integer', description: 'Закупочная цена за единицу, копейки.' },
              },
            },
          },
        },
      },
      Doc: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string' },
          location_id: { type: 'string', format: 'uuid' },
          to_location_id: { type: 'string', format: 'uuid', nullable: true },
          counterparty: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          seq: { type: 'integer' },
        },
      },
      SaleInput: {
        type: 'object',
        required: ['location_id', 'lines'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Свой идентификатор делает повтор безопасным.' },
          location_id: { type: 'string', format: 'uuid' },
          discount: { type: 'integer', description: 'Скидка на весь чек, копейки.' },
          payment: { type: 'string', enum: ['cash', 'card', 'transfer'] },
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['product_id', 'qty', 'price'],
              properties: {
                product_id: { type: 'string', format: 'uuid' },
                qty: { type: 'integer' },
                price: { type: 'integer', description: 'Цена продажи за единицу, копейки.' },
              },
            },
          },
        },
      },
      Sale: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          location_id: { type: 'string', format: 'uuid' },
          discount: { type: 'integer' },
          total: { type: 'integer', description: 'К оплате после скидки, копейки.' },
          cost_total: { type: 'integer', description: 'Себестоимость. Продавцу не отдаётся.' },
          payment: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          refunded_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      SalesSummary: {
        type: 'object',
        properties: {
          revenue: { type: 'integer' },
          cost: { type: 'integer' },
          profit: { type: 'integer' },
          discounts: { type: 'integer' },
          receipts: { type: 'integer' },
          averageReceipt: { type: 'integer' },
        },
      },
      PushPayload: {
        type: 'object',
        description: 'Каждая таблица — массив строк с идентификаторами, созданными на устройстве.',
        properties: {
          locations: { type: 'array', items: { type: 'object' } },
          categories: { type: 'array', items: { type: 'object' } },
          products: { type: 'array', items: { type: 'object' } },
          docs: { type: 'array', items: { type: 'object' } },
          sales: { type: 'array', items: { type: 'object' } },
          sale_items: { type: 'array', items: { type: 'object' } },
          stock_moves: { type: 'array', items: { type: 'object' } },
        },
      },
      PushResult: {
        type: 'object',
        properties: {
          cursor: { type: 'integer', description: 'Номер, до которого сервер учёл изменения.' },
          applied: { type: 'object', description: 'Сколько строк реально записалось по каждой таблице.' },
        },
      },
      PullResult: {
        type: 'object',
        properties: {
          changes: { type: 'object' },
          cursor: { type: 'integer' },
          has_more: { type: 'boolean', description: 'Нужно запросить следующую страницу с новым since.' },
        },
      },
    },
  },
} as const;
