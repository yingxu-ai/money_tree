import { resolveErrorMessage } from "@/config/errorCodes";

export class ApiError extends Error {
  code: number;
  traceId: string;

  constructor(code: number, message: string, traceId = "") {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.traceId = traceId;
  }

  static fromResponse(code: number, message?: string, traceId?: string): ApiError {
    return new ApiError(code, resolveErrorMessage(code, message), traceId);
  }

  get isAuthError(): boolean {
    return this.code === 2001 || this.code === 2002;
  }

  get isPermissionError(): boolean {
    return this.code === 2003;
  }
}
