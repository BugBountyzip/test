import { SDK } from "caido:plugin";
import {
  type Result,
  type Scan,
  type ScanTarget,
  type TemplateResult,
} from "shared";
import { ScanStore } from "../stores/scans";
import { SettingsStore } from "../stores/settings";
import { runScanWorker } from "../services/scanner";
import { CaidoBackendSDK } from "@/types";
import { parseRequest } from "../utils/utils";

export function getTemplateResults(
  sdk: SDK,
  scanID: number
): Result<TemplateResult[]> {
  const scanStore = ScanStore.get();
  const scan = scanStore.getScan(scanID);

  if (!scan) return { kind: "Error", error: "Scan not found" };
  return { kind: "Success", value: scan.Results || [] };
}

export const getTemplateResult = (
  sdk: SDK,
  scanID: number,
  templateResultID: number
): Result<TemplateResult> => {
  const scanStore = ScanStore.get();
  const scan = scanStore.getScan(scanID);
  
  if (!scan) return { kind: "Error", error: "Scan not found" };
  const templateResult = scan.Results.find((result) => result.ID === templateResultID);
  
  if (!templateResult) return { kind: "Error", error: "Template result not found" };
  return { kind: "Success", value: templateResult };
};

export const getScans = (sdk: SDK): Result<Scan[]> => {
  const scanStore = ScanStore.get();
  return { kind: "Success", value: scanStore.getScans() };
};

export const getScan = (
  sdk: SDK,
  scanID: number
): Result<Omit<Scan, "Results">> => {
  const scanStore = ScanStore.get();
  const scan = scanStore.getScan(scanID);

  if (scan) return { kind: "Success", value: scan };
  return { kind: "Error", error: "Scan not found" };
};

const getHighestId = (): number => {
  const scanStore = ScanStore.get();
  const scans = scanStore.getScans();
  return scans.reduce((maxId, scan) => Math.max(maxId, scan.ID), 0);
}

export const addScan = async (
  sdk: CaidoBackendSDK,
  target: ScanTarget
): Promise<Result<Scan>> => {
  try {
    
    if (target.request) {
      try {
        parseRequest(target.request);
      } catch (error) {
        return { kind: "Error", error: `Invalid request format: ${error.message}` };
      }
    }

    const scanStore = ScanStore.get();
    const nextID = getHighestId() + 1;

    const scan: Scan = {
      ID: nextID,
      State: "Running",
      Target: target,
      startedAt: new Date(),
      Results: [],
    };

    scanStore.addScan(scan);
    sdk.api.send("scans:created", scan);
    return { kind: "Success", value: scan };
  } catch (error) {
    return { kind: "Error", error: `Failed to add scan: ${error.message}` };
  }
};

export const deleteScan = (sdk: CaidoBackendSDK, id: number): Result<void> => {
  try {
    const scanStore = ScanStore.get();
    cancelScan(sdk, id);
    scanStore.deleteScan(id);

    sdk.api.send("scans:deleted", id);
    return { kind: "Success", value: undefined };
  } catch (error) {
    return { kind: "Error", error: `Failed to delete scan: ${error.message}` };
  }
};

export const updateScan = (
  sdk: CaidoBackendSDK,
  id: number,
  fields: Partial<Scan>
): Result<Scan> => {
  try {
    const scanStore = ScanStore.get();
    const scan = scanStore.updateScan(id, fields);
    if (!scan) {
      return { kind: "Error", error: "Scan not found" };
    }

    sdk.api.send("scans:updated", id, fields);
    return { kind: "Success", value: scan };
  } catch (error) {
    return { kind: "Error", error: `Failed to update scan: ${error.message}` };
  }
};

export const runScan = async (
  sdk: CaidoBackendSDK,
  scanID: number
): Promise<Result<Scan>> => {
  const scanStore = ScanStore.get();
  const scan = scanStore.getScan(scanID);
  const settingsStore = SettingsStore.get();
  const settings = settingsStore.getSettings();

  if (!scan) return { kind: "Error", error: "Scan not found" };

  // Validate request format
  try {
    if (scan.Target && scan.Target.request) {
      parseRequest(scan.Target.request);
    } else {
      throw new Error("Invalid scan target: Missing request data");
    }
  } catch (error) {
    return { kind: "Error", error: `Invalid request format: ${error.message}` };
  }

  let timeoutHandler: NodeJS.Timeout | null = null;

  try {
    scanStore.updateScan(scan.ID, { State: "Running" });
    sdk.api.send("scans:updated", scan.ID, { State: "Running" });

    timeoutHandler = setTimeout(() => {
      sdk.console.log(
        `Scan ${scan.ID} timed out after ${settings.scanTimeout}ms`
      );

      scanStore.updateScan(scan.ID, { 
        State: "Timed Out",
        finishedAt: new Date()
      });
      sdk.api.send("scans:updated", scan.ID, { 
        State: "Timed Out",
        finishedAt: new Date()
      });
    }, settings.scanTimeout);

    await runScanWorker(sdk, scan);

    if (timeoutHandler) {
      clearTimeout(timeoutHandler);
    }

    const finishedAt = new Date();
    scanStore.updateScan(scan.ID, { 
      State: "Completed",
      finishedAt 
    });
    sdk.api.send("scans:updated", scan.ID, { 
      State: "Completed",
      finishedAt 
    });

    return { kind: "Success", value: scan };

  } catch (error) {
    if (timeoutHandler) {
      clearTimeout(timeoutHandler);
    }

    sdk.console.log(`Scan error: ${error.message || error}`);
    
    const finishedAt = new Date();
    scanStore.updateScan(scan.ID, { 
      State: "Failed",
      finishedAt,
      error: error.message || "Unknown error during scan execution"
    });
    sdk.api.send("scans:updated", scan.ID, { 
      State: "Failed",
      finishedAt,
      error: error.message || "Unknown error during scan execution"
    });

    return { 
      kind: "Error", 
      error: `Scan failed: ${error.message || "Unknown error"}` 
    };
  }
};

export const reRunScan = async (
  sdk: SDK,
  scanID: number
): Promise<Result<Scan>> => {
  try {
    const scanStore = ScanStore.get();
    const scan = scanStore.getScan(scanID);

    if (!scan) return { kind: "Error", error: "Scan not found" };

    const newScan = await addScan(sdk, scan.Target);
    if (newScan.kind === "Error") {
      return newScan;
    }

    return await runScan(sdk, newScan.value.ID);
  } catch (error) {
    return { kind: "Error", error: `Failed to rerun scan: ${error.message}` };
  }
};

export const clearScans = (sdk: CaidoBackendSDK): Result<void> => {
  try {
    const scanStore = ScanStore.get();
    const scans = scanStore.getScans();
    
    scans.forEach((scan) => {
      if (scan.State === "Running") {
        cancelScan(sdk, scan.ID);
      }
    });

    scanStore.clearScans();
    sdk.api.send("scans:cleared");
    return { kind: "Success", value: undefined };
  } catch (error) {
    return { kind: "Error", error: `Failed to clear scans: ${error.message}` };
  }
};

export const cancelScan = (sdk: CaidoBackendSDK
