export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string, id: string) =>
  new AppError("not_found", `${what} not found: ${id}`, 404);

export const badRequest = (message: string) =>
  new AppError("bad_request", message, 400);

export const conflict = (message: string) =>
  new AppError("conflict", message, 409);

export const notSupported = (message: string) =>
  new AppError("not_supported", message, 501);
