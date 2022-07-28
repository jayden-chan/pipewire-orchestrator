import { apcKey25 } from "../devices/apcKey25";
import { error, log } from "../logger";
import { amidiSend, MidiEvent, watchMidi } from "../midi";
import { run } from "../util";

type LedState = "OFF" | "RED" | "GREEN" | "AMBER";

const nextState = {
  OFF: <LedState>"GREEN",
  GREEN: <LedState>"AMBER",
  AMBER: <LedState>"RED",
  RED: <LedState>"OFF",
};

const ledStateToHex = {
  OFF: 0,
  GREEN: 1,
  AMBER: 5,
  RED: 3,
};

const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

export async function watchMidiCommand(dev: string) {
  const [amidil] = await run("amidi -l");
  const foundPort = amidil.split(/\r?\n/g).find((line) => line.includes(dev));

  if (foundPort === undefined) {
    error(`Unable to locate device "${dev}"`);
    return;
  }

  const [matched, port] = foundPort.match(deviceRe) ?? [];
  if (!matched) {
    error(`Failed to extract port from device listing`);
    return;
  }

  const [prom, stream] = watchMidi(port);

  const devMapping = apcKey25;
  const buttonStates: {
    [key: string]: LedState;
  } = {};

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;

    if (event.type === "NOTE_ON") {
      const key = `${event.channel}:${event.note}`;
      const button = devMapping.buttons[key];
      if (button) {
        log(button.label);
        if (!buttonStates[key]) {
          buttonStates[key] = "GREEN";
        } else {
          buttonStates[key] = nextState[buttonStates[key]];
        }

        const b1 = ((0b1001 << 4) | event.channel)
          .toString(16)
          .padStart(2, "0");
        const b2 = event.note.toString(16).padStart(2, "0");
        const b3 = ledStateToHex[buttonStates[key]]
          .toString(16)
          .padStart(2, "0");
        const hex = `${b1}${b2}${b3}`;

        amidiSend(port, hex);
      } else if (event.channel === devMapping.keys.channel) {
        log(`Key ${event.note} velocity ${event.velocity}`);
      }
    } else if (event.type === "CONTROL_CHANGE") {
      const key = `${event.channel}:${event.controller}`;
      const dial = devMapping.dials[key];
      if (dial) {
        log(dial.label, event.value);
      }
    } else if (event.type === "NOTE_OFF") {
      //
    } else {
      log(event);
    }
  });
  await prom;
}
