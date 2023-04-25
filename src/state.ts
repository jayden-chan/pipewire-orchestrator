import { access, readFile, writeFile } from "fs/promises";
import { DaemonContext, RestorableDaemonFields } from "./daemon/daemon";
import { error, warn } from "./logger";

export async function dumpState(context: DaemonContext): Promise<void> {
  const path = context.config.stateFile;
  if (!path) {
    return;
  }

  const restorableFields: RestorableDaemonFields = {
    // TODO: need to actually manifest this state with MIDI commands
    ranges: context.ranges,
    // TODO: need to actually manifest this state with MIDI commands
    mutes: context.mutes,
    // TODO: need to actually manifest this state with MIDI commands
    dials: context.dials,
    ledSaveStates: context.ledSaveStates,
    // TODO: this needs to be cleaned to remove stale
    // action hashes that got put in
    cycleStates: context.cycleStates,
    buttonColors: context.buttonColors,
  };

  await writeFile(path, JSON.stringify(restorableFields), { encoding: "utf8" });
}

export async function restoreState(context: DaemonContext): Promise<void> {
  const path = context.config.stateFile;
  if (!path) {
    return;
  }

  try {
    await access(path);
  } catch (e) {
    warn(`[restore-state]`, `Cannot access state file: ${e}`);
    return;
  }

  try {
    // TODO: ajv
    const stateData = JSON.parse(
      await readFile(path, { encoding: "utf8" })
    ) as RestorableDaemonFields;

    context.ranges = stateData.ranges;
    context.mutes = stateData.mutes;
    context.dials = stateData.dials;
    context.ledSaveStates = stateData.ledSaveStates;
    context.cycleStates = stateData.cycleStates;
    context.buttonColors = stateData.buttonColors;
  } catch (e) {
    error(`[restore-state]`, `Failed to restore state: ${e}`);
  }
}
