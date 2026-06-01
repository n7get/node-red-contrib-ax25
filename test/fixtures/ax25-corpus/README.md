# AX.25 Corpus Fixtures

This folder contains small synthetic binary fixtures used to validate decode classification behavior.

- i-frame.bin: control byte with least-significant bit unset (I-frame)
- s-frame.bin: control byte value mapped to S-frame
- u-frame.bin: control byte value mapped to U-frame

These fixtures follow the compact test codec framing format in lib/ax25-codec.js.
