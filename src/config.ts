import Ajv from "ajv";
import { readFile } from "fs/promises";
import { parse as YAMLParse } from "yaml";
import { Device, Range } from "./devices";
import { MidiEvent } from "./midi";
import { NodeAndPort } from "./pipewire";

export type MapFunction = "IDENTITY" | "SQUARED" | "SQRT" | "TAPER";

/**
 * Execute a shell command when the binding is activated
 */
export type CommandAction = {
  type: "command";
  command: string;
  onFinish?: Action[];
  cancelable?: boolean;
};

/**
 * Change the range of a dial when the binding is executed
 */
export type RangeAction = {
  type: "range";
  dial: string;
  range: Range;
};

/**
 * Emit a MIDI event when the binding is activated
 */
export type MidiAction = {
  type: "midi";
  events: MidiEvent[];
};

/**
 * Cycle through the given sub-bindings each time the binding
 * is activated
 */
export type CycleAction = {
  type: "cycle";
  actions: Action[][];
};

/**
 * Cancel any current pending action. If there is no pending action
 * then the alt binding will be executed (if specified)
 */
export type CancelAction = {
  type: "cancel";
  alt?: Action;
};

/**
 * Turn on or off mute for the given dial
 */
export type ToggleMuteAction = {
  type: "mute";
  mute: boolean;
  dial: string;
};

/**
 * Load an LV2 preset for the given plugin
 */
export type LV2LoadPresetAction = {
  type: "lv2::load_preset";
  pluginName: string;
  preset: string;
};

/**
 * Open the selection prompt to assign an application
 * to a mixer channel
 */
export type MixerSelectAction = {
  type: "mixer::select";
  onFinish?: Action[];
  channel: number;
};

/**
 * Create a link between two nodes and ports within PipeWire
 */
export type PipewireLinkAction = {
  type: "pipewire::link";
  src: NodeAndPort;
  dest: NodeAndPort;
};

/**
 * Create an exclusive link between two nodes and ports within PipeWire.
 * Creating an exclusive link is equivalent to creating a normal link and then
 * destroying all other links originating from source port that aren't the newly
 * created one.
 */
export type PipewireExclusiveLinkAction = {
  type: "pipewire::exclusive_link";
  src: NodeAndPort;
  dest: NodeAndPort;
};

/**
 * Destroy a link between two nodes and ports within PipeWire
 */
export type PipewireUnLinkAction = {
  type: "pipewire::unlink";
  src: NodeAndPort;
  dest: NodeAndPort;
};

/**
 * Set the given button LED to the given color
 */
export type LEDSetAction = {
  type: "led::set";
  button: string;
  color: string;
};

/**
 * Save the LED state of the given button
 */
export type LEDSaveAction = {
  type: "led::save";
  button: string;
};

/**
 * Restore the previously saved LED state of the
 * given button
 */
export type LEDRestoreAction = {
  type: "led::restore";
  button: string;
};

export type Action =
  | LV2LoadPresetAction
  | CommandAction
  | ToggleMuteAction
  | MidiAction
  | PipewireLinkAction
  | PipewireUnLinkAction
  | PipewireExclusiveLinkAction
  | RangeAction
  | LEDSetAction
  | LEDSaveAction
  | LEDRestoreAction
  | CancelAction
  | CycleAction
  | MixerSelectAction;

/**
 * Actions(s) to execute on a key event such as a key
 * press or release
 */
export type KeyEventAction = {
  actions: Action[];
  // only used for long press
  timeout?: number;
};

/**
 * Pass through the MIDI input to the given channel and controller,
 * optionally passing the input through the mapping function first
 */
export type PassthroughBinding = {
  type: "passthrough";
  mapFunction?: MapFunction;
  outChannel: number;
  outController: number;
};

export type DialBinding = PassthroughBinding;

export type ButtonBinding = {
  type: "button";
  defaultLEDState?: string;
  onPress?: KeyEventAction;
  onLongPress?: KeyEventAction;
  onShiftPress?: KeyEventAction;
  onShiftLongPress?: KeyEventAction;
  onRelease?: KeyEventAction;
};

export type Binding = DialBinding | ButtonBinding;

export type Label = string;
export type Bindings = {
  [key: Label]: Binding;
};

export type NodeEventConfig = {
  node: string;
  do: Action[];
};

export type PipeWireNodeConfig = {
  node: string;
  onConnect?: Action[];
  onDisconnect?: Action[];
  mixerChannel?: number | "round_robin";
};

export type LV2Plugin = {
  uri: string;
  name: string;
  host: "jalv" | "jalv.gtk3";
};

export type Config = {
  connections: [string, string][];
  device: string;
  inputMidi: string;
  outputMidi: string;
  bindings: Bindings;
  lv2Path?: string;
  pipewire: {
    rules: PipeWireNodeConfig[];
    plugins: LV2Plugin[];
  };
};

export type RuntimeConfig = Omit<Config, "device"> & {
  device: Device;
};

export async function readConfig(path: string): Promise<Config> {
  const contents =
    path.endsWith(".yaml") || path.endsWith(".yml")
      ? YAMLParse(await readFile(path, { encoding: "utf8" }))
      : JSON.parse(await readFile(path, { encoding: "utf8" }));

  const schema = await readFile(__dirname + "/config-schema.json", {
    encoding: "utf8",
  });

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile<Config>(JSON.parse(schema));

  const valid = validate(contents);
  if (!valid) {
    console.error("Invalid config file:", validate.errors);
    throw new Error("Invalid config file");
  }

  return contents;
}
