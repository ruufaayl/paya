"""Drawn, entirely synthetic faces for exercising the real YuNet/SFace models without any real person.

The real detector finds these faces and their five landmarks, so head-turn liveness and the full
real-model pipeline can be tested. They are NOT suitable for testing whether the recogniser tells two
people apart (to SFace every cartoon looks alike); that is tested with the mock engine instead.
"""
import cv2
import numpy as np


def drawn_face(turn: float = 0.0, size: int = 400) -> np.ndarray:
    """turn in [-1, 1]: positive means the person turns to THEIR left (nose moves to the image's right)."""
    img = np.full((size, size, 3), (200, 210, 220), np.uint8)
    cv2.ellipse(img, (200, 210), (110, 140), 0, 0, 360, (140, 170, 215), -1)
    for side in (-1, 1):
        ex = 200 + side * 45 + int(turn * 12)
        cv2.ellipse(img, (ex, 180), (22, 12), 0, 0, 360, (255, 255, 255), -1)
        cv2.circle(img, (ex + int(turn * 6), 180), 9, (40, 30, 30), -1)
        cv2.line(img, (ex - 25, 155), (ex + 25, 152), (50, 50, 70), 5)
    nx = 200 + int(turn * 45)
    cv2.polylines(img, [np.array([[nx, 190], [nx - 15, 255], [nx + 15, 255]])], True, (100, 120, 170), 3)
    cv2.ellipse(img, (200 + int(turn * 22), 295), (40, 15), 0, 0, 180, (60, 60, 160), 5)
    img = cv2.GaussianBlur(img, (5, 5), 0)
    noise = np.random.default_rng(int(turn * 100) + 107).integers(-3, 4, img.shape)  # distinct frames
    return np.clip(img.astype(int) + noise, 0, 255).astype(np.uint8)
