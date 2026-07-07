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
}

export function printJson(data: JsonSuccess | JsonError): void {
  console.log(JSON.stringify(data));
}

export function printHuman(message: string): void {
  console.error(message);
}

export function formatSendSuccess(duplicate: boolean, publicId: string, json: boolean): void {
  if (json) {
    return;
  }
  if (duplicate) {
    printHuman(`Event already exists (${publicId})`);
  } else {
    printHuman(`Event queued (${publicId})`);
  }
}

export function formatConnectionSuccess(workspaceName: string, json: boolean): void {
  if (json) {
    return;
  }
  printHuman(`Connected to workspace "${workspaceName}"`);
}

export function formatSetKeySuccess(location: string, json: boolean): void {
  if (json) {
    return;
  }
  printHuman(`API key stored in ${location}`);
}
