import { Button } from "../devices";
import { apcKey25 } from "../devices/apcKey25";
import { debug, error, log, warn } from "../logger";
import { amidiSend, MidiEvent, watchMidi } from "../midi";
import { midish } from "../midi/midish";
import { run } from "../util";

const deviceRe = /^IO\s+([a-zA-Z0-9:,]+)\s+(.*?)$/;

export type Range = [number, number];

type Binding =
  | {
      type: "command";
      command: string;
    }
  | {
      type: "passthrough";
      outChannel: number;
      outController: number;
    }
  | {
      type: "range";
      dial: string;
      modes: DialRange[];
    };

type DialRange = {
  range: Range;
  color: string;
};

const BINDINGS: Record<string, Binding> = {
  "Play/Pause": {
    type: "command",
    command: "/home/jayden/.config/dotfiles/scripts/xf86.sh media PlayPause",
  },
  Right: {
    type: "command",
    command: "/home/jayden/.config/dotfiles/scripts/xf86.sh media Next",
  },
  Left: {
    type: "command",
    command: "/home/jayden/.config/dotfiles/scripts/xf86.sh media Previous",
  },
  "Button 33": {
    type: "range",
    dial: "Dial 1",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 34": {
    type: "range",
    dial: "Dial 2",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 35": {
    type: "range",
    dial: "Dial 3",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 36": {
    type: "range",
    dial: "Dial 4",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 37": {
    type: "range",
    dial: "Dial 5",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 38": {
    type: "range",
    dial: "Dial 6",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 39": {
    type: "range",
    dial: "Dial 7",
    modes: [
      {
        range: [0, 1],
        color: "GREEN",
      },
      {
        range: [0, 0.5],
        color: "AMBER",
      },
    ],
  },
  "Button 40": {
    type: "range",
    dial: "Dial 8",
    modes: [
      {
        range: [0, 0.66],
        color: "GREEN",
      },
      {
        range: [0, 0.33],
        color: "AMBER",
      },
      {
        range: [0, 1],
        color: "RED",
      },
    ],
  },
  "Dial 8": {
    type: "passthrough",
    outChannel: 4,
    outController: 7,
  },
  "Dial 7": {
    type: "passthrough",
    outChannel: 4,
    outController: 8,
  },
};

function setRangeLed(
  button: Button,
  mode: DialRange,
  channel: number,
  note: number
) {
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
      amidiSend("hw:5,1", (0b1001 << 4) | channel, note, ledState[1]);
    }
  }
}

export async function watchMidiCommand(dev: string) {
  const [amidil] = await run("amidi --list-devices");
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

  const [watchMidiProm, stream] = watchMidi(port);
  const [midishProm, midishIn] = midish();

  midishIn.push(`dnew 0 "14:0" rw`);
  midishIn.push("i");
  midishIn.push("onew out0 {0 0}");
  midishIn.push("onew out1 {0 1}");
  midishIn.push("onew out2 {0 2}");
  midishIn.push("onew out3 {0 3}");
  midishIn.push("onew out4 {0 4}");
  midishIn.push("onew out5 {0 5}");
  midishIn.push("onew out6 {0 6}");
  midishIn.push("onew out7 {0 7}");
  midishIn.push("onew out8 {0 8}");
  midishIn.push("co out0");

  const devMapping = apcKey25;
  const buttonStates: {
    [key: string]: number;
  } = {};

  const rangeStates: Record<string, { range: Range; idx: number }> =
    Object.fromEntries(
      Object.values(BINDINGS)
        .map((val) => {
          if (val.type === "range") {
            return [val.dial, { range: val.modes[0].range, idx: 0 }];
          } else {
            return undefined;
          }
        })
        .filter((v) => v !== undefined) as [
        string,
        { range: Range; idx: number }
      ][]
    );

  Object.entries(BINDINGS).forEach(([key, binding]) => {
    if (binding.type === "range") {
      const devKey = Object.entries(devMapping.buttons).find(
        ([, b]) => b.label === key
      );
      if (devKey === undefined) {
        return;
      }

      const mode = binding.modes[0];
      const [channel, note] = devKey[0].split(":").map((n) => Number(n));
      setRangeLed(devKey[1], mode, channel, note);
    }
  });

  let co = "out0";

  stream.on("data", (data) => {
    const event = JSON.parse(data) as MidiEvent;

    if (event.type === "NOTE_ON") {
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

            const b3 = button.ledStates[ledStates[buttonStates[key]]];
            amidiSend("hw:5,1", (0b1001 << 4) | event.channel, event.note, b3);
          }
        }
      } else if (event.channel === devMapping.keys.channel) {
        debug(`Key ${event.note} velocity ${event.velocity}`);
      }
    } else if (event.type === "CONTROL_CHANGE") {
      const key = `${event.channel}:${event.controller}`;
      const dial = devMapping.dials[key];
      if (dial) {
        debug(`[dial] `, dial.label, event.value);

        const binding = BINDINGS[dial.label];
        if (binding !== undefined && binding.type === "passthrough") {
          const newCo = `out${binding.outChannel}`;
          let pct = event.value / 127;
          if (rangeStates[dial.label] !== undefined) {
            const [start, end] = rangeStates[dial.label].range;
            pct = pct * (end - start) + start;
          }

          const mapped = Math.round(pct * 16383);
          let midishCmd = `oaddev {xctl ${newCo} ${binding.outController} ${mapped}}`;
          if (newCo !== co) {
            midishCmd = `co ${newCo}\n${midishCmd}`;
            co = newCo;
          }
          debug(`midish out: ${midishCmd.replace(/\n/g, "<CR>")}`);
          midishIn.push(midishCmd);
        }
      }
    } else if (event.type === "NOTE_OFF") {
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
