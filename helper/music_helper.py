"""Background helper for the music widget of the deskbar mod.

The mod cannot hear the speaker or press a media key by itself, so this small
process does three things and writes what it finds to state.json:

    now playing   Windows' own media session (the same one the volume flyout
                  shows): title, artist, playing or paused, position. Chrome
                  publishes YouTube Music there, so no browser automation.
    controls      toggle / next / prev / stop read from cmd.txt and sent to that
                  session (a media key as the fallback).
    spectrum      the speaker's output captured in loopback, as 24 bars.

It lives only while the widget is open: the mod touches alive.txt once a
second, and the helper exits when that is 12 seconds stale. One copy at a time
(helper.lock holds its pid).
"""
from __future__ import annotations

import asyncio
import ctypes
import json
import os
import sys
import threading
import time
from pathlib import Path

import numpy as np

# The folder its files live in is given on the command line (the mod's data
# folder); beside the script itself only when run by hand.
HERE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
STATE = HERE / "state.json"
CMD = HERE / "cmd.txt"
ALIVE = HERE / "alive.txt"
LOCK = HERE / "helper.lock"
LOG = HERE / "helper.log"

BARS = 24
RATE = 48000
BLOCK = 2048
FPS = 12
TICK = 0.02              # the command file is looked at fifty times a second
IDLE_EXIT = 12.0          # seconds without the mod's heartbeat

VK = {"toggle": 0xB3, "next": 0xB0, "prev": 0xB1, "stop": 0xB2, "volup": 0xAF, "voldown": 0xAE}
COVER = HERE / "cover.json"


def log(text: str) -> None:
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {text}\n")
    except OSError:
        pass


def press(key: str) -> None:
    vk = VK.get(key)
    if vk:
        ctypes.windll.user32.keybd_event(vk, 0, 1, 0)
        ctypes.windll.user32.keybd_event(vk, 0, 3, 0)


# ------------------------------------------------------------------ spectrum

class Spectrum(threading.Thread):
    """Reads the default speaker in loopback and keeps 24 bar heights (0-1).

    WASAPI loopback hands over nothing while nothing plays, so the read blocks;
    that is why it has a thread of its own and the bars decay by themselves."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.bars = np.zeros(BARS)
        self.level = 0.0
        self.at = 0.0
        self.error = ""
        edges = np.geomspace(50, 16000, BARS + 1)
        freqs = np.fft.rfftfreq(BLOCK, 1 / RATE)
        # the lowest bands are narrower than one FFT bin: those take the bin nearest their middle
        self.bins = [
            found if len(found) else np.array([int(np.argmin(np.abs(freqs - np.sqrt(lo * hi))))])
            for lo, hi in zip(edges[:-1], edges[1:])
            for found in [np.where((freqs >= lo) & (freqs < hi))[0]]
        ]
        self.window = np.hanning(BLOCK)

    def run(self) -> None:
        try:
            import soundcard as sc
            import warnings
            warnings.simplefilter("ignore")
            speaker = sc.default_speaker()
            mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
            with mic.recorder(samplerate=RATE, channels=2, blocksize=BLOCK) as rec:
                while True:
                    data = rec.record(numframes=BLOCK)
                    mono = data.mean(axis=1) if data.ndim > 1 else data
                    if len(mono) < BLOCK:
                        continue
                    mag = np.abs(np.fft.rfft(mono[:BLOCK] * self.window)) / (BLOCK / 4)
                    raw = np.array([mag[b].max() if len(b) else 0.0 for b in self.bins])
                    db = 20 * np.log10(raw + 1e-7)                # about -140 to 0
                    now = np.clip((db + 62) / 50, 0, 1)            # -62 dB floor
                    self.bars = np.maximum(now, self.bars * 0.72)  # fast up, slow down
                    self.level = float(np.sqrt(np.mean(mono ** 2)))
                    self.at = time.time()
        except Exception as e:  # noqa: BLE001
            self.error = f"{type(e).__name__}: {e}"
            log(f"spectrum stopped: {self.error}")

    def read(self) -> list[int]:
        if time.time() - self.at > 0.25:           # silence: let the bars fall
            self.bars = self.bars * 0.8
        return [int(round(v * 9)) for v in self.bars]


# ------------------------------------------------------------------ media session

_manager = None


async def session():
    # Asking Windows for the manager takes a moment: ask once and keep it, so a
    # button press goes straight to the session.
    global _manager
    if _manager is None:
        from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as Manager
        _manager = await Manager.request_async()
    return _manager.get_current_session()


async def now_playing() -> dict:
    try:
        from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status
        s = await session()
        if s is None:
            return {"has": False}
        props = await s.try_get_media_properties_async()
        info = s.get_playback_info()
        line = s.get_timeline_properties()
        return {
            "has": True,
            "title": props.title or "",
            "artist": props.artist or "",
            "app": (s.source_app_user_model_id or "").split("!")[0].split("\\")[-1],
            "playing": info.playback_status == Status.PLAYING,
            "position": line.position.total_seconds(),
            "duration": line.end_time.total_seconds(),
            "stamped": line.last_updated_time.timestamp() if line.last_updated_time else 0,
        }
    except Exception as e:  # noqa: BLE001
        return {"has": False, "error": f"{type(e).__name__}: {e}"}


async def cover(key: str) -> None:
    """The cover of the song playing, as a small JPEG in cover.json; an empty
    one when the player gives none. Written once per song."""
    data = ""
    try:
        import base64
        import io as _io
        from PIL import Image
        from winrt.windows.storage.streams import DataReader
        s = await session()
        props = await s.try_get_media_properties_async() if s is not None else None
        if props is not None and props.thumbnail is not None:
            stream = await props.thumbnail.open_read_async()
            reader = DataReader(stream)
            await reader.load_async(stream.size)
            raw = bytearray(stream.size)
            reader.read_bytes(raw)
            im = Image.open(_io.BytesIO(bytes(raw))).convert("RGB")
            w, h = im.size
            e = min(w, h)
            im = im.crop(((w - e) // 2, (h - e) // 2, (w - e) // 2 + e, (h - e) // 2 + e)).resize((72, 72))
            out = _io.BytesIO()
            im.save(out, "JPEG", quality=72)
            data = base64.b64encode(out.getvalue()).decode("ascii")
    except Exception as e:  # noqa: BLE001
        log(f"cover: {type(e).__name__}: {e}")
    try:
        COVER.write_text(json.dumps({"key": key, "jpeg": data}), encoding="utf-8")
    except OSError:
        pass


async def control(action: str) -> None:
    if action in ("volup", "voldown"):          # the system volume, two steps
        press(action)
        press(action)
        return
    try:
        s = await session()
        if s is not None:
            done = await {
                "toggle": s.try_toggle_play_pause_async,
                "next": s.try_skip_next_async,
                "prev": s.try_skip_previous_async,
                "stop": s.try_pause_async,
            }[action]()
            if done:
                return
    except Exception as e:  # noqa: BLE001
        log(f"control {action}: {type(e).__name__}: {e}")
    press(action)


# ------------------------------------------------------------------ main loop

def already_running() -> bool:
    try:
        pid = int(LOCK.read_text())
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return STATE.exists() and time.time() - STATE.stat().st_mtime < 3
    except (OSError, ValueError):
        pass
    return False


async def main() -> int:
    if already_running():
        return 0
    LOCK.write_text(str(os.getpid()))
    ALIVE.write_text(str(time.time()))
    spectrum = Spectrum()
    spectrum.start()
    track: dict = {"has": False}
    last_track = 0.0
    last_cmd = CMD.read_text(encoding="utf-8") if CMD.exists() else ""
    log("started")
    await session()                             # warm, so the first press is quick
    cmd_stamp = CMD.stat().st_mtime_ns if CMD.exists() else 0
    last_write = 0.0
    mine = Path(__file__).stat().st_mtime
    fast_until = 0.0
    cover_key = None
    while True:
        tick = time.time()
        # a press: the file's stamp is cheap to look at, so this runs every 20 ms
        try:
            stamp = CMD.stat().st_mtime_ns
        except OSError:
            stamp = cmd_stamp
        if stamp != cmd_stamp:
            cmd_stamp = stamp
            try:
                cmd = CMD.read_text(encoding="utf-8")
            except OSError:
                cmd = last_cmd
            if cmd != last_cmd:                 # "<counter> <action>"
                last_cmd = cmd
                action = cmd.split()[-1] if cmd.split() else ""
                if action in VK:
                    await control(action)
                    # the player takes ~50 ms to report its new state: look
                    # often for a moment instead of once a second
                    fast_until = tick + 1.5
                    last_track = 0.0
                    last_write = 0.0
        if tick - last_write < 1 / FPS:
            await asyncio.sleep(TICK)
            continue
        last_write = tick
        try:
            if tick - ALIVE.stat().st_mtime > IDLE_EXIT:
                break
            if Path(__file__).stat().st_mtime != mine:   # a newer helper was saved
                break
        except OSError:
            break
        if tick - last_track > (0.08 if tick < fast_until else 1.0):
            track = await now_playing()
            last_track = tick
        key = f"{track.get('title', '')}|{track.get('artist', '')}" if track.get("has") else ""
        if key != cover_key:                    # a new song: fetch its cover once
            cover_key = key
            await cover(key)
        track["coverKey"] = key
        if track.get("has") and track.get("playing") and track.get("stamped"):
            # Windows stamps the position now and then: run it on from there
            track["now"] = min(track["duration"] or 1e9, track["position"] + (tick - track["stamped"]))
        else:
            track["now"] = track.get("position", 0)
        state = {"at": tick, "bars": spectrum.read(), "level": round(spectrum.level, 4),
                 "spectrumError": spectrum.error, **track}
        tmp = STATE.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(state), encoding="utf-8")
            os.replace(tmp, STATE)
        except OSError:
            pass
        await asyncio.sleep(TICK)
    log("stopped: the widget is closed, or the helper was updated")
    try:
        LOCK.unlink()
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception as e:  # noqa: BLE001
        log(f"crashed: {type(e).__name__}: {e}")
        raise
