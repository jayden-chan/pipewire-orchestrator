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
aconnect <hardware device id> <virtual device id>
```

## Todo
- [x] Batch hex requests to amidi
- [ ] Dial layers
- [x] Shift key to turn dials without sending input
- [x] Mute controls for dials
- [ ] Guitar amp selection with buttons
- [x] Microphone mute button
- [ ] EQ selection with buttons
- [ ] Auto-connect gain controllers with pw-dump watcher
- [ ] Auto-connect virtual midi devices with aconnect
- [ ] Add TCP RPC
- [ ] Combine MIDI and Pipewire watch modes
