export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const badRequest = (m, extra) => new HttpError(400, m, extra);
export const unauthorized = (m = '請先登入') => new HttpError(401, m);
export const forbidden = (m = '您沒有權限執行此操作') => new HttpError(403, m);
export const notFound = (m = '找不到資料') => new HttpError(404, m);
export const conflict = (m, extra) => new HttpError(409, m, extra);
