"""Download the two face models used for onboarding and verify their SHA-256 before use.

  python -m paya.fetch_models [target_dir]

YuNet (face detection) is MIT-licensed and SFace (face recognition) is Apache-2.0, both from the
OpenCV model zoo; both allow commercial use. (InsightFace's pretrained models were rejected because
they are licensed for non-commercial research only.) The files are not committed to the repository.
"""
import hashlib
import os
import sys
import urllib.request

from .kyc_engines import MODEL_SHA256, SFACE_FILE, YUNET_FILE

BASE = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
URLS = {YUNET_FILE: f"{BASE}/face_detection_yunet/{YUNET_FILE}",
        SFACE_FILE: f"{BASE}/face_recognition_sface/{SFACE_FILE}"}


def fetch(target: str) -> None:
    os.makedirs(target, exist_ok=True)
    for name, url in URLS.items():
        path = os.path.join(target, name)
        if os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() == MODEL_SHA256[name]:
            print(f"ok      {name}")
            continue
        data = urllib.request.urlopen(url, timeout=120).read()
        got = hashlib.sha256(data).hexdigest()
        if got != MODEL_SHA256[name]:
            raise SystemExit(f"checksum mismatch for {name}: {got}")
        with open(path, "wb") as fh:
            fh.write(data)
        print(f"fetched {name} ({len(data):,} bytes, sha256 verified)")


if __name__ == "__main__":
    fetch(sys.argv[1] if len(sys.argv) > 1 else "models")
