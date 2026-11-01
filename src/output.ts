export interface JsonSuccess {
  ok: true;
  [key: string]: unknown;
}

export interface JsonError {
  ok: false;
  error: string;
  code: string;
  errors?: Record<string, string[]>;
  status_code?: number;
  request_id?: string;
}

export function printJson(data: JsonSuccess | JsonError): void {
  console.log(JSON.stringify(data));
}

export function printHuman(message: string): void {
  console.error(message);
}

function withRequestId(message: string, requestId?: string): string {
  return requestId ? `${message} (request id ${requestId})` : message;
}

export function formatSendSuccess(
  duplicate: boolean,
  publicId: string,
  json: boolean,
  requestId?: string,
): void {
  if (json) {
    return;
  }
  if (duplicate) {
    printHuman(withRequestId(`Event already exists (${publicId})`, requestId));
  } else {
    printHuman(withRequestId(`Event queued (${publicId})`, requestId));
  }
}

export function formatConnectionSuccess(
  workspaceName: string,
  json: boolean,
  requestId?: string,
): void {
  if (json) {
    return;
  }
  printHuman(withRequestId(`Connected to workspace "${workspaceName}"`, requestId));
}

export function formatSetKeySuccess(location: string, json: boolean): void {
  if (json) {
    return;
  }
  printHuman(`API key stored in ${location}`);
}
