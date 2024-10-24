import { mkdir } from "fs/promises";
import { SDK } from "caido:plugin";
import * as path from "path";

export async function ensureDir(sdk: SDK): Promise<boolean> {
  try {
    const dir = getTemplateDir(sdk);
    await mkdir(dir, { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

export function fixWindowsPath(inputPath: string): string {
  if (/^[a-zA-Z]:[^\\/]/.test(inputPath)) {
    return inputPath.replace(/^([a-zA-Z]:)(.*)$/, '$1\\$2');
  }
  return inputPath;
}

export function getTemplatePath(sdk: SDK, templateID: string): string {
  return fixWindowsPath(path.join(sdk.meta.path(), "templates", templateID + ".yaml"));
}

export function getTemplateDir(sdk: SDK): string {
  return fixWindowsPath(path.join(sdk.meta.path(), "templates"));
}

export function parseRequest(requestString: string): Record<string, any> {
  try {
    if (!requestString || typeof requestString !== 'string') {
      throw new Error('Invalid request string provided');
    }

    const request: Record<string, any> = {};
    const lines = requestString.split(/\r?\n/);

    if (lines.length === 0) {
      throw new Error('Empty request string');
    }

    const parsedRequestLine = parseRequestLine(lines.shift() || "");
    if (!parsedRequestLine.method || !parsedRequestLine.uri) {
      throw new Error('Invalid request line format');
    }

    request["method"] = parsedRequestLine["method"];
    request["uri"] = parsedRequestLine["uri"];
    request["protocol"] = parsedRequestLine["protocol"] || "HTTP/1.1";

    const headerLines: string[] = [];
    while (lines.length > 0) {
      const line = lines.shift();
      if (line === "") break;
      if (line) headerLines.push(line);
    }

    request["headers"] = parseHeaders(headerLines);
    request["body"] = lines.join("\r\n");

    if (!request.method || !request.uri) {
      throw new Error('Missing required request fields');
    }

    return request;
  } catch (error) {
    throw new Error(`Request parsing failed: ${error.message}`);
  }
}

export function parseResponse(responseString: string): Record<string, any> {
  try {
    if (!responseString || typeof responseString !== 'string') {
      throw new Error('Invalid response string provided');
    }

    const response: Record<string, any> = {};
    const lines = responseString.split(/\r?\n/);

    if (lines.length === 0) {
      throw new Error('Empty response string');
    }

    const parsedStatusLine = parseStatusLine(lines.shift() || "");
    if (!parsedStatusLine.statusCode) {
      throw new Error('Invalid status line format');
    }

    response["protocolVersion"] = parsedStatusLine["protocol"] || "HTTP/1.1";
    response["statusCode"] = parsedStatusLine["statusCode"];
    response["statusMessage"] = parsedStatusLine["statusMessage"];

    const headerLines: string[] = [];
    while (lines.length > 0) {
      const line = lines.shift();
      if (line === "") break;
      if (line) headerLines.push(line);
    }

    response["headers"] = parseHeaders(headerLines);
    response["body"] = lines.join("\r\n");

    return response;
  } catch (error) {
    throw new Error(`Response parsing failed: ${error.message}`);
  }
}

export function parseHeaders(headerLines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    if (!line.includes(':')) continue;
    const parts = line.split(":");
    const key = parts.shift()?.trim() || "";
    if (key) headers[key.toLowerCase()] = parts.join(":").trim();
  }
  return headers;
}

export function parseStatusLine(statusLine: string): Record<string, string | undefined> {
  const parts = statusLine.match(/^(.+) ([0-9]{3}) (.*)$/);
  const parsed: Record<string, string | undefined> = {};

  if (parts !== null) {
    parsed["protocol"] = parts[1];
    parsed["statusCode"] = parts[2];
    parsed["statusMessage"] = parts[3];
  } else {
    throw new Error('Invalid status line format');
  }

  return parsed;
}

export function parseRequestLine(requestLineString: string): Record<string, string | undefined> {
  const parts = requestLineString.trim().split(/\s+/);
  const parsed: Record<string, string | undefined> = {};

  if (parts.length < 2) {
    throw new Error('Invalid request line format');
  }

  parsed["method"] = parts[0].toUpperCase();
  parsed["uri"] = parts[1];
  parsed["protocol"] = parts[2] || "HTTP/1.1";

  return parsed;
}

export function validateTemplate(template: any): {
  message?: string;
  valid: boolean;
} {
  if (typeof template !== "object" || template === null) {
    return {
      message: "Template must be an object",
      valid: false,
    };
  }

  if (typeof template.id !== "string" || template.id.trim() === "") {
    return {
      message: "Template must have a non-empty string ID",
      valid: false,
    };
  }

  if (!/^[a-zA-Z0-9-]+$/.test(template.id)) {
    return {
      message: "Template ID must only contain alphanumeric characters and dashes",
      valid: false,
    };
  }

  if (template.id.length > 100) {
    return {
      message: "Template ID must be less than 100 characters",
      valid: false,
    };
  }

  if (typeof template.enabled !== "boolean") {
    return {
      message: "Template must have a boolean enabled",
      valid: false,
    };
  }

  if (typeof template.modificationScript !== "string") {
    return {
      message: "Template must have a string modificationScript",
      valid: false,
    };
  }

  return {
    valid: true,
  };
}
