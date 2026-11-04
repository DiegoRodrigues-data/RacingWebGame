export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_REUSED: 401,
  FORBIDDEN: 403,
  ACCOUNT_LOCKED: 423,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  NICKNAME_TAKEN: 409,
  ALREADY_REGISTERED: 409,
  NOT_REGISTERED: 409,
  RACE_FULL: 409,
  REGISTRATION_CLOSED: 409,
  SCHEDULE_CONFLICT: 409,
  INELIGIBLE_LEVEL: 403,
  EMAIL_NOT_VERIFIED: 403,
  TRACE_WINDOW_CLOSED: 409,
  TRACE_OUT_OF_BOUNDS: 422,
  TRACE_INVALID: 422,
  TRACE_RATE_LIMITED: 429,
  SETUP_LOCKED: 409,
  SETUP_INVALID: 422,
  CAR_TAKEN: 409,
  INVALID_TRANSITION: 409,
  TRACK_INVALID: 422,
  TRACK_NOT_PUBLISHED: 409,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.status = ERROR_CODES[code];
  }
  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
