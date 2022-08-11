# PipeWire Orchestrator

PipeWire Orchestrator is a background daemon that performs several audio and MIDI-related
tasks on Linux. Some of the features include (but are not limited to):

- MIDI processing and mapping based on configuration rules
  - Map MIDI buttons to arbitrary shell commands
  - Separate short press, long press, and shift press actions
  - Remapping individual MIDI inputs to other channels or controllers
  - Remapping entire MIDI devices to appear as other devices
  - Sending analog inputs through a continuous function (sqrt, square, etc) before
    sending to system MIDI
  - Changing the perceived min and max range of an analog input (1/2 or 1/3rd range,
    etc)
  - Controlling LED colors of MIDI devices
- PipeWire connection graph monitoring
  - Connecting and disconnecting nodes automatically based on configuration rules
  - Assigning application outputs to volume mixer channels in a round-robin fashion
  - Running arbitrary commands when nodes are added and removed from the connection
    graph
- JACK LV2 plugin host
  - Basic support for running LV2 plugins with JACK and controlling them with
    aforementioned MIDI processing.
- Provide configuration as either JSON or YAML with automatic runtime validation

Here are some examples of things you can do with PipeWire Orchestrator and a cheap USB
MIDI controller:

- Per-application volume control with physical dials, including buttons to mute or
  activate "quiet mode"
- Play sound effects through your microphone with the push of a button
- Load system-wide parametric EQ profiles with buttons
- Trigger home automation events with buttons or dials (turn on/off or dim lights with
  MIDI)
- Globally mute audio sources regardless of which applications are using them
- Control system media Play/Pause Next/Previous with hardware buttons
- Toggle direct monitoring of any audio source with a button or dial (hear your
  microphone through your headset, for example)

Essentially the point of this program is to allow MIDI controllers to be used as general
purpose input devices instead of just for musical performances.

## TODO

- [x] Batch hex requests to amidi
- [ ] Layers
- [x] Shift key to turn dials without sending input
- [x] Mute controls for dials
- [ ] Guitar amp selection with buttons
- [x] Microphone mute button
- [x] EQ selection with buttons
- [x] Auto-connect gain controllers with pw-dump watcher
- [x] Auto-connect virtual midi devices with aconnect
- [ ] Add TCP RPC
- [x] Combine MIDI and Pipewire watch modes
- [x] Use shift/other modifier key to open popup dialog for assigning dial to application
- [x] Add long press/momentary push functionality
- [x] Request parameter dump from midi device on startup (not supported on current
      hardware)
- [x] Better error handling besides "it's wrong"
- [x] Round robin mixer channel assignment

## Development

### Regenerating the config file JSON schema

If you make a change to the `Config` type in `config.ts` you need to regenerate the
config file JSON schema. Use the following command:

```bash
yarn typegen
```

### Enable Virtual MIDI in Linux

```bash
sudo modprobe snd_virmidi
echo "snd_virmidi" | sudo tee /etc/modules-load.d/snd-virmidi.conf
```
