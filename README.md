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
