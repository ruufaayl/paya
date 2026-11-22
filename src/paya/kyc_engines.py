"""Image and biometric engines for onboarding. Everything here works on images IN MEMORY.

Nothing in this module writes an image, a face crop or a face template anywhere. Callers get numbers
(scores, ratios, booleans) and a keyed digest of the input, never the input.

Engines
  document quality   OpenCV: sharpness (variance of the Laplacian), brightness, glare
  document data      OpenCV QR reader on the specimen card's signed machine-readable code
  face               YuNet detector (MIT) + SFace recogniser (Apache 2.0) from the OpenCV model zoo
  liveness           active challenge: head turns measured from YuNet's five facial landmarks
  screening          fuzzy name match against a synthetic watch-list (standard library difflib)

If the face models are missing, the face engine is None and every face check returns ERROR, which the
decision rules turn into a human referral. A missing model can never cause an approval.
"""
import base64
import binascii
import hashlib
import hmac
import os
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Protocol

import cv2
import numpy as np

from .config import get_settings

MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_SIDE = 1280

YUNET_FILE = "face_detection_yunet_2023mar.onnx"
SFACE_FILE = "face_recognition_sface_2021dec.onnx"
MODEL_SHA256 = {
    YUNET_FILE: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    SFACE_FILE: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}


class ImageRejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def digest(data: bytes) -> str:
    """Keyed hash: proves which image was checked without keeping it, and cannot be reversed or looked up."""
    return hmac.new(get_settings().kyc_pepper.encode(), data, hashlib.sha256).hexdigest()


def decode_image(data_url: str) -> tuple[np.ndarray, str]:
    """Decode a base64 or data-URL image into a BGR array. Returns (image, keyed digest)."""
    if not isinstance(data_url, str) or not data_url:
        raise ImageRejected("IMAGE_MISSING")
    b64 = data_url.split(",", 1)[1] if data_url.startswith("data:") else data_url
    if len(b64) > MAX_IMAGE_BYTES * 4 // 3 + 16:
        raise ImageRejected("IMAGE_TOO_LARGE")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageRejected("IMAGE_NOT_BASE64") from exc
    if not (raw.startswith(b"\xff\xd8") or raw.startswith(b"\x89PNG") or raw[8:12] == b"WEBP"):
        raise ImageRejected("IMAGE_TYPE_NOT_ALLOWED")  # JPEG, PNG or WebP only, checked by magic bytes
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None or img.shape[0] < 48 or img.shape[1] < 48:
        raise ImageRejected("IMAGE_UNREADABLE")
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        f = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (int(w * f), int(h * f)), interpolation=cv2.INTER_AREA)
    return img, digest(raw)


# ------------------------------------------------------------------ document
def document_quality(img: np.ndarray) -> dict:
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    brightness = float(grey.mean())
    glare = float((grey >= 250).mean())
    problems = []
    if sharpness < 50:
        problems.append("BLURRY")
    if brightness < 60:
        problems.append("TOO_DARK")
    if brightness > 215:
        problems.append("TOO_BRIGHT")
    if glare > 0.20:  # the code itself is white, so only large clipped areas count
        problems.append("GLARE")
    return {"sharpness": round(sharpness, 1), "brightness": round(brightness, 1), "glare": round(glare, 4),
            "problems": problems}


def read_qr(img: np.ndarray) -> str | None:
    """Read the card's machine-readable code. Tries the standard and the more tolerant ArUco-based reader."""
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    readers = [cv2.QRCodeDetector()]
    if hasattr(cv2, "QRCodeDetectorAruco"):
        readers.append(cv2.QRCodeDetectorAruco())
    for candidate in (grey, cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]):
        for r in readers:
            try:
                text, _, _ = r.detectAndDecode(candidate)
            except cv2.error:
                continue
            if text:
                return text
    return None


# ------------------------------------------------------------------ face
@dataclass(frozen=True)
class Face:
    box: tuple[float, float, float, float]
    landmarks: tuple[tuple[float, float], ...]  # right eye, left eye, nose tip, right mouth, left mouth
    score: float
    row: np.ndarray | None = None  # the detector's raw row, needed by the aligner


class FaceEngine(Protocol):
    name: str

    def detect(self, img: np.ndarray) -> list[Face]: ...
    def embed(self, img: np.ndarray, face: Face) -> np.ndarray: ...
    def similarity(self, a: np.ndarray, b: np.ndarray) -> float: ...


class OpenCVFaceEngine:
    name = "opencv-yunet2023mar+sface2021dec"

    def __init__(self, model_dir: str) -> None:
        self._det = cv2.FaceDetectorYN.create(os.path.join(model_dir, YUNET_FILE), "", (320, 320), 0.8, 0.3, 50)
        self._rec = cv2.FaceRecognizerSF.create(os.path.join(model_dir, SFACE_FILE), "")

    def detect(self, img: np.ndarray) -> list[Face]:
        h, w = img.shape[:2]
        self._det.setInputSize((w, h))
        _, rows = self._det.detect(img)
        faces = []
        for r in rows if rows is not None else []:
            lm = tuple((float(r[4 + 2 * i]), float(r[5 + 2 * i])) for i in range(5))
            faces.append(Face(box=tuple(float(v) for v in r[:4]), landmarks=lm, score=float(r[14]), row=r))
        return sorted(faces, key=lambda f: f.box[2] * f.box[3], reverse=True)

    def embed(self, img: np.ndarray, face: Face) -> np.ndarray:
        return self._rec.feature(self._rec.alignCrop(img, face.row)).copy()

    def similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return float(self._rec.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))


def models_present(model_dir: str) -> bool:
    for name, sha in MODEL_SHA256.items():
        path = os.path.join(model_dir, name)
        if not os.path.exists(path):
            return False
        with open(path, "rb") as fh:
            if hashlib.sha256(fh.read()).hexdigest() != sha:
                return False  # a tampered or different model must not be used silently
    return True


@lru_cache(maxsize=1)
def _default_engine() -> FaceEngine | None:
    cfg = get_settings()
    if cfg.kyc_face_engine != "opencv":
        return None
    if not models_present(cfg.kyc_model_dir):
        from .config import on_vercel
        if not on_vercel():
            return None          # no models: every application is referred to a person (never auto-decided)
        try:                     # serverless: fetch into /tmp on first use, checksums verified as in `make models`
            from .fetch_models import fetch
            fetch(cfg.kyc_model_dir)
        except Exception:        # noqa: BLE001  a failed fetch must not break onboarding: it refers instead
            return None
        if not models_present(cfg.kyc_model_dir):
            return None
    return OpenCVFaceEngine(cfg.kyc_model_dir)


_override: list[FaceEngine | None] = []


def face_engine() -> FaceEngine | None:
    return _override[-1] if _override else _default_engine()


def set_face_engine(engine: FaceEngine | None) -> None:
    """Tests inject a deterministic engine. Production always uses the pinned OpenCV models (or none)."""
    _override.clear()
    _override.append(engine)


def clear_face_engine() -> None:
    _override.clear()


def yaw_ratio(face: Face) -> float:
    """Horizontal nose offset from the eye midpoint, divided by the distance between the eyes.

    About 0 when looking straight at the camera. Positive when the person turns to THEIR left
    (in an unmirrored camera image the nose moves to the right of the frame).
    """
    (rx, _), (lx, _), (nx, _) = face.landmarks[0], face.landmarks[1], face.landmarks[2]
    eye_dist = abs(lx - rx) or 1.0
    return (nx - (rx + lx) / 2) / eye_dist


# ------------------------------------------------------------------ screening
def _norm(name: str) -> str:
    return " ".join("".join(c if c.isalnum() else " " for c in name.lower()).split())


def name_similarity(a: str, b: str) -> float:
    na, nb = _norm(a), _norm(b)
    direct = SequenceMatcher(None, na, nb).ratio()
    tokens = SequenceMatcher(None, " ".join(sorted(na.split())), " ".join(sorted(nb.split()))).ratio()
    return round(max(direct, tokens), 3)
