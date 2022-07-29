import { Bindings, DialRange, readConfig } from "../config";
import { Button, Range } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { debug, error, log, warn } from "../logger";
import {
  amidiSend,
  amidiSendBatched,
  ByteTriplet,
  MidiEvent,
  midiEventToNumber,
  MidiEventType,
  watchMidi,
} from "../midi";
import { midish } from "../midi/midish";
import { run } from "../util";

const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

const MAP_FUNCTIONS = {
  IDENTITY: (input: any) => input,
  SQUARED: (input: number) => input * input,
  SQRT: (input: number) => Math.sqrt(input),
};

function setRangeLed(
  button: Button,
  mode: DialRange,
  channel: number,
  note: number
): ByteTriplet | undefined {
  if (button.ledStates !== undefined) {
    const requestedColor = mode.color;
    const ledState = Object.entries(button.ledStates).find(([color]) => {
      return color === requestedColor;
    });

    debug(`[setRangeLed]`, button, mode, channel, note);

    if (ledState === undefined) {
      warn(
        `Button ${button.label} doesn't support requested color ${requestedColor}`
      );
    } else {
      return {
        b1: (midiEventToNumber(MidiEventType.NoteOff) << 4) | channel,
        b2: note,
        b3: ledState[1],
      };
    }
  }
}

export async function watchMidiCommand(dev: string) {
  const [amidil] = await run("amidi --list-devices");
  const foundPort = amidil.split(/\r?\n/g).find((line) => line.includes(dev));

  const config = await readConfig("./config.json");
  const BINDINGS = config.bindings;
  const BINDINGS_ENTRIES = Object.entries(BINDINGS);

  if (foundPort === undefined) {
    error(`Unable to locate device "${dev}"`);
    return;
  }

  const [matched, port] = foundPort.match(deviceRe) ?? [];
  if (!matched) {
    error(`Failed to extract port from device listing`);
    return;
  }

  const [watchMidiProm, stream] = watchMidi(port);
  const [midishProm, midishIn] = midish();

  midishIn.push(`dnew 0 "14:0" rw`);
  midishIn.push("i");
  for (let i = 0; i < 16; i++) {
    midishIn.push(`onew out${i} {0 ${i}}`);
  }
  midishIn.push("co out0");

  const devMapping = apcKey25;
  const buttonStates: {
    [key: string]: number;
  } = {};

  const rangeStates: Record<string, { range: Range; idx: number }> =
    Object.fromEntries(
      BINDINGS_ENTRIES.map(([, val]) => {
        if (val.type === "range") {
          return [val.dial, { range: val.modes[0].range, idx: 0 }];
        } else {
          return undefined;
        }
      }).filter((v) => v !== undefined) as [
        string,
        { range: Range; idx: number }
      ][]
    );

  // set LED states of buttons that control dial ranges
  amidiSendBatched(
    "hw:5,1",
    BINDINGS_ENTRIES.map(([key, binding]) => {
      if (binding.type === "range") {
        const devKey = Object.entries(devMapping.buttons).find(
          ([, b]) => b.label === key
        );
        if (devKey === undefined) {
          return undefined;
        }

        const mode = binding.modes[0];
        const [channel, note] = devKey[0].split(":").map((n) => Number(n));
        return setRangeLed(devKey[1], mode, channel, note);
      }
    }).filter((f) => f !== undefined) as ByteTriplet[]
  );

  // turn on LEDs of keys that are mapped to commands and only have 2 LED states
  amidiSendBatched(
    "hw:5,1",
    BINDINGS_ENTRIES.map(([key, binding]) => {
      if (binding.type === "command") {
        const devKey = Object.entries(devMapping.buttons).find(
          ([, b]) => b.label === key
        );
        if (devKey === undefined || devKey[1].ledStates === undefined) {
          return undefined;
        }

        const onState = Object.entries(devKey[1].ledStates).find(
          ([state]) => state === "ON"
        );
        if (onState !== undefined) {
          const [channel, note] = devKey[0].split(":").map((n) => Number(n));
          return {
            b1: (midiEventToNumber(MidiEventType.NoteOff) << 4) | channel,
            b2: note,
            b3: onState[1],
          };
        }
      }
      // typescript isn't smart enough to take into account this undefined filtering step
    }).filter((i) => i !== undefined) as ByteTriplet[]
  );

  let co = "out0";

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;

    if (event.type === MidiEventType.NoteOn) {
      const key = `${event.channel}:${event.note}`;
      const button = devMapping.buttons[key];
      if (button) {
        debug(`[button pressed] ${button.label}`);
        const binding = BINDINGS[button.label];
        if (binding !== undefined) {
          if (binding.type === "command") {
            run(binding.command);
          } else if (binding.type === "range") {
            const newIdx =
              (rangeStates[binding.dial].idx + 1) % binding.modes.length;
            const newMode = binding.modes[newIdx];
            rangeStates[binding.dial] = {
              range: newMode.range,
              idx: newIdx,
            };

            setRangeLed(button, newMode, event.channel, event.note);
          }
        } else {
          if (button.ledStates !== undefined) {
            const ledStates = Object.keys(button.ledStates).filter(
              (state) => !state.includes("FLASHING")
            );
            const numLedStates = ledStates.length;
            if (!buttonStates[key]) {
              buttonStates[key] = 1;
            } else {
              buttonStates[key] = (buttonStates[key] + 1) % numLedStates;
            }

            const data = {
              b1: (0b1001 << 4) | event.channel,
              b2: event.note,
              b3: button.ledStates[ledStates[buttonStates[key]]],
            };
            amidiSend("hw:5,1", data);
          }
        }
      } else if (event.channel === devMapping.keys.channel) {
        debug(`Key ${event.note} velocity ${event.velocity}`);
      }
    } else if (event.type === MidiEventType.ControlChange) {
      const key = `${event.channel}:${event.controller}`;
      const dial = devMapping.dials[key];
      if (dial) {
        debug(`[dial] `, dial.label, event.value);
        let pct = event.value / (dial.range[1] - dial.range[0]);
        if (rangeStates[dial.label] !== undefined) {
          const [start, end] = rangeStates[dial.label].range;
          pct = pct * (end - start) + start;
        }

        const binding = BINDINGS[dial.label];
        if (binding !== undefined && binding.type === "passthrough") {
          const newCo = `out${binding.outChannel}`;
          const mappedPct =
            MAP_FUNCTIONS[binding.mapFunction ?? "IDENTITY"](pct);
          const mapped = Math.round(mappedPct * 16383);
          let midishCmd = `oaddev {xctl ${newCo} ${binding.outController} ${mapped}}`;

          // update the current output in midish if necessary
          if (newCo !== co) {
            midishCmd = `co ${newCo}\n${midishCmd}`;
            co = newCo;
          }
          debug(`[midish] [cmd]: ${midishCmd.replace(/\n/g, "<CR>")}`);
          midishIn.push(midishCmd);
        }
      }
    } else if (event.type === MidiEventType.NoteOff) {
      //
    } else {
      log(event);
    }
  });

  try {
    await Promise.race([watchMidiProm, midishProm]);
  } catch (err) {
    error(`Problem ocurred with midi watch: exit code ${err}`);
  }
}
