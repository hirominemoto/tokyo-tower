# 東京タワー、見上げる場所 — 60s score, synthesized from scratch (numpy only)
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
import wave
SR = 44100; DUR = 60.0; N = int(SR * (DUR + 4))
rng = np.random.default_rng(20261115)
mix = {k: np.zeros((N, 2)) for k in ('piano', 'pad', 'bass', 'ep', 'bell')}
def f(m): return 440.0 * 2 ** ((m - 69) / 12)
def put(bus, t, sig, pan=0.0, gain=1.0):
    i = int(t * SR); n = min(len(sig), N - i)
    if n <= 0: return
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    mix[bus][i:i + n, 0] += sig[:n] * l * gain; mix[bus][i:i + n, 1] += sig[:n] * r * gain

def piano(m, dur, vel=0.6):
    f0 = f(m); L = int(SR * (dur + 3.5)); t = np.arange(L) / SR
    out = np.zeros(L); B = 0.00035 * (1 + max(0, m - 60) * 0.03)
    bright = 0.55 + 0.6 * vel
    for k in range(1, 13):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        if fk > 9000: break
        amp = (1.0 / k ** (2.0 - bright * 0.7)) * (0.6 if k % 2 == 0 else 1.0)
        tau = (2.6 / (1 + 0.45 * (k - 1))) * (1.25 - (m - 48) / 80)
        for det, a in ((0.0, 0.6), (0.0011, 0.4)):
            out += amp * a * np.exp(-t / tau) * np.sin(2 * np.pi * fk * (1 + det) * t + rng.uniform(0, 0.3))
    att = np.minimum(1, t / 0.006); out *= att
    # soft felt thump
    th = np.exp(-t / 0.02) * np.sin(2 * np.pi * 110 * t) * 0.05
    rel = np.where(t > dur, np.exp(-(t - dur) / 0.45), 1.0)   # half-pedalled release
    return (out + th) * rel * vel * 0.22

def ep(m, dur, vel=0.4):   # soft electric-piano / celesta tone for the alley arpeggio
    f0 = f(m); L = int(SR * (dur + 1.6)); t = np.arange(L) / SR
    modi = 1.1 * np.exp(-t / 0.25)
    s = np.sin(2 * np.pi * f0 * t + modi * np.sin(2 * np.pi * f0 * 2 * t)) * np.exp(-t / 0.9)
    s += 0.3 * np.sin(2 * np.pi * f0 * 2.0 * t) * np.exp(-t / 0.4)
    return s * np.minimum(1, t / 0.004) * vel * 0.16

def bell(m, vel=0.3):
    f0 = f(m); L = int(SR * 4.0); t = np.arange(L) / SR
    s = np.sin(2 * np.pi * f0 * t + 0.8 * np.exp(-t / 0.5) * np.sin(2 * np.pi * f0 * 3.01 * t)) * np.exp(-t / 1.3)
    return s * np.minimum(1, t / 0.003) * vel * 0.12

def pad(notes, t0, t1, vel=0.3, att=1.6, rel=2.2, bright=1.0):
    L = int(SR * (t1 - t0 + rel)); t = np.arange(L) / SR
    env = np.minimum(1, t / att) ** 1.5 * np.where(t > (t1 - t0), np.maximum(0, 1 - (t - (t1 - t0)) / rel) ** 2, 1.0)
    outL = np.zeros(L); outR = np.zeros(L)
    for m in notes:
        f0 = f(m)
        for det, pan in ((-0.0035, -0.7), (0.0, 0.0), (0.004, 0.7), (-0.0018, 0.35), (0.0022, -0.35)):
            ph = rng.uniform(0, 6.28); s = np.zeros(L)
            for k in range(1, 7):
                s += np.sin(2 * np.pi * f0 * (1 + det) * k * t + ph * k) / k ** (2.4 - 0.5 * bright)
            vib = 1 + 0.06 * np.sin(2 * np.pi * (0.17 + 0.05 * rng.random()) * t + rng.uniform(0, 6))
            s *= vib
            outL += s * (0.5 - pan * 0.4); outR += s * (0.5 + pan * 0.4)
    i = int(t0 * SR); n = min(L, N - i); g = vel * 0.05 / max(1, len(notes)) * 3
    mix['pad'][i:i + n, 0] += outL[:n] * env[:n] * g; mix['pad'][i:i + n, 1] += outR[:n] * env[:n] * g

def bass(m, t0, dur, vel=0.5):
    L = int(SR * (dur + 1.0)); t = np.arange(L) / SR; f0 = f(m)
    s = np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(2 * np.pi * 2 * f0 * t)
    env = np.minimum(1, t / 0.08) * np.where(t > dur, np.exp(-(t - dur) / 0.35), 1.0) * (0.75 + 0.25 * np.exp(-t / 1.5))
    put('bass', t0, s * env * vel * 0.16)

def P(t, m, dur=1.0, vel=0.55, pan=None):
    put('piano', t + rng.uniform(-0.006, 0.006), piano(m, dur, vel * rng.uniform(0.94, 1.04)), pan if pan is not None else (m - 66) / 40)

# ---------------- score ----------------
D2,E2,Fs2,G2,A2,B2 = 38,40,42,43,45,47
D3,E3,Fs3,G3,A3,B3,Cs4,D4,E4,Fs4,G4,A4,B4,Cs5,D5,E5,Fs5,G5,A5,B5,Cs6,D6,E6,Fs6,A6 = 50,52,54,55,57,59,61,62,64,66,67,69,71,73,74,76,78,79,81,83,85,86,88,90,93
# bars: (start, length, bass, pad notes, left-hand notes)
bars = [
 (3, 4, D2,  [D3, A3, Fs4, E4],        [D3, A3, Fs4]),      # Dadd9      street
 (7, 4, B2-12+12, [B3-12, Fs3, D4, A4-12], [B2, Fs3, D4]),  # Bm7
 (11, 4, G2, [G3, D4, Fs4, B3],        [G2, D3, B3]),       # Gmaj7      temple
 (15, 4, A2, [A3-12, E3, D4, E4],      [A2, E3, D4]),       # Asus
 (19, 4, Fs2,[Fs3, A3, D4, E4],        [Fs2, D3, A3]),      # D/F#       park
 (23, 4, G2, [G3, B3, D4, Fs4],        [G2, D3, B3]),       # Gmaj7
 (27, 4, E2, [E3, G3, B3, D4, Fs4],    [E2, B2, G3]),       # Em9        alley
 (31, 4, A2, [A3-12, G3, D4, E4],      [A2, E3, G3]),       # A7sus
 (35, 4, B2-12+12, [B3-12, Fs3, A3, D4], [B2, Fs3, D4]),    # Bm7        konbini
 (39, 5, G2, [G3, B3, D4, Fs4],        [G2, D3, B3]),       # Gmaj7 ... (fermata)  ただいま
 (44, 4, D2, [D3, A3, D4, Fs4, A4],    [D2, A2, Fs3, D4]),  # D          pull back
 (48, 4, B2-12+12, [B3-12, Fs3, D4, A4], [B2, Fs3, D4]),    # Bm7
 (52, 4, G2, [G3, B3, D4, E4],         [G2, D3, B3]),       # G6 -> A
 (56, 6, D2, [D3, A3, D4, E4, Fs4, A4],[D2, A2]),           # Dadd9      title
]
dyn = lambda t: 0.75 if t < 11 else 0.7 if t < 19 else 0.85 if t < 27 else 0.8 if t < 35 else 0.62 if t < 44 else 1.0
for (t0, ln, b, pd, lh) in bars:
    d = dyn(t0)
    pad(pd, t0 - 0.6, t0 + ln - 0.2, vel=(0.5 if t0 < 44 else 0.85) * (0.7 if 35 <= t0 < 44 else 1), bright=1.0 if t0 < 44 else 1.5)
    bass(b, t0, ln - 0.4, 0.5 * d)
    if t0 < 44:
        for i, m in enumerate(lh): P(t0 + i * 0.07, m, 3.0, 0.36 * d)
        if t0 not in (11, 15, 35, 39): P(t0 + 2.0, lh[1], 1.5, 0.26 * d); P(t0 + 2.5, lh[2], 1.2, 0.24 * d)
    elif t0 < 56:
        for i, m in enumerate(lh): P(t0 + i * 0.06, m, 3.5, 0.5)
        for k, m in enumerate([lh[1], lh[2], lh[3] if len(lh) > 3 else lh[2] + 12, lh[2], lh[1] + 12, lh[2]]): P(t0 + 1.0 + k * 0.5, m, 0.9, 0.3)
# pad pre-roll from the very first frame, and extra low A pedal under the 44s lift
pad([D3, A3], 0.0, 3.0, vel=0.35, att=2.2)
pad([A2 + 12, E4], 42.2, 44.2, vel=0.35, att=1.4, rel=1.2)
pad([D5, Fs5, A5], 44.0, 59.0, vel=0.42, att=3.5, rel=3.0, bright=1.6)   # high strings for the wide view

# alley: gentle eighth-note arpeggio (27-35)
arps = {27: [E4, G4, B4, D5, Fs5, D5, B4, G4], 31: [E4, G4, A4, D5, E5, D5, A4, G4]}
for t0, seq in arps.items():
    for k, m in enumerate(seq): put('ep', t0 + k * 0.5 + 0.25, ep(m, 0.5, 0.34 if k % 2 == 0 else 0.26), pan=0.35 * (-1) ** k)
# konbini: sparse cool ticks
for t, m in [(35.5, Fs5), (36.5, A5), (37.5, Fs5), (38.5, D5)]: put('ep', t, ep(m, 0.6, 0.22), pan=0.3)

mel = [
 (1.0, A4, 1.6, .34), (2.0, Fs4, 1.4, .30),
 (3.0, A4, .5, .5), (3.5, D5, .5, .52), (4.0, Fs5, 1.5, .6), (5.5, E5, .5, .48), (6.0, D5, 1.4, .5),
 (7.0, B4, .5, .48), (7.5, D5, .5, .5), (8.0, Fs5, 1.5, .58), (9.5, E5, .5, .46), (10.0, Cs5, 1.3, .46),
 (11.0, B4, 2.0, .46), (13.0, D5, 1.0, .44), (14.0, A4, 1.4, .42),
 (15.0, E5, 2.0, .48), (17.0, D5, 1.0, .44), (18.0, Cs5, 1.2, .42),
 (19.0, A4, .5, .5), (19.5, D5, .5, .52), (20.0, Fs5, .5, .56), (20.5, A5, 1.5, .64), (22.0, Fs5, .5, .5), (22.5, E5, .7, .48),
 (23.0, D5, .5, .5), (23.5, G5, .5, .54), (24.0, B5, 1.5, .64), (25.5, A5, .5, .52), (26.0, Fs5, 1.2, .5),
 (27.0, G5, 1.0, .56), (28.0, Fs5, .5, .48), (28.5, E5, .5, .46), (29.0, B4, 2.0, .48),
 (31.0, A4, .5, .46), (31.5, D5, .5, .48), (32.0, E5, 1.5, .56), (33.5, G5, .5, .5), (34.0, E5, 1.2, .46),
 (35.0, Fs5, 2.0, .44), (37.0, D5, 1.0, .4), (38.0, B4, 1.2, .38),
 (39.0, B4, .5, .42), (39.5, D5, .5, .44), (40.0, G5, 1.5, .52), (41.55, Fs5, 1.1, .5), (42.75, E5, 1.6, .4),
 (44.0, A4, .5, .62), (44.5, D5, .5, .64), (45.0, Fs5, 1.5, .74), (46.5, E5, .5, .6), (47.0, D5, 1.2, .62),
 (48.0, B4, .5, .6), (48.5, D5, .5, .62), (49.0, Fs5, .5, .68), (49.5, A5, 1.4, .76), (51.0, Fs5, .5, .6), (51.5, E5, .6, .58),
 (52.0, D5, .5, .6), (52.5, G5, .5, .62), (53.0, B5, 1.0, .72), (54.0, A5, 1.0, .64), (55.0, E5, 1.0, .54),
]
for (t, m, d, v) in mel:
    P(t, m, d + 0.6, v)
    if t >= 44: P(t + 0.004, m + 12, d + 0.4, v * 0.42, pan=0.25)
# final chord (title), rolled, then one high answer
for i, m in enumerate([D3, A3, D4, E4, Fs4, A4, D5, Fs5]): P(56.0 + i * 0.075, m, 4.5, 0.5 - 0.02 * i)
P(57.6, A5, 3.0, .34); P(58.4, D6, 3.0, .28)
for t, m, v in [(45.0, Fs6, .22), (47.0, D6, .16), (49.5, A6, .22), (53.0, D6 + 12 - 12, .16), (56.3, A6, .2), (57.6, Fs6, .14)]: put('bell', t, bell(m, v), pan=rng.uniform(-0.5, 0.5))
# temple: two distant low bells
for t in (12.0, 16.0): put('bell', t, bell(D4, .28), pan=-0.3)

# ---------------- mix ----------------
def lp(x, fc): sos = butter(2, fc / (SR / 2), 'low', output='sos'); return sosfilt(sos, x, axis=0)
def hp(x, fc): sos = butter(2, fc / (SR / 2), 'high', output='sos'); return sosfilt(sos, x, axis=0)
dry = lp(mix['piano'], 5200) * 1.0 + lp(mix['pad'], 3800) * 0.9 + mix['bass'] * 0.9 + lp(mix['ep'], 4200) * 0.8 + lp(mix['bell'], 6500) * 0.7
send = lp(mix['piano'], 4200) * 0.9 + mix['pad'] * 0.45 + mix['ep'] * 1.0 + mix['bell'] * 1.4
# hall: decaying filtered noise, different per channel
L = int(SR * 3.2); tt = np.arange(L) / SR
ir = np.stack([rng.standard_normal(L), rng.standard_normal(L)], 1) * (np.exp(-tt / 0.75))[:, None]
ir[: int(0.012 * SR)] = 0; ir = lp(hp(ir, 250), 3600); ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1)
out = dry + wet * 0.33
out = hp(out, 28)
out = out[: int(SR * DUR)]
t = np.arange(len(out)) / SR
out *= (np.minimum(1, t / 0.4) * np.clip((60.0 - t) / 2.2, 0, 1) ** 1.5)[:, None]
# gentle glue: soft saturation + normalize
pk = np.abs(out).max(); out = np.tanh(out / pk * 1.35) / np.tanh(1.35)
out *= 0.84 / np.abs(out).max()
rms = np.sqrt((out ** 2).mean()); print('peak %.2f rms %.3f (%.1f dBFS)' % (np.abs(out).max(), rms, 20 * np.log10(rms)))
for a, b in [(0, 11), (11, 19), (19, 27), (27, 35), (35, 44), (44, 56), (56, 60)]:
    s = out[int(a * SR):int(b * SR)]; print(a, b, '%.1f dB' % (20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9)))
w = wave.open('score.wav', 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((out * 32767).astype('<i2').tobytes()); w.close()
