import { Response } from "express";

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  } | null;
  meta?: any;
}

export const sendSuccess = <T>(res: Response, data: T, meta?: any, statusCode = 200) => {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta,
  };
  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  message: string,
  code = "INTERNAL_SERVER_ERROR",
  statusCode = 500,
  details?: any
) => {
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
  return res.status(statusCode).json(response);
};
