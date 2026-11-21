# Face models (not committed)

Run `make models` (or `python -m paya.fetch_models models`) to download them. Each file's SHA-256 is pinned in `src/paya/kyc_engines.py`; a file that does not match is never loaded.

| File | Purpose | Licence | Source |
|---|---|---|---|
| `face_detection_yunet_2023mar.onnx` | Face detection and five landmarks | MIT (`LICENSE-yunet-MIT`) | OpenCV model zoo |
| `face_recognition_sface_2021dec.onnx` | Face template and cosine match | Apache 2.0 (`LICENSE-sface-Apache-2.0`) | OpenCV model zoo |

If the models are missing, onboarding still works, but every application is referred to Compliance. A missing model can never approve anyone.
