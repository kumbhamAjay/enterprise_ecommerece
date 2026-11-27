export class HttpError extends Error {
  // `extra` is merged into the JSON error body, e.g. { productId } so the client can point at the culprit
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
