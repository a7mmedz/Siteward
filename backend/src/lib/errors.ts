import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import type { Logger } from './logger.js';

export type ErrorDetail = { path: string; message: string };

/** An error that maps directly onto the API error shape `{ error: { code, message, details? } }`. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
  }

  toBody() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

export function zodDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export function validationError(error: z.ZodError): AppError {
  const details = zodDetails(error);
  const message = details.length === 1 ? details[0]!.message : 'Some fields are invalid';
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

/** Parse untrusted input with a Zod schema, throwing a 400 with field details on failure. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route for ${req.method} ${req.path}`));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.toBody() });
      return;
    }
    // Errors raised by express.json(): malformed body or body too large.
    const type = err && typeof err === 'object' && 'type' in err ? err.type : undefined;
    if (type === 'entity.parse.failed') {
      res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
      return;
    }
    if (type === 'entity.too.large') {
      res
        .status(413)
        .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
      return;
    }
    logger.error({ err }, 'Unhandled error');
    res
      .status(500)
      .json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server' } });
  };
}
