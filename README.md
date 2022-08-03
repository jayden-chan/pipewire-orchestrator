# pipewire-orchestrator

## Notes

### Enable Virtual MIDI

```bash
sudo modprobe snd_virmidi
echo "snd_virmidi" | sudo tee /etc/modules-load.d/snd-virmidi.conf
```

### Connect device to virtual MIDI

```bash
# find devices
aconnect -l
aconnect <virtual device id> <hardware device id>
```

## Todo

- [x] Batch hex requests to amidi
- [ ] Layers
- [x] Shift key to turn dials without sending input
- [x] Mute controls for dials
- [ ] Guitar amp selection with buttons
- [x] Microphone mute button
- [ ] EQ selection with buttons
- [x] Auto-connect gain controllers with pw-dump watcher
- [x] Auto-connect virtual midi devices with aconnect
- [ ] Add TCP RPC
- [x] Combine MIDI and Pipewire watch modes
- [x] Use shift/other modifier key to open popup dialog for assigning dial to application
- [ ] Add long press/momentary push functionality
- [ ] Request parameter dump from midi device on startup
- [x] Better error handling besides "it's wrong"
- [ ] Round robin mixer channel assignment

## Dev

### Regenerating the config file JSON schema

If you make a change to the `Config` type in `config.ts` you need to regenerate the
config file JSON schema. Use the following command:

```bash
npx typescript-json-schema --aliasRefs --topRef --noExtraProps --required --strictNullChecks tsconfig.json Config > src/config-schema.json
```
