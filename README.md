# pipewire-orchestrator

## Nodes

### Enable Virtual MIDI
```bash
sudo modprobe snd_virmidi
echo "snd-virmidi" | sudo tee /etc/modules
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
- [ ] Mute controls for dials
- [ ] Guitar amp selection with buttons
- [ ] Microphone mute button
- [ ] EQ selection with buttons?
