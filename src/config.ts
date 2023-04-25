import Ajv from "ajv";
import { readFile } from "fs/promises";
import { parse as YAMLParse } from "yaml";
import configJsonSchema from "./config-schema.json";
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

export type ConfigReloadAction = {
  type: "config::reload";
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
  | MixerSelectAction
  | ConfigReloadAction;

/**
 * Actions(s) to execute on a key press event
 */
export type KeyPressConfig = {
  actions: Action[];
};

/**
 * Actions(s) to execute on a key release event
 */
export type KeyReleaseConfig = {
  actions: Action[];
};

/**
 * Actions(s) to execute on a key long press event
 */
export type KeyLongPressConfig = {
  actions: Action[];
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
  // The default state of the button LED if no other color
  // could be determined. This will be overridden by the state
  // save/restore functionality. In other words, the LED will be set
  // to the color that it was when pipewire-orchestrator was when it
  // last exited
  defaultLEDState?: string;
  // The default state of the button LED to set when the program
  // starts. This will override any previously saved LED state.
  defaultLEDStateAlways?: string;
  // The actions to execute when the button is pressed
  onPress?: KeyPressConfig;
  // The actions to execute when the button is long pressed
  onLongPress?: KeyLongPressConfig;
  // The actions to execute when the button is shift pressed
  onShiftPress?: KeyPressConfig;
  // The actions to execute when the button is shift long pressed
  onShiftLongPress?: KeyLongPressConfig;
  // The actions to execute when the button is released
  onRelease?: KeyReleaseConfig;
};

export type Binding = DialBinding | ButtonBinding;

export type Label = string;
export type Bindings = {
  [key: Label]: Binding;
};

export type NodeName = string;
export type NodeEventConfig = {
  node: NodeName;
  do: Action[];
};

export type PipeWireNodeConfig = {
  node: NodeName;
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
  stateFile?: string;
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
  configPath: string;
  onConnectRules: Array<[NodeName, Action[]]>;
  onDisconnectRules: Array<[NodeName, Action[]]>;
  mixerRules: Array<[NodeName, number | "round_robin"]>;
};

export async function readConfig(path: string): Promise<Config> {
  const fileContents = await readFile(path, { encoding: "utf8" });
  let contents: any = undefined;
  try {
    contents = YAMLParse(fileContents);
  } catch (_) {}

  if (contents === undefined) {
    try {
      contents = JSON.parse(fileContents);
    } catch (_) {}
  }

  if (contents === undefined) {
    throw new Error("Failed to parse config file. Tried both JSON and YAML.");
  }

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile<Config>(configJsonSchema);

  const valid = validate(contents);
  if (!valid) {
    console.error("Invalid config file:", validate.errors);
    throw new Error("Invalid config file");
  }

  return contents;
}
