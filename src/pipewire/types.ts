// To parse this data:
//
//   import { Convert } from "./file";
//
//   const pipewireItem = Convert.toPipewireItems(json);

export interface PipewireItem {
  id: number;
  type: PipewireItemType;
  version: number;
  permissions: Permission[];
  info?: Info;
  props?: PipewireItemProps;
  metadata?: Metadatum[];
}

export interface Info {
  cookie?: number;
  "user-name"?: UserName;
  "host-name"?: HostName;
  version?: CoreVersionEnum | number;
  name?: string;
  "change-mask": ChangeMask[];
  props: InfoProps;
  filename?: string;
  args?: null | string;
  type?: string;
  "max-input-ports"?: number;
  "max-output-ports"?: number;
  "n-input-ports"?: number;
  "n-output-ports"?: number;
  state?: State;
  error?: null;
  params?: Params;
  direction?: InfoDirection;
  "output-node-id"?: number;
  "output-port-id"?: number;
  "input-node-id"?: number;
  "input-port-id"?: number;
  format?: InfoFormat;
}

export enum ChangeMask {
  Format = "format",
  InputPorts = "input-ports",
  OutputPorts = "output-ports",
  Params = "params",
  Props = "props",
  State = "state",
}

export enum InfoDirection {
  Input = "input",
  Output = "output",
}

export interface InfoFormat {
  mediaType: MediaType;
  mediaSubtype: MediaSubtype;
  format: FormatEnum;
}

export enum FormatEnum {
  F32LE = "F32LE",
  F32P = "F32P",
  S32LE = "S32LE",
  Yuy2 = "YUY2",
}

export enum MediaSubtype {
  Control = "control",
  DSP = "dsp",
  Mjpg = "mjpg",
  Raw = "raw",
}

export enum MediaType {
  Application = "application",
  Audio = "audio",
  Video = "video",
}

export enum HostName {
  Grace = "grace",
}

export interface Params {
  EnumFormat?: EnumFormat[];
  PropInfo?: PropInfo[];
  Props?: Prop[];
  Format?: Format[];
  EnumPortConfig?: PortConfig[];
  PortConfig?: PortConfig[];
  Latency?: Latency[];
  ProcessLatency?: ProcessLatency[];
  IO?: Io[];
  Meta?: Meta[];
  Buffers?: Buffer[];
  EnumProfile?: Profile[];
  Profile?: Profile[];
  EnumRoute?: EnumRoute[];
  Route?: Route[];
}

export interface Buffer {
  buffers: Buffers;
  blocks: number;
  size: Buffers;
  stride: number;
}

export interface Buffers {
  default: number;
  min: number;
  max: number;
  step?: number;
}

export interface EnumFormat {
  mediaType: MediaType;
  mediaSubtype: MediaSubtype;
  format?: FormatFormatClass | FormatEnum;
  rate?: Buffers | number;
  channels?: number;
  position?: AudioChannel[];
  size?: Size;
  framerate?: Framerate;
}

export interface FormatFormatClass {
  default: FormatEnum;
  alt1: FormatEnum;
  alt2: FormatEnum;
}

export interface Framerate {
  num: number;
  denom: number;
}

export enum AudioChannel {
  FL = "FL",
  Fr = "FR",
}

export interface Size {
  width: number;
  height: number;
}

export interface PortConfig {
  direction: EnumPortConfigDirection;
  mode: Mode;
}

export enum EnumPortConfigDirection {
  Input = "Input",
  Output = "Output",
}

export enum Mode {
  Convert = "convert",
  DSP = "dsp",
}

export interface Profile {
  index: number;
  name: string;
  description: string;
  priority: number;
  available: Available;
  classes: Array<Array<number[] | ClassEnum | number> | number>;
  save?: boolean;
}

export enum Available {
  No = "no",
  Unknown = "unknown",
  Yes = "yes",
}

export enum ClassEnum {
  AudioSink = "Audio/Sink",
  AudioSource = "Audio/Source",
  CardProfileDevices = "card.profile.devices",
}

export interface EnumRoute {
  index: number;
  direction: EnumPortConfigDirection;
  name: string;
  description: string;
  priority: number;
  available: Available;
  info: Array<number | string>;
  profiles: number[];
  devices: number[];
}

export interface Format {
  mediaType: MediaType;
  mediaSubtype: MediaSubtype;
  format?: FormatEnum;
  rate?: number;
  channels?: number;
  position?: AudioChannel[];
}

export interface Io {
  id: ID;
  size: number;
}

export enum ID {
  Buffers = "Buffers",
  Clock = "Clock",
  Control = "Control",
  Position = "Position",
}

export interface Latency {
  direction: EnumPortConfigDirection;
  minQuantum: number;
  maxQuantum: number;
  minRate: number;
  maxRate: number;
  minNs: number;
  maxNs: number;
}

export interface Meta {
  type: MetaType;
  size: number;
}

export enum MetaType {
  Header = "Header",
}

export interface ProcessLatency {
  quantum: number;
  rate: number;
  ns: number;
}

export interface PropInfo {
  id?: string;
  description: string;
  type: TypeClass | TypeTypeEnum | number;
  container?: Container;
  name?: string;
  params?: boolean;
  labels?: Array<LabelEnum | number>;
}

export enum Container {
  Array = "Array",
}

export enum LabelEnum {
  AperturePriorityMode = "Aperture Priority Mode",
  Disabled = "Disabled",
  Lipshitz5Dithering = "Lipshitz 5 dithering",
  ManualMode = "Manual Mode",
  None = "none",
  PassiveSurroundDecoding = "Passive Surround Decoding",
  Psd = "psd",
  Rectangular = "rectangular",
  RectangularDithering = "Rectangular dithering",
  Shaped5 = "shaped5",
  Simple = "simple",
  SimpleUpmixing = "Simple upmixing",
  SlopedTriangularDithering = "Sloped Triangular dithering",
  The50Hz = "50 Hz",
  The60Hz = "60 Hz",
  Triangular = "triangular",
  TriangularDithering = "Triangular dithering",
  TriangularHF = "triangular-hf",
  Wannamaker3 = "wannamaker3",
  Wannamaker3Dithering = "Wannamaker 3 dithering",
}

export interface TypeClass {
  default: boolean | number;
  min?: number;
  max?: number;
  alt1?: boolean;
  alt2?: boolean;
  step?: number;
}

export enum TypeTypeEnum {
  APIALSAC3 = "api.alsa.c-3",
  APIALSAP3 = "api.alsa.p-3",
  Default = "default",
  Empty = "",
  FLFr = "[ FL, FR ]",
  Front3 = "front:3",
  None = "none",
  Psd = "psd",
  Type = "[  ]",
  Unknown = "UNKNOWN",
}

export interface Prop {
  volume?: number;
  mute?: boolean;
  channelVolumes?: number[];
  channelMap?: AudioChannel[];
  softMute?: boolean;
  softVolumes?: number[];
  monitorMute?: boolean;
  monitorVolumes?: number[];
  params?: Array<boolean | number | string>;
  device?: Device;
  deviceName?: string;
  deviceFd?: number;
  cardName?: string;
  latencyOffsetNsec?: number;
}

export enum Device {
  Default = "default",
  DevVideo0 = "/dev/video0",
  Front3 = "front:3",
}

export interface Route {
  index: number;
  direction: EnumPortConfigDirection;
  name: RouteName;
  description: Description;
  priority: number;
  available: Available;
  info: Array<number | string>;
  profiles: number[];
  device: number;
  props: RouteProps;
  devices: number[];
  profile: number;
  save: boolean;
}

export enum Description {
  AnalogInput = "Analog Input",
  AnalogOutput = "Analog Output",
}

export enum RouteName {
  AnalogInput = "analog-input",
  AnalogOutput = "analog-output",
}

export interface RouteProps {
  mute: boolean;
  channelVolumes: number[];
  volumeBase: number;
  volumeStep: number;
  channelMap: AudioChannel[];
  softVolumes: number[];
  latencyOffsetNsec: number;
}

export interface InfoProps {
  "config.name"?: ConfigName;
  "link.max-buffers"?: number;
  "log.level"?: number;
  "core.daemon"?: boolean;
  "core.name"?: CoreName;
  "default.clock.rate"?: number;
  "default.clock.allowed-rates"?: string;
  "default.clock.quantum"?: number;
  "default.clock.min-quantum"?: number;
  "default.clock.max-quantum"?: number;
  "cpu.max-align"?: number;
  "default.clock.quantum-limit"?: number;
  "default.video.width"?: number;
  "default.video.height"?: number;
  "default.video.rate.num"?: number;
  "default.video.rate.denom"?: number;
  "clock.power-of-two-quantum"?: boolean;
  "mem.warn-mlock"?: boolean;
  "mem.allow-mlock"?: boolean;
  "settings.check-quantum"?: boolean;
  "settings.check-rate"?: boolean;
  "object.id": number;
  "object.serial": number;
  "module.name"?: string;
  "module.author"?: ModuleAuthor;
  "module.description"?: string;
  "module.usage"?: string;
  "module.version"?: CoreVersionEnum;
  "nice.level"?: number;
  "rt.prio"?: number;
  "rt.time.soft"?: number;
  "rt.time.hard"?: number;
  "module.id"?: number;
  "factory.name"?: string;
  "factory.type.name"?: string;
  "factory.type.version"?: number;
  "factory.usage"?: string;
  "node.name"?: string;
  "node.group"?: NodeGroup;
  "priority.driver"?: number;
  "factory.id"?: number;
  "clock.quantum-limit"?: number;
  "node.driver"?: boolean;
  "node.freewheel"?: boolean;
  "node.description"?: string;
  "media.class"?: MediaClass;
  "audio.position"?: AudioPosition;
  "factory.mode"?: FactoryMode;
  "audio.adapt.follower"?: string;
  "library.name"?: LibraryName;
  "pipewire.protocol"?: PipewireProtocol;
  "pipewire.sec.pid"?: number;
  "pipewire.sec.uid"?: number;
  "pipewire.sec.gid"?: number;
  "pipewire.sec.label"?: string;
  "client.api"?: ClientAPI;
  "pulse.server.type"?: PulseServerType;
  "application.name"?: ApplicationName;
  "application.process.id"?: number;
  "application.process.user"?: UserName;
  "application.process.host"?: HostName;
  "application.process.binary"?: Application;
  "application.language"?: ApplicationLanguage;
  "window.x11.display"?: WindowX11Display;
  "application.process.machine-id"?: ApplicationProcessMachineID;
  "application.process.session-id"?: number;
  "pulse.min.quantum"?: PulseMinQuantum;
  "core.version"?: CoreVersionEnum;
  "pipewire.access"?: PipewireAccess;
  "wireplumber.daemon"?: boolean;
  "wireplumber.export-core"?: boolean;
  "wireplumber.script-engine"?: WireplumberScriptEngine;
  "client.id"?: number;
  "device.api"?: DeviceAPI;
  "format.dsp"?: FormatDSP;
  "object.path"?: string;
  "port.name"?: string;
  "port.alias"?: string;
  "port.id"?: number;
  "port.physical"?: boolean;
  "port.terminal"?: boolean;
  "port.direction"?: PortDirection;
  "node.id"?: number;
  "api.v4l2.path"?: APIV4L2Path;
  "device.bus"?: DeviceBus;
  "device.bus-path"?: DeviceBusPath;
  "device.capabilities"?: DeviceCapabilities;
  "device.description"?: DeviceDescriptionEnum;
  "device.enum.api"?: DeviceEnumAPI;
  "device.name"?: string;
  "device.plugged.usec"?: number;
  "device.product.id"?: DeviceProductID;
  "device.product.name"?: DeviceDescriptionEnum;
  "device.serial"?: string;
  "device.subsystem"?: DeviceClassEnum;
  "device.sysfs.path"?: string;
  "device.vendor.id"?: DeviceVendorID;
  "device.vendor.name"?: DeviceVendorName;
  "api.v4l2.cap.driver"?: APIV4L2CapDriver;
  "api.v4l2.cap.card"?: APIV4L2CapCard;
  "api.v4l2.cap.bus_info"?: APIV4L2CapBusInfo;
  "api.v4l2.cap.version"?: APIV4L2CapVersion;
  "api.v4l2.cap.capabilities"?: APIV4L2CapCapabilities;
  "api.v4l2.cap.device-caps"?: number | string;
  "api.acp.auto-port"?: boolean;
  "api.acp.auto-profile"?: boolean;
  "api.alsa.card"?: number;
  "api.alsa.card.longname"?: string;
  "api.alsa.card.name"?: ALSACardName;
  "api.alsa.path"?: APIALSAPath;
  "api.alsa.use-acp"?: boolean;
  "device.icon-name"?: DeviceIconName;
  "device.nick"?: ALSACardName;
  "alsa.card"?: number;
  "alsa.card_name"?: ALSACardName;
  "alsa.long_card_name"?: string;
  "alsa.driver_name"?: ALSADriverName;
  "device.string"?: number;
  "device.bus-id"?: string;
  "device.form-factor"?: string;
  "audio.channel"?: AudioChannel;
  "port.monitor"?: boolean;
  "device.id"?: number;
  "node.nick"?: ALSACardName;
  "node.pause-on-idle"?: boolean;
  "priority.session"?: number;
  "media.role"?: MediaRole;
  "alsa.class"?: ALSAClass;
  "alsa.device"?: number;
  "alsa.id"?: ALSA;
  "alsa.name"?: ALSA;
  "alsa.resolution_bits"?: number;
  "alsa.subclass"?: ALSASubclass;
  "alsa.subdevice"?: number;
  "alsa.subdevice_name"?: ALSASubdeviceName;
  "api.alsa.pcm.card"?: number;
  "api.alsa.pcm.stream"?: APIALSAPCMStream;
  "audio.channels"?: number;
  "card.profile.device"?: number;
  "device.class"?: DeviceClassEnum;
  "device.profile.description"?: DeviceProfileDescription;
  "device.profile.name"?: DeviceProfileName;
  "device.routes"?: number;
  "node.max-latency"?: NodeMaxLatency;
  "window.x11.screen"?: number;
  "loop.cancel"?: boolean;
  "client.name"?: string;
  "node.latency"?: NodeLatency;
  "node.rate"?: NodeRate;
  "node.lock-quantum"?: boolean;
  "media.type"?: MediaTypeEnum;
  "media.category"?: MediaCategory;
  "node.always-process"?: boolean;
  "node.transport.sync"?: boolean;
  "link.output.node"?: number;
  "link.output.port"?: number;
  "link.input.node"?: number;
  "link.input.port"?: number;
  "object.linger"?: boolean;
  "media.name"?: string;
  "resample.quality"?: number;
  "stream.is-live"?: boolean;
  "node.autoconnect"?: boolean;
  "node.want-driver"?: boolean;
  "adapt.follower.spa-node"?: string;
  "object.register"?: boolean;
  "pulse.attr.maxlength"?: number;
  "pulse.attr.tlength"?: number;
  "pulse.attr.prebuf"?: number;
  "pulse.attr.minreq"?: number;
  "application.version"?: string;
  "application.icon-name"?: Application;
}

export enum ALSACardName {
  HDANVidia = "HDA NVidia",
  HDAudioGeneric = "HD-Audio Generic",
  NexiGoN930AFFHDWebcam = "NexiGo N930AF FHD Webcam",
  ScarlettSoloUSB = "Scarlett Solo USB",
}

export enum ALSAClass {
  Generic = "generic",
}

export enum ALSADriverName {
  SndHdaIntel = "snd_hda_intel",
  SndUSBAudio = "snd_usb_audio",
}

export enum ALSA {
  USBAudio = "USB Audio",
}

export enum ALSASubclass {
  GenericMix = "generic-mix",
}

export enum ALSASubdeviceName {
  Subdevice0 = "subdevice #0",
}

export enum APIALSAPath {
  Front3 = "front:3",
  Hw0 = "hw:0",
  Hw1 = "hw:1",
  Hw2 = "hw:2",
  Hw3 = "hw:3",
}

export enum APIALSAPCMStream {
  Capture = "capture",
  Playback = "playback",
}

export enum APIV4L2CapBusInfo {
  USB00002B00311 = "usb-0000:2b:00.3-1.1",
}

export enum APIV4L2CapCapabilities {
  The84A00001 = "84a00001",
}

export enum APIV4L2CapCard {
  NexiGoN930AFFHDWebcamNexiG = "NexiGo N930AF FHD Webcam: NexiG",
}

export enum APIV4L2CapDriver {
  Uvcvideo = "uvcvideo",
}

export enum APIV4L2CapVersion {
  The51555 = "5.15.55",
}

export enum APIV4L2Path {
  DevVideo0 = "/dev/video0",
  DevVideo1 = "/dev/video1",
}

export enum Application {
  Discord = "Discord",
  Firefox = "firefox",
  PipewirePulse = "pipewire-pulse",
  Plank = "plank",
  PwDump = "pw-dump",
  Python310 = "python3.10",
  Spotify = "spotify",
  Wireplumber = "wireplumber",
}

export enum ApplicationLanguage {
  EnCAUTF8 = "en_CA.UTF-8",
  EnUSUtf8 = "en_US.utf8",
}

export enum ApplicationName {
  ChromiumInput = "Chromium input",
  Firefox = "Firefox",
  PipewirePulse = "pipewire-pulse",
  Plank = "plank",
  PwDump = "pw-dump",
  Python310 = "python3.10",
  Spotify = "spotify",
  WEBRTCVoiceEngine = "WEBRTC VoiceEngine",
  WirePlumber = "WirePlumber",
  WirePlumberExport = "WirePlumber [export]",
}

export enum ApplicationProcessMachineID {
  The13Db5F802Ca34B9Fb2Faae79A41B9A8C = "13db5f802ca34b9fb2faae79a41b9a8c",
}

export enum UserName {
  Jayden = "jayden",
}

export enum AudioPosition {
  FLFr = "FL,FR",
}

export enum ClientAPI {
  Jack = "jack",
  PipewirePulse = "pipewire-pulse",
}

export enum ConfigName {
  JackConf = "jack.conf",
  PipewireConf = "pipewire.conf",
  PipewirePulseConf = "pipewire-pulse.conf",
  USRShareWireplumberWireplumberConf = "/usr/share/wireplumber/wireplumber.conf",
}

export enum CoreName {
  Pipewire0 = "pipewire-0",
  PipewireJayden10472 = "pipewire-jayden-10472",
  PipewireJayden1070 = "pipewire-jayden-1070",
  PipewireJayden1071 = "pipewire-jayden-1071",
  PipewireJayden39022 = "pipewire-jayden-39022",
  PipewireJayden39427 = "pipewire-jayden-39427",
  PipewireJayden39992 = "pipewire-jayden-39992",
  PipewireJayden41654 = "pipewire-jayden-41654",
  PipewireJayden61929 = "pipewire-jayden-61929",
}

export enum CoreVersionEnum {
  The0356 = "0.3.56",
}

export enum DeviceAPI {
  ALSA = "alsa",
  V4L2 = "v4l2",
}

export enum DeviceBus {
  PCI = "pci",
  USB = "usb",
}

export enum DeviceBusPath {
  PCI000029001 = "pci-0000:29:00.1",
  PCI00002B003USB01110 = "pci-0000:2b:00.3-usb-0:1.1:1.0",
  PCI00002B003USB01112 = "pci-0000:2b:00.3-usb-0:1.1:1.2",
  PCI00002B003USB01210 = "pci-0000:2b:00.3-usb-0:1.2:1.0",
  PCI00002B004 = "pci-0000:2b:00.4",
}

export enum DeviceCapabilities {
  Capture = ":capture:",
  Empty = ":",
}

export enum DeviceClassEnum {
  Sound = "sound",
  Video4Linux = "video4linux",
}

export enum DeviceDescriptionEnum {
  GP107GLHighDefinitionAudioController = "GP107GL High Definition Audio Controller",
  NexiGoN930AFFHDWebcam = "NexiGo N930AF FHD Webcam",
  ScarlettSolo3RDGen = "Scarlett Solo (3rd Gen.)",
  StarshipMatisseHDAudioController = "Starship/Matisse HD Audio Controller",
}

export enum DeviceEnumAPI {
  Udev = "udev",
}

export enum DeviceIconName {
  AudioCardAnalogPCI = "audio-card-analog-pci",
  AudioCardAnalogUSB = "audio-card-analog-usb",
  CameraWebAnalogUSB = "camera-web-analog-usb",
}

export enum DeviceProductID {
  The0X0Fb9 = "0x0fb9",
  The0X1487 = "0x1487",
  The0X228 = "0x228",
  The0X2283 = "0x2283",
  The0X8211 = "0x8211",
}

export enum DeviceProfileDescription {
  AnalogStereo = "Analog Stereo",
}

export enum DeviceProfileName {
  AnalogStereo = "analog-stereo",
}

export enum DeviceVendorID {
  The0X1022 = "0x1022",
  The0X10De = "0x10de",
  The0X1235 = "0x1235",
  The0X1Bc = "0x1bc",
  The0X1Bcf = "0x1bcf",
}

export enum DeviceVendorName {
  AdvancedMicroDevicesIncAMD = "Advanced Micro Devices, Inc. [AMD]",
  FocusriteNovation = "Focusrite-Novation",
  NVIDIACorporation = "NVIDIA Corporation",
  ShenzhenAoniElectronicCoLtd = "SHENZHEN AONI ELECTRONIC CO., LTD",
  SunplusInnovationTechnologyInc = "Sunplus Innovation Technology Inc.",
}

export enum FactoryMode {
  Merge = "merge",
  Split = "split",
}

export enum FormatDSP {
  The32BitFloatMonoAudio = "32 bit float mono audio",
  The8BitRawMIDI = "8 bit raw midi",
}

export enum LibraryName {
  AudioconvertLibspaAudioconvert = "audioconvert/libspa-audioconvert",
}

export enum MediaCategory {
  Duplex = "Duplex",
}

export enum MediaClass {
  AudioDevice = "Audio/Device",
  AudioSink = "Audio/Sink",
  AudioSource = "Audio/Source",
  AudioSourceVirtual = "Audio/Source/Virtual",
  MIDIBridge = "Midi/Bridge",
  StreamOutputAudio = "Stream/Output/Audio",
  VideoDevice = "Video/Device",
  VideoSource = "Video/Source",
}

export enum MediaRole {
  Camera = "Camera",
  DSP = "DSP",
  Music = "Music",
}

export enum MediaTypeEnum {
  Audio = "Audio",
}

export enum ModuleAuthor {
  GeorgeKiagiadakisGeorgeKiagiadakisCollaboraCOM = "George Kiagiadakis <george.kiagiadakis@collabora.com>",
  WimTaymansWimTaymansGmailCOM = "Wim Taymans <wim.taymans@gmail.com>",
}

export enum NodeGroup {
  PipewireDummy = "pipewire.dummy",
  PipewireFreewheel = "pipewire.freewheel",
}

export enum NodeLatency {
  The25648000 = "256/48000",
  The819244100 = "8192/44100",
}

export enum NodeMaxLatency {
  The1638448000 = "16384/48000",
}

export enum NodeRate {
  The144100 = "1/44100",
  The148000 = "1/48000",
}

export enum PipewireAccess {
  Unrestricted = "unrestricted",
}

export enum PipewireProtocol {
  ProtocolNative = "protocol-native",
}

export enum PortDirection {
  In = "in",
  Out = "out",
}

export enum PulseMinQuantum {
  The102448000 = "1024/48000",
}

export enum PulseServerType {
  Unix = "unix",
}

export enum WindowX11Display {
  The0 = ":0",
}

export enum WireplumberScriptEngine {
  LuaScripting = "lua-scripting",
}

export enum State {
  Active = "active",
  Idle = "idle",
  Running = "running",
  Suspended = "suspended",
}

export interface Metadatum {
  subject: number;
  key: string;
  type: string;
  value: ValueClass | number | string;
}

export interface ValueClass {
  name?: ValueName;
  volume?: number;
  mute?: boolean;
  volumes?: number[];
  channels?: AudioChannel[];
}

export enum ValueName {
  CarlaSink = "carla-sink",
  CarlaSource = "carla-source",
}

export enum Permission {
  M = "m",
  R = "r",
  W = "w",
  X = "x",
}

export interface PipewireItemProps {
  "object.serial": number;
  "metadata.name"?: MetadataName;
  "factory.id"?: number;
  "module.id"?: number;
  "client.id"?: number;
}

export enum MetadataName {
  Default = "default",
  RouteSettings = "route-settings",
  Settings = "settings",
}

export enum PipewireItemType {
  PipeWireInterfaceClient = "PipeWire:Interface:Client",
  PipeWireInterfaceCore = "PipeWire:Interface:Core",
  PipeWireInterfaceDevice = "PipeWire:Interface:Device",
  PipeWireInterfaceFactory = "PipeWire:Interface:Factory",
  PipeWireInterfaceLink = "PipeWire:Interface:Link",
  PipeWireInterfaceMetadata = "PipeWire:Interface:Metadata",
  PipeWireInterfaceModule = "PipeWire:Interface:Module",
  PipeWireInterfaceNode = "PipeWire:Interface:Node",
  PipeWireInterfacePort = "PipeWire:Interface:Port",
  PipeWireInterfaceProfiler = "PipeWire:Interface:Profiler",
}

// Converts JSON strings to/from your types
export class Convert {
  public static toPipewireItems(json: string): PipewireItem[] {
    return JSON.parse(json);
  }

  public static pipewireItemsToJson(value: PipewireItem[]): string {
    return JSON.stringify(value);
  }
}
