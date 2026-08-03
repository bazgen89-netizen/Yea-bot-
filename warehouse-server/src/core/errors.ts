/**
 * Ошибка, которую можно безопасно показать клиенту.
 *
 * Всё, что не ApiError, наружу отдаётся как «внутренняя ошибка»: текст
 * исключения из базы может содержать данные другой организации.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Нужна авторизация') =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'Недостаточно прав') => new ApiError(403, 'forbidden', message);

export const notFound = (message = 'Не найдено') => new ApiError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'conflict', message, details);
